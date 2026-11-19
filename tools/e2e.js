'use strict';

// 端到端测试：跑在生成出来的接口服务上。
// 用内置 node 执行：runtime\node\node.exe tools\e2e.js http://127.0.0.1:18100

const BASE = process.argv[2] || 'http://127.0.0.1:18100';
const results = [];
let pass = 0;
let fail = 0;

async function call(method, p, body, headers) {
  const opt = { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(headers || {}) } };
  if (body != null) opt.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetch(BASE + p, opt);
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch (e) { /* 保留文本 */ }
  return { status: res.status, data };
}

function check(name, cond, detail) {
  if (cond) { pass += 1; results.push(`  ✓ ${name}`); } else { fail += 1; results.push(`  ✗ ${name} ${detail ? `→ ${JSON.stringify(detail).slice(0, 160)}` : ''}`); }
}

(async () => {
  console.log(`E2E → ${BASE}\n`);

  const health = await call('GET', '/_health');
  check('健康检查三件套', health.status === 200 && health.data.mysql && health.data.redis && health.data.s3, health.data);

  const docs = await call('GET', '/_docs');
  check('OpenAPI 可解析', docs.status === 200 && docs.data.openapi === '3.0.3' && Object.keys(docs.data.paths || {}).length > 0, docs.status);

  const meta = await call('GET', '/_meta');
  const connKeys = meta.data && meta.data.connections && meta.data.connections.mysql ? meta.data.connections.mysql.length : 0;
  check('元信息包含连接/日志/token', !!(meta.data && meta.data.log && meta.data.token && connKeys >= 1), meta.data && meta.data.log);

  const routes = await call('GET', '/_routes');
  check('路由表完整', routes.status === 200 && routes.data.routes.length >= 10, routes.data && routes.data.routes.length);

  // 注册
  const uname = `u${Date.now().toString().slice(-8)}`;
  const reg = await call('POST', '/api/register', { username: uname, password: 'pw123456', nickname: '测试' });
  check('注册成功并返回 onlyId/token', reg.status === 201 && reg.data.data.onlyId && reg.data.data.token, reg);

  const reg2 = await call('POST', '/api/register', { username: uname, password: 'pw123456', nickname: '测试' });
  check('重复注册 409', reg2.status === 409 && reg2.data.data.error === 'USER_EXISTS', reg2.status);

  // 登录
  const login = await call('POST', '/api/login', { username: uname, password: 'pw123456' });
  check('登录成功', login.status === 200 && login.data.data.token, login.status);
  const badLogin = await call('POST', '/api/login', { username: uname, password: 'wrong' });
  check('错误密码 401', badLogin.status === 401 && badLogin.data.data.error === 'BAD_PASSWORD', badLogin.status);

  const token = login.data.data.token;
  const me = await call('GET', '/api/me', null, { authorization: `Bearer ${token}` });
  check('token 取当前用户', me.status === 200 && me.data.data.user && me.data.data.user.username === uname, me.data);
  const noToken = await call('GET', '/api/me');
  check('无 token 401', noToken.status === 401, noToken.status);

  // 订单 CRUD
  const created = await call('POST', '/api/biz_order', { order_no: `SO-${Date.now()}`, customer: '张三', amount: 88.5, status: 1 });
  check('新建订单（事务提交）', created.status === 201 && created.data.data.id > 0, created.data);
  const orderId = created.data.data.id;

  const list1 = await call('GET', '/api/biz_order?page=1&size=5');
  check('列表返回', list1.status === 200 && Array.isArray(list1.data.data.rows), list1.status);
  const list2 = await call('GET', '/api/biz_order?page=1&size=5');
  check('第二次命中缓存', list2.data.cached === true, list2.data.cached);

  const detail = await call('GET', `/api/biz_order/${orderId}`);
  check('详情', detail.status === 200 && detail.data.data.row && String(detail.data.data.row.id) === String(orderId), detail.status);

  const upd = await call('PUT', `/api/biz_order/${orderId}`, { customer: '李四', amount: 99 });
  check('更新（事务提交）', upd.status === 200 && upd.data.data.changed === 1, upd.data);
  const after = await call('GET', `/api/biz_order/${orderId}`);
  check('更新后缓存已失效', after.data.cached !== true && after.data.data.row.customer === '李四', after.data);

  const join = await call('GET', '/api/orders/with-items');
  check('多表联查', join.status === 200 && Array.isArray(join.data.data.rows), join.status);

  // 事务回滚
  const before = (await call('GET', '/api/biz_order?page=1&size=1')).data.data.total;
  const tx = await call('POST', '/api/orders/tx-demo', { order_no: 'TX-1', customer: '回滚', amount: 1, sku: 'A', qty: 2, price: 3 });
  check('事务脚本返回回滚', tx.status === 200 && tx.data.data.rolledBack === true, tx.data);
  const afterTx = (await call('GET', '/api/biz_order?page=1&size=1')).data.data.total;
  check('回滚后数据未增加', Number(afterTx) === Number(before), { before, afterTx });

  // 限流
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await call('GET', '/api/orders/ping')).status);
  check('限流生效（3 次后 429）', codes.slice(0, 3).every((c) => c === 200) && codes.slice(3).every((c) => c === 429), codes);

  // 上传
  const fd = new FormData();
  fd.append('file', new Blob(['hello clickbuild e2e'], { type: 'text/plain' }), 'e2e.txt');
  const up = await fetch(`${BASE}/api/biz_order/${orderId}/file`, { method: 'POST', body: fd });
  const upData = await up.json();
  check('附件进对象存储并回填', up.status === 200 && upData.data && upData.data.key, up.status);

  // 日志
  const logs = await call('GET', '/_logs?tail=200');
  const hasLevels = logs.data.logs.some((l) => l.level && l.iface);
  check('运行日志带等级与接口名', logs.status === 200 && hasLevels, logs.data.logs && logs.data.logs.slice(-2));

  // 清理
  const del = await call('DELETE', `/api/biz_order/${orderId}`);
  check('删除（事务提交）', del.status === 200 && del.data.data.deleted === 1, del.data);

  console.log(results.join('\n'));
  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? '，失败 ' + fail : '，全部通过'}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 崩了：', e); process.exit(2); });
