// 作者：yxpil
'use strict';

// 一个接口可以挂多张表、多个库；每条路由是一段可自定义脚本（见 script.js）。
// 这里只管数据模型、默认脚本、DDL 和校验。

const crypto = require('crypto');
const script = require('./script');
const docs = require('./docs');

// 工作任务的三种形态：只写前端、只写后端、前后端一起（默认）。
const TASK_TYPES = ['frontend', 'backend', 'mixed', 'database'];

const TYPES = [
  { key: 'bigint', sql: 'BIGINT', label: 'BIGINT 长整', input: 'int', group: 'number' },
  { key: 'int', sql: 'INT', label: 'INT 整型', input: 'int', group: 'number' },
  { key: 'smallint', sql: 'SMALLINT', label: 'SMALLINT 短整', input: 'int', group: 'number' },
  { key: 'tinyint', sql: 'TINYINT', label: 'TINYINT 微整', input: 'int', group: 'number' },
  { key: 'bool', sql: 'TINYINT(1)', label: 'BOOL 布尔', input: 'bool', group: 'number' },
  { key: 'decimal', sql: 'DECIMAL(18,2)', label: 'DECIMAL 金额', input: 'number', group: 'number' },
  { key: 'float', sql: 'FLOAT', label: 'FLOAT 单精度', input: 'number', group: 'number' },
  { key: 'double', sql: 'DOUBLE', label: 'DOUBLE 双精度', input: 'number', group: 'number' },
  { key: 'varchar', sql: 'VARCHAR(255)', label: 'VARCHAR 短文本', input: 'text', group: 'text' },
  { key: 'char', sql: 'CHAR(32)', label: 'CHAR 定长', input: 'text', group: 'text' },
  { key: 'text', sql: 'TEXT', label: 'TEXT 长文本', input: 'textarea', group: 'text' },
  { key: 'longtext', sql: 'LONGTEXT', label: 'LONGTEXT 超长文本', input: 'textarea', group: 'text' },
  { key: 'datetime', sql: 'DATETIME', label: 'DATETIME 时间', input: 'datetime', group: 'time' },
  { key: 'date', sql: 'DATE', label: 'DATE 日期', input: 'date', group: 'time' },
  { key: 'json', sql: 'JSON', label: 'JSON 结构', input: 'json', group: 'text' },
  // 语义类型：SQL 里仍是可索引的文本键，编辑器知道它是什么，文档和表单可以给出正确示例与约束。
  { key: 'token', sql: 'VARCHAR(1024)', label: 'TOKEN 令牌', input: 'password', group: 'semantic', semantic: 'token', secret: true, hint: 'JWT / API token；默认隐藏且不参与查询' },
  { key: 'url', sql: 'VARCHAR(1024)', label: 'URL 链接', input: 'url', group: 'semantic', semantic: 'url', hint: '完整 URL，文档示例按链接生成' },
  { key: 'file', sql: 'VARCHAR(512)', label: 'FILE 文件键', input: 'file', group: 'file', semantic: 'file', accept: '*/*', hint: 'S3 objectKey，不把文件本体塞进数据库' },
  { key: 'image', sql: 'VARCHAR(512)', label: 'IMAGE 图片键', input: 'file', group: 'file', semantic: 'image', accept: 'image/*', hint: '图片对象键或 URL' },
  { key: 'video', sql: 'VARCHAR(512)', label: 'VIDEO 视频键', input: 'file', group: 'file', semantic: 'video', accept: 'video/*', hint: '视频对象键或 URL' },
  { key: 'audio', sql: 'VARCHAR(512)', label: 'AUDIO 音频键', input: 'file', group: 'file', semantic: 'audio', accept: 'audio/*', hint: '音频对象键或 URL' },
  { key: 'pdf', sql: 'VARCHAR(512)', label: 'PDF PDF 键', input: 'file', group: 'file', semantic: 'pdf', accept: '.pdf,application/pdf', hint: 'PDF 对象键或 URL' },
  { key: 'doc', sql: 'VARCHAR(512)', label: 'DOC 文档键', input: 'file', group: 'file', semantic: 'doc', accept: '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document', hint: 'Word 文档对象键或 URL' },
  { key: 'excel', sql: 'VARCHAR(512)', label: 'EXCEL 表格键', input: 'file', group: 'file', semantic: 'excel', accept: '.xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', hint: 'Excel / CSV 对象键或 URL' },
  { key: 'archive', sql: 'VARCHAR(512)', label: 'ARCHIVE 压缩包键', input: 'file', group: 'file', semantic: 'archive', accept: '.zip,.rar,.7z,.tar,.gz,.bz2', hint: '压缩包对象键或 URL' },
];

const TYPE_KEYS = TYPES.map((t) => t.key);

function defaultConnections() {
  return {
    mysql: [{ key: 'main', label: '本机 MariaDB', host: '127.0.0.1', port: 13306, user: 'root', password: '', database: 'clickbuild' }],
    redis: [{ key: 'main', label: '本机 Redis', host: '127.0.0.1', port: 16379, db: 0 }],
    s3: [{ key: 'main', label: '本机 RustFS', endpoint: '127.0.0.1', port: 19000, accessKey: 'clickbuild', secretKey: 'clickbuild123', bucket: 'clickbuild' }],
  };
}

function defaultGuard() {
  return {
    tx: false,
    rate: { enabled: false, limit: 60, window: 60 },
    schedule: { enabled: false, from: '', to: '' },
    breaker: { enabled: false, threshold: 5, cooldown: 30 },
  };
}

const ROUTE_KINDS = ['list', 'detail', 'create', 'update', 'delete', 'upload', 'login', 'register', 'me', 'logout', 'search', 'health', 'redirect', 'proxy', 'objects', 'crawl', 'custom'];
const IO_RESPONSES = ['json', 'cookie', 'file', 'object', 'proxy', 'crawl'];
const IO_STORES = ['none', 'mysql', 'redis', 'memory', 's3'];
const FILE_KINDS = ['any', 'image', 'video', 'audio', 'document', 'pdf', 'archive'];
const COOKIE_SAME_SITE = ['Lax', 'Strict', 'None'];

function defaultIoTypes() {
  return [
    { id: 'json', name: '普通 JSON', response: 'json', storage: 'none', fileKind: 'any', maxMb: 20, tableKey: 'main', field: '', autoBind: false, cookieName: '', ttl: 0, prefix: '', note: '查表/写入后直接返回 JSON' },
    { id: 'cookie', name: 'Cookie 会话', response: 'cookie', storage: 'redis', fileKind: 'any', maxMb: 0, tableKey: 'main', field: '', autoBind: false, cookieName: 'icb_token', ttl: 7200, prefix: 'icb:token:', note: '脚本 TOKEN NEW 签发，会话写 Redis，响应自动 Set-Cookie' },
    { id: 'file', name: '文件上传', response: 'file', storage: 's3', fileKind: 'any', maxMb: 20, tableKey: 'main', field: 'file_key', autoBind: true, cookieName: '', ttl: 0, prefix: '', note: 'multipart 文件进 S3，SQL 只存 objectKey' },
    { id: 'image', name: '图片上传', response: 'file', storage: 's3', fileKind: 'image', maxMb: 8, tableKey: 'main', field: 'file_key', autoBind: true, cookieName: '', ttl: 0, prefix: '', note: '只收图片，进 S3，SQL 存对象键' },
    { id: 'object', name: '对象列表', response: 'object', storage: 's3', fileKind: 'any', maxMb: 0, tableKey: 'main', field: '', autoBind: false, cookieName: '', ttl: 0, prefix: '', note: '直接列桶内对象，不走 SQL' },
    { id: 'proxy', name: '上游代理', response: 'proxy', storage: 'none', fileKind: 'any', maxMb: 0, tableKey: 'main', field: '', autoBind: false, cookieName: '', ttl: 0, prefix: '', note: '透传到“上游”页配置的服务' },
    { id: 'crawl', name: '网页抓取', response: 'crawl', storage: 'none', fileKind: 'any', maxMb: 0, tableKey: 'main', field: '', autoBind: false, cookieName: '', ttl: 0, prefix: '', note: '抓网页后在脚本里加工' },
    { id: 'cache', name: 'Redis 缓存结果', response: 'json', storage: 'redis', fileKind: 'any', maxMb: 0, tableKey: 'main', field: '', autoBind: false, cookieName: '', ttl: 60, prefix: 'icb:', note: '查询结果写 Redis，键按路由模板生成' },
  ];
}

function normalizeIoTypes(list) {
  const defaults = defaultIoTypes();
  const given = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  const push = (raw, i) => {
    const base = defaults.find((x) => x.id === String(raw && raw.id)) || defaults[0];
    const id = safeIdent((raw && raw.id) || base.id || `type_${i + 1}`, 'type');
    if (seen.has(id)) return;
    seen.add(id);
    const pick = (key, allowed, def) => (allowed.includes(raw && raw[key]) ? raw[key] : def);
    out.push({
      id,
      name: String((raw && raw.name) || base.name || id),
      response: pick('response', IO_RESPONSES, base.response),
      storage: pick('storage', IO_STORES, base.storage),
      fileKind: pick('fileKind', FILE_KINDS, base.fileKind),
      maxMb: Math.max(0, Number((raw && raw.maxMb != null ? raw.maxMb : base.maxMb) || 0)),
      tableKey: String((raw && raw.tableKey) || base.tableKey || 'main'),
      field: String((raw && raw.field != null ? raw.field : (base.field || ''))),
      autoBind: raw && raw.autoBind != null ? !!raw.autoBind : !!base.autoBind,
      cookieName: String((raw && raw.cookieName) || base.cookieName || ''),
      ttl: Math.max(0, Number((raw && raw.ttl != null ? raw.ttl : base.ttl) || 0)),
      prefix: String((raw && raw.prefix) || base.prefix || ''),
      note: String((raw && raw.note) || base.note || ''),
    });
  };
  given.forEach(push);
  defaults.forEach((d, i) => { if (!seen.has(d.id)) push(d, i); });
  return out;
}

function ioFromKind(kind, scriptText) {
  const base = defaultIoTypes();
  if (kind === 'upload') return base.find((x) => x.id === 'file');
  if (kind === 'objects') return base.find((x) => x.id === 'object');
  if (kind === 'proxy') return base.find((x) => x.id === 'proxy');
  if (kind === 'crawl') return base.find((x) => x.id === 'crawl');
  if (/TOKEN\s+NEW/i.test(String(scriptText || ''))) return base.find((x) => x.id === 'cookie');
  return base.find((x) => x.id === 'json');
}

function ioOf(route) {
  const kind = ROUTE_KINDS.includes(route && route.key) ? route.key : 'custom';
  const fallback = ioFromKind(kind, route && route.script);
  const raw = (route && route.io) || {};
  const pick = (key, allowed, def) => (allowed.includes(raw[key]) ? raw[key] : def);
  return {
    typeId: String(raw.typeId || fallback.id),
    response: pick('response', IO_RESPONSES, fallback.response),
    storage: pick('storage', IO_STORES, fallback.storage),
    fileKind: pick('fileKind', FILE_KINDS, fallback.fileKind),
    maxMb: Math.max(0, Number(raw.maxMb != null ? raw.maxMb : fallback.maxMb) || 0),
    tableKey: String(raw.tableKey || fallback.tableKey || 'main'),
    field: String(raw.field != null ? raw.field : (fallback.field || '')),
    autoBind: raw.autoBind != null ? !!raw.autoBind : !!fallback.autoBind,
    cookieName: String(raw.cookieName || fallback.cookieName || ''),
    ttl: Math.max(0, Number(raw.ttl != null ? raw.ttl : fallback.ttl) || 0),
    cookiePath: String(raw.cookiePath || '/'),
    httpOnly: raw.httpOnly !== false,
    sameSite: COOKIE_SAME_SITE.includes(raw.sameSite) ? raw.sameSite : 'Lax',
    prefix: String(raw.prefix || fallback.prefix || ''),
    bucket: String(raw.bucket || ''),
  };
}

const ROUTE_META = {
  list: { name: '列表', method: 'GET', path: '/:table' },
  detail: { name: '详情', method: 'GET', path: '/:table/:id' },
  create: { name: '新建', method: 'POST', path: '/:table' },
  update: { name: '更新', method: 'PUT', path: '/:table/:id' },
  delete: { name: '删除', method: 'DELETE', path: '/:table/:id' },
  upload: { name: '附件', method: 'POST', path: '/:table/:id/file' },
  login: { name: '登录', method: 'POST', path: '/auth/login' },
  register: { name: '注册', method: 'POST', path: '/auth/register' },
  me: { name: '当前用户', method: 'GET', path: '/auth/me' },
  logout: { name: '退出登录', method: 'POST', path: '/auth/logout' },
  search: { name: '搜索', method: 'GET', path: '/:table/search' },
  health: { name: '健康检查', method: 'GET', path: '/:table/health' },
  redirect: { name: '跳转', method: 'GET', path: '/go/:slug' },
  proxy: { name: '上游转发', method: 'POST', path: '/proxy' },
  objects: { name: '对象表', method: 'GET', path: '/objects' },
  crawl: { name: '抓取', method: 'GET', path: '/crawl' },
  custom: { name: '自定义', method: 'POST', path: '/custom' },
};

const ROUTE_TEMPLATES = {
  list: [
    'LET $rows = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} ORDER BY {{orderBy:main}} LIMIT {{limit}} OFFSET {{offset}};',
    'LET $total = QUERY SELECT COUNT(*) AS total FROM {{t:main}} WHERE {{where:main}};',
    'RETURN 200 { "rows": $rows.rows, "total": $total.rows[0].total };',
  ].join('\n'),
  detail: [
    'LET $row = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{idColumn:main}} = {{id}} LIMIT 1;',
    'IF LEN($row.rows) == 0',
    '  RETURN 404 { "ok": false, "error": "NOT_FOUND" };',
    'END',
    'RETURN 200 { "row": $row.rows[0] };',
  ].join('\n'),
  create: [
    'LET $ins = EXEC INSERT INTO {{t:main}} ({{insertColumns:main}}) VALUES ({{insertValues:main}});',
    'RETURN 201 { "id": $ins.insertId };',
  ].join('\n'),
  update: [
    'LET $hit = QUERY SELECT COUNT(*) AS n FROM {{t:main}} WHERE {{idColumn:main}} = {{id}} LIMIT 1;',
    'IF $hit.rows[0].n == 0',
    '  RETURN 404 { "ok": false, "error": "NOT_FOUND" };',
    'END',
    'LET $upd = EXEC UPDATE {{t:main}} SET {{updateSet:main}} WHERE {{idColumn:main}} = {{id}};',
    'RETURN 200 { "changed": $upd.affectedRows };',
  ].join('\n'),
  delete: [
    'LET $hit = QUERY SELECT COUNT(*) AS n FROM {{t:main}} WHERE {{idColumn:main}} = {{id}} LIMIT 1;',
    'IF $hit.rows[0].n == 0',
    '  RETURN 404 { "ok": false, "error": "NOT_FOUND" };',
    'END',
    'LET $del = EXEC DELETE FROM {{t:main}} WHERE {{idColumn:main}} = {{id}};',
    'RETURN 200 { "deleted": $del.affectedRows };',
  ].join('\n'),
  upload: [
    '# 文件已经由服务器写进对象存储，这里只做入库；{{objectKey}} {{objectUrl}} {{filename}} {{size}} 都是现成的',
    'LET $hit = QUERY SELECT COUNT(*) AS n FROM {{t:main}} WHERE {{idColumn:main}} = {{id}} LIMIT 1;',
    'IF $hit.rows[0].n == 0',
    '  RETURN 404 { "ok": false, "error": "NOT_FOUND" };',
    'END',
    'EXEC UPDATE {{t:main}} SET {{bindColumn:main}} = {{objectKey}} WHERE {{idColumn:main}} = {{id}};',
    'RETURN 200 { "key": {{objectKey}}, "url": {{objectUrl}}, "name": {{filename}} };',
  ].join('\n'),
  login: [
    '# 登录：表里需要有 username / password_hash / nickname 字段；密码用 SM4 存储',
    'LET $u = QUERY SELECT id, password_hash, nickname FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
    'IF LEN($u.rows) == 0',
    '  RETURN 401 { "ok": false, "error": "INVALID_CREDENTIALS", "message": "用户名或密码错误" };',
    'END',
    "IF SM4_DEC($u.rows[0].password_hash, 'clickbuild-key') != {{body.password}}",
    '  RETURN 401 { "ok": false, "error": "INVALID_CREDENTIALS", "message": "用户名或密码错误" };',
    'END',
    'LET $t = TOKEN NEW { "uid": $u.rows[0].id, "username": {{body.username}}, "nickname": $u.rows[0].nickname };',
    'RETURN 200 { "ok": true, "token": $t.token, "expiresIn": $t.ttl, "user": { "id": $u.rows[0].id, "nickname": $u.rows[0].nickname } };',
  ].join('\n'),
  register: [
    '# 注册：先查重，再插入，密码 SM4 加密，最后直接签发 token',
    'LET $exists = QUERY SELECT id FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
    'IF LEN($exists.rows) > 0',
    '  RETURN 409 { "ok": false, "error": "USER_EXISTS", "message": "用户名已存在" };',
    'END',
    "LET $ins = EXEC INSERT INTO {{t:main}} (username, password_hash, nickname, role, status) VALUES ({{body.username}}, SM4_ENC({{body.password}}, 'clickbuild-key'), {{body.nickname}}, {{body.role}}, 1);",
    'LET $t = TOKEN NEW { "uid": $ins.insertId, "username": {{body.username}}, "nickname": {{body.nickname}}, "role": {{body.role}} };',
    'RETURN 201 { "ok": true, "id": $ins.insertId, "token": $t.token, "expiresIn": $t.ttl };',
  ].join('\n'),
  me: [
    '# 当前用户：网关先验 token，验过就把会话放进 $user',
    'RETURN 200 { "ok": true, "user": $user, "token": {{token}} };',
  ].join('\n'),
  logout: [
    '# 退出登录：删除 Redis / 内存里的 token 会话，并清掉 Cookie',
    'TOKEN DEL {{token}};',
    'RETURN 200 { "ok": true, "message": "已退出登录" };',
  ].join('\n'),
  search: [
    '# 搜索：关键字与字段筛选都走 {{where:main}}，支持排序和分页',
    'LET $rows = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} ORDER BY {{orderBy:main}} LIMIT {{limit}} OFFSET {{offset}};',
    'RETURN 200 { "ok": true, "rows": $rows.rows, "keyword": {{query.keyword}}, "total": LEN($rows.rows) };',
  ].join('\n'),
  health: [
    '# 健康检查：轻量探活，不返回业务数据；适合网关、负载均衡和监控',
    'LET $db = QUERY SELECT 1 AS ok;',
    'RETURN 200 { "ok": true, "db": $db.rows[0].ok, "service": "clickbuild", "time": NOW() };',
  ].join('\n'),
  redirect: [
    '# 短链跳转：按路径参数 slug 查目标地址，再用 302 送出 Location',
    'LET $row = QUERY SELECT target_url FROM {{t:main}} WHERE slug = {{path.slug}} LIMIT 1;',
    'IF LEN($row.rows) == 0',
    '  RETURN 404 { "ok": false, "error": "NOT_FOUND", "message": "短链不存在" };',
    'END',
    'RETURN 302 $row.rows[0].target_url;',
  ].join('\n'),
  proxy: [
    '# 上游转发由服务器按 route.proxy 直接代理，不走这段脚本。',
    'RETURN 501 { "ok": false, "error": "PROXY_NOT_CONFIGURED", "message": "请在上游页配置 baseUrl 与转发路径" };',
  ].join('\n'),
  objects: [
    '# 对象表由服务器直接列桶内对象，不走 SQL。',
    'RETURN 501 { "ok": false, "error": "OBJECT_TABLE_NOT_CONFIGURED" };',
  ].join('\n'),
  crawl: [
    '# 抓取路由：抓取上游页面并返回标题/正文片段/链接，可在脚本里继续加工。',
    'LET $page = CRAWL \'https://example.com\' { "maxBytes": 1048576 };',
    'RETURN 200 { "url": {{query.url}}, "title": $page.title, "text": $page.text, "links": $page.links };',
  ].join('\n'),
  custom: [
    '# 自定义脚本：随便查、随便改，SQL 里用 {{body.x}} {{query.x}} {{id}} 取请求参数',
    'LET $rows = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} LIMIT {{limit}};',
    'RETURN 200 { "rows": $rows.rows };',
  ].join('\n'),
};

function newField(name, type) {
  const t = TYPE_KEYS.includes(type) ? type : 'varchar';
  const meta = TYPES.find((x) => x.key === t) || {};
  return {
    name: name || 'field',
    type: t,
    comment: '',
    pk: false,
    autoIncrement: false,
    nullable: true,
    search: !!(meta.group === 'text' && /char|text/.test(t)),
    hidden: !!meta.secret,
    query: !meta.secret,
    writable: true,
    default: '',
  };
}

function defaultFields() {
  return [
    { ...newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false, comment: '主键' },
    { ...newField('created_at', 'datetime'), nullable: true, writable: false, default: 'CURRENT_TIMESTAMP', comment: '创建时间' },
    { ...newField('updated_at', 'datetime'), nullable: true, writable: false, default: 'CURRENT_TIMESTAMP', comment: '更新时间' },
  ];
}

// 新建空白表默认无主键：只给时间戳，主键由用户按业务自己加。
function blankFields() {
  return [
    { ...newField('created_at', 'datetime'), nullable: true, writable: false, default: 'CURRENT_TIMESTAMP', comment: '创建时间' },
    { ...newField('updated_at', 'datetime'), nullable: true, writable: false, default: 'CURRENT_TIMESTAMP', comment: '更新时间' },
  ];
}

function safeIdent(name, prefix) {
  const raw = String(name == null ? '' : name).toLowerCase();
  const ascii = raw.replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (/^[a-z_][a-z0-9_]{0,47}$/.test(ascii)) return ascii;
  const hash = crypto.createHash('sha1').update(String(name || 'x')).digest('hex').slice(0, 8);
  const p = String(prefix || 't').toLowerCase().replace(/[^a-z0-9_]/g, '') || 't';
  return `${p}_${hash}`;
}

function keyOf(name, used) {
  const base = safeIdent(name, 'table').slice(0, 24) || 'table';
  let key = base;
  let n = 2;
  while (used.has(key)) { key = `${base.slice(0, 20)}_${n++}`; }
  used.add(key);
  return key;
}

const STORE_MODES = ['mysql', 'cache', 'redis', 'redis-mysql', 'lru', 'lru-redis', 'periodic'];

function storeOf(t) {
  const s = (t && t.store) || {};
  return {
    mode: STORE_MODES.includes(s.mode) ? s.mode : 'mysql',
    ttl: Number(s.ttl || 0),
    max: Number(s.max || 10000),
    flushMs: Number(s.flushMs || 5000),
  };
}

function newTable(name, usedKeys) {
  const safe = safeIdent(name, 'tbl');
  return {
    key: keyOf(safe, usedKeys || new Set()),
    name: safe,
    schema: '',
    comment: '',
    store: storeOf(null),
    fields: blankFields(),
  };
}

function newRoute(kind, iface, index) {
  const kindKey = ROUTE_KINDS.includes(kind) ? kind : 'custom';
  const main = iface && iface.tables && iface.tables[0];
  const tableName = main ? main.name : 'table';
  let path = ROUTE_META[kindKey].path.replace(':table', tableName);
  if (kindKey === 'custom') path = `/custom-${(index || 0) + 1}`;
  return {
    id: crypto.randomUUID().slice(0, 8),
    key: kindKey,
    name: ROUTE_META[kindKey].name,
    method: ROUTE_META[kindKey].method,
    path,
    auth: kindKey === 'me' || kindKey === 'logout',
    summary: '',
    guard: { ...defaultGuard(), tx: ['create', 'update', 'delete', 'register'].includes(kindKey) },
    script: ROUTE_TEMPLATES[kindKey],
    cache: { enabled: kindKey === 'list' || kindKey === 'detail', key: 'icb:{{t:main}}:{{queryHash}}:{{page}}:{{pageSize}}', ttl: 60 },
  };
}

const IFACE_SCENARIOS = {
  blank: { label: '空接口', table: '', comment: '', routes: null, fields: null },
  auth: {
    label: '登录注册',
    table: 'sys_user',
    comment: '用户名密码登录、注册即签发 token',
    routes: ['login', 'register', 'detail', 'list'],
    fields: [
      { name: 'username', type: 'varchar', comment: '登录名' },
      { name: 'password_hash', type: 'varchar', comment: '密码（SM4）' },
      { name: 'nickname', type: 'varchar', comment: '昵称' },
      { name: 'role', type: 'varchar', comment: '角色 admin/user' },
      { name: 'status', type: 'tinyint', comment: '1 启用 0 禁用' },
    ],
  },
  rbac: {
    label: '账号权限',
    table: 'sys_account',
    comment: '登录注册、当前用户、退出登录与角色权限；首个注册账号自动成为管理员',
    routes: ['login', 'register', 'me', 'logout', 'list', 'detail', 'search'],
    authMode: 'all',
    fields: [
      { name: 'username', type: 'varchar', comment: '登录名' },
      { name: 'password_hash', type: 'varchar', comment: '密码（SM4）' },
      { name: 'nickname', type: 'varchar', comment: '昵称' },
      { name: 'role', type: 'varchar', comment: '角色 admin/user' },
      { name: 'status', type: 'tinyint', comment: '1 启用 0 禁用' },
    ],
    // 用户管理只给管理员；登录、注册公开；当前用户与退出需要 token。
    routeRoles: { list: ['admin'], detail: ['admin'], search: ['admin'] },
    scripts: {
      login: [
        '# 登录：校验状态与 SM4 密码，签发带角色的 token（Redis 会话）',
        'LET $u = QUERY SELECT id, password_hash, nickname, role, status FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
        'IF LEN($u.rows) == 0',
        '  RETURN 401 { "ok": false, "error": "INVALID_CREDENTIALS", "message": "用户名或密码错误" };',
        'END',
        'IF $u.rows[0].status != 1',
        '  RETURN 403 { "ok": false, "error": "ACCOUNT_DISABLED", "message": "账号已停用" };',
        'END',
        "IF SM4_DEC($u.rows[0].password_hash, 'clickbuild-key') != {{body.password}}",
        '  RETURN 401 { "ok": false, "error": "INVALID_CREDENTIALS", "message": "用户名或密码错误" };',
        'END',
        'LET $t = TOKEN NEW { "uid": $u.rows[0].id, "username": {{body.username}}, "nickname": $u.rows[0].nickname, "role": $u.rows[0].role };',
        'RETURN 200 { "ok": true, "token": $t.token, "expiresIn": $t.ttl, "user": { "id": $u.rows[0].id, "nickname": $u.rows[0].nickname, "role": $u.rows[0].role } };',
      ].join('\n'),
      register: [
        '# 注册：首个账号自动成为 admin，后续注册为 user；密码 SM4 加密并直接登录',
        'LET $exists = QUERY SELECT id FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
        'IF LEN($exists.rows) > 0',
        '  RETURN 409 { "ok": false, "error": "USER_EXISTS", "message": "用户名已存在" };',
        'END',
        'LET $count = QUERY SELECT COUNT(*) AS n FROM {{t:main}};',
        'IF $count.rows[0].n == 0',
        '  LET $role = "admin";',
        'ELSE',
        '  LET $role = "user";',
        'END',
        "LET $ins = EXEC INSERT INTO {{t:main}} (username, password_hash, nickname, role, status) VALUES ({{body.username}}, SM4_ENC({{body.password}}, 'clickbuild-key'), {{body.nickname}}, $role, 1);",
        'LET $t = TOKEN NEW { "uid": $ins.insertId, "username": {{body.username}}, "nickname": {{body.nickname}}, "role": $role };',
        'RETURN 201 { "ok": true, "id": $ins.insertId, "token": $t.token, "expiresIn": $t.ttl, "role": $role };',
      ].join('\n'),
    },
  },
  search: {
    label: '信息搜索',
    table: 'search_record',
    comment: '关键词、字段筛选、排序、分页',
    routes: ['search', 'list', 'detail', 'create', 'delete'],
    fields: [
      { name: 'title', type: 'varchar', comment: '标题' },
      { name: 'category', type: 'varchar', comment: '分类' },
      { name: 'content', type: 'text', comment: '正文' },
      { name: 'status', type: 'tinyint', comment: '0 草稿 1 发布' },
    ],
  },
  cms: {
    label: '内容管理',
    table: 'cms_article',
    comment: '文章增删改查与搜索',
    routes: ['list', 'detail', 'create', 'update', 'delete', 'search', 'upload'],
    fields: [
      { name: 'title', type: 'varchar', comment: '标题' },
      { name: 'slug', type: 'varchar', comment: 'URL 别名' },
      { name: 'summary', type: 'varchar', comment: '摘要' },
      { name: 'content', type: 'text', comment: '正文' },
      { name: 'status', type: 'tinyint', comment: '0 草稿 1 发布' },
    ],
  },
  shop: {
    label: '商品目录',
    table: 'shop_product',
    comment: '商品、库存、价格与图片',
    routes: ['list', 'detail', 'create', 'update', 'delete', 'search', 'upload'],
    fields: [
      { name: 'name', type: 'varchar', comment: '商品名' },
      { name: 'sku', type: 'varchar', comment: 'SKU' },
      { name: 'price', type: 'decimal', comment: '售价' },
      { name: 'stock', type: 'int', comment: '库存' },
      { name: 'status', type: 'tinyint', comment: '1 上架 0 下架' },
    ],
  },
  form: {
    label: '表单收集',
    table: 'form_submission',
    comment: '报名、问卷、留言统一收集',
    routes: ['create', 'list', 'detail', 'delete'],
    fields: [
      { name: 'form_name', type: 'varchar', comment: '表单名' },
      { name: 'name', type: 'varchar', comment: '姓名' },
      { name: 'phone', type: 'varchar', comment: '电话' },
      { name: 'email', type: 'varchar', comment: '邮箱' },
      { name: 'content', type: 'text', comment: '留言' },
    ],
  },
  shortlink: {
    label: '短链跳转',
    table: 'short_link',
    comment: 'slug 查表后 302 跳到目标地址',
    routes: ['redirect', 'list', 'create', 'detail', 'update', 'delete'],
    fields: [
      { name: 'slug', type: 'varchar', comment: '短码' },
      { name: 'target_url', type: 'varchar', comment: '目标地址' },
      { name: 'hits', type: 'int', comment: '访问次数' },
      { name: 'status', type: 'tinyint', comment: '1 启用 0 停用' },
    ],
  },
  health: {
    label: '健康检查',
    table: 'health_probe',
    comment: '探活、版本与服务状态',
    routes: ['health', 'detail', 'list'],
    fields: [
      { name: 'service', type: 'varchar', comment: '服务名' },
      { name: 'version', type: 'varchar', comment: '版本' },
      { name: 'status', type: 'tinyint', comment: '1 正常 0 异常' },
    ],
  },
};

function newIface(name, categoryId, opts) {
  const o = opts || {};
  const sc = IFACE_SCENARIOS[String(o.scenario || o.template || 'blank')] || IFACE_SCENARIOS.blank;
  const used = new Set();
  const id = crypto.randomUUID().slice(0, 8);
  const base = safeIdent(name || 'new', 'iface');
  const tableName = o.tableName ? safeIdent(o.tableName, 'tbl') : (sc.table ? safeIdent(sc.table, 'tbl') : `${base}_${id}`);
  const main = newTable(tableName, used);
  // 默认路由模板统一引用 {{t:main}} / {{columns:main}}，首张表必须叫 main。
  main.key = 'main';
  main.comment = String(o.tableComment || sc.comment || '');
  used.add('main');
  const initialFields = Array.isArray(o.fields)
    ? o.fields
    : (sc.fields || [{ name: 'name', type: 'varchar', comment: '名称' }]);
  const reserved = new Set(['id', 'created_at', 'updated_at']);
  const custom = initialFields.map((f) => {
    const key = String((f && f.name) || '').trim().toLowerCase();
    if (!/^[a-z_][a-z0-9_]{0,47}$/.test(key) || reserved.has(key)) return null;
    const type = TYPE_KEYS.includes(String(f.type || '').toLowerCase()) ? String(f.type).toLowerCase() : 'varchar';
    return {
      ...newField(key, type),
      comment: String(f.comment || ''),
      search: ['varchar', 'char', 'text'].includes(type),
      hidden: ['password', 'password_hash', 'token', 'secret'].includes(key),
      query: !['password', 'password_hash', 'token', 'secret'].includes(key),
    };
  }).filter(Boolean);
  main.fields = [...defaultFields(), ...custom];
  const allowedKinds = ['list', 'detail', 'create', 'update', 'delete', 'upload', 'login', 'register', 'me', 'logout', 'search', 'health', 'redirect'];
  const wantedKinds = Array.isArray(o.routeKinds) && o.routeKinds.length
    ? o.routeKinds.filter((k) => allowedKinds.includes(k))
    : (sc.routes || allowedKinds);
  const kinds = wantedKinds.length ? Array.from(new Set(wantedKinds)) : allowedKinds;
  const routeScripts = o.scripts || sc.scripts || {};
  const routes = kinds.map((k) => {
    const r = newRoute(k, { tables: [main] });
    if (routeScripts[k]) r.script = routeScripts[k];
    return r;
  });
  let basePath = String(o.basePath || '').trim();
  if (basePath) {
    if (!basePath.startsWith('/')) basePath = '/' + basePath;
    basePath = basePath.replace(/\/+$/, '');
  }
  const authMode = ['all', 'write'].includes(o.authMode)
    ? o.authMode
    : (['all', 'write'].includes(sc.authMode) ? sc.authMode : 'none');
  const openKinds = ['login', 'register', 'health', 'redirect'];
  const routeRoles = o.routeRoles || sc.routeRoles || {};
  routes.forEach((r) => {
    r.auth = !openKinds.includes(r.key) && (authMode === 'all' || (authMode === 'write' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(r.method)));
    const roles = Array.isArray(routeRoles[r.key]) ? routeRoles[r.key].map(String).filter(Boolean) : [];
    r.roles = roles;
    if (roles.length) r.auth = true;
  });
  return {
    id,
    name: name || '新接口',
    comment: String(o.comment || ''),
    categoryId: categoryId || 'biz',
    basePath,
    tables: [main],
    routes,
    storage: { enabled: true, bucket: 'clickbuild', bindField: 'file_key' },
    page: { size: 20 },
    docs: { summary: String(o.comment || ''), description: '', owner: '', version: '1.0.0', tags: [], requestExample: '', responseExample: '', notes: '' },
  };
}

function seedProject() {
  const order = newIface('订单', 'biz');
  order.comment = '订单主表 + 明细表，演示一个接口挂多张表';
  order.tables = [
    {
      key: 'main', name: 'biz_order', schema: '', comment: '订单主表',
      fields: [
        { ...newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false, comment: '主键' },
        { ...newField('order_no', 'varchar'), search: true, comment: '订单号' },
        { ...newField('customer', 'varchar'), search: true, comment: '客户' },
        { ...newField('amount', 'decimal'), comment: '金额' },
        { ...newField('status', 'tinyint'), comment: '状态 0 待付 1 已付 2 完成' },
        { ...newField('file_key', 'varchar'), hidden: true, comment: '附件对象键' },
        { ...newField('created_at', 'datetime'), writable: false, default: 'CURRENT_TIMESTAMP' },
      ],
    },
    {
      key: 'item', name: 'biz_order_item', schema: '', comment: '订单明细',
      fields: [
        { ...newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false },
        { ...newField('order_id', 'bigint'), comment: '订单主键' },
        { ...newField('sku', 'varchar'), search: true, comment: '商品编码' },
        { ...newField('qty', 'int'), comment: '数量' },
        { ...newField('price', 'decimal'), comment: '单价' },
      ],
    },
  ];
  order.routes = ['list', 'detail', 'create', 'update', 'delete', 'upload'].map((k) => newRoute(k, order));
  order.routes.push({
    ...newRoute('custom', order, 0),
    name: '订单+明细联查',
    method: 'GET',
    path: '/orders/with-items',
    script: [
      '# 一个接口多张表：主表 LEFT JOIN 明细，一次查出来（多库时把 {{t:item}} 换成 schema 前缀即可）',
      'LET $rows = QUERY SELECT o.id, o.order_no, o.customer, o.amount, o.status, i.sku, i.qty, i.price FROM {{t:main}} o LEFT JOIN {{t:item}} i ON i.order_id = o.id WHERE {{where:main}} ORDER BY o.id DESC LIMIT {{limit}} OFFSET {{offset}};',
      'RETURN 200 { "rows": $rows.rows };',
    ].join('\n'),
    cache: { enabled: false, key: '', ttl: 60 },
  });
  order.routes.push({
    ...newRoute('custom', order, 1),
    name: '事务演示（写入后回滚）',
    method: 'POST',
    path: '/orders/tx-demo',
    summary: '写两条再回滚，验证原子性：要么全成，要么全退',
    guard: { ...defaultGuard(), tx: true },
    script: [
      '# 演示事务：插入主表 + 明细，然后手动回滚，数据不会留下',
      'EXEC INSERT INTO {{t:main}} (order_no, customer, amount, status) VALUES ({{body.order_no}}, {{body.customer}}, {{body.amount}}, 0);',
      'EXEC INSERT INTO {{t:item}} (order_id, sku, qty, price) VALUES (LAST_INSERT_ID(), {{body.sku}}, {{body.qty}}, {{body.price}});',
      'TX ROLLBACK;',
      'RETURN 200 { "rolledBack": true, "message": "事务已回滚，脏数据不会入库" };',
    ].join('\n'),
    cache: { enabled: false, key: '', ttl: 60 },
  });
  order.routes.push({
    ...newRoute('custom', order, 2),
    name: '限流演示',
    method: 'GET',
    path: '/orders/ping',
    summary: '10 秒内最多 3 次，超出返回 429',
    guard: { ...defaultGuard(), rate: { enabled: true, limit: 3, window: 10 } },
    script: ['RETURN 200 { "ok": true, "at": {{now}} };'].join('\n'),
    cache: { enabled: false, key: '', ttl: 60 },
  });

  const user = newIface('用户注册', 'sys');
  user.comment = '注册接口：先查重、再插入、密码哈希，全程一段脚本';
  user.tables = [{
    key: 'main', name: 'sys_user', schema: '', comment: '用户表',
    fields: [
      { ...newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false },
      { ...newField('only_id', 'char'), hidden: true, comment: '唯一ID（只此一份）' },
      { ...newField('username', 'varchar'), search: true, comment: '用户名' },
      { ...newField('password_hash', 'varchar'), hidden: true, comment: '密码（SM4 加密存储，不对外暴露）' },
      { ...newField('nickname', 'varchar'), search: true, comment: '昵称' },
      { ...newField('created_at', 'datetime'), writable: false, default: 'CURRENT_TIMESTAMP' },
    ],
  }];
  user.routes = [
    {
      ...newRoute('custom', user, 0),
      name: '注册',
      method: 'POST',
      path: '/register',
      summary: '先查重、再插入，密码 SM4 加密，返回唯一ID与token',
      script: [
        '# 注册：先查重 → 插入（密码 SM4 加密、生成唯一ID）→ 颁发 token',
        'LET $exists = QUERY SELECT id FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
        'IF LEN($exists.rows) > 0',
        '  RETURN 409 { "ok": false, "error": "USER_EXISTS" };',
        'END',
        'EXEC INSERT INTO {{t:main}} (only_id, username, password_hash, nickname) VALUES ({{onlyId}}, {{body.username}}, SM4_ENC({{body.password}}, \'clickbuild-key\'), {{body.nickname}});',
        'LET $t = TOKEN NEW { "onlyId": {{onlyId}}, "username": {{body.username}}, "nickname": {{body.nickname}} };',
        'RETURN 201 { "ok": true, "onlyId": {{onlyId}}, "token": $t.token, "expiresIn": $t.ttl };',
      ].join('\n'),
      cache: { enabled: false, key: '', ttl: 60 },
    },
    {
      ...newRoute('custom', user, 1),
      name: '登录',
      method: 'POST',
      path: '/login',
      summary: '校验 SM4 密码，签发 token（Redis 会话）',
      script: [
        'LET $u = QUERY SELECT id, only_id, nickname, password_hash FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
        'IF LEN($u.rows) == 0',
        '  RETURN 401 { "ok": false, "error": "NO_USER" };',
        'END',
        'IF SM4_DEC($u.rows[0].password_hash, \'clickbuild-key\') != {{body.password}}',
        '  RETURN 401 { "ok": false, "error": "BAD_PASSWORD" };',
        'END',
        'LET $t = TOKEN NEW { "onlyId": $u.rows[0].only_id, "username": {{body.username}}, "nickname": $u.rows[0].nickname };',
        'RETURN 200 { "ok": true, "token": $t.token, "onlyId": $u.rows[0].only_id };',
      ].join('\n'),
      cache: { enabled: false, key: '', ttl: 60 },
    },
    {
      ...newRoute('custom', user, 2),
      name: '当前用户',
      method: 'GET',
      path: '/me',
      auth: true,
      summary: '带 token 取当前用户（token 存 Redis）',
      script: [
        '# 网关先验 token，验过就把用户信息放进 $user',
        'RETURN 200 { "user": $user, "token": {{token}} };',
      ].join('\n'),
      cache: { enabled: false, key: '', ttl: 60 },
    },
    newRoute('list', user),
    newRoute('detail', user),
  ];
  user.routes[3].path = '/users';
  user.routes[4].path = '/users/:id';

  return {
    name: '接口工程',
    description: '一个接口就是一组表 + 一组脚本路由',
    taskType: 'mixed',
    categories: [
      { id: 'biz', name: '业务表格' },
      { id: 'sys', name: '平台表格' },
    ],
    functions: [
      { name: 'MASK_PHONE', params: ['v'], body: 'CONCAT(SUBSTR(v, 0, 3), "****", SUBSTR(v, 7, 4))' },
    ],
    interfaces: [order, user],
    ioTypes: defaultIoTypes(),
    connections: defaultConnections(),
    log: { enabled: true, level: 'INFO', conn: 'main', database: '', table: 'sys_log', console: true },
    token: { ttl: 7200, header: 'authorization', cookie: 'icb_token', store: 'redis' },
    docs: { title: '接口工程 API', version: '1.0.0', description: '由 ClickBuild 生成的接口服务文档' },
    services: [
      { key: 'self', label: '本服务', baseUrl: 'http://127.0.0.1:18100/' },
    ],
    theme: { accent: '#111111', headerTitle: '接口工程', footerText: 'ClickBuild · 黑白简约', pattern: 'none', logo: '' },
    isolation: { resetOnStart: false, database: '' },
    updatedAt: new Date().toISOString(),
  };
}

// 新建任务默认内容：不再给空工程。后端 / 混合任务自带一套可直接跑通的账号接口，
// 只前端任务仍然保持空白画布（接口编辑入口本来也收起）。
function starterProject(taskType) {
  const kind = TASK_TYPES.includes(taskType) ? taskType : 'mixed';
  const p = seedProject();
  p.name = kind === 'database' ? '数据库工程' : '新建工程';
  p.taskType = kind;
  p.description = kind === 'frontend' ? '只前端任务 · 空白画布'
    : kind === 'database' ? '数据库工程 · 直接连接 MariaDB'
      : '自带账号权限接口的新工程';
  p.categories = [{ id: 'base', name: '基础' }];
  p.functions = [];
  delete p.frontend;
  p.interfaces = [];
  if (kind === 'frontend') return p;
  if (kind === 'database') {
    p.dbProject = { conn: 'main', database: 'clickbuild', table: '' };
    return p;
  }

  const account = newIface('账号权限', 'base', { scenario: 'rbac' });
  account.comment = '新建工程自带：登录、注册、当前用户、退出；管理员可管理用户';
  p.interfaces = [account];
  p.permissions = {
    roles: [{ key: 'admin', name: '管理员' }, { key: 'user', name: '普通用户' }],
    enforce: true,
  };
  return p;
}

function normalizeTable(t, idx, used) {
  const fields = (Array.isArray(t.fields) && t.fields.length ? t.fields : defaultFields()).map((f, i) => {
    const type = TYPE_KEYS.includes(f.type) ? f.type : 'varchar';
    const meta = TYPES.find((x) => x.key === type) || {};
    return {
      name: f.name || `field_${i + 1}`,
      type,
      comment: f.comment || '',
      pk: !!f.pk,
      autoIncrement: !!f.autoIncrement,
      nullable: f.nullable !== false,
      search: f.search !== false && /char|text/i.test(type),
      hidden: f.hidden == null ? !!meta.secret : !!f.hidden,
      query: f.query == null ? !meta.secret : f.query !== false,
      writable: f.writable !== false,
      default: f.default == null ? '' : String(f.default),
    };
  });
  return {
    key: t.key || keyOf(t.name || `table_${idx + 1}`, used),
    name: t.name || `table_${idx + 1}`,
    schema: t.schema || '',
    conn: t.conn || 'main',
    comment: t.comment || '',
    store: storeOf(t),
    indexes: (Array.isArray(t.indexes) ? t.indexes : []).map((x, i) => {
      const idx = x && typeof x === 'object' ? x : {};
      return {
        name: idx.name || `idx_${t.name || `table_${idx + 1}`}_${i + 1}`,
        unique: !!idx.unique,
        columns: Array.isArray(idx.columns) ? idx.columns.map(String) : [],
      };
    }),
    relations: (Array.isArray(t.relations) ? t.relations : []).map((r) => {
      const rel = r && typeof r === 'object' ? r : {};
      return {
        name: String(rel.name || ''),
        kind: String(rel.kind || 'many-to-one'),
        target: String(rel.target || rel.to || ''),
        field: String(rel.field || rel.foreignKey || ''),
        targetKey: String(rel.targetKey || 'id'),
        through: String(rel.through || ''),
      };
    }),
    fields,
  };
}

function normalizeRoute(r, idx) {
  const kind = ROUTE_KINDS.includes(r.key) ? r.key : 'custom';
  const g = r.guard || {};
  const roles = Array.isArray(r.roles) ? r.roles.map(String).filter(Boolean) : [];
  return {
    id: r.id || crypto.randomUUID().slice(0, 8),
    key: kind,
    name: r.name || ROUTE_META[kind].name,
    method: (r.method || ROUTE_META[kind].method).toUpperCase(),
    path: r.path || `/route-${idx + 1}`,
    auth: !!r.auth || roles.length > 0,
    summary: r.summary || '',
    guard: {
      tx: g.tx != null ? !!g.tx : ['create', 'update', 'delete'].includes(kind),
      rate: { enabled: !!(g.rate && g.rate.enabled), limit: Number((g.rate && g.rate.limit) || 60), window: Number((g.rate && g.rate.window) || 60) },
      schedule: { enabled: !!(g.schedule && g.schedule.enabled), from: (g.schedule && g.schedule.from) || '', to: (g.schedule && g.schedule.to) || '' },
      breaker: { enabled: !!(g.breaker && g.breaker.enabled), threshold: Number((g.breaker && g.breaker.threshold) || 5), cooldown: Number((g.breaker && g.breaker.cooldown) || 30) },
    },
    script: typeof r.script === 'string' ? r.script : ROUTE_TEMPLATES[kind],
    cache: { enabled: !!(r.cache && r.cache.enabled), key: (r.cache && r.cache.key) || '', ttl: Number((r.cache && r.cache.ttl) || 60) },
    io: ioOf({ key: kind, script: typeof r.script === 'string' ? r.script : ROUTE_TEMPLATES[kind], io: r.io }),
    docs: {
      summary: (r.docs && r.docs.summary) || r.summary || '',
      description: (r.docs && r.docs.description) || '',
      requestExample: (r.docs && r.docs.requestExample) || '',
      responseExample: (r.docs && r.docs.responseExample) || '',
    },
    roles: Array.isArray(r.roles) ? r.roles.map(String).filter(Boolean) : [],
    docsAuto: r.docsAuto && typeof r.docsAuto === 'object'
      ? { fingerprint: String(r.docsAuto.fingerprint || ''), fields: Array.isArray(r.docsAuto.fields) ? r.docsAuto.fields.map(String) : [] }
      : null,
    proxy: {
      enabled: !!(r.proxy && r.proxy.enabled) || kind === 'proxy',
      upstream: (r.proxy && r.proxy.upstream) || '',
      target: (r.proxy && r.proxy.target) || '',
      stripPrefix: !(r.proxy && r.proxy.stripPrefix === false),
      forwardHeaders: !(r.proxy && r.proxy.forwardHeaders === false),
      timeout: Number((r.proxy && r.proxy.timeout) || 15000),
    },
  };
}

function normalizeIface(iface, project, idx) {
  const used = new Set();
  const tables = (Array.isArray(iface.tables) && iface.tables.length
    ? iface.tables
    : [{ key: 'main', name: iface.table || iface.name || `table_${idx + 1}`, fields: iface.fields, schema: iface.schema }]
  ).map((t, i) => normalizeTable({ ...t, fields: t.fields || (i === 0 ? iface.fields : undefined) }, i, used));
  let routes = Array.isArray(iface.routes) ? iface.routes.map(normalizeRoute) : [];
  if (!routes.length) routes = ['list', 'detail', 'create', 'update', 'delete'].map((k) => newRoute(k, { tables }));
  let storageBind = (iface.storage && iface.storage.bindField) || 'file_key';
  for (const r of routes) {
    if (r.io && r.io.response === 'file' && r.io.autoBind && r.io.field) {
      const t = tables.find((x) => x.key === r.io.tableKey) || tables[0];
      const field = safeIdent(r.io.field, 'field');
      if (t && !t.fields.some((f) => f.name === field)) {
        t.fields.push({
          ...newField(field, 'varchar'),
          hidden: true,
          query: false,
          comment: '对象键（S3 key）',
        });
      }
      storageBind = field;
    }
  }
  const docContext = { tables, basePath: iface.basePath || '', name: iface.name || '' };
  for (const r of routes) docs.applyRouteDocs(docContext, r);
  return {
    id: iface.id || crypto.randomUUID().slice(0, 8),
    name: iface.name || `接口${idx + 1}`,
    comment: iface.comment || '',
    categoryId: iface.categoryId || (project.categories[0] && project.categories[0].id) || 'biz',
    basePath: iface.basePath || '',
    tables,
    routes,
    storage: { enabled: iface.storage ? iface.storage.enabled !== false : true, bucket: (iface.storage && iface.storage.bucket) || 'clickbuild', bindField: storageBind },
    objects: {
      enabled: !!(iface.objects && iface.objects.enabled),
      bucket: (iface.objects && iface.objects.bucket) || ((iface.storage && iface.storage.bucket) || 'clickbuild'),
      prefix: (iface.objects && iface.objects.prefix) || '',
      pageSize: Number((iface.objects && iface.objects.pageSize) || 20),
    },
    page: { size: Number((iface.page && iface.page.size) || 20) },
    docs: {
      summary: (iface.docs && iface.docs.summary) || iface.comment || '',
      description: (iface.docs && iface.docs.description) || '',
      owner: (iface.docs && iface.docs.owner) || '',
      version: (iface.docs && iface.docs.version) || '1.0.0',
      tags: Array.isArray(iface.docs && iface.docs.tags) ? iface.docs.tags : [],
      requestExample: (iface.docs && iface.docs.requestExample) || '',
      responseExample: (iface.docs && iface.docs.responseExample) || '',
      notes: (iface.docs && iface.docs.notes) || '',
    },
  };
}

function cloneIface(iface, names) {
  const used = new Set((names || []).map((n) => String(n).trim()));
  const base = String(iface.name || '接口').replace(/[0-9]+$/, '');
  let n = 2;
  let name = `${base}${n}`;
  while (used.has(name)) { n += 1; name = `${base}${n}`; }
  const copy = JSON.parse(JSON.stringify(iface));
  copy.id = crypto.randomUUID().slice(0, 8);
  copy.name = name;
  const renamed = new Map();
  copy.tables = (copy.tables || []).map((t) => {
    const next = { ...t, name: `${t.name}_${n}`, comment: t.comment ? `${t.comment}（副本${n}）` : '' };
    renamed.set(t.name, next.name);
    return next;
  });
  const swap = (text) => {
    let out = String(text || '');
    renamed.forEach((to, from) => { out = out.split(from).join(to); });
    return out;
  };
  const bumpPath = (p) => String(p || '').replace(/([A-Za-z0-9_-]+)(\/:[^/]*)?$/, (m, seg, tail) => `${seg}-${n}${tail || ''}`);
  copy.routes = (copy.routes || []).map((r) => ({
    ...r,
    id: crypto.randomUUID().slice(0, 8),
    path: bumpPath(r.path),
    script: swap(r.script),
  }));
  copy.basePath = copy.basePath || '';
  return copy;
}

function normalizeProject(project) {
  const p = project && typeof project === 'object' ? project : {};
  let categories = Array.isArray(p.categories) && p.categories.length ? p.categories : [{ id: 'biz', name: '业务表格' }];
  categories = categories.map((c, i) => ({ id: c.id || `cat${i + 1}`, name: c.name || `分类${i + 1}` }));
  const ifaces = (Array.isArray(p.interfaces) ? p.interfaces : []).map((it, i) => normalizeIface(it, { categories }, i));
  const functions = (Array.isArray(p.functions) ? p.functions : []).map((f, i) => ({
    name: String(f.name || `FUNC_${i + 1}`).toUpperCase(),
    params: Array.isArray(f.params) ? f.params : String(f.params || '').split(',').map((s) => s.trim()).filter(Boolean),
    body: String(f.body || ''),
  }));
  const conns = defaultConnections();
  const given = p.connections || {};
  const pick = (kind, list) => (Array.isArray(list) && list.length ? list : conns[kind]).map((c, i) => ({
    ...conns[kind][0], ...c, key: c.key || (i === 0 ? 'main' : `c${i + 1}`),
  }));
  return {
    name: p.name || '接口工程',
    description: p.description || '',
    taskType: TASK_TYPES.includes(p.taskType) ? p.taskType : 'mixed',
    dbProject: p.dbProject && typeof p.dbProject === 'object' ? {
      conn: String(p.dbProject.conn || 'main'),
      database: String(p.dbProject.database || ''),
      table: String(p.dbProject.table || ''),
    } : null,
    categories,
    ioTypes: normalizeIoTypes(p.ioTypes),
    functions,
    interfaces: ifaces,
    connections: {
      mysql: pick('mysql', given.mysql),
      redis: pick('redis', given.redis),
      s3: pick('s3', given.s3),
    },
    log: {
      enabled: !!(p.log && p.log.enabled),
      level: String((p.log && p.log.level) || 'INFO').toUpperCase(),
      conn: (p.log && p.log.conn) || 'main',
      database: (p.log && p.log.database) || '',
      table: (p.log && p.log.table) || 'sys_log',
      console: !(p.log && p.log.console === false),
    },
    token: {
      ttl: Number((p.token && p.token.ttl) || 7200),
      header: (p.token && p.token.header) || 'authorization',
      cookie: (p.token && p.token.cookie) || 'icb_token',
      store: (p.token && p.token.store) === 'memory' ? 'memory' : 'redis',
    },
    docs: {
      title: (p.docs && p.docs.title) || (p.name || '接口工程'),
      version: (p.docs && p.docs.version) || '1.0.0',
      description: (p.docs && p.docs.description) || (p.description || ''),
    },
    errors: {
      pages: !(p.errors && p.errors.pages === false),
      detail: !(p.errors && p.errors.detail === false),
    },
    services: (Array.isArray(p.services) ? p.services : []).map((s, i) => ({
      key: s.key || `svc${i + 1}`, label: s.label || s.key || `服务${i + 1}`, baseUrl: s.baseUrl || '', token: s.token || '',
    })),
    upstreams: (Array.isArray(p.upstreams) ? p.upstreams : []).map((u, i) => ({
      id: String(u.id || `up${i + 1}`),
      name: String(u.name || u.id || `上游${i + 1}`),
      baseUrl: String(u.baseUrl || '').replace(/\/+$/, ''),
      prefix: String(u.prefix || ''),
      authHeader: String(u.authHeader || ''),
      authValue: String(u.authValue || ''),
      timeout: Number(u.timeout || 15000),
      headers: (u.headers && typeof u.headers === 'object') ? u.headers : {},
    })),
    permissions: {
      roles: (Array.isArray(p.permissions && p.permissions.roles) && p.permissions.roles.length
        ? p.permissions.roles
        : [{ key: 'admin', name: '管理员' }, { key: 'user', name: '普通用户' }]).map((r, i) => ({
        key: String(r.key || `role${i + 1}`).replace(/[^A-Za-z0-9_-]/g, ''),
        name: String(r.name || r.key || `角色${i + 1}`),
      })),
      enforce: !!(p.permissions && p.permissions.enforce),
    },
    theme: {
      accent: (p.theme && p.theme.accent) || '#111111',
      headerTitle: (p.theme && p.theme.headerTitle) || (p.name || '接口工程'),
      footerText: (p.theme && p.theme.footerText) || '',
      pattern: (p.theme && p.theme.pattern) || 'none',
      logo: (p.theme && p.theme.logo) || '',
    },
    isolation: {
      resetOnStart: !!(p.isolation && p.isolation.resetOnStart),
      database: (p.isolation && p.isolation.database) || '',
    },
    seed: (p.seed && typeof p.seed === 'object' && String(p.seed.sql || '').trim()) ? {
      enabled: p.seed.enabled !== false,
      guard: String(p.seed.guard || ''),
      sql: String(p.seed.sql || ''),
      note: String(p.seed.note || ''),
    } : null,
    frontend: (p.frontend && p.frontend.project && (Array.isArray(p.frontend.project.elements) || (Array.isArray(p.frontend.project.pages) && p.frontend.project.pages.length))) ? {
      format: 'yxpp',
      version: 1,
      name: String(p.frontend.name || '前端工程'),
      framework: String(p.frontend.framework || 'tailwind'),
      updatedAt: p.frontend.updatedAt || new Date().toISOString(),
      project: p.frontend.project,
      html: String(p.frontend.html || ''),
    } : null,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
  };
}

// 项目级表目录：同一工程内所有接口的表放在一起，供跨接口 SQL 引用。
// 物理表名在工程里唯一；同表被多个接口复用时只保留一条，并记下 ifaceNames。
function projectTableCatalog(project) {
  const p = project && Array.isArray(project.interfaces) ? project : normalizeProject(project);
  const out = [];
  const seen = new Map();
  for (const it of p.interfaces || []) {
    for (const t of it.tables || []) {
      if (!t || !t.name) continue;
      const ref = t.schema ? `${t.schema}.${t.name}` : t.name;
      if (seen.has(ref)) {
        const hit = seen.get(ref);
        if (it.name && !hit.ifaceNames.includes(it.name)) hit.ifaceNames.push(it.name);
        continue;
      }
      const item = {
        ...t,
        ifaceId: String(it.id || ''),
        ifaceName: String(it.name || ''),
        ifaceBasePath: String(it.basePath || ''),
        ifaceNames: it.name ? [String(it.name)] : [],
        ref,
      };
      seen.set(ref, item);
      out.push(item);
    }
  }
  return out;
}

function validateProject(project) {
  const errors = [];
  const warnings = [];
  const catIds = new Set(project.categories.map((c) => c.id));
  const routes = new Set();
  project.interfaces.forEach((it, i) => {
    if (!it.name) errors.push(`第 ${i + 1} 个接口没有名字`);
    if (!catIds.has(it.categoryId)) errors.push(`接口「${it.name}」的分类不存在`);
    if (!it.tables.length) errors.push(`接口「${it.name}」至少要有一张表`);
    const tableKeys = new Set();
    it.tables.forEach((t) => {
      if (tableKeys.has(t.key)) errors.push(`接口「${it.name}」表键重复：${t.key}`);
      tableKeys.add(t.key);
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(t.name)) errors.push(`接口「${it.name}」表名非法：${t.name}`);
      if (!t.fields.some((f) => f.pk)) warnings.push(`表 ${t.name} 没有主键（按无主键模式生成）`);
      for (const f of t.fields) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(f.name)) errors.push(`表 ${t.name} 字段名非法：${f.name}`);
      }
    });
    it.routes.forEach((r) => {
      const key = `${r.method} ${it.basePath}${r.path}`;
      if (routes.has(key)) errors.push(`路由重复：${key}`);
      routes.add(key);
      if (!/^[A-Za-z0-9_/:.-]*$/.test(r.path)) errors.push(`路由路径含非法字符：${r.path}`);
      const chk = script.checkScript(r.script);
      chk.problems.forEach((p) => errors.push(`接口「${it.name}」${r.method} ${r.path}：${p}`));
      if (r.proxy && r.proxy.enabled && !r.proxy.target && !r.proxy.upstream) errors.push(`接口「${it.name}」${r.method} ${r.path}：代理路由缺少上游或目标路径`);
      if (r.io) {
        if (r.io.response === 'file' && r.io.storage !== 's3') errors.push(`接口「${it.name}」${r.method} ${r.path}：文件上传必须使用 S3 存储`);
        if (r.io.response === 'file' && r.io.autoBind) {
          const target = it.tables.find((t) => t.key === r.io.tableKey) || it.tables[0];
          if (!target || !target.fields.some((f) => f.name === r.io.field)) errors.push(`接口「${it.name}」${r.method} ${r.path}：自动入库字段不存在 ${r.io.field}`);
        }
        if (r.io.response === 'cookie' && !['redis', 'memory'].includes(r.io.storage)) errors.push(`接口「${it.name}」${r.method} ${r.path}：Cookie 会话只能存 Redis 或进程内存`);
      }
      if (r.roles && r.roles.length) {
        const known = new Set(((project.permissions && project.permissions.roles) || []).map((x) => x.key));
        r.roles.forEach((role) => { if (!known.has(role)) errors.push(`接口「${it.name}」${r.method} ${r.path}：权限矩阵里没有角色 ${role}`); });
      }
    });
  });
  for (const f of project.functions) {
    if (!f.name) errors.push('自定义函数缺少名字');
    if (!f.body) errors.push(`自定义函数 ${f.name} 没有表达式`);
    try { script.parseExpr(f.body); } catch (e) { errors.push(`自定义函数 ${f.name}：${e.message}`); }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function ddlOf(iface) {
  const out = [];
  for (const t of iface.tables) {
    if (t.schema) out.push(`CREATE DATABASE IF NOT EXISTS \`${t.schema}\` DEFAULT CHARACTER SET utf8mb4;`);
    const cols = t.fields.map((f) => {
      const type = (TYPES.find((x) => x.key === f.type) || TYPES[8]).sql;
      const parts = [`  \`${f.name}\` ${type}`];
      if (f.pk && f.autoIncrement) parts.push('AUTO_INCREMENT');
      parts.push(f.nullable === false ? 'NOT NULL' : 'NULL');
      if (f.default && !f.autoIncrement) {
        parts.push(/CURRENT_TIMESTAMP|NULL|^\d+$/.test(f.default) ? `DEFAULT ${f.default}` : `DEFAULT '${String(f.default).replace(/'/g, "''")}'`);
      }
      if (f.comment) parts.push(`COMMENT '${String(f.comment).replace(/'/g, "''")}'`);
      return parts.join(' ');
    });
    const pk = t.fields.filter((f) => f.pk).map((f) => `\`${f.name}\``).join(', ');
    const pkSql = pk ? `,\n  PRIMARY KEY (${pk})` : '';
    out.push(`CREATE TABLE IF NOT EXISTS ${t.schema ? `\`${t.schema}\`.` : ''}\`${t.name}\` (\n${cols.join(',\n')}${pkSql}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${t.comment ? ` COMMENT='${String(t.comment).replace(/'/g, "''")}'` : ''};`);
  }
  return out.join('\n\n');
}

module.exports = {
  TYPES, TYPE_KEYS, TASK_TYPES, ROUTE_KINDS, ROUTE_META, ROUTE_TEMPLATES, IFACE_SCENARIOS,
  IO_RESPONSES, IO_STORES, FILE_KINDS,
  newField, defaultFields, newTable, newRoute, newIface, cloneIface, seedProject, starterProject,
  defaultIoTypes, normalizeIoTypes, ioOf,
  safeIdent,
  defaultConnections, defaultGuard,
  normalizeProject, normalizeIface, normalizeTable, normalizeRoute, validateProject, ddlOf,
  projectTableCatalog,
};
