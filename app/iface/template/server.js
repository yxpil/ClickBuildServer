'use strict';

// 由 ClickBuild 生成的接口服务（v3）。
// 一个接口 = 多张表（可跨库/跨连接）+ 多条脚本路由；SQL / Redis / 对象存储三向联动。
// 额外能力：事务与回滚日志、限流、时间窗、熔断、分级日志（可落库）、token 会话、服务间调用、OpenAPI 文档、SSE 日志流。
// 依赖：mysql2 / ioredis / minio（构建器带着，可用 NODE_PATH 指过来）。

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const Minio = require('minio');
const render = require('./src/render');
const scriptEngine = require('./src/script');

const ROOT = __dirname;
const CFG = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 13306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DB || 'clickbuild',
  redisHost: process.env.REDIS_HOST || '127.0.0.1',
  redisPort: Number(process.env.REDIS_PORT || 16379),
  redisDb: Number(process.env.REDIS_DB || 0),
  s3End: process.env.S3_ENDPOINT || '127.0.0.1',
  s3Port: Number(process.env.S3_PORT || 19000),
  s3Key: process.env.S3_ACCESS_KEY || 'clickbuild',
  s3Secret: process.env.S3_SECRET_KEY || 'clickbuild123',
  s3Ssl: String(process.env.S3_SSL || 'false') === 'true',
  httpPort: Number(process.env.PORT || 18100),
  apiPrefix: process.env.API_PREFIX || '/api',
  resetDb: String(process.env.RESET_DB || '') === '1',
  logLevel: String(process.env.LOG_LEVEL || '').toUpperCase(),
};

const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'interfaces.json'), 'utf8'));
const IFACES = project.interfaces || [];
const CONNS = project.connections || {};
const LOG_CFG = project.log || {};
const TOKEN_CFG = project.token || {};
const DOCS_CFG = project.docs || {};
const CACHE_NS = process.env.CACHE_PREFIX || `icb:cache:${project.name || 'project'}`;

const FUNCS = {};
(project.functions || []).forEach((f) => {
  try { FUNCS[f.name.toUpperCase()] = { params: f.params, ast: scriptEngine.parseExpr(f.body) }; } catch (e) { console.error('自定义函数解析失败', f.name, e.message); }
});
const PARSED = new WeakMap();

const LEVELS = { TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50, FATAL: 60 };
const MIN_LEVEL = LEVELS[CFG.logLevel || LOG_CFG.level || 'INFO'] || 30;
const COLORS = { TRACE: '\x1b[90m', DEBUG: '\x1b[36m', INFO: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m', FATAL: '\x1b[35m' };

const pools = new Map(); // key -> { pool, cfg }
let redis = null;
let s3 = null;
let bucketReady = false;
let logPool = null;

const RING = [];
const SSE = new Set();
const RL = new Map(); // 内存限流
const BREAK = new Map(); // 熔断状态

function mysqlConn(key) {
  const list = CONNS.mysql || [];
  return list.find((c) => c.key === (key || 'main')) || list[0] || { key: 'main', host: CFG.host, port: CFG.port, user: CFG.user, password: CFG.password, database: CFG.database };
}

// 平台默认库（clickbuild）跟随 MYSQL_DB，这样同一个生成服务换库就能多项目隔离；
// 显式写了别的库名（多库工程）则原样使用。
function dbOf(cfg) {
  const raw = (cfg && cfg.database) || '';
  if (!raw || raw === 'clickbuild') return CFG.database;
  return raw;
}

async function poolFor(key) {
  const cfg = mysqlConn(key);
  const id = cfg.key || 'main';
  if (!pools.has(id)) {
    const pool = mysql.createPool({
      host: cfg.host, port: Number(cfg.port), user: cfg.user, password: cfg.password,
      database: dbOf(cfg), waitForConnections: true, connectionLimit: 10,
      multipleStatements: false, namedPlaceholders: false,
    });
    pools.set(id, { pool, cfg });
  }
  return pools.get(id);
}

function parsedOf(route) {
  if (!PARSED.has(route)) {
    const p = scriptEngine.parseScript(route.script || '');
    if (p.errors.length) console.error('脚本解析有问题：', route.method, route.path, p.errors);
    PARSED.set(route, p.ast);
  }
  return PARSED.get(route);
}

// ---------------- 日志 ----------------
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function logPush(entry) {
  RING.push(entry);
  if (RING.length > 500) RING.shift();
  for (const cli of SSE) {
    try { cli.write(`data: ${JSON.stringify(entry)}\n\n`); } catch (e) { /* 客户端断了 */ }
  }
  if (LOG_CFG.console !== false) {
    const color = COLORS[entry.level] || '';
    console.log(`${color}[${entry.level}] ${entry.ts} ${entry.method || ''} ${entry.pathname || ''} ${entry.status || ''} ${entry.ms != null ? `${entry.ms}ms` : ''} ${entry.message || ''}\x1b[0m`);
  }
  if (LOG_CFG.enabled) persistLog(entry);
}

let logPoolWarned = false;
function persistLog(entry) {
  if ((LEVELS[entry.level] || 30) < MIN_LEVEL) return;
  if (!logPool) {
    if (!logPoolWarned) { logPoolWarned = true; console.error('日志落库跳过：日志连接不可用'); }
    return;
  }
  const table = LOG_CFG.table || 'sys_log';
  logPool.query(
    `INSERT INTO \`${table}\` (level, iface, route, method, pathname, status, ms, ip, trace_id, message, meta, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
    [entry.level, entry.iface || '', entry.route || '', entry.method || '', entry.pathname || '', entry.status || 0,
      entry.ms || 0, entry.ip || '', String(entry.traceId || '').slice(0, 64), String(entry.message || '').slice(0, 500),
      entry.data ? JSON.stringify(entry.data).slice(0, 2000) : null],
  ).catch((e) => { if (!logPoolWarned) { logPoolWarned = true; console.error('日志落库失败：', e.message); } });
}

// ---------------- 会话（token） ----------------
const TOKEN_TTL = Number(TOKEN_CFG.ttl || 7200);
const tokenStore = {
  async mint(user) {
    if (!redis) throw new Error('Redis 不可用，无法签发 token');
    const onlyId = (user && user.onlyId) || crypto.randomUUID().replace(/-/g, '');
    const token = crypto.randomBytes(24).toString('hex');
    const payload = { ...user, onlyId, issuedAt: new Date().toISOString() };
    await redis.setex(`icb:token:${token}`, TOKEN_TTL, JSON.stringify(payload));
    await redis.set(`icb:only:${onlyId}`, token, 'EX', TOKEN_TTL);
    return { token, onlyId, ttl: TOKEN_TTL };
  },
  async get(token) {
    if (!redis || !token) return null;
    const raw = await redis.get(`icb:token:${token}`);
    return raw ? JSON.parse(raw) : null;
  },
  async del(token) {
    if (!redis || !token) return false;
    const raw = await redis.get(`icb:token:${token}`);
    if (raw) {
      try {
        const u = JSON.parse(raw);
        if (u.onlyId) await redis.del(`icb:only:${u.onlyId}`);
      } catch (e) { /* 忽略 */ }
    }
    await redis.del(`icb:token:${token}`);
    return true;
  },
};

function bearer(req) {
  const h = req.headers[String(TOKEN_CFG.header || 'authorization').toLowerCase()] || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  if (m) return m[1].trim();
  const cookie = String(req.headers.cookie || '');
  const cm = new RegExp(`${TOKEN_CFG.cookie || 'icb_token'}=([^;]+)`).exec(cookie);
  return cm ? decodeURIComponent(cm[1]) : '';
}

// ---------------- 路由匹配 ----------------
function routeRegex(prefix, pattern) {
  const keys = [];
  const full = `^${(prefix + pattern).split('/').map((seg) => {
    if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
    if (seg === '*') { keys.push('*'); return '(.*)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/')}/?$`;
  return { re: new RegExp(full), keys };
}

const TABLE = [];
for (const iface of IFACES) {
  for (const route of iface.routes || []) {
    const base = (iface.basePath || '').replace(/\/$/, '');
    const { re, keys } = routeRegex(CFG.apiPrefix + base, route.path);
    TABLE.push({ iface, route, re, keys, specific: !route.path.includes(':') });
  }
}
TABLE.sort((a, b) => Number(b.specific) - Number(a.specific));

function matchRoute(method, pathname) {
  for (const item of TABLE) {
    const m = item.re.exec(pathname);
    if (!m) continue;
    if (item.route.method !== method && !(method === 'HEAD' && item.route.method === 'GET')) continue;
    const params = {};
    item.keys.forEach((k, i) => { if (k !== '*') params[k] = decodeURIComponent(m[i + 1] || ''); });
    return { ...item, params };
  }
  return null;
}

function send(res, status, body, extra) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-filename,x-content-type,authorization',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'cache-control': 'no-store',
    ...(extra || {}),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) { reject(new Error('请求体超过 64MB')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buf, boundary) {
  const fields = {};
  let file = null;
  const delim = Buffer.from(`--${boundary}`);
  let idx = buf.indexOf(delim);
  while (idx >= 0) {
    const start = idx + delim.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(delim, start);
    if (next < 0) break;
    const raw = buf.slice(start + 2, next - 2);
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headers = raw.slice(0, headerEnd).toString('utf8');
      const content = raw.slice(headerEnd + 4);
      const nameM = /name="([^"]+)"/i.exec(headers);
      const fileM = /filename="([^"]*)"/i.exec(headers);
      if (fileM) file = { filename: fileM[1], contentType: (/content-type:\s*([^\r\n]+)/i.exec(headers) || [])[1] || 'application/octet-stream', buffer: content };
      else if (nameM) fields[nameM[1]] = content.toString('utf8');
    }
    idx = next;
  }
  return { fields, file };
}

function safeName(name) {
  return String(name || 'file').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120);
}

async function putObject(iface, filename, contentType, buffer) {
  if (!s3 || !bucketReady) throw new Error('对象存储不可用');
  const day = new Date().toISOString().slice(0, 10);
  const bucket = (iface.storage && iface.storage.bucket) || 'clickbuild';
  const key = `${iface.tables[0].name}/${day}/${crypto.randomUUID()}-${safeName(filename)}`;
  await s3.putObject(bucket, key, buffer, buffer.length, { 'Content-Type': contentType || 'application/octet-stream' });
  let url = '';
  try { url = await s3.presignedGetObject(bucket, key, 7 * 24 * 3600); } catch (e) { url = ''; }
  return { objectKey: key, objectUrl: url, filename, size: buffer.length, contentType: contentType || 'application/octet-stream', bucket };
}

function cacheKeyOf(iface, route, ctx) {
  const tpl = route.cache.key || `icb:${iface.tables[0].name}:${route.method}:${route.path}:{{queryHash}}`;
  try {
    const raw = render.renderText(tpl, iface, ctx);
    if (!raw) return '';
    // 每个工程一个缓存命名空间，多个工程共用一台 Redis 也互不相干
    return raw.startsWith(`${CACHE_NS}:`) ? raw : `${CACHE_NS}:${raw.replace(/^icb:/, '')}`;
  } catch (e) { return ''; }
}

async function invalidate(iface) {
  if (!redis) return;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${CACHE_NS}:*`, 'COUNT', 200);
    cursor = next;
    if (keys.length) await redis.del(keys);
  } while (cursor !== '0');
}

// ---------------- 限流 / 时间窗 / 熔断 ----------------
async function rateOk(key, limit, windowSec) {
  const ttl = Math.max(1, Number(windowSec) || 60);
  if (redis) {
    try {
      const k = `icb:rl:${key}:${Math.floor(Date.now() / (ttl * 1000))}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, ttl + 1);
      return { ok: n <= limit, count: n, limit, ttl };
    } catch (e) { /* 落回内存 */ }
  }
  const now = Date.now();
  const slot = `${key}:${Math.floor(now / (ttl * 1000))}`;
  const cur = (RL.get(slot) || 0) + 1;
  RL.set(slot, cur);
  if (RL.size > 5000) RL.clear();
  return { ok: cur <= limit, count: cur, limit, ttl };
}

function clockMinutes(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function inWindow(cfg) {
  if (!cfg || !cfg.enabled) return true;
  const from = clockMinutes(cfg.from);
  const to = clockMinutes(cfg.to);
  if (from == null || to == null) return true;
  const d = new Date();
  const now = d.getHours() * 60 + d.getMinutes();
  if (from === to) return true;
  if (from < to) return now >= from && now <= to;
  return now >= from || now <= to; // 跨零点
}

function breakerState(key) {
  if (!BREAK.has(key)) BREAK.set(key, { fails: 0, openUntil: 0, last: 0 });
  return BREAK.get(key);
}

function breakerOpen(key, cfg) {
  if (!cfg || !cfg.enabled) return { open: false };
  const st = breakerState(key);
  const open = st.openUntil > Date.now();
  return { open, until: st.openUntil, fails: st.fails, threshold: cfg.threshold };
}

function breakerRecord(key, cfg, failed) {
  if (!cfg || !cfg.enabled) return;
  const st = breakerState(key);
  if (failed) {
    st.fails += 1;
    if (st.fails >= Number(cfg.threshold || 5)) {
      st.openUntil = Date.now() + Number(cfg.cooldown || 30) * 1000;
      st.fails = 0;
      logPush({ level: 'WARN', ts: stamp(), message: `熔断打开：${key}，${cfg.cooldown}s 后半开`, data: { key } });
    }
  } else {
    st.fails = 0;
    st.openUntil = 0;
  }
}

// ---------------- 请求处理 ----------------
async function handle(req, res, item) {
  const started = Date.now();
  const iface = item.iface;
  const route = item.route;
  const guard = route.guard || {};
  const url = new URL(req.url, 'http://local');
  const pathname = decodeURIComponent(url.pathname);
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '');
  const traceId = crypto.randomBytes(8).toString('hex');
  const rkey = `${iface.id}:${route.method}:${route.path}`;

  const query = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  const raw = await readBody(req);
  let body = {};
  let file = null;
  const ct = String(req.headers['content-type'] || '');
  try {
    if (ct.includes('application/json') && raw.length) body = JSON.parse(raw.toString('utf8')) || {};
    else if (ct.includes('multipart/form-data')) {
      const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
      if (m) {
        const mp = parseMultipart(raw, (m[1] || m[2] || '').trim());
        body = mp.fields;
        file = mp.file;
      }
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
    }
  } catch (e) {
    return send(res, 400, { ok: false, error: 'BAD_BODY', message: e.message });
  }

  if (req.headers['x-filename'] && raw.length && (!ct || ct.includes('application/octet-stream') || ct.startsWith('image/') || ct.startsWith('text/'))) {
    file = { filename: String(req.headers['x-filename']), contentType: String(req.headers['x-content-type'] || ct || 'application/octet-stream'), buffer: raw };
  }

  // 时间窗
  if (!inWindow(guard.schedule)) {
    const e = { level: 'WARN', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 503, ms: 0, ip, traceId, message: '不在服务时间段' };
    logPush(e);
    return send(res, 503, { ok: false, error: 'SCHEDULE_OFF', message: `该接口只在 ${guard.schedule.from} ~ ${guard.schedule.to} 之间开放`, traceId });
  }

  // 熔断
  const br = breakerOpen(rkey, guard.breaker);
  if (br.open) {
    const e = { level: 'WARN', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 503, ms: 0, ip, traceId, message: '熔断中' };
    logPush(e);
    return send(res, 503, { ok: false, error: 'BREAKER_OPEN', message: '接口临时熔断，稍后再试', until: new Date(br.until).toISOString(), traceId }, { 'retry-after': String(Math.ceil((br.until - Date.now()) / 1000)) });
  }

  // 限流
  if (guard.rate && guard.rate.enabled) {
    const r = await rateOk(rkey, Number(guard.rate.limit || 60), Number(guard.rate.window || 60));
    if (!r.ok) {
      logPush({ level: 'WARN', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 429, ms: 0, ip, traceId, message: `限流 ${r.count}/${r.limit}` });
      return send(res, 429, { ok: false, error: 'RATE_LIMIT', message: `每 ${r.ttl}s 最多 ${r.limit} 次`, traceId }, { 'retry-after': String(r.ttl) });
    }
  }

  // 会话
  let user = null;
  let token = '';
  if (route.auth) {
    token = bearer(req);
    user = token ? await tokenStore.get(token) : null;
    if (!user) {
      logPush({ level: 'WARN', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 401, ms: 0, ip, traceId, message: 'token 无效' });
      return send(res, 401, { ok: false, error: 'UNAUTHORIZED', message: '需要有效的 token（Authorization: Bearer ... 或 cookie）', traceId });
    }
  }

  const ctx = {
    query, body, path: item.params, id: item.params.id != null ? item.params.id : (query.id != null ? query.id : body.id),
    file: null, vars: user ? { user } : {}, uuid: crypto.randomUUID().replace(/-/g, ''),
    user, token, remoteIp: ip, traceId, service: project.services || [],
  };

  let uploaded = null;
  if (file && iface.storage && iface.storage.enabled !== false && route.key === 'upload') {
    uploaded = await putObject(iface, file.filename, file.contentType, file.buffer);
    ctx.file = uploaded;
  }

  const ckey = route.cache && route.cache.enabled ? cacheKeyOf(iface, route, ctx) : '';
  if (ckey && redis) {
    try {
      const hit = await redis.get(ckey);
      if (hit) {
        const ms = Date.now() - started;
        logPush({ level: 'DEBUG', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 200, ms, ip, traceId, message: 'cache hit' });
        return send(res, 200, { ok: true, cached: true, data: JSON.parse(hit), ms });
      }
    } catch (e) { /* 缓存读失败就当没命中 */ }
  }

  const dbHandle = await poolFor((iface.tables[0] && iface.tables[0].conn) || 'main');
  const txStates = new Map(); // connKey -> { conn, inTx, released }
  const txKeys = new Set();
  (iface.tables || []).forEach((t) => txKeys.add(t.conn || 'main'));
  if (!txKeys.size) txKeys.add('main');

  function connKeyForSql(sql) {
    const text = String(sql || '');
    let hit = null; let len = 0;
    let mainSeen = false;
    for (const t of (iface.tables || [])) {
      const n = t.name;
      if (!n) continue;
      const re = new RegExp('(^|[^A-Za-z0-9_])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])', 'i');
      if (!re.test(text)) continue;
      if ((t.conn || 'main') === 'main') mainSeen = true;
      if (n.length > len) { hit = t.conn || 'main'; len = n.length; }
    }
    // 跨库 JOIN：一句 SQL 同时命中主库表和辅库表时走 main。
    // 主库表通常未加 schema，换到辅库连接会把主库表名解析到辅库；辅库表在脚本里用 {{schema:item}} 全限定。
    if (mainSeen && hit !== 'main') return 'main';
    return hit || ((iface.tables[0] && iface.tables[0].conn) || 'main');
  }

  async function txBeginAll() {
    const started = [];
    for (const key of txKeys) {
      if (txStates.get(key) && txStates.get(key).inTx) continue;
      const h = await poolFor(key);
      const c = await h.pool.getConnection();
      try { await c.beginTransaction(); } catch (e) { try { c.release(); } catch (x) {} throw e; }
      txStates.set(key, { conn: c, inTx: true, released: false });
      started.push(key);
    }
    return started;
  }

  async function txRollbackAll(reason) {
    const failed = [];
    for (const [key, st] of txStates) {
      if (!st.inTx) continue;
      try { await st.conn.rollback(); } catch (e) { failed.push({ key, error: e.message }); }
      st.inTx = false;
      try { st.conn.release(); } catch (x) {}
      st.released = true;
      if (reason) {
        logPush({ level: failed.length ? 'FATAL' : 'WARN', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 500, ms: Date.now() - started, ip, traceId, message: `事务回滚（${reason}）`, data: { conn: key, error: failed.find((f) => f.key === key) ? failed.find((f) => f.key === key).error : undefined } });
      }
    }
    return failed;
  }

  async function txCommitAll() {
    const committed = []; let failure = null;
    for (const [key, st] of txStates) {
      if (!st.inTx) continue;
      try {
        await st.conn.commit();
        st.inTx = false;
        committed.push(key);
        try { st.conn.release(); } catch (x) {}
        st.released = true;
      } catch (e) {
        failure = { key, error: e.message };
        break; // 保留连接给 txRollbackAll 做补偿
      }
    }
    return { committed, failure };
  }

  async function dbQuery(sql, params) {
    const key = connKeyForSql(sql);
    const st = txStates.get(key);
    const runner = st && st.inTx ? st.conn : (await poolFor(key)).pool;
    return (await runner.query(sql, params))[0];
  }
  async function dbExecute(sql, params) {
    const key = connKeyForSql(sql);
    const st = txStates.get(key);
    const runner = st && st.inTx ? st.conn : (await poolFor(key)).pool;
    const [r] = await runner.execute(sql, params);
    return { affectedRows: r.affectedRows || 0, insertId: r.insertId != null ? r.insertId : null, info: r.info || '' };
  }

  const startedTx = !!guard.tx;
  if (startedTx) {
    try {
      await txBeginAll();
      if (txStates.size > 1) logPush({ level: 'INFO', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 200, ms: Date.now() - started, ip, traceId, message: `跨库事务开启（${[...txStates.keys()].join(',')}）` });
    } catch (e) {
      await txRollbackAll('开启失败');
      logPush({ level: 'ERROR', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 500, ms: Date.now() - started, ip, traceId, message: '开启事务失败', data: { error: e.message } });
      return send(res, 500, { ok: false, error: 'TX_BEGIN_FAILED', message: e.message, traceId });
    }
  }

  const logs = [];
  let result;
  try {
    result = await scriptEngine.runScript(parsedOf(route), {
      iface, ctx,
      vars: ctx.vars || {},
      customFuncs: FUNCS,
      db: {
        query: dbQuery,
        execute: dbExecute,
        tx: async (action) => {
          if (!startedTx) throw new Error('该路由没有开启事务（guard.tx=false）');
          if (action === 'BEGIN') { await txBeginAll(); return { state: 'BEGIN', connections: [...txStates.keys()] }; }
          if (action === 'COMMIT') { const r = await txCommitAll(); if (r.failure) throw new Error(`COMMIT_FAILED ${r.failure.key}: ${r.failure.error}`); return { state: 'COMMIT', committed: r.committed }; }
          if (action === 'ROLLBACK') { const f = await txRollbackAll('手动回滚'); return { state: 'ROLLBACK', failed: f }; }
          return { state: action };
        },
      },
      http: async (method, target, payload, headers) => {
        const u = String(target || '');
        if (!/^http(s)?:\/\//i.test(u)) throw new Error(`HTTP 地址要以 http(s):// 开头：${u}`);
        const res2 = await fetch(u, {
          method: method || 'GET',
          headers: { 'content-type': 'application/json', ...(headers || {}) },
          body: payload == null || method === 'GET' ? undefined : JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
        const text = await res2.text();
        let data = text;
        try { data = JSON.parse(text); } catch (e) { /* 保留文本 */ }
        return { status: res2.status, ok: res2.ok, body: data };
      },
      publish: async (channel, payload) => {
        if (!redis) throw new Error('Redis 不可用');
        await redis.publish(String(channel), typeof payload === 'string' ? payload : JSON.stringify(payload));
        return true;
      },
      token: tokenStore,
    });
  } catch (e) {
    if (startedTx) {
      await txRollbackAll('脚本异常');
      logPush({ level: 'FATAL', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 500, ms: Date.now() - started, ip, traceId, message: '事务已回滚（脚本异常）', data: { error: e.message, stack: String(e.stack || '').split('\n').slice(0, 4) } });
    }
    breakerRecord(rkey, guard.breaker, true);
    throw e;
  }

  // 收尾：所有连接一起提交；提交阶段失败无法真正回滚，必须留 FATAL 并返回 500。
  let commitFailure = null;
  if (startedTx && txStates.size) {
    const r = await txCommitAll();
    if (r.committed.length) logPush({ level: 'DEBUG', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: result.status || 200, ms: Date.now() - started, ip, traceId, message: `事务提交（${r.committed.join(',')}）` });
    if (r.failure) {
      commitFailure = r.failure;
      logPush({ level: 'FATAL', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 500, ms: Date.now() - started, ip, traceId, message: '跨库提交失败：已提交的无法回退，需按日志补偿', data: { committed: r.committed, failed: r.failure } });
      await txRollbackAll('提交失败补偿');
    }
  }
  if (commitFailure) {
    return send(res, 500, { ok: false, error: 'CROSS_TX_COMMIT_FAILED', message: '提交阶段失败，部分连接已提交，已记录 FATAL 日志', traceId });
  }

  logs.push(...(result.logs || []));
  const status = result.status || 200;
  if (status < 400 && route.cache && route.cache.enabled && ckey && redis) {
    try { await redis.setex(ckey, route.cache.ttl || 60, JSON.stringify(result.body)); } catch (e) { /* 忽略 */ }
  }
  if (route.method !== 'GET' && status < 400) await invalidate(iface);
  breakerRecord(rkey, guard.breaker, status >= 500);

  const ms = Date.now() - started;
  logPush({ level: status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status, ms, ip, traceId, message: `${status} ${route.name}`, data: logs.length ? logs : null });

  return send(res, status, {
    ok: status < 400,
    data: result.body,
    cached: false,
    ms,
    traceId,
    ...(uploaded ? { file: uploaded } : {}),
    ...(logs.length ? { logs } : {}),
  });
}

// ---------------- 文档 ----------------
function openapi() {
  const paths = {};
  for (const iface of IFACES) {
    for (const route of iface.routes || []) {
      const full = (CFG.apiPrefix + (iface.basePath || '') + route.path).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const op = {
        tags: [iface.name],
        summary: route.summary || route.name,
        description: (iface.docs && iface.docs.description) || iface.comment || '',
        operationId: `${iface.id}_${route.key}_${route.method}_${route.path}`.replace(/[^A-Za-z0-9_]/g, '_'),
        responses: { 200: { description: 'OK' }, 400: { description: '参数/业务错误' }, 401: { description: '未授权' }, 429: { description: '限流' }, 503: { description: '熔断/时间窗' } },
        ...(route.auth ? { security: [{ bearer: [] }] } : {}),
        'x-clickbuild': { kind: route.key, tx: !!(route.guard && route.guard.tx), cache: route.cache },
      };
      const params = [];
      const varKeys = Date.now();
      const segs = route.path.split('/').filter((s) => s.startsWith(':'));
      segs.forEach((s) => params.push({ name: s.slice(1), in: 'path', required: true, schema: { type: 'string' } }));
      if (route.key === 'list' || route.key === 'custom') {
        ['page', 'size', 'keyword', 'sort'].forEach((q) => params.push({ name: q, in: 'query', required: false, schema: { type: 'string' } }));
      }
      if (params.length) op.parameters = params;
      if (route.method !== 'GET') {
        const fields = (iface.tables[0].fields || []).filter((f) => f.writable !== false && !f.pk);
        const props = {};
        fields.forEach((f) => { props[f.name] = { type: f.type === 'json' ? 'object' : /int|decimal|float|double|bool/i.test(f.type) ? 'number' : 'string', description: f.comment || '' }; });
        op.requestBody = { content: { 'application/json': { schema: { type: 'object', properties: props } } } };
      }
      paths[full] = { ...(paths[full] || {}), [route.method.toLowerCase()]: op };
    }
  }
  return {
    openapi: '3.0.3',
    info: { title: (DOCS_CFG.title || project.name), version: DOCS_CFG.version || '1.0.0', description: DOCS_CFG.description || project.description || '' },
    servers: [{ url: `http://127.0.0.1:${CFG.httpPort}` }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    tags: (project.categories || []).map((c) => ({ name: c.name, description: c.id })),
    paths,
    'x-clickbuild': { generatedAt: new Date().toISOString(), log: LOG_CFG, token: { ttl: TOKEN_TTL }, services: project.services || [] },
  };
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function docsHtml() {
  const spec = openapi();
  const rows = [];
  for (const iface of IFACES) {
    for (const route of iface.routes || []) {
      rows.push(`<tr><td>${esc(route.method)}</td><td><code>${esc(CFG.apiPrefix + (iface.basePath || '') + route.path)}</code></td><td>${esc(route.name)}</td><td>${esc(route.summary || '')}</td><td>${route.auth ? 'token' : '—'}</td><td>${route.guard && route.guard.tx ? '事务' : ''}${route.cache && route.cache.enabled ? ' 缓存' : ''}</td></tr>`);
    }
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(spec.info.title)}</title>
<style>body{font:14px/1.6 -apple-system,Segoe UI,sans-serif;margin:32px;color:#111}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f5f5f5}code{font-family:ui-monospace,monospace}a{color:#111}</style>
<h1>${esc(spec.info.title)} <small>v${esc(spec.info.version)}</small></h1><p>${esc(spec.info.description || '')}</p>
<p><a href="/help">帮助 / 语法</a> · <a href="/_docs">OpenAPI JSON</a> · <a href="/_meta">元信息</a> · <a href="/_routes">路由</a> · <a href="/_health">健康</a></p>
<table><thead><tr><th>方法</th><th>路径</th><th>名称</th><th>说明</th><th>鉴权</th><th>特性</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function helpHtml() {
  const routeRows = [];
  for (const iface of IFACES) {
    for (const route of iface.routes || []) {
      const full = CFG.apiPrefix + (iface.basePath || '') + route.path;
      routeRows.push(`<tr><td>${esc(route.method)}</td><td><code>${esc(full)}</code></td><td>${esc(iface.name)} / ${esc(route.name)}</td><td>${esc(route.summary || '')}</td></tr>`);
    }
  }
  const firstGet = TABLE.find((t) => t.route.method === 'GET');
  const exampleUrl = firstGet ? `http://127.0.0.1:${CFG.httpPort}${CFG.apiPrefix}${(firstGet.iface.basePath || '')}${firstGet.route.path}` : `http://127.0.0.1:${CFG.httpPort}${CFG.apiPrefix}`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(project.name)} · 帮助</title>
<style>
body{font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:0;color:#111;background:#fff}
header{padding:16px 24px;border-bottom:1px solid #111;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
header h1{font-size:18px;margin:0}
header a{color:#111;font-size:12px}
main{max-width:1080px;margin:24px auto;padding:0 20px}
h2{font-size:14px;margin:28px 0 10px;padding-bottom:5px;border-bottom:1px solid #111}
table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f5f5f5;font-weight:600}
code,pre{font-family:Consolas,ui-monospace,monospace}
code{font-size:12px}
pre{border:1px solid #111;background:#fafafa;padding:10px;overflow:auto;white-space:pre-wrap}
.note{color:#555;font-size:12px}
.badge{display:inline-block;border:1px solid #111;padding:1px 6px;margin-right:6px;font-size:11px}
</style>
<header><h1>${esc(project.name)} · 帮助</h1><a href="/">控制台 / 前端</a><a href="/docs">接口文档</a><a href="/_docs">OpenAPI</a><a href="/_routes">全部路由</a><a href="/_health">健康检查</a></header>
<main>
<p class="note">${esc(project.description || '')}</p>
<p><span class="badge">API 前缀 ${esc(CFG.apiPrefix)}</span><span class="badge">端口 ${CFG.httpPort}</span><span class="badge">数据库 ${esc(CFG.database)}</span><span class="badge">Redis ${esc(CFG.redisHost)}:${CFG.redisPort}</span><span class="badge">S3 ${esc(CFG.s3End)}:${CFG.s3Port}</span></p>

<h2>1. 快速访问</h2>
<table><thead><tr><th>地址</th><th>用途</th></tr></thead><tbody>
<tr><td><code>/</code></td><td>控制台或前端页面</td></tr>
<tr><td><code>/docs</code></td><td>本服务的接口文档</td></tr>
<tr><td><code>/help</code></td><td>当前这页：语法、占位符、函数、示例</td></tr>
<tr><td><code>/_docs</code> 或 <code>/openapi.json</code></td><td>OpenAPI JSON，可导入 Postman / Apifox</td></tr>
<tr><td><code>/_routes</code></td><td>全部路由的机器可读列表</td></tr>
<tr><td><code>/_health</code></td><td>MySQL / Redis / S3 健康检查</td></tr>
<tr><td><code>/_logs</code> / <code>/_logs/stream</code></td><td>日志快照 / SSE 实时日志</td></tr>
</tbody></table>

<h2>2. 接口路由</h2>
<table><thead><tr><th>方法</th><th>完整路径</th><th>接口</th><th>说明</th></tr></thead><tbody>${routeRows.join('')}</tbody></table>

<h2>3. 请求约定</h2>
<table><thead><tr><th>位置</th><th>写法</th><th>说明</th></tr></thead><tbody>
<tr><td>路径参数</td><td><code>/xxx/:id</code></td><td>脚本里用 <code>{{id}}</code> 或 <code>{{path.id}}</code></td></tr>
<tr><td>查询参数</td><td><code>?page=1&amp;pageSize=20&amp;keyword=abc</code></td><td>脚本里用 <code>{{query.x}}</code>；<code>{{where:main}}</code> 会自动拼条件</td></tr>
<tr><td>请求体</td><td><code>application/json</code></td><td>脚本里用 <code>{{body.x}}</code></td></tr>
<tr><td>登录态</td><td><code>Authorization: Bearer &lt;token&gt;</code> 或 Cookie</td><td>脚本里用 <code>{{user.x}}</code>，需路由开启 auth</td></tr>
<tr><td>文件上传</td><td><code>multipart/form-data</code>，字段名任意</td><td>上传后可用 <code>{{objectKey}}</code> / <code>{{objectUrl}}</code></td></tr>
</tbody></table>
<p class="note">成功响应统一为 <code>{"ok":true,"data":...,"traceId":"..."}</code>；失败为 <code>{"ok":false,"error":"...","message":"..."}</code>。</p>

<h2>4. SQL 占位符</h2>
<table><thead><tr><th>占位符</th><th>展开</th></tr></thead><tbody>
<tr><td><code>{{t:key}}</code> / <code>{{table:key}}</code></td><td>表名，key 是表键（首张表固定 main）</td></tr>
<tr><td><code>{{columns:key}}</code></td><td>查询列，自动跳过 hidden 字段</td></tr>
<tr><td><code>{{insertColumns:key}}</code> / <code>{{insertValues:key}}</code></td><td>INSERT 的列和参数化值</td></tr>
<tr><td><code>{{updateSet:key}}</code></td><td>UPDATE SET，只改请求体里出现的字段</td></tr>
<tr><td><code>{{where:key}}</code></td><td>条件：<code>field__gte</code>、<code>__lte</code>、<code>__like</code>、<code>__in</code>、<code>__between</code>、<code>keyword</code></td></tr>
<tr><td><code>{{orderBy:key}}</code> / <code>{{limit}}</code> / <code>{{offset}}</code></td><td>排序与分页，字段有白名单</td></tr>
<tr><td><code>{{body.x}}</code> / <code>{{query.x}}</code> / <code>{{path.x}}</code> / <code>{{user.x}}</code></td><td>请求体、查询、路径、登录态</td></tr>
<tr><td><code>{{onlyId}}</code> / <code>{{token}}</code> / <code>{{uuid}}</code> / <code>{{now}}</code> / <code>{{traceId}}</code></td><td>平台生成值</td></tr>
<tr><td><code>{{objectKey}}</code> / <code>{{objectUrl}}</code> / <code>{{filename}}</code> / <code>{{size}}</code></td><td>对象存储上传结果</td></tr>
</tbody></table>

<h2>5. 脚本语句</h2>
<table><thead><tr><th>写法</th><th>作用</th></tr></thead><tbody>
<tr><td><code>LET $x = QUERY SELECT ...;</code></td><td>查询，结果在 <code>$x.rows</code></td></tr>
<tr><td><code>LET $x = EXEC INSERT/UPDATE/DELETE ...;</code></td><td>写操作，结果在 <code>$x.insertId</code> / <code>$x.affectedRows</code></td></tr>
<tr><td><code>LET $x = HASH('sha256', {{body.name}});</code></td><td>表达式赋值，可调用内置函数</td></tr>
<tr><td><code>IF 条件 ... ELSEIF ... ELSE ... END</code></td><td>分支</td></tr>
<tr><td><code>FOREACH $row IN $rows.rows ... END</code></td><td>循环，最多 500 条</td></tr>
<tr><td><code>RETURN 200 { "x": $x };</code></td><td>返回 JSON，第二段是表达式</td></tr>
<tr><td><code>LOG 表达式;</code></td><td>写一条请求日志</td></tr>
<tr><td><code>TX BEGIN|COMMIT|ROLLBACK;</code></td><td>手动事务；写路由默认自动事务</td></tr>
<tr><td><code>HTTP GET|POST 'url' { ... }</code></td><td>调用其它服务</td></tr>
<tr><td><code>PUBLISH 'channel' 表达式;</code></td><td>向 Redis 发布消息</td></tr>
<tr><td><code>TOKEN NEW|GET|DEL ...</code></td><td>签发 / 读取 / 删除 token 会话</td></tr>
</tbody></table>

<h2>6. 内置函数</h2>
<table><thead><tr><th>分类</th><th>函数</th></tr></thead><tbody>
<tr><td>哈希 / 加密</td><td><code>HASH(algo,v)</code> <code>MD5(v)</code> <code>SHA1(v)</code> <code>SHA256(v)</code> <code>SM3(v)</code> <code>SM4_ENC(v,key)</code> <code>SM4_DEC(v,key)</code></td></tr>
<tr><td>字符串</td><td><code>SUBSTR</code> <code>LEFT</code> <code>RIGHT</code> <code>LEN</code> <code>UPPER</code> <code>LOWER</code> <code>TRIM</code> <code>CONCAT</code> <code>REPLACE</code> <code>SPLIT</code> <code>JOIN</code> <code>MASK</code> <code>URL_ENC</code> <code>URL_DEC</code></td></tr>
<tr><td>数字</td><td><code>INT</code> <code>FLOAT</code> <code>ROUND</code> <code>ABS</code> <code>RAND_INT</code></td></tr>
<tr><td>时间 / ID</td><td><code>NOW()</code> <code>TODAY()</code> <code>UUID()</code></td></tr>
<tr><td>JSON</td><td><code>JSON_GET(obj,'a.b')</code> <code>JSON_STR(v)</code></td></tr>
<tr><td>逻辑</td><td><code>IF(cond,a,b)</code> <code>IN(v,arr)</code> <code>CONTAINS</code> <code>START_WITH</code> <code>END_WITH</code> <code>COALESCE</code></td></tr>
</tbody></table>

<h2>7. 直接试一下</h2>
<pre># 列表
curl "${esc(exampleUrl)}"

# 新建（按你的表字段替换 JSON）
curl -X POST "${esc(exampleUrl)}" -H "Content-Type: application/json" -d '{"name":"test"}'

# 健康检查
curl "http://127.0.0.1:${CFG.httpPort}/_health"</pre>
<p class="note">注意：所有接口默认前缀是 <code>${esc(CFG.apiPrefix)}</code>；如果路径带 <code>:id</code>，请求时换成真实 ID。数据库 / Redis / S3 地址在生成目录的 <code>.env</code> 里改，重启服务生效。</p>
</main></html>`;
}

// ---------------- 启动 ----------------
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://local');
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/_health') {
      let mysqlOk = false, redisOk = false, s3Ok = false;
      try { const c = await (await poolFor('main')).pool.getConnection(); await c.query('SELECT 1'); c.release(); mysqlOk = true; } catch (e) {}
      try { redisOk = (await redis.ping()) === 'PONG'; } catch (e) {}
      try { s3Ok = await s3.bucketExists((IFACES[0] && IFACES[0].storage && IFACES[0].storage.bucket) || 'clickbuild'); } catch (e) {}
      return send(res, 200, { ok: true, mysql: mysqlOk, redis: redisOk, s3: s3Ok, port: CFG.httpPort, log: LOG_CFG.enabled ? 'db' : 'console' });
    }
    if (pathname === '/_meta') {
      return send(res, 200, {
        ok: true, name: project.name, database: CFG.database, prefix: CFG.apiPrefix,
        categories: project.categories,
        connections: CONNS,
        log: LOG_CFG, token: { ttl: TOKEN_TTL, header: TOKEN_CFG.header, cookie: TOKEN_CFG.cookie },
        interfaces: IFACES.map((i) => ({
          id: i.id, name: i.name, comment: i.comment, categoryId: i.categoryId, docs: i.docs,
          tables: i.tables.map((t) => ({ key: t.key, name: t.name, schema: t.schema, conn: t.conn, fields: t.fields })),
          routes: (i.routes || []).map((r) => ({ name: r.name, method: r.method, path: r.path, kind: r.key, cache: r.cache, guard: r.guard, auth: r.auth, summary: r.summary })),
        })),
        functions: project.functions,
      });
    }
    if (pathname === '/_routes') {
      return send(res, 200, {
        ok: true,
        routes: TABLE.map((t) => ({ interface: t.iface.name, name: t.route.name, method: t.route.method, path: CFG.apiPrefix + (t.iface.basePath || '') + t.route.path, kind: t.route.key, auth: t.route.auth, guard: t.route.guard })),
      });
    }
    if (pathname === '/_docs' || pathname === '/openapi.json') return send(res, 200, openapi());
    if (pathname === '/docs') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(docsHtml()); }
    if (pathname === '/help' || pathname === '/help/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(helpHtml()); }
    if (pathname === '/_logs') {
      const tail = Math.min(Number(url.searchParams.get('tail') || 50), 500);
      return send(res, 200, { ok: true, logs: RING.slice(-tail) });
    }
    if (pathname === '/_logs/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ level: 'INFO', ts: stamp(), message: '日志流已连接' })}\n\n`);
      SSE.add(res);
      req.on('close', () => SSE.delete(res));
      return;
    }
    if (pathname === '/' || pathname === '/console') {
      const front = path.join(ROOT, 'public', 'index.html');
      if (pathname === '/' && fs.existsSync(front)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(front));
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(ROOT, 'public', 'console.html')));
    }
    if (pathname === '/frontend/index.yxpp' || pathname === '/frontend/project.json') {
      const file = path.join(ROOT, 'frontend', path.basename(pathname));
      if (fs.existsSync(file)) return send(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    if (pathname.startsWith('/sql/')) {
      const f = path.join(ROOT, 'sql', path.basename(pathname));
      if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(fs.readFileSync(f)); }
      return send(res, 404, { ok: false, error: 'NO_SQL' });
    }

    const item = matchRoute(req.method, pathname);
    if (!item) {
      return send(res, 404, {
        ok: false, error: 'NO_ROUTE', message: `${req.method} ${pathname} 没有匹配到接口路由`,
        hint: '打开 /_routes 看全部路由，/docs 看文档',
      });
    }
    return await handle(req, res, item);
  } catch (e) {
    console.error('[error]', req.method, req.url, e);
    logPush({ level: 'ERROR', ts: stamp(), method: req.method, pathname, status: 500, ms: 0, message: e.message });
    return send(res, 500, { ok: false, error: 'INTERNAL', message: e.message, stack: String(e.stack || '').split('\n').slice(0, 4) });
  }
});

async function initMysql() {
  const main = mysqlConn('main');
  const admin = await mysql.createConnection({ host: main.host, port: Number(main.port), user: main.user, password: main.password, multipleStatements: true });
  const mainDb = dbOf(main);
  const dbs = new Set([mainDb]);
  for (const c of CONNS.mysql || []) dbs.add(dbOf(c));
  for (const i of IFACES) for (const t of i.tables) if (t.schema) dbs.add(t.schema);
  if (CFG.resetDb) {
    for (const db of dbs) await admin.query(`DROP DATABASE IF EXISTS \`${db}\``);
    console.log('RESET_DB=1，已清空项目数据库：', [...dbs].join(', '));
  }
  for (const db of dbs) await admin.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` DEFAULT CHARACTER SET utf8mb4`);
  await admin.end();

  for (const c of CONNS.mysql || []) await poolFor(c.key);

  for (const f of fs.readdirSync(path.join(ROOT, 'sql')).filter((x) => x.endsWith('.sql')).sort()) {
    const text = fs.readFileSync(path.join(ROOT, 'sql', f), 'utf8');
    if (!text.trim()) continue;
    const conn = await mysql.createConnection({ host: main.host, port: Number(main.port), user: main.user, password: main.password, database: mainDb, multipleStatements: true });
    try { await conn.query(text); } catch (e) { console.error('建表失败', f, e.message); } finally { await conn.end(); }
  }

  // 日志表：单独的库/连接也能落
  if (LOG_CFG.enabled) {
    const lc = mysqlConn(LOG_CFG.conn || 'main');
    const db = LOG_CFG.database || dbOf(lc);
    const admin2 = await mysql.createConnection({ host: lc.host, port: Number(lc.port), user: lc.user, password: lc.password, multipleStatements: true });
    await admin2.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` DEFAULT CHARACTER SET utf8mb4`);
    await admin2.query(`CREATE TABLE IF NOT EXISTS \`${db}\`.\`${LOG_CFG.table || 'sys_log'}\` (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      level VARCHAR(8) NOT NULL,
      iface VARCHAR(64) NULL, route VARCHAR(64) NULL, method VARCHAR(8) NULL, pathname VARCHAR(255) NULL,
      status INT NULL, ms INT NULL, ip VARCHAR(64) NULL, trace_id VARCHAR(64) NULL,
      message VARCHAR(512) NULL, meta TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_level (level), KEY idx_time (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await admin2.end();
    logPool = mysql.createPool({ host: lc.host, port: Number(lc.port), user: lc.user, password: lc.password, database: db, connectionLimit: 4 });
  }
}

async function clearCacheNS() {
  if (!redis) return 0;
  let cursor = '0';
  let total = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${CACHE_NS}:*`, 'COUNT', 200);
    cursor = next;
    if (keys.length) { await redis.del(keys); total += keys.length; }
  } while (cursor !== '0');
  return total;
}

async function bootstrap() {
  await initMysql();
  if (CFG.resetDb) {
    try {
      const n = await clearCacheNS();
      if (n) console.log(`RESET_DB=1，已清空本工程缓存键 ${n} 个（${CACHE_NS}:*）`);
    } catch (e) { console.error('清缓存失败', e.message); }
  }

  try {
    const rc = (CONNS.redis || [])[0] || {};
    redis = new Redis({ host: rc.host || CFG.redisHost, port: Number(rc.port || CFG.redisPort), db: Number(rc.db || CFG.redisDb), lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false });
    redis.on('error', (e) => console.error('[redis]', e.message));
  } catch (e) { console.error('Redis 连接失败，缓存/会话不可用', e.message); redis = null; }

  try {
    const sc = (CONNS.s3 || [])[0] || {};
    s3 = new Minio.Client({ endPoint: sc.endpoint || CFG.s3End, port: Number(sc.port || CFG.s3Port), useSSL: CFG.s3Ssl, accessKey: sc.accessKey || CFG.s3Key, secretKey: sc.secretKey || CFG.s3Secret });
    const buckets = new Set(IFACES.map((i) => (i.storage && i.storage.bucket) || 'clickbuild'));
    for (const b of buckets) {
      const exists = await s3.bucketExists(b).catch(() => false);
      if (!exists) await s3.makeBucket(b).catch((e) => console.error('建桶失败', b, e.message));
    }
    bucketReady = true;
  } catch (e) { console.error('对象存储不可用', e.message); s3 = null; }

  server.listen(CFG.httpPort, () => {
    logPush({ level: 'INFO', ts: stamp(), message: `ClickBuild 接口服务已启动 → http://127.0.0.1:${CFG.httpPort}` });
    console.log(`控制台 http://127.0.0.1:${CFG.httpPort}/  文档 /docs  健康 /_health  日志流 /_logs/stream`);
  });
}

bootstrap().catch((e) => { console.error('启动失败', e); process.exit(1); });

process.on('SIGTERM', () => { try { server.close(); pools.forEach((p) => p.pool.end()); logPool && logPool.end(); redis && redis.disconnect(); } catch (e) {} process.exit(0); });
