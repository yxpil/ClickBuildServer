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
      CACHE_PREFIX: 'icb:cache:help-test',
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
