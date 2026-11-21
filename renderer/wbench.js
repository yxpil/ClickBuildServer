'use strict';

const api = window.icb;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const S = {
  project: null,
  list: [],
  services: null,
  res: null,
  settings: null,
  cat: '',
  mode: 'grid',
  selId: null,
  tab: 'tables',
  tableKey: '',
  routeId: '',
  help: null,
  genDir: '',
  testCounts: null,
  saveTimer: null,
  saveState: 'saved',
  saveText: '已保存',
  valTimer: null,
  problems: [],
  view: 'api',
  studioProject: null,
  runtimes: [],
  runner: 'node',
  hot: true,
};

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// HTTP 方法用固定色，不跟主题走：扫一眼就能分清增删改查。
const METHOD_TONES = { GET: 'get', HEAD: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', OPTIONS: 'other' };
function methodTone(m) { return METHOD_TONES[String(m || '').toUpperCase()] || 'other'; }
function methodBadge(m, cls) {
  return `<span class="m-badge m-${methodTone(m)}${cls ? ' ' + cls : ''}">${esc(String(m || '').toUpperCase())}</span>`;
}
function fieldTone(type) {
  const key = String(type || '').toLowerCase();
  const meta = fieldTypeMeta(key);
  if (meta && meta.group) return meta.group;
  if (['bigint', 'int', 'smallint', 'tinyint', 'decimal', 'float', 'double', 'number'].includes(key)) return 'number';
  if (['bool', 'boolean'].includes(key)) return 'bool';
  if (['datetime', 'date', 'time', 'timestamp'].includes(key)) return 'time';
  if (['json', 'array', 'object'].includes(key)) return 'json';
  if (['file', 'image', 'video', 'audio', 'pdf', 'doc', 'excel', 'archive'].includes(key)) return 'file';
  if (['token', 'url', 'email', 'phone', 'ip', 'uuid'].includes(key)) return 'semantic';
  return 'text';
}

const TASK_KINDS = {
  mixed: { label: '混合任务', short: '混', hint: '前后端一起写，接口和前端工坊都能用' },
  backend: { label: '只后端任务', short: '后', hint: '只写接口、表结构和脚本，前端入口收起' },
  frontend: { label: '只前端任务', short: '前', hint: '只写页面，接口编辑和生成服务收起' },
};
const TASK_ORDER = ['mixed', 'backend', 'frontend'];
function taskKindOf(p) {
  const t = p && p.taskType;
  return TASK_KINDS[t] ? t : 'mixed';
}
function taskKindMeta(p) {
  return TASK_KINDS[taskKindOf(p)];
}

// 一个窗口里挂多个工程，像 WPS 的文档标签；切换前先把当前工程落盘。
const TABS = { items: [], active: '', key: 'cbs.taskTabs.v1' };

// API 的 spec.TYPES 会在 help 里返回；这里只做未加载时的兜底，避免向导在首屏拿不到类型。
const BASE_FIELD_TYPE_KEYS = [
  'bigint', 'int', 'smallint', 'tinyint', 'bool', 'decimal', 'float', 'double',
  'varchar', 'char', 'text', 'longtext', 'datetime', 'date', 'json',
  'token', 'url', 'file', 'image', 'video', 'audio', 'pdf', 'doc', 'excel', 'archive',
];
const FIELD_TYPE_GROUPS = { number: '数值', text: '文本', time: '时间', semantic: '语义类型', file: '文件 / 文档' };
function fieldTypeList() {
  return (S.help && Array.isArray(S.help.types) && S.help.types.length) ? S.help.types : [];
}
function fieldTypeKeys() {
  const list = fieldTypeList();
  return list.length ? list.map((t) => t.key) : BASE_FIELD_TYPE_KEYS;
}
function fieldTypeMeta(type) {
  return fieldTypeList().find((t) => t.key === type) || null;
}

/* ---------------- SVG 图标 ---------------- */
const I = {
  new: '<path d="M8 3v10M3 8h10"/>',
  open: '<path d="M2 5h5l1.5 2H14v6H2z"/>',
  save: '<path d="M3 3h8l3 3v8H3z"/><path d="M5 3v4h5V3M5 11h6"/>',
  iface: '<rect x="2.5" y="3.5" width="11" height="9"/><path d="M2.5 6.5h11"/>',
  trash: '<path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9"/>',
  copy: '<rect x="2.5" y="2.5" width="8" height="8"/><path d="M6 13.5h7.5V6"/>',
  table: '<rect x="2" y="2.5" width="12" height="11"/><path d="M2 6h12M2 9.5h12M5.5 6v7.5M10 6v7.5"/>',
  field: '<path d="M2 8h12M8 2v12"/><circle cx="8" cy="8" r="4.5"/>',
  check: '<path d="M2 8.5l4 4 8-9"/>',
  sql: '<path d="M5 3L2 8l3 5M11 3l3 5-3 5"/>',
  play: '<path d="M4 2.5l9 5.5-9 5.5z"/>',
  stop: '<rect x="4" y="4" width="8" height="8"/>',
  console: '<rect x="2" y="3" width="12" height="10"/><path d="M4.5 6l2 2-2 2M8 10h3"/>',
  grid: '<rect x="2" y="2.5" width="12" height="11"/><path d="M2 6h12M6 6v7.5M10 6v7.5"/>',
  more: '<circle cx="3" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="13" cy="8" r="1.1"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.2 2.4c-.4.3-.5.7-.5 1.1M8 11.6v.2"/>',
  page: '<path d="M3 2h7l3 3v9H3z"/><path d="M6 6h4M6 9h4M6 12h3"/>',
  package: '<path d="M8 2l6 3v6l-6 3-6-3V5z"/><path d="M2 5l6 3 6-3M8 8v6"/>',
  star: '<path d="M8 2.2l1.75 3.55 3.92.57-2.84 2.77.67 3.9L8 11.14l-3.5 1.85.67-3.9L2.33 6.32l3.92-.57z"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/>',
};
const icon = (k) => `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${I[k] || I.page}</svg>`;

function rb(action, ic, label, title) {
  return `<div class="rb" data-action="${action}" title="${esc(title || label)}">${icon(ic)}<span class="t">${esc(label)}</span></div>`;
}

/* ---------------- 基础工具 ---------------- */
function toast(msg, ms) {
  const el = $('#toast');
  el.textContent = window.__i18n && window.__i18n.translate ? window.__i18n.translate(msg) : msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms || 2200);
}

function modal(html, mount, opts) {
  const box = $('#modal');
  const o = opts || {};
  const width = Number(o.width) || 640;
  const maxHeight = o.maxHeight || '80vh';
  const frameClass = o.plain ? 'bg-white border-0' : 'bg-white border border-neutral-900';
  const frameStyle = `width:${width}px;max-width:96vw;max-height:${maxHeight}` + (o.plain ? ';border-radius:12px;box-shadow:0 24px 70px rgba(32,36,43,.22)' : '');
  box.classList.remove('hidden');
  box.innerHTML = `<div class="${frameClass} overflow-auto" style="${frameStyle}">${html}</div>`;
  if (mount) mount(box.firstElementChild);
  if (window.__i18n && window.__i18n.apply) window.__i18n.apply(document);
  return box;
}
function closeModal() {
  const box = $('#modal');
  box.classList.add('hidden');
  box.innerHTML = '';
}

function ask(title, value, hint) {
  return new Promise((resolve) => {
    modal(`<div class="p-4">
      <div class="text-[13px] font-semibold mb-3">${esc(title)}</div>
      <input id="askIn" class="w-full border border-neutral-900 px-2 py-1 mono" value="${esc(value || '')}">
      ${hint ? `<div class="text-[11px] text-neutral-500 mt-2">${esc(hint)}</div>` : ''}
      <div class="flex justify-end gap-2 mt-4">
        <button class="btn thin" id="askNo">取消</button>
        <button class="btn solid" id="askYes">确定</button>
      </div></div>`, (root) => {
      const input = root.querySelector('#askIn');
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') root.querySelector('#askYes').click(); });
      root.querySelector('#askNo').onclick = () => { closeModal(); resolve(null); };
      root.querySelector('#askYes').onclick = () => { const v = input.value.trim(); closeModal(); resolve(v || null); };
    });
  });
}

function confirmBox(title, text) {
  return new Promise((resolve) => {
    modal(`<div class="p-4">
      <div class="text-[13px] font-semibold mb-2">${esc(title)}</div>
      <div class="text-[12px] text-neutral-700 mb-4">${esc(text || '')}</div>
      <div class="flex justify-end gap-2">
        <button class="btn thin" id="cNo">取消</button>
        <button class="btn solid" id="cYes">确定</button>
      </div></div>`, (root) => {
      root.querySelector('#cNo').onclick = () => { closeModal(); resolve(false); };
      root.querySelector('#cYes').onclick = () => { closeModal(); resolve(true); };
    });
  });
}

const GUIDE_STEPS = [
  { title: '基础信息', hint: '从常用接口复制，或新建' },
  { title: '主表', hint: '表名与初始业务字段' },
  { title: '路由', hint: '选择要生成的基础路由' },
  { title: '确认', hint: '检查后才会写入工程' },
];
const GUIDE_ROUTE_DEFS = [
  { key: 'list', name: '列表', method: 'GET', path: '/:table', desc: '分页查询，支持搜索与缓存' },
  { key: 'detail', name: '详情', method: 'GET', path: '/:table/:id', desc: '按主键查询单条记录' },
  { key: 'create', name: '新建', method: 'POST', path: '/:table', desc: '插入记录，事务保护' },
  { key: 'update', name: '更新', method: 'PUT', path: '/:table/:id', desc: '按主键更新记录' },
  { key: 'delete', name: '删除', method: 'DELETE', path: '/:table/:id', desc: '按主键删除记录' },
];
const GUIDE_PRESETS = [
  { name: 'name', type: 'varchar', comment: '名称' },
  { name: 'title', type: 'varchar', comment: '标题' },
  { name: 'status', type: 'tinyint', comment: '状态' },
  { name: 'amount', type: 'decimal', comment: '金额' },
  { name: 'remark', type: 'text', comment: '备注' },
];

function guideFields(text) {
  const fields = [];
  const errors = [];
  const seen = new Set();
  const reserved = new Set(['id', 'created_at', 'updated_at']);
  const types = fieldTypeKeys();
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim();
    if (!raw) return;
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:[\s,，]+([A-Za-z]+))?(?:[\s,，]+(.+))?$/);
    if (!m) { errors.push(`第 ${i + 1} 行格式不对，应为「字段名 类型 注释」`); return; }
    const name = m[1].toLowerCase();
    if (reserved.has(name)) { errors.push(`字段 ${name} 由系统自动创建，不用重复填写`); return; }
    if (seen.has(name)) { errors.push(`字段 ${name} 重复`); return; }
    const type = (m[2] || 'varchar').toLowerCase();
    if (!types.includes(type)) { errors.push(`字段 ${name} 的类型 ${type} 不支持`); return; }
    seen.add(name);
    fields.push({ name, type, comment: (m[3] || '').trim() });
  });
  return { fields, errors };
}

function guideBasePath(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/+$/, '');
}

async function newIfaceGuide(initialCat) {
  const cats = (S.project.categories || []).slice();
  let favoriteLib = [];
  try {
    const lib = await api.ifaceLibrary();
    if (lib && lib.ok) favoriteLib = (lib.list || []).filter((x) => x.favorite);
  } catch (_) {}
  const state = {
    step: 0,
    name: '',
    categoryId: initialCat || S.cat || (cats[0] && cats[0].id) || 'biz',
    prefix: '',
    comment: '',
    tableName: '',
    tableComment: '',
    fieldText: 'name varchar 名称',
    routeKinds: GUIDE_ROUTE_DEFS.map((r) => r.key),
    authMode: 'none',
    fields: [],
  };
  return new Promise((resolve) => {
    let done = false;
    const shell = `<div class="guide-shell flex flex-col" style="height:648px;max-height:88vh">
      <style>
        .guide-shell{font-size:12px;color:var(--cb-text);background:#fff;border-radius:12px;overflow:hidden;font-family:var(--cb-font)}
        .guide-head{display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid var(--cb-line);background:#fff}
        .guide-head-mark{width:32px;height:32px;border-radius:9px;background:var(--cb-accent-soft);color:var(--cb-accent);display:flex;align-items:center;justify-content:center;flex:none}
        .guide-head-mark svg{width:16px;height:16px}
        .guide-title{font-size:15px;font-weight:600;letter-spacing:-.01em;line-height:1.35}
        .guide-sub{font-size:11px;color:var(--cb-muted);margin-top:3px;line-height:1.45}
        .guide-head-right{margin-left:auto;display:flex;align-items:center;gap:10px}
        .guide-head-chip{height:24px;padding:0 9px;border:1px solid var(--cb-line);border-radius:999px;background:#f8fafc;color:var(--cb-muted);font-size:10px;display:flex;align-items:center;letter-spacing:.04em}
        .guide-main{flex:1;min-height:0;display:flex;background:#fff}
        .guide-rail{width:190px;flex:none;padding:14px 12px;background:#f7f9fc;border-right:1px solid var(--cb-line);overflow:auto}
        .guide-rail-note{font-size:10px;color:var(--cb-muted);padding:0 6px 10px;letter-spacing:.02em}
        .guide-step{position:relative;display:flex;align-items:flex-start;gap:10px;padding:10px 10px;border:1px solid transparent;border-radius:8px;margin-bottom:4px;color:var(--cb-text-2);transition:background .15s,border-color .15s,box-shadow .15s}
        .guide-step + .guide-step:before{content:"";position:absolute;left:26px;top:-5px;width:1px;height:4px;background:#dfe5ee}
        .guide-step.is-active{background:#fff;border-color:#dbe6fb;box-shadow:0 1px 2px rgba(32,36,43,.05),inset 3px 0 0 var(--cb-accent)}
        .guide-step.is-done{color:var(--cb-text)}
        .guide-step-index{width:22px;height:22px;flex:none;border-radius:50%;border:1px solid #d7dde7;background:#fff;color:var(--cb-muted);display:flex;align-items:center;justify-content:center;font:600 10px/1 Consolas,monospace;margin-top:1px}
        .guide-step.is-active .guide-step-index{background:var(--cb-accent);border-color:var(--cb-accent);color:#fff;box-shadow:0 0 0 3px rgba(47,107,220,.10)}
        .guide-step.is-done .guide-step-index{background:var(--cb-accent-soft);border-color:#c9daf7;color:var(--cb-accent)}
        .guide-step-title{font-size:12px;font-weight:600;line-height:1.4}
        .guide-step.is-active .guide-step-title{color:var(--cb-text)}
        .guide-step-hint{font-size:10px;color:var(--cb-muted);line-height:1.5;margin-top:2px}
        .guide-body{flex:1;min-width:0;overflow:auto;padding:22px 24px 20px}
        .guide-h{font-size:15px;font-weight:600;letter-spacing:-.01em;line-height:1.4}
        .guide-p{font-size:11px;color:var(--cb-muted);line-height:1.65;margin-top:4px;margin-bottom:18px}
        .guide-label{display:flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:var(--cb-text);margin-bottom:6px}
        .guide-req{color:#b52b2b;font-weight:600}
        .guide-input,.guide-select,.guide-textarea{width:100%;min-height:34px;border:1px solid #dfe4ec;border-radius:7px;background:#fff;padding:6px 10px;font-size:12px;color:var(--cb-text);transition:border-color .15s,box-shadow .15s}
        .guide-input:hover,.guide-select:hover,.guide-textarea:hover{border-color:#ccd4e0}
        .guide-input:focus,.guide-select:focus,.guide-textarea:focus{border-color:var(--cb-accent);box-shadow:0 0 0 3px rgba(47,107,220,.10);outline:none}
        .guide-textarea{min-height:120px;line-height:1.65;resize:vertical;padding:9px 10px}
        .guide-help{font-size:10px;color:var(--cb-muted);line-height:1.6;margin-top:5px}
        .guide-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .guide-field{margin-bottom:16px}
        .guide-input-group{display:flex;align-items:stretch;border:1px solid #dfe4ec;border-radius:7px;overflow:hidden;background:#fff;transition:border-color .15s,box-shadow .15s}
        .guide-input-group:focus-within{border-color:var(--cb-accent);box-shadow:0 0 0 3px rgba(47,107,220,.10)}
        .guide-input-prefix{display:flex;align-items:center;padding:0 10px;background:#f7f9fc;border-right:1px solid var(--cb-line);color:var(--cb-muted);font:10px/1 Consolas,monospace;flex:none}
        .guide-input-group input{flex:1;min-width:0;border:0;box-shadow:none!important;border-radius:0;padding:6px 10px;font:11px/1.5 Consolas,monospace}
        .guide-note{border:1px solid var(--cb-line);background:#f8fafc;border-radius:8px;padding:10px 12px;color:var(--cb-text-2);font-size:11px;line-height:1.65}
        .guide-note-blue{border-color:#dbe6fb;background:var(--cb-accent-soft);color:#35507a}
        .guide-quick{border:1px solid #f1dfb4;background:#fffbf1;border-radius:9px;padding:12px 13px;margin-bottom:16px}
        .guide-quick-head{display:flex;align-items:flex-start;gap:9px}
        .guide-quick-mark{width:28px;height:28px;border-radius:7px;background:#fff3d6;color:#d99a20;display:flex;align-items:center;justify-content:center;flex:none}
        .guide-quick-mark svg{width:14px;height:14px}
        .guide-quick-title{font-size:12px;font-weight:600;color:#5e4a1c;line-height:1.4}
        .guide-quick-sub{font-size:10px;color:#8a7a52;line-height:1.55;margin-top:2px}
        .guide-quick-row{display:flex;gap:8px;margin-top:10px}
        .guide-quick-row select{flex:1;min-width:0;height:32px;border:1px solid #e7d7b0;border-radius:7px;background:#fff;padding:0 8px;font-size:11.5px;color:#4c422e;outline:none}
        .guide-quick-row select:focus{border-color:#d99a20;box-shadow:0 0 0 3px rgba(217,154,32,.12)}
        .guide-quick-row .btn{height:32px;white-space:nowrap}
        .guide-quick-or{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:#9aa3b2;font-size:10px}
        .guide-quick-or:before,.guide-quick-or:after{content:"";height:1px;background:#e6eaf0;flex:1}
        .guide-route-list{border:1px solid var(--cb-line);border-radius:9px;overflow:hidden;background:#fff}
        .guide-route-item{display:flex;align-items:center;gap:12px;padding:11px 13px;cursor:pointer;border-bottom:1px solid var(--cb-line-soft);transition:background .12s}
        .guide-route-item:last-child{border-bottom:0}
        .guide-route-item:hover{background:#f8fafc}
        .guide-route-item input{width:14px;height:14px;accent-color:var(--cb-accent);flex:none}
        .guide-route-path{font:10.5px/1.5 Consolas,monospace;color:var(--cb-muted);margin-left:8px}
        .guide-route-desc{display:block;font-size:10px;color:var(--cb-muted);margin-top:2px}
        .guide-chip{display:inline-flex;align-items:center;height:22px;padding:0 7px;border:1px solid var(--cb-line);border-radius:5px;background:#f8fafc;color:var(--cb-text-2);font:10px/1 Consolas,monospace}
        .guide-preset{height:26px;border:1px solid var(--cb-line);border-radius:6px;background:#fff;color:var(--cb-text-2);font-size:10.5px;padding:0 8px}
        .guide-preset:hover{background:var(--cb-accent-soft);border-color:#c9daf7;color:var(--cb-accent)}
        .guide-review{border:1px solid var(--cb-line);border-radius:9px;overflow:hidden;background:#fff}
        .guide-review-row{display:grid;grid-template-columns:120px minmax(0,1fr);border-bottom:1px solid var(--cb-line-soft)}
        .guide-review-row:last-child{border-bottom:0}
        .guide-review-k{padding:9px 12px;background:#f8fafc;color:var(--cb-muted);font-size:11px;border-right:1px solid var(--cb-line-soft)}
        .guide-review-v{padding:9px 12px;font-size:12px;color:var(--cb-text);min-width:0;word-break:break-all}
        .guide-foot{display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid var(--cb-line);background:#fafbfd}
        .guide-foot-err{flex:1;min-width:0;color:#b52b2b;font-size:11px;line-height:1.45}
        .guide-pos{height:26px;padding:0 9px;border:1px solid var(--cb-line);border-radius:999px;background:#fff;color:var(--cb-muted);font:10px/1 Consolas,monospace;display:flex;align-items:center;flex:none}
        .guide-shell .btn{height:34px;border-radius:7px;font-size:12px}
        .guide-shell .btn.solid{padding:0 16px}
        .guide-shell .btn.thin{padding:0 13px}
      </style>
      <div class="guide-head">
        <div class="guide-head-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h14M5 12h8M5 17h5"/><path d="M17 15v4M15 17h4"/></svg></div>
        <div>
          <div class="guide-title">新建接口 · 创建引导</div>
          <div class="guide-sub">四步完成基础配置，最后确认才会写入工程</div>
        </div>
        <div class="guide-head-right">
          <span class="guide-head-chip">4 STEPS</span>
          <button class="btn thin" id="guideClose">关闭</button>
        </div>
      </div>
      <div class="guide-main">
        <aside id="guideRail" class="guide-rail"></aside>
        <section id="guideBody" class="guide-body"></section>
      </div>
      <div class="guide-foot">
        <span id="guideErr" class="guide-foot-err"></span>
        <span id="guidePos" class="guide-pos mono"></span>
        <button class="btn thin" id="guidePrev">上一步</button>
        <button class="btn solid" id="guideNext">下一步</button>
        <button class="btn solid" id="guideCreate">确认创建</button>
      </div>
    </div>`;
    modal(shell, mount, { width: 820, maxHeight: '86vh', plain: true });

    function mount(root) {
      const rail = root.querySelector('#guideRail');
      const body = root.querySelector('#guideBody');
      const err = root.querySelector('#guideErr');
      const pos = root.querySelector('#guidePos');
      const prev = root.querySelector('#guidePrev');
      const next = root.querySelector('#guideNext');
      const create = root.querySelector('#guideCreate');

      const finish = (value) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey);
        closeModal();
        resolve(value);
      };
      const fail = (msg) => { err.textContent = msg || ''; };
      const clear = () => fail('');
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      };
      document.addEventListener('keydown', onKey);

      function read() {
        const g = (id) => root.querySelector('#' + id);
        if (g('guideName')) {
          state.name = g('guideName').value.trim();
          state.categoryId = g('guideCat').value;
          state.prefix = g('guidePrefix').value.trim();
          state.comment = g('guideComment').value.trim();
        }
        if (g('guideTable')) {
          state.tableName = g('guideTable').value.trim();
          state.tableComment = g('guideTableComment').value.trim();
          state.fieldText = g('guideFields').value;
          const parsed = guideFields(state.fieldText);
          state.fields = parsed.fields;
          state.fieldErrors = parsed.errors;
        }
        if (root.querySelector('[data-guide-route]')) {
          state.routeKinds = Array.from(root.querySelectorAll('[data-guide-route]:checked')).map((x) => x.value);
          state.authMode = g('guideAuth').value;
        }
      }

      function tableError() {
        const name = state.tableName;
        if (!name) return '';
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) return '主表名只能使用字母、数字和下划线，且不能以数字开头';
        const low = name.toLowerCase();
        const owner = S.project.interfaces.find((it) => it.tables.some((t) => String(t.name).toLowerCase() === low));
        if (owner) return `表名 ${name} 已被接口「${owner.name}」使用`;
        return '';
      }

      function validate(step) {
        if (step === 0) {
          if (!state.name) return '请填写接口名称';
          if (S.project.interfaces.some((it) => String(it.name).trim().toLowerCase() === state.name.toLowerCase())) return `接口名「${state.name}」已存在`;
          if (state.prefix && !/^[A-Za-z0-9_./-]+$/.test(guideBasePath(state.prefix))) return '路径前缀只能使用字母、数字、下划线、斜杠、点和短横线';
        }
        if (step === 1) {
          const te = tableError();
          if (te) return te;
          const parsed = guideFields(state.fieldText);
          if (parsed.errors.length) return parsed.errors[0];
        }
        if (step === 2 && !state.routeKinds.length) return '至少保留一条路由，否则接口没有可用入口';
        return '';
      }

      function routePath(def) {
        return def.path.replace(':table', state.tableName || '主表名');
      }

      function renderRail() {
        rail.innerHTML = `<div class="guide-rail-note">创建流程</div>` + GUIDE_STEPS.map((s, i) => {
          const active = i === state.step;
          const passed = i < state.step;
          return `<div class="guide-step ${active ? 'is-active' : ''} ${passed ? 'is-done' : ''}">
            <span class="guide-step-index">${passed ? '✓' : i + 1}</span>
            <div class="min-w-0">
              <div class="guide-step-title">${s.title}</div>
              <div class="guide-step-hint">${s.hint}</div>
            </div>
          </div>`;
        }).join('');
      }

      function fieldPreview() {
        const p = guideFields(state.fieldText);
        if (p.errors.length) return `<div class="text-[11px] text-red-700 mt-2">${esc(p.errors[0])}</div>`;
        if (!p.fields.length) return `<div class="guide-help mt-2">不填业务字段：只保留 id、created_at、updated_at。</div>`;
        return `<div class="mt-2 flex flex-wrap gap-1">${p.fields.map((f) => `<span class="guide-chip">${esc(f.name)} · ${esc(f.type)}</span>`).join('')}</div>`;
      }

      function renderBody() {
        if (state.step === 0) {
          const quick = favoriteLib.length
            ? `<div class="guide-quick">
                <div class="guide-quick-head">
                  <span class="guide-quick-mark">${icon('star')}</span>
                  <div><div class="guide-quick-title">从常用接口开始</div><div class="guide-quick-sub">直接完整复制已编辑好的表、字段、路由、脚本和文档；不会进入后面三步。</div></div>
                </div>
                <div class="guide-quick-row">
                  <select id="guideLibPick">${favoriteLib.map((x) => `<option value="${esc(x.id)}">${esc(x.category)} · ${esc(x.name)}（${x.counts.tables} 表 / ${x.counts.routes} 路由）</option>`).join('')}</select>
                  <button type="button" class="btn solid" id="guideLibUse">用这个接口</button>
                </div>
              </div>`
            : `<div class="guide-quick">
                <div class="guide-quick-head">
                  <span class="guide-quick-mark">${icon('star')}</span>
                  <div><div class="guide-quick-title">从常用接口开始</div><div class="guide-quick-sub">还没有收藏的常用接口。可以在接口编辑器里点「存为常用接口」，或在接口库里点亮星标后再来选用。</div></div>
                </div>
              </div>`;
          body.innerHTML = `
            ${quick}
            <div class="guide-quick-or">或从空白接口开始</div>
            <div class="guide-h">第一步 · 基础信息</div>
            <div class="guide-p">这些内容会出现在接口列表、文档和生成的路由前缀里。</div>
            <div class="guide-field">
              <label class="guide-label">接口名称 <span class="guide-req">*</span></label>
              <input id="guideName" class="guide-input" autocomplete="off" value="${esc(state.name)}" placeholder="例如：商品、订单、会员">
              <div class="guide-help">当前工程里不能重名；名称确定后不建议再改。</div>
            </div>
            <div class="guide-grid2 guide-field">
              <div>
                <label class="guide-label">分类</label>
                <select id="guideCat" class="guide-select">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === state.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              </div>
              <div>
                <label class="guide-label">路径前缀</label>
                <div class="guide-input-group">
                  <span class="guide-input-prefix">/api</span>
                  <input id="guidePrefix" autocomplete="off" value="${esc(state.prefix)}" placeholder="/v1/products">
                </div>
                <div class="guide-help">可留空；最终地址 = /api + 前缀 + 路由路径。</div>
              </div>
            </div>
            <div class="guide-field">
              <label class="guide-label">一句话说明</label>
              <input id="guideComment" class="guide-input" value="${esc(state.comment)}" placeholder="例如：商品的上架、库存与价格维护">
            </div>
          `;
          const name = body.querySelector('#guideName');
          name.focus();
          name.select();
          const sync = () => read();
          body.querySelectorAll('#guideName,#guidePrefix,#guideComment').forEach((el) => el.addEventListener('input', sync));
          body.querySelector('#guideCat').addEventListener('change', sync);
          const libUse = body.querySelector('#guideLibUse');
          if (libUse) {
            libUse.onclick = () => {
              const pick = body.querySelector('#guideLibPick');
              const item = favoriteLib.find((x) => x.id === pick.value);
              if (!item) return fail('请选择一个常用接口');
              finish({ fromLibraryId: item.id, fromLibraryName: item.name, fromLibraryCategory: item.category });
            };
          }
        } else if (state.step === 1) {
          body.innerHTML = `
            <div class="guide-h">第二步 · 主表</div>
            <div class="guide-p">接口会自动带上一张主表，表键固定为 main，创建后仍可继续加字段。</div>
            <div class="guide-grid2 guide-field">
              <div>
                <label class="guide-label">主表名</label>
                <input id="guideTable" class="guide-input mono" autocomplete="off" value="${esc(state.tableName)}" placeholder="留空自动生成">
                <div class="guide-help">表名全局唯一，只能使用字母、数字和下划线。</div>
              </div>
              <div>
                <label class="guide-label">表注释</label>
                <input id="guideTableComment" class="guide-input" value="${esc(state.tableComment)}" placeholder="例如：商品主表">
                <div class="guide-help">会显示在表结构页和接口文档里。</div>
              </div>
            </div>
            <div class="guide-field">
              <label class="guide-label">初始业务字段</label>
              <div class="guide-help" style="margin-top:-2px;margin-bottom:7px">每行一个，格式：字段名 类型 注释。系统已自动加入 id、created_at、updated_at。</div>
              <textarea id="guideFields" rows="6" class="guide-textarea mono" placeholder="title varchar 标题&#10;price decimal 价格">${esc(state.fieldText)}</textarea>
              <div id="guideFieldPreview">${fieldPreview()}</div>
              <div class="flex flex-wrap gap-1 mt-2">${GUIDE_PRESETS.map((p, i) => `<button type="button" class="guide-preset" data-guide-preset="${i}">+ ${esc(p.comment)}</button>`).join('')}</div>
            </div>
          `;
          const ta = body.querySelector('#guideFields');
          ta.addEventListener('input', () => {
            state.fieldText = ta.value;
            body.querySelector('#guideFieldPreview').innerHTML = fieldPreview();
          });
          body.querySelectorAll('[data-guide-preset]').forEach((b) => {
            b.onclick = () => {
              const p = GUIDE_PRESETS[Number(b.dataset.guidePreset)];
              const parsed = guideFields(ta.value);
              if (parsed.fields.some((f) => f.name === p.name)) { fail(`字段 ${p.name} 已在列表里`); return; }
              clear();
              ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' : '') + `${p.name} ${p.type} ${p.comment}`;
              state.fieldText = ta.value;
              body.querySelector('#guideFieldPreview').innerHTML = fieldPreview();
            };
          });
          body.querySelector('#guideTable').addEventListener('input', read);
          body.querySelector('#guideTableComment').addEventListener('input', read);
        } else if (state.step === 2) {
          const t = state.tableName || '主表名';
          body.innerHTML = `
            <div class="guide-h">第三步 · 路由</div>
            <div class="guide-p">选择要生成的基础路由，创建后仍可逐条修改脚本和路径。</div>
            <div class="guide-route-list">
              ${GUIDE_ROUTE_DEFS.map((r) => `<label class="guide-route-item">
                <input type="checkbox" data-guide-route value="${r.key}" ${state.routeKinds.includes(r.key) ? 'checked' : ''}>
                <span class="m-badge m-${r.method.toLowerCase()}">${r.method}</span>
                <span class="flex-1 min-w-0">
                  <span class="font-medium">${r.name}</span>
                  <span class="guide-route-path">${esc('/api' + guideBasePath(state.prefix) + routePath(r).replace(':table', t))}</span>
                  <span class="guide-route-desc">${r.desc}</span>
                </span>
              </label>`).join('')}
            </div>
            <div class="guide-grid2" style="margin-top:16px">
              <div>
                <label class="guide-label">接口鉴权</label>
                <select id="guideAuth" class="guide-select">
                  <option value="none" ${state.authMode === 'none' ? 'selected' : ''}>公开，不校验 token</option>
                  <option value="write" ${state.authMode === 'write' ? 'selected' : ''}>写操作需要 token</option>
                  <option value="all" ${state.authMode === 'all' ? 'selected' : ''}>全部需要 token</option>
                </select>
              </div>
              <div class="guide-note guide-note-blue" style="display:flex;align-items:center">
                已选 <b id="guideRouteCount" style="margin:0 4px">${state.routeKinds.length}</b> 条路由；列表与详情默认启用 60 秒缓存。
              </div>
            </div>
          `;
          body.querySelectorAll('[data-guide-route]').forEach((cb) => {
            cb.addEventListener('change', () => {
              read();
              const el = body.querySelector('#guideRouteCount');
              if (el) el.textContent = state.routeKinds.length;
            });
          });
          body.querySelector('#guideAuth').addEventListener('change', read);
        } else {
          const parsed = guideFields(state.fieldText);
          const authText = state.authMode === 'all' ? '全部路由需要 token' : state.authMode === 'write' ? '写操作需要 token' : '公开';
          const category = cats.find((c) => c.id === state.categoryId);
          const base = guideBasePath(state.prefix);
          body.innerHTML = `
            <div class="guide-h">第四步 · 确认创建</div>
            <div class="guide-p">下面只是预览，点「确认创建」之前不会写入工程。</div>
            <div class="guide-review">
              <div class="guide-review-row"><div class="guide-review-k">接口</div><div class="guide-review-v font-medium">${esc(state.name)}</div></div>
              <div class="guide-review-row"><div class="guide-review-k">分类</div><div class="guide-review-v">${esc(category ? category.name : state.categoryId)}</div></div>
              <div class="guide-review-row"><div class="guide-review-k">路径前缀</div><div class="guide-review-v mono">${esc(base || '（无）')}</div></div>
              <div class="guide-review-row"><div class="guide-review-k">主表</div><div class="guide-review-v mono">${esc(state.tableName || '自动生成')} · main</div></div>
              <div class="guide-review-row"><div class="guide-review-k">业务字段</div><div class="guide-review-v mono text-[11px]">${parsed.fields.length ? parsed.fields.map((f) => esc(f.name)).join(' / ') : '无（仅 id 与时间戳）'}</div></div>
              <div class="guide-review-row"><div class="guide-review-k">路由</div><div class="guide-review-v">${state.routeKinds.length} 条 · ${esc(authText)}</div></div>
              <div class="guide-review-row"><div class="guide-review-k">示例地址</div><div class="guide-review-v mono text-[11px]">${esc('/api' + base + (state.routeKinds.includes('list') ? '/' + (state.tableName || '主表名') : '/...'))}</div></div>
            </div>
            <div class="guide-note guide-note-blue" style="margin-top:14px">
              创建后会自动打开接口编辑器；主表、字段、路由和文档都可以继续修改。取消或关闭窗口不会产生任何改动。
            </div>
          `;
        }
        pos.textContent = `${state.step + 1} / ${GUIDE_STEPS.length}`;
        prev.style.visibility = state.step === 0 ? 'hidden' : 'visible';
        next.classList.toggle('hidden', state.step === GUIDE_STEPS.length - 1);
        create.classList.toggle('hidden', state.step !== GUIDE_STEPS.length - 1);
        err.textContent = '';
        renderRail();
      }

      function go(delta) {
        read();
        if (delta > 0) {
          const msg = validate(state.step);
          if (msg) { fail(msg); return; }
        }
        if (state.step === 1 && state.tableName) state.tableName = state.tableName.toLowerCase();
        state.step = Math.max(0, Math.min(GUIDE_STEPS.length - 1, state.step + delta));
        renderBody();
        if (state.step === 1 && body.querySelector('#guideTable')) body.querySelector('#guideTable').focus();
      }

      prev.onclick = () => go(-1);
      next.onclick = () => go(1);
      root.querySelector('#guideClose').onclick = () => finish(null);
      create.onclick = () => {
        read();
        const msg = validate(0) || validate(1) || validate(2);
        if (msg) { fail(msg); return; }
        finish({
          name: state.name,
          categoryId: state.categoryId,
          basePath: guideBasePath(state.prefix),
          comment: state.comment,
          tableName: state.tableName,
          tableComment: state.tableComment,
          fields: guideFields(state.fieldText).fields,
          routeKinds: state.routeKinds.slice(),
          authMode: state.authMode,
        });
      };
      renderBody();
    }
  });
}

const ifaceOf = (id) => S.project.interfaces.find((i) => i.id === id);
const activeIface = () => ifaceOf(S.selId) || S.project.interfaces.find((i) => i.categoryId === S.cat) || S.project.interfaces[0];

function tableOfIface(iface, key) {
  if (!iface) return null;
  return iface.tables.find((t) => t.key === key) || iface.tables[0];
}

const IO_RESPONSES = [
  ['json', '返回 JSON'],
  ['cookie', 'Cookie 会话'],
  ['file', '文件上传'],
  ['object', '对象列表'],
  ['proxy', '上游代理'],
  ['crawl', '网页抓取'],
];
const IO_STORES = [
  ['none', '不额外存储'],
  ['mysql', 'MySQL 表'],
  ['redis', 'Redis'],
  ['memory', '进程内存'],
  ['s3', 'S3 对象存储'],
];
const IO_FILE_KINDS = [
  ['any', '任意文件'],
  ['image', '图片'],
  ['video', '视频'],
  ['audio', '音频'],
  ['document', '文档'],
  ['pdf', 'PDF'],
  ['archive', '压缩包'],
];
function ioTypesOf() {
  return (S.project && Array.isArray(S.project.ioTypes)) ? S.project.ioTypes : [];
}
function ioTypeOf(id) {
  return ioTypesOf().find((x) => x.id === id) || ioTypesOf()[0] || null;
}
function ioOfRoute(r) {
  const io = (r && r.io) || {};
  return {
    typeId: io.typeId || (r && r.key === 'upload' ? 'file' : (r && r.key === 'objects' ? 'object' : (r && r.key === 'proxy' ? 'proxy' : 'json'))),
    response: io.response || 'json',
    storage: io.storage || 'none',
    fileKind: io.fileKind || 'any',
    maxMb: Number(io.maxMb || 0),
    tableKey: io.tableKey || 'main',
    field: io.field || '',
    autoBind: io.autoBind != null ? !!io.autoBind : io.response === 'file',
    cookieName: io.cookieName || '',
    ttl: Number(io.ttl || 0),
    cookiePath: io.cookiePath || '/',
    httpOnly: io.httpOnly !== false,
    sameSite: io.sameSite || 'Lax',
    prefix: io.prefix || '',
    bucket: io.bucket || '',
  };
}
function applyIoType(it, r, typeId) {
  const type = ioTypeOf(typeId);
  if (!type) return;
  const io = ioOfRoute(r);
  ['response', 'storage', 'fileKind', 'maxMb', 'tableKey', 'field', 'autoBind', 'cookieName', 'ttl', 'prefix'].forEach((k) => { io[k] = type[k]; });
  io.typeId = type.id;
  r.io = io;
  if (type.response === 'cookie') {
    S.project.token = S.project.token || {};
    if (!r.io.cookieName) r.io.cookieName = (S.project.token && S.project.token.cookie) || 'icb_token';
  }
  if (type.response === 'file') {
    const target = tableOfIface(it, type.tableKey);
    if (target && type.field && !target.fields.some((f) => f.name === type.field)) {
      target.fields.push({ name: type.field, type: 'varchar', comment: '对象键（S3 key）', pk: false, autoIncrement: false, nullable: true, search: false, hidden: true, query: false, writable: true, default: '' });
      if (it.storage) it.storage.bindField = type.field;
    }
  }
  if (type.storage === 'redis' && type.response === 'json') {
    r.cache = r.cache || { enabled: true, key: 'icb:{{t:main}}:{{queryHash}}', ttl: Number(type.ttl || 60) };
    r.cache.enabled = true;
    r.cache.ttl = Number(type.ttl || 60);
  }
}
function paramsOfRoute(it, r) {
  const out = [];
  String(r.path || '').split('/').filter((s) => s.startsWith(':')).forEach((s) => out.push('path:' + s.slice(1)));
  const io = ioOfRoute(r);
  if (io.response === 'file') out.push('file');
  if (r.method !== 'GET') {
    const t = tableOfIface(it, io.tableKey) || it.tables[0] || {};
    (t.fields || []).filter((f) => f.writable !== false && !f.pk && !f.autoIncrement).slice(0, 6).forEach((f) => out.push('body:' + f.name));
  }
  const q = [];
  if (r.key === 'list' || r.key === 'custom') q.push('page', 'size', 'keyword');
  if (r.key === 'detail' && !out.some((x) => x.startsWith('path:'))) q.push('id');
  return out.concat(q).join(', ') || '无';
}
function ioLogicText(it, r) {
  const io = ioOfRoute(r);
  const t = tableOfIface(it, io.tableKey) || it.tables[0] || { name: 'table' };
  if (io.response === 'file') {
    return [
      `1. 接收 multipart 文件，拒绝超过 ${io.maxMb || 0} MB 或非「${io.fileKind}」类型`,
      `2. 写入 S3 桶 ${io.bucket || (it.storage && it.storage.bucket) || 'clickbuild'}${io.prefix ? ' / 前缀 ' + io.prefix : ''}`,
      `3. 对象键写入 ${t.name}.${io.field || '（未选字段）'}${io.autoBind ? '（服务器自动入库）' : '（由脚本入库）'}`,
      `4. 响应附带 { objectKey, objectUrl, filename, size }`,
    ].join('\n');
  }
  if (io.response === 'cookie') {
    return [
      `1. 脚本用 TOKEN NEW 签发会话`,
      `2. 会话写 ${io.storage === 'memory' ? '进程内存（重启丢失）' : 'Redis ' + (io.prefix || 'icb:token:')}`,
      `3. 响应 Set-Cookie: ${io.cookieName || 'icb_token'}，HttpOnly=${io.httpOnly ? 'true' : 'false'}，SameSite=${io.sameSite}，Max-Age=${io.ttl || 7200}`,
      `4. 后续请求可从 Authorization 或 Cookie 读取同一会话`,
    ].join('\n');
  }
  if (io.response === 'object') return '服务器直接列 S3 桶内对象，支持 marker 分页、下载与删除，不走 SQL。';
  if (io.response === 'proxy') return '服务器把请求转发到“上游”页配置的 baseUrl，不进入脚本。';
  if (io.response === 'crawl') return '服务器抓取目标网页，脚本里用 CRAWL 取得 title/text/links 后继续加工。';
  if (io.storage === 'redis') return `查询结果写 Redis，TTL ${io.ttl || 60}s；命中缓存直接返回，写操作按路由缓存键失效。`;
  return '执行脚本里的 QUERY / EXEC，按 RETURN 的 JSON 返回。';
}
function nextTableKey(iface, base) {
  const clean = String(base || 'table').toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'table';
  if (!iface.tables.some((t) => t.key === clean)) return clean;
  const stem = clean.replace(/(?:_\d+)+$/, '') || 'table';
  let i = 2;
  let key = `${stem}_${i++}`;
  while (iface.tables.some((t) => t.key === key)) key = `${stem}_${i++}`;
  return key;
}

function setSaveState(state, text) {
  S.saveState = state;
  const map = {
    dirty: ['未保存', '#a16207'],
    saving: ['保存中…', '#555555'],
    saved: [text || '已保存', '#166534'],
    error: ['保存失败', '#b91c1c'],
  };
  const [label, color] = map[state] || map.saved;
  S.saveText = label;
  const el = $('#saveState');
  if (!el) return;
  el.textContent = label;
  el.style.color = color;
  el.title = state === 'error' ? '点击重试保存' : '点击立即保存（Ctrl+S）';
  updateTabDirty();
}

function scheduleSave() {
  setSaveState('dirty');
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => save(true), 700);
}

async function save(silent) {
  if (!S.project) return false;
  setSaveState('saving');
  try {
    const r = await api.save(S.project);
    if (r && r.ok === false) {
      setSaveState('error');
      toast('保存被拦截：' + (r.error || '插件取消了保存'), 5000);
      return false;
    }
    if (r && r.project) S.project = r.project;
    S.problems = r.problems || [];
    tabFollowProject(S.project);
    renderSide();
    setSaveState('saved', S.problems.length ? `已保存 · ${S.problems.length} 问题` : '已保存');
    if (!silent) toast(r.problems.length ? `已保存，但有 ${S.problems.length} 处问题` : '已保存');
    return true;
  } catch (err) {
    setSaveState('error');
    toast('保存失败：' + String(err && err.message || err), 5000);
    return false;
  }
}

async function flushAndSave(reason) {
  if (S.view === 'studio' && studioDirty) {
    const ok = await saveStudioToProject(reason || '离开工程');
    if (!ok) return false;
  }
  return save(true);
}

/* ---------------- 多项目标签（WPS 式） ---------------- */
function loadTabStrip() {
  try {
    const raw = sessionStorage.getItem(TABS.key);
    const data = raw ? JSON.parse(raw) : null;
    if (data && Array.isArray(data.items)) {
      TABS.items = data.items.filter((x) => x && typeof x.name === 'string' && x.name);
      TABS.active = String(data.active || '');
    }
  } catch (e) { TABS.items = []; TABS.active = ''; }
  if (!TABS.items.some((x) => x.name === TABS.active)) TABS.active = '';
}
function saveTabStrip() {
  try {
    sessionStorage.setItem(TABS.key, JSON.stringify({ items: TABS.items.slice(0, 20), active: TABS.active }));
  } catch (e) { /* 会话存储不可用时只影响重启恢复，不影响当前窗口 */ }
}
function tabSyncProject(p) {
  if (!p || !p.name) return;
  const kind = taskKindOf(p);
  const hit = TABS.items.find((x) => x.name === p.name);
  if (hit) { hit.taskType = kind; }
  else TABS.items.push({ name: p.name, taskType: kind });
  TABS.active = p.name;
  saveTabStrip();
}
// 工程在标题栏被改名后，当前标签也跟着改，而不是留下一个指向旧文件名的死标签。
function tabFollowProject(p) {
  if (!p || !p.name) return;
  const idx = TABS.items.findIndex((x) => x.name === TABS.active);
  if (idx >= 0) TABS.items[idx] = { name: p.name, taskType: taskKindOf(p) };
  tabSyncProject(p);
  renderTabs();
}
function updateTabDirty() {
  const el = document.querySelector('.task-tab.active .task-dirty');
  if (el) el.style.visibility = S.saveState === 'saved' ? 'hidden' : 'visible';
}
function renderTabs() {
  const bar = $('#taskTabs');
  const list = $('#taskTabList');
  if (!bar || !list) return;
  const items = TABS.items.filter((x) => x.name);
  bar.classList.toggle('hidden', !items.length || !S.project);
  if (!items.length || !S.project) { list.innerHTML = ''; return; }
  list.innerHTML = items.map((x) => {
    const active = x.name === TABS.active;
    const kind = TASK_KINDS[x.taskType] || TASK_KINDS.mixed;
    return `<div class="task-tab ${active ? 'active' : ''}" data-tab-name="${esc(x.name)}" title="${esc(x.name)} · ${esc(kind.label)}">
      <span class="task-kind">${esc(kind.short)}</span>
      <span class="task-name">${esc(x.name)}</span>
      <span class="task-dirty" style="visibility:${active && S.saveState !== 'saved' ? 'visible' : 'hidden'}"></span>
      <button class="task-x" data-tab-close="${esc(x.name)}" title="关闭「${esc(x.name)}」" aria-label="关闭">×</button>
    </div>`;
  }).join('');
  const activeEl = list.querySelector('.task-tab.active');
  if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  saveTabStrip();
}

async function switchTab(name) {
  if (!name || !S.project || name === TABS.active) return;
  if (!(await flushAndSave('切换标签'))) return toast('当前工程保存失败，已取消切换', 5000);
  const p = await api.load(name);
  if (!p) {
    TABS.items = TABS.items.filter((x) => x.name !== name);
    saveTabStrip(); renderTabs();
    return toast('找不到工程：' + name, 5000);
  }
  await enterWorkspace(p, { fromTab: true });
  toast(`已切到「${p.name}」`, 2200);
}

async function closeTab(name) {
  const isActive = name === TABS.active;
  if (isActive && S.project) {
    if (!(await flushAndSave('关闭标签'))) return toast('当前工程保存失败，标签没有关闭', 5000);
  }
  const idx = TABS.items.findIndex((x) => x.name === name);
  if (idx < 0) return;
  TABS.items.splice(idx, 1);
  if (isActive) {
    const next = TABS.items[Math.min(idx, TABS.items.length - 1)];
    S.project = null;
    if (next) {
      const p = await api.load(next.name);
      if (p) {
        await enterWorkspace(p, { fromTab: true });
      } else {
        TABS.items = TABS.items.filter((x) => x.name !== next.name);
      }
    }
    if (!TABS.items.length) {
      TABS.active = ''; saveTabStrip(); renderTabs();
      $('#taskTabs').classList.add('hidden');
      await showProjectHub();
    }
  } else {
    saveTabStrip(); renderTabs();
  }
}

async function closeOtherTabs() {
  const keep = TABS.active;
  if (!keep || !S.project) return;
  if (!(await flushAndSave('关闭其他标签'))) return toast('当前工程保存失败，已取消', 5000);
  TABS.items = TABS.items.filter((x) => x.name === keep);
  saveTabStrip(); renderTabs();
  toast('已关闭其他标签，当前工程保留', 2500);
}

function tabCtxMenu(name, x, y) {
  const count = TABS.items.length;
  openCtx(x, y, [
    { label: '在新窗口打开', hint: '独立窗口', run: async () => {
      if (name === TABS.active && S.project && !(await flushAndSave('新窗口'))) {
        return toast('当前工程保存失败，已取消打开新窗口', 5000);
      }
      await api.newWindow(name);
    } },
    { label: '关闭这个标签', run: () => closeTab(name) },
    { label: '关闭其他标签', hint: `${count - 1} 个`, disabled: count <= 1, run: closeOtherTabs },
  ]);
}

// 三类任务的选择入口。默认混合；只有用户明确选了才改。
function chooseTaskKind(title) {
  return new Promise((resolve) => {
    const cards = TASK_ORDER.map((k) => {
      const m = TASK_KINDS[k];
      return `<button class="task-kind-card ${k === 'mixed' ? 'on' : ''}" data-task-kind="${k}">
        <span class="k">${esc(m.short)}</span>
        <b>${esc(m.label)}${k === 'mixed' ? '（默认）' : ''}</b>
        <span>${esc(m.hint)}</span>
      </button>`;
    }).join('');
    modal(`<div class="p-5 w-[560px] max-w-[94vw]">
      <div class="text-[14px] font-semibold">${esc(title || '新建任务')}</div>
      <div class="text-[11px] text-neutral-500 mt-1 mb-4">先定这次要写什么：只写页面、只写接口，还是两边一起。以后可以在标题栏改。</div>
      <div class="task-kind-grid">${cards}</div>
      <div class="flex justify-end mt-4"><button class="btn thin" id="tkCancel">取消</button></div>
    </div>`, (root) => {
      root.querySelector('#tkCancel').onclick = () => { closeModal(); resolve(null); };
      root.querySelectorAll('[data-task-kind]').forEach((b) => {
        b.onclick = () => { closeModal(); resolve(b.dataset.taskKind); };
      });
    });
  });
}

async function newTaskFlow(kind) {
  const chosen = kind || await chooseTaskKind('新建任务');
  if (!chosen) return false;
  if (S.project && !(await flushAndSave('新建任务'))) {
    toast('当前工程没有保存成功，已取消新建；改动还在当前工程里', 6000);
    return false;
  }
  const p = await api.seed();
  p.taskType = chosen;
  p.name = uniqueProjectName(chosen === 'frontend' ? '前端任务' : chosen === 'backend' ? '后端任务' : '混合任务');
  p.description = `${TASK_KINDS[chosen].label} · 空白工程`;
  p.interfaces = [];
  p.functions = [];
  delete p.frontend;
  const r = await api.save(p);
  if (r && r.ok === false) return toast('新任务保存失败：' + (r.error || '未知错误'), 6000);
  const proj = (r && r.project) || p;
  await enterWorkspace(proj);
  toast(`已新建「${proj.name}」· ${TASK_KINDS[chosen].label}`, 3500);
  return true;
}

async function changeTaskKind(kind) {
  if (!S.project || !TASK_KINDS[kind] || taskKindOf(S.project) === kind) {
    if (S.project) $('#taskKind').value = taskKindOf(S.project);
    return;
  }
  if (!(await confirmBox('切换任务类型', `把「${S.project.name}」切成${TASK_KINDS[kind].label}？现有接口和数据不会删除，只是收起对应的入口。`))) {
    $('#taskKind').value = taskKindOf(S.project);
    return;
  }
  if (S.view === 'studio' && studioDirty) await saveStudioToProject('切换任务类型');
  const old = taskKindOf(S.project);
  S.project.taskType = kind;
  if (!(await save(true))) {
    S.project.taskType = old;
    $('#taskKind').value = old;
    return;
  }
  tabSyncProject(S.project);
  applyTaskMode();
  if (kind === 'frontend') setView('studio');
  else if (S.view === 'studio') setView('api');
  else render();
  renderTabs();
  toast(`已切到${TASK_KINDS[kind].label}`, 3000);
}

/* ---------------- 渲染入口 ---------------- */
function render() {
  $('#projectName').value = S.project.name;
  $('#taskKind').value = taskKindOf(S.project);
  applyTaskMode();
  renderRibbon();
  renderWorkspace();
  renderSheets();
  renderSide();
  renderTabs();
}

// 任务类型决定这个工程露出多少东西：只前端不显示接口工作台，只后端不显示前端工坊。
function applyTaskMode() {
  const kind = taskKindOf(S.project);
  const sub = $('#appSubtitle');
  if (sub) sub.textContent = '接口工作台';
  const vs = $('#viewSwitch');
  if (vs) vs.classList.toggle('hidden', kind !== 'mixed');
  const search = $('#search');
  if (search) search.classList.toggle('hidden', kind === 'frontend');
  const gen = document.querySelector('[data-action="generate"]');
  if (gen) gen.classList.toggle('hidden', kind === 'frontend');
  const deploy = document.querySelector('[data-action="deployUpdate"]');
  if (deploy) deploy.classList.toggle('hidden', kind === 'backend');
}

function renderRibbon() {
  const svc = S.services || { items: [], ports: {} };
  const infra = svc.items.filter((x) => x.id !== 'server');
  const server = svc.items.find((x) => x.id === 'server');
  const up = infra.filter((x) => x.running).length;
  const running = server && server.running;
  const kind = taskKindOf(S.project);
  const backend = kind !== 'frontend';
  $('#ribbon').innerHTML = `
  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('seed', 'new', '新建', '先保存当前工程，再新建一个任务')}
    ${rb('open', 'open', '打开', '打开已有工程，开成新标签')}
  </div><div class="lbl">工程</div></div>

  ${backend ? `<div class="ribbon-group"><div class="flex gap-1">
    ${rb('newIface', 'iface', '新建接口', '在当前分类新建接口')}
    ${rb('favLib', 'star', '常用', '收藏、分类，一键复用常用接口')}
    ${rb('dupIface', 'copy', '复制', '复制当前接口')}
    ${rb('delIface', 'trash', '删除', '删除当前接口')}
  </div><div class="lbl">接口</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('addTable', 'table', '加表', '给当前接口加一张表')}
    ${rb('addField', 'field', '加字段', '给当前表加字段')}
    ${rb('ddl', 'sql', '看 DDL', '查看建表语句')}
  </div><div class="lbl">表结构</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('preview', 'sql', '预览', '把脚本里的 SQL 展开看看')}
    ${rb('test', 'play', '测试', '发送请求到生成的服务')}
  </div><div class="lbl">脚本</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb(running ? 'stopServer' : 'launchWeb', running ? 'stop' : 'play', running ? '停止' : '启动', running ? '停止网页服务和 MariaDB / Redis / RustFS' : '生成当前工程、启动服务并打开网页主页')}
    ${rb('home', 'console', '打开主页', '在浏览器打开当前工程的网页主页')}
    ${rb('monitor', 'console', '监控', '实时看请求日志与健康状态')}
    <div class="ribbon-status" title="数据库 / 缓存 / 对象存储运行状态"><span class="dot ${up ? 'on' : 'off'}"></span>${up}/${infra.length} 运行</div>
  </div><div class="lbl">运行</div></div>` : ''}

  ${pluginRibbon()}
  <div class="ribbon-group ribbon-group-end"><div class="flex gap-1">
    ${rb('exportProject', 'package', '导出工程', '按所选类型导出源码工程')}
    ${rb('docs', 'page', '接口文档', '预览自动生成的 API 文档')}
    ${rb('moreMenu', 'more', '更多…', '模版、接口库、AI、导入导出和设置')}
  </div><div class="lbl">导出与更多</div></div>`;
}

// 插件贡献的命令只放前 3 个，剩下的在「插件」面板里；避免插件一多把 Ribbon 撑爆。
function pluginRibbon() {
  const info = S.pluginInfo;
  const cmds = (info && info.commands) || [];
  if (!cmds.length) return '';
  const shown = cmds.slice(0, 3);
  const enabled = (info.list || []).filter((p) => p.enabled).length;
  return `<div class="ribbon-group"><div class="flex gap-1">
    ${shown.map((c) => `<div class="rb" data-plugin-run="${esc(c.id)}" title="${esc(c.description || c.pluginName + ' · ' + c.title)}">${icon(c.icon || 'page')}<span class="t">${esc(c.title)}</span></div>`).join('')}
    <div class="rb" data-action="plugins" title="管理插件、命令、日志和开发者文档">${icon('more')}<span class="t">插件…</span></div>
  </div><div class="lbl">插件${enabled ? ' · ' + enabled : ''}</div></div>`;
}

function showMoreMenu() {
  const item = (name, label, desc) => `<button class="more-item" data-more-action="${name}"><b>${esc(label)}</b><span>${esc(desc)}</span></button>`;
  modal(`<div class="p-5 w-[560px] max-h-[80vh] overflow-auto">
    <div class="flex items-start gap-3 mb-4">
      <div class="flex-1">
        <div class="text-[14px] font-semibold">更多操作</div>
        <div class="text-[11px] text-neutral-500 mt-1">日常编辑只留了常用入口；模版、导入导出和系统设置收在这里，避免工具栏堆成一片。</div>
      </div>
      <button class="btn thin" id="moreClose">关闭</button>
    </div>

    <div class="more-sect">
      <h5>内容与复用</h5>
      <div class="more-grid">
        ${item('templates', '模版库', '套用内置业务工程')}
        ${item('favLib', '常用接口', '收藏、分类、搜索、复用')}
        ${item('ifaceLib', '接口库', '浏览全部内置与我的接口')}
        ${item('saveTemplate', '存为模版', '把当前工程收进模版库')}
        ${item('saveIface', '存为常用接口', '把当前接口加入收藏，随时复用')}
      </div>
    </div>

    <div class="more-sect">
      <h5>导入导出</h5>
      <div class="more-grid">
        ${item('exportYxpn', '导出 .yxpn', '带前端与文档的工程包')}
        ${item('importYxpn', '导入 .yxpn', '打开已有工程包')}
        ${item('microExport', '导出微服务', '按接口或分类拆独立服务')}
        ${item('plugins', '插件', '启停插件与信任目录')}
      </div>
    </div>

    <div class="more-sect">
      <h5>工具与系统</h5>
      <div class="more-grid">
        ${item('ai', 'AI 生成', '用对话框生成接口工程')}
        ${item('settings', '设置', 'AI、模型参数与服务端口')}
        ${item('language', '界面语言', '多国语言、切换后立即重载')}
        ${item('assoc', '关联 .yxpn', '设为默认打开方式')}
        ${item('newWindow', '新窗口', '同款无边框窗口，当前工程先保存')}
        ${item('grid', '表格视图', '回到接口总表')}
        ${item('help', '帮助', '语法、函数与快捷键')}
      </div>
    </div>
  </div>`, (m) => {
    m.querySelector('#moreClose').onclick = closeModal;
    m.querySelectorAll('[data-more-action]').forEach((b) => {
      b.onclick = () => { closeModal(); act(b.dataset.moreAction); };
    });
  });
}

function renderSheets() {
  const tabs = S.project.categories.map((c) => `<div class="sheet ${S.mode === 'grid' && c.id === S.cat ? 'active' : ''}" data-sheet="${c.id}" title="双击重命名">${esc(c.name)}<span class="ml-2 text-neutral-400">${S.project.interfaces.filter((i) => i.categoryId === c.id).length}</span></div>`).join('');
  const saveColor = { dirty: '#a16207', saving: '#555555', saved: '#166534', error: '#b91c1c' }[S.saveState] || '#166534';
  const saveTitle = S.saveState === 'error' ? '点击重试保存' : '点击立即保存（Ctrl+S）';
  $('#sheetbar').innerHTML = `${tabs}
    <div class="sheet text-neutral-600" data-action="addCat">＋</div>
    <div class="ml-auto flex items-center gap-2 pr-2 text-[11px] text-neutral-500">
      <span class="mono">${S.project.interfaces.length} 接口</span>
      <span class="mono">${S.project.interfaces.reduce((n, i) => n + i.tables.length, 0)} 表</span>
      <span class="mono">${S.project.interfaces.reduce((n, i) => n + i.routes.length, 0)} 路由</span>
      <span id="saveState" class="mono cursor-pointer" style="color:${saveColor}" title="${saveTitle}">${esc(S.saveText)}</span>
    </div>
    <div id="resStats" role="button" aria-label="资源占用分析" title="资源占用分析"></div>`;
  renderResourceBar();
  $$('#sheetbar .sheet[data-sheet]').forEach((el) => {
    el.addEventListener('click', () => { S.cat = el.dataset.sheet; S.mode = 'grid'; S.tab = 'tables'; render(); });
    el.addEventListener('dblclick', async () => {
      const id = el.dataset.sheet;
      const cat = S.project.categories.find((c) => c.id === id);
      const name = await ask('重命名分类', cat.name);
      if (name) { cat.name = name; scheduleSave(); render(); }
    });
  });
  const sv = $('#saveState');
  if (sv) sv.onclick = () => save();
}

/* ---------------- 资源占用 ---------------- */
const RES_TONE = (pct, warn = 65, bad = 85) => {
  if (pct == null || !Number.isFinite(pct)) return '';
  if (pct >= bad) return 'bad';
  if (pct >= warn) return 'warn';
  return '';
};
function resBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(v >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${Math.round(v)} B`;
}
function resPct(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Number(n).toFixed(digits)}%`;
}
function resServiceMem(id) {
  const hit = ((S.res && S.res.services) || []).find((x) => x.id === id);
  return hit ? hit.memBytes : 0;
}
function renderResourceBar() {
  const box = $('#resStats');
  if (!box) return;
  const r = S.res;
  const cpu = r && r.cpu ? r.cpu.percent : null;
  const mem = r && r.memory ? r.memory.percent : null;
  const disk = r && r.disk ? r.disk.percent : null;
  const svc = r ? `${r.serviceRunning}/${r.services.length}` : '—';
  const svcMem = r ? resBytes(r.serviceMem) : '—';
  const appCpu = r && r.app ? r.app.cpuPercent : null;
  const appMem = r && r.app ? r.app.memBytes : null;
  const off = !!(r && r.services.some((x) => x.running === false));
  const cpuTone = RES_TONE(cpu);
  const memTone = RES_TONE(mem);
  const diskTone = RES_TONE(disk, 90, 97);
  box.className = $('#resPop') && !$('#resPop').classList.contains('hidden') ? 'on' : '';
  box.innerHTML = `
    <span class="res-chip" title="CPU ${resPct(cpu, 1)} · ${(r && r.cpu.cores) || '—'} 核 · 本应用 ${resPct(appCpu, 1)}">
      <span class="res-key">CPU</span>
      <span class="res-meter ${cpuTone}"><i style="width:${cpu == null ? 0 : Math.max(1, Math.min(100, cpu))}%"></i></span>
      <b>${resPct(cpu, 0)}</b>
    </span>
    <span class="res-chip" title="内存 ${resPct(mem, 1)} · ${r ? resBytes(r.memory.used) + ' / ' + resBytes(r.memory.total) : '—'} · 本应用 ${resBytes(appMem)}">
      <span class="res-key">内存</span>
      <span class="res-meter ${memTone}"><i style="width:${mem == null ? 0 : Math.max(1, Math.min(100, mem))}%"></i></span>
      <b>${resPct(mem, 0)}</b>
    </span>
    <span class="res-chip hide-sm" title="磁盘 ${resPct(disk, 1)} · ${r && r.disk ? r.disk.label + ' 盘可用 ' + resBytes(r.disk.free) : '—'}">
      <span class="res-key">磁盘</span><b class="${diskTone === 'bad' ? 'res-bad' : ''}">${resPct(disk, 0)}</b>
    </span>
    <span class="res-chip" title="服务进程 ${svc} 运行 · 内存合计 ${svcMem} · 本应用 ${r ? r.app.processes : 0} 个进程">
      <span class="res-dot ${off ? 'off' : ''}"></span>
      <span class="res-key">服务</span><b>${svc}</b><span class="res-sub hide-sm">${svcMem}</span>
    </span>`;
  box.onclick = (e) => { e.stopPropagation(); toggleResPop(); };
}
function toggleResPop(force) {
  const pop = $('#resPop');
  if (!pop) return;
  const open = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
  if (!open) {
    pop.classList.add('hidden');
    renderResourceBar();
    return;
  }
  pop.classList.remove('hidden');
  renderResPop();
  renderResourceBar();
  sampleResources(true);
}
function renderResPop() {
  const pop = $('#resPop');
  if (!pop || pop.classList.contains('hidden')) return;
  const r = S.res;
  if (!r) {
    pop.innerHTML = `<div class="res-pop-head"><b>资源占用分析</b><span class="res-time">正在采样…</span><button class="res-close" id="resClose" title="关闭">×</button></div>`;
    const close = $('#resClose');
    if (close) close.onclick = (e) => { e.stopPropagation(); toggleResPop(false); };
    return;
  }
  const cpu = r.cpu.percent;
  const mem = r.memory.percent;
  const disk = r.disk ? r.disk.percent : null;
  const net = r.net;
  const lv = r.analysis.level;
  const lvText = { ok: '正常', warn: '注意', bad: '偏高' }[lv] || '正常';
  const time = new Date(r.at).toLocaleTimeString('zh-CN', { hour12: false });
  const services = r.services || [];
  const maxMem = Math.max(1, ...services.map((x) => x.memBytes || 0));
  pop.innerHTML = `
    <div class="res-pop-head">
      <b>资源占用分析</b>
      <span class="res-time"><span class="res-key">采样</span> ${time}</span>
      <button class="res-refresh" id="resRefresh">立即刷新</button>
      <button class="res-close" id="resClose" title="关闭">×</button>
    </div>
    <div class="res-cards">
      <div class="res-card">
        <div class="res-card-top"><span>CPU</span><b class="${RES_TONE(cpu)}">${resPct(cpu, 1)}</b></div>
        <div class="res-card-sub"><span class="res-key">CPU 核心</span> ${r.cpu.cores} · <span class="res-key">本应用</span> ${resPct(r.app.cpuPercent, 1)}</div>
        <div class="res-card-bar ${RES_TONE(cpu)}"><i style="width:${cpu == null ? 0 : Math.max(1, Math.min(100, cpu))}%"></i></div>
      </div>
      <div class="res-card">
        <div class="res-card-top"><span>内存</span><b class="${RES_TONE(mem)}">${resPct(mem, 1)}</b></div>
        <div class="res-card-sub">${resBytes(r.memory.used)} / ${resBytes(r.memory.total)} · <span class="res-key">本应用</span> ${resBytes(r.app.memBytes)}</div>
        <div class="res-card-bar ${RES_TONE(mem)}"><i style="width:${mem == null ? 0 : Math.max(1, Math.min(100, mem))}%"></i></div>
      </div>
      <div class="res-card">
        <div class="res-card-top"><span><span class="res-key">磁盘</span> ${r.disk ? esc(r.disk.label) : ''}</span><b class="${RES_TONE(disk, 90, 97)}">${resPct(disk, 1)}</b></div>
        <div class="res-card-sub"><span class="res-key">可用</span> ${r.disk ? resBytes(r.disk.free) : '—'} · <span class="res-key">共</span> ${r.disk ? resBytes(r.disk.total) : '—'}</div>
        <div class="res-card-bar ${RES_TONE(disk, 90, 97)}"><i style="width:${disk == null ? 0 : Math.max(1, Math.min(100, disk))}%"></i></div>
      </div>
      <div class="res-card">
        <div class="res-card-top"><span>网络</span><b>↓ ${net ? resBytes(net.rxRate) : '—'}/s</b></div>
        <div class="res-card-sub">↑ ${net ? resBytes(net.txRate) : '—'}/s · <span class="res-key">接收</span> ${net ? resBytes(net.rx) : '—'} / <span class="res-key">发送</span> ${net ? resBytes(net.tx) : '—'}</div>
        <div class="res-card-sub"><span class="res-key">本应用进程</span> ${r.app.processes} · <span class="res-key">含主进程、渲染进程与 GPU</span></div>
      </div>
    </div>
    <div class="res-notes">
      <div class="res-notes-head"><b>资源分析</b><span class="res-level ${lv}">${lvText}</span></div>
      <ul>${(r.analysis.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    </div>
    <div class="res-svc">
      <div class="res-svc-head"><b>服务进程</b><span>${r.serviceRunning}/${services.length} <span class="res-key">运行中</span> · <span class="res-key">合计</span> ${resBytes(r.serviceMem)}</span></div>
      <div class="res-svc-row head"><span></span><span>进程</span><span class="res-svc-mem">内存</span><span class="res-svc-port">端口</span></div>
      ${services.map((x) => `
        <div class="res-svc-row" title="${esc(x.name)} PID ${x.pid || '—'}">
          <span class="res-dot ${x.running ? '' : 'off'}"></span>
          <span class="res-svc-name">${esc(x.name)}<em>${x.pid ? 'PID ' + x.pid : ''}</em></span>
          <span class="res-svc-mem">${x.memBytes ? resBytes(x.memBytes) : '—'}</span>
          <span class="res-svc-port">${x.port || '—'}</span>
        </div>`).join('') || `<div class="res-svc-row"><span></span><span class="res-svc-name">还没有运行中的服务</span><span class="res-svc-mem">—</span><span class="res-svc-port">—</span></div>`}
    </div>
    <div class="res-foot">服务内存来自 tasklist 实测，约 6 秒缓存一次；CPU、内存、磁盘、网络每次采样实时读取。</div>`;
  const close = $('#resClose');
  if (close) close.onclick = (e) => { e.stopPropagation(); toggleResPop(false); };
  const refresh = $('#resRefresh');
  if (refresh) refresh.onclick = (e) => { e.stopPropagation(); sampleResources(true); };
}
let resBusy = false;
async function sampleResources(force) {
  if (!S.project || resBusy) return;
  if (!force && document.hidden) return;
  resBusy = true;
  try {
    const items = ((S.services && S.services.items) || []).map((x) => ({ id: x.id, name: x.name, port: x.port, running: x.running, pid: x.pid }));
    S.res = await api.resources(items);
    renderResourceBar();
    renderResPop();
  } catch (e) { /* 采样失败不影响工作台 */ }
  finally { resBusy = false; }
}

function renderSide() {
  const svc = S.services;
  if (!svc) return;
  const counts = {
    ifaces: S.project.interfaces.length,
    tables: S.project.interfaces.reduce((n, i) => n + i.tables.length, 0),
    routes: S.project.interfaces.reduce((n, i) => n + i.routes.length, 0),
    funcs: (S.project.functions || []).length,
  };
  const problems = S.problems || [];
  const infra = (svc.items || []).filter((x) => x.id !== 'server');
  const up = infra.filter((x) => x.running).length;
  const infraMem = infra.reduce((n, x) => n + resServiceMem(x.id), 0);
  $('#sideTop').innerHTML = `
  <div class="side-sect">
    <h4>项目概览</h4>
    <div class="side-stats">
      <div><b>${counts.ifaces}</b><span>接口</span></div>
      <div><b>${counts.tables}</b><span>表</span></div>
      <div><b>${counts.routes}</b><span>路由</span></div>
    </div>
    <div class="side-check ${problems.length ? 'bad' : 'ok'}">${problems.length ? `${problems.length} 项待处理` : '结构检查通过'}</div>
    ${problems.length ? `<div class="text-[11px] space-y-1 mt-2">${problems.slice(0, 6).map((p) => `<div class="border-l-2 border-neutral-900 pl-2">${esc(p)}</div>`).join('')}${problems.length > 6 ? `<div class="text-neutral-500">还有 ${problems.length - 6} 条…</div>` : ''}</div>` : ''}
  </div>

  <div class="side-sect">
    <div class="side-head"><h4>运行环境</h4><span>${up}/${infra.length} 运行${infraMem ? ' · ' + resBytes(infraMem) : ''}</span></div>
    ${svc.bundled === false ? `<div class="text-[11px] text-red-600 mb-1">安装包缺少服务文件：${esc((svc.missing || []).join('、'))}</div>` : ''}
    ${svc.items.filter((x) => x.id !== 'server').map((it) => `
      <div class="side-svc" title="${it.running ? '运行中' : '未运行'}${resServiceMem(it.id) ? ' · 内存 ' + resBytes(resServiceMem(it.id)) : ''}">
        <span class="dot ${it.running ? 'on' : 'off'}"></span>
        <span class="flex-1 truncate">${esc(it.name)}</span>
        ${resServiceMem(it.id) ? `<span class="side-mem">${resBytes(resServiceMem(it.id))}</span>` : ''}
        <span class="mono text-[10px] text-neutral-500">${it.port}</span>
        <button class="btn thin side-mini" data-svc="${it.id}" data-on="${it.running ? '0' : '1'}">${it.running ? '停止' : '启动'}</button>
      </div>`).join('')}
    <div class="side-ports">MySQL ${svc.ports.mysql} · Redis ${svc.ports.redis} · S3 ${svc.ports.s3}${(svc.conflicts && svc.conflicts.length) ? `<br><span title="${esc(svc.conflicts.map((c) => `${c.label} ${c.from}→${c.to}（${c.reason}）`).join('；'))}">${svc.conflicts.length} 个端口已自动避让</span>` : ''}</div>
  </div>

  <details class="side-sect side-details">
    <summary>工程详情</summary>
    <div class="side-kv"><span>自定义函数</span><b>${counts.funcs}</b></div>
    <div class="side-kv"><span>生成目录</span><b class="mono break-all">${esc(S.genDir || '还没有生成')}</b></div>
  </details>`;

  $$('[data-svc]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.svc;
      b.disabled = true;
      b.textContent = '…';
      const r = await (b.dataset.on === '1' ? api.startService(id) : api.stopService(id));
      if (r && r.ok === false) toast(r.error || '操作失败');
      S.services = await api.services();
      renderSide();
      renderRibbon();
    };
  });
}

/* ---------------- 表格视图 ---------------- */
function renderWorkspace() {
  const side = document.querySelector('#workbenchMain > aside');
  if (side) side.classList.toggle('hidden', S.mode === 'help');
  if (S.mode === 'editor' && activeIface()) renderEditor();
  else if (S.mode === 'help') renderHelp();
  else renderGrid();
  if (window.__i18n && window.__i18n.apply) window.__i18n.apply(document);
}

function renderGrid() {
  const cat = S.project.categories.find((c) => c.id === S.cat) || S.project.categories[0];
  const rows = S.project.interfaces.filter((i) => i.categoryId === cat.id);
  const head = ['A 接口名', 'B 表', 'C 字段', 'D 路由', 'E 备注'];
  $('#workspace').innerHTML = `
  <div class="h-9 shrink-0 flex items-center gap-3 px-3 border-b border-neutral-300 text-[12px]">
    <b>${esc(cat.name)}</b>
    <input id="gridFilter" class="border border-neutral-300 px-2 py-0.5 w-56" placeholder="筛选当前分类：接口 / 表 / 备注…" value="${esc(gridQuery)}">
    <span class="text-neutral-500" id="gridCount">${rows.length} 个接口 · 双击行进入编辑</span>
    <span class="ml-auto flex gap-1">
      <button class="btn thin" data-action="newIface">＋ 新建接口</button>
      <button class="btn thin" data-action="addCat">＋ 新建分类</button>
    </span>
  </div>
  <div class="flex-1 overflow-auto">
    <table class="gt">
      <thead><tr><th class="rownum"></th>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((i, n) => `
          <tr data-iface="${i.id}" class="${i.id === S.selId ? 'sel' : ''}" data-search="${esc((i.name + ' ' + i.comment + ' ' + i.tables.map((t) => t.name + ' ' + t.comment).join(' ')).toLowerCase())}">
            <td class="rownum">${n + 1}</td>
            <td class="font-medium" title="${esc(i.name)}">${esc(i.name)}</td>
            <td class="mono text-[12px]" title="${esc(i.tables.map((t) => t.name).join(', '))}">${i.tables.map((t) => esc(t.name)).join(', ')}</td>
            <td class="mono text-[12px]">${i.tables.reduce((s, t) => s + t.fields.length, 0)}</td>
            <td class="mono text-[12px]">${i.routes.length}</td>
            <td class="text-[12px] text-neutral-600 truncate" title="${esc(i.comment)}">${esc(i.comment)}</td>
          </tr>`).join('') || `<tr><td class="rownum">1</td><td colspan="5" class="text-neutral-500">这个分类还没有接口，点右上角新建。</td></tr>`}
        ${rows.length ? `<tr id="gridNoHit" class="hidden"><td class="rownum"></td><td colspan="5" class="text-neutral-500">没有匹配的接口，换个关键词试试。</td></tr>` : ''}
      </tbody>
    </table>
  </div>`;

  const filter = $('#gridFilter');
  if (filter) {
    filter.oninput = () => {
      gridQuery = filter.value;
      const q = gridQuery.trim().toLowerCase();
      let shown = 0;
      $$('#workspace tr[data-iface]').forEach((tr) => {
        const hit = !q || (tr.dataset.search || '').includes(q);
        tr.classList.toggle('hidden', !hit);
        if (hit) shown += 1;
      });
      const noHit = $('#gridNoHit');
      if (noHit) noHit.classList.toggle('hidden', !q || shown > 0);
      const count = $('#gridCount');
      if (count) count.textContent = q ? `${shown} / ${rows.length} 个接口` : `${rows.length} 个接口 · 双击行进入编辑`;
    };
  }
  $$('#workspace tr[data-iface]').forEach((tr) => {
    tr.addEventListener('click', () => { S.selId = tr.dataset.iface; $$('#workspace tr[data-iface]').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel'); renderSide(); });
    tr.addEventListener('dblclick', () => openIface(tr.dataset.iface));
  });
}

function openIface(id) {
  S.selId = id;
  S.mode = 'editor';
  S.tab = 'tables';
  S.tableKey = (ifaceOf(id).tables[0] || {}).key || '';
  S.routeId = (ifaceOf(id).routes[0] || {}).id || '';
  render();
}

/* ---------------- 接口编辑器 ---------------- */
function renderEditor() {
  const it = activeIface();
  if (!it) { S.mode = 'grid'; return renderGrid(); }
  const tabs = [
    ['tables', '表结构', 0, 'data'],
    ['routes', '路由脚本', 0, 'route'],
    ['io', '接口类型', 0, 'io'],
    ['docs', '接口文档', 0, 'doc'],
    ['cache', '缓存与存储', 1, 'cache'],
    ['upstream', '上游', 0, 'upstream'],
    ['permissions', '权限', 0, 'perm'],
    ['objects', '对象表', 0, 'object'],
    ['test', '测试', 1, 'test'],
    ['export', '生成导出', 0, 'export'],
  ];
  $('#workspace').innerHTML = `
  <div class="editor-topbar h-11 shrink-0 flex items-center gap-2 px-3 border-b border-neutral-300">
    <button class="btn thin" data-action="grid">← 表格</button>
    <input id="ifName" class="border border-neutral-300 px-2 py-1 text-[13px] font-semibold w-48" value="${esc(it.name)}">
    <select id="ifCat" class="border border-neutral-300 px-1 py-1 text-[12px]">
      ${S.project.categories.map((c) => `<option value="${c.id}" ${c.id === it.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select>
    <input id="ifBase" class="border border-neutral-300 px-2 py-1 mono text-[12px] w-36" placeholder="/orders" value="${esc(it.basePath)}" title="接口统一前缀，可留空">
    <input id="ifComment" class="border border-neutral-300 px-2 py-1 text-[12px] flex-1 min-w-32" placeholder="备注" value="${esc(it.comment)}">
    <button class="btn thin" data-action="delIface">删除接口</button>
  </div>
  <div class="editor-tabbar h-9 shrink-0 flex items-center border-b border-neutral-300 px-2 text-[12px]">
    ${tabs.map(([k, label, group, tone]) => `<div class="tabbtn ${group ? 'tab-start' : ''} ${S.tab === k ? 'on' : ''}" data-tab="${k}"><i class="tb-dot tb-${tone}"></i>${label}</div>`).join('')}
    <div class="ml-auto flex items-center gap-1.5"><span class="count-chip chip-blue">${it.tables.length} 表</span><span class="count-chip chip-green">${it.routes.length} 路由</span></div>
  </div>
  <div class="flex-1 min-h-0 overflow-hidden" id="tabBody"></div>`;

  const body = $('#tabBody');
  if (S.tab === 'tables') body.innerHTML = tabTables(it);
  else if (S.tab === 'routes') body.innerHTML = tabRoutes(it);
  else if (S.tab === 'io') body.innerHTML = tabIo(it);
  else if (S.tab === 'docs') body.innerHTML = tabDocs(it);
  else if (S.tab === 'cache') body.innerHTML = tabCache(it);
  else if (S.tab === 'upstream') body.innerHTML = tabUpstream(it);
  else if (S.tab === 'permissions') body.innerHTML = tabPermissions(it);
  else if (S.tab === 'objects') body.innerHTML = tabObjects(it);
  else if (S.tab === 'test') body.innerHTML = tabTest(it);
  else body.innerHTML = tabExport(it);

  $('#ifName').oninput = (e) => { it.name = e.target.value; scheduleSave(); };
  $('#ifBase').oninput = (e) => { it.basePath = e.target.value; scheduleSave(); };
  $('#ifComment').oninput = (e) => { it.comment = e.target.value; scheduleSave(); };
  $('#ifCat').onchange = (e) => { it.categoryId = e.target.value; S.cat = e.target.value; scheduleSave(); renderSheets(); };
  $$('[data-tab]').forEach((t) => { t.onclick = () => { S.tab = t.dataset.tab; renderWorkspace(); }; });

  if (S.tab === 'tables') bindTables(it);
  if (S.tab === 'routes') bindRoutes(it);
  if (S.tab === 'io') bindIo(it);
  if (S.tab === 'docs') bindDocs(it);
  if (S.tab === 'cache') bindCache(it);
  if (S.tab === 'upstream') bindUpstream(it);
  if (S.tab === 'permissions') bindPermissions(it);
  if (S.tab === 'objects') bindObjects(it);
  if (S.tab === 'test') bindTest(it);
  if (S.tab === 'export') bindExport(it);
}

function nextFieldName(t) {
  const used = new Set((t.fields || []).map((f) => f.name));
  let n = (t.fields || []).length + 1;
  while (used.has(`field_${n}`)) n++;
  return `field_${n}`;
}

function addFieldQuick(it) {
  const t = it && tableOfIface(it, S.tableKey);
  if (!t) return;
  S.tab = 'tables';
  t.fields.push({ name: nextFieldName(t), type: 'varchar', comment: '', pk: false, autoIncrement: false, nullable: true, search: true, hidden: false, query: true, writable: true, default: '' });
  scheduleSave();
  const idx = t.fields.length - 1;
  renderWorkspace();
  setTimeout(() => {
    const el = document.querySelector(`[data-fi="${idx}"][data-fk="name"]`);
    if (el) { el.focus(); el.select(); el.scrollIntoView({ block: 'center' }); }
  }, 0);
  toast('已新增字段，直接输入名字');
}

/* ----- 表结构 ----- */
function tabTables(it) {
  const t = tableOfIface(it, S.tableKey);
  if (!t) return '<div class="p-4">没有表。</div>';
  const st = storeOf(t);
  const typeOptions = (cur) => {
    const list = fieldTypeList();
    if (!list.length) {
      return BASE_FIELD_TYPE_KEYS.map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${k}</option>`).join('');
    }
    const groups = ['number', 'text', 'time', 'semantic', 'file'];
    const body = groups.map((g) => {
      const items = list.filter((t) => (t.group || 'text') === g);
      if (!items.length) return '';
      return `<optgroup label="${esc(FIELD_TYPE_GROUPS[g] || g)}">${items.map((t) => `<option value="${esc(t.key)}" ${t.key === cur ? 'selected' : ''}>${esc(t.label || t.key)}</option>`).join('')}</optgroup>`;
    }).join('');
    return list.some((t) => t.key === cur) ? body : `<option value="${esc(cur)}" selected>${esc(cur)}</option>` + body;
  };
  return `
  <div class="h-full flex flex-col">
    <div class="shrink-0 border-b border-neutral-200">
      <div class="flex items-center gap-2 px-2 py-1.5 min-w-0">
        <div id="tableTabs" class="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 py-0.5" title="表多时可横向滚动，滚轮也可">
          ${it.tables.map((x) => `<div class="pill table-tab shrink-0 cursor-pointer truncate ${x.key === t.key ? 'on' : ''}" style="max-width:210px" title="${esc(x.key)} · ${esc(x.name)}" data-table="${x.key}">${esc(x.key)} · ${esc(x.name)}</div>`).join('')}
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <span class="text-[11px] text-neutral-500 mono">${it.tables.length} 表</span>
          <select id="tSelect" class="border border-neutral-300 px-1 py-0.5 text-[11px] mono" style="max-width:190px" title="快速切表">
            ${it.tables.map((x) => `<option value="${x.key}" ${x.key === t.key ? 'selected' : ''}>${esc(x.key)} · ${esc(x.name)}</option>`).join('')}
          </select>
          <button class="btn thin" data-action="addTable">＋ 表</button>
        </div>
      </div>
      <div class="flex items-center gap-2 px-3 py-1.5 bg-neutral-50 border-t border-neutral-200" style="flex-wrap:wrap">
        <span class="text-[11px]">表名 <input id="tName" class="border border-neutral-300 px-1 py-0.5 mono w-44" value="${esc(t.name)}"></span>
        <span class="text-[11px]">库 <input id="tSchema" class="border border-neutral-300 px-1 py-0.5 mono w-28" placeholder="留空=默认库" value="${esc(t.schema)}"></span>
        <span class="text-[11px]">注释 <input id="tComment" class="border border-neutral-300 px-1 py-0.5 w-40" value="${esc(t.comment)}"></span>
        <span class="text-[11px]">加速 <select id="tStore" class="border border-neutral-300 px-1 py-0.5 text-[11px]" title="${esc(STORE_MODES.map((m) => `${m.name}：${m.desc}`).join('\n'))}">${STORE_MODES.map((m) => `<option value="${m.id}" ${m.id === st.mode ? 'selected' : ''} title="${esc(m.desc)}">${esc(m.name)}</option>`).join('')}</select></span>
        <span class="text-[11px] ${st.mode === 'cache' || st.mode === 'redis' || st.mode === 'redis-mysql' ? '' : 'hidden'}" data-store-for="ttl">TTL(秒) <input id="tStoreTtl" type="number" min="0" step="1" class="border border-neutral-300 px-1 py-0.5 mono w-16" value="${st.ttl}"></span>
        <span class="text-[11px] ${st.mode === 'lru' || st.mode === 'lru-redis' ? '' : 'hidden'}" data-store-for="max">上限(条) <input id="tStoreMax" type="number" min="100" step="100" class="border border-neutral-300 px-1 py-0.5 mono w-20" value="${st.max}"></span>
        <span class="text-[11px] ${st.mode === 'periodic' ? '' : 'hidden'}" data-store-for="flush">刷盘(毫秒) <input id="tStoreFlush" type="number" min="500" step="500" class="border border-neutral-300 px-1 py-0.5 mono w-20" value="${st.flushMs}"></span>
        <button class="btn thin ml-auto" data-action="delTable">删表</button>
      </div>
    </div>
    <div class="flex-1 overflow-auto">
      <table class="gt">
        <thead><tr><th class="rownum"></th><th>A 字段</th><th>B 类型</th><th>C 主键</th><th>D 自增</th><th>E 可空</th><th>F 搜索</th><th>G 隐藏</th><th>H 默认</th><th>I 注释</th><th style="width:56px">J</th></tr></thead>
        <tbody>
          ${t.fields.map((f, i) => `
          <tr data-field-row="${i}" data-ftone="${fieldTone(f.type)}">
            <td class="rownum">${i + 1}</td>
            <td><input class="cell-in mono" data-fi="${i}" data-fk="name" value="${esc(f.name)}"></td>
            <td><select class="cell-in mono" data-fi="${i}" data-fk="type" title="${esc((fieldTypeMeta(f.type) || {}).hint || '字段类型')}">${typeOptions(f.type)}</select></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="pk" ${f.pk ? 'checked' : ''}></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="autoIncrement" ${f.autoIncrement ? 'checked' : ''}></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="nullable" ${f.nullable ? 'checked' : ''}></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="search" ${f.search ? 'checked' : ''}></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="hidden" ${f.hidden ? 'checked' : ''}></td>
            <td><input class="cell-in mono" data-fi="${i}" data-fk="default" value="${esc(f.default)}"></td>
            <td><input class="cell-in" data-fi="${i}" data-fk="comment" value="${esc(f.comment)}"></td>
            <td class="text-center"><button class="btn thin" data-del="${i}">×</button></td>
          </tr>`).join('')}
          <tr class="add-field-row" data-add-field title="点击新增字段；在字段名里按 Enter 也可以">
            <td class="rownum">＋</td>
            <td colspan="9">点击新增字段，或在字段名里按 Enter 继续新增；行内直接改名字、选类型</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="shrink-0 border-t border-neutral-200 px-3 py-2 flex items-center gap-2 text-[12px]">
      <button class="btn thin" data-action="addField">＋ 加字段</button>
      <button class="btn thin" data-action="importTable">导入表格</button>
      <input id="tImport" type="file" accept=".csv,.tsv,.txt" class="hidden">
      <span class="text-neutral-500">表键 <b>${esc(t.key)}</b>，脚本里用 {{columns:${esc(t.key)}}}、{{where:${esc(t.key)}}} 引用这张表。</span>
      <span id="tStoreHint" class="text-neutral-500 truncate" style="max-width:320px">${esc((STORE_MODES.find((m) => m.id === st.mode) || {}).desc || '')}</span>
      <button class="btn thin ml-auto" data-action="ddl">看 DDL</button>
    </div>
  </div>`;
}

function bindTables(it) {
  const t = tableOfIface(it, S.tableKey);
  $$('[data-table]').forEach((el) => { el.onclick = () => { S.tableKey = el.dataset.table; renderWorkspace(); }; });
  const sel = $('#tSelect');
  if (sel) sel.onchange = () => { S.tableKey = sel.value; renderWorkspace(); };
  const bar = $('#tableTabs');
  if (bar) {
    bar.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { bar.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    const on = bar.querySelector('.table-tab.on');
    if (on) {
      const br = bar.getBoundingClientRect();
      const ar = on.getBoundingClientRect();
      bar.scrollLeft += ar.left - br.left - (bar.clientWidth - ar.width) / 2;
    }
  }
  const name = $('#tName'); if (name) name.oninput = (e) => { t.name = e.target.value; scheduleSave(); };
  const sc = $('#tSchema'); if (sc) sc.oninput = (e) => { t.schema = e.target.value; scheduleSave(); };
  const cm = $('#tComment'); if (cm) cm.oninput = (e) => { t.comment = e.target.value; scheduleSave(); };
  const storeSel = $('#tStore');
  const syncStoreFields = () => {
    const mode = t.store && t.store.mode ? t.store.mode : 'mysql';
    $$('[data-store-for]').forEach((el) => {
      const show = (el.dataset.storeFor === 'ttl' && ['cache', 'redis', 'redis-mysql'].includes(mode))
        || (el.dataset.storeFor === 'max' && ['lru', 'lru-redis'].includes(mode))
        || (el.dataset.storeFor === 'flush' && mode === 'periodic');
      el.classList.toggle('hidden', !show);
    });
  };
  if (storeSel) storeSel.onchange = () => {
    t.store = { ...storeOf(t), mode: storeSel.value };
    scheduleSave();
    syncStoreFields();
    const hint = $('#tStoreHint');
    if (hint) hint.textContent = (STORE_MODES.find((m) => m.id === storeSel.value) || {}).desc || '';
  };
  const ttl = $('#tStoreTtl'); if (ttl) ttl.oninput = () => { t.store = { ...storeOf(t), ttl: Number(ttl.value || 0) }; scheduleSave(); };
  const max = $('#tStoreMax'); if (max) max.oninput = () => { t.store = { ...storeOf(t), max: Number(max.value || 10000) }; scheduleSave(); };
  const flush = $('#tStoreFlush'); if (flush) flush.oninput = () => { t.store = { ...storeOf(t), flushMs: Number(flush.value || 5000) }; scheduleSave(); };
  syncStoreFields();
  const importInput = $('#tImport');
  if (importInput) importInput.onchange = async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    try {
      const rows = parseDelimited(await file.text());
      if (rows.length < 1) throw new Error('文件是空的');
      const headers = rows[0], data = rows.slice(1);
      if (!(await confirmBox('导入表格', `用「${file.name}」的表头替换当前表字段？字段按列位置覆盖，已有主键/自增标记保留。`))) return;
      const usedNames = new Set();
      t.fields = headers.map((h, i) => {
        const old = t.fields[i] || {};
        let name = fieldNameFromHeader(h, i);
        while (usedNames.has(name)) name = name.replace(/(_\d+)?$/, (m) => `_${Number((m || '_1').slice(1)) + 1}`);
        usedNames.add(name);
        return {
          name,
          type: data.length ? guessColumnType(data.map((r) => r[i])) : (old.type || 'varchar'),
          comment: String(h || '').trim() || old.comment || '',
          pk: !!old.pk, autoIncrement: !!old.autoIncrement, nullable: old.nullable !== false,
          search: old.search !== false, hidden: !!old.hidden, query: old.query !== false,
          writable: old.writable !== false, default: old.default || '',
        };
      });
      scheduleSave();
      renderWorkspace();
      toast(`已导入 ${t.fields.length} 个字段（${data.length} 行样例）`, 4000);
    } catch (e) {
      toast('表格导入失败：' + e.message, 5000);
    } finally {
      importInput.value = '';
    }
  };
  $$('[data-fi]').forEach((el) => {
    const i = Number(el.dataset.fi);
    const k = el.dataset.fk;
    const f = t.fields[i];
    if (!f) return;
    if (el.type === 'checkbox') el.onchange = () => { f[k] = el.checked; scheduleSave(); };
    else {
      el.oninput = () => {
        f[k] = el.value;
        if (k === 'type') {
          const meta = fieldTypeMeta(el.value);
          if (meta && meta.secret) {
            f.hidden = true;
            f.query = false;
            f.search = false;
          }
          scheduleSave();
          renderWorkspace();
          toast(`已切换为 ${meta ? meta.label : el.value}`);
          return;
        }
        scheduleSave();
        if (k === 'name') renderSide();
      };
      if (el.tagName === 'SELECT') el.onchange = el.oninput;
      if (k === 'name') el.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addFieldQuick(it); }
      };
    }
  });
  const addRow = $('[data-add-field]');
  if (addRow) addRow.onclick = () => addFieldQuick(it);
  $$('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (t.fields.length <= 1) return toast('至少留一个字段');
      const i = Number(b.dataset.del);
      if (!(await confirmBox('删除字段', `确定删掉「${t.fields[i].name}」？`))) return;
      t.fields.splice(i, 1);
      scheduleSave(); renderWorkspace();
    };
  });
}

/* ----- 路由脚本 ----- */
function scriptTable(it) {
  return it.tables[0] || { name: 'table', key: 'main', fields: [] };
}

function scriptTemplates(it) {
  const t = scriptTable(it);
  const key = t.key || 'main';
  return [
    ['列表', '分页查询并返回 rows', `LET $rows = QUERY SELECT {{columns:${key}}} FROM {{t:${key}}} WHERE {{where:${key}}} ORDER BY {{orderBy:${key}}} LIMIT {{limit}} OFFSET {{offset}};\nRETURN 200 { "ok": true, "rows": $rows.rows };`],
    ['新增', '插入一条并返回 insertId', `LET $ins = EXEC INSERT INTO {{t:${key}}} ({{insertColumns:${key}}}) VALUES ({{insertValues:${key}}});\nRETURN 201 { "ok": true, "id": $ins.insertId };`],
    ['校验', '先查重，再决定是否继续', `LET $exists = QUERY SELECT {{idColumn:${key}}} FROM {{t:${key}}} WHERE {{idColumn:${key}}} = {{body.id}} LIMIT 1;\nIF LEN($exists.rows) > 0\n  RETURN 409 { "ok": false, "error": "EXISTS" };\nEND`],
    ['事务', '手动提交或回滚', `TX BEGIN;\nLET $a = EXEC INSERT INTO {{t:${key}}} ({{insertColumns:${key}}}) VALUES ({{insertValues:${key}}});\nTX COMMIT;\nRETURN 201 { "ok": true, "id": $a.insertId };`],
    ['抓取', '抓网页并按大小/超时限制', `LET $page = CRAWL 'https://example.com' { maxBytes: 200000, timeout: 8000 };\nRETURN 200 { "ok": $page.ok, "title": $page.title, "bytes": $page.bytes };`],
    ['等待', '显式延时，最长 60 秒', `WAIT 500;\nLOG DEBUG '等待完成';`],
  ];
}

function scriptAssistHtml(it) {
  const t = scriptTable(it);
  const key = t.key || 'main';
  const fields = (t.fields || []).slice(0, 8);
  return `<aside id="scriptAssist" class="w-[264px] shrink-0 border-l border-neutral-300 bg-neutral-50 flex flex-col min-h-0">
    <div class="h-8 shrink-0 border-b border-neutral-300 px-2 flex items-center gap-2">
      <b class="text-[11px]">脚本助手</b>
      <span class="text-[10px] text-neutral-500">Ctrl+空格</span>
      <button class="ml-auto text-[11px] text-neutral-500 hover:text-neutral-900" data-assist-hide="1" title="收起脚本助手">收起</button>
    </div>
    <div class="flex-1 overflow-auto p-2 text-[11px]">
      <div class="text-neutral-500 leading-5 mb-2">每条路由就是一段脚本：先 <span class="mono">LET</span> 取数，再 <span class="mono">IF</span> 判断，最后 <span class="mono">RETURN</span> 返回。</div>
      <div class="font-semibold border-b border-neutral-300 pb-1 mb-1">插入常用写法</div>
      <div class="grid grid-cols-2 gap-1 mb-3">
        ${scriptTemplates(it).map(([label, , code], i) => `<button class="btn thin text-left" data-snp="${i}" title="${esc(code)}">${esc(label)}</button>`).join('')}
      </div>
      <div class="font-semibold border-b border-neutral-300 pb-1 mb-1">当前表：<span class="mono">${esc(t.name)}</span></div>
      <div class="flex flex-wrap gap-1 mb-3">
        <button class="chip" data-chip="{{t:${esc(key)}}}" title="表名">表 {{t:${esc(key)}}}</button>
        <button class="chip" data-chip="{{columns:${esc(key)}}}" title="全部字段">字段列表</button>
        <button class="chip" data-chip="{{where:${esc(key)}}}" title="按 query 生成条件">WHERE</button>
        <button class="chip" data-chip="{{idColumn:${esc(key)}}}" title="主键列">主键</button>
      </div>
      <div class="font-semibold border-b border-neutral-300 pb-1 mb-1">字段</div>
      <div class="flex flex-wrap gap-1 mb-3">
        ${fields.map((f) => `<button class="chip" data-chip="{{body.${esc(f.name)}}}" title="请求体字段">${esc(f.name)}</button>`).join('') || '<span class="text-neutral-500">没有字段</span>'}
      </div>
      <div class="font-semibold border-b border-neutral-300 pb-1 mb-1">常用变量</div>
      <div class="flex flex-wrap gap-1 mb-3">
        ${['{{body.x}}', '{{query.x}}', '{{path.x}}', '{{id}}', '{{now}}', '{{uuid}}'].map((x) => `<button class="chip mono" data-chip="${esc(x)}">${esc(x)}</button>`).join('')}
      </div>
      <div class="text-neutral-500 leading-5 mb-2">参数写进 <span class="mono">{{...}}</span> 会自动参数化，不要自己拼 SQL 字符串。</div>
      <button class="btn thin w-full" data-action="scriptGuide">完整语法速查</button>
    </div>
  </aside>`;
}

function insertScriptText(text) {
  const ta = $('#rScript');
  if (!ta) return;
  const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
  const end = ta.selectionEnd == null ? start : ta.selectionEnd;
  ta.setRangeText(text, start, end, 'end');
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

const CB_KEYWORDS = new Set(['LET', 'SET', 'QUERY', 'EXEC', 'IF', 'ELSEIF', 'ELSE', 'END', 'FOREACH', 'IN', 'RETURN', 'LOG', 'WAIT', 'TX', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TOKEN', 'NEW', 'PUBLISH', 'CRAWL', 'REDIS', 'GET', 'PUT', 'DEL', 'INCR', 'EXPIRE']);
const CB_SQL = new Set(['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'NULL', 'IS', 'LIKE', 'IN', 'EXISTS', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'UNION', 'ALL']);

function scriptTok(cls, text) {
  if (!text) return '';
  return `<span class="tok-${cls}">${esc(text)}</span>`;
}

// 单行高亮；st.block 在行间保留，所以跨行 /* */ 注释不会串色。
function highlightScriptLine(line, st) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (st.block) {
      const end = line.indexOf('*/', i);
      if (end < 0) { out += scriptTok('comment', line.slice(i)); break; }
      out += scriptTok('comment', line.slice(i, end + 2));
      st.block = false;
      i = end + 2;
      continue;
    }
    const c = line[i];
    const n = line[i + 1];
    if ((c === '/' && n === '/') || c === '#') { out += scriptTok('comment', line.slice(i)); break; }
    if (c === '/' && n === '*') { st.block = true; out += scriptTok('comment', '/*'); i += 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === c) { j++; break; }
        j++;
      }
      out += scriptTok('str', line.slice(i, j));
      i = j;
      continue;
    }
    if (c === '{' && n === '{') {
      const end = line.indexOf('}}', i + 2);
      if (end < 0) { out += scriptTok('ph', line.slice(i)); break; }
      out += scriptTok('ph', line.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if (c === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+|\s*\[[^\]]*\])*/.exec(line.slice(i));
      if (m) { out += scriptTok('var', m[0]); i += m[0].length; continue; }
    }
    if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(line.slice(i));
      out += scriptTok('num', m[0]);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
      const word = m[0];
      const upper = word.toUpperCase();
      let cls = '';
      if (CB_KEYWORDS.has(upper)) cls = 'kw';
      else if (CB_SQL.has(upper)) cls = 'sql';
      else if (/^\s*\(/.test(line.slice(i + word.length))) cls = 'fn';
      out += cls ? scriptTok(cls, word) : esc(word);
      i += word.length;
      continue;
    }
    if ('+-*/%<>!=&|(){}[],:;.'.includes(c)) { out += scriptTok('op', c); i++; continue; }
    out += esc(c);
    i++;
  }
  return out;
}

function scriptHighlight(text, diagnostics) {
  const lines = String(text == null ? '' : text).split('\n');
  const byLine = new Map();
  for (const d of diagnostics || []) {
    const cur = byLine.get(d.line);
    if (!cur || d.severity === 'error' || cur === 'warning') byLine.set(d.line, d.severity);
  }
  const st = { block: false };
  return lines.map((line, idx) => {
    const sev = byLine.get(idx + 1);
    const cls = sev === 'error' ? ' line-error' : sev === 'warning' ? ' line-warning' : '';
    return `<div class="cl${cls}" data-line="${idx + 1}">${highlightScriptLine(line, st) || ''}</div>`;
  }).join('');
}

function scriptGutter(text, diagnostics) {
  const lines = String(text == null ? '' : text).split('\n');
  const byLine = new Map();
  for (const d of diagnostics || []) {
    const row = byLine.get(d.line) || { severity: 'warning', items: [] };
    row.items.push(d);
    if (d.severity === 'error' || row.severity !== 'error') row.severity = d.severity === 'error' ? 'error' : row.severity;
    byLine.set(d.line, row);
  }
  return lines.map((_, idx) => {
    const row = byLine.get(idx + 1);
    const sev = row ? row.severity : '';
    const tip = row ? row.items.map((d) => `${d.severity === 'error' ? '错误' : '警告'} ${d.code || 'ISSUE'}: ${d.message || ''}`).join('\n') : '';
    const icon = sev ? `<span class="gl-icon"><span>!</span></span>` : '<span class="gl-mark"></span>';
    return `<div class="gl${sev ? ' line-' + sev : ''}" data-line="${idx + 1}"${tip ? ` title="${esc(tip)}"` : ''}>${icon}<span class="gl-no">${idx + 1}</span></div>`;
  }).join('');
}

function scriptMarkers(text, diagnostics) {
  const lines = String(text == null ? '' : text).split('\n');
  const rows = [];
  for (const d of diagnostics || []) {
    const line = Number(d.line) || 1;
    const col = Math.max(1, Number(d.column) || 1);
    const end = Math.max(col + 1, Number(d.endColumn) || col + 1);
    if (line < 1 || line > lines.length) continue;
    const sev = d.severity === 'warning' ? 'warning' : 'error';
    const len = Math.max(1, end - col);
    const top = (line - 1) * 21 + 23;
    const tip = `${sev === 'error' ? '错误' : '警告'} ${d.code || 'ISSUE'}：${d.message || ''}${d.hint ? '\n' + d.hint : ''}`;
    rows.push(`<div class="code-marker ${sev}" data-line="${line}" data-column="${col}" data-end-column="${end}" data-tip="${esc(tip)}" style="left:calc(12px + ${col - 1} * 1ch);top:${top}px;width:calc(${len} * 1ch)"><i></i></div>`);
  }
  return rows.join('');
}

function scriptProblemsHtml(diagnostics, checking) {
  const ds = diagnostics || [];
  const errors = ds.filter((d) => d.severity === 'error').length;
  const warnings = ds.filter((d) => d.severity === 'warning').length;
  const count = checking
    ? '<span>扫描中…</span>'
    : `${errors ? `<span class="bad">${errors} 个错误</span>` : '<span>0 个错误</span>'}${warnings ? ` / <span class="warn">${warnings} 个警告</span>` : ''}`;
  const head = `<div class="code-problems-head"><b>Problems</b>${count}<span class="ml-auto text-neutral-400">输入时自动分析 · 点问题跳到对应位置</span></div>`;
  if (checking) return `${head}<div class="code-diag"><span class="code-diag-badge">·</span><span>正在分析脚本…</span></div>`;
  if (!ds.length) return `${head}<div class="code-diag" style="border-left-color:#1f8f3a"><span class="code-diag-badge" style="background:#1f8f3a">✓</span><span>没有发现问题。继续输入会自动重新检查。</span></div>`;
  const rows = ds.slice(0, 24).map((d, idx) => {
    const sev = d.severity === 'warning' ? 'warning' : 'error';
    const code = d.code || 'ISSUE';
    return `<div class="code-diag ${sev}" data-diag-line="${d.line}" data-diag-column="${d.column || 1}" data-diag-end="${d.endColumn || (d.column || 1) + 1}" data-diag-index="${idx}" title="跳到第 ${d.line} 行${d.column ? '，第 ' + d.column + ' 列' : ''}">
      <span class="code-diag-badge">!</span>
      <span class="code-diag-msg"><b>第 ${d.line} 行${d.column ? ':' + d.column : ''}</b> ${esc(d.message || '')}</span>
      <span class="code-diag-hint">${esc(d.hint || '')}</span>
      <span class="code-diag-code">${esc(code)}</span>
    </div>`;
  }).join('');
  const more = ds.length > 24 ? `<div class="code-diag"><span class="code-diag-badge">…</span><span>还有 ${ds.length - 24} 条，先修正前面的问题</span></div>` : '';
  return `${head}<div class="code-diag-list">${rows}${more}</div>`;
}

function scriptCursorInfo(ta) {
  const pos = ta.selectionStart == null ? 0 : ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return `第 ${line} 行，第 ${col} 列`;
}

function setupScriptEditor(onChange) {
  const ta = $('#rScript');
  if (!ta) return;
  const hi = $('#codeHighlightInner');
  const gut = $('#codeGutterInner');
  const marks = $('#codeMarkerInner');
  const problems = $('#codeProblems');
  const status = $('#rStatus');
  const cursor = $('#rCursor');
  let diagnostics = [];
  let timer = 0;
  let seq = 0;
  let checking = true;
  let tip = document.getElementById('codeTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'codeTooltip';
    tip.className = 'code-tooltip';
    document.body.appendChild(tip);
  }
  const hideTip = () => { if (tip) tip.classList.remove('show'); };
  const showTip = (marker, x, y) => {
    if (!tip) return;
    const text = marker.getAttribute('data-tip') || '';
    const parts = text.split('\n');
    tip.className = 'code-tooltip show' + (/^警告/.test(text) ? ' warning' : '');
    tip.innerHTML = `<b>${esc(parts.shift() || '')}</b>${parts.length ? `<em>${esc(parts.join(' '))}</em>` : ''}`;
    const pad = 12;
    const w = Math.min(380, Math.max(220, tip.offsetWidth || 260));
    const h = tip.offsetHeight || 44;
    tip.style.left = `${Math.min(window.innerWidth - w - pad, x + 12)}px`;
    tip.style.top = `${Math.min(window.innerHeight - h - pad, y + 16)}px`;
  };

  const syncScroll = () => {
    if (hi) hi.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (gut) gut.style.transform = `translateY(${-ta.scrollTop}px)`;
    if (marks) marks.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  };
  const paint = () => {
    if (hi) hi.innerHTML = scriptHighlight(ta.value, diagnostics);
    if (gut) gut.innerHTML = scriptGutter(ta.value, diagnostics);
    if (marks) marks.innerHTML = scriptMarkers(ta.value, diagnostics);
    if (problems) problems.innerHTML = scriptProblemsHtml(diagnostics, checking);
    hideTip();
  };
  const setStatus = (c) => {
    const dot = $('#liveDot');
    const errors = c && c.errorCount || 0;
    const warnings = c && c.warningCount || 0;
    if (dot) dot.className = `live-dot ${errors ? 'err' : warnings ? 'warn' : checking ? '' : 'ok'}`;
    if (!status) return;
    status.className = `code-status ${checking ? 'checking' : errors ? 'err' : warnings ? 'warn' : 'ok'}`;
    if (checking) status.textContent = '检查中…';
    else if (errors) status.textContent = `${errors} 个错误${warnings ? ` · ${warnings} 个警告` : ''}`;
    else if (warnings) status.textContent = `${warnings} 个警告`;
    else status.textContent = '实时检查通过';
  };
  const jumpTo = (lineNo, column, endColumn) => {
    const lines = ta.value.split('\n');
    const line = Math.min(Math.max(1, Number(lineNo) || 1), lines.length);
    let pos = 0;
    for (let k = 0; k < line - 1 && k < lines.length; k++) pos += lines[k].length + 1;
    const text = lines[line - 1] || '';
    const startCol = Math.min(Math.max(1, Number(column) || 1), text.length + 1) - 1;
    const endCol = Math.min(text.length, Math.max(startCol + 1, (Number(endColumn) || startCol + 2) - 1));
    ta.focus();
    ta.setSelectionRange(pos + startCol, pos + endCol);
    const targetTop = Math.max(0, (line - 1) * 21 - ta.clientHeight / 2);
    ta.scrollTop = targetTop;
    ta.scrollLeft = Math.max(0, startCol * 7.5 - ta.clientWidth / 2);
    syncScroll();
    if (cursor) cursor.textContent = `第 ${line} 行，第 ${startCol + 1} 列`;
    hideTip();
  };

  const check = () => {
    const token = ++seq;
    checking = true;
    paint();
    setStatus(null);
    api.checkScript(ta.value).then((c) => {
      if (token !== seq) return;
      diagnostics = Array.isArray(c && c.diagnostics) ? c.diagnostics : [];
      checking = false;
      paint();
      setStatus(c);
    }).catch((e) => {
      if (token !== seq) return;
      checking = false;
      diagnostics = [{ line: 1, column: 1, endColumn: 2, severity: 'error', code: 'CHECK_FAILED', message: `检查器调用失败：${e.message}`, hint: '确认主进程 IPC 正常后重试' }];
      paint();
      setStatus({ errorCount: 1, warningCount: 0 });
    });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 320);
  };

  ta.addEventListener('scroll', syncScroll, { passive: true });
  ta.addEventListener('input', () => {
    schedule();
    paint();
    if (cursor) cursor.textContent = scriptCursorInfo(ta);
    onChange(ta.value);
  });
  ta.addEventListener('click', () => { if (cursor) cursor.textContent = scriptCursorInfo(ta); });
  ta.addEventListener('keyup', () => { if (cursor) cursor.textContent = scriptCursorInfo(ta); });
  ta.addEventListener('select', () => { if (cursor) cursor.textContent = scriptCursorInfo(ta); });

  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      const value = ta.value;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const lineEnd = en === s ? value.indexOf('\n', en) : en;
      const block = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
      const rows = block.split('\n');
      const allComment = rows.filter((x) => x.trim()).every((x) => /^\s*\/\//.test(x));
      const next = rows.map((x) => {
        if (!x.trim()) return x;
        return allComment ? x.replace(/^(\s*)\/\/\s?/, '$1') : x.replace(/^(\s*)/, '$1// ');
      }).join('\n');
      ta.setRangeText(next, lineStart, lineEnd === -1 ? value.length : lineEnd, 'select');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      if (s === en) {
        if (e.shiftKey) {
          const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
          const head = ta.value.slice(ls, s);
          const cut = head.endsWith('  ') ? 2 : head.endsWith('\t') ? 1 : 0;
          if (cut) ta.setRangeText('', s - cut, s, 'end');
        } else {
          ta.setRangeText('  ', s, en, 'end');
        }
      } else {
        const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
        const le = ta.value.indexOf('\n', en) === -1 ? ta.value.length : ta.value.indexOf('\n', en);
        const block = ta.value.slice(ls, le);
        const next = block.split('\n').map((x) => e.shiftKey ? x.replace(/^(  |\t)/, '') : '  ' + x).join('\n');
        ta.setRangeText(next, ls, le, 'select');
      }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const s = ta.selectionStart;
      const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
      const line = ta.value.slice(ls, s);
      const indent = (line.match(/^\s*/) || [''])[0];
      const deeper = /^\s*(IF|ELSEIF|ELSE|FOREACH|TX\s+BEGIN|BEGIN)\b/i.test(line);
      const dedent = /^\s*(END|ELSE|ELSEIF)\b/i.test(line) ? 2 : 0;
      const base = indent.length >= dedent ? indent.slice(0, indent.length - dedent) : '';
      ta.setRangeText('\n' + base + (deeper ? '  ' : ''), s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
  });

  if (problems) {
    problems.addEventListener('click', (e) => {
      const row = e.target.closest('[data-diag-line]');
      if (!row) return;
      jumpTo(
        Number(row.dataset.diagLine),
        Number(row.dataset.diagColumn || 1),
        Number(row.dataset.diagEnd || Number(row.dataset.diagColumn || 1) + 1),
      );
    });
  }

  if (gut) {
    gut.addEventListener('click', (e) => {
      const row = e.target.closest('[data-line]');
      if (!row || !row.classList.contains('line-error') && !row.classList.contains('line-warning')) return;
      const line = Number(row.dataset.line);
      const d = diagnostics.find((x) => x.line === line) || { line, column: 1, endColumn: 2 };
      jumpTo(d.line, d.column, d.endColumn);
    });
  }

  if (marks) {
    marks.addEventListener('mouseover', (e) => {
      const marker = e.target.closest('.code-marker');
      if (marker) showTip(marker, e.clientX, e.clientY);
    });
    marks.addEventListener('mousemove', (e) => {
      const marker = e.target.closest('.code-marker');
      if (marker) showTip(marker, e.clientX, e.clientY);
    });
    marks.addEventListener('mouseleave', hideTip);
    marks.addEventListener('click', (e) => {
      const marker = e.target.closest('.code-marker');
      if (!marker) return;
      jumpTo(Number(marker.dataset.line), Number(marker.dataset.column), Number(marker.dataset.endColumn));
    });
  }

  paint();
  if (cursor) cursor.textContent = scriptCursorInfo(ta);
  syncScroll();
  check();
}

function showScriptGuide() {
  modal(`<div class="p-4 text-[12px] leading-6" style="max-height:78vh;overflow:auto">
    <div class="font-semibold text-[13px] mb-1">脚本怎么写</div>
    <div class="text-neutral-500 mb-3">一条路由一段脚本，按顺序执行；不需要写分号之外的 JS 语法。</div>
    <table class="help-grid">
      <thead><tr><th style="width:220px">写法</th><th>作用</th></tr></thead>
      <tbody>
        <tr><td class="mono"># 注释 / // 注释 / /* 多行 */</td><td>三种注释；字符串里的 # 和 // 不会被当成注释</td></tr>
        <tr><td class="mono">LET $x = QUERY SELECT …;</td><td>查询，结果在 $x.rows</td></tr>
        <tr><td class="mono">LET $x = EXEC INSERT/UPDATE/DELETE …;</td><td>增删改，结果在 $x.affectedRows / $x.insertId</td></tr>
        <tr><td class="mono">IF 条件 … ELSE … END</td><td>分支；条件可用 LEN、IN、CONTAINS</td></tr>
        <tr><td class="mono">FOREACH $row IN $x.rows … END</td><td>循环，最多 500 条</td></tr>
        <tr><td class="mono">RETURN 200 { "ok": true };</td><td>直接返回 JSON</td></tr>
        <tr><td class="mono">LOG INFO '内容';</td><td>写运行日志，控制台可见</td></tr>
        <tr><td class="mono">WAIT 500;</td><td>等待 500 毫秒，最长 60 秒</td></tr>
        <tr><td class="mono">TX BEGIN; … TX COMMIT;</td><td>手动事务；异常时 ROLLBACK</td></tr>
        <tr><td class="mono">LET $x = CRAWL 'https://…' { … };</td><td>抓取网页，返回 title/text/links/bytes</td></tr>
      </tbody>
    </table>
    <div class="mt-3 font-semibold">最常用占位符</div>
    <div class="text-neutral-600"><span class="mono">{{t:main}}</span> 表名 · <span class="mono">{{columns:main}}</span> 字段 · <span class="mono">{{where:main}}</span> 条件 · <span class="mono">{{body.x}}</span> 请求体 · <span class="mono">{{query.x}}</span> 查询参数 · <span class="mono">{{id}}</span> 主键参数</div>
    <div class="flex justify-end mt-4"><button class="btn thin" id="sgClose">知道了</button></div>
  </div>`, (root) => { root.querySelector('#sgClose').onclick = closeModal; }, { width: 760, maxHeight: '86vh' });
}

function tabRoutes(it) {
  const r = it.routes.find((x) => x.id === S.routeId) || it.routes[0];
  if (!r) return '<div class="p-4">没有路由。</div>';
  const io = ioOfRoute(r);
  return `
  <div class="h-full flex min-h-0">
    <div class="route-list w-60 shrink-0 border-r border-neutral-300 overflow-auto">
      ${it.routes.map((x) => `
        <div class="route-item m-${methodTone(x.method)} ${x.id === r.id ? 'on' : ''}" data-route="${x.id}" data-method="${esc(x.method)}">
          <div class="flex items-center gap-2">${methodBadge(x.method)}<span class="font-medium truncate">${esc(x.name)}</span></div>
          <div class="route-path mono text-[11px] truncate">${esc(x.path)}</div>
        </div>`).join('')}
      <div class="p-2 flex flex-col gap-1">
        <select id="newRouteKind" class="border border-neutral-300 px-1 py-1 text-[12px]">
          <option value="custom">自定义</option><option value="list">列表</option><option value="detail">详情</option>
          <option value="create">新建</option><option value="update">更新</option><option value="delete">删除</option><option value="upload">附件</option>
          <option value="proxy">上游转发</option><option value="objects">对象表</option><option value="crawl">抓取</option>
        </select>
        <button class="btn thin" data-action="addRoute">＋ 加路由</button>
      </div>
    </div>
    <div class="flex-1 flex flex-col min-w-0">
      <div class="route-workhead shrink-0 px-3 py-2 border-b border-neutral-200 text-[12px] m-${methodTone(r.method)}">
        <div class="flex items-center gap-2 min-w-0">
          <input id="rName" class="border border-neutral-300 px-1 py-0.5 w-36 shrink-0" value="${esc(r.name)}">
          <select id="rIoType" class="border border-neutral-300 px-1 py-0.5 text-[12px] shrink-0" title="接口类型：存储和返回方式">
            ${ioTypesOf().map((t2) => `<option value="${esc(t2.id)}" ${t2.id === io.typeId ? 'selected' : ''}>${esc(t2.name)}</option>`).join('')}
          </select>
          <select id="rMethod" class="m-select m-${methodTone(r.method)} px-1 py-0.5 mono shrink-0">
            ${['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => `<option ${m === r.method ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <input id="rPath" class="border border-neutral-300 px-1 py-0.5 mono flex-1 min-w-24" value="${esc(r.path)}">
          <label class="flex items-center gap-1 shrink-0"><input type="checkbox" id="rCache" ${r.cache.enabled ? 'checked' : ''}>Redis 缓存</label>
        </div>
        <div class="flex items-center gap-2 mt-1 min-w-0">
          <button class="btn thin shrink-0 whitespace-nowrap" data-action="toggleAssist">脚本提示</button>
          <span class="text-[10px] text-neutral-500 truncate" id="rIoHint">${esc(io.response)} → ${esc(io.storage)}${io.response === 'file' ? ' · S3 · ' + esc(io.field || '未选字段') : ''}${io.response === 'cookie' ? ' · ' + esc(io.cookieName || 'icb_token') : ''}</span>
          <div class="ml-auto flex items-center gap-1 shrink-0">
            <button class="btn thin whitespace-nowrap" data-action="tryRoute">试运行</button>
            <button class="btn thin whitespace-nowrap" data-action="preview">预览 SQL</button>
            <button class="btn thin whitespace-nowrap" data-action="delRoute">删除</button>
          </div>
        </div>
      </div>
      ${r.key === 'proxy' ? `<div class="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-neutral-200 bg-neutral-50 text-[11px]" style="flex-wrap:wrap">
        <span>上游 <select id="pxUpstream" class="border border-neutral-300 px-1 py-0.5 mono">${['', ...(S.project.upstreams || []).map((u) => u.id)].map((id) => {
          const u = (S.project.upstreams || []).find((x) => x.id === id);
          return `<option value="${esc(id)}" ${id === (r.proxy && r.proxy.upstream) ? 'selected' : ''}>${esc(u ? `${u.name} (${u.baseUrl})` : '未选择')}</option>`;
        }).join('')}</select></span>
        <span>目标 <input id="pxTarget" class="border border-neutral-300 px-1 py-0.5 mono w-56" value="${esc((r.proxy && r.proxy.target) || '')}" placeholder="/v1/users"></span>
        <span>超时 <input id="pxTimeout" class="border border-neutral-300 px-1 py-0.5 mono w-16" value="${esc((r.proxy && r.proxy.timeout) || 15000)}"> ms</span>
        <label class="flex items-center gap-1"><input type="checkbox" id="pxHeaders" ${!(r.proxy && r.proxy.forwardHeaders === false) ? 'checked' : ''}> 转发请求头</label>
      </div>` : ''}
      <div class="flex-1 flex min-h-0">
        <div class="flex-1 min-w-0 flex flex-col min-h-0">
          <div class="code-shell method-frame m-${methodTone(r.method)}">
            <div class="code-gutter"><div class="code-gutter-inner" id="codeGutterInner">${scriptGutter(r.script, [])}</div></div>
            <div class="code-stage">
              <div class="code-highlight"><div class="code-highlight-inner" id="codeHighlightInner">${scriptHighlight(r.script, [])}</div></div>
              <div class="code-marker-layer"><div class="code-marker-inner" id="codeMarkerInner">${scriptMarkers(r.script, [])}</div></div>
              <textarea id="rScript" class="code-editor" spellcheck="false" autocapitalize="off" autocomplete="off">${esc(r.script)}</textarea>
            </div>
          </div>
          <div id="codeProblems" class="code-problems">${scriptProblemsHtml([], true)}</div>
        </div>
        ${scriptAssistHtml(it)}
      </div>
      <div class="shrink-0 border-t border-neutral-300 px-3 py-1 text-[11px] text-neutral-600 flex items-center gap-3 min-w-0">
        <span class="mono shrink-0">ClickBuild Script</span>
        <span class="text-neutral-400 truncate">Ctrl+/ 注释 · Tab 缩进 · Enter 继承缩进 · 停止输入 0.3 秒后自动检查</span>
        <span class="ml-auto mono shrink-0" id="rCursor">第 1 行，第 1 列</span>
        <span class="shrink-0 inline-flex items-center gap-1"><i id="liveDot" class="live-dot"></i><span id="rStatus" class="code-status checking">自动检查中…</span></span>
      </div>
    </div>
  </div>`;
}

function bindRoutes(it) {
  const r = it.routes.find((x) => x.id === S.routeId) || it.routes[0];
  $$('[data-route]').forEach((el) => { el.onclick = () => { S.routeId = el.dataset.route; renderWorkspace(); }; });
  $('#rName').oninput = (e) => { r.name = e.target.value; scheduleSave(); };
  if ($('#rIoType')) $('#rIoType').onchange = (e) => {
    applyIoType(it, r, e.target.value);
    if (ioOfRoute(r).response === 'file') {
      const t = tableOfIface(it, r.io.tableKey) || it.tables[0];
      if (t && r.io.field && !t.fields.some((f) => f.name === r.io.field)) {
        t.fields.push({ name: r.io.field, type: 'varchar', comment: '对象键（S3 key）', pk: false, autoIncrement: false, nullable: true, search: false, hidden: true, query: true, writable: true, default: '' });
      }
    }
    scheduleSave(); renderWorkspace();
  };
  $('#rMethod').onchange = (e) => { r.method = e.target.value; scheduleSave(); renderWorkspace(); };
  $('#rPath').oninput = (e) => { r.path = e.target.value; scheduleSave(); };
  $('#rCache').onchange = (e) => { r.cache.enabled = e.target.checked; scheduleSave(); };
  if (r.key === 'proxy') {
    const up = $('#pxUpstream');
    if (up) up.onchange = () => { r.proxy = r.proxy || {}; r.proxy.enabled = true; r.proxy.upstream = up.value; scheduleSave(); };
    const target = $('#pxTarget');
    if (target) target.oninput = () => { r.proxy = r.proxy || {}; r.proxy.target = target.value; scheduleSave(); };
    const timeout = $('#pxTimeout');
    if (timeout) timeout.oninput = () => { r.proxy = r.proxy || {}; r.proxy.timeout = Number(timeout.value) || 15000; scheduleSave(); };
    const fh = $('#pxHeaders');
    if (fh) fh.onchange = () => { r.proxy = r.proxy || {}; r.proxy.forwardHeaders = fh.checked; scheduleSave(); };
  }
  const assist = $('#scriptAssist');
  if (assist) {
    assist.querySelectorAll('[data-assist-hide]').forEach((b) => {
      b.onclick = () => { assist.classList.add('hidden'); };
    });
    assist.querySelectorAll('[data-snp]').forEach((b) => {
      b.onclick = () => {
        const list = scriptTemplates(it);
        const item = list[Number(b.dataset.snp)];
        if (item) insertScriptText(item[2] + '\n');
      };
    });
    assist.querySelectorAll('[data-chip]').forEach((b) => {
      b.onclick = () => insertScriptText(b.dataset.chip || '');
    });
  }
  const scriptBox = $('#rScript');
  if (scriptBox) {
    scriptBox.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === ' ' || e.key === 'Space')) {
        e.preventDefault();
        if (assist) assist.classList.toggle('hidden');
      }
    });
    setupScriptEditor((value) => { r.script = value; scheduleSave(); });
  }
  const tryBtn = $('[data-action="tryRoute"]');  if (tryBtn) tryBtn.onclick = () => {
    const pathKeys = Array.from(String(r.path || '').matchAll(/:([A-Za-z0-9_]+)/g)).map((m) => m[1]);
    const sampleQuery = pathKeys.length ? JSON.stringify(Object.fromEntries(pathKeys.map((k) => [k, '1'])), null, 2) : '{}';
    const docBody = String((r.docs && r.docs.requestExample) || '').trim();
    const sampleBody = /^[{\[]/.test(docBody) ? docBody : (['POST', 'PUT', 'PATCH'].includes(String(r.method).toUpperCase()) ? '{\n  \n}' : '');
    modal(`<div class="p-4 text-[12px]">
      <div class="font-semibold mb-1">试运行 ${esc(r.method)} ${esc(r.path)}</div>
      <div class="text-neutral-500 mb-3">请求会发到当前启动服务的 /api 前缀；路径参数 :id 会取下方路径参数里的 id，其余键作为查询参数。</div>
      <div class="flex gap-3">
        <div class="flex-1">路径/查询参数 JSON<textarea id="tryQuery" rows="7" class="cell-in monoarea w-full">${esc(sampleQuery)}</textarea></div>
        <div class="flex-1">请求体 JSON<textarea id="tryBody" rows="7" class="cell-in monoarea w-full">${esc(sampleBody)}</textarea></div>
      </div>
      <div class="mt-3 flex items-center gap-2"><button class="btn thin" id="tryGo">发送</button><span id="tryMeta" class="text-neutral-500"></span></div>
      <pre id="tryOut" class="mt-2 p-2 bg-neutral-50 border border-neutral-200 mono text-[11px] overflow-auto" style="max-height:38vh">等待发送…</pre>
      <div class="flex justify-end mt-2"><button class="btn thin" id="tryClose">关闭</button></div>
    </div>`, (root) => {
      root.querySelector('#tryClose').onclick = closeModal;
      root.querySelector('#tryGo').onclick = async () => {
        const meta = root.querySelector('#tryMeta'); const out = root.querySelector('#tryOut');
        meta.textContent = '发送中…';
        let query = {};
        try { query = JSON.parse(root.querySelector('#tryQuery').value || '{}'); } catch (e) { meta.textContent = '参数 JSON 不合法'; return; }
        const bodyText = root.querySelector('#tryBody').value.trim();
        const res = await api.tryRoute({ project: S.project, ifaceId: it.id, routeId: r.id, bodyText, query });
        meta.textContent = res.status ? `${res.status} · ${res.ms}ms · ${res.url}` : String(res.error || '失败');
        out.textContent = typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2);
      };
    }, { width: 860, maxHeight: '86vh' });
  };
}

/* ----- 接口类型 ----- */
function ioStoresFor(response) {
  if (response === 'cookie') return IO_STORES.filter(([k]) => k === 'redis' || k === 'memory');
  if (response === 'file' || response === 'object') return IO_STORES.filter(([k]) => k === 's3');
  return IO_STORES.filter(([k]) => k !== 's3');
}
function ioSelect(kind, value, attrs, response) {
  if (kind === 'response') {
    return `<select ${attrs || ''}>${IO_RESPONSES.map(([k, label]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  }
  if (kind === 'storage') {
    const fixed = response === 'file' || response === 'object';
    const labels = ioStoresFor(response);
    const val = labels.some(([k]) => k === value) ? value : labels[0][0];
    return `<select ${attrs || ''} ${fixed ? 'disabled title="文件/对象类型固定走 S3，SQL 只存对象键"' : ''}>${labels.map(([k, label]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  }
  return `<select ${attrs || ''}>${IO_FILE_KINDS.map(([k, label]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
}

function tabIo(it) {
  const types = ioTypesOf();
  const tokenStore = (S.project.token && S.project.token.store) || 'redis';
  return `<div class="h-full overflow-auto p-3 text-[12px]">
    <div class="flex items-start gap-3 mb-3">
      <div>
        <div class="font-semibold text-[13px]">接口类型表</div>
        <div class="text-neutral-500 leading-5 mt-1">类型不是写死的枚举。下面每一行都是一个可复用类型，路由页的下拉框直接引用；服务器按类型生成文件 / Cookie / 缓存处理逻辑。</div>
      </div>
      <div class="ml-auto flex items-center gap-2 shrink-0">
        <span class="text-neutral-600">Cookie 会话全局存储</span>
        <select id="ioTokenStore" class="border border-neutral-300 px-1 py-1">
          <option value="redis" ${tokenStore !== 'memory' ? 'selected' : ''}>Redis（推荐）</option>
          <option value="memory" ${tokenStore === 'memory' ? 'selected' : ''}>进程内存（重启丢失）</option>
        </select>
        <button class="btn thin" data-action="addIoType">＋ 加类型</button>
      </div>
    </div>
    <div style="overflow:auto;border:1px solid #d4d4d4">
      <table class="help-grid io-grid" style="width:100%;min-width:1160px;table-layout:fixed;margin:0">
        <thead><tr>
          <th style="width:112px">类型名称</th><th style="width:106px">返回处理</th><th style="width:112px">默认存储</th>
          <th style="width:92px">文件类型</th><th style="width:64px">上限 MB</th><th style="width:100px">目标表</th>
          <th style="width:92px">入库字段</th><th style="width:92px">Cookie 名</th><th style="width:62px">TTL 秒</th>
          <th style="width:auto">说明</th><th style="width:38px"></th>
        </tr></thead>
        <tbody>
          ${types.map((t, i) => `<tr>
            <td><input data-iot="name" data-i="${i}" class="cell-in w-full" value="${esc(t.name)}"></td>
            <td>${ioSelect('response', t.response, `data-iot="response" data-i="${i}" class="cell-in w-full"`)}</td>
            <td>${ioSelect('storage', t.storage, `data-iot="storage" data-i="${i}" class="cell-in w-full"`, t.response)}</td>
            <td>${ioSelect('file', t.fileKind, `data-iot="fileKind" data-i="${i}" class="cell-in w-full"`)}</td>
            <td><input type="number" min="0" data-iot="maxMb" data-i="${i}" class="cell-in w-full mono" value="${Number(t.maxMb || 0)}"></td>
            <td><select data-iot="tableKey" data-i="${i}" class="cell-in w-full">${it.tables.map((tb) => `<option value="${esc(tb.key)}" ${tb.key === t.tableKey ? 'selected' : ''}>${esc(tb.name)}</option>`).join('')}</select></td>
            <td><input data-iot="field" data-i="${i}" class="cell-in w-full mono" value="${esc(t.field || '')}" placeholder="file_key"></td>
            <td><input data-iot="cookieName" data-i="${i}" class="cell-in w-full mono" value="${esc(t.cookieName || '')}" placeholder="icb_token"></td>
            <td><input type="number" min="0" data-iot="ttl" data-i="${i}" class="cell-in w-full mono" value="${Number(t.ttl || 0)}"></td>
            <td><input data-iot="note" data-i="${i}" class="cell-in w-full" value="${esc(t.note || '')}"></td>
            <td class="text-center"><button class="btn thin" data-action="delIoType" data-i="${i}" ${types.length <= 1 ? 'disabled' : ''}>删</button></td>
          </tr>`).join('') || `<tr><td colspan="11" class="text-neutral-500">还没有类型表，点右上角「加类型」。</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="flex items-end gap-3 mt-5 mb-2">
      <div>
        <div class="font-semibold text-[13px]">本接口路由分配</div>
        <div class="text-neutral-500 mt-1">每一行是一条真实路由。切换类型会自动改存储、补入库字段；文件类型固定走 S3，SQL 只存对象键。</div>
      </div>
      <span class="ml-auto text-neutral-500 mono">${it.routes.length} 条路由</span>
    </div>
    <div style="overflow:auto;border:1px solid #d4d4d4">
      <table class="help-grid" style="min-width:1160px;margin:0">
        <thead><tr>
          <th style="width:220px">路由</th><th style="width:155px">接口类型</th><th style="width:130px">存储</th>
          <th style="width:150px">目标表</th><th style="width:145px">SQL 字段</th><th style="width:75px">自动入库</th>
          <th>接口要什么</th><th style="width:130px">操作</th>
        </tr></thead>
        <tbody>
          ${it.routes.map((r) => {
            const io = ioOfRoute(r);
            const t = tableOfIface(it, io.tableKey) || it.tables[0] || { fields: [] };
            const fieldOpts = (t.fields || []).filter((f) => !f.pk).map((f) => `<option value="${esc(f.name)}" ${f.name === io.field ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
            return `<tr data-io-route="${esc(r.id)}">
              <td>${methodBadge(r.method)} <span class="mono">${esc(r.path)}</span><div class="text-[10px] text-neutral-500 truncate">${esc(r.name)}</div></td>
              <td><select data-ior="typeId" data-id="${esc(r.id)}" class="cell-in w-full">${types.map((t2) => `<option value="${esc(t2.id)}" ${t2.id === io.typeId ? 'selected' : ''}>${esc(t2.name)}</option>`).join('')}</select></td>
              <td>${ioSelect('storage', io.storage, `data-ior="storage" data-id="${esc(r.id)}" class="cell-in w-full"`, io.response)}</td>
              <td><select data-ior="tableKey" data-id="${esc(r.id)}" class="cell-in w-full">${it.tables.map((tb) => `<option value="${esc(tb.key)}" ${tb.key === io.tableKey ? 'selected' : ''}>${esc(tb.name)}</option>`).join('')}</select></td>
              <td><select data-ior="field" data-id="${esc(r.id)}" class="cell-in w-full"><option value="">—</option>${fieldOpts}</select></td>
              <td class="text-center"><input type="checkbox" data-ior="autoBind" data-id="${esc(r.id)}" ${io.autoBind ? 'checked' : ''}></td>
              <td class="text-[11px] text-neutral-600">${esc(paramsOfRoute(it, r))}</td>
              <td class="text-center whitespace-nowrap">
                <button class="btn thin" data-action="ioLogic" data-id="${esc(r.id)}">逻辑</button>
                <button class="btn thin" data-action="ioApply" data-id="${esc(r.id)}">套用</button>
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="8" class="text-neutral-500">没有路由。</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="text-neutral-500 text-[11px] mt-2">「套用」只生成与类型匹配的脚本骨架：文件上传会写 S3 键入库，Cookie 类型不会覆盖现有登录脚本，只配置 Set-Cookie 与会话存储。</div>
  </div>`;
}

function bindIo(it) {
  const save = () => scheduleSave();
  $$('[data-iot]').forEach((el) => {
    const i = Number(el.dataset.i);
    const key = el.dataset.iot;
    const t = ioTypesOf()[i];
    if (!t) return;
    const apply = () => {
      t[key] = el.type === 'number' ? Number(el.value) || 0 : el.value;
      if (key === 'response' && el.value === 'file') { t.storage = 's3'; t.autoBind = true; if (!t.field) t.field = 'file_key'; }
      if (key === 'response' && el.value === 'cookie') { t.storage = 'redis'; if (!t.cookieName) t.cookieName = 'icb_token'; if (!t.ttl) t.ttl = 7200; }
      save();
    };
    el.oninput = apply;
    if (el.tagName === 'SELECT') el.onchange = () => { apply(); renderWorkspace(); };
  });
  const ts = $('#ioTokenStore');
  if (ts) ts.onchange = () => {
    S.project.token = S.project.token || {};
    S.project.token.store = ts.value;
    let n = 0;
    (S.project.ioTypes || []).forEach((t) => {
      if (t.response === 'cookie' && (t.storage === 'redis' || t.storage === 'memory' || !t.storage)) t.storage = ts.value;
    });
    S.project.interfaces.forEach((x) => (x.routes || []).forEach((r) => {
      const io = r.io || {};
      if ((io.response || '').toLowerCase() === 'cookie' && (io.storage === 'redis' || io.storage === 'memory' || !io.storage)) {
        io.storage = ts.value;
        r.io = io;
        n += 1;
      }
    }));
    save();
    renderWorkspace();
    toast(`Cookie 会话已切到${ts.value === 'memory' ? '进程内存' : 'Redis'}，同步 ${n} 条 Cookie 路由`);
  };
  $$('[data-ior]').forEach((el) => {
    const r = it.routes.find((x) => x.id === el.dataset.id);
    if (!r) return;
    const io = ioOfRoute(r);
    const key = el.dataset.ior;
    const commit = () => {
      if (el.type === 'checkbox') io[key] = el.checked;
      else io[key] = el.value;
      if (key === 'typeId') applyIoType(it, r, el.value);
      else {
        r.io = io;
        if (key === 'storage' && io.response === 'file' && io.storage !== 's3') {
          io.storage = 's3';
          toast('文件上传必须用 S3，已自动改回 S3');
        }
      }
      save();
    };
    el.onchange = () => { commit(); renderWorkspace(); };
  });
  $$('[data-action="addIoType"]').forEach((b) => { b.onclick = () => {
    const id = 'type_' + Math.random().toString(16).slice(2, 7);
    S.project.ioTypes = S.project.ioTypes || [];
    S.project.ioTypes.push({ id, name: '新类型', response: 'json', storage: 'none', fileKind: 'any', maxMb: 20, tableKey: 'main', field: '', autoBind: false, cookieName: '', ttl: 0, prefix: '', note: '' });
    save(); renderWorkspace();
  }; });
  $$('[data-action="delIoType"]').forEach((b) => { b.onclick = async () => {
    const i = Number(b.dataset.i);
    if (!(await confirmBox('删除接口类型', `删除「${ioTypesOf()[i].name}」？引用它的路由会回落到普通 JSON。`))) return;
    S.project.ioTypes.splice(i, 1);
    it.routes.forEach((r) => { if (!ioTypeOf(ioOfRoute(r).typeId)) applyIoType(it, r, (ioTypesOf()[0] || {}).id); });
    save(); renderWorkspace();
  }; });
  $$('[data-action="ioLogic"]').forEach((b) => { b.onclick = () => {
    const r = it.routes.find((x) => x.id === b.dataset.id);
    if (!r) return;
    const io = ioOfRoute(r);
    modal(`<div class="p-4 text-[12px] leading-6" style="min-width:520px">
      <div class="font-semibold text-[13px] mb-1">${esc(r.method)} ${esc(r.path)} · ${esc(io.typeId)}</div>
      <div class="text-neutral-500 mb-3">服务器会按这套配置生成下面的处理链路，不是页面上的假按钮。</div>
      <pre class="p-3 bg-neutral-50 border border-neutral-200 mono text-[12px] whitespace-pre-wrap">${esc(ioLogicText(it, r))}</pre>
      <div class="mt-3 text-neutral-600">路由脚本：<span class="mono">${esc(r.script.split('\n')[0] || '(空)')}</span></div>
      <div class="flex justify-end mt-4"><button class="btn thin" id="ioLogicClose">关闭</button></div>
    </div>`, (root) => { root.querySelector('#ioLogicClose').onclick = closeModal; }, { width: 720 }); 
  }; });
  $$('[data-action="ioApply"]').forEach((b) => { b.onclick = () => {
    const r = it.routes.find((x) => x.id === b.dataset.id);
    if (!r) return;
    const io = ioOfRoute(r);
    const t = tableOfIface(it, io.tableKey) || it.tables[0] || { name: 'table' };
    if (io.response === 'file') {
      if (!io.field) return toast('先在“SQL 字段”里选一个对象键字段');
      if (io.autoBind) {
        r.script = 'RETURN 200 { "key": {{objectKey}}, "url": {{objectUrl}}, "name": {{filename}}, "size": {{size}} };';
        toast('已使用服务器自动入库；脚本只返回对象信息');
      } else {
        r.script = `EXEC UPDATE {{t:${io.tableKey}}} SET ${io.field} = {{objectKey}} WHERE {{idColumn:${io.tableKey}}} = {{id}};\nRETURN 200 { "key": {{objectKey}}, "url": {{objectUrl}}, "name": {{filename}} };`;
        toast('已生成按 id 写对象键的脚本');
      }
    } else if (io.storage === 'redis' && io.response === 'json') {
      r.cache = r.cache || {};
      r.cache.enabled = true;
      r.cache.ttl = Number(io.ttl || 60);
      toast('已启用 Redis 结果缓存');
    } else if (io.response === 'cookie') {
      toast('Cookie 类型已配置；脚本里保留 TOKEN NEW 即可，服务器会自动 Set-Cookie');
    } else {
      toast('这个类型不需要额外脚本');
    }
    save(); renderWorkspace();
  }; });
}

/* ----- 上游 ----- */
function tabUpstream(it) {
  const ups = S.project.upstreams || (S.project.upstreams = []);
  const probe = S.upstreamProbe;
  return `
  <div class="h-full overflow-auto p-3 text-[12px]">
    <div class="help-h flex items-center gap-2">上游服务器
      <span class="text-neutral-500 font-normal">导入后可由代理路由直接转发，也可把 OpenAPI 路径一键生成本接口的转发路由</span>
      <button class="btn thin ml-auto" data-action="addUpstream">＋ 新增上游</button>
    </div>
    <table class="help-grid">
      <thead><tr><th style="width:150px">名称</th><th>baseUrl</th><th style="width:120px">鉴权头</th><th style="width:160px">鉴权值</th><th style="width:80px">超时ms</th><th style="width:170px">操作</th></tr></thead>
      <tbody>
        ${ups.map((u, i) => `<tr data-up="${i}">
          <td><input class="cell-in" data-uf="name" value="${esc(u.name)}"></td>
          <td><input class="cell-in mono" data-uf="baseUrl" value="${esc(u.baseUrl)}" placeholder="http://127.0.0.1:8080"></td>
          <td><input class="cell-in mono" data-uf="authHeader" value="${esc(u.authHeader)}" placeholder="authorization"></td>
          <td><input class="cell-in mono" data-uf="authValue" value="${esc(u.authValue)}" placeholder="Bearer xxx"></td>
          <td><input class="cell-in mono" data-uf="timeout" value="${esc(u.timeout)}"></td>
          <td class="flex gap-1"><button class="btn thin" data-up-probe="${i}">探测</button><button class="btn thin" data-up-import="${i}">导入路由</button><button class="btn thin" data-up-del="${i}">删除</button></td>
        </tr>`).join('') || `<tr><td colspan="6" class="text-neutral-500">还没有上游，点“新增上游”填 baseUrl。</td></tr>`}
      </tbody>
    </table>
    ${probe ? `<div class="help-h">探测结果 · ${esc(probe.url || '')}</div>
      <div class="text-neutral-600 mb-2">${probe.ok ? `可访问，发现 ${probe.routes.length} 条 OpenAPI 路径${probe.title ? ' · ' + esc(probe.title) : ''}` : `失败：${esc(probe.error || probe.note || '未知错误')}`}</div>
      <table class="help-grid"><thead><tr><th style="width:80px">方法</th><th>路径</th><th>说明</th></tr></thead><tbody>
      ${(probe.routes || []).slice(0, 40).map((r) => `<tr><td class="mono">${esc(r.method)}</td><td class="mono">${esc(r.path)}</td><td>${esc(r.name)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-neutral-500">没有解析到路径。</td></tr>'}
      </tbody></table>` : ''}
    <div class="text-neutral-500 mt-2">代理路由在“路由脚本”里新建“上游转发”，填上游名与目标路径；服务器会直接转发请求体与状态码，不进入 SQL/事务。</div>
  </div>`;
}

function bindUpstream(it) {
  const ups = S.project.upstreams || (S.project.upstreams = []);
  $$('[data-up]').forEach((row) => {
    const u = ups[Number(row.dataset.up)];
    row.querySelectorAll('[data-uf]').forEach((el) => {
      el.oninput = () => {
        const k = el.dataset.uf;
        u[k] = k === 'timeout' ? Number(el.value) || 15000 : el.value;
        if (k === 'baseUrl') u.baseUrl = u.baseUrl.replace(/\/+$/, '');
        scheduleSave();
      };
    });
  });
  $$('[data-up-probe]').forEach((btn) => {
    btn.onclick = async () => {
      const u = ups[Number(btn.dataset.upProbe)];
      btn.disabled = true; btn.textContent = '探测中';
      const r = await api.probeUpstream({ baseUrl: u.baseUrl, timeout: u.timeout });
      S.upstreamProbe = { ...r, upstream: u.id };
      renderWorkspace();
    };
  });
  $$('[data-up-import]').forEach((btn) => {
    btn.onclick = async () => {
      const u = ups[Number(btn.dataset.upImport)];
      if (!S.upstreamProbe || S.upstreamProbe.upstream !== u.id) {
        S.upstreamProbe = { ...(await api.probeUpstream({ baseUrl: u.baseUrl, timeout: u.timeout })), upstream: u.id };
      }
      const routes = (S.upstreamProbe.routes || []).slice(0, 20);
      if (!routes.length) return toast('没有可导入的 OpenAPI 路径');
      if (!(await confirmBox('导入上游路由', `把 ${routes.length} 条路径生成到「${it.name}」的转发路由？`))) return;
      const used = new Set(it.routes.map((r) => `${r.method} ${r.path}`));
      for (const src of routes) {
        let p = `/proxy${src.path.startsWith('/') ? '' : '/'}${src.path}`;
        if (used.has(`${src.method} ${p}`)) continue;
        it.routes.push({
          id: crypto.randomUUID().slice(0, 8), key: 'proxy', name: src.name || src.path,
          method: src.method, path: p, auth: false, summary: `转发到 ${u.name}`,
          guard: { tx: false, rate: { enabled: false }, schedule: { enabled: false }, breaker: { enabled: false } },
          script: '# 代理路由直接转发，不走脚本', cache: { enabled: false, key: '', ttl: 60 },
          docs: { summary: '', description: '', requestExample: '', responseExample: '' }, roles: [],
          proxy: { enabled: true, upstream: u.id, target: src.path, stripPrefix: true, forwardHeaders: true, timeout: u.timeout || 15000 },
        });
        used.add(`${src.method} ${p}`);
      }
      S.routeId = it.routes[it.routes.length - 1].id;
      scheduleSave(); renderWorkspace(); toast('已生成转发路由');
    };
  });
  $$('[data-up-del]').forEach((btn) => {
    btn.onclick = async () => {
      const i = Number(btn.dataset.upDel);
      if (!(await confirmBox('删除上游', `删除「${ups[i].name}」？相关代理路由会保留但找不到上游。`))) return;
      ups.splice(i, 1); scheduleSave(); renderWorkspace();
    };
  });
}

/* ----- 权限 ----- */
function tabPermissions(it) {
  const perm = S.project.permissions || (S.project.permissions = { roles: [], enforce: false });
  perm.roles = perm.roles && perm.roles.length ? perm.roles : [{ key: 'admin', name: '管理员' }, { key: 'user', name: '普通用户' }];
  return `
  <div class="h-full overflow-auto p-3 text-[12px]">
    <div class="help-h flex items-center gap-2">权限矩阵
      <span class="text-neutral-500 font-normal">勾选表示该角色可访问；一行都不勾表示不限制角色（仍受“需要 token”开关约束）</span>
      <label class="ml-auto flex items-center gap-1"><input type="checkbox" id="permEnforce" ${perm.enforce ? 'checked' : ''}> 生成服务启用角色校验</label>
    </div>
    <div class="flex items-center gap-2 mb-2" style="flex-wrap:wrap">
      ${perm.roles.map((r, i) => `<span class="pill flex items-center gap-1">${esc(r.name)}<span class="mono text-neutral-500">${esc(r.key)}</span><button class="text-neutral-500" data-role-del="${i}" title="删除角色">×</button></span>`).join('')}
      <input id="roleName" class="border border-neutral-300 px-1 py-0.5 w-32" placeholder="新角色名，如 审核员">
      <button class="btn thin" data-action="addRole">＋ 角色</button>
    </div>
    <table class="help-grid">
      <thead><tr><th style="width:70px">方法</th><th>路由</th>${perm.roles.map((r) => `<th style="width:100px" class="text-center">${esc(r.name)}<div class="mono text-[10px] text-neutral-500">${esc(r.key)}</div></th>`).join('')}</tr></thead>
      <tbody>
        ${it.routes.map((r) => `<tr>
          <td class="mono">${methodBadge(r.method)}</td>
          <td><div>${esc(r.name)}</div><div class="mono text-[11px] text-neutral-500">${esc(r.path)}</div></td>
          ${perm.roles.map((role) => `<td class="text-center"><input type="checkbox" data-role-route="${r.id}" data-role="${role.key}" ${(r.roles || []).includes(role.key) ? 'checked' : ''}></td>`).join('')}
        </tr>`).join('') || '<tr><td colspan="3" class="text-neutral-500">没有路由。</td></tr>'}
      </tbody>
    </table>
    <div class="text-neutral-500 mt-2">token 内需要带 <span class="mono">roles: ["admin"]</span>；脚本里 <span class="mono">TOKEN NEW { "roles": ["admin"] }</span> 即可签发。未开启“启用角色校验”时矩阵只记录不拦截。</div>
  </div>`;
}

function bindPermissions(it) {
  const perm = S.project.permissions;
  $('#permEnforce').onchange = (e) => { perm.enforce = e.target.checked; scheduleSave(); };
  $$('[data-role-route]').forEach((el) => {
    el.onchange = () => {
      const r = it.routes.find((x) => x.id === el.dataset.roleRoute);
      const role = el.dataset.role;
      r.roles = r.roles || [];
      if (el.checked && !r.roles.includes(role)) r.roles.push(role);
      if (!el.checked) r.roles = r.roles.filter((x) => x !== role);
      if (r.roles.length) r.auth = true;
      scheduleSave();
    };
  });
  $$('[data-role-del]').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.roleDel);
      const key = perm.roles[i].key;
      perm.roles.splice(i, 1);
      it.routes.forEach((r) => { r.roles = (r.roles || []).filter((x) => x !== key); });
      scheduleSave(); renderWorkspace();
    };
  });
  const add = $('[data-action="addRole"]');
  if (add) add.onclick = () => {
    const name = $('#roleName').value.trim();
    if (!name) return toast('先填角色名');
    const key = name.toLowerCase().replace(/[^a-z0-9_-]/g, '') || `role${perm.roles.length + 1}`;
    if (perm.roles.some((r) => r.key === key)) return toast('角色已存在');
    perm.roles.push({ key, name });
    scheduleSave(); renderWorkspace();
  };
}

/* ----- 对象表 ----- */
function tabObjects(it) {
  const obj = it.objects || (it.objects = { enabled: false, bucket: it.storage.bucket || 'clickbuild', prefix: '', pageSize: 20 });
  const rows = S.s3Rows || [];
  return `
  <div class="h-full overflow-auto p-3 text-[12px]">
    <div class="help-h flex items-center gap-2">对象存储表
      <span class="text-neutral-500 font-normal">把 RustFS / S3 桶里的对象直接列成表格，支持分页、下载、删除与生成对象表路由</span>
    </div>
    <div class="flex items-center gap-3" style="flex-wrap:wrap">
      <label class="flex items-center gap-1"><input type="checkbox" id="objEnabled" ${obj.enabled ? 'checked' : ''}> 启用对象表</label>
      桶 <input id="objBucket" class="border border-neutral-300 px-1 py-0.5 mono w-44" value="${esc(obj.bucket)}">
      前缀 <input id="objPrefix" class="border border-neutral-300 px-1 py-0.5 mono w-44" value="${esc(obj.prefix)}" placeholder="uploads/">
      每页 <input id="objPage" class="border border-neutral-300 px-1 py-0.5 mono w-16" value="${esc(obj.pageSize)}">
      <button class="btn thin" data-action="objList">预览对象</button>
      <button class="btn thin" data-action="objRoute">生成对象表路由</button>
    </div>
    <table class="help-grid mt-3">
      <thead><tr><th>对象键</th><th style="width:100px">大小</th><th style="width:170px">最后修改</th><th style="width:80px">下载</th></tr></thead>
      <tbody>
        ${rows.map((o) => `<tr><td class="mono break-all">${esc(o.key)}</td><td class="mono">${fmtSize(o.size)}</td><td class="mono">${esc(o.lastModified || '')}</td><td>${o.url ? `<a class="underline" href="${esc(o.url)}" target="_blank">打开</a>` : '—'}</td></tr>`).join('') || `<tr><td colspan="4" class="text-neutral-500">点“预览对象”列当前桶。</td></tr>`}
      </tbody>
    </table>
    <div class="text-neutral-500 mt-2">对象表路由返回 <span class="mono">{ ok, data:[{key,name,size,url}], page:{hasMore,nextMarker} }</span>，可直接给表格组件分页。</div>
  </div>`;
}

function bindObjects(it) {
  const obj = it.objects;
  $('#objEnabled').onchange = (e) => { obj.enabled = e.target.checked; scheduleSave(); };
  $('#objBucket').oninput = (e) => { obj.bucket = e.target.value; scheduleSave(); };
  $('#objPrefix').oninput = (e) => { obj.prefix = e.target.value; scheduleSave(); };
  $('#objPage').oninput = (e) => { obj.pageSize = Number(e.target.value) || 20; scheduleSave(); };
  const list = $('[data-action="objList"]');
  if (list) list.onclick = async () => {
    list.disabled = true; list.textContent = '读取中';
    const r = await api.listS3({ project: S.project, bucket: obj.bucket, prefix: obj.prefix });
    S.s3Rows = r.ok ? r.rows : [];
    renderWorkspace();
    if (!r.ok) toast('对象存储读取失败：' + String(r.error || '').slice(0, 160), 6000);
  };
  const mk = $('[data-action="objRoute"]');
  if (mk) mk.onclick = async () => {
    if (!obj.enabled) { obj.enabled = true; scheduleSave(); }
    if (it.routes.some((r) => r.key === 'objects')) return toast('已经存在对象表路由');
    it.routes.push({
      id: crypto.randomUUID().slice(0, 8), key: 'objects', name: '对象表', method: 'GET', path: '/objects',
      auth: false, summary: '列出桶内对象', guard: { tx: false, rate: { enabled: false }, schedule: { enabled: false }, breaker: { enabled: false } },
      script: '# 对象表由服务器直接列桶', cache: { enabled: false, key: '', ttl: 60 },
      docs: { summary: '', description: '', requestExample: '', responseExample: '' }, roles: [],
      proxy: { enabled: false, upstream: '', target: '', stripPrefix: true, forwardHeaders: true, timeout: 15000 },
    });
    S.tab = 'routes'; S.routeId = it.routes[it.routes.length - 1].id;
    scheduleSave(); renderWorkspace(); toast('已生成对象表路由');
  };
}

function fmtSize(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

/* ----- 接口文档 ----- */
function tabDocs(it) {
  const d = it.docs || {};
  return `
  <div class="h-full overflow-auto p-3 text-[12px]">
    <div class="docs-auto-banner">
      <span class="docs-auto-mark">AUTO</span>
      <span>文档由脚本、SQL 字段和接口类型自动生成：请求示例、响应示例、参数、错误码都来自真实脚本。改脚本后打开本页会自动刷新；手动改过的字段会保留。</span>
    </div>
    <div class="help-h">接口级文档（会写进 OpenAPI 的 tag 描述）</div>
    <table class="help-grid">
      <tbody>
        <tr><th style="width:120px">一句话说明</th><td><input class="cell-in" data-df="summary" value="${esc(d.summary || '')}" placeholder="例如：订单创建与查询"></td></tr>
        <tr><th>详细描述</th><td><textarea class="cell-in monoarea" rows="3" data-df="description" placeholder="这个接口负责什么、有哪些表、有什么约束">${esc(d.description || '')}</textarea></td></tr>
        <tr><th>负责人</th><td class="flex gap-2"><input class="cell-in" data-df="owner" value="${esc(d.owner || '')}" placeholder="张三">
          <span class="text-neutral-500">版本</span><input class="cell-in" data-df="version" value="${esc(d.version || '1.0.0')}" style="width:100px"></td></tr>
        <tr><th>标签</th><td><input class="cell-in" data-df="tags" value="${esc((d.tags || []).join(', '))}" placeholder="用户, 登录（逗号分隔）"></td></tr>
        <tr><th>请求示例</th><td>${it.routes.length > 1 ? '<span class="text-neutral-500">这个接口有多条路由，请求示例按路由分别生成，见下方表格。</span>' : `<textarea class="cell-in monoarea" rows="3" data-df="requestExample" placeholder='{"username":"alice"}'>${esc(d.requestExample || '')}</textarea>`}</td></tr>
        <tr><th>响应示例</th><td>${it.routes.length > 1 ? '<span class="text-neutral-500">响应示例按路由分别生成，来自脚本的 RETURN 与 SQL 字段。</span>' : `<textarea class="cell-in monoarea" rows="3" data-df="responseExample" placeholder='{"ok":true}'>${esc(d.responseExample || '')}</textarea>`}</td></tr>
        <tr><th>备注</th><td><textarea class="cell-in monoarea" rows="2" data-df="notes" placeholder="内部说明，不会公开到 /docs">${esc(d.notes || '')}</textarea></td></tr>
      </tbody>
    </table>

    <div class="help-h flex items-center gap-2">每条路由的文档
      <span class="text-neutral-500 font-normal">不是手填模板：打开页面时按脚本自动解析并补全</span>
      <button class="btn thin ml-auto" data-action="docs">预览 OpenAPI</button>
    </div>
    <table class="help-grid">
      <thead><tr><th style="width:110px">路由</th><th>说明</th><th>请求示例</th><th>响应示例</th></tr></thead>
      <tbody>
        ${it.routes.map((r) => {
          const rd = r.docs || {};
          return `<tr data-route-doc="${r.id}" data-doc-fp="${(r.docsAuto && r.docsAuto.fingerprint) || ''}">
            <td>${methodBadge(r.method)}<div class="mono text-[11px] text-neutral-500 break-all">${esc(r.path)}</div>${(r.docsAuto && r.docsAuto.fields && r.docsAuto.fields.length) ? '<span class="docs-auto-tag">脚本生成</span>' : ''}</td>
            <td><textarea class="cell-in" rows="2" data-rd="summary" placeholder="这条路由做什么">${esc(rd.summary || r.summary || '')}</textarea>
              <textarea class="cell-in monoarea" rows="6" data-rd="description" placeholder="参数、错误码">${esc(rd.description || '')}</textarea></td>
            <td><textarea class="cell-in monoarea" rows="6" data-rd="requestExample">${esc(rd.requestExample || '')}</textarea></td>
            <td><textarea class="cell-in monoarea" rows="6" data-rd="responseExample">${esc(rd.responseExample || '')}</textarea></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="text-neutral-500 mt-2">说明、参数、错误码、请求/响应示例都从脚本里的 SQL、{{body.x}} / {{query.x}} / {{file.x}} 和 RETURN 分支推导。手改某个字段后，该字段不再自动覆盖。</div>
  </div>`;
}

function bindDocs(it) {
  $$('[data-df]').forEach((el) => {
    el.oninput = () => {
      it.docs = it.docs || {};
      const k = el.dataset.df;
      it.docs[k] = k === 'tags' ? el.value.split(',').map((s) => s.trim()).filter(Boolean) : el.value;
      scheduleSave();
    };
  });
  $$('[data-route-doc]').forEach((row) => {
    const r = it.routes.find((x) => x.id === row.dataset.routeDoc);
    if (!r) return;
    row.querySelectorAll('[data-rd]').forEach((el) => {
      el.oninput = () => {
        r.docs = r.docs || {};
        r.docs[el.dataset.rd] = el.value;
        r.docsAuto = r.docsAuto || { fingerprint: '', fields: [] };
        r.docsAuto.fields = (r.docsAuto.fields || []).filter((f) => f !== el.dataset.rd);
        if (el.dataset.rd === 'summary') r.summary = el.value;
        scheduleSave();
      };
    });
    refreshRouteDocs(it, r, row).catch(() => {});
  });
}

async function refreshRouteDocs(it, r, row) {
  if (!api.inferDocs) return;
  const facts = await api.inferDocs(it, r);
  if (!facts || !row.isConnected) return;
  const fields = ['summary', 'description', 'requestExample', 'responseExample'];
  const auto = new Set((r.docsAuto && r.docsAuto.fields) || []);
  r.docs = r.docs || {};
  let changed = false;
  const nextAuto = Array.from(auto);
  for (const field of fields) {
    if (!r.docs[field] || auto.has(field)) {
      if (r.docs[field] !== facts[field]) {
        r.docs[field] = facts[field];
        changed = true;
      }
      if (!nextAuto.includes(field)) nextAuto.push(field);
      const el = row.querySelector(`[data-rd="${field}"]`);
      if (el) el.value = facts[field] || '';
    }
  }
  if (changed || !r.docsAuto || r.docsAuto.fingerprint !== facts.fingerprint) {
    r.docsAuto = { fingerprint: facts.fingerprint, fields: nextAuto };
    if (r.docs.summary) r.summary = r.docs.summary;
    scheduleSave();
  }
}

/* ----- 缓存与存储 ----- */
function tabCache(it) {
  return `
  <div class="p-3 overflow-auto h-full text-[12px]">
    <div class="help-h">Redis 旁路缓存（每条路由单独开关）</div>
    <table class="help-grid">
      <thead><tr><th>路由</th><th>方法</th><th style="width:80px">启用</th><th style="width:90px">TTL 秒</th><th>缓存键模板</th></tr></thead>
      <tbody>
        ${it.routes.map((r) => `<tr>
          <td>${esc(r.name)}</td><td>${methodBadge(r.method)}</td>
          <td class="text-center"><input type="checkbox" data-cr="${r.id}" ${r.cache.enabled ? 'checked' : ''}></td>
          <td><input class="cell-in mono" data-ct="${r.id}" value="${esc(r.cache.ttl)}"></td>
          <td><input class="cell-in mono" data-ck="${r.id}" value="${esc(r.cache.key)}" placeholder="icb:{{t:main}}:{{queryHash}}"></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="text-neutral-500 mt-1">写操作成功后会自动清掉 icb:&lt;表名&gt;:* 的键。</div>

    <div class="help-h">对象存储（RustFS / S3）</div>
    <div class="flex items-center gap-3">
      <label class="flex items-center gap-1"><input type="checkbox" id="stEnabled" ${it.storage.enabled ? 'checked' : ''}> 启用上传</label>
      桶 <input id="stBucket" class="border border-neutral-300 px-1 py-0.5 mono w-40" value="${esc(it.storage.bucket)}">
      入库字段 <input id="stBind" class="border border-neutral-300 px-1 py-0.5 mono w-36" value="${esc(it.storage.bindField)}">
    </div>
    <div class="text-neutral-500 mt-1">附件路由会把文件写进桶，再把对象键写回主表；{{objectKey}} / {{objectUrl}} 在脚本里可直接用。</div>

    <div class="help-h">分页</div>
    默认每页 <input id="pgSize" class="border border-neutral-300 px-1 py-0.5 mono w-16" value="${esc(it.page.size)}"> 条
  </div>`;
}

function bindCache(it) {
  $$('[data-cr]').forEach((el) => {
    el.onchange = () => { const r = it.routes.find((x) => x.id === el.dataset.cr); r.cache.enabled = el.checked; scheduleSave(); };
  });
  $$('[data-ct]').forEach((el) => {
    el.oninput = () => { const r = it.routes.find((x) => x.id === el.dataset.ct); r.cache.ttl = Number(el.value) || 60; scheduleSave(); };
  });
  $$('[data-ck]').forEach((el) => {
    el.oninput = () => { const r = it.routes.find((x) => x.id === el.dataset.ck); r.cache.key = el.value; scheduleSave(); };
  });
  $('#stEnabled').onchange = (e) => { it.storage.enabled = e.target.checked; scheduleSave(); };
  $('#stBucket').oninput = (e) => { it.storage.bucket = e.target.value; scheduleSave(); };
  $('#stBind').oninput = (e) => { it.storage.bindField = e.target.value; scheduleSave(); };
  $('#pgSize').oninput = (e) => { it.page.size = Number(e.target.value) || 20; scheduleSave(); };
}

/* ----- 测试 ----- */
function runnerOptions() {
  const list = (S.runtimes && S.runtimes.length) ? S.runtimes : [
    { id: 'node', name: 'Node', available: true, note: '内置 Node.js' },
    { id: 'bun', name: 'Bun', available: false, note: '未检测到 Bun' },
    { id: 'java', name: 'Java', available: false, note: '未检测到 JDK' },
    { id: 'go', name: 'Go', available: false, note: '未检测到 Go' },
  ];
  return list.map((r) => {
    const ver = String(r.version || '').replace(/^java version "?([^"\s]+)"?.*$/i, '$1').replace(/^go version go/i, '').replace(/^v/i, '').split(/\s+/)[0];
    const label = `${r.name}${ver ? ' ' + ver : ''}${r.native === false && r.available ? '（启动器）' : ''}${r.available ? '' : '（不可用）'}`;
    return `<option value="${r.id}" ${r.id === S.runner ? 'selected' : ''} ${r.available ? '' : 'disabled'} title="${esc(r.note || '')}">${esc(label)}</option>`;
  }).join('');
}

function testCountsText() {
  const c = S.testCounts;
  if (!c) return S.genDir ? '还没有生成测试' : '生成服务会自动带出 tests/';
  return `${c.interfaces} 接口 · ${c.routes} 路由 · ${c.cases} 用例 · ${c.runnable} 可执行 · ${c.writeCases || 0} 写入用例 · ${c.skipped} 跳过`;
}

function tabTest(it) {
  const server = ((S.services && S.services.items) || []).find((x) => x.id === 'server') || {};
  const running = !!server.running;
  return `
  <div class="h-full flex flex-col p-3 gap-2 text-[12px] overflow-auto">
    <div class="border border-neutral-300 bg-neutral-50 px-2 py-1.5 flex items-center gap-2 flex-wrap">
      <b class="text-[12px]">自动测试</b>
      <span class="text-neutral-500">按接口、路由、字段和鉴权生成 Node 测试，不用手写</span>
      <button class="btn thin" data-action="genTests">生成测试</button>
      <button class="btn thin" data-action="openGenDir">打开生成目录</button>
      <span id="tGenInfo" class="mono text-[11px] text-neutral-600 ml-auto">${esc(testCountsText())}</span>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <select id="tRoute" class="border border-neutral-300 px-1 py-1 mono">
        ${it.routes.map((r) => `<option value="${r.id}">${esc(r.method)} ${esc(r.path)} · ${esc(r.name)}</option>`).join('')}
      </select>
      <input id="tId" class="border border-neutral-300 px-2 py-1 mono w-28" placeholder=":id 的值">
      <span class="flex items-center gap-1"><span class="dot ${running ? 'on' : 'off'}"></span>${running ? '运行中' : '已停止'}</span>
      <select id="tRuntime" class="border border-neutral-300 px-1 py-1 mono" title="选择启动运行时">${runnerOptions()}</select>
      <label class="flex items-center gap-1 cursor-pointer" title="监听文件变化并自动重启"><input id="tHot" type="checkbox" ${S.hot ? 'checked' : ''}>热部署</label>
      <button class="btn thin" data-action="${running ? 'stopServer' : 'startServer'}">${running ? '停止服务' : '启动服务'}</button>
      <button class="btn thin" data-action="console">打开主页</button>
      <button class="btn solid ml-auto" data-action="send">发送</button>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div><div class="text-neutral-500 mb-1">Query（a=1&amp;b=2）</div><textarea id="tQuery" class="w-full border border-neutral-300 monoarea p-2" rows="2" placeholder="page=1&pageSize=5"></textarea></div>
      <div><div class="text-neutral-500 mb-1">Body（JSON）</div><textarea id="tBody" class="w-full border border-neutral-300 monoarea p-2" rows="2" placeholder='{"username":"tom","password":"123"}'></textarea></div>
    </div>
    <div class="flex-1 min-h-40 flex flex-col">
      <div class="text-neutral-500 mb-1">响应</div>
      <pre id="tOut" class="flex-1 border border-neutral-300 monoarea p-2 overflow-auto whitespace-pre-wrap">—</pre>
    </div>
  </div>`;
}

function bindTest(it) {
  const route = it.routes.find((x) => x.id === S.routeId) || it.routes[0];
  $('#tRoute').value = route.id;
  $('#tRoute').onchange = (e) => { S.routeId = e.target.value; };
  const rt = $('#tRuntime');
  if (rt) {
    rt.onchange = (e) => { S.runner = e.target.value; };
  }
  const hot = $('#tHot');
  if (hot) {
    hot.onchange = (e) => { S.hot = e.target.checked; };
  }
}

/* ----- 导出 ----- */
function tabExport(it) {
  const server = ((S.services && S.services.items) || []).find((x) => x.id === 'server') || {};
  const running = !!server.running;
  return `
  <div class="h-full flex flex-col p-3 gap-3 text-[12px] overflow-auto">
    <div class="help-h">生成服务</div>
    <div class="flex items-center gap-2 flex-wrap">
      <button class="btn solid" data-action="generate">生成到 generated/iface</button>
      <button class="btn thin" data-action="exportProject">导出工程（IDEA）</button>
      <span class="flex items-center gap-1"><span class="dot ${running ? 'on' : 'off'}"></span>${running ? '运行中' : '已停止'}</span>
      <select id="eRuntime" class="border border-neutral-300 px-1 py-1 mono" title="选择启动运行时">${runnerOptions()}</select>
      <label class="flex items-center gap-1 cursor-pointer" title="监听文件变化并自动重启"><input id="eHot" type="checkbox" ${S.hot ? 'checked' : ''}>热部署</label>
      <button class="btn thin" data-action="${running ? 'stopServer' : 'startServer'}">${running ? '停止服务' : `启动服务（:${S.settings.ports.http}）`}</button>
      <button class="btn thin" data-action="console">打开主页</button>
    </div>
    <div class="text-[11px] text-neutral-500">导出工程会新建一个独立目录，带 <span class="mono">.idea</span> 配置、启动配置和 <span class="mono">dev.js</span> 热部署脚本；IDEA 里 File → Open 直接打开。</div>
    <div class="mono text-[11px] break-all">${esc(S.genDir || '还没有生成')}</div>
    <div class="text-[11px] text-neutral-500">生成服务时会一起写 tests/。列表与 404 断言默认只读；写入生命周期在工程目录用 CBS_WRITE_TESTS=1 npm run test:api 显式开启，跳过原因写进 tests/plan.json。</div>

    <div class="help-h">生成物</div>
    <table class="help-grid">
      <thead><tr><th>文件</th><th>用途</th></tr></thead>
      <tbody>
        <tr><td class="mono">server.js</td><td>启动建库建表、挂路由、执行脚本</td></tr>
        <tr><td class="mono">src/modules/*/index.js</td><td>每个接口一个模块，自动加载；可加 handler / setup</td></tr>
        <tr><td class="mono">src/script.js</td><td>脚本解释器</td></tr>
        <tr><td class="mono">src/render.js</td><td>占位符 / 参数化 SQL 引擎</td></tr>
        <tr><td class="mono">src/funcs.js</td><td>HASH / SM3 / SM4 / SUBSTR… 扩展函数</td></tr>
        <tr><td class="mono">interfaces.json</td><td>接口、表、脚本的完整描述</td></tr>
        <tr><td class="mono">tests/api.test.js</td><td>按接口、路由、字段和鉴权自动生成的 API 测试（Node 原生 test runner）</td></tr>
        <tr><td class="mono">tests/plan.json</td><td>测试计划：可执行用例、跳过原因、写入开关</td></tr>
        <tr><td class="mono">sql/*.sql</td><td>每张表的建表语句</td></tr>
        <tr><td class="mono">export/js|java|go</td><td>每条路由转成 JS / Java / Go</td></tr>
      </tbody>
    </table>

    <div class="help-h">自定义函数</div>
    <table class="help-grid">
      <thead><tr><th>名字</th><th>参数</th><th>表达式</th><th></th></tr></thead>
      <tbody>
        ${(S.project.functions || []).map((f, i) => `<tr>
          <td><input class="cell-in mono" data-fn="${i}" data-ff="name" value="${esc(f.name)}"></td>
          <td><input class="cell-in mono" data-fn="${i}" data-ff="params" value="${esc((f.params || []).join(','))}"></td>
          <td><input class="cell-in mono" data-fn="${i}" data-ff="body" value="${esc(f.body)}"></td>
          <td class="text-center"><button class="btn thin" data-fdel="${i}">×</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="flex gap-2"><button class="btn thin" data-action="addFunc">＋ 自定义函数</button>
    <span class="text-neutral-500">例：MASK_PHONE(v) → CONCAT(SUBSTR(v,0,3),"****",SUBSTR(v,7,4))</span></div>
  </div>`;
}

function bindExport(it) {
  const rt = $('#eRuntime');
  if (rt) rt.onchange = (e) => { S.runner = e.target.value; };
  const hot = $('#eHot');
  if (hot) hot.onchange = (e) => { S.hot = e.target.checked; };
  $$('[data-fn]').forEach((el) => {
    const i = Number(el.dataset.fn);
    const k = el.dataset.ff;
    el.oninput = () => {
      const f = S.project.functions[i];
      if (k === 'params') f.params = el.value.split(',').map((s) => s.trim()).filter(Boolean);
      else if (k === 'name') f.name = el.value.toUpperCase();
      else f.body = el.value;
      scheduleSave();
    };
  });
  $$('[data-fdel]').forEach((b) => {
    b.onclick = () => { S.project.functions.splice(Number(b.dataset.fdel), 1); scheduleSave(); renderWorkspace(); };
  });
}

/* ---------------- 帮助中心 ---------------- */
const HELP_ROUTE_DOCS = [
  { key: 'list', name: '列表', desc: '分页查询，默认带 {{where}}、{{orderBy}}、{{limit}}、{{offset}}，支持筛选、排序、关键词与 Redis 缓存。' },
  { key: 'detail', name: '详情', desc: '按主键查一条；找不到返回 404。默认路径里的 :id 由请求路径提供。' },
  { key: 'create', name: '新建', desc: '按请求体插入记录；默认脚本带事务。返回 201 与 insertId。' },
  { key: 'update', name: '更新', desc: '按主键更新；只写请求体里出现的字段，先查存在再更新。' },
  { key: 'delete', name: '删除', desc: '按主键删除；先查存在，再删，返回 affectedRows。' },
  { key: 'upload', name: '附件', desc: 'multipart 上传；服务先写 S3，脚本里直接拿 {{objectKey}} 入库。默认路径结尾是 /file。' },
  { key: 'proxy', name: '上游转发', desc: '把请求透传到“上游”页配置的服务；可改目标路径、超时、是否转发请求头。' },
  { key: 'objects', name: '对象表', desc: '直接列对象存储桶里的文件，不走 SQL；适合做文件库、素材库。' },
  { key: 'crawl', name: '抓取', desc: '抓取 http(s) 网页，返回 title、text、links；默认禁止内网地址。' },
  { key: 'custom', name: '自定义', desc: '一段完全自写的脚本；新建时会生成 /custom-N，路径可以随时改。' },
];

const HELP_FUNCS = [
  ['HASH', 'HASH(algo, v)', '按算法算十六进制摘要；algo 支持 md5、sha1、sha256、sm3 等 Node 支持的名称。', "HASH('sha256', {{body.password}})"],
  ['MD5', 'MD5(v)', 'MD5 摘要，兼容老系统。', 'MD5({{body.text}})'],
  ['SHA1', 'SHA1(v)', 'SHA-1 摘要。', 'SHA1({{body.text}})'],
  ['SHA256', 'SHA256(v)', 'SHA-256 摘要，常用密码哈希。', 'SHA256({{body.password}})'],
  ['SM3', 'SM3(v)', '国密 SM3 摘要。', 'SM3({{body.id_card}})'],
  ['SM4_ENC', 'SM4_ENC(v, key)', '国密 SM4 加密，返回 Base64；key 满 16 字节直接用，否则 SHA-256 截前 16 字节。', "SM4_ENC({{body.phone}}, 'clickbuild-key')"],
  ['SM4_DEC', 'SM4_DEC(v, key)', 'SM4 解密；key 必须与加密时一致。', "SM4_DEC($row.secret, 'clickbuild-key')"],
  ['SUBSTR', 'SUBSTR(v, start, len)', '截取字符串；start 从 0 开始，len 可省略。', 'SUBSTR({{body.phone}}, 7, 4)'],
  ['LEFT', 'LEFT(v, n)', '取左边 n 个字符。', "LEFT('13800138000', 3)"],
  ['RIGHT', 'RIGHT(v, n)', '取右边 n 个字符。', "RIGHT('13800138000', 4)"],
  ['LEN', 'LEN(v)', '字符串或数组长度。', 'LEN($rows.rows)'],
  ['UPPER', 'UPPER(v)', '转大写。', 'UPPER({{body.code}})'],
  ['LOWER', 'LOWER(v)', '转小写。', 'LOWER({{body.email}})'],
  ['TRIM', 'TRIM(v)', '去掉首尾空白。', 'TRIM({{body.name}})'],
  ['CONCAT', 'CONCAT(...)', '拼接任意多个值。', "CONCAT('NO-', {{body.id}})"],
  ['REPLACE', 'REPLACE(v, from, to)', '把 from 全部替换成 to。', "REPLACE({{body.phone}}, '-', '')"],
  ['SPLIT', 'SPLIT(v, sep)', '按分隔符切成数组；sep 省略时按逗号。', "SPLIT({{body.tags}}, ',')"],
  ['JOIN', 'JOIN(arr, sep)', '把数组拼成字符串。', "JOIN($roles, '|')"],
  ['NOW', 'NOW()', '当前时间，格式 YYYY-MM-DD HH:MM:SS。', 'NOW()'],
  ['TODAY', 'TODAY()', '今天，格式 YYYY-MM-DD。', 'TODAY()'],
  ['UUID', 'UUID()', '标准 UUID v4。', 'UUID()'],
  ['BASE64_ENC', 'BASE64_ENC(v)', 'UTF-8 字符串转 Base64。', "BASE64_ENC('hello')"],
  ['BASE64_DEC', 'BASE64_DEC(v)', 'Base64 还原成 UTF-8 字符串。', 'BASE64_DEC({{body.data}})'],
  ['URL_ENC', 'URL_ENC(v)', 'URL 编码。', 'URL_ENC({{body.keyword}})'],
  ['URL_DEC', 'URL_DEC(v)', 'URL 解码。', 'URL_DEC({{query.q}})'],
  ['INT', 'INT(v)', '转整数，失败为 0。', "INT('12px')"],
  ['FLOAT', 'FLOAT(v)', '转浮点数，失败为 0。', "FLOAT('3.14')"],
  ['STR', 'STR(v)', '转字符串；对象会转 JSON。', 'STR($ins.insertId)'],
  ['ROUND', 'ROUND(v, n)', '四舍五入到 n 位小数。', 'ROUND({{body.amount}}, 2)'],
  ['ABS', 'ABS(v)', '绝对值。', 'ABS({{body.delta}})'],
  ['COALESCE', 'COALESCE(...)', '返回第一个非 null、非 undefined、非空字符串的值。', "COALESCE({{body.nickname}}, '匿名')"],
  ['MASK', 'MASK(v, start, len, ch)', '从 start 开始遮住 len 个字符，ch 默认星号。', "MASK({{body.phone}}, 3, 4, '*')"],
  ['JSON_GET', 'JSON_GET(obj, path)', '按点路径取 JSON 字段；数组用数字下标。', "JSON_GET({{body.meta}}, 'user.name')"],
  ['JSON_STR', 'JSON_STR(v)', '把值序列化成 JSON 字符串。', 'JSON_STR($rows.rows)'],
  ['RAND_INT', 'RAND_INT(a, b)', '闭区间随机整数。', 'RAND_INT(1000, 9999)'],
  ['IF', 'IF(cond, a, b)', '三元表达式；条件为真返回 a，否则 b。', "IF({{body.vip}}, 'VIP', '普通')"],
  ['IN', 'IN(v, arr)', '判断值是否在数组里，返回 true/false。', "IN({{body.status}}, ['paid', 'shipped'])"],
  ['CONTAINS', 'CONTAINS(v, sub)', '字符串是否包含子串。', "CONTAINS('order-1001', 'order')"],
  ['START_WITH', 'START_WITH(v, sub)', '是否以子串开头；函数名就是 START_WITH。', "START_WITH('order-1001', 'order')"],
  ['END_WITH', 'END_WITH(v, sub)', '是否以子串结尾。', "END_WITH('file.pdf', '.pdf')"],
];

const HELP_SECTIONS = [
  {
    id: 'quick', group: '开始', nav: '5 分钟跑通', num: '01', title: '5 分钟跑通第一个接口', lead: '从空白工程到能返回 200 的列表接口，只走真实按钮，不写配置文件。',
    body: `
      <div class="hb-grid">
        <div class="hb-card"><b>你会得到</b><p>一个「订单」接口、一张 orders 表、五条基础路由，以及能在浏览器和 curl 里访问的列表 / 新建接口。</p></div>
        <div class="hb-card"><b>开始前</b><p>不需要先装 MariaDB、Redis、S3。点“启动”时应用会拉起内置三台服务，实际端口以工作台右侧的“运行环境”为准。</p></div>
      </div>
      <div class="hb-step"><span class="hb-step-n">1</span><div class="hb-step-body"><b>新建一个任务</b><p>在工程历史页点右上角“新建任务”，任务类型选“只后端”（只做 API）或“混合任务”（API + 前端）。新建出来的是空白工程，没有接口是正常的。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">2</span><div class="hb-step-body"><b>新建接口</b><p>进入工作台后点 Ribbon 的“新建接口”，或按 <span class="hb-kbd">Ctrl+N</span>。创建引导一共四步：基础信息 → 主表 → 路由 → 确认。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">3</span><div class="hb-step-body"><b>填主表字段</b><p>第二步每行一个字段，格式是“字段名 类型 注释”。可以直接粘贴：</p>
        <div class="hb-code"><div class="hb-code-head">初始业务字段</div><pre>name varchar 名称
price decimal 价格
status tinyint 状态 0 下架 1 上架</pre></div>
        <p>系统会自动补 id 主键、created_at、updated_at。点“下一步”。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">4</span><div class="hb-step-body"><b>保留五条基础路由</b><p>第三步默认勾选列表、详情、新建、更新、删除；鉴权先选“公开”。到第四步检查预览，点“确认创建”。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">5</span><div class="hb-step-body"><b>启动并访问</b><p>点 Ribbon 的“启动”。它会保存、生成服务、拉起依赖、启动网页服务并自动打开主页。状态区显示三台依赖都在运行后，再试接口。</p></div></div>
      <div class="hb-code"><div class="hb-code-head">命令行验收（PowerShell 用 curl.exe）</div><pre>curl.exe "http://127.0.0.1:18100/api/orders?page=1&amp;pageSize=5"
curl.exe -X POST "http://127.0.0.1:18100/api/orders" -H "Content-Type: application/json" -d '{"name":"首单","price":99.5}'</pre></div>
      <div class="hb-check"><b>跑通标准</b><div>① 主页能打开；② 列表返回 200 且 rows 是数组；③ 新建返回 201 和 id；④ 再查列表能看到刚插入的那条；⑤ 服务 /help 与 /docs 都能打开。</div></div>
      <div class="hb-tip"><b>提示</b><div>地址由三部分组成：<span class="hb-inline">/api</span> + 接口里的“路径前缀” + 路由路径。没填前缀时就是 <span class="hb-inline">/api/orders</span>。端口在“设置 → 本地服务端口”里改，默认 18100。</div></div>
    `,
  },
  {
    id: 'concept', group: '开始', nav: '六个概念', num: '02', title: '先弄懂六个概念', lead: '后面所有操作都围绕这六个对象，先分清“接口”和“路由”就不会迷路。',
    body: `
      <div class="hb-grid">
        <div class="hb-card"><b>工程 Project</b><p>一个可保存、可切换的工作单元。工程名显示在标题栏，自动保存成工程 JSON，也能打包成 .yxpn。</p></div>
        <div class="hb-card"><b>接口 Interface</b><p>一组业务能力的集合，比如“订单”。一个接口可以有多张表和多条路由；表键 main 是主表。</p></div>
        <div class="hb-card"><b>表 Table</b><p>真正建到 MariaDB 的表。表名全局唯一；表键 main、item 用于脚本占位符，不参与 SQL 表名。</p></div>
        <div class="hb-card"><b>路由 Route</b><p>一条真实的 HTTP 入口：方法 + 路径 + 一段脚本。列表、详情、新建都是路由，不是表。</p></div>
        <div class="hb-card"><b>脚本 Script</b><p>每条路由自己的执行逻辑。生成的服务器里跑的是同一套解释器，不是只给你看的示例。</p></div>
        <div class="hb-card"><b>任务类型 Task</b><p>只前端 / 只后端 / 混合。只控制哪些入口出现，不会删除已有数据，随时能切回来。</p></div>
      </div>
      <div class="hb-code"><div class="hb-code-head">对象关系</div><pre>工程
└─ 接口（订单）               路径前缀 /v1/orders
   ├─ 表 main  → biz_order     主表，字段、主键、索引语义
   ├─ 表 item  → biz_order_item 明细表，脚本里用 {{t:item}}
   └─ 路由 GET /api/v1/orders   → 一段脚本 → SQL / Redis / S3</pre></div>
      <div class="hb-p"><b>一句话判断：</b>想“存什么”改表；想“怎么访问、返回什么”改路由和脚本；想“这组功能属于谁”改接口；想“整个项目怎么交付”改工程和任务类型。</div>
      <div class="hb-warn"><b>注意</b><div>“表键”和“表名”不是一回事。表键是脚本里的引用名（main、item），表名才是数据库里的真实表名。改表名不会自动改脚本里的表键。</div></div>
    `,
  },
  {
    id: 'project', group: '开始', nav: '工程与任务类型', num: '03', title: '新建、打开与任务类型', lead: '工程历史页负责选择工作对象；工作台只显示当前任务真正需要的入口。',
    body: `
      <div class="hb-h3">先认清工作台的四个区域</div>
      <div class="hb-grid">
        <div class="hb-card"><b>顶部：项目标签 + Ribbon</b><p>项目标签显示当前打开的工程；下面一排 Ribbon 按“工程 / 接口 / 表结构 / 脚本 / 运行 / 插件 / 导出与更多”分组，新建接口、启动、测试都在这里。</p></div>
        <div class="hb-card"><b>左侧：接口内部导航</b><p>“业务表格、平台表格、删除接口、表结构、路由脚本、接口类型、接口文档、缓存与存储、上游、权限、对象表、测试、生成导出”。它只切换当前接口的页，不等于切换工程。</p></div>
        <div class="hb-card"><b>中间：当前页画布</b><p>字段表格、脚本编辑器、文档预览、试运行结果都落在这里。宽度变化时表格和编辑器会自适应，左导航不会消失。</p></div>
        <div class="hb-card"><b>右侧：运行环境</b><p>显示 MariaDB、Redis、RustFS、生成服务的真实端口、运行状态和进程内存；服务没起来时，这里就是第一现场。帮助模式会临时收起这一栏给正文让位。</p></div>
      </div>
      <div class="hb-tip"><b>找不到按钮时</b><div>先看 Ribbon 的分组名，再看左侧导航。底部状态栏会写当前工程、接口数、表数和“已保存”，右侧同时显示 CPU、内存、磁盘、服务运行数和进程内存；点这一块会展开资源占用分析，列出每个服务进程的 PID、内存、端口，并根据磁盘余量、服务在线情况给出提示。右上角“搜索接口 / 表 / 字段 / 路由 / SQL”是跨当前工程搜索，不是帮助搜索。</div></div>
      <div class="hb-h3">工程历史页</div>
      <div class="hb-p">启动应用先进入“工程历史”。左键工程卡片直接打开；右键有“打开 / 复制工程 / 删除工程”；卡片右上角红叉也是删除。顶部搜索会同时过滤工程名、描述、路径和模版标签。</div>
      <div class="hb-grid">
        <div class="hb-card"><b>新建任务</b><p>生成空白工程并进入工作台。三种任务类型：只前端、只后端、混合。</p></div>
        <div class="hb-card"><b>从模版开始</b><p>下方模版卡片会带完整业务结构；点一张就按模版新建工程，适合先看成品再改。</p></div>
        <div class="hb-card"><b>导入 .yxpn</b><p>“更多…”里的“导入 .yxpn”，会把工程包还原成可编辑工程；导出时连前端和文档一起带走。</p></div>
        <div class="hb-card"><b>多项目标签</b><p>打开另一个工程会开新标签；<span class="hb-kbd">Ctrl+Tab</span> 切换，标签上中键或右键可关闭。</p></div>
      </div>
      <div class="hb-h3">三种任务类型看到什么</div>
      <table class="hb-table"><thead><tr><th>类型</th><th>入口</th><th>适合</th></tr></thead><tbody>
        <tr><td><b>只后端</b></td><td>接口工作台、表结构、路由、测试、导出；不显示前端工坊，也不显示“更新部署”。</td><td>只交付 API、脚本、数据库结构。</td></tr>
        <tr><td><b>只前端</b></td><td>直接进入前端工坊；隐藏接口搜索和“生成服务”，不显示接口工作台。</td><td>只做页面，不碰接口。</td></tr>
        <tr><td><b>混合</b></td><td>顶部出现“接口 / 前端”切换，两个工作台都能用，适合从接口到页面一起交付。</td><td>完整业务应用。</td></tr>
      </tbody></table>
      <div class="hb-tip"><b>自动保存</b><div>改工程名、字段、脚本、路由都会自动保存；<span class="hb-kbd">Ctrl+S</span> 只是立即落盘。新建任务或打开另一个工程前，应用会先等当前保存完成，避免丢改动。</div></div>
      <div class="hb-warn"><b>删除不可撤销</b><div>工程历史里删除会把工程 JSON 从磁盘删掉，不是只从列表移除。重要工程先“导出 .yxpn”留一份。</div></div>
    `,
  },
  {
    id: 'schema', group: '核心', nav: '建表与字段', num: '04', title: '建表、字段与导入表格', lead: '接口里的表结构直接决定 SQL、文档、表单和对象存储绑定。',
    body: `
      <div class="hb-h3">主表从创建引导来，更多表在“表结构”页加</div>
      <div class="hb-p">创建引导会生成一张主表（表键固定 main）。进入接口后，点“表结构”页的“＋ 表”可以加明细表、日志表、配置表；点表头标签或“快速切表”切换。表键自动生成，脚本里用 <span class="hb-inline">{{t:main}}</span>、<span class="hb-inline">{{t:item}}</span> 引用。</div>
      <div class="hb-h3">字段表格 A–J 列</div>
      <table class="hb-table"><thead><tr><th>列</th><th>作用</th><th>怎么选</th></tr></thead><tbody>
        <tr><td>A 字段</td><td>数据库列名，脚本和请求体都用它。</td><td>小写字母、数字、下划线；不要和 id / created_at / updated_at 重名。</td></tr>
        <tr><td>B 类型</td><td>决定 SQL 类型、表单控件、文档示例。</td><td>金额用 decimal，状态用 tinyint，长文用 text。</td></tr>
        <tr><td>C 主键</td><td>每张表一个主键；没有时会退回第一个字段。</td><td>业务表通常 id + 自增。</td></tr>
        <tr><td>D 自增</td><td>插入时不从请求体取值，由数据库生成。</td><td>和主键一起勾。</td></tr>
        <tr><td>E 可空</td><td>允许 NULL；不勾表示必填。</td><td>可选备注、可选外键可以勾。</td></tr>
        <tr><td>F 搜索</td><td>把字段加入 {{where}} 的 keyword 搜索范围。</td><td>订单号、客户、标题、SKU 等要搜的文本字段。</td></tr>
        <tr><td>G 隐藏</td><td>不出现在列表字段、文档、响应；也不参与 query 条件。</td><td>密码哈希、内部标记、token。</td></tr>
        <tr><td>H 默认</td><td>请求体没给值时使用；也写进建表语句。</td><td>CURRENT_TIMESTAMP、0、空字符串。</td></tr>
        <tr><td>I 注释</td><td>写进数据库注释和文档说明。</td><td>用一句业务话解释，不要写“字段1”。</td></tr>
        <tr><td>J 删除</td><td>移除这一行字段。</td><td>主键、业务正在用的列删除前先改脚本。</td></tr>
      </tbody></table>
      <div class="hb-h3">25 种字段类型</div>
      <table class="hb-table"><thead><tr><th>组</th><th>类型</th><th>用途与注意</th></tr></thead><tbody>
        <tr><td>数字 8 种</td><td class="mono">bigint / int / smallint / tinyint / bool / decimal / float / double</td><td>bool 落库是 TINYINT(1)；decimal 默认 DECIMAL(18,2)，金额不要用 float。</td></tr>
        <tr><td>文本 4 种</td><td class="mono">varchar / char / text / longtext</td><td>varchar 默认 VARCHAR(255)，char 默认 CHAR(32)；长文用 text / longtext。</td></tr>
        <tr><td>时间 2 种</td><td class="mono">datetime / date</td><td>datetime 存日期时间，date 只存日期。</td></tr>
        <tr><td>语义 3 种</td><td class="mono">json / token / url</td><td>json 落库仍是 JSON；token 默认隐藏且不参与查询；url 按链接生成文档示例。</td></tr>
        <tr><td>文件 8 种</td><td class="mono">file / image / video / audio / pdf / doc / excel / archive</td><td>SQL 里只存 S3 对象键，不把文件本体塞进数据库；上传路由会按类型限制文件。</td></tr>
      </tbody></table>
      <div class="hb-tip"><b>文件字段的正确用法</b><div>把字段类型设成 image / file 等，再给路由分配“文件上传”或“图片上传”类型。上传成功后脚本里用 <span class="hb-inline">{{objectKey}}</span> 入库，列表接口返回对象键，前端再换成可访问 URL。</div></div>
      <div class="hb-h3">从 CSV / TSV 导入字段</div>
      <div class="hb-p">表结构页底部点“导入表格”，选择 .csv / .tsv / .txt。第一行当表头，后面样例数据用来猜类型；已有主键、自增标记会保留。导入会替换当前表字段，操作前先确认表名。</div>
      <div class="hb-check"><b>验收标准</b><div>表头 25 种类型都能选；勾“搜索”的文本字段能被 <span class="hb-inline">?keyword=</span> 命中；隐藏字段不出现在 <span class="hb-inline">{{columns}}</span> 和列表响应里；文件字段只看到对象键。</div></div>
    `,
  },
  {
    id: 'routes', group: '核心', nav: '10 种路由', num: '05', title: '10 种路由与真实地址', lead: '路由决定访问方式和默认脚本；所有路径最终都由 /api + 接口前缀 + 路由路径拼成。',
    body: `
      <table class="hb-table"><thead><tr><th>路由</th><th>方法</th><th>默认路径</th><th>它做什么</th></tr></thead><tbody>@@ROUTE_ROWS@@</tbody></table>
      <div class="hb-p"><b>路径里的 <span class="hb-inline">:table</span> 是占位符。</b>创建路由时它会换成主表名，例如主表 orders 的详情路由实际是 <span class="hb-inline">/orders/:id</span>；<span class="hb-inline">:id</span> 是请求路径参数。</div>
      <div class="hb-h3">怎么加、怎么改</div>
      <div class="hb-p">“路由脚本”页左侧是路由列表，底部下拉选类型，点“＋ 加路由”。右侧可以改名字、接口类型、方法、路径、Redis 缓存开关，再直接编辑脚本。默认五条基础路由创建后仍可逐条修改或删除。</div>
      <div class="hb-code"><div class="hb-code-head">地址拼装</div><pre>最终地址 = /api + 接口“路径前缀” + 路由路径

接口前缀 /v1 + 列表路径 /orders
→ GET http://127.0.0.1:18100/api/v1/orders

接口前缀为空 + 详情路径 /orders/:id
→ GET http://127.0.0.1:18100/api/orders/12</pre></div>
      <div class="hb-tip"><b>上传路由</b><div>默认路径是 <span class="hb-inline">/:table/:id/file</span>，所以要先有记录 id 再上传。服务器先把文件写进 S3，再执行脚本；脚本里可直接用 <span class="hb-inline">{{objectKey}}</span>、<span class="hb-inline">{{objectUrl}}</span>、<span class="hb-inline">{{filename}}</span>、<span class="hb-inline">{{size}}</span>。</div></div>
      <div class="hb-h3">三类特殊路由</div>
      <div class="hb-grid">
        <div class="hb-card"><b>上游转发 proxy</b><p>先在接口“上游”页配置 baseUrl，再在路由里选上游、目标路径、超时。适合把已有服务挂到当前域名下。</p></div>
        <div class="hb-card"><b>对象表 objects</b><p>直接列桶内对象，不走 SQL。适合素材库、附件列表；返回的是对象元信息。</p></div>
        <div class="hb-card"><b>网页抓取 crawl</b><p>抓 http(s) 网页；默认禁止内网地址，返回 title、text、links、bytes。可在“接口类型”里分配抓取类型。</p></div>
        <div class="hb-card"><b>自定义 custom</b><p>完全自写脚本；新建时路径是 /custom-N，不会覆盖已有路由，改路径即可变成正式接口。</p></div>
      </div>
      <div class="hb-warn"><b>默认行为</b><div>列表和详情默认开 60 秒 Redis 缓存；新建、更新、删除默认启用事务。改脚本时如果不想要缓存，先在路由顶部取消“Redis 缓存”。</div></div>
    `,
  },
  {
    id: 'script', group: '核心', nav: '脚本语法', num: '06', title: '脚本语法：一条路由一段逻辑', lead: '脚本只有语句和表达式两层。先掌握 LET / QUERY / EXEC / IF / RETURN，就能写出大部分接口。',
    body: `
      <div class="hb-code"><div class="hb-code-head">一个完整的注册路由</div><pre><span class="cm"># 先查重，再插入，最后签发 token</span>
LET $exists = QUERY SELECT id FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($exists.rows) &gt; 0
  RETURN 409 { "ok": false, "error": "USER_EXISTS" };
END
EXEC INSERT INTO {{t:main}} (username, password_hash, nickname)
VALUES ({{body.username}}, SM4_ENC({{body.password}}, 'clickbuild-key'), {{body.nickname}});
LET $t = TOKEN NEW { "username": {{body.username}} };
RETURN 201 { "ok": true, "token": $t.token };</pre></div>
      <div class="hb-h3">基础语句</div>
      <table class="hb-table"><thead><tr><th>写法</th><th>结果</th></tr></thead><tbody>
        <tr><td class="mono">LET $x = QUERY SQL;</td><td>执行查询，结果在 <span class="hb-inline">$x.rows</span>，还有 <span class="hb-inline">$x.sql</span> / <span class="hb-inline">$x.params</span>。</td></tr>
        <tr><td class="mono">LET $x = EXEC SQL;</td><td>执行增删改，结果含 <span class="hb-inline">affectedRows</span>、<span class="hb-inline">insertId</span>。</td></tr>
        <tr><td class="mono">LET $x = 表达式;</td><td>算值，比如 <span class="hb-inline">HASH('sha256', {{body.password}})</span>。</td></tr>
        <tr><td class="mono">QUERY SQL;</td><td>不取名也能执行；结果留在 <span class="hb-inline">{{last.x}}</span>，下一条 SQL 里可引用，但不会自动变成 <span class="hb-inline">$变量</span>。</td></tr>
        <tr><td class="mono">RETURN 200 { ... };</td><td>立即结束并返回；不写状态码时默认 200。</td></tr>
        <tr><td class="mono">LOG INFO '文本';</td><td>写服务日志；级别可写 TRACE / DEBUG / INFO / WARN / ERROR。</td></tr>
      </tbody></table>
      <div class="hb-h3">分支与循环</div>
      <div class="hb-p">IF 不需要括号和花括号，用 <span class="hb-inline">IF 条件</span> 开始，<span class="hb-inline">ELSEIF</span>、<span class="hb-inline">ELSE</span> 可选，最后必须有 <span class="hb-inline">END</span>。FOREACH 用 <span class="hb-inline">FOREACH $row IN $rows.rows</span> 开始，也要 <span class="hb-inline">END</span> 结束，每次最多遍历 500 条。</div>
      <div class="hb-code"><div class="hb-code-head">条件与循环</div><pre>IF {{body.status}} == 1 &amp;&amp; {{body.amount}} &gt; 0
  RETURN 200 { "ok": true };
ELSEIF {{body.status}} == 2
  RETURN 403 { "ok": false, "error": "LOCKED" };
ELSE
  LOG WARN '未知状态';
  RETURN 400 { "ok": false, "error": "BAD_STATUS" };
END

LET $order = EXEC INSERT INTO {{t:main}} (order_no, customer)
VALUES ({{body.order_no}}, {{body.customer}});

FOREACH $item IN {{body.items}}
  EXEC INSERT INTO {{t:item}} (order_id, sku, qty)
  VALUES ($order.insertId, {{item.sku}}, {{item.qty}});
END</pre></div>
      <div class="hb-h3">表达式</div>
      <div class="hb-p">支持 <span class="hb-inline">== != &gt; &lt; &gt;= &lt;=</span>、<span class="hb-inline">&amp;&amp; || !</span>、<span class="hb-inline">+ - * / %</span>；支持数组 <span class="hb-inline">['a','b']</span> 和对象 <span class="hb-inline">{ "k": 1 }</span>。字符串用单引号或双引号。变量用 <span class="hb-inline">$name</span>，取值用 <span class="hb-inline">$x.rows[0].id</span> 或 <span class="hb-inline">$x.rows.0.id</span>。</div>
      <div class="hb-h3">进阶语句</div>
      <table class="hb-table"><thead><tr><th>语句</th><th>说明</th></tr></thead><tbody>
        <tr><td class="mono">WAIT 500;</td><td>等待毫秒，最多 60000。脚本总步数上限 5000。</td></tr>
        <tr><td class="mono">TX BEGIN; / TX COMMIT; / TX ROLLBACK;</td><td>手动事务。默认写路由已经自动开事务；自定义跨表写入可自己控制。</td></tr>
        <tr><td class="mono">LET $r = HTTP GET 'http://127.0.0.1:18101/api/x';</td><td>服务间调用，支持 GET/POST/PUT/DELETE，返回 <span class="hb-inline">{ status, ok, body }</span>。POST 可在末尾写 JSON。</td></tr>
        <tr><td class="mono">LET $p = CRAWL 'https://example.com' { "maxText": 5000 };</td><td>抓网页，返回 title、text、links、bytes；默认禁止内网地址。</td></tr>
        <tr><td class="mono">LET $t = TOKEN NEW { "uid": 1 };</td><td>签发会话 token；返回 <span class="hb-inline">$t.token</span>、<span class="hb-inline">$t.onlyId</span>、<span class="hb-inline">$t.ttl</span>。</td></tr>
        <tr><td class="mono">LET $u = TOKEN GET $token;</td><td>按 token 取会话内容；无效返回空。也可以 <span class="hb-inline">TOKEN DEL $token;</span> 注销。</td></tr>
        <tr><td class="mono">PUBLISH 'orders:new' { "id": 1 };</td><td>向 Redis 频道发布消息，微服务之间可用。</td></tr>
      </tbody></table>
      <div class="hb-warn"><b>写好习惯</b><div>每条语句建议以分号结尾；注释用 <span class="hb-inline">#</span> 最稳，也支持 <span class="hb-inline">//</span> 和 <span class="hb-inline">/* ... */</span>。停止输入 0.3 秒后编辑器会自动检查，红色波浪线就是语法或变量问题。</div></div>
    `,
  },
  {
    id: 'sqlref', group: '核心', nav: 'SQL 与查询', num: '07', title: 'SQL 占位符、筛选、分页与排序', lead: '占位符不是字符串替换：表名和列名走白名单，请求值全部参数化成问号。',
    body: `
      <div class="hb-h3">最常用的五段 SQL</div>
      <div class="hb-code"><div class="hb-code-head">列表 / 详情 / 新建 / 更新 / 删除</div><pre>SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} ORDER BY {{orderBy:main}} LIMIT {{limit}} OFFSET {{offset}};
SELECT {{columns:main}} FROM {{t:main}} WHERE {{idColumn:main}} = {{id}} LIMIT 1;
INSERT INTO {{t:main}} ({{insertColumns:main}}) VALUES ({{insertValues:main}});
UPDATE {{t:main}} SET {{updateSet:main}} WHERE {{idColumn:main}} = {{id}};
DELETE FROM {{t:main}} WHERE {{idColumn:main}} = {{id}};</pre></div>
      <div class="hb-h3">占位符清单</div>
      <table class="hb-table"><thead><tr><th>占位符</th><th>展开成什么</th></tr></thead><tbody>
        <tr><td class="mono">{{t:main}} / {{t:item}}</td><td>按表键取真实表名，可带库前缀；不是用户输入。</td></tr>
        <tr><td class="mono">{{columns:main}} / {{allColumns:main}}</td><td>可见字段列表 / 全部字段（含隐藏）。</td></tr>
        <tr><td class="mono">{{insertColumns:main}} / {{insertValues:main}}</td><td>可写字段列表与对应的 ? 参数；自动跳过主键、自增、不可写字段。</td></tr>
        <tr><td class="mono">{{updateSet:main}}</td><td>只把请求体里出现过的可写字段拼成“列 = ?”。</td></tr>
        <tr><td class="mono">{{where:main}}</td><td>根据 query 拼条件；没有条件时是 1 = 1，可直接接在 WHERE 后。</td></tr>
        <tr><td class="mono">{{orderBy:main}}</td><td>读 ?sort=字段:asc/desc，最多三个；不合法时回退主键倒序。</td></tr>
        <tr><td class="mono">{{limit}} {{offset}} {{page}} {{pageSize}}</td><td>page 默认 1，pageSize 默认 20，最大 500；offset 自动算。</td></tr>
        <tr><td class="mono">{{idColumn:main}}</td><td>主键列名；没有主键时退回第一个字段。</td></tr>
        <tr><td class="mono">{{id}} {{now}} {{uuid}} {{queryHash}}</td><td>路径 id、当前时间、随机 UUID、查询哈希。</td></tr>
        <tr><td class="mono">{{body.x}} {{query.x}} {{path.x}} {{user.x}}</td><td>请求体、查询串、路径参数、已登录用户；自动参数化。</td></tr>
        <tr><td class="mono">{{objectKey}} {{objectUrl}} {{filename}} {{size}}</td><td>上传后的对象键、访问地址、原始文件名、字节数。</td></tr>
        <tr><td class="mono">{{vars.x}} {{last.x}}</td><td>脚本变量与上一条 QUERY/EXEC 的结果，可带点路径。</td></tr>
      </tbody></table>
      <div class="hb-h3">{{where:main}} 支持的 query 运算符</div>
      <table class="hb-table"><thead><tr><th>写法</th><th>SQL</th><th>例子</th></tr></thead><tbody>
        <tr><td class="mono">status=1</td><td>等于</td><td>?status=1</td></tr>
        <tr><td class="mono">status__ne=1</td><td>&lt;&gt;</td><td>?status__ne=1</td></tr>
        <tr><td class="mono">amount__gte=10 / __gt / __lte / __lt</td><td>&gt;= / &gt; / &lt;= / &lt;</td><td>?amount__gte=100</td></tr>
        <tr><td class="mono">name__like=张</td><td>LIKE %张%</td><td>?name__like=张</td></tr>
        <tr><td class="mono">name__contains / __startswith / __endswith</td><td>包含 / 开头 / 结尾</td><td>?name__startswith=订</td></tr>
        <tr><td class="mono">status__in=1,2,3</td><td>IN，最多 50 个</td><td>?status__in=0,1</td></tr>
        <tr><td class="mono">amount__between=1,99</td><td>BETWEEN，需两个值</td><td>?amount__between=10,50</td></tr>
        <tr><td class="mono">name__regex / __iregex / __notregex</td><td>REGEXP</td><td>?order_no__regex=^A</td></tr>
        <tr><td class="mono">deleted_at__isnull=1</td><td>IS NULL；传 0 变 IS NOT NULL</td><td>?file_key__isnull=1</td></tr>
        <tr><td class="mono">keyword=关键字</td><td>在勾了“搜索”的文本字段里 LIKE</td><td>?keyword=首单</td></tr>
        <tr><td class="mono">sort=amount:desc,id:asc</td><td>最多三个字段</td><td>?sort=amount:desc</td></tr>
      </tbody></table>
      <div class="hb-p">多表查询直接在 SQL 里 JOIN：<span class="hb-inline">FROM {{t:main}} o LEFT JOIN {{t:item}} i ON i.order_id = o.id</span>。列名要自己写别名，避免两张表都有 id 时混淆；WHERE 仍可接 <span class="hb-inline">{{where:main}}</span>。</div>
      <div class="hb-tip"><b>安全边界</b><div>表名、列名只接受已存在的标识符；所有 <span class="hb-inline">{{body.x}}</span>、<span class="hb-inline">{{query.x}}</span> 都会变成参数占位符，不用自己拼引号，也不容易 SQL 注入。</div></div>
    `,
  },
  {
    id: 'functions', group: '核心', nav: '函数手册', num: '08', title: '40 个内置函数与自定义函数', lead: '函数既能在 LET 表达式里用，也能在部分 SQL 位置展开成本地计算结果。',
    body: `
      <div class="hb-p">下面 40 个函数是运行时真实清单。表达式里可以任意调用；SQL 里会本地展开的是 <span class="hb-inline">HASH / SM3 / SM4_ENC / SM4_DEC / MASK / URL_ENC / URL_DEC / RAND_INT</span> 以及自定义函数，其余同名函数交给 MariaDB 原生实现。</div>
      <table class="hb-table"><thead><tr><th style="width:115px">函数</th><th style="width:165px">签名</th><th>作用</th><th style="width:210px">例子</th></tr></thead><tbody>@@FUNC_ROWS@@</tbody></table>
      <div class="hb-h3">SQL 里用函数</div>
      <div class="hb-code"><div class="hb-code-head">密码哈希与手机号脱敏</div><pre>EXEC INSERT INTO {{t:main}} (username, password_hash, phone_mask)
VALUES ({{body.username}}, HASH('sha256', {{body.password}}), MASK({{body.phone}}, 3, 4, '*'));</pre></div>
      <div class="hb-p">SQL 函数参数只接受 <span class="hb-inline">?</span>、字符串、数字、NULL。写 <span class="hb-inline">HASH('sha256', {{body.password}})</span> 时，占位符会先变成 <span class="hb-inline">?</span>，再在本地算好摘要，最后把结果作为参数发给数据库。</div>
      <div class="hb-h3">自定义函数</div>
      <div class="hb-p">在“生成导出”页底部“自定义函数”表里新增一行：名字、参数列表、表达式。例如名字 <span class="hb-inline">MASK_PHONE</span>，参数 <span class="hb-inline">v</span>，表达式 <span class="hb-inline">CONCAT(SUBSTR(v, 0, 3), "****", SUBSTR(v, 7, 4))</span>。之后脚本里直接 <span class="hb-inline">MASK_PHONE({{body.phone}})</span>。</div>
      <div class="hb-warn"><b>命名</b><div>自定义函数名会统一转大写；不要和 40 个内置函数重名。参数名直接按顺序绑定，函数体里用参数名，不要加 $。</div></div>
    `,
  },
  {
    id: 'debug', group: '运行', nav: '启动与联调', num: '09', title: '启动、试运行、控制台与更新部署', lead: '先把服务跑起来，再用真实请求验证。所有测试都走生成后的 /api 地址，不是前端假数据。',
    body: `
      <div class="hb-h3">先认清统一响应结构</div>
      <div class="hb-code"><div class="hb-code-head">真实接口返回的样子</div><pre>{
  "ok": true,
  "data": { "rows": [ { "id": 1, "order_no": "SO-1001" } ], "total": 1 },
  "cached": false,
  "ms": 2,
  "traceId": "16accffcee60b5db"
}

{ "ok": false, "error": "NOT_FOUND", "message": "记录不存在", "traceId": "..." }</pre></div>
      <div class="hb-p">脚本里 <span class="hb-inline">RETURN 200 { "rows": ... }</span> 的对象会放进 <span class="hb-inline">data</span>，HTTP 状态码仍然是脚本写的 200 / 201 / 404。列表分页在 <span class="hb-inline">data.rows</span> 与 <span class="hb-inline">data.total</span>；新建在 <span class="hb-inline">data.id</span>；更新是 <span class="hb-inline">data.changed</span>；删除是 <span class="hb-inline">data.deleted</span>。<span class="hb-inline">cached: true</span> 表示这次命中响应缓存。</p>
      <div class="hb-tip"><b>两个序列化细节</b><div>datetime / date 默认按 ISO 字符串返回，例如 <span class="hb-inline">2026-11-20T17:13:07.000Z</span>，前端按 UTC 解析；decimal 可能返回字符串 <span class="hb-inline">"99.50"</span>，要计算先 <span class="hb-inline">Number()</span>，避免金额相加变成拼接。</div></div>
      <div class="hb-h3">启动链路</div>
      <div class="hb-p">Ribbon 的“启动”会依次做四件事：保存当前工程 → 生成服务文件 → 启动未运行的 MariaDB / Redis / RustFS → 启动网页服务并打开主页。第一次启动会比较慢，状态区会显示依赖启动进度。</div>
      <div class="hb-grid">
        <div class="hb-card"><b>启动 / 停止</b><p>同一个按钮切换。停止会停网页服务和 MariaDB / Redis / RustFS，不删数据库。</p></div>
        <div class="hb-card"><b>打开主页</b><p>服务运行中才能打开；没启动会提示先启动。</p></div>
        <div class="hb-card"><b>更新部署</b><p>先保存并校验脚本，再启动依赖、重新生成、热重启服务；脚本有错会直接拦下。</p></div>
        <div class="hb-card"><b>监控</b><p>看请求日志、状态码、耗时和健康状态；排查 4xx / 5xx 先看这里。</p></div>
      </div>
      <div class="hb-h3">三种测试方式</div>
      <table class="hb-table"><thead><tr><th>入口</th><th>怎么用</th><th>适合</th></tr></thead><tbody>
        <tr><td>路由页“试运行”</td><td>填路径/查询参数 JSON 和请求体 JSON，点发送；结果里的 status、ms、url 和响应体都会显示。</td><td>临时验证某条路由。</td></tr>
        <tr><td>“测试”页</td><td>选路由、运行环境、Query（a=1&amp;b=2）、Body JSON，点“发送”。</td><td>连续调试同一条接口。</td></tr>
        <tr><td>浏览器 / curl</td><td>直接访问 /api 地址，或打开 /docs 复制示例。</td><td>验收真实调用、联调外部系统。</td></tr>
      </tbody></table>
      <div class="hb-code"><div class="hb-code-head">常用验收命令</div><pre>curl.exe "http://127.0.0.1:18100/api/orders?page=1&amp;pageSize=5&amp;keyword=首单"
curl.exe -X PUT "http://127.0.0.1:18100/api/orders/1" -H "Content-Type: application/json" -d '{"status":1}'
curl.exe -X DELETE "http://127.0.0.1:18100/api/orders/1"</pre></div>
      <div class="hb-tip"><b>控制台</b><div>底部“控制台”打开日志面板；<span class="hb-kbd">Ctrl+\`</span> 或 <span class="hb-kbd">Alt+F12</span> 可快速开合。脚本里的 LOG、SQL 错误、服务启动失败都会写在这里。</div></div>
      <div class="hb-warn"><b>端口被占</b><div>应用会自动避让端口，并在工作台右侧“运行环境”提示“端口已自动避让”。以那里显示的实际端口为准，不要死记默认值。改端口后先停止对应服务再启动。</div></div>
      <div class="hb-check"><b>验收标准</b><div>列表 200；详情不存在的 id 返回 404；新建 201；更新返回 changed；删除返回 deleted；控制台无红色错误；/help 与 /docs 可访问。</div></div>
    `,
  },
  {
    id: 'frontend', group: '运行', nav: '前端工坊', num: '10', title: '前端工坊与 .yxpp', lead: '混合或只前端任务里，页面在 PageStudio 里编辑；接口和页面通过工程自动同步。',
    body: `
      <div class="hb-p">顶部“接口 / 前端”切换只在混合任务出现。前端工坊本身是一个真实页面编辑器，工程源文件是 <span class="hb-inline">.yxpp</span>，导出的静态页面在生成工程的 <span class="hb-inline">public/index.html</span>。</div>
      <div class="hb-grid">
        <div class="hb-card"><b>导入 .yxpp</b><p>把已有前端工程装进当前工程；导入后立即成为页面源文件。</p></div>
        <div class="hb-card"><b>导出 .yxpp</b><p>把当前页面工程单独存成 .yxpp，便于备份、迁移或交给别人。</p></div>
        <div class="hb-card"><b>立即同步</b><p>把编辑器里的改动刷进当前工程；顶部状态会显示已保存 / 有未同步改动。</p></div>
        <div class="hb-card"><b>更新部署</b><p>先等前端同步，再校验接口脚本，最后重新生成并重启服务。</p></div>
      </div>
      <div class="hb-h3">推荐顺序</div>
      <div class="hb-step"><span class="hb-step-n">1</span><div class="hb-step-body"><b>先把接口跑通</b><p>在接口工作台建表、写路由，用“试运行”确认返回结构。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">2</span><div class="hb-step-body"><b>再打开前端</b><p>切到“前端”，在 PageStudio 里搭页面、绑定接口。混合任务两边共享同一个工程。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">3</span><div class="hb-step-body"><b>同步并部署</b><p>点“立即同步”，再点“更新部署”。部署成功后打开主页检查真实页面。</p></div></div>
      <div class="hb-tip"><b>只前端任务</b><div>只前端任务直接进入前端工坊，接口工作台不显示。仍然可以导出 .yxpp，或后续把任务类型切回混合再补接口。</div></div>
      <div class="hb-warn"><b>不要绕过同步</b><div>编辑器里有未同步改动时直接“更新部署”，应用会先强制同步；同步失败会拦住部署。看到“还没同步到当前工程”的提示，先点“立即同步”。</div></div>
    `,
  },
  {
    id: 'export', group: '交付', nav: '生成与导出', num: '11', title: '生成、导出与独立运行', lead: '生成服务是给自己调试；导出工程是交付给别人或部署到服务器。',
    body: `
      <div class="hb-h3">两个按钮的区别</div>
      <table class="hb-table"><thead><tr><th>按钮</th><th>产出</th><th>用途</th></tr></thead><tbody>
        <tr><td>生成服务</td><td>生成到应用管理的 generated 目录，并启动服务。</td><td>当前机器上调试验收。</td></tr>
        <tr><td>导出工程</td><td>新建独立目录，带 .idea、RUN.md、config.json、public/、sql/、docs/ 和所选运行时。</td><td>交付、部署、二次开发。</td></tr>
      </tbody></table>
      <div class="hb-h3">选运行时</div>
      <table class="hb-table"><thead><tr><th>类型</th><th>启动命令</th><th>注意</th></tr></thead><tbody>
        <tr><td>Node.js</td><td class="mono">npm install<br>node server.js</td><td>默认；热部署用 <span class="hb-inline">node dev.js</span>。</td></tr>
        <tr><td>Bun</td><td class="mono">bun install<br>bun server.js</td><td>接口与 Node 版一致，启动更快。</td></tr>
        <tr><td>Go 原生</td><td class="mono">cd native/go<br>go mod tidy<br>go run .</td><td>不依赖 Node；只支持直连 MySQL 存储模式。</td></tr>
        <tr><td>Java 原生</td><td class="mono">cd native/java<br>javac -encoding UTF-8 -cp "lib/*" -d bin src/icb/*.java<br>java -cp "bin;lib/*" icb.Main</td><td>JDK 17+，不依赖 Node；只支持直连 MySQL。</td></tr>
        <tr><td>Python Flask</td><td class="mono">cd native/python<br>pip install -r requirements.txt<br>python app.py</td><td>先创建并激活 venv；不依赖 Node，导出目录只带这一套。</td></tr>
      </tbody></table>
      <div class="hb-p">导出弹窗里还能选“生成 404 / 500 错误页”和“500 页面显示错误详情”。错误页只影响浏览器，API 客户端仍收到 JSON；关闭详情后页面只显示状态码和 traceId，堆栈写日志。</div>
      <div class="hb-h3">导出目录里看什么</div>
      <div class="hb-code"><div class="hb-code-head">先读 RUN.md，再改 config.json</div><pre>server.js                入口
src/modules/             每个接口一个模块
src/script.js            脚本解释器
src/render.js            占位符 / 参数化 SQL
src/funcs.js             40 个内置函数
interfaces.json          接口、表、脚本完整描述
sql/*.sql                建表语句
docs/                    OpenAPI 文档
public/index.html        前端页面
config.json              端口、数据库、Redis、S3
RUN.md                   启动说明</pre></div>
      <div class="hb-tip"><b>配置优先级</b><div>端口、MariaDB、Redis、S3 先改根目录 <span class="hb-inline">config.json</span>；系统环境变量优先，<span class="hb-inline">.env</span> 只作为可选覆盖。改完重启服务生效。</div></div>
      <div class="hb-h3">其它交付方式</div>
      <div class="hb-grid">
        <div class="hb-card"><b>导出 .yxpn</b><p>带前端、接口、文档的完整工程包，适合备份和迁移；也可以设成默认打开方式。</p></div>
        <div class="hb-card"><b>导出微服务</b><p>按接口或分类拆成独立服务，每个服务有自己的端口和配置，适合拆分部署。</p></div>
        <div class="hb-card"><b>接口文档</b><p>自动生成 OpenAPI 3.0.3；可预览 JSON，也可在浏览器 /docs 查看可读版。</p></div>
        <div class="hb-card"><b>用 IDEA 打开</b><p>导出目录带 .idea 和启动配置；点“用 IDEA 打开”，没装 IDEA 会退回打开目录。</p></div>
      </div>
      <div class="hb-warn"><b>原生运行时限制</b><div>Go / Java 原生只支持“直连 MySQL”，遇到 Redis 表、LRU、定期落盘等加速模式会拒绝启动，避免静默读写不一致。需要这些模式就导出 Node / Bun。</div></div>
    `,
  },
  {
    id: 'advanced', group: '交付', nav: '进阶能力', num: '12', title: '接口类型、鉴权、缓存、对象与 AI', lead: '这些能力都在界面里有真实配置项；先理解默认值，再按业务打开。',
    body: `
      <div class="hb-h3">8 种默认接口类型</div>
      <table class="hb-table"><thead><tr><th>类型</th><th>存储 / 行为</th></tr></thead><tbody>
        <tr><td>普通 JSON</td><td>查表/写入后直接返回 JSON，不落额外存储。默认类型。</td></tr>
        <tr><td>Cookie 会话</td><td>脚本 TOKEN NEW 签发，会话写 Redis；响应自动 Set-Cookie，默认 cookie 名 icb_token，TTL 7200。</td></tr>
        <tr><td>文件上传</td><td>multipart 文件写 S3，SQL 只存 objectKey；默认上限 20MB，自动绑定 file_key 字段。</td></tr>
        <tr><td>图片上传</td><td>同文件上传，只收图片；默认上限 8MB。</td></tr>
        <tr><td>对象列表</td><td>直接列桶内对象，不走 SQL。</td></tr>
        <tr><td>上游代理</td><td>把请求透传到“上游”里配置的服务，可转发请求头、改超时。</td></tr>
        <tr><td>网页抓取</td><td>抓网页后在脚本里加工，返回标题、正文、链接。</td></tr>
        <tr><td>Redis 缓存结果</td><td>把结果写 Redis，键按路由模板生成，默认前缀 icb:、TTL 60。</td></tr>
      </tbody></table>
      <div class="hb-p">“接口类型”页可以新增自定义类型，再把路由分配过去。文件类固定走 S3，Cookie 类固定走 Redis 或进程内存；切换类型会改存储、补入库字段，但不会清空已有脚本。</div>
      <div class="hb-h3">鉴权</div>
      <div class="hb-p">创建引导第三步可选“公开 / 写操作需要 token / 全部需要 token”。路由页的“权限”页还能配角色。开启鉴权后，请求要带 <span class="hb-inline">Authorization: Bearer &lt;token&gt;</span>，或带登录时种下的 Cookie；否则返回 401 <span class="hb-inline">UNAUTHORIZED</span>。</div>
      <div class="hb-code"><div class="hb-code-head">登录签发，受保护路由读取</div><pre>LET $t = TOKEN NEW { "uid": $u.rows[0].id, "name": {{body.username}} };
RETURN 200 { "ok": true, "token": $t.token };

<span class="cm"># 需要 token 的路由里，当前用户已在 $user</span>
RETURN 200 { "user": $user };</pre></div>
      <div class="hb-h3">缓存与存储加速</div>
      <div class="hb-p">路由顶部“Redis 缓存”控制整条响应缓存，列表/详情默认开 60 秒。表结构页的“加速”下拉控制表数据怎么读写：直连 MySQL、MySQL + Redis 查询缓存、Redis 表、Redis 热读 + MySQL 权威、LRU 内存表、LRU + Redis 持久、内存表 + 定期写 Redis。TTL、上限、刷盘间隔就在表头改。</div>
      <div class="hb-h3">对象存储</div>
      <div class="hb-p">文件不进数据库，只存对象键。上传路由成功后可用 <span class="hb-inline">{{objectKey}}</span> 入库；对象表路由直接列桶；下载/预览地址用 <span class="hb-inline">{{objectUrl}}</span> 或前端自己拼。默认桶 clickbuild，可在设置和导出配置里改。</div>
      <div class="hb-h3">AI 与插件</div>
      <div class="hb-grid">
        <div class="hb-card"><b>AI 生成</b><p>“更多 → AI 生成”用自然语言生成接口工程。设置里选 Ollama、OpenAI 兼容或本地模拟；先“测试连接”再保存。失败可勾“退回本地模拟”。</p></div>
        <div class="hb-card"><b>插件</b><p>“更多 → 插件”启停插件、看命令与日志、管理信任目录。插件命令最多三个显示在 Ribbon，其余在插件面板。</p></div>
        <div class="hb-card"><b>上游</b><p>接口“上游”页配置 baseUrl 和鉴权，proxy 路由才能选；适合挂已有 REST 服务。</p></div>
        <div class="hb-card"><b>模版 / 接口库</b><p>“更多”里可套用模版、插入现成接口，或把当前工程/接口存进库，方便复用。</p></div>
      </div>
      <div class="hb-warn"><b>AI 产物要验收</b><div>AI 只负责生成结构，不保证业务正确。生成后逐条看表字段、路由脚本、鉴权，再启动试运行；不要直接把未验收的工程部署到生产。</div></div>
    `,
  },
  {
    id: 'recipes', group: '交付', nav: '实战配方', num: '13', title: '五个可直接照抄的配方', lead: '下面都是真实脚本结构，复制到自定义路由后按表键和字段名微调即可。',
    body: `
      <div class="hb-h3">配方 1 · 注册 + 登录 + 当前用户</div>
      <div class="hb-code"><div class="hb-code-head">注册</div><pre>LET $exists = QUERY SELECT id FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($exists.rows) &gt; 0
  RETURN 409 { "ok": false, "error": "USER_EXISTS" };
END
EXEC INSERT INTO {{t:main}} (only_id, username, password_hash, nickname)
VALUES ({{onlyId}}, {{body.username}}, SM4_ENC({{body.password}}, 'clickbuild-key'), {{body.nickname}});
LET $t = TOKEN NEW { "onlyId": {{onlyId}}, "username": {{body.username}} };
RETURN 201 { "ok": true, "onlyId": {{onlyId}}, "token": $t.token };</pre></div>
      <div class="hb-code"><div class="hb-code-head">登录</div><pre>LET $u = QUERY SELECT id, only_id, password_hash FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 401 { "ok": false, "error": "NO_USER" };
END
IF SM4_DEC($u.rows[0].password_hash, 'clickbuild-key') != {{body.password}}
  RETURN 401 { "ok": false, "error": "BAD_PASSWORD" };
END
LET $t = TOKEN NEW { "onlyId": $u.rows[0].only_id, "username": {{body.username}} };
RETURN 200 { "ok": true, "token": $t.token };</pre></div>
      <div class="hb-p">把“当前用户”路由设成需要 token，脚本只要 <span class="hb-inline">RETURN 200 { "user": $user };</span>。密码字段记得设成 token 或隐藏字段，别在列表里暴露。</div>
      <div class="hb-h3">配方 2 · 主表 + 明细，一次事务写入</div>
      <div class="hb-code"><div class="hb-code-head">订单写入</div><pre>LET $order = EXEC INSERT INTO {{t:main}} (order_no, customer, amount, status)
VALUES ({{body.order_no}}, {{body.customer}}, {{body.amount}}, 0);
FOREACH $item IN {{body.items}}
  EXEC INSERT INTO {{t:item}} (order_id, sku, qty, price)
  VALUES ($order.insertId, {{item.sku}}, {{item.qty}}, {{item.price}});
END
RETURN 201 { "ok": true, "orderId": $order.insertId, "items": LEN({{body.items}}) };</pre></div>
      <div class="hb-p">自定义路由的“权限”页打开事务开关，或脚本里显式 <span class="hb-inline">TX BEGIN;</span> / <span class="hb-inline">TX COMMIT;</span>。出错时 <span class="hb-inline">TX ROLLBACK;</span>，主表和明细一起回滚。</div>
      <div class="hb-h3">配方 3 · 文件上传并绑定字段</div>
      <div class="hb-code"><div class="hb-code-head">上传后入库（路由类型选文件上传）</div><pre>LET $hit = QUERY SELECT COUNT(*) AS n FROM {{t:main}} WHERE {{idColumn:main}} = {{id}} LIMIT 1;
IF $hit.rows[0].n == 0
  RETURN 404 { "ok": false, "error": "NOT_FOUND" };
END
EXEC UPDATE {{t:main}} SET {{bindColumn:main}} = {{objectKey}} WHERE {{idColumn:main}} = {{id}};
RETURN 200 { "ok": true, "key": {{objectKey}}, "url": {{objectUrl}}, "size": {{size}} };</pre></div>
      <div class="hb-p">上传请求是 multipart：字段名用 <span class="hb-inline">file</span>，地址是 <span class="hb-inline">POST /api/.../{{id}}/file</span>。类型上限、文件种类、入库字段都能在“接口类型”页改。</div>
      <div class="hb-h3">配方 4 · 列表筛选、分页与联查</div>
      <div class="hb-code"><div class="hb-code-head">订单 + 明细联查</div><pre>LET $rows = QUERY
SELECT o.id, o.order_no, o.customer, o.amount, o.status, i.sku, i.qty, i.price
FROM {{t:main}} o LEFT JOIN {{t:item}} i ON i.order_id = o.id
WHERE {{where:main}} ORDER BY o.id DESC LIMIT {{limit}} OFFSET {{offset}};
RETURN 200 { "rows": $rows.rows };</pre></div>
      <div class="hb-p">请求示例：<span class="hb-inline">?page=2&amp;pageSize=10&amp;status__in=1,2&amp;amount__gte=100&amp;keyword=首单&amp;sort=amount:desc</span>。要总数时再查一次 <span class="hb-inline">COUNT(*)</span>。</div>
      <div class="hb-h3">配方 5 · 抓取网页 + Redis 缓存</div>
      <div class="hb-code"><div class="hb-code-head">抓取标题与正文</div><pre>LET $page = CRAWL 'https://example.com/news' { "maxText": 20000, "links": false };
IF $page.ok == false
  RETURN 502 { "ok": false, "error": "UPSTREAM_FAILED", "status": $page.status };
END
RETURN 200 { "title": $page.title, "text": $page.text, "bytes": $page.bytes };</pre></div>
      <div class="hb-p">路由顶部勾“Redis 缓存”，整条响应按 queryHash 缓存，适合价格页、资讯页这类读多写少的数据。需要最新数据时缩短 TTL 或关闭缓存。</div>
    `,
  },
  {
    id: 'shortcuts', group: '参考', nav: '快捷键', num: '14', title: '快捷键与高效操作', lead: '常用操作都有键盘入口；鼠标右键和双击也有固定含义。',
    body: `
      <table class="hb-table"><thead><tr><th style="width:190px">按键</th><th>作用</th></tr></thead><tbody>
        <tr><td><span class="hb-kbd">Ctrl+K</span></td><td>聚焦顶部全局搜索；可搜接口、表、字段、路由、SQL。</td></tr>
        <tr><td><span class="hb-kbd">Ctrl+S</span></td><td>立即保存当前工程；平时也会自动保存。</td></tr>
        <tr><td><span class="hb-kbd">Ctrl+T</span></td><td>新建任务（会先保存当前工程）。</td></tr>
        <tr><td><span class="hb-kbd">Ctrl+N</span></td><td>新建接口；<span class="hb-kbd">Ctrl+Shift+N</span> 新建分类。</td></tr>
        <tr><td><span class="hb-kbd">Ctrl+Tab</span></td><td>切换项目标签；加 Shift 反向切换。</td></tr>
        <tr><td><span class="hb-kbd">Ctrl+Enter</span></td><td>生成服务（不在输入框里时）。</td></tr>
        <tr><td><span class="hb-kbd">Ctrl+\`</span> / <span class="hb-kbd">Alt+F12</span></td><td>开合底部控制台。</td></tr>
        <tr><td><span class="hb-kbd">F2</span></td><td>重命名当前选中的接口。</td></tr>
        <tr><td><span class="hb-kbd">Delete</span></td><td>在接口总表里删除当前选中的接口（会确认）。</td></tr>
        <tr><td><span class="hb-kbd">Esc</span></td><td>关弹窗 / 关搜索面板 / 从编辑器退回总表。</td></tr>
        <tr><td><span class="hb-kbd">Tab</span> / <span class="hb-kbd">Ctrl+/</span></td><td>脚本编辑器缩进 / 注释当前行；停止输入 0.3 秒自动检查。</td></tr>
      </tbody></table>
      <div class="hb-h3">鼠标操作</div>
      <div class="hb-grid">
        <div class="hb-card"><b>接口总表</b><p>单击选中看右侧详情，双击进入编辑器；行内筛选只过滤当前分类。</p></div>
        <div class="hb-card"><b>工程历史</b><p>左键打开；右键打开 / 复制 / 删除；卡片红叉也是删除。</p></div>
        <div class="hb-card"><b>项目标签</b><p>中键关闭；右键打开标签菜单；加号新建任务。</p></div>
        <div class="hb-card"><b>表结构</b><p>点“＋”行加字段；在字段名里按 Enter 继续加；表标签可横向滚动。</p></div>
      </div>
      <div class="hb-tip"><b>搜索面板</b><div>全局搜索按类型排序：接口 → 路由 → 表 → 字段。点结果会直接跳到对应接口、路由或字段，不需要自己找分类。</div></div>
    `,
  },
  {
    id: 'trouble', group: '参考', nav: '排错手册', num: '15', title: '常见问题与排错顺序', lead: '先判断是“没启动”“脚本错”还是“请求不对”，再按对应链路查。',
    body: `
      <div class="hb-h3">先按这个顺序查</div>
      <div class="hb-step"><span class="hb-step-n">1</span><div class="hb-step-body"><b>服务有没有起来</b><p>看 Ribbon 的运行状态和工作台右侧“运行环境”。没起来就点“启动”，再打开控制台看启动失败原因。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">2</span><div class="hb-step-body"><b>脚本有没有错</b><p>路由页底部状态应是“检查通过”；红色标记处逐条修。也可以点 Ribbon 的“检查”查看全工程问题。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">3</span><div class="hb-step-body"><b>地址和方法对不对</b><p>用“试运行”或 /docs 里的示例地址，不要凭记忆拼。路径参数 :id 要换成真实 id。</p></div></div>
      <div class="hb-step"><span class="hb-step-n">4</span><div class="hb-step-body"><b>数据在不在</b><p>表建了没有、字段名对不对、记录是否存在；数据库日志和请求日志能区分 SQL 错与业务 404。</p></div></div>
      <table class="hb-table"><thead><tr><th style="width:170px">现象</th><th>常见原因</th><th>处理</th></tr></thead><tbody>
        <tr><td>点启动没反应</td><td>端口被别的程序占用；内置依赖没起来；脚本校验失败。</td><td>看右侧“运行环境”和控制台；改端口后先停再启；先修红标。</td></tr>
        <tr><td>提示“先生成并启动服务”</td><td>网页服务没运行，/help 和 /docs 不可用。</td><td>点“启动”，等状态变绿。</td></tr>
        <tr><td>404 NOT_FOUND</td><td>id 不存在；路径拼错；服务还是旧版本。</td><td>先查列表确认 id；核对前缀；点“更新部署”。</td></tr>
        <tr><td>404 页面而不是 JSON</td><td>访问了不存在的路由，浏览器拿到错误页。</td><td>用 /docs 复制正确地址；API 客户端仍会收到 JSON。</td></tr>
        <tr><td>401 UNAUTHORIZED</td><td>路由开了鉴权，但没带 token / cookie；token 过期。</td><td>先登录拿 token，带 Authorization: Bearer；或检查 Cookie。</td></tr>
        <tr><td>405</td><td>方法不对，例如用 GET 调 POST 路由。</td><td>按路由页显示的方法调用。</td></tr>
        <tr><td>409 / 400</td><td>业务校验拦下：重复、缺参数、状态不合法。</td><td>看响应里的 error 字段；按脚本里的条件修请求。</td></tr>
        <tr><td>未知表键</td><td>脚本写了 {{t:xxx}}，但接口里没有这个表键。</td><td>到表结构页确认表键；main/item 不要混用表名。</td></tr>
        <tr><td>更新语句没有可写字段</td><td>请求体为空，或字段全是主键/自增/隐藏/不可写。</td><td>在 Body 里带至少一个可写字段。</td></tr>
        <tr><td>上传失败 / 413</td><td>超过类型上限；字段名不是 file；记录 id 不存在。</td><td>改“接口类型”上限；用 multipart 字段 file；先建记录。</td></tr>
        <tr><td>500</td><td>SQL 语法、类型转换、脚本运行错误、上游不可用。</td><td>看控制台堆栈与 traceId；先在“试运行”复现。</td></tr>
        <tr><td>表不存在</td><td>服务连到了别的库；建表 SQL 没执行；表名被改过。</td><td>核对 config.json 的库；重新生成/部署；看 sql/ 目录。</td></tr>
        <tr><td>AI 一直失败</td><td>地址、模型名、Key 不对；本机 Ollama 没启动。</td><td>设置里“测试连接”；先勾“退回本地模拟”验证链路。</td></tr>
        <tr><td>重启后数据没了</td><td>用了 LRU 内存表或进程内存 Cookie 会话。</td><td>改 MySQL / Redis 持久模式；重要会话用 Redis。</td></tr>
        <tr><td>Go / Java 启动被拒</td><td>表用了 Redis / LRU / 定期落盘等加速模式。</td><td>改回直连 MySQL，或导出 Node / Bun。</td></tr>
      </tbody></table>
      <div class="hb-warn"><b>不要靠猜</b><div>控制台里的第一条红色错误通常才是根因，后面的 500 往往只是连锁反应。先修第一条，再重试。</div></div>
      <div class="hb-check"><b>修完后的回归</b><div>重新点“检查”→ 更新部署 → 列表 / 详情 / 新建 / 更新 / 删除各跑一次 → 看 /docs 示例是否同步 → 再交付。</div></div>
    `,
  },
];

function renderHelp() {
  const routeMeta = (S.help && S.help.routes) || {};
  const routeRows = HELP_ROUTE_DOCS.map((r) => {
    const m = routeMeta[r.key] || { method: '—', path: '—' };
    return `<tr><td><b>${esc(r.name)}</b></td><td class="mono">${esc(m.method)}</td><td class="mono">${esc(m.path)}</td><td>${r.desc}</td></tr>`;
  }).join('');
  const funcRows = HELP_FUNCS.map(([name, sig, desc, example]) =>
    `<tr><td class="mono"><b>${esc(name)}</b></td><td class="mono">${esc(sig)}</td><td>${esc(desc)}</td><td class="mono">${esc(example)}</td></tr>`
  ).join('');
  const groups = [];
  HELP_SECTIONS.forEach((s) => { if (!groups.includes(s.group)) groups.push(s.group); });
  const navHtml = groups.map((g) => {
    const items = HELP_SECTIONS.filter((s) => s.group === g);
    return `<div class="hb-nav-group">${esc(g)}</div>${items.map((s) =>
      `<button class="hb-nav-item" data-help-go="${s.id}" title="${esc(s.title)}"><span class="hb-nav-num">${s.num}</span><span>${esc(s.nav)}</span></button>`
    ).join('')}`;
  }).join('');
  const sectionHtml = HELP_SECTIONS.map((s) => `
    <section class="hb-sec" id="hb-sec-${s.id}" data-help-id="${s.id}">
      <div class="hb-sec-head">
        <span class="hb-sec-num">${s.num}</span>
        <div><h2>${esc(s.title)}</h2><p>${esc(s.lead)}</p></div>
      </div>
      ${s.body.replace('@@ROUTE_ROWS@@', routeRows).replace('@@FUNC_ROWS@@', funcRows)}
    </section>`).join('');

  $('#workspace').innerHTML = `
  <div class="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-neutral-300 bg-white">
    <button class="btn thin" data-action="grid">← 表格</button>
    <b class="text-[12px]">使用手册</b>
    <span class="text-neutral-500 text-[10px] hidden sm:inline">可搜索 · 每一步都能照着做</span>
    <div class="hb-search-wrap ml-auto"><input id="helpSearch" placeholder="搜索章节 / 语法 / 函数 / 错误…" autocomplete="off"><span class="hb-search-count" id="helpCount">${HELP_SECTIONS.length}/${HELP_SECTIONS.length}</span></div>
    <button class="btn thin" data-action="openHelpUrl" title="打开生成服务的 /help">服务帮助</button>
    <button class="btn thin" data-action="openDocsUrl" title="打开生成的 OpenAPI 文档">API 文档</button>
  </div>
  <div class="hb-shell">
    <aside class="hb-aside">
      <div class="hb-aside-head"><b>目录</b><span>15 章 · 40 函数 · 10 路由</span></div>
      ${navHtml}
    </aside>
    <div class="hb-scroll" id="helpScroll">
      <div class="hb-main">
        <div class="hb-hero">
          <div class="hb-kicker">CLICKBUILD · USER GUIDE</div>
          <h1>从第一个接口，到能交付的服务</h1>
          <p>这不是语法速查表，而是一本按真实按钮写成的使用手册。先走“5 分钟跑通”，再按章节查建表、路由、脚本、联调、导出和排错。</p>
          <div class="hb-meta"><span>15 章</span><span>40 个内置函数</span><span>10 类路由</span><span>25 种字段</span><span>8 种接口类型</span></div>
          <div class="hb-hero-actions">
            <button class="btn solid" data-help-go="quick">从 5 分钟开始</button>
            <button class="btn thin" data-help-go="functions">查函数签名</button>
            <button class="btn thin" data-help-go="recipes">看实战配方</button>
            <button class="btn thin" data-help-go="trouble">接口报错怎么办</button>
          </div>
        </div>
        <div class="hb-empty" id="helpEmpty">没有匹配的章节。<br>试试“脚本”“上传”“404”“事务”或函数名。</div>
        ${sectionHtml}
        <div class="hb-p" style="margin-top:26px;color:#8a93a1;font-size:10.5px">本手册随应用内真实能力生成。函数清单、路由元数据和字段类型以当前运行时为准；服务页 /help、/docs 需要在网页服务启动后才能打开。</div>
      </div>
    </div>
  </div>`;
  bindHelp();
}

function bindHelp() {
  const root = $('#workspace');
  const scroll = root.querySelector('#helpScroll');
  const search = root.querySelector('#helpSearch');
  const count = root.querySelector('#helpCount');
  const empty = root.querySelector('#helpEmpty');
  const nav = Array.from(root.querySelectorAll('.hb-nav-item'));
  const sections = Array.from(root.querySelectorAll('.hb-sec'));

  const go = (id) => {
    const sec = root.querySelector('#hb-sec-' + id);
    if (sec) sec.scrollIntoView({ block: 'start' });
  };
  root.querySelectorAll('[data-help-go]').forEach((b) => { b.onclick = () => go(b.dataset.helpGo); });

  let raf = 0;
  const spy = () => {
    raf = 0;
    let current = sections[0] ? sections[0].dataset.helpId : '';
    const top = scroll.getBoundingClientRect().top + 18;
    sections.forEach((s) => { if (s.getBoundingClientRect().top <= top) current = s.dataset.helpId; });
    nav.forEach((b) => b.classList.toggle('on', b.dataset.helpGo === current));
  };
  scroll.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(spy); });
  spy();

  const filter = () => {
    const q = String(search.value || '').trim().toLowerCase();
    let shown = 0;
    sections.forEach((s) => {
      const hit = !q || s.textContent.toLowerCase().includes(q);
      s.style.display = hit ? '' : 'none';
      if (hit) shown += 1;
    });
    nav.forEach((b) => {
      const sec = root.querySelector('#hb-sec-' + b.dataset.helpGo);
      b.style.display = (!q || (sec && sec.style.display !== 'none')) ? '' : 'none';
    });
    count.textContent = shown + '/' + sections.length;
    empty.style.display = shown ? 'none' : 'block';
  };
  search.addEventListener('input', filter);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; filter(); search.blur(); }
  });
}

/* ---------------- 搜索 ---------------- */
let gridQuery = '';
let searchActive = -1;
let searchRows = [];
const SEARCH_LIMIT = 60;
const SEARCH_KIND_ORDER = { '接口': 0, '路由': 1, '表': 2, '字段': 3 };

function searchScore(text, q, weight) {
  const t = String(text || '').toLowerCase();
  if (t === q) return 100 * weight;
  if (t.startsWith(q)) return 60 * weight;
  if (t.includes(q)) return 30 * weight;
  return 0;
}

function markSearch(text, q) {
  const raw = String(text == null ? '' : text);
  const low = raw.toLowerCase();
  const idx = low.indexOf(q.toLowerCase());
  if (idx < 0) return esc(raw);
  return esc(raw.slice(0, idx)) + '<mark>' + esc(raw.slice(idx, idx + q.length)) + '</mark>' + esc(raw.slice(idx + q.length));
}

function searchMatches(q) {
  const low = q.toLowerCase();
  const seen = new Map();
  const total = { score: 0 };
  const push = (id, kind, text, extra, cat, more) => {
    const key = `${id}|${kind}|${text}`;
    if (seen.has(key)) return;
    seen.set(key, { id, kind, text, extra, cat, score: total.score, ...(more || {}) });
  };
  for (const it of S.project.interfaces) {
    const cat = S.project.categories.find((c) => c.id === it.categoryId);
    const catName = cat ? cat.name : '';
    total.score = searchScore(it.name, low, 3);
    if (it.name.toLowerCase().includes(low)) push(it.id, '接口', it.name, '名称', catName);
    total.score = searchScore(it.comment || '', low, 2);
    if ((it.comment || '').toLowerCase().includes(low)) push(it.id, '接口', it.comment, '备注', catName);
    for (const t of it.tables) {
      total.score = searchScore(t.name, low, 2);
      if (t.name.toLowerCase().includes(low)) push(it.id, '表', t.name, `表键 ${t.key}`, catName, { tableKey: t.key });
      total.score = searchScore(t.comment || '', low, 2);
      if ((t.comment || '').toLowerCase().includes(low)) push(it.id, '表', `${t.name} · ${t.comment}`, '表注释', catName, { tableKey: t.key });
      const mode = storeOf(t).mode;
      total.score = searchScore(storeLabel(mode), low, 2);
      if (mode.includes(low) || storeLabel(mode).toLowerCase().includes(low)) push(it.id, '表', `${t.name} · ${storeLabel(mode)}`, '加速模式', catName, { tableKey: t.key });
      for (const f of t.fields) {
        const display = `${t.name}.${f.name}`;
        total.score = searchScore(display, low, 3);
        if (display.toLowerCase().includes(low)) push(it.id, '字段', display, f.type, catName, { tableKey: t.key, field: f.name });
        total.score = searchScore(f.comment || '', low, 1);
        if ((f.comment || '').toLowerCase().includes(low)) push(it.id, '字段', `${display} · ${f.comment}`, '字段注释', catName, { tableKey: t.key, field: f.name });
      }
    }
    for (const r of it.routes) {
      total.score = searchScore(`${r.method} ${r.path}`, low, 2);
      if ((r.name + ' ' + r.path + ' ' + r.script).toLowerCase().includes(low)) {
        push(it.id, '路由', `${r.method} ${r.path}`, r.name || '路由', catName, { routeId: r.id });
      }
    }
  }
  const rows = [...seen.values()].sort((a, b) => b.score - a.score || (SEARCH_KIND_ORDER[a.kind] ?? 9) - (SEARCH_KIND_ORDER[b.kind] ?? 9));
  return { rows, total: rows.length };
}

function focusTableField(name) {
  if (!name) return;
  const rows = [...document.querySelectorAll('#workspace tr[data-field-row]')];
  const row = rows.find((tr) => {
    const inp = tr.querySelector('[data-fk="name"]');
    return inp && inp.value === name;
  });
  if (!row) return;
  row.scrollIntoView({ block: 'center' });
  row.style.background = '#fff3bf';
  row.style.outline = '2px solid #171717';
  const inp = row.querySelector('[data-fk="name"]');
  if (inp) { inp.focus(); inp.select && inp.select(); }
  setTimeout(() => { row.style.background = ''; row.style.outline = ''; }, 1800);
}

function renderSearch() {
  const q = $('#search').value.trim();
  const panel = $('#searchPanel');
  if (!q) { panel.classList.add('hidden'); searchActive = -1; return; }
  const found = searchMatches(q);
  searchRows = found.rows;
  if (searchActive >= searchRows.length) searchActive = 0;
  panel.classList.remove('hidden');
  const head = `<div class="sticky top-0 bg-neutral-100 border-b border-neutral-300 px-3 py-1.5 text-[11px] flex gap-2">
    <b>${found.total} 条</b><span class="text-neutral-500">↑↓ 选择 · Enter 跳转</span>
    ${found.total > SEARCH_LIMIT ? `<span class="ml-auto text-neutral-500">显示前 ${SEARCH_LIMIT} 条，缩小关键词继续找</span>` : ''}
  </div>`;
  const body = searchRows.length ? searchRows.slice(0, SEARCH_LIMIT).map((r, i) => `
    <div class="result-item px-3 py-2 border-b border-neutral-200 cursor-pointer ${i === searchActive ? 'bg-neutral-100' : ''}" data-res="${i}">
      <div class="flex gap-2 items-center"><span class="pill">${esc(r.kind)}</span><span>${markSearch(r.text, q)}</span></div>
      <div class="text-[11px] text-neutral-500">${esc(r.cat)} · ${esc(r.extra)}</div>
    </div>`).join('') : '<div class="p-3 text-neutral-500 text-[12px]">没有匹配。</div>';
  panel.innerHTML = head + body;
  if (searchActive >= 0) {
    const el = panel.querySelector(`[data-res="${searchActive}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  panel.querySelectorAll('[data-res]').forEach((el) => {
    el.onclick = () => {
      const r = searchRows[Number(el.dataset.res)];
      const it = ifaceOf(r.id);
      S.cat = it.categoryId;
      if (r.kind === '路由') {
        const route = it.routes.find((x) => x.id === r.routeId) || it.routes[0];
        S.routeId = route.id; S.mode = 'editor'; S.tab = 'routes';
      } else if (r.kind === '表' || r.kind === '字段') {
        const key = r.tableKey || (it.tables[0] || {}).key;
        S.tableKey = key; S.mode = 'editor'; S.tab = 'tables';
      } else openIface(it.id);
      panel.classList.add('hidden');
      $('#search').value = '';
      searchActive = -1;
      render();
      if (r.kind === '字段' && r.field) requestAnimationFrame(() => focusTableField(r.field));
    };
  });
}

/* ---------------- 动作 ---------------- */
let launchingWeb = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function flushStudio(reason) {
  if (!studioLoaded || !studioReady) return !studioDirty;
  let tries = 0;
  while (studioDirty || studioSaveBusy) {
    if (tries++ > 4) return false;
    if (studioSaveBusy) { await pause(250); continue; }
    if (await saveStudioToProject(reason, true)) return true;
    await pause(250);
  }
  return true;
}
let deployingUpdate = false;
async function ensureInfra() {
  const infra = (S.services && S.services.items || []).filter((x) => x.id !== 'server');
  const missing = infra.filter((x) => !x.running);
  if (!missing.length) return [];
  toast(`正在启动 ${missing.map((x) => x.name).join(' / ')}…`, 12000);
  const results = await Promise.all(missing.map((x) => api.startService(x.id).catch((e) => ({ ok: false, error: e.message }))));
  const failed = missing.filter((x, i) => results[i] && results[i].ok === false);
  if (failed.length) toast(`依赖启动失败：${failed.map((x) => x.name).join(' / ')}，仍会尝试继续`, 6000);
  S.services = await api.services();
  return failed;
}
async function deployUpdate() {
  if (deployingUpdate) return toast('正在更新部署，请稍候');
  deployingUpdate = true;
  try {
    if (studioLoaded && (studioDirty || studioSaveBusy)) {
      const synced = await flushStudio('更新部署前保存');
      if (!synced) return toast('前端还没同步到当前工程，先处理同步失败再更新', 5000);
    }
    if (!(await save(true))) return;
    const v = await api.validate(S.project);
    if (v && v.errors && v.errors.length) return toast(`还有 ${v.errors.length} 处问题，先修好再更新`, 5000);

    await ensureInfra();
    const r = await api.deploy(S.project, { runtime: S.runner, hot: S.hot, dir: S.genDir });
    if (!r || r.ok === false) {
      S.services = await api.services();
      renderRibbon();
      return toast('更新部署失败：' + String((r && r.error) || '未知错误').slice(0, 180), 6000);
    }
    S.genDir = r.dir;
    S.services = await api.services();
    if (S.view === 'studio') {
      renderRibbon();
      refreshStudioState();
    } else {
      render();
    }
    const state = r.restarted ? '服务已重启' : '服务已启动';
    toast(`更新完成：${r.files.length} 个文件，${state}（:${r.port}）`, 4500);
  } catch (e) {
    toast('更新部署失败：' + String((e && e.message) || e), 6000);
  } finally {
    deployingUpdate = false;
  }
}

async function launchWeb() {
  if (launchingWeb) return toast('正在启动网页，请稍候');
  launchingWeb = true;
  try {
    if (studioLoaded && (studioDirty || studioSaveBusy)) {
      const synced = await flushStudio('启动前保存');
      if (!synced) return toast('前端还没同步到当前工程，先处理同步失败再启动', 5000);
    }
    await ensureInfra();
    const g = await api.generate(S.project);
    if (!g.ok) return toast('生成失败：' + String(g.error || '').slice(0, 160), 6000);
    S.genDir = g.dir;
    const prev = (S.services && S.services.items || []).find((x) => x.id === 'server');
    if (prev && prev.running && prev.dir && prev.dir !== g.dir) await api.stopServer();
    const r = await api.startServer(S.genDir, { runtime: S.runner, hot: S.hot });
    if (r.ok === false) return toast(r.error || '启动失败', 6000);
    S.services = await api.services();
    renderRibbon(); renderSide(); renderWorkspace();
    const svc = (S.services.items || []).find((x) => x.id === 'server');
    if (!svc || !svc.running) return toast('服务没有监听网页端口，请打开日志排查', 6000);
    const url = await api.console();
    toast(`${r.already ? '服务已在运行' : '网页已启动'}，已打开主页 ${url || ''}`, 4000);
  } catch (e) {
    toast('启动网页失败：' + String((e && e.message) || e), 6000);
  } finally {
    launchingWeb = false;
  }
}
async function runPluginCommand(key) {
  if (!key) return;
  const r = await api.pluginRun(key, { project: S.project, ifaceId: S.selId, tableKey: S.tableKey });
  if (r && r.ok === false) return toast('插件命令失败：' + (r.error || ''), 6000);
  if (r && r.project) {
    S.project = r.project;
    if (!S.project.interfaces.some((i) => i.id === S.selId)) S.selId = (S.project.interfaces[0] || {}).id;
    if (!S.project.categories.some((c) => c.id === S.cat)) S.cat = (S.project.categories[0] || {}).id || '';
    render();
    scheduleSave();
  }
  if (r && r.message) toast(r.message, 4500);
  if (r && r.openUrl) api.openUrl(r.openUrl);
  if (r && r.html) {
    modal(`<div class="p-5 max-w-[720px] max-h-[80vh] overflow-auto">${r.html}<div class="flex justify-end mt-4"><button class="btn thin" id="pluginResultClose">关闭</button></div></div>`, (root) => {
      root.querySelector('#pluginResultClose').onclick = closeModal;
    });
  }
  try { S.pluginInfo = await api.pluginSummary(); renderRibbon(); } catch (_) {}
}

async function act(name, el) {
  const it = (S.project && Array.isArray(S.project.interfaces)) ? activeIface() : null;
  if (name === 'moreMenu') return showMoreMenu();
  if (name === 'save') return save();
  if (name === 'scriptGuide') return showScriptGuide();
  if (name === 'toggleAssist') {
    const a = $('#scriptAssist');
    if (a) a.classList.toggle('hidden');
    return;
  }
  if (name === 'seed') {
    return newTaskFlow();
  }
  if (name === 'open') {
    if (!(await flushAndSave('打开工程'))) return;
    await showProjectHub();
    return;
  }
  if (name === 'newIface') {
    const cat = S.project.categories.find((c) => c.id === S.cat) || S.project.categories[0];
    const cfg = await newIfaceGuide(cat.id);
    if (!cfg) return;
    if (cfg.fromLibraryId) {
      const got = await api.ifaceLibraryInsert(S.project, cfg.fromLibraryId);
      if (!got.ok) return toast('复用失败：' + String(got.error || '').slice(0, 200), 6500);
      S.project = got.project; S.cat = got.category; S.selId = got.ifaceId;
      openIface(got.ifaceId); scheduleSave();
      toast(`已从常用接口复制「${got.name}」${got.renamed ? '（同名，已自动加序号）' : ''}${got.routesRenamed ? `（${got.routesRenamed} 条路由已避重）` : ''}`, 3600);
      return;
    }
    const blank = await api.blank(cfg);
    S.project.interfaces.push(blank); S.cat = blank.categoryId; S.selId = blank.id;
    openIface(blank.id); scheduleSave(); toast(`已创建接口「${blank.name}」`);
    return;
  }
  if (name === 'dupIface' && it) {
    const copy = await api.clone(it, S.project.interfaces.map((x) => x.name));
    S.project.interfaces.push(copy); S.selId = copy.id; S.mode = 'editor';
    scheduleSave(); render(); toast(`已复制为「${copy.name}」`);
    return;
  }
  if (name === 'delIface' && it) {
    if (!(await confirmBox('删除接口', `确定删掉「${it.name}」？表结构、脚本都会一起没了。`))) return;
    S.project.interfaces = S.project.interfaces.filter((x) => x.id !== it.id);
    S.mode = 'grid'; S.selId = (S.project.interfaces[0] || {}).id || '';
    scheduleSave(); render();
    return;
  }
  if (name === 'addTable' && it) {
    const n = await ask('新表名字', 'new_table', '表键会自动生成，脚本里按表键引用；中文名会自动转成安全表名');
    if (!n) return;
    const safe = await api.ident(n, 'tbl');
    const key = nextTableKey(it, safe);
    it.tables.push({ key, name: safe, schema: '', comment: '', fields: defaultFields() });
    S.tableKey = key; S.tab = 'tables'; scheduleSave(); renderWorkspace();
    return;
  }
  if (name === 'dupTable' && it) {
    const t = tableOfIface(it, S.tableKey);
    const copy = JSON.parse(JSON.stringify(t));
    copy.key = nextTableKey(it, t.key);
    copy.name = `${t.name}_copy`;
    copy.comment = `${t.comment || ''}（副本）`;
    it.tables.push(copy);
    S.tableKey = copy.key; S.tab = 'tables'; scheduleSave(); renderWorkspace();
    toast(`已复制表结构为「${copy.key}」`);
    return;
  }
  if (name === 'delTable' && it) {
    if (it.tables.length <= 1) return toast('至少留一张表');
    const t = tableOfIface(it, S.tableKey);
    if (!(await confirmBox('删表', `确定删掉表「${t.name}」？`))) return;
    it.tables = it.tables.filter((x) => x.key !== t.key);
    S.tableKey = it.tables[0].key; scheduleSave(); renderWorkspace();
    return;
  }
  if (name === 'importTable') { const inp = $('#tImport'); if (inp) inp.click(); return; }
  if (name === 'addField' && it) {
    addFieldQuick(it);
    return;
  }
  if (name === 'addRoute' && it) {
    const kind = ($('#newRouteKind') || {}).value || 'custom';
    const route = newRoute(it, kind);
    applyIoType(it, route, route.io && route.io.typeId);
    it.routes.push(route); S.routeId = route.id; scheduleSave(); renderWorkspace();
    return;
  }
  if (name === 'delRoute' && it) {
    const r = it.routes.find((x) => x.id === S.routeId);
    if (!r) return;
    if (!(await confirmBox('删除路由', `确定删掉 ${r.method} ${r.path}？`))) return;
    it.routes = it.routes.filter((x) => x.id !== r.id);
    S.routeId = (it.routes[0] || {}).id || ''; scheduleSave(); renderWorkspace();
    return;
  }
  if (name === 'addCat') {
    const n = await ask('新分类名字', '新分类');
    if (!n) return;
    const id = 'c' + Math.random().toString(16).slice(2, 6);
    S.project.categories.push({ id, name: n });
    S.cat = id; S.mode = 'grid'; scheduleSave(); render();
    return;
  }
  if (name === 'grid') { S.mode = 'grid'; render(); return; }
  if (name === 'help') { S.mode = 'help'; if (!S.help) S.help = await api.help(); render(); return; }
  if (name === 'openHelpUrl' || name === 'openDocsUrl') {
    const svc = (S.services.items || []).find((x) => x.id === 'server');
    if (!svc || !svc.running) return toast('先生成并启动服务，再打开帮助页');
    await api.openUrl(`http://127.0.0.1:${svc.port}${name === 'openHelpUrl' ? '/help' : '/docs'}`);
    return;
  }
  if (name === 'test') { if (it) { S.mode = 'editor'; S.tab = 'test'; renderWorkspace(); } return; }
  if (name === 'genTests') {
    let dir = S.genDir;
    if (!dir) {
      const g = await api.generate(S.project);
      if (!g.ok) return toast('生成失败：' + String(g.error || '').slice(0, 120), 5000);
      dir = g.dir;
      S.genDir = dir;
      if (g.tests) S.testCounts = g.tests;
    }
    const r = await api.generateTests(S.project, dir);
    if (!r.ok) return toast('测试生成失败：' + String(r.error || '').slice(0, 120), 5000);
    S.testCounts = r.counts;
    if (S.tab === 'test') renderWorkspace();
    toast(`已生成 ${r.counts.cases} 个用例：${r.counts.runnable} 个可执行，${r.counts.writeCases || 0} 个写入用例，${r.counts.skipped} 个跳过`, 4500);
    return;
  }
  if (name === 'openGenDir') {
    if (!S.genDir) return toast('先生成工程或测试，再打开目录', 4000);
    await api.openPath(S.genDir);
    return;
  }
  if (name === 'check') {
    S.problems = (await api.validate(S.project)).errors;
    renderSide();
    toast(S.problems.length ? `有 ${S.problems.length} 处问题` : '脚本都通过了');
    return;
  }
  if (name === 'preview' && it) {
    const r = it.routes.find((x) => x.id === S.routeId) || it.routes[0];
    const pv = await api.preview({ iface: it, routeId: r.id, query: { page: '1' }, bodyText: '{"username":"tom"}' });
    if (!pv.ok) return toast(pv.error);
    modal(`<div class="p-3"><div class="flex items-center gap-2 mb-2"><b>展开后的 SQL</b><span class="mono text-[11px] text-neutral-500">${esc(r.method)} ${esc(r.path)}</span><button class="btn thin ml-auto" id="pvClose">关闭</button></div>
      ${pv.statements.map((s) => `<div class="mb-3"><div class="text-[11px] text-neutral-500">${esc(s.mode)} ${esc(s.name)}</div><pre class="monoarea border border-neutral-300 p-2 bg-neutral-50 whitespace-pre-wrap">${esc(s.sql)}\n参数 ${esc(JSON.stringify(s.params))}</pre></div>`).join('')}
      ${pv.cacheKey ? `<div class="text-[11px]">缓存键 <span class="mono">${esc(pv.cacheKey)}</span></div>` : ''}
      </div>`, (root) => { root.querySelector('#pvClose').onclick = closeModal; });
    return;
  }
  if (name === 'ddl' && it) {
    const d = await api.ddl(it);
    modal(`<div class="p-3"><div class="flex items-center gap-2 mb-2"><b>DDL</b><button class="btn thin ml-auto" id="ddlClose">关闭</button></div><pre class="monoarea border border-neutral-300 p-2 bg-neutral-50 whitespace-pre-wrap">${esc(d.ddl || d.error)}</pre></div>`, (root) => { root.querySelector('#ddlClose').onclick = closeModal; });
    return;
  }
  if (name === 'send' && it) {
    const route = it.routes.find((x) => x.id === $('#tRoute').value) || it.routes[0];
    const idv = $('#tId').value.trim();
    let p = (route.path || '').replace(':id', idv || '1');
    if (!p.startsWith('/')) p = '/' + p;
    p = '/api' + (it.basePath || '') + p;
    const q = {};
    $('#tQuery').value.split('&').filter(Boolean).forEach((kv) => { const [k, v] = kv.split('='); if (k) q[k] = v || ''; });
    const r = await api.test({ method: route.method, path: p, query: q, bodyText: $('#tBody').value.trim(), id: idv });
    $('#tOut').textContent = r.ok ? `${r.status} · ${r.ms}ms\n${r.body}` : r.error;
    return;
  }
  if (name === 'generate') {
    const g = await api.generate(S.project);
    if (!g.ok) { toast('生成失败：' + String(g.error || '').slice(0, 120), 5000); return; }
    S.genDir = g.dir;
    if (g.tests) S.testCounts = g.tests;
    if (S.mode !== 'editor') S.mode = 'grid';
    S.tab = 'export';
    render();
    toast(`已生成 ${g.files.length} 个文件${g.tests ? ` · ${g.tests.runnable} 个可执行测试` : ''}${g.warnings && g.warnings.length ? `（插件提示 ${g.warnings.length} 条）` : ''}`, 3500);
    return;
  }
  if (name === 'deployUpdate') { return deployUpdate(); }
  if (name === 'launchWeb' || name === 'startServer') { return launchWeb(); }
  if (name === 'stopServer') {
    const r = await api.stopService('');
    S.services = await api.services();
    renderRibbon(); renderSide(); renderWorkspace();
    if (r && r.ok === false) return toast('停止失败：' + String(r.error || '仍有服务未能停止'), 7000);
    toast('已停止');
    return;
  }
  if (name === 'startAll') { await api.startService(''); S.services = await api.services(); renderRibbon(); renderSide(); toast('已启动三台服务'); return; }
  if (name === 'stopAll') { await api.stopService(''); S.services = await api.services(); renderRibbon(); renderSide(); toast('已停止'); return; }
  if (name === 'home' || name === 'console') {
    const svc = (S.services && S.services.items || []).find((x) => x.id === 'server');
    if (!svc || !svc.running) return toast('网页还没启动，先点“启动”', 4000);
    await api.console();
    return;
  }
  if (name === 'logs') { return showLogs(); }
  if (name === 'addFunc') {
    S.project.functions.push({ name: 'MY_FUNC', params: ['v'], body: 'UPPER(v)' });
    scheduleSave(); renderWorkspace();
    return;
  }
  if (name === 'exportProject') {
    const errCfg = S.project.errors || {};
    modal(`<div class="p-4 w-[420px]">
      <div class="text-[13px] font-semibold mb-3">导出工程</div>
      <label class="flex items-start gap-2 py-2 cursor-pointer"><input id="epPages" type="checkbox" ${errCfg.pages === false ? '' : 'checked'} class="mt-0.5"><span><b class="text-[12px]">生成 404 / 500 错误页</b><span class="block text-[11px] text-neutral-500">浏览器打开时显示黑白错误页，API 客户端仍收到 JSON。</span></span></label>
      <label class="flex items-start gap-2 py-2 cursor-pointer"><input id="epDetail" type="checkbox" ${errCfg.detail === false ? '' : 'checked'} class="mt-0.5"><span><b class="text-[12px]">500 页面显示错误详情</b><span class="block text-[11px] text-neutral-500">关闭后只显示状态码和 traceId，堆栈写日志。</span></span></label>
      <div class="text-[11px] text-neutral-500 mt-1 mb-3">导出同时带 <span class="mono">dev.js</span> 热部署入口（<span class="mono">node dev.js</span>）。</div>
      <label class="block text-[11px] font-semibold mb-1">导出类型（只导出选中的一套）</label>
      <select id="epRuntime" class="w-full border border-neutral-300 bg-white px-2 py-1.5 text-[12px] mb-2">
        <option value="node">Node.js（server.js，默认）</option>
        <option value="bun">Bun（server.js）</option>
        <option value="go">Go 原生（native/go，不依赖 Node）</option>
        <option value="java">Java 原生（native/java，JDK 17+）</option>
        <option value="python">Python Flask（native/python）</option>
      </select>
      <div class="text-[11px] text-neutral-500 mb-3">选择后会按这个类型裁剪导出目录：只带对应的服务端实现和公共 <span class="mono">config.json</span> / <span class="mono">public/</span>，不再把四套运行时一起塞进工程。</div>
      <div class="flex justify-end gap-2"><button class="btn thin" id="epCancel">取消</button><button class="btn solid" id="epGo">导出</button></div></div>`, (m) => {
      m.querySelector('#epCancel').onclick = closeModal;
      m.querySelector('#epGo').onclick = async () => {
        const errors = { pages: !!m.querySelector('#epPages').checked, detail: !!m.querySelector('#epDetail').checked };
        const runtime = m.querySelector('#epRuntime').value || 'node';
        closeModal();
        const r = await api.exportProject(S.project, { errors, runtime, runtimeOnly: true });
        if (!r) return;
        if (!r.ok) return toast('导出失败：' + String(r.error || '').slice(0, 160), 6000);
        S.exportDir = r.dir;
        modal(`<div class="p-4">
          <div class="text-[13px] font-semibold mb-2">工程已导出 · ${r.files.length} 个文件</div>
          <div class="text-[11px] text-neutral-500 mb-1 mono break-all">${esc(r.dir)}</div>
          <div class="text-[11px] text-neutral-600 mb-3">导出类型：<span class="mono">${esc(r.runtime || 'node')}</span>（只包含这一套）；已带 <span class="mono">.idea</span> 工程配置；错误页：${errors.pages ? '开' : '关'}，500 详情：${errors.detail ? '开' : '关'}。</div>
          <div class="text-[11px] text-neutral-500 mb-4">先看 <span class="mono">RUN.md</span>。数据库、Redis、S3 地址在 <span class="mono">.env</span>。</div>
          <div class="flex justify-end gap-2">
            <button class="btn thin" id="epOpen">打开目录</button>
            <button class="btn solid" id="epIdea">用 IDEA 打开</button>
          </div></div>`, (mm) => {
          mm.querySelector('#epOpen').onclick = () => api.openPath(r.dir);
          mm.querySelector('#epIdea').onclick = async () => {
            const got = await api.openInIdea(r.dir);
            if (got.ok) { closeModal(); toast('已交给 IntelliJ IDEA 打开', 3500); }
            else { toast(got.error || '没有找到 IDEA，已打开目录', 6000); api.openPath(r.dir); }
          };
        });
      };
    });
    return;
  }
  if (name === 'exportYxpn') {
    const r = await api.exportYxpn(S.project);
    if (!r.ok) return toast('导出失败：' + r.error, 5000);
    toast(`已导出工程包（${Math.round(r.size / 1024)} KB）：${r.file}`, 5000);
    return;
  }
  if (name === 'importYxpn') {
    const r = await api.importYxpn();
    if (!r) return;
    if (!r.ok) return toast('导入失败：' + r.error, 5000);
    S.project = r.project;
    S.cat = (S.project.categories[0] || {}).id || '';
    S.selId = (S.project.interfaces[0] || {}).id || '';
    S.mode = 'grid';
    await api.save(S.project);
    render(); toast(`已导入「${S.project.name}」（${r.files.length} 个文件）`, 4000);
    return;
  }
  if (name === 'docs') {
    const d = await api.docs(S.project);
    if (!d.ok) return toast('文档生成失败');
    modal(`<div class="p-4">
      <div class="flex items-center gap-2 mb-3"><b>API 文档预览</b>
        <span class="pill">OpenAPI 3.0.3</span>
        <button class="btn thin ml-auto" id="docOpen">在浏览器打开</button>
        <button class="btn thin" id="docCopy">复制 JSON</button>
        <button class="btn thin" id="docClose">关闭</button></div>
      <pre class="monoarea border border-neutral-300 bg-neutral-50 p-2 max-h-[60vh] overflow-auto whitespace-pre-wrap">${esc(JSON.stringify(d.openapi, null, 2))}</pre>
    </div>`, (root) => {
      root.querySelector('#docClose').onclick = closeModal;
      root.querySelector('#docOpen').onclick = () => api.openUrl(`http://127.0.0.1:${(S.settings.ports || {}).http || 18100}/docs`);
      root.querySelector('#docCopy').onclick = () => { navigator.clipboard.writeText(JSON.stringify(d.openapi, null, 2)); toast('已复制'); };
    });
    return;
  }
  if (name === 'ai') return showAi();
  if (name === 'microExport') return showMicroExport();
  if (name === 'templates') return showTemplates();
  if (name === 'saveTemplate') return showSaveTemplate();
  if (name === 'ifaceLib') return showIfaceLibrary();
  if (name === 'favLib') return showIfaceLibrary({ view: 'favorite' });
  if (name === 'saveIface') return showSaveIface();
  if (name === 'plugins') return showPlugins();
  if (name === 'monitor') return showMonitor();
  if (name === 'settings') return showSettings();
  if (name === 'language') return showLanguagePicker();
  if (name === 'theme') return showTheme();
  if (name === 'newWindow') {
    if (!(await flushAndSave('新窗口'))) return;
    await api.newWindow(S.project.name);
    toast('已打开同款无边框新窗口，当前工程已先保存');
    return;
  }
  if (name === 'assoc') {
    const r = await api.assocYxpn();
    toast(r.ok ? '已把 .yxpn / .yxpp 关联到本软件，双击即可用这里打开' : '关联失败：' + (r.error || r.out || ''), 5000);
    return;
  }
}

/* ---------------- 微服务导出 ---------------- */
function showMicroExport(presetId) {
  const cats = S.project.categories || [];
  const ifaces = S.project.interfaces || [];
  const nOf = (cid) => ifaces.filter((i) => i.categoryId === cid).length;
  modal(`<div class="p-4">
    <div class="text-[13px] font-semibold mb-3">按接口 / 分类导出独立服务</div>
    <div class="text-[11px] text-neutral-500 mb-2">勾选分类会带上它下面的全部接口；导出物是完整可启动的服务，端口、库、缓存都要自己改。</div>
    <div class="grid grid-cols-2 gap-2">
      <div class="border border-neutral-300 p-2 max-h-[40vh] overflow-auto">
        <div class="text-[11px] font-semibold mb-1">按分类</div>
        ${cats.map((c) => `<label class="flex items-center gap-2 py-0.5"><input type="checkbox" class="mexCat" data-cat="${esc(c.id)}"><span>${esc(c.name)}</span><span class="text-neutral-500 text-[11px]">${nOf(c.id)} 个接口</span></label>`).join('') || '<div class="text-neutral-500">没有分类</div>'}
      </div>
      <div class="border border-neutral-300 p-2 max-h-[40vh] overflow-auto">
        <div class="text-[11px] font-semibold mb-1">按接口</div>
        ${ifaces.map((i) => `<label class="flex items-center gap-2 py-0.5"><input type="checkbox" class="mexIface" data-cat="${esc(i.categoryId)}" value="${esc(i.id)}"${i.id === presetId ? ' checked' : ''}><span>${esc(i.name)}</span><span class="text-neutral-500 text-[11px]">${(i.routes || []).length} 条路由</span></label>`).join('') || '<div class="text-neutral-500">没有接口</div>'}
      </div>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button class="btn thin" id="mexNo">取消</button>
      <button class="btn solid" id="mexYes">导出</button>
    </div></div>`, (root) => {
    root.querySelectorAll('.mexCat').forEach((cb) => {
      cb.onchange = () => {
        root.querySelectorAll('.mexIface').forEach((ib) => {
          if (ib.dataset.cat === cb.dataset.cat) ib.checked = cb.checked;
        });
      };
    });
    root.querySelector('#mexNo').onclick = closeModal;
    root.querySelector('#mexYes').onclick = async () => {
      const only = [...new Set([...root.querySelectorAll('.mexIface:checked')].map((x) => x.value))];
      if (!only.length) return toast('至少选一个接口');
      const picked = ifaces.filter((i) => only.includes(i.id)).map((i) => i.name);
      closeModal();
      const name = await ask('微服务名称', `${S.project.name}-微服务`, '只导出选中的接口，生成到独立目录');
      if (!name) return;
      const r = await api.generate(S.project, undefined, { only, dirName: name, ide: true });
      if (!r.ok) return toast('导出失败：' + String(r.error || '').slice(0, 140), 5000);
      modal(`<div class="p-4">
        <div class="text-[13px] font-semibold mb-2">已导出 ${r.count} 个接口 · ${r.files.length} 个文件</div>
        <div class="text-[11px] text-neutral-500 mb-2 mono break-all">${esc(r.dir)}</div>
        <div class="text-[11px] text-neutral-600 mb-1">${esc(picked.join('、'))}</div>
        <div class="text-[11px] text-neutral-500 mb-4">已带 <span class="mono">.idea</span>；启动前改 .env 里的 PORT / MYSQL_DB / CACHE_PREFIX，避免和主服务抢端口、串库、串缓存。</div>
        <div class="flex justify-end gap-2">
          <button class="btn thin" id="mxOpen">打开目录</button>
          <button class="btn solid" id="mxIdea">用 IDEA 打开</button>
        </div></div>`, (m) => {
        m.querySelector('#mxOpen').onclick = () => api.openPath(r.dir);
        m.querySelector('#mxIdea').onclick = async () => {
          const got = await api.openInIdea(r.dir);
          if (got.ok) { closeModal(); toast('已交给 IntelliJ IDEA 打开', 3500); }
          else { toast(got.error || '没有找到 IDEA，已打开目录', 6000); api.openPath(r.dir); }
        };
      });
    };
  });
}

/* ---------------- 模版 ---------------- */
async function showTemplates() {
  const r = await api.templates();
  if (!r.ok) return toast('读取模版失败：' + r.error);
  modal(`<div class="p-4">
    <div class="flex items-center gap-2 mb-3"><b class="text-[13px]">工程模版</b>
      <span class="pill">${r.list.length} 个</span>
      <button class="btn thin ml-auto" id="tplSave">把当前工程存为模版</button>
      <button class="btn thin" id="tplClose">关闭</button></div>
    <div class="border border-neutral-300 max-h-[62vh] overflow-auto">
      ${r.list.map((t) => `<div class="flex items-start gap-3 p-3 border-b border-neutral-200">
        <div class="w-8 h-8 shrink-0 border border-neutral-900 flex items-center justify-center mono text-[11px]">${t.kind === 'builtin' ? '内置' : '我的'}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2"><b>${esc(t.name)}</b>
            <span class="text-[11px] text-neutral-500 mono">${t.counts.interfaces} 接口 · ${t.counts.tables} 表 · ${t.counts.routes} 路由</span></div>
          <div class="text-[12px] text-neutral-600 mt-1">${esc(t.description)}</div>
          <div class="text-[11px] text-neutral-500 mt-1">${(t.tags || []).map((x) => `<span class="pill mr-1">${esc(x)}</span>`).join('')}</div>
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <button class="btn thin" data-tpl-apply="${esc(t.id)}">套用</button>
          ${t.kind === 'user' ? `<button class="btn thin" data-tpl-del="${esc(t.id)}">删除</button>` : ''}
        </div>
      </div>`).join('')}
    </div>
    <div class="text-[11px] text-neutral-500 mt-2">套用会先保存当前工程，再用模版新建一个工程；当前内容不会被覆盖。内置模版只读，另存一份后可以随意改。</div>
  </div>`, (root) => {
    root.querySelector('#tplClose').onclick = closeModal;
    root.querySelector('#tplSave').onclick = () => { closeModal(); showSaveTemplate(); };
    root.querySelectorAll('[data-tpl-apply]').forEach((b) => {
      b.onclick = async () => {
        const got = await api.templateGet(b.dataset.tplApply);
        if (!got.ok) return toast('读取失败：' + got.error);
        const ok = await activateFreshProject(got.project, (p) => `已从模版「${got.name}」新建「${p.name}」`);
        if (ok) closeModal();
      };
    });
    root.querySelectorAll('[data-tpl-del]').forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmBox('删除模版', '确定删掉这个自定义模版？不会影响工程本身。'))) return;
        const d = await api.templateRemove(b.dataset.tplDel);
        if (!d.ok) return toast(d.error || '删除失败');
        closeModal(); showTemplates();
      };
    });
  });
}

async function showSaveTemplate() {
  const name = await ask('存为模版', S.project.name + ' 模版', '名字会出现在模版库里，之后可一键套用');
  if (!name) return;
  const r = await api.templateSave({ name, project: S.project, description: `${S.project.interfaces.length} 个接口的自定义模版` });
  if (!r.ok) return toast('保存失败：' + String(r.error || '').slice(0, 160), 5000);
  toast(`已保存模版「${r.name}」`);
}

/* ---------------- 接口库（单个接口） ---------------- */
function ifaceLibCategoryOf(it) {
  const cat = (S.project.categories || []).find((c) => c.id === it.categoryId);
  return cat ? cat.name : '未分类';
}

async function showSaveIface(opts) {
  const it = activeIface();
  if (!it) return toast('当前没有可保存的接口');
  const o = opts || {};
  const desc = it.docs && (it.docs.summary || it.docs.description) || `${it.tables.length} 表 · ${it.routes.length} 路由`;
  modal(`<div class="lib-save">
    <style>
      .lib-save{padding:20px 22px 18px;background:#fff;border-radius:12px;color:#2f3542}
      .lib-save h3{margin:0;font-size:15px;font-weight:600;letter-spacing:.2px}
      .lib-save .sub{margin-top:4px;font-size:11.5px;color:#7b8494}
      .lib-save label{display:block;margin-top:14px;font-size:11.5px;color:#606a7b}
      .lib-save input[type=text],.lib-save textarea{width:100%;box-sizing:border-box;margin-top:5px;border:1px solid #dfe4ec;border-radius:8px;padding:8px 10px;font-size:12.5px;color:#2f3542;outline:none;background:#fff}
      .lib-save input[type=text]:focus,.lib-save textarea:focus{border-color:#4c8dff;box-shadow:0 0 0 3px rgba(76,141,255,.12)}
      .lib-save textarea{resize:vertical;min-height:58px;line-height:1.5}
      .lib-save .fav{display:flex;align-items:center;gap:8px;margin-top:14px;padding:10px 12px;border:1px solid #f1dfb4;background:#fffbf1;border-radius:8px;color:#6b5a2e;font-size:12px}
      .lib-save .fav input{width:15px;height:15px}
      .lib-save .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
    </style>
    <h3>存为常用接口</h3>
    <div class="sub">保存当前接口的表、路由、文档和脚本，之后可以从常用接口一键复用。</div>
    <label>接口名称<input id="saveIfaceName" type="text" maxlength="40" value="${esc(it.name)}"></label>
    <label>分类<input id="saveIfaceCat" type="text" maxlength="20" value="${esc(ifaceLibCategoryOf(it))}" placeholder="例如：用户中心"></label>
    <label>说明<textarea id="saveIfaceDesc" maxlength="200">${esc(desc)}</textarea></label>
    <label class="fav"><input id="saveIfaceFav" type="checkbox" checked>加入常用（收藏），在「常用接口」里优先显示</label>
    <div class="acts"><button class="btn thin" id="saveIfaceNo">取消</button><button class="btn solid" id="saveIfaceYes">保存</button></div>
  </div>`, (root) => {
    const name = root.querySelector('#saveIfaceName');
    const cat = root.querySelector('#saveIfaceCat');
    const note = root.querySelector('#saveIfaceDesc');
    const fav = root.querySelector('#saveIfaceFav');
    name.focus(); name.select();
    const cancel = () => { closeModal(); if (o.after) o.after(); };
    const save = async () => {
      const n = name.value.trim();
      if (!n) return toast('接口名不能为空');
      const r = await api.ifaceLibrarySave({
        name: n,
        iface: it,
        sourceProject: S.project.name,
        description: note.value.trim(),
        category: cat.value.trim() || ifaceLibCategoryOf(it),
        favorite: fav.checked,
        tags: [S.project.name],
      });
      if (!r.ok) return toast('保存失败：' + String(r.error || '').slice(0, 180), 6500);
      closeModal();
      toast(fav.checked ? `已加入常用接口「${r.name}」` : `已存入接口库「${r.name}」`);
      if (o.after) o.after();
    };
    root.querySelector('#saveIfaceNo').onclick = cancel;
    root.querySelector('#saveIfaceYes').onclick = save;
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    cat.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  }, { width: 520, maxHeight: '90vh', plain: true });
}

async function showIfaceLibrary(opts) {
  const o = opts || {};
  const r = await api.ifaceLibrary();
  if (!r.ok) return toast('读取接口库失败：' + r.error);
  const state = {
    view: o.view || 'all',
    q: o.q || '',
    category: o.category || 'all',
  };
  let entries = (r.list || []).slice();
  const root = modal(`<div class="lib-shell">
    <style>
      .lib-shell{background:#fff;border-radius:12px;color:#2f3542;display:flex;flex-direction:column;max-height:86vh;font-family:"Microsoft YaHei","Segoe UI",sans-serif}
      .lib-head{display:flex;align-items:center;gap:12px;padding:17px 20px 13px;border-bottom:1px solid #edf0f4}
      .lib-mark{width:34px;height:34px;border-radius:9px;background:#fff6e2;color:#d99a20;display:flex;align-items:center;justify-content:center;flex:none}
      .lib-mark svg{width:18px;height:18px}
      .lib-title{font-size:15px;font-weight:600;line-height:1.2}
      .lib-sub{font-size:11.5px;color:#7b8494;margin-top:4px}
      .lib-head .acts{margin-left:auto;display:flex;gap:8px;align-items:center}
      .lib-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid #f1f3f7;background:#fcfdfe}
      .lib-search{display:flex;align-items:center;gap:6px;border:1px solid #dfe4ec;border-radius:8px;background:#fff;padding:0 9px;height:32px;min-width:238px}
      .lib-search svg{width:14px;height:14px;color:#9aa3b2;flex:none}
      .lib-search input{border:0;outline:0;background:transparent;font-size:12px;flex:1;min-width:0;color:#2f3542}
      .lib-tabs{display:flex;border:1px solid #dfe4ec;border-radius:8px;overflow:hidden;background:#fff}
      .lib-tab{border:0;background:#fff;padding:7px 11px;font-size:11.5px;color:#6b7484;cursor:pointer;border-right:1px solid #edf0f4}
      .lib-tab:last-child{border-right:0}
      .lib-tab.on{background:#eef4ff;color:#2f6fe4;font-weight:600}
      .lib-cat{height:32px;border:1px solid #dfe4ec;border-radius:8px;background:#fff;color:#536074;font-size:11.5px;padding:0 8px;max-width:140px;outline:none}
      .lib-stats{margin-left:auto;font-size:11.5px;color:#8b93a1;white-space:nowrap}
      .lib-list{overflow:auto;min-height:180px;max-height:calc(86vh - 198px);padding:4px 0}
      .lib-row{display:grid;grid-template-columns:28px 44px minmax(0,1fr) 118px auto;gap:10px;align-items:center;padding:10px 20px;border-bottom:1px solid #f1f3f7;background:#fff;transition:background .12s}
      .lib-row:hover{background:#fbfcff}
      .lib-row.is-fav{box-shadow:inset 3px 0 0 #f0c35b}
      .lib-star{width:28px;height:28px;border:1px solid transparent;border-radius:8px;background:transparent;color:#c4cad4;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
      .lib-star svg{width:15px;height:15px}
      .lib-star.on{color:#d99a20;background:#fff8e7;border-color:#f3e0b4}
      .lib-star.on svg{fill:#f6c453;stroke:#d99a20}
      .lib-kind{font-size:10px;text-align:center;padding:3px 0;border-radius:5px;border:1px solid #e2e6ee;color:#7c8697;background:#fafbfd}
      .lib-kind.user{color:#2f6fe4;border-color:#d7e4ff;background:#f2f7ff}
      .lib-name-line{display:flex;align-items:center;gap:7px;min-width:0}
      .lib-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lib-cat-pill{font-size:10px;color:#56627a;background:#f1f3f7;border-radius:10px;padding:1px 8px;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis}
      .lib-desc{font-size:10.5px;color:#8b93a1;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lib-meta{font-size:10.5px;color:#697386;text-align:right;line-height:1.55;white-space:nowrap}
      .lib-actions{display:flex;gap:6px;justify-content:flex-end}
      .lib-actions .btn{padding:5px 10px;font-size:11px}
      .lib-use{border:1px solid #cfe0ff!important;background:#f3f8ff!important;color:#2361d6!important}
      .lib-empty{padding:44px 20px 34px;text-align:center;color:#7b8494}
      .lib-empty .ic{width:42px;height:42px;margin:0 auto 10px;border-radius:12px;background:#fff6e2;color:#d99a20;display:flex;align-items:center;justify-content:center}
      .lib-empty .ic svg{width:20px;height:20px}
      .lib-empty b{display:block;font-size:13px;color:#3d4554;margin-bottom:5px}
      .lib-empty span{font-size:11.5px;line-height:1.6}
      .lib-empty button{margin-top:13px}
      .lib-foot{display:flex;align-items:center;gap:10px;padding:10px 20px;border-top:1px solid #edf0f4;font-size:10.5px;color:#8b93a1;background:#fcfdfe}
    </style>
    <div class="lib-head">
      <div class="lib-mark">${icon('star')}</div>
      <div><div class="lib-title" id="libTitle">${state.view === 'favorite' ? '常用接口' : '接口库'}</div><div class="lib-sub">收藏、分类、搜索；编辑好的接口可以直接复用到当前工程</div></div>
      <div class="acts"><button class="btn thin" id="libSave">＋ 存当前接口</button><button class="btn thin" id="libClose">关闭</button></div>
    </div>
    <div class="lib-toolbar">
      <div class="lib-search">${icon('search')}<input id="libQ" placeholder="搜索名称 / 分类 / 说明 / 来源"></div>
      <div class="lib-tabs">
        <button class="lib-tab" data-lib-view="favorite">常用</button>
        <button class="lib-tab" data-lib-view="all" data-lib-kind="all">全部</button>
        <button class="lib-tab" data-lib-view="user" data-lib-kind="user">我的</button>
        <button class="lib-tab" data-lib-view="builtin" data-lib-kind="builtin">内置</button>
      </div>
      <select id="libCat" class="lib-cat"><option value="all">全部分类</option></select>
      <span class="lib-stats" id="libStats"></span>
    </div>
    <div class="lib-list" id="libList"></div>
    <div class="lib-foot"><span>复用会完整复制表、字段、路由、脚本和文档；名称、表名、basePath 自动避重。</span><span id="libCount" style="margin-left:auto"></span></div>
  </div>`, (box) => {
    const listEl = box.querySelector('#libList');
    const qEl = box.querySelector('#libQ');
    const catEl = box.querySelector('#libCat');
    const statsEl = box.querySelector('#libStats');
    const countEl = box.querySelector('#libCount');
    const titleEl = box.querySelector('#libTitle');

    const cats = () => [...new Set(entries.map((x) => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const updateCats = () => {
      const cur = state.category;
      catEl.innerHTML = `<option value="all">全部分类</option>` + cats().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      catEl.value = cur !== 'all' && cats().includes(cur) ? cur : 'all';
      state.category = catEl.value;
    };

    const row = (x) => {
      const desc = [x.description, x.source && x.source !== x.name ? '来源：' + x.source : ''].filter(Boolean).join(' · ');
      return `<div class="lib-row ${x.favorite ? 'is-fav' : ''}" data-lib-row="${esc(x.id)}" data-kind="${esc(x.kind)}" data-name="${esc(x.name)}" data-source="${esc(x.source || '')}">
        <button class="lib-star ${x.favorite ? 'on' : ''}" data-lib-star="${esc(x.id)}" title="${x.favorite ? '取消常用' : '加入常用'}">${icon('star')}</button>
        <div class="lib-kind ${x.kind}">${x.kind === 'builtin' ? '内置' : '我的'}</div>
        <div style="min-width:0">
          <div class="lib-name-line"><span class="lib-name" title="${esc(x.name)}">${esc(x.name)}</span><span class="lib-cat-pill" title="${esc(x.category)}">${esc(x.category)}</span></div>
          <div class="lib-desc" title="${esc(desc)}">${esc(desc || '没有说明')}</div>
        </div>
        <div class="lib-meta">${x.counts.tables} 表 · ${x.counts.routes} 路由<br>复用 ${x.uses || 0} 次${x.lastUsedAt ? ' · ' + esc(new Date(x.lastUsedAt).toLocaleDateString('zh-CN')) : ''}</div>
        <div class="lib-actions">
          <button class="btn thin lib-use" data-lib-add="${esc(x.id)}">复用</button>
          <button class="btn thin" data-lib-edit="${esc(x.id)}">编辑</button>
          ${x.kind === 'user' ? `<button class="btn thin" data-lib-del="${esc(x.id)}">删除</button>` : ''}
        </div>
      </div>`;
    };

    const render = () => {
      updateCats();
      titleEl.textContent = state.view === 'favorite' ? '常用接口' : '接口库';
      const q = state.q.trim().toLowerCase();
      const shown = entries.filter((x) => {
        const byView = state.view === 'all' ? true : state.view === 'favorite' ? x.favorite : x.kind === state.view;
        const byCat = state.category === 'all' || x.category === state.category;
        const hay = [x.name, x.category, x.description, x.source].join(' ').toLowerCase();
        return byView && byCat && (!q || hay.includes(q));
      }).sort((a, b) => (Number(b.favorite) - Number(a.favorite)) || ((b.uses || 0) - (a.uses || 0)) || (a.kind === b.kind ? 0 : a.kind === 'user' ? -1 : 1));
      box.querySelectorAll('[data-lib-view]').forEach((b) => b.classList.toggle('on', b.dataset.libView === state.view));
      const fav = entries.filter((x) => x.favorite).length;
      const mine = entries.filter((x) => x.kind === 'user').length;
      statsEl.textContent = `${fav} 常用 · ${mine} 我的 · ${entries.length - mine} 内置`;
      countEl.textContent = `显示 ${shown.length} / ${entries.length}`;
      listEl.innerHTML = shown.length ? shown.map(row).join('') : `<div class="lib-empty">
        <div class="ic">${icon(state.view === 'favorite' ? 'star' : 'iface')}</div>
        <b>${state.view === 'favorite' ? '还没有常用接口' : '没有符合条件的接口'}</b>
        <span>${state.view === 'favorite' ? '给接口库里的条目点亮星标，或在接口编辑器里点「存为常用接口」，之后就能在这里一键复用。' : '换个关键词、分类或筛选条件再试试。'}</span>
        ${state.view === 'favorite' ? `<button class="btn thin" id="libEmptySave">存当前接口</button>` : ''}
      </div>`;
      const emptySave = listEl.querySelector('#libEmptySave');
      if (emptySave) emptySave.onclick = saveCurrent;
    };

    const saveCurrent = () => {
      if (!activeIface()) return toast('当前没有可保存的接口');
      closeModal();
      showSaveIface({ after: () => showIfaceLibrary({ view: 'favorite' }) });
    };

    const useEntry = async (id) => {
      const got = await api.ifaceLibraryInsert(S.project, id);
      if (!got.ok) return toast('复用失败：' + String(got.error || '').slice(0, 200), 6500);
      S.project = got.project;
      S.cat = got.category;
      S.selId = got.ifaceId;
      S.mode = 'editor'; S.tab = 'tables'; S.problems = [];
      await api.save(S.project);
      closeModal(); render();
      toast(`已复用「${got.name}」${got.renamed ? '（同名，已自动加序号）' : ''}${got.routesRenamed ? `（${got.routesRenamed} 条路由已避重）` : ''}`, 3200);
    };

    listEl.addEventListener('click', async (e) => {
      const star = e.target.closest('[data-lib-star]');
      if (star) {
        const x = entries.find((y) => y.id === star.dataset.libStar);
        if (!x) return;
        const d = await api.ifaceLibraryUpdate(x.id, { favorite: !x.favorite });
        if (!d.ok) return toast(d.error || '操作失败');
        Object.assign(x, d.entry);
        render();
        toast(x.favorite ? `已加入常用「${x.name}」` : `已取消常用「${x.name}」`);
        return;
      }
      const use = e.target.closest('[data-lib-add]');
      if (use) return useEntry(use.dataset.libAdd);
      const edit = e.target.closest('[data-lib-edit]');
      if (edit) {
        closeModal();
        return showIfaceLibraryEdit(edit.dataset.libEdit, state);
      }
      const del = e.target.closest('[data-lib-del]');
      if (del) {
        const x = entries.find((y) => y.id === del.dataset.libDel);
        closeModal();
        if (!(await confirmBox('删除常用接口', `确定删除「${x ? x.name : '这个接口'}」？只影响接口库，不影响当前工程。`))) {
          showIfaceLibrary(state);
          return;
        }
        const d = await api.ifaceLibraryRemove(del.dataset.libDel);
        if (!d.ok) return toast(d.error || '删除失败');
        showIfaceLibrary(state);
        toast('已从接口库删除');
      }
    });

    qEl.value = state.q;
    qEl.addEventListener('input', () => { state.q = qEl.value; render(); });
    catEl.addEventListener('change', () => { state.category = catEl.value; render(); });
    box.querySelectorAll('[data-lib-view]').forEach((b) => {
      b.onclick = () => { state.view = b.dataset.libView; render(); };
    });
    box.querySelector('#libClose').onclick = closeModal;
    box.querySelector('#libSave').onclick = saveCurrent;
    render();
  }, { width: 920, maxHeight: '86vh', plain: true });
  return root;
}

async function showIfaceLibraryEdit(id, back) {
  const r = await api.ifaceLibraryGet(id);
  if (!r.ok) { toast(r.error || '读取失败'); return showIfaceLibrary(back); }
  const e = r.entry || r;
  const builtin = e.kind === 'builtin';
  modal(`<div class="lib-save">
    <style>
      .lib-save{padding:20px 22px 18px;background:#fff;border-radius:12px;color:#2f3542}
      .lib-save h3{margin:0;font-size:15px;font-weight:600}
      .lib-save .sub{margin-top:4px;font-size:11.5px;color:#7b8494}
      .lib-save label{display:block;margin-top:14px;font-size:11.5px;color:#606a7b}
      .lib-save input[type=text],.lib-save textarea{width:100%;box-sizing:border-box;margin-top:5px;border:1px solid #dfe4ec;border-radius:8px;padding:8px 10px;font-size:12.5px;color:#2f3542;outline:none;background:#fff}
      .lib-save input[type=text]:focus,.lib-save textarea:focus{border-color:#4c8dff;box-shadow:0 0 0 3px rgba(76,141,255,.12)}
      .lib-save textarea{resize:vertical;min-height:64px;line-height:1.5}
      .lib-save .fav{display:flex;align-items:center;gap:8px;margin-top:14px;padding:10px 12px;border:1px solid #f1dfb4;background:#fffbf1;border-radius:8px;color:#6b5a2e;font-size:12px}
      .lib-save .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
    </style>
    <h3>编辑接口信息</h3>
    <div class="sub">${builtin ? '内置接口可以改分类、说明和收藏状态，接口内容保持不变。' : '修改名称、分类和说明，不会改变已复用到工程里的接口。'}</div>
    <label>接口名称<input id="editLibName" type="text" maxlength="40" value="${esc(e.name)}" ${builtin ? 'disabled style="background:#f5f6f8;color:#8b93a1"' : ''}></label>
    <label>分类<input id="editLibCat" type="text" maxlength="20" value="${esc(e.category)}"></label>
    <label>说明<textarea id="editLibDesc" maxlength="200">${esc(e.description || '')}</textarea></label>
    <label class="fav"><input id="editLibFav" type="checkbox" ${e.favorite ? 'checked' : ''}>加入常用（收藏）</label>
    <div class="acts"><button class="btn thin" id="editLibNo">取消</button><button class="btn solid" id="editLibYes">保存</button></div>
  </div>`, (root) => {
    const name = root.querySelector('#editLibName');
    const cat = root.querySelector('#editLibCat');
    const desc = root.querySelector('#editLibDesc');
    const fav = root.querySelector('#editLibFav');
    const cancel = () => { closeModal(); showIfaceLibrary(back); };
    const save = async () => {
      const patch = {
        category: cat.value.trim(),
        description: desc.value.trim(),
        favorite: fav.checked,
      };
      if (!builtin) patch.name = name.value.trim();
      const d = await api.ifaceLibraryUpdate(e.id, patch);
      if (!d.ok) return toast('保存失败：' + String(d.error || '').slice(0, 180), 5500);
      closeModal();
      showIfaceLibrary(back);
      toast('接口信息已更新');
    };
    root.querySelector('#editLibNo').onclick = cancel;
    root.querySelector('#editLibYes').onclick = save;
    name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); });
  }, { width: 540, maxHeight: '90vh', plain: true });
}

/* ---------------- 插件 / Defender ---------------- */
async function showPlugins() {
  const r = await api.pluginSummary();
  if (!r.ok) return toast('读取插件失败');
  const tpls = (await api.pluginTemplates()).list || [];
  const list = r.list || [];
  const cmds = r.commands || [];
  const enabled = list.filter((p) => p.enabled).length;
  const cmdButtons = cmds.map((c) => `<button class="btn thin" data-pl-run="${esc(c.id)}" title="${esc(c.description || c.pluginName)}">${esc(c.title)}<span class="text-neutral-500 ml-1">· ${esc(c.pluginName)}</span></button>`).join('') || '<span class="text-[11px] text-neutral-500">启用的插件还没注册命令。可以点「新建插件」生成一个带命令的脚手架。</span>';
  const hookNames = [...new Set((r.hooks || []).map((h) => (typeof h === 'string' ? h : h.name)))];
  modal(`<div class="p-4">
    <div class="flex items-center gap-2 mb-3"><b class="text-[13px]">插件</b>
      <span class="pill">${list.length} 个 · ${enabled} 启用</span>
      <span class="pill">命令 ${cmds.length}</span>
      <span class="pill">模版 ${tpls.length}</span>
      <span class="text-[11px] text-neutral-500 mono">API v${esc(r.apiVersion || '')}</span>
      <button class="btn thin ml-auto" id="plReload">重新加载</button>
      <button class="btn thin" id="plScaffold">新建插件</button>
      <button class="btn thin" id="plInstall">安装插件</button>
      <button class="btn thin" id="plClose">关闭</button></div>
    <div class="border border-neutral-300 max-h-[36vh] overflow-auto">
      ${list.map((p) => `<div class="flex items-center gap-3 p-2 border-b border-neutral-200">
        <label class="flex items-center gap-2"><input type="checkbox" data-pl="${esc(p.id)}" ${p.enabled ? 'checked' : ''}>
          <b>${esc(p.name)}</b></label>
        <span class="pill">${esc(p.id)}</span><span class="text-[11px] text-neutral-500 mono">v${esc(p.version || '')}</span>
        <span class="text-[11px] text-neutral-500">${p.source === 'builtin' ? '内置' : '我的'}</span>
        <div class="text-[12px] text-neutral-600 flex-1 truncate" title="${esc(p.description)}">${esc(p.description)}</div>
        ${(p.commands || []).length ? `<span class="pill">${p.commands.length} 命令</span>` : ''}
        ${(p.hooks || []).length ? `<span class="pill">${p.hooks.length} 钩子</span>` : ''}
        ${p.errors && p.errors.length ? `<span class="pill" title="${esc(p.errors.join('\n'))}">${p.errors.length} 错误</span>` : ''}
        ${p.source === 'user' ? `<button class="btn thin" data-pl-del="${esc(p.id)}">卸载</button>` : ''}
      </div>`).join('') || '<div class="p-4 text-neutral-500">还没有插件。点“安装插件”选一个带 plugin.json 的文件夹，或“新建插件”生成脚手架。</div>'}
    </div>

    <div class="help-h">插件命令</div>
    <div class="flex flex-wrap gap-2">${cmdButtons}</div>

    <div class="help-h">插件模版</div>
    <div class="flex flex-wrap gap-2">${tpls.map((t) => `<button class="btn thin" data-pl-tpl="${esc(t.id)}">${esc(t.name)}<span class="text-neutral-500 ml-1">· ${esc(t.pluginId || '插件')}</span></button>`).join('') || '<span class="text-[11px] text-neutral-500">还没有插件注册模版。</span>'}</div>

    <div class="help-h">生命周期钩子</div>
    <div class="text-[11px] text-neutral-600 mono leading-6">${hookNames.map(esc).join(' · ')}</div>
    <div class="text-[11px] text-neutral-500 mt-1">插件可以监听保存、生成、导出、服务启停和工程打开；返回 { project } 改工程，返回 false 取消动作。</div>

    <div class="flex items-center gap-2 mt-3">
      <button class="btn thin" id="plLogs">查看日志</button>
      <button class="btn thin" id="plDocs">开发者文档</button>
      <button class="btn thin" id="plTrust">加入 Defender 信任目录</button>
    </div>
    <div class="text-[11px] text-neutral-500 mt-2">插件在主进程的独立 vm 上下文里执行，默认没有 require / process / 文件系统；权限按 manifest 授予。只安装你信任的插件。</div>
    <div class="mono text-[11px] text-neutral-600 mt-2 flex gap-3">
      <button class="btn thin" id="plOpenRepo">打开内置插件目录</button>
      <button class="btn thin" id="plOpenUser">打开我的插件目录</button>
    </div>
    <pre id="plOut" class="monoarea text-[11px] border border-neutral-300 p-2 mt-2 max-h-24 overflow-auto whitespace-pre-wrap hidden"></pre>
  </div>`, (root) => {
    const out = root.querySelector('#plOut');
    const refreshRibbon = async () => { try { S.pluginInfo = await api.pluginSummary(); renderRibbon(); } catch (_) {} };
    root.querySelector('#plClose').onclick = closeModal;
    root.querySelector('#plReload').onclick = async () => {
      const d = await api.pluginReload();
      if (!d.ok) return toast('重载失败');
      await refreshRibbon();
      closeModal(); showPlugins();
      toast(`已重新加载 ${d.list.length} 个插件`);
    };
    root.querySelectorAll('[data-pl]').forEach((cb) => {
      cb.onchange = async () => {
        const d = await api.pluginEnable(cb.dataset.pl, cb.checked);
        if (!d.ok) toast(d.error || '切换失败');
        else toast(`${cb.checked ? '已启用' : '已禁用'} ${cb.dataset.pl}`);
        await refreshRibbon();
      };
    });
    root.querySelectorAll('[data-pl-run]').forEach((b) => {
      b.onclick = async () => { closeModal(); await runPluginCommand(b.dataset.plRun); };
    });
    root.querySelectorAll('[data-pl-tpl]').forEach((b) => {
      b.onclick = async () => {
        const got = await api.pluginTemplateGet(b.dataset.plTpl);
        if (!got.ok) return toast('读取插件模版失败：' + (got.error || ''));
        const ok = await activateFreshProject(got.project, (p) => `已从插件模版「${got.name}」新建「${p.name}」`);
        if (ok) closeModal();
      };
    });
    root.querySelectorAll('[data-pl-del]').forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmBox('卸载插件', '会删除这个插件目录，确定？'))) return;
        const d = await api.pluginUninstall(b.dataset.plDel);
        if (!d.ok) return toast(d.error || '卸载失败');
        closeModal(); showPlugins();
      };
    });
    root.querySelector('#plInstall').onclick = async () => {
      const d = await api.pluginInstall();
      if (!d) return;
      if (!d.ok) return toast(d.error || '安装失败', 5000);
      await refreshRibbon();
      closeModal(); showPlugins(); toast('已安装 ' + d.id);
    };
    root.querySelector('#plScaffold').onclick = async () => {
      const name = await ask('新建插件', 'hello-plugin', '生成带 plugin.json、命令、钩子和 README 的脚手架，放在“我的插件目录”');
      if (!name) return;
      const d = await api.pluginScaffold(name);
      if (!d.ok) return toast(d.error || '创建失败', 6000);
      await refreshRibbon();
      closeModal(); showPlugins(); toast('已创建 ' + d.id);
    };
    root.querySelector('#plLogs').onclick = async () => {
      const d = await api.pluginLogs();
      out.classList.remove('hidden');
      out.textContent = (d.logs || []).slice(-120).join('\n') || '还没有插件日志。';
    };
    root.querySelector('#plDocs').onclick = async () => {
      const d = await api.pluginDocs();
      if (!d.ok) return toast('读取开发者文档失败');
      modal(`<div class="p-5 max-w-[760px] max-h-[82vh] overflow-auto">
        <div class="flex items-center gap-2 mb-3"><b class="text-[13px]">插件 API v${esc(d.apiVersion || '')}</b><button class="btn thin ml-auto" id="plDocsClose">关闭</button></div>
        <div class="text-[12px] text-neutral-600 mb-3">manifest 至少要 id / name / version / main；权限和 contributes.commands 可选。旧的 apply(project, api) 仍然兼容。</div>
        <pre class="monoarea text-[11px] border border-neutral-300 p-3 whitespace-pre-wrap">${esc(JSON.stringify(d.manifest, null, 2))}</pre>
        <div class="help-h">API</div>
        <div class="text-[12px] leading-6">${(d.api || []).map((a) => `<div><span class="mono">${esc(a.name)}</span> — ${esc(a.desc)}</div>`).join('')}</div>
        <div class="help-h">钩子</div>
        <div class="text-[11px] mono leading-6">${(d.hooks || []).map((h) => typeof h === 'string' ? h : h.name).join(' · ')}</div>
        <div class="help-h">权限</div>
        <div class="text-[11px] mono leading-6">${(d.permissions || []).map((p) => typeof p === 'string' ? p : p.name).join(' · ')}</div>
        <div class="help-h">示例</div>
        <pre class="monoarea text-[11px] border border-neutral-300 p-3 whitespace-pre-wrap">${esc(d.example || '')}</pre>
      </div>`, (rr) => { rr.querySelector('#plDocsClose').onclick = closeModal; });
    };
    root.querySelector('#plTrust').onclick = async () => {
      root.querySelector('#plTrust').disabled = true;
      out.classList.remove('hidden');
      out.textContent = '正在写入排除项（可能需要管理员权限）…';
      const d = await api.defenderTrust([]);
      out.textContent = d.ok
        ? `已信任。\n现有排除目录：${(d.paths || []).join('\n') || '（读不到，刷新一下）'}`
        : '失败：' + (d.error || '未知错误');
      root.querySelector('#plTrust').disabled = false;
    };
    root.querySelector('#plOpenRepo').onclick = () => api.pluginOpenDir('repo');
    root.querySelector('#plOpenUser').onclick = () => api.pluginOpenDir('user');
  });
}

/* ---------------- 底部控制台（IDEA 风格，多标签） ---------------- */
const CONSOLE_SOURCES = {
  server: { label: '生成服务', empty: '还没有输出。点击“启动”后，服务 stdout / stderr 会实时显示在这里。' },
  mysql: { label: 'MariaDB', empty: 'MariaDB 还没有输出。' },
  redis: { label: 'Redis', empty: 'Redis 还没有输出。' },
  s3: { label: 'RustFS', empty: 'RustFS 还没有输出。' },
};
const consoleState = { tabs: [], active: '', follow: true, filter: '', timer: null, busy: false, seed: 0 };

function consoleTabOf(id) { return consoleState.tabs.find((t) => t.id === id); }
function consoleActiveTab() { return consoleTabOf(consoleState.active); }

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

function appendConsoleText(tab, raw) {
  const text = stripAnsi(raw);
  if (text === tab.prev) return;
  let add = '';
  if (!tab.prev) add = text;
  else if (text.startsWith(tab.prev)) add = text.slice(tab.prev.length);
  else {
    let overlap = 0;
    const max = Math.min(tab.prev.length, text.length);
    for (let n = max; n > 0; n--) {
      if (tab.prev.slice(-n) === text.slice(0, n)) { overlap = n; break; }
    }
    add = (overlap ? '' : '[日志已滚动，下面是最新一段]\n') + text.slice(overlap);
  }
  tab.prev = text;
  if (add) tab.text = (tab.text + add).slice(-200000);
}

function consoleLineCount(text) { return text ? text.split('\n').length : 0; }

function renderConsoleHead() {
  const head = $('#consoleHead');
  if (!head) return;
  head.innerHTML = consoleState.tabs.map((t) => {
    const on = t.id === consoleState.active;
    return `<div class="console-tab flex items-center gap-1 px-3 border-r border-neutral-300 cursor-pointer ${on ? 'bg-white font-semibold border-b-2 border-b-neutral-900' : 'text-neutral-600 hover:bg-neutral-50'}" data-ctab="${t.id}">
      <span class="inline-block w-1.5 h-1.5 rounded-full ${t.text ? 'bg-neutral-900' : 'bg-neutral-300'}"></span>
      <span>${esc(t.label)}</span>
      <span class="text-neutral-400">${consoleLineCount(t.text)}</span>
      <button class="ml-1 text-neutral-400 hover:text-neutral-900" data-ctab-close="${t.id}" title="关闭这个控制台">×</button>
    </div>`;
  }).join('') + `<button id="consolePlus" class="px-2 text-neutral-600 hover:bg-neutral-200" title="新建控制台">＋</button>
    <span class="ml-auto pr-2 text-[10px] text-neutral-500 self-center">${consoleState.tabs.length} 个控制台 · 每秒刷新</span>`;
  head.querySelectorAll('[data-ctab]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('[data-ctab-close]')) return;
      consoleState.active = el.dataset.ctab;
      renderConsoleHead();
      renderConsoleBody();
      pollConsole();
    };
  });
  head.querySelectorAll('[data-ctab-close]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      closeConsoleTab(el.dataset.ctabClose);
    };
  });
  const plus = $('#consolePlus');
  if (plus) plus.onclick = showConsoleSourcePicker;
}

function renderConsoleBody() {
  const body = $('#consoleBody');
  const meta = $('#consoleMeta');
  if (!body) return;
  const tab = consoleActiveTab();
  if (!tab) { body.textContent = ''; meta.textContent = ''; return; }
  const q = consoleState.filter.trim().toLowerCase();
  let text = tab.text;
  if (q) {
    const lines = text.split('\n');
    text = lines.filter((l) => l.toLowerCase().includes(q)).join('\n');
    if (!text) text = `（没有包含“${consoleState.filter.trim()}”的行）`;
  }
  if (!text) text = CONSOLE_SOURCES[tab.source].empty;
  body.textContent = text;
  meta.textContent = `${consoleLineCount(tab.text)} 行 · ${tab.source === 'server' ? (serverRunning() ? '运行中' : '未启动') : '服务日志'}`;
  if (consoleState.follow) body.scrollTop = body.scrollHeight;
}

function serverRunning() {
  const s = ((S.services && S.services.items) || []).find((x) => x.id === 'server');
  return !!(s && s.running);
}

async function pollConsole() {
  const tab = consoleActiveTab();
  if (!tab || consoleState.busy || $('#consoleDock').classList.contains('hidden')) return;
  consoleState.busy = true;
  try {
    const raw = await api.logs(tab.source);
    appendConsoleText(tab, raw || '');
    renderConsoleBody();
    renderConsoleHead();
  } catch (e) {
    appendConsoleText(tab, `[读取 ${tab.label} 日志失败] ${e.message}\n`);
  } finally { consoleState.busy = false; }
}

function addConsoleTab(source) {
  const meta = CONSOLE_SOURCES[source];
  if (!meta) return null;
  const exist = consoleState.tabs.find((t) => t.source === source);
  if (exist) { consoleState.active = exist.id; return exist; }
  consoleState.seed += 1;
  const tab = { id: `${source}-${consoleState.seed}`, source, label: meta.label, text: '', prev: '' };
  consoleState.tabs.push(tab);
  consoleState.active = tab.id;
  return tab;
}

function openConsoleDock(source) {
  const dock = $('#consoleDock');
  if (!dock) return;
  addConsoleTab(source || 'server');
  dock.classList.remove('hidden');
  dock.classList.add('flex');
  renderConsoleHead();
  renderConsoleBody();
  pollConsole();
  if (!consoleState.timer) consoleState.timer = setInterval(pollConsole, 1000);
}

function closeConsoleTab(id) {
  const idx = consoleState.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  consoleState.tabs.splice(idx, 1);
  if (consoleState.active === id) consoleState.active = consoleState.tabs[Math.max(0, idx - 1)] ? consoleState.tabs[Math.max(0, idx - 1)].id : '';
  if (!consoleState.tabs.length) { closeConsoleDock(); return; }
  renderConsoleHead(); renderConsoleBody(); pollConsole();
}

function closeConsoleDock() {
  const dock = $('#consoleDock');
  dock.classList.add('hidden');
  dock.classList.remove('flex');
  if (consoleState.timer) { clearInterval(consoleState.timer); consoleState.timer = null; }
}

function showConsoleSourcePicker() {
  const options = Object.entries(CONSOLE_SOURCES).map(([id, s]) => `<button class="btn thin" data-csource="${id}">${esc(s.label)}</button>`).join('');
  modal(`<div class="p-4 text-[12px]">
    <div class="font-semibold mb-1">新建控制台</div>
    <div class="text-neutral-500 mb-3">每类服务一个独立输出标签；可以同时开生成服务、MariaDB、Redis、RustFS。</div>
    <div class="flex gap-2 flex-wrap">${options}</div>
    <div class="flex justify-end mt-4"><button class="btn thin" id="csCancel">取消</button></div>
  </div>`, (root) => {
    root.querySelector('#csCancel').onclick = closeModal;
    root.querySelectorAll('[data-csource]').forEach((b) => {
      b.onclick = () => { openConsoleDock(b.dataset.csource); closeModal(); };
    });
  }, { width: 460 });
}

function bindConsoleDock() {
  const close = $('#consoleClose');
  if (close) close.onclick = closeConsoleDock;
  const clear = $('#consoleClear');
  if (clear) clear.onclick = () => {
    const tab = consoleActiveTab();
    if (!tab) return;
    tab.text = '';
    renderConsoleHead(); renderConsoleBody();
    pollConsole();
  };
  const copy = $('#consoleCopy');
  if (copy) copy.onclick = async () => {
    const tab = consoleActiveTab();
    if (!tab) return;
    try { await navigator.clipboard.writeText(tab.text); toast('当前控制台内容已复制'); }
    catch (e) { toast('复制失败：' + e.message); }
  };
  const filter = $('#consoleFilter');
  if (filter) filter.oninput = () => { consoleState.filter = filter.value; renderConsoleBody(); };
  const follow = $('#consoleFollow');
  if (follow) follow.onchange = () => { consoleState.follow = follow.checked; renderConsoleBody(); };
  const resize = $('#consoleResize');
  if (resize) {
    resize.onmousedown = (e) => {
      e.preventDefault();
      const dock = $('#consoleDock');
      const startY = e.clientY;
      const startH = dock.getBoundingClientRect().height;
      const move = (ev) => {
        const h = Math.max(120, Math.min(window.innerHeight * 0.7, startH + (startY - ev.clientY)));
        dock.style.height = h + 'px';
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
  }
}

function showLogs() {
  openConsoleDock('server');
}

function newRoute(it, kind) {
  const t = it.tables[0] || { name: 'table' };
  const meta = {
    list: ['列表', 'GET', '/' + t.name],
    detail: ['详情', 'GET', '/' + t.name + '/:id'],
    create: ['新建', 'POST', '/' + t.name],
    update: ['更新', 'PUT', '/' + t.name + '/:id'],
    delete: ['删除', 'DELETE', '/' + t.name + '/:id'],
    upload: ['附件', 'POST', '/' + t.name + '/:id/file'],
    proxy: ['上游转发', 'POST', '/proxy-' + (it.routes.length + 1)],
    objects: ['对象表', 'GET', '/objects'],
    crawl: ['抓取', 'GET', '/crawl'],
    custom: ['自定义', 'POST', '/custom-' + (it.routes.length + 1)],
  }[kind] || ['自定义', 'POST', '/custom'];
  const scripts = {
    list: 'LET $rows = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} ORDER BY {{orderBy:main}} LIMIT {{limit}} OFFSET {{offset}};\nLET $total = QUERY SELECT COUNT(*) AS total FROM {{t:main}} WHERE {{where:main}};\nRETURN 200 { "rows": $rows.rows, "total": $total.rows[0].total };',
    detail: 'LET $row = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{idColumn:main}} = {{id}} LIMIT 1;\nRETURN 200 { "row": $row.rows[0] };',
    create: 'LET $ins = EXEC INSERT INTO {{t:main}} ({{insertColumns:main}}) VALUES ({{insertValues:main}});\nRETURN 201 { "id": $ins.insertId };',
    update: 'LET $upd = EXEC UPDATE {{t:main}} SET {{updateSet:main}} WHERE {{idColumn:main}} = {{id}};\nRETURN 200 { "changed": $upd.affectedRows };',
    delete: 'LET $del = EXEC DELETE FROM {{t:main}} WHERE {{idColumn:main}} = {{id}};\nRETURN 200 { "deleted": $del.affectedRows };',
    upload: 'EXEC UPDATE {{t:main}} SET {{bindColumn:main}} = {{objectKey}} WHERE {{idColumn:main}} = {{id}};\nRETURN 200 { "key": {{objectKey}}, "url": {{objectUrl}} };',
    proxy: '# 上游转发由服务器直接代理，不走脚本。请在“上游”页配置 baseUrl 与本路由目标。',
    objects: '# 对象表由服务器直接列桶内对象。',
    crawl: 'LET $page = CRAWL \'https://example.com\' { "maxBytes": 1048576 };\nRETURN 200 { "title": $page.title, "text": $page.text, "links": $page.links };',
    custom: '# 自定义脚本\nLET $rows = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} LIMIT {{limit}};\nRETURN 200 { "rows": $rows.rows };',
  };
  const ioKind = {
    upload: ['file', 'file', 's3', 'any', 20, 'file_key', true],
    objects: ['object', 'object', 's3', 'any', 0, '', false],
    proxy: ['proxy', 'proxy', 'none', 'any', 0, '', false],
    crawl: ['crawl', 'crawl', 'none', 'any', 0, '', false],
  }[kind] || ['json', 'json', 'none', 'any', 20, '', false];
  return {
    id: Math.random().toString(16).slice(2, 10),
    key: kind, name: meta[0], method: meta[1], path: meta[2], auth: false,
    roles: [],
    proxy: { enabled: kind === 'proxy', upstream: '', target: '', stripPrefix: true, forwardHeaders: true, timeout: 15000 },
    script: scripts[kind] || scripts.custom,
    io: {
      typeId: ioKind[0], response: ioKind[1], storage: ioKind[2], fileKind: ioKind[3],
      maxMb: ioKind[4], tableKey: 'main', field: ioKind[5], autoBind: ioKind[6],
      cookieName: '', ttl: 0, cookiePath: '/', httpOnly: true, sameSite: 'Lax', prefix: '', bucket: '',
    },
    docs: { summary: meta[0], description: '', requestExample: '', responseExample: '' },
    cache: { enabled: kind === 'list' || kind === 'detail', key: 'icb:{{t:main}}:{{queryHash}}:{{page}}:{{pageSize}}', ttl: 60 },
  };
}

function defaultFields() {
  return [
    { name: 'id', type: 'bigint', comment: '主键', pk: true, autoIncrement: true, nullable: false, search: false, hidden: false, query: false, writable: false, default: '' },
    { name: 'created_at', type: 'datetime', comment: '创建时间', pk: false, autoIncrement: false, nullable: true, search: false, hidden: false, query: true, writable: false, default: 'CURRENT_TIMESTAMP' },
  ];
}

document.addEventListener('click', (e) => {
  if (!$('#resPop') || $('#resPop').classList.contains('hidden')) return;
  if (e.target.closest('#resPop') || e.target.closest('#resStats')) return;
  toggleResPop(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#resPop') && !$('#resPop').classList.contains('hidden')) toggleResPop(false);
});

/* ---------------- 事件绑定 ---------------- */
document.addEventListener('click', (e) => {
  const pl = e.target.closest('[data-plugin-run]');
  if (pl) {
    e.preventDefault();
    return runPluginCommand(pl.dataset.pluginRun).catch((err) => toast(String(err && err.message || err), 5000));
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();
  act(el.dataset.action, el).catch((err) => toast(String(err && err.message || err), 5000));
});

$('#search').addEventListener('input', () => { searchActive = -1; renderSearch(); });
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#searchPanel').classList.add('hidden'); searchActive = -1; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!searchRows.length) return;
    const max = Math.min(SEARCH_LIMIT, searchRows.length) - 1;
    searchActive = e.key === 'ArrowDown' ? Math.min(max, searchActive + 1) : Math.max(0, searchActive - 1);
    renderSearch();
    return;
  }
  if (e.key === 'Enter') {
    const target = searchActive >= 0 ? $(`#searchPanel [data-res="${searchActive}"]`) : $('#searchPanel [data-res]');
    if (target) target.click();
  }
});
bindConsoleDock();
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
  const modalOpen = !$('#modal').classList.contains('hidden');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
  if ((e.altKey && e.key === 'F12') || (mod && e.key === '`')) {
    e.preventDefault();
    if ($('#consoleDock').classList.contains('hidden')) openConsoleDock('server');
    else closeConsoleDock();
    return;
  }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (mod && e.key === 'Tab') {
    e.preventDefault();
    if (TABS.items.length < 2) return;
    const i = TABS.items.findIndex((x) => x.name === TABS.active);
    const next = TABS.items[(i + (e.shiftKey ? -1 : 1) + TABS.items.length) % TABS.items.length];
    if (next) switchTab(next.name);
    return;
  }
  if (mod && !typing && !modalOpen && e.key.toLowerCase() === 't') { e.preventDefault(); newTaskFlow(); return; }
  if (mod && !typing && !modalOpen && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (e.shiftKey) act('addCat'); else act('newIface');
    return;
  }
  if (mod && !typing && !modalOpen && e.key === 'Enter') { e.preventDefault(); act('generate'); return; }
  if (!typing && !modalOpen && e.key === 'F2' && S.selId) {
    e.preventDefault();
    const it = activeIface();
    if (it) ask('接口名', it.name).then((n) => { if (n) { it.name = n; scheduleSave(); render(); } });
    return;
  }
  if (!typing && !modalOpen && S.mode === 'grid' && S.selId && e.key === 'Delete') {
    e.preventDefault(); act('delIface'); return;
  }
  if (e.key === 'Escape') {
    if (modalOpen) { closeModal(); return; }
    const sp = $('#searchPanel');
    if (sp && !sp.classList.contains('hidden')) { sp.classList.add('hidden'); return; }
    if (!$('#ctxmenu').classList.contains('hidden')) { closeCtx(); return; }
    if (S.mode === 'editor' && !typing) { S.mode = 'grid'; render(); }
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search') && !e.target.closest('#searchPanel')) $('#searchPanel').classList.add('hidden');
});
$('#projectName').addEventListener('input', (e) => { S.project.name = e.target.value; scheduleSave(); });
$('#taskKind').addEventListener('change', (e) => {
  changeTaskKind(e.target.value).catch((err) => {
    $('#taskKind').value = taskKindOf(S.project);
    toast(String(err && err.message || err), 5000);
  });
});
$('#taskTabNew').onclick = () => newTaskFlow().catch((err) => toast(String(err && err.message || err), 5000));
$('#taskTabs').addEventListener('click', (e) => {
  const x = e.target.closest('[data-tab-close]');
  if (x) { e.preventDefault(); e.stopPropagation(); return closeTab(x.dataset.tabClose); }
  const tab = e.target.closest('.task-tab');
  if (tab) switchTab(tab.dataset.tabName);
});
$('#taskTabs').addEventListener('mousedown', (e) => {
  if (e.button !== 1) return;
  const tab = e.target.closest('.task-tab');
  if (tab) { e.preventDefault(); closeTab(tab.dataset.tabName); }
});
$('#taskTabs').addEventListener('contextmenu', (e) => {
  const tab = e.target.closest('.task-tab');
  if (!tab) return;
  e.preventDefault();
  e.stopPropagation();
  tabCtxMenu(tab.dataset.tabName, e.clientX, e.clientY);
});

/* ---------------- 主题 ---------------- */
function themeDefaults() {
  return { v: 2, head: '#ffffff', headText: '#20242b', accent: '#2f6bdc', footer: '#ffffff', font: '' };
}
function isLegacyDefaultTheme(t) {
  return !(t && t.v)
    && (!t || !t.accent || t.accent === '#111111')
    && (!t || !t.headText || t.headText === '#111111')
    && (!t || !t.footer || t.footer === '#f4f4f4');
}
function applyTheme(t) {
  const th = { ...themeDefaults(), ...(t || {}) };
  // 旧版的“黑白纸张”默认主题自动迁移到 WPS 式浅色默认主题；用户自定义主题保留。
  if (isLegacyDefaultTheme(t)) Object.assign(th, themeDefaults());
  const root = document.documentElement.style;
  root.setProperty('--cb-head', th.head || '#ffffff');
  root.setProperty('--cb-headtext', th.headText || '#20242b');
  root.setProperty('--cb-accent', th.accent || '#2f6bdc');
  root.setProperty('--cb-footer', th.footer || '#ffffff');
  root.setProperty('--cb-font', th.font || '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif');
  if (th.titleSuffix) document.title = `ClickBuildServer · ${th.titleSuffix}`;
}

/* ---------------- 设置 ---------------- */
function aiDefaults() {
  const savedAi = (S.settings && S.settings.ai) || {};
  return {
    provider: savedAi.provider || 'ollama',
    endpoint: savedAi.endpoint || (savedAi.provider === 'openai' ? 'https://api.openai.com/v1' : 'http://127.0.0.1:11434'),
    model: savedAi.model || '',
    apiKey: savedAi.apiKey || '',
    timeout: Number(savedAi.timeout || 180000),
    temperature: savedAi.temperature == null ? 0.2 : Number(savedAi.temperature),
    maxTokens: Number(savedAi.maxTokens || 4096),
    fallbackMock: !!savedAi.fallbackMock,
  };
}

function parseDelimited(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const first = clean.split('\n')[0] || '';
  const delim = first.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
function guessColumnType(values) {
  const sample = values.map((v) => String(v == null ? '' : v).trim()).filter(Boolean).slice(0, 12);
  if (!sample.length) return 'varchar';
  if (sample.every((v) => /^-?\d+$/.test(v))) return 'bigint';
  if (sample.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return 'decimal';
  if (sample.every((v) => /^(true|false|0|1)$/i.test(v))) return 'bool';
  if (sample.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
  if (sample.every((v) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v))) return 'datetime';
  if (sample.every((v) => /^[\[{]/.test(v))) return 'json';
  return 'varchar';
}
function fieldNameFromHeader(h, i) {
  const s = String(h || '').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) return `field_${i + 1}`;
  return /^[0-9]/.test(s) ? `f_${s}` : s;
}

const STORE_MODES = [  { id: 'mysql', name: '直连 MySQL', desc: '每次都读库，最稳，适合账务和必须实时的数据' },
  { id: 'cache', name: 'MySQL + Redis 查询缓存', desc: '读走 Redis 缓存，写后失效，适合读多写少' },
  { id: 'redis', name: 'Redis 表（读写都走 Redis）', desc: '表数据只存 Redis，增删改查不再写 MySQL；支持 TTL，重启从 Redis 恢复' },
  { id: 'redis-mysql', name: 'Redis 热读 + MySQL 权威', desc: '热读 Redis，MySQL 保底，适合排行榜与高频详情' },
  { id: 'lru', name: 'LRU 内存表', desc: '表数据只在进程内存，超过上限淘汰最旧行；重启清空' },
  { id: 'lru-redis', name: 'LRU 内存表 + Redis 持久', desc: '读写内存表，每次写入同步 Redis；重启恢复，适合单机热表' },
  { id: 'periodic', name: '内存表 + 定期写 Redis', desc: '读写内存表，按刷盘间隔批量写 Redis；重启恢复最后一次落盘' },
];
function storeOf(t) {
  const s = (t && t.store) || {};
  return { mode: STORE_MODES.some((x) => x.id === s.mode) ? s.mode : 'mysql', ttl: Number(s.ttl || 0), max: Number(s.max || 10000), flushMs: Number(s.flushMs || 5000) };
}
function storeLabel(id) {
  const m = STORE_MODES.find((x) => x.id === id);
  return m ? m.name : '直连 MySQL';
}

const AI_PRESETS = {
  ollama: { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', label: 'Ollama 本机' },
  openai: { provider: 'openai', endpoint: 'https://api.openai.com/v1', label: 'OpenAI' },
  deepseek: { provider: 'openai', endpoint: 'https://api.deepseek.com/v1', label: 'DeepSeek' },
  moonshot: { provider: 'openai', endpoint: 'https://api.moonshot.cn/v1', label: 'Moonshot / Kimi' },
  zhipu: { provider: 'openai', endpoint: 'https://open.bigmodel.cn/api/paas/v4', label: '智谱 BigModel' },
  siliconflow: { provider: 'openai', endpoint: 'https://api.siliconflow.cn/v1', label: 'SiliconFlow' },
  custom: null,
};

function showLanguagePicker() {
  const list = (window.__i18n && window.__i18n.locales) || [];
  const cur = (window.__i18n && window.__i18n.locale) || 'zh-CN';
  const cards = (items) => items.map((x) => `
    <button type="button" class="lang-card${x.id === cur ? ' on' : ''}" data-locale="${esc(x.id)}"
      title="${esc(x.english)}"
      style="display:flex;align-items:center;gap:10px;padding:10px 11px;border:1px solid ${x.id === cur ? '#20242b' : '#d9d9d9'};background:${x.id === cur ? '#f4f6fa' : '#fff'};border-radius:8px;text-align:left;cursor:pointer">
      <span style="flex:none;width:34px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;background:${x.id === cur ? '#20242b' : '#eef1f5'};color:${x.id === cur ? '#fff' : '#5f6875'};font:600 11px/1 var(--cb-font)">${esc(x.short || x.id)}</span>
      <span style="min-width:0;flex:1">
        <b style="display:block;font:600 12px/1.3 var(--cb-font);color:#20242b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.label)}</b>
        <span style="display:block;margin-top:2px;font:10px/1.3 var(--cb-font);color:#7b8492;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.english)} · ${esc(x.id)}</span>
      </span>
      ${x.id === cur ? '<span style="flex:none;font:10px/1 var(--cb-font);color:#20242b">当前</span>' : ''}
    </button>`).join('');
  modal(`<div class="p-4 w-[720px] max-w-[94vw] max-h-[88vh] flex flex-col">
    <div class="flex items-start gap-3">
      <div class="flex-1">
        <div class="text-[13px] font-semibold">界面语言与地区</div>
        <div class="text-[11px] text-neutral-500 mt-1">语言包由 Index-Translate 预先翻译；切换后立即重载，不改动工程数据。</div>
      </div>
      <button class="btn thin" id="langClose">关闭</button>
    </div>
    <div class="mt-3 relative">
      <input id="langSearch" class="w-full border border-neutral-300 px-2 py-2 text-[12px]" placeholder="搜索语言 / 地区 / 代码" autocomplete="off">
    </div>
    <div id="langGrid" class="grid grid-cols-2 gap-2 mt-3 overflow-auto pr-1" style="min-height:220px;max-height:56vh">${cards(list)}</div>
    <div class="mt-3 flex items-center gap-2 text-[10px] text-neutral-500">
      <span id="langCount">${list.length} 种界面语言</span>
      <span>·</span>
      <span>安装器会按安装时选择的语言写入首次启动语言</span>
    </div>
  </div>`, (root) => {
    const input = root.querySelector('#langSearch');
    const grid = root.querySelector('#langGrid');
    const count = root.querySelector('#langCount');
    const filter = () => {
      const q = String(input.value || '').trim().toLowerCase();
      const hits = q ? list.filter((x) => `${x.label} ${x.english} ${x.id} ${x.short || ''}`.toLowerCase().includes(q)) : list;
      grid.innerHTML = cards(hits) || '<div class="text-[11px] text-neutral-500 p-3">没有匹配的语言</div>';
      count.textContent = `${hits.length} / ${list.length} 种界面语言`;
      grid.querySelectorAll('[data-locale]').forEach((b) => {
        b.onclick = () => chooseLanguage(b.dataset.locale, b);
      });
    };
    const chooseLanguage = async (id, btn) => {
      if (!id || id === cur) { closeModal(); return; }
      if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
      try {
        await window.__i18n.setLocale(id);
      } catch (e) {
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        toast(`切换语言失败：${String((e && e.message) || e)}`, 5000);
      }
    };
    input.addEventListener('input', filter);
    root.querySelector('#langClose').onclick = closeModal;
    grid.querySelectorAll('[data-locale]').forEach((b) => {
      b.onclick = () => chooseLanguage(b.dataset.locale, b);
    });
    setTimeout(() => input.focus(), 30);
  });
}

function showSettings() {
  const ai = aiDefaults();
  const currentLang = (window.__i18n && window.__i18n.current) || { id: 'zh-CN', label: '简体中文', english: 'Chinese (Simplified)' };
  const ports = { http: 18100, mysql: 13306, redis: 16379, s3: 19000, s3Console: 19001, ...(S.settings.ports || {}) };
  const presetOf = (provider, endpoint) => {
    const e = String(endpoint || '').replace(/\/+$/, '');
    const hit = Object.keys(AI_PRESETS).find((k) => AI_PRESETS[k] && AI_PRESETS[k].provider === provider && AI_PRESETS[k].endpoint.replace(/\/+$/, '') === e);
    return hit || 'custom';
  };
  modal(`<div class="p-4 w-[820px] max-w-[94vw] max-h-[90vh] overflow-auto">
    <div class="flex items-center gap-2 mb-3">
      <b class="text-[13px]">设置</b>
      <span class="text-[11px] text-neutral-500">AI 接口、模型参数和本地服务端口都在这里改，不用编辑任何配置文件。</span>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,.9fr);gap:12px;align-items:start">
      <section class="border border-neutral-300 p-3">
        <div class="flex items-center gap-2 mb-2"><b class="text-[12px]">AI 接口</b><span class="pill" id="setAiPill">未检测</span></div>
        <div class="grid grid-cols-2 gap-2 text-[12px]">
          <label class="block">接入方式
            <select id="setProvider" class="w-full border border-neutral-300 px-1 py-1 mt-1">
              <option value="ollama">Ollama（本机）</option>
              <option value="openai">OpenAI 兼容</option>
              <option value="mock">本地模拟</option>
            </select>
          </label>
          <label class="block">服务预设
            <select id="setPreset" class="w-full border border-neutral-300 px-1 py-1 mt-1">
              <option value="ollama">Ollama 本机</option>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="moonshot">Moonshot / Kimi</option>
              <option value="zhipu">智谱 BigModel</option>
              <option value="siliconflow">SiliconFlow</option>
              <option value="custom">自定义</option>
            </select>
          </label>
        </div>
        <label class="block text-[12px] mt-2">接口地址
          <input id="setEndpoint" class="w-full border border-neutral-300 px-2 py-1 mt-1 mono" placeholder="http://127.0.0.1:11434">
        </label>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;margin-top:8px">
          <label class="block text-[12px]">模型
            <input id="setModel" list="setModels" class="w-full border border-neutral-300 px-2 py-1 mt-1 mono" placeholder="qwen3:8b / gpt-4o-mini">
            <datalist id="setModels"></datalist>
          </label>
          <button class="btn thin h-[30px]" id="setTest">测试连接</button>
        </div>
        <label class="block text-[12px] mt-2">API Key
          <input id="setKey" type="password" class="w-full border border-neutral-300 px-2 py-1 mt-1 mono" placeholder="本机 Ollama 可留空">
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px" class="text-[12px]">
          <label>超时（秒）<input id="setTimeout" type="number" min="3" step="1" class="w-full border border-neutral-300 px-1 py-1 mt-1"></label>
          <label>温度<input id="setTemp" type="number" min="0" max="2" step="0.1" class="w-full border border-neutral-300 px-1 py-1 mt-1"></label>
          <label>最大 Token<input id="setMaxTokens" type="number" min="256" step="256" class="w-full border border-neutral-300 px-1 py-1 mt-1"></label>
        </div>
        <label class="flex items-center gap-1 text-[11px] mt-2"><input type="checkbox" id="setFallback"> 真实接口失败时退回本地模拟</label>
        <div id="setAiStatus" class="text-[11px] text-neutral-600 mt-2">填写后点“测试连接”，成功再保存。</div>
        <div class="text-[10px] text-neutral-500 mt-2">Ollama 默认地址 http://127.0.0.1:11434；OpenAI 兼容服务地址通常以 /v1 结尾，例如 DeepSeek 的 https://api.deepseek.com/v1。</div>
      </section>
      <div>
        <section class="border border-neutral-300 p-3">
          <b class="text-[12px]">本地服务端口</b>
          <div class="grid grid-cols-2 gap-2 mt-2 text-[12px]">
            <label>网页服务<input id="portHttp" type="number" min="1" max="65535" class="w-full border border-neutral-300 px-1 py-1 mt-1"></label>
            <label>MariaDB<input id="portMysql" type="number" min="1" max="65535" class="w-full border border-neutral-300 px-1 py-1 mt-1"></label>
            <label>Redis<input id="portRedis" type="number" min="1" max="65535" class="w-full border border-neutral-300 px-1 py-1 mt-1"></label>
            <label>RustFS<input id="portS3" type="number" min="1" max="65535" class="w-full border border-neutral-300 px-1 py-1 mt-1"></label>
            <label class="col-span-2">RustFS 控制台<input id="portS3Console" type="number" min="1" max="65535" class="w-full border border-neutral-300 px-1 py-1 mt-1"></label>
          </div>
          <div class="text-[10px] text-neutral-500 mt-2">改端口后，先停止再启动对应服务；正在运行的服务不会自动迁移。</div>
        </section>
        <section class="border border-neutral-300 p-3 mt-3">
          <b class="text-[12px]">语言运行时</b>
          <div class="mt-2 text-[11px] space-y-1">
            ${(S.runtimes || []).map((r) => `<div class="flex items-center gap-2"><span class="pill ${r.available ? 'solid' : ''}">${r.available ? '可用' : '不可用'}</span><span class="mono">${esc(r.name)}</span><span class="text-neutral-500 truncate" title="${esc(r.path || '')}">${esc(r.version || '')}</span></div>`).join('') || '<div class="text-neutral-500">未检测到运行时</div>'}
          </div>
          <div class="text-[10px] text-neutral-500 mt-2">Go / Java 生成的是原生服务；启动时用本机 Go 或 JDK 编译，不需要 Node。检测结果在下次启动软件时刷新。</div>
        </section>
        <section class="border border-neutral-300 p-3 mt-3">
          <b class="text-[12px]">存储加速模式</b>
          <div class="mt-2 text-[11px] space-y-1">
            ${STORE_MODES.map((m) => `<div><span class="mono">${esc(m.name)}</span><span class="text-neutral-500"> · ${esc(m.desc)}</span></div>`).join('')}
          </div>
          <div class="text-[10px] text-neutral-500 mt-2">在“表结构”页每张表的“加速”下拉里选择，支持全局搜索；TTL、LRU 上限、刷盘间隔都在表头直接改。</div>
          <div class="text-[10px] text-neutral-500 mt-1">纯表模式（Redis / LRU / 定期落盘）只由 Node 运行时执行；Go / Java 原生运行时只支持“直连 MySQL”，遇到其他模式会拒绝启动，避免静默读写不一致。</div>
        </section>
        <section class="border border-neutral-300 p-3 mt-3">
          <b class="text-[12px]">界面</b>
          <div class="mt-2 flex items-center gap-2 p-2 border border-neutral-200 bg-neutral-50">
            <span class="pill solid" style="min-width:34px;text-align:center">${esc(currentLang.short || '中')}</span>
            <div style="min-width:0;flex:1">
              <div class="text-[12px] font-semibold truncate">${esc(currentLang.label || currentLang.id)}</div>
              <div class="text-[10px] text-neutral-500 truncate">${esc(currentLang.english || '')} · ${esc(currentLang.id)}</div>
            </div>
            <button class="btn thin" id="setLanguage">切换语言</button>
          </div>
          <button class="btn thin w-full mt-2" id="setTheme">主题、页眉页脚与字体</button>
          <div class="text-[10px] text-neutral-500 mt-2">支持 ${(window.__i18n && window.__i18n.locales ? window.__i18n.locales.length : 21)} 种界面语言；切换后立即重载，不再占用顶栏。</div>
        </section>
      </div>
    </div>
    <div class="flex gap-2 justify-end mt-3">
      <button class="btn thin" id="setClose">关闭</button>
      <button class="btn solid" id="setSave">保存设置</button>
    </div>
  </div>`, (root) => {
    const provider = root.querySelector('#setProvider');
    const preset = root.querySelector('#setPreset');
    const endpoint = root.querySelector('#setEndpoint');
    const model = root.querySelector('#setModel');
    const key = root.querySelector('#setKey');
    const timeout = root.querySelector('#setTimeout');
    const temp = root.querySelector('#setTemp');
    const maxTokens = root.querySelector('#setMaxTokens');
    const fallback = root.querySelector('#setFallback');
    const models = root.querySelector('#setModels');
    const pill = root.querySelector('#setAiPill');
    const statusEl = root.querySelector('#setAiStatus');

    provider.value = ai.provider;
    preset.value = presetOf(ai.provider, ai.endpoint);
    endpoint.value = ai.endpoint;
    model.value = ai.model;
    key.value = ai.apiKey;
    timeout.value = Math.round(ai.timeout / 1000);
    temp.value = ai.temperature;
    maxTokens.value = ai.maxTokens;
    fallback.checked = ai.fallbackMock;
    root.querySelector('#portHttp').value = ports.http;
    root.querySelector('#portMysql').value = ports.mysql;
    root.querySelector('#portRedis').value = ports.redis;
    root.querySelector('#portS3').value = ports.s3;
    root.querySelector('#portS3Console').value = ports.s3Console;

    const readAi = () => ({
      provider: provider.value,
      endpoint: endpoint.value.trim(),
      model: model.value.trim(),
      apiKey: key.value.trim(),
      timeout: Math.max(3000, Number(timeout.value || 180) * 1000),
      temperature: Number(temp.value == null || temp.value === '' ? 0.2 : temp.value),
      maxTokens: Number(maxTokens.value || 4096),
      fallbackMock: fallback.checked,
    });
    const setPill = (text, cls) => { pill.textContent = text; pill.className = `pill ${cls || ''}`; };

    preset.onchange = () => {
      const p = AI_PRESETS[preset.value];
      if (!p) return;
      provider.value = p.provider;
      endpoint.value = p.endpoint;
      model.value = '';
      statusEl.textContent = '已填入 ' + p.label + ' 的默认地址，再填写模型名并测试连接。';
      setPill('未检测', '');
    };
    provider.onchange = () => {
      if (provider.value === 'ollama' && !/11434|ollama/i.test(endpoint.value)) {
        endpoint.value = 'http://127.0.0.1:11434';
        preset.value = 'ollama';
      }
      if (provider.value === 'mock') {
        setPill('本地模拟', '');
        statusEl.textContent = '本地模拟不调用任何接口，按关键词生成固定模板。';
      } else {
        preset.value = presetOf(provider.value, endpoint.value);
      }
    };
    endpoint.oninput = () => { preset.value = presetOf(provider.value, endpoint.value); };

    root.querySelector('#setTest').onclick = async () => {
      const cfg = readAi();
      if (cfg.provider === 'mock') { setPill('本地模拟', ''); statusEl.textContent = '本地模拟，不需要连接。'; return; }
      if (!cfg.endpoint) { setPill('地址为空', 'pill-bad'); statusEl.textContent = '先填写接口地址。'; return; }
      setPill('检测中…', '');
      statusEl.textContent = `正在连接 ${cfg.endpoint} …`;
      let st;
      try { st = await api.aiStatus(cfg); } catch (e) { st = { ok: false, error: e.message || String(e) }; }
      if (!st || !st.ok) {
        setPill('未连接', 'pill-bad');
        statusEl.textContent = `连接失败：${(st && st.error) || '未知错误'}`;
        return;
      }
      setPill('已连接', 'pill-ok');
      models.innerHTML = (st.models || []).map((m) => `<option value="${esc(m.name)}"></option>`).join('');
      const names = (st.models || []).map((m) => m.name);
      if (!model.value && names.length) model.value = names.find((n) => /qwen3|qwen2\.5|gpt-4o/i.test(n)) || names[0];
      statusEl.textContent = `${st.message || '已连接'}${names.length ? ` · 找到 ${names.length} 个模型` : ''}`;
    };

    root.querySelector('#setTheme').onclick = () => { closeModal(); showTheme(); };
    root.querySelector('#setLanguage').onclick = () => { closeModal(); showLanguagePicker(); };
    root.querySelector('#setClose').onclick = closeModal;
    root.querySelector('#setSave').onclick = async () => {
      const cfg = readAi();
      const nextPorts = {
        http: Number(root.querySelector('#portHttp').value),
        mysql: Number(root.querySelector('#portMysql').value),
        redis: Number(root.querySelector('#portRedis').value),
        s3: Number(root.querySelector('#portS3').value),
        s3Console: Number(root.querySelector('#portS3Console').value),
      };
      if (!(cfg.temperature >= 0 && cfg.temperature <= 2)) { setPill('温度不合法', 'pill-bad'); statusEl.textContent = '温度范围是 0–2。'; return; }
      if (!(cfg.maxTokens >= 256)) { setPill('Token 不合法', 'pill-bad'); statusEl.textContent = '最大 Token 至少 256。'; return; }
      const vals = Object.values(nextPorts);
      if (vals.some((v) => !Number.isInteger(v) || v < 1 || v > 65535)) { setPill('端口不合法', 'pill-bad'); statusEl.textContent = '端口必须是 1–65535 的整数。'; return; }
      if (new Set(vals).size !== vals.length) { setPill('端口重复', 'pill-bad'); statusEl.textContent = '五个端口不能重复。'; return; }
      try {
        await api.saveSettings({ ai: cfg });
        S.settings.ai = cfg;
        const savedPorts = await api.setPorts(nextPorts);
        S.settings.ports = savedPorts;
        S.services = await api.services();
        renderSide();
        closeModal();
        toast('设置已保存；改过的服务端口需要停止后重新启动才生效', 5000);
      } catch (e) {
        setPill('保存失败', 'pill-bad');
        statusEl.textContent = `保存失败：${e.message || e}`;
      }
    };
  }, { width: 860, maxHeight: '90vh' });
}

function showTheme() {
  const saved = S.settings.theme || {};
  const t = { ...themeDefaults(), ...saved };
  if (isLegacyDefaultTheme(saved)) Object.assign(t, themeDefaults());
  modal(`<div class="p-4 w-[560px]">
    <div class="text-[13px] font-semibold mb-3">界面主题</div>
    <div class="grid grid-cols-2 gap-3 text-[12px]">
      <label>页眉底色 <input type="color" id="thHead" value="${esc(t.head)}" class="ml-2 align-middle"></label>
      <label>页眉文字 <input type="color" id="thHeadText" value="${esc(t.headText)}" class="ml-2 align-middle"></label>
      <label>强调色 <input type="color" id="thAccent" value="${esc(t.accent)}" class="ml-2 align-middle"></label>
      <label>页脚底色 <input type="color" id="thFooter" value="${esc(t.footer)}" class="ml-2 align-middle"></label>
    </div>
    <div class="mt-3 text-[12px]">字体 <input id="thFont" class="w-full border border-neutral-300 px-2 py-1 mt-1 mono" value="${esc(t.font || '')}" placeholder="留空用系统默认，例如 Georgia, serif"></div>
    <div class="mt-3 text-[11px] text-neutral-500">主题存在本机设置里，只影响界面，不影响生成的服务。</div>
    <div class="flex gap-2 mt-4 justify-end">
      <button class="btn thin" id="thReset">恢复默认</button>
      <button class="btn thin" id="thClose">取消</button>
      <button class="btn solid" id="thSave">应用</button>
    </div>
  </div>`, (root) => {
    const read = () => ({
      v: 2,
      head: root.querySelector('#thHead').value,
      headText: root.querySelector('#thHeadText').value,
      accent: root.querySelector('#thAccent').value,
      footer: root.querySelector('#thFooter').value,
      font: root.querySelector('#thFont').value,
    });
    root.querySelector('#thClose').onclick = closeModal;
    root.querySelector('#thReset').onclick = async () => {
      const next = await api.theme(themeDefaults());
      S.settings.theme = next; applyTheme(next); closeModal(); toast('已恢复默认浅色主题');
    };
    root.querySelector('#thSave').onclick = async () => {
      const next = await api.theme(read());
      S.settings.theme = next; applyTheme(next); closeModal(); toast('主题已应用');
    };
  });
}

/* ---------------- AI 生成 ---------------- */
function showAi() {
  const aiCfg = aiDefaults();
  const ctx = {
    name: S.project.name || '接口工程',
    interfaces: S.project.interfaces.length,
    tables: S.project.interfaces.reduce((n, it) => n + it.tables.length, 0),
    routes: S.project.interfaces.reduce((n, it) => n + it.routes.length, 0),
    selected: (S.project.interfaces.find((it) => it.id === S.selId) || {}).name || '未选中',
    frontend: S.project.frontend ? `${S.project.frontend.name || '前端工程'}（${(S.project.frontend.project && S.project.frontend.project.elements || []).length} 个元素）` : '无',
  };
  modal(`<div class="p-4">
    <div class="flex items-center gap-2 mb-2"><b>AI 生成接口 / 前端</b><span class="pill" id="aiPill">检测中…</span>
      <span class="text-[11px] text-neutral-500 ml-2">模型会读取当前工程，生成前不会改动工程</span></div>
    <div id="aiCfg" class="border border-neutral-300 p-2 mb-2 text-[12px]">
      <div class="ai-row"><label>接口</label>
        <select id="aiProvider">
          <option value="ollama">Ollama（本机）</option>
          <option value="openai">OpenAI 兼容</option>
          <option value="mock">本地模拟</option>
        </select>
        <label>地址</label><input id="aiEndpoint" class="mono" placeholder="http://127.0.0.1:11434">
      </div>
      <div class="ai-row"><label>模型</label>
        <input id="aiModel" class="mono" list="aiModels" placeholder="qwen3.8:27b">
        <datalist id="aiModels"></datalist>
        <button class="btn thin" id="aiTest">测试连接</button>
        <label>超时</label><input id="aiTimeout" type="number" min="3" step="1" class="w-[72px]"><span class="text-neutral-500">秒</span>
      </div>
      <div class="ai-row"><label>温度</label><input id="aiTemp" type="number" min="0" max="2" step="0.1" class="w-[64px]"><label>最大 Token</label><input id="aiMaxTokens" type="number" min="256" step="256" class="w-[84px]"><span class="text-neutral-500">参数会随工程上下文一起发给模型</span></div>
      <div class="ai-row"><label>API Key</label>
        <input id="aiKey" type="password" class="mono" placeholder="Ollama 可留空">
        <label class="flex items-center gap-1"><input type="checkbox" id="aiFallback"> 失败时退回本地模拟</label>
      </div>
      <div id="aiStatus" class="text-[11px] text-neutral-600 mt-1">正在检测本机服务…</div>
    </div>
    <div id="aiCtxLine" class="text-[11px] text-neutral-600 mb-1">当前工程：<b>${esc(ctx.name)}</b> · ${ctx.interfaces} 接口 / ${ctx.tables} 表 / ${ctx.routes} 路由 · 选中 ${esc(ctx.selected)} · 前端 ${esc(ctx.frontend)}</div>
    <textarea id="aiPrompt" class="w-full h-[84px] border border-neutral-900 p-2 mono text-[12px]" placeholder="例如：当前已有会员表和订单表，只追加一个优惠券接口，包含列表、创建、停用；再生成一个黑白办公风格的运营前端页面，不要重复会员和订单"></textarea>
    <div class="flex items-center gap-2 mt-2">
      <select id="aiMode" class="border border-neutral-300 px-1 py-1 text-[12px]">
        <option value="replace">替换接口（保留工程名 / 连接设置；前端按需求生成）</option>
        <option value="append">追加到当前工程（可同时生成前端）</option>
      </select>
      <label class="text-[11px] flex items-center gap-1"><input type="checkbox" id="aiUseCtx" checked> 携带当前工程上下文</label>
      <button class="btn thin ml-auto" id="aiClose">关闭</button>
      <button class="btn solid" id="aiGo">生成</button>
    </div>
    <div id="aiLog" class="border border-neutral-300 bg-neutral-50 p-2 h-[200px] overflow-auto text-[12px] mt-2"></div>
  </div>`, (root) => {
    const log = (s) => { const d = root.querySelector('#aiLog'); d.innerHTML += `<div class="border-b border-neutral-200 py-1">${esc(s)}</div>`; d.scrollTop = d.scrollHeight; };
    const provider = root.querySelector('#aiProvider');
    const endpoint = root.querySelector('#aiEndpoint');
    const model = root.querySelector('#aiModel');
    const timeout = root.querySelector('#aiTimeout');
    const temp = root.querySelector('#aiTemp');
    const maxTokens = root.querySelector('#aiMaxTokens');
    const key = root.querySelector('#aiKey');
    const fallback = root.querySelector('#aiFallback');
    const mode = root.querySelector('#aiMode');
    const useCtx = root.querySelector('#aiUseCtx');
    const pill = root.querySelector('#aiPill');
    const statusEl = root.querySelector('#aiStatus');
    const models = root.querySelector('#aiModels');
    const go = root.querySelector('#aiGo');
    provider.value = aiCfg.provider;
    endpoint.value = aiCfg.endpoint;
    model.value = aiCfg.model;
    key.value = aiCfg.apiKey;
    timeout.value = Math.round(aiCfg.timeout / 1000);
    temp.value = aiCfg.temperature;
    maxTokens.value = aiCfg.maxTokens;
    fallback.checked = aiCfg.fallbackMock;

    const readCfg = () => ({
      provider: provider.value,
      endpoint: endpoint.value.trim(),
      model: model.value.trim(),
      apiKey: key.value.trim(),
      timeout: Math.max(3000, Number(timeout.value || 180) * 1000),
      temperature: Number(temp.value == null || temp.value === '' ? 0.2 : temp.value),
      maxTokens: Number(maxTokens.value || 4096),
      fallbackMock: fallback.checked,
    });
    const persist = async () => {
      const cfg = readCfg();
      aiCfg.provider = cfg.provider; aiCfg.endpoint = cfg.endpoint; aiCfg.model = cfg.model;
      aiCfg.apiKey = cfg.apiKey; aiCfg.timeout = cfg.timeout;
      aiCfg.temperature = cfg.temperature; aiCfg.maxTokens = cfg.maxTokens;
      aiCfg.fallbackMock = cfg.fallbackMock;
      S.settings.ai = cfg;
      try { await api.saveSettings({ ai: cfg }); } catch (e) { /* 设置保存失败不阻断生成 */ }
      return cfg;
    };
    const setPill = (text, cls) => { pill.textContent = text; pill.className = `pill ${cls || ''}`; };
    const showStatus = async (silent) => {
      const cfg = readCfg();
      if (cfg.provider === 'mock') {
        setPill('本地模拟', '');
        statusEl.textContent = '本地模拟：按关键词生成固定模板，不会调用真实模型。';
        return { ok: true, models: [] };
      }
      setPill('检测中…', '');
      statusEl.textContent = `正在连接 ${cfg.endpoint || '（未填写地址）'} …`;
      const st = await api.aiStatus(cfg);
      if (!st.ok) {
        setPill('未连接', 'pill-bad');
        statusEl.textContent = `连接失败：${st.error || '未知错误'}${cfg.provider === 'ollama' ? '。请确认 Ollama 已启动。' : ''}`;
        return st;
      }
      setPill(st.provider === 'ollama' ? 'Ollama 已连接' : '接口已连接', 'pill-ok');
      models.innerHTML = (st.models || []).map((m) => `<option value="${esc(m.name)}"></option>`).join('');
      const names = (st.models || []).map((m) => m.name);
      if (!model.value && names.length) {
        model.value = names.find((n) => /qwen3\.8|qwen3/i.test(n)) || names.find((n) => /qwen2\.5|phi4/i.test(n)) || names[0];
        await persist();
      }
      statusEl.textContent = `${st.message || '已连接'}${names.length ? ` · 当前模型 ${model.value || '未选择'}` : ''}`;
      if (!silent) log(`连接成功：${st.message || '已连接'}${names.length ? `，${names.length} 个模型` : ''}`);
      return st;
    };

    provider.onchange = async () => {
      if (provider.value === 'ollama' && /api\.openai|openai\.com/i.test(endpoint.value)) endpoint.value = 'http://127.0.0.1:11434';
      if (provider.value === 'openai' && /11434|ollama/i.test(endpoint.value)) endpoint.value = 'https://api.openai.com/v1';
      if (provider.value === 'mock') { setPill('本地模拟', ''); statusEl.textContent = '本地模拟：按关键词生成固定模板，不会调用真实模型。'; }
      else await showStatus(true);
      await persist();
    };
    endpoint.onchange = () => { model.value = ''; showStatus(true).then(persist); };
    root.querySelector('#aiTest').onclick = async () => { log('测试连接…'); const st = await showStatus(false); if (st.ok) await persist(); };
    useCtx.onchange = () => {
      if (!useCtx.checked && mode.value === 'append') mode.value = 'replace';
      root.querySelector('#aiCtxLine').innerHTML = useCtx.checked
        ? `当前工程：<b>${esc(ctx.name)}</b> · ${ctx.interfaces} 接口 / ${ctx.tables} 表 / ${ctx.routes} 路由 · 选中 ${esc(ctx.selected)} · 前端 ${esc(ctx.frontend)}`
        : '未携带当前工程上下文：模型只会按需求生成，不会知道已有接口和表。';
    };
    root.querySelector('#aiClose').onclick = closeModal;

    go.onclick = async () => {
      const prompt = root.querySelector('#aiPrompt').value.trim();
      if (!prompt) return log('先写一句要做什么');
      const cfg = await persist();
      if (cfg.provider !== 'mock' && !cfg.endpoint) return log('失败：没有填写 AI 接口地址，当前工程未改动。');
      if (cfg.provider !== 'mock' && !cfg.model) return log('失败：没有选择模型，当前工程未改动。');
      const applyMode = useCtx.checked ? mode.value : 'replace';
      if (applyMode === 'append' && !useCtx.checked) return log('失败：追加模式必须携带当前工程上下文。');
      log(`你：${prompt}`);
      log(`模式：${applyMode === 'append' ? '追加' : '替换'} · ${cfg.provider === 'mock' ? '本地模拟' : `${cfg.provider} / ${cfg.model}`} · 上下文 ${useCtx.checked ? `「${ctx.name}」${ctx.interfaces} 接口` : '未携带'}`);
      log('AI 正在生成…');
      go.disabled = true;
      const t0 = Date.now();
      let r;
      try { r = await api.ai({ prompt, project: useCtx.checked ? S.project : null, selectedId: useCtx.checked ? S.selId : '', applyMode, config: cfg }); }
      catch (e) { r = { error: e.message || String(e) }; }
      go.disabled = false;
      if (!r || r.error) {
        setPill('生成失败', 'pill-bad');
        log(`失败：${(r && r.error) || '没有返回结果'}。当前工程未改动。`);
        return;
      }
      const sec = ((r.elapsedMs || Date.now() - t0) / 1000).toFixed(1);
      const providerText = r.provider === 'mock' ? '本地模拟' : `${r.provider === 'ollama' ? 'Ollama' : 'AI'} / ${r.model}`;
      setPill(r.provider === 'mock' ? '本地模拟' : '生成成功', r.provider === 'mock' ? '' : 'pill-ok');
      log(`AI（${providerText}，${sec}s）：${r.reply || '已生成'}`);
      if (r.contextUsed && r.context) log(`已读取上下文：工程「${r.context.projectName}」${r.context.interfaces} 接口 / ${r.context.tables} 表${r.context.selected ? `，选中「${r.context.selected.name}」` : ''}`);
      if (r.fallback) log(`注意：真实 AI 调用失败（${r.error}），已按设置回退到本地模拟。`);
      S.project = r.project;
      S.cat = (r.project.categories[0] || {}).id || '';
      S.selId = (r.project.interfaces[0] || {}).id || '';
      S.mode = 'grid';
      let saved = {};
      try { saved = await api.save(r.project); }
      catch (e) { log(`保存失败：${e.message || e}。工程已在内存中更新，可直接重试保存。`); setPill('保存失败', 'pill-bad'); return; }
      S.problems = (saved && saved.problems) || [];
      render();
      log(`已${r.applyMode === 'append' ? '追加' : '替换'}并保存「${r.project.name}」：${r.project.interfaces.length} 接口 / ${r.project.interfaces.reduce((n, it) => n + it.tables.length, 0)} 表。`);
      if (r.frontendUpdated) log(`前端已更新：「${r.frontendName || (r.project.frontend && r.project.frontend.name) || '前端工程'}」，${((r.project.frontend && r.project.frontend.project && r.project.frontend.project.elements) || []).length} 个元素。`);
      if (S.problems.length) log(`保存后仍有 ${S.problems.length} 个校验问题：${S.problems.slice(0, 3).join('；')}`);
      else log('工程校验通过。点“生成服务”就能跑。');
    };
    showStatus(true).catch((e) => { setPill('未连接', 'pill-bad'); statusEl.textContent = `连接失败：${e.message || e}`; });
  }, { width: 780, maxHeight: '90vh' });
}

/* ---------------- 实时监控 ---------------- */
function showMonitor() {
  const drawer = $('#drawer');
  drawer.classList.remove('hidden');
  drawer.innerHTML = `
    <div class="h-10 shrink-0 border-b border-neutral-900 flex items-center px-3 gap-2">
      <b class="text-[13px]">实时监控</b>
      <span id="monDot" class="dot off"></span>
      <span id="monHealth" class="mono text-[11px] text-neutral-500"></span>
      <label class="text-[11px] ml-auto flex items-center gap-1"><input type="checkbox" id="monErr"> 只看 WARN/ERROR</label>
      <select id="monIface" class="border border-neutral-300 px-1 py-0.5 text-[12px]"><option value="">全部接口</option></select>
      <button class="btn thin" id="monPause">暂停</button>
      <button class="btn thin" id="monClose">关闭</button>
    </div>
    <div id="monRows" class="flex-1 overflow-auto text-[12px]"></div>`;
  let paused = false;
  let timer = null;
  const levelClass = (lv) => ({ TRACE: 'text-neutral-400', DEBUG: 'text-neutral-500', INFO: 'text-neutral-900', WARN: 'text-amber-700', ERROR: 'text-red-700', FATAL: 'text-white bg-red-800 px-1' }[lv] || 'text-neutral-700');
  async function tick() {
    if (paused) return;
    const r = await api.monitor(300);
    const dot = $('#monDot');
    dot.className = 'dot ' + (r.ok ? 'on' : 'off');
    $('#monHealth').textContent = r.ok ? `mysql ${r.health.mysql ? '✓' : '✗'} · redis ${r.health.redis ? '✓' : '✗'} · s3 ${r.health.s3 ? '✓' : '✗'} · ${r.routes.length} 路由` : r.error;
    if (!r.ok) { $('#monRows').innerHTML = `<div class="p-4 text-neutral-500">${esc(r.error)}</div>`; return; }
    const sel = $('#monIface');
    if (sel.options.length <= 1) {
      const names = Array.from(new Set(r.logs.map((l) => l.iface).filter(Boolean)));
      names.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
    }
    const errOnly = $('#monErr').checked;
    const filter = sel.value;
    const rows = r.logs.filter((l) => (!errOnly || ['WARN', 'ERROR', 'FATAL'].includes(l.level)) && (!filter || l.iface === filter)).slice(-120).reverse();
    $('#monRows').innerHTML = rows.map((l) => `<div class="px-3 py-1 border-b border-neutral-200 flex gap-2 items-baseline hover:bg-neutral-50 cursor-pointer" data-log-iface="${esc(l.iface || '')}" data-log-route="${esc(l.route || '')}" title="点击定位到对应接口路由">
      <span class="mono text-[10px] text-neutral-400 w-[62px] shrink-0">${esc((l.time || '').slice(11))}</span>
      <span class="mono text-[10px] w-[52px] shrink-0 ${levelClass(l.level)}">${esc(l.level || 'INFO')}</span>
      <span class="mono text-[10px] w-[46px] shrink-0">${esc(String(l.status || ''))}</span>
      <span class="mono text-[10px] w-[52px] shrink-0 text-neutral-500">${esc(String(l.ms || 0) + 'ms')}</span>
      <span class="flex-1 truncate" title="${esc(l.message)}">${esc(l.message)}</span>
      <span class="mono text-[10px] text-neutral-400 shrink-0">${esc(l.iface || '')}${l.route ? ' · ' + esc(l.route) : ''}</span>
    </div>`).join('') || '<div class="p-4 text-neutral-500">还没有日志，去“测试”页发个请求试试。</div>';
    $$('#monRows [data-log-iface]').forEach((row) => {
      row.onclick = () => {
        const iface = S.project.interfaces.find((x) => x.name === row.dataset.logIface);
        if (!iface) return toast('这条日志没有关联到当前工程的接口');
        const route = (iface.routes || []).find((r) => r.name === row.dataset.logRoute);
        S.selId = iface.id;
        if (route) S.routeId = route.id;
        S.mode = 'editor'; if (route) S.tab = 'routes';
        clearInterval(timer);
        drawer.classList.add('hidden'); drawer.innerHTML = '';
        render();
        toast(`已定位：${iface.name}${route ? ' · ' + route.name : ''}`);
      };
    });
  }
  $('#monPause').onclick = () => { paused = !paused; $('#monPause').textContent = paused ? '继续' : '暂停'; };
  $('#monClose').onclick = () => { clearInterval(timer); drawer.classList.add('hidden'); drawer.innerHTML = ''; };
  $('#monErr').onchange = tick; $('#monIface').onchange = tick;
  tick();
  timer = setInterval(tick, 2000);
}

/* ---------------- 右键菜单 ---------------- */
function closeCtx() {
  const box = $('#ctxmenu');
  if (box) box.classList.add('hidden');
}

function copyText(text) {
  const s = String(text == null ? '' : text);
  if (!s) return toast('没有可复制的内容');
  (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject(new Error('剪贴板不可用')))
    .then(() => toast(`已复制：${s.length > 36 ? s.slice(0, 36) + '…' : s}`))
    .catch(() => toast('复制失败，请手动选中'));
}

function openCtx(x, y, items) {
  const box = $('#ctxmenu');
  box.innerHTML = items.map((it, i) => {
    if (it.sep) return '<div style="height:1px;background:#e5e5e5;margin:4px 0"></div>';
    const color = it.danger ? '#b91c1c' : '';
    const disabled = it.disabled ? 'opacity:.38;cursor:default' : '';
    return `<div class="px-3 py-1.5 flex items-center gap-5" style="white-space:nowrap;${color ? `color:${color};` : ''}${disabled}" data-ctx="${i}" ${it.disabled ? 'data-disabled="1"' : ''}>
      <span class="flex-1">${esc(it.label)}</span>${it.hint ? `<span class="text-[10px] text-neutral-400 mono">${esc(it.hint)}</span>` : ''}
    </div>`;
  }).join('');
  box.classList.remove('hidden');
  box.style.left = '0px'; box.style.top = '0px';
  box.style.minWidth = '220px'; box.style.maxWidth = '320px';
  const w = box.offsetWidth || 220;
  const h = box.offsetHeight || 40;
  box.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 12)) + 'px';
  box.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 12)) + 'px';
  box.querySelectorAll('[data-ctx]').forEach((el) => {
    const item = items[Number(el.dataset.ctx)];
    if (!item || item.disabled) return;
    el.onmouseenter = () => { el.style.background = '#171717'; el.style.color = '#fff'; };
    el.onmouseleave = () => { el.style.background = ''; el.style.color = item.danger ? '#b91c1c' : ''; };
    el.onclick = () => { closeCtx(); const fn = item.run; if (fn) Promise.resolve(fn()).catch((e) => toast(String(e && e.message || e), 5000)); };
  });
}
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const sheet = e.target.closest('#sheetbar .sheet[data-sheet]');
  const row = e.target.closest('#workspace tr[data-iface]');
  const routeEl = e.target.closest('#routeList [data-route], [data-route]');
  const tableEl = e.target.closest('#tableTabs [data-table]');
  const fieldRow = e.target.closest('#workspace tr[data-field-row]');
  const inWorkspace = e.target.closest('#workspace') || e.target.closest('#sheetbar');
  if (!sheet && !row && !routeEl && !tableEl && !fieldRow && !inWorkspace) return;
  e.preventDefault();
  closeCtx();

  if (row) {
    const iface = S.project.interfaces.find((x) => x.id === row.dataset.iface);
    S.selId = iface.id;
    openCtx(e.clientX, e.clientY, [
      { label: '打开接口', hint: '双击', run: () => openIface(iface.id) },
      { label: '复制接口', hint: '自动编号', run: () => act('dupIface') },
      { label: '导出此接口为微服务', run: () => showMicroExport(iface.id) },
      { sep: true },
      { label: '重命名', run: async () => { const n = await ask('接口名', iface.name); if (n) { iface.name = n; scheduleSave(); render(); } } },
      { label: '删除接口', danger: true, run: () => act('delIface') },
    ]);
    return;
  }
  if (sheet) {
    const cat = S.project.categories.find((c) => c.id === sheet.dataset.sheet);
    openCtx(e.clientX, e.clientY, [
      { label: '重命名分类', run: async () => { const n = await ask('分类名', cat.name); if (n) { cat.name = n; scheduleSave(); render(); } } },
      { label: '在此分类新建接口', run: async () => { S.cat = cat.id; await act('newIface'); } },
      { sep: true },
      { label: '导出 .yxpn', run: () => act('exportYxpn') },
    ]);
    return;
  }
  if (tableEl) {
    const it = activeIface();
    const key = tableEl.dataset.table;
    const t = tableOfIface(it, key);
    openCtx(e.clientX, e.clientY, [
      { label: '切换到此表', run: () => { S.tableKey = key; renderWorkspace(); } },
      { label: '复制表结构', run: () => { S.tableKey = key; act('dupTable'); } },
      { label: '复制表键', hint: t.key, run: () => copyText(t.key) },
      { sep: true },
      { label: '看 DDL', run: () => { S.tableKey = key; renderWorkspace(); act('ddl'); } },
      { label: '删除此表', danger: true, disabled: it.tables.length <= 1, run: () => { S.tableKey = key; act('delTable'); } },
    ]);
    return;
  }
  if (fieldRow) {
    const it = activeIface();
    const t = tableOfIface(it, S.tableKey);
    const i = Number(fieldRow.dataset.fieldRow);
    const f = t.fields[i];
    if (!f) return;
    openCtx(e.clientX, e.clientY, [
      { label: '复制字段名', hint: f.name, run: () => copyText(f.name) },
      { label: '复制此字段', run: () => {
        const copy = JSON.parse(JSON.stringify(f));
        let name = `${f.name}_copy`; let n = 2;
        while (t.fields.some((x) => x.name === name)) name = `${f.name}_copy_${n++}`;
        copy.name = name; copy.pk = false; copy.autoIncrement = false;
        t.fields.splice(i + 1, 0, copy); scheduleSave(); renderWorkspace();
        toast(`已复制字段「${name}」`);
      } },
      { sep: true },
      { label: '在末尾加字段', run: () => act('addField') },
      { label: '删除此字段', danger: true, disabled: t.fields.length <= 1, run: async () => {
        if (!(await confirmBox('删除字段', `确定删掉「${f.name}」？`))) return;
        t.fields.splice(i, 1); scheduleSave(); renderWorkspace();
      } },
    ]);
    return;
  }
  if (routeEl) {
    const it = activeIface();
    const id = routeEl.dataset.route;
    openCtx(e.clientX, e.clientY, [
      { label: '打开这条路由', run: () => { S.routeId = id; S.tab = 'routes'; S.mode = 'editor'; render(); } },
      { label: '复制路由', run: () => {
        const r = it.routes.find((x) => x.id === id);
        const copy = JSON.parse(JSON.stringify(r));
        copy.id = Math.random().toString(16).slice(2, 10);
        copy.name = r.name + '2'; copy.path = r.path + '-2';
        it.routes.push(copy); S.routeId = copy.id; scheduleSave(); renderWorkspace();
      } },
      { label: '删除路由', danger: true, run: () => { S.routeId = id; act('delRoute'); } },
    ]);
    return;
  }

  // 空白区域：不再“右键没反应”
  const editor = S.mode === 'editor';
  const items = editor ? [
    { label: '添加字段', run: () => act('addField') },
    { label: '新增表', run: () => act('addTable') },
    { label: '复制当前表结构', run: () => act('dupTable') },
    { label: '看当前表 DDL', run: () => act('ddl') },
    { sep: true },
    { label: '路由脚本', run: () => { S.tab = 'routes'; renderWorkspace(); } },
    { label: '接口文档', run: () => { S.tab = 'docs'; renderWorkspace(); } },
    { label: '测试', run: () => { S.tab = 'test'; renderWorkspace(); } },
    { label: '生成导出', run: () => { S.tab = 'export'; renderWorkspace(); } },
    { sep: true },
    { label: '生成服务', hint: 'Ctrl+Enter', run: () => act('generate') },
    { label: '导出工程', run: () => act('exportProject') },
    { label: '保存', hint: 'Ctrl+S', run: () => save() },
  ] : [
    { label: '新建接口', hint: 'Ctrl+N', run: () => act('newIface') },
    { label: '新建分类', hint: 'Ctrl+Shift+N', run: () => act('addCat') },
    { sep: true },
    { label: '导入 .yxpn', run: () => act('importYxpn') },
    { label: '导出工程', run: () => act('exportProject') },
    { label: '生成服务', hint: 'Ctrl+Enter', run: () => act('generate') },
    { label: '打开生成目录', disabled: !S.genDir, run: () => api.openPath(S.genDir) },
    { sep: true },
    { label: '全局搜索', hint: 'Ctrl+K', run: () => { $('#search').focus(); $('#search').select(); } },
    { label: '主题', run: () => act('theme') },
    { label: '保存', hint: 'Ctrl+S', run: () => save() },
  ];
  openCtx(e.clientX, e.clientY, items);
});
document.addEventListener('click', (e) => { if (!e.target.closest('#ctxmenu')) closeCtx(); });
window.addEventListener('resize', closeCtx);
window.addEventListener('blur', closeCtx);

/* ---------------- 窗口按钮（无边框自绘标题栏） ---------------- */
function bindWindowControls() {
  const btnMax = $('#winMax');
  const setState = (max) => {
    if (!btnMax) return;
    btnMax.title = max ? '还原' : '最大化';
    btnMax.innerHTML = max
      ? '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M3 3V1h6v6H7" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.2" y="1.2" width="7.6" height="7.6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  };
  $('#winMin').onclick = () => api.win('minimize');
  btnMax.onclick = () => api.win('maximize');
  $('#winClose').onclick = () => api.win('close');
  $('#appHeader').addEventListener('dblclick', (e) => {
    if (e.target.closest('input,button,.no-drag')) return;
    api.win('maximize');
  });
  api.win('state').then((s) => setState(!!(s && s.maximized)));
  api.onWinState((s) => setState(!!(s && s.maximized)));
}

/* ---------------- 前端模式（ClickBuild 前端工坊 / .yxpp） ---------------- */
let studioHtmlCache = '';
let studioLoaded = false;
let studioReady = false;
let studioBound = null;
let studioBlankBinding = false;
let studioDirty = false;
let studioSaveTimer = null;
let studioAutoTimer = null;
let studioSaveBusy = false;
let studioSaveAgain = false;
let studioSeq = 0;
let studioLastAt = 0;
const studioReqs = new Map();
const STUDIO_BLANK = '__blank__';

function studioFrame() { return $('#studioFrame'); }

function postToStudio(msg) {
  const f = studioFrame();
  try { if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*'); } catch (e) { /* retry on ready */ }
}

function refreshStudioState() {
  const el = $('#studioState');
  if (!el) return;
  const f = S.project && S.project.frontend;
  const pages = f && f.project && Array.isArray(f.project.pages) ? f.project.pages.length : 1;
  el.textContent = f
    ? `已连接工程：${f.name || '前端工程'} · ${pages} 页 · 自动同步`
    : '空白画布 · 编辑后自动绑定到当前工程';
  el.disabled = false;
}

function blankStudioProject() {
  return {
    name: `${S.project.name || '前端'} 前端`,
    framework: 'tailwind',
    page: { w: 1200, h: 900, bg: '#FFFFFF' },
    theme: { font: '-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', accent: '#0B0B0B', radius: 4, grid: 8, showGrid: true },
    assets: [],
    elements: [],
  };
}

function syncStudioFromProject(force) {
  const f = S.project && S.project.frontend;
  if (f && f.project) {
    if (!force && studioBound === f.project && !studioBlankBinding) return;
    studioBound = f.project;
    studioBlankBinding = false;
    studioDirty = false;
    studioLoadProject(f.project, 'bound');
  } else {
    if (!force && studioBound === STUDIO_BLANK) return;
    studioBound = STUDIO_BLANK;
    studioBlankBinding = true;
    studioDirty = false;
    studioLoadProject(blankStudioProject(), 'none');
  }
}

async function ensureStudio() {
  if (studioLoaded) return;
  const f = studioFrame();
  if (!f) return;
  studioLoaded = true;
  try {
    studioHtmlCache = await api.studioHtml();
    f.srcdoc = studioHtmlCache;
    f.addEventListener('load', () => {
      if (!studioLoaded) return;
      setTimeout(() => { if (studioLoaded) syncStudioFromProject(true); }, 500);
    }, { once: true });
    if (!studioAutoTimer) {
      studioAutoTimer = setInterval(() => {
        if (studioDirty && S.view === 'studio') saveStudioToProject('定时保存');
      }, 20000);
    }
  } catch (e) {
    studioLoaded = false;
    toast('前端工坊加载失败：' + (e.message || e), 5000);
  }
}

function studioRouteBody(script) {
  const out = [];
  String(script || '').replace(/\{\{\s*body\.([A-Za-z0-9_]+)/g, (m, name) => {
    if (out.indexOf(name) < 0) out.push(name);
    return m;
  });
  return out;
}
function studioIfaces() {
  return ((S.project && S.project.interfaces) || []).map((i) => ({
    name: i.name,
    basePath: i.basePath || '',
    routes: (i.routes || []).map((r) => ({
      key: r.key, name: r.name, method: r.method, path: r.path, summary: r.summary,
      body: Array.isArray(r.body) ? r.body : studioRouteBody(r.script),
      io: ioOfRoute(r),
    })),
    tables: (i.tables || []).map((t) => ({
      key: t.key, name: t.name, schema: t.schema || '', conn: t.conn || 'main', comment: t.comment || '',
      fields: (t.fields || []).map((f) => ({
        name: f.name, type: f.type, length: f.length, comment: f.comment,
        pk: !!f.pk, autoIncrement: !!f.autoIncrement, nullable: f.nullable !== false,
        default: f.default, hidden: !!f.hidden, writable: f.writable !== false, search: !!f.search,
      })),
    })),
    fields: (((i.tables || []).find((t) => t.key === 'main') || {}).fields || []).map((f) => ({
      name: f.name, type: f.type, length: f.length, comment: f.comment,
      pk: !!f.pk, autoIncrement: !!f.autoIncrement, nullable: f.nullable !== false,
      default: f.default, hidden: !!f.hidden, writable: f.writable !== false, search: !!f.search,
    })),
  }));
}
async function studioLoadProject(project, binding) {
  if (!project) return;
  const ui = window.__i18n || {};
  const locale = String((S.settings && S.settings.language) || ui.locale || 'zh-CN');
  const ifaces = studioIfaces();
  let previewHtml = '';
  if (project.app && project.app.mode && project.previewSeed && project.previewSeed.sql) {
    try {
      const got = await api.studioPreview({ project, name: (S.project && S.project.name) || project.name || '' });
      previewHtml = (got && got.html) || '';
    } catch (e) { previewHtml = ''; }
  }
  postToStudio({
    type: 'cbs:yxpp:load',
    project,
    binding: binding || 'bound',
    lang: locale,
    dir: ui.dir || 'ltr',
    dict: ui.dict || {},
    patterns: ui.patterns || [],
    ifaces,
    previewHtml,
    at: studioLastAt,
  });
}

function captureStudioProject() {
  return new Promise((resolve) => {
    if (!studioLoaded) return resolve(null);
    const id = `r${++studioSeq}`;
    const timer = setTimeout(() => { studioReqs.delete(id); resolve(null); }, 8000);
    studioReqs.set(id, (project, html) => { clearTimeout(timer); resolve({ project, html: html || '' }); });
    postToStudio({ type: 'cbs:yxpp:get', requestId: id });
  });
}

function isStudioExportHtml(html) {
  return /^<!--\s*cbs:studio-export\s*-->/.test(String(html || '').trim());
}

function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function scheduleStudioSave(delay) {
  clearTimeout(studioSaveTimer);
  studioSaveTimer = setTimeout(() => { saveStudioToProject('编辑自动保存'); }, delay == null ? 1200 : delay);
}

async function saveStudioToProject(reason, force) {
  if (!studioLoaded || !studioReady) return false;
  if (!studioDirty && !force) return true;
  if (studioSaveBusy) { studioSaveAgain = true; return false; }
  studioSaveBusy = true;
  studioDirty = false;
  try {
    const got = await captureStudioProject();
    if (!got || !got.project || !got.project.page) {
      studioDirty = true;
      postToStudio({ type: 'cbs:yxpp:error', message: '读取画布失败，稍后会重试' });
      return false;
    }
    const project = got.project;
    // 案例前端自带可交互 HTML（登录、路由试运行等）；设计编辑只更新 project，不把这段运行时脚本冲掉。
    const old = S.project.frontend;
    const customHtml = !!(old && old.html && /<script[\s>]/i.test(old.html) && !isStudioExportHtml(old.html));
    const built = await api.frontendBuild({ project, name: S.project.name, framework: 'tailwind', html: customHtml ? old.html : (got.html || '') });
    if (!built || !built.ok) throw new Error((built && built.error) || '生成 .yxpp 失败');
    S.project.frontend = built.yxpp;
    await api.save(S.project);
    setSaveState('saved', '前端已同步');
    studioBound = built.yxpp.project;
    studioBlankBinding = false;
    studioLastAt = Date.now();
    postToStudio({ type: 'cbs:yxpp:saved', at: studioLastAt });
    refreshStudioState();
    if (reason === '手动同步') toast('已同步到当前工程', 2500);
    return true;
  } catch (e) {
    studioDirty = true;
    postToStudio({ type: 'cbs:yxpp:error', message: String((e && e.message) || e) });
    if (reason === '手动同步') toast('同步失败：' + String((e && e.message) || e), 5000);
    return false;
  } finally {
    studioSaveBusy = false;
    if (studioDirty || studioSaveAgain) {
      studioSaveAgain = false;
      scheduleStudioSave(1000);
    }
  }
}

async function attachStudioToProject() {
  if (!studioReady) return toast('前端工坊还没加载完，稍等一下', 4000);
  const ok = await saveStudioToProject('手动同步', true);
  if (ok) toast('已绑定并同步到当前工程；启动后首页就是这份页面', 4500);
}

async function exportStudioYxpp() {
  const got = await captureStudioProject();
  if (!got || !got.project || !got.project.page) return toast('读取前端工程失败', 4000);
  const old = S.project.frontend;
  const customHtml = !!(old && old.html && /<script[\s>]/i.test(old.html) && !isStudioExportHtml(old.html));
  const built = await api.frontendBuild({ project: got.project, name: S.project.name, framework: 'tailwind', html: customHtml ? old.html : (got.html || '') });
  if (!built || !built.ok) return toast('生成 .yxpp 失败', 5000);
  downloadJson(`${String(S.project.name || '前端工程').replace(/[\\/:*?"<>|]/g, '_')}.yxpp`, built.yxpp);
  toast('已导出 .yxpp', 3000);
}

async function importStudioYxpp() {
  const got = await api.frontendImport();
  if (!got || !got.ok) {
    if (got && !got.canceled) toast('导入失败：' + (got.error || ''), 5000);
    return;
  }
  S.project.frontend = got.yxpp;
  await api.save(S.project);
  refreshStudioState();
  studioLastAt = Date.now();
  studioBound = got.yxpp.project;
  studioBlankBinding = false;
  studioLoadProject(got.yxpp.project, 'bound');
  toast(`已导入 .yxpp「${got.yxpp.name}」`, 4000);
}

function setView(view) {
  const next = view === 'studio' ? 'studio' : 'api';
  const kind = taskKindOf(S.project);
  if (next === 'studio' && kind === 'backend') {
    toast('这是只后端任务，没有前端工坊；要写页面请先把任务类型改成混合', 5000);
    return;
  }
  if (next === 'api' && kind === 'frontend') {
    toast('这是只前端任务，接口工作台已收起；要写接口请先把任务类型改成混合', 5000);
    return;
  }
  if (S.view === 'studio' && next === 'api' && studioDirty) saveStudioToProject('切换视图');
  S.view = next;
  const studio = S.view === 'studio';
  if (studio) toggleResPop(false);
  $('#ribbon').classList.toggle('hidden', studio);
  $('#workbenchMain').classList.toggle('hidden', studio);
  $('#sheetbar').classList.toggle('hidden', studio);
  $('#studioPane').classList.toggle('hidden', !studio);
  $('#studioPane').classList.toggle('flex', studio);
  $$('#viewSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  if (studio) {
    ensureStudio();
    refreshStudioState();
    if (studioReady) syncStudioFromProject(false);
  } else {
    render();
    sampleResources();
  }
}

window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (d.type === 'cbs:app:action') {
    const target = { import: '#yxppImport', export: '#yxppExport', sync: '#yxppAttach', deploy: '#yxppDeploy' }[d.action];
    const btn = target && $(target);
    if (btn) btn.click();
  }
  if (d.type === 'cbs:yxpp:project' && d.requestId && studioReqs.has(d.requestId)) {
    const fn = studioReqs.get(d.requestId);
    studioReqs.delete(d.requestId);
    fn(d.project, d.html);
  }
  if (d.type === 'cbs:yxpp:ready') {
    studioReady = true;
    syncStudioFromProject(true);
  }
  if (d.type === 'cbs:yxpp:dirty') {
    studioDirty = true;
    if (S.view === 'studio') setSaveState('dirty', '前端未同步');
    scheduleStudioSave(d.immediate ? 0 : 1200);
  }
  if (d.type === 'cbs:yxpp:reload') {
    syncStudioFromProject(true);
    toast('已从当前工程重新载入前端', 3000);
  }
});

$('#viewSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});
$('#yxppImport').onclick = () => importStudioYxpp().catch((e) => toast(e.message, 5000));
$('#yxppExport').onclick = () => exportStudioYxpp().catch((e) => toast(e.message, 5000));
$('#yxppAttach').onclick = () => attachStudioToProject().catch((e) => toast(e.message, 5000));
$('#yxppDeploy').onclick = () => deployUpdate().catch((e) => toast(e.message, 5000));

/* ---------------- 工程历史预览 ---------------- */
const HUB = { list: [], templates: [], filter: '', menuName: '' };

function hubTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function hubFilterText(item) {
  const kind = TASK_KINDS[item.taskType] || TASK_KINDS.mixed;
  return [item.name, item.description, kind.label, ...(item.tags || []), ...(item.tables || [])].join(' ').toLowerCase();
}

function uniqueProjectName(base) {
  const names = new Set([...(S.list || []), ...(HUB.list || [])].map((x) => String(x.name || '').toLowerCase()));
  let next = String(base || '新工程').trim() || '新工程';
  let n = 2;
  while (names.has(next.toLowerCase())) next = `${String(base || '新工程').trim()} ${n++}`;
  return next;
}

// 新建/套用模版的唯一入口：先落盘当前工程，再保存一个新名字的工程并切过去。
// 任何一步失败都不动当前工程，避免“点了新建反而把当前内容冲掉”。
async function activateFreshProject(next, doneText) {
  const saved = await flushAndSave('套用模版');
  if (!saved) {
    toast('当前工程没有保存成功，已取消新建；改动还在当前工程里', 6000);
    return false;
  }
  const p = next;
  p.name = uniqueProjectName(p.name);
  p.taskType = p.taskType || 'mixed';
  const r = await api.save(p);
  if (r && r.ok === false) {
    toast('新工程保存失败：' + (r.error || '未知错误'), 6000);
    return false;
  }
  const proj = (r && r.project) || p;
  try { S.list = await api.projects(); } catch (_) {}
  await enterWorkspace(proj);
  toast(doneText(proj), 4500);
  return true;
}

function renderHubSections() {
  const box = $('#hubSections');
  if (!box) return;
  const q = HUB.filter.trim().toLowerCase();
  const projects = HUB.list.filter((p) => !q || hubFilterText(p).includes(q));
  const templates = HUB.templates.filter((t) => !q || hubFilterText(t).includes(q));

  const projectHtml = projects.length ? projects.map((p) => {
    const tables = new Set(p.tables || []).size;
    const current = S.project && S.project.name === p.name;
    const kind = TASK_KINDS[p.taskType] || TASK_KINDS.mixed;
    return `<article class="hub-project ${p.missing ? 'missing' : ''}" data-hub-open="${esc(p.name)}">
      <button class="hub-x" data-hub-del="${esc(p.name)}" title="删除工程「${esc(p.name)}」" aria-label="删除工程">×</button>
      <div class="hub-project-top">
        <span class="hub-badge">${p.missing ? '丢失' : current ? '当前' : '工程'}</span>
        <span class="hub-kind">${esc(kind.label)}</span>
        <span class="hub-time">${hubTime(p.updatedAt)}</span>
      </div>
      <h3>${esc(p.name)}</h3>
      <div class="hub-project-desc">${esc(p.description || '已保存的接口工程')}</div>
      <div class="hub-stats"><span>${p.count || 0} 接口</span><span>${tables} 表</span><span>${p.routes || 0} 路由</span></div>
      <div class="hub-path ${p.missing ? 'missing' : ''}" title="${esc(p.missing ? '找不到文件' : p.file)}">${p.missing ? '找不到文件' : esc(p.file)}</div>
    </article>`;
  }).join('') : `<div class="hub-empty">${q ? '没有匹配的工程。' : '还没有历史工程，从下面的模版挑一个开始。'}</div>`;

  const tplHtml = templates.length ? templates.map((t, i) => `<article class="hub-tpl" data-hub-tpl="${esc(t.id)}" title="使用模版「${esc(t.name)}」">
      <div class="hub-tpl-top"><span class="hub-tpl-index">${String(i + 1).padStart(2, '0')}</span><span class="hub-tpl-kind">${t.kind === 'builtin' ? '内置' : '我的'}</span></div>
      <h3>${esc(t.name)}</h3>
      <div class="hub-tpl-meta">${t.counts.interfaces} 接口 · ${t.counts.tables} 表 · ${t.counts.routes} 路由</div>
      <div class="hub-tpl-desc">${esc(t.description || '')}</div>
      <div class="hub-tpl-tags">${(t.tags || []).slice(0, 4).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
    </article>`).join('') : `<div class="hub-empty">${q ? '没有匹配的模版。' : '暂时没有可用模版。'}</div>`;

  box.innerHTML = `
    <section class="hub-section">
      <div class="hub-section-head"><h2>全部工程</h2><span class="hub-count" data-hub-count="projects">${projects.length} / ${HUB.list.length}</span><span class="hub-hint">左键打开 · 右键复制或删除 · 红叉删除</span></div>
      <div class="hub-projects">${projectHtml}</div>
    </section>
    <section class="hub-section">
      <div class="hub-section-head"><h2>从模版开始</h2><span class="hub-count" data-hub-count="templates">${templates.length} / ${HUB.templates.length}</span><span class="hub-hint">音乐网站、小说网站以及全部内置模版都在这里</span></div>
      <div class="hub-templates">${tplHtml}</div>
    </section>`;
}

function renderProjectHub() {
  $('#projectHub').innerHTML = `<div class="hub-shell">
    <div class="hub-top">
      <div class="hub-brand"><img src="../assets/logo.png" alt="ClickBuild" width="26" height="26"><span class="hub-brand-word">ClickBuild</span><span>项目工作台</span></div>
      <div class="hub-top-note">先选择工程或模版</div>
      <div class="hub-search">
        <input id="hubSearch" placeholder="搜索工程 / 模版 / 标签…" value="${esc(HUB.filter)}" autocomplete="off">
        <button class="btn thin primary" id="hubNew">新建任务</button>
      </div>
      <button class="hub-win" data-hub-win="minimize" title="最小化"><svg width="11" height="11" viewBox="0 0 11 11"><path d="M1 5.5h9" stroke="currentColor" stroke-width="1.2"/></svg></button>
      <button class="hub-win" data-hub-win="maximize" title="最大化"><svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.2" y="1.2" width="8.6" height="8.6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg></button>
      <button class="hub-win close" data-hub-win="close" title="关闭"><svg width="11" height="11" viewBox="0 0 11 11"><path d="M1.2 1.2l8.6 8.6M9.8 1.2l-8.6 8.6" stroke="currentColor" stroke-width="1.2"/></svg></button>
    </div>
    <div class="hub-body">
      <div class="hub-kicker">工程与模版</div>
      <div class="hub-heading">工程历史</div>
      <div class="hub-sub">打开应用先在这里选择历史工程，选中之后才进入工作台。历史文件、模版和复制入口都在这一页。</div>
      <div id="hubSections"></div>
    </div>
    <div class="hub-footer"><span>ClickBuild 项目中心</span><span>${HUB.list.length} 个历史工程</span><span>${HUB.templates.length} 个模版</span></div>
  </div>`;

  const input = $('#hubSearch');
  input.addEventListener('input', () => { HUB.filter = input.value; renderHubSections(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { HUB.filter = ''; input.value = ''; renderHubSections(); }
  });
  $('#hubNew').onclick = () => newTaskFlow();
  $('#projectHub').querySelectorAll('[data-hub-win]').forEach((b) => {
    b.onclick = () => api.win(b.dataset.hubWin);
  });
  renderHubSections();
}

async function showProjectHub() {
  HUB.filter = '';
  HUB.list = await api.projects();
  S.list = HUB.list;
  const tpl = await api.templates();
  HUB.templates = tpl && tpl.ok ? tpl.list : [];
  toggleResPop(false);
  $('#projectHub').classList.remove('hidden');
  renderProjectHub();
}

function hideProjectHub() {
  hideHubMenu();
  $('#projectHub').classList.add('hidden');
}

function hideHubMenu() {
  HUB.menuName = '';
  const menu = $('#hubMenu');
  if (menu) menu.classList.add('hidden');
}

function showHubMenu(name, x, y) {
  const item = HUB.list.find((p) => p.name === name);
  if (!item) return;
  HUB.menuName = name;
  const menu = $('#hubMenu');
  menu.innerHTML = `
    <div class="hub-menu-item" data-hub-menu="open">打开工程</div>
    <div class="hub-menu-item" data-hub-menu="duplicate">复制工程</div>
    <div class="hub-menu-sep"></div>
    <div class="hub-menu-item danger" data-hub-menu="delete">删除工程</div>`;
  menu.classList.remove('hidden');
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
}

async function refreshHubList() {
  HUB.list = await api.projects();
  S.list = HUB.list;
  // 历史里已经删掉的工程，顺手从标签栏摘掉，避免留下打不开的死标签。
  const alive = new Set(HUB.list.map((x) => x.name));
  TABS.items = TABS.items.filter((x) => alive.has(x.name));
  if (TABS.active && !alive.has(TABS.active)) {
    TABS.active = '';
    if (S.project && !alive.has(S.project.name)) S.project = null;
  }
  saveTabStrip(); renderTabs();
  renderHubSections();
  const shell = $('#projectHub .hub-shell');
  if (shell) {
    const counts = shell.querySelectorAll('.hub-footer span');
    if (counts[1]) counts[1].textContent = `${HUB.list.length} 个历史工程`;
    if (counts[2]) counts[2].textContent = `${HUB.templates.length} 个模版`;
  }
}

async function openHubProject(name) {
  const p = await api.load(name);
  if (!p) {
    await refreshHubList();
    return toast('找不到文件：' + name, 6000);
  }
  await enterWorkspace(p);
  toast('已打开工程「' + p.name + '」');
}

async function deleteHubProject(name) {
  const item = HUB.list.find((p) => p.name === name) || {};
  const msg = item.missing
    ? `「${name}」的文件已经找不到，仍然移除这条历史记录？`
    : `确定删除工程「${name}」？工程 JSON 会从磁盘删除，这个操作不能撤销。`;
  if (!(await confirmBox('删除工程', msg))) return;
  const r = await api.remove(name);
  TABS.items = TABS.items.filter((x) => x.name !== name);
  if (TABS.active === name) {
    TABS.active = '';
    if (S.project && S.project.name === name) S.project = null;
    saveTabStrip(); renderTabs();
    $('#taskTabs').classList.add('hidden');
  }
  if (r && r.missing) toast('找不到文件：' + name + '，已移除这条历史记录', 5000);
  else toast('已删除工程「' + name + '」', 4000);
  await refreshHubList();
}

async function duplicateHubProject(name) {
  const r = await api.duplicateProject(name);
  if (!r || r.ok === false) {
    await refreshHubList();
    return toast('找不到文件：' + name, 5000);
  }
  await refreshHubList();
  toast(`已复制为「${r.name}」`, 4000);
}

async function hubUseTemplate(id) {
  const got = await api.templateGet(id);
  if (!got || got.ok === false) return toast('读取模版失败：' + ((got && got.error) || '未知错误'), 5000);
  if (S.project && !(await confirmBox('从模版新建工程', `用「${got.name}」新建工程并开一个新标签？当前工程会先保存，原标签不会被覆盖。`))) return;
  if (S.project && !(await flushAndSave('套用模版'))) return toast('当前工程保存失败，已取消新建', 5000);
  const p = got.project;
  p.name = uniqueProjectName(got.name || p.name);
  p.taskType = p.taskType || 'mixed';
  const w = await api.save(p);
  if (w && w.ok === false) return toast('新工程保存失败：' + (w.error || ''), 5000);
  await enterWorkspace((w && w.project) || p);
  toast(`已从模版「${got.name}」新建「${p.name}」`, 4500);
}

async function hubNewBlank(kind) {
  return newTaskFlow(kind);
}

async function enterWorkspace(p, opts) {
  if (S.view === 'studio' && studioDirty) {
    const ok = await saveStudioToProject('打开工程');
    if (!ok) {
      toast('前端画布没有同步成功，先停留在当前工程', 5000);
      return false;
    }
  }
  hideProjectHub();
  S.project = p;
  S.res = null;
  S.genDir = '';
  S.testCounts = null;
  if (!TASK_KINDS[S.project.taskType]) S.project.taskType = 'mixed';
  $('#projectName').value = S.project.name;
  $('#taskKind').value = taskKindOf(S.project);
  S.cat = (p.categories[0] || {}).id || '';
  S.selId = (p.interfaces[0] || {}).id || '';
  S.mode = 'grid'; S.tab = 'tables'; S.tableKey = ''; S.routeId = '';
  S.problems = (await api.validate(p)).errors || [];
  S.view = 'api';
  S.studioProject = null; studioLoaded = false; studioDirty = false;
  if (!S.help) S.help = await api.help();
  tabSyncProject(S.project);
  renderTabs();
  applyTaskMode();
  if (taskKindOf(S.project) === 'frontend') setView('studio');
  else setView('api');
  if (TABS.items.length > 1) renderTabs();
  return true;
}

$('#projectHub').addEventListener('click', async (e) => {
  const win = e.target.closest('[data-hub-win]');
  if (win) return;
  const del = e.target.closest('[data-hub-del]');
  if (del) { e.stopPropagation(); return deleteHubProject(del.dataset.hubDel); }
  const tpl = e.target.closest('[data-hub-tpl]');
  if (tpl) return hubUseTemplate(tpl.dataset.hubTpl);
  const card = e.target.closest('[data-hub-open]');
  if (card) return openHubProject(card.dataset.hubOpen);
});

$('#projectHub').addEventListener('contextmenu', (e) => {
  const card = e.target.closest('[data-hub-open]');
  if (!card) return;
  e.preventDefault();
  showHubMenu(card.dataset.hubOpen, e.clientX, e.clientY);
});

$('#hubMenu').addEventListener('click', async (e) => {
  const item = e.target.closest('[data-hub-menu]');
  if (!item || !HUB.menuName) return;
  const name = HUB.menuName;
  hideHubMenu();
  if (item.dataset.hubMenu === 'open') return openHubProject(name);
  if (item.dataset.hubMenu === 'duplicate') return duplicateHubProject(name);
  if (item.dataset.hubMenu === 'delete') return deleteHubProject(name);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#hubMenu') && !e.target.closest('[data-hub-open]')) hideHubMenu();
});
window.addEventListener('blur', hideHubMenu);

/* ---------------- 启动 ---------------- */
(async function boot() {
  bindWindowControls();
  let startupToastDone = false;
  const applyStartupReport = async (report) => {
    try {
      S.services = await api.services();
      if (S.project) { renderRibbon(); renderSide(); }
    } catch (e) { /* 启动页还没完成时忽略 */ }
    if (report && !startupToastDone) {
      startupToastDone = true;
      if (report.conflicts && report.conflicts.length) {
        const text = report.conflicts.map((c) => `${c.label} ${c.from}→${c.to}`).join('，');
        toast(`端口被占用，已自动避让：${text}`, 7000);
      }
      if (report.errors && report.errors.length) toast(`启动时有 ${report.errors.length} 项需要留意，右侧运行环境会保留状态`, 7000);
    }
  };
  try { api.onStartupReport((report) => applyStartupReport(report)); } catch (e) { /* 旧 preload 时忽略 */ }
  try {
    const b = await api.boot();
    S.list = b.list;
    S.services = b.services;
    S.settings = b.settings;
    try { S.pluginInfo = await api.pluginSummary(); } catch (e) { S.pluginInfo = { list: [], commands: [], hooks: [] }; }
    try { S.runtimes = await api.runtimes(); } catch (e) { S.runtimes = []; }
    try { await applyStartupReport(await api.startupReport()); } catch (e) { /* 启动报告不存在时忽略 */ }
    let bootTheme = S.settings.theme || {};
    if (isLegacyDefaultTheme(bootTheme)) {
      try {
        bootTheme = await api.theme(themeDefaults());
        S.settings.theme = bootTheme;
      } catch (e) {
        bootTheme = themeDefaults();
      }
    }
    applyTheme(bootTheme);
    S.help = await api.help();

    const wanted = new URLSearchParams(location.search).get('project');
    const openFile = new URLSearchParams(location.search).get('openFile') || new URLSearchParams(location.search).get('openYxpn');
    loadTabStrip();
    let direct = null;
    let openStudio = false;
    if (wanted) direct = await api.load(wanted);
    if (openFile && /\.yxpp$/i.test(openFile)) {
      const r = await api.importYxppPath(openFile);
      if (r && r.ok) {
        const yxppName = String((r.yxpp && r.yxpp.name) || '').trim();
        const hit = (S.list || []).find((p) => !p.missing && yxppName && (p.name === yxppName || (p.frontend && p.frontend.name === yxppName)));
        let base;
        if (hit) {
          // 已有同名工程：只更新前端绑定，绝不覆盖它的接口和表。
          base = await api.load(hit.name);
          base.frontend = r.yxpp;
          base.frontendPath = openFile;
          await api.save(base);
          toast(`已打开「${base.name}」的前端工程，后端接口保持不变`, 4000);
        } else {
          base = await api.seed();
          base.name = uniqueProjectName(yxppName || '前端工程');
          base.description = '从 .yxpp 打开的前端工程（空白后端）';
          base.interfaces = [];
          base.functions = [];
          base.frontend = r.yxpp;
          base.frontendPath = openFile;
          await api.save(base);
          toast(`已从前端工程新建「${base.name}」`, 4000);
        }
        direct = base;
        openStudio = true;
      } else {
        toast('前端工程打不开：' + ((r && r.error) || '未知错误'), 5000);
      }
    } else if (openFile) {
      const r = await api.importYxpnPath(openFile);
      if (r && r.ok) {
        direct = r.project;
        await api.save(direct);
        toast(`已从工程包打开「${direct.name}」`, 4000);
      } else {
        toast('工程包打不开：' + ((r && r.error) || '未知错误'), 5000);
      }
    }

    if (direct) {
      TABS.items = []; TABS.active = '';
      await enterWorkspace(direct);
      if (openStudio) setView('studio');
    } else {
      // 启动先看工程历史，不自动恢复上次的一堆标签，避免误以为工程都还开着。
      TABS.items = []; TABS.active = ''; saveTabStrip();
      $('#taskTabs').classList.add('hidden');
      if (wanted) toast('找不到文件：' + wanted, 6000);
      await showProjectHub();
    }

    setInterval(async () => {
      if (!S.project) return;
      if ($('#drawer').classList.contains('hidden')) {
        const detailsOpen = !!(document.querySelector('#sideTop .side-details') && document.querySelector('#sideTop .side-details').open);
        S.services = await api.services();
        renderRibbon();
        await sampleResources();
        renderSide();
        if (detailsOpen) {
          const d = document.querySelector('#sideTop .side-details');
          if (d) d.open = true;
        }
      }
    }, 4000);
  } catch (e) {
    document.body.innerHTML = `<pre class="p-4">启动失败：${esc(e && e.message || e)}</pre>`;
  }
})();
