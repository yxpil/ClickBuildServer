// 作者：yxpil
'use strict';

// 生成「问卷系统」内置案例：完整工程 JSON + 可直接使用的公开填写/后台管理前端。
// 运行：node tools/make-survey-case.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'survey-frontend.html');
const OUT = path.join(ROOT, 'app', 'iface', 'cases', 'survey.json');

function id(seed) { return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8); }

function field(name, type, comment, opts = {}) {
  return {
    name, type, comment,
    pk: !!opts.pk, autoIncrement: !!opts.autoIncrement,
    nullable: opts.nullable !== false, search: !!opts.search, hidden: !!opts.hidden,
    query: !!opts.query, writable: !!opts.writable, default: opts.default || '',
  };
}

function route(name, method, routePath, auth, summary, script) {
  return {
    id: id(method + ' ' + routePath),
    key: 'custom', name, method, path: routePath, auth: !!auth,
    summary,
    guard: {
      tx: false,
      rate: { enabled: false, limit: 60, window: 60 },
      schedule: { enabled: false, from: '', to: '' },
      breaker: { enabled: false, threshold: 5, cooldown: 30 },
    },
    script,
    cache: { enabled: false, key: '', ttl: 60 },
    docs: { summary, description: '', requestExample: '', responseExample: '' },
  };
}

const surveyTable = {
  key: 'main', name: 'sv_survey', schema: '', conn: 'main', comment: '问卷主表',
  fields: [
    field('id', 'bigint', '主键', { pk: true, autoIncrement: true, nullable: false, query: true }),
    field('title', 'varchar', '问卷标题', { search: true, query: true, writable: true }),
    field('description', 'text', '问卷说明', { query: true, writable: true }),
    field('questions', 'text', '题目 JSON', { query: true, writable: true }),
    field('status', 'tinyint', '状态 0草稿 1开放 2结束', { query: true, writable: true, default: '0' }),
    field('response_count', 'int', '答卷数', { query: true, writable: false, default: '0' }),
    field('created_at', 'datetime', '创建时间', { query: true, writable: false, default: 'CURRENT_TIMESTAMP' }),
    field('updated_at', 'datetime', '更新时间', { query: true, writable: false, default: 'CURRENT_TIMESTAMP' }),
  ],
};

const responseTable = {
  key: 'resp', name: 'sv_response', schema: '', conn: 'main', comment: '答卷表',
  fields: [
    field('id', 'bigint', '主键', { pk: true, autoIncrement: true, nullable: false, query: true }),
    field('survey_id', 'bigint', '问卷 ID', { search: true, query: true, writable: true }),
    field('respondent', 'varchar', '填写人', { search: true, query: true, writable: true }),
    field('answers', 'text', '回答 JSON', { query: true, writable: true }),
    field('created_at', 'datetime', '提交时间', { query: true, writable: false, default: 'CURRENT_TIMESTAMP' }),
  ],
};

const adminTable = {
  key: 'auth', name: 'sv_admin', schema: '', conn: 'main', comment: '问卷管理员',
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

  route('开放问卷列表', 'GET', '/surveys', false, '公开列出开放中的问卷', [
    'LET $r = QUERY SELECT * FROM {{t:main}} WHERE status = 1 ORDER BY updated_at DESC, id DESC;',
    'RETURN 200 $r.rows;',
  ].join('\n')),

  route('开放问卷详情', 'GET', '/surveys/:id', false, '公开读取一份开放问卷', [
    'LET $r = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} AND status = 1 LIMIT 1;',
    'IF LEN($r.rows) == 0',
    '  RETURN 404 { "error": "NOT_FOUND", "message": "问卷不存在或已结束" };',
    'END',
    'RETURN 200 $r.rows[0];',
  ].join('\n')),

  route('问卷列表', 'GET', '/admin/surveys', true, '后台列出全部问卷', [
    'LET $r = QUERY SELECT * FROM {{t:main}} ORDER BY id DESC;',
    'RETURN 200 $r.rows;',
  ].join('\n')),

  route('新建问卷', 'POST', '/admin/surveys', true, '创建问卷并设置状态', [
    'IF LEN({{body.title}}) == 0',
    '  RETURN 400 { "error": "TITLE_REQUIRED", "message": "问卷标题不能为空" };',
    'END',
    'EXEC INSERT INTO {{t:main}} (title, description, questions, status, response_count, created_at, updated_at) VALUES ({{body.title}}, {{body.description}}, {{body.questions}}, {{body.status}}, 0, NOW(), NOW());',
    'RETURN 201 { "ok": true };',
  ].join('\n')),

  route('更新问卷', 'PUT', '/admin/surveys/:id', true, '更新标题、说明、题目与状态', [
    'EXEC UPDATE {{t:main}} SET title = {{body.title}}, description = {{body.description}}, questions = {{body.questions}}, status = {{body.status}}, updated_at = NOW() WHERE id = {{id}};',
    'RETURN 200 { "ok": true };',
  ].join('\n')),

  route('删除问卷', 'DELETE', '/admin/surveys/:id', true, '无答卷时删除问卷', [
    'LET $r = QUERY SELECT response_count FROM {{t:main}} WHERE id = {{id}} LIMIT 1;',
    'IF LEN($r.rows) == 0',
    '  RETURN 404 { "error": "NOT_FOUND", "message": "问卷不存在" };',
    'END',
    'IF $r.rows[0].response_count > 0',
    '  RETURN 409 { "error": "HAS_RESPONSES", "message": "已有答卷，不能直接删除；请先结束问卷并导出数据" };',
    'END',
    'EXEC DELETE FROM {{t:main}} WHERE id = {{id}};',
    'RETURN 200 { "ok": true };',
  ].join('\n')),

  route('切换状态', 'POST', '/admin/surveys/:id/status', true, '发布、结束或转草稿', [
    'IF {{body.status}} < 0',
    '  RETURN 400 { "error": "BAD_STATUS", "message": "状态不合法" };',
    'END',
    'EXEC UPDATE {{t:main}} SET status = {{body.status}}, updated_at = NOW() WHERE id = {{id}};',
    'RETURN 200 { "ok": true };',
  ].join('\n')),

  route('提交答卷', 'POST', '/surveys/:id/responses', false, '公开提交一份答卷并累加计数', [
    'LET $s = QUERY SELECT id, status FROM {{t:main}} WHERE id = {{id}} LIMIT 1;',
    'IF LEN($s.rows) == 0',
    '  RETURN 404 { "error": "NOT_FOUND", "message": "问卷不存在" };',
    'END',
    'IF $s.rows[0].status != 1',
    '  RETURN 409 { "error": "SURVEY_CLOSED", "message": "问卷已结束，无法提交" };',
    'END',
    'EXEC INSERT INTO {{t:resp}} (survey_id, respondent, answers, created_at) VALUES ({{id}}, {{body.respondent}}, {{body.answers}}, NOW());',
    'EXEC UPDATE {{t:main}} SET response_count = response_count + 1, updated_at = NOW() WHERE id = {{id}};',
    'RETURN 201 { "ok": true };',
  ].join('\n')),

  route('答卷列表', 'GET', '/admin/surveys/:id/responses', true, '后台读取某份问卷的全部答卷', [
    'LET $r = QUERY SELECT * FROM {{t:resp}} WHERE survey_id = {{id}} ORDER BY id DESC LIMIT 500;',
    'RETURN 200 $r.rows;',
  ].join('\n')),
];

function N(type, key, x, y, w, h, props, style, children) {
  return {
    id: 'sv-' + key, type, x, y, w, h, name: '', hidden: false, locked: false,
    props: props || {}, style: style || {}, children: children || [],
  };
}
const T = (key, x, y, w, h, text, size, color, extra) => N('text', key, x, y, w, h, Object.assign({ text, size, color }, extra || {}));
const H = (key, x, y, w, h, text, size, color, extra) => N('heading', key, x, y, w, h, Object.assign({ text, size, weight: 600, lh: 1.18, ls: -0.6, color, tag: 'h2' }, extra || {}));
const BOX = (key, x, y, w, h, bg, extra) => N('box', key, x, y, w, h, {}, Object.assign({ background: bg, radius: 0 }, extra || {}));

function project() {
  const cardStyle = { background: '#FBF9F3', border: 1, borderColor: '#D8D3C6', radius: 3 };
  return {
    name: '问卷系统 · 案例前端',
    framework: 'tailwind',
    page: { w: 1200, h: 1080, bg: '#F4F2EB' },
    theme: { font: '"Space Grotesk","Noto Sans SC",sans-serif', accent: '#2C5A4A', radius: 3, grid: 8, showGrid: true },
    assets: [],
    elements: [
      BOX('topbar', 0, 0, 1200, 62, '#111110'),
      T('brand-mark', 60, 17, 34, 28, 'FORM', 10, '#D8D4C8', { weight: 600, ls: 1.6 }),
      T('brand-title', 106, 15, 160, 28, '问卷系统', 17, '#FFFFFF', { weight: 600, ls: 0.4 }),
      T('brand-sub', 230, 20, 210, 18, 'CLICKBUILD / SURVEY', 9.5, '#8E8B82', { ls: 1.8 }),
      T('nav', 900, 21, 240, 18, '填写问卷        管理后台', 11, '#C9C5B9', { ls: 0.6 }),
      BOX('accent', 0, 62, 1200, 5, '#2C5A4A'),
      T('kicker', 60, 118, 420, 18, 'OPEN SURVEY / 公开征集', 10.5, '#2C5A4A', { weight: 600, ls: 2.2 }),
      H('hero-title', 60, 145, 760, 132, '让每个问题\n都有答案。', 52, '#141412', { lh: 1.1, ls: -2.4 }),
      T('hero-lead', 60, 300, 620, 46, '从创建、发布到收集、统计，一套可以直接使用的问卷系统。填写无需登录，管理需要管理员账号。', 14, '#666157', { lh: 1.7 }),
      T('hero-meta', 60, 370, 700, 18, '3 份开放问卷        27 份已收答卷        CSV 一键导出', 10, '#666157', { ls: 0.8 }),
      N('divider', 'hero-line', 60, 420, 1080, 1, {}, { background: '#D8D3C6' }),
      H('section-title', 60, 449, 400, 36, '开放中的问卷', 25, '#141412', { tag: 'h2' }),
      T('section-note', 990, 458, 150, 18, 'SELECT · 3 ROWS', 9.5, '#666157', { ls: 0.8 }),

      BOX('card-1', 60, 505, 520, 222, '#FBF9F3', cardStyle),
      T('card-1-status', 84, 527, 180, 18, '●  开放中', 10, '#2C5A4A', { ls: 0.8 }),
      T('card-1-id', 506, 527, 50, 18, '#SV-01', 9.5, '#666157', { ls: 0.8 }),
      H('card-1-title', 84, 558, 460, 34, '客户满意度调查', 21, '#141412', { lh: 1.3, ls: -0.5 }),
      T('card-1-desc', 84, 602, 456, 44, '用一分钟告诉我们你的真实感受，所有回答仅用于改进产品。', 12.5, '#666157', { lh: 1.55 }),
      T('card-1-foot', 84, 688, 460, 18, '4 题 · 18 份答卷                     开始填写 →', 10, '#666157', { ls: 0.2 }),

      BOX('card-2', 620, 505, 520, 222, '#FBF9F3', cardStyle),
      T('card-2-status', 644, 527, 180, 18, '●  开放中', 10, '#2C5A4A', { ls: 0.8 }),
      T('card-2-id', 1066, 527, 50, 18, '#SV-02', 9.5, '#666157', { ls: 0.8 }),
      H('card-2-title', 644, 558, 460, 34, '新功能内测报名', 21, '#141412', { lh: 1.3, ls: -0.5 }),
      T('card-2-desc', 644, 602, 456, 44, '留下联系方式与使用场景，我们会邀请合适的用户参与内测。', 12.5, '#666157', { lh: 1.55 }),
      T('card-2-foot', 644, 688, 460, 18, '3 题 · 9 份答卷                       开始填写 →', 10, '#666157', { ls: 0.2 }),

      BOX('admin-panel', 60, 760, 1080, 168, '#111110', { radius: 3 }),
      T('admin-kicker', 88, 785, 500, 18, 'ADMIN CONSOLE', 9.5, '#8E8B82', { ls: 2 }),
      H('admin-title', 88, 812, 620, 38, '管理后台：编辑、发布、看结果', 24, '#F7F4EA', { lh: 1.2, ls: -0.6 }),
      T('admin-desc', 88, 858, 620, 38, '默认管理员 admin / Admin@123456。登录后可创建问卷、结束收集、导出 CSV。', 12, '#B9B5AA', { lh: 1.6 }),
      BOX('admin-btn', 920, 820, 168, 44, '#2C5A4A', { radius: 2 }),
      T('admin-btn-text', 944, 833, 130, 18, '进入管理后台  →', 11.5, '#FFFFFF', { weight: 600, ls: 0.4 }),
      T('foot-left', 60, 972, 420, 18, 'CLICKBUILD / SURVEY SYSTEM', 9.5, '#8E8B82', { ls: 1.4 }),
      T('foot-right', 830, 972, 310, 18, '公开填写 · 后台管理 · 数据留在自己的库', 9.5, '#8E8B82', { ls: 0.4 }),
    ],
  };
}

const html = fs.readFileSync(TEMPLATE, 'utf8');
const docs = {
  title: '问卷系统',
  version: '1.0.0',
  description: '公开问卷填写、后台问卷编辑、答卷收集、逐题统计与 CSV 导出。自带完整前端页面，套用后直接可用。',
};

const data = {
  name: '问卷系统',
  description: '公开填写、后台编辑、答卷统计与 CSV 导出；自带可直接使用的问卷前端',
  categories: [
    { id: 'form', name: '问卷' },
    { id: 'data', name: '数据' },
  ],
  functions: null,
  interfaces: [{
    id: id('survey-interface'),
    name: '问卷系统',
    comment: '问卷、答卷与统计',
    categoryId: 'form',
    basePath: '',
    tables: [surveyTable, responseTable, adminTable],
    routes,
    storage: { enabled: false, bucket: '', bindField: '' },
    page: { size: 20 },
    docs: {
      summary: '问卷与答卷',
      description: '题目和回答以 JSON 保存，前端负责渲染与统计。',
      owner: '', version: '1.0.0', tags: ['问卷', '统计'],
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
  theme: { accent: '#2C5A4A', headerTitle: '问卷系统', footerText: '', pattern: 'none', logo: '' },
  isolation: { resetOnStart: false, database: '' },
  generatedAt: new Date().toISOString(),
  frontend: {
    format: 'yxpp',
    version: 1,
    name: '问卷系统 · 案例前端',
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
