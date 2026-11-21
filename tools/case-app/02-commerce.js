// 作者：yxpil
/* 交易模式：商城 / 活动票务 / 餐厅点餐。真实商品、购物车、库存、订单、票码、桌台。 */
function cart() { return storeGet('cbs-cart:' + (CASE.code || 'case'), []); }
function saveCart(v) { storeSet('cbs-cart:' + (CASE.code || 'case'), v); }
function cartCount() { return cart().reduce((n, x) => n + Number(x.qty || 0), 0); }

function addCart(item, qty) {
  const list = cart();
  const found = list.find((x) => String(x.id) === String(item.id));
  if (found) found.qty = Number(found.qty) + Number(qty || 1);
  else list.push(Object.assign({}, item, { qty: Number(qty || 1) }));
  saveCart(list);
  toast('已加入购物车', 'ok');
  renderChrome();
  App.render();
}
App.addCart = addCart;

function setCartQty(id, delta) {
  const list = cart();
  const found = list.find((x) => String(x.id) === String(id));
  if (!found) return;
  found.qty = Math.max(1, Number(found.qty) + delta);
  saveCart(list);
  renderChrome();
  App.render();
}
App.setCartQty = setCartQty;

function removeCart(id) {
  saveCart(cart().filter((x) => String(x.id) !== String(id)));
  renderChrome();
  App.render();
}
App.removeCart = removeCart;

function commerceCard(row, kind) {
  const title = row.title || row.name || '未命名';
  const cat = row.category || row.venue || '';
  const price = row.price;
  const stock = row.stock;
  let foot = '<span>' + esc(UX.itemLabel) + ' →</span>';
  if (kind === 'mall') foot = '<span class="' + (Number(stock) > 0 ? 'price' : 'pill bad') + '">' + (Number(stock) > 0 ? fmtMoney(price) : '已售罄') + '</span><span>库存 ' + esc(stock == null ? '—' : stock) + '</span>';
  if (kind === 'event') foot = '<span class="price">' + fmtMoney(price) + '</span><span>余票 ' + esc(stock == null ? '—' : stock) + '</span>';
  return '<article class="card" onclick="App.openCommerceItem(' + HQ(row.id) + ')">' +
    '<div class="card-cover">' + coverHtml(row, { label: cat || UX.itemLabel }) + '</div>' +
    '<div class="card-body"><div class="card-kicker"><span>' + esc(cat || UX.kicker) + '</span><span>' + esc(kind === 'event' ? fmtDate(row.start_at, true) : '现货') + '</span></div>' +
    '<h3>' + esc(title) + '</h3><p>' + esc(plain(row.description || row.venue || '', 100) || '打开查看详情。') + '</p>' +
    '<div class="card-foot">' + foot + '</div></div></article>';
}

async function mallHome() {
  setMain(loadingHtml());
  try {
    const rows = rowsOf(await api(UX.primary.iface, UX.primary.list));
    state.rows[UX.primary.iface] = rows;
    const onSale = rows.filter((r) => !UX.fields.status || String(r[UX.fields.status]) === '1');
    const cats = Array.from(new Set(onSale.map((r) => r.category).filter(Boolean)));
    const list = filterKeyword(onSale, ['title', 'description', 'category']);
    const hero = '<section class="hero"><div class="hero-card" style="background:#1F2A24">' +
      '<div class="eyebrow">' + esc(UX.home.kicker) + '</div><h1>' + esc(UX.home.title) + '</h1><p>' + esc(UX.home.sub) + '</p>' +
      '<div class="hero-actions"><button class="btn" onclick="App.go(\'collection\')">' + esc(UX.home.cta) + '</button>' +
      '<button class="btn ghost" onclick="App.go(\'cart\')">购物车 · ' + cartCount() + '</button></div></div>' +
      '<div class="hero-art"><div class="hero-art-head"><span>今日推荐</span><span>' + esc(UX.mark) + '</span></div>' +
      (list[0] ? '<div class="hero-feature"><span class="big">' + esc(fmtMoney(list[0].price)) + '</span><b>' + esc(list[0].title) + '</b><span>' + esc(list[0].category || '') + ' · 库存 ' + esc(list[0].stock) + '</span></div>' : '') +
      '<div class="hero-list">' + list.slice(0, 4).map((r) => '<div><span>' + esc(short(r.title, 20)) + '</span><em>' + esc(fmtMoney(r.price)) + '</em></div>').join('') + '</div></div></section>';
    setMain('<div class="page">' + hero +
      '<section class="section"><div class="section-head"><div><h2>全部商品</h2><p>共 ' + onSale.length + ' 件在售</p></div>' +
      '<div class="chips">' + cats.map((c) => '<button class="chip ' + (state.params.category === c ? 'on' : '') + '" onclick="App.filterValue(\'category\',' + HQ(c) + ')">' + esc(c) + '</button>').join('') + '</div></div>' +
      '<div class="grid four">' + list.filter((r) => !state.params.category || r.category === state.params.category).map((r) => commerceCard(r, 'mall')).join('') + '</div></section>' +
      pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

async function eventHome() {
  setMain(loadingHtml());
  try {
    const rows = rowsOf(await api(UX.primary.iface, UX.primary.list));
    state.rows[UX.primary.iface] = rows;
    const list = filterKeyword(rows, ['title', 'venue']);
    const hero = '<section class="hero"><div class="hero-card" style="background:#7A2F1B">' +
      '<div class="eyebrow">' + esc(UX.home.kicker) + '</div><h1>' + esc(UX.home.title) + '</h1><p>' + esc(UX.home.sub) + '</p>' +
      '<div class="hero-actions"><button class="btn" onclick="App.go(\'collection\')">' + esc(UX.home.cta) + '</button><button class="btn ghost" onclick="App.go(\'my\')">我的票夹</button></div></div>' +
      '<div class="hero-art"><div class="hero-art-head"><span>最近一场</span><span>' + esc(UX.mark) + '</span></div>' +
      (list[0] ? '<div class="hero-feature"><span class="big">' + esc(fmtDate(list[0].start_at)) + '</span><b>' + esc(list[0].title) + '</b><span>' + esc(list[0].venue || '') + ' · ' + esc(fmtMoney(list[0].price)) + '</span></div>' : '') +
      '<div class="hero-list">' + list.slice(0, 4).map((r) => '<div><span>' + esc(short(r.title, 20)) + '</span><em>' + esc(fmtDate(r.start_at)) + '</em></div>').join('') + '</div></div></section>';
    setMain('<div class="page">' + hero + '<section class="section"><div class="section-head"><div><h2>近期活动</h2><p>选一场，买票后生成唯一电子票码</p></div></div>' +
      '<div class="grid">' + list.map((r) => commerceCard(r, 'event')).join('') + '</div></section>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

async function posHome() {
  setMain(loadingHtml());
  try {
    const dishes = rowsOf(await api(UX.primary.iface, UX.primary.list));
    const tables = rowsOf(await api(UX.tables.iface, UX.tables.list));
    state.rows[UX.primary.iface] = dishes;
    state.rows.__tables = tables;
    const tableId = state.params.table;
    const table = tables.find((t) => String(t.id) === String(tableId));
    const cartList = cart();
    const total = cartList.reduce((n, x) => n + Number(x.price) * Number(x.qty), 0);
    const tableHtml = '<div class="panel"><div class="panel-head"><h3>桌台</h3><span class="faint">先开台，再点菜</span></div><div class="chips">' +
      tables.map((t) => '<button class="chip ' + (String(tableId) === String(t.id) ? 'on' : '') + '" onclick="App.selectTable(' + HQ(t.id) + ')">' +
        esc(t.table_no) + ' · ' + (Number(t.status) === 1 ? '用餐中' : '空闲') + ' · ' + esc(t.seats) + '座</button>').join('') + '</div>' +
      (table ? '<p class="faint" style="margin:14px 0 0">当前：' + esc(table.table_no) + '（' + esc(table.seats) + ' 座）</p>' : '<p class="faint" style="margin:14px 0 0">还没有选桌台</p>') + '</div>';
    const dishesHtml = '<div class="panel"><div class="panel-head"><h3>菜单</h3><span class="faint">' + dishes.length + ' 道菜</span></div><div class="grid four">' +
      dishes.map((d) => '<article class="card"><div class="card-body"><div class="card-kicker"><span>' + esc(d.category || '热菜') + '</span><span>库存 ' + esc(d.stock) + '</span></div><h3>' + esc(d.name) + '</h3>' +
        '<div class="card-foot"><span class="price">' + fmtMoney(d.price) + '</span><button class="btn sm primary" onclick="App.posAdd(' + HQ(d.id) + ')">加入</button></div></div></article>').join('') + '</div></div>';
    const orderHtml = '<div class="panel"><div class="panel-head"><h3>当前桌台订单</h3><span class="faint">' + cartList.length + ' 项</span></div>' +
      (cartList.length ? cartList.map((x) => '<div class="cart-line"><div class="thumb">' + esc(String(x.name || '菜').slice(0, 1)) + '</div><div class="info"><b>' + esc(x.name) + '</b><span>' + fmtMoney(x.price) + ' × ' + x.qty + '</span></div>' +
        '<div class="qty"><button onclick="App.setCartQty(' + HQ(x.id) + ',-1)">−</button><em>' + x.qty + '</em><button onclick="App.setCartQty(' + HQ(x.id) + ',1)">+</button></div></div>').join('') : '<div class="empty" style="padding:30px">还没有加菜</div>') +
      '<div class="cart-total" style="margin-top:16px"><span>合计</span><b>' + fmtMoney(total) + '</b></div>' +
      '<button class="btn primary block" onclick="App.posSubmit()" ' + (!table || !cartList.length ? 'disabled' : '') + '>下单到后厨</button></div>';
    setMain('<div class="page">' + pageTitle('点餐台', '桌台、菜品、加菜、订单明细和后厨队列都是真实数据。') + tableHtml + '<div class="grid" style="grid-template-columns:minmax(0,1.4fr) minmax(320px,.8fr);align-items:start"><div>' + dishesHtml + '</div><div>' + orderHtml + '</div></div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

function filterKeyword(rows, fields) {
  const kw = searchValue().toLowerCase();
  if (!kw) return rows;
  return rows.filter((r) => fields.some((f) => String(r[f] || '').toLowerCase().indexOf(kw) >= 0));
}

App.filterValue = (key, value) => { state.params[key] = value; App.render(); };

async function commerceHome() {
  if (UX.kind === 'event') return eventHome();
  if (UX.kind === 'pos') return posHome();
  return mallHome();
}

async function commerceCollection() {
  if (UX.kind === 'event') return eventHome();
  if (UX.kind === 'pos') return posHome();
  return mallHome();
}

App.selectTable = async (id) => {
  try {
    await api(UX.tables.iface, UX.tables.open, { method: 'POST', params: { id }, body: {} });
    state.params.table = id;
    toast('已开台', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.posAdd = (id) => {
  const d = (state.rows[UX.primary.iface] || []).find((x) => String(x.id) === String(id));
  if (!d) return;
  const list = cart();
  const found = list.find((x) => String(x.id) === String(id));
  if (found) found.qty += 1;
  else list.push({ id: d.id, name: d.name, price: d.price, qty: 1 });
  saveCart(list);
  App.render();
};

App.posSubmit = async () => {
  if (!requireAuth('登录后才能下单')) return;
  const tableId = state.params.table;
  const list = cart();
  if (!tableId || !list.length) return;
  try {
    let orderId = 0;
    for (const item of list) {
      const d = await api(UX.order.iface, UX.order.create, {
        method: 'POST',
        body: { table_id: tableId, dish_id: item.id, name: item.name, price: item.price, qty: item.qty },
      });
      orderId = d.orderId || orderId;
    }
    saveCart([]);
    toast('已下单到后厨', 'ok');
    state.params.orderId = orderId;
    App.go('order', { id: orderId });
  } catch (e) { toast(e.message, 'err'); }
};

async function commerceItem() {
  const id = state.params.id;
  if (UX.kind === 'pos') return posHome();
  setMain(loadingHtml());
  try {
    let row;
    if (UX.kind === 'mall' && UX.primary.detail) {
      row = itemOf(await api(UX.primary.iface, UX.primary.detail, { params: { id } }));
    } else {
      row = (state.rows[UX.primary.iface] || []).find((x) => String(x.id) === String(id)) || itemOf(await api(UX.primary.iface, UX.primary.list));
    }
    if (!row || !row.id) throw new Error('记录不存在');
    const isEvent = UX.kind === 'event';
    const price = row.price;
    const stock = row.stock;
    const desc = row.description || row.venue || '';
    const body = isEvent
      ? '<div class="detail-grid"><div><label>场地</label><b>' + esc(row.venue || '—') + '</b></div><div><label>时间</label><b>' + esc(fmtDate(row.start_at, true)) + '</b></div><div><label>票价</label><b>' + fmtMoney(price) + '</b></div><div><label>余票</label><b>' + esc(stock) + '</b></div></div>'
      : '<div class="detail-grid"><div><label>分类</label><b>' + esc(row.category || '—') + '</b></div><div><label>售价</label><b>' + fmtMoney(price) + '</b></div><div><label>库存</label><b>' + esc(stock) + '</b></div><div><label>销量</label><b>' + esc(row.sales || 0) + '</b></div></div>' +
        '<div class="article-body" style="margin-top:14px">' + richBody(desc) + '</div>';
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回列表</button>' +
      '<span class="pill ' + (Number(stock) > 0 ? 'ok' : 'bad') + '">' + (Number(stock) > 0 ? '可购买' : '已售罄') + '</span></div>' +
      '<div class="panel" style="padding:30px">' +
      '<div class="hero" style="grid-template-columns:260px minmax(0,1fr);margin:0 0 24px"><div style="height:220px;border-radius:14px;overflow:hidden;position:relative;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#111))">' + coverHtml(row, { label: row.category || '' }) + '</div>' +
      '<div><div class="eyebrow">' + esc(UX.kicker) + ' · ' + esc(isEvent ? '现场票务' : '在售商品') + '</div><h1 style="font-size:30px;margin:10px 0">' + esc(row.title) + '</h1>' +
      '<div class="price" style="font-size:28px">' + fmtMoney(price) + '</div>' +
      '<div class="hero-actions"><div class="qty" style="height:38px"><button onclick="App.buyQty(-1)">−</button><em id="buy-qty" style="width:40px;font-size:13px">1</em><button onclick="App.buyQty(1)">+</button></div>' +
      '<button class="btn primary" onclick="App.addCommerceCart()" ' + (Number(stock) <= 0 ? 'disabled' : '') + '>' + (isEvent ? '购买门票' : '加入购物车') + '</button></div></div></div>' +
      body + '</div>' + pageFoot() + '</div>');
    App._buyRow = row;
    App._buyQty = 1;
  } catch (e) { setMain('<div class="page">' + emptyHtml('打不开这个页面', e.message) + '</div>'); }
}

App.buyQty = (d) => {
  App._buyQty = Math.max(1, (App._buyQty || 1) + d);
  const el = $('#buy-qty');
  if (el) el.textContent = App._buyQty;
};

App.addCommerceCart = () => {
  const row = App._buyRow;
  if (!row) return;
  addCart({ id: row.id, title: row.title, price: row.price, stock: row.stock, kind: UX.kind }, App._buyQty || 1);
  if (UX.kind === 'event') App.go('cart');
  else toast('已加入购物车，可在购物车结账', 'ok');
};

App.openCommerceItem = (id) => {
  state.params = { id };
  state.view = 'item';
  renderChrome();
  App.render();
};

async function commerceCart() {
  const list = cart();
  const total = list.reduce((n, x) => n + Number(x.price) * Number(x.qty), 0);
  setMain('<div class="page narrow">' + pageTitle('购物车', '这里是你刚刚加进来的真实商品或门票。') +
    (list.length ? '<div class="panel">' + list.map((x) => '<div class="cart-line"><div class="thumb">' + esc(String(x.title || '·').slice(0, 1)) + '</div><div class="info"><b>' + esc(x.title) + '</b><span>' + fmtMoney(x.price) + ' × ' + x.qty + '</span></div>' +
      '<div class="qty"><button onclick="App.setCartQty(' + HQ(x.id) + ',-1)">−</button><em>' + x.qty + '</em><button onclick="App.setCartQty(' + HQ(x.id) + ',1)">+</button></div>' +
      '<button class="btn sm danger" onclick="App.removeCart(' + HQ(x.id) + ')">移除</button></div>').join('') +
      '<div class="cart-total" style="margin-top:20px"><span>合计</span><b>' + fmtMoney(total) + '</b></div>' +
      '<button class="btn primary block" style="margin-top:14px" onclick="App.checkout()">去结算</button></div>' : emptyHtml('购物车是空的', '先去挑点东西。') ) +
    pageFoot() + '</div>');
}

App.checkout = () => {
  if (!requireAuth('登录后才能结算')) return;
  const list = cart();
  if (!list.length) return;
  const fields = UX.kind === 'mall' ? ['receiver', 'address'] : [];
  modal({
    title: '确认订单',
    desc: '提交后会调用真实下单接口，商城还会先扣减库存。',
    width: 560,
    body: '<div class="form">' + (fields.length ? fields.map((f) => '<div class="field full"><label>' + (f === 'receiver' ? '收货人' : '收货地址') + '</label><input data-field="' + f + '" placeholder="' + (f === 'receiver' ? '姓名' : '详细地址') + '"></div>').join('') : '') +
      '<div class="form-note">共 ' + list.length + ' 项，合计 ' + fmtMoney(list.reduce((n, x) => n + Number(x.price) * Number(x.qty), 0)) + '</div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.doCheckout()">提交订单</button>',
  });
};

App.doCheckout = async () => {
  const list = cart();
  const form = $('#modal-body');
  const data = readForm(form);
  if (UX.kind === 'mall' && (!data.receiver || !data.address)) { toast('收货人和地址都要填', 'err'); return; }
  try {
    if (UX.kind === 'mall') {
      for (const item of list) {
        await api(UX.stock.iface, UX.stock.path, { method: 'POST', params: { id: item.id }, body: { qty: item.qty } });
      }
      await api(UX.order.iface, UX.order.create, {
        method: 'POST',
        body: {
          order_no: 'SO' + Date.now(),
          receiver: data.receiver,
          address: data.address,
          amount: list.reduce((n, x) => n + Number(x.price) * Number(x.qty), 0),
          items: list.map((x) => ({ product_id: x.id, title: x.title, qty: x.qty, price: x.price })),
        },
      });
    } else {
      for (const item of list) {
        await api(UX.ticket.iface, UX.ticket.buy, { method: 'POST', body: { event_id: item.id, qty: item.qty } });
      }
    }
    saveCart([]);
    App.closeModal();
    renderChrome();
    toast('下单成功', 'ok');
    App.go('my');
  } catch (e) {
    toast(e.message || '下单失败', 'err');
  }
};

async function commerceMy() {
  if (UX.kind === 'event') {
    if (!state.token) { setMain('<div class="page">' + emptyHtml('登录后查看电子票', '票夹按账号保存。') + '<div style="text-align:center"><button class="btn primary" onclick="App.login()">登录</button></div></div>'); return; }
    setMain(loadingHtml());
    try {
      const rows = rowsOf(await api(UX.ticket.iface, UX.ticket.mine));
      setMain('<div class="page">' + pageTitle('我的票夹', '每张票都有唯一票码，现场可以直接核销。') +
        (rows.length ? '<div class="grid">' + rows.map((r) => '<article class="card"><div class="card-cover" style="height:130px;background:linear-gradient(135deg,#7A2F1B,#C06A3E)"><span class="cover-label">' + (Number(r.checked) === 1 ? '已核销' : '待入场') + '</span></div><div class="card-body"><h3>' + esc(r.title) + '</h3><p>' + esc(fmtDate(r.start_at, true)) + ' · ' + esc(r.qty) + ' 张</p>' +
          '<div class="card-foot"><span style="font-family:ui-monospace,monospace;font-weight:700">' + esc(r.code) + '</span><span class="pill ' + (Number(r.checked) === 1 ? 'ok' : 'warn') + '">' + (Number(r.checked) === 1 ? '已核销' : '未核销') + '</span></div></div></article>').join('') + '</div>' : emptyHtml('还没有票', '去活动页买一张。')) + pageFoot() + '</div>');
    } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
    return;
  }
  if (UX.kind === 'pos') {
    if (!state.token) { setMain('<div class="page">' + emptyHtml('登录后查看后厨', '后厨队列按账号权限读取。') + '</div>'); return; }
    try {
      const rows = rowsOf(await api(UX.order.iface, UX.order.kitchen));
      setMain('<div class="page">' + pageTitle('后厨队列', '所有未结账订单的菜品，按加入顺序排列。') + tableHTML(UX.order.iface, rows, ['name', 'qty', 'table_id', 'order_id'], { emptyTitle: '后厨已经清空' }) + pageFoot() + '</div>');
    } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
    return;
  }
  setMain(loadingHtml());
  try {
    let rows = rowsOf(await api(UX.order.iface, UX.order.withItems || UX.order.list));
    setMain('<div class="page">' + pageTitle('我的订单', '订单和明细来自真实联查。') +
      (rows.length ? tableHTML(UX.order.iface, rows, ['order_no', 'title', 'qty', 'amount', 'status'], { emptyTitle: '还没有订单' }) : emptyHtml('还没有订单', '去商城下一单。')) + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

async function commerceOrder() {
  if (!state.token) return commerceMy();
  setMain(loadingHtml());
  try {
    const d = await api(UX.order.iface, UX.order.detail, { params: { id: state.params.id } });
    const order = itemOf(d);
    const items = order.__items || [];
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'home\')">← 返回点餐台</button><span class="pill warn">' + esc(order.status || 'open') + '</span></div>' +
      '<div class="panel"><div class="panel-head"><h3>订单 #' + esc(order.id) + ' · 桌台 ' + esc(order.table_id) + '</h3><b class="price">' + fmtMoney(order.total) + '</b></div>' +
      tableHTML(UX.order.iface, items, ['name', 'price', 'qty'], { emptyTitle: '还没有菜品' }) +
      '<button class="btn primary" style="margin-top:16px" onclick="App.checkoutPos(' + HQ(order.id) + ')">结账并释放桌台</button></div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

App.checkoutPos = async (id) => {
  try {
    await api(UX.order.iface, UX.order.checkout, { method: 'PUT', params: { id }, body: {} });
    toast('已结账，桌台已释放', 'ok');
    App.go('home');
  } catch (e) { toast(e.message, 'err'); }
};

async function commerceAdmin() {
  if (UX.kind === 'event') {
    setMain(loadingHtml());
    try {
      const rows = rowsOf(await api(UX.primary.iface, UX.primary.list));
      let tickets = [];
      try { tickets = rowsOf(await api(UX.ticket.iface, '/tickets')); } catch (e) { tickets = []; }
      state.rows[UX.primary.iface] = rows;
      state.rows.__tickets = tickets;
      setMain('<div class="page">' + pageTitle('活动管理', '发布活动后，余票和购票会实时变化。') +
        '<div class="toolbar"><button class="btn primary" onclick="App.newEvent()">+ 发布活动</button><span class="spacer"></span></div>' +
        '<div class="panel"><div class="panel-head"><h3>活动</h3><span class="faint">' + rows.length + ' 场</span></div>' + tableHTML(UX.primary.iface, rows, ['title', 'venue', 'start_at', 'price', 'stock'], { emptyTitle: '还没有活动' }) + '</div>' +
        '<div class="panel" style="margin-top:18px"><div class="panel-head"><h3>票务核销</h3><span class="faint">' + tickets.filter((x) => !Number(x.checked)).length + ' 张待核销</span></div>' +
        tableHTML(UX.ticket.iface, tickets, ['code', 'title', 'qty', 'start_at', 'checked'], {
          emptyTitle: '还没有售出票',
          actions: (row) => Number(row.checked) ? '<span class="pill ok">已核销</span>' : '<button class="btn sm primary" onclick="event.stopPropagation();App.checkinTicket(' + HQ(row.code) + ')">核销</button>',
        }) + '</div>' + pageFoot() + '</div>');
    } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
    return;
  }
  if (UX.kind === 'pos') {
    setMain(loadingHtml());
    try {
      const dishes = rowsOf(await api(UX.primary.iface, UX.primary.list));
      const tables = rowsOf(await api(UX.tables.iface, UX.tables.list));
      state.rows[UX.primary.iface] = dishes;
      state.rows.__tables = tables;
      setMain('<div class="page">' + pageTitle('菜单管理', '菜品和桌台是点餐台的基础数据。') +
        '<div class="toolbar"><button class="btn primary" onclick="App.newDish()">+ 新增菜品</button><button class="btn" onclick="App.newTable()">+ 新增桌台</button><span class="spacer"></span></div>' +
        '<div class="panel"><div class="panel-head"><h3>菜品</h3><span class="faint">' + dishes.length + ' 道</span></div>' + tableHTML(UX.primary.iface, dishes, ['name', 'category', 'price', 'stock']) + '</div>' +
        '<div class="panel"><div class="panel-head"><h3>桌台</h3><span class="faint">' + tables.length + ' 张</span></div>' + tableHTML(UX.tables.iface, tables, ['table_no', 'seats', 'status']) + '</div>' + pageFoot() + '</div>');
    } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
    return;
  }
  setMain(loadingHtml());
  try {
    const rows = rowsOf(await api(UX.primary.iface, UX.primary.list));
    state.rows[UX.primary.iface] = rows;
    setMain('<div class="page">' + pageTitle('商品管理', '上架、改价、改库存都会实时影响商城。') +
      '<div class="toolbar"><button class="btn primary" onclick="App.newProduct()">+ 上架商品</button><span class="spacer"></span></div>' +
      tableHTML(UX.primary.iface, rows, ['title', 'category', 'price', 'stock', 'status'], {
        emptyTitle: '还没有商品',
        actions: (row) => '<button class="btn sm" onclick="event.stopPropagation();App.editProduct(' + HQ(row.id) + ')">编辑</button><button class="btn sm danger" onclick="event.stopPropagation();App.deleteProduct(' + HQ(row.id) + ')">删除</button>',
      }) + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

function productForm(title, values, submit) {
  openForm({
    title,
    iface: UX.primary.iface,
    path: values && values.id ? UX.primary.update : UX.primary.create,
    values: values || {},
    submitLabel: '保存商品',
    onSubmit: async (data) => {
      if (values && values.id) await api(UX.primary.iface, UX.primary.update, { method: 'PUT', params: { id: values.id }, body: data });
      else await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: data });
      toast('已保存', 'ok');
      await App.render();
    },
  });
}
App.newProduct = () => { if (requireAuth()) productForm('上架商品', null); };
App.editProduct = (id) => {
  const row = (state.rows[UX.primary.iface] || []).find((x) => String(x.id) === String(id));
  if (row) productForm('编辑商品', row);
};
App.deleteProduct = async (id) => {
  if (!(await confirmBox('删除这个商品？'))) return;
  try { await api(UX.primary.iface, UX.primary.remove, { method: 'DELETE', params: { id } }); toast('已删除', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};

App.newEvent = () => {
  if (!requireAuth()) return;
  openForm({
    title: '发布活动', iface: UX.primary.iface, path: UX.primary.create, submitLabel: '发布',
    onSubmit: async (data) => { await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: data }); toast('已发布', 'ok'); await App.render(); },
  });
};
App.checkinTicket = async (code) => {
  if (!(await confirmBox('核销票码 ' + code + '？'))) return;
  try {
    await api(UX.ticket.iface, UX.ticket.checkin, { method: 'PUT', params: { code }, body: {} });
    toast('已核销', 'ok');
    await App.render();
  } catch (e) { toast(e.message, 'err'); }
};
App.newDish = () => {
  if (!requireAuth()) return;
  openForm({ title: '新增菜品', iface: UX.primary.iface, path: UX.primary.create, submitLabel: '保存', onSubmit: async (d) => { await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: d }); toast('已保存', 'ok'); await App.render(); } });
};
App.newTable = () => {
  if (!requireAuth()) return;
  openForm({ title: '新增桌台', iface: UX.tables.iface, path: UX.tables.create, submitLabel: '保存', onSubmit: async (d) => { await api(UX.tables.iface, UX.tables.create, { method: 'POST', body: d }); toast('已保存', 'ok'); await App.render(); } });
};

MODES.commerce = {
  home: commerceHome,
  collection: commerceCollection,
  item: commerceItem,
  cart: commerceCart,
  my: commerceMy,
  admin: commerceAdmin,
  order: commerceOrder,
};
