'use strict';

// 生成扩展案例 JSON。案例本身是普通工程文件，运行时由 templates.js 直接读取。
// 用法：runtime\node\node.exe tools/make-cases.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const spec = require('../app/iface/spec');

const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'iface', 'cases', 'blog.json'), 'utf8'));
const OUT = path.join(__dirname, '..', 'app', 'iface', 'cases');

const id = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const field = (name, type = 'varchar', o = {}) => ({ name, type, comment: o.comment || '', pk: !!o.pk, autoIncrement: !!o.autoIncrement, nullable: o.nullable !== false, search: o.search, hidden: !!o.hidden, query: o.query, writable: o.writable, default: o.default || '' });
const pk = () => field('id', 'bigint', { pk: true, autoIncrement: true, nullable: false, writable: false, query: false, comment: '主键' });
const onlyId = () => field('only_id', 'char', { comment: '唯一ID', hidden: true, search: true });
const created = () => field('created_at', 'datetime', { comment: '创建时间', writable: false, default: 'CURRENT_TIMESTAMP' });
const money = (n, c) => field(n, 'decimal', { comment: c || '金额' });
const table = (key, name, comment, fields) => ({ key, name, comment, fields });
const route = (key, name, method, p, script, o = {}) => ({
  id: id(key + name + p), key, name, method, path: p, auth: !!o.auth, summary: o.summary || name,
  guard: { tx: o.tx != null ? o.tx : ['POST', 'PUT', 'DELETE'].includes(method), rate: { enabled: false, limit: 60, window: 60 }, schedule: { enabled: false, from: '', to: '' }, breaker: { enabled: false, threshold: 5, cooldown: 30 } },
  script, cache: { enabled: false, key: '', ttl: 60 },
  docs: { summary: o.summary || name, description: o.description || '', requestExample: o.req || '', responseExample: o.res || '' },
});
const iface = (name, cat, basePath, tables, routes, docs = {}) => ({
  id: id(name), name, comment: docs.comment || docs.summary || name, categoryId: cat, basePath, tables, routes,
  storage: { enabled: true, bucket: 'clickbuild', bindField: 'file_key' }, page: { size: 20 },
  docs: { summary: docs.summary || name, description: docs.description || '', owner: 'ClickBuild 案例库', version: '1.0.0', tags: docs.tags || [] },
});
const project = (name, description, cats, ifaces) => ({
  ...base, name, description,
  categories: cats,
  interfaces: ifaces,
  connections: base.connections,
  generatedAt: new Date().toISOString(),
  docs: { ...base.docs, title: name, description },
  theme: { ...base.theme, headerTitle: name, footerText: 'ClickBuild · 内置案例' },
});

const userTable = (name = 'users') => table('users', name, '用户', [
  pk(), onlyId(), field('username', 'char', { comment: '用户名', search: true }),
  field('password_hash', 'varchar', { comment: 'SM4 密码', hidden: true, search: true }),
  field('display_name', 'varchar', { comment: '显示名', search: true }),
  field('status', 'tinyint', { comment: '状态', default: '1' }),
  created(),
]);

const registerScript = (t, extraCols = '', extraVals = '') => `LET $u = QUERY SELECT id FROM {{t:${t}}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($u.rows) > 0
  RETURN 409 { "ok": false, "error": "USER_EXISTS" };
END
EXEC INSERT INTO {{t:${t}}} (only_id, username, password_hash, display_name${extraCols}) VALUES ({{onlyId}}, {{body.username}}, SM4_ENC({{body.password}}, 'clickbuild-key'), {{body.display_name}}${extraVals});
LET $t = TOKEN NEW { "onlyId": {{onlyId}}, "username": {{body.username}} };
RETURN 201 { "ok": true, "onlyId": {{onlyId}}, "token": $t.token };`;

const loginScript = (t) => `LET $u = QUERY SELECT only_id, password_hash, display_name FROM {{t:${t}}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 401 { "ok": false, "error": "NO_USER" };
END
IF SM4_DEC($u.rows[0].password_hash, 'clickbuild-key') != {{body.password}}
  RETURN 401 { "ok": false, "error": "BAD_PASSWORD" };
END
LET $t = TOKEN NEW { "onlyId": $u.rows[0].only_id, "username": {{body.username}} };
RETURN 200 { "ok": true, "token": $t.token, "name": $u.rows[0].display_name };`;

const cases = {};

/* ---------------- 即时通讯 ---------------- */
cases.chat = project('聊天服务', '私聊会话、消息收发、已读回执、未读数；登录 token 识别用户', [
  { id: 'im', name: '消息' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/chat', [userTable('chat_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '注册并签发 token', req: '{"username":"alice","password":"123456","display_name":"Alice"}' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '登录' }),
    route('custom', '当前用户', 'GET', '/me', 'RETURN 200 { "user": $user };', { auth: true, tx: false, summary: '当前用户' }),
  ], { summary: '聊天账户', description: '用户注册、登录、当前会话用户' }),
  iface('私聊', 'im', '/chat', [
    userTable('chat_user'),
    table('conv', 'chat_conversation', '会话', [pk(), field('owner_only_id', 'char'), field('peer_only_id', 'char'), field('last_message', 'text'), field('updated_at', 'datetime', { default: 'CURRENT_TIMESTAMP' })]),
    table('msg', 'chat_message', '消息', [pk(), field('conv_id', 'bigint'), field('from_only_id', 'char'), field('to_only_id', 'char'), field('body', 'text'), field('msg_type', 'varchar', { default: 'text' }), field('read_flag', 'tinyint', { default: '0' }), created()]),
  ], [
    route('custom', '发送消息', 'POST', '/messages', `LET $c = QUERY SELECT id FROM {{t:conv}} WHERE (owner_only_id = {{user.onlyId}} AND peer_only_id = {{body.to}}) OR (owner_only_id = {{body.to}} AND peer_only_id = {{user.onlyId}}) LIMIT 1;
LET $cid = 0;
IF LEN($c.rows) > 0
  SET $cid = $c.rows[0].id;
ELSE
  LET $ins = EXEC INSERT INTO {{t:conv}} (owner_only_id, peer_only_id, last_message) VALUES ({{user.onlyId}}, {{body.to}}, {{body.body}});
  SET $cid = $ins.insertId;
END
EXEC INSERT INTO {{t:msg}} (conv_id, from_only_id, to_only_id, body, msg_type) VALUES ({{vars.cid}}, {{user.onlyId}}, {{body.to}}, {{body.body}}, {{body.msg_type}});
EXEC UPDATE {{t:conv}} SET last_message = {{body.body}}, updated_at = NOW() WHERE id = {{vars.cid}};
RETURN 201 { "ok": true, "convId": $cid };`, { auth: true, summary: '发送一条消息，自动建会话' }),
    route('custom', '收件箱', 'GET', '/messages', 'LET $rows = QUERY SELECT id, conv_id, from_only_id, body, read_flag, created_at FROM {{t:msg}} WHERE to_only_id = {{user.onlyId}} ORDER BY id DESC LIMIT 50;\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '收到的消息' }),
    route('custom', '标记已读', 'PUT', '/messages/:id/read', 'EXEC UPDATE {{t:msg}} SET read_flag = 1 WHERE id = {{id}} AND to_only_id = {{user.onlyId}};\nRETURN 200 { "ok": true };', { auth: true, summary: '已读回执' }),
    route('custom', '未读数', 'GET', '/unread', 'LET $r = QUERY SELECT COUNT(*) AS n FROM {{t:msg}} WHERE to_only_id = {{user.onlyId}} AND read_flag = 0;\nRETURN 200 { "unread": $r.rows[0].n };', { auth: true, tx: false, summary: '未读消息数' }),
    route('custom', '会话列表', 'GET', '/conversations', 'LET $rows = QUERY SELECT c.id, c.last_message, c.updated_at, u.display_name AS peer_name FROM {{t:conv}} c LEFT JOIN {{t:users}} u ON u.only_id = IF(c.owner_only_id = {{user.onlyId}}, c.peer_only_id, c.owner_only_id) WHERE c.owner_only_id = {{user.onlyId}} OR c.peer_only_id = {{user.onlyId}} ORDER BY c.updated_at DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '我的会话列表' }),
  ], { summary: '即时通讯', description: '发送消息自动建会话、收件箱、已读、未读、会话联查', tags: ['IM', '聊天'] }),
]);

/* ---------------- 视频会议 ---------------- */
cases.meeting = project('视频会议服务', '会议室创建、加入/离开、结束会议并写纪要素材', [
  { id: 'room', name: '会议' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/meeting', [userTable('meeting_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '登录' }),
  ], { summary: '会议账户', description: '参会人账户与 token' }),
  iface('会议室', 'room', '/meeting', [
    userTable('meeting_user'),
    table('room', 'meeting_room', '会议室', [pk(), field('room_no', 'char'), field('title', 'varchar'), field('host_only_id', 'char'), field('status', 'tinyint', { default: '1' }), field('start_at', 'datetime'), field('end_at', 'datetime'), created()]),
    table('part', 'meeting_participant', '参会人', [pk(), field('room_id', 'bigint'), field('user_only_id', 'char'), field('joined_at', 'datetime', { default: 'CURRENT_TIMESTAMP' }), field('left_at', 'datetime')]),
    table('min', 'meeting_minutes', '纪要', [pk(), field('room_id', 'bigint'), field('summary', 'text'), created()]),
  ], [
    route('custom', '创建会议', 'POST', '/rooms', 'LET $ins = EXEC INSERT INTO {{t:room}} (room_no, title, host_only_id, start_at, end_at) VALUES ({{body.room_no}}, {{body.title}}, {{user.onlyId}}, {{body.start_at}}, {{body.end_at}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '创建会议室' }),
    route('custom', '会议列表', 'GET', '/rooms', 'LET $rows = QUERY SELECT r.id, r.room_no, r.title, r.status, r.start_at, COUNT(p.id) AS people FROM {{t:room}} r LEFT JOIN {{t:part}} p ON p.room_id = r.id GROUP BY r.id ORDER BY r.id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '进行中和历史会议' }),
    route('custom', '加入会议', 'POST', '/rooms/:id/join', 'LET $r = QUERY SELECT status FROM {{t:room}} WHERE id = {{id}} LIMIT 1;\nIF LEN($r.rows) == 0\n  RETURN 404 { "ok": false, "error": "NO_ROOM" };\nEND\nIF $r.rows[0].status != 1\n  RETURN 409 { "ok": false, "error": "ROOM_CLOSED" };\nEND\nEXEC INSERT INTO {{t:part}} (room_id, user_only_id) VALUES ({{id}}, {{user.onlyId}});\nRETURN 200 { "ok": true };', { auth: true, summary: '加入会议' }),
    route('custom', '离开会议', 'PUT', '/rooms/:id/leave', 'EXEC UPDATE {{t:part}} SET left_at = NOW() WHERE room_id = {{id}} AND user_only_id = {{user.onlyId}} AND left_at IS NULL;\nRETURN 200 { "ok": true };', { auth: true, summary: '离开会议' }),
    route('custom', '结束会议', 'PUT', '/rooms/:id/end', 'EXEC UPDATE {{t:room}} SET status = 0, end_at = NOW() WHERE id = {{id}} AND host_only_id = {{user.onlyId}};\nEXEC INSERT INTO {{t:min}} (room_id, summary) VALUES ({{id}}, {{body.summary}});\nRETURN 200 { "ok": true };', { auth: true, summary: '主持人结束会议并写纪要' }),
  ], { summary: '视频会议', description: '创建、加入、离开、结束，参会人数联查，纪要素材落库', tags: ['会议', '视频'] }),
]);

/* ---------------- CRM ---------------- */
cases.crm = project('CRM 客户服务', '客户、联系人、商机推进与阶段统计；一个客户可挂多个联系人', [
  { id: 'crm', name: '客户' }, { id: 'deal', name: '商机' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/crm', [userTable('crm_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '销售注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '销售登录' }),
  ], { summary: 'CRM 账户', description: '销售账户' }),
  iface('客户', 'crm', '/crm', [
    table('main', 'crm_customer', '客户', [pk(), field('name', 'varchar', { search: true }), field('phone', 'varchar', { search: true }), field('level', 'varchar', { default: 'B' }), field('owner_only_id', 'char'), field('remark', 'text'), created()]),
    table('contact', 'crm_contact', '联系人', [pk(), field('customer_id', 'bigint'), field('name', 'varchar', { search: true }), field('title', 'varchar'), field('phone', 'varchar')]),
    table('deal', 'crm_deal', '商机', [pk(), field('customer_id', 'bigint'), field('title', 'varchar'), money('amount'), field('stage', 'varchar', { default: 'lead' }), created()]),
  ], [
    route('custom', '客户列表', 'GET', '/customers', 'LET $rows = QUERY SELECT c.id, c.name, c.phone, c.level, COUNT(d.id) AS deals FROM {{t:main}} c LEFT JOIN {{t:deal}} d ON d.customer_id = c.id GROUP BY c.id ORDER BY c.id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '客户与商机数' }),
    route('custom', '新建客户', 'POST', '/customers', 'LET $ins = EXEC INSERT INTO {{t:main}} (name, phone, level, owner_only_id, remark) VALUES ({{body.name}}, {{body.phone}}, {{body.level}}, {{user.onlyId}}, {{body.remark}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '新建客户' }),
    route('custom', '客户详情', 'GET', '/customers/:id', 'LET $c = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nLET $ct = QUERY SELECT * FROM {{t:contact}} WHERE customer_id = {{id}};\nLET $d = QUERY SELECT * FROM {{t:deal}} WHERE customer_id = {{id}};\nRETURN 200 { "customer": $c.rows, "contacts": $ct.rows, "deals": $d.rows };', { auth: false, tx: false, summary: '客户 + 联系人 + 商机联查' }),
    route('custom', '添加联系人', 'POST', '/customers/:id/contacts', 'EXEC INSERT INTO {{t:contact}} (customer_id, name, title, phone) VALUES ({{id}}, {{body.name}}, {{body.title}}, {{body.phone}});\nRETURN 201 { "ok": true };', { auth: true, summary: '添加联系人' }),
    route('custom', '推进商机', 'POST', '/deals', 'EXEC INSERT INTO {{t:deal}} (customer_id, title, amount, stage) VALUES ({{body.customer_id}}, {{body.title}}, {{body.amount}}, {{body.stage}});\nRETURN 201 { "ok": true };', { auth: true, summary: '新建商机' }),
    route('custom', '阶段统计', 'GET', '/stats', 'LET $rows = QUERY SELECT stage, COUNT(*) AS n, SUM(amount) AS total FROM {{t:deal}} GROUP BY stage;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '按阶段汇总金额' }),
  ], { summary: '客户管理', description: '客户、联系人、商机、阶段统计', tags: ['CRM', '销售'] }),
]);

/* ---------------- 在线教育 ---------------- */
cases.edu = project('在线课程服务', '课程、课时、报名与学习进度；报名时事务校验名额', [
  { id: 'course', name: '课程' }, { id: 'learn', name: '学习' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/edu', [userTable('edu_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '学员注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '学员登录' }),
  ], { summary: '学员账户', description: '学员账户' }),
  iface('课程', 'course', '/edu', [
    table('main', 'edu_course', '课程', [pk(), field('title', 'varchar', { search: true }), field('teacher', 'varchar'), money('price'), field('seats', 'int', { default: '30' }), field('enrolled', 'int', { default: '0' }), field('status', 'tinyint', { default: '1' }), created()]),
    table('lesson', 'edu_lesson', '课时', [pk(), field('course_id', 'bigint'), field('title', 'varchar'), field('duration', 'int', { comment: '分钟' })]),
  ], [
    route('custom', '课程列表', 'GET', '/courses', 'LET $rows = QUERY SELECT id, title, teacher, price, seats, enrolled FROM {{t:main}} WHERE status = 1 ORDER BY id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '在售课程' }),
    route('custom', '课程详情', 'GET', '/courses/:id', 'LET $c = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nLET $l = QUERY SELECT * FROM {{t:lesson}} WHERE course_id = {{id}} ORDER BY id;\nRETURN 200 { "course": $c.rows, "lessons": $l.rows };', { auth: false, tx: false, summary: '课程与大钢' }),
    route('custom', '新建课程', 'POST', '/courses', 'LET $ins = EXEC INSERT INTO {{t:main}} (title, teacher, price, seats) VALUES ({{body.title}}, {{body.teacher}}, {{body.price}}, {{body.seats}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '新建课程' }),
    route('custom', '添加课时', 'POST', '/courses/:id/lessons', 'EXEC INSERT INTO {{t:lesson}} (course_id, title, duration) VALUES ({{id}}, {{body.title}}, {{body.duration}});\nRETURN 201 { "ok": true };', { auth: true, summary: '添加课时' }),
  ], { summary: '课程管理', description: '课程、课时、名额' }),
  iface('报名', 'learn', '/edu', [
    table('main', 'edu_enrollment', '报名', [pk(), field('course_id', 'bigint'), field('user_only_id', 'char'), field('progress', 'int', { default: '0' }), created()]),
    table('course', 'edu_course', '课程', [pk(), field('title', 'varchar'), field('seats', 'int'), field('enrolled', 'int')]),
  ], [
    route('custom', '报名', 'POST', '/courses/:id/enroll', 'LET $e = QUERY SELECT id FROM {{t:main}} WHERE course_id = {{id}} AND user_only_id = {{user.onlyId}} LIMIT 1;\nIF LEN($e.rows) > 0\n  RETURN 409 { "ok": false, "error": "ALREADY_ENROLLED" };\nEND\nLET $c = QUERY SELECT seats, enrolled FROM {{t:course}} WHERE id = {{id}} LIMIT 1;\nIF LEN($c.rows) == 0\n  RETURN 404 { "ok": false, "error": "NO_COURSE" };\nEND\nIF $c.rows[0].enrolled >= $c.rows[0].seats\n  RETURN 409 { "ok": false, "error": "FULL" };\nEND\nEXEC INSERT INTO {{t:main}} (course_id, user_only_id) VALUES ({{id}}, {{user.onlyId}});\nEXEC UPDATE {{t:course}} SET enrolled = enrolled + 1 WHERE id = {{id}};\nRETURN 201 { "ok": true };', { auth: true, summary: '报名（防重复/防超员）' }),
    route('custom', '我的课程', 'GET', '/my-courses', 'LET $rows = QUERY SELECT e.id, e.progress, c.title, c.teacher FROM {{t:main}} e JOIN {{t:course}} c ON c.id = e.course_id WHERE e.user_only_id = {{user.onlyId}};\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '我的报名' }),
    route('custom', '更新进度', 'PUT', '/enrollments/:id/progress', 'EXEC UPDATE {{t:main}} SET progress = {{body.progress}} WHERE id = {{id}} AND user_only_id = {{user.onlyId}};\nRETURN 200 { "ok": true };', { auth: true, summary: '学习进度' }),
  ], { summary: '报名与进度', description: '报名事务、名额校验、我的课程、进度', tags: ['教育', '报名'] }),
]);

/* ---------------- 餐饮点餐 ---------------- */
cases.restaurant = project('餐饮点餐服务', '菜单、桌台、开台、加菜、结账；订单金额在事务内累计', [
  { id: 'menu', name: '菜单' }, { id: 'order', name: '点餐' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/restaurant', [userTable('rest_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '店员注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '店员登录' }),
  ], { summary: '店员账户', description: '点餐系统账户' }),
  iface('菜单', 'menu', '/restaurant', [
    table('main', 'rest_dish', '菜品', [pk(), field('name', 'varchar', { search: true }), money('price'), field('category', 'varchar'), field('stock', 'int', { default: '100' }), field('status', 'tinyint', { default: '1' })]),
    table('table', 'rest_table', '桌台', [pk(), field('table_no', 'char'), field('seats', 'int'), field('status', 'tinyint', { default: '0' })]),
  ], [
    route('custom', '菜单', 'GET', '/dishes', 'LET $rows = QUERY SELECT id, name, price, category, stock FROM {{t:main}} WHERE status = 1 ORDER BY category, id;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '在售菜品' }),
    route('custom', '新增菜品', 'POST', '/dishes', 'LET $ins = EXEC INSERT INTO {{t:main}} (name, price, category, stock) VALUES ({{body.name}}, {{body.price}}, {{body.category}}, {{body.stock}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '新增菜品' }),
    route('custom', '新增桌台', 'POST', '/tables', 'LET $ins = EXEC INSERT INTO {{t:table}} (table_no, seats) VALUES ({{body.table_no}}, {{body.seats}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '新增桌台' }),
    route('custom', '桌台列表', 'GET', '/tables', 'LET $rows = QUERY SELECT * FROM {{t:table}} ORDER BY table_no;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '桌台状态' }),
    route('custom', '开台', 'POST', '/tables/:id/open', 'EXEC UPDATE {{t:table}} SET status = 1 WHERE id = {{id}} AND status = 0;\nRETURN 200 { "ok": true };', { auth: true, summary: '开台' }),
  ], { summary: '菜单与桌台', description: '菜品、桌台、开台' }),
  iface('点餐', 'order', '/restaurant', [
    table('main', 'rest_order', '订单', [pk(), field('table_id', 'bigint'), field('user_only_id', 'char'), money('total'), field('status', 'varchar', { default: 'open' }), created()]),
    table('item', 'rest_order_item', '明细', [pk(), field('order_id', 'bigint'), field('dish_id', 'bigint'), field('name', 'varchar'), money('price'), field('qty', 'int')]),
    table('dish', 'rest_dish', '菜品', [pk(), field('name', 'varchar'), field('price', 'decimal'), field('stock', 'int')]),
    table('tbl', 'rest_table', '桌台', [pk(), field('table_no', 'char'), field('seats', 'int'), field('status', 'tinyint', { default: '0' })]),
  ], [
    route('custom', '下单', 'POST', '/orders', 'LET $t = QUERY SELECT id FROM {{t:main}} WHERE table_id = {{body.table_id}} AND status = \'open\' LIMIT 1;\nLET $oid = 0;\nIF LEN($t.rows) > 0\n  SET $oid = $t.rows[0].id;\nELSE\n  LET $ins = EXEC INSERT INTO {{t:main}} (table_id, user_only_id, total) VALUES ({{body.table_id}}, {{user.onlyId}}, 0);\n  SET $oid = $ins.insertId;\nEND\nEXEC INSERT INTO {{t:item}} (order_id, dish_id, name, price, qty) VALUES ({{vars.oid}}, {{body.dish_id}}, {{body.name}}, {{body.price}}, {{body.qty}});\nEXEC UPDATE {{t:main}} SET total = total + {{body.price}} * {{body.qty}} WHERE id = {{vars.oid}};\nEXEC UPDATE {{t:dish}} SET stock = stock - {{body.qty}} WHERE id = {{body.dish_id}} AND stock >= {{body.qty}};\nRETURN 201 { "ok": true, "orderId": $oid };', { auth: true, summary: '加菜并累计金额（事务）' }),
    route('custom', '订单明细', 'GET', '/orders/:id', 'LET $o = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nLET $items = QUERY SELECT * FROM {{t:item}} WHERE order_id = {{id}};\nRETURN 200 { "order": $o.rows, "items": $items.rows };', { auth: true, tx: false, summary: '订单与明细联查' }),
    route('custom', '结账', 'PUT', '/orders/:id/checkout', 'EXEC UPDATE {{t:main}} SET status = \'paid\' WHERE id = {{id}} AND status = \'open\';\nEXEC UPDATE {{t:tbl}} SET status = 0 WHERE id = (SELECT table_id FROM {{t:main}} WHERE id = {{id}});\nRETURN 200 { "ok": true };', { auth: true, summary: '结账并释放桌台' }),
    route('custom', '后厨队列', 'GET', '/kitchen', 'LET $rows = QUERY SELECT i.id, i.name, i.qty, o.table_id, o.id AS order_id FROM {{t:item}} i JOIN {{t:main}} o ON o.id = i.order_id WHERE o.status = \'open\' ORDER BY i.id;\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '未结账菜品队列' }),
  ], { summary: '点餐与结账', description: '加菜累计金额、扣库存、结账释放桌台、后厨联查', tags: ['餐饮', '点餐'] }),
]);

/* ---------------- 物流 ---------------- */
cases.logistics = project('物流轨迹服务', '运单、轨迹节点、状态推进；按运单号联查全部节点', [
  { id: 'ship', name: '运单' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/logistics', [userTable('logi_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '网点注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '网点登录' }),
  ], { summary: '物流账户', description: '网点账户' }),
  iface('运单', 'ship', '/logistics', [
    table('main', 'logi_shipment', '运单', [pk(), field('tracking_no', 'char', { search: true }), field('sender', 'varchar'), field('receiver', 'varchar'), field('status', 'varchar', { default: 'created' }), created()]),
    table('track', 'logi_track', '轨迹', [pk(), field('shipment_id', 'bigint'), field('node', 'varchar'), field('detail', 'text'), created()]),
  ], [
    route('custom', '创建运单', 'POST', '/shipments', 'LET $ins = EXEC INSERT INTO {{t:main}} (tracking_no, sender, receiver) VALUES ({{body.tracking_no}}, {{body.sender}}, {{body.receiver}});\nEXEC INSERT INTO {{t:track}} (shipment_id, node, detail) VALUES ($ins.insertId, \'已揽收\', {{body.detail}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '创建运单并写首个节点' }),
    route('custom', '轨迹查询', 'GET', '/shipments/:no', 'LET $s = QUERY SELECT * FROM {{t:main}} WHERE tracking_no = {{path.no}} LIMIT 1;\nLET $t = QUERY SELECT node, detail, created_at FROM {{t:track}} WHERE shipment_id = (SELECT id FROM {{t:main}} WHERE tracking_no = {{path.no}}) ORDER BY id;\nRETURN 200 { "shipment": $s.rows, "tracks": $t.rows };', { auth: false, tx: false, summary: '按运单号联查轨迹' }),
    route('custom', '推进节点', 'POST', '/shipments/:id/track', 'EXEC INSERT INTO {{t:track}} (shipment_id, node, detail) VALUES ({{id}}, {{body.node}}, {{body.detail}});\nEXEC UPDATE {{t:main}} SET status = {{body.node}} WHERE id = {{id}};\nRETURN 201 { "ok": true };', { auth: true, summary: '追加轨迹节点' }),
    route('custom', '运单列表', 'GET', '/shipments', 'LET $rows = QUERY SELECT id, tracking_no, sender, receiver, status, created_at FROM {{t:main}} ORDER BY id DESC LIMIT 100;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '最近运单' }),
  ], { summary: '运单轨迹', description: '创建运单、追加节点、按运单号联查轨迹', tags: ['物流', '轨迹'] }),
]);

/* ---------------- 医疗挂号 ---------------- */
cases.hospital = project('预约挂号服务', '科室、医生、号源、挂号与取消；号源容量在事务内校验', [
  { id: 'dept', name: '科室' }, { id: 'appt', name: '挂号' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/hospital', [userTable('hosp_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '患者注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '患者登录' }),
  ], { summary: '患者账户', description: '患者账户' }),
  iface('科室', 'dept', '/hospital', [
    table('main', 'hosp_department', '科室', [pk(), field('name', 'varchar', { search: true }), field('floor', 'varchar'), field('phone', 'varchar')]),
    table('doc', 'hosp_doctor', '医生', [pk(), field('department_id', 'bigint'), field('name', 'varchar', { search: true }), field('title', 'varchar'), field('fee', 'decimal')]),
  ], [
    route('custom', '科室列表', 'GET', '/departments', 'LET $rows = QUERY SELECT * FROM {{t:main}} ORDER BY id;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '全部科室' }),
    route('custom', '新增科室', 'POST', '/departments', 'LET $ins = EXEC INSERT INTO {{t:main}} (name, floor, phone) VALUES ({{body.name}}, {{body.floor}}, {{body.phone}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '新增科室' }),
    route('custom', '科室医生', 'GET', '/departments/:id/doctors', 'LET $rows = QUERY SELECT * FROM {{t:doc}} WHERE department_id = {{id}} ORDER BY id;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '科室下医生' }),
    route('custom', '新增医生', 'POST', '/doctors', 'LET $ins = EXEC INSERT INTO {{t:doc}} (department_id, name, title, fee) VALUES ({{body.department_id}}, {{body.name}}, {{body.title}}, {{body.fee}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '新增医生' }),
  ], { summary: '科室与医生', description: '科室、医生、费用' }),
  iface('挂号', 'appt', '/hospital', [
    table('slot', 'hosp_slot', '号源', [pk(), field('doctor_id', 'bigint'), field('day', 'date'), field('capacity', 'int'), field('booked', 'int', { default: '0' })]),
    table('main', 'hosp_appointment', '挂号单', [pk(), field('slot_id', 'bigint'), field('patient_only_id', 'char'), field('status', 'varchar', { default: 'booked' }), created()]),
    table('doc', 'hosp_doctor', '医生', [pk(), field('name', 'varchar'), field('fee', 'decimal')]),
  ], [
    route('custom', '号源列表', 'GET', '/slots', 'LET $rows = QUERY SELECT s.id, s.day, s.capacity, s.booked, d.name AS doctor FROM {{t:slot}} s JOIN {{t:doc}} d ON d.id = s.doctor_id ORDER BY s.day, s.id;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '可挂号源' }),
    route('custom', '新增号源', 'POST', '/slots', 'LET $ins = EXEC INSERT INTO {{t:slot}} (doctor_id, day, capacity) VALUES ({{body.doctor_id}}, {{body.day}}, {{body.capacity}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '放号' }),
    route('custom', '挂号', 'POST', '/appointments', 'LET $s = QUERY SELECT capacity, booked FROM {{t:slot}} WHERE id = {{body.slot_id}} LIMIT 1;\nIF LEN($s.rows) == 0\n  RETURN 404 { "ok": false, "error": "NO_SLOT" };\nEND\nIF $s.rows[0].booked >= $s.rows[0].capacity\n  RETURN 409 { "ok": false, "error": "FULL" };\nEND\nEXEC INSERT INTO {{t:main}} (slot_id, patient_only_id) VALUES ({{body.slot_id}}, {{user.onlyId}});\nEXEC UPDATE {{t:slot}} SET booked = booked + 1 WHERE id = {{body.slot_id}};\nRETURN 201 { "ok": true };', { auth: true, summary: '挂号，防满号' }),
    route('custom', '我的挂号', 'GET', '/my-appointments', 'LET $rows = QUERY SELECT a.id, a.status, s.day, d.name AS doctor FROM {{t:main}} a JOIN {{t:slot}} s ON s.id = a.slot_id JOIN {{t:doc}} d ON d.id = s.doctor_id WHERE a.patient_only_id = {{user.onlyId}};\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '我的挂号单' }),
    route('custom', '取消挂号', 'PUT', '/appointments/:id/cancel', 'EXEC UPDATE {{t:main}} SET status = \'cancelled\' WHERE id = {{id}} AND patient_only_id = {{user.onlyId}} AND status = \'booked\';\nEXEC UPDATE {{t:slot}} SET booked = GREATEST(booked - 1, 0) WHERE id = (SELECT slot_id FROM {{t:main}} WHERE id = {{id}});\nRETURN 200 { "ok": true };', { auth: true, summary: '取消并释放号源' }),
  ], { summary: '预约挂号', description: '号源、挂号、取消释放、我的挂号联查', tags: ['医疗', '挂号'] }),
]);

/* ---------------- 财务报销 ---------------- */
cases.finance = project('费用报销服务', '员工提交报销、审批人通过/驳回、按分类汇总', [
  { id: 'exp', name: '报销' }, { id: 'appr', name: '审批' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/finance', [userTable('fin_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '员工注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '员工登录' }),
  ], { summary: '财务账户', description: '员工账户' }),
  iface('报销单', 'exp', '/finance', [
    table('main', 'fin_expense', '报销单', [pk(), field('user_only_id', 'char'), field('title', 'varchar', { search: true }), money('amount'), field('category', 'varchar'), field('status', 'varchar', { default: 'pending' }), field('invoice_key', 'varchar'), created()]),
    table('appr', 'fin_approval', '审批记录', [pk(), field('expense_id', 'bigint'), field('approver_only_id', 'char'), field('action', 'varchar'), field('comment', 'text'), created()]),
  ], [
    route('custom', '提交报销', 'POST', '/expenses', 'LET $ins = EXEC INSERT INTO {{t:main}} (user_only_id, title, amount, category, invoice_key) VALUES ({{user.onlyId}}, {{body.title}}, {{body.amount}}, {{body.category}}, {{body.invoice_key}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '提交报销单' }),
    route('custom', '我的报销', 'GET', '/my-expenses', 'LET $rows = QUERY SELECT id, title, amount, category, status, created_at FROM {{t:main}} WHERE user_only_id = {{user.onlyId}} ORDER BY id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '我的报销单' }),
    route('custom', '待审批', 'GET', '/pending', 'LET $rows = QUERY SELECT * FROM {{t:main}} WHERE status = \'pending\' ORDER BY id;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '待审批列表' }),
    route('custom', '审批', 'PUT', '/expenses/:id/approve', 'EXEC UPDATE {{t:main}} SET status = {{body.action}} WHERE id = {{id}} AND status = \'pending\';\nEXEC INSERT INTO {{t:appr}} (expense_id, approver_only_id, action, comment) VALUES ({{id}}, {{user.onlyId}}, {{body.action}}, {{body.comment}});\nRETURN 200 { "ok": true };', { auth: true, summary: '通过/驳回并留痕' }),
    route('custom', '分类统计', 'GET', '/stats', 'LET $rows = QUERY SELECT category, COUNT(*) AS n, SUM(amount) AS total FROM {{t:main}} WHERE status = \'approved\' GROUP BY category;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '已通过报销按分类汇总' }),
  ], { summary: '报销与审批', description: '提交、待审批、审批留痕、分类统计', tags: ['财务', '报销'] }),
]);

/* ---------------- IoT 设备 ---------------- */
cases.iot = project('IoT 设备监控服务', '设备注册、密钥校验、遥测上报、最新值、温度告警', [
  { id: 'dev', name: '设备' }, { id: 'data', name: '数据' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/iot', [userTable('iot_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '运维注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '运维登录' }),
  ], { summary: '运维账户', description: '运维账户' }),
  iface('设备', 'dev', '/iot', [
    table('main', 'iot_device', '设备', [pk(), field('device_no', 'char', { search: true }), field('name', 'varchar', { search: true }), field('secret_hash', 'varchar', { hidden: true }), field('status', 'tinyint', { default: '1' }), field('last_seen', 'datetime')]),
    table('tel', 'iot_telemetry', '遥测', [pk(), field('device_id', 'bigint'), field('temp', 'decimal'), field('humidity', 'decimal'), field('payload', 'json'), created()]),
  ], [
    route('custom', '注册设备', 'POST', '/devices', 'LET $ins = EXEC INSERT INTO {{t:main}} (device_no, name, secret_hash) VALUES ({{body.device_no}}, {{body.name}}, SM4_ENC({{body.secret}}, \'clickbuild-key\'));\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '注册设备并保存密钥摘要' }),
    route('custom', '上报遥测', 'POST', '/telemetry', 'LET $d = QUERY SELECT id, secret_hash FROM {{t:main}} WHERE device_no = {{body.device_no}} LIMIT 1;\nIF LEN($d.rows) == 0\n  RETURN 404 { "ok": false, "error": "NO_DEVICE" };\nEND\nIF SM4_DEC($d.rows[0].secret_hash, \'clickbuild-key\') != {{body.secret}}\n  RETURN 401 { "ok": false, "error": "BAD_SECRET" };\nEND\nEXEC INSERT INTO {{t:tel}} (device_id, temp, humidity, payload) VALUES ({{vars.d.rows.0.id}}, {{body.temp}}, {{body.humidity}}, {{body.payload}});\nEXEC UPDATE {{t:main}} SET last_seen = NOW() WHERE id = {{vars.d.rows.0.id}};\nRETURN 201 { "ok": true };', { auth: false, summary: '设备密钥校验后上报' }),
    route('custom', '设备列表', 'GET', '/devices', 'LET $rows = QUERY SELECT id, device_no, name, status, last_seen FROM {{t:main}} ORDER BY id;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '设备状态' }),
    route('custom', '最新遥测', 'GET', '/devices/:id/latest', 'LET $rows = QUERY SELECT temp, humidity, payload, created_at FROM {{t:tel}} WHERE device_id = {{id}} ORDER BY id DESC LIMIT 1;\nRETURN 200 { "latest": $rows.rows };', { auth: false, tx: false, summary: '最新一条遥测' }),
    route('custom', '温度告警', 'GET', '/alerts', 'LET $rows = QUERY SELECT d.name, t.temp, t.created_at FROM {{t:tel}} t JOIN {{t:main}} d ON d.id = t.device_id WHERE t.temp > {{query.temp}} ORDER BY t.id DESC LIMIT 100;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '按温度阈值筛选告警' }),
  ], { summary: '设备与遥测', description: '设备密钥、遥测、最新值、阈值告警', tags: ['IoT', '监控'] }),
]);

/* ---------------- 活动票务 ---------------- */
cases.event = project('活动票务服务', '活动发布、余票、购票事务、电子票核销', [
  { id: 'event', name: '活动' }, { id: 'ticket', name: '票务' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/events', [userTable('evt_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '购票人注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '购票人登录' }),
  ], { summary: '购票账户', description: '购票人账户' }),
  iface('活动', 'event', '/events', [
    table('main', 'evt_event', '活动', [pk(), field('title', 'varchar', { search: true }), field('venue', 'varchar'), field('start_at', 'datetime'), money('price'), field('stock', 'int'), field('status', 'tinyint', { default: '1' })]),
  ], [
    route('custom', '活动列表', 'GET', '/events', 'LET $rows = QUERY SELECT id, title, venue, start_at, price, stock FROM {{t:main}} WHERE status = 1 ORDER BY start_at;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '在售活动' }),
    route('custom', '发布活动', 'POST', '/events', 'LET $ins = EXEC INSERT INTO {{t:main}} (title, venue, start_at, price, stock) VALUES ({{body.title}}, {{body.venue}}, {{body.start_at}}, {{body.price}}, {{body.stock}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '发布活动' }),
  ], { summary: '活动管理', description: '活动、票价、库存' }),
  iface('购票', 'ticket', '/events', [
    table('main', 'evt_order', '订单', [pk(), field('event_id', 'bigint'), field('user_only_id', 'char'), field('qty', 'int'), money('total'), field('status', 'varchar', { default: 'paid' }), created()]),
    table('ticket', 'evt_ticket', '电子票', [pk(), field('order_id', 'bigint'), field('code', 'char', { search: true }), field('checked', 'tinyint', { default: '0' })]),
    table('event', 'evt_event', '活动', [pk(), field('price', 'decimal'), field('stock', 'int')]),
  ], [
    route('custom', '购票', 'POST', '/orders', 'LET $e = QUERY SELECT price, stock FROM {{t:event}} WHERE id = {{body.event_id}} LIMIT 1;\nIF LEN($e.rows) == 0\n  RETURN 404 { "ok": false, "error": "NO_EVENT" };\nEND\nIF $e.rows[0].stock < {{body.qty}}\n  RETURN 409 { "ok": false, "error": "SOLD_OUT" };\nEND\nLET $ins = EXEC INSERT INTO {{t:main}} (event_id, user_only_id, qty, total) VALUES ({{body.event_id}}, {{user.onlyId}}, {{body.qty}}, {{vars.e.rows.0.price}} * {{body.qty}});\nEXEC UPDATE {{t:event}} SET stock = stock - {{body.qty}} WHERE id = {{body.event_id}};\nEXEC INSERT INTO {{t:ticket}} (order_id, code) VALUES ($ins.insertId, {{onlyId}});\nRETURN 201 { "ok": true, "orderId": $ins.insertId };', { auth: true, summary: '购票扣库存并出票' }),
    route('custom', '我的票', 'GET', '/my-tickets', 'LET $rows = QUERY SELECT t.code, t.checked, o.qty, e.title, e.start_at FROM {{t:ticket}} t JOIN {{t:main}} o ON o.id = t.order_id JOIN {{t:event}} e ON e.id = o.event_id WHERE o.user_only_id = {{user.onlyId}};\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '我的电子票' }),
    route('custom', '核销', 'PUT', '/tickets/:code/checkin', 'EXEC UPDATE {{t:ticket}} SET checked = 1 WHERE code = {{path.code}} AND checked = 0;\nRETURN 200 { "ok": true };', { auth: false, summary: '扫码核销' }),
  ], { summary: '购票与核销', description: '事务购票、扣库存、出票、核销、我的票联查', tags: ['票务', '活动'] }),
]);

/* ---------------- 网课系统 ---------------- */
cases.netcourse = project('网课系统', '课程发布、课时、报名、学习进度、在线考试与成绩单；讲师和学员分表管理', [
  { id: 'nc', name: '课程' }, { id: 'learn', name: '学习' }, { id: 'sys', name: '账户' },
], [
  iface('账户', 'sys', '/netcourse', [userTable('nc_user')], [
    route('custom', '注册', 'POST', '/register', registerScript('users'), { auth: false, summary: '学员/讲师注册' }),
    route('custom', '登录', 'POST', '/login', loginScript('users'), { auth: false, summary: '登录签发 token' }),
  ], { summary: '网课账户', description: '学员与讲师账户' }),
  iface('课程', 'nc', '/netcourse', [
    table('main', 'nc_course', '课程', [pk(), field('title', 'varchar', { search: true }), field('teacher_only_id', 'char'), field('intro', 'text'), money('price'), field('status', 'varchar', { default: 'draft' }), field('lesson_count', 'int', { default: '0' }), field('views', 'int', { default: '0' }), created()]),
    table('lesson', 'nc_lesson', '课时', [pk(), field('course_id', 'bigint'), field('title', 'varchar', { search: true }), field('video_url', 'varchar'), field('duration', 'int'), field('sort', 'int', { default: '0' }), created()]),
  ], [
    route('custom', '创建课程', 'POST', '/courses', 'LET $ins = EXEC INSERT INTO {{t:main}} (title, teacher_only_id, intro, price) VALUES ({{body.title}}, {{user.onlyId}}, {{body.intro}}, {{body.price}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '讲师创建课程草稿' }),
    route('custom', '添加课时', 'POST', '/courses/:id/lessons', 'EXEC INSERT INTO {{t:lesson}} (course_id, title, video_url, duration, sort) VALUES ({{id}}, {{body.title}}, {{body.video_url}}, {{body.duration}}, {{body.sort}});\nEXEC UPDATE {{t:main}} SET lesson_count = lesson_count + 1 WHERE id = {{id}};\nRETURN 201 { "ok": true };', { auth: true, summary: '加课时并累计课时数' }),
    route('custom', '发布课程', 'PUT', '/courses/:id/publish', 'EXEC UPDATE {{t:main}} SET status = \'published\' WHERE id = {{id}} AND teacher_only_id = {{user.onlyId}};\nRETURN 200 { "ok": true };', { auth: true, summary: '讲师发布课程' }),
    route('custom', '课程列表', 'GET', '/courses', 'LET $rows = QUERY SELECT id, title, intro, price, lesson_count, views FROM {{t:main}} WHERE status = \'published\' ORDER BY id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '已发布课程' }),
    route('custom', '课程详情', 'GET', '/courses/:id', 'EXEC UPDATE {{t:main}} SET views = views + 1 WHERE id = {{id}};\nLET $c = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nLET $l = QUERY SELECT id, title, video_url, duration, sort FROM {{t:lesson}} WHERE course_id = {{id}} ORDER BY sort, id;\nRETURN 200 { "course": $c.rows, "lessons": $l.rows };', { auth: false, tx: false, summary: '课程详情 + 课时目录 + 播放计数' }),
  ], { summary: '课程与课时', description: '课程草稿、课时目录、发布、播放计数', tags: ['网课', '课程'] }),
  iface('学习', 'learn', '/netcourse', [
    table('enroll', 'nc_enroll', '报名', [pk(), field('course_id', 'bigint'), field('user_only_id', 'char'), field('progress', 'int', { default: '0' }), field('status', 'varchar', { default: 'learning' }), created()]),
    table('course', 'nc_course', '课程', [pk(), field('title', 'varchar'), money('price'), field('status', 'varchar')]),
    table('exam', 'nc_exam', '考试', [pk(), field('course_id', 'bigint'), field('user_only_id', 'char'), field('score', 'int'), field('passed', 'tinyint', { default: '0' }), created()]),
  ], [
    route('custom', '报名课程', 'POST', '/courses/:id/enroll', 'LET $c = QUERY SELECT id, status FROM {{t:course}} WHERE id = {{id}} LIMIT 1;\nIF LEN($c.rows) == 0\n  RETURN 404 { "ok": false, "error": "NO_COURSE" };\nEND\nIF $c.rows[0].status != \'published\'\n  RETURN 409 { "ok": false, "error": "NOT_PUBLISHED" };\nEND\nLET $e = QUERY SELECT id FROM {{t:enroll}} WHERE course_id = {{id}} AND user_only_id = {{user.onlyId}} LIMIT 1;\nIF LEN($e.rows) > 0\n  RETURN 409 { "ok": false, "error": "ALREADY_ENROLLED" };\nEND\nLET $ins = EXEC INSERT INTO {{t:enroll}} (course_id, user_only_id) VALUES ({{id}}, {{user.onlyId}});\nRETURN 201 { "ok": true, "enrollId": $ins.insertId };', { auth: true, summary: '报名（防重复）' }),
    route('custom', '我的课程', 'GET', '/my-courses', 'LET $rows = QUERY SELECT e.id, e.progress, e.status, c.title, c.price FROM {{t:enroll}} e JOIN {{t:course}} c ON c.id = e.course_id WHERE e.user_only_id = {{user.onlyId}};\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '学员已报名课程' }),
    route('custom', '更新进度', 'PUT', '/enrollments/:id/progress', 'EXEC UPDATE {{t:enroll}} SET progress = {{body.progress}} WHERE id = {{id}} AND user_only_id = {{user.onlyId}};\nRETURN 200 { "ok": true };', { auth: true, summary: '记录学习进度百分比' }),
    route('custom', '提交考试', 'POST', '/exams', 'LET $ins = EXEC INSERT INTO {{t:exam}} (course_id, user_only_id, score, passed) VALUES ({{body.course_id}}, {{user.onlyId}}, {{body.score}}, CASE WHEN {{body.score}} >= 60 THEN 1 ELSE 0 END);\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: true, summary: '提交分数，自动判定及格' }),
    route('custom', '我的成绩', 'GET', '/my-exams', 'LET $rows = QUERY SELECT x.id, x.score, x.passed, c.title FROM {{t:exam}} x JOIN {{t:course}} c ON c.id = x.course_id WHERE x.user_only_id = {{user.onlyId}};\nRETURN 200 { "rows": $rows.rows };', { auth: true, tx: false, summary: '成绩单联查课程' }),
  ], { summary: '报名与学习', description: '报名校验、进度、考试判分与成绩单', tags: ['网课', '学习', '考试'] }),
]);

/* ---------------- 装修报价 ---------------- */
cases.decoration = project('装修报价系统', '客户、面积、人工/材料单价、项目明细、折扣提交与审批；报价总额随明细累计', [
  { id: 'cust', name: '客户' }, { id: 'quote', name: '报价' },
], [
  iface('客户', 'cust', '/decoration', [
    table('main', 'deco_customer', '客户', [pk(), field('name', 'varchar', { search: true }), field('phone', 'varchar', { search: true }), field('address', 'varchar'), created()]),
  ], [
    route('custom', '新建客户', 'POST', '/customers', 'LET $ins = EXEC INSERT INTO {{t:main}} (name, phone, address) VALUES ({{body.name}}, {{body.phone}}, {{body.address}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: false, summary: '登记装修客户' }),
    route('custom', '客户列表', 'GET', '/customers', 'LET $rows = QUERY SELECT * FROM {{t:main}} ORDER BY id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '客户列表' }),
  ], { summary: '装修客户', description: '客户建档' }),
  iface('报价', 'quote', '/decoration', [
    table('main', 'deco_quote', '报价单', [pk(), field('customer_id', 'bigint'), field('title', 'varchar', { search: true }), field('area', 'decimal'), field('labor_rate', 'decimal'), field('material_rate', 'decimal'), field('discount', 'decimal', { default: '0' }), money('total'), field('status', 'varchar', { default: 'draft' }), created()]),
    table('item', 'deco_item', '项目明细', [pk(), field('quote_id', 'bigint'), field('name', 'varchar', { search: true }), field('spec', 'varchar'), field('unit', 'varchar'), field('qty', 'decimal'), field('unit_price', 'decimal'), money('amount'), created()]),
    table('cust', 'deco_customer', '客户', [pk(), field('name', 'varchar'), field('phone', 'varchar'), field('address', 'varchar')]),
  ], [
    route('custom', '新建报价', 'POST', '/quotes', 'LET $ins = EXEC INSERT INTO {{t:main}} (customer_id, title, area, labor_rate, material_rate, discount, total) VALUES ({{body.customer_id}}, {{body.title}}, {{body.area}}, {{body.labor_rate}}, {{body.material_rate}}, {{body.discount}}, {{body.area}} * ({{body.labor_rate}} + {{body.material_rate}}));\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: false, summary: '按面积和单价建立报价' }),
    route('custom', '添加项目', 'POST', '/quotes/:id/items', 'EXEC INSERT INTO {{t:item}} (quote_id, name, spec, unit, qty, unit_price, amount) VALUES ({{id}}, {{body.name}}, {{body.spec}}, {{body.unit}}, {{body.qty}}, {{body.unit_price}}, {{body.qty}} * {{body.unit_price}});\nEXEC UPDATE {{t:main}} SET total = total + {{body.qty}} * {{body.unit_price}} WHERE id = {{id}};\nRETURN 201 { "ok": true };', { auth: false, summary: '加项目并累计总额' }),
    route('custom', '折扣提交', 'PUT', '/quotes/:id/submit', 'EXEC UPDATE {{t:main}} SET total = ROUND(total * (1 - discount / 100), 2), status = \'submitted\' WHERE id = {{id}};\nRETURN 200 { "ok": true };', { auth: false, summary: '按折扣率结价并提交' }),
    route('custom', '报价详情', 'GET', '/quotes/:id', 'LET $q = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nLET $i = QUERY SELECT * FROM {{t:item}} WHERE quote_id = {{id}} ORDER BY id;\nLET $c = QUERY SELECT * FROM {{t:cust}} WHERE id = (SELECT customer_id FROM {{t:main}} WHERE id = {{id}}) LIMIT 1;\nRETURN 200 { "quote": $q.rows, "items": $i.rows, "customer": $c.rows };', { auth: false, tx: false, summary: '报价 + 明细 + 客户三表联查' }),
    route('custom', '报价列表', 'GET', '/quotes', 'LET $rows = QUERY SELECT q.id, q.title, q.area, q.total, q.status, c.name AS customer FROM {{t:main}} q LEFT JOIN {{t:cust}} c ON c.id = q.customer_id ORDER BY q.id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '报价列表联查客户' }),
    route('custom', '审批报价', 'PUT', '/quotes/:id/approve', 'EXEC UPDATE {{t:main}} SET status = \'approved\' WHERE id = {{id}} AND status = \'submitted\';\nRETURN 200 { "ok": true };', { auth: false, summary: '客户确认报价' }),
  ], { summary: '装修报价', description: '面积基价、项目明细、折扣、审批', tags: ['装修', '报价', '审批'] }),
]);

/* ---------------- 印刷报价 ---------------- */
cases.printing = project('印刷报价系统', '尺寸、数量、双面、纸价与制版费自动算价，后道工艺费逐项累加', [
  { id: 'prt', name: '印刷' },
], [
  iface('报价', 'prt', '/printing', [
    table('main', 'prt_quote', '印刷报价', [pk(), field('job_name', 'varchar', { search: true }), field('paper', 'varchar'), field('width', 'decimal'), field('height', 'decimal'), field('qty', 'int'), field('sides', 'int', { default: '1' }), field('unit_price', 'decimal'), field('plate_fee', 'decimal', { default: '0' }), field('process_fee', 'decimal', { default: '0' }), money('total'), field('status', 'varchar', { default: 'draft' }), created()]),
    table('proc', 'prt_process', '后道工艺', [pk(), field('quote_id', 'bigint'), field('name', 'varchar', { search: true }), field('fee', 'decimal'), created()]),
  ], [
    route('custom', '新建报价', 'POST', '/quotes', 'LET $ins = EXEC INSERT INTO {{t:main}} (job_name, paper, width, height, qty, sides, unit_price, plate_fee, total) VALUES ({{body.job_name}}, {{body.paper}}, {{body.width}}, {{body.height}}, {{body.qty}}, {{body.sides}}, {{body.unit_price}}, {{body.plate_fee}}, ROUND({{body.width}} * {{body.height}} / 10000 * {{body.qty}} * {{body.sides}} * {{body.unit_price}} + {{body.plate_fee}}, 2));\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: false, summary: '按面积/数量/双面/制版费算价' }),
    route('custom', '添加工艺', 'POST', '/quotes/:id/processes', 'EXEC INSERT INTO {{t:proc}} (quote_id, name, fee) VALUES ({{id}}, {{body.name}}, {{body.fee}});\nEXEC UPDATE {{t:main}} SET process_fee = process_fee + {{body.fee}}, total = total + {{body.fee}} WHERE id = {{id}};\nRETURN 201 { "ok": true };', { auth: false, summary: '后道工艺累加' }),
    route('custom', '报价列表', 'GET', '/quotes', 'LET $rows = QUERY SELECT id, job_name, paper, qty, total, status FROM {{t:main}} ORDER BY id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '印刷报价列表' }),
    route('custom', '报价详情', 'GET', '/quotes/:id', 'LET $q = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nLET $p = QUERY SELECT * FROM {{t:proc}} WHERE quote_id = {{id}};\nRETURN 200 { "quote": $q.rows, "processes": $p.rows };', { auth: false, tx: false, summary: '报价 + 后道工艺联查' }),
    route('custom', '确认报价', 'PUT', '/quotes/:id/submit', 'EXEC UPDATE {{t:main}} SET status = \'quoted\' WHERE id = {{id}};\nRETURN 200 { "ok": true };', { auth: false, summary: '业务员提交报价' }),
    route('custom', '成交', 'PUT', '/quotes/:id/approve', 'EXEC UPDATE {{t:main}} SET status = \'approved\' WHERE id = {{id}} AND status = \'quoted\';\nRETURN 200 { "ok": true };', { auth: false, summary: '客户确认成交' }),
  ], { summary: '印刷报价', description: '面积/数量/双面/制版/后道', tags: ['印刷', '报价', '制造'] }),
]);

/* ---------------- 软件项目报价 ---------------- */
cases.softquote = project('软件项目报价系统', '客户、人天单价、模块工作量、折扣与版本报价；模块金额自动汇总到项目', [
  { id: 'client', name: '客户' }, { id: 'proj', name: '项目' },
], [
  iface('客户', 'client', '/softquote', [
    table('main', 'soft_client', '客户', [pk(), field('name', 'varchar', { search: true }), field('contact', 'varchar'), field('phone', 'varchar'), created()]),
  ], [
    route('custom', '新建客户', 'POST', '/clients', 'LET $ins = EXEC INSERT INTO {{t:main}} (name, contact, phone) VALUES ({{body.name}}, {{body.contact}}, {{body.phone}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: false, summary: '登记客户' }),
    route('custom', '客户列表', 'GET', '/clients', 'LET $rows = QUERY SELECT * FROM {{t:main}} ORDER BY id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '客户列表' }),
  ], { summary: '软件客户', description: '客户档案' }),
  iface('项目', 'proj', '/softquote', [
    table('main', 'soft_project', '项目', [pk(), field('client_id', 'bigint'), field('name', 'varchar', { search: true }), field('requirement', 'text'), field('rate_per_day', 'decimal'), field('discount', 'decimal', { default: '0' }), money('total'), field('status', 'varchar', { default: 'draft' }), created()]),
    table('mod', 'soft_module', '模块', [pk(), field('project_id', 'bigint'), field('name', 'varchar', { search: true }), field('days', 'decimal'), money('amount'), created()]),
    table('client', 'soft_client', '客户', [pk(), field('name', 'varchar'), field('contact', 'varchar'), field('phone', 'varchar')]),
  ], [
    route('custom', '新建项目', 'POST', '/projects', 'LET $ins = EXEC INSERT INTO {{t:main}} (client_id, name, requirement, rate_per_day, discount, total) VALUES ({{body.client_id}}, {{body.name}}, {{body.requirement}}, {{body.rate_per_day}}, {{body.discount}}, 0);\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: false, summary: '按人天单价立项' }),
    route('custom', '添加模块', 'POST', '/projects/:id/modules', 'LET $p = QUERY SELECT rate_per_day FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nIF LEN($p.rows) == 0\n  RETURN 404 { "ok": false, "error": "NO_PROJECT" };\nEND\nEXEC INSERT INTO {{t:mod}} (project_id, name, days, amount) VALUES ({{id}}, {{body.name}}, {{body.days}}, {{body.days}} * {{vars.p.rows.0.rate_per_day}});\nEXEC UPDATE {{t:main}} SET total = total + {{body.days}} * {{vars.p.rows.0.rate_per_day}} WHERE id = {{id}};\nRETURN 201 { "ok": true };', { auth: false, summary: '模块工作量自动计价并汇总' }),
    route('custom', '折扣提交', 'PUT', '/projects/:id/submit', 'EXEC UPDATE {{t:main}} SET total = ROUND(total * (1 - discount / 100), 2), status = \'quoted\' WHERE id = {{id}};\nRETURN 200 { "ok": true };', { auth: false, summary: '按折扣率生成报价' }),
    route('custom', '项目详情', 'GET', '/projects/:id', 'LET $p = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nLET $m = QUERY SELECT * FROM {{t:mod}} WHERE project_id = {{id}} ORDER BY id;\nLET $c = QUERY SELECT * FROM {{t:client}} WHERE id = (SELECT client_id FROM {{t:main}} WHERE id = {{id}}) LIMIT 1;\nRETURN 200 { "project": $p.rows, "modules": $m.rows, "client": $c.rows };', { auth: false, tx: false, summary: '项目 + 模块 + 客户联查' }),
    route('custom', '项目列表', 'GET', '/projects', 'LET $rows = QUERY SELECT p.id, p.name, p.total, p.status, c.name AS client FROM {{t:main}} p LEFT JOIN {{t:client}} c ON c.id = p.client_id ORDER BY p.id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '项目报价列表' }),
    route('custom', '成交', 'PUT', '/projects/:id/approve', 'EXEC UPDATE {{t:main}} SET status = \'approved\' WHERE id = {{id}} AND status = \'quoted\';\nRETURN 200 { "ok": true };', { auth: false, summary: '客户确认项目报价' }),
  ], { summary: '软件报价', description: '人天、模块、折扣、成交', tags: ['软件', '报价', '项目'] }),
]);

/* ---------------- 货运报价 ---------------- */
cases.freight = project('货运报价系统', '线路基价 + 公斤价，按体积重与实际重取大计费；报价单可确认成交', [
  { id: 'route', name: '线路' }, { id: 'quote', name: '报价' },
], [
  iface('线路', 'route', '/freight', [
    table('main', 'fr_route', '线路', [pk(), field('origin', 'varchar', { search: true }), field('destination', 'varchar', { search: true }), money('base_price'), money('price_per_kg'), field('volume_ratio', 'int', { default: '167' }), field('active', 'tinyint', { default: '1' }), created()]),
  ], [
    route('custom', '新增线路', 'POST', '/routes', 'LET $ins = EXEC INSERT INTO {{t:main}} (origin, destination, base_price, price_per_kg, volume_ratio) VALUES ({{body.origin}}, {{body.destination}}, {{body.base_price}}, {{body.price_per_kg}}, {{body.volume_ratio}});\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: false, summary: '维护线路运价' }),
    route('custom', '线路列表', 'GET', '/routes', 'LET $rows = QUERY SELECT * FROM {{t:main}} WHERE active = 1 ORDER BY id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '在营线路' }),
  ], { summary: '货运线路', description: '线路基价与公斤价' }),
  iface('报价', 'quote', '/freight', [
    table('main', 'fr_quote', '货运报价', [pk(), field('customer_name', 'varchar', { search: true }), field('phone', 'varchar'), field('route_id', 'bigint'), field('weight', 'decimal'), field('volume', 'decimal'), field('chargeable', 'decimal'), money('total'), field('status', 'varchar', { default: 'draft' }), created()]),
    table('route', 'fr_route', '线路', [pk(), field('origin', 'varchar'), field('destination', 'varchar'), money('base_price'), money('price_per_kg'), field('volume_ratio', 'int'), field('active', 'tinyint')]),
  ], [
    route('custom', '创建报价', 'POST', '/quotes', 'LET $ins = EXEC INSERT INTO {{t:main}} (customer_name, phone, route_id, weight, volume, chargeable, total) SELECT {{body.customer_name}}, {{body.phone}}, id, {{body.weight}}, {{body.volume}}, GREATEST({{body.weight}}, {{body.volume}} * volume_ratio), base_price + GREATEST({{body.weight}}, {{body.volume}} * volume_ratio) * price_per_kg FROM {{t:route}} WHERE id = {{body.route_id}} AND active = 1;\nRETURN 201 { "ok": true, "id": $ins.insertId };', { auth: false, summary: '体积重/实重取大自动计费' }),
    route('custom', '报价列表', 'GET', '/quotes', 'LET $rows = QUERY SELECT q.id, q.customer_name, q.chargeable, q.total, q.status, r.origin, r.destination FROM {{t:main}} q JOIN {{t:route}} r ON r.id = q.route_id ORDER BY q.id DESC;\nRETURN 200 { "rows": $rows.rows };', { auth: false, tx: false, summary: '报价联查线路' }),
    route('custom', '报价详情', 'GET', '/quotes/:id', 'LET $q = QUERY SELECT * FROM {{t:main}} WHERE id = {{id}} LIMIT 1;\nLET $r = QUERY SELECT * FROM {{t:route}} WHERE id = (SELECT route_id FROM {{t:main}} WHERE id = {{id}}) LIMIT 1;\nRETURN 200 { "quote": $q.rows, "route": $r.rows };', { auth: false, tx: false, summary: '报价 + 线路' }),
    route('custom', '确认报价', 'PUT', '/quotes/:id/approve', 'EXEC UPDATE {{t:main}} SET status = \'approved\' WHERE id = {{id}} AND status = \'draft\';\nRETURN 200 { "ok": true };', { auth: false, summary: '客户确认运价' }),
  ], { summary: '货运报价', description: '实重/体积重、基价+公斤价', tags: ['物流', '货运', '报价'] }),
]);

for (const [name, p] of Object.entries(cases)) {
  const normalized = spec.normalizeProject(p);
  const v = spec.validateProject(normalized);
  if (!v.ok) throw new Error(`${name} 校验失败：${v.errors.join(' | ')}`);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  console.log(`wrote ${name}.json  ${normalized.interfaces.length} 接口 / ${normalized.interfaces.reduce((n, i) => n + i.routes.length, 0)} 路由`);
}
