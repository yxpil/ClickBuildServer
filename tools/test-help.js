'use strict';

// 生成服务的帮助页回归：真实启动一台服务，检查 /help 内容以及 /docs、/console 入口。
// 用法：runtime\node\node.exe tools\test-help.js
// 前置：MariaDB / Redis / RustFS 已启动（13306 / 16379 / 19000）。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const templates = require('../app/iface/templates');
const plugins = require('../app/iface/plugins');
const codegen = require('../app/iface/codegen');
const spec = require('../app/iface/spec');

const NODE = path.join(__dirname, '..', 'runtime', 'node', 'node.exe');
const NODE_PATH = path.join(__dirname, '..', 'node_modules');
const PORT = 18990;
const DIR = path.join(os.tmpdir(), 'clickbuild-help-test');
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function text(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.text() };
}

async function main() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const tpl = templates.get('builtin:blog');
  const project = plugins.apply(tpl.project).project;
  // 加一个默认新建接口，验证 CRUD 默认 404 与 405。
  project.interfaces.push(spec.newIface('默认响应', (project.categories[0] || {}).id || 'biz'));
  codegen.writeTo(project, DIR, { port: PORT });

  const child = spawn(NODE, ['server.js'], {
    cwd: DIR,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_PATH,
      PORT: String(PORT),
      MYSQL_DB: 'clickbuild_help_test',
      RESET_DB: '1',
      CACHE_PREFIX: `icb:cache:help-test:${Date.now()}`,
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
        if ((await fetch(BASE + '/_health')).status === 200) { ready = true; break; }
      } catch (e) { /* retry */ }
    }
    check('生成服务启动', ready, ready ? '' : log.join('').slice(-500));
    if (!ready) throw new Error('service not ready');

    const help = await text('/help');
    check('/help 返回 200', help.status === 200, String(help.status));
    for (const marker of ['1. 快速访问', '2. 接口路由', '4. SQL 占位符', '5. 脚本语句', '6. 内置函数', '7. 直接试一下', 'SM4_ENC', '{{body.x}}']) {
      check(`/help 包含「${marker}」`, help.body.includes(marker));
    }
    check('/help 列出真实接口路由', help.body.includes('/api/'), '/help');

    const docs = await text('/docs');
    check('/docs 返回 200', docs.status === 200, String(docs.status));
    check('/docs 有 /help 入口', docs.body.includes('href="/help"'));

    const consolePage = await text('/console');
    check('/console 返回 200', consolePage.status === 200, String(consolePage.status));
    check('/console 有 /help 入口', consolePage.body.includes('href="/help"'));
    check('/console 有 /docs 入口', consolePage.body.includes('href="/docs"'));

    const routes = await (await fetch(BASE + '/_routes')).json();
    const detail = (routes.routes || []).find((r) => r.method === 'GET' && r.path.includes(':id'));
    check('存在详情路由用于错误响应测试', !!detail, detail && detail.path);
    if (detail) {
      const miss = await fetch(BASE + detail.path.replace(':id', '999999'));
      const missBody = await miss.json();
      check('业务 404 顶层带 error', miss.status === 404 && missBody.error === 'NOT_FOUND', `${miss.status} ${JSON.stringify(missBody).slice(0, 90)}`);
    }

    const def = (routes.routes || []).filter((r) => r.interface === '默认响应');
    const put = def.find((r) => r.method === 'PUT' && r.path.includes(':id'));
    const del = def.find((r) => r.method === 'DELETE' && r.path.includes(':id'));
    const list = def.find((r) => r.method === 'GET' && !r.path.includes(':id'));
    if (put) {
      const r = await fetch(BASE + put.path.replace(':id', '999999'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
      const b = await r.json();
      check('默认更新对不存在记录返回 404', r.status === 404 && b.error === 'NOT_FOUND', `${r.status} ${JSON.stringify(b).slice(0, 90)}`);
    }
    if (del) {
      const r = await fetch(BASE + del.path.replace(':id', '999999'), { method: 'DELETE' });
      const b = await r.json();
      check('默认删除对不存在记录返回 404', r.status === 404 && b.error === 'NOT_FOUND', `${r.status} ${JSON.stringify(b).slice(0, 90)}`);
    }
    if (list) {
      const r = await fetch(BASE + list.path, { method: 'PATCH' });
      const b = await r.json();
      check('路径存在但方法不对返回 405', r.status === 405 && b.error === 'METHOD_NOT_ALLOWED', `${r.status} ${JSON.stringify(b).slice(0, 90)}`);
      check('405 带 Allow 响应头', /GET/.test(r.headers.get('allow') || ''), r.headers.get('allow') || '-');
    }
    const noRoute = await fetch(BASE + '/api/definitely-not-here');
    const noRouteBody = await noRoute.json();
    check('未知路由默认 404', noRoute.status === 404 && noRouteBody.error === 'NO_ROUTE', `${noRoute.status} ${noRouteBody.error}`);
    check('/_errors/405 可预览', (await text('/_errors/405')).status === 405);
    check('/_errors/413 可预览', (await text('/_errors/413')).status === 413);
    if (list) {
      const huge = 'x'.repeat(65 * 1024 * 1024);
      const r = await fetch(BASE + list.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: huge });
      const b = await r.json();
      check('超大请求体返回 413', r.status === 413 && b.error === 'BODY_TOO_LARGE', `${r.status} ${JSON.stringify(b).slice(0, 90)}`);
    }

    const openapi = await (await fetch(BASE + '/openapi.json')).json();
    const firstOp = Object.values(openapi.paths || {}).map((p) => Object.values(p)[0]).find(Boolean);
    check('OpenAPI 默认响应含 404', !!(firstOp && firstOp.responses && firstOp.responses[404]));
    check('OpenAPI 默认响应含 405', !!(firstOp && firstOp.responses && firstOp.responses[405]));
  } finally {
    if (!child.killed) child.kill();
    await sleep(400);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
