// ---- 00-core.js ----
/* 真实业务页面核心：请求、鉴权、表单、弹窗、导航、表格。 */
const App = (window.App = {});
const CASE = window.CASE || {};
const UX = window.UX || {};
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const state = {
  view: 'home',
  params: {},
  token: '',
  user: null,
  rows: {},
  played: {},
  loading: 0,
};

const MODES = {};

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
App.esc = esc;

function storeGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

function ifaceOf(name) {
  return (CASE.interfaces || []).find((i) => i.name === name)
    || (CASE.interfaces || []).find((i) => String(i.name).indexOf(name) >= 0)
    || null;
}
App.ifaceOf = ifaceOf;

function routeOf(ifaceName, path, method) {
  const i = ifaceOf(ifaceName);
  if (!i) return null;
  const list = i.routes || [];
  let r = list.find((x) => x.path === path && (!method || x.method === method));
  if (!r) r = list.find((x) => x.path === path);
  if (!r && path && path.indexOf(':') >= 0) {
    const norm = path.replace(/:[A-Za-z0-9_]+/g, ':');
    r = list.find((x) => x.path.replace(/:[A-Za-z0-9_]+/g, ':') === norm && (!method || x.method === method));
  }
  return r || null;
}

function apiUrl(ifaceName, path, params) {
  const i = ifaceOf(ifaceName);
  if (!i) throw new Error('接口不存在：' + ifaceName);
  let p = (i.basePath || '') + path;
  if (params) {
    Object.keys(params).forEach((k) => {
      p = p.replace(new RegExp(':' + k + '(?![A-Za-z0-9_])', 'g'), encodeURIComponent(String(params[k])));
    });
  }
  return '/api' + p;
}

async function api(ifaceName, path, opts) {
  opts = opts || {};
  const method = opts.method || 'GET';
  let url = apiUrl(ifaceName, path, opts.params);
  if (opts.query) {
    const qs = new URLSearchParams();
    Object.keys(opts.query).forEach((k) => {
      const v = opts.query[k];
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const s = qs.toString();
    if (s) url += (url.indexOf('?') >= 0 ? '&' : '?') + s;
  }
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (state.token) headers.authorization = 'Bearer ' + state.token;
  let res;
  try {
    res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch (e) {
    throw new Error('无法连接服务，请确认案例服务已经启动');
  }
  let json = {};
  try { json = await res.json(); } catch (e) { json = {}; }
  if (!res.ok || json.ok === false) {
    const err = new Error(json.message || json.error || ('请求失败 ' + res.status));
    err.status = res.status;
    err.code = json.error || '';
    throw err;
  }
  return json.data === undefined ? json : json.data;
}
App.api = api;

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const k of ['rows', 'data', 'list', 'items']) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}
App.rowsOf = rowsOf;

function itemOf(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.row && typeof payload.row === 'object') return Object.assign({}, payload.row, { __replies: payload.replies || payload.row.replies || [] });
  if (Array.isArray(payload.post)) return payload.post[0] || payload;
  if (payload.post && typeof payload.post === 'object') return payload.post;
  if (Array.isArray(payload.song)) return payload.song[0] || payload;
  if (payload.song && typeof payload.song === 'object') return payload.song;
  if (Array.isArray(payload.video)) return payload.video[0] || payload;
  if (payload.video && typeof payload.video === 'object') return payload.video;
  if (Array.isArray(payload.course)) return Object.assign({}, payload.course[0] || {}, { __lessons: payload.lessons || [] });
  if (Array.isArray(payload.quote)) return Object.assign({}, payload.quote[0] || {}, { __items: payload.items || [], __processes: payload.processes || [] });
  if (Array.isArray(payload.project)) return Object.assign({}, payload.project[0] || {}, { __modules: payload.modules || [], __client: payload.client || [] });
  if (Array.isArray(payload.shipment)) return Object.assign({}, payload.shipment[0] || {}, { __tracks: payload.tracks || [] });
  if (Array.isArray(payload.order)) return Object.assign({}, payload.order[0] || {}, { __items: payload.items || [] });
  if (Array.isArray(payload.latest)) return Object.assign({}, payload.latest[0] || {});
  if (Array.isArray(payload.user)) return payload.user[0] || {};
  if (payload.user && typeof payload.user === 'object') return payload.user;
  return payload;
}
App.itemOf = itemOf;

function fmtDate(v, withTime) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, withTime ? 16 : 10);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  if (!withTime) return day;
  return day + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtDay(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtMoney(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
function plain(v, n) {
  const s = String(v == null ? '' : v).replace(/[#*_>`\-\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  return n && s.length > n ? s.slice(0, n) + '…' : s;
}
function short(v, n) {
  const s = String(v == null ? '' : v);
  return s.length > (n || 28) ? s.slice(0, n || 28) + '…' : s;
}

function fieldMeta(ifaceName, name) {
  const i = ifaceOf(ifaceName);
  if (!i) return { name, type: 'varchar', comment: name };
  for (const t of (i.tables || [])) {
    const f = (t.fields || []).find((x) => x.name === name);
    if (f) return f;
  }
  return { name, type: 'varchar', comment: name };
}
App.fieldMeta = fieldMeta;

const FIELD_LABELS = {
  id: '编号', name: '名称', title: '标题', phone: '电话', mobile: '手机', email: '邮箱',
  author: '作者',
  level: '等级', remark: '备注', content: '内容', body: '消息', status: '状态', stage: '阶段',
  priority: '优先级', customer_id: '客户',
  amount: '金额', total: '合计', price: '价格', qty: '数量', stock: '库存', count: '数量',
  category: '分类', description: '说明', summary: '摘要', address: '地址', region: '地区',
  action: '操作', comment: '意见',
  assignee: '处理人', owner: '负责人', owner_only_id: '负责人', created_at: '创建时间',
  updated_at: '更新时间', cover: '封面', cover_key: '封面', avatar: '头像', nickname: '昵称',
  order_no: '订单号', table_no: '桌号', seats: '座位', table_id: '桌台', budget: '预算',
  room_no: '会议号', host_only_id: '主持人', people: '人数',
  deadline: '截止', start_at: '开始', end_at: '结束', progress: '进度', score: '得分',
  active: '启用', approver_only_id: '审批人', area: '面积', booked: '已约', capacity: '容量',
  chargeable: '计费重', checked: '已核验', client_id: '客户', code: '票码', conv_id: '会话',
  course_id: '课程', customer_name: '客户', day: '日期', days: '工期', department_id: '科室',
  destination: '目的地', detail: '详情', device_id: '设备', device_no: '设备号', discount: '折扣',
  dish_id: '菜品', doctor_id: '医生', duration: '时长', enrolled: '报名人数', event_id: '活动',
  expense_id: '报销单', fee: '费用', floor: '楼层', from_only_id: '发送人', group_id: '群组',
  height: '高度', humidity: '湿度', intro: '简介', invoice_key: '发票', job_name: '项目',
  joined_at: '加入时间', labor_rate: '人工单价', last_message: '最后消息', last_seen: '最后在线',
  left_at: '离开时间', lesson_count: '课时', material_rate: '材料单价', moment_id: '动态',
  msg_type: '消息类型', node: '节点', order_id: '订单', origin: '起点', paper: '纸张',
  passed: '通过', patient_only_id: '患者', payload: '载荷', peer_only_id: '对话人',
  plate_fee: '制版费', process_fee: '工艺费', project_id: '项目', quote_id: '报价单',
  rate_per_day: '日费率', read_flag: '已读', receiver: '收货人', room_id: '房间', route_id: '线路',
  sender: '发货人', shipment_id: '运单', sides: '面数', slot_id: '时段', sort: '排序',
  spec: '规格', teacher: '讲师', teacher_only_id: '讲师', temp: '温度', to_only_id: '收件人',
  tracking_no: '运单号', unit: '单位', unit_price: '单价', venue: '场地', video_url: '视频地址',
  views: '播放量', volume: '体积', volume_ratio: '体积重比', weight: '重量', width: '宽度',
};
function labelOf(ifaceName, name) {
  if (name === 'status' && UX.order && ifaceName === UX.order.iface) return '订单状态';
  const f = fieldMeta(ifaceName, name);
  const c = String(f.comment || '').trim();
  const enumish = /(^|\s)\d+\s+\S/.test(c) || /[|｜]/.test(c);
  return (!enumish && c && c !== name ? c : '') || FIELD_LABELS[name] || name;
}

function isDateField(meta, name) {
  return /date|time/i.test(meta.type) || /(^|_)(day|date|at|time)$/.test(name);
}
function isNumberField(meta, name) {
  return /int|decimal|float|double|number/i.test(meta.type) || /(price|amount|total|fee|qty|stock|capacity|seats|progress|score|views|days|duration|weight|volume|area|rate|sort|count|enrolled|booked)$/.test(name);
}
function isLongField(meta, name) {
  return /text/i.test(meta.type) || /(content|intro|description|remark|requirement|summary|detail|body|answers|questions|payload|images|bio|reason|comment)$/.test(name);
}

function enumFor(name, ifaceName) {
  const by = (UX.enumsByIface && ifaceName && UX.enumsByIface[ifaceName]) || {};
  return by[name] || (UX.enums && UX.enums[name]) || null;
}

function statusClass(v) {
  const s = String(v == null ? '' : v).toLowerCase();
  if (['1', 'approved', 'published', 'paid', 'completed', 'done', 'open', 'active', 'online', '1'].includes(s)) return 'ok';
  if (['0', 'pending', 'submitted', 'draft', 'quoted', 'booked', 'new', 'waiting'].includes(s)) return 'warn';
  if (['2', '3', '9', 'rejected', 'cancelled', 'closed', 'offline', 'disabled', 'failed'].includes(s)) return 'bad';
  return '';
}

function fieldValue(ifaceName, name, row) {
  if (!row) return '—';
  if (name === 'customer_id' && row.customer_id) return row.customer_id;
  const v = row[name];
  const meta = fieldMeta(ifaceName, name);
  if (v === undefined || v === null || v === '') return '—';
  if (name === 'status' || name === 'stage' || name === 'priority' || name === 'action' || name === 'level' || enumFor(name, ifaceName)) {
    const en = enumFor(name, ifaceName);
    let text = en && en[String(v)] != null ? en[String(v)] : String(v);
    if (name === 'status' && UX.order && ifaceName === UX.order.iface) {
      text = ({ 0: '待付款', 1: '已付款', 2: '已发货', 3: '已完成', 9: '已取消' })[String(v)] || text;
    }
    return '<span class="pill ' + statusClass(v) + '">' + esc(text) + '</span>';
  }
  if (isDateField(meta, name)) return esc(fmtDate(v, true));
  if (isNumberField(meta, name) && /(price|amount|total|fee|chargeable|base_price|unit_price|rate|salary)/.test(name)) return esc(fmtMoney(v));
  return esc(short(v, 80));
}

function coverHtml(row, opts) {
  opts = opts || {};
  const cover = row && (row.cover_key || row.cover || row.avatar);
  if (cover && (/^https?:/.test(cover) || cover.charAt(0) === '/')) {
    return '<img src="' + esc(cover) + '" alt="" style="width:100%;height:100%;object-fit:cover">';
  }
  const title = String((row && (row.title || row.name || row.job_name || row.tracking_no)) || '·');
  const glyph = title.slice(0, 2);
  return '<span class="glyph">' + esc(glyph) + '</span>' +
    '<span class="cover-label">' + esc(opts.label || (row && (row.category || row.paper || row.genre)) || '') + '</span>';
}
App.coverHtml = coverHtml;

function avatar(name, cls) {
  const s = String(name || '?').trim();
  return '<span class="avatar ' + (cls || '') + '">' + esc(s.slice(0, 1).toUpperCase()) + '</span>';
}
App.avatar = avatar;

function setMain(html) {
  const root = $('#app');
  if (root) root.innerHTML = html;
}
function loadingHtml(text) {
  return '<div class="loading"><div class="spinner"></div>' + esc(text || '正在读取真实数据…') + '</div>';
}
function emptyHtml(title, text) {
  return '<div class="empty"><b>' + esc(title || '这里还没有内容') + '</b>' + esc(text || '换个筛选条件，或者先创建第一条数据。') + '</div>';
}

function toast(msg, type) {
  let wrap = $('#toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toasts';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; }, 2200);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2700);
}
App.toast = toast;

/* ---------------- 鉴权 ---------------- */
function authIface() { return (UX.auth && UX.auth.iface) || null; }

function loadSession() {
  state.token = storeGet('cbs-app:' + (CASE.code || 'case') + ':token', '') || '';
  state.user = storeGet('cbs-app:' + (CASE.code || 'case') + ':user', null);
}
function saveSession() {
  storeSet('cbs-app:' + (CASE.code || 'case') + ':token', state.token || '');
  storeSet('cbs-app:' + (CASE.code || 'case') + ':user', state.user || null);
}
function clearSession() {
  state.token = '';
  state.user = null;
  saveSession();
}

async function refreshMe() {
  if (!state.token || !UX.auth || !UX.auth.me) return;
  try {
    const d = await api(authIface(), UX.auth.me);
    const u = itemOf(d);
    if (u && (u.only_id || u.nickname || u.display_name)) {
      state.user = Object.assign({}, state.user || {}, {
        onlyId: u.only_id || (state.user && state.user.onlyId) || '',
        name: u.display_name || u.nickname || (state.user && state.user.name) || '',
        nickname: u.nickname || '',
        avatar: u.avatar || '',
        bio: u.bio || '',
        region: u.region || '',
      });
      saveSession();
    }
  } catch (e) { /* token 过期时保留界面，操作时再提示 */ }
}

function authBody(register) {
  const i = authIface();
  const path = register ? UX.auth.register : UX.auth.login;
  const r = routeOf(i, path, 'POST');
  const body = (r && r.body && r.body.length) ? r.body.slice() : (register ? ['username', 'password', 'display_name'] : ['username', 'password']);
  return body;
}

function openAuth(register) {
  if (state.token) {
    App.confirm('退出当前账号？').then((ok) => {
      if (!ok) return;
      clearSession();
      renderChrome();
      App.render();
      toast('已退出登录');
    });
    return;
  }
  if (!UX.auth) { toast('这个案例不需要登录'); return; }
  const isReg = !!register;
  const fields = authBody(isReg);
  const body = fields.map((name) => {
    const meta = fieldMeta(authIface(), name);
    if (name === 'password') return '<div class="field"><label>密码</label><input data-field="password" type="password" placeholder="至少 6 位"></div>';
    if (name === 'display_name') return '<div class="field"><label>显示名</label><input data-field="display_name" placeholder="别人看到的名字"></div>';
    if (name === 'nickname') return '<div class="field"><label>昵称</label><input data-field="nickname" placeholder="你的昵称"></div>';
    if (name === 'device') return '<input data-field="device" type="hidden" value="web-console">';
    if (name === 'username') return '<div class="field"><label>用户名</label><input data-field="username" placeholder="登录名"></div>';
    return '<div class="field"><label>' + esc(labelOf(authIface(), name)) + '</label><input data-field="' + esc(name) + '" placeholder="' + esc(meta.comment || '') + '"></div>';
  }).join('');

  App.modal({
    title: isReg ? '注册一个账号' : '登录',
    desc: isReg ? '注册成功会直接登录，所有写操作都会带上你的身份。' : '登录后才能创建、修改、收藏和查看“我的”数据。',
    body: '<div class="form">' + body + '<div class="form-note">' + (isReg ? '已经注册过？可以直接切换到登录。' : '还没有账号？先注册一个，数据会真实写进数据库。') + '</div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button>' +
      '<button class="btn primary" onclick="App.doAuth(' + (isReg ? 'true' : 'false') + ')">' + (isReg ? '注册并登录' : '登录') + '</button>',
    onMount: () => {
      const link = $('#auth-switch');
      if (link) link.onclick = () => { App.closeModal(); openAuth(!isReg); };
    },
  });
}
App.login = () => openAuth(false);
App.register = () => openAuth(true);

async function doAuth(register) {
  const box = $('#modal-body');
  if (!box) return;
  const data = {};
  $$('[data-field]', box).forEach((el) => { if (el.value) data[el.name || el.getAttribute('data-field')] = el.value; });
  $$('[data-field]', box).forEach((el) => { if (el.value) data[el.getAttribute('data-field')] = el.value; });
  if (!data.username || !data.password) { toast('用户名和密码都要填', 'err'); return; }
  if (register && !data.display_name && !data.nickname) data.display_name = data.username;
  try {
    const d = await api(authIface(), register ? UX.auth.register : UX.auth.login, { method: 'POST', body: data });
    const token = d.token || d.accessToken || d.access_token;
    if (!token) throw new Error('服务没有返回登录凭证');
    state.token = token;
    state.user = {
      onlyId: d.onlyId || d.only_id || '',
      name: d.name || d.nickname || data.display_name || data.nickname || data.username,
      nickname: d.nickname || '',
      avatar: '',
      bio: '',
      region: '',
    };
    saveSession();
    App.closeModal();
    await refreshMe();
    renderChrome();
    toast(register ? '注册成功，已登录' : '登录成功', 'ok');
    App.render();
  } catch (e) {
    toast(e.message || '登录失败', 'err');
    if (String(e.code).indexOf('USER') >= 0) toast('用户名已被占用，换一个试试', 'err');
  }
}
App.doAuth = doAuth;

function requireAuth(message) {
  if (state.token) return true;
  toast(message || '先登录一下', 'err');
  openAuth(false);
  return false;
}
App.requireAuth = requireAuth;

/* ---------------- 表单 / 弹窗 ---------------- */
function fieldInput(ifaceName, name, value) {
  const meta = fieldMeta(ifaceName, name);
  const label = labelOf(ifaceName, name);
  const hint = /(^|\s)\d+\s+\S/.test(String(meta.comment || '')) ? '' : (meta.comment || '');
  const en = enumFor(name, ifaceName);
  const full = isLongField(meta, name) || /(payload|items|answers|questions|tags|images)$/.test(name) ? ' full' : '';
  let input = '';
  if (en) {
    const opts = Object.keys(en).map((k) => '<option value="' + esc(k) + '"' + (String(value) === k ? ' selected' : '') + '>' + esc(en[k]) + '</option>').join('');
    input = '<select data-field="' + esc(name) + '"><option value="">请选择</option>' + opts + '</select>';
  } else if (isLongField(meta, name)) {
    input = '<textarea data-field="' + esc(name) + '" placeholder="' + esc(hint) + '">' + esc(value == null ? '' : value) + '</textarea>';
  } else if (name === 'password' || name === 'secret') {
    input = '<input data-field="' + esc(name) + '" type="password" value="' + esc(value == null ? '' : value) + '">';
  } else if (isDateField(meta, name)) {
    const v = String(value || '').replace(' ', 'T').slice(0, 16);
    input = '<input data-field="' + esc(name) + '" type="datetime-local" value="' + esc(v) + '">';
  } else if (isNumberField(meta, name)) {
    input = '<input data-field="' + esc(name) + '" type="number" step="any" value="' + esc(value == null ? '' : value) + '" placeholder="' + esc(hint) + '">';
  } else {
    input = '<input data-field="' + esc(name) + '" value="' + esc(value == null ? '' : value) + '" placeholder="' + esc(hint) + '">';
  }
  return '<div class="field' + full + '"><label>' + esc(label) + '</label>' + input + '</div>';
}

function formHTML(ifaceName, path, values, fieldsOverride) {
  const r = routeOf(ifaceName, path, 'POST') || routeOf(ifaceName, path, 'PUT') || routeOf(ifaceName, path);
  let names = fieldsOverride && fieldsOverride.length ? fieldsOverride.slice() : ((r && r.body) || []).slice();
  const block = ['id', 'created_at', 'updated_at', 'password_hash', 'only_id', 'user_only_id', 'owner_only_id'];
  const sensitive = (n) => /(password|secret|token|hash|only_id|api_key|private_key|cover_key|file_key|avatar|(^|_)key)$/.test(n);
  const i = ifaceOf(ifaceName);
  const ti = (i && i.tables && (i.tables.find((t) => t.key === (r && r.table)) || i.tables[0])) || {};
  const tableFields = ti.fields || [];
  names = names.filter((n) => block.indexOf(n) < 0 && !sensitive(n));
  const authPath = /(login|register|logout)/.test(path || '');
  if (!authPath) {
    const extra = tableFields.filter((f) => !f.pk && f.hidden && f.writable !== false && block.indexOf(f.name) < 0 && !sensitive(f.name) && names.indexOf(f.name) < 0).map((f) => f.name);
    names = names.concat(extra);
  }
  if (!names.length) {
    if (i && i.tables && i.tables[0]) {
      names = tableFields.filter((f) => !f.pk && f.writable !== false && block.indexOf(f.name) < 0 && !sensitive(f.name)).map((f) => f.name);
    }
  }
  return '<div class="form">' + names.map((n) => fieldInput(ifaceName, n, values ? values[n] : '')).join('') +
    '<div class="form-note">提交后会直接写入真实数据表，并刷新当前页面。</div></div>';
}
App.formHTML = formHTML;

function readForm(root) {
  const out = {};
  $$('[data-field]', root || document).forEach((el) => {
    const name = el.getAttribute('data-field');
    let v = el.value;
    if (v === '' || v == null) return;
    if (el.type === 'number') v = Number(v);
    out[name] = v;
  });
  return out;
}
App.readForm = readForm;

function closeModal() {
  const m = $('#modal-mask');
  if (m) { m.classList.remove('open'); m.innerHTML = ''; }
}
App.closeModal = closeModal;

function modal(opts) {
  let m = $('#modal-mask');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-mask';
    m.className = 'modal-mask';
    m.onclick = (e) => { if (e.target === m) closeModal(); };
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="modal" style="width:min(' + (opts.width || 560) + 'px,100%)">' +
    '<div class="modal-head"><div><h3>' + esc(opts.title || '') + '</h3>' +
    (opts.desc ? '<p>' + esc(opts.desc) + '</p>' : '') + '</div>' +
    '<button class="close" onclick="App.closeModal()">×</button></div>' +
    '<div class="modal-body" id="modal-body">' + (opts.body || '') + '</div>' +
    (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '') + '</div>';
  m.classList.add('open');
  if (opts.onMount) opts.onMount(m);
}
App.modal = modal;

function confirmBox(message) {
  return new Promise((resolve) => {
    modal({
      title: '请确认',
      desc: message,
      body: '',
      foot: '<button class="btn" onclick="App._confirm(false)">取消</button><button class="btn primary" onclick="App._confirm(true)">确认</button>',
    });
    App._confirm = (v) => { closeModal(); resolve(v); };
  });
}
App.confirm = confirmBox;

function openForm(opts) {
  modal({
    title: opts.title,
    desc: opts.desc || '填写后提交，数据会写入真实业务表。',
    width: 620,
    body: '<div id="form-root">' + formHTML(opts.iface, opts.path, opts.values, opts.fields) + '</div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button>' +
      '<button class="btn primary" onclick="App.submitModal()">' + esc(opts.submitLabel || '保存') + '</button>',
    onMount: () => { App._pendingSubmit = opts.onSubmit; },
  });
}
App.openForm = openForm;

async function submitModal() {
  const root = $('#form-root');
  const fn = App._pendingSubmit;
  if (!root || !fn) return;
  const data = readForm(root);
  try {
    await fn(data);
    closeModal();
  } catch (e) {
    toast(e.message || '提交失败', 'err');
  }
}
App.submitModal = submitModal;

/* ---------------- 通用渲染 ---------------- */
function renderChrome() {
  document.body.className = 'mode-' + (UX.mode || 'content');
  const mark = UX.mark || (CASE.code || 'CASE');
  const name = state.user && state.user.name ? state.user.name : '';
  const authHtml = state.token
    ? '<button class="user-chip" onclick="App.login()">' + avatar(name || '我') + '<b>' + esc(short(name || '已登录', 10)) + '</b></button>'
    : (UX.auth ? '<button class="btn" onclick="App.login()">登录</button><button class="btn primary" onclick="App.register()">注册</button>' : '');
  const nav = (UX.nav || []).map((n) =>
    '<button data-nav="' + esc(n.view) + '" class="' + (state.view === n.view ? 'on' : '') + '" onclick="App.go(' + JSON.stringify(n.view) + ')">' + esc(n.label) + '</button>'
  ).join('');
  $('#topbar').innerHTML = '<div class="topbar-in">' +
    '<a class="brand" href="javascript:void(0)" onclick="App.go(\'home\')">' +
      '<span class="brand-mark">' + esc(mark.slice(0, 2)) + '</span>' +
      '<span class="brand-text"><b>' + esc(UX.brand || CASE.name) + '</b><span>' + esc(UX.kicker || '') + '</span></span>' +
    '</a>' +
    '<div class="nav">' + nav + '</div>' +
    '<div class="top-actions">' +
      '<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>' +
      '<input id="global-search" placeholder="搜索…" onkeydown="if(event.key===\'Enter\')App.search(this.value)"></label>' +
      authHtml +
    '</div></div>';
  const cartCount = cart().reduce((n, x) => n + Number(x.qty || 0), 0);
  if (UX.mode === 'commerce' && UX.kind !== 'pos') {
    const cartBtn = $('#cart-btn');
    if (cartBtn) cartBtn.textContent = '购物车' + (cartCount ? ' · ' + cartCount : '');
  }
}
App.renderChrome = renderChrome;

function go(view, params) {
  state.view = view;
  state.params = params || {};
  renderChrome();
  App.render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
App.go = go;

function goBack(view) {
  go(view || (UX.mode === 'content' ? 'home' : 'collection'));
}
App.goBack = goBack;

function search(keyword) {
  state.params = state.params || {};
  state.params.keyword = keyword || '';
  if (state.view !== 'collection') state.view = 'collection';
  renderChrome();
  App.render();
}
App.search = search;
function searchValue() { return (state.params && state.params.keyword) || ''; }

function rowsOfIface(name) { return rowsOf(state.rows[name]); }

function tableHTML(ifaceName, rows, columns, opts) {
  opts = opts || {};
  if (!rows || !rows.length) return emptyHtml(opts.emptyTitle || '还没有记录', opts.emptyText || '先新建一条，或者换个关键词搜索。');
  const cols = columns && columns.length ? columns : Object.keys(rows[0]).filter((k) => !/^(id|only_id|user_only_id|owner_only_id|password_hash)$/.test(k)).slice(0, 6);
  const head = cols.map((c) => '<th>' + esc(labelOf(ifaceName, c)) + '</th>').join('');
  const body = rows.map((row, idx) => {
    const tds = cols.map((c, i) => '<td>' + (i === 0 ? '<span class="strong">' : '') + fieldValue(ifaceName, c, row) + (i === 0 ? '</span>' : '') + '</td>').join('');
    return '<tr onclick="App.openRow(' + JSON.stringify(ifaceName) + ',' + idx + ')">' + tds +
      (opts.actions ? '<td><div class="row-actions">' + opts.actions(row, idx) + '</div></td>' : '') + '</tr>';
  }).join('');
  return '<div class="table-wrap"><table><thead><tr>' + head + (opts.actions ? '<th style="text-align:right">操作</th>' : '') +
    '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
App.tableHTML = tableHTML;

function openRow(ifaceName, idx) {
  const row = (state.rows[ifaceName] || [])[idx];
  if (row) App.openDetail(ifaceName, row);
}
App.openRow = openRow;

/* 各模式会覆盖这个方法；默认弹字段详情。 */
App.openDetail = function (ifaceName, row) {
  const fields = Object.keys(row).filter((k) => !/^(id|password_hash|only_id)$/.test(k)).slice(0, 12);
  modal({
    title: row.title || row.name || row.job_name || row.order_no || '记录详情',
    body: '<div class="detail-grid">' + fields.map((f) =>
      '<div><label>' + esc(labelOf(ifaceName, f)) + '</label><b>' + fieldValue(ifaceName, f, row) + '</b></div>').join('') + '</div>',
    foot: '<button class="btn" onclick="App.closeModal()">关闭</button>',
  });
};

/* 通用新建器：params 里的 create 配置。 */
function createRecord(cfg) {
  if (!cfg) return;
  if (!requireAuth()) return;
  openForm({
    title: cfg.title || '新建' + (cfg.label || '记录'),
    iface: cfg.iface,
    path: cfg.create,
    values: cfg.values || {},
    submitLabel: '创建',
    onSubmit: async (data) => {
      await api(cfg.iface, cfg.create, { method: 'POST', body: data });
      toast('已创建', 'ok');
      await App.render();
    },
  });
}
App.createRecord = createRecord;

function pageFoot() {
  return '<div class="foot"><span>' + esc(UX.brand) + ' · ' + esc(UX.kicker || '') + '</span>' +
    '<span>真实业务页面 · 数据来自 ClickBuild 生成服务</span></div>';
}

function pageTitle(title, sub) {
  return '<div class="section-head" style="margin-bottom:24px"><div><div class="eyebrow">' + esc(UX.kicker) + '</div>' +
    '<h2 style="font-size:30px;margin-top:8px">' + esc(title) + '</h2>' +
    (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div></div>';
}

function toolbar(extra) {
  return '<div class="toolbar"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>' +
    '<input value="' + esc(searchValue()) + '" placeholder="搜索…" onkeydown="if(event.key===\'Enter\')App.search(this.value)"></label>' +
    (extra || '') + '<span class="spacer"></span></div>';
}

// ---- 01-content.js ----
/* 内容站模式：博客 / 小说 / 音乐 / 视频。真实写作、发布、阅读、评论、收藏。 */
function contentRows() { return state.rows[UX.primary.iface] || []; }

async function loadContentRows(force) {
  if (!force && state.rows[UX.primary.iface]) return contentRows();
  const d = await api(UX.primary.iface, UX.primary.list);
  const rows = rowsOf(d);
  state.rows[UX.primary.iface] = rows;
  return rows;
}

async function loadCategories() {
  if (!UX.category) return [];
  if (state.rows[UX.category.iface]) return state.rows[UX.category.iface];
  try {
    const d = await api(UX.category.iface, UX.category.list);
    state.rows[UX.category.iface] = rowsOf(d);
  } catch (e) { state.rows[UX.category.iface] = []; }
  return state.rows[UX.category.iface];
}

function categoryName(list, id) {
  const c = (list || []).find((x) => String(x.id) === String(id));
  return c ? (c.name || c.title || '') : '';
}

function contentVisible(rows) {
  const statusKey = UX.fields.status;
  const hasPublished = rows.some((r) => String(r[statusKey]) === '1');
  let out = hasPublished ? rows.filter((r) => String(r[statusKey]) === '1') : rows.slice();
  const kw = searchValue().toLowerCase();
  if (kw) out = out.filter((r) => JSON.stringify(r).toLowerCase().indexOf(kw) >= 0);
  if (state.params.category) out = out.filter((r) => String(r[UX.fields.category]) === String(state.params.category));
  return out.sort((a, b) => String(b[UX.fields.date] || b.published_at || b.id).localeCompare(String(a[UX.fields.date] || a.published_at || a.id)));
}

function contentCard(row, catList) {
  const title = row[UX.fields.title] || '未命名';
  const date = row[UX.fields.date] || row.published_at || row.created_at;
  const views = row[UX.fields.views] || 0;
  const cat = categoryName(catList, row[UX.fields.category]) || (row.paper || '');
  const unit = UX.media ? ' 次播放' : ' 次阅读';
  return '<article class="card" onclick="App.openContentItem(' + JSON.stringify(row.id) + ')">' +
    '<div class="card-cover">' + coverHtml(row, { label: cat || UX.itemLabel }) + '</div>' +
    '<div class="card-body"><div class="card-kicker"><span>' + esc(cat || UX.kicker) + '</span><span>' + esc(fmtDate(date)) + '</span></div>' +
    '<h3>' + esc(title) + '</h3><p>' + esc(plain(row[UX.fields.body], 120) || '打开查看详情。') + '</p>' +
    '<div class="card-foot"><span>' + esc(views) + unit + '</span><span>' + esc(UX.itemLabel) + ' →</span></div></div></article>';
}

async function contentHome() {
  setMain(loadingHtml());
  try {
    const rows = await loadContentRows(true);
    const cats = await loadCategories();
    const list = contentVisible(rows);
    const featured = list[0];
    const rest = (list.length === 1 ? list : list.slice(1, 10));
    const top = rows.slice().sort((a, b) => Number(b[UX.fields.views] || 0) - Number(a[UX.fields.views] || 0)).slice(0, 5);
    const hero = '<section class="hero"><div class="hero-card">' +
      '<div class="eyebrow">' + esc(UX.home.kicker) + '</div><h1>' + esc(UX.home.title) + '</h1>' +
      '<p>' + esc(UX.home.sub) + '</p><div class="hero-actions">' +
      '<button class="btn" onclick="App.go(\'collection\')">' + esc(UX.home.cta) + '</button>' +
      (UX.auth ? '<button class="btn ghost" onclick="App.go(\'admin\')">' + esc(UX.writeLabel) + '</button>' : '') +
      '</div></div>' +
      '<div class="hero-art"><div class="hero-art-head"><span>本期焦点</span><span>' + esc(UX.brand) + '</span></div>' +
      (featured ? '<div class="hero-feature"><span class="big">' + esc(String(featured[UX.fields.views] || 0)) + '</span>' +
        '<b>' + esc(featured[UX.fields.title]) + '</b><span>' + esc(categoryName(cats, featured[UX.fields.category]) || UX.itemLabel) + ' · ' + esc(fmtDate(featured[UX.fields.date])) + '</span></div>' : '<div class="hero-feature"><b>还没有内容</b><span>注册后发布第一篇。</span></div>') +
      '<div class="hero-list">' + top.slice(0, 4).map((r, i) => '<div onclick="App.openContentItem(' + JSON.stringify(r.id) + ')" style="cursor:pointer"><span>' + String(i + 1).padStart(2, '0') + ' · ' + esc(short(r[UX.fields.title], 22)) + '</span><em>' + esc(r[UX.fields.views] || 0) + '</em></div>').join('') + '</div>' +
      '</div></section>';
    const chips = '<div class="chips"><button class="chip ' + (!state.params.category ? 'on' : '') + '" onclick="App.go(\'collection\')">全部</button>' +
      cats.map((c) => '<button class="chip ' + (String(state.params.category) === String(c.id) ? 'on' : '') + '" onclick="App.filterCategory(' + JSON.stringify(c.id) + ')">' + esc(c.name) + '</button>').join('') + '</div>';
    const section = '<section class="section"><div class="section-head"><div><h2>最新' + esc(UX.itemLabel) + '</h2><p>' + esc(list.length) + ' 条真实内容，按发布时间排序</p></div>' + chips + '</div>' +
      (rest.length ? '<div class="grid">' + rest.map((r) => contentCard(r, cats)).join('') + '</div>' : emptyHtml('还没有公开的' + UX.itemLabel, '到后台' + (UX.media ? '上传' : '写') + '一篇，发布后会出现在这里。')) + '</section>';
    setMain('<div class="page">' + hero + section + pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page">' + emptyHtml('读取失败', e.message) + pageFoot() + '</div>');
  }
}

async function contentCollection() {
  setMain(loadingHtml());
  try {
    const rows = await loadContentRows();
    const cats = await loadCategories();
    const list = contentVisible(rows);
    setMain('<div class="page">' + pageTitle('全部' + UX.itemLabel, '共 ' + list.length + ' 条，点击任意一张进入真实详情页。') +
      toolbar('') +
      '<div class="chips" style="margin-bottom:20px"><button class="chip ' + (!state.params.category ? 'on' : '') + '" onclick="App.go(\'collection\')">全部</button>' +
      cats.map((c) => '<button class="chip ' + (String(state.params.category) === String(c.id) ? 'on' : '') + '" onclick="App.filterCategory(' + JSON.stringify(c.id) + ')">' + esc(c.name) + '</button>').join('') + '</div>' +
      (list.length ? '<div class="grid">' + list.map((r) => contentCard(r, cats)).join('') + '</div>' : emptyHtml('没有找到匹配的' + UX.itemLabel, '换一个关键词或分类试试。')) +
      pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>');
  }
}

App.filterCategory = (id) => {
  state.params.category = id;
  App.render();
};

App.openContentItem = (id) => {
  state.params = { id };
  state.view = 'item';
  renderChrome();
  if (UX.primary.read) api(UX.primary.iface, UX.primary.read, { params: { id } }).catch(() => null);
  App.render();
};

function richBody(text) {
  const src = String(text || '').trim();
  if (!src) return '<p class="muted">作者还没有填正文。</p>';
  const blocks = src.split(/\n{2,}/);
  return blocks.map((b) => {
    const t = b.trim();
    if (!t) return '';
    if (/^#{1,3}\s+/.test(t)) return '<h2>' + esc(t.replace(/^#{1,3}\s+/, '')) + '</h2>';
    if (/^[-*]\s+/m.test(t)) {
      return '<ul>' + t.split('\n').filter((x) => /^[-*]\s+/.test(x.trim())).map((x) => '<li>' + esc(x.replace(/^[-*]\s+/, '')) + '</li>').join('') + '</ul>';
    }
    return '<p>' + esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

async function loadComments(row) {
  const c = UX.comments;
  if (!c) return [];
  try {
    let path = c.list;
    let query = null;
    if (path.indexOf(':id') >= 0) path = path.replace(':id', row.id);
    else query = { [c.foreign]: row.id };
    const d = await api(c.iface, path, { query });
    return rowsOf(d);
  } catch (e) { return []; }
}

function mediaUrl(row) {
  if (!row) return '';
  const raw = row.file_url || row.file_key || '';
  if (!raw) return '';
  if (/^https?:|^\//.test(raw)) return raw;
  return '/uploads/' + raw.replace(/^uploads\//, '');
}

function mediaBlock(row) {
  if (!UX.media) return '';
  const url = mediaUrl(row);
  if (!url) {
    return '<div class="empty" style="padding:22px;margin:18px 0">' +
      (state.token ? '还没有上传' + (UX.media === 'audio' ? '音频' : '视频') + '。<button class="btn sm primary" style="margin-left:8px" onclick="App.uploadMedia(' + JSON.stringify(row.id) + ')">上传文件</button>' : '作者还没有上传' + (UX.media === 'audio' ? '音频' : '视频') + '。') + '</div>';
  }
  const playHandler = UX.primary.play ? ' onplay="App.mediaPlay(' + JSON.stringify(row.id) + ')"' : '';
  return '<div class="media-box" style="margin:18px 0;background:#0d0d0d;border-radius:14px;overflow:hidden">' +
    (UX.media === 'audio'
      ? '<div style="padding:18px 20px;color:#eee;font-size:13px">' + esc(row.title || '') + '</div><audio controls preload="metadata" src="' + esc(url) + '" style="width:100%;padding:0 14px 14px"' + playHandler + '></audio>'
      : '<video controls preload="metadata" src="' + esc(url) + '" style="width:100%;display:block;max-height:62vh;background:#000"' + playHandler + '></video>') +
    '</div>';
}

App.mediaPlay = (id) => {
  if (!UX.primary.play || state.played[String(id)]) return;
  state.played[String(id)] = true;
  api(UX.primary.iface, UX.primary.play, { params: { id } }).then(() => {
    const row = (state.rows[UX.primary.iface] || []).find((x) => String(x.id) === String(id));
    if (row) row[UX.fields.views] = Number(row[UX.fields.views] || 0) + 1;
    const meta = document.querySelector('.article-meta [data-views]');
    if (meta) meta.textContent = String((parseInt(meta.textContent, 10) || 0) + 1) + (UX.media ? ' 次播放' : ' 次阅读');
  }).catch(() => { state.played[String(id)] = false; });
};

App.uploadMedia = (id) => {
  if (!requireAuth('登录后才能上传')) return;
  if (!UX.primary.upload) { toast('这个案例还没有配置上传接口', 'err'); return; }
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = UX.media === 'audio' ? 'audio/*' : 'video/*';
  picker.onchange = async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    toast('正在上传 ' + file.name + '…', 'ok');
    const fd = new FormData();
    fd.append('file', file, file.name);
    try {
      const res = await fetch(apiUrl(UX.primary.iface, UX.primary.upload, { id }), {
        method: 'POST',
        headers: state.token ? { authorization: 'Bearer ' + state.token } : {},
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.message || json.error || ('上传失败 ' + res.status));
      toast('上传完成', 'ok');
      await App.render();
    } catch (e) { toast(e.message, 'err'); }
  };
  picker.click();
};

function durationText(value) {
  const sec = Number(value || 0);
  if (!sec) return '';
  return sec < 60 ? Math.round(sec) + ' 秒' : Math.round(sec / 60) + ' 分钟';
}

async function contentItem() {
  const id = state.params.id;
  const p = UX.primary;
  setMain(loadingHtml('正在打开' + UX.itemLabel + '…'));
  try {
    const d = await api(p.iface, p.detail, { params: { id } });
    const row = itemOf(d);
    if (!row || !row.id) throw new Error('内容不存在');
    if (p.read) api(p.iface, p.read, { params: { id } }).catch(() => {});
    const comments = await loadComments(row);
    const cats = await loadCategories();
    const cat = categoryName(cats, row[UX.fields.category]);
    let faved = false;
    if (UX.favorites && state.token) {
      try {
        const f = rowsOf(await api(UX.favorites.iface, UX.favorites.list));
        faved = f.some((x) => String(x[UX.favorites.foreign] || x.id) === String(row.id));
      } catch (e) { /* 忽略 */ }
    }
    const actions = [];
    if (UX.favorites) {
      actions.push('<button class="btn ' + (faved ? 'dark' : '') + '" onclick="App.toggleFavorite(' + JSON.stringify(row.id) + ')">' + (faved ? '已收藏' : '收藏') + '</button>');
    }
    if (state.token && UX.auth) {
      actions.push('<button class="btn" onclick="App.editContent(' + JSON.stringify(row.id) + ')">编辑</button>');
      if (p.publish) actions.push('<button class="btn" onclick="App.publishContent(' + JSON.stringify(row.id) + ')">发布</button>');
    }
    const commentHtml = UX.comments ? (
      '<section class="comments"><h3>讨论 · ' + comments.length + '</h3>' +
      (comments.length ? comments.map((c) => '<div class="comment">' + avatar(c[UX.comments.author] || c.author || '读') +
        '<div class="comment-main"><b>' + esc(c[UX.comments.author] || c.author || '读者') + '</b><time>' + esc(fmtDate(c.created_at, true)) + '</time>' +
        '<p>' + esc(c.content) + '</p></div></div>').join('') : '<div class="empty" style="padding:30px">还没有评论，来说第一句。</div>') +
      (state.token
        ? '<div class="comment-form"><textarea id="comment-text" placeholder="写下你的想法…"></textarea><button class="btn primary" onclick="App.submitComment(' + JSON.stringify(row.id) + ')">发表评论</button></div>'
        : '<div class="empty" style="padding:24px">登录后参与讨论。<button class="btn sm primary" style="margin-left:8px" onclick="App.login()">登录</button></div>') +
      '</section>'
    ) : '';
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回' + esc(UX.itemLabel) + '</button>' +
      '<span class="pill">' + esc(cat || UX.itemLabel) + '</span></div>' +
      '<article class="article"><div class="eyebrow">' + esc(UX.kicker) + ' · ' + esc(cat || UX.itemLabel) + '</div>' +
      '<h1>' + esc(row[UX.fields.title] || '未命名') + '</h1>' +
      '<div class="article-meta"><span>' + esc(fmtDate(row[UX.fields.date] || row.created_at, true)) + '</span><span data-views>' + esc(row[UX.fields.views] || 0) + (UX.media ? ' 次播放' : ' 次阅读') + '</span>' +
      (row[UX.fields.duration] ? '<span>' + esc(durationText(row[UX.fields.duration])) + '</span>' : '') + '</div>' +
      '<div class="article-cover">' + coverHtml(row, { label: cat || '' }) + '</div>' +
      mediaBlock(row) +
      ((UX.media && !(row.description || row.intro)) ? '' : '<div class="article-body">' + richBody(UX.media ? (row.description || row.intro) : row[UX.fields.body]) + '</div>') +
      '<div class="article-actions">' + actions.join('') + '<button class="btn" onclick="App.goBack(\'collection\')">继续浏览</button></div>' +
      commentHtml + '</article>' + pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page narrow">' + emptyHtml('打不开这个' + UX.itemLabel, e.message) + pageFoot() + '</div>');
  }
}

App.submitComment = async (id) => {
  if (!requireAuth('登录后才能评论')) return;
  const box = $('#comment-text');
  const text = box ? box.value.trim() : '';
  if (!text) { toast('评论不能为空', 'err'); return; }
  const c = UX.comments;
  const body = { content: text };
  body[c.foreign] = id;
  if (c.author === 'author') body.author = (state.user && state.user.name) || '读者';
  else {
    body[c.author] = state.user && state.user.onlyId;
    if (!body[c.author]) { toast('缺少用户身份，请重新登录', 'err'); return; }
  }
  if (c.create === '/comments') body.status = 1;
  try {
    await api(c.iface, c.create, { method: 'POST', body });
    toast('评论已发表', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.toggleFavorite = async (id) => {
  if (!requireAuth('登录后才能收藏')) return;
  try {
    await api(UX.favorites.iface, UX.favorites.toggle, { method: 'POST', body: { [UX.favorites.foreign]: id } });
    toast('收藏状态已更新', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.openRecord = (iface, row) => App.openDetail(iface, row);

App.publishContent = async (id) => {
  const p = UX.primary;
  try {
    await api(p.iface, p.publish, { method: 'POST', params: { id }, body: {} });
    toast('已发布', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.editContent = (id) => {
  const row = (state.rows[UX.primary.iface] || []).find((x) => String(x.id) === String(id));
  if (!row) { toast('请先刷新列表', 'err'); return; }
  openForm({
    title: '编辑' + UX.itemLabel,
    iface: UX.primary.iface,
    path: UX.primary.update,
    fields: contentWriteFields(),
    values: row,
    submitLabel: '保存修改',
    onSubmit: async (data) => {
      await api(UX.primary.iface, UX.primary.update, { method: 'PUT', params: { id }, body: data });
      toast('已保存', 'ok');
      await App.render();
    },
  });
};

function contentWriteFields() {
  return UX.fieldKeys || (UX.media ? ['title', 'category_id', 'duration', 'status'] : ['title', 'slug', 'category_id', 'content', 'status']);
}

async function contentAdmin() {
  const tab = state.params.tab || 'primary';
  setMain(loadingHtml());
  try {
    const cats = await loadCategories();
    const primaryRows = await loadContentRows(true);
    let commentRows = [];
    if (tab === 'comments' && UX.comments) {
      try { commentRows = rowsOf(await api(UX.comments.iface, UX.comments.list.replace(':id', ''))); } catch (e) { commentRows = []; }
    }
    const tabs = [
      { id: 'primary', label: UX.itemLabel },
      { id: 'categories', label: UX.category ? '分类' : '—' },
      { id: 'comments', label: '评论' },
    ].filter((x) => x.label !== '—');
    const tabsHtml = '<div class="chips" style="margin-bottom:18px">' + tabs.map((t) =>
      '<button class="chip ' + (tab === t.id ? 'on' : '') + '" onclick="App.adminTab(' + JSON.stringify(t.id) + ')">' + esc(t.label) + '</button>').join('') + '</div>';
    let body = '';
    if (tab === 'primary') {
      body = '<div class="toolbar"><button class="btn primary" onclick="App.newContent()">+ ' + esc(UX.writeLabel) + '</button><span class="spacer"></span>' +
        '<span class="faint">共 ' + primaryRows.length + ' 条</span></div>' +
        tableHTML(UX.primary.iface, primaryRows, ['title', 'status', 'views', 'created_at'], {
          emptyTitle: '还没有' + UX.itemLabel,
          actions: (row) => '<button class="btn sm" onclick="event.stopPropagation();App.editContent(' + JSON.stringify(row.id) + ')">编辑</button>' +
            (UX.media ? '<button class="btn sm primary" onclick="event.stopPropagation();App.uploadMedia(' + JSON.stringify(row.id) + ')">上传文件</button>' : '') +
            (UX.primary.publish ? '<button class="btn sm" onclick="event.stopPropagation();App.publishContent(' + JSON.stringify(row.id) + ')">发布</button>' : '') +
            '<button class="btn sm danger" onclick="event.stopPropagation();App.deleteContent(' + JSON.stringify(row.id) + ')">删除</button>',
        });
    } else if (tab === 'categories') {
      body = '<div class="toolbar"><button class="btn primary" onclick="App.newCategory()">+ 新建分类</button><span class="spacer"></span><span class="faint">共 ' + cats.length + ' 个分类</span></div>' +
        tableHTML(UX.category.iface, cats, ['name', 'slug', 'sort'], {
          emptyTitle: '还没有分类',
          actions: (row) => '<button class="btn sm danger" onclick="event.stopPropagation();App.deleteCategory(' + JSON.stringify(row.id) + ')">删除</button>',
        });
    } else {
      body = tableHTML(UX.comments.iface, commentRows, ['author', 'content', 'status', 'created_at'], {
        emptyTitle: '还没有评论',
        actions: (row) => '<button class="btn sm danger" onclick="event.stopPropagation();App.deleteComment(' + JSON.stringify(row.id) + ')">删除</button>',
      });
    }
    setMain('<div class="page">' + pageTitle('内容后台', '在这里写、改、发布，也可以管理分类和评论。') + tabsHtml + body + pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page">' + emptyHtml('后台读取失败', e.message) + '</div>');
  }
}

App.adminTab = (tab) => { state.params.tab = tab; App.render(); };

App.newContent = () => {
  if (!requireAuth()) return;
  const p = UX.primary;
  openForm({
    title: UX.writeLabel,
    desc: '标题和正文是必填项；保存后可以再点“发布”。',
    iface: p.iface,
    path: p.create,
    fields: contentWriteFields(),
    submitLabel: '保存草稿',
    onSubmit: async (data) => {
      if (!data[UX.fields.title]) throw new Error('标题不能为空');
      const created = await api(p.iface, p.create, { method: 'POST', body: data });
      toast('已保存，可在列表里继续编辑或发布', 'ok');
      await App.render();
      if (UX.media && created && created.id) App.uploadMedia(created.id);
    },
  });
};

App.newCategory = () => {
  if (!requireAuth()) return;
  openForm({
    title: '新建分类', iface: UX.category.iface, path: UX.category.create, submitLabel: '创建',
    onSubmit: async (data) => {
      await api(UX.category.iface, UX.category.create, { method: 'POST', body: data });
      toast('分类已创建', 'ok');
      await App.render();
    },
  });
};

App.deleteContent = async (id) => {
  if (!(await confirmBox('删除这条内容？删除后不能恢复。'))) return;
  try {
    await api(UX.primary.iface, UX.primary.remove, { method: 'DELETE', params: { id } });
    toast('已删除', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.deleteCategory = async (id) => {
  if (!(await confirmBox('删除这个分类？'))) return;
  try {
    await api(UX.category.iface, UX.category.remove, { method: 'DELETE', params: { id } });
    toast('已删除', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.deleteComment = async (id) => {
  if (!(await confirmBox('删除这条评论？'))) return;
  try {
    await api(UX.comments.iface, UX.comments.remove, { method: 'DELETE', params: { id } });
    toast('已删除', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

async function contentMy() {
  if (!UX.favorites) { App.go('admin'); return; }
  if (!state.token) { setMain('<div class="page">' + emptyHtml('登录后查看收藏', '收藏数据按账号保存。') + '<div style="text-align:center"><button class="btn primary" onclick="App.login()">登录</button></div></div>'); return; }
  setMain(loadingHtml());
  try {
    const rows = rowsOf(await api(UX.favorites.iface, UX.favorites.list));
    setMain('<div class="page">' + pageTitle('我的收藏', '共 ' + rows.length + ' 条，收藏关系存在真实数据表里。') +
      (rows.length ? '<div class="grid">' + rows.map((r) => {
        const title = r.title || r.name || '未命名';
        return '<div class="card" onclick="App.openContentItem(' + JSON.stringify(r[UX.favorites.foreign] || r.id) + ')"><div class="card-cover">' + coverHtml(r) + '</div><div class="card-body"><h3>' + esc(title) + '</h3><div class="card-foot"><span>已收藏</span><span>' + esc(UX.itemLabel) + ' →</span></div></div></div>';
      }).join('') + '</div>' : emptyHtml('还没有收藏', '点开一首歌或一个视频，点“收藏”就会出现在这里。')) + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

MODES.content = {
  home: contentHome,
  collection: contentCollection,
  item: contentItem,
  admin: contentAdmin,
  my: contentMy,
};

// ---- 02-commerce.js ----
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
  return '<article class="card" onclick="App.openCommerceItem(' + JSON.stringify(row.id) + ')">' +
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
      '<div class="chips">' + cats.map((c) => '<button class="chip ' + (state.params.category === c ? 'on' : '') + '" onclick="App.filterValue(\'category\',' + JSON.stringify(c) + ')">' + esc(c) + '</button>').join('') + '</div></div>' +
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
      tables.map((t) => '<button class="chip ' + (String(tableId) === String(t.id) ? 'on' : '') + '" onclick="App.selectTable(' + JSON.stringify(t.id) + ')">' +
        esc(t.table_no) + ' · ' + (Number(t.status) === 1 ? '用餐中' : '空闲') + ' · ' + esc(t.seats) + '座</button>').join('') + '</div>' +
      (table ? '<p class="faint" style="margin:14px 0 0">当前：' + esc(table.table_no) + '（' + esc(table.seats) + ' 座）</p>' : '<p class="faint" style="margin:14px 0 0">还没有选桌台</p>') + '</div>';
    const dishesHtml = '<div class="panel"><div class="panel-head"><h3>菜单</h3><span class="faint">' + dishes.length + ' 道菜</span></div><div class="grid four">' +
      dishes.map((d) => '<article class="card"><div class="card-body"><div class="card-kicker"><span>' + esc(d.category || '热菜') + '</span><span>库存 ' + esc(d.stock) + '</span></div><h3>' + esc(d.name) + '</h3>' +
        '<div class="card-foot"><span class="price">' + fmtMoney(d.price) + '</span><button class="btn sm primary" onclick="App.posAdd(' + JSON.stringify(d.id) + ')">加入</button></div></div></article>').join('') + '</div></div>';
    const orderHtml = '<div class="panel"><div class="panel-head"><h3>当前桌台订单</h3><span class="faint">' + cartList.length + ' 项</span></div>' +
      (cartList.length ? cartList.map((x) => '<div class="cart-line"><div class="thumb">' + esc(String(x.name || '菜').slice(0, 1)) + '</div><div class="info"><b>' + esc(x.name) + '</b><span>' + fmtMoney(x.price) + ' × ' + x.qty + '</span></div>' +
        '<div class="qty"><button onclick="App.setCartQty(' + JSON.stringify(x.id) + ',-1)">−</button><em>' + x.qty + '</em><button onclick="App.setCartQty(' + JSON.stringify(x.id) + ',1)">+</button></div></div>').join('') : '<div class="empty" style="padding:30px">还没有加菜</div>') +
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
      '<div class="qty"><button onclick="App.setCartQty(' + JSON.stringify(x.id) + ',-1)">−</button><em>' + x.qty + '</em><button onclick="App.setCartQty(' + JSON.stringify(x.id) + ',1)">+</button></div>' +
      '<button class="btn sm danger" onclick="App.removeCart(' + JSON.stringify(x.id) + ')">移除</button></div>').join('') +
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
      '<button class="btn primary" style="margin-top:16px" onclick="App.checkoutPos(' + JSON.stringify(order.id) + ')">结账并释放桌台</button></div>' + pageFoot() + '</div>');
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
          actions: (row) => Number(row.checked) ? '<span class="pill ok">已核销</span>' : '<button class="btn sm primary" onclick="event.stopPropagation();App.checkinTicket(' + JSON.stringify(row.code) + ')">核销</button>',
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
        actions: (row) => '<button class="btn sm" onclick="event.stopPropagation();App.editProduct(' + JSON.stringify(row.id) + ')">编辑</button><button class="btn sm danger" onclick="event.stopPropagation();App.deleteProduct(' + JSON.stringify(row.id) + ')">删除</button>',
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

// ---- 03-catalog.js ----
/* 目录/预约模式：到店预约、课程报名、网课学习、医院挂号。 */
function catalogRows() { return state.rows[UX.primary.iface] || []; }

function catalogCard(row) {
  const title = row.title || row.name || '未命名';
  const sub = row.teacher || row.floor || row.duration || '';
  const price = row.price != null ? fmtMoney(row.price) : (row.fee != null ? '挂号费 ' + fmtMoney(row.fee) : '');
  const meta = UX.flow === 'course' || UX.flow === 'netcourse'
    ? ('名额 ' + esc(row.enrolled || 0) + ' / ' + esc(row.seats || '不限'))
    : (UX.flow === 'hospital' ? ('楼层 ' + esc(row.floor || '—')) : ('时长 ' + esc(row.duration || '—') + ' 分钟'));
  return '<article class="card" onclick="App.openCatalogItem(' + JSON.stringify(row.id) + ')">' +
    '<div class="card-cover">' + coverHtml(row, { label: UX.itemLabel }) + '</div>' +
    '<div class="card-body"><div class="card-kicker"><span>' + esc(sub || UX.kicker) + '</span><span>' + esc(meta) + '</span></div>' +
    '<h3>' + esc(title) + '</h3><p>' + esc(plain(row.intro || row.requirement || row.name || '', 100) || '打开查看可约时间与详情。') + '</p>' +
    '<div class="card-foot"><span class="price">' + esc(price || '免费') + '</span><span>查看 →</span></div></div></article>';
}

async function catalogHome() {
  setMain(loadingHtml());
  try {
    const rows = rowsOf(await api(UX.primary.iface, UX.primary.list));
    state.rows[UX.primary.iface] = rows;
    const list = filterKeyword(rows, UX.flow === 'hospital' ? ['name', 'floor'] : ['title', 'name', 'teacher']);
    const hero = '<section class="hero"><div class="hero-card">' +
      '<div class="eyebrow">' + esc(UX.home.kicker) + '</div><h1>' + esc(UX.home.title) + '</h1><p>' + esc(UX.home.sub) + '</p>' +
      '<div class="hero-actions"><button class="btn" onclick="App.go(\'collection\')">' + esc(UX.home.cta) + '</button>' +
      (UX.auth ? '<button class="btn ghost" onclick="App.login()">登录 / 注册</button>' : '') + '</div></div>' +
      '<div class="hero-art"><div class="hero-art-head"><span>可约目录</span><span>' + esc(UX.mark) + '</span></div>' +
      (list[0] ? '<div class="hero-feature"><span class="big">' + esc(String(list.length)) + '</span><b>' + esc(list[0].title || list[0].name) + '</b><span>现在可以开始选择</span></div>' : '') +
      '<div class="hero-list">' + list.slice(0, 4).map((r) => '<div><span>' + esc(short(r.title || r.name, 20)) + '</span><em>' + esc(r.price != null ? fmtMoney(r.price) : (r.floor || '—')) + '</em></div>').join('') + '</div></div></section>';
    setMain('<div class="page">' + hero + '<section class="section"><div class="section-head"><div><h2>全部' + esc(UX.itemLabel) + '</h2><p>共 ' + list.length + ' 个可选项目</p></div></div>' +
      (list.length ? '<div class="grid">' + list.map(catalogCard).join('') + '</div>' : emptyHtml('还没有可选项', '到管理后台先建一个。')) + '</section>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

async function catalogCollection() { return catalogHome(); }

App.openCatalogItem = (id) => {
  state.params = { id };
  state.view = 'item';
  renderChrome();
  App.render();
};

async function catalogItem() {
  if (UX.flow === 'booking') return bookingItem();
  if (UX.flow === 'hospital') return hospitalItem();
  return courseItem();
}

/* ---- 到店预约 ---- */
async function bookingItem() {
  const id = state.params.id;
  setMain(loadingHtml());
  try {
    const services = await (async () => {
      if (state.rows[UX.primary.iface]) return state.rows[UX.primary.iface];
      const d = rowsOf(await api(UX.primary.iface, UX.primary.list)); state.rows[UX.primary.iface] = d; return d;
    })();
    const service = services.find((x) => String(x.id) === String(id));
    if (!service) throw new Error('服务不存在');
    const slots = rowsOf(await api(UX.slot.iface, UX.slot.list));
    state.rows[UX.slot.iface] = slots;
    const mine = slots.filter((s) => String(s.service_id) === String(id));
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回服务列表</button><span class="pill ok">' + esc(service.status == 1 ? '可预约' : '暂停预约') + '</span></div>' +
      '<div class="panel" style="padding:30px"><div class="eyebrow">' + esc(UX.kicker) + '</div><h1 style="font-size:32px;margin:10px 0 12px">' + esc(service.name) + '</h1>' +
      '<p class="muted">时长 ' + esc(service.duration) + ' 分钟 · ' + fmtMoney(service.price) + '</p>' +
      '<div class="section" style="margin-top:26px"><div class="section-head"><h2 style="font-size:17px">可约时段</h2><span class="faint">选中后提交预约，名额实时扣减</span></div>' +
      (mine.length ? mine.map((s) => {
        const left = Number(s.capacity) - Number(s.booked);
        const dayText = fmtDay(s.day);
        const timeMatch = (v) => { const m = String(v || '').match(/(\d{1,2}:\d{2})/); return m ? m[1] : String(v || ''); };
        return '<div class="cart-line"><div class="thumb">' + esc(dayText.slice(5)) + '</div><div class="info"><b>' + esc(dayText) + ' · ' + esc(timeMatch(s.start_time)) + ' - ' + esc(timeMatch(s.end_time)) + '</b><span>剩余 ' + left + ' / ' + s.capacity + ' 个名额</span></div>' +
          '<button class="btn sm primary" ' + (left <= 0 ? 'disabled' : '') + ' onclick="App.bookSlot(' + JSON.stringify(s.id) + ')">' + (left <= 0 ? '已满' : '预约') + '</button></div>';
      }).join('') : emptyHtml('这个项目还没有开放时段', '到预约管理里先放号。')) + '</div></div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('打不开预约页', e.message) + '</div>'); }
}

App.bookSlot = (slotId) => {
  const phone = storeGet('cbs-app:' + CASE.code + ':phone', '');
  modal({
    title: '填写预约信息',
    desc: '提交后会占用一个名额，取消预约会释放。',
    width: 520,
    body: '<div class="form"><div class="field"><label>姓名</label><input data-field="customer" placeholder="怎么称呼你"></div>' +
      '<div class="field"><label>电话</label><input data-field="phone" value="' + esc(phone) + '" placeholder="方便店家联系"></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.submitBooking(' + JSON.stringify(slotId) + ')">确认预约</button>',
  });
};

App.submitBooking = async (slotId) => {
  const data = readForm($('#modal-body'));
  if (!data.customer || !data.phone) { toast('姓名和电话都要填', 'err'); return; }
  try {
    await api(UX.record.iface, UX.record.create, { method: 'POST', body: { slot_id: slotId, service_id: state.params.id, customer: data.customer, phone: data.phone } });
    storeSet('cbs-app:' + CASE.code + ':phone', data.phone);
    App.closeModal();
    toast('预约成功', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

/* ---- 课程 / 网课 ---- */
async function courseItem() {
  const id = state.params.id;
  setMain(loadingHtml());
  try {
    const d = await api(UX.primary.iface, UX.primary.detail, { params: { id } });
    const course = itemOf(d);
    const lessons = course.__lessons || d.lessons || [];
    const enrolled = rowsOf(state.rows[UX.record.iface] || []);
    let mine = null;
    if (state.token) {
      try { mine = rowsOf(await api(UX.record.iface, UX.record.mine)).find((x) => String(x.course_id || x.title) === String(course.id) || x.title === course.title); } catch (e) {}
    }
    const published = UX.flow === 'netcourse' ? course.status === 'published' : true;
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回课程</button><span class="pill ' + (published ? 'ok' : 'warn') + '">' + (published ? '可报名' : esc(course.status || '未发布')) + '</span></div>' +
      '<div class="panel" style="padding:30px"><div class="eyebrow">' + esc(UX.kicker) + '</div><h1 style="font-size:32px;margin:10px 0 12px">' + esc(course.title) + '</h1>' +
      '<p class="muted">' + esc(course.intro || course.teacher || '') + '</p>' +
      '<div class="detail-grid"><div><label>价格</label><b>' + fmtMoney(course.price) + '</b></div>' +
      (UX.flow === 'course' ? '<div><label>讲师</label><b>' + esc(course.teacher || '—') + '</b></div><div><label>名额</label><b>' + esc(course.enrolled || 0) + ' / ' + esc(course.seats || '不限') + '</b></div>' : '<div><label>课时</label><b>' + esc(course.lesson_count || lessons.length) + '</b></div>') +
      '<div><label>浏览</label><b>' + esc(course.views || 0) + '</b></div></div>' +
      '<div class="hero-actions">' + (mine
        ? '<button class="btn dark" onclick="App.go(\'my\')">已报名 · 去学习</button>'
        : '<button class="btn primary" onclick="App.enrollCourse(' + JSON.stringify(course.id) + ')" ' + (!published ? 'disabled' : '') + '>立即报名</button>') +
      '<button class="btn" onclick="App.goBack(\'collection\')">看看别的</button></div>' +
      '<div class="section"><div class="section-head"><h2 style="font-size:17px">课程目录</h2><span class="faint">' + lessons.length + ' 个课时</span></div>' +
      (lessons.length ? lessons.map((l, i) => '<div class="cart-line"><div class="thumb">' + String(i + 1).padStart(2, '0') + '</div><div class="info"><b>' + esc(l.title) + '</b><span>' + esc(l.duration || 0) + ' 分钟' + (l.video_url ? ' · 视频' : '') + '</span></div>' +
        (l.video_url ? '<a class="btn sm" href="' + esc(l.video_url) + '" target="_blank" rel="noreferrer">预览</a>' : '') + '</div>').join('') : emptyHtml('还没有课时', '讲师还在备课。')) + '</div>' +
      '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('打不开课程', e.message) + '</div>'); }
}

App.enrollCourse = async (id) => {
  if (!requireAuth('登录后才能报名')) return;
  try {
    await api(UX.record.iface, UX.record.create, { method: 'POST', params: { id }, body: {} });
    toast('报名成功', 'ok');
    App.go('my');
  } catch (e) { toast(e.message, 'err'); }
};

/* ---- 医院 ---- */
async function hospitalItem() {
  const id = state.params.id;
  setMain(loadingHtml());
  try {
    const depts = state.rows[UX.primary.iface] || rowsOf(await api(UX.primary.iface, UX.primary.list));
    const dept = depts.find((x) => String(x.id) === String(id));
    if (!dept) throw new Error('科室不存在');
    const doctors = rowsOf(await api(UX.doctor.iface, UX.doctor.list, { params: { id } }));
    const slots = rowsOf(await api(UX.slot.iface, UX.slot.list));
    state.rows[UX.doctor.iface] = doctors;
    state.rows[UX.slot.iface] = slots;
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回科室</button><span class="pill">' + esc(dept.floor || '门诊') + '</span></div>' +
      '<div class="panel" style="padding:30px"><div class="eyebrow">' + esc(UX.kicker) + '</div><h1 style="font-size:32px;margin:10px 0 12px">' + esc(dept.name) + '</h1>' +
      '<p class="muted">楼层 ' + esc(dept.floor || '—') + ' · 电话 ' + esc(dept.phone || '—') + '</p>' +
      '<div class="section"><div class="section-head"><h2 style="font-size:17px">出诊医生</h2><span class="faint">选择医生后查看号源</span></div>' +
      (doctors.length ? '<div class="grid">' + doctors.map((doc) => '<article class="card"><div class="card-body"><div class="card-kicker"><span>' + esc(doc.title || '医生') + '</span><span>' + fmtMoney(doc.fee) + '</span></div><h3>' + esc(doc.name) + '</h3>' +
        '<button class="btn sm primary" style="margin-top:auto" onclick="App.showDoctorSlots(' + JSON.stringify(doc.id) + ')">查看号源</button></div></article>').join('') + '</div>' : emptyHtml('科室还没有医生', '到门诊管理里添加。')) + '</div></div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('打不开科室', e.message) + '</div>'); }
}

App.showDoctorSlots = (doctorId) => {
  const slots = (state.rows[UX.slot.iface] || []).filter((s) => String(s.doctor_id) === String(doctorId));
  const doc = (state.rows[UX.doctor.iface] || []).find((x) => String(x.id) === String(doctorId));
  modal({
    title: (doc ? doc.name : '医生') + ' 的号源',
    desc: '挂号会占用号源；取消挂号会释放。',
    width: 600,
    body: slots.length ? slots.map((s) => {
      const left = Number(s.capacity) - Number(s.booked);
      return '<div class="cart-line"><div class="thumb">' + esc(String(s.day).slice(5, 10)) + '</div><div class="info"><b>' + esc(s.day) + ' · ' + esc(doc ? doc.name : '') + '</b><span>剩余 ' + left + ' / ' + s.capacity + '</span></div>' +
        '<button class="btn sm primary" ' + (left <= 0 ? 'disabled' : '') + ' onclick="App.bookAppointment(' + JSON.stringify(s.id) + ')">' + (left <= 0 ? '已满' : '挂号') + '</button></div>';
    }).join('') : emptyHtml('这个医生还没有号源', '到门诊管理里放号。'),
    foot: '<button class="btn" onclick="App.closeModal()">关闭</button>',
  });
};

App.bookAppointment = async (slotId) => {
  if (!requireAuth('登录后才能挂号')) return;
  try {
    await api(UX.record.iface, UX.record.create, { method: 'POST', body: { slot_id: slotId } });
    App.closeModal();
    toast('挂号成功', 'ok');
    App.go('my');
  } catch (e) { toast(e.message, 'err'); }
};

/* ---- 我的 ---- */
async function catalogMy() {
  if (UX.flow === 'booking') {
    setMain(loadingHtml());
    try {
      const rows = rowsOf(await api(UX.record.iface, UX.record.list));
      state.rows[UX.record.iface] = rows;
      setMain('<div class="page">' + pageTitle('我的预约', '所有预约单都在这里，可以取消释放名额。') +
        (rows.length ? tableHTML(UX.record.iface, rows, ['customer', 'phone', 'service_id', 'slot_id', 'status'], {
          emptyTitle: '还没有预约',
          actions: (row) => '<button class="btn sm danger" onclick="event.stopPropagation();App.cancelBooking(' + JSON.stringify(row.id) + ')">取消</button>',
        }) : emptyHtml('还没有预约', '去选一个服务和时间。')) + pageFoot() + '</div>');
    } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
    return;
  }
  if (UX.flow === 'hospital') {
    if (!state.token) { setMain('<div class="page">' + emptyHtml('登录后查看挂号', '挂号记录按账号保存。') + '<div style="text-align:center"><button class="btn primary" onclick="App.login()">登录</button></div></div>'); return; }
    setMain(loadingHtml());
    try {
      const rows = rowsOf(await api(UX.record.iface, UX.record.mine));
      state.rows[UX.record.iface] = rows;
      setMain('<div class="page">' + pageTitle('我的挂号', '取消后号源会立即释放。') +
        (rows.length ? tableHTML(UX.record.iface, rows, ['doctor', 'day', 'status'], {
          emptyTitle: '还没有挂号',
          actions: (row) => '<button class="btn sm danger" onclick="event.stopPropagation();App.cancelAppointment(' + JSON.stringify(row.id) + ')">取消</button>',
        }) : emptyHtml('还没有挂号', '去科室页选医生和号源。')) + pageFoot() + '</div>');
    } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
    return;
  }
  if (!state.token) { setMain('<div class="page">' + emptyHtml('登录后查看我的课程', '学习进度按账号保存。') + '<div style="text-align:center"><button class="btn primary" onclick="App.login()">登录</button></div></div>'); return; }
  setMain(loadingHtml());
  try {
    const courses = rowsOf(await api(UX.record.iface, UX.record.mine));
    state.rows[UX.record.iface] = courses;
    let exams = [];
    if (UX.record.exams) { try { exams = rowsOf(await api(UX.record.iface, UX.record.exams)); } catch (e) {} }
    setMain('<div class="page">' + pageTitle('我的学习', '进度、考试和成绩都是真实数据。') +
      (courses.length ? '<div class="grid">' + courses.map((c) => '<article class="card"><div class="card-body"><div class="card-kicker"><span>' + esc(c.teacher || '课程') + '</span><span>进度 ' + esc(c.progress || 0) + '%</span></div><h3>' + esc(c.title) + '</h3>' +
        '<div style="height:7px;background:var(--soft);border-radius:99px;overflow:hidden;margin-top:6px"><div style="height:100%;width:' + Math.max(0, Math.min(100, Number(c.progress || 0))) + '%;background:var(--accent)"></div></div>' +
        '<div class="card-foot"><button class="btn sm" onclick="App.updateProgress(' + JSON.stringify(c.id) + ',' + JSON.stringify(c.progress || 0) + ')">更新进度</button>' +
        (UX.record.exam ? '<button class="btn sm primary" onclick="App.takeExam(' + JSON.stringify(c.course_id || c.id) + ')">提交考试</button>' : '') + '</div></div></article>').join('') + '</div>' : emptyHtml('还没有报名课程', '去课程库挑一门。')) +
      (exams.length ? '<section class="section"><div class="section-head"><h2>我的成绩</h2></div>' + tableHTML(UX.record.iface, exams, ['title', 'score', 'passed'], { emptyTitle: '还没有成绩' }) + '</section>' : '') +
      pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

App.cancelBooking = async (id) => {
  if (!(await confirmBox('取消这条预约？名额会释放。'))) return;
  try { await api(UX.record.iface, UX.record.cancel, { method: 'POST', params: { id }, body: {} }); toast('已取消', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};
App.cancelAppointment = async (id) => {
  if (!(await confirmBox('取消这次挂号？号源会释放。'))) return;
  try { await api(UX.record.iface, UX.record.cancel, { method: 'PUT', params: { id }, body: {} }); toast('已取消', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};

App.updateProgress = (id, current) => {
  modal({
    title: '更新学习进度',
    body: '<div class="form"><div class="field full"><label>完成进度（0-100）</label><input data-field="progress" type="number" min="0" max="100" value="' + esc(current) + '"></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.saveProgress(' + JSON.stringify(id) + ')">保存</button>',
  });
};
App.saveProgress = async (id) => {
  const data = readForm($('#modal-body'));
  try { await api(UX.record.iface, UX.record.progress, { method: 'PUT', params: { id }, body: { progress: Number(data.progress || 0) } }); App.closeModal(); toast('已更新', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};
App.takeExam = (courseId) => {
  modal({
    title: '提交考试',
    desc: '填写分数，服务端会根据 60 分线自动判分。',
    body: '<div class="form"><div class="field full"><label>分数</label><input data-field="score" type="number" min="0" max="100" value="80"></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.submitExam(' + JSON.stringify(courseId) + ')">提交</button>',
  });
};
App.submitExam = async (courseId) => {
  const data = readForm($('#modal-body'));
  try { await api(UX.record.iface, UX.record.exam, { method: 'POST', body: { course_id: courseId, score: Number(data.score || 0) } }); App.closeModal(); toast('成绩已记录', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};

/* ---- 管理 ---- */
async function catalogAdmin() {
  setMain(loadingHtml());
  try {
    if (UX.flow === 'booking') {
      const services = rowsOf(await api(UX.primary.iface, UX.primary.list));
      const slots = rowsOf(await api(UX.slot.iface, UX.slot.list));
      const bookings = rowsOf(await api(UX.record.iface, UX.record.list));
      state.rows[UX.primary.iface] = services; state.rows[UX.slot.iface] = slots; state.rows[UX.record.iface] = bookings;
      setMain('<div class="page">' + pageTitle('预约管理', '服务、时段、预约单三层联动。') +
        '<div class="toolbar"><button class="btn primary" onclick="App.newService()">+ 新增服务</button><button class="btn" onclick="App.newSlot()">+ 放号</button></div>' +
        '<div class="panel"><div class="panel-head"><h3>服务项目</h3></div>' + tableHTML(UX.primary.iface, services, ['name', 'price', 'duration', 'status']) + '</div>' +
        '<div class="panel"><div class="panel-head"><h3>时段</h3></div>' + tableHTML(UX.slot.iface, slots, ['service_id', 'day', 'start_time', 'end_time', 'capacity', 'booked']) + '</div>' +
        '<div class="panel"><div class="panel-head"><h3>预约单</h3></div>' + tableHTML(UX.record.iface, bookings, ['customer', 'phone', 'service_id', 'slot_id', 'status']) + '</div>' + pageFoot() + '</div>');
      return;
    }
    if (UX.flow === 'hospital') {
      const depts = rowsOf(await api(UX.primary.iface, UX.primary.list));
      const slots = rowsOf(await api(UX.slot.iface, UX.slot.list));
      state.rows[UX.primary.iface] = depts; state.rows[UX.slot.iface] = slots;
      setMain('<div class="page">' + pageTitle('门诊管理', '科室、医生、号源层层挂接。') +
        '<div class="toolbar"><button class="btn primary" onclick="App.newDepartment()">+ 新增科室</button><button class="btn" onclick="App.newDoctor()">+ 新增医生</button><button class="btn" onclick="App.newHospitalSlot()">+ 放号</button></div>' +
        '<div class="panel"><div class="panel-head"><h3>科室</h3></div>' + tableHTML(UX.primary.iface, depts, ['name', 'floor', 'phone'], {
          actions: (row) => '<button class="btn sm" onclick="event.stopPropagation();App.listDoctors(' + JSON.stringify(row.id) + ')">医生</button>',
        }) + '</div>' +
        '<div class="panel"><div class="panel-head"><h3>号源</h3></div>' + tableHTML(UX.slot.iface, slots, ['doctor_id', 'day', 'capacity', 'booked']) + '</div>' + pageFoot() + '</div>');
      return;
    }
    const courses = rowsOf(await api(UX.primary.iface, UX.primary.list));
    state.rows[UX.primary.iface] = courses;
    setMain('<div class="page">' + pageTitle(UX.flow === 'netcourse' ? '讲师后台' : '课程管理', '建课、加课时、发布，全部真实落库。') +
      '<div class="toolbar"><button class="btn primary" onclick="App.newCourse()">+ ' + esc(UX.writeLabel) + '</button></div>' +
      '<div class="panel"><div class="panel-head"><h3>课程</h3><span class="faint">' + courses.length + ' 门</span></div>' +
      tableHTML(UX.primary.iface, courses, ['title', 'price', 'status', 'created_at'], {
        actions: (row) => '<button class="btn sm" onclick="event.stopPropagation();App.addLesson(' + JSON.stringify(row.id) + ')">加课时</button>' +
          (UX.primary.publish ? '<button class="btn sm primary" onclick="event.stopPropagation();App.publishCourse(' + JSON.stringify(row.id) + ')">发布</button>' : ''),
      }) + '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('后台读取失败', e.message) + '</div>'); }
}

App.newService = () => openForm({ title: '新增服务', iface: UX.primary.iface, path: UX.primary.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: d }); toast('已创建', 'ok'); await App.render(); } });
App.newSlot = () => openForm({ title: '放号', iface: UX.slot.iface, path: UX.slot.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.slot.iface, UX.slot.create, { method: 'POST', body: d }); toast('已放号', 'ok'); await App.render(); } });
App.newDepartment = () => openForm({ title: '新增科室', iface: UX.primary.iface, path: UX.primary.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: d }); toast('已创建', 'ok'); await App.render(); } });
App.newDoctor = () => openForm({ title: '新增医生', iface: UX.doctor.iface, path: UX.doctor.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.doctor.iface, UX.doctor.create, { method: 'POST', body: d }); toast('已创建', 'ok'); await App.render(); } });
App.newHospitalSlot = () => openForm({ title: '放号', iface: UX.slot.iface, path: UX.slot.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.slot.iface, UX.slot.create, { method: 'POST', body: d }); toast('已放号', 'ok'); await App.render(); } });
App.listDoctors = async (deptId) => {
  try {
    const docs = rowsOf(await api(UX.doctor.iface, UX.doctor.list, { params: { id: deptId } }));
    modal({ title: '科室医生', body: docs.length ? docs.map((d) => '<div class="cart-line"><div class="thumb">' + esc(String(d.name).slice(0, 1)) + '</div><div class="info"><b>' + esc(d.name) + '</b><span>' + esc(d.title || '') + ' · ' + fmtMoney(d.fee) + '</span></div></div>').join('') : emptyHtml('还没有医生', ''), foot: '<button class="btn" onclick="App.closeModal()">关闭</button>' });
  } catch (e) { toast(e.message, 'err'); }
};
App.newCourse = () => openForm({ title: UX.writeLabel, iface: UX.primary.iface, path: UX.primary.create, submitLabel: '创建课程', onSubmit: async (d) => { await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: d }); toast('已创建', 'ok'); await App.render(); } });
App.addLesson = (id) => openForm({ title: '添加课时', iface: UX.lesson.iface, path: UX.lesson.add, params: { id }, submitLabel: '添加', onSubmit: async (d) => { await api(UX.lesson.iface, UX.lesson.add, { method: 'POST', params: { id }, body: d }); toast('已添加', 'ok'); await App.render(); } });
App.publishCourse = async (id) => {
  try { await api(UX.primary.iface, UX.primary.publish, { method: 'PUT', params: { id }, body: {} }); toast('已发布', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};

MODES.catalog = {
  home: catalogHome,
  collection: catalogCollection,
  item: catalogItem,
  my: catalogMy,
  admin: catalogAdmin,
};

// ---- 04-desk.js ----
/* 后台工作台模式：客户、报价、运单、工单、设备、审批。真实列表、详情、统计和动作。 */

function deskMenu() { return (UX.menu || []); }
function deskMenuByView(view) {
  const list = deskMenu();
  return list.find((m) => m.view === view)
    || list.find((m) => m.label === view)
    || list.find((m) => (m.list || '').indexOf('/' + view) === 0)
    || null;
}
function deskActionsFor(scope, menu, row) {
  return (UX.actions || []).filter((a) => {
    if (a.scope !== scope) return false;
    if (a.iface && menu && a.iface !== menu.iface) return false;
    if (a.when && row) return Object.keys(a.when).every((k) => String(row[k]) === String(a.when[k]));
    return true;
  });
}
function deskActionBody(action, row, params) {
  const body = {};
  Object.keys(action.map || {}).forEach((target) => { const src = action.map[target]; body[target] = row[src] != null ? row[src] : params[Object.keys(params)[0]]; });
  return body;
}
function deskParamKey(menu) { return menu && menu.detailKey ? menu.detailKey : 'id'; }
function deskRowKey(menu, row) {
  if (!row) return '';
  if (menu && menu.detailKey && row[menu.detailKey] != null) return row[menu.detailKey];
  return row.id != null ? row.id : (row.order_no || row.tracking_no || row.quote_no || '');
}
function deskTitle(row) {
  if (!row) return '记录';
  return row.title || row.name || row.job_name || row.order_no || row.tracking_no || row.device_no || row.customer_name || ('#' + (row.id == null ? '' : row.id));
}
function deskColumns(menu, rows) {
  if (menu.columns && menu.columns.length) return menu.columns;
  const first = rows && rows[0];
  if (!first) return [];
  return Object.keys(first).filter((k) => !/^(id|only_id|user_only_id|owner_only_id|password_hash|payload)$/.test(k)).slice(0, 7);
}

function deskCacheKey(menu) { return 'desk:' + ((menu && (menu.label || menu.list)) || ''); }

async function deskLoad(menu, force) {
  const iface = menu.iface;
  const key = deskCacheKey(menu);
  if (!force && state.rows[key] && state.rows[key].__path === menu.list) return state.rows[key];
  const d = await api(iface, menu.list);
  const rows = rowsOf(d);
  rows.__path = menu.list;
  state.rows[key] = rows;
  return rows;
}

async function deskAll(force) {
  const out = {};
  for (const menu of deskMenu()) {
    try { out[menu.label] = await deskLoad(menu, force); } catch (e) { out[menu.label] = { __error: e.message }; }
  }
  return out;
}

function statNumber(rows, key) {
  const list = rows || [];
  if (!list.length) return 0;
  if (key && list[0] && list[0][key] != null) return list.reduce((n, r) => n + Number(r[key] || 0), 0);
  return list.length;
}

async function deskHome() {
  setMain(loadingHtml('正在读取工作台数据…'));
  try {
    const all = await deskAll(true);
    const menus = deskMenu();
    const main = menus[0];
    const mainRows = all[main.label] || [];
    const stats = menus.map((m) => {
      const rows = all[m.label] || [];
      if (m.list.indexOf('/stats') >= 0) {
        return { label: m.label, value: String(rows.length), note: '统计分组' };
      }
      return { label: m.label, value: String(Array.isArray(rows) ? rows.length : 0), note: '条记录' };
    });
    const recent = Array.isArray(mainRows) ? mainRows.slice(0, 8) : [];
    const cols = deskColumns(main, recent);
    const body = recent.length
      ? '<div class="table-wrap"><table><thead><tr>' + cols.map((c) => '<th>' + esc(labelOf(main.iface, c)) + '</th>').join('') + '</tr></thead><tbody>' +
        recent.map((r) => '<tr onclick="App.openDeskRow(' + JSON.stringify(menus.indexOf(main)) + ',' + JSON.stringify(r.id == null ? '' : r.id) + ')">' +
          cols.map((c, i) => '<td>' + (i === 0 ? '<span class="strong">' : '') + fieldValue(main.iface, c, r) + (i === 0 ? '</span>' : '') + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>'
      : emptyHtml('还没有' + main.label, '点右上角新建，第一条数据会出现在这里。');

    setMain('<div class="page desk">' +
      '<section class="desk-hero"><div><div class="eyebrow">' + esc(UX.kicker) + '</div><h1>' + esc(UX.home.title) + '</h1><p>' + esc(UX.home.sub) + '</p>' +
      '<div class="hero-actions"><button class="btn primary" onclick="App.newDeskRecord()">' + esc(UX.home.cta) + '</button>' +
      '<button class="btn ghost" onclick="App.goDesk(0)">查看' + esc(main.label) + '</button></div></div>' +
      '<div class="desk-stamp"><span>' + esc(UX.mark) + '</span><b>' + new Date().toLocaleDateString('zh-CN') + '</b><em>' + esc(UX.tagline) + '</em></div></section>' +
      '<section class="kpi-row">' + stats.map((s) => '<div class="kpi"><span>' + esc(s.label) + '</span><b>' + esc(s.value) + '</b><em>' + esc(s.note) + '</em></div>').join('') + '</section>' +
      '<section class="section"><div class="section-head"><div><h2>最近' + esc(main.label) + '</h2><p>点击任意一行进入真实详情</p></div>' +
      '<button class="btn ghost" onclick="App.goDesk(0)">全部 →</button></div>' + body + '</section>' +
      pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page">' + emptyHtml('工作台读取失败', e.message) + pageFoot() + '</div>');
  }
}
App.goDeskHome = () => { state.view = 'home'; state.params = {}; renderChrome(); App.render(); };

function deskListPage(menu, rows) {
  const cols = deskColumns(menu, rows);
  const actionCell = menu.readonly ? '' : '<th style="text-align:right">操作</th>';
  const createActs = deskActionsFor('create', menu);
  const body = rows.length
    ? '<div class="table-wrap"><table><thead><tr>' + cols.map((c) => '<th>' + esc(labelOf(menu.iface, c)) + '</th>').join('') + actionCell + '</tr></thead><tbody>' +
      rows.map((r, idx) => '<tr>' + cols.map((c, i) => '<td>' + (i === 0 ? '<span class="strong">' : '') + fieldValue(menu.iface, c, r) + (i === 0 ? '</span>' : '') + '</td>').join('') +
        (menu.readonly ? '' : '<td><div class="row-actions">' + deskActionsFor('row', menu, r).map((a, ai) =>
          '<button class="mini" onclick="event.stopPropagation();App.deskRowAction(' + idx + ',' + ai + ')">' + esc(a.label) + '</button>').join('') +
          '<button class="mini" onclick="event.stopPropagation();App.openDeskRow(' + idx + ')">' + (menu.detail ? '详情' : '查看') + '</button>' +
          (menu.create ? '<button class="mini" onclick="event.stopPropagation();App.editDeskRow(' + idx + ')">编辑</button>' : '') + '</div></td>') + '</tr>').join('') +
      '</tbody></table></div>'
    : emptyHtml('还没有' + menu.label, menu.create ? '点右上角新建一条。' : '暂无可展示数据。');
  return '<div class="page desk">' + pageTitle(menu.label, menu.readonly ? '聚合统计，只读' : ('共 ' + rows.length + ' 条真实记录')) +
    '<div class="toolbar"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>' +
    '<input id="desk-search" value="' + esc(searchValue()) + '" placeholder="搜索' + esc(menu.label) + '…" onkeydown="if(event.key===\'Enter\')App.search(this.value)"></label>' +
    (menu.create ? '<button class="btn primary" onclick="App.newDeskRecord()">新建' + esc(menu.label) + '</button>' : '') +
    createActs.map((a, ai) => '<button class="btn" onclick="App.deskCreateAction(' + ai + ')">' + esc(a.label) + '</button>').join('') +
    '<span class="spacer"></span></div>' + body + pageFoot() + '</div>';
}

async function deskCollection() {
  const index = Number(state.params.menu || 0);
  const menu = deskMenu()[index] || deskMenu()[0];
  if (!menu) { setMain(emptyHtml('没有配置业务菜单')); return; }
  setMain(loadingHtml('正在读取' + menu.label + '…'));
  try {
    let rows = await deskLoad(menu, true);
    if (menu.readonly) rows = rowsOf(await api(menu.iface, menu.list));
    const kw = searchValue().toLowerCase();
    if (kw) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().indexOf(kw) >= 0);
    state.currentRows = rows;
    setMain(deskListPage(menu, rows));
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

App.goDesk = (index) => {
  state.view = 'collection';
  state.params = { menu: Number(index || 0) };
  renderChrome();
  App.render();
};

App.searchDesk = (keyword) => {
  state.params.keyword = keyword || '';
  App.render();
};

App.openDeskRow = (index, id) => {
  const menu = deskMenu()[Number(state.params.menu || 0)] || deskMenu()[0];
  if (!menu) return;
  const rows = state.rows[deskCacheKey(menu)] || [];
  const row = (id != null && rows.find((r) => String(r.id) === String(id) || String(r[deskParamKey(menu)]) === String(id))) || rows[Number(index)];
  if (!row) return;
  if (!menu.detail) { App.detailModal(menu, row); return; }
  state.view = 'detail';
  state.params = { menu: deskMenu().indexOf(menu), row: row, id: deskRowKey(menu, row) };
  renderChrome();
  App.render();
};

App.detailModal = (menu, row) => {
  const fields = Object.keys(row).filter((k) => !/^(__|id|password_hash)/.test(k)).slice(0, 14);
  App.modal({
    title: deskTitle(row),
    desc: menu.label,
    body: '<div class="detail-grid">' + fields.map((f) =>
      '<div><label>' + esc(labelOf(menu.iface, f)) + '</label><b>' + fieldValue(menu.iface, f, row) + '</b></div>').join('') + '</div>',
    foot: '<button class="btn" onclick="App.closeModal()">关闭</button>',
  });
};

function deskRelated(menu, detail) {
  const arrays = [];
  if (Array.isArray(detail.contacts)) arrays.push({ title: '联系人', iface: menu.iface, rows: detail.contacts, cols: ['name', 'title', 'phone'] });
  if (Array.isArray(detail.deals)) arrays.push({ title: '商机', iface: menu.iface, rows: detail.deals, cols: ['title', 'amount', 'stage'] });
  if (Array.isArray(detail.__items)) arrays.push({ title: '明细', iface: menu.iface, rows: detail.__items, cols: Object.keys(detail.__items[0] || {}).filter((k) => !/^(id|quote_id|project_id|order_id)$/.test(k)).slice(0, 6) });
  if (Array.isArray(detail.__processes)) arrays.push({ title: '后道工艺', iface: menu.iface, rows: detail.__processes, cols: ['name', 'fee'] });
  if (Array.isArray(detail.__modules)) arrays.push({ title: '模块', iface: menu.iface, rows: detail.__modules, cols: ['name', 'days', 'amount'] });
  if (Array.isArray(detail.__tracks)) arrays.push({ title: '轨迹', iface: menu.iface, rows: detail.__tracks, cols: ['node', 'detail', 'created_at'] });
  if (Array.isArray(detail.__replies)) arrays.push({ title: '回复记录', iface: '回复', rows: detail.__replies, cols: ['author', 'content', 'created_at'] });
  if (Array.isArray(detail.__client)) arrays.push({ title: '客户', iface: menu.iface, rows: detail.__client, cols: ['name', 'contact', 'phone'] });
  if (!arrays.length) return '';
  return arrays.map((a) => '<section class="section"><div class="section-head"><div><h2>' + esc(a.title) + '</h2><p>' + a.rows.length + ' 条关联记录</p></div></section>' +
    (a.rows.length ? '<div class="table-wrap"><table><thead><tr>' + a.cols.map((c) => '<th>' + esc(labelOf(a.iface, c)) + '</th>').join('') + '</tr></thead><tbody>' +
      a.rows.map((r) => '<tr>' + a.cols.map((c) => '<td>' + fieldValue(a.iface, c, r) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : emptyHtml('暂无' + a.title, '可以通过右侧动作添加。')) + '</section>').join('');
}

async function deskDetail() {
  const menu = deskMenu()[Number(state.params.menu || 0)] || deskMenu()[0];
  if (!menu || !menu.detail) { state.view = 'home'; return App.render(); }
  setMain(loadingHtml('正在读取详情…'));
  try {
    const params = {};
    params[deskParamKey(menu)] = state.params.id;
    let d;
    try { d = await api(menu.iface, menu.detail, { params }); }
    catch (e) {
      const rows = await deskLoad(menu, true);
      const row = rows.find((r) => String(r[deskParamKey(menu)]) === String(state.params.id)) || state.params.row;
      d = row || {};
    }
    const detail = itemOf(d);
    const base = Object.assign({}, state.params.row || {}, detail);
    const fields = Object.keys(base).filter((k) => !/^(__|id\b|password_hash|only_id)/.test(k) && base[k] != null && typeof base[k] !== 'object').slice(0, 16);
    const actions = deskActionsFor('detail', menu, base);
    const actionHtml = actions.map((a, i) => '<button class="btn ' + (a.danger ? 'danger' : 'primary') + '" onclick="App.deskAction(' + i + ')">' + esc(a.label) + '</button>').join('');
    setMain('<div class="page desk">' +
      '<div class="crumb"><button class="mini" onclick="App.goDesk(' + state.params.menu + ')">← 返回' + esc(menu.label) + '</button><span>' + esc(menu.label) + ' / ' + esc(deskTitle(base)) + '</span></div>' +
      '<section class="detail-hero"><div><div class="eyebrow">' + esc(menu.iface) + '</div><h1>' + esc(deskTitle(base)) + '</h1>' +
      '<div class="detail-meta">' + fields.slice(0, 4).map((f) => '<span>' + esc(labelOf(menu.iface, f)) + ' · ' + fieldValue(menu.iface, f, base) + '</span>').join('') + '</div></div>' +
      '<div class="detail-actions">' + actionHtml + '</div></section>' +
      '<section class="section"><div class="section-head"><div><h2>字段</h2><p>直接来自接口返回</p></div></div>' +
      '<div class="detail-grid">' + fields.map((f) => '<div><label>' + esc(labelOf(menu.iface, f)) + '</label><b>' + fieldValue(menu.iface, f, base) + '</b></div>').join('') + '</div></section>' +
      deskRelated(menu, base) + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('详情读取失败', e.message) + '</div>'); }
}

function deskActionParams(action, menu, row) {
  const params = {};
  const keys = Array.from(String(action.path || '').matchAll(/:([A-Za-z0-9_]+)/g)).map((m) => m[1]);
  keys.forEach((k) => {
    let v = row && row[k];
    if (v == null && k === 'id') v = row && row.id;
    if (v == null && k === 'no') v = row && (row.tracking_no || row.order_no || row.quote_no);
    if (v == null) v = deskRowKey(menu, row);
    params[k] = v;
  });
  if (!keys.length) params[deskParamKey(menu)] = deskRowKey(menu, row);
  return params;
}
function deskOpenAction(action, menu, row) {
  if (!action) return;
  const params = deskActionParams(action, menu, row);
  const body = deskActionBody(action, row || {}, params);
  if (action.confirm) {
    App.confirm(action.confirm).then((ok) => { if (ok) runDeskAction(action, params, body); });
    return;
  }
  if (action.fields && action.fields.length) {
    App.openForm({
      title: action.label,
      iface: action.iface,
      path: action.path,
      desc: '这个动作会直接写入真实业务表。',
      values: body,
      submitLabel: action.label,
      onSubmit: async (data) => {
        await api(action.iface, action.path, { method: action.method || 'POST', params, body: Object.assign({}, body, data) });
        toast(action.label + '成功', 'ok');
        await App.render();
      },
    });
    return;
  }
  runDeskAction(action, params, body);
}

App.deskAction = (index) => {
  const menu = deskMenu()[Number(state.params.menu || 0)] || deskMenu()[0];
  const row = state.params.row || {};
  deskOpenAction(deskActionsFor('detail', menu, row)[index], menu, row);
};

App.deskRowAction = (rowIndex, index) => {
  const menu = deskMenu()[Number(state.params.menu || 0)] || deskMenu()[0];
  const rows = (state.currentRows && state.currentRows.length ? state.currentRows : state.rows[deskCacheKey(menu)]) || [];
  const row = rows[rowIndex] || {};
  deskOpenAction(deskActionsFor('row', menu, row)[index], menu, row);
};

App.deskCreateAction = (index) => {
  const menu = deskMenu()[Number(state.params.menu || 0)] || deskMenu()[0];
  deskOpenAction(deskActionsFor('create', menu)[index], menu, {});
};

async function runDeskAction(action, params, body) {
  try {
    await api(action.iface, action.path, { method: action.method || 'POST', params, body });
    toast(action.label + '成功', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '操作失败', 'err'); }
}

App.newDeskRecord = () => {
  const menu = deskMenu()[Number(state.params.menu || 0)] || deskMenu()[0];
  if (!menu || !menu.create) { toast('这个菜单不支持新建', 'err'); return; }
  App.openForm({
    title: '新建' + menu.label,
    iface: menu.iface,
    path: menu.create,
    submitLabel: '创建',
    onSubmit: async (data) => {
      await api(menu.iface, menu.create, { method: 'POST', body: data });
      toast('已创建', 'ok');
      await App.render();
    },
  });
};

App.editDeskRow = (index) => {
  const menu = deskMenu()[Number(state.params.menu || 0)] || deskMenu()[0];
  if (!menu) return;
  const rows = state.rows[deskCacheKey(menu)] || [];
  const row = rows[index];
  if (!row) return;
  const route = (ifaceOf(menu.iface).routes || []).find((r) => r.method === 'PUT' && r.path === (menu.list + '/:id')) ||
    (ifaceOf(menu.iface).routes || []).find((r) => r.method === 'PUT');
  if (!route) { toast('这个案例没有更新接口', 'err'); return; }
  const params = { id: row.id };
  App.openForm({
    title: '编辑' + menu.label,
    iface: menu.iface,
    path: route.path,
    values: row,
    submitLabel: '保存',
    onSubmit: async (data) => {
      await api(menu.iface, route.path, { method: 'PUT', params, body: data });
      toast('已保存', 'ok');
      await App.render();
    },
  });
};

async function deskBoard() {
  const menu = deskMenu()[0];
  setMain(loadingHtml());
  try {
    const rows = await deskLoad(menu, true);
    const stageKey = rows[0] && (rows[0].stage != null ? 'stage' : (rows[0].status != null ? 'status' : null));
    if (!stageKey) return deskCollection();
    const groups = {};
    rows.forEach((r) => { const k = String(r[stageKey] == null ? '未分组' : r[stageKey]); (groups[k] = groups[k] || []).push(r); });
    setMain('<div class="page desk">' + pageTitle('商机看板', '按阶段分组的真实数据') +
      '<div class="board">' + Object.keys(groups).map((k) => '<div class="board-col"><div class="board-head"><b>' + esc((enumFor(stageKey) || {})[k] || k) + '</b><span>' + groups[k].length + '</span></div>' +
        groups[k].map((r) => '<div class="board-card" onclick="App.openDeskRow(' + rows.indexOf(r) + ')"><b>' + esc(deskTitle(r)) + '</b><span>' + esc(fmtMoney(r.amount || r.total || 0)) + '</span></div>').join('') + '</div>').join('') + '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

// ---- 05-chat.js ----
/* 即时聊天模式：会话列表、消息流、发送、已读、未读数。 */

function chatRows() { return state.rows['__chat'] || []; }

async function chatLoad() {
  const data = {};
  data.conversations = rowsOf(await api(UX.auth.iface, UX.routes.conversations));
  data.inbox = rowsOf(await api(UX.auth.iface, UX.routes.messages));
  try { data.unread = itemOf(await api(UX.auth.iface, UX.routes.unread)); } catch (e) { data.unread = {}; }
  state.rows['__chat'] = data;
  return data;
}

function chatPeer(row) {
  return row.peer_only_id || row.only_id || row.from_only_id || row.sender_only_id || row.to_only_id || row.user_only_id || '';
}
function chatPeerName(row) {
  return row.peer_name || row.from_name || row.sender_name || row.nickname || row.name || chatPeer(row) || '对方';
}
function chatText(row) { return row.last_message || row.body || row.content || row.message || ''; }
function chatTime(row) { return row.updated_at || row.created_at || row.sent_at || ''; }
function chatMine(row) {
  const me = state.user && state.user.onlyId;
  if (!me) return false;
  return String(row.from_only_id || row.sender_only_id || '') === String(me);
}

async function chatHome() {
  if (!requireAuth('登录后才能查看会话')) return;
  setMain(loadingHtml('正在读取会话…'));
  try {
    const d = await chatLoad();
    const convs = d.conversations || [];
    const inbox = d.inbox || [];
    const unread = Number(d.unread && (d.unread.count || d.unread.total || d.unread.unread) || 0);
    const rows = convs.length ? convs : inbox;
    const list = rows.length ? rows.map((c) => {
      const active = String(state.params.conv || '') === String(c.id || c.conv_id || chatPeer(c));
      return '<button class="conv ' + (active ? 'on' : '') + '" onclick="App.openChat(' + JSON.stringify(c.id || c.conv_id || chatPeer(c)) + ',' + JSON.stringify(chatPeer(c)) + ',' + JSON.stringify(chatPeerName(c)) + ')">' +
        avatar(chatPeerName(c)) +
        '<span class="conv-main"><b>' + esc(chatPeerName(c)) + '</b><em>' + esc(plain(chatText(c), 34) || '还没有消息') + '</em></span>' +
        '<span class="conv-side"><i>' + esc(fmtDate(chatTime(c), true)) + '</i></span></button>';
    }).join('') : emptyHtml('还没有会话', '注册第二个账号，给对方发第一条消息。');
    setMain('<div class="page chat-page"><div class="chat-shell">' +
      '<aside class="chat-side"><div class="chat-side-head"><b>消息</b><span>' + (unread ? unread + ' 未读' : '全部已读') + '</span></div>' +
      '<div class="chat-side-list">' + list + '</div>' +
      '<button class="btn primary chat-new" onclick="App.newChat()">发起新会话</button></aside>' +
      '<main class="chat-main"><div class="chat-empty"><span class="big-mark">' + esc((UX.mark || 'IM').slice(0, 2)) + '</span><h2>' + esc(UX.home.title) + '</h2><p>' + esc(UX.home.sub) + '</p>' +
      '<div class="chat-meta"><span>会话 ' + convs.length + '</span><span>收件 ' + inbox.length + '</span><span>未读 ' + unread + '</span></div></div></main>' +
      '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('会话读取失败', e.message) + '</div>'); }
}

async function chatThread() {
  if (!requireAuth('登录后才能查看消息')) return;
  setMain(loadingHtml('正在读取消息…'));
  try {
    const d = await chatLoad();
    const peer = state.params.peer || '';
    const convId = state.params.conv || '';
    const inbox = d.inbox || [];
    let msgs = [];
    if (convId && UX.routes.thread) {
      msgs = rowsOf(await api(UX.auth.iface, UX.routes.thread, { params: { id: convId } }));
    } else {
      msgs = inbox.filter((m) => {
        const p = chatPeer(m);
        return (convId && String(m.conv_id || m.conversation_id || '') === String(convId)) || (peer && String(p) === String(peer));
      });
    }
    const incomingUnread = inbox.filter((m) => String(m.conv_id || '') === String(convId) && !chatMine(m) && !Number(m.read_flag));
    if (incomingUnread.length && UX.routes.read) {
      await Promise.all(incomingUnread.map((m) => api(UX.auth.iface, UX.routes.read, { method: 'PUT', params: { id: m.id } }).catch(() => null)));
    }
    msgs = msgs.slice().sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)));
    const list = (d.conversations || []);
    const side = list.length ? list.map((c) => {
      const active = String(convId) === String(c.id || c.conv_id || chatPeer(c));
      return '<button class="conv ' + (active ? 'on' : '') + '" onclick="App.openChat(' + JSON.stringify(c.id || c.conv_id || chatPeer(c)) + ',' + JSON.stringify(chatPeer(c)) + ',' + JSON.stringify(chatPeerName(c)) + ')">' +
        avatar(chatPeerName(c)) + '<span class="conv-main"><b>' + esc(chatPeerName(c)) + '</b><em>' + esc(plain(chatText(c), 30) || '还没有消息') + '</em></span></button>';
    }).join('') : '<div class="chat-side-empty">暂无会话</div>';
    const bubbles = msgs.length ? msgs.map((m) => '<div class="bubble-row ' + (chatMine(m) ? 'mine' : '') + '">' +
      (!chatMine(m) ? avatar(chatPeerName(m)) : '') +
      '<div class="bubble"><p>' + esc(m.body || m.content || m.message || '') + '</p><span>' + esc(fmtDate(m.created_at, true)) + '</span></div></div>').join('')
      : '<div class="chat-empty small"><h3>还没有消息</h3><p>在下面输入第一句，消息会真实写入数据库。</p></div>';
    setMain('<div class="page chat-page"><div class="chat-shell">' +
      '<aside class="chat-side"><div class="chat-side-head"><b>会话</b><span>' + list.length + '</span></div><div class="chat-side-list">' + side + '</div>' +
      '<button class="btn primary chat-new" onclick="App.newChat()">发起新会话</button></aside>' +
      '<main class="chat-main"><div class="chat-thread-head"><div>' + avatar(chatPeerName({ peer_name: state.params.name })) +
      '<b>' + esc(state.params.name || peer || '会话') + '</b><span>真实会话 · ' + msgs.length + ' 条消息</span></div>' +
      '<button class="mini" onclick="App.refreshChat()">刷新</button></div>' +
      '<div class="chat-thread" id="chat-thread">' + bubbles + '</div>' +
      '<div class="chat-compose"><textarea id="chat-input" placeholder="输入消息，Enter 发送"></textarea><button class="btn primary" onclick="App.sendChat()">发送</button></div>' +
      '</main></div>' + pageFoot() + '</div>');
    const input = $('#chat-input');
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.sendChat(); } };
    const thread = $('#chat-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  } catch (e) { setMain('<div class="page">' + emptyHtml('消息读取失败', e.message) + '</div>'); }
}

App.openChat = (conv, peer, name) => {
  state.view = 'thread';
  state.params = { conv, peer, name };
  renderChrome();
  App.render();
};

App.refreshChat = () => App.render();

App.sendChat = async () => {
  const input = $('#chat-input');
  const body = input ? input.value.trim() : '';
  if (!body) return;
  const peer = state.params.peer;
  if (!peer) { toast('缺少收件人 ID，请从新会话发起', 'err'); return; }
  try {
    await api(UX.auth.iface, UX.routes.send, { method: 'POST', body: { to: peer, body, msg_type: 'text' } });
    input.value = '';
    toast('已发送', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '发送失败', 'err'); }
};

App.newChat = () => {
  App.modal({
    title: '发起新会话',
    desc: '输入对方的 only_id。注册另一个账号后，在「我的」里可以看到自己的 only_id。',
    body: '<div class="form"><div class="field"><label>对方 only_id</label><input id="chat-to" placeholder="例如 u_xxxxx"></div>' +
      '<div class="field"><label>第一条消息</label><textarea id="chat-first" placeholder="写点什么…"></textarea></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.startChat()">发送</button>',
  });
};

App.startChat = async () => {
  const to = ($('#chat-to') && $('#chat-to').value || '').trim();
  const body = ($('#chat-first') && $('#chat-first').value || '').trim();
  if (!to) { toast('先填对方 only_id', 'err'); return; }
  if (!body) { toast('先写第一条消息', 'err'); return; }
  try {
    await api(UX.auth.iface, UX.routes.send, { method: 'POST', body: { to, body, msg_type: 'text' } });
    App.closeModal();
    toast('已发送', 'ok');
    App.openChat('', to, to);
  } catch (e) { toast(e.message || '发送失败', 'err'); }
};

// ---- 06-social.js ----
/* 社交社区模式：动态流、点赞评论、好友、私聊、通知、资料。 */

function socialIface(path, method) {
  const list = CASE.interfaces || [];
  const hit = list.find((i) => (i.routes || []).some((r) => r.path === path && (!method || r.method === method)));
  return hit ? hit.name : (UX.auth && UX.auth.iface);
}
function socialApi(path, opts) {
  opts = opts || {};
  return api(socialIface(path, opts.method || 'GET'), path, opts);
}
async function socialRows(path, opts) { return rowsOf(await socialApi(path, opts)); }
function momentAuthor(m) {
  return m.author_name || m.nickname || m.display_name || m.peer_name || m.only_id || '好友';
}
function momentText(m) { return m.content || m.body || m.text || ''; }
function momentId(m) { return m.id || m.moment_id; }

function momentCard(m) {
  const id = momentId(m);
  const images = String(m.images || '').split(/[,，]/).filter(Boolean);
  return '<article class="moment"><div class="moment-head">' + avatar(momentAuthor(m)) +
    '<div><b>' + esc(momentAuthor(m)) + '</b><span>' + esc(fmtDate(m.created_at, true)) + '</span></div>' +
    '<button class="mini" onclick="App.likeMoment(' + JSON.stringify(id) + ')">♡ ' + esc(m.like_count || m.likes || 0) + '</button></div>' +
    '<p>' + esc(momentText(m)).replace(/\n/g, '<br>') + '</p>' +
    (images.length ? '<div class="moment-images">' + images.slice(0, 3).map((src) => src && /^(https?:|\/)/.test(src) ? '<img src="' + esc(src) + '">' : '').join('') + '</div>' : '') +
    '<div class="moment-foot"><button class="mini" onclick="App.openMoment(' + JSON.stringify(id) + ')">评论 ' + esc(m.comment_count || 0) + '</button>' +
    '<button class="mini" onclick="App.shareMoment(' + JSON.stringify(id) + ')">转发</button></div></article>';
}

async function socialHome() {
  if (!requireAuth('登录后才能查看好友动态')) return;
  setMain(loadingHtml('正在读取动态…'));
  try {
    const moments = await socialRows(UX.routes.moments);
    const friends = await socialRows(UX.routes.friends).catch(() => []);
    const unread = itemOf(await socialApi(UX.routes.unread).catch(() => ({})));
    const list = moments.slice(0, 20);
    setMain('<div class="page social-page"><div class="social-layout">' +
      '<main class="social-feed"><div class="composer"><div class="composer-head">' + avatar((state.user && state.user.name) || '我') +
      '<button class="composer-input" onclick="App.newMoment()">分享一点真实的事…</button></div>' +
      '<div class="composer-foot"><span>动态 ' + moments.length + '</span><span>好友 ' + friends.length + '</span><span>未读 ' + esc(unread.count || unread.unread || unread.total || 0) + '</span></div></div>' +
      (list.length ? list.map(momentCard).join('') : emptyHtml('还没有动态', '发第一条，好友会在这里看到。')) +
      '</main><aside class="social-side"><div class="side-card"><h3>好友</h3>' +
      (friends.slice(0, 8).map((f) => '<div class="friend-row">' + avatar(f.nickname || f.name || f.only_id) + '<span><b>' + esc(f.nickname || f.name || f.only_id) + '</b><em>' + esc(f.bio || f.region || '') + '</em></span></div>').join('') || '<p class="muted">还没有好友</p>') +
      '<button class="btn ghost" onclick="App.go(\'friends\')">管理好友</button></div>' +
      '<div class="side-card"><h3>通知</h3><button class="btn ghost" onclick="App.go(\'notifications\')">查看通知</button></div></aside>' +
      '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('动态读取失败', e.message) + '</div>'); }
}

App.newMoment = () => {
  if (!requireAuth('登录后才能发动态')) return;
  App.openForm({
    title: '发布动态',
    iface: socialIface('/moments', 'POST'),
    path: '/moments',
    desc: '内容会直接进入好友动态流。',
    fields: ['content', 'images'],
    submitLabel: '发布',
    onSubmit: async (data) => {
      await socialApi('/moments', { method: 'POST', body: { ...data, visibility: 1 } });
      toast('已发布', 'ok');
      state.view = 'home';
      await App.render();
    },
  });
};

App.likeMoment = async (id) => {
  try { await socialApi('/moments/' + encodeURIComponent(id) + '/like', { method: 'POST', body: {} }); await App.render(); }
  catch (e) { toast(e.message || '操作失败', 'err'); }
};

App.shareMoment = (id) => {
  const url = location.origin + location.pathname + '#moment-' + id;
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('链接已复制', 'ok')).catch(() => toast(url));
  else toast(url);
};

App.openMoment = (id) => {
  state.view = 'moment';
  state.params = { id };
  renderChrome();
  App.render();
};

async function socialMoment() {
  if (!requireAuth('登录后才能查看动态')) return;
  setMain(loadingHtml('正在读取动态和评论…'));
  try {
    const d = await socialApi('/moments/' + encodeURIComponent(state.params.id));
    const m = itemOf(d);
    const comments = rowsOf(await socialApi('/moments/' + encodeURIComponent(state.params.id) + '/comments').catch(() => ({})));
    setMain('<div class="page social-page"><button class="mini" onclick="App.go(\'home\')">← 返回动态</button>' +
      '<div class="social-layout"><main class="social-feed" style="margin-top:16px">' + momentCard(m) +
      '<section class="section"><div class="section-head"><div><h2>评论</h2><p>' + comments.length + ' 条真实评论</p></div></div>' +
      (comments.length ? comments.map((c) => '<div class="comment"><b>' + esc(c.author_name || c.nickname || c.only_id || '好友') + '</b><p>' + esc(c.content || c.body || '') + '</p><span>' + esc(fmtDate(c.created_at, true)) + '</span></div>').join('') : '<div class="empty">还没有评论，写下第一条。</div>') +
      '<div class="comment-form"><textarea id="comment-input" placeholder="说点什么…"></textarea><button class="btn primary" onclick="App.sendComment()">发表评论</button></div></section></main></div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('动态读取失败', e.message) + '</div>'); }
}

App.sendComment = async () => {
  const input = $('#comment-input');
  const body = input && input.value.trim();
  if (!body) return;
  try {
    await socialApi('/moments/' + encodeURIComponent(state.params.id) + '/comments', { method: 'POST', body: { content: body } });
    input.value = '';
    toast('评论已发表', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '评论失败', 'err'); }
};

async function socialFriends() {
  if (!requireAuth('登录后查看好友')) return;
  setMain(loadingHtml('正在读取好友…'));
  try {
    const friends = await socialRows(UX.routes.friends);
    const requests = await socialRows(UX.routes.friendRequests).catch(() => []);
    const suggest = await socialRows(UX.routes.friendSuggest).catch(() => []);
    setMain('<div class="page social-page">' + pageTitle('好友', '好友、申请和推荐都来自真实关系表') +
      '<section class="section"><div class="section-head"><div><h2>我的好友</h2><p>' + friends.length + ' 位</p></div></div>' +
      (friends.length ? '<div class="friend-grid">' + friends.map((f) => '<div class="friend-card">' + avatar(f.nickname || f.name || f.only_id) +
        '<b>' + esc(f.nickname || f.name || f.only_id) + '</b><span>' + esc(f.bio || f.region || f.signature || '') + '</span>' +
        '<div class="friend-actions"><button class="mini" onclick="App.chatWithFriend(' + JSON.stringify(f.only_id) + ',' + JSON.stringify(f.nickname || f.name || f.only_id) + ')">私聊</button>' +
        '<button class="mini danger" onclick="App.removeFriend(' + JSON.stringify(f.only_id) + ')">删除</button></div></div>').join('') + '</div>' : emptyHtml('还没有好友', '从推荐或搜索里加一个。')) + '</section>' +
      '<section class="section"><div class="section-head"><div><h2>好友申请</h2><p>' + requests.length + ' 条待处理</p></div></div>' +
      (requests.length ? requests.map((r) => '<div class="request-row"><span><b>' + esc(r.nickname || r.name || r.from_only_id || r.only_id) + '</b><em>' + esc(r.message || r.reason || '') + '</em></span>' +
        '<button class="mini" onclick="App.handleFriend(' + JSON.stringify(r.req_id || r.id) + ',\'accept\')">通过</button>' +
        '<button class="mini danger" onclick="App.handleFriend(' + JSON.stringify(r.req_id || r.id) + ',\'reject\')">拒绝</button></div>').join('') : '<div class="empty">没有待处理申请。</div>') + '</section>' +
      '<section class="section"><div class="section-head"><div><h2>可能认识</h2><p>来自好友推荐</p></div></div>' +
      (suggest.length ? '<div class="friend-grid">' + suggest.slice(0, 12).map((f) => '<div class="friend-card">' + avatar(f.nickname || f.name || f.only_id) +
        '<b>' + esc(f.nickname || f.name || f.only_id) + '</b><span>' + esc(f.bio || '') + '</span>' +
        '<button class="mini" onclick="App.addFriend(' + JSON.stringify(f.only_id) + ')">加好友</button></div>').join('') + '</div>' : '<div class="empty">暂时没有推荐。</div>') + '</section>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('好友读取失败', e.message) + '</div>'); }
}

App.addFriend = async (onlyId) => {
  try { await socialApi('/friends/requests', { method: 'POST', body: { to: onlyId, message: '你好，想加你为好友。' } }); toast('申请已发送', 'ok'); }
  catch (e) { toast(e.message || '申请失败', 'err'); }
};
App.handleFriend = async (reqId, action) => {
  try { await socialApi('/friends/requests/' + encodeURIComponent(reqId), { method: 'PUT', body: { action } }); toast('已处理', 'ok'); await App.render(); }
  catch (e) { toast(e.message || '处理失败', 'err'); }
};
App.removeFriend = (onlyId) => App.confirm('确认删除这位好友？').then(async (ok) => {
  if (!ok) return;
  try { await socialApi('/friends/' + encodeURIComponent(onlyId), { method: 'DELETE' }); toast('已删除', 'ok'); await App.render(); }
  catch (e) { toast(e.message || '删除失败', 'err'); }
});

App.chatWithFriend = (onlyId, name) => {
  state.view = 'messages';
  state.params = { peer: onlyId, name };
  renderChrome();
  App.render();
};

async function socialMessages() {
  if (!requireAuth('登录后查看私聊')) return;
  setMain(loadingHtml('正在读取会话…'));
  try {
    const convs = await socialRows(UX.routes.conversations);
    const unread = itemOf(await socialApi('/unread').catch(() => ({})));
    const peer = state.params.peer;
    let thread = [];
    let active = null;
    if (peer) {
      const conv = convs.find((c) => String(c.peer_only_id || c.only_id) === String(peer));
      active = conv || { peer_only_id: peer, peer_name: state.params.name, id: '' };
    } else if (convs[0]) active = convs[0];
    if (active) thread = rowsOf(await socialApi('/messages/' + encodeURIComponent(active.id || active.conv_id), { params: {} }).catch(() => ({})));
    const side = convs.length ? convs.map((c) => '<button class="conv ' + (active && String(c.id) === String(active.id) ? 'on' : '') + '" onclick="App.openSocialChat(' + JSON.stringify(c.id) + ',' + JSON.stringify(c.peer_only_id || c.only_id) + ',' + JSON.stringify(c.peer_name || '') + ')">' +
      avatar(c.peer_name || c.peer_only_id) + '<span class="conv-main"><b>' + esc(c.peer_name || c.peer_only_id) + '</b><em>' + esc(plain(c.last_message, 30) || '') + '</em></span></button>').join('') : '<div class="chat-side-empty">还没有会话</div>';
    const msgs = thread.length ? thread.map((m) => {
      const mine = state.user && String(m.from_only_id || m.sender_only_id) === String(state.user.onlyId);
      return '<div class="bubble-row ' + (mine ? 'mine' : '') + '"><div class="bubble"><p>' + esc(m.content || m.body || '') + '</p><span>' + esc(fmtDate(m.created_at, true)) + '</span></div></div>';
    }).join('') : '<div class="chat-empty small"><h3>还没有消息</h3><p>在下面发第一条。</p></div>';
    setMain('<div class="page chat-page social-page"><div class="chat-shell">' +
      '<aside class="chat-side"><div class="chat-side-head"><b>私聊</b><span>' + (unread.count || unread.unread || 0) + ' 未读</span></div><div class="chat-side-list">' + side + '</div>' +
      '<button class="btn primary chat-new" onclick="App.newSocialChat()">发起私聊</button></aside>' +
      '<main class="chat-main"><div class="chat-thread-head"><div>' + avatar(active && (active.peer_name || active.peer_only_id)) + '<b>' + esc(active ? (active.peer_name || active.peer_only_id) : '选择会话') + '</b></div></div>' +
      '<div class="chat-thread">' + msgs + '</div>' +
      (active ? '<div class="chat-compose"><textarea id="social-input" placeholder="输入消息，Enter 发送"></textarea><button class="btn primary" onclick="App.sendSocial()">发送</button></div>' : '') +
      '</main></div>' + pageFoot() + '</div>');
    const input = $('#social-input');
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.sendSocial(); } };
  } catch (e) { setMain('<div class="page">' + emptyHtml('私聊读取失败', e.message) + '</div>'); }
}

App.openSocialChat = (convId, peer, name) => {
  state.view = 'messages';
  state.params = { conv: convId, peer, name };
  renderChrome();
  App.render();
};

App.sendSocial = async () => {
  const input = $('#social-input');
  const body = input && input.value.trim();
  if (!body) return;
  const peer = state.params.peer || '';
  if (!peer) { toast('缺少对方 only_id', 'err'); return; }
  try {
    await socialApi('/messages', { method: 'POST', body: { to: peer, content: body, body } });
    input.value = '';
    toast('已发送', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '发送失败', 'err'); }
};

App.newSocialChat = () => {
  App.modal({
    title: '发起私聊',
    desc: '输入对方的 only_id。',
    body: '<div class="form"><div class="field"><label>对方 only_id</label><input id="social-to"></div><div class="field"><label>第一条消息</label><textarea id="social-first"></textarea></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.startSocialChat()">发送</button>',
  });
};

App.startSocialChat = async () => {
  const to = ($('#social-to') && $('#social-to').value || '').trim();
  const body = ($('#social-first') && $('#social-first').value || '').trim();
  if (!to || !body) { toast('收件人和消息都要填', 'err'); return; }
  try {
    await socialApi('/messages', { method: 'POST', body: { to, content: body, body } });
    App.closeModal();
    state.view = 'messages';
    state.params = { peer: to, name: to };
    toast('已发送', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '发送失败', 'err'); }
};

async function socialNotifications() {
  if (!requireAuth('登录后查看通知')) return;
  setMain(loadingHtml('正在读取通知…'));
  try {
    const list = await socialRows(UX.routes.notifications);
    const unread = itemOf(await socialApi(UX.routes.unread).catch(() => ({})));
    setMain('<div class="page social-page">' + pageTitle('通知', (unread.count || unread.unread || 0) + ' 条未读') +
      '<div class="toolbar"><span class="spacer"></span><button class="btn ghost" onclick="App.readAll()">全部已读</button></div>' +
      (list.length ? list.map((n) => '<div class="notice ' + (n.is_read ? '' : 'unread') + '"><div class="notice-main"><b>' + esc(n.title || n.type || '通知') + '</b><p>' + esc(n.content || n.body || '') + '</p><span>' + esc(fmtDate(n.created_at, true)) + '</span></div>' +
        '<button class="mini" onclick="App.readNotice(' + JSON.stringify(n.id) + ')">标记已读</button></div>').join('') : emptyHtml('没有通知', '有人点赞、评论或加好友时会出现在这里。')) +
      pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('通知读取失败', e.message) + '</div>'); }
}
App.readAll = async () => {
  try { await socialApi(UX.routes.readAll, { method: 'PUT', body: {} }); toast('已全部标记已读', 'ok'); await App.render(); }
  catch (e) { toast(e.message || '操作失败', 'err'); }
};
App.readNotice = async (id) => {
  try { await socialApi('/notifications/' + encodeURIComponent(id) + '/read', { method: 'PUT', body: {} }); await App.render(); }
  catch (e) { toast(e.message || '操作失败', 'err'); }
};

async function socialProfile() {
  if (!requireAuth('登录后查看资料')) return;
  setMain(loadingHtml('正在读取资料…'));
  try {
    const d = await socialApi('/me');
    const u = itemOf(d);
    const stats = itemOf(await socialApi('/stats').catch(() => ({})));
    setMain('<div class="page social-page">' + pageTitle(u.nickname || u.display_name || '我的资料', u.bio || '') +
      '<div class="profile-grid"><div class="profile-card">' + avatar(u.nickname || u.display_name || '我') +
      '<h3>' + esc(u.nickname || u.display_name || '') + '</h3><p>' + esc(u.bio || '') + '</p>' +
      '<div class="profile-meta"><span>only_id</span><b>' + esc(u.only_id || '') + '</b></div>' +
      '<div class="profile-meta"><span>地区</span><b>' + esc(u.region || '—') + '</b></div>' +
      '<button class="btn ghost" onclick="App.editProfile()">编辑资料</button></div>' +
      '<div class="profile-stats">' + ['moments', 'friends', 'messages', 'notifications'].map((k) => '<div class="kpi"><span>' + esc(k) + '</span><b>' + esc(stats[k] || stats[k + '_count'] || 0) + '</b></div>').join('') + '</div></div>' +
      pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('资料读取失败', e.message) + '</div>'); }
}
App.editProfile = () => {
  App.openForm({
    title: '编辑资料', iface: socialIface('/me', 'PUT'), path: '/me', submitLabel: '保存',
    fields: ['nickname', 'bio', 'region'],
    values: state.user || {},
    onSubmit: async (data) => {
      await socialApi('/me', { method: 'PUT', body: data });
      state.user = Object.assign({}, state.user || {}, data);
      saveSession();
      toast('已保存', 'ok');
      renderChrome();
      await App.render();
    },
  });
};

// ---- 99-boot.js ----
/* 启动与路由：按模式把视图分派到真实页面。 */
function render() {
  if (!state.token && UX.auth && state.view !== 'home') {
    /* 未登录也允许看首页；需要登录的页面由各视图自己 requireAuth。 */
  }
  switch (UX.mode) {
    case 'content':
      if (state.view === 'home') return contentHome();
      if (state.view === 'collection') return contentCollection();
      if (state.view === 'item') return contentItem();
      if (state.view === 'my') return contentMy();
      if (state.view === 'admin') return contentAdmin();
      return contentHome();
    case 'commerce':
      if (state.view === 'home') return commerceHome();
      if (state.view === 'collection') return commerceCollection();
      if (state.view === 'item') return commerceItem();
      if (state.view === 'cart') return commerceCart();
      if (state.view === 'my') return commerceMy();
      if (state.view === 'order') return commerceOrder();
      if (state.view === 'admin') return commerceAdmin();
      return commerceHome();
    case 'catalog':
      if (state.view === 'home') return catalogHome();
      if (state.view === 'collection') return catalogCollection();
      if (state.view === 'item') return catalogItem();
      if (state.view === 'my') return catalogMy();
      if (state.view === 'admin') return catalogAdmin();
      return catalogHome();
    case 'desk':
      if (state.view === 'home') return deskHome();
      if (state.view === 'collection') return deskCollection();
      if (state.view === 'detail') return deskDetail();
      if (state.view === 'board') return deskBoard();
      if (state.view === 'pending') { state.params = { menu: 1 }; return deskCollection(); }
      if (state.view === 'customers') { state.params = { menu: deskMenu().findIndex((m) => m.label.indexOf('客户') >= 0) }; return deskCollection(); }
      if (state.view === 'routes') { state.params = { menu: deskMenu().findIndex((m) => m.label.indexOf('线路') >= 0) }; return deskCollection(); }
      if (state.view === 'alerts') { state.params = { menu: deskMenu().findIndex((m) => m.label.indexOf('告警') >= 0) }; return deskCollection(); }
      return deskHome();
    case 'chat':
      if (state.view === 'thread') return chatThread();
      return chatHome();
    case 'social':
      if (state.view === 'home') return socialHome();
      if (state.view === 'moment') return socialMoment();
      if (state.view === 'friends') return socialFriends();
      if (state.view === 'messages') return socialMessages();
      if (state.view === 'notifications') return socialNotifications();
      if (state.view === 'profile') return socialProfile();
      return socialHome();
    default:
      return contentHome();
  }
}
App.render = render;

function boot() {
  loadSession();
  renderChrome();
  refreshMe().finally(() => { renderChrome(); App.render(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
