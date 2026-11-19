'use strict';

// 一个接口可以挂多张表、多个库；每条路由是一段可自定义脚本（见 script.js）。
// 这里只管数据模型、默认脚本、DDL 和校验。

const crypto = require('crypto');
const script = require('./script');

const TYPES = [
  { key: 'bigint', sql: 'BIGINT', label: 'BIGINT 长整', input: 'int' },
  { key: 'int', sql: 'INT', label: 'INT 整型', input: 'int' },
  { key: 'smallint', sql: 'SMALLINT', label: 'SMALLINT 短整', input: 'int' },
  { key: 'tinyint', sql: 'TINYINT', label: 'TINYINT 微整', input: 'int' },
  { key: 'bool', sql: 'TINYINT(1)', label: 'BOOL 布尔', input: 'bool' },
  { key: 'decimal', sql: 'DECIMAL(18,2)', label: 'DECIMAL 金额', input: 'number' },
  { key: 'float', sql: 'FLOAT', label: 'FLOAT 单精度', input: 'number' },
  { key: 'double', sql: 'DOUBLE', label: 'DOUBLE 双精度', input: 'number' },
  { key: 'varchar', sql: 'VARCHAR(255)', label: 'VARCHAR 短文本', input: 'text' },
  { key: 'char', sql: 'CHAR(32)', label: 'CHAR 定长', input: 'text' },
  { key: 'text', sql: 'TEXT', label: 'TEXT 长文本', input: 'textarea' },
  { key: 'longtext', sql: 'LONGTEXT', label: 'LONGTEXT 超长文本', input: 'textarea' },
  { key: 'datetime', sql: 'DATETIME', label: 'DATETIME 时间', input: 'datetime' },
  { key: 'date', sql: 'DATE', label: 'DATE 日期', input: 'date' },
  { key: 'json', sql: 'JSON', label: 'JSON 结构', input: 'json' },
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

const ROUTE_KINDS = ['list', 'detail', 'create', 'update', 'delete', 'upload', 'custom'];

const ROUTE_META = {
  list: { name: '列表', method: 'GET', path: '/:table' },
  detail: { name: '详情', method: 'GET', path: '/:table/:id' },
  create: { name: '新建', method: 'POST', path: '/:table' },
  update: { name: '更新', method: 'PUT', path: '/:table/:id' },
  delete: { name: '删除', method: 'DELETE', path: '/:table/:id' },
  upload: { name: '附件', method: 'POST', path: '/:table/:id/file' },
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
  custom: [
    '# 自定义脚本：随便查、随便改，SQL 里用 {{body.x}} {{query.x}} {{id}} 取请求参数',
    'LET $rows = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} LIMIT {{limit}};',
    'RETURN 200 { "rows": $rows.rows };',
  ].join('\n'),
};

function newField(name, type) {
  const t = TYPE_KEYS.includes(type) ? type : 'varchar';
  return {
    name: name || 'field',
    type: t,
    comment: '',
    pk: false,
    autoIncrement: false,
    nullable: true,
    search: /char|text/i.test(t),
    hidden: false,
    query: true,
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

function newTable(name, usedKeys) {
  const safe = safeIdent(name, 'tbl');
  return {
    key: keyOf(safe, usedKeys || new Set()),
    name: safe,
    schema: '',
    comment: '',
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
    auth: false,
    summary: '',
    guard: { ...defaultGuard(), tx: ['create', 'update', 'delete'].includes(kindKey) },
    script: ROUTE_TEMPLATES[kindKey],
    cache: { enabled: kindKey === 'list' || kindKey === 'detail', key: 'icb:{{t:main}}:{{queryHash}}:{{page}}:{{pageSize}}', ttl: 60 },
  };
}

function newIface(name, categoryId) {
  const used = new Set();
  const id = crypto.randomUUID().slice(0, 8);
  const base = safeIdent(name || 'new', 'iface');
  const main = newTable(`${base}_${id}`, used);
  // 默认路由模板统一引用 {{t:main}} / {{columns:main}}，首张表必须叫 main。
  main.key = 'main';
  used.add('main');
  main.fields = [...defaultFields(), { ...newField('name', 'varchar'), search: true }];
  const routes = ['list', 'detail', 'create', 'update', 'delete'].map((k) => newRoute(k, { tables: [main] }));
  return {
    id,
    name: name || '新接口',
    comment: '',
    categoryId: categoryId || 'biz',
    basePath: '',
    tables: [main],
    routes,
    storage: { enabled: true, bucket: 'clickbuild', bindField: 'file_key' },
    page: { size: 20 },
    docs: { summary: '', description: '', owner: '', version: '1.0.0', tags: [], requestExample: '', responseExample: '', notes: '' },
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
    categories: [
      { id: 'biz', name: '业务表格' },
      { id: 'sys', name: '平台表格' },
    ],
    functions: [
      { name: 'MASK_PHONE', params: ['v'], body: 'CONCAT(SUBSTR(v, 0, 3), "****", SUBSTR(v, 7, 4))' },
    ],
    interfaces: [order, user],
    connections: defaultConnections(),
    log: { enabled: true, level: 'INFO', conn: 'main', database: '', table: 'sys_log', console: true },
    token: { ttl: 7200, header: 'authorization', cookie: 'icb_token' },
    docs: { title: '接口工程 API', version: '1.0.0', description: '由 ClickBuild 生成的接口服务文档' },
    services: [
      { key: 'self', label: '本服务', baseUrl: 'http://127.0.0.1:18100/' },
    ],
    theme: { accent: '#111111', headerTitle: '接口工程', footerText: 'ClickBuild · 黑白简约', pattern: 'none', logo: '' },
    isolation: { resetOnStart: false, database: '' },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeTable(t, idx, used) {
  const fields = (Array.isArray(t.fields) && t.fields.length ? t.fields : defaultFields()).map((f, i) => ({
    name: f.name || `field_${i + 1}`,
    type: TYPE_KEYS.includes(f.type) ? f.type : 'varchar',
    comment: f.comment || '',
    pk: !!f.pk,
    autoIncrement: !!f.autoIncrement,
    nullable: f.nullable !== false,
    search: f.search !== false && /char|text/i.test(f.type || 'varchar'),
    hidden: !!f.hidden,
    query: f.query !== false,
    writable: f.writable !== false,
    default: f.default == null ? '' : String(f.default),
  }));
  return {
    key: t.key || keyOf(t.name || `table_${idx + 1}`, used),
    name: t.name || `table_${idx + 1}`,
    schema: t.schema || '',
    conn: t.conn || 'main',
    comment: t.comment || '',
    fields,
  };
}

function normalizeRoute(r, idx) {
  const kind = ROUTE_KINDS.includes(r.key) ? r.key : 'custom';
  const g = r.guard || {};
  return {
    id: r.id || crypto.randomUUID().slice(0, 8),
    key: kind,
    name: r.name || ROUTE_META[kind].name,
    method: (r.method || ROUTE_META[kind].method).toUpperCase(),
    path: r.path || `/route-${idx + 1}`,
    auth: !!r.auth,
    summary: r.summary || '',
    guard: {
      tx: g.tx != null ? !!g.tx : ['create', 'update', 'delete'].includes(kind),
      rate: { enabled: !!(g.rate && g.rate.enabled), limit: Number((g.rate && g.rate.limit) || 60), window: Number((g.rate && g.rate.window) || 60) },
      schedule: { enabled: !!(g.schedule && g.schedule.enabled), from: (g.schedule && g.schedule.from) || '', to: (g.schedule && g.schedule.to) || '' },
      breaker: { enabled: !!(g.breaker && g.breaker.enabled), threshold: Number((g.breaker && g.breaker.threshold) || 5), cooldown: Number((g.breaker && g.breaker.cooldown) || 30) },
    },
    script: typeof r.script === 'string' ? r.script : ROUTE_TEMPLATES[kind],
    cache: { enabled: !!(r.cache && r.cache.enabled), key: (r.cache && r.cache.key) || '', ttl: Number((r.cache && r.cache.ttl) || 60) },
    docs: {
      summary: (r.docs && r.docs.summary) || r.summary || '',
      description: (r.docs && r.docs.description) || '',
      requestExample: (r.docs && r.docs.requestExample) || '',
      responseExample: (r.docs && r.docs.responseExample) || '',
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
  return {
    id: iface.id || crypto.randomUUID().slice(0, 8),
    name: iface.name || `接口${idx + 1}`,
    comment: iface.comment || '',
    categoryId: iface.categoryId || (project.categories[0] && project.categories[0].id) || 'biz',
    basePath: iface.basePath || '',
    tables,
    routes,
    storage: { enabled: iface.storage ? iface.storage.enabled !== false : true, bucket: (iface.storage && iface.storage.bucket) || 'clickbuild', bindField: (iface.storage && iface.storage.bindField) || 'file_key' },
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
    categories,
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
    frontend: (p.frontend && p.frontend.project && Array.isArray(p.frontend.project.elements)) ? {
      format: 'yxpp',
      version: 1,
      name: String(p.frontend.name || '前端工程'),
      framework: String(p.frontend.framework || 'tailwind'),
      updatedAt: p.frontend.updatedAt || new Date().toISOString(),
      project: p.frontend.project,
      html: String(p.frontend.html || ''),
    } : null,
    updatedAt: p.updatedAt || new Date().toISOString(),
  };
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
  TYPES, TYPE_KEYS, ROUTE_KINDS, ROUTE_META, ROUTE_TEMPLATES,
  newField, defaultFields, newTable, newRoute, newIface, cloneIface, seedProject,
  safeIdent,
  defaultConnections, defaultGuard,
  normalizeProject, normalizeIface, normalizeTable, normalizeRoute, validateProject, ddlOf,
};
