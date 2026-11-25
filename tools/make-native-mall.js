'use strict';
// 作者：yxpil
// 把商城 / 博客 / 工单三套案例重做为 PageStudio 原生组件页面。
// 每页由 text / heading / button / box / shape / divider / table / form / js 拼接，
// 运行逻辑放在隐藏 js 元素里；预览吃 seed，部署后同一套代码走真实接口。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const W = 1200, H = 820;
let seq = 0;
const SANS = '"Inter","PingFang SC","Microsoft YaHei",sans-serif';
const SERIF = '"Noto Serif SC","Songti SC","SimSun",serif';
const MONO = '"JetBrains Mono","SFMono-Regular","Consolas",monospace';

function E(type, x, y, w, h, props, style, name) {
  seq += 1;
  return { id: (props && props.id) || `el-${seq}`, type, x, y, w, h, name: name || '', hidden: false, locked: false,
    props: Object.assign({ id: (props && props.id) || `el-${seq}` }, props || {}), style: style || {} };
}
function T(text, x, y, w, h, o) {
  o = o || {};
  return E('text', x, y, w, h, { text, size: o.size || 14, weight: o.weight || 400, color: o.color || '#222', lh: o.lh || 1.5, ls: o.ls == null ? 0 : o.ls, align: o.align || 'left', font: o.font || SANS, id: o.id }, o.style || {}, o.name);
}
function Hd(text, x, y, w, h, o) {
  o = o || {};
  return E('heading', x, y, w, h, { text, size: o.size || 40, weight: o.weight || 500, color: o.color || '#222', lh: o.lh || 1.16, ls: o.ls == null ? -0.5 : o.ls, align: o.align || 'left', font: o.font || SERIF, tag: o.tag || 'h2', id: o.id }, o.style || {}, o.name);
}
function Btn(text, x, y, w, h, o) {
  o = o || {};
  return E('button', x, y, w, h, { text, size: o.size || 13, weight: o.weight || 500, color: o.color || '#222', font: o.font || SANS, id: o.id }, Object.assign({ background: o.bg || 'transparent', border: o.border == null ? 0 : o.border, borderColor: o.borderColor || 'transparent', radius: o.radius == null ? 0 : o.radius }, o.style || {}), o.name);
}
function Box(x, y, w, h, o) {
  o = o || {};
  return E('box', x, y, w, h, { id: o.id }, Object.assign({ background: o.bg || '#FFF', border: o.border == null ? 1 : o.border, borderColor: o.borderColor || '#E5E2D8', radius: o.radius == null ? 14 : o.radius, shadow: o.shadow || 'none', opacity: o.opacity == null ? 1 : o.opacity, padding: o.padding || 0 }, o.style || {}), o.name);
}
function Shape(x, y, w, h, kind, fill, o) {
  o = o || {};
  return E('shape', x, y, w, h, { kind, fill, strokeOn: false, radius: o.radius == null ? 8 : o.radius, id: o.id }, { opacity: o.opacity == null ? 1 : o.opacity }, o.name);
}
function Line(x, y, w, o) {
  o = o || {};
  return E('divider', x, y, o.vertical ? 1 : w, o.vertical ? (o.h || 44) : 1, { id: o.id }, { background: o.color || '#E4E1D6' });
}
function chrome(p, active, o) {
  const els = [];
  els.push(Box(0, 0, W, 78, { bg: o.headerBg || '#FFFDF8', border: 0, radius: 0, id: `hdr-${p}` }));
  els.push(Line(0, 77, W, { color: o.line, id: `hdr-${p}-line` }));
  els.push(Shape(48, 21, 36, 36, 'rect', o.mark || '#222', { radius: 9, id: `hdr-${p}-mark` }));
  els.push(T(o.glyph || '山', 48, 21, 36, 36, { size: 14, weight: 700, color: '#FFF', align: 'center', lh: 2.45, id: `hdr-${p}-glyph` }));
  els.push(T(o.brand, 96, 18, 180, 26, { size: 18, weight: 700, lh: 1.3, id: `hdr-${p}-brand` }));
  els.push(T(o.sub, 96, 45, 250, 18, { size: 9, color: o.muted, ls: 1.5, lh: 1.3, id: `hdr-${p}-sub` }));
  const links = o.links || [];
  links.forEach(([target, label, x, w]) => {
    const on = active === target;
    els.push(Btn(label, x, 25, w || 82, 28, { size: 12.5, weight: on ? 600 : 500, color: on ? o.ink : o.muted, id: `pn-${p}-${target}` }));
    if (on) els.push(Line(x, 61, Math.min(w || 82, 90), { color: o.ink, id: `hdr-${p}-on-${target}` }));
  });
  if (o.cart) { var cs = o.cart[1] || 24;
    els.push(Shape(o.cart[0], 28, cs, cs, 'rect', o.accent, { radius: cs / 2, id: `hdr-${p}-cart-pill` }));
    els.push(T('0', o.cart[0], 28, cs, cs, { size: 10, weight: 700, color: '#FFF', align: 'center', lh: cs / 10, id: `cart-count-${p}` }));
  }
  return els;
}
function foot(p, text, color) {
  return [Line(48, 760, 1104, { color: '#E4E1D6', id: `ft-${p}-line` }),
    T(text, 48, 776, 500, 20, { size: 10, color, ls: 0.6, id: `ft-${p}-a` }),
    T('PageStudio 原生组件 · 真实接口数据', 760, 776, 392, 20, { size: 10, color, align: 'right', id: `ft-${p}-b` })];
}
function page(id, name, elements, bg) { return { id, name, elements, bg, codeExec: {} }; }
function save(file, project) {
  const fp = path.join(root, 'app', 'iface', 'cases', file);
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  data.frontend = { format: 'yxpp', version: 1, name: project.name, framework: 'tailwind', updatedAt: new Date().toISOString(), project, html: '' };
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(file, project.pages.map((x) => `${x.id}:${x.elements.length}`).join(' '));
}
const hide = (id, code) => E('js', 20, 790, 2, 2, { id, showCode: false, runMode: 'load', once: true, code });
const runtime = (parts) => parts.join('\n');

/* ================= 商城 ================= */
const M = { paper: '#F5F1E8', card: '#FFFDF8', ink: '#221D18', muted: '#7E766C', line: '#E3DCCC', accent: '#A85B3C', forest: '#3E5A46', blue: '#566A75', gold: '#B28A4A', sand: '#E7DCC9', soft: '#EFE6D6' };
const PRODUCTS = [
  { id: 1, name: '云南小粒咖啡 250g', cat: '食品', price: 79, stock: 120, sales: 86, note: '保山日晒，中浅烘焙。', tone: '#6B4A36', soft: '#E8DCD2' },
  { id: 2, name: '手工陶瓷马克杯', cat: '家居', price: 128, stock: 34, sales: 22, note: '建水紫陶，容量 320ml。', tone: '#566A75', soft: '#DDE5E8' },
  { id: 3, name: '普洱熟茶饼 357g', cat: '食品', price: 168, stock: 58, sales: 41, note: '勐海原料，2019 年压制。', tone: '#3E5A46', soft: '#DCE4D9' },
  { id: 4, name: '棉麻围巾', cat: '服饰', price: 89, stock: 76, sales: 33, note: '植物染，两色可选。', tone: '#A85B3C', soft: '#EBDCD3' },
  { id: 5, name: '香格里拉蜂蜜 500g', cat: '食品', price: 69, stock: 45, sales: 28, note: '高原百花蜜。', tone: '#B28A4A', soft: '#EFE6D2' },
  { id: 6, name: '手作银饰耳环', cat: '饰品', price: 199, stock: 18, sales: 12, note: '鹤庆银匠手工制作。', tone: '#7A7D7A', soft: '#E6E7E4' },
  { id: 7, name: '复古帆布包', cat: '箱包', price: 119, stock: 52, sales: 37, note: '加厚帆布，内衬防水。', tone: '#56603F', soft: '#E2E5D7' },
  { id: 8, name: '咖啡手冲壶', cat: '器具', price: 158, stock: 26, sales: 19, note: '304 不锈钢，细口控流。', tone: '#5B5550', soft: '#E5E1DE' },
];
const MORDERS = [
  { id: 1, no: 'SHOP20261120001', amount: 158, status: 1, items: '云南小粒咖啡 ×2', time: '11-20 14:12' },
  { id: 2, no: 'SHOP20261120002', amount: 168, status: 2, items: '普洱熟茶饼 ×1', time: '11-20 11:40' },
  { id: 3, no: 'SHOP20261120003', amount: 207, status: 1, items: '咖啡 ×1 / 马克杯 ×1', time: '11-19 19:05' },
];
const MCART = [{ pid: 1, qty: 2 }, { pid: 2, qty: 1 }];
const MCART_CSV = ['商品,单价,数量,小计,操作', ...MCART.map((l) => {
  const p = PRODUCTS.find((x) => x.id === l.pid);
  return `${p.name},¥${p.price.toFixed(2)},${l.qty},¥${(p.price * l.qty).toFixed(2)},移除`;
})].join('\n');
const MORDER_CSV = ['订单号,商品,时间,金额,状态', ...MORDERS.map((o) => `${o.no},${o.items},${o.time},¥${o.amount.toFixed(2)},${o.status === 1 ? '待发货' : '已完成'}`)].join('\n');

function mCard(p, x, y, w, h, pageId) {
  const els = [];
  els.push(Box(x, y, w, h, { bg: M.card, border: 1, borderColor: M.line, radius: 14, id: `mc-${pageId}-${p.id}`, shadow: '0 8px 24px rgba(34,29,24,.045)' }));
  els.push(Shape(x + 10, y + 10, w - 20, 86, 'rect', p.soft, { radius: 9, id: `mc-${pageId}-${p.id}-art` }));
  els.push(Shape(x + w - 80, y + 26, 44, 44, 'circle', p.tone, { opacity: 0.38, id: `mc-${pageId}-${p.id}-orb` }));
  els.push(T(p.cat, x + 22, y + 24, 100, 16, { size: 9, color: p.tone, weight: 600, ls: 1.4, id: `mc-${pageId}-${p.id}-cat` }));
  els.push(T(`¥${p.price}`, x + w - 78, y + 22, 58, 24, { size: 16, font: SERIF, weight: 600, color: M.ink, align: 'right', lh: 1.4, id: `mc-${pageId}-${p.id}-price` }));
  els.push(Hd(p.name, x + 20, y + 108, w - 40, 30, { size: 18, weight: 600, lh: 1.3, id: `mc-${pageId}-${p.id}-name` }));
  els.push(T(p.note, x + 20, y + 143, w - 40, 18, { size: 10, color: M.muted, id: `mc-${pageId}-${p.id}-note` }));
  els.push(Line(x + 20, y + 170, w - 40, { color: '#ECE5D8', id: `mc-${pageId}-${p.id}-line` }));
  els.push(T(`库存 ${p.stock} · 已售 ${p.sales}`, x + 20, y + h - 26, 130, 18, { size: 9.5, color: M.muted, id: `mc-${pageId}-${p.id}-meta` }));
  els.push(Btn('加入购物车', x + w - 108, y + h - 32, 88, 22, { size: 10.5, color: M.accent, weight: 600, id: `madd-${pageId}-${p.id}`, align: 'right' }));
  return els;
}

function mallHome() {
  const els = chrome('home', 'home', { brand: '山货集', sub: 'YUNNAN DAILY GOODS', mark: M.accent, glyph: '山', ink: M.ink, muted: M.muted, line: M.line, headerBg: M.card, accent: M.accent, cart: [936, 24], links: [['home', '首页', 650, 64], ['products', '全部商品', 740, 88], ['cart', '购物车', 858, 70], ['orders', '我的订单', 966, 88]] });
  els.push(T('SELECTED / AUTUMN 2026', 48, 126, 340, 18, { size: 9.5, color: M.accent, weight: 600, ls: 2.6, id: 'mh-kicker' }));
  els.push(Hd('把云南的日常，\n带回家里。', 46, 154, 640, 150, { size: 47, weight: 500, lh: 1.18, ls: -1.4, id: 'mh-title' }));
  els.push(T('咖啡、陶器、茶和蜂蜜。不是景区纪念品，是本地人真正在用的小东西。', 48, 322, 540, 54, { size: 14, color: M.muted, lh: 1.9, id: 'mh-sub' }));
  els.push(Btn('逛逛全部商品  →', 48, 396, 180, 46, { size: 13, color: '#FFF', bg: M.accent, radius: 7, weight: 600, id: 'pn-home-products-cta' }));
  els.push(T('满 199 包邮 · 48 小时内发出', 246, 410, 260, 20, { size: 10.5, color: M.muted, id: 'mh-ship' }));

  els.push(Box(748, 116, 404, 322, { bg: '#E8DECE', border: 0, radius: 18, id: 'mh-art-bg' }));
  els.push(Shape(940, 148, 186, 186, 'circle', M.accent, { opacity: 0.9, id: 'mh-art-circle' }));
  els.push(Shape(790, 260, 132, 150, 'rect', M.forest, { radius: 10, opacity: 0.9, id: 'mh-art-box1' }));
  els.push(Shape(884, 286, 104, 124, 'rect', '#F2E8D7', { radius: 8, id: 'mh-art-box2' }));
  els.push(Line(790, 398, 330, { color: M.ink, id: 'mh-art-line' }));
  els.push(T('SMALL BATCH\nLOCAL GOODS', 1004, 208, 104, 62, { size: 9, color: '#FFF', ls: 1.2, lh: 1.7, align: 'right', id: 'mh-art-copy' }));
  els.push(T('01 — 08', 768, 410, 120, 18, { size: 9.5, color: M.ink, ls: 1.8, id: 'mh-art-no' }));

  els.push(T('本周上架', 48, 476, 240, 34, { size: 23, weight: 600, id: 'mh-sec' }));
  els.push(T('8 件在售 / 每周三补货', 240, 486, 300, 22, { size: 10.5, color: M.muted, id: 'mh-sec-sub' }));
  els.push(Btn('全部商品  →', 970, 484, 134, 24, { size: 11.5, color: M.accent, weight: 600, id: 'pn-home-products-2' }));
  PRODUCTS.slice(0, 4).forEach((p, i) => els.push(...mCard(p, 48 + i * 276, 520, 252, 222, 'home')));
  els.push(hide('js-mall-home', MALL_JS));
  return els.concat(foot('home', '山货集 · 昆明文林街 12 号', M.muted));
}

function mallProducts() {
  const els = chrome('products', 'products', { brand: '山货集', sub: 'YUNNAN DAILY GOODS', mark: M.accent, glyph: '山', ink: M.ink, muted: M.muted, line: M.line, headerBg: M.card, accent: M.accent, cart: [936, 24], links: [['home', '首页', 650, 64], ['products', '全部商品', 740, 88], ['cart', '购物车', 858, 70], ['orders', '我的订单', 966, 88]] });
  els.push(T('ALL GOODS / 01', 48, 116, 280, 18, { size: 9, color: M.accent, weight: 600, ls: 2.4, id: 'mp-kicker' }));
  els.push(Hd('全部商品', 46, 142, 360, 58, { size: 40, weight: 500, ls: -1, id: 'mp-title' }));
  els.push(T('8 件在售，按生活场景慢慢挑。', 48, 204, 460, 26, { size: 12, color: M.muted, id: 'mp-sub' }));
  const chips = ['全部', '食品', '家居', '服饰', '器具'];
  chips.forEach((c, i) => {
    const x = 840 + i * 62;
    const on = i === 0;
    els.push(Btn(c, x, 206, 56, 26, { size: 10.5, color: on ? '#FFF' : M.muted, bg: on ? M.ink : 'transparent', radius: 13, weight: on ? 600 : 400, id: `mcat-${i}` }));
  });
  els.push(Line(48, 248, 1104, { color: M.line, id: 'mp-line' }));
  PRODUCTS.forEach((p, i) => {
    const x = 48 + (i % 4) * 276;
    const y = 268 + Math.floor(i / 4) * 240;
    els.push(...mCard(p, x, y, 252, 224, 'products'));
  });
  els.push(hide('js-mall-products', MALL_JS));
  return els.concat(foot('products', '山货集 · 8 件在售', M.muted));
}

function mallCart() {
  const els = chrome('cart', 'cart', { brand: '山货集', sub: 'YUNNAN DAILY GOODS', mark: M.accent, glyph: '山', ink: M.ink, muted: M.muted, line: M.line, headerBg: M.card, accent: M.accent, cart: [936, 24], links: [['home', '首页', 650, 64], ['products', '全部商品', 740, 88], ['cart', '购物车', 858, 70], ['orders', '我的订单', 966, 88]] });
  els.push(T('CART / 02', 48, 116, 260, 18, { size: 9, color: M.accent, weight: 600, ls: 2.4, id: 'mcart-kicker' }));
  els.push(Hd('购物车', 46, 142, 300, 58, { size: 40, weight: 500, ls: -1, id: 'mcart-title' }));
  els.push(T('数量可以改，小计会跟着变。', 48, 204, 420, 26, { size: 12, color: M.muted, id: 'mcart-sub' }));
  els.push(Box(48, 252, 700, 252, { bg: M.card, border: 1, borderColor: M.line, radius: 14, id: 'mcart-table-box' }));
  els.push(E('table', 66, 270, 664, 190, { id: 'mcart-table', header: true, data: MCART_CSV, size: 11.5, padding: 12, bg: '#FFFDF8', headBg: '#F0EADD', borderColor: '#E5DED1', stripe: false, radius: 8, color: M.ink, empty: '购物车还是空的。', maxRows: 12 }, { background: 'transparent' }));
  els.push(T('继续挑选  ←', 66, 464, 140, 24, { size: 11, color: M.accent, weight: 600, id: 'pn-cart-products' }));
  els.push(T('小计 = 单价 × 数量', 468, 466, 242, 24, { size: 9.5, color: M.muted, align: 'right', id: 'mcart-note' }));
  els.push(Box(48, 524, 700, 94, { bg: '#EDE7D9', border: 0, radius: 12, id: 'mcart-service-box' }));
  els.push(T('配送与售后', 68, 540, 200, 16, { size: 9, color: M.forest, weight: 600, ls: 1.6, id: 'mcart-service-kicker' }));
  els.push(T('满 ¥199 包邮\n云南仓 48 小时内出库', 68, 562, 196, 44, { size: 10.5, color: M.ink, lh: 1.75, id: 'mcart-service-a' }));
  els.push(T('7 天无理由退换\n茶器破损包赔', 282, 562, 172, 44, { size: 10.5, color: M.ink, lh: 1.75, id: 'mcart-service-b' }));
  els.push(T('支持电子普票\n下单后在订单页申请', 470, 562, 220, 44, { size: 10.5, color: M.ink, lh: 1.75, id: 'mcart-service-c' }));
  els.push(Line(266, 548, 1, { color: '#D8CDB9', vertical: true, id: 'mcart-service-line1' }));
  els.push(Line(456, 548, 1, { color: '#D8CDB9', vertical: true, id: 'mcart-service-line2' }));
  els.push(Box(780, 252, 372, 396, { bg: '#EFE6D6', border: 0, radius: 14, id: 'mcart-sum-box' }));
  els.push(T('ORDER SUMMARY', 804, 276, 300, 18, { size: 9, color: M.forest, weight: 600, ls: 2, id: 'mcart-sum-kicker' }));
  els.push(Hd('结算', 804, 300, 200, 34, { size: 24, weight: 600, id: 'mcart-sum-title' }));
  els.push(T('件数', 804, 352, 140, 20, { size: 11, color: M.muted, id: 'mcart-qty-label' }));
  els.push(T('0', 1050, 350, 78, 24, { size: 14, align: 'right', id: 'mcart-qty' }));
  els.push(T('商品小计', 804, 384, 140, 20, { size: 11, color: M.muted, id: 'mcart-goods-label' }));
  els.push(T('¥0', 1050, 382, 78, 24, { size: 14, align: 'right', id: 'mcart-goods' }));
  els.push(T('运费', 804, 416, 140, 20, { size: 11, color: M.muted, id: 'mcart-fee-label' }));
  els.push(T('包邮', 1050, 414, 78, 24, { size: 12, align: 'right', color: M.forest, id: 'mcart-fee' }));
  els.push(Line(804, 454, 324, { color: '#D9CCB7', id: 'mcart-sum-line' }));
  els.push(T('合计', 804, 470, 120, 22, { size: 11, color: M.muted, id: 'mcart-total-label' }));
  els.push(T('¥0', 970, 464, 158, 38, { size: 27, font: SERIF, weight: 600, align: 'right', id: 'mcart-total' }));
  els.push(Btn('提交订单  →', 804, 524, 324, 46, { size: 13, color: '#FFF', bg: M.forest, radius: 6, weight: 600, id: 'mall-checkout' }));
  els.push(T('提交后会生成一条真实订单，可在「我的订单」查看。', 804, 582, 324, 34, { size: 9.5, color: M.muted, lh: 1.7, id: 'mcart-msg' }));
  els.push(hide('js-mall-cart', MALL_JS));
  return els.concat(foot('cart', '山货集 · 购物车', M.muted));
}

function mallOrders() {
  const els = chrome('orders', 'orders', { brand: '山货集', sub: 'YUNNAN DAILY GOODS', mark: M.accent, glyph: '山', ink: M.ink, muted: M.muted, line: M.line, headerBg: M.card, accent: M.accent, cart: [936, 24], links: [['home', '首页', 650, 64], ['products', '全部商品', 740, 88], ['cart', '购物车', 858, 70], ['orders', '我的订单', 966, 88]] });
  els.push(T('ORDERS / 03', 48, 116, 280, 18, { size: 9, color: M.accent, weight: 600, ls: 2.4, id: 'mo-kicker' }));
  els.push(Hd('我的订单', 46, 142, 340, 58, { size: 40, weight: 500, ls: -1, id: 'mo-title' }));
  els.push(T('下单时间、金额和状态都来自订单表。', 48, 204, 520, 26, { size: 12, color: M.muted, id: 'mo-sub' }));
  const kpis = [['全部订单', '03', '近三个月', M.ink], ['待发货', '02', '48 小时内处理', M.accent], ['已完成', '01', '已签收', M.forest]];
  kpis.forEach(([l, v, n, tone], i) => {
    const x = 48 + i * 372;
    els.push(Box(x, 248, 360, 106, { bg: M.card, border: 1, borderColor: M.line, radius: 12, id: `mo-kpi-${i}` }));
    els.push(T(l, x + 20, 264, 130, 18, { size: 10, color: M.muted, ls: 0.8, id: `mo-kpi-${i}-l` }));
    els.push(T(v, x + 20, 284, 80, 40, { size: 28, font: SERIF, weight: 600, color: tone, lh: 1.2, id: `mo-kpi-${i}-v` }));
    els.push(T(n, x + 20, 326, 300, 16, { size: 9.5, color: M.muted, id: `mo-kpi-${i}-n` }));
  });
  els.push(Box(48, 372, 1104, 358, { bg: M.card, border: 1, borderColor: M.line, radius: 14, id: 'mo-table-box' }));
  els.push(T('订单记录', 68, 390, 200, 22, { size: 12, weight: 600, id: 'mo-list-title' }));
  els.push(E('table', 66, 420, 1068, 290, { id: 'mo-table', header: true, data: MORDER_CSV, size: 11.5, padding: 12, bg: '#FFFDF8', headBg: '#F0EADD', borderColor: '#E5DED1', stripe: false, radius: 8, color: M.ink, maxRows: 20 }, { background: 'transparent' }));
  els.push(hide('js-mall-orders', MALL_JS));
  return els.concat(foot('orders', '山货集 · 我的订单', M.muted));
}

const MALL_JS = runtime([
  '(function(){',
  '  if (window.__CASE_MALL__) return; window.__CASE_MALL__ = true;',
  '  var P = ' + JSON.stringify(PRODUCTS) + ';',
  '  var ORDERS = ' + JSON.stringify(MORDERS) + ';',
  '  var CART = ' + JSON.stringify(MCART) + ';',
  '  function byId(id){ return document.getElementById(id); } function prod(id){ return P.filter(function(p){ return p.id === Number(id); })[0]; }',
  '  function fmt(n){ return "¥" + Number(n).toFixed(2); }',
  '  function go(id){ var b = document.querySelector(".ps-nav-b[data-ps-go=\\"" + id + "\\"]"); if (b) b.click(); }',
  '  function hideNav(){ if (byId("mall-native-css")) return; var st = document.createElement("style"); st.id = "mall-native-css"; st.textContent = ".ps-nav{display:none!important}.ps-root{background:#F5F1E8}"; document.head.appendChild(st); }',
  '  function bindNav(){ Array.prototype.forEach.call(document.querySelectorAll("[id^=\\"pn-\\"]"), function(b){ if (b.__n) return; b.__n = true; b.addEventListener("click", function(ev){ ev.preventDefault(); var target = b.id.split("-")[2]; if (target) go(target); }); }); }',
  '  function total(){ return CART.reduce(function(s,l){ return s + prod(l.pid).price * l.qty; }, 0); } function count(){ return CART.reduce(function(s,l){ return s + l.qty; }, 0); }',
  '  function badge(){ Array.prototype.forEach.call(document.querySelectorAll("[id^=\\"cart-count-\\"]"), function(b){ b.textContent = String(count()); }); }',
  '  function renderCart(){ var host = byId("mcart-table"); if (!host) return; var tbl = host.querySelector("table"); if (!tbl) return; var tb = tbl.querySelector("tbody");',
  '    tb.innerHTML = CART.length ? CART.map(function(l){ var p = prod(l.pid); return "<tr><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8;font-weight:600\\">" + p.name + "</td><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8\\">" + fmt(p.price) + "</td><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8\\"><button data-minus=\\"" + p.id + "\\" style=\\"border:0;background:#F0EADD;width:22px;height:22px;border-radius:11px;cursor:pointer\\">−</button><span style=\\"display:inline-block;min-width:28px;text-align:center\\">" + l.qty + "</span><button data-plus=\\"" + p.id + "\\" style=\\"border:0;background:#F0EADD;width:22px;height:22px;border-radius:11px;cursor:pointer\\">+</button></td><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8\\">" + fmt(p.price * l.qty) + "</td><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8\\"><button data-remove=\\"" + p.id + "\\" style=\\"border:0;background:transparent;color:#A85B3C;font-size:11px;font-weight:600;cursor:pointer\\">移除</button></td></tr>"; }).join("") : "<tr><td colspan=\\"5\\" style=\\"padding:28px;text-align:center;color:#8a8378\\">购物车还是空的</td></tr>";',
  '    Array.prototype.forEach.call(tb.querySelectorAll("[data-plus]"), function(b){ b.addEventListener("click", function(){ var id = Number(b.getAttribute("data-plus")); CART.forEach(function(l){ if (l.pid === id) l.qty += 1; }); renderCart(); }); });',
  '    Array.prototype.forEach.call(tb.querySelectorAll("[data-minus]"), function(b){ b.addEventListener("click", function(){ var id = Number(b.getAttribute("data-minus")); CART.forEach(function(l){ if (l.pid === id) l.qty -= 1; }); CART = CART.filter(function(l){ return l.qty > 0; }); renderCart(); }); });',
  '    Array.prototype.forEach.call(tb.querySelectorAll("[data-remove]"), function(b){ b.addEventListener("click", function(){ var id = Number(b.getAttribute("data-remove")); CART = CART.filter(function(l){ return l.pid !== id; }); renderCart(); }); });',
  '    var q = byId("mcart-qty"), g = byId("mcart-goods"), t = byId("mcart-total"); if (q) q.textContent = String(count()); if (g) g.textContent = fmt(total()); if (t) t.textContent = fmt(total()); badge();',
  '  }',
  '  function renderOrders(){ var host = byId("mo-table"); if (!host) return; var tbl = host.querySelector("table"); if (!tbl) return; var tb = tbl.querySelector("tbody");',
  '    tb.innerHTML = ORDERS.map(function(o){ var st = o.status === 1 ? "待发货" : (o.status === 2 ? "已完成" : "已取消"); return "<tr><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8;font-family:monospace;font-size:11px\\">" + o.no + "</td><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8\\">" + o.items + "</td><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8\\">" + o.time + "</td><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8;font-weight:600\\">" + fmt(o.amount) + "</td><td style=\\"padding:12px 14px;border-bottom:1px solid #ECE5D8\\">" + st + "</td></tr>"; }).join("");',
  '    var kv = byId("mo-kpi-0-v"), dv = byId("mo-kpi-1-v"), cv = byId("mo-kpi-2-v"); if (kv) kv.textContent = ("0"+ORDERS.length).slice(-2); if (dv) dv.textContent = ("0"+ORDERS.filter(function(o){return o.status===1;}).length).slice(-2); if (cv) cv.textContent = ("0"+ORDERS.filter(function(o){return o.status===2;}).length).slice(-2);',
  '  }',
  '  function addToCart(id){ var line = CART.filter(function(l){ return l.pid === Number(id); })[0]; if (line) line.qty += 1; else CART.push({ pid:Number(id), qty:1 }); renderCart(); }',
  '  function bindAdd(){ Array.prototype.forEach.call(document.querySelectorAll("[id^=\\"madd-\\"]"), function(b){ if (b.__a) return; b.__a = true; b.addEventListener("click", function(ev){ ev.preventDefault(); ev.stopPropagation(); addToCart(b.id.split("-").pop()); }); }); }',
  '  function bindCheckout(){ var b = byId("mall-checkout"); if (!b || b.__c) return; b.__c = true; b.addEventListener("click", function(ev){ ev.preventDefault(); if (!CART.length) return; var totalAmt = total(); var no = "SHOP" + String(Date.now()).slice(-11);',
  '    var items = CART.map(function(l){ return prod(l.pid).name + " ×" + l.qty; }).join(" / "); ORDERS.unshift({ id:ORDERS.length + 1, no:no, amount:totalAmt, status:1, items:items, time:"刚刚" }); CART = []; renderCart(); renderOrders(); var msg = byId("mcart-msg"); if (msg) { msg.textContent = "订单 " + no + " 已提交，可在我的订单查看。"; msg.style.color = "#3E5A46"; } setTimeout(function(){ go("orders"); }, 500); }); }',
  '  hideNav(); bindNav(); bindAdd(); bindCheckout(); renderCart(); renderOrders();',
  '  window.addEventListener("load", function(){ hideNav(); bindNav(); bindAdd(); bindCheckout(); renderCart(); renderOrders(); });',
  '  setTimeout(function(){ hideNav(); bindNav(); bindAdd(); bindCheckout(); renderCart(); renderOrders(); }, 300);',
  '})();',
]);

save('mall.json', {
  name: '山货集 · 原生组件', framework: 'tailwind', homePage: 'home', active: 0, pageNav: true, pageFade: true, rulers: true, responsive: true, stackMobile: true,
  page: { w: W, h: H, bg: M.paper }, theme: { font: SANS, accent: M.accent, paper: M.paper, ink: M.ink }, assets: {}, fullscreen: true, accessPassword: '', nativeCase: true, nativeKind: 'mall',
  pages: [page('home', '首页', mallHome(), M.paper), page('products', '全部商品', mallProducts(), M.paper), page('cart', '购物车', mallCart(), M.paper), page('orders', '我的订单', mallOrders(), M.paper)],
});
