'use strict';

// 行业案例真实 HTTP 回归：逐个生成、启动独立数据库与端口、调用真实接口，再停掉。
// 用法：runtime\node\node.exe tools/e2e-cases.js
// 前置：MariaDB / Redis / RustFS 已启动（端口 13306 / 16379 / 19000）。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const templates = require('../app/iface/templates');
const plugins = require('../app/iface/plugins');
const codegen = require('../app/iface/codegen');

const NODE = path.join(__dirname, '..', 'runtime', 'node', 'node.exe');
const NODE_PATH = path.join(__dirname, '..', 'node_modules');
const ROOT = path.join(os.tmpdir(), 'clickbuild-case-test');
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(base, method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await r.json(); } catch (e) { data = {}; }
  const payload = data && data.data && typeof data.data === 'object' ? data.data : data;
  return { status: r.status, raw: data, data: payload || {} };
}
const tokenOf = (r) => (r.data && r.data.token) || '';

async function startCase(c, idx) {
  const dir = path.join(ROOT, c.name);
  fs.mkdirSync(dir, { recursive: true });
  const tpl = templates.get(c.id);
  const ap = plugins.apply(tpl.project);
  codegen.writeTo(ap.project, dir, { port: 18420 + idx });
  const db = `clickbuild_case_${c.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`.slice(0, 60);
  const child = spawn(NODE, ['server.js'], {
    cwd: dir,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_PATH, PORT: String(18420 + idx), MYSQL_DB: db, RESET_DB: '1',
      CACHE_PREFIX: `icb:cache:case:${c.name}`,
    },
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const base = `http://127.0.0.1:${18420 + idx}`;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const h = await req(base, 'GET', '/_health');
      if (h.status === 200) return { child, base, log, db, dir };
    } catch (e) { /* retry */ }
  }
  child.kill();
  throw new Error(`服务未启动：${log.join('').slice(-600)}`);
}

function stopCase(s) {
  return new Promise((resolve) => {
    if (!s || !s.child || s.child.killed) return resolve();
    s.child.once('close', () => resolve());
    s.child.kill();
    setTimeout(resolve, 3000);
  });
}

const flows = {
  async chat(base) {
    let r = await req(base, 'POST', '/chat/register', { username: 'alice', password: '123456', display_name: 'Alice' });
    check('聊天：注册发 token', r.status === 201 && !!tokenOf(r));
    const token = tokenOf(r);
    r = await req(base, 'POST', '/chat/register', { username: 'bob', password: '123456', display_name: 'Bob' });
    check('聊天：第二个用户注册', r.status === 201 && !!tokenOf(r));
    const bobToken = tokenOf(r);
    const bobId = r.data.onlyId;
    r = await req(base, 'POST', '/chat/messages', { to: bobId, body: '你好，Bob', msg_type: 'text' }, token);
    check('聊天：发送消息并建会话', r.status === 201 && Number(r.data.convId) > 0, JSON.stringify(r.data));
    r = await req(base, 'GET', '/chat/messages', undefined, bobToken);
    check('聊天：收件箱可读', r.status === 200 && (r.data.rows || []).length === 1);
    r = await req(base, 'GET', '/chat/unread', undefined, bobToken);
    check('聊天：未读数为 1', r.status === 200 && Number(r.data.unread) === 1);
    const msg = (await req(base, 'GET', '/chat/messages', undefined, bobToken)).data.rows[0];
    await req(base, 'PUT', `/chat/messages/${msg.id}/read`, undefined, bobToken);
    r = await req(base, 'GET', '/chat/unread', undefined, bobToken);
    check('聊天：已读后未读归零', Number(r.data.unread) === 0);
    r = await req(base, 'GET', '/chat/conversations', undefined, token);
    check('聊天：会话列表联查', r.status === 200 && (r.data.rows || []).length === 1);
  },
  async meeting(base) {
    let r = await req(base, 'POST', '/meeting/register', { username: 'host', password: '123456', display_name: '主持人' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/meeting/rooms', { room_no: 'M-001', title: '周会', start_at: '2026-11-20 10:00:00', end_at: '2026-11-20 11:00:00' }, token);
    check('会议：创建会议室', r.status === 201 && Number(r.data.id) > 0);
    const id = r.data.id;
    r = await req(base, 'POST', `/meeting/rooms/${id}/join`, {}, token);
    check('会议：加入', r.status === 200);
    r = await req(base, 'GET', '/meeting/rooms');
    check('会议：列表人数联查', r.status === 200 && (r.data.rows || [])[0] && Number(r.data.rows[0].people) === 1);
    r = await req(base, 'PUT', `/meeting/rooms/${id}/leave`, {}, token);
    check('会议：离开', r.status === 200);
    r = await req(base, 'PUT', `/meeting/rooms/${id}/end`, { summary: '完成了评审' }, token);
    check('会议：结束并写纪要', r.status === 200);
  },
  async crm(base) {
    let r = await req(base, 'POST', '/crm/register', { username: 'sales', password: '123456', display_name: '销售' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/crm/customers', { name: '云海科技', phone: '13800000000', level: 'A', remark: '重点客户' }, token);
    check('CRM：新建客户', r.status === 201 && Number(r.data.id) > 0);
    const cid = r.data.id;
    r = await req(base, 'POST', `/crm/customers/${cid}/contacts`, { name: '王工', title: 'CTO', phone: '13900000000' }, token);
    check('CRM：添加联系人', r.status === 201);
    r = await req(base, 'POST', '/crm/deals', { customer_id: cid, title: '年度框架', amount: 120000, stage: 'proposal' }, token);
    check('CRM：新建商机', r.status === 201);
    r = await req(base, 'GET', `/crm/customers/${cid}`);
    check('CRM：客户详情三表联查', r.status === 200 && r.data.contacts.length === 1 && r.data.deals.length === 1);
    r = await req(base, 'GET', '/crm/stats');
    check('CRM：阶段金额统计', r.status === 200 && r.data.rows[0].stage === 'proposal' && Number(r.data.rows[0].total) === 120000);
  },
  async edu(base) {
    let r = await req(base, 'POST', '/edu/register', { username: 'stu', password: '123456', display_name: '学生' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/edu/courses', { title: 'SQL 实战', teacher: '张老师', price: 199, seats: 2 }, token);
    check('教育：新建课程', r.status === 201);
    const cid = r.data.id;
    r = await req(base, 'POST', `/edu/courses/${cid}/lessons`, { title: '第一课', duration: 45 }, token);
    check('教育：添加课时', r.status === 201);
    r = await req(base, 'POST', `/edu/courses/${cid}/enroll`, {}, token);
    check('教育：报名成功', r.status === 201);
    r = await req(base, 'POST', `/edu/courses/${cid}/enroll`, {}, token);
    check('教育：重复报名被拒', r.status === 409);
    r = await req(base, 'GET', '/edu/my-courses', undefined, token);
    check('教育：我的课程联查', r.status === 200 && r.data.rows.length === 1);
    const eid = r.data.rows[0].id;
    r = await req(base, 'PUT', `/edu/enrollments/${eid}/progress`, { progress: 60 }, token);
    check('教育：更新进度', r.status === 200);
  },
  async restaurant(base) {
    let r = await req(base, 'POST', '/restaurant/register', { username: 'waiter', password: '123456', display_name: '服务员' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/restaurant/dishes', { name: '宫保鸡丁', price: 38, category: '热菜', stock: 20 }, token);
    check('餐饮：新增菜品', r.status === 201);
    const dish = r.data.id;
    r = await req(base, 'POST', '/restaurant/tables', { table_no: 'A01', seats: 4 }, token);
    check('餐饮：新增桌台', r.status === 201);
    const table = r.data.id;
    await req(base, 'POST', `/restaurant/tables/${table}/open`, {}, token);
    r = await req(base, 'POST', '/restaurant/orders', { table_id: table, dish_id: dish, name: '宫保鸡丁', price: 38, qty: 2 }, token);
    check('餐饮：加菜并累计金额', r.status === 201 && Number(r.data.orderId) > 0);
    const oid = r.data.orderId;
    r = await req(base, 'GET', `/restaurant/orders/${oid}`, undefined, token);
    check('餐饮：订单明细与金额', r.status === 200 && Number(r.data.order[0].total) === 76 && r.data.items.length === 1);
    r = await req(base, 'GET', '/restaurant/kitchen', undefined, token);
    check('餐饮：后厨队列联查', r.status === 200 && r.data.rows.length === 1);
    r = await req(base, 'PUT', `/restaurant/orders/${oid}/checkout`, {}, token);
    check('餐饮：结账释放桌台', r.status === 200, JSON.stringify(r.raw).slice(0, 300));
  },
  async logistics(base) {
    let r = await req(base, 'POST', '/logistics/register', { username: 'station', password: '123456', display_name: '网点' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/logistics/shipments', { tracking_no: 'SF123456', sender: '昆明', receiver: '上海', detail: '已揽收' }, token);
    check('物流：创建运单', r.status === 201);
    r = await req(base, 'GET', '/logistics/shipments/SF123456');
    check('物流：按单号查轨迹', r.status === 200 && r.data.tracks.length === 1);
    const id = r.data.shipment[0].id;
    r = await req(base, 'POST', `/logistics/shipments/${id}/track`, { node: '运输中', detail: '到达杭州' }, token);
    check('物流：追加轨迹', r.status === 201);
    r = await req(base, 'GET', '/logistics/shipments/SF123456');
    check('物流：轨迹更新为两条', r.data.tracks.length === 2 && r.data.shipment[0].status === '运输中');
  },
  async hospital(base) {
    let r = await req(base, 'POST', '/hospital/register', { username: 'patient', password: '123456', display_name: '患者' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/hospital/departments', { name: '内科', floor: '3F', phone: '0871-1234' }, token);
    check('医疗：新增科室', r.status === 201);
    const dept = r.data.id;
    r = await req(base, 'POST', '/hospital/doctors', { department_id: dept, name: '李医生', title: '主任', fee: 20 }, token);
    check('医疗：新增医生', r.status === 201);
    const doc = r.data.id;
    r = await req(base, 'POST', '/hospital/slots', { doctor_id: doc, day: '2026-11-22', capacity: 2 }, token);
    check('医疗：放号', r.status === 201);
    const slot = r.data.id;
    r = await req(base, 'POST', '/hospital/appointments', { slot_id: slot }, token);
    check('医疗：挂号成功', r.status === 201);
    r = await req(base, 'GET', '/hospital/my-appointments', undefined, token);
    check('医疗：我的挂号联查', r.status === 200 && r.data.rows.length === 1);
    const ap = r.data.rows[0].id;
    r = await req(base, 'PUT', `/hospital/appointments/${ap}/cancel`, {}, token);
    check('医疗：取消释放号源', r.status === 200);
  },
  async finance(base) {
    let r = await req(base, 'POST', '/finance/register', { username: 'staff', password: '123456', display_name: '员工' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/finance/expenses', { title: '差旅费', amount: 880.5, category: '交通', invoice_key: 'inv-1' }, token);
    check('财务：提交报销', r.status === 201);
    const id = r.data.id;
    r = await req(base, 'GET', '/finance/pending');
    check('财务：待审批列表', r.status === 200 && r.data.rows.length === 1);
    r = await req(base, 'PUT', `/finance/expenses/${id}/approve`, { action: 'approved', comment: '同意' }, token);
    check('财务：审批留痕', r.status === 200);
    r = await req(base, 'GET', '/finance/stats');
    check('财务：分类汇总', r.status === 200 && Number(r.data.rows[0].total) === 880.5);
  },
  async iot(base) {
    let r = await req(base, 'POST', '/iot/register', { username: 'ops', password: '123456', display_name: '运维' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/iot/devices', { device_no: 'DEV-001', name: '温控器', secret: 's3cret' }, token);
    check('IoT：注册设备', r.status === 201);
    const id = r.data.id;
    r = await req(base, 'POST', '/iot/telemetry', { device_no: 'DEV-001', secret: 'bad', temp: 31, humidity: 50, payload: '{}' });
    check('IoT：错误密钥被拒', r.status === 401);
    r = await req(base, 'POST', '/iot/telemetry', { device_no: 'DEV-001', secret: 's3cret', temp: 31, humidity: 50, payload: '{"ok":true}' });
    check('IoT：正确密钥上报', r.status === 201);
    r = await req(base, 'GET', `/iot/devices/${id}/latest`);
    check('IoT：最新遥测', r.status === 200 && Number(r.data.latest[0].temp) === 31);
    r = await req(base, 'GET', '/iot/alerts?temp=28');
    check('IoT：温度告警联查', r.status === 200 && r.data.rows.length === 1);
  },
  async event(base) {
    let r = await req(base, 'POST', '/events/register', { username: 'buyer', password: '123456', display_name: '购票人' });
    const token = tokenOf(r);
    r = await req(base, 'POST', '/events/events', { title: '昆明音乐节', venue: '滇池广场', start_at: '2026-12-01 19:00:00', price: 188, stock: 100 }, token);
    check('票务：发布活动', r.status === 201);
    const id = r.data.id;
    r = await req(base, 'POST', '/events/orders', { event_id: id, qty: 2 }, token);
    check('票务：购票扣库存出票', r.status === 201 && Number(r.data.orderId) > 0);
    r = await req(base, 'GET', '/events/my-tickets', undefined, token);
    check('票务：我的电子票', r.status === 200 && r.data.rows.length === 1);
    const code = r.data.rows[0].code;
    r = await req(base, 'PUT', `/events/tickets/${code}/checkin`, {});
    check('票务：核销', r.status === 200);
    r = await req(base, 'GET', '/events/my-tickets', undefined, token);
    check('票务：核销状态回写', Number(r.data.rows[0].checked) === 1);
  },
  async netcourse(base) {
    let r = await req(base, 'POST', '/netcourse/register', { username: 'teacher', password: '123456', display_name: '讲师' });
    const teacher = tokenOf(r);
    r = await req(base, 'POST', '/netcourse/courses', { title: 'Rust 入门', intro: '从零开始', price: 199 }, teacher);
    check('网课：创建课程', r.status === 201 && Number(r.data.id) > 0);
    const cid = r.data.id;
    r = await req(base, 'POST', `/netcourse/courses/${cid}/lessons`, { title: '第一课', video_url: 'https://v.example/1.mp4', duration: 30, sort: 1 }, teacher);
    check('网课：添加课时一', r.status === 201);
    r = await req(base, 'POST', `/netcourse/courses/${cid}/lessons`, { title: '第二课', video_url: 'https://v.example/2.mp4', duration: 45, sort: 2 }, teacher);
    check('网课：添加课时二', r.status === 201);
    r = await req(base, 'PUT', `/netcourse/courses/${cid}/publish`, {}, teacher);
    check('网课：发布课程', r.status === 200);
    r = await req(base, 'GET', '/netcourse/courses');
    check('网课：课程列表', r.status === 200 && r.data.rows.length === 1);
    r = await req(base, 'GET', `/netcourse/courses/${cid}`);
    check('网课：课程详情与课时目录', r.status === 200 && r.data.lessons.length === 2);
    r = await req(base, 'POST', '/netcourse/register', { username: 'learner', password: '123456', display_name: '学员' });
    const learner = tokenOf(r);
    r = await req(base, 'POST', `/netcourse/courses/${cid}/enroll`, {}, learner);
    check('网课：报名', r.status === 201 && Number(r.data.enrollId) > 0);
    const eid = r.data.enrollId;
    r = await req(base, 'POST', `/netcourse/courses/${cid}/enroll`, {}, learner);
    check('网课：重复报名被拒', r.status === 409);
    r = await req(base, 'GET', '/netcourse/my-courses', undefined, learner);
    check('网课：我的课程', r.status === 200 && r.data.rows.length === 1);
    r = await req(base, 'PUT', `/netcourse/enrollments/${eid}/progress`, { progress: 60 }, learner);
    check('网课：更新进度', r.status === 200);
    r = await req(base, 'POST', '/netcourse/exams', { course_id: cid, score: 80 }, learner);
    check('网课：提交考试自动判分', r.status === 201);
    r = await req(base, 'GET', '/netcourse/my-exams', undefined, learner);
    check('网课：成绩单', r.status === 200 && Number(r.data.rows[0].passed) === 1);
  },
  async decoration(base) {
    let r = await req(base, 'POST', '/decoration/customers', { name: '张先生', phone: '13800000000', address: '昆明市五华区' });
    check('装修：新建客户', r.status === 201 && Number(r.data.id) > 0);
    const customer = r.data.id;
    r = await req(base, 'POST', '/decoration/quotes', { customer_id: customer, title: '三居室整装', area: 100, labor_rate: 80, material_rate: 120, discount: 5 });
    check('装修：新建报价', r.status === 201 && Number(r.data.id) > 0);
    const qid = r.data.id;
    r = await req(base, 'POST', `/decoration/quotes/${qid}/items`, { name: '墙面乳胶漆', spec: '立邦', unit: '㎡', qty: 10, unit_price: 50 });
    check('装修：添加项目并累计', r.status === 201);
    r = await req(base, 'PUT', `/decoration/quotes/${qid}/submit`, {});
    check('装修：折扣提交', r.status === 200);
    r = await req(base, 'GET', `/decoration/quotes/${qid}`);
    check('装修：三表联查', r.status === 200 && r.data.items.length === 1 && Number(r.data.quote[0].total) === 19475);
    r = await req(base, 'PUT', `/decoration/quotes/${qid}/approve`, {});
    check('装修：审批报价', r.status === 200);
    r = await req(base, 'GET', '/decoration/quotes');
    check('装修：报价列表联查客户', r.status === 200 && r.data.rows[0].status === 'approved');
  },
  async printing(base) {
    let r = await req(base, 'POST', '/printing/quotes', { job_name: '画册印刷', paper: '铜版纸', width: 210, height: 297, qty: 1000, sides: 2, unit_price: 0.8, plate_fee: 200 });
    check('印刷：自动算价', r.status === 201 && Number(r.data.id) > 0);
    const qid = r.data.id;
    r = await req(base, 'GET', `/printing/quotes/${qid}`);
    check('印刷：面积/数量/双面/制版价', r.status === 200 && Number(r.data.quote[0].total) > 10000);
    r = await req(base, 'POST', `/printing/quotes/${qid}/processes`, { name: '覆膜', fee: 500 });
    check('印刷：后道工艺累加', r.status === 201);
    r = await req(base, 'GET', `/printing/quotes/${qid}`);
    check('印刷：工艺明细与总价', r.status === 200 && r.data.processes.length === 1);
    r = await req(base, 'PUT', `/printing/quotes/${qid}/submit`, {});
    check('印刷：提交报价', r.status === 200);
    r = await req(base, 'PUT', `/printing/quotes/${qid}/approve`, {});
    check('印刷：成交', r.status === 200);
    r = await req(base, 'GET', '/printing/quotes');
    check('印刷：报价列表', r.status === 200 && r.data.rows[0].status === 'approved');
  },
  async softquote(base) {
    let r = await req(base, 'POST', '/softquote/clients', { name: '某科技公司', contact: '李经理', phone: '13900000000' });
    check('软报：新建客户', r.status === 201 && Number(r.data.id) > 0);
    const client = r.data.id;
    r = await req(base, 'POST', '/softquote/projects', { client_id: client, name: 'ERP 二期', requirement: '进销存 + 报表', rate_per_day: 800, discount: 10 });
    check('软报：新建项目', r.status === 201 && Number(r.data.id) > 0);
    const pid = r.data.id;
    r = await req(base, 'POST', `/softquote/projects/${pid}/modules`, { name: '权限模块', days: 10 });
    check('软报：模块一计价', r.status === 201);
    r = await req(base, 'POST', `/softquote/projects/${pid}/modules`, { name: '报表模块', days: 5 });
    check('软报：模块二计价', r.status === 201);
    r = await req(base, 'PUT', `/softquote/projects/${pid}/submit`, {});
    check('软报：折扣提交', r.status === 200);
    r = await req(base, 'GET', `/softquote/projects/${pid}`);
    check('软报：项目/模块/客户联查', r.status === 200 && r.data.modules.length === 2 && Number(r.data.project[0].total) === 10800);
    r = await req(base, 'PUT', `/softquote/projects/${pid}/approve`, {});
    check('软报：成交', r.status === 200);
  },
  async freight(base) {
    let r = await req(base, 'POST', '/freight/routes', { origin: '昆明', destination: '上海', base_price: 500, price_per_kg: 12, volume_ratio: 167 });
    check('货运：新增线路', r.status === 201 && Number(r.data.id) > 0);
    const rid = r.data.id;
    r = await req(base, 'POST', '/freight/quotes', { customer_name: '王女士', phone: '13700000000', route_id: rid, weight: 30, volume: 0.5 });
    check('货运：体积重取大计费', r.status === 201 && Number(r.data.id) > 0);
    const qid = r.data.id;
    r = await req(base, 'GET', `/freight/quotes/${qid}`);
    check('货运：报价与线路联查', r.status === 200 && Number(r.data.quote[0].chargeable) === 83.5);
    r = await req(base, 'GET', '/freight/quotes');
    check('货运：报价列表', r.status === 200 && Number(r.data.rows[0].total) === 1502);
    r = await req(base, 'PUT', `/freight/quotes/${qid}/approve`, {});
    check('货运：确认报价', r.status === 200);
  },
};

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  const list = templates.list().filter((t) => t.kind === 'builtin' && t.id !== 'builtin:crossdb');
  const cases = [
    { id: 'builtin:chat', name: 'chat', flow: flows.chat },
    { id: 'builtin:meeting', name: 'meeting', flow: flows.meeting },
    { id: 'builtin:crm', name: 'crm', flow: flows.crm },
    { id: 'builtin:edu', name: 'edu', flow: flows.edu },
    { id: 'builtin:restaurant', name: 'restaurant', flow: flows.restaurant },
    { id: 'builtin:logistics', name: 'logistics', flow: flows.logistics },
    { id: 'builtin:hospital', name: 'hospital', flow: flows.hospital },
    { id: 'builtin:finance', name: 'finance', flow: flows.finance },
    { id: 'builtin:iot', name: 'iot', flow: flows.iot },
    { id: 'builtin:event', name: 'event', flow: flows.event },
    { id: 'builtin:netcourse', name: 'netcourse', flow: flows.netcourse },
    { id: 'builtin:decoration', name: 'decoration', flow: flows.decoration },
    { id: 'builtin:printing', name: 'printing', flow: flows.printing },
    { id: 'builtin:softquote', name: 'softquote', flow: flows.softquote },
    { id: 'builtin:freight', name: 'freight', flow: flows.freight },
  ];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const tpl = list.find((x) => x.id === c.id);
    if (!tpl) { check(`${c.name} 案例存在`, false); continue; }
    console.log(`\n== ${tpl.name} ==`);
    let s = null;
    try {
      s = await startCase(c, i);
      check(`${c.name} 服务启动`, true, s.base);
      await c.flow(s.base + '/api');
    } catch (e) {
      check(`${c.name} 流程异常`, false, e.message);
      if (s && s.log) console.error(s.log.join('').slice(-800));
    } finally {
      if (s) await stopCase(s);
    }
  }
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 通过`);
  await sleep(300);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
