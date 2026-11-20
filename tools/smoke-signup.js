'use strict';

// 活动报名案例真实端到端验收：生成服务 -> 启动 -> 登录 -> 建活动 -> 名额/重复校验 -> 名单 -> 删除保护。
// 前置：MariaDB / Redis / RustFS 已启动。用法：node tools/smoke-signup.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const templates = require('../app/iface/templates');
const codegen = require('../app/iface/codegen');

const NODE = path.join(__dirname, '..', 'runtime', 'node', 'node.exe');
const NODE_PATH = path.join(__dirname, '..', 'node_modules');
const PORT = 18995;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = path.join(os.tmpdir(), 'clickbuild-signup-smoke');
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}
function unwrap(json) { return json && json.data !== undefined ? json.data : json; }
async function req(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  return { status: r.status, text, json, data: unwrap(json) };
}
function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  return [];
}
function later() {
  const d = new Date(Date.now() + 7 * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' 14:00:00';
}

(async () => {
  const project = templates.get('builtin:signup').project;
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const g = codegen.writeTo(project, DIR, { port: PORT });
  console.log(`生成 ${g.files.length} 个文件 -> ${DIR}`);

  const child = spawn(NODE, ['server.js'], {
    cwd: DIR,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_PATH,
      PORT: String(PORT),
      MYSQL_DB: 'clickbuild_signup_smoke',
      RESET_DB: '1',
      CACHE_PREFIX: `icb:cache:signup-smoke:${Date.now()}`,
    },
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try { if ((await req('GET', '/_health')).status === 200) { ready = true; break; } } catch (e) { /* retry */ }
    }
    check('报名服务启动', ready, ready ? '' : log.join('').slice(-900));
    if (!ready) return;

    const home = await req('GET', '/');
    check('GET / 返回报名前端', home.status === 200 && home.text.includes('活动报名') && home.text.includes('const CASE ='), `${home.status} ${home.text.length} B`);
    const yxpp = await req('GET', '/frontend/index.yxpp');
    check('GET /frontend/index.yxpp 可读', yxpp.status === 200 && yxpp.json && Array.isArray(yxpp.json.project.elements), `${yxpp.status} ${yxpp.text.length} B`);

    check('管理接口未登录返回 401', (await req('GET', '/api/admin/events')).status === 401);
    const login = await req('POST', '/api/admin/login', { username: 'admin', password: 'Admin@123456' });
    const token = login.data && login.data.token;
    check('默认管理员可登录', login.status === 200 && !!token, `${login.status}`);
    if (!token) return;

    const create = await req('POST', '/api/admin/events', {
      title: '产品体验日 · 验收场',
      description: '端到端验收创建的活动。',
      location: '昆明 · 五华区',
      start_at: later(),
      capacity: 2,
      status: 1,
    }, token);
    check('创建并开放活动', create.status === 201, `${create.status} ${create.text.slice(0, 100)}`);

    const list = await req('GET', '/api/events');
    const pub = rowsOf(list.data);
    const eid = pub[0] && pub[0].id;
    check('公开列表出现活动', list.status === 200 && pub.length === 1, `rows=${pub.length}`);

    const detail = await req('GET', `/api/events/${eid}`);
    check('公开详情返回活动', detail.status === 200 && detail.data && detail.data.title === '产品体验日 · 验收场', `${detail.status}`);

    const first = await req('POST', `/api/events/${eid}/signups`, { name: '张三', phone: '13800000001', remark: '前端' });
    check('第一条报名成功', first.status === 201, `${first.status} ${first.text.slice(0, 80)}`);

    const dup = await req('POST', `/api/events/${eid}/signups`, { name: '张三', phone: '13800000001' });
    check('重复手机号被拒绝', dup.status === 409 && dup.text.includes('DUPLICATE_PHONE'), `${dup.status}`);

    const second = await req('POST', `/api/events/${eid}/signups`, { name: '李四', phone: '13800000002' });
    check('第二条报名成功', second.status === 201, String(second.status));

    const full = await req('POST', `/api/events/${eid}/signups`, { name: '王五', phone: '13800000003' });
    check('名额满后拒绝报名', full.status === 409 && full.text.includes('EVENT_FULL'), `${full.status} ${full.text.slice(0, 80)}`);

    const after = await req('GET', `/api/events/${eid}`);
    check('报名计数为 2', Number(after.data.registered_count) === 2, `count=${after.data.registered_count}`);

    const adminRows = await req('GET', `/api/admin/events/${eid}/signups`, undefined, token);
    const regs = rowsOf(adminRows.data);
    check('后台读到两条报名', adminRows.status === 200 && regs.length === 2 && regs.some(r => r.phone === '13800000001'), `${adminRows.status} rows=${regs.length}`);

    const del = await req('DELETE', `/api/admin/events/${eid}`, undefined, token);
    check('有报名时拒绝删除', del.status === 409 && del.text.includes('HAS_SIGNUPS'), `${del.status}`);

    const close = await req('POST', `/api/admin/events/${eid}/status`, { status: 2 }, token);
    check('结束活动', close.status === 200, String(close.status));
    check('结束后公开列表为空', rowsOf((await req('GET', '/api/events')).data).length === 0);
    const closed = await req('POST', `/api/events/${eid}/signups`, { name: '赵六', phone: '13800000004' });
    check('结束后禁止报名', closed.status === 409 && closed.text.includes('EVENT_CLOSED'), `${closed.status}`);

    const reopen = await req('POST', `/api/admin/events/${eid}/status`, { status: 1 }, token);
    check('重新开放', reopen.status === 200, String(reopen.status));
    const update = await req('PUT', `/api/admin/events/${eid}`, {
      title: '产品体验日 · 验收场（已更新）',
      description: '更新后的说明。',
      location: '昆明 · 呈贡区',
      start_at: later(),
      capacity: 3,
      status: 1,
    }, token);
    check('编辑活动', update.status === 200, String(update.status));
    const changed = await req('GET', `/api/events/${eid}`);
    check('编辑结果生效', changed.data && changed.data.title === '产品体验日 · 验收场（已更新）' && Number(changed.data.capacity) === 3, changed.data && changed.data.title);

    const bad = await req('POST', '/api/admin/events', { title: '', start_at: later(), status: 1 }, token);
    check('空标题被拒绝', bad.status === 400, `${bad.status}`);
    const missing = await req('GET', '/api/events/999999');
    check('不存在活动返回 404', missing.status === 404, String(missing.status));
  } finally {
    if (!child.killed) child.kill();
    await sleep(300);
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 通过`);
    if (failed.length) console.log('服务日志尾部：\n' + log.join('').slice(-1600));
    process.exit(failed.length ? 1 : 0);
  }
})();
