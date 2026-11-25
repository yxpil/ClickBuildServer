// 作者：yxpil
// 多类型基础设施连接：MariaDB / Redis / S3 兼容对象存储，全部允许自定义外部地址。
'use strict';

const Redis = require('ioredis');
const Minio = require('minio');
const spec = require('./spec');
const sshTunnel = require('./ssh-tunnel');

const KINDS = ['mysql', 'redis', 's3'];
const MAX_KEYS = 500;
const DANGEROUS = new Set(['FLUSHALL', 'FLUSHDB', 'SHUTDOWN', 'DEBUG', 'CONFIG', 'SCRIPT', 'MODULE', 'SLAVEOF', 'REPLICAOF', 'MONITOR', 'SYNC', 'PSYNC']);

function kindOf(v) {
  return KINDS.includes(v) ? v : 'mysql';
}

function rawConnections(project, kind) {
  const p = spec.normalizeProject(project || {});
  const k = kindOf(kind);
  return (p.connections && p.connections[k]) || [];
}

function connectionsOf(project, kind) {
  const k = kindOf(kind);
  return rawConnections(project, k).map((c) => {
    const base = {
      key: c.key || 'main',
      label: c.label || c.key || (k === 'redis' ? 'Redis' : k === 's3' ? 'S3' : 'MariaDB'),
      readonly: !!c.readonly,
    };
    if (k === 'mysql') return { ...base, kind: k, host: c.host || '127.0.0.1', port: Number(c.port || 3306), user: c.user || 'root', database: c.database || 'clickbuild', ssh: sshTunnel.sshSummary(c) };
    if (k === 'redis') return { ...base, kind: k, host: c.host || '127.0.0.1', port: Number(c.port || 6379), db: Number(c.db || 0), tls: !!c.tls, hasPassword: !!c.password, ssh: sshTunnel.sshSummary(c) };
    return { ...base, kind: k, endpoint: c.endpoint || '127.0.0.1', port: Number(c.port || 9000), useSSL: c.useSSL === true, region: c.region || '', bucket: c.bucket || 'clickbuild' };
  });
}

function allConnections(project) {
  const out = {};
  for (const k of KINDS) out[k] = connectionsOf(project, k);
  return out;
}

function resolveConn(project, kind, connKey) {
  const k = kindOf(kind);
  const list = rawConnections(project, k);
  const hit = list.find((c) => c.key === connKey) || list[0];
  if (!hit) throw new Error(`工程没有配置 ${k === 'mysql' ? 'MariaDB' : k === 'redis' ? 'Redis' : '对象存储'} 连接`);
  return { kind: k, conn: { ...hit, key: hit.key || 'main' } };
}

function friendly(kind, conn, e) {
  const at = kind === 'mysql'
    ? `${conn.host || '127.0.0.1'}:${conn.port || 3306}`
    : kind === 'redis'
      ? `${conn.host || '127.0.0.1'}:${conn.port || 6379}/${conn.db || 0}`
      : `${conn.endpoint || '127.0.0.1'}:${conn.port || 9000}`;
  const code = (e && e.code) || '';
  const msg = (e && e.message) || '连接失败';
  let hint = msg;
  if (code === 'ECONNREFUSED') hint = `连不上 ${at}，先启动服务或检查地址和端口。`;
  else if (code === 'ETIMEDOUT') hint = `${at} 连接超时，检查网络、防火墙和安全组。`;
  else if (code === 'ENOTFOUND') hint = `解析不到主机 ${at}，检查域名或 DNS。`;
  else if (/access denied|invalid access key|signature/i.test(msg)) hint = `认证失败，检查用户名、密码或 AccessKey / SecretKey。`;
  else if (/bucket/i.test(msg) && /not exist/i.test(msg)) hint = `桶不存在，检查桶名或先新建桶。`;
  return { ok: false, code, error: msg, hint };
}

async function withRedis(project, opts, fn) {
  const o = opts || {};
  let info;
  try {
    info = resolveConn(project, 'redis', o.connKey);
  } catch (e) {
    return { ok: false, code: 'TARGET', error: e.message, hint: e.message };
  }
  const c = info.conn;
  if (c.readonly && o.write) return { ok: false, code: 'ER_READONLY', error: '这个 Redis 连接是只读的', hint: '到连接设置取消“只读”再写入' };
  const db = Number(o.db === undefined ? c.db || 0 : o.db);
  let tunnel = null;
  try {
    if (c.sshEnabled) tunnel = await sshTunnel.openTunnel(c, c.host, c.port);
    const client = new Redis({
      host: tunnel ? tunnel.host : c.host || '127.0.0.1',
      port: tunnel ? tunnel.port : Number(c.port || 6379),
      password: c.password || undefined,
      db: Number.isFinite(db) ? db : 0,
      tls: c.tls ? {} : undefined,
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
    client.on('error', () => { /* 错误在 connect / 命令返回里处理 */ });
    try {
      await client.connect();
      return await fn(client, { ...info, db });
    } finally {
      client.disconnect();
    }
  } catch (e) {
    return friendly('redis', c, e);
  } finally {
    if (tunnel) { try { tunnel.close(); } catch (_) { /* noop */ } }
  }
}

async function test(project, opts) {
  const o = opts || {};
  const kind = kindOf(o.kind);
  if (kind === 'mysql') {
    const dbAdmin = require('./db-admin');
    return dbAdmin.test(project, { connKey: o.connKey });
  }
  if (kind === 'redis') {
    return withRedis(project, { ...o, write: false }, async (r) => {
      const info = await r.info('server');
      const dbsize = await r.dbsize();
      const version = (/redis_version:([^\r\n]+)/.exec(info) || [])[1] || 'Redis';
      return { ok: true, kind, version, db: r.options.db, dbSize: dbsize };
    });
  }
  let c;
  try {
    const info = resolveConn(project, 's3', o.connKey);
    c = info.conn;
    const client = s3Client(c);
    const buckets = await client.listBuckets();
    return { ok: true, kind: 's3', version: 'S3', buckets: buckets.length, endpoint: c.endpoint, port: c.port, useSSL: c.useSSL === true };
  } catch (e) {
    return friendly('s3', c || {}, e);
  }
}

async function redisOverview(project, opts) {
  const o = opts || {};
  return withRedis(project, { ...o, write: false }, async (r) => {
    const info = await r.info();
    const dbsize = await r.dbsize();
    const sections = {};
    let section = '';
    for (const line of String(info || '').split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith('#')) { section = line.replace(/^#\s*/, ''); sections[section] = {}; continue; }
      const i = line.indexOf(':');
      if (i > 0 && sections[section]) sections[section][line.slice(0, i)] = line.slice(i + 1);
    }
    const server = sections.Server || {};
    const clients = sections.Clients || {};
    const memory = sections.Memory || {};
    return {
      ok: true,
      kind: 'redis',
      db: r.options.db,
      dbSize: dbsize,
      version: server.redis_version || '',
      mode: server.redis_mode || '',
      os: server.os || '',
      uptime: Number(server.uptime_in_seconds || 0),
      clients: Number(clients.connected_clients || 0),
      memory: Number(memory.used_memory || 0),
      maxMemory: Number(memory.maxmemory || 0),
      keyspace: sections.Keyspace || {},
    };
  });
}

async function redisScan(project, opts) {
  const o = opts || {};
  const pattern = String(o.pattern || '*').slice(0, 200);
  const cursor = String(o.cursor || '0');
  const count = Math.max(10, Math.min(200, Number(o.count || 100)));
  return withRedis(project, { ...o, write: false }, async (r) => {
    const [next, keys] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    const limited = keys.slice(0, MAX_KEYS);
    const pipeline = r.pipeline();
    for (const k of limited) { pipeline.type(k); pipeline.ttl(k); }
    const replies = await pipeline.exec();
    const rows = limited.map((key, i) => {
      const type = replies[i * 2] && replies[i * 2][1];
      const ttl = replies[i * 2 + 1] && replies[i * 2 + 1][1];
      return { key, type: String(type || 'unknown'), ttl: Number(ttl === -1 ? -1 : ttl || 0) };
    });
    return { ok: true, cursor: String(next || '0'), pattern, keys: rows, truncated: keys.length > MAX_KEYS };
  });
}

async function redisKey(project, opts) {
  const o = opts || {};
  const key = String(o.key || '');
  if (!key) return { ok: false, code: 'KEY', error: '缺少 key', hint: '先选一个键' };
  return withRedis(project, { ...o, write: false }, async (r) => {
    const type = await r.type(key);
    const ttl = await r.ttl(key);
    let memory = null;
    try { memory = await r.memory('USAGE', key); } catch (e) { memory = null; }
    let value = null;
    if (type === 'string') value = await r.get(key);
    else if (type === 'hash') value = await r.hgetall(key);
    else if (type === 'list') value = await r.lrange(key, 0, 199);
    else if (type === 'set') value = await r.smembers(key);
    else if (type === 'zset') value = await r.zrange(key, 0, 199, 'WITHSCORES');
    else if (type === 'stream') value = await r.xlen(key);
    return { ok: true, key, type, ttl, memory, value };
  });
}

function splitCommand(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const out = [];
  let buf = '';
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && s[i + 1]) { buf += s[i + 1]; i++; continue; }
      if (ch === quote) { quote = ''; continue; }
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) { if (buf) { out.push(buf); buf = ''; } continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function normalizeRedisValue(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  if (typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(normalizeRedisValue);
  if (typeof v === 'object') return v;
  return v;
}

async function redisCommand(project, opts) {
  const o = opts || {};
  const parts = Array.isArray(o.args) ? o.args.map(String) : splitCommand(o.command);
  if (!parts.length) return { ok: false, code: 'EMPTY', error: '命令为空', hint: '例如 GET key' };
  const cmd = parts[0].toUpperCase();
  if (DANGEROUS.has(cmd)) return { ok: false, code: 'BLOCKED', error: `命令 ${cmd} 会清空数据或修改服务配置`, hint: '这一类命令不在工作台开放，请用 redis-cli 或运维通道执行' };
  const write = !['GET', 'MGET', 'STRLEN', 'TYPE', 'TTL', 'PTTL', 'EXISTS', 'SCAN', 'KEYS', 'HGET', 'HGETALL', 'HMGET', 'HLEN', 'HEXISTS', 'LRANGE', 'LLEN', 'LINDEX', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'ZRANGE', 'ZSCORE', 'ZCARD', 'XLEN', 'XRANGE', 'INFO', 'DBSIZE', 'TIME', 'RANDOMKEY', 'MEMORY'].includes(cmd);
  return withRedis(project, { ...o, write }, async (r) => {
    const started = Date.now();
    const value = await r.call(cmd, ...parts.slice(1));
    return { ok: true, command: parts.join(' '), value: normalizeRedisValue(value), elapsed: Date.now() - started, write };
  });
}

async function redisDelete(project, opts) {
  const o = opts || {};
  const keys = Array.isArray(o.keys) ? o.keys.map(String) : [String(o.key || '')].filter(Boolean);
  if (!keys.length) return { ok: false, code: 'KEY', error: '缺少 key', hint: '先选一个键' };
  return withRedis(project, { ...o, write: true }, async (r) => {
    const n = await r.del(...keys);
    return { ok: true, deleted: Number(n || 0), keys };
  });
}

function redisText(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

async function redisSaveKey(project, opts) {
  const o = opts || {};
  const key = String(o.key || '').trim();
  if (!key) return { ok: false, code: 'KEY', error: '缺少 key', hint: '先填键名' };
  if (key.length > 512) return { ok: false, code: 'KEY', error: '键名太长', hint: 'Redis 键名最多 512 字节' };
  const type = ['string', 'hash', 'list', 'set', 'zset'].includes(String(o.type || '')) ? String(o.type) : 'string';
  const ttl = Number(o.ttl === undefined ? -1 : o.ttl);
  const value = o.value;
  return withRedis(project, { ...o, write: true }, async (r) => {
    const existingType = await r.type(key);
    const replace = o.replace !== false;
    if (existingType !== 'none' && replace) await r.del(key);
    let written = 0;
    if (type === 'string') {
      const text = redisText(value);
      await r.set(key, text);
      written = 1;
    } else if (type === 'hash') {
      const rows = Array.isArray(value)
        ? value.map((x) => ({ field: redisText(x && x.field), value: redisText(x && x.value) })).filter((x) => x.field)
        : Object.entries(value || {}).map(([field, v]) => ({ field, value: redisText(v) }));
      if (!rows.length) return { ok: false, code: 'VALUE', error: 'Hash 至少需要一个字段', hint: '填字段名和值' };
      const args = [];
      for (const row of rows) args.push(row.field, row.value);
      await r.hset(key, ...args);
      written = rows.length;
    } else if (type === 'list') {
      const rows = (Array.isArray(value) ? value : String(value || '').split('\n')).map(redisText).filter((x) => x !== '');
      if (!rows.length) return { ok: false, code: 'VALUE', error: 'List 至少需要一个元素', hint: '每行一个元素' };
      await r.rpush(key, ...rows);
      written = rows.length;
    } else if (type === 'set') {
      const rows = (Array.isArray(value) ? value : String(value || '').split('\n')).map(redisText).filter((x) => x !== '');
      if (!rows.length) return { ok: false, code: 'VALUE', error: 'Set 至少需要一个成员', hint: '每行一个成员' };
      await r.sadd(key, ...rows);
      written = rows.length;
    } else {
      const rows = Array.isArray(value) ? value : [];
      const args = [];
      for (const row of rows) {
        const member = redisText(row && row.member);
        if (!member) continue;
        const score = Number(row && row.score);
        if (!Number.isFinite(score)) continue;
        args.push(score, member);
      }
      if (!args.length) return { ok: false, code: 'VALUE', error: 'ZSet 至少需要一个成员和分数', hint: '成员不能为空，分数必须是数字' };
      await r.zadd(key, ...args);
      written = args.length / 2;
    }
    if (Number.isFinite(ttl) && ttl > 0) await r.expire(key, Math.round(ttl));
    else if (ttl === -1 || ttl === 0) await r.persist(key).catch(() => 0);
    const afterType = await r.type(key);
    const afterTtl = await r.ttl(key);
    return { ok: true, key, type: afterType, ttl: afterTtl, written, replaced: existingType !== 'none' && replace };
  });
}

async function redisExpire(project, opts) {
  const o = opts || {};
  const key = String(o.key || '');
  if (!key) return { ok: false, code: 'KEY', error: '缺少 key' };
  const ttl = Number(o.ttl);
  if (!Number.isFinite(ttl) || ttl < -1) return { ok: false, code: 'TTL', error: 'TTL 必须是 -1 或非负秒数' };
  return withRedis(project, { ...o, write: true }, async (r) => {
    const exists = await r.exists(key);
    if (!exists) return { ok: false, code: 'NOT_FOUND', error: '键不存在', hint: '可能已经被删除' };
    if (ttl === -1) await r.persist(key); else await r.expire(key, Math.round(ttl));
    return { ok: true, key, ttl: await r.ttl(key) };
  });
}

async function redisRename(project, opts) {
  const o = opts || {};
  const key = String(o.key || '');
  const next = String(o.next || '').trim();
  if (!key || !next) return { ok: false, code: 'KEY', error: '缺少原键名或新键名' };
  if (key === next) return { ok: false, code: 'KEY', error: '新键名和原键名相同' };
  return withRedis(project, { ...o, write: true }, async (r) => {
    const exists = await r.exists(next);
    if (exists && o.overwrite !== true) return { ok: false, code: 'EXISTS', error: `键 ${next} 已存在`, hint: '换一个名字，或勾选覆盖' };
    await (o.overwrite === true ? r.rename(key, next) : r.renamenx(key, next));
    return { ok: true, key, next };
  });
}

function s3Client(c) {
 const useSSL = c.useSSL === true || c.useSSL === 'true' || Number(c.port) === 443;
  return new Minio.Client({
    endPoint: c.endpoint || '127.0.0.1',
    port: Number(c.port || (useSSL ? 443 : 9000)),
    useSSL,
    accessKey: c.accessKey || '',
    secretKey: c.secretKey || '',
    region: c.region || undefined,
  });
}

async function withS3(project, opts, fn) {
  const o = opts || {};
  let info;
  try { info = resolveConn(project, 's3', o.connKey); } catch (e) { return { ok: false, code: 'TARGET', error: e.message, hint: e.message }; }
  const c = info.conn;
  if (c.readonly && o.write) return { ok: false, code: 'ER_READONLY', error: '这个对象存储连接是只读的', hint: '到连接设置取消“只读”再写入' };
  try {
    return await fn(s3Client(c), { ...info, bucket: o.bucket || c.bucket || 'clickbuild' });
  } catch (e) {
    return friendly('s3', c, e);
  }
}

async function s3Buckets(project, opts) {
  return withS3(project, { ...(opts || {}), write: false }, async (client, ctx) => {
    const list = await client.listBuckets();
    return { ok: true, buckets: (list || []).map((b) => ({ name: b.name, creationDate: b.creationDate || null })) };
  });
}

function s3List(client, bucket, prefix, limit) {
  const rows = [];
  return new Promise((resolve, reject) => {
    const stream = client.listObjectsV2(bucket, prefix || '', true);
    let done = false;
    stream.on('data', (o) => {
      if (rows.length >= limit) { if (!done) { done = true; stream.destroy(); } return; }
      rows.push({ key: o.name, name: String(o.name || '').split('/').pop(), size: Number(o.size || 0), etag: o.etag || '', lastModified: o.lastModified || null, storageClass: o.storageClass || '' });
    });
    stream.on('end', () => resolve(rows));
    stream.on('error', (e) => reject(e));
  });
}

async function s3Objects(project, opts) {
  const o = opts || {};
  const bucket = String(o.bucket || '');
  if (!bucket) return { ok: false, code: 'BUCKET', error: '缺少桶名', hint: '先选一个桶' };
  return withS3(project, { ...o, bucket, write: false }, async (client, ctx) => {
    const limit = Math.max(10, Math.min(500, Number(o.limit || 200)));
    const rows = await s3List(client, bucket, String(o.prefix || ''), limit);
    return { ok: true, bucket, prefix: String(o.prefix || ''), objects: rows, truncated: rows.length >= limit };
  });
}

async function s3Stat(project, opts) {
  const o = opts || {};
  if (!o.bucket || !o.key) return { ok: false, code: 'KEY', error: '缺少桶名或对象键', hint: '先选一个对象' };
  return withS3(project, { ...o, write: false }, async (client, ctx) => {
    const st = await client.statObject(o.bucket, o.key);
    return { ok: true, bucket: o.bucket, key: o.key, size: st.size, etag: st.etag, contentType: st.metaData && (st.metaData['content-type'] || st.metaData['Content-Type']), lastModified: st.lastModified, metadata: st.metaData || {} };
  });
}

async function s3Url(project, opts) {
  const o = opts || {};
  if (!o.bucket || !o.key) return { ok: false, code: 'KEY', error: '缺少桶名或对象键' };
  return withS3(project, { ...o, write: false }, async (client, ctx) => ({ ok: true, url: await client.presignedGetObject(o.bucket, o.key, Math.max(60, Math.min(86400, Number(o.expires || 3600)))) }));
}

async function s3Delete(project, opts) {
  const o = opts || {};
  if (!o.bucket || !o.key) return { ok: false, code: 'KEY', error: '缺少桶名或对象键' };
  return withS3(project, { ...o, write: true }, async (client, ctx) => {
    await client.removeObject(o.bucket, o.key);
    return { ok: true, bucket: o.bucket, key: o.key };
  });
}

async function s3CreateBucket(project, opts) {
  const o = opts || {};
  const bucket = String(o.bucket || '');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return { ok: false, code: 'BUCKET', error: '桶名不合法', hint: '3-63 位小写字母、数字、点或短横线' };
  return withS3(project, { ...o, write: true }, async (client, ctx) => {
    await client.makeBucket(bucket);
    return { ok: true, bucket };
  });
}

async function s3Put(project, opts) {
  const o = opts || {};
  const bucket = String(o.bucket || '');
  const key = String(o.key || '').replace(/^\/+/, '');
  if (!bucket || !key) return { ok: false, code: 'KEY', error: '缺少桶名或对象键' };
  const b64 = String(o.contentBase64 || '');
  if (!b64) return { ok: false, code: 'EMPTY', error: '文件是空的', hint: '空文件请用“新建目录”' };
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return { ok: false, code: 'BASE64', error: '文件内容解码失败' }; }
  if (buf.length > 25 * 1024 * 1024) return { ok: false, code: 'TOO_LARGE', error: '单个对象超过 25 MB', hint: '大文件请用 S3 客户端或分片上传' };
  return withS3(project, { ...o, write: true }, async (client, ctx) => {
    const meta = { 'Content-Type': String(o.contentType || 'application/octet-stream') };
    await client.putObject(bucket, key, buf, buf.length, meta);
    return { ok: true, bucket, key, size: buf.length, contentType: meta['Content-Type'] };
  });
}

async function s3Get(project, opts) {
  const o = opts || {};
  const bucket = String(o.bucket || '');
  const key = String(o.key || '');
  if (!bucket || !key) return { ok: false, code: 'KEY', error: '缺少桶名或对象键' };
  return withS3(project, { ...o, write: false }, async (client, ctx) => {
    const st = await client.statObject(bucket, key);
    if (Number(st.size || 0) > 20 * 1024 * 1024) {
      return { ok: false, code: 'TOO_LARGE', error: '对象超过 20 MB', hint: '先用“生成下载链接”在浏览器里下载，或使用 S3 客户端' };
    }
    const stream = await client.getObject(bucket, key);
    const chunks = [];
    await new Promise((resolve, reject) => {
      stream.on('data', (c) => chunks.push(Buffer.from(c)));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    const contentType = (st.metaData && (st.metaData['content-type'] || st.metaData['Content-Type'])) || 'application/octet-stream';
    return {
      ok: true, bucket, key, size: buf.length, contentType,
      name: key.split('/').pop() || 'download.bin',
      contentBase64: buf.toString('base64'),
    };
  });
}

async function s3CreateFolder(project, opts) {
  const o = opts || {};
  const bucket = String(o.bucket || '');
  let key = String(o.key || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!bucket || !key) return { ok: false, code: 'KEY', error: '缺少桶名或目录名' };
  if (!/^[^\u0000-\u001f]+$/.test(key)) return { ok: false, code: 'KEY', error: '目录名包含非法字符' };
  return withS3(project, { ...o, write: true }, async (client, ctx) => {
    const folderKey = `${key}/`;
    await client.putObject(bucket, folderKey, Buffer.alloc(0), 0, { 'Content-Type': 'application/x-directory' });
    return { ok: true, bucket, key: folderKey };
  });
}

async function s3DeleteBucket(project, opts) {
  const o = opts || {};
  const bucket = String(o.bucket || '');
  if (!bucket) return { ok: false, code: 'BUCKET', error: '缺少桶名' };
  return withS3(project, { ...o, write: true }, async (client, ctx) => {
    const rows = await s3List(client, bucket, '', 1);
    if (rows.length) return { ok: false, code: 'NOT_EMPTY', error: '桶里还有对象', hint: '先清空桶，再删除桶' };
    await client.removeBucket(bucket);
    return { ok: true, bucket };
  });
}

module.exports = {
  KINDS,
  kindOf,
  connectionsOf,
  allConnections,
  resolveConn,
  splitCommand,
  test,
  redisOverview,
  redisScan,
  redisKey,
  redisCommand,
  redisDelete,
  redisSaveKey,
  redisExpire,
  redisRename,
  s3Buckets,
  s3Objects,
  s3Stat,
  s3Url,
  s3Delete,
  s3CreateBucket,
  s3Put,
  s3Get,
  s3CreateFolder,
  s3DeleteBucket,
};
