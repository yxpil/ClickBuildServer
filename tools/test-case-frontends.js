// 作者：yxpil
'use strict';

// 真实案例回归：只允许 4 套 PageStudio 原生多页 .yxpp。
// 每套必须满足：project.pages >= 3、每页由原生组件拼接（nativeCase）、无整页 appview；
// .yxpp 不存手写 HTML，生成产物从原生 pages 渲染成可部署 HTML。
// 最后真实启动商城案例，确认 `/` 返回运行时页、`/frontend/index.yxpp` 是原生多页工程。
// 用法：node tools/test-case-frontends.js
// 前置：MariaDB / Redis / RustFS 已启动（13306 / 16379 / 19000）。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const templates = require('../app/iface/templates');
const codegen = require('../app/iface/codegen');

const NODE = path.join(__dirname, '..', 'runtime', 'node', 'node.exe');
const NODE_PATH = path.join(__dirname, '..', 'node_modules');
const OUT = path.join(os.tmpdir(), 'clickbuild-native-case-test');
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(base, p) {
  const r = await fetch(base + p);
  return { status: r.status, text: await r.text(), type: r.headers.get('content-type') || '' };
}

async function liveMall(dir) {
  const port = 18992;
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(NODE, ['server.js'], {
    cwd: dir,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_PATH,
      PORT: String(port),
      MYSQL_DB: 'clickbuild_native_case_test',
      RESET_DB: '1',
      CACHE_PREFIX: `icb:cache:native-case-test:${Date.now()}`,
    },
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  try {
    let ready = false;
    for (let i = 0; i < 48; i++) {
      await sleep(250);
      try {
        if ((await req(base, '/_health')).status === 200) { ready = true; break; }
      } catch (e) { /* retry */ }
    }
    check('商城案例服务启动', ready, ready ? '' : log.join('').slice(-500));
    if (!ready) return;
    const health = await req(base, '/_health/interfaces');
    let healthOk = false;
    try {
      const h = JSON.parse(health.text);
      healthOk = health.status === 200 && h.ok === true && h.total >= 1 && h.healthy === h.total && Array.isArray(h.interfaces);
    } catch (e) { /* ignore */ }
    check('全部接口健康检查', healthOk, `${health.status} ${health.text.slice(0, 160)}`);
    const home = await req(base, '/');
    check('GET / 返回真实商城原生页', home.status === 200 && home.text.includes('id="ps-root"') && home.text.includes('data-ps-page') && home.text.includes('山货集') && !home.text.includes('MALL / CASE FRONTEND'), `${home.status} ${home.text.length} B`);
    const yxpp = await req(base, '/frontend/index.yxpp');
    let yxppOk = false;
    try {
      const body = JSON.parse(yxpp.text);
      yxppOk = yxpp.status === 200 && body.format === 'yxpp' && body.project && Array.isArray(body.project.pages) && body.project.pages.length >= 3 && !!body.project.nativeCase;
    } catch (e) { /* ignore */ }
    check('GET /frontend/index.yxpp 返回原生多页工程', yxppOk, `${yxpp.status} ${yxpp.text.length} B`);
    const project = await req(base, '/frontend/project.json');
    let projectOk = false;
    try {
      const body = JSON.parse(project.text);
      projectOk = project.status === 200 && body && Array.isArray(body.pages) && body.pages.length >= 3 && !!body.nativeCase;
    } catch (e) { /* ignore */ }
    check('GET /frontend/project.json 返回原生多页工程', projectOk, `${project.status} ${project.text.length} B`);
  } finally {
    if (!child.killed) child.kill();
    await sleep(400);
  }
}

async function liveBooking(dir) {
  const port = 18993;
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(NODE, ['server.js'], {
    cwd: dir,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_PATH,
      PORT: String(port),
      MYSQL_DB: 'clickbuild_booking_case_test',
      RESET_DB: '1',
      CACHE_PREFIX: `icb:cache:booking-case-test:${Date.now()}`,
    },
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const rows = (x) => (x && x.data && Array.isArray(x.data.rows)) ? x.data.rows : (Array.isArray(x && x.rows) ? x.rows : []);
  try {
    let ready = false;
    for (let i = 0; i < 48; i++) {
      await sleep(250);
      try {
        if ((await req(base, '/_health')).status === 200) { ready = true; break; }
      } catch (e) { /* retry */ }
    }
    check('预约案例服务启动', ready, ready ? '' : log.join('').slice(-500));
    if (!ready) return;
    const services = rows(JSON.parse((await req(base, '/api/services')).text));
    const beforeSlots = rows(JSON.parse((await req(base, '/api/slots')).text));
    const service = services[0];
    const slot = beforeSlots.find((x) => String(x.service_id) === String(service && service.id)) || beforeSlots[0];
    const r = await fetch(base + '/api/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot_id: slot.id, service_id: slot.service_id, customer: '真实预约验收', phone: '13800001111' }),
    });
    const body = await r.text();
    check('POST /api/bookings 写入真实预约单', r.status === 201 && /"ok":true/.test(body) && /"id"/.test(body), `${r.status} ${body.slice(0, 180)}`);
    const afterSlots = rows(JSON.parse((await req(base, '/api/slots')).text));
    const after = afterSlots.find((x) => String(x.id) === String(slot.id));
    check('预约提交后时段 capacity 真实占位', !!after && Number(after.booked) === Number(slot.booked) + 1, `${slot && slot.booked} -> ${after && after.booked}`);
    const bookings = rows(JSON.parse((await req(base, '/api/bookings')).text));
    const created = bookings.find((x) => x.customer === '真实预约验收' && String(x.slot_id) === String(slot.id));
    check('预约单进入我的预约数据表', !!created && String(created.service_id) === String(slot.service_id), created ? JSON.stringify(created).slice(0, 180) : 'missing');
  } finally {
    if (!child.killed) child.kill();
    await sleep(400);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const builtins = templates.list().filter((t) => t.kind === 'builtin');
  check('只展示 4 套真实案例', builtins.length === 4, builtins.map((t) => t.name).join('/'));
  let liveDir = '';
  let bookingDir = '';
  for (const t of builtins) {
    const p = templates.get(t.id).project;
    const f = p.frontend;
    const name = t.name;
    const errors = [];
    const isNative = !!(f && f.project && f.project.nativeCase);
    const isApp = !!(f && f.project && f.project.app && f.project.app.mode);
    if (!f || !f.project) errors.push('缺 frontend.project');
    else {
      if (!Array.isArray(f.project.pages) || !f.project.pages.length) errors.push('缺原生多页 pages');
      else {
        for (const page of f.project.pages) {
          if (!Array.isArray(page.elements) || page.elements.length < 8) errors.push(`页「${page.name || page.id}」组件不足`);
          if (!isNative && !page.elements.some((x) => x.type === 'appview')) errors.push(`页「${page.name || page.id}」缺 appview`);
          if (isNative && page.elements.some((x) => x.type === 'appview')) errors.push(`页「${page.name || page.id}」仍是整页 appview`);
        }
      }
      if (!isNative && !isApp) errors.push('project 既不是 nativeCase 也没有 app mode');
      if (Array.isArray(f.project.elements)) errors.push('仍是旧的单页 elements 格式');
    }
    if (!f || !f.html) errors.push('缺运行时 HTML');
    else if (isNative) {
      if (!f.html.includes('id="ps-root"')) errors.push('HTML 缺原生页根节点');
      if (!f.html.includes('data-ps-page')) errors.push('HTML 缺原生多页 section');
      if (!f.html.includes('data-ps-form')) errors.push('HTML 缺原生表单');
      if (f.html.includes('window.CASE =')) errors.push('原生案例仍套 app 运行时');
      if (f.html.length < 60000) errors.push('HTML 过小，原生页未渲染完整');
      const scripts = [...f.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      if (!scripts.length) errors.push('HTML 缺脚本');
      else {
        for (const script of scripts) {
          try { new Function(script); } catch (e) { errors.push('脚本语法错误：' + e.message); break; }
        }
      }
    } else {
      if (!f.html.includes('id="app"')) errors.push('HTML 缺应用根节点');
      if (!f.html.includes('window.CASE =')) errors.push('HTML 缺应用配置');
      if (!f.html.includes('window.UX =')) errors.push('HTML 缺运行时');
      if (f.html.includes('CASE FRONTEND') || f.html.includes('接口清单')) errors.push('HTML 仍是接口案例页');
      if (f.html.length < 60000) errors.push('HTML 过小，运行时未带入');
      const scripts = [...f.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      if (!scripts.length) errors.push('HTML 缺脚本');
      else {
        for (const script of scripts) {
          try { new Function(script); } catch (e) { errors.push('脚本语法错误：' + e.message); break; }
        }
      }
    }
    check(`案例「${name}」是原生多页 .yxpp`, errors.length === 0, errors.length ? errors.join(' | ') : `${f.project.pages.length} 页 / ${isNative ? '原生组件' : f.project.app.mode} / ${Math.round(f.html.length / 1024)} KB`);

    if (errors.length) continue;
    const dir = path.join(OUT, name);
    const g = codegen.writeTo(p, dir, { port: 18992 });
    const yxppPath = path.join(dir, 'frontend', 'index.yxpp');
    const projectPath = path.join(dir, 'frontend', 'project.json');
    const htmlPath = path.join(dir, 'public', 'index.html');
    const filesOk = fs.existsSync(yxppPath) && fs.existsSync(projectPath) && fs.existsSync(htmlPath);
    let parseOk = false;
    if (filesOk) {
      const y = JSON.parse(fs.readFileSync(yxppPath, 'utf8'));
      const yHtml = String(y.html || '');
      const pubHtml = fs.readFileSync(htmlPath, 'utf8');
      parseOk = y.format === 'yxpp' && y.project && Array.isArray(y.project.pages) && y.project.pages.length >= 3 && yHtml.replace(/\s+/g, '') === pubHtml.replace(/\s+/g, '');
      if (parseOk) parseOk = yHtml.includes('window.CASE =') || yHtml.includes('id="ps-root"');
    }
    check(`案例「${name}」生成原生 .yxpp 产物`, filesOk && parseOk, `${g.files.length} 文件`);
    if (name === '商城') {
      const edited = JSON.parse(JSON.stringify(p));
      const hit = (edited.frontend.project.pages[0].elements || []).find((e) => e.type === 'heading' || e.type === 'text');
      const marker = '部署编辑验收 · native';
      hit.props = hit.props || {};
      hit.props.text = (hit.props.text || '') + ' ' + marker;
      const edDir = path.join(OUT, name + '-edited');
      codegen.writeTo(edited, edDir, { port: 18992 });
      const edHtml = fs.readFileSync(path.join(edDir, 'public', 'index.html'), 'utf8');
      check('原生案例编辑后重新生成部署页带上新文字', edHtml.includes(marker), marker);
    }
    if (name === '商城') liveDir = dir;
    if (name === '预约') bookingDir = dir;
  }

  if (liveDir) await liveMall(liveDir);
  if (bookingDir) await liveBooking(bookingDir);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  console.log(`产物目录：${OUT}`);
  process.exit(failed.length ? 1 : 0);
})();
