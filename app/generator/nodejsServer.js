'use strict';
const N = require('./naming');

function storageFile() {
  return `'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }

/** 本地磁盘：uploads/<date>/<rand>.<ext> */
function saveLocal(buffer, filename) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dir = path.join(cfg.storage.localDir, day);
  ensure(dir);
  const ext = path.extname(filename || '').toLowerCase();
  const key = crypto.randomBytes(12).toString('hex') + ext;
  fs.writeFileSync(path.join(dir, key), buffer);
  return { objectKey: day + '/' + key, url: '/uploads/' + day + '/' + key };
}

/** S3 / MinIO 预签名 URL（SigV4，GET 读 / PUT 写） */
function presign(method, objectKey, expiresSec = 900) {
  const { endpoint, bucket, accessKey, secretKey } = cfg.storage;
  if (!endpoint || !accessKey || !secretKey) return null;
  const url = new URL(endpoint.replace(/\\/$/, '') + '/' + bucket + '/' + objectKey.replace(/^\\//, ''));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[\\-:]/g, '').split('.')[0] + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const region = process.env.OSS_REGION || 'us-east-1';
  const service = 's3';
  const scope = dateStamp + '/' + region + '/' + service + '/aws4_request';
  const qp = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': accessKey + '/' + scope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': 'host',
  });
  const canonical = [method, url.pathname, qp.toString(), 'host:' + url.host + '\\n', 'host', 'UNSIGNED-PAYLOAD'].join('\\n');
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash].join('\\n');
  const kDate = crypto.createHmac('sha256', 'AWS4' + secretKey).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSign = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const sig = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  qp.set('X-Amz-Signature', sig);
  return url.toString() + '?' + qp.toString();
}

async function put(buffer, filename) {
  if (cfg.storage.provider === 'local') return saveLocal(buffer, filename);
  const saved = saveLocal(buffer, filename);
  const signed = presign('PUT', saved.objectKey);
  if (!signed) return saved;
  const r = await fetch(signed, { method: 'PUT', body: buffer });
  if (!r.ok) throw new Error('对象存储上传失败：' + r.status);
  return { objectKey: saved.objectKey, url: cfg.storage.publicBase ? cfg.storage.publicBase + '/' + saved.objectKey : signed.split('?')[0] };
}

function signedUrl(objectKey, expiresSec = 900) {
  const s = presign('GET', objectKey, expiresSec);
  if (s) return s;
  return cfg.storage.publicBase ? cfg.storage.publicBase + '/' + objectKey : '/uploads/' + objectKey;
}

module.exports = { put, signedUrl, presign, saveLocal };
`;
}

function pluginsFile() {
  return `'use strict';
const db = require('./db');
const storage = require('./storage');

/**
 * 视频分区插件：同一套接口，不同分区挂不同实现。
 * 分区表里存 plugin_code + plugin_config(JSON)，播放时按分区解析。
 * 内置：
 *   passthrough  直链播放
 *   signed       防盗链（签名 URL）
 *   watermark    水印（返回水印参数，前端/转码服务叠加）
 *   drm          加密封装（返回 keyId/许可证地址）
 */
const BUILTIN = {
  passthrough: {
    code: 'passthrough',
    async play(asset) { return { url: asset.url || asset.object_key, mode: 'direct' }; },
  },
  signed: {
    code: 'signed',
    async play(asset) { return { url: storage.signedUrl(asset.object_key), mode: 'signed', expires: 900 }; },
  },
  watermark: {
    code: 'watermark',
    async play(asset, cfg) {
      return { url: storage.signedUrl(asset.object_key), mode: 'watermark', watermark: cfg.watermark || { text: 'ClickBuild', position: 'br' } };
    },
  },
  drm: {
    code: 'drm',
    async play(asset, cfg) { return { url: storage.signedUrl(asset.object_key), mode: 'drm', keyId: cfg.keyId || '', licenseUrl: cfg.licenseUrl || '' }; },
  },
};

function parseConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function resolve(partitionCode) {
  if (!partitionCode) return { code: 'passthrough', impl: BUILTIN.passthrough, config: {} };
  const rows = await db.query('SELECT * FROM media_partition WHERE partition_code = ? LIMIT 1', [partitionCode], { read: true }).catch(() => []);
  if (!rows.length) return { code: 'passthrough', impl: BUILTIN.passthrough, config: {} };
  const row = rows[0];
  const code = row.plugin_code || 'passthrough';
  const impl = BUILTIN[code] || BUILTIN.passthrough;
  return { code, impl, config: parseConfig(row.plugin_config), partition: row };
}

async function play(partitionCode, asset) {
  const plugin = await resolve(partitionCode);
  const payload = await plugin.impl.play(asset, plugin.config);
  return { ...payload, plugin: plugin.code, partition: partitionCode || '' };
}

module.exports = { resolve, play, BUILTIN, parseConfig };
`;
}

function uploadFile(ir) {
  const limits = (ir.project.upload && ir.project.upload.limit) || {};
  return `'use strict';
// 只有真正收到上传请求时才加载 busboy，未装依赖也能启动/自检
let busboyLib = null;
function getBusboy() {
  if (!busboyLib) busboyLib = require('busboy');
  return busboyLib;
}
const path = require('path');
const crypto = require('crypto');
const storage = require('./storage');

const MAX_SIZE = Number(process.env.UPLOAD_MAX_SIZE || ${limits.maxSize || 200} * 1024 * 1024);

const TYPE_MAP = [
  { type: 'video', exts: ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.flv', '.m3u8', '.ts'] },
  { type: 'audio', exts: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'] },
  { type: 'doc', exts: ['.doc', '.docx', '.ppt', '.pptx', '.pdf', '.xls', '.xlsx', '.txt', '.md'] },
  { type: 'image', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] },
  { type: 'archive', exts: ['.zip', '.rar', '.7z', '.tar', '.gz'] },
];

function detect(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  for (const item of TYPE_MAP) if (item.exts.includes(ext)) return { type: item.type, ext };
  return { type: 'other', ext };
}

/** 解析 multipart：返回 { fields, file } */
function parse(req) {
  return new Promise((resolve, reject) => {
    const bb = getBusboy()({ headers: req.headers, limits: { fileSize: MAX_SIZE } });
    let file = null;
    const fields = {};
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => { size += c.length; chunks.push(c); });
      stream.on('limit', () => reject(Object.assign(new Error('文件超过大小上限'), { status: 413 })));
      stream.on('end', () => {
        file = { field: name, filename: info.filename, mime: info.mimeType, buffer: Buffer.concat(chunks), size };
      });
    });
    bb.on('error', reject);
    bb.on('close', () => resolve({ fields, file }));
    req.pipe(bb);
  });
}

async function handle(req, db, user) {
  const { fields, file } = await parse(req);
  if (!file) throw Object.assign(new Error('缺少文件'), { status: 400 });
  const allowed = (process.env.UPLOAD_EXTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const detected = detect(file.filename);
  if (allowed.length && !allowed.includes(detected.ext)) {
    throw Object.assign(new Error('不允许的扩展名：' + detected.ext), { status: 400 });
  }
  const saved = await storage.put(file.buffer, file.filename);
  return {
    assetType: detected.type,
    ext: detected.ext,
    objectKey: saved.objectKey,
    url: saved.url,
    size: file.size,
    title: fields.title || path.basename(file.filename, detected.ext),
    bucket: fields.bucket || 'media',
  };
}

module.exports = { handle, detect, TYPE_MAP, MAX_SIZE };
`;
}

function serverFile(ir) {
  const p = ir.project;
  const hasMedia = ir.modules.some((m) => m.id === 'media-upload');
  const hasPlay = ir.modules.some((m) => m.id === 'media-play');
  const hasBlocks = (ir.blocks || []).length > 0;
  const hasVerify = ir.modules.some((m) => m.id === 'verify-code');
  return `'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./src/config');
const db = require('./src/db');
const auth = require('./src/auth');
const crud = require('./src/crud');
const customSql = require('./src/customSql');
const schema = require('./src/schema');
const plugins = require('./src/plugins');
const upload = require('./src/upload');
const waf = require('./src/waf');

const SELF_CHECK = process.argv.includes('--selfcheck');
const routes = [];

function add(method, pattern, handler, opts = {}) {
  const keys = [];
  // pathname 已剥掉 contextPath 与前导斜杠，这里统一去掉 pattern 的前导斜杠再编译
  const raw = String(pattern);
  const src = raw.startsWith('/') ? raw.slice(1) : raw;
  const regex = new RegExp('^' + src.replace(/\\//g, '\\\\/').replace(/:([\\w]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '\\/?$');
  routes.push({ method: method.toUpperCase(), regex, keys, handler, opts });
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

const ok = (res, data) => send(res, 200, { code: 0, message: 'ok', data });
const fail = (res, status, message) => send(res, status, { code: status, message });

function csv(res, rows, table) {
  const cols = table.columns.map((c) => c.name);
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => {
    const v = r[c] == null ? '' : String(r[c]);
    return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=' + table.name + '.csv' });
  res.end(head + '\\n' + body + '\\n');
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 20 * 1024 * 1024) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  if (waf.inspectBody(raw)) throw Object.assign(new Error('请求内容被安全策略拦截'), { status: 403 });
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

async function logOp(req, user, module, action, detail) {
  try {
    await db.query(
      // id 是雪花主键（没有自增），module 在 DDL 里避关键字成了 module_x
      'INSERT INTO sys_operation_log (id, module_x, action, user_id, username, params, ip, created_at) VALUES (?,?,?,?,?,?,?,NOW())',
      [require('./src/id').next(), module, action, user ? user.userId : null, user ? user.username : '', String(detail || '').slice(0, 500), req.socket.remoteAddress || ''],
    );
  } catch { /* 日志失败不影响主流程 */ }
}

/* ----------------------------- 路由注册 ----------------------------- */

add('POST', '/auth/login', async (req, res) => {});
add('POST', '/auth/logout', async (req, res) => {});
add('GET', '/auth/me', async (req, res) => {});
add('POST', '/auth/refresh', async (req, res) => {});

schema.tables.forEach((t) => {
  const base = t.route;
  const perm = (action) => t.module + ':' + action;
  const service = crud.make(t.name);

  add('GET', base, async (req, res, params, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('list'))) return fail(res, 403, '无权限：' + perm('list'));
    const r = await service.list(ctx.query, ctx.user);
    ok(res, r);
  }, { module: t.module, action: 'list' });

  add('GET', base + '/list', async (req, res, params, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('list'))) return fail(res, 403, '无权限：' + perm('list'));
    const r = await service.list(ctx.query, ctx.user);
    ok(res, r);
  }, { module: t.module, action: 'list' });

  add('GET', base + '/export', async (req, res, params, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('export') || perm('list'))) return fail(res, 403, '无权限');
    const r = await service.list({ ...ctx.query, pageSize: 5000 }, ctx.user);
    csv(res, r.rows, t);
  }, { module: t.module, action: 'export' });

  add('GET', base + '/:id', async (req, res, p, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('detail'))) return fail(res, 403, '无权限');
    const row = await service.detail(p.id);
    if (!row) return fail(res, 404, '不存在');
    ok(res, row);
  }, { module: t.module, action: 'detail' });

  add('POST', base, async (req, res, p, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('create'))) return fail(res, 403, '无权限');
    const body = await readBody(req);
    const id = await service.create(body, ctx.user);
    await logOp(req, ctx.user, t.module, 'create', id);
    ok(res, { id });
  }, { module: t.module, action: 'create' });

  add('PUT', base + '/:id', async (req, res, p, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('update'))) return fail(res, 403, '无权限');
    const body = await readBody(req);
    await service.update(p.id, body, ctx.user);
    await logOp(req, ctx.user, t.module, 'update', p.id);
    ok(res, true);
  }, { module: t.module, action: 'update' });

  add('DELETE', base + '/:id', async (req, res, p, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('delete'))) return fail(res, 403, '无权限');
    await service.remove(p.id, ctx.user);
    await logOp(req, ctx.user, t.module, 'delete', p.id);
    ok(res, true);
  }, { module: t.module, action: 'delete' });

  // 条件新增：批量插入
  add('POST', base + '/batch', async (req, res, p, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('create'))) return fail(res, 403, '无权限');
    const body = await readBody(req);
    const items = Array.isArray(body) ? body : (body.items || []);
    const r = await service.insertMany(items, ctx.user);
    await logOp(req, ctx.user, t.module, 'create-batch', 'count=' + r.count);
    ok(res, r);
  }, { module: t.module, action: 'create' });

  // 条件更新：PATCH ?条件 + body 设置
  add('PATCH', base, async (req, res, p, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('update'))) return fail(res, 403, '无权限');
    const body = await readBody(req);
    const sets = body.set || body.data || body;
    const where = Object.assign({}, ctx.query, body.where || {});
    const r = await service.patchWhere(where, sets, ctx.user);
    await logOp(req, ctx.user, t.module, 'update-where', JSON.stringify(r));
    ok(res, r);
  }, { module: t.module, action: 'update' });

  // 条件删除：不带 id，按 ?字段=值 / filter 批量删
  add('DELETE', base, async (req, res, p, ctx) => {
    if (!auth.hasPerm(ctx.user, perm('delete'))) return fail(res, 403, '无权限');
    const r = await service.removeWhere(ctx.query, ctx.user);
    await logOp(req, ctx.user, t.module, 'delete-where', JSON.stringify(r));
    ok(res, r);
  }, { module: t.module, action: 'delete' });
});

// 自定义 SQL
schema.queries.forEach((q) => {
  add(q.method, '/query/' + q.name, async (req, res, p, ctx) => {
    if (!auth.hasPerm(ctx.user, q.perm)) return fail(res, 403, '无权限：' + q.perm);
    const src = Object.assign({}, ctx.query, ctx.user ? { userId: ctx.user.userId, username: ctx.user.username } : {});
    if (req.method === 'POST') Object.assign(src, await readBody(req));
    const r = await customSql.run(q.name, src);
    ok(res, r);
  }, { module: 'query', action: q.name });
});
add('GET', '/query', async (req, res) => ok(res, customSql.list()));
${hasBlocks ? `// 自定义积木：用户自己写的工具，一个积木一条路由
const blocksMod = require('./src/blocks');
blocksMod.list.forEach((b) => {
  add(b.method, b.path, async (req, res, p, ctx) => {
    if (b.perm && !auth.hasPerm(ctx.user, b.perm)) return fail(res, 403, '无权限：' + b.perm);
    const body = req.method === 'POST' ? await readBody(req) : null;
    const r = await b.handler({ req, user: ctx.user, params: p, query: ctx.query, body, db, cache: require('./src/cache'), ids: require('./src/id') });
    ok(res, r);
  }, { module: 'block', action: b.id });
});
add('GET', '/blocks', async (req, res) => ok(res, blocksMod.list.map((b) => ({ id: b.id, name: b.name, method: b.method, path: b.path, perm: b.perm }))));
` : ''}
${hasVerify ? `// 验证码：发送 / 校验，通道由你在 config 里接第三方服务
const verifyCode = require('./src/verifyCode');
add('POST', '/captcha/send', async (req, res, p, ctx) => {
  if (!auth.hasPerm(ctx.user, 'verify-code:create')) return fail(res, 403, '无权限：verify-code:create');
  const body = await readBody(req);
  const r = await verifyCode.send(body.channel || 'sms', body.target, body.scene, req.socket.remoteAddress || '');
  await logOp(req, ctx.user, 'verify-code', 'send', body.channel + ':' + body.target);
  ok(res, { channel: r.channel, provider: r.provider, sent: r.sent, dryRun: r.dryRun || false, expireAt: r.expireAt });
}, { module: 'verify-code', action: 'send' });

add('POST', '/captcha/verify', async (req, res, p, ctx) => {
  if (!auth.hasPerm(ctx.user, 'verify-code:list')) return fail(res, 403, '无权限：verify-code:list');
  const body = await readBody(req);
  const pass = await verifyCode.verify(body.channel || 'sms', body.target, body.code, body.scene);
  ok(res, { verified: !!pass });
}, { module: 'verify-code', action: 'verify' });

add('GET', '/captcha/channels', async (req, res, p, ctx) => {
  if (!auth.hasPerm(ctx.user, 'verify-code:list')) return fail(res, 403, '无权限');
  ok(res, verifyCode.channels());
}, { module: 'verify-code', action: 'channels' });
` : ''}

${hasMedia ? `// 媒体上传：按扩展名判定 audio/video/doc/image
add('POST', '/media/upload', async (req, res, p, ctx) => {
  if (!auth.hasPerm(ctx.user, 'file:upload')) return fail(res, 403, '无权限：file:upload');
  const r = await upload.handle(req, db, ctx.user);
  await logOp(req, ctx.user, 'media', 'upload', r.objectKey);
  ok(res, r);
}, { module: 'media', action: 'upload' });
` : ''}
${hasPlay ? `// 视频播放：按分区解析插件
add('GET', '/media/play/:partition/:id', async (req, res, p, ctx) => {
  const rows = await db.query('SELECT * FROM media_asset WHERE id = ? LIMIT 1', [p.id], { read: true }).catch(() => []);
  if (!rows.length) return fail(res, 404, '资产不存在');
  const r = await plugins.play(p.partition, rows[0]);
  ok(res, r);
}, { module: 'media', action: 'play' });

add('GET', '/media/plugins', async (req, res) => ok(res, Object.values(plugins.BUILTIN).map((x) => ({ code: x.code }))));
` : ''}

/* ----------------------------- 请求处理 ----------------------------- */

async function handle(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname.replace(cfg.app.contextPath, '').replace(/^\\//, '');

  // 第一道闸：SQL 注入 / XSS / 穿越 / CC / 并发 / CORS / 安全头
  if (waf.guard(req, res, url)) return;

  // 静态：本地存储的媒体
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const file = path.join(cfg.storage.localDir || './uploads', url.pathname.slice('/uploads/'.length));
    if (fs.existsSync(file)) {
      fs.createReadStream(file).pipe(res);
      return;
    }
    return fail(res, 404, '文件不存在');
  }

  // 健康检查：不鉴权、不踩权限拦截，给容器/网关探活用
  if (req.method === 'GET' && (pathname === 'health' || pathname === 'healthz')) {
    const dbOk = await Promise.race([
      db.ping().then((v) => !!v).catch(() => false),
      new Promise((r) => setTimeout(() => r(false), 1200)),
    ]);
    return ok(res, {
      status: dbOk ? 'UP' : 'DEGRADED',
      app: cfg.app.name,
      uptime: Math.round(process.uptime()),
      db: dbOk,
      redis: cfg.redis.enabled ? 'configured' : 'disabled',
      time: new Date().toISOString(),
    });
  }

  const hit = routes.find((r) => r.method === req.method && r.regex.test(pathname));
  if (!hit) return fail(res, 404, '接口不存在：' + pathname);

  const m = pathname.match(hit.regex);
  const params = {};
  hit.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  const query = Object.fromEntries(url.searchParams.entries());

  try {
    // 登录相关不需要鉴权
    if (pathname.startsWith('auth/')) {
      if (pathname === 'auth/login') {
        const body = await readBody(req);
        const rows = await db.query('SELECT * FROM sys_user WHERE username = ? AND deleted = 0 LIMIT 1', [body.username || '']);
        if (!rows.length) return fail(res, 401, '账号或密码错误');
        const u = rows[0];
        if (!auth.checkPassword(body.password || '', u.password)) return fail(res, 401, '账号或密码错误');
        const tid = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const issued = await auth.issueLuid(u.id, u.username);
        const perms = issued ? issued.perms : await auth.loadPerms(u.id);
        const token = auth.sign({ uid: u.id, uname: u.username, tid, luid: issued ? issued.luid : undefined });
        await db.query('INSERT INTO sys_session (token_id, user_id, device, ip, expires_at, revoked) VALUES (?,?,?,?,DATE_ADD(NOW(), INTERVAL ? SECOND),0)',
          [tid, u.id, req.headers['user-agent'] || '', req.socket.remoteAddress || '', cfg.app.tokenTtl]).catch(() => []);
        auth.setCookie(res, token);
        return ok(res, { token, userId: u.id, username: u.username, luid: issued ? issued.luid : null, perms });
      }
      if (pathname === 'auth/logout') {
        const t = auth.tokenFrom(req);
        const c = auth.verify(t);
        if (c && c.tid) await db.query('UPDATE sys_session SET revoked = 1 WHERE token_id = ?', [c.tid]).catch(() => []);
        if (c && c.luid) await auth.dropLuid(c.luid).catch(() => null);
        auth.clearCookie(res);
        return ok(res, true);
      }
      if (pathname === 'auth/me') {
        const u = await auth.current(req);
        if (!u) return fail(res, 401, '未登录');
        return ok(res, u);
      }
      if (pathname === 'auth/refresh') {
        const u = await auth.current(req);
        if (!u) return fail(res, 401, '未登录');
        const token = auth.sign({ uid: u.userId, uname: u.username, tid: u.tokenId, luid: u.luid });
        auth.setCookie(res, token);
        return ok(res, { token, luid: u.luid || null });
      }
    }

    const user = await auth.current(req);
    if (!user) return fail(res, 401, '未登录');
    await hit.handler(req, res, params, { user, query });
  } catch (e) {
    // 数据库不可用时不要把内网地址/账号暴露给客户端，只回 503
    const dbDown = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH',
      'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(e.code);
    console.error('[error]', pathname, e.code || '-', e.message);
    if (dbDown) return fail(res, 503, '数据库暂不可用，请稍后再试');
    const status = e.status || 500;
    return fail(res, status, status >= 500 ? '服务器内部错误' : (e.message || '请求失败'));
  }
}

async function main() {
  if (SELF_CHECK) {
    console.log('[selfcheck] 表 ' + schema.tables.length + ' / 查询 ' + schema.queries.length + ' / 路由 ' + routes.length);
    routes.forEach((r) => console.log('  ' + r.method.padEnd(6) + ' ' + cfg.app.contextPath + '/ ' + r.regex.source));
    return;
  }
  const server = http.createServer((req, res) => {
    waf.enter();
    res.on('close', waf.leave);
    handle(req, res);
  });
  server.listen(cfg.app.port, async () => {
    console.log('[boot] ' + cfg.app.name + ' listening on http://localhost:' + cfg.app.port + cfg.app.contextPath);
    try {
      if (await db.ping()) {
        await auth.bootstrap();
        console.log('[boot] MySQL 连接正常');
      }
    } catch (e) {
      console.warn('[boot] MySQL 未连接：' + e.message + '（接口会在首次查询时报错）');
    }
  });
}

main();
`;
}

/** 自定义积木：用户自己写的工具/接口，一个积木一个 handler。 */
function blocksFile(ir) {
  const validCode = (code) => {
    try {
      // 生成期先验证用户片段是不是合法 JS，避免一个手滑的占位符把整个工程弄崩
      new Function('ctx', `return (async () => {\n${code}\n})();`);
      return true;
    } catch (e) {
      return false;
    }
  };
  const list = (ir.blocks || []).map((b) => {
    const hasCode = b.code && b.code.trim();
    let body;
    if (!hasCode) {
      body = `      return { block: ${JSON.stringify(b.id)}, params: ctx.params, query: ctx.query, body: ctx.body };`;
    } else if (validCode(b.code)) {
      body = b.code;
    } else {
      // 片段暂时不是合法 JS：原样保留成注释，并给出可运行的默认返回
      body = b.code.split('\n').map((l) => '      // ' + l).join('\n') +
        `\n      return { block: ${JSON.stringify(b.id)}, note: '这段自定义代码还没写成合法 JS，改好 blocks.js 后重启即可' };`;
    }
    return `  {
    id: ${JSON.stringify(b.id)},
    name: ${JSON.stringify(b.name)},
    method: ${JSON.stringify(b.method)},
    path: ${JSON.stringify('/blocks/' + b.id)},
    perm: ${JSON.stringify(b.perm)},
    params: ${JSON.stringify(b.params || [])},
    // 自定 SQL 在这里写：可用 ctx.db / ctx.cache / ctx.ids / ctx.user
    async handler(ctx) {
${body}
    },
  },`;
  });

  return `'use strict';
const db = require('./db');
const cache = require('./cache');
const ids = require('./id');

/**
 * 自定义积木：生成后仍可自由改写 handler —— 这就是"用户自己写的工具"。
 * ctx = { req, user, params, query, body, db, cache, ids }
 */
const blocks = [
${list.join('\n')}
];

module.exports = { list: blocks, db, cache, ids };
`;
}

/** 验证码：只做"对接骨架"，真正发送由你配置的第三方通道完成。 */
function verifyCodeFile(ir) {
  const ver = ir.verification || {};
  const sms = ver.sms || {};
  const email = ver.email || {};
  return `'use strict';
const db = require('./db');
const cache = require('./cache');
const cfg = require('./config');

/** 短信通道：provider=none 时只打印（联调用）；provider=http 时 POST 到你自己的网关。 */
async function sendSms(target, code, scene) {
  const s = cfg.verification.sms;
  if (!s.provider || s.provider === 'none') {
    console.log('[sms:dry-run]', target, code, scene);
    return { channel: 'sms', provider: 'none', sent: false, dryRun: true };
  }
  if (s.provider === 'http' && s.endpoint) {
    if (typeof fetch !== 'function') throw new Error('当前 Node 无 fetch，请升级到 18+');
    const r = await fetch(s.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, code, scene, signName: s.signName, templateCode: s.templateCode }),
    });
    if (!r.ok) throw new Error('短信网关返回 ' + r.status);
    return { channel: 'sms', provider: 'http', sent: true };
  }
  throw new Error('未实现的短信通道：' + s.provider + '（支持 none / http，或自行在 sendSms 里补实现）');
}

/** 邮件通道：provider=http 走网关；smtp 需要你自己装 nodemailer 后在此实现。 */
async function sendEmail(target, code, scene) {
  const e = cfg.verification.email;
  if (!e.provider || e.provider === 'none') {
    console.log('[email:dry-run]', target, code, scene);
    return { channel: 'email', provider: 'none', sent: false, dryRun: true };
  }
  if (e.provider === 'http') {
    const gateway = e.host.startsWith('http') ? e.host : 'http://' + e.host;
    if (typeof fetch !== 'function') throw new Error('当前 Node 无 fetch，请升级到 18+');
    const r = await fetch(gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, code, scene, from: e.from }),
    });
    if (!r.ok) throw new Error('邮件网关返回 ' + r.status);
    return { channel: 'email', provider: 'http', sent: true };
  }
  throw new Error('smtp 模式需要安装 nodemailer 并在 sendEmail 内实现');
}

function randomCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

async function send(channel, target, scene, ip) {
  if (!target) throw new Error('缺少接收方');
  if (!['sms', 'email'].includes(channel)) throw new Error('通道只支持 sms / email');
  const code = randomCode(6);
  const expireAt = new Date(Date.now() + 5 * 60 * 1000);

  await db.query(
    'INSERT INTO sys_verify_code (id, channel, target, code, scene, expire_at, used, sent_at, ip, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,0,NOW(),?,NOW(),NOW(),0)',
    [require('./id').next(), channel, target, code, scene || 'default', expireAt, ip || ''],
  ).catch(() => null);

  await cache.set('vcode:' + channel + ':' + target + ':' + (scene || 'default'), code, 300);

  const r = channel === 'sms' ? await sendSms(target, code, scene) : await sendEmail(target, code, scene);
  return { ...r, code, expireAt };
}

async function verify(channel, target, code, scene) {
  if (!code) return false;
  const key = 'vcode:' + channel + ':' + target + ':' + (scene || 'default');
  const cached = await cache.get(key);
  if (cached && String(cached) === String(code)) {
    await cache.del(key);
    await db.query('UPDATE sys_verify_code SET used = 1 WHERE target = ? AND code = ? AND used = 0', [target, code]).catch(() => null);
    return true;
  }
  const rows = await db.query(
    'SELECT * FROM sys_verify_code WHERE target = ? AND code = ? AND used = 0 ORDER BY id DESC LIMIT 1',
    [target, code], { read: true },
  ).catch(() => []);
  if (!rows.length) return false;
  await db.query('UPDATE sys_verify_code SET used = 1 WHERE id = ?', [rows[0].id]).catch(() => null);
  return true;
}

function channels() {
  return {
    sms: { provider: cfg.verification.sms.provider, endpoint: cfg.verification.sms.endpoint },
    email: { provider: cfg.verification.email.provider, host: cfg.verification.email.host },
  };
}

module.exports = { send, verify, channels, sendSms, sendEmail, randomCode };
`;
}

/** 基础 WAF：进程内挡掉常见扫描、灌流量与跨域乱配。 */
function wafFile() {
  return `'use strict';
/**
 * 基础防护（生成期固化配置）：
 *   SQL 注入 / XSS / 路径穿越 / CC 限流 / 并发上限 / CORS / 安全响应头。
 * 真上生产建议再在前面挂 Nginx 或 ONRouter，这里是最低成本的第一道闸。
 */
const cfg = require('./config');
const W = cfg.waf || {};

const SQLI = /(union\\s+select|select\\s+[\\w,\\s*]+\\s+from|insert\\s+into|delete\\s+from|drop\\s+table|'\\s*or\\s*'|\\bor\\s+1\\s*=\\s*1|;\\s*--|\\bsleep\\s*\\(|benchmark\\s*\\()/i;
const XSS = /(<script|javascript:\\s|onerror\\s*=|onload\\s*=|<iframe|document\\.cookie)/i;

const buckets = new Map();
let inFlight = 0;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const raw = (fwd ? String(fwd).split(',')[0] : req.socket.remoteAddress) || '';
  return raw.trim();
}

function decode(s) {
  try { return decodeURIComponent(decodeURIComponent(s)); } catch (e) { return s; }
}

function allow(ip) {
  const rps = W.cc.rps || 20;
  const burst = W.cc.burst || 40;
  if (buckets.size > 20000) buckets.clear();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: burst, last: Date.now() }; buckets.set(ip, b); }
  const now = Date.now();
  b.tokens = Math.min(burst, b.tokens + ((now - b.last) / 1000) * rps);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function headers(res) {
  if (!res.setHeader) return;
  if (W.headers && W.headers.contentTypeOptions) res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', (W.headers && W.headers.frameOptions) || 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (W.headers && W.headers.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function cors(req, res) {
  const c = W.cors || {};
  if (!c.enabled) return false;
  const origin = req.headers.origin;
  const list = c.origins || ['*'];
  if (origin && (list.includes('*') || list.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', c.credentials ? origin : (list.includes('*') ? '*' : origin));
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', (c.methods || []).join(', '));
    res.setHeader('Access-Control-Allow-Headers', (c.headers || []).join(', '));
    res.setHeader('Access-Control-Expose-Headers', 'X-Luid');
    if (c.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

function deny(res, msg, status) {
  const body = JSON.stringify({ code: status || 403, message: msg, data: null });
  res.writeHead(status || 403, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/** 返回 true 表示请求已被拦截（响应已写回）。 */
function guard(req, res, url) {
  if (!W.enabled) return false;
  headers(res);
  if (W.ddos && W.ddos.enabled && inFlight > (W.ddos.maxConcurrent || 200)) {
    deny(res, '服务器繁忙，请稍后再试', 503);
    return true;
  }
  if (W.cc && W.cc.enabled && !allow(clientIp(req))) {
    deny(res, '请求过于频繁', 429);
    return true;
  }
  const probe = decode(url.pathname + '?' + url.search);
  if (W.pathTraversal && (probe.includes('../') || probe.includes('..\\\\') || probe.includes('%2e%2e') || probe.includes('%252e'))) {
    deny(res, '非法路径');
    return true;
  }
  if (W.sqlInjection && SQLI.test(probe)) {
    deny(res, '非法参数');
    return true;
  }
  if (W.xss && XSS.test(probe)) {
    deny(res, '非法内容');
    return true;
  }
  if (cors(req, res)) return true;
  return false;
}

/** 请求体检测（默认关闭：正文里出现 SQL 关键字可能是正常业务内容）。 */
function inspectBody(raw) {
  if (!W.enabled || !W.sqlInjectionBody || !raw) return false;
  if (raw.length > 200000) return false;
  return SQLI.test(raw);
}

function enter() { inFlight += 1; }
function leave() { inFlight = Math.max(0, inFlight - 1); }
function stats() { return { inFlight, buckets: buckets.size }; }

module.exports = { guard, inspectBody, enter, leave, stats, SQLI, XSS };
`;
}

module.exports = { storageFile, pluginsFile, uploadFile, serverFile, blocksFile, verifyCodeFile, wafFile };
