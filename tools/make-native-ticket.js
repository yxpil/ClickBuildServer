'use strict';
// 作者：yxpil
// 工单案例：PageStudio 原生组件拼接，4 页（工作台 / 工单 / 工单详情 / 客户）。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const W = 1200, H = 820;
let seq = 0;
const SANS = '"Inter","PingFang SC","Microsoft YaHei",sans-serif';
const SERIF = '"Noto Serif SC","Songti SC","SimSun",serif';
const MONO = '"JetBrains Mono","Consolas",monospace';

function E(type, x, y, w, h, props, style, name) { seq++; const id = (props && props.id) || `tk-${seq}`; return { id, type, x, y, w, h, name: name || '', hidden: false, locked: false, props: Object.assign({ id }, props || {}), style: style || {} }; }
function T(text, x, y, w, h, o) { o = o || {}; return E('text', x, y, w, h, { text, size: o.size || 14, weight: o.weight || 400, color: o.color || K.ink, lh: o.lh || 1.5, ls: o.ls == null ? 0 : o.ls, align: o.align || 'left', font: o.font || SANS, id: o.id }, o.style || {}, o.name); }
function Hd(text, x, y, w, h, o) { o = o || {}; return E('heading', x, y, w, h, { text, size: o.size || 40, weight: o.weight || 500, color: o.color || K.ink, lh: o.lh || 1.16, ls: o.ls == null ? -0.5 : o.ls, align: o.align || 'left', font: o.font || SERIF, tag: o.tag || 'h2', id: o.id }, o.style || {}, o.name); }
function Btn(text, x, y, w, h, o) { o = o || {}; return E('button', x, y, w, h, { text, size: o.size || 13, weight: o.weight || 500, color: o.color || K.ink, font: o.font || SANS, id: o.id }, Object.assign({ background: o.bg || 'transparent', border: o.border == null ? 0 : o.border, borderColor: o.borderColor || 'transparent', radius: o.radius == null ? 0 : o.radius }, o.style || {}), o.name); }
function Box(x, y, w, h, o) { o = o || {}; return E('box', x, y, w, h, { id: o.id }, Object.assign({ background: o.bg || K.card, border: o.border == null ? 1 : o.border, borderColor: o.borderColor || K.line, radius: o.radius == null ? 14 : o.radius, shadow: o.shadow || 'none', opacity: 1, padding: o.padding || 0 }, o.style || {}), o.name); }
function Shape(x, y, w, h, kind, fill, o) { o = o || {}; return E('shape', x, y, w, h, { kind, fill, strokeOn: false, radius: o.radius == null ? 8 : o.radius, id: o.id }, { opacity: o.opacity == null ? 1 : o.opacity }, o.name); }
function Line(x, y, w, o) { o = o || {}; return E('divider', x, y, w, 1, { id: o.id }, { background: o.color || K.line }); }
const K = { paper: '#F1F4F2', card: '#FBFCFA', ink: '#1C2423', muted: '#707C78', line: '#D9E0DD', accent: '#2C5B57', amber: '#B07A3F', red: '#A65343', blue: '#4C6472', soft: '#DFE7E3' };

const CUSTOMERS = [
  { id: 1, name: '昆明云岭科技', phone: '13877770001', level: 5, owner: '客服一组', note: '年度服务客户' },
  { id: 2, name: '春城文旅集团', phone: '13877770002', level: 4, owner: '客服二组', note: '票务系统客户' },
  { id: 3, name: '滇池咖啡供应链', phone: '13877770003', level: 3, owner: '客服一组', note: '门店系统' },
  { id: 4, name: '小满设计工作室', phone: '13877770004', level: 2, owner: '客服二组', note: '小型客户' },
  { id: 5, name: '西南物流园', phone: '13877770005', level: 4, owner: '客服三组', note: '接口对接' },
];
const TICKETS = [
  { id: 1, title: '导出报表中文乱码', content: 'CSV 用 Excel 打开后中文显示为乱码。', customer: 1, status: 1, priority: 2, assignee: '工程师张三', time: '11-25 09:12' },
  { id: 2, title: '票务核销提示重复', content: '同一张票在手持机上核销两次都成功。', customer: 2, status: 1, priority: 3, assignee: '工程师李四', time: '11-25 08:40' },
  { id: 3, title: '库存预警没有推送', content: '低于安全库存后没有收到通知。', customer: 3, status: 2, priority: 2, assignee: '工程师张三', time: '11-24 17:05' },
  { id: 4, title: '登录后空白页', content: 'Chrome 131 登录后页面空白。', customer: 4, status: 0, priority: 2, assignee: '', time: '11-25 10:22' },
  { id: 5, title: '运单轨迹缺节点', content: '顺丰和圆通的轨迹字段不一致。', customer: 5, status: 1, priority: 2, assignee: '工程师王五', time: '11-24 15:18' },
  { id: 6, title: '历史订单无法搜索', content: '订单号搜索无结果。', customer: 1, status: 2, priority: 1, assignee: '工程师张三', time: '11-23 11:30' },
];
const REPLIES = [
  { ticket: 1, author: '工程师张三', content: '已复现，CSV 增加 BOM 头，今天发版。', time: '11-25 10:01' },
  { ticket: 2, author: '工程师李四', content: '核销接口加幂等键，正在灰度。', time: '11-25 09:06' },
  { ticket: 3, author: '工程师张三', content: '排查是通知队列积压，已补发。', time: '11-24 18:20' },
  { ticket: 5, author: '工程师王五', content: '已统一为 shipping/delivered/signed 三态。', time: '11-24 16:02' },
];
const statusText = (s) => s === 0 ? '待受理' : (s === 1 ? '处理中' : '已关闭');
const priorityText = (p) => p === 3 ? '高' : (p === 2 ? '中' : '低');
const cust = (id) => CUSTOMERS.find((c) => c.id === id) || CUSTOMERS[0];
const TICKET_CSV = ['编号,标题,客户,优先级,状态,负责人,操作', ...TICKETS.map((t) => `#${String(t.id).padStart(3, '0')},${t.title},${cust(t.customer).name},${priorityText(t.priority)},${statusText(t.status)},${t.assignee || '未分配'},查看`)].join('\n');
const CUSTOMER_CSV = ['客户,联系人,等级,负责人,备注', ...CUSTOMERS.map((c) => `${c.name},${c.phone},L${c.level},${c.owner},${c.note}`)].join('\n');
const REPLY_CSV = ['回复人,内容,时间', ...REPLIES.filter((r) => r.ticket === 1).map((r) => `${r.author},${r.content},${r.time}`)].join('\n');

function chrome(p, active) {
  const els = [];
  els.push(Box(0, 0, W, 78, { bg: K.card, border: 0, radius: 0, id: `hdr-${p}` }));
  els.push(Line(0, 77, W, { id: `hdr-${p}-line` }));
  els.push(Shape(48, 21, 36, 36, 'rect', K.accent, { radius: 9, id: `hdr-${p}-mark` }));
  els.push(T('应', 48, 21, 36, 36, { size: 14, weight: 700, color: '#FFF', align: 'center', lh: 2.45, id: `hdr-${p}-glyph` }));
  els.push(T('应答台', 96, 18, 160, 26, { size: 18, weight: 700, id: `hdr-${p}-brand` }));
  els.push(T('SUPPORT DESK · KUNMING', 96, 45, 290, 18, { size: 9, color: K.muted, ls: 1.7, id: `hdr-${p}-sub` }));
  [['home', '工作台', 720], ['collection', '工单', 812], ['customers', '客户', 890]].forEach(([t, l, x]) => {
    const on = active === t;
    els.push(Btn(l, x, 25, 74, 28, { size: 12.5, color: on ? K.ink : K.muted, weight: on ? 600 : 500, id: `pn-${p}-${t}` }));
    if (on) els.push(Line(x, 61, 58, { color: K.ink, id: `hdr-${p}-on-${t}` }));
  });
  els.push(Shape(1028, 30, 8, 8, 'circle', '#5E8F6B', { opacity: 1, id: `hdr-${p}-live-dot` }));
  els.push(T('服务在线', 1044, 26, 100, 18, { size: 9.5, color: K.muted, id: `hdr-${p}-live` }));
  return els;
}
function foot(p, text) { return [Line(48, 760, 1104, { id: `ft-${p}-line` }), T(text, 48, 776, 480, 20, { size: 10, color: K.muted, ls: 0.6, id: `ft-${p}-a` }), T('PageStudio 原生组件 · 真实接口数据', 760, 776, 392, 20, { size: 10, color: K.muted, align: 'right', id: `ft-${p}-b` })]; }
const page = (id, name, elements) => ({ id, name, elements, bg: K.paper, codeExec: {} });
const hide = (id, code) => E('js', 20, 790, 2, 2, { id, showCode: false, runMode: 'load', once: true, code });
function save(file, project) { const fp = path.join(root, 'app', 'iface', 'cases', file); const data = JSON.parse(fs.readFileSync(fp, 'utf8')); data.frontend = { format: 'yxpp', version: 1, name: project.name, framework: 'tailwind', updatedAt: new Date().toISOString(), project, html: '' }; fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf8'); console.log(file, project.pages.map((x) => `${x.id}:${x.elements.length}`).join(' ')); }

function kpi(x, y, label, value, note, tone, prefix, i) {
  return [Box(x, y, 264, 88, { bg: K.card, border: 1, borderColor: K.line, radius: 11, id: `${prefix}-kpi-${i}` }),
    T(label, x + 18, y + 14, 120, 16, { size: 9.5, color: K.muted, ls: 0.8, id: `${prefix}-kpi-${i}-l` }),
    T(value, x + 18, y + 32, 80, 38, { size: 27, font: SERIF, weight: 600, color: tone, lh: 1.2, id: `${prefix}-kpi-${i}-v` }),
    T(note, x + 98, y + 48, 150, 18, { size: 9.5, color: K.muted, id: `${prefix}-kpi-${i}-n` })];
}

function ticketHome() {
  const els = chrome('home', 'home');
  els.push(T('SUPPORT / NOV 25', 48, 124, 300, 18, { size: 9.5, color: K.accent, weight: 600, ls: 2.4, id: 'th-kicker' }));
  els.push(Hd('今天有 5 张工单，\n等你处理。', 46, 152, 600, 142, { size: 44, weight: 500, lh: 1.2, ls: -1.2, id: 'th-title' }));
  els.push(T('客服、工程和客户都在同一张表里。先处理高优先级，再回复等待中的人。', 48, 310, 540, 50, { size: 13, color: K.muted, lh: 1.9, id: 'th-sub' }));
  els.push(Btn('查看全部工单  →', 48, 382, 180, 44, { size: 13, color: '#FFF', bg: K.accent, radius: 6, weight: 600, id: 'pn-home-collection-cta' }));
  els.push(T('平均首响 12 分钟', 248, 396, 220, 20, { size: 10.5, color: K.muted, id: 'th-sla' }));

  els.push(Box(760, 118, 392, 296, { bg: '#E2E8E4', border: 0, radius: 16, id: 'th-art-bg' }));
  els.push(Shape(792, 176, 128, 128, 'circle', K.accent, { opacity: 0.88, id: 'th-art-circle' }));
  els.push(T('SLA', 800, 196, 114, 30, { size: 7, color: '#FFF', weight: 600, ls: 2, id: 'th-art-k' }));
  els.push(T('12 MIN', 800, 222, 114, 36, { size: 22, font: SERIF, color: '#FFF', lh: 1.3, id: 'th-art-v' }));
  els.push(Shape(942, 154, 176, 10, 'rect', K.amber, { radius: 5, id: 'th-art-bar1' }));
  els.push(Shape(942, 178, 136, 10, 'rect', K.blue, { radius: 5, id: 'th-art-bar2' }));
  els.push(Shape(942, 202, 156, 10, 'rect', K.red, { radius: 5, opacity: 0.7, id: 'th-art-bar3' }));
  els.push(T('FIRST RESPONSE', 942, 230, 170, 18, { size: 8.5, color: K.ink, ls: 1.2, id: 'th-art-cap' }));
  els.push(T('客服不是传话筒。\n是把问题拆到能解决为止。', 780, 328, 330, 60, { size: 12, color: K.muted, lh: 1.9, id: 'th-art-copy' }));

  [['待受理', '01', '需要分配', K.red], ['处理中', '04', '工程跟进', K.amber], ['已关闭', '01', '本周完成', K.accent], ['客户', '05', '在服务中', K.blue]].forEach(([l, v, n, t], i) => els.push(...kpi(48 + i * 276, 458, l, v, n, t, 'th', i)));

  els.push(T('最近工单', 48, 566, 220, 24, { size: 13, weight: 600, id: 'th-list-title' }));
  els.push(T('按更新时间排序', 900, 568, 252, 20, { size: 9.5, color: K.muted, align: 'right', id: 'th-list-note' }));
  els.push(E('table', 48, 596, 1104, 144, { id: 'th-table', header: true, data: TICKET_CSV, size: 10.5, padding: 10, bg: '#FBFCFA', headBg: '#E8EEE9', borderColor: '#D9E0DD', stripe: false, radius: 7, color: K.ink, maxRows: 6 }, { background: 'transparent' }));
  els.push(hide('js-ticket-home', TICKET_JS));
  return els.concat(foot('home', '应答台 · 今日工作台'));
}

function ticketCollection() {
  const els = chrome('collection', 'collection');
  els.push(T('TICKETS / 01', 48, 116, 260, 18, { size: 9, color: K.accent, weight: 600, ls: 2.4, id: 'tc-kicker' }));
  els.push(Hd('工单', 46, 142, 300, 58, { size: 40, weight: 500, ls: -1, id: 'tc-title' }));
  els.push(T('6 张工单。点「查看」进入详情，回复和解决都会落表。', 48, 204, 560, 26, { size: 12, color: K.muted, id: 'tc-sub' }));
  ['全部', '待受理', '处理中', '已关闭'].forEach((c, i) => {
    els.push(Btn(c, 760 + i * 84, 206, 72, 26, { size: 10.5, color: i === 0 ? '#FFF' : K.muted, bg: i === 0 ? K.ink : 'transparent', radius: 13, weight: i === 0 ? 600 : 400, id: `tkfilter-${i}` }));
  });
  els.push(Line(48, 246, 1104, { id: 'tc-line' }));
  els.push(Box(48, 264, 1104, 470, { bg: K.card, border: 1, borderColor: K.line, radius: 14, id: 'tc-box' }));
  els.push(T('全部工单', 68, 282, 200, 24, { size: 12, weight: 600, id: 'tc-list-title' }));
  els.push(T('编号 / 标题 / 客户 / 优先级 / 状态 / 负责人', 760, 284, 372, 18, { size: 9, color: K.muted, align: 'right', id: 'tc-list-note' }));
  els.push(E('table', 66, 316, 1068, 400, { id: 'tc-table', header: true, data: TICKET_CSV, size: 11, padding: 12, bg: '#FBFCFA', headBg: '#E8EEE9', borderColor: '#D9E0DD', stripe: false, radius: 7, color: K.ink, maxRows: 20 }, { background: 'transparent' }));
  els.push(hide('js-ticket-collection', TICKET_JS));
  return els.concat(foot('collection', '应答台 · 6 张工单'));
}

function ticketDetail() {
  const els = chrome('detail', 'collection');
  els.push(T('#T-001 / 处理中', 48, 116, 280, 18, { size: 9, color: K.amber, weight: 600, ls: 1.6, id: 'td-kicker' }));
  els.push(Hd(TICKETS[0].title, 46, 140, 700, 58, { size: 34, weight: 500, lh: 1.3, ls: -0.6, id: 'td-title' }));
  els.push(T('昆明云岭科技 · 优先级 中 · 工程师张三', 48, 200, 520, 22, { size: 10.5, color: K.muted, id: 'td-meta' }));
  els.push(Box(48, 242, 700, 168, { bg: K.card, border: 1, borderColor: K.line, radius: 12, id: 'td-content-box' }));
  els.push(T('问题描述', 68, 258, 120, 18, { size: 9, color: K.accent, weight: 600, ls: 1.2, id: 'td-content-label' }));
  els.push(T(TICKETS[0].content, 68, 282, 660, 44, { size: 13, color: '#39423F', lh: 1.95, id: 'td-content' }));
  els.push(T('SERVICE NOTE', 68, 332, 200, 14, { size: 8.5, color: K.accent, weight: 600, ls: 1.2, id: 'td-note-label' }));
  els.push(T('首次响应 15 分钟 · 解决时限 4 小时 · 当前 SLA 内', 68, 350, 500, 18, { size: 10.5, color: '#39423F', id: 'td-note' }));
  els.push(Line(68, 380, 660, { color: '#E2E7E3', id: 'td-content-line' }));
  els.push(T('客户：昆明云岭科技 · 13877770001 · L5', 68, 390, 500, 18, { size: 9.5, color: K.muted, id: 'td-customer' }));

  els.push(Box(780, 140, 372, 262, { bg: '#E4EAE5', border: 0, radius: 12, id: 'td-side' }));
  els.push(T('TICKET STATUS', 804, 158, 300, 18, { size: 8.5, color: K.accent, weight: 600, ls: 1.6, id: 'td-status-k' }));
  els.push(T(statusText(TICKETS[0].status), 804, 180, 200, 38, { size: 25, font: SERIF, weight: 600, id: 'td-status' }));
  els.push(T('负责人', 804, 232, 100, 18, { size: 9.5, color: K.muted, id: 'td-owner-l' }));
  els.push(T('工程师张三', 900, 232, 220, 20, { size: 11, weight: 600, id: 'td-owner' }));
  els.push(T('创建时间', 804, 262, 100, 18, { size: 9.5, color: K.muted, id: 'td-time-l' }));
  els.push(T('11-25 09:12', 900, 262, 220, 20, { size: 11, id: 'td-time' }));
  els.push(Btn('标记已解决  ✓', 804, 314, 150, 34, { size: 11, color: '#FFF', bg: K.accent, radius: 4, weight: 600, id: 'td-resolve' }));
  els.push(Btn('返回工单列表  ←', 970, 318, 150, 24, { size: 10.5, color: K.accent, weight: 600, id: 'pn-detail-collection' }));

  els.push(T('处理记录', 48, 438, 220, 26, { size: 14, weight: 600, id: 'td-replies-title' }));
  els.push(T('回复会追加到 biz_ticket_reply', 820, 442, 332, 18, { size: 9.5, color: K.muted, align: 'right', id: 'td-replies-note' }));
  els.push(E('table', 48, 468, 660, 196, { id: 'td-replies', header: true, data: REPLY_CSV, size: 10.5, padding: 10, bg: '#FBFCFA', headBg: '#E8EEE9', borderColor: '#D9E0DD', stripe: false, radius: 7, color: K.ink, maxRows: 10 }, { background: 'transparent' }));

  els.push(Box(744, 438, 408, 272, { bg: K.card, border: 1, borderColor: K.line, radius: 12, id: 'td-form-box' }));
  els.push(T('写一条回复', 766, 456, 240, 22, { size: 12.5, weight: 600, id: 'td-form-title' }));
  els.push(T('回复后负责人会被记录，状态自动变成处理中。', 766, 482, 356, 18, { size: 9, color: K.muted, id: 'td-form-note' }));
  els.push(E('form', 766, 510, 364, 180, { id: 'td-reply-form', fields: '回复人|text|工程师张三|author|required\n回复内容|textarea|写清楚处理进展|content|required', action: '/api/tickets/1/replies', method: 'post', submitMode: 'custom', custom: 'return window.__ticketReply(data, form);', submit: '发送回复', submitBg: K.accent, submitColor: '#FFF', inputBg: '#FFF', labelColor: K.muted, radius: 5, size: 12, success: '回复已发送。' }, { background: 'transparent' }));
  els.push(hide('js-ticket-detail', TICKET_JS));
  return els.concat(foot('detail', '应答台 · 工单详情'));
}

function ticketCustomers() {
  const els = chrome('customers', 'customers');
  els.push(T('CUSTOMERS / 02', 48, 116, 300, 18, { size: 9, color: K.accent, weight: 600, ls: 2.4, id: 'tm-kicker' }));
  els.push(Hd('客户', 46, 142, 300, 58, { size: 40, weight: 500, ls: -1, id: 'tm-title' }));
  els.push(T('客户等级决定响应顺序。L5 先接，L2 排后。', 48, 204, 520, 26, { size: 12, color: K.muted, id: 'tm-sub' }));
  [['客户总数', '05', '在服务中', K.accent], ['L5 客户', '01', '最高优先级', K.red], ['L4 客户', '02', '重点跟进', K.amber]].forEach(([l, v, n, t], i) => {
    const x = 48 + i * 372;
    els.push(Box(x, 244, 360, 88, { bg: K.card, border: 1, borderColor: K.line, radius: 11, id: `tm-kpi-${i}` }));
    els.push(T(l, x + 18, 258, 120, 16, { size: 9.5, color: K.muted, id: `tm-kpi-${i}-l` }));
    els.push(T(v, x + 18, 276, 70, 38, { size: 27, font: SERIF, weight: 600, color: t, lh: 1.2, id: `tm-kpi-${i}-v` }));
    els.push(T(n, x + 98, 290, 220, 18, { size: 9.5, color: K.muted, id: `tm-kpi-${i}-n` }));
  });
  els.push(Box(48, 360, 1104, 360, { bg: K.card, border: 1, borderColor: K.line, radius: 14, id: 'tm-box' }));
  els.push(T('客户列表', 68, 378, 200, 24, { size: 12, weight: 600, id: 'tm-list-title' }));
  els.push(T('来源 crm_customer', 940, 380, 192, 18, { size: 9, color: K.muted, align: 'right', id: 'tm-list-note' }));
  els.push(E('table', 66, 410, 1068, 292, { id: 'tm-table', header: true, data: CUSTOMER_CSV, size: 11, padding: 12, bg: '#FBFCFA', headBg: '#E8EEE9', borderColor: '#D9E0DD', stripe: false, radius: 7, color: K.ink, maxRows: 20 }, { background: 'transparent' }));
  els.push(hide('js-ticket-customers', TICKET_JS));
  return els.concat(foot('customers', '应答台 · 5 个客户'));
}

const TICKET_JS = [
  '(function(){',
  '  if (window.__CASE_TICKET__) return; window.__CASE_TICKET__ = true;',
  '  var TICKETS = ' + JSON.stringify(TICKETS) + ';',
  '  var CUSTOMERS = ' + JSON.stringify(CUSTOMERS) + ';',
  '  var REPLIES = ' + JSON.stringify(REPLIES) + ';',
  '  var CUR = 1, FILTER = 0;',
  '  function byId(id){ return document.getElementById(id); } function cust(id){ return CUSTOMERS.filter(function(c){ return c.id === Number(id); })[0] || CUSTOMERS[0]; } function ticket(id){ return TICKETS.filter(function(t){ return t.id === Number(id); })[0]; }',
  '  function st(s){ return s === 0 ? "待受理" : (s === 1 ? "处理中" : "已关闭"); } function pr(p){ return p === 3 ? "高" : (p === 2 ? "中" : "低"); }',
  '  function go(id){ var b = document.querySelector(".ps-nav-b[data-ps-go=\\"" + id + "\\"]"); if (b) b.click(); }',
  '  function hideNav(){ if (byId("tk-native-css")) return; var s = document.createElement("style"); s.id = "tk-native-css"; s.textContent = ".ps-nav{display:none!important}.ps-root{background:#F1F4F2}"; document.head.appendChild(s); }',
  '  function bindNav(){ Array.prototype.forEach.call(document.querySelectorAll("[id^=\\"pn-\\"]"), function(b){ if (b.__n) return; b.__n = true; b.addEventListener("click", function(e){ e.preventDefault(); var t = b.id.split("-")[2]; if (t) go(t); }); }); }',
  '  function rowsHtml(list){ return list.map(function(t){ var c = cust(t.customer); return "<tr><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5;font-family:monospace;font-size:10.5px\\">#" + String(t.id).padStart(3,"0") + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5;font-weight:600\\">" + t.title + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\">" + c.name + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\">" + pr(t.priority) + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\">" + st(t.status) + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\">" + (t.assignee || "未分配") + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\"><button data-open=\\"" + t.id + "\\" style=\\"border:0;background:transparent;color:#2C5B57;font-size:11px;font-weight:600;cursor:pointer\\">查看</button></td></tr>"; }).join("") || "<tr><td colspan=\\"7\\" style=\\"padding:24px;text-align:center;color:#8d9894\\">没有工单</td></tr>"; }',
  '  function bindOpen(tb){ Array.prototype.forEach.call(tb.querySelectorAll("[data-open]"), function(b){ b.addEventListener("click", function(){ openTicket(b.getAttribute("data-open")); }); }); }',
  '  function renderTables(){ [["th-table", false], ["tc-table", true]].forEach(function(c){ var host = byId(c[0]); if (!host) return; var tbl = host.querySelector("table"); if (!tbl) return; var tb = tbl.querySelector("tbody");',
  '    var list = TICKETS.slice(); if (c[1] && FILTER) list = list.filter(function(t){ return t.status === FILTER - 1; }); tb.innerHTML = rowsHtml(list); bindOpen(tb); });',
  '    [["th",0],["th",1],["th",2],["th",3]].forEach(function(){ }); var w = function(id,v){var e=byId(id);if(e)e.textContent=v;};',
  '    w("th-kpi-0-v", ("0"+TICKETS.filter(function(t){return t.status===0;}).length).slice(-2)); w("th-kpi-1-v", ("0"+TICKETS.filter(function(t){return t.status===1;}).length).slice(-2)); w("th-kpi-2-v", ("0"+TICKETS.filter(function(t){return t.status===2;}).length).slice(-2)); w("th-kpi-3-v", ("0"+CUSTOMERS.length).slice(-2)); }',
  '  function replyRows(){ var host = byId("td-replies"); if (!host) return; var tbl = host.querySelector("table"); if (!tbl) return; var tb = tbl.querySelector("tbody"); var list = REPLIES.filter(function(r){ return r.ticket === CUR; });',
  '    tb.innerHTML = list.map(function(r){ return "<tr><td style=\\"padding:10px 12px;border-bottom:1px solid #E4E9E5;font-weight:600\\">" + r.author + "</td><td style=\\"padding:10px 12px;border-bottom:1px solid #E4E9E5\\">" + r.content + "</td><td style=\\"padding:10px 12px;border-bottom:1px solid #E4E9E5;color:#7C8884\\">" + r.time + "</td></tr>"; }).join("") || "<tr><td colspan=\\"3\\" style=\\"padding:18px;text-align:center;color:#8d9894\\">暂无回复</td></tr>"; }',
  '  function openTicket(id){ var t = ticket(id); if (!t) return; CUR = t.id; var c = cust(t.customer); var set = function(k,v){var e=byId(k);if(e)e.textContent=v;};',
  '    set("td-kicker", "#T-" + String(t.id).padStart(3,"0") + " / " + st(t.status)); set("td-title", t.title); set("td-meta", c.name + " · 优先级 " + pr(t.priority) + " · " + (t.assignee || "未分配")); set("td-content", t.content); set("td-customer", "客户：" + c.name + " · " + c.phone + " · L" + c.level); set("td-status", st(t.status)); set("td-owner", t.assignee || "未分配"); set("td-time", t.time);',
  '    replyRows(); go("detail"); }',
  '  function renderCustomers(){ var host = byId("tm-table"); if (!host) return; var tbl = host.querySelector("table"); if (!tbl) return; var tb = tbl.querySelector("tbody");',
  '    tb.innerHTML = CUSTOMERS.map(function(c){ return "<tr><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5;font-weight:600\\">" + c.name + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\">" + c.phone + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\">L" + c.level + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\">" + c.owner + "</td><td style=\\"padding:11px 12px;border-bottom:1px solid #E4E9E5\\">" + c.note + "</td></tr>"; }).join(""); }',
  '  function bindFilter(){ for (var i=0;i<4;i++){ (function(i){ var b = byId("tkfilter-"+i); if (!b || b.__f) return; b.__f = true; b.addEventListener("click", function(){ FILTER = i; for (var j=0;j<4;j++){ var x = byId("tkfilter-"+j); if (x) { x.style.background = j===i ? "#1C2423" : "transparent"; x.style.color = j===i ? "#FFFFFF" : "#707C78"; } } renderTables(); }); })(i); } }',
  '  window.__ticketReply = function(data){ var t = ticket(CUR); if (!data.author || !data.content) return Promise.reject(new Error("请填写回复人和内容")); var r = { ticket:CUR, author:data.author, content:data.content, time:"刚刚" }; REPLIES.push(r); if (t && t.status === 0) t.status = 1; renderTables(); replyRows(); var s = byId("td-status"); if (s) s.textContent = st(t.status); return Promise.resolve(r); };',
  '  function bindResolve(){ var b = byId("td-resolve"); if (!b || b.__r) return; b.__r = true; b.addEventListener("click", function(){ var t = ticket(CUR); if (t) t.status = 2; renderTables(); var s = byId("td-status"); if (s) s.textContent = "已关闭"; var k = byId("td-kicker"); if (k) k.textContent = "#T-" + String(CUR).padStart(3,"0") + " / 已关闭"; }); }',
  '  hideNav(); bindNav(); bindOpen(document); bindFilter(); renderTables(); replyRows(); renderCustomers(); bindResolve();',
  '  window.addEventListener("load", function(){ hideNav(); bindNav(); bindFilter(); renderTables(); replyRows(); renderCustomers(); bindResolve(); });',
  '  setTimeout(function(){ hideNav(); bindNav(); bindFilter(); renderTables(); replyRows(); renderCustomers(); bindResolve(); }, 300);',
  '})();',
].join('\n');

save('ticket.json', {
  name: '应答台 · 原生组件', framework: 'tailwind', homePage: 'home', active: 0, pageNav: true, pageFade: true, rulers: true, responsive: true, stackMobile: true,
  page: { w: W, h: H, bg: K.paper }, theme: { font: SANS, accent: K.accent, paper: K.paper, ink: K.ink }, assets: {}, fullscreen: true, accessPassword: '', nativeCase: true, nativeKind: 'ticket',
  pages: [page('home', '工作台', ticketHome()), page('collection', '工单', ticketCollection()), page('detail', '工单详情', ticketDetail()), page('customers', '客户', ticketCustomers())],
});
