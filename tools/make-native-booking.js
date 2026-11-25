// 作者：yxpil
'use strict';
// 生成「预约」原生组件案例：页面由 text / heading / button / box / shape / table / form / js 拼接，
// 不再使用整页 appview。运行态数据由隐藏的 js 元素驱动，预览时走 seed，部署后走真实接口。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'app', 'iface', 'cases', 'booking.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const W = 1200;
const H = 820;
const C = {
  paper: '#F4F5EF',
  card: '#FCFCF8',
  ink: '#1D2420',
  muted: '#77817A',
  line: '#DDDCD2',
  forest: '#2F4A3C',
  forestSoft: '#DCE3D7',
  clay: '#B4795A',
  sand: '#EDE6D8',
  sage: '#8FA08E',
  slate: '#586A72',
  white: '#FFFFFF',
};
const SERIF = '"Noto Serif SC","Songti SC","SimSun",serif';
const SANS = '"Inter","PingFang SC","Microsoft YaHei",sans-serif';

let seq = 0;
function E(type, x, y, w, h, props, style, name) {
  seq += 1;
  const id = (props && props.id) || `bk-${type}-${seq}`;
  return {
    id,
    type,
    x, y, w, h,
    name: name || '',
    hidden: false,
    locked: false,
    props: Object.assign({ id }, props || {}),
    style: style || {},
  };
}
function T(text, x, y, w, h, opts) {
  const o = opts || {};
  return E('text', x, y, w, h, {
    text,
    size: o.size || 14,
    weight: o.weight || 400,
    color: o.color || C.ink,
    lh: o.lh || 1.5,
    ls: o.ls == null ? 0 : o.ls,
    align: o.align || 'left',
    font: o.font || SANS,
    id: o.id,
  }, o.style || {}, o.name);
}
function Hd(text, x, y, w, h, opts) {
  const o = opts || {};
  return E('heading', x, y, w, h, {
    text,
    size: o.size || 40,
    weight: o.weight || 500,
    color: o.color || C.ink,
    lh: o.lh || 1.16,
    ls: o.ls == null ? -0.5 : o.ls,
    align: o.align || 'left',
    font: o.font || SERIF,
    tag: o.tag || 'h2',
    id: o.id,
  }, o.style || {}, o.name);
}
function Btn(text, x, y, w, h, opts) {
  const o = opts || {};
  return E('button', x, y, w, h, {
    text,
    size: o.size || 13,
    weight: o.weight || 500,
    color: o.color || C.ink,
    font: o.font || SANS,
    id: o.id,
  }, Object.assign({ background: o.bg || 'transparent', border: o.border == null ? 0 : o.border, borderColor: o.borderColor || 'transparent', radius: o.radius == null ? 0 : o.radius }, o.style || {}), o.name);
}
function Box(x, y, w, h, opts) {
  const o = opts || {};
  return E('box', x, y, w, h, { id: o.id }, Object.assign({
    background: o.bg || C.card,
    border: o.border == null ? 1 : o.border,
    borderColor: o.borderColor || C.line,
    radius: o.radius == null ? 14 : o.radius,
    shadow: o.shadow || 'none',
    opacity: o.opacity == null ? 1 : o.opacity,
    padding: o.padding || 0,
  }, o.style || {}), o.name);
}
function Shape(x, y, w, h, kind, fill, opts) {
  const o = opts || {};
  return E('shape', x, y, w, h, { kind, fill, strokeOn: false, radius: o.radius == null ? 8 : o.radius, id: o.id }, { opacity: o.opacity == null ? 1 : o.opacity }, o.name);
}
function Divider(x, y, w, opts) {
  const o = opts || {};
  return E('divider', x, y, w, 1, { id: o.id }, { background: o.color || C.line });
}

function nav(page, active) {
  const els = [];
  els.push(Box(0, 0, W, 78, { bg: '#FCFCF9', border: 0, radius: 0, id: `nav-${page}-bg` }));
  els.push(Divider(0, 77, W, { color: '#E4E3D9', id: `nav-${page}-line` }));
  els.push(Shape(48, 21, 36, 36, 'rect', C.forest, { radius: 9, id: `nav-${page}-mark` }));
  els.push(T('闲', 48, 21, 36, 36, { size: 14, weight: 700, color: C.white, align: 'center', lh: 2.45, id: `nav-${page}-mark-t` }));
  els.push(T('闲时', 96, 19, 120, 26, { size: 18, weight: 700, lh: 1.3, id: `nav-${page}-brand` }));
  els.push(T('XIANSHI · 到店预约', 96, 45, 220, 18, { size: 9, color: C.muted, ls: 1.6, lh: 1.3, id: `nav-${page}-sub` }));
  const links = [
    ['home', '首页', 720],
    ['collection', '服务项目', 810],
    ['my', '我的预约', 918],
    ['admin', '预约管理', 1032],
  ];
  links.forEach(([target, label, x]) => {
    const on = active === target;
    els.push(Btn(label, x, 25, target === 'collection' ? 86 : 78, 28, {
      size: 12.5, weight: on ? 600 : 500, color: on ? C.ink : C.muted, id: `pn-${page}-${target}`,
    }));
    if (on) els.push(Divider(x, 61, target === 'collection' ? 86 : 60, { color: C.ink, id: `nav-${page}-${target}-on` }));
  });
  return els;
}

function footer(page) {
  return [
    Divider(48, 760, 1104, { color: '#E4E3D9', id: `ft-${page}-line` }),
    T('闲时 · 到店预约', 48, 776, 260, 20, { size: 10, color: C.muted, ls: 0.8, id: `ft-${page}-a` }),
    T('真实接口数据 · 页面由 PageStudio 组件拼接', 800, 776, 352, 20, { size: 10, color: C.muted, align: 'right', id: `ft-${page}-b` }),
  ];
}

const services = [
  { id: 1, name: '肩颈理疗', price: 168, duration: 60, en: 'NECK & SHOULDER', tone: C.forest, soft: '#DCE3D7' },
  { id: 2, name: '足部护理', price: 128, duration: 45, en: 'FOOT CARE', tone: C.clay, soft: '#EFE1D7' },
  { id: 3, name: '头皮养护', price: 198, duration: 75, en: 'SCALP CARE', tone: C.slate, soft: '#DFE6E9' },
  { id: 4, name: '初次体验', price: 88, duration: 30, en: 'FIRST VISIT', tone: '#7B6A55', soft: '#E8E2D7' },
];
const BOOKINGS = [
  { id: 1, service_id: 1, slot_id: 1, customer: '周敏', phone: '13800001234', status: 1, time: '11-21 09:00' },
  { id: 2, service_id: 1, slot_id: 1, customer: '李哲', phone: '13900002345', status: 1, time: '11-21 09:00' },
  { id: 3, service_id: 1, slot_id: 2, customer: '王珂', phone: '13700003456', status: 1, time: '11-21 14:00' },
  { id: 4, service_id: 2, slot_id: 3, customer: '陈露', phone: '13600004567', status: 1, time: '11-21 10:30' },
];
const TABLE_DATA = [
  '编号,项目,时段,客户,状态,操作',
  ...BOOKINGS.map((b) => `#0${b.id},${services.find((s) => s.id === b.service_id).name},${b.time},${b.customer},待服务,取消`),
].join('\n');

const RUNTIME_JS = [
  '(function(){',
  '  if (window.__CASE_BOOKING_RUNTIME__) return; window.__CASE_BOOKING_RUNTIME__ = true;',
  '  var SEED = ' + JSON.stringify({ services, bookings: BOOKINGS }) + ';',
  '  var DATA = { services: SEED.services, bookings: SEED.bookings.slice() };',
  '  var SERVICE = 1; window.__CASE_SERVICE__ = SERVICE;',
  '  function byId(id){ return document.getElementById(id); }',
  '  function svc(id){ for (var i=0;i<DATA.services.length;i++) if (String(DATA.services[i].id) === String(id)) return DATA.services[i]; return DATA.services[0]; }',
  '  function statusText(n){ return n === 3 ? "已取消" : (n === 2 ? "已完成" : "待服务"); }',
  '  function go(id){ var b = document.querySelector(".ps-nav-b[data-ps-go=\\"" + id + "\\"]"); if (b) b.click(); }',
  '  function hideNav(){ var st = document.getElementById("case-native-css"); if (st) return; st = document.createElement("style"); st.id = "case-native-css";',
  '    st.textContent = ".ps-nav{display:none!important}.ps-root{background:#F4F5EF}button{font-family:inherit}"; document.head.appendChild(st); }',
  '  function bindNav(){ var all = document.querySelectorAll("[id^=\\"pn-\\"]");',
  '    Array.prototype.forEach.call(all, function(b){ if (b.__caseNav) return; b.__caseNav = true;',
  '      b.addEventListener("click", function(ev){ ev.preventDefault(); var parts = b.id.split("-"); var target = parts[2]; if (target) go(target); }); }); }',
  '  function paintFormTitle(){ var el = byId("cl-form-title"); if (el) el.textContent = "留个联系方式 · " + svc(SERVICE).name; }',
  '  function bindCards(){ var all = document.querySelectorAll("[id^=\\"bsel-\\"]");',
  '    Array.prototype.forEach.call(all, function(b){ if (b.__casePick) return; b.__casePick = true;',
  '      b.addEventListener("click", function(ev){ ev.preventDefault(); ev.stopPropagation(); var parts = b.id.split("-"); var sid = parts[parts.length-1]; SERVICE = Number(sid); window.__CASE_SERVICE__ = SERVICE; paintFormTitle();',
  '        if (parts[1] === "home") setTimeout(function(){ go("collection"); }, 60); }); }); }',
  '  function rowHtml(b, admin){ var s = svc(b.service_id); var actions = b.status === 3 ? "<span style=\\"color:#9aa39b;font-size:11px\\">已取消</span>" :',
  '      "<button type=\\"button\\" data-bk-cancel=\\"" + b.id + "\\" style=\\"border:0;background:transparent;color:#B4795A;font-size:11px;font-weight:600;cursor:pointer;padding:0\\">取消</button>";',
  '    if (admin) actions = b.status === 1 ? "<button type=\\"button\\" data-bk-done=\\"" + b.id + "\\" style=\\"border:0;background:#2F4A3C;color:#fff;font-size:10px;padding:4px 10px;border-radius:4px;cursor:pointer\\">到店</button>" : actions;',
  '    return "<tr><td style=\\"padding:11px 14px;border-bottom:1px solid #E7E6DD\\">#0" + b.id + "</td><td style=\\"padding:11px 14px;border-bottom:1px solid #E7E6DD;font-weight:600\\">" + s.name + "</td><td style=\\"padding:11px 14px;border-bottom:1px solid #E7E6DD;color:#77817A\\">" + b.time + "</td><td style=\\"padding:11px 14px;border-bottom:1px solid #E7E6DD\\">" + b.customer + "</td><td style=\\"padding:11px 14px;border-bottom:1px solid #E7E6DD\\">" + statusText(b.status) + "</td><td style=\\"padding:11px 14px;border-bottom:1px solid #E7E6DD\\">" + actions + "</td></tr>"; }',
  '  function setText(id, value){ var el = byId(id); if (el) el.textContent = value; }',
  '  function updateKpis(){ var w = DATA.bookings.filter(function(b){ return b.status === 1; }).length; var d = DATA.bookings.filter(function(b){ return b.status === 2; }).length; var c = DATA.bookings.filter(function(b){ return b.status === 3; }).length;',
  '    setText("my-kpi-0-v", ("0" + w).slice(-2)); setText("my-kpi-1-v", ("0" + d).slice(-2)); setText("my-kpi-2-v", ("0" + w).slice(-2));',
  '    setText("ad-kpi-0-v", ("0" + w).slice(-2)); setText("ad-kpi-1-v", "00"); setText("ad-kpi-2-v", ("0" + c).slice(-2)); setText("ad-kpi-3-v", "03"); }',
  '  function renderTables(){ updateKpis(); var conf = [["my-bookings-table", false], ["ad-bookings-table", true]];',
  '    conf.forEach(function(c){ var host = byId(c[0]); if (!host) return; var tbl = host.querySelector("table"); if (!tbl) return; var tb = tbl.querySelector("tbody"); if (!tb) { tb = document.createElement("tbody"); tbl.appendChild(tb); }',
  '      var rows = DATA.bookings.slice(); if (!c[1]) rows = rows.filter(function(b){ return b.status !== 2; });',
  '      tb.innerHTML = rows.map(function(b){ return rowHtml(b, c[1]); }).join("") || "<tr><td colspan=\\"6\\" style=\\"padding:24px;text-align:center;color:#8b948d\\">暂无预约</td></tr>";',
  '      Array.prototype.forEach.call(tb.querySelectorAll("[data-bk-cancel]"), function(btn){ btn.addEventListener("click", function(){ var id = Number(btn.getAttribute("data-bk-cancel")); DATA.bookings.forEach(function(b){ if (Number(b.id) === id) b.status = 3; }); renderTables(); }); });',
  '      Array.prototype.forEach.call(tb.querySelectorAll("[data-bk-done]"), function(btn){ btn.addEventListener("click", function(){ var id = Number(btn.getAttribute("data-bk-done")); DATA.bookings.forEach(function(b){ if (Number(b.id) === id) b.status = 2; }); renderTables(); }); }); }); }',
  '  function addLocal(payload){ var id = DATA.bookings.length ? Math.max.apply(null, DATA.bookings.map(function(b){ return Number(b.id)||0; })) + 1 : 1;',
  '    DATA.bookings.unshift({ id:id, service_id:payload.service_id, slot_id:payload.slot_id, customer:payload.customer, phone:payload.phone, status:1, time:(payload.day ? String(payload.day).slice(5) : "11-21") + " " + (payload.time || "09:00") }); return DATA.bookings[0]; }',
  '  window.__bookService = function(data, form){',
  '    var sid = Number(window.__CASE_SERVICE__) || 1; var s = svc(sid);',
  '    var payload = { service_id: sid, slot_id: data.slot_id ? Number(data.slot_id) : 1, customer: String(data.customer||"").trim(), phone: String(data.phone||"").trim(), day: data.day || "", time: data.time || "", status: 1 };',
  '    if (!payload.customer) return Promise.reject(new Error("请填写称呼"));',
  '    if (!/^1\\d{10}$/.test(payload.phone)) return Promise.reject(new Error("请填写 11 位手机号"));',
  '    payload.note = data.note || "";',
  '    return fetch("/api/bookings", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) })',
  '      .then(function(res){ if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })',
  '      .catch(function(){ return addLocal(payload); })',
  '      .then(function(rec){ if (!rec || !rec.id) rec = addLocal(payload); renderTables(); if (form) { var msg = form.querySelector("[data-ps-form-msg]"); if (msg) { msg.textContent = "已预约「" + s.name + "」，可在我的预约里查看。"; msg.style.color = "#2F4A3C"; } } return rec; });',
  '  };',
  '  hideNav(); bindNav(); bindCards(); paintFormTitle(); renderTables();',
  '  window.addEventListener("load", function(){ hideNav(); bindNav(); bindCards(); renderTables(); });',
  '  setTimeout(function(){ hideNav(); bindNav(); bindCards(); renderTables(); }, 300);',
  '})();',
].join('\n');


function serviceCard(page, s, x, y) {
  const els = [];
  els.push(Box(x, y, 252, 232, { bg: C.card, border: 1, borderColor: '#E4E3D9', radius: 16, id: `card-${page}-${s.id}`, shadow: '0 10px 30px rgba(29,36,32,.05)' }));
  els.push(Shape(x + 12, y + 12, 228, 88, 'rect', s.soft, { radius: 11, id: `card-${page}-${s.id}-art` }));
  els.push(Shape(x + 168, y + 20, 56, 56, 'circle', s.tone, { opacity: 0.18, id: `card-${page}-${s.id}-orb` }));
  els.push(T(s.en, x + 26, y + 24, 180, 18, { size: 8.5, color: s.tone, weight: 600, ls: 1.8, id: `card-${page}-${s.id}-en` }));
  els.push(T(String(s.duration).padStart(2, '0'), x + 26, y + 42, 100, 40, { size: 32, font: SERIF, weight: 500, color: s.tone, lh: 1.1, id: `card-${page}-${s.id}-dur` }));
  els.push(T('分钟', x + 74, y + 62, 40, 16, { size: 10, color: s.tone, id: `card-${page}-${s.id}-min` }));
  els.push(Hd(s.name, x + 22, y + 112, 190, 34, { size: 21, weight: 600, lh: 1.3, id: `card-${page}-${s.id}-name` }));
  els.push(T('独立护理室 · 一人一换', x + 22, y + 146, 200, 18, { size: 10.5, color: C.muted, id: `card-${page}-${s.id}-note` }));
  els.push(Divider(x + 22, y + 174, 208, { color: '#E6E5DC', id: `card-${page}-${s.id}-line` }));
  els.push(T(`¥${s.price}`, x + 22, y + 186, 100, 28, { size: 19, font: SERIF, weight: 600, color: C.ink, lh: 1.4, id: `card-${page}-${s.id}-price` }));
  els.push(Btn('查看 →', x + 150, y + 184, 78, 28, { size: 11.5, color: s.tone, weight: 600, id: `bsel-${page}-${s.id}`, align: 'right' }));
  return els;
}

// ---------- home ----------
function homePage() {
  const els = [].concat(nav('home', 'home'));
  els.push(T('SPACE TO SLOW DOWN', 48, 126, 300, 18, { size: 9.5, color: C.forest, weight: 600, ls: 3, id: 'hm-kicker' }));
  els.push(Hd('把一段时间，\n只留给自己。', 46, 154, 600, 148, { size: 46, weight: 500, lh: 1.18, ls: -1.4, id: 'hm-title' }));
  els.push(T('四个到店项目，真实时段、真实名额。选一个合适的下午，把手机放下。', 48, 314, 500, 54, { size: 14, color: C.muted, lh: 1.9, id: 'hm-sub' }));
  els.push(Btn('看看可约时段  →', 48, 386, 172, 46, { size: 13, color: C.white, bg: C.forest, radius: 7, weight: 600, id: 'pn-home-collection-cta' }));
  els.push(T('营业 10:00 — 20:00', 240, 400, 180, 20, { size: 10.5, color: C.muted, id: 'hm-hours' }));

  // 右侧平面构成
  els.push(Box(742, 118, 410, 320, { bg: '#E8E9DD', border: 0, radius: 18, id: 'hm-art-bg' }));
  els.push(Shape(914, 156, 210, 210, 'circle', C.forest, { opacity: 0.92, id: 'hm-art-circle' }));
  els.push(Shape(780, 300, 150, 110, 'rect', C.clay, { radius: 75, opacity: 0.92, id: 'hm-art-pill' }));
  els.push(T('48°\nN', 802, 176, 100, 100, { size: 38, font: SERIF, color: C.white, lh: 1.05, weight: 500, id: 'hm-art-coord' }));
  els.push(T('SLOW STUDIO / 2026', 764, 406, 180, 20, { size: 9, color: C.forest, ls: 1.4, id: 'hm-art-copy' }));

  els.push(T('本周可约', 48, 478, 260, 36, { size: 21, weight: 600, id: 'hm-sec' }));
  els.push(T('4 个到店项目 / 名额实时扣减', 300, 486, 360, 22, { size: 10.5, color: C.muted, id: 'hm-sec-sub' }));
  els.push(Btn('全部项目  →', 952, 484, 152, 24, { size: 11.5, color: C.forest, weight: 600, id: 'pn-home-collection-2' }));
  services.forEach((s, i) => {
    els.push(...serviceCard('home', s, 48 + i * 276, 522));
  });
  // 隐藏 JS：驱动导航、选中服务、提交预约、刷新我的预约
  els.push(E('js', 20, 790, 2, 2, {
    id: 'js-home-runtime', showCode: false, runMode: 'load', once: true,
    code: RUNTIME_JS,
  }));
  return els.concat(footer('home'));
}

// ---------- collection ----------
function collectionPage() {
  const els = [].concat(nav('collection', 'collection'));
  els.push(T('SERVICES / 01', 48, 116, 260, 18, { size: 9, color: C.clay, weight: 600, ls: 2.6, id: 'cl-kicker' }));
  els.push(Hd('服务项目', 46, 142, 360, 58, { size: 40, weight: 500, ls: -1, id: 'cl-title' }));
  els.push(T('选项目，再留一个称呼和电话。名额会在提交时真实占位。', 48, 204, 520, 26, { size: 12, color: C.muted, id: 'cl-sub' }));
  els.push(Divider(48, 244, 1104, { color: '#DFDED4', id: 'cl-line' }));

  services.forEach((s, i) => {
    const y = 264 + i * 116;
    els.push(Box(48, y, 700, 102, { bg: C.card, border: 1, borderColor: '#E4E3D9', radius: 12, id: `cl-row-${s.id}` }));
    els.push(Shape(62, y + 14, 74, 74, 'rect', s.soft, { radius: 9, id: `cl-art-${s.id}` }));
    els.push(Shape(104, y + 40, 22, 22, 'circle', s.tone, { opacity: 0.5, id: `cl-orb-${s.id}` }));
    els.push(Hd(s.name, 154, y + 18, 240, 32, { size: 19, weight: 600, lh: 1.3, id: `cl-name-${s.id}` }));
    els.push(T(`${s.duration} 分钟 · 独立护理室 · 今日有 3 个时段`, 154, y + 54, 340, 20, { size: 10.5, color: C.muted, id: `cl-meta-${s.id}` }));
    els.push(T(`¥${s.price}`, 550, y + 28, 84, 30, { size: 19, font: SERIF, weight: 600, lh: 1.4, id: `cl-price-${s.id}` }));
    els.push(Btn('选择', 648, y + 32, 76, 34, { size: 11.5, color: C.white, bg: s.tone, radius: 4, weight: 600, id: `bsel-collection-${s.id}` }));
  });

  // 预约表单
  els.push(Box(780, 264, 372, 456, { bg: '#FCFCF8', border: 1, borderColor: '#E1E0D5', radius: 14, id: 'cl-form-panel', shadow: '0 14px 40px rgba(29,36,32,.06)' }));
  els.push(T('RESERVE / 填写预约', 804, 286, 300, 18, { size: 9, color: C.clay, weight: 600, ls: 2, id: 'cl-form-kicker' }));
  els.push(Hd('留个联系方式', 804, 310, 300, 34, { size: 22, weight: 600, lh: 1.3, id: 'cl-form-title' }));
  els.push(T('提交后会占用一个名额，可在「我的预约」里查看。', 804, 348, 324, 34, { size: 10.5, color: C.muted, lh: 1.7, id: 'cl-form-sub' }));
  const formFields = [
    '称呼|text|怎么称呼你|customer|required',
    '手机号|tel|11 位手机号|phone|required',
    '到店日期|date||day',
    '备注|textarea|想提前说明的事|note',
  ].join('\n');
  els.push(E('form', 804, 394, 324, 300, {
    id: 'cl-form',
    fields: formFields,
    action: '/api/bookings',
    method: 'post',
    submitMode: 'custom',
    custom: 'return window.__bookService(data, form);',
    submit: '确认预约',
    submitBg: C.forest,
    submitColor: C.white,
    inputBg: '#FFFFFF',
    labelColor: C.muted,
    radius: 5,
    size: 12,
    success: '预约已提交，名额已为你保留。',
  }, { background: 'transparent' }));
  els.push(T('提交即表示同意到店前 2 小时可免费取消。', 804, 700, 324, 18, { size: 9.5, color: C.muted, id: 'cl-form-note' }));

  els.push(E('js', 20, 790, 2, 2, { id: 'js-collection-runtime', showCode: false, runMode: 'load', once: true, code: RUNTIME_JS }));
  return els.concat(footer('collection'));
}

// ---------- my ----------
function myPage() {
  const els = [].concat(nav('my', 'my'));
  els.push(T('MY RESERVATIONS / 02', 48, 116, 300, 18, { size: 9, color: C.clay, weight: 600, ls: 2.4, id: 'my-kicker' }));
  els.push(Hd('我的预约', 46, 142, 360, 58, { size: 40, weight: 500, ls: -1, id: 'my-title' }));
  els.push(T('这里只放你自己的预约，取消后名额会立刻回到可约池。', 48, 204, 560, 26, { size: 12, color: C.muted, id: 'my-sub' }));

  const kpis = [
    ['待服务', '04', '本周已确认', C.forest],
    ['已完成', '00', '近三个月', C.clay],
    ['可取消', '04', '服务前 2 小时', C.muted],
  ];
  kpis.forEach(([label, value, note, tone], i) => {
    const x = 48 + i * 372;
    els.push(Box(x, 248, 360, 98, { bg: C.card, border: 1, borderColor: '#E3E2D8', radius: 12, id: `my-kpi-${i}` }));
    els.push(T(label, x + 20, 264, 120, 18, { size: 10, color: C.muted, ls: 1, id: `my-kpi-${i}-l` }));
    els.push(T(value, x + 20, 284, 90, 42, { size: 30, font: SERIF, weight: 600, color: tone, lh: 1.2, id: `my-kpi-${i}-v` }));
    els.push(T(note, x + 112, 296, 220, 18, { size: 10, color: C.muted, id: `my-kpi-${i}-n` }));
  });

  els.push(T('预约记录', 48, 380, 220, 24, { size: 13, weight: 600, id: 'my-list-title' }));
  els.push(T('取消后不可恢复，请确认时间。', 850, 382, 302, 20, { size: 10, color: C.muted, align: 'right', id: 'my-list-note' }));
  els.push(E('table', 48, 412, 1104, 308, {
    id: 'my-bookings-table',
    header: true,
    data: TABLE_DATA,
    size: 11.5,
    padding: 11,
    bg: '#FCFCF8',
    headBg: '#EFF1E9',
    borderColor: '#E2E1D7',
    stripe: false,
    radius: 8,
    color: C.ink,
    empty: '还没有预约，去服务项目页选一个时段。',
    maxRows: 20,
  }, { background: 'transparent' }));
  els.push(E('js', 20, 790, 2, 2, { id: 'js-my-runtime', showCode: false, runMode: 'load', once: true, code: RUNTIME_JS }));
  return els.concat(footer('my'));
}

// ---------- admin ----------
function adminPage() {
  const els = [].concat(nav('admin', 'admin'));
  els.push(T('DESK / 03', 48, 116, 260, 18, { size: 9, color: C.clay, weight: 600, ls: 2.4, id: 'ad-kicker' }));
  els.push(Hd('预约管理', 46, 142, 360, 58, { size: 40, weight: 500, ls: -1, id: 'ad-title' }));
  els.push(T('今日到店、待确认和取消，都在这一张表里。', 48, 204, 560, 26, { size: 12, color: C.muted, id: 'ad-sub' }));
  const stats = [
    ['今日到店', '04', C.forest],
    ['待确认', '00', C.clay],
    ['本周取消', '00', C.muted],
    ['空闲时段', '03', C.slate],
  ];
  stats.forEach(([label, value, tone], i) => {
    const x = 48 + i * 276;
    els.push(Box(x, 248, 264, 88, { bg: C.card, border: 1, borderColor: '#E3E2D8', radius: 12, id: `ad-kpi-${i}` }));
    els.push(T(label, x + 18, 262, 120, 18, { size: 10, color: C.muted, ls: 0.8, id: `ad-kpi-${i}-l` }));
    els.push(T(value, x + 18, 282, 80, 38, { size: 28, font: SERIF, weight: 600, color: tone, lh: 1.2, id: `ad-kpi-${i}-v` }));
  });
  els.push(T('全部预约', 48, 370, 220, 24, { size: 13, weight: 600, id: 'ad-list-title' }));
  els.push(E('table', 48, 402, 1104, 322, {
    id: 'ad-bookings-table',
    header: true,
    data: TABLE_DATA,
    size: 11.5,
    padding: 11,
    bg: '#FCFCF8',
    headBg: '#EFF1E9',
    borderColor: '#E2E1D7',
    stripe: false,
    radius: 8,
    color: C.ink,
    empty: '暂无预约。',
    maxRows: 20,
  }, { background: 'transparent' }));
  els.push(E('js', 20, 790, 2, 2, { id: 'js-admin-runtime', showCode: false, runMode: 'load', once: true, code: RUNTIME_JS }));
  return els.concat(footer('admin'));
}

const page = (id, name, elements) => ({ id, name, elements, bg: C.paper, codeExec: {} });
const project = {
  name: '预约服务 · 原生组件',
  framework: 'tailwind',
  homePage: 'home',
  active: 0,
  pageNav: true,
  pageFade: true,
  rulers: true,
  responsive: true,
  stackMobile: true,
  page: { w: W, h: H, bg: C.paper },
  pages: [
    page('home', '首页', homePage()),
    page('collection', '服务项目', collectionPage()),
    page('my', '我的预约', myPage()),
    page('admin', '预约管理', adminPage()),
  ],
  theme: { font: SANS, accent: C.forest, paper: C.paper, ink: C.ink },
  assets: {},
  fullscreen: true,
  accessPassword: '',
  nativeCase: true,
  nativeKind: 'booking',
};

data.frontend = {
  format: 'yxpp',
  version: 1,
  name: project.name,
  framework: 'tailwind',
  updatedAt: new Date().toISOString(),
  project,
  html: '',
};
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ file, pages: project.pages.map((p) => ({ id: p.id, elements: p.elements.length })) }, null, 2));
