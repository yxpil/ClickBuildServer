'use strict';

// 全部案例前端（.yxpp）回归：22 套内置案例都必须带 PageStudio 工程与可运行 HTML，
// 生成产物必须写入 frontend/index.yxpp、frontend/project.json、public/index.html；
// 最后真实启动商城案例，确认 `/` 返回前端页、`/frontend/index.yxpp` 可读。
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
const OUT = path.join(os.tmpdir(), 'clickbuild-case-frontend-test');
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
      MYSQL_DB: 'clickbuild_frontend_test',
      RESET_DB: '1',
      CACHE_PREFIX: `icb:cache:frontend-test:${Date.now()}`,
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
    const consolePage = await req(base, '/console');
    check('控制台健康按钮检查全部', consolePage.status === 200 && consolePage.text.includes('/_health/interfaces') && consolePage.text.includes('检查全部'), `${consolePage.status} ${consolePage.text.length} B`);
    const home = await req(base, '/');
    check('GET / 返回案例前端', home.status === 200 && home.text.includes('MALL / CASE FRONTEND') && home.text.includes('const CASE ='), `${home.status} ${home.text.length} B`);
    const yxpp = await req(base, '/frontend/index.yxpp');
    let yxppOk = false;
    try {
      const body = JSON.parse(yxpp.text);
      yxppOk = yxpp.status === 200 && body.format === 'yxpp' && body.project && Array.isArray(body.project.elements);
    } catch (e) { /* ignore */ }
    check('GET /frontend/index.yxpp 返回 200', yxppOk, `${yxpp.status} ${yxpp.text.length} B`);
    const project = await req(base, '/frontend/project.json');
    let projectOk = false;
    try {
      const body = JSON.parse(project.text);
      projectOk = project.status === 200 && body && Array.isArray(body.elements);
    } catch (e) { /* ignore */ }
    check('GET /frontend/project.json 返回 200', projectOk, `${project.status} ${project.text.length} B`);
  } finally {
    if (!child.killed) child.kill();
    await sleep(400);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const builtins = templates.list().filter((t) => t.kind === 'builtin');
  let liveDir = '';
  for (const t of builtins) {
    const p = templates.get(t.id).project;
    const f = p.frontend;
    const name = t.name;
    const errors = [];
    if (!f || !f.project || !Array.isArray(f.project.elements)) errors.push('缺 frontend.project');
    else if (!f.project.elements.length) errors.push('project 无元素');
    if (!f || !f.html) errors.push('缺 frontend.html');
    else {
      if (!f.html.includes(p.name)) errors.push('HTML 缺案例名');
      if (!f.html.includes('const CASE = ')) errors.push('HTML 缺案例数据');
      if (!f.html.includes('fetch(')) errors.push('HTML 缺接口调用');
      if (f.html.length < 8000) errors.push('HTML 过小');
      const script = f.html.match(/<script>([\s\S]*?)<\/script>/);
      if (!script) errors.push('HTML 缺脚本');
      else {
        try { new Function(script[1]); } catch (e) { errors.push('脚本语法错误：' + e.message); }
      }
    }
    check(`案例「${name}」带完整 .yxpp`, errors.length === 0, errors.length ? errors.join(' | ') : `${f.project.elements.length} 元素 / ${Math.round(f.html.length / 1024)} KB`);

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
      parseOk = y.format === 'yxpp' && y.project && Array.isArray(y.project.elements) && y.html === fs.readFileSync(htmlPath, 'utf8');
    }
    check(`案例「${name}」生成 .yxpp 产物`, filesOk && parseOk, `${g.files.length} 文件`);
    if (name === '商城') liveDir = dir;
  }

  if (liveDir) await liveMall(liveDir);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  console.log(`产物目录：${OUT}`);
  process.exit(failed.length ? 1 : 0);
})();
