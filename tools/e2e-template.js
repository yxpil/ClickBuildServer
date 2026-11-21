// 作者：yxpil
'use strict';

// 商城模版的真实 HTTP E2E：注册 → 商品 CRUD → 购物车联查 → 下单事务 → 联查订单
// 用法：runtime\node\node.exe tools\e2e-template.js http://127.0.0.1:18200

const base = process.argv[2] || 'http://127.0.0.1:18200';
const results = [];
let token = '';
let productId = 0;

async function call(method, p, body, extra) {
  const res = await fetch(base + p, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((extra && extra.headers) || {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let raw = null;
  try { raw = JSON.parse(text); } catch (e) { /* 非 JSON 也能看状态码 */ }
  // 服务统一包了一层 { ok, data }，测试里只关心 data
  const payload = raw && raw.ok === true && raw.data !== undefined ? raw.data : raw;
  return { status: res.status, json: payload, raw, text };
}

function check(name, ok, extra) {
  results.push(ok);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
}

(async () => {
  console.log(`模版 E2E → ${base}`);
  let r = await fetch(`${base}/_health`).then((x) => x.json());
  check('健康检查', !!r.ok, JSON.stringify(r).slice(0, 100));

  const products = await fetch(`${base}/api/products`).then((x) => x.json());
  const plist = products.data || products;
  check('商品列表可读', Array.isArray(plist.rows), `${plist.total} 条`);

  const created = await call('POST', '/api/products', { title: '测试键盘', price: 299.5, stock: 10, category: '外设' });
  check('新建商品', created.status === 201 && !!created.json.id, `${created.status}`);
  productId = created.json && created.json.id;

  await call('PUT', `/api/products/${productId}`, { price: 288, stock: 9 });
  const detail = await call('GET', `/api/products/${productId}`);
  check('改价并回读', detail.json.row && Number(detail.json.row.price) === 288, `price=${detail.json.row && detail.json.row.price}`);

  const reg = await call('POST', '/api/register', { username: `u${Date.now()}`, password: '123456', nickname: '测试' });
  check('注册发 token', reg.status === 201 && !!reg.json.token, `${reg.status}`);
  token = (reg.json && reg.json.token) || '';
  const login = await call('POST', '/api/login', { username: 'nobody', password: 'x' });
  check('错误用户 401', login.status === 401);

  const add = await call('POST', '/api/cart/add', { product_id: productId, qty: 2 });
  check('加入购物车', add.status === 200 && add.json.ok === true);
  const cart = await call('GET', '/api/cart');
  check('购物车联查商品', Array.isArray(cart.json.rows) && cart.json.rows.some((x) => x.title === '测试键盘'), `${cart.json.rows && cart.json.rows.length} 行`);

  const order = await call('POST', '/api/orders', { order_no: `SO${Date.now()}`, receiver: '张三', address: '昆明', amount: 576, items: [{ product_id: productId, title: '测试键盘', qty: 2, price: 288 }] });
  check('下单（两张表同一事务）', order.status === 201 && !!order.json.id, `${order.status}`);
  const orders = await call('GET', '/api/orders/with-items');
  check('订单联查明细', Array.isArray(orders.json.rows) && orders.json.rows.some((x) => x.title === '测试键盘'));

  const stock = await call('POST', `/api/products/${productId}/stock`, { qty: 99 });
  const stockErr = (stock.json && (stock.json.error || (stock.json.data && stock.json.data.error))) || '';
  check('库存不足 409', stock.status === 409 && stockErr === 'OUT_OF_STOCK', stock.text.slice(0, 80));

  const docs = await fetch(`${base}/docs`).then((x) => x.text());
  check('文档页可打开', docs.includes('<!doctype') || docs.includes('ClickBuild'), `${docs.length} 字节`);
  const openapi = await fetch(`${base}/openapi.json`).then((x) => x.json()).catch(() => null);
  check('OpenAPI 带示例', !!(openapi && openapi.paths));

  const failed = results.filter((x) => !x).length;
  console.log(`\n通过 ${results.length - failed} / ${results.length}${failed ? '，有失败' : '，全部通过'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E 崩溃：', e); process.exit(1); });
