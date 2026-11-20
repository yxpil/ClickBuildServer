'use strict';

// 从脚本反推接口文档：参数、示例、响应、错误码都来自真实的 AST 和表结构，不再让用户手填空占位符。
const crypto = require('crypto');
const { parseScript } = require('./script');

const FIELDS = ['summary', 'description', 'requestExample', 'responseExample'];
const SQL_WORDS = new Set(['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'LIMIT', 'OFFSET', 'ORDER', 'GROUP', 'HAVING', 'UNION', 'AS', 'SET', 'VALUES', 'INTO', 'UPDATE', 'DELETE', 'LIKE', 'IN']);

function listTables(iface) {
  return Array.isArray(iface && iface.tables) ? iface.tables : [];
}
function findTable(iface, token) {
  const list = listTables(iface);
  return list.find((t) => t && (t.key === token || t.name === token)) || null;
}
function findField(iface, name) {
  for (const t of listTables(iface)) {
    const f = (t.fields || []).find((x) => x && x.name === name);
    if (f) return { table: t, field: f };
  }
  return null;
}
function typeOf(field) {
  return String((field && field.type) || '').toLowerCase();
}
function isNumberType(type) {
  return /^(bigint|int|smallint|tinyint|decimal|float|double|bool)$/.test(String(type || ''));
}
function uuid() {
  return '550e8400-e29b-41d4-a716-446655440000';
}
function sampleForName(name, field) {
  const n = String(name || '').toLowerCase();
  const type = typeOf(field);
  if (/only_id|onlyid/.test(n)) return 'u_10001';
  if (/group_id/.test(n)) return 'g_10001';
  if (/moment_id/.test(n)) return 'm_10001';
  if (/msg_id/.test(n)) return 'msg_10001';
  if (/conv_id/.test(n)) return 'c_10001';
  if (/order_id/.test(n)) return 1001;
  if (/^id$|_id$/.test(n)) return 1;
  if (/password|passwd|secret/.test(n)) return 'secret123';
  if (/username|login/.test(n)) return 'alice';
  if (/nickname/.test(n)) return '小艾';
  if (/phone|mobile/.test(n)) return '13800138000';
  if (/email/.test(n)) return 'alice@example.com';
  if (/avatar|image|photo|cover|media_url/.test(n)) return 'https://example.com/a.png';
  if (/url|link/.test(n)) return 'https://example.com/a';
  if (/region|city|address/.test(n)) return '昆明';
  if (isNumberType(type) && type !== 'bool') return 1;
  if (type === 'bool') return true;
  if (/role|scene|kind|type|mode/.test(n)) return 'user';
  if (/status|state|flag|enable|allow|visible/.test(n)) return 1;
  if (/count|total|qty|size|page|limit|offset|amount|price/.test(n)) return 1;
  if (/keyword|search|query|\bq\b/.test(n)) return 'keyword';
  if (/title|name|subject/.test(n)) return '示例标题';
  if (/intro|bio|content|body|desc|comment|note|text/.test(n)) return '示例文本';
  if (/created_at|updated_at|last_seen_at|joined_at|time|date/.test(n) || /datetime/.test(type)) return '2026-01-01 00:00:00';
  if (/date/.test(type)) return '2026-01-01';
  if (/json/.test(type)) return {};
  if (isNumberType(type)) return 1;
  if (/bool/.test(type)) return true;
  return '示例文本';
}
function sampleForPlaceholder(ph, iface) {
  const token = String(ph || '');
  if (token === 'now') return '2026-01-01 00:00:00';
  if (token === 'uuid') return uuid();
  if (token === 'onlyId') return 'u_10001';
  if (/^id$/.test(token) || /\.id$/.test(token)) return 1;
  if (/^file\./.test(token)) return '(binary)';
  if (/^user\./.test(token)) {
    const leaf = token.split('.').pop();
    return leaf === 'onlyId' || leaf === 'only_id' ? 'u_10001' : sampleForName(leaf, null);
  }
  if (/^query\./.test(token) || /^body\./.test(token) || /^path\./.test(token)) {
    const leaf = token.split('.').slice(1).join('.');
    const hit = findField(iface, leaf);
    return sampleForName(leaf, hit && hit.field);
  }
  return '示例文本';
}

function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (node.k) fn(node);
  for (const key of Object.keys(node)) {
    if (key === 'k') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
    else walk(v, fn);
  }
}

function splitTop(text) {
  const out = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < String(text || '').length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\' && i + 1 < text.length) { cur += text[++i]; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function tableRefs(sql, iface) {
  const refs = [];
  const re = /\{\{t:([^}]+)\}\}\s*(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)?/gi;
  let m;
  while ((m = re.exec(sql))) {
    let alias = m[2] || '';
    if (!alias || SQL_WORDS.has(alias.toUpperCase())) alias = '';
    refs.push({ table: findTable(iface, m[1].trim()), alias, token: m[1].trim() });
  }
  return refs;
}

function selectedColumns(sql, iface) {
  const refs = tableRefs(sql, iface);
  const first = refs[0] && refs[0].table;
  if (!first) return [];
  const m = /SELECT\s+([\s\S]*?)\s+FROM\s+/i.exec(sql);
  if (!m) return [];
  const body = m[1].replace(/^DISTINCT\s+/i, '').trim();
  if (body === '*') {
    return (first.fields || []).filter((f) => !f.hidden).slice(0, 8).map((f) => ({ name: f.name, field: f }));
  }
  return splitTop(body).map((part) => {
    let expression = part;
    let name = '';
    const am = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(expression);
    if (am) {
      name = am[1];
      expression = expression.slice(0, am.index).trim();
    }
    let prefix = '';
    const pm = /^(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(expression);
    if (pm) {
      prefix = pm[1] || '';
      name = name || pm[2];
    } else if (!name) {
      const tail = expression.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      name = tail ? tail[1] : 'value';
    }
    const table = prefix
      ? (refs.find((r) => r.alias === prefix) || {}).table || first
      : first;
    const field = (table.fields || []).find((f) => f.name === name) || null;
    return { name, field };
  }).filter((c) => c.name && c.name !== '*');
}

function queryShape(sql, iface) {
  const columns = selectedColumns(sql, iface);
  const row = {};
  if (columns.length) {
    for (const c of columns) row[c.name] = sampleForName(c.name, c.field);
  } else {
    const first = (tableRefs(sql, iface)[0] || {}).table;
    if (first) (first.fields || []).filter((f) => !f.hidden).slice(0, 5).forEach((f) => { row[f.name] = sampleForName(f.name, f); });
  }
  return { row, columns: columns.map((c) => c.name) };
}

function walkSample(node, ctx, depth) {
  if (!node || depth > 12) return null;
  if (node.k === 'lit') return node.v;
  if (node.k === 'ph') return sampleForPlaceholder(node.v, ctx.iface);
  if (node.k === 'object') {
    const out = {};
    for (const e of node.entries || []) {
      const key = String(e.key || '').replace(/^__ph__/, '');
      out[key || 'key'] = walkSample(e.value, ctx, depth + 1);
    }
    return out;
  }
  if (node.k === 'array') return (node.items || []).map((x) => walkSample(x, ctx, depth + 1));
  if (node.k === 'var') {
    const name = node.name;
    const path = Array.isArray(node.path) ? node.path.slice() : [];
    if (ctx.queries[name]) {
      const q = ctx.queries[name];
      if (path[0] === 'rows') {
        const rest = path.slice(1);
        if (!rest.length) return [q.row];
        if (typeof rest[0] === 'number') return walkRow(q.row, rest.slice(1));
        return walkRow(q.row, rest);
      }
      if (path[0] === 'columns') return q.columns;
      return { rows: [q.row], columns: q.columns };
    }
    if (ctx.tokens[name]) return walkRow({ token: '<token>', onlyId: 'u_10001' }, path);
    if (ctx.scalars[name] !== undefined) return walkRow(ctx.scalars[name], path);
    return '示例值';
  }
  if (node.k === 'call') {
    const fn = String(node.name || '').toUpperCase();
    if (fn === 'NOW') return '2026-01-01 00:00:00';
    if (fn === 'UUID') return uuid();
    if (fn === 'LEN' || fn === 'COUNT' || fn === 'SUM' || fn === 'AVG') return 1;
    if (fn === 'CONCAT') {
      const parts = (node.args || []).map((a) => walkSample(a, ctx, depth + 1)).filter((x) => x != null);
      return parts.map(String).join('');
    }
    if (/ENC|HASH|SM4/.test(fn)) return '<encrypted>';
    return '示例值';
  }
  if (node.k === 'bin' || node.k === 'cmp' || node.k === 'and' || node.k === 'or' || node.k === 'un') return 'computed';
  if (node.k === 'ident') return '示例值';
  return null;
}
function walkRow(base, path) {
  let cur = base;
  for (const p of path || []) {
    if (cur == null) return '示例值';
    if (typeof p === 'number' && Array.isArray(cur)) cur = cur[p] == null ? '示例值' : cur[p];
    else cur = cur[p] == null ? '示例值' : cur[p];
  }
  return cur;
}

function collectScript(text, iface) {
  let parsed;
  try { parsed = parseScript(text); } catch (e) { parsed = { ast: [] }; }
  const ctx = { iface, queries: {}, tokens: {}, scalars: {}, success: [], errors: [] };
  walk(parsed.ast, (n) => {
    if (n.k === 'let') {
      if (n.from === 'query' || n.from === 'exec') {
        const shape = queryShape(n.sql || '', iface);
        ctx.queries[n.name] = shape;
      } else if (n.from === 'token') {
        ctx.tokens[n.name] = true;
      } else {
        ctx.scalars[n.name] = walkSample(n.expr, ctx, 0);
      }
    } else if (n.k === 'sql') {
      // 裸 QUERY/EXEC 不产生变量，只用于识别表。
    } else if (n.k === 'return') {
      if (n.status >= 400) ctx.errors.push(n);
      else ctx.success.push(n);
    }
  });
  return { parsed, ctx };
}

function objectValue(node, key) {
  if (!node || node.k !== 'object') return null;
  const hit = (node.entries || []).find((e) => String(e.key) === key);
  return hit ? hit.value : null;
}

function errorsFrom(ctx) {
  const out = [];
  const seen = new Set();
  for (const n of ctx.errors) {
    const codeNode = objectValue(n.expr, 'error');
    const code = codeNode && codeNode.k === 'lit' ? String(codeNode.v) : '';
    const messageNode = objectValue(n.expr, 'message');
    const message = messageNode && messageNode.k === 'lit' ? String(messageNode.v) : explainError(code);
    const key = `${n.status}|${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ status: n.status, code: code || 'ERROR', message });
  }
  return out;
}
function explainError(code) {
  const map = {
    EMPTY_KEYWORD: '关键词不能为空',
    NOT_FOUND: '资源不存在',
    EXISTS: '资源已存在',
    USER_EXISTS: '用户名已存在',
    UNAUTHORIZED: '未登录或 token 无效',
    FORBIDDEN: '没有权限',
    BAD_CREDENTIAL: '账号或密码错误',
    INVALID_PARAM: '参数不合法',
    PARAM_MISSING: '缺少必填参数',
    FILE_TYPE_NOT_ALLOWED: '文件类型不允许',
    FILE_TOO_LARGE: '文件超过大小限制',
    RATE_LIMITED: '请求过于频繁',
  };
  return map[code] || (code ? '业务错误' : '请求失败');
}

function collectPlaceholders(text) {
  const out = [];
  const re = /\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return Array.from(new Set(out));
}

function paramsFrom(iface, route) {
  const places = collectPlaceholders(route.script || '');
  const params = [];
  const add = (inType, name, required, field) => {
    if (!name || params.some((p) => p.in === inType && p.name === name)) return;
    params.push({
      in: inType, name, required,
      schema: field ? schemaOf(field) : { type: 'string' },
      description: (field && field.comment) || descOfName(name),
      example: sampleForName(name, field),
    });
  };
  for (const t of places) {
    if (/^body\./.test(t)) {
      const leaf = t.slice(5);
      const hit = findField(iface, leaf);
      add('body', leaf, true, hit && hit.field);
    } else if (/^query\./.test(t)) {
      const leaf = t.slice(6);
      const hit = findField(iface, leaf);
      add('query', leaf, /^(q|keyword|id|onlyId)$/i.test(leaf), hit && hit.field);
    } else if (/^path\./.test(t)) {
      const leaf = t.slice(5);
      const hit = findField(iface, leaf);
      add('path', leaf, true, hit && hit.field);
    } else if (/^file\./.test(t)) {
      add('body', 'file', true, null);
    } else if (/^id$/.test(t)) {
      add('path', 'id', true, null);
    }
  }
  // 路径里的 :id 即使用 {{id}} 也要能出现在文档里。
  const pathParams = String(route.path || '').split('/').filter((x) => x.startsWith(':')).map((x) => x.slice(1));
  pathParams.forEach((p) => {
    const hit = findField(iface, p);
    add('path', p, true, hit && hit.field);
  });
  // 查询词被 LEN($kw)==0 判空时视为必填。
  for (const p of params.filter((x) => x.in === 'query')) {
    if (new RegExp(`LEN\\(\\$${p.name}\\b`, 'i').test(route.script || '')) p.required = true;
  }
  return params;
}

function schemaOf(field) {
  const t = typeOf(field);
  if (/^(bigint|int|smallint|tinyint)$/.test(t)) return { type: 'integer' };
  if (/^(decimal|float|double)$/.test(t)) return { type: 'number' };
  if (t === 'bool') return { type: 'boolean' };
  if (t === 'json') return { type: 'object' };
  return { type: 'string' };
}
function descOfName(name) {
  const n = String(name || '').toLowerCase();
  if (/password|passwd/.test(n)) return '密码';
  if (/username|login/.test(n)) return '登录名';
  if (/nickname/.test(n)) return '昵称';
  if (/phone|mobile/.test(n)) return '手机号';
  if (/email/.test(n)) return '邮箱';
  if (/avatar|image|photo|cover/.test(n)) return '图片 URL';
  if (/only_?id/.test(n)) return '用户唯一标识';
  if (/group_?id/.test(n)) return '群唯一标识';
  if (/moment_?id/.test(n)) return '动态唯一标识';
  if (/msg_?id/.test(n)) return '消息唯一标识';
  if (/keyword|search|\bq\b/.test(n)) return '搜索关键词';
  if (/^page$/.test(n)) return '页码，从 1 开始';
  if (/^size$/.test(n)) return '每页条数';
  if (/^sort$/.test(n)) return '排序字段';
  if (/^id$/.test(n)) return '主键 ID';
  if (/role/.test(n)) return '角色';
  if (/status/.test(n)) return '状态';
  return '参数';
}

function buildRequest(iface, route, params) {
  const base = `/api${iface.basePath || ''}${route.path || ''}`;
  let url = base.replace(/:([A-Za-z0-9_]+)/g, (m, name) => {
    const p = params.find((x) => x.in === 'path' && x.name === name);
    return encodeURIComponent(String(p ? p.example : '1'));
    });
  const qs = params.filter((x) => x.in === 'query').map((x) => `${encodeURIComponent(x.name)}=${encodeURIComponent(String(x.example))}`).join('&');
  if (qs) url += `?${qs}`;
  const lines = [`${route.method} ${url}`];
  if (route.auth) lines.push('Authorization: Bearer <token>');
  const file = params.some((x) => x.name === 'file');
  const body = {};
  for (const p of params.filter((x) => x.in === 'body' && x.name !== 'file')) body[p.name] = p.example;
  if (file) {
    lines.push('Content-Type: multipart/form-data');
    if (Object.keys(body).length) lines.push('', JSON.stringify(body, null, 2));
    lines.push('file: (binary)');
  } else if (Object.keys(body).length) {
    lines.push('Content-Type: application/json');
    lines.push('', JSON.stringify(body, null, 2));
  }
  return lines.join('\n');
}

function buildResponse(iface, route, successReturn, ctx) {
  if (route.proxy && route.proxy.enabled) return '代理上游响应（透传状态码与响应体）';
  if (route.io && route.io.response === 'file') return '(二进制文件流)';
  const n = successReturn;
  if (!n) {
    if (route.method === 'DELETE') return '{"ok":true}';
    return '{"ok":true}';
  }
  if (!n.expr) return `HTTP ${n.status}（无响应体）`;
  const sample = walkSample(n.expr, ctx, 0);
  return JSON.stringify(sample, null, 2);
}

function templateTables(iface, script) {
  const names = [];
  const re = /\{\{t:([^}]+)\}\}/g;
  let m;
  while ((m = re.exec(script))) {
    const t = findTable(iface, m[1].trim());
    if (t && !names.includes(t.name)) names.push(t.name);
  }
  return names;
}

function inferRouteDocs(iface, route) {
  const script = String((route && route.script) || '');
  const { ctx } = collectScript(script, iface);
  const params = paramsFrom(iface, route);
  const errors = errorsFrom(ctx);
  if (route.auth && !errors.some((e) => e.status === 401)) {
    errors.unshift({ status: 401, code: 'UNAUTHORIZED', message: '未登录或 token 无效' });
  }
  const summary = (route.docs && route.docs.summary) || route.summary || route.name || `${route.method} ${route.path}`;
  const tables = templateTables(iface, script);
  const success = ctx.success.find((n) => n.status >= 200 && n.status < 300) || ctx.success[0] || null;
  const descriptionParts = [];
  descriptionParts.push(`${route.method} ${route.path}：${summary}`);
  descriptionParts.push(route.auth ? `鉴权：需要登录${(route.roles || []).length ? `，角色 ${route.roles.join('/')}` : ''}` : '鉴权：公开接口');
  if (route.io && route.io.response === 'cookie') descriptionParts.push(`会话：签发 ${route.io.cookieName || 'icb_token'}，存储 ${route.io.storage || 'redis'}`);
  if (route.io && route.io.response === 'file') descriptionParts.push(`文件：大小上限 ${route.io.maxMb || 10} MB，对象键写回 ${route.io.tableKey || '主表'}.${route.io.field || 'file_key'}`);
  if (route.guard && route.guard.tx) descriptionParts.push('事务：写入失败整体回滚');
  if (route.cache && route.cache.enabled) descriptionParts.push(`缓存：Redis 旁路，TTL ${route.cache.ttl || 60}s`);
  if (tables.length) descriptionParts.push(`涉及表：${tables.join('、')}`);
  if (params.length) {
    descriptionParts.push('参数：');
    for (const p of params) descriptionParts.push(`- ${p.in}.${p.name}（${p.schema.type}，${p.required ? '必填' : '可选'}）：${p.description}`);
  }
  if (errors.length) {
    descriptionParts.push('错误码：');
    for (const e of errors) descriptionParts.push(`- ${e.status} ${e.code}：${e.message}`);
  }
  const requestExample = buildRequest(iface, route, params);
  const responseExample = buildResponse(iface, route, success, ctx);
  const fingerprint = crypto.createHash('sha1')
    .update(JSON.stringify({ script, method: route.method, path: route.path, auth: route.auth, io: route.io, roles: route.roles }))
    .digest('hex').slice(0, 16);
  return {
    summary,
    description: descriptionParts.join('\n'),
    requestExample,
    responseExample,
    parameters: params,
    errors,
    tables,
    fingerprint,
  };
}

// 在 normalize 时填充空文档；脚本变化后只覆盖曾经由检查器自动生成的字段。
function applyRouteDocs(iface, route) {
  const facts = inferRouteDocs(iface, route);
  const prev = route.docsAuto && typeof route.docsAuto === 'object' ? route.docsAuto : { fields: [], fingerprint: '' };
  const auto = new Set(Array.isArray(prev.fields) ? prev.fields : []);
  if (prev.fingerprint && prev.fingerprint !== facts.fingerprint) {
    for (const f of FIELDS) if (auto.has(f)) route.docs[f] = facts[f];
  }
  for (const f of FIELDS) {
    if (!route.docs[f]) {
      route.docs[f] = facts[f];
      auto.add(f);
    }
  }
  route.docsAuto = { fingerprint: facts.fingerprint, fields: FIELDS.filter((f) => auto.has(f)) };
  if (auto.has('summary') && route.docs.summary) route.summary = route.docs.summary;
  return facts;
}

function mergeRouteDocs(iface, route) {
  const facts = inferRouteDocs(iface, route);
  const docs = {};
  for (const f of FIELDS) docs[f] = (route.docs && route.docs[f]) || facts[f];
  docs.summary = docs.summary || facts.summary;
  return { ...facts, ...docs };
}

module.exports = { inferRouteDocs, applyRouteDocs, mergeRouteDocs };
