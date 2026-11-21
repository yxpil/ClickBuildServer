// 作者：yxpil
// Rust 全栈运行时回归：生成 -> 建库 -> cargo run -> 登录 -> 带 token 访问 /api/auth/me。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const templates = require('../app/iface/templates');
const { generate, writeTo } = require('../app/generator');
const { normalizeProject } = require('../app/generator/ir');

const PORT = 19181;
const HOST = '127.0.0.1';
const DB_HOST = process.env.CB_MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.CB_MYSQL_PORT || 13306);
const DB_USER = process.env.CB_MYSQL_USER || 'root';
const DB_PASS = process.env.CB_MYSQL_PASSWORD || '';
const DB_NAME = `cbs_rust_${Date.now()}`;
const outDir = path.join(os.tmpdir(), 'cbs-rust-runtime');

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      host: HOST, port: PORT, path: urlPath, method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitPort() {
  for (let i = 0; i < 120; i++) {
    try {
      await request('GET', '/api/auth/me');
      return true;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function main() {
  const project = normalizeProject(templates.get('builtin:mall').project).project;
  project.lang = 'rust';
  project.name = 'Rust 全栈验收';
  project.database.name = DB_NAME;
  project.security.initAdmin = 'admin';
  project.security.initPassword = 'admin123';
  project.redis.enabled = false;
  const result = generate(project);
  writeTo(outDir, result.files);

  const conn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, multipleStatements: true });
  await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await conn.end();

  const sqlDir = path.join(outDir, 'sql');
  const sqlConn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, multipleStatements: true });
  for (const f of fs.readdirSync(sqlDir).sort()) {
    if (!f.endsWith('.sql') || f.includes('seed')) continue;
    const content = fs.readFileSync(path.join(sqlDir, f), 'utf8');
    await sqlConn.query(content);
  }
  await sqlConn.end();

  const child = spawn('cargo', ['run', '--quiet'], {
    cwd: outDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_HOST,
      DB_PORT: String(DB_PORT),
      DB_NAME,
      DB_USER,
      DB_PASSWORD: DB_PASS,
      REDIS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  try {
    if (!(await waitPort())) throw new Error(`Rust 服务没有在 120 秒内监听 ${PORT}\n${log.slice(-3000)}`);
    const login = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    if (login.status !== 200) throw new Error(`登录失败 ${login.status}: ${login.body}`);
    const payload = JSON.parse(login.body);
    const token = payload.data && payload.data.token;
    if (!token) throw new Error(`登录响应没有 token: ${login.body}`);
    const me = await request('GET', '/api/auth/me', null, token);
    if (me.status !== 200) throw new Error(`/api/auth/me 失败 ${me.status}: ${me.body}`);
    const meBody = JSON.parse(me.body);
    if (!meBody.data || !meBody.data.username) throw new Error(`/api/auth/me 返回异常: ${me.body}`);

    const apiDoc = fs.readFileSync(path.join(outDir, 'docs', 'API.md'), 'utf8');
    const listPath = apiDoc.split(/\r?\n/)
      .map((l) => l.match(/\| `GET` \| `(\/api\/[^`]*?)` \| 分页查询 \|/))
      .find(Boolean)?.[1];
    if (!listPath) throw new Error('API.md 里没有可测的列表路由');
    const list = await request('GET', `${listPath}?page=1&size=10`, null, token);
    if (list.status !== 200) throw new Error(`列表 ${listPath} 失败 ${list.status}: ${list.body}`);
    const listBody = JSON.parse(list.body);
    if (listBody.code !== 0 || !listBody.data || !Array.isArray(listBody.data.records)) {
      throw new Error(`列表 ${listPath} 返回异常: ${list.body}`);
    }
    console.log(`ok   Rust 服务启动，登录 admin，/api/auth/me 返回 ${meBody.data.username}`);
    console.log(`ok   列表 ${listPath} 返回 ${listBody.data.records.length} 条（total ${listBody.data.total}）`);
    console.log('2 passed');
  } finally {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', resolve);
    });
  }
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exitCode = 1;
});
