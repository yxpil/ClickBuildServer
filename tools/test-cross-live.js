// 作者：yxpil
'use strict';

// 真实 MariaDB 端到端：生成服务 → 自动建表 → 订单接口 JOIN 账号接口的表。
// 需要本机 127.0.0.1:13306 的 MariaDB（root/空密码）；不进 CI，手动运行。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const spec = require('../app/iface/spec');
const codegen = require('../app/iface/codegen');

const PORT = 18192;
const DB = 'cb_cross_live_' + Date.now().toString(36);
const ROOT = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cross-live-'));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function makeProject() {
  return spec.normalizeProject({
    name: '跨接口真实联查',
    categories: [{ id: 'biz', name: '业务' }],
    interfaces: [
      {
        id: 'iface_order', name: '订单服务', basePath: '/cross', tables: [{
          key: 'main', name: 'xs_order', comment: '订单',
          fields: [
            { name: 'id', type: 'bigint', pk: true, autoIncrement: true },
            { name: 'order_no', type: 'varchar' },
            { name: 'user_id', type: 'bigint' },
          ],
        }],
        routes: [{
          id: 'route_join', key: 'custom', name: '跨接口联查', method: 'GET', path: '/join',
          script: `LET $rows = QUERY SELECT o.id AS order_id, o.order_no, a.username\nFROM {{t:main}} o\nLEFT JOIN {{t:xs_account}} a ON a.id = o.user_id\nORDER BY o.id ASC;\nRETURN 200 { "ok": true, "rows": $rows.rows };`,
        }],
      },
      {
        id: 'iface_account', name: '账号服务', basePath: '/accounts', tables: [{
          key: 'main', name: 'xs_account', comment: '账号',
          fields: [
            { name: 'id', type: 'bigint', pk: true, autoIncrement: true },
            { name: 'username', type: 'varchar' },
          ],
        }],
        routes: [{ id: 'route_list', key: 'list', name: '账号列表', method: 'GET', path: '/accounts' }],
      },
    ],
  });
}

(async () => {
  const project = makeProject();
  console.log('生成服务 →', OUT);
  codegen.writeTo(project, path.join(OUT, 'svc'), { port: PORT, runtime: 'node', runtimeOnly: true });

  let child = null;
  let conn = null;
  try {
    child = spawn(process.execPath, [path.join(OUT, 'svc', 'server.js')], {
      cwd: path.join(OUT, 'svc'),
      env: {
        ...process.env,
        PORT: String(PORT),
        MYSQL_DB: DB,
        SEED_DEMO: '0',
        NODE_PATH: path.join(ROOT, 'node_modules'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logs = [];
    child.stdout.on('data', (d) => logs.push(String(d)));
    child.stderr.on('data', (d) => logs.push(String(d)));

    let up = false;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        const r = await get(`http://127.0.0.1:${PORT}/_health`);
        if (r.status === 200) { up = true; break; }
      } catch (e) { /* 等启动 */ }
      if (child.exitCode != null) break;
    }
    if (!up) throw new Error('生成服务没有启动：' + logs.join('').slice(-1200));

    conn = await mysql.createConnection({ host: '127.0.0.1', port: 13306, user: 'root', password: '', database: DB });
    await conn.query("INSERT INTO xs_account (id, username) VALUES (1, 'alice'), (2, 'bob')");
    await conn.query("INSERT INTO xs_order (id, order_no, user_id) VALUES (1, 'A-001', 1), (2, 'B-002', 2), (3, 'C-003', 99)");
    const r = await get(`http://127.0.0.1:${PORT}/api/cross/join`);
    const body = JSON.parse(r.body);
    const data = body.data || body;
    if (r.status !== 200 || !body.ok || !data.ok || !Array.isArray(data.rows) || data.rows.length !== 3) throw new Error('联查响应不对：' + r.body);
    if (data.rows[0].username !== 'alice' || data.rows[1].username !== 'bob' || data.rows[2].username !== null) {
      throw new Error('联查字段不对：' + r.body);
    }
    console.log('ok  跨接口 LEFT JOIN 返回 3 行，alice/bob/null 正确');
    console.log('日志片段：' + logs.join('').split('\n').filter(Boolean).slice(-3).join(' | '));
  } finally {
    if (conn) {
      try { await conn.query(`DROP DATABASE IF EXISTS \`${DB}\``); } catch (e) { /* ignore */ }
      try { await conn.end(); } catch (e) { /* ignore */ }
    }
    if (child) {
      child.kill();
      await sleep(800);
      if (child.exitCode == null) child.kill('SIGKILL');
    }
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
