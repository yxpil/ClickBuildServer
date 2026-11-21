// 作者：yxpil
'use strict';

// 跨库事务的真实回归：服务必须已经启动，并已连上 MariaDB。
// 用法：
//   runtime\node\node.exe tools\e2e-crossdb.js http://127.0.0.1:18300
// 可选环境变量：MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MAIN_DB/AUX_DB

const mysql = require('mysql2/promise');

const base = (process.argv[2] || 'http://127.0.0.1:18300').replace(/\/$/, '');
const orders = [];
function check(name, ok, extra = '') {
  orders.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
}
const req = async (method, path, body) => {
  const r = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch (e) { data = { raw: await r.text().catch(() => '') }; }
  return { status: r.status, data };
};
const rowsOf = (data) => (data && data.data && Array.isArray(data.data.rows) ? data.data.rows : []);
const mysqlOpts = (db) => ({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 13306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: db,
});

(async () => {
  const health = await req('GET', '/_health');
  check('健康检查', health.status === 200 && health.data.ok === true, `HTTP ${health.status}`);

  const tag = `E2E-${Date.now()}`;
  const body = { order_no: tag, user_id: 1, amount: 10.25, sku: 'E2E-SKU', qty: 2, price: 5.125 };
  const created = await req('POST', '/api/orders', body);
  check('跨库下单成功', created.status === 201 && created.data.ok === true, JSON.stringify(created.data).slice(0, 160));
  const orderId = created.data && created.data.data && created.data.data.orderId;
  check('返回订单 id', Number(orderId) > 0, String(orderId));

  const before = await req('GET', '/api/orders');
  const beforeRows = rowsOf(before.data);
  const beforeHit = beforeRows.filter((r) => r.order_no === tag).length;
  check('跨库 JOIN 能查回订单', before.status === 200 && beforeHit === 1, `rows=${beforeRows.length}`);

  const aux = await mysql.createConnection(mysqlOpts(process.env.AUX_DB || 'clickbuild_aux'));
  const [auxRows] = await aux.query('SELECT order_id, sku, qty FROM cross_order_item WHERE order_id = ?', [orderId]);
  check('明细已写入辅库', auxRows.length === 1 && auxRows[0].sku === 'E2E-SKU', JSON.stringify(auxRows));

  const failed = await req('POST', '/api/orders/fail', { order_no: `${tag}-BAD`, user_id: 1, amount: 1, sku: 'BAD', qty: 1, price: 1 });
  check('故意失败返回 5xx', failed.status >= 500, `HTTP ${failed.status}`);
  check('失败响应是 SQL 错误', !!(failed.data && /no_such_column/i.test(failed.data.message || '')), String((failed.data || {}).message || '').slice(0, 120));

  const after = await req('GET', '/api/orders');
  const afterRows = rowsOf(after.data);
  check('失败后主表没有新增', afterRows.length === beforeRows.length, `${beforeRows.length} -> ${afterRows.length}`);
  check('失败单号没有落库', afterRows.every((r) => r.order_no !== `${tag}-BAD`));

  const [zero] = await aux.query('SELECT COUNT(*) AS n FROM cross_order_item WHERE order_id = 0');
  check('失败插入的孤儿明细已回滚', Number(zero[0].n) === 0, `order_id=0 rows=${zero[0].n}`);
  await aux.end();

  const main = await mysql.createConnection(mysqlOpts(process.env.MAIN_DB || 'clickbuild_cross_main'));
  const [mainRows] = await main.query('SELECT order_no FROM cross_order WHERE order_no IN (?, ?)', [tag, `${tag}-BAD`]);
  check('主库只保留成功订单', mainRows.length === 1 && mainRows[0].order_no === tag, JSON.stringify(mainRows));
  await main.end();

  const bad = orders.filter((x) => !x.ok);
  console.log(`\n${orders.length - bad.length}/${orders.length} 通过`);
  // 等 socket 关闭，避免 Node 25 / Windows 在退出瞬间触发 libuv 断言
  await new Promise((r) => setTimeout(r, 300));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.error('E2E 运行失败：', e.message);
  process.exit(2);
});
