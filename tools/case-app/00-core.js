// 作者：yxpil
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

/* 行内事件里的字符串参数：JSON 转义后还要做 HTML 属性转义，避免 onclick="App.f(\"x\")" 截断属性 */
function HQ(v) {
  return String(JSON.stringify(v == null ? '' : v))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  } else if (isNumberField(meta, name)) {
    input = '<input data-field="' + esc(name) + '" type="number" step="any" value="' + esc(value == null ? '' : value) + '" placeholder="' + esc(hint) + '">';
  } else if (isDateField(meta, name)) {
    const v = String(value || '').replace(' ', 'T').slice(0, 16);
    input = '<input data-field="' + esc(name) + '" type="datetime-local" value="' + esc(v) + '">';
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
    '<button data-nav="' + esc(n.view) + '" class="' + (state.view === n.view ? 'on' : '') + '" onclick="App.go(' + HQ(n.view) + ')">' + esc(n.label) + '</button>'
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
    return '<tr onclick="App.openRow(' + HQ(ifaceName) + ',' + idx + ')">' + tds +
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
