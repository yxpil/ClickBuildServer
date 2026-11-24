// 作者：yxpil
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

// 配置优先级：真正的系统环境变量 > config.json > .env > 内置默认值。
// config.json 是导出工程的主配置，改完重启即可生效，不需要改 server.js。
function readDotEnv() {
  const out = {};
  try {
    const envFile = path.join(ROOT, '.env');
    if (!fs.existsSync(envFile)) return out;
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let value = m[2].trim();
      const quote = value[0];
      if (quote === '"' || quote === "'") {
        const end = value.indexOf(quote, 1);
        if (end > 0) value = value.slice(1, end);
      } else {
        value = value.split(/\s+#/)[0].trim();
      }
      out[m[1]] = value;
    }
  } catch (e) { console.error('[env] 读取 .env 失败', e.message); }
  return out;
}
function readConfig() {
  const candidates = [
    process.env.CBS_CONFIG,
    path.join(ROOT, 'config.json'),
    path.join(ROOT, '..', 'config.json'),
    path.join(ROOT, '..', '..', 'config.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (parsed && typeof parsed === 'object') {
        console.log(`[config] 已加载 ${file}`);
        return parsed;
      }
    } catch (e) {
      console.error(`[config] 读取 ${file} 失败：${e.message}`);
    }
  }
  return {};
}
const DOT_ENV = readDotEnv();
const CONFIG = readConfig();
function cfg(key, fallback) {
  if (process.env[key] !== undefined) return process.env[key];
  if (CONFIG[key] !== undefined) return CONFIG[key];
  if (DOT_ENV[key] !== undefined) return DOT_ENV[key];
  return fallback;
}

const CFG = {
  host: String(cfg('MYSQL_HOST', '127.0.0.1')),
  port: Number(cfg('MYSQL_PORT', 13306)),
  user: String(cfg('MYSQL_USER', 'root')),
  password: String(cfg('MYSQL_PASSWORD', '')),
  database: String(cfg('MYSQL_DB', 'clickbuild')),
  redisHost: String(cfg('REDIS_HOST', '127.0.0.1')),
  redisPort: Number(cfg('REDIS_PORT', 16379)),
  redisDb: Number(cfg('REDIS_DB', 0)),
  s3End: String(cfg('S3_ENDPOINT', '127.0.0.1')),
  s3Port: Number(cfg('S3_PORT', 19000)),
  s3Key: String(cfg('S3_ACCESS_KEY', 'clickbuild')),
  s3Secret: String(cfg('S3_SECRET_KEY', 'clickbuild123')),
  s3Ssl: String(cfg('S3_SSL', 'false')) === 'true',
  httpPort: Number(cfg('PORT', 18100)),
  apiPrefix: String(cfg('API_PREFIX', '/api')),
  resetDb: String(cfg('RESET_DB', '')) === '1' || String(cfg('RESET_DB', '')).toLowerCase() === 'true',
  seedDemo: String(cfg('SEED_DEMO', '1')).toLowerCase() !== '0',
  logLevel: String(cfg('LOG_LEVEL', '')).toUpperCase(),
  maxBodyBytes: Math.max(1, Number(cfg('MAX_BODY_MB', 64)) || 64) * 1024 * 1024,
};

const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'interfaces.json'), 'utf8'));
const UPSTREAMS = Array.isArray(project.upstreams) ? project.upstreams : [];
const PERMISSIONS = project.permissions || {};
const ERR_CFG = project.errors || {};
const ERR_PAGES = String(cfg('ERROR_PAGES', ERR_CFG.pages === false ? 'false' : 'true')) !== 'false';
const ERR_DETAIL = String(cfg('ERROR_DETAIL', ERR_CFG.detail === false ? 'false' : 'true')) !== 'false';
let IFACES = [];
try {
  IFACES = require(path.join(ROOT, 'src', 'modules'));
  if (!Array.isArray(IFACES)) throw new Error('src/modules 没有返回模块数组');
  console.log(`[modules] 已加载 ${IFACES.length} 个接口模块`);
} catch (e) {
  console.error('[modules] 模块加载失败，回退 interfaces.json：', e.message);
  IFACES = project.interfaces || [];
}
IFACES.forEach((m) => {
  if (!m || !m.id) throw new Error('接口模块缺少 id');
  m.routes = Array.isArray(m.routes) ? m.routes : [];
  m.tables = Array.isArray(m.tables) ? m.tables : [];
});
project.interfaces = IFACES;
const CONNS = project.connections || {};
const LOG_CFG = project.log || {};
const TOKEN_CFG = project.token || {};
const DOCS_CFG = project.docs || {};
const CACHE_NS = String(cfg('CACHE_PREFIX', `icb:cache:${project.name || 'project'}`));
const STORE_MEM = new Map();
const STORE_VER = new Map();
function storePolicy(iface, sql) {
  const tables = iface.tables || [];
  let t = tables[0] || {};
  if (sql) {
    // 按实际查询的表选择加速策略；联表时命中第一个出现的表，写操作仍整体失效。
    const hit = tables.find((x) => {
      const name = String(x.name || '');
      if (!name) return false;
      try { return new RegExp(`(^|[^A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`, 'i').test(sql); } catch (e) { return false; }
    });
    if (hit) t = hit;
  }
  const s = t.store || {};
  return { mode: s.mode || 'mysql', ttl: Number(s.ttl || 0) || 60, max: Number(s.max || 10000), flushMs: Number(s.flushMs || 5000) };
}
function storeVersion(iface) { return STORE_VER.get(iface.id || iface.name) || 0; }
function storeBump(iface) {
  const k = iface.id || iface.name;
  STORE_VER.set(k, (STORE_VER.get(k) || 0) + 1);
  for (const key of STORE_MEM.keys()) if (key.startsWith(`q:${k}:`)) STORE_MEM.delete(key);
}
function storeTouch(key, val, max) {
  STORE_MEM.delete(key);
  STORE_MEM.set(key, { val, at: Date.now() });
  while (STORE_MEM.size > max) {
    const oldest = STORE_MEM.keys().next().value;
    STORE_MEM.delete(oldest);
  }
}


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
let rowstore = null;
try {
  rowstore = require(path.join(ROOT, 'src', 'rowstore')).create({ project, interfaces: IFACES, redis: () => redis });
} catch (e) { console.error('[rowstore] 纯表引擎不可用，回退 MySQL：', e.message); }

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

function sqlIdent(v) {
  return '`' + String(v == null ? '' : v).replace(/`/g, '``') + '`';
}

// 检查全部接口：路由是否注册、脚本能否解析、表与字段是否存在。
// 只做结构与语法检查，不执行任何写请求，适合控制台「检查全部」按钮。
async function checkInterfaceHealth() {
  const started = Date.now();
  const report = await Promise.all((IFACES || []).map(async (iface) => {
    const t0 = Date.now();
    const errors = [];
    const tables = Array.isArray(iface.tables) ? iface.tables : [];
    const routes = Array.isArray(iface.routes) ? iface.routes : [];
    if (!iface.id) errors.push('缺少接口 id');
    if (!iface.name) errors.push('缺少接口名称');
    if (!tables.length) errors.push('没有配置数据表');
    if (!routes.length) errors.push('没有配置路由');

    await Promise.all(tables.map(async (t) => {
      if (!t || !t.name) { errors.push('存在未命名的数据表'); return; }
      try {
        const h = await poolFor(t.conn || 'main');
        const prefix = t.schema ? `${sqlIdent(t.schema)}.` : '';
        const cols = (Array.isArray(t.fields) ? t.fields : []).map((f) => f && f.name).filter(Boolean).map(sqlIdent);
        const sql = `SELECT ${cols.length ? cols.join(',') : '1'} FROM ${prefix}${sqlIdent(t.name)} LIMIT 0`;
        await h.pool.query(sql);
      } catch (e) {
        errors.push(`表 ${t.name}：${e.message}`);
      }
    }));

    await Promise.all(routes.map(async (r) => {
      if (!r || !r.method || !r.path) { errors.push('存在缺少 method/path 的路由'); return; }
      const registered = TABLE.some((x) => x.iface === iface && x.route === r);
      if (!registered) errors.push(`路由 ${r.method} ${r.path} 未注册`);
      if (r.handler) return; // 模块自定义 handler，不做脚本语法检查
      try {
        const p = scriptEngine.parseScript(r.script || '');
        if (p.errors && p.errors.length) {
          errors.push(`路由 ${r.method} ${r.path} 脚本：${p.errors.slice(0, 3).map(String).join('；')}`);
        }
      } catch (e) {
        errors.push(`路由 ${r.method} ${r.path} 脚本：${e.message}`);
      }
    }));

    return {
      id: iface.id || '', name: iface.name || '(未命名接口)',
      ok: errors.length === 0,
      tables: tables.length, routes: routes.length,
      ms: Date.now() - t0,
      errors: errors.slice(0, 8),
    };
  }));

  const total = report.length;
  const healthy = report.filter((i) => i.ok).length;
  return {
    ok: healthy === total,
    checkedAt: new Date().toISOString(),
    total, healthy,
    tables: report.reduce((n, i) => n + i.tables, 0),
    routes: report.reduce((n, i) => n + i.routes, 0),
    elapsedMs: Date.now() - started,
    note: '只检查接口注册、表/字段和脚本语法，不执行写请求',
    interfaces: report,
  };
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
const MEM_TOKENS = new Map();
const MEM_ONLY = new Map();
function memSet(token, payload, ttl) {
  const ms = Math.max(1, Number(ttl || TOKEN_TTL)) * 1000;
  MEM_TOKENS.set(token, { payload, expireAt: Date.now() + ms });
  MEM_ONLY.set(String(payload.onlyId || ''), { token, expireAt: Date.now() + ms });
}
function memGet(token) {
  const hit = MEM_TOKENS.get(token);
  if (!hit) return null;
  if (hit.expireAt <= Date.now()) { MEM_TOKENS.delete(token); return null; }
  return hit.payload;
}
function memDel(token) {
  const payload = memGet(token);
  MEM_TOKENS.delete(token);
  if (payload && payload.onlyId) MEM_ONLY.delete(String(payload.onlyId));
  return !!payload;
}
const tokenStore = {
  async mint(user, mode) {
    const store = mode === 'memory' ? 'memory' : (TOKEN_CFG.store === 'memory' ? 'memory' : 'redis');
    const onlyId = (user && user.onlyId) || crypto.randomUUID().replace(/-/g, '');
    const token = crypto.randomBytes(24).toString('hex');
    const payload = { ...user, onlyId, issuedAt: new Date().toISOString() };
    if (store === 'memory') {
      if (!redis) console.warn('[token] Redis 不可用，会话写入进程内存');
      memSet(token, payload, TOKEN_TTL);
      return { token, onlyId, ttl: TOKEN_TTL, store: 'memory' };
    }
    if (!redis) throw new Error('Redis 不可用，无法签发 token；可在“接口类型”里把 Cookie 会话存储切到内存');
    await redis.setex(`icb:token:${token}`, TOKEN_TTL, JSON.stringify(payload));
    await redis.set(`icb:only:${onlyId}`, token, 'EX', TOKEN_TTL);
    return { token, onlyId, ttl: TOKEN_TTL, store: 'redis' };
  },
  async get(token) {
    if (!token) return null;
    const mem = memGet(token);
    if (mem) return mem;
    if (!redis) return null;
    const raw = await redis.get(`icb:token:${token}`);
    return raw ? JSON.parse(raw) : null;
  },
  async del(token) {
    if (!token) return false;
    const mem = memDel(token);
    if (!redis) return mem;
    const raw = await redis.get(`icb:token:${token}`);
    if (raw) {
      try {
        const u = JSON.parse(raw);
        if (u.onlyId) await redis.del(`icb:only:${u.onlyId}`);
      } catch (e) { /* 忽略 */ }
    }
    await redis.del(`icb:token:${token}`);
    return !!raw || mem;
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

// 登录脚本签发 token 后自动写入 HttpOnly cookie；退出时清除。
// 这样浏览器只靠 cookie 就能维持登录态，API 客户端仍然可以用 Authorization。
function authCookie(ctx, route) {
  const io = (route && route.io) || {};
  const cookieRoute = io.response === 'cookie';
  if (!cookieRoute && !ctx.mintedToken && !ctx.tokenDeleted) return '';
  const name = String(io.cookieName || TOKEN_CFG.cookie || 'icb_token');
  const path = String(io.cookiePath || '/');
  const ttl = Number(io.ttl || TOKEN_TTL);
  const same = ['Lax', 'Strict', 'None'].includes(io.sameSite) ? io.sameSite : 'Lax';
  const flags = `Path=${path}; HttpOnly; SameSite=${same}${same === 'None' ? '; Secure' : ''}`;
  if (ctx.tokenDeleted) return `${name}=; ${flags}; Max-Age=0`;
  if (!ctx.mintedToken) return '';
  return `${name}=${encodeURIComponent(ctx.mintedToken)}; ${flags}; Max-Age=${ttl}`;
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

// 路径能匹配、方法不匹配时返回 405，并带上 Allow。
function allowedMethods(pathname) {
  const out = new Set();
  for (const item of TABLE) {
    if (!item.re.test(pathname)) continue;
    out.add(item.route.method);
    if (item.route.method === 'GET') out.add('HEAD');
  }
  return [...out];
}

function cleanHeaders(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) continue;
    if (/^(content-length|transfer-encoding|connection)$/i.test(key)) continue;
    const values = Array.isArray(value) ? value : [value];
    if (values.some((v) => /[\r\n]/.test(String(v)))) continue;
    out[key] = Array.isArray(value) ? values.map(String) : String(value);
  }
  return out;
}

function redirectTarget(body) {
  if (typeof body === 'string') return body.trim();
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  for (const key of ['location', 'Location', 'LOCATION', 'redirect', 'redirectUrl', 'url']) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function hasLocation(headers) {
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === 'location');
}

function send(res, status, body, extra) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-filename,x-content-type,authorization',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'cache-control': 'no-store',
    ...cleanHeaders(extra),
  };
  const redirect = status >= 300 && status < 400 && hasLocation(headers);
  const noBody = status === 204 || status === 304 || (res.req && res.req.method === 'HEAD') || redirect;
  if (noBody) delete headers['content-type'];
  res.writeHead(status, headers);
  res.end(noBody ? '' : JSON.stringify(body == null ? {} : body));
}

function upstreamOf(key) {
  return UPSTREAMS.find((u) => u.id === key || u.name === key);
}

function joinUrl(base, target) {
  const b = String(base || '').replace(/\/+$/, '');
  const t = String(target || '');
  if (!t) return b;
  return `${b}/${t.replace(/^\/+/, '')}`;
}

function proxyUrl(route, params, query, iface) {
  const p = route.proxy || {};
  const up = upstreamOf(p.upstream);
  let target = p.target || '';
  if (target) {
    // target 里显式的 :id 先替换；target 固定但路由带参数时，把未消费的参数按顺序拼到路径后
    const used = new Set();
    target = target.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (m, k) => {
      if (params && params[k] != null) { used.add(k); return encodeURIComponent(params[k]); }
      return m;
    });
    const missing = [];
    (route.path || '').replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (m, k) => {
      if (!used.has(k) && params && params[k] != null) missing.push(params[k]);
      return m;
    });
    if (missing.length && !/:\w/.test(target)) target = `${target.replace(/\/+$/, '')}/${missing.map(encodeURIComponent).join('/')}`;
  }
  if (!target && p.stripPrefix !== false) {
    let rest = route.path || '/';
    for (const [k, v] of Object.entries(params || {})) rest = rest.replace(`:${k}`, encodeURIComponent(v));
    target = rest.replace(/^\/+/, '');
  }
  const base = p.target && /^http(s)?:\/\//i.test(p.target) ? '' : (up ? up.baseUrl : '');
  if (!base && !/^http(s)?:\/\//i.test(p.target || '')) throw new Error('代理路由没有配置可用的上游 baseUrl');
  let u = /^http(s)?:\/\//i.test(target) ? target : joinUrl(base, target);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (['page', 'size', 'limit', 'offset', 'marker', 'prefix'].includes(k)) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x)); else qs.append(k, v == null ? '' : String(v));
  }
  if (qs.toString()) u += (u.includes('?') ? '&' : '?') + qs.toString();
  return { url: u, upstream: up || null };
}

async function handleProxy(req, res, item, raw, query, started) {
  const route = item.route; const iface = item.iface;
  let u;
  try { u = proxyUrl(route, item.params, query, iface); } catch (e) {
    return send(res, 502, { ok: false, error: 'UPSTREAM_MISSING', message: e.message });
  }
  const up = u.upstream || {};
  const headers = {};
  const ct = req.headers['content-type'];
  if (ct) headers['content-type'] = ct;
  if (raw.length) headers['content-length'] = String(raw.length);
  if (route.proxy && route.proxy.forwardHeaders !== false) {
    for (const h of ['accept', 'accept-language', 'user-agent', 'x-request-id', 'authorization', 'cookie']) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }
  }
  if (up.authHeader && up.authValue) headers[up.authHeader] = up.authValue;
  Object.assign(headers, up.headers || {});
  let r;
  try {
    r = await fetch(u.url, {
      method: req.method === 'HEAD' ? 'GET' : req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw,
      redirect: 'manual',
      signal: AbortSignal.timeout(Number(route.proxy.timeout || up.timeout || 15000)),
    });
  } catch (e) {
    logPush({ level: 'ERROR', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname: req.url, status: 502, ms: Date.now() - started, ip: String(req.socket.remoteAddress || ''), traceId: '', message: `上游转发失败 ${u.url}`, data: { error: e.message } });
    return send(res, 502, { ok: false, error: 'UPSTREAM_FAILED', message: e.message, upstream: u.url });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  const outHeaders = {};
  for (const h of ['content-type', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'location', 'set-cookie', 'x-request-id']) {
    const v = r.headers.get(h);
    if (v) outHeaders[h] = v;
  }
  outHeaders['access-control-allow-origin'] = '*';
  logPush({ level: r.status >= 500 ? 'ERROR' : 'INFO', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname: req.url, status: r.status, ms: Date.now() - started, ip: String(req.socket.remoteAddress || ''), traceId: r.headers.get('x-request-id') || '', message: `转发 ${req.method} ${u.url}` });
  res.writeHead(r.status, outHeaders);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function handleObjects(req, res, item, query) {
  const iface = item.iface; const cfg = iface.objects || {};
  if (!cfg.enabled) return send(res, 404, { ok: false, error: 'OBJECT_TABLE_OFF', message: '该接口未启用对象表' });
  if (!s3) return send(res, 503, { ok: false, error: 'S3_NOT_READY', message: '对象存储未连接' });
  const bucket = String(query.bucket || cfg.bucket || (iface.storage && iface.storage.bucket) || 'clickbuild');
  const prefix = String(query.prefix == null ? (cfg.prefix || '') : query.prefix);
  const pageSize = Math.max(1, Math.min(Number(query.size || query.limit || cfg.pageSize || 20), 200));
  const marker = String(query.marker || '');
  if (req.method === 'DELETE') {
    let key = String(query.key || '');
    if (!key) return send(res, 400, { ok: false, error: 'KEY_REQUIRED', message: '删除对象需要 ?key=' });
    await s3.removeObject(bucket, key);
    return send(res, 200, { ok: true, data: { bucket, key, deleted: true } });
  }
  const list = await new Promise((resolve, reject) => {
    const stream = s3.listObjectsV2(bucket, prefix, true, marker);
    const rows = [];
    stream.on('data', (o) => rows.push({ key: String(o.name || o.key || ''), size: o.size, etag: o.etag, lastModified: o.lastModified }));
    stream.on('end', () => resolve(rows));
    stream.on('error', reject);
  });
  const hasMore = list.length > pageSize;
  const rows = list.slice(0, pageSize);
  const nextMarker = hasMore ? rows[rows.length - 1].key : '';
  const out = await Promise.all(rows.map(async (o) => ({
    ...o,
    bucket, prefix,
    name: o.key.split('/').pop(),
    url: await s3.presignedGetObject(bucket, o.key, 3600).catch(() => ''),
  })));
  if (query.download) {
    const key = String(query.key || '');
    if (!key) return send(res, 400, { ok: false, error: 'KEY_REQUIRED', message: '下载对象需要 ?key=' });
    const url = await s3.presignedGetObject(bucket, key, 3600);
    res.writeHead(302, { location: url, 'cache-control': 'no-store' });
    return res.end();
  }
  return send(res, 200, { ok: true, data: out, page: { size: pageSize, count: out.length, hasMore, nextMarker, bucket, prefix } });
}

function wantsHtml(req) {  const accept = String(req.headers.accept || '').toLowerCase();
  return accept.includes('text/html') && !accept.includes('application/json');
}

function errorHtml(status, title, message, detail, traceId) {
  const color = status >= 500 ? '#b91c1c' : '#111111';
  const detailHtml = ERR_DETAIL && detail
    ? `<pre class="detail">${esc(detail)}</pre>`
    : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} · ${esc(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f4f2;color:#111;font:14px/1.65 -apple-system,Segoe UI,"Microsoft YaHei",sans-serif}
.card{width:min(720px,calc(100vw - 40px));background:#fff;border:1px solid #d4d4d4;border-left:5px solid ${color};padding:34px 38px 30px;box-shadow:0 18px 50px rgba(0,0,0,.08)}
.code{font:700 56px/1 ui-monospace,Consolas,monospace;letter-spacing:-2px;color:${color}}
h1{font-size:20px;margin:16px 0 8px;font-weight:650}.msg{color:#555;margin:0 0 18px;word-break:break-all}
.meta{display:flex;flex-wrap:wrap;gap:8px 20px;color:#777;font-size:12px;font-family:ui-monospace,Consolas,monospace}
.links{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}
a{color:#111;border:1px solid #111;padding:7px 13px;text-decoration:none;font-size:12px}a:hover{background:#111;color:#fff}
.detail{margin:18px 0 0;padding:12px;border:1px solid #e5e5e5;background:#fafafa;max-height:220px;overflow:auto;font:12px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;color:#444}
.note{margin-top:18px;color:#999;font-size:11px}
</style></head><body><main class="card">
<div class="code">${status}</div><h1>${esc(title)}</h1><p class="msg">${esc(message)}</p>
<div class="meta"><span>${esc(new Date().toISOString())}</span><span>traceId ${esc(traceId || '-')}</span></div>
${detailHtml}
<div class="links"><a href="/">控制台</a><a href="/docs">接口文档</a><a href="/_routes">路由清单</a><a href="/_logs">最近日志</a></div>
<div class="note">由 ClickBuild 生成的服务 · 浏览器打开时显示错误页，API 客户端仍收到 JSON</div>
</main></body></html>`;
}

function sendError(req, res, status, body, title, detail, extra) {
  if (ERR_PAGES && wantsHtml(req)) {
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...(extra || {}),
    });
    return res.end(errorHtml(status, title || (status === 404 ? '没有找到这个页面' : '服务内部错误'), (body && body.message) || '', [(body && body.hint), detail].filter(Boolean).join('\n'), body && body.traceId));
  }
  return send(res, status, body, extra);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > CFG.maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        const err = new Error(`请求体超过 ${Math.round(CFG.maxBodyBytes / 1024 / 1024)}MB`);
        err.code = 'BODY_TOO_LARGE';
        reject(err);
        return;
      }
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

function fileKindOk(kind, filename, contentType) {
  const k = String(kind || 'any');
  if (k === 'any') return true;
  const ct = String(contentType || '').toLowerCase();
  const ext = (String(filename || '').match(/\.([A-Za-z0-9]+)$/) || [])[1] || '';
  const image = /^image\//.test(ct) || /^(png|jpg|jpeg|gif|webp|bmp|svg|avif)$/i.test(ext);
  const video = /^video\//.test(ct) || /^(mp4|mov|webm|mkv|avi)$/i.test(ext);
  const audio = /^audio\//.test(ct) || /^(mp3|wav|ogg|m4a|flac|aac)$/i.test(ext);
  const pdf = ct === 'application/pdf' || ext.toLowerCase() === 'pdf';
  const doc = pdf || /^(doc|docx|xls|xlsx|ppt|pptx|csv|txt|md|rtf)$/i.test(ext) || /^(application\/(msword|vnd\.|pdf)|text\/)/.test(ct);
  const archive = /^(zip|rar|7z|tar|gz|tgz|bz2)$/i.test(ext) || /^(application\/(zip|x-tar|x-rar-compressed))/.test(ct);
  if (k === 'image') return image;
  if (k === 'video') return video;
  if (k === 'audio') return audio;
  if (k === 'pdf') return pdf;
  if (k === 'document') return doc;
  if (k === 'archive') return archive;
  return true;
}

async function putObject(iface, filename, contentType, buffer, opts) {
  const day = new Date().toISOString().slice(0, 10);
  const bucket = (opts && opts.bucket) || (iface.storage && iface.storage.bucket) || 'clickbuild';
  const prefix = String((opts && opts.prefix) || '').replace(/^\/+|\/+$/g, '');
  const key = `${prefix ? prefix + '/' : ''}${iface.tables[0].name}/${day}/${crypto.randomUUID()}-${safeName(filename)}`;
  if (!s3 || !bucketReady) {
    const localDir = (cfg.storage && cfg.storage.localDir) || './uploads';
    const full = path.join(localDir, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return { objectKey: key, objectUrl: '/uploads/' + key, filename, size: buffer.length, contentType: contentType || 'application/octet-stream', bucket, local: true };
  }
  try {
    await s3.putObject(bucket, key, buffer, buffer.length, { 'Content-Type': contentType || 'application/octet-stream' });
    let url = '';
    try { url = await s3.presignedGetObject(bucket, key, 7 * 24 * 3600); } catch (e) { url = ''; }
    return { objectKey: key, objectUrl: url, filename, size: buffer.length, contentType: contentType || 'application/octet-stream', bucket };
  } catch (e) {
    const localDir = (cfg.storage && cfg.storage.localDir) || './uploads';
    const full = path.join(localDir, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return { objectKey: key, objectUrl: '/uploads/' + key, filename, size: buffer.length, contentType: contentType || 'application/octet-stream', bucket, local: true, s3Error: e.message };
  }
}

function cacheKeyOf(iface, route, ctx) {
  const tpl = route.cache.key || `icb:${iface.tables[0].name}:${route.method}:${route.path}:{{queryHash}}`;
  try {
    const raw = render.renderText(tpl, iface, ctx);
    if (!raw) return '';
    // 每个工程一个缓存命名空间，多个工程共用一台 Redis 也互不相干。
    // 路由也必须进 key：列表/详情可能共用同一个表模板，不能互相读到别人的缓存。
    const body = raw.startsWith(`${CACHE_NS}:`) ? raw.slice(CACHE_NS.length + 1) : raw.replace(/^icb:/, '');
    return `${CACHE_NS}:${route.method}:${route.path}:${body}`;
  } catch (e) { return ''; }
}

function scriptMayRedirect(route) {
  return /(^|\n)\s*RETURN\s+3\d{2}\b/i.test(String((route && route.script) || ''));
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

// ---------------- 爬虫获取 ----------------
function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
}

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

async function crawlPage(target, options) {
  const opt = options || {};
  const u = new URL(String(target || ''));
  if (!/^http(s)?:/.test(u.protocol)) throw new Error(`CRAWL 只支持 http(s)：${target}`);
  if (!opt.allowPrivate && isPrivateHost(u.hostname)) throw new Error(`CRAWL 默认禁止内网地址：${u.hostname}`);
  const maxBytes = Math.max(1024, Math.min(Number(opt.maxBytes) || 2 * 1024 * 1024, 8 * 1024 * 1024));
  const timeout = Math.max(1000, Math.min(Number(opt.timeoutMs) || 20000, 60000));
  const res = await fetch(u, {
    method: opt.method || 'GET',
    headers: { 'user-agent': 'ClickBuildCrawler/1.0', accept: 'text/html,application/json,text/plain', ...(opt.headers || {}) },
    body: opt.body == null ? undefined : (typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body)),
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error(`CRAWL 响应超过 ${maxBytes} 字节`);
  const text = Buffer.from(buf).toString('utf8');
  const contentType = String(res.headers.get('content-type') || '');
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
  const links = [];
  if (opt.links !== false) {
    const re = /<a\s+[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^>\s]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(text)) && links.length < (Number(opt.maxLinks) || 200)) {
      const href = m[1] || m[2] || m[3] || '';
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
      let abs = href;
      try { abs = new URL(href, u).toString(); } catch (e) { /* 保留原值 */ }
      links.push({ href: abs, text: decodeEntities(m[4].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200) });
    }
  }
  const body = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const matched = opt.pattern ? (new RegExp(String(opt.pattern), 'i').exec(text) || [])[1] || '' : '';
  return {
    status: res.status, ok: res.ok, url: u.toString(), contentType, title,
    text: body.slice(0, Number(opt.maxText) || 200000), matched,
    links: opt.links === false ? [] : links,
    bytes: buf.byteLength,
  };
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
  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    if (e.code === 'BODY_TOO_LARGE' || /请求体超过/.test(e.message)) {
      return sendError(req, res, 413, { ok: false, error: 'BODY_TOO_LARGE', message: e.message, traceId }, '请求体过大');
    }
    throw e;
  }
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

  // 权限矩阵：路由声明 roles 时，用户 token 里必须带 roles 交集。
  if (Array.isArray(route.roles) && route.roles.length && !user) {
    logPush({ level: 'WARN', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 401, ms: 0, ip, traceId, message: '角色路由缺少 token' });
    return send(res, 401, { ok: false, error: 'UNAUTHORIZED', message: '需要有效的 token（该路由配置了角色）', traceId });
  }
  if (PERMISSIONS.enforce && Array.isArray(route.roles) && route.roles.length) {
    const roles = Array.isArray(user && user.roles) ? user.roles : (user && user.role ? [user.role] : []);
    if (!roles.some((r) => route.roles.includes(r))) {
      logPush({ level: 'WARN', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 403, ms: 0, ip, traceId, message: `角色不足：${roles.join(',') || '无'} 不在 ${route.roles.join(',')}` });
      return send(res, 403, { ok: false, error: 'FORBIDDEN', message: `需要角色：${route.roles.join(',')}`, traceId });
    }
  }

  // 上游转发：直接代理，不进入脚本/事务。
  if (route.key === 'proxy' || (route.proxy && route.proxy.enabled)) {
    return handleProxy(req, res, item, raw, query, started);
  }

  // 对象表：把 bucket 里的对象直接列成表格（支持 marker 分页与 DELETE）。
  if (route.key === 'objects') {
    try { return await handleObjects(req, res, item, query); } catch (e) {
      logPush({ level: 'ERROR', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 500, ms: Date.now() - started, ip, traceId, message: '对象表失败', data: { error: e.message } });
      return send(res, 500, { ok: false, error: 'OBJECT_TABLE_FAILED', message: e.message, traceId });
    }
  }

  const ctx = {
    query, body, path: item.params, id: item.params.id != null ? item.params.id : (query.id != null ? query.id : body.id),
    headers: req.headers || {},
    req: { method: req.method, url: req.url, path: pathname, headers: req.headers || {} },
    file: null, vars: user ? { user } : {}, uuid: crypto.randomUUID().replace(/-/g, ''),
    user, token, remoteIp: ip, traceId, service: project.services || [],
    io: route.io || {},
    cookieStore: route.io && route.io.response === 'cookie' && route.io.storage === 'memory' ? 'memory' : 'redis',
    mintedToken: '', mintedOnlyId: '', tokenDeleted: false,
  };

  let uploaded = null;
  const io = route.io || {};
  if (io.response === 'file') {
    if (!file) return send(res, 400, { ok: false, error: 'FILE_REQUIRED', message: '该接口类型要求上传文件（multipart 字段 file）', traceId });
    const maxMb = Number(io.maxMb || 0);
    if (maxMb > 0 && file.buffer.length > maxMb * 1024 * 1024) {
      return send(res, 413, { ok: false, error: 'FILE_TOO_LARGE', message: `文件超过 ${maxMb} MB`, traceId });
    }
    if (!fileKindOk(io.fileKind, file.filename, file.contentType)) {
      return send(res, 415, { ok: false, error: 'FILE_TYPE_NOT_ALLOWED', message: `只允许 ${io.fileKind} 类型`, traceId });
    }
    try {
      uploaded = await putObject(iface, file.filename, file.contentType, file.buffer, { bucket: io.bucket, prefix: io.prefix });
      ctx.file = uploaded;
      if (io.autoBind && io.field) {
        const target = (iface.tables || []).find((t) => t.key === io.tableKey) || iface.tables[0];
        if (target) {
          const qf = '`' + String(io.field).replace(/`/g, '') + '`';
          const qt = '`' + String(target.name).replace(/`/g, '') + '`';
          const pk = (target.fields || []).find((f) => f.pk) || { name: 'id' };
          const h = await poolFor(target.conn || 'main');
          if (ctx.id != null && String(ctx.id) !== '') {
            const r = await h.pool.query(`UPDATE ${qt} SET ${qf} = ? WHERE \`${pk.name}\` = ?`, [uploaded.objectKey, ctx.id]);
            uploaded.boundRows = (r[0] || r).affectedRows;
          } else {
            const r = await h.pool.query(`INSERT INTO ${qt} (${qf}) VALUES (?)`, [uploaded.objectKey]);
            const ins = r[0] || r;
            uploaded.recordId = ins.insertId;
            ctx.id = ins.insertId;
          }
        }
      }
    } catch (e) {
      logPush({ level: 'ERROR', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 500, ms: Date.now() - started, ip, traceId, message: '文件入库失败', data: { error: e.message } });
      return send(res, 500, { ok: false, error: 'UPLOAD_FAILED', message: e.message, traceId });
    }
  }

  const cacheable = route.cache && route.cache.enabled && !scriptMayRedirect(route);
  const ckey = cacheable ? cacheKeyOf(iface, route, ctx) : '';
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
    if (rowstore) rowstore.begin();
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
    if (rowstore) rowstore.rollback();
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
    if (!failure && rowstore) await rowstore.commit();
    return { committed, failure };
  }

  async function dbQuery(sql, params) {
    if (rowstore) {
      const pure = await rowstore.query(iface, sql, params || []);
      if (pure) return pure;
    }
    const key = connKeyForSql(sql);
    const st = txStates.get(key);
    const runner = st && st.inTx ? st.conn : (await poolFor(key)).pool;
    const policy = storePolicy(iface, sql);
    if (policy.mode === 'mysql') return (await runner.query(sql, params))[0];
    const ikey = iface.id || iface.name;
    const qkey = `q:${ikey}:${storeVersion(iface)}:${crypto.createHash('sha1').update(sql + '|' + JSON.stringify(params || [])).digest('hex')}`;
    const useMem = ['cache', 'redis-mysql', 'periodic'].includes(policy.mode);
    const useRedis = ['cache', 'redis-mysql'].includes(policy.mode);
    const ttl = policy.ttl;
    if (useMem) {
      const hit = STORE_MEM.get(qkey);
      if (hit && Date.now() - hit.at < ttl * 1000) return hit.val;
    }
    if (useRedis && redis) {
      try {
        const raw = await redis.get(`${CACHE_NS}:${qkey}`);
        if (raw) {
          const rows = JSON.parse(raw);
          if (useMem) storeTouch(qkey, rows, policy.max);
          return rows;
        }
      } catch (e) { /* 回退 MySQL */ }
    }
    const rows = (await runner.query(sql, params))[0];
    if (useMem) storeTouch(qkey, rows, policy.max);
    if (useRedis && redis) {
      try { await redis.setex(`${CACHE_NS}:${qkey}`, ttl, JSON.stringify(rows)); } catch (e) {}
    }
    return rows;
  }
  async function dbExecute(sql, params) {
    if (rowstore) {
      const pure = await rowstore.exec(iface, sql, params || []);
      if (pure) return pure;
    }
    const key = connKeyForSql(sql);
    const st = txStates.get(key);
    const runner = st && st.inTx ? st.conn : (await poolFor(key)).pool;
    const [r] = await runner.execute(sql, params);
    if (storePolicy(iface, sql).mode !== 'mysql' && !st) storeBump(iface);
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
      return sendError(req, res, 500, { ok: false, error: 'TX_BEGIN_FAILED', message: e.message, traceId }, '服务内部错误', e.stack);
    }
  }

  const logs = [];
  let result;
  try {
    if (typeof route.handler === 'function') {
      // 模块自定义逻辑：handler 优先于脚本解释器，和脚本路由共用鉴权、限流、事务、缓存。
      const api = {
        project, iface, route, ctx, redis, s3,
        db: { query: dbQuery, execute: dbExecute },
        log: (level, message, data) => logPush({ level: level || 'INFO', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 0, ms: Date.now() - started, ip, traceId, message, data }),
      };
      const raw = await route.handler(ctx, api);
      result = (raw && typeof raw === 'object' && ('status' in raw || 'body' in raw || 'logs' in raw || 'headers' in raw))
        ? { status: raw.status || 200, body: raw.body, logs: raw.logs || [], headers: raw.headers }
        : { status: 200, body: raw };
    } else {
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
      crawl: (target, options) => crawlPage(target, options),
      publish: async (channel, payload) => {
        if (!redis) throw new Error('Redis 不可用');
        await redis.publish(String(channel), typeof payload === 'string' ? payload : JSON.stringify(payload));
        return true;
      },
      token: tokenStore,
      });
    }
  } catch (e) {
    if (startedTx) {
      await txRollbackAll('脚本异常');
      logPush({ level: 'FATAL', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status: 500, ms: Date.now() - started, ip, traceId, message: '事务已回滚（脚本异常）', data: { error: e.message, stack: String(e.stack || '').split('\n').slice(0, 4) } });
    }
    // 把路由上下文挂到异常上，最外层 500 报告才能写清楚是哪条路由失败。
    e.icbRoute = route.name;
    e.icbRouteMethod = route.method;
    e.icbRoutePath = pathname;
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
    return sendError(req, res, 500, { ok: false, error: 'CROSS_TX_COMMIT_FAILED', message: '提交阶段失败，部分连接已提交，已记录 FATAL 日志', traceId }, '服务内部错误');
  }

  logs.push(...(result.logs || []));
  const status = result.status || 200;
  const headers = cleanHeaders(result.headers);
  if (status >= 300 && status < 400 && status !== 304) {
    const location = redirectTarget(result.body);
    if (location && !hasLocation(headers)) headers.Location = location;
  }
  const redirect = status >= 300 && status < 400 && hasLocation(headers);
  if (!redirect && status < 400 && route.cache && route.cache.enabled && ckey && redis) {
    try { await redis.setex(ckey, route.cache.ttl || 60, JSON.stringify(result.body)); } catch (e) { /* 忽略 */ }
  }
  if (route.method !== 'GET' && status < 400) await invalidate(iface);
  breakerRecord(rkey, guard.breaker, status >= 500);

  const ms = Date.now() - started;
  logPush({ level: status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO', ts: stamp(), iface: iface.name, route: route.name, method: route.method, pathname, status, ms, ip, traceId, message: `${status} ${route.name}`, data: logs.length ? logs : null });

  const outBody = result.body && typeof result.body === 'object' ? result.body : {};
  const failed = status >= 400 || (!redirect && outBody.ok === false);
  const out = {
    ok: !failed,
    ...(failed ? {
      error: outBody.error || 'ERROR',
      message: outBody.message || undefined,
      hint: outBody.hint || undefined,
      route: route.name,
      method: route.method,
      path: pathname,
    } : {}),
    data: result.body,
    cached: false,
    ms,
    traceId,
    ...(uploaded ? { file: uploaded } : {}),
    ...(logs.length ? { logs } : {}),
  };
  if (status >= 500) return sendError(req, res, status, out, '服务内部错误', outBody.message || '');
  const setCookie = authCookie(ctx, route);
  const extra = { ...headers };
  if (setCookie) extra['set-cookie'] = setCookie;
  return send(res, status, out, extra);
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
        responses: { 200: { description: 'OK' }, 400: { description: '参数/请求体错误' }, 401: { description: '未授权' }, 403: { description: '无权访问' }, 404: { description: '资源/路由不存在' }, 405: { description: '请求方法不允许' }, 409: { description: '状态冲突' }, 413: { description: '请求体过大' }, 429: { description: '限流' }, 503: { description: '熔断/时间窗/服务不可用' } },
        ...(route.auth ? { security: [{ bearer: [] }] } : {}),
        'x-clickbuild': { kind: route.key, io: route.io, tx: !!(route.guard && route.guard.tx), cache: route.cache },
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
<tr><td><code>/_health/interfaces</code></td><td>检查全部接口的路由、表/字段和脚本语法，不执行写请求</td></tr>
<tr><td><code>/_logs</code> / <code>/_logs/stream</code></td><td>日志快照 / SSE 实时日志</td></tr>
<tr><td><code>/_errors/404</code></td><td>404 错误页预览</td></tr>
<tr><td><code>/_errors/405</code></td><td>405 方法不允许错误页预览</td></tr>
<tr><td><code>/_errors/413</code></td><td>413 请求体过大错误页预览</td></tr>
<tr><td><code>/_errors/500</code></td><td>500 错误页预览</td></tr>
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
<tr><td><code>{{where:key}}</code></td><td>条件：<code>field</code> / <code>__ne</code> / <code>__gte</code> / <code>__gt</code> / <code>__lte</code> / <code>__lt</code> / <code>__like</code> / <code>__regex</code> / <code>__iregex</code> / <code>__notregex</code> / <code>__contains</code> / <code>__startswith</code> / <code>__endswith</code> / <code>__in</code> / <code>__between</code> / <code>__isnull</code> / <code>__notnull</code>；<code>keyword</code> 走 LIKE，<code>keywordRegex</code> 走 REGEXP</td></tr>
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

# 过滤（等值 / LIKE / 正则 / 范围 / 非空）
curl "${esc(exampleUrl)}?keyword=abc&name__startswith=A&status__in=paid,shipped&amount__gte=100&title__iregex=(?i)pro"

# 健康检查（依赖 + 全部接口结构与脚本）
curl "http://127.0.0.1:${CFG.httpPort}/_health"
curl "http://127.0.0.1:${CFG.httpPort}/_health/interfaces"</pre>
<p class="note">注意：所有接口默认前缀是 <code>${esc(CFG.apiPrefix)}</code>；如果路径带 <code>:id</code>，请求时换成真实 ID。数据库 / Redis / S3 地址在生成目录的 <code>.env</code> 里改，重启服务生效。</p>
</main></html>`;
}

// ---------------- 启动 ----------------
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://local');
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/_errors/404') {
      const traceId = crypto.randomBytes(6).toString('hex');
      return sendError(req, res, 404, { ok: false, error: 'NO_ROUTE', message: '这是 404 页面预览', traceId }, '没有找到这个页面');
    }
    if (pathname === '/_errors/405') {
      const traceId = crypto.randomBytes(6).toString('hex');
      return sendError(req, res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', message: '这是 405 页面预览', traceId }, '请求方法不允许', '', { allow: 'GET, POST, PUT, DELETE' });
    }
    if (pathname === '/_errors/413') {
      const traceId = crypto.randomBytes(6).toString('hex');
      return sendError(req, res, 413, { ok: false, error: 'BODY_TOO_LARGE', message: `这是 413 页面预览：请求体超过 ${Math.round(CFG.maxBodyBytes / 1024 / 1024)}MB`, traceId }, '请求体过大');
    }
    if (pathname === '/_errors/500') throw new Error('这是 500 页面预览：模拟服务端异常');
    if (pathname === '/_health/interfaces') {
      try {
        return send(res, 200, await checkInterfaceHealth());
      } catch (e) {
        return send(res, 500, { ok: false, error: 'HEALTH_CHECK_FAILED', message: e.message, checkedAt: new Date().toISOString() });
      }
    }
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
        log: LOG_CFG, token: { ttl: TOKEN_TTL, header: TOKEN_CFG.header, cookie: TOKEN_CFG.cookie, store: TOKEN_CFG.store || 'redis' },
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
    if (pathname.startsWith('/uploads/')) {
      const rel = decodeURIComponent(pathname.slice('/uploads/'.length));
      if (rel.includes('..')) return send(res, 400, { ok: false, error: 'BAD_PATH' });
      const localDir = (cfg.storage && cfg.storage.localDir) || './uploads';
      const f = path.join(localDir, rel);
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, { ok: false, error: 'NO_FILE' });
      const ext = path.extname(f).toLowerCase();
      const types = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
      const stat = fs.statSync(f);
      const range = req.headers.range;
      const common = { 'content-type': types[ext] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600' };
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
        if (m && (m[1] || m[2])) {
          let start = m[1] ? Number(m[1]) : 0;
          let end = m[2] ? Number(m[2]) : stat.size - 1;
          if (!m[1] && m[2]) { start = Math.max(0, stat.size - Number(m[2])); end = stat.size - 1; }
          if (start >= stat.size || end < start) { res.writeHead(416, { 'content-range': 'bytes */' + stat.size }); return res.end(); }
          end = Math.min(end, stat.size - 1);
          res.writeHead(206, Object.assign({}, common, { 'content-range': 'bytes ' + start + '-' + end + '/' + stat.size, 'content-length': end - start + 1 }));
          return fs.createReadStream(f, { start, end }).pipe(res);
        }
      }
      res.writeHead(200, Object.assign({}, common, { 'content-length': stat.size }));
      return fs.createReadStream(f).pipe(res);
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
      const traceId = crypto.randomBytes(6).toString('hex');
      const allow = allowedMethods(pathname);
      if (allow.length) {
        return sendError(req, res, 405, {
          ok: false, error: 'METHOD_NOT_ALLOWED', message: `${req.method} ${pathname} 不支持，允许：${allow.join(', ')}`,
          allow, traceId,
        }, '请求方法不允许', '', { allow: allow.join(', ') });
      }
      return sendError(req, res, 404, {
        ok: false, error: 'NO_ROUTE', message: `${req.method} ${pathname} 没有匹配到接口路由`,
        hint: '打开 /_routes 看全部路由，/docs 看文档', traceId,
      }, '没有找到这个页面');
    }
    return await handle(req, res, item);
  } catch (e) {
    const traceId = crypto.randomBytes(6).toString('hex');
    console.error('[error]', traceId, req.method, req.url, e);
    logPush({ level: 'ERROR', ts: stamp(), method: req.method, pathname, status: 500, ms: 0, message: e.message, traceId });
    return sendError(req, res, 500, {
      ok: false, error: 'INTERNAL', message: e.message, stack: String(e.stack || '').split('\n').slice(0, 4), traceId,
      hint: '把这条 traceId 发到控制台日志里，可以定位到具体路由和 SQL；需要隐藏堆栈时关闭“错误详情”开关。',
      route: e.icbRoute || undefined,
      method: e.icbRouteMethod || req.method,
      path: e.icbRoutePath || pathname,
    }, '服务内部错误', ERR_DETAIL ? String(e.stack || e.message) : '');
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

async function applySeed() {
  if (!CFG.seedDemo) { console.log('SEED_DEMO=0，跳过演示场景'); return; }
  const file = path.join(ROOT, 'src', 'seed.json');
  if (!fs.existsSync(file)) return;
  let seed;
  try { seed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('[seed] seed.json 解析失败', e.message); return; }
  if (!seed || seed.enabled === false || !String(seed.sql || '').trim()) return;
  const main = mysqlConn('main');
  const db = dbOf(main);
  const conn = await mysql.createConnection({ host: main.host, port: Number(main.port), user: main.user, password: main.password, database: db, multipleStatements: true });
  try {
    if (seed.guard) {
      const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${seed.guard}\``);
      if (Number(rows[0] && rows[0].n) > 0) { console.log(`[seed] 已有数据，跳过演示场景：${seed.guard}`); return; }
    }
    await conn.query(seed.sql);
    console.log(`[seed] 演示场景已写入：${seed.note || db}`);
  } catch (e) {
    console.error('[seed] 演示场景写入失败（服务继续启动）：', e.message);
  } finally {
    await conn.end().catch(() => {});
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
  await applySeed();
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

  if (redis && redis.status !== 'ready') {
    await new Promise((resolve) => {
      const done = () => { try { clearTimeout(t); } catch (x) {} resolve(); };
      const t = setTimeout(done, 2500);
      redis.once('ready', done);
      redis.once('error', done);
    }).catch(() => {});
  }

  if (rowstore) {
    try {
      await rowstore.init();
      console.log('纯表存储已初始化：' + (rowstore.PURE_MODES ? [...rowstore.PURE_MODES].join(' / ') : ''));
    } catch (e) {
      console.error('纯表存储初始化失败', e.message);
    }
  }

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

  // 模块初始化：每个接口模块可以在自己的 index.js 里导出 setup(api)
  for (const m of IFACES) {
    if (typeof m.setup !== 'function') continue;
    try {
      const defaultConn = (m.tables[0] && m.tables[0].conn) || 'main';
      await m.setup({
        project,
        module: m,
        redis,
        s3,
        mysql: (key) => poolFor(key || defaultConn),
        db: {
          query: async (sql, params, connKey) => (await (await poolFor(connKey || defaultConn)).pool.query(sql, params || []))[0],
          execute: async (sql, params, connKey) => {
            const [r] = await (await poolFor(connKey || defaultConn)).pool.execute(sql, params || []);
            return { affectedRows: r.affectedRows || 0, insertId: r.insertId != null ? r.insertId : null, info: r.info || '' };
          },
        },
        log: (level, message, data) => logPush({ level: level || 'INFO', ts: stamp(), iface: m.name, message, data }),
      });
    } catch (e) {
      logPush({ level: 'ERROR', ts: stamp(), iface: m.name, message: `模块 setup 失败：${e.message}`, data: { stack: String(e.stack || '').split('\n').slice(0, 4) } });
    }
  }

  server.listen(CFG.httpPort, () => {
    logPush({ level: 'INFO', ts: stamp(), message: `ClickBuild 接口服务已启动 → http://127.0.0.1:${CFG.httpPort}` });
    console.log(`控制台 http://127.0.0.1:${CFG.httpPort}/  文档 /docs  健康 /_health  日志流 /_logs/stream`);
  });
}

bootstrap().catch((e) => { console.error('启动失败', e); process.exit(1); });

process.on('SIGTERM', () => { try { server.close(); pools.forEach((p) => p.pool.end()); logPool && logPool.end(); redis && redis.disconnect(); } catch (e) {} process.exit(0); });
