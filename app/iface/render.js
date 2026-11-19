'use strict';

// 一个接口可以挂多张表、多个库。SQL 模板里的占位符分两类：
//   结构占位符（{{t:main}} {{columns:item}} {{where:order}} ...）——按表结构安全拼装，标识符走白名单
//   值占位符（{{body.x}} {{query.x}} {{id}} ...）——一律渲染成 ? 并进参数数组
// 表键：tables[].key，缺省 main。不带 key 的写法等价于 main。

const crypto = require('crypto');

const RE_TOKEN = /\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}/g;

const STRUCT = new Set([
  't', 'table', 'columns', 'insertColumns', 'insertValues', 'updateSet', 'where',
  'orderBy', 'limit', 'offset', 'idColumn', 'page', 'pageSize', 'schema', 'tableComment',
  'bindColumn', 'bucket',
]);

const VALUES = new Set(['id', 'now', 'uuid', 'onlyId', 'token', 'remoteIp', 'traceId', 'queryHash', 'filename', 'contentType', 'size', 'objectKey', 'objectUrl']);

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NUMERIC = new Set(['bigint', 'int', 'smallint', 'tinyint', 'decimal', 'float', 'double', 'bool', 'boolean']);

function ident(value, label) {
  const v = String(value == null ? '' : value).trim();
  if (!IDENT_RE.test(v)) throw new Error(`非法标识符 ${label || ''}：${JSON.stringify(v)}（只允许字母、数字、下划线，且以字母或下划线开头）`);
  return v;
}

function intIn(value, def, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function typeOf(field) {
  return String((field && field.type) || 'varchar').toLowerCase();
}

function cast(field, raw) {
  if (raw == null) return null;
  if (!field) return raw;
  const t = typeOf(field);
  if (t === 'bool') return raw === true || raw === '1' || raw === 1 || raw === 'true';
  if (NUMERIC.has(t)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (Array.isArray(raw)) return raw.join(',');
  return String(raw);
}

function tableOf(root, key) {
  const tables = root && root.tables;
  if (!Array.isArray(tables) || !tables.length) return null;
  if (!key) return tables[0];
  return tables.find((t) => t.key === key) || null;
}

// 把接口 + 表键收敛成一份"单表视图"，供下面的拼装函数使用（也兼容旧的单表接口）
function bindingOf(root, key) {
  const t = tableOf(root, key);
  if (!t) {
    if (root && root.tables) throw new Error(`未知表键：${key || 'main'}`);
    return root;
  }
  return {
    table: t.name,
    schema: t.schema || '',
    comment: t.comment || t.name,
    fields: t.fields || [],
    page: root.page,
    storage: root.storage,
    bindField: root.storage && root.storage.bindField,
    tables: root.tables,
  };
}

function splitToken(token) {
  const i = token.indexOf(':');
  if (i < 0) return [token, ''];
  return [token.slice(0, i), token.slice(i + 1)];
}

function pick(ctx, token) {
  const dot = token.indexOf('.');
  const scope = dot > 0 ? token.slice(0, dot) : '';
  const key = dot > 0 ? token.slice(dot + 1) : token;
  // vars / last 支持点路径，例如 {{vars.oid.rows.0.id}}、{{last.insertId}}
  if (scope === 'vars' || scope === 'last') {
    let cur = scope === 'vars' ? (ctx.vars || {}) : ctx.last;
    for (const seg of key.split('.')) {
      if (cur == null) return undefined;
      cur = cur[seg];
    }
    return cur;
  }
  const bag = { query: ctx.query, body: ctx.body, path: ctx.path, file: ctx.file, user: ctx.user || {}, env: ctx.env || {} }[scope];
  if (!bag) return undefined;
  return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : undefined;
}

function findField(binding, name) {
  return (binding.fields || []).find((f) => f.name === name);
}

function columnsSql(binding) {
  return (binding.fields || []).filter((f) => !f.hidden).map((f) => ident(f.name, 'field')).join(', ');
}

function idField(binding) {
  return (binding.fields || []).find((f) => f.pk) || (binding.fields || [])[0] || { name: 'id', type: 'bigint', pk: true };
}

function writableFields(binding) {
  return (binding.fields || []).filter((f) => !f.pk && !f.autoIncrement && f.writable !== false);
}

function buildWhere(binding, ctx, params) {
  const parts = [];
  const fields = (binding.fields || []).filter((f) => f.query !== false && !f.hidden);
  const q = ctx.query || {};
  const byName = new Map(fields.map((f) => [f.name, f]));

  for (const key of Object.keys(q)) {
    if (key === 'page' || key === 'pageSize' || key === 'sort' || key === 'keyword') continue;
    const m = /^([A-Za-z0-9_]+)(?:__(gte|lte|gt|lt|like|in|between|ne))?$/.exec(key);
    if (!m) continue;
    const field = byName.get(m[1]);
    if (!field) continue;
    const op = m[2] || 'eq';
    const col = ident(field.name, 'field');
    const raw = q[key];
    if (raw === '' || raw == null) continue;

    if (op === 'eq') { parts.push(`${col} = ?`); params.push(cast(field, raw)); }
    else if (op === 'ne') { parts.push(`${col} <> ?`); params.push(cast(field, raw)); }
    else if (op === 'gte' || op === 'gt' || op === 'lte' || op === 'lt') {
      const sign = { gte: '>=', gt: '>', lte: '<=', lt: '<' }[op];
      parts.push(`${col} ${sign} ?`);
      params.push(cast(field, raw));
    } else if (op === 'like') { parts.push(`${col} LIKE ?`); params.push(`%${String(raw)}%`); }
    else if (op === 'in') {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      const clean = list.map((v) => String(v).trim()).filter(Boolean).slice(0, 50);
      if (!clean.length) continue;
      parts.push(`${col} IN (${clean.map(() => '?').join(', ')})`);
      clean.forEach((v) => params.push(cast(field, v)));
    } else if (op === 'between') {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      if (list.length < 2) continue;
      parts.push(`${col} BETWEEN ? AND ?`);
      params.push(cast(field, list[0]), cast(field, list[1]));
    }
  }

  const kw = String(q.keyword || '').trim();
  const searchFields = fields.filter((f) => f.search && /char|text|varchar/i.test(typeOf(f)));
  if (kw && searchFields.length) {
    parts.push(`(${searchFields.map((f) => `${ident(f.name)} LIKE ?`).join(' OR ')})`);
    searchFields.forEach(() => params.push(`%${kw}%`));
  }
  return parts.length ? parts.join(' AND ') : '1 = 1';
}

function orderBySql(binding, ctx) {
  const raw = String((ctx.query && ctx.query.sort) || '').trim();
  const fields = new Map((binding.fields || []).map((f) => [f.name, f]));
  if (raw) {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    const built = [];
    for (const p of list) {
      const mm = /^([A-Za-z0-9_]+)(?::(asc|desc))?$/i.exec(p);
      if (mm && fields.has(mm[1])) built.push(`${ident(mm[1])} ${(mm[2] || 'asc').toUpperCase()}`);
    }
    if (built.length) return built.join(', ');
  }
  return `${ident(idField(binding).name)} DESC`;
}

function queryHash(ctx) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).sort().forEach((k) => { out[k] = norm(v[k]); });
      return out;
    }
    return v;
  };
  return crypto.createHash('sha1')
    .update(JSON.stringify({ q: norm(ctx.query || {}), p: norm(ctx.path || {}), id: ctx.id || '' }))
    .digest('hex').slice(0, 16);
}

function structValue(token, root, ctx, params) {
  const [base, key] = splitToken(token);
  const b = (base === 'bucket' || base === 'bindColumn') ? null : bindingOf(root, key);
  switch (base) {
    case 't':
    case 'table': return ident(b.table, 'table');
    case 'schema': return b.schema ? `${ident(b.schema, 'schema')}.` : '';
    case 'tableComment': return String(b.comment || '');
    case 'columns': return columnsSql(b);
    case 'insertColumns': return writableFields(b).map((f) => ident(f.name, 'field')).join(', ');
    case 'insertValues': {
      const body = ctx.body || {};
      return writableFields(b).map((f) => {
        const v = Object.prototype.hasOwnProperty.call(body, f.name) ? body[f.name] : (f.default != null && f.default !== '' ? f.default : null);
        params.push(cast(f, v));
        return '?';
      }).join(', ');
    }
    case 'updateSet': {
      const cols = writableFields(b).filter((f) => Object.prototype.hasOwnProperty.call(ctx.body || {}, f.name));
      if (!cols.length) throw new Error('更新语句没有可写字段：请求体里没有匹配任何可写字段');
      return cols.map((f) => { params.push(cast(f, ctx.body[f.name])); return `${ident(f.name)} = ?`; }).join(', ');
    }
    case 'where': return buildWhere(b, ctx, params);
    case 'orderBy': return orderBySql(b, ctx);
    case 'limit': return String(intIn((ctx.query || {}).pageSize || (ctx.query || {}).limit, (root.page && root.page.size) || 20, 1, 500));
    case 'offset': {
      const size = intIn((ctx.query || {}).pageSize || (ctx.query || {}).limit, (root.page && root.page.size) || 20, 1, 500);
      const page = intIn((ctx.query || {}).page, 1, 1, 100000);
      return String((page - 1) * size);
    }
    case 'page': return String(intIn((ctx.query || {}).page, 1, 1, 100000));
    case 'pageSize': return String(intIn((ctx.query || {}).pageSize, (root.page && root.page.size) || 20, 1, 500));
    case 'idColumn': return ident(idField(b).name, 'field');
    case 'bindColumn': return ident((root.storage && root.storage.bindField) || root.bindField || 'file_key', 'field');
    case 'bucket': return String((root.storage && root.storage.bucket) || 'clickbuild').replace(/'/g, '');
    default: return '';
  }
}

function valueOf(token, ctx, root) {
  if (token === 'id') {
    if (ctx.id != null) return ctx.id;
    if (ctx.query && ctx.query.id != null) return ctx.query.id;
    return ctx.path && ctx.path.id;
  }
  if (token === 'now') return ctx.now || new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (token === 'uuid' || token === 'onlyId') return ctx.uuid || crypto.randomUUID();
  if (token === 'token') return ctx.token || '';
  if (token === 'remoteIp') return ctx.remoteIp || '';
  if (token === 'traceId') return ctx.traceId || '';
  if (token === 'queryHash') return queryHash(ctx);
  if (token === 'filename') return (ctx.file && ctx.file.filename) || '';
  if (token === 'contentType') return (ctx.file && ctx.file.contentType) || '';
  if (token === 'size') return (ctx.file && ctx.file.size) || 0;
  if (token === 'objectKey') return (ctx.file && ctx.file.objectKey) || '';
  if (token === 'objectUrl') return (ctx.file && ctx.file.objectUrl) || '';
  const v = pick(ctx, token);
  const fieldName = token.split('.').slice(-1)[0];
  const b = bindingOf(root, '');
  return cast(findField(b, fieldName), v);
}

// 供脚本解释器使用：SQL 文本来自脚本，上下文是接口（可带多表）
function renderSqlText(text, root, ctx) {
  let out = '';
  const params = [];
  let last = 0;
  RE_TOKEN.lastIndex = 0;
  let m;
  // 脚本里的 $变量 可以直接写进 SQL：$i.product_id → {{vars.i.product_id}}，
  // 也支持数组下标：$rows.rows[0].id → {{vars.rows.rows.0.id}}。
  // 只替换能解析出值的路径（至少一段 .），解析不到就原样留给 SQL 报错。
  const tpl = String(text || '').replace(/\$([A-Za-z_][A-Za-z0-9_]*(?:(?:\[[0-9]+\])|(?:\.[A-Za-z0-9_]+))*)/g, (all, rawPath) => {
    const path = rawPath.replace(/\[([0-9]+)\]/g, '.$1');
    const v = pick(ctx, `vars.${path}`);
    if (v === undefined || v === null) return all;
    return `{{vars.${path}}}`;
  });
  while ((m = RE_TOKEN.exec(tpl))) {
    out += tpl.slice(last, m.index);
    const token = m[1];
    const base = splitToken(token)[0];
    if (STRUCT.has(base)) {
      out += structValue(token, root, ctx, params);
    } else {
      params.push(valueOf(token, ctx, root));
      out += '?';
    }
    last = m.index + m[0].length;
  }
  out += tpl.slice(last);
  return { sql: out, params };
}

function renderSql(root, ctx) {
  if (!root || typeof root.sql !== 'string') throw new Error('缺少 SQL');
  return renderSqlText(root.sql, root, ctx);
}

function renderText(tpl, root, ctx) {
  return String(tpl || '').replace(RE_TOKEN, (all, token) => {
    const [base, key] = splitToken(token);
    if (STRUCT.has(base)) {
      const b = (base === 'bucket' || base === 'bindColumn') ? null : bindingOf(root, key);
      if (base === 'table') return ident(b.table, 'table');
      if (base === 't') return ident(b.table, 'table');
      if (base === 'columns') return columnsSql(b);
      if (base === 'idColumn') return ident(idField(b).name, 'field');
      if (base === 'bindColumn') return String((root.storage && root.storage.bindField) || 'file_key');
      if (base === 'bucket') return String((root.storage && root.storage.bucket) || 'clickbuild');
      if (base === 'page') return String(intIn((ctx.query || {}).page, 1, 1, 100000));
      if (base === 'pageSize' || base === 'limit') return String(intIn((ctx.query || {}).pageSize || (ctx.query || {}).limit, (root.page && root.page.size) || 20, 1, 500));
      if (base === 'offset') return String(((intIn((ctx.query || {}).page, 1, 1, 100000)) - 1) * intIn((ctx.query || {}).pageSize, 20, 1, 500));
      if (base === 'orderBy') return 'id DESC';
      if (base === 'where') return '1 = 1';
      return '';
    }
    const v = valueOf(token, ctx, root);
    return v == null ? '' : String(v);
  });
}

function tokens(tpl) {
  const out = [];
  String(tpl || '').replace(RE_TOKEN, (all, token) => { out.push(token); return all; });
  return out;
}

function checkTemplate(tpl) {
  const unknown = [];
  for (const t of tokens(tpl)) {
    const base = splitToken(t)[0];
    if (STRUCT.has(base) || VALUES.has(t)) continue;
    if (/^(query|body|path|file|vars)\.[A-Za-z0-9_]+/.test(t)) continue;
    unknown.push(t);
  }
  return unknown;
}

module.exports = {
  STRUCT, VALUES, tokens, checkTemplate, renderSql, renderSqlText, renderText, queryHash,
  ident, cast, idField, writableFields, bindingOf, tableOf, splitToken, valueOf,
};
