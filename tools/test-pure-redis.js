// 作者：yxpil
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { writeTo } = require('../app/iface/codegen');

const project = JSON.parse(JSON.stringify(require('../app/iface/cases/blog.json')));
const iface = project.interfaces.find((i) => i.name === '文章');
iface.tables[0].store = { mode: 'redis', ttl: 0, max: 10000, flushMs: 5000 };
project.interfaces = [iface];
const out = path.join(process.env.TEMP, 'cbs-pure-redis');
fs.rmSync(out, { recursive: true, force: true });
writeTo(project, out, {});

const env = {
  ...process.env,
  NODE_PATH: path.resolve(__dirname, '..', 'node_modules'),
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '13306', MYSQL_USER: 'root', MYSQL_PASSWORD: '', MYSQL_DB: 'clickbuild_rowstore',
  REDIS_HOST: '127.0.0.1', REDIS_PORT: '16379', REDIS_DB: '3',
  PORT: '18999', S3_ENDPOINT: '127.0.0.1', S3_PORT: '19000',
  ROWSTORE_DEBUG: '1',
};
const child = spawn(process.execPath, ['server.js'], { cwd: out, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });

async function wait() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:18999/_health');
      if (r.ok) return;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('服务未启动\n' + log);
}

(async () => {
  await wait();
  const base = 'http://127.0.0.1:18999';
  let r = await fetch(base + '/api/posts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Pure Redis First', slug: 'pure-1', content: 'body', status: 0 }),
  });
  const created = await r.json();
  const createdId = created.data && created.data.id;
  console.log('create', r.status, createdId);
  r = await fetch(base + '/api/posts');
  const list = await r.json();
  console.log('list', r.status, JSON.stringify(list).slice(0, 300));
  r = await fetch(base + '/api/posts/' + createdId);
  const one = await r.json();
  console.log('detail', r.status, one.data && one.data.row && one.data.row.title);
  r = await fetch(base + '/api/posts/' + createdId, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Pure Redis Renamed' }),
  });
  console.log('update', r.status, await r.json());
  r = await fetch(base + '/api/posts/' + createdId);
  console.log('after-update', r.status, JSON.stringify(await r.json()).slice(0, 300));
  r = await fetch(base + '/api/posts?title=' + encodeURIComponent('Pure Redis Renamed'));
  console.log('search', r.status, JSON.stringify(await r.json()).slice(0, 300));
  child.kill();
  await new Promise((res) => setTimeout(res, 500));
  console.log('--- log ---\n' + log.split('\n').filter((x) => /纯表|rowstore|启动|错误|Error/i.test(x)).join('\n'));
})().catch((e) => { console.error(e); child.kill(); process.exitCode = 1; });
