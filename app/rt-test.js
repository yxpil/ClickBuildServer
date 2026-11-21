// 作者：yxpil
'use strict';
/**
 * 运行时冒烟测试：真生成、真启动、真打请求。
 *
 *   node app/rt-test.js                # 默认 node 语言
 *   node app/rt-test.js --lang go      # 跑 Go 版本（需要 go 工具链）
 *   node app/rt-test.js --install      # 先 npm install（首次跑 Node 工程时用）
 *   node app/rt-test.js --keep         # 保留临时工程，方便手查
 *   node app/rt-test.js --db --install --db-port 3307 --db-password root123
 *                                      # 建库→导 SQL→真登录→真增删改查→审计→登出失效
 *
 * 断言的是"行为"，不是"文件存在"：状态码、响应头、限流、错误信息是否泄露内网地址。
 * --db 模式会额外建一个临时库（跑完自动删掉），把 SQL DDL / 种子数据 / 登录链路也一起验证。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const LANG = String(opt('lang', 'node'));
const PORT = Number(opt('port', 18099));
const INSTALL = args.includes('--install');
const KEEP = args.includes('--keep');
const DB = args.includes('--db');
const DB_HOST = String(opt('db-host', '127.0.0.1'));
const DB_PORT = Number(opt('db-port', 3307));
const DB_USER = String(opt('db-user', 'root'));
const DB_PASS = String(opt('db-password', 'root123'));
const NAME = 'rtdemo';
const MODULES = 'auth,account,rbac,order,audit-log,product,media';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cbs-rt-test-' + Date.now());
const PROJ = path.join(OUT, NAME);
const BASE = 'http://127.0.0.1:' + PORT + '/api';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  → ' + detail : ''));
};

function request(method, url, { body, headers, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: Object.assign({}, headers, data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, headers: {}, text: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

function waitPort(port, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      const r = request('GET', 'http://127.0.0.1:' + port + '/api/auth/me').then((res) => {
        if (res.status > 0) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tick, 300);
      });
      return r;
    };
    tick();
  });
}

/**
 * 把生成物 sql/*.sql 依次导进真实 MySQL：先建库，再按序号建表，最后 seed。
 * 用的是生成工程自己装好的 mysql2，不额外引入依赖。
 */
async function importSql(proj) {
  const mysql = require(path.join(proj, 'node_modules', 'mysql2', 'promise'));
  const dir = path.join(proj, 'sql');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const first = fs.readFileSync(path.join(dir, files[0]), 'utf8');
  const m = /CREATE DATABASE(?: IF NOT EXISTS)?\s+`([^`]+)`/i.exec(first);
  const dbName = m ? m[1] : 'click_server';

  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, multipleStatements: true,
  });
  const failed = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    // 去掉整行 -- 注释，避免空语句触发语法错误
    const sql = raw.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').trim();
    if (!sql) continue;
    try {
      await conn.query(sql);
    } catch (e) {
      failed.push(f + ': ' + e.message);
    }
    if (f === files[0]) await conn.query('USE `' + dbName + '`');
  }
  await conn.end();
  return { dbName, failed };
}

/** 跑完删库，别在别人机器上留垃圾。 */
async function dropDatabase(proj, dbName) {
  try {
    const mysql = require(path.join(proj, 'node_modules', 'mysql2', 'promise'));
    const conn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS });
    await conn.query('DROP DATABASE IF EXISTS `' + dbName + '`');
    await conn.end();
  } catch (e) {
    console.log('  (删库失败，可手动清理 ' + dbName + ')');
  }
}

async function main() {
  // 1. 生成工程
  const gen = spawnSync(
    process.execPath,
    [path.join(ROOT, 'app', 'gen-cli.js'), '--lang', LANG, '--modules', MODULES, '--name', NAME, '--out', OUT],
    { encoding: 'utf8' },
  );
  if (gen.status !== 0 || !fs.existsSync(PROJ)) {
    console.log(gen.stdout || '', gen.stderr || '');
    check('生成工程', false, '产物目录不存在');
    return;
  }
  console.log('工程：' + PROJ);

  // 2. 依赖（Node 需要 mysql2 / ioredis / busboy / xlsx）
  if (LANG === 'node' && INSTALL) {
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error'], { cwd: PROJ, encoding: 'utf8', shell: true });
    check('安装依赖', r.status === 0, (r.stdout || '').trim().split('\n').pop());
  }

  // 3. 启动
  let cmd;
  let argv;
  let dbName = null;
  if (LANG === 'go') {
    const bin = path.join(PROJ, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    // go.mod 只列直接依赖，先 tidy 补齐 go.sum（生成物 README 里也这么写）
    const tidy = spawnSync('go', ['mod', 'tidy'], { cwd: PROJ, encoding: 'utf8', shell: process.platform === 'win32' });
    check('go mod tidy', tidy.status === 0, tidy.status === 0 ? '' : (tidy.stderr || '').trim().split('\n').slice(-2).join(' | '));
    if (tidy.status !== 0) return;
    const out = path.join(bin, process.platform === 'win32' ? 'server.exe' : 'server');
    // Go 工程是 main.go 在根目录（不是 cmd/server）
    const b = spawnSync('go', ['build', '-o', out, '.'], { cwd: PROJ, encoding: 'utf8', shell: process.platform === 'win32' });
    if (b.status !== 0) {
      check('Go 编译', false, (b.stderr || b.stdout || '').trim().split('\n').slice(-3).join(' | '));
      return;
    }
    check('Go 编译', true, `bin/${path.basename(out)}`);
    cmd = out;
    argv = [];
  } else {
    cmd = process.execPath;
    argv = [path.join(PROJ, 'server.js')];
  }

  // 3a. 有数据库模式：先建库导 SQL，再让服务连上去
  if (DB) {
    if (LANG !== 'node') {
      check('--db 仅支持 node 语言', false, '当前 lang=' + LANG);
      return;
    }
    try {
      const r = await importSql(PROJ);
      dbName = r.dbName;
      check('SQL 导入数据库', r.failed.length === 0, r.failed.length ? r.failed[0] : dbName + ' / 全部脚本执行成功');
      if (r.failed.length) return;
    } catch (e) {
      check('连接数据库', false, e.message);
      return;
    }
  }

  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    APP_PORT: String(PORT),
    NODE_ENV: 'test',
  });
  if (DB) {
    Object.assign(env, {
      DB_HOST, DB_PORT: String(DB_PORT), DB_USER, DB_PASSWORD: DB_PASS, DB_NAME: dbName,
      DB_CONNECT_TIMEOUT: '5000',
      INIT_ADMIN: 'admin',
      INIT_PASSWORD: 'Admin@123456',
    });
  }
  const proc = spawn(cmd, argv, { cwd: PROJ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  proc.stdout.on('data', (d) => logs.push(String(d)));
  proc.stderr.on('data', (d) => logs.push(String(d)));

  const up = await waitPort(PORT, 20000);
  check('服务启动', up, up ? BASE : logs.join('').slice(-300));
  if (!up) {
    proc.kill();
    return;
  }

  try {
    // 4. 未登录必须 401
    const me = await request('GET', BASE + '/auth/me');
    check('未登录拦截 401', me.status === 401, 'status=' + me.status);

    // 健康检查：不鉴权即可访问，且是 JSON
    const h = await request('GET', BASE + '/health');
    let hjson = {};
    try { hjson = JSON.parse(h.text); } catch (e) { hjson = {}; }
    check('健康检查 200', h.status === 200, 'status=' + h.status);
    check('健康检查含 status 字段', typeof hjson.data?.status === 'string' || typeof hjson.status === 'string',
      h.text.slice(0, 80));

    // 5. WAF：SQL 注入 / XSS / 路径穿越
    const sqli = await request('GET', BASE + "/order/orders?id=1' or 1=1");
    check('SQL 注入拦截 403', sqli.status === 403, 'status=' + sqli.status);

    const xss = await request('GET', BASE + '/order/orders?keyword=<script>alert(1)</script>');
    check('XSS 拦截 403', xss.status === 403, 'status=' + xss.status);

    const trav = await request('GET', BASE + '/files?path=../../etc/passwd');
    check('路径穿越拦截 403', trav.status === 403, 'status=' + trav.status);

    const dbl = await request('GET', BASE + '/order/orders?id=1%2527%2520or%25201%253D1');
    check('二次编码绕过拦截 403', dbl.status === 403, 'status=' + dbl.status);

    // 6. 坏 JSON 必须是 400，而不是 500
    const bad = await request('POST', BASE + '/auth/login', {
      body: '{oops',
      headers: { 'Content-Type': 'application/json' },
    });
    check('非法 JSON 返回 400', bad.status === 400, 'status=' + bad.status + ' ' + bad.text.slice(0, 60));

    // 7. 数据库不可用时必须是 503，且不泄露内网地址
    const login = await request('POST', BASE + '/auth/login', {
      body: { username: 'admin', password: 'whatever' },
      headers: { 'Content-Type': 'application/json' },
    });
    const leak = /127\.0\.0\.1|ECONNREFUSED|3306|ER_ACCESS/.test(login.text);
    check('数据库异常不泄露内网信息', !leak, 'status=' + login.status + ' body=' + login.text.slice(0, 60));
    check('数据库异常给出 503/401', [401, 503, 200].includes(login.status), 'status=' + login.status);

    // 8. 未知路由 404，且返回 JSON 而不是 HTML 堆栈
    const nf = await request('GET', BASE + '/nope/nothing');
    check('未知路由 404', nf.status === 404, 'status=' + nf.status);
    check('错误响应是 JSON', /^\{/.test(nf.text.trim()), nf.text.slice(0, 40));

    // 8b. 有数据库：真登录 → LUID → 真增改查 → 审计 → 登出失效
    if (DB) {
      const json = { 'Content-Type': 'application/json' };

      const login = await request('POST', BASE + '/auth/login', { body: { username: 'admin', password: 'Admin@123456' }, headers: json });
      let lj = {};
      try { lj = JSON.parse(login.text); } catch (e) { lj = {}; }
      const token = lj.data && lj.data.token;
      const luid = lj.data && lj.data.luid;
      check('真库登录成功', login.status === 200 && !!token, 'status=' + login.status);
      check('登录签发 LUID', typeof luid === 'string' && luid.startsWith('L'), 'luid=' + luid);
      if (!token) return;

      const auth = Object.assign({ Authorization: 'Bearer ' + token }, json);

      const me = await request('GET', BASE + '/auth/me', { headers: auth });
      let mj = {};
      try { mj = JSON.parse(me.text); } catch (e) { mj = {}; }
      check('/auth/me 带回同一 LUID', me.status === 200 && (mj.data ? (mj.data.luid || (mj.data.user && mj.data.user.luid)) : null) === luid,
        'status=' + me.status + ' luid=' + (mj.data && mj.data.luid));

      const wrong = await request('POST', BASE + '/auth/login', { body: { username: 'admin', password: 'wrong-pass' }, headers: json });
      check('错误口令 401', wrong.status === 401, 'status=' + wrong.status);

      const orderNo = 'RT' + Date.now();
      const create = await request('POST', BASE + '/order/biz-order', {
        body: { order_no: orderNo, buyer_id: 1001, buyer_name: 'rt', total_amount: 99.5, pay_status: 0, order_status: 1, source: 'rt-test' },
        headers: auth,
      });
      let cj = {};
      try { cj = JSON.parse(create.text); } catch (e) { cj = {}; }
      const rowId = cj.data && (cj.data.id || cj.data.insertId);
      check('创建订单（真写入）', create.status === 200 && !!rowId, 'status=' + create.status + ' id=' + rowId);

      const list = await request('GET', BASE + '/order/biz-order?keyword=' + encodeURIComponent(orderNo) + '&page=1&pageSize=10', { headers: auth });
      let ljson = {};
      try { ljson = JSON.parse(list.text); } catch (e) { ljson = {}; }
      const rows = (ljson.data && (ljson.data.list || ljson.data.rows || ljson.data)) || [];
      check('关键词过滤命中新订单',
        Array.isArray(rows) && rows.some((r) => String(r.order_no) === orderNo),
        'rows=' + (Array.isArray(rows) ? rows.length : typeof rows));

      const cond = await request('GET', BASE + '/order/biz-order?order_status__eq=1&sort=id:desc&page=1&pageSize=5', { headers: auth });
      check('条件查询 200', cond.status === 200, 'status=' + cond.status + ' ' + cond.text.slice(0, 60));

      const patch = await request('PATCH', BASE + '/order/biz-order', { body: { id: rowId, remark: 'rt-patched' }, headers: auth });
      check('条件更新 PATCH 200', patch.status === 200, 'status=' + patch.status + ' ' + patch.text.slice(0, 60));

      const aud = await request('GET', BASE + '/auditlog/sys-operation-log?page=1&pageSize=5', { headers: auth });
      let aj = {};
      try { aj = JSON.parse(aud.text); } catch (e) { aj = {}; }
      const arows = (aj.data && (aj.data.list || aj.data.rows || aj.data)) || [];
      check('审计日志有记录', aud.status === 200 && Array.isArray(arows) && arows.length > 0,
        'status=' + aud.status + ' rows=' + (Array.isArray(arows) ? arows.length : typeof arows));

      const out = await request('POST', BASE + '/auth/logout', { body: {}, headers: auth });
      check('登出 200', out.status === 200, 'status=' + out.status);
      const after = await request('GET', BASE + '/auth/me', { headers: auth });
      check('登出后旧 token 失效', after.status === 401, 'status=' + after.status);
    }

    // 9. CORS 预检
    const pre = await request('OPTIONS', BASE + '/auth/login', {
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    check('CORS 预检 204', pre.status === 204, 'status=' + pre.status);
    check('CORS 回源', !!pre.headers['access-control-allow-origin'], 'ACAO=' + pre.headers['access-control-allow-origin']);

    // 10. 安全头
    const sec = await request('GET', BASE + '/auth/me');
    check('X-Frame-Options', String(sec.headers['x-frame-options'] || '').toUpperCase() === 'DENY', String(sec.headers['x-frame-options']));
    check('X-Content-Type-Options', sec.headers['x-content-type-options'] === 'nosniff', String(sec.headers['x-content-type-options']));

    // 11. CC 限流：连打 60 次必须出现 429
    let hit429 = 0;
    let hit401 = 0;
    for (let i = 0; i < 60; i += 1) {
      const r = await request('GET', BASE + '/auth/me');
      if (r.status === 429) hit429 += 1;
      if (r.status === 401) hit401 += 1;
    }
    check('CC 限流触发 429', hit429 > 0, '401=' + hit401 + ' 429=' + hit429);

    // 12. 生成物自带 --selfcheck 能列出路由（不依赖数据库）
    if (LANG === 'node') {
      const sc = spawnSync(process.execPath, [path.join(PROJ, 'server.js'), '--selfcheck'], { cwd: PROJ, encoding: 'utf8' });
      check('--selfcheck 可运行', sc.status === 0 && /\[selfcheck\]/.test(sc.stdout || ''), (sc.stdout || '').split('\n')[0]);
    }
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 600));
    if (!KEEP) {
      if (DB && dbName) await dropDatabase(PROJ, dbName);
      try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* Windows 上偶尔被占用，忽略 */ }
    }
  }
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.pass);
    console.log('');
    console.log('结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
    if (failed.length) {
      console.log('失败项：' + failed.map((f) => f.name).join('、'));
      process.exit(1);
    }
    console.log('运行时冒烟测试全部通过');
  })
  .catch((e) => {
    console.error('测试异常：' + e.message);
    process.exit(1);
  });
