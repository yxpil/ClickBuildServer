'use strict';

// 生成「活动报名」内置案例：公开报名 + 名额控制 + 后台发布 + 报名名单导出。
// 运行：node tools/make-signup-case.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'signup-frontend.html');
const OUT = path.join(ROOT, 'app', 'iface', 'cases', 'signup.json');

function id(seed) { return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8); }

function field(name, type, comment, opts = {}) {
  return {
    name, type, comment,
    pk: !!opts.pk, autoIncrement: !!opts.autoIncrement,
    nullable: opts.nullable !== false, search: !!opts.search, hidden: !!opts.hidden,
    query: !!opts.query, writable: !!opts.writable, default: opts.default || '',
  };
}

function route(name, method, routePath, auth, summary, script, opts = {}) {
  return {
    id: id(method + ' ' + routePath),
    key: 'custom', name, method, path: routePath, auth: !!auth,
    summary,
    guard: {
      tx: !!opts.tx,
      rate: { enabled: false, limit: 60, window: 60 },
      schedule: { enabled: false, from: '', to: '' },
      breaker: { enabled: false, threshold: 5, cooldown: 30 },
    },
    script,
    cache: { enabled: false, key: '', ttl: 60 },
    docs: { summary, description: '', requestExample: '', responseExample: '' },
  };
}

const eventTable = {
  key: 'main', name: 'rg_event', schema: '', conn: 'main', comment: '活动主表',
  fields: [
    field('id', 'bigint', '主键', { pk: true, autoIncrement: true, nullable: false, query: true }),
    field('title', 'varchar', '活动标题', { search: true, query: true, writable: true }),
    field('description', 'text', '活动说明', { query: true, writable: true }),
    field('location', 'varchar', '活动地点', { search: true, query: true, writable: true }),
    field('start_at', 'datetime', '开始时间', { query: true, writable: true }),
    field('capacity', 'int', '名额，0 不限', { query: true, writable: true, default: '0' }),
    field('status', 'tinyint', '状态 0草稿 1开放 2结束', { query: true, writable: true, default: '0' }),
    field('registered_count', 'int', '已报名人数', { query: true, writable: false, default: '0' }),
    field('created_at', 'datetime', '创建时间', { query: true, writable: false, default: 'CURRENT_TIMESTAMP' }),
    field('updated_at', 'datetime', '更新时间', { query: true, writable: false, default: 'CURRENT_TIMESTAMP' }),
  ],
};

const signupTable = {
  key: 'reg', name: 'rg_signup', schema: '', conn: 'main', comment: '报名记录',
  fields: [
    field('id', 'bigint', '主键', { pk: true, autoIncrement: true, nullable: false, query: true }),
    field('event_id', 'bigint', '活动 ID', { search: true, query: true, writable: true }),
    field('name', 'varchar', '姓名', { search: true, query: true, writable: true }),
    field('phone', 'varchar', '手机号', { search: true, query: true, writable: true }),
    field('remark', 'varchar', '备注', { query: true, writable: true }),
    field('created_at', 'datetime', '报名时间', { query: true, writable: false, default: 'CURRENT_TIMESTAMP' }),
  ],
};

const adminTable = {
  key: 'auth', name: 'rg_admin', schema: '', conn: 'main', comment: '报名管理员',
  fields: [
    field('id', 'bigint', '主键', { pk: true, autoIncrement: true, nullable: false, query: true }),
    field('username', 'varchar', '账号', { search: true, query: true, writable: true }),
    field('password', 'varchar', 'SM4 密码', { query: true, writable: true, hidden: true }),
    field('display_name', 'varchar', '显示名', { query: true, writable: true }),
    field('created_at', 'datetime', '创建时间', { query: true, writable: false, default: 'CURRENT_TIMESTAMP' }),
  ],
};

const routes = [
  route('管理员登录', 'POST', '/admin/login', false, '首次登录自动创建默认管理员', [
    'LET $u = QUERY SELECT username, password, display_name FROM {{t:auth}} WHERE username = {{body.username}} LIMIT 1;',
    'IF LEN($u.rows) == 0',
    '  IF {{body.username}} == "admin" && {{body.password}} == "Admin@123456"',
    '    EXEC INSERT INTO {{t:auth}} (username, password, display_name, created_at) VALUES ("admin", SM4_ENC("Admin@123456", "clickbuild-key"), "管理员", NOW());',
    '    LET $t0 = TOKEN NEW { "username": "admin", "role": "admin" };',
    '    RETURN 200 { "ok": true, "token": $t0.token, "name": "管理员" };',
    '  END',
    '  RETURN 401 { "error": "BAD_LOGIN", "message": "账号或密码错误" };',
    'END',
    'IF SM4_DEC($u.rows[0].password, "clickbuild-key") != {{body.password}}',
    '  RETURN 401 { "error": "BAD_LOGIN", "message": "账号或密码错误" };',
    'END',
    'LET $t = TOKEN NEW { "username": $u.rows[0].username, "role": "admin" };',
    'RETURN 200 { "ok": true, "token": $t.token, "name": $u.rows[0].display_name };',
  ].join('\n')),

  route('开放活动列表', 'GET', '/events', false, '公开列出开放报名的活动', [
    'LET $r = QUERY SELECT * FROM {{t:main}} WHERE status = 1 ORDER BY start_at ASC, id DESC;',
    'RETURN 200 $r.rows;',
  ].join('\n')),

  route('开放活动详情', 'GET', '/events/:id', false, '公开读取活动与剩余名额', [
    'LET $r = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} AND status = 1 LIMIT 1;',
    'IF LEN($r.rows) == 0',
    '  RETURN 404 { "error": "NOT_FOUND", "message": "活动不存在或已结束" };',
    'END',
    'RETURN 200 $r.rows[0];',
  ].join('\n')),

  route('活动列表', 'GET', '/admin/events', true, '后台列出全部活动', [
    'LET $r = QUERY SELECT * FROM {{t:main}} ORDER BY id DESC;',
    'RETURN 200 $r.rows;',
  ].join('\n')),

  route('新建活动', 'POST', '/admin/events', true, '创建活动并设置名额与状态', [
    'IF LEN({{body.title}}) == 0',
    '  RETURN 400 { "error": "TITLE_REQUIRED", "message": "活动标题不能为空" };',
    'END',
    'EXEC INSERT INTO {{t:main}} (title, description, location, start_at, capacity, status, registered_count, created_at, updated_at) VALUES ({{body.title}}, {{body.description}}, {{body.location}}, {{body.start_at}}, {{body.capacity}}, {{body.status}}, 0, NOW(), NOW());',
    'RETURN 201 { "ok": true };',
  ].join('\n')),

  route('更新活动', 'PUT', '/admin/events/:id', true, '更新活动信息、名额与状态', [
    'EXEC UPDATE {{t:main}} SET title = {{body.title}}, description = {{body.description}}, location = {{body.location}}, start_at = {{body.start_at}}, capacity = {{body.capacity}}, status = {{body.status}}, updated_at = NOW() WHERE id = {{id}};',
    'RETURN 200 { "ok": true };',
  ].join('\n')),

  route('删除活动', 'DELETE', '/admin/events/:id', true, '无报名记录时删除活动', [
    'LET $r = QUERY SELECT registered_count FROM {{t:main}} WHERE id = {{id}} LIMIT 1;',
    'IF LEN($r.rows) == 0',
    '  RETURN 404 { "error": "NOT_FOUND", "message": "活动不存在" };',
    'END',
    'IF $r.rows[0].registered_count > 0',
    '  RETURN 409 { "error": "HAS_SIGNUPS", "message": "已有报名记录，不能直接删除；请先结束活动并导出名单" };',
    'END',
    'EXEC DELETE FROM {{t:main}} WHERE id = {{id}};',
    'RETURN 200 { "ok": true };',
  ].join('\n')),

  route('切换状态', 'POST', '/admin/events/:id/status', true, '开放、结束或转草稿', [
    'EXEC UPDATE {{t:main}} SET status = {{body.status}}, updated_at = NOW() WHERE id = {{id}};',
    'RETURN 200 { "ok": true };',
  ].join('\n')),

  route('提交报名', 'POST', '/events/:id/signups', false, '校验名额与重复手机号后报名', [
    'LET $e = QUERY SELECT id, status, capacity, registered_count FROM {{t:main}} WHERE id = {{id}} FOR UPDATE;',
    'IF LEN($e.rows) == 0',
    '  RETURN 404 { "error": "NOT_FOUND", "message": "活动不存在" };',
    'END',
    'IF $e.rows[0].status != 1',
    '  RETURN 409 { "error": "EVENT_CLOSED", "message": "活动已结束，无法报名" };',
    'END',
    'IF $e.rows[0].capacity > 0 && $e.rows[0].registered_count >= $e.rows[0].capacity',
    '  RETURN 409 { "error": "EVENT_FULL", "message": "名额已满" };',
    'END',
    'LET $d = QUERY SELECT id FROM {{t:reg}} WHERE event_id = {{id}} AND phone = {{body.phone}} LIMIT 1;',
    'IF LEN($d.rows) > 0',
    '  RETURN 409 { "error": "DUPLICATE_PHONE", "message": "这个手机号已经报名过了" };',
    'END',
    'EXEC INSERT INTO {{t:reg}} (event_id, name, phone, remark, created_at) VALUES ({{id}}, {{body.name}}, {{body.phone}}, {{body.remark}}, NOW());',
    'EXEC UPDATE {{t:main}} SET registered_count = registered_count + 1, updated_at = NOW() WHERE id = {{id}};',
    'RETURN 201 { "ok": true };',
  ].join('\n'), { tx: true }),

  route('报名名单', 'GET', '/admin/events/:id/signups', true, '后台读取某场活动的报名名单', [
    'LET $r = QUERY SELECT * FROM {{t:reg}} WHERE event_id = {{id}} ORDER BY id DESC LIMIT 500;',
    'RETURN 200 $r.rows;',
  ].join('\n')),
];

function N(type, key, x, y, w, h, props, style, children) {
  return {
    id: 'rg-' + key, type, x, y, w, h, name: '', hidden: false, locked: false,
    props: props || {}, style: style || {}, children: children || [],
  };
}
const T = (key, x, y, w, h, text, size, color, extra) => N('text', key, x, y, w, h, Object.assign({ text, size, color }, extra || {}));
const H = (key, x, y, w, h, text, size, color, extra) => N('heading', key, x, y, w, h, Object.assign({ text, size, weight: 600, lh: 1.18, ls: -0.6, color, tag: 'h2' }, extra || {}));
const BOX = (key, x, y, w, h, bg, extra) => N('box', key, x, y, w, h, {}, Object.assign({ background: bg, radius: 0 }, extra || {}));

function project() {
  const cardStyle = { background: '#FBF9F3', border: 1, borderColor: '#D8D3C6', radius: 3 };
  return {
    name: '活动报名 · 案例前端',
    framework: 'tailwind',
    page: { w: 1200, h: 1080, bg: '#F4F2EB' },
    theme: { font: '"Space Grotesk","Noto Sans SC",sans-serif', accent: '#9A4E2C', radius: 3, grid: 8, showGrid: true },
    assets: [],
    elements: [
      BOX('topbar', 0, 0, 1200, 62, '#111110'),
      T('brand-mark', 60, 17, 34, 28, 'JOIN', 10, '#D8D4C8', { weight: 600, ls: 1.6 }),
      T('brand-title', 106, 15, 170, 28, '活动报名', 17, '#FFFFFF', { weight: 600, ls: 0.4 }),
      T('brand-sub', 244, 20, 230, 18, 'CLICKBUILD / SIGNUP', 9.5, '#8E8B82', { ls: 1.8 }),
      T('nav', 900, 21, 240, 18, '活动列表        管理后台', 11, '#C9C5B9', { ls: 0.6 }),
      BOX('accent', 0, 62, 1200, 5, '#9A4E2C'),
      T('kicker', 60, 118, 420, 18, 'OPEN REGISTRATION / 公开报名', 10.5, '#9A4E2C', { weight: 600, ls: 2.2 }),
      H('hero-title', 60, 145, 800, 132, '一场活动，\n从报名开始。', 52, '#141412', { lh: 1.1, ls: -2.4 }),
      T('hero-lead', 60, 300, 650, 46, '发布活动、设置名额、公开报名、导出名单。填写无需登录，管理需要管理员账号。', 14, '#666157', { lh: 1.7 }),
      T('hero-meta', 60, 370, 760, 18, '2 场开放活动        128 个名额        46 人已报名', 10, '#666157', { ls: 0.8 }),
      N('divider', 'hero-line', 60, 420, 1080, 1, {}, { background: '#D8D3C6' }),
      H('section-title', 60, 449, 400, 36, '开放中的活动', 25, '#141412', { tag: 'h2' }),
      T('section-note', 990, 458, 150, 18, 'SELECT · 2 ROWS', 9.5, '#666157', { ls: 0.8 }),

      BOX('card-1', 60, 505, 520, 254, '#FBF9F3', cardStyle),
      T('card-1-date', 84, 527, 180, 18, '11 / 28   SAT', 10, '#9A4E2C', { ls: 1.2 }),
      T('card-1-spots', 480, 527, 80, 18, '还剩 34 席', 9.5, '#666157', { ls: 0.6 }),
      H('card-1-title', 84, 558, 460, 34, '产品发布会 · 昆明站', 21, '#141412', { lh: 1.3, ls: -0.5 }),
      T('card-1-desc', 84, 604, 456, 44, '聊聊新版本、接口工作台与无代码生成，现场有实操环节。', 12.5, '#666157', { lh: 1.55 }),
      T('card-1-place', 84, 666, 460, 18, '昆明 · 五华区 · 14:00', 11, '#666157', { ls: 0.2 }),
      T('card-1-foot', 84, 716, 460, 18, '已报名 46 / 80                          我要报名 →', 10.5, '#666157', { ls: 0.2 }),

      BOX('card-2', 620, 505, 520, 254, '#FBF9F3', cardStyle),
      T('card-2-date', 644, 527, 180, 18, '12 / 06   SAT', 10, '#9A4E2C', { ls: 1.2 }),
      T('card-2-spots', 1040, 527, 80, 18, '还剩 42 席', 9.5, '#666157', { ls: 0.6 }),
      H('card-2-title', 644, 558, 460, 34, '接口设计工作坊', 21, '#141412', { lh: 1.3, ls: -0.5 }),
      T('card-2-desc', 644, 604, 456, 44, '从一张表到一个服务：现场拆解接口、路由与脚本的边界。', 12.5, '#666157', { lh: 1.55 }),
      T('card-2-place', 644, 666, 460, 18, '昆明 · 呈贡区 · 10:00', 11, '#666157', { ls: 0.2 }),
      T('card-2-foot', 644, 716, 460, 18, '已报名 12 / 48                           我要报名 →', 10.5, '#666157', { ls: 0.2 }),

      BOX('admin-panel', 60, 806, 1080, 158, '#111110', { radius: 3 }),
      T('admin-kicker', 88, 829, 500, 18, 'ADMIN CONSOLE', 9.5, '#8E8B82', { ls: 2 }),
      H('admin-title', 88, 855, 620, 38, '管理后台：发布活动、看名单', 24, '#F7F4EA', { lh: 1.2, ls: -0.6 }),
      T('admin-desc', 88, 899, 620, 38, '默认管理员 admin / Admin@123456。名额在报名事务内校验，名单可一键导出。', 12, '#B9B5AA', { lh: 1.6 }),
      BOX('admin-btn', 920, 858, 168, 44, '#9A4E2C', { radius: 2 }),
      T('admin-btn-text', 944, 871, 130, 18, '进入管理后台  →', 11.5, '#FFFFFF', { weight: 600, ls: 0.4 }),
      T('foot-left', 60, 1000, 420, 18, 'CLICKBUILD / SIGNUP SYSTEM', 9.5, '#8E8B82', { ls: 1.4 }),
      T('foot-right', 830, 1000, 310, 18, '公开报名 · 名额控制 · 名单导出', 9.5, '#8E8B82', { ls: 0.4 }),
    ],
  };
}

const html = fs.readFileSync(TEMPLATE, 'utf8');
const docs = {
  title: '活动报名',
  version: '1.0.0',
  description: '公开活动列表、在线报名、名额与重复手机号校验、后台活动管理、报名名单与 CSV 导出。自带完整前端页面，套用后直接可用。',
};

const data = {
  name: '活动报名',
  description: '公开报名、名额与重复手机号校验、后台发布、报名名单与 CSV 导出',
  categories: [
    { id: 'event', name: '活动' },
    { id: 'data', name: '数据' },
  ],
  functions: null,
  interfaces: [{
    id: id('signup-interface'),
    name: '活动报名',
    comment: '活动、名额与报名名单',
    categoryId: 'event',
    basePath: '',
    tables: [eventTable, signupTable, adminTable],
    routes,
    storage: { enabled: false, bucket: '', bindField: '' },
    page: { size: 20 },
    docs: {
      summary: '活动与报名',
      description: '报名在事务内校验名额与手机号，名单可按活动导出。',
      owner: '', version: '1.0.0', tags: ['活动', '报名', '名额'],
      requestExample: '', responseExample: '', notes: '',
    },
  }],
  connections: {
    mysql: [{ key: 'main', label: '本机 MariaDB', host: '127.0.0.1', port: 13306, user: 'root', password: '', database: 'clickbuild' }],
    redis: [{ key: 'main', label: '本机 Redis', host: '127.0.0.1', port: 16379, db: 0 }],
    s3: [{ key: 'main', label: '本机 RustFS', endpoint: '127.0.0.1', port: 19000, accessKey: 'clickbuild', secretKey: 'clickbuild123', bucket: 'clickbuild' }],
  },
  log: { enabled: false, level: 'INFO', conn: 'main', database: '', table: 'sys_log', console: true },
  token: { ttl: 7200, header: 'authorization', cookie: 'icb_token' },
  docs,
  services: null,
  theme: { accent: '#9A4E2C', headerTitle: '活动报名', footerText: '', pattern: 'none', logo: '' },
  isolation: { resetOnStart: false, database: '' },
  generatedAt: new Date().toISOString(),
  frontend: {
    format: 'yxpp',
    version: 1,
    name: '活动报名 · 案例前端',
    framework: 'tailwind',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: project(),
    html,
  },
};

fs.writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');
console.log('wrote ' + OUT);
console.log('interfaces=' + data.interfaces.length + ' tables=' + data.interfaces.reduce((n, i) => n + i.tables.length, 0) + ' routes=' + routes.length);
console.log('frontend html=' + html.length + ' bytes, elements=' + data.frontend.project.elements.length);
