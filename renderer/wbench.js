'use strict';

const api = window.icb;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const S = {
  project: null,
  list: [],
  services: null,
  settings: null,
  cat: '',
  mode: 'grid',
  selId: null,
  tab: 'tables',
  tableKey: '',
  routeId: '',
  help: null,
  genDir: '',
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
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.2 2.4c-.4.3-.5.7-.5 1.1M8 11.6v.2"/>',
  page: '<path d="M3 2h7l3 3v9H3z"/><path d="M6 6h4M6 9h4M6 12h3"/>',
  package: '<path d="M8 2l6 3v6l-6 3-6-3V5z"/><path d="M2 5l6 3 6-3M8 8v6"/>',
};
const icon = (k) => `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square">${I[k] || I.page}</svg>`;

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
  box.classList.remove('hidden');
  box.innerHTML = `<div class="bg-white border border-neutral-900 overflow-auto" style="width:${width}px;max-width:96vw;max-height:${maxHeight}">${html}</div>`;
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
  { title: '基础信息', hint: '名字、分类、路径前缀' },
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
  const types = ['bigint', 'int', 'smallint', 'tinyint', 'bool', 'decimal', 'float', 'double', 'varchar', 'char', 'text', 'longtext', 'datetime', 'date', 'json'];
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

function newIfaceGuide(initialCat) {
  const cats = (S.project.categories || []).slice();
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
    const shell = `<div class="flex flex-col text-[12px]" style="height:620px;max-height:82vh">
      <div class="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-neutral-300 bg-white">
        <div>
          <div class="text-[14px] font-semibold">新建接口 · 创建引导</div>
          <div class="text-[11px] text-neutral-500 mt-0.5">先配置，最后确认；取消不会改动当前工程</div>
        </div>
        <button class="ml-auto btn thin" id="guideClose">关闭</button>
      </div>
      <div class="flex-1 min-h-0 flex">
        <div id="guideRail" class="w-[176px] shrink-0 border-r border-neutral-300 bg-neutral-50"></div>
        <div id="guideBody" class="flex-1 min-w-0 overflow-auto p-5"></div>
      </div>
      <div class="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-neutral-300 bg-white">
        <span id="guideErr" class="text-[11px] text-red-700 flex-1 min-w-0"></span>
        <span id="guidePos" class="text-[11px] text-neutral-500 mono"></span>
        <button class="btn thin" id="guidePrev">上一步</button>
        <button class="btn solid" id="guideNext">下一步</button>
        <button class="btn solid" id="guideCreate">确认创建</button>
      </div>
    </div>`;
    modal(shell, mount, { width: 780, maxHeight: '84vh' });

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
        rail.innerHTML = GUIDE_STEPS.map((s, i) => {
          const active = i === state.step;
          const passed = i < state.step;
          return `<div class="px-3 py-3 border-b border-neutral-200 ${active ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700'}">
            <div class="flex items-center gap-2">
              <span class="w-5 h-5 inline-flex items-center justify-center border ${active ? 'border-white' : 'border-neutral-400'} ${passed ? 'bg-neutral-200 text-neutral-900' : ''} text-[10px] mono">${passed ? '✓' : i + 1}</span>
              <span class="font-semibold">${s.title}</span>
            </div>
            <div class="mt-1 pl-7 text-[10px] ${active ? 'text-neutral-300' : 'text-neutral-500'}">${s.hint}</div>
          </div>`;
        }).join('');
      }

      function fieldPreview() {
        const p = guideFields(state.fieldText);
        if (p.errors.length) return `<div class="text-[11px] text-red-700 mt-2">${esc(p.errors[0])}</div>`;
        if (!p.fields.length) return `<div class="text-[11px] text-neutral-500 mt-2">不填业务字段：只保留 id、created_at、updated_at。</div>`;
        return `<div class="mt-2 flex flex-wrap gap-1">${p.fields.map((f) => `<span class="px-1.5 py-0.5 border border-neutral-300 bg-neutral-50 mono text-[10px]">${esc(f.name)} · ${esc(f.type)}</span>`).join('')}</div>`;
      }

      function renderBody() {
        if (state.step === 0) {
          body.innerHTML = `
            <div class="text-[13px] font-semibold">第一步 · 基础信息</div>
            <div class="text-[11px] text-neutral-500 mt-1 mb-4">这些内容会出现在接口列表、文档和生成的路由前缀里。</div>
            <label class="block mb-1 font-medium">接口名称 <span class="text-red-700">*</span></label>
            <input id="guideName" class="w-full border border-neutral-900 px-2 py-1.5 mb-1" value="${esc(state.name)}" placeholder="例如：商品、订单、会员">
            <div class="text-[10px] text-neutral-500 mb-4">当前工程里不能重名。</div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block mb-1 font-medium">分类</label>
                <select id="guideCat" class="w-full border border-neutral-900 px-2 py-1.5">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === state.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              </div>
              <div>
                <label class="block mb-1 font-medium">路径前缀</label>
                <div class="flex items-stretch border border-neutral-900">
                  <span class="px-2 py-1.5 bg-neutral-100 text-neutral-500 border-r border-neutral-300 mono text-[11px]">/api</span>
                  <input id="guidePrefix" class="flex-1 min-w-0 px-2 py-1.5 mono" value="${esc(state.prefix)}" placeholder="/v1/products">
                </div>
              </div>
            </div>
            <div class="text-[10px] text-neutral-500 mt-1 mb-4">前缀可留空；最终地址 = /api + 前缀 + 路由路径。</div>
            <label class="block mb-1 font-medium">一句话说明</label>
            <input id="guideComment" class="w-full border border-neutral-900 px-2 py-1.5" value="${esc(state.comment)}" placeholder="例如：商品的上架、库存与价格维护">
          `;
          const name = body.querySelector('#guideName');
          name.focus();
          name.select();
          const sync = () => read();
          body.querySelectorAll('#guideName,#guidePrefix,#guideComment').forEach((el) => el.addEventListener('input', sync));
          body.querySelector('#guideCat').addEventListener('change', sync);
        } else if (state.step === 1) {
          body.innerHTML = `
            <div class="text-[13px] font-semibold">第二步 · 主表</div>
            <div class="text-[11px] text-neutral-500 mt-1 mb-4">接口会自动带上一张主表，表键固定为 main。</div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block mb-1 font-medium">主表名</label>
                <input id="guideTable" class="w-full border border-neutral-900 px-2 py-1.5 mono" value="${esc(state.tableName)}" placeholder="留空自动生成">
                <div class="text-[10px] text-neutral-500 mt-1">表名要全局唯一，只能用字母、数字、下划线。</div>
              </div>
              <div>
                <label class="block mb-1 font-medium">表注释</label>
                <input id="guideTableComment" class="w-full border border-neutral-900 px-2 py-1.5" value="${esc(state.tableComment)}" placeholder="例如：商品主表">
              </div>
            </div>
            <div class="mt-4">
              <label class="block mb-1 font-medium">初始业务字段</label>
              <div class="text-[10px] text-neutral-500 mb-2">每行一个，格式：字段名 类型 注释。系统已自动加入 id、created_at、updated_at。</div>
              <textarea id="guideFields" rows="7" class="w-full border border-neutral-900 px-2 py-1.5 mono" placeholder="title varchar 标题&#10;price decimal 价格">${esc(state.fieldText)}</textarea>
              <div id="guideFieldPreview">${fieldPreview()}</div>
              <div class="flex flex-wrap gap-1 mt-2">${GUIDE_PRESETS.map((p, i) => `<button type="button" class="btn thin" data-guide-preset="${i}">+ ${esc(p.comment)}</button>`).join('')}</div>
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
            <div class="text-[13px] font-semibold">第三步 · 路由</div>
            <div class="text-[11px] text-neutral-500 mt-1 mb-4">选择要生成的基础路由，创建后仍可逐条修改脚本和路径。</div>
            <div class="border border-neutral-300 divide-y divide-neutral-200">
              ${GUIDE_ROUTE_DEFS.map((r) => `<label class="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-neutral-50">
                <input type="checkbox" data-guide-route value="${r.key}" ${state.routeKinds.includes(r.key) ? 'checked' : ''}>
                <span class="w-14 shrink-0 mono text-[10px] px-1 py-0.5 border border-neutral-400 text-center">${r.method}</span>
                <span class="flex-1 min-w-0">
                  <span class="font-medium">${r.name}</span>
                  <span class="mono text-[11px] text-neutral-500 ml-2">${esc('/api' + guideBasePath(state.prefix) + routePath(r).replace(':table', t))}</span>
                  <span class="block text-[10px] text-neutral-500 mt-0.5">${r.desc}</span>
                </span>
              </label>`).join('')}
            </div>
            <div class="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label class="block mb-1 font-medium">接口鉴权</label>
                <select id="guideAuth" class="w-full border border-neutral-900 px-2 py-1.5">
                  <option value="none" ${state.authMode === 'none' ? 'selected' : ''}>公开，不校验 token</option>
                  <option value="write" ${state.authMode === 'write' ? 'selected' : ''}>写操作需要 token</option>
                  <option value="all" ${state.authMode === 'all' ? 'selected' : ''}>全部需要 token</option>
                </select>
              </div>
              <div class="border border-neutral-300 bg-neutral-50 p-2 text-[11px] text-neutral-600">
                已选 <b id="guideRouteCount">${state.routeKinds.length}</b> 条路由；列表与详情默认启用 60 秒缓存。
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
            <div class="text-[13px] font-semibold">第四步 · 确认创建</div>
            <div class="text-[11px] text-neutral-500 mt-1 mb-4">下面只是预览，点「确认创建」之前不会写入工程。</div>
            <div class="border border-neutral-900">
              <div class="grid grid-cols-[120px_1fr] text-[12px]">
                <div class="px-3 py-2 bg-neutral-100 border-b border-r border-neutral-300 text-neutral-600">接口</div><div class="px-3 py-2 border-b border-neutral-300 font-medium">${esc(state.name)}</div>
                <div class="px-3 py-2 bg-neutral-100 border-b border-r border-neutral-300 text-neutral-600">分类</div><div class="px-3 py-2 border-b border-neutral-300">${esc(category ? category.name : state.categoryId)}</div>
                <div class="px-3 py-2 bg-neutral-100 border-b border-r border-neutral-300 text-neutral-600">路径前缀</div><div class="px-3 py-2 border-b border-neutral-300 mono">${esc(base || '（无）')}</div>
                <div class="px-3 py-2 bg-neutral-100 border-b border-r border-neutral-300 text-neutral-600">主表</div><div class="px-3 py-2 border-b border-neutral-300 mono">${esc(state.tableName || '自动生成')} · main</div>
                <div class="px-3 py-2 bg-neutral-100 border-b border-r border-neutral-300 text-neutral-600">业务字段</div><div class="px-3 py-2 border-b border-neutral-300 mono text-[11px]">${parsed.fields.length ? parsed.fields.map((f) => esc(f.name)).join(' / ') : '无（仅 id 与时间戳）'}</div>
                <div class="px-3 py-2 bg-neutral-100 border-b border-r border-neutral-300 text-neutral-600">路由</div><div class="px-3 py-2 border-b border-neutral-300">${state.routeKinds.length} 条 · ${esc(authText)}</div>
                <div class="px-3 py-2 bg-neutral-100 border-r border-neutral-300 text-neutral-600">示例地址</div><div class="px-3 py-2 mono text-[11px]">${esc('/api' + base + (state.routeKinds.includes('list') ? '/' + (state.tableName || '主表名') : '/...'))}</div>
              </div>
            </div>
            <div class="mt-4 border border-neutral-300 bg-neutral-50 p-3 text-[11px] text-neutral-600">
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
    S.problems = r.problems || [];
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

/* ---------------- 渲染入口 ---------------- */
function render() {
  $('#projectName').value = S.project.name;
  renderRibbon();
  renderWorkspace();
  renderSheets();
  renderSide();
}

function renderRibbon() {
  const svc = S.services || { items: [], ports: {} };
  const infra = svc.items.filter((x) => x.id !== 'server');
  const server = svc.items.find((x) => x.id === 'server');
  const up = infra.filter((x) => x.running).length;
  $('#ribbon').innerHTML = `
  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('seed', 'new', '新建', '重置为示例工程')}
    ${rb('open', 'open', '打开', '打开已有工程')}
    ${rb('save', 'save', '保存', '保存工程')}
  </div><div class="lbl">文件</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('newIface', 'iface', '新建', '在当前分类新建接口')}
    ${rb('dupIface', 'copy', '复制', '复制当前接口')}
    ${rb('delIface', 'trash', '删除', '删除当前接口')}
  </div><div class="lbl">接口</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('addTable', 'table', '加表', '给当前接口加一张表')}
    ${rb('addField', 'field', '加字段', '给当前表加字段')}
    ${rb('ddl', 'sql', 'DDL', '查看建表语句')}
  </div><div class="lbl">表结构</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('check', 'check', '校验', '校验全部脚本')}
    ${rb('preview', 'sql', '预览', '把脚本里的 SQL 展开看看')}
    ${rb('test', 'play', '测试', '发送请求到生成的服务')}
  </div><div class="lbl">脚本</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('deployUpdate', 'check', '更新', '保存并重新生成前后端，重启生成服务')}
    ${rb(server && server.running ? 'stopServer' : 'launchWeb', server && server.running ? 'stop' : 'play', server && server.running ? '停止' : '启动', server && server.running ? '停止生成服务' : '生成当前工程、启动服务并打开网页主页')}
    <div class="flex items-center gap-1 px-1 text-[10px] text-neutral-500" title="数据库 / 缓存 / 对象存储运行状态"><span class="dot ${up ? 'on' : 'off'}"></span>${up}/${infra.length}</div>
    ${rb('home', 'console', '打开主页', '在浏览器打开当前工程的网页主页')}
    ${rb('microExport', 'package', '微服务', '按接口或分类导出独立服务')}
  </div><div class="lbl">服务</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('grid', 'grid', '表格', '回到 Excel 表格视图')}
    ${rb('help', 'help', '帮助', '语法与函数手册')}
  </div><div class="lbl">视图</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('exportProject', 'package', '导出工程', '导出完整源码工程，IDEA 可直接打开')}
    ${rb('exportYxpn', 'save', '导出包', '导出 .yxpn 工程包（含运行时与文档）')}
    ${rb('importYxpn', 'open', '导入包', '打开 .yxpn 工程包')}
    ${rb('docs', 'page', '文档', '预览自动生成的 API 文档')}
  </div><div class="lbl">工程</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('templates', 'page', '模版库', '内置商城/视频/博客/工单/预约，一键套用')}
    ${rb('saveTemplate', 'save', '存模版', '把当前工程存成自己的模版')}
    ${rb('ifaceLib', 'field', '接口库', '内置/自存接口，一键插入当前工程')}
    ${rb('saveIface', 'save', '存接口', '把当前接口存入接口库，同名会被拒绝')}
    ${rb('plugins', 'field', '插件', '插件启停、安装、信任目录')}
  </div><div class="lbl">模版与插件</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('ai', 'iface', 'AI 生成', '用 AI 对话框生成接口工程')}
    ${rb('monitor', 'console', '监控', '实时看请求日志与健康状态')}
    ${rb('settings', 'field', '设置', 'AI 接口、模型参数与本地服务端口')}
    ${rb('assoc', 'page', '关联', '把 .yxpn 设为默认打开')}
    ${rb('newWindow', 'open', '新窗口', '为当前工程再开一个窗口')}
  </div><div class="lbl">扩展</div></div>`;
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
    </div>`;
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

function renderSide() {
  const svc = S.services;
  if (!svc) return;
  const counts = {
    ifaces: S.project.interfaces.length,
    tables: S.project.interfaces.reduce((n, i) => n + i.tables.length, 0),
    routes: S.project.interfaces.reduce((n, i) => n + i.routes.length, 0),
    funcs: (S.project.functions || []).length,
  };
  $('#sideTop').innerHTML = `
  <div class="side-sect">
    <h4>内置服务</h4>
    ${svc.bundled === false ? `<div class="text-[11px] text-red-600 mb-1">安装包缺少服务文件：${esc((svc.missing || []).join('、'))}</div>` : ''}
    ${svc.items.filter((x) => x.id !== 'server').map((it) => `
      <div class="flex items-center gap-2 py-1">
        <span class="dot ${it.running ? 'on' : 'off'}"></span>
        <span class="flex-1">${esc(it.name)}</span>
        <span class="mono text-[11px] text-neutral-500">${it.port}</span>
        <button class="btn thin" data-svc="${it.id}" data-on="${it.running ? '0' : '1'}">${it.running ? '停' : '启'}</button>
      </div>`).join('')}
    <div class="text-[11px] text-neutral-500 mt-2">端口：MySQL ${svc.ports.mysql} · Redis ${svc.ports.redis} · S3 ${svc.ports.s3}</div>
  </div>

  <div class="side-sect">
    <h4>工程统计</h4>
    <div class="grid grid-cols-2 gap-1 text-[12px]">
      <div>接口 <b>${counts.ifaces}</b></div><div>表 <b>${counts.tables}</b></div>
      <div>路由 <b>${counts.routes}</b></div><div>自定义函数 <b>${counts.funcs}</b></div>
    </div>
  </div>

  <div class="side-sect">
    <h4>校验</h4>
    ${S.problems.length ? `<div class="text-[12px] space-y-1">${S.problems.slice(0, 12).map((p) => `<div class="border-l-2 border-neutral-900 pl-2">${esc(p)}</div>`).join('')}${S.problems.length > 12 ? `<div class="text-neutral-500">还有 ${S.problems.length - 12} 条…</div>` : ''}</div>` : '<div class="text-[12px] text-neutral-600">没有发现问题。</div>'}
  </div>

  <div class="side-sect">
    <h4>生成目录</h4>
    <div class="mono text-[11px] break-all">${esc(S.genDir || '还没有生成')}</div>
  </div>

  <div class="side-sect">
    <h4>操作提示</h4>
    <div class="text-[11px] text-neutral-600 leading-5">
      双击表格行进入接口编辑。<br>
      每个接口可挂多张表、多个库。<br>
      每条路由是一段脚本，SQL 用 {{...}} 取参数。<br>
      生成后点“启动服务”跑生成的服务。
    </div>
  </div>`;

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
    ['tables', '表结构'],
    ['routes', '路由脚本'],
    ['docs', '接口文档'],
    ['cache', '缓存与存储'],
    ['upstream', '上游'],
    ['permissions', '权限'],
    ['objects', '对象表'],
    ['test', '测试'],
    ['export', '生成导出'],
  ];
  $('#workspace').innerHTML = `
  <div class="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-neutral-300">
    <button class="btn thin" data-action="grid">← 表格</button>
    <input id="ifName" class="border border-neutral-300 px-2 py-1 text-[13px] font-semibold w-48" value="${esc(it.name)}">
    <select id="ifCat" class="border border-neutral-300 px-1 py-1 text-[12px]">
      ${S.project.categories.map((c) => `<option value="${c.id}" ${c.id === it.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select>
    <input id="ifBase" class="border border-neutral-300 px-2 py-1 mono text-[12px] w-36" placeholder="/orders" value="${esc(it.basePath)}" title="接口统一前缀，可留空">
    <input id="ifComment" class="border border-neutral-300 px-2 py-1 text-[12px] flex-1 min-w-32" placeholder="备注" value="${esc(it.comment)}">
    <button class="btn thin" data-action="delIface">删除接口</button>
  </div>
  <div class="h-9 shrink-0 flex items-center border-b border-neutral-300 px-2 text-[12px]">
    ${tabs.map(([k, label]) => `<div class="tabbtn ${S.tab === k ? 'on' : ''}" data-tab="${k}">${label}</div>`).join('')}
    <div class="ml-auto text-neutral-500 mono">${it.tables.length} 表 · ${it.routes.length} 路由</div>
  </div>
  <div class="flex-1 min-h-0 overflow-hidden" id="tabBody"></div>`;

  const body = $('#tabBody');
  if (S.tab === 'tables') body.innerHTML = tabTables(it);
  else if (S.tab === 'routes') body.innerHTML = tabRoutes(it);
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
  if (S.tab === 'docs') bindDocs(it);
  if (S.tab === 'cache') bindCache(it);
  if (S.tab === 'upstream') bindUpstream(it);
  if (S.tab === 'permissions') bindPermissions(it);
  if (S.tab === 'objects') bindObjects(it);
  if (S.tab === 'test') bindTest(it);
  if (S.tab === 'export') bindExport(it);
}

/* ----- 表结构 ----- */
function tabTables(it) {
  const t = tableOfIface(it, S.tableKey);
  if (!t) return '<div class="p-4">没有表。</div>';
  const st = storeOf(t);
  const typeOptions = (cur) => ['bigint', 'int', 'smallint', 'tinyint', 'bool', 'decimal', 'float', 'double', 'varchar', 'char', 'text', 'longtext', 'datetime', 'date', 'json']
    .map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${k}</option>`).join('');
  return `
  <div class="h-full flex flex-col">
    <div class="shrink-0 border-b border-neutral-200">
      <div class="flex items-center gap-2 px-2 py-1.5 min-w-0">
        <div id="tableTabs" class="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 py-0.5" title="表多时可横向滚动，滚轮也可">
          ${it.tables.map((x) => `<div class="pill shrink-0 cursor-pointer truncate ${x.key === t.key ? 'bg-neutral-900 text-white' : 'bg-white'}" style="max-width:210px" title="${esc(x.key)} · ${esc(x.name)}" data-table="${x.key}">${esc(x.key)} · ${esc(x.name)}</div>`).join('')}
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
          <tr data-field-row="${i}">
            <td class="rownum">${i + 1}</td>
            <td><input class="cell-in mono" data-fi="${i}" data-fk="name" value="${esc(f.name)}"></td>
            <td><select class="cell-in mono" data-fi="${i}" data-fk="type">${typeOptions(f.type)}</select></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="pk" ${f.pk ? 'checked' : ''}></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="autoIncrement" ${f.autoIncrement ? 'checked' : ''}></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="nullable" ${f.nullable ? 'checked' : ''}></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="search" ${f.search ? 'checked' : ''}></td>
            <td><input type="checkbox" data-fi="${i}" data-fk="hidden" ${f.hidden ? 'checked' : ''}></td>
            <td><input class="cell-in mono" data-fi="${i}" data-fk="default" value="${esc(f.default)}"></td>
            <td><input class="cell-in" data-fi="${i}" data-fk="comment" value="${esc(f.comment)}"></td>
            <td class="text-center"><button class="btn thin" data-del="${i}">×</button></td>
          </tr>`).join('')}
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
    const on = bar.querySelector('.bg-neutral-900');
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
      el.oninput = () => { f[k] = el.value; scheduleSave(); if (k === 'name') renderSide(); };
      if (el.tagName === 'SELECT') el.onchange = el.oninput;
    }
  });
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
  const r = activeIface() && activeIface().routes.find((x) => x.id === S.routeId);
  if (r) { r.script = ta.value; scheduleSave(); }
  $('#rStatus').textContent = `${ta.value.split(/\n/).length} 行`;
}

function showScriptGuide() {
  modal(`<div class="p-4 text-[12px] leading-6" style="max-height:78vh;overflow:auto">
    <div class="font-semibold text-[13px] mb-1">脚本怎么写</div>
    <div class="text-neutral-500 mb-3">一条路由一段脚本，按顺序执行；不需要写分号之外的 JS 语法。</div>
    <table class="help-grid">
      <thead><tr><th style="width:220px">写法</th><th>作用</th></tr></thead>
      <tbody>
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
  return `
  <div class="h-full flex min-h-0">
    <div class="w-60 shrink-0 border-r border-neutral-300 overflow-auto">
      ${it.routes.map((x) => `
        <div class="px-2 py-2 border-b border-neutral-200 cursor-pointer ${x.id === r.id ? 'bg-neutral-100' : ''}" data-route="${x.id}">
          <div class="flex items-center gap-2"><span class="pill">${esc(x.method)}</span><span class="font-medium truncate">${esc(x.name)}</span></div>
          <div class="mono text-[11px] text-neutral-500 truncate">${esc(x.path)}</div>
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
      <div class="shrink-0 px-3 py-2 border-b border-neutral-200 text-[12px]">
        <div class="flex items-center gap-2 min-w-0">
          <input id="rName" class="border border-neutral-300 px-1 py-0.5 w-36 shrink-0" value="${esc(r.name)}">
          <select id="rMethod" class="border border-neutral-300 px-1 py-0.5 mono shrink-0">
            ${['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => `<option ${m === r.method ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <input id="rPath" class="border border-neutral-300 px-1 py-0.5 mono flex-1 min-w-24" value="${esc(r.path)}">
          <label class="flex items-center gap-1 shrink-0"><input type="checkbox" id="rCache" ${r.cache.enabled ? 'checked' : ''}>Redis 缓存</label>
        </div>
        <div class="flex items-center gap-2 mt-1 min-w-0">
          <button class="btn thin shrink-0 whitespace-nowrap" data-action="toggleAssist">脚本提示</button>
          <span class="text-[10px] text-neutral-500 truncate">Ctrl+空格 开关右侧助手；试运行会请求当前已启动的服务</span>
          <div class="ml-auto flex items-center gap-1 shrink-0">
            <button class="btn thin whitespace-nowrap" data-action="checkOne">校验</button>
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
        <textarea id="rScript" class="flex-1 min-w-0 border-0 p-3 monoarea outline-none" spellcheck="false">${esc(r.script)}</textarea>
        ${scriptAssistHtml(it)}
      </div>
      <div class="shrink-0 border-t border-neutral-300 px-3 py-1 text-[11px] text-neutral-600 flex gap-3">
        <span>LET / QUERY / EXEC / IF / ELSE / END / FOREACH / RETURN / LOG</span>
        <span class="ml-auto" id="rStatus">${r.script.split(/\n/).length} 行</span>
      </div>
    </div>
  </div>`;
}

function bindRoutes(it) {
  const r = it.routes.find((x) => x.id === S.routeId) || it.routes[0];
  $$('[data-route]').forEach((el) => { el.onclick = () => { S.routeId = el.dataset.route; renderWorkspace(); }; });
  $('#rName').oninput = (e) => { r.name = e.target.value; scheduleSave(); };
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
  }
  const tryBtn = $('[data-action="tryRoute"]');  if (tryBtn) tryBtn.onclick = () => {
    const sampleBody = (r.docs && r.docs.requestExample) || (['POST', 'PUT', 'PATCH'].includes(r.method) ? '{\n  \n}' : '');
    modal(`<div class="p-4 text-[12px]">
      <div class="font-semibold mb-1">试运行 ${esc(r.method)} ${esc(r.path)}</div>
      <div class="text-neutral-500 mb-3">请求会发到当前启动服务的 /api 前缀；路径参数 :id 会取下方路径参数里的 id。</div>
      <div class="flex gap-3">
        <div class="flex-1">路径/查询参数 JSON<textarea id="tryQuery" rows="7" class="cell-in monoarea w-full">{"id":"1"}</textarea></div>
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
  $('#rScript').oninput = (e) => {
    r.script = e.target.value;
    $('#rStatus').textContent = `${e.target.value.split(/\n/).length} 行`;
    scheduleSave();
    clearTimeout(bindRoutes._t);
    bindRoutes._t = setTimeout(async () => {
      const c = await api.checkScript(r.script);
      $('#rStatus').textContent = c.ok ? `${r.script.split(/\n/).length} 行 · 语法通过` : c.problems.join('；');
    }, 900);
  };
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
          <td class="mono">${esc(r.method)}</td>
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
    <div class="help-h">接口级文档（会写进 OpenAPI 的 tag 描述）</div>
    <table class="help-grid">
      <tbody>
        <tr><th style="width:120px">一句话说明</th><td><input class="cell-in" data-df="summary" value="${esc(d.summary || '')}" placeholder="例如：订单创建与查询"></td></tr>
        <tr><th>详细描述</th><td><textarea class="cell-in monoarea" rows="3" data-df="description" placeholder="这个接口负责什么、有哪些表、有什么约束">${esc(d.description || '')}</textarea></td></tr>
        <tr><th>负责人</th><td class="flex gap-2"><input class="cell-in" data-df="owner" value="${esc(d.owner || '')}" placeholder="张三">
          <span class="text-neutral-500">版本</span><input class="cell-in" data-df="version" value="${esc(d.version || '1.0.0')}" style="width:100px"></td></tr>
        <tr><th>标签</th><td><input class="cell-in" data-df="tags" value="${esc((d.tags || []).join(', '))}" placeholder="用户, 登录（逗号分隔）"></td></tr>
        <tr><th>请求示例</th><td><textarea class="cell-in monoarea" rows="3" data-df="requestExample" placeholder='{"username":"alice"}'>${esc(d.requestExample || '')}</textarea></td></tr>
        <tr><th>响应示例</th><td><textarea class="cell-in monoarea" rows="3" data-df="responseExample" placeholder='{"ok":true}'>${esc(d.responseExample || '')}</textarea></td></tr>
        <tr><th>备注</th><td><textarea class="cell-in monoarea" rows="2" data-df="notes" placeholder="内部说明，不会公开到 /docs">${esc(d.notes || '')}</textarea></td></tr>
      </tbody>
    </table>

    <div class="help-h flex items-center gap-2">每条路由的文档
      <span class="text-neutral-500 font-normal">填写后自动出现在 /docs 与 openapi.json</span>
      <button class="btn thin ml-auto" data-action="docs">预览 OpenAPI</button>
    </div>
    <table class="help-grid">
      <thead><tr><th style="width:110px">路由</th><th>说明</th><th>请求示例</th><th>响应示例</th></tr></thead>
      <tbody>
        ${it.routes.map((r) => {
          const rd = r.docs || {};
          return `<tr data-route-doc="${r.id}">
            <td><span class="pill">${esc(r.method)}</span><div class="mono text-[11px] text-neutral-500 break-all">${esc(r.path)}</div></td>
            <td><textarea class="cell-in" rows="2" data-rd="summary" placeholder="这条路由做什么">${esc(rd.summary || r.summary || '')}</textarea>
              <textarea class="cell-in monoarea" rows="2" data-rd="description" placeholder="参数、错误码">${esc(rd.description || '')}</textarea></td>
            <td><textarea class="cell-in monoarea" rows="3" data-rd="requestExample">${esc(rd.requestExample || '')}</textarea></td>
            <td><textarea class="cell-in monoarea" rows="3" data-rd="responseExample">${esc(rd.responseExample || '')}</textarea></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="text-neutral-500 mt-2">提示：写操作建议写上成功与失败两种响应示例，其他人看文档就能直接对接。</div>
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
        if (el.dataset.rd === 'summary') r.summary = el.value;
        scheduleSave();
      };
    });
  });
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
          <td>${esc(r.name)}</td><td class="mono">${esc(r.method)}</td>
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

function tabTest(it) {
  const server = ((S.services && S.services.items) || []).find((x) => x.id === 'server') || {};
  const running = !!server.running;
  return `
  <div class="h-full flex flex-col p-3 gap-2 text-[12px] overflow-auto">
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

/* ---------------- 帮助 ---------------- */
function renderHelp() {
  $('#workspace').innerHTML = `
  <div class="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-neutral-300">
    <button class="btn thin" data-action="grid">← 表格</button>
    <b>帮助 · 脚本语法</b>
    <span class="text-neutral-500 text-[11px]">生成的服务器里跑的就是这一套解释器</span>
    <span class="ml-auto flex gap-1">
      <button class="btn thin" data-action="openHelpUrl">打开服务 /help</button>
      <button class="btn thin" data-action="openDocsUrl">打开 /docs</button>
    </span>
  </div>
  <div class="flex-1 overflow-auto p-4 text-[12px] leading-6">
    <div class="help-h">0. 在这里能做什么</div>
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="border border-neutral-300 p-3"><b>1. 建表</b><div class="text-neutral-600">在接口里加一张或多张表，字段名、类型、主键、自增、可空、可查直接在表格里改。</div></div>
      <div class="border border-neutral-300 p-3"><b>2. 生成接口</b><div class="text-neutral-600">列表、详情、新建、更新、删除、附件、上游转发、对象表、抓取都可以一键加路由。</div></div>
      <div class="border border-neutral-300 p-3"><b>3. 写脚本</b><div class="text-neutral-600">每条路由一段脚本：查库、判断、事务、返回 JSON；右侧脚本助手会给出常用写法和字段。</div></div>
      <div class="border border-neutral-300 p-3"><b>4. 联调</b><div class="text-neutral-600">在“路由”页点“试运行”发请求；底部控制台看服务输出、数据库和 Redis 日志。</div></div>
      <div class="border border-neutral-300 p-3"><b>5. 导出</b><div class="text-neutral-600">生成 Node / Python / Go / Java 工程，根目录 config.json 改端口、数据库等参数，不用改源码。</div></div>
    </div>

    <div class="help-h">1. 一条路由 = 一段脚本</div>
<pre class="monoarea border border-neutral-300 p-3 bg-neutral-50">LET $exists = QUERY SELECT id FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($exists.rows) &gt; 0
  RETURN 409 { "ok": false, "error": "USER_EXISTS" };
ELSE
  LET $ins = EXEC INSERT INTO {{t:main}} (username, password_hash) VALUES ({{body.username}}, HASH('sha256', {{body.password}}));
  RETURN 201 { "ok": true, "id": $ins.insertId };
END</pre>

    <div class="help-h">2. 语句</div>
    <table class="help-grid">
      <thead><tr><th style="width:240px">写法</th><th>作用</th></tr></thead>
      <tbody>
        <tr><td class="mono">LET $x = QUERY SQL;</td><td>查询，结果放 $x.rows</td></tr>
        <tr><td class="mono">LET $x = EXEC SQL;</td><td>增删改，结果放 $x.affectedRows / $x.insertId</td></tr>
        <tr><td class="mono">LET $x = 表达式;</td><td>算一个值，比如 LET $h = HASH('sm3', {{body.name}});</td></tr>
        <tr><td class="mono">IF 条件 … ELSEIF … ELSE … END</td><td>分支</td></tr>
        <tr><td class="mono">FOREACH $row IN $rows.rows … END</td><td>循环（最多 500 条）</td></tr>
        <tr><td class="mono">RETURN 200 { … };</td><td>直接返回，第二段是 JSON 表达式</td></tr>
        <tr><td class="mono">LOG 表达式;</td><td>写日志到响应里</td></tr>
      </tbody>
    </table>

    <div class="help-h">3. SQL 占位符</div>
    <table class="help-grid">
      <thead><tr><th style="width:260px">占位符</th><th>含义</th></tr></thead>
      <tbody>
        <tr><td class="mono">{{t:main}} / {{t:item}}</td><td>表名（:后面是表键）</td></tr>
        <tr><td class="mono">{{columns:main}}</td><td>全部可见字段列表</td></tr>
        <tr><td class="mono">{{insertColumns:main}} / {{insertValues:main}}</td><td>INSERT 的列与 ? 值</td></tr>
        <tr><td class="mono">{{updateSet:main}}</td><td>UPDATE SET，只取请求体里出现的字段</td></tr>
        <tr><td class="mono">{{where:main}}</td><td>按 query 拼条件，支持 field__gte / __like / __in / __between，还有 keyword</td></tr>
        <tr><td class="mono">{{orderBy:main}}</td><td>?sort=amount:desc 或默认主键倒序</td></tr>
        <tr><td class="mono">{{limit}} {{offset}} {{page}} {{pageSize}}</td><td>分页</td></tr>
        <tr><td class="mono">{{idColumn:main}}</td><td>主键列名</td></tr>
        <tr><td class="mono">{{body.x}} {{query.x}} {{path.x}}</td><td>请求参数（自动 ? 参数化）</td></tr>
        <tr><td class="mono">{{id}} {{now}} {{uuid}} {{queryHash}}</td><td>常用值</td></tr>
        <tr><td class="mono">{{objectKey}} {{objectUrl}} {{filename}} {{size}}</td><td>上传文件信息</td></tr>
      </tbody>
    </table>

    <div class="help-h">4. 内置函数</div>
    <div class="grid grid-cols-2 gap-x-6 gap-y-1 mono text-[11px]">
      ${(S.help ? S.help.builtins : ['HASH', 'MD5', 'SHA1', 'SHA256', 'SM3', 'SM4_ENC', 'SM4_DEC', 'SUBSTR', 'LEFT', 'RIGHT', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'CONCAT', 'REPLACE', 'SPLIT', 'JOIN', 'NOW', 'TODAY', 'UUID', 'BASE64_ENC', 'BASE64_DEC', 'URL_ENC', 'URL_DEC', 'INT', 'FLOAT', 'STR', 'ROUND', 'ABS', 'COALESCE', 'MASK', 'JSON_GET', 'JSON_STR', 'RAND_INT', 'IF', 'IN', 'CONTAINS', 'START_WITH', 'END_WITH']).map((n) => `<div>${esc(n)}</div>`).join('')}
    </div>

    <div class="help-h">5. 自定义函数</div>
    <div>在“生成导出”页加一行，比如 <span class="mono">MASK_PHONE(v) → CONCAT(SUBSTR(v,0,3),"****",SUBSTR(v,7,4))</span>，之后脚本里直接 MASK_PHONE({{body.phone}})。</div>

    <div class="help-h">6. 导出成别语言</div>
    <div>生成目录里的 <span class="mono">export/js|java|go</span>：JS 是逐句翻译的完整实现，Java/Go 是路由 + SQL 骨架，接上各自的数据库驱动即可。</div>

    <div class="help-h">7. 键盘</div>
    <div><span class="kbd">Ctrl+K</span> 全局搜索 · <span class="kbd">Ctrl+S</span> 保存 · 表格里双击行进入接口</div>
  </div>`;
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
async function act(name, el) {
  const it = activeIface();
  if (name === 'save') return save();
  if (name === 'scriptGuide') return showScriptGuide();
  if (name === 'toggleAssist') {
    const a = $('#scriptAssist');
    if (a) a.classList.toggle('hidden');
    return;
  }
  if (name === 'seed') {
    if (!(await confirmBox('重置工程', '会用示例工程覆盖当前内容，先保存的话请点取消。'))) return;
    S.project = await api.seed();
    await api.save(S.project);
    S.cat = S.project.categories[0].id; S.selId = S.project.interfaces[0].id; S.mode = 'grid';
    render(); toast('已重置为示例工程');
    return;
  }
  if (name === 'open') {
    await save(true);
    await showProjectHub();
    return;
  }
  if (name === 'newIface') {
    const cat = S.project.categories.find((c) => c.id === S.cat) || S.project.categories[0];
    const cfg = await newIfaceGuide(cat.id);
    if (!cfg) return;
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
    const t = tableOfIface(it, S.tableKey);
    const n = await ask('字段名', 'new_field');
    if (!n) return;
    t.fields.push({ name: n, type: 'varchar', comment: '', pk: false, autoIncrement: false, nullable: true, search: true, hidden: false, query: true, writable: true, default: '' });
    scheduleSave(); renderWorkspace();
    return;
  }
  if (name === 'addRoute' && it) {
    const kind = ($('#newRouteKind') || {}).value || 'custom';
    const route = newRoute(it, kind);
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
  if (name === 'check') {
    S.problems = (await api.validate(S.project)).errors;
    renderSide();
    toast(S.problems.length ? `有 ${S.problems.length} 处问题` : '脚本都通过了');
    return;
  }
  if (name === 'checkOne' && it) {
    const r = it.routes.find((x) => x.id === S.routeId);
    const c = await api.checkScript(r.script);
    toast(c.ok ? '这条脚本没问题' : c.problems.slice(0, 2).join('；'), 4000);
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
    if (S.mode !== 'editor') S.mode = 'grid';
    S.tab = 'export';
    render();
    toast(`已生成 ${g.files.length} 个文件${g.warnings && g.warnings.length ? `（插件提示 ${g.warnings.length} 条）` : ''}`, 3500);
    return;
  }
  if (name === 'deployUpdate') { return deployUpdate(); }
  if (name === 'launchWeb' || name === 'startServer') { return launchWeb(); }
  if (name === 'stopServer') { await api.stopServer(); S.services = await api.services(); renderRibbon(); renderSide(); renderWorkspace(); toast('已停止网页服务'); return; }
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
      <div class="flex justify-end gap-2"><button class="btn thin" id="epCancel">取消</button><button class="btn solid" id="epGo">导出</button></div></div>`, (m) => {
      m.querySelector('#epCancel').onclick = closeModal;
      m.querySelector('#epGo').onclick = async () => {
        const errors = { pages: !!m.querySelector('#epPages').checked, detail: !!m.querySelector('#epDetail').checked };
        closeModal();
        const r = await api.exportProject(S.project, { errors });
        if (!r) return;
        if (!r.ok) return toast('导出失败：' + String(r.error || '').slice(0, 160), 6000);
        S.exportDir = r.dir;
        modal(`<div class="p-4">
          <div class="text-[13px] font-semibold mb-2">工程已导出 · ${r.files.length} 个文件</div>
          <div class="text-[11px] text-neutral-500 mb-1 mono break-all">${esc(r.dir)}</div>
          <div class="text-[11px] text-neutral-600 mb-3">已带 <span class="mono">.idea</span> 工程配置和「启动接口服务」运行配置；错误页：${errors.pages ? '开' : '关'}，500 详情：${errors.detail ? '开' : '关'}。</div>
          <div class="text-[11px] text-neutral-500 mb-4">先 <span class="mono">npm install</span>，再在 IDEA 里运行；数据库、Redis、S3 地址在 <span class="mono">.env</span>。</div>
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
  if (name === 'saveIface') return showSaveIface();
  if (name === 'plugins') return showPlugins();
  if (name === 'monitor') return showMonitor();
  if (name === 'settings') return showSettings();
  if (name === 'theme') return showTheme();
  if (name === 'newWindow') { await api.newWindow(S.project.name); toast('已打开新窗口，可直接编辑同一工程'); return; }
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
    <div class="text-[11px] text-neutral-500 mt-2">套用会替换当前编辑的工程（先保存的话点取消）。内置模版只读，另存一份后可以随意改。</div>
  </div>`, (root) => {
    root.querySelector('#tplClose').onclick = closeModal;
    root.querySelector('#tplSave').onclick = () => { closeModal(); showSaveTemplate(); };
    root.querySelectorAll('[data-tpl-apply]').forEach((b) => {
      b.onclick = async () => {
        const got = await api.templateGet(b.dataset.tplApply);
        if (!got.ok) return toast('读取失败：' + got.error);
        if (!(await confirmBox('套用模版', `用「${got.name}」替换当前工程？当前未保存的修改会丢。`))) return;
        const keepName = S.project.name;
        S.project = got.project;
        S.project.name = keepName;
        S.cat = (S.project.categories[0] || {}).id || '';
        S.selId = (S.project.interfaces[0] || {}).id || '';
        S.mode = 'grid'; S.tab = 'tables'; S.problems = [];
        await api.save(S.project);
        closeModal(); render(); toast(`已套用模版「${got.name}」，记得生成服务`);
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
async function showSaveIface() {
  const it = activeIface();
  if (!it) return toast('当前没有可保存的接口');
  const name = await ask('存入接口库', it.name, '只保存当前接口（表、路由、文档、脚本）；接口库内不允许重名');
  if (!name) return;
  const desc = it.docs && (it.docs.summary || it.docs.description) || `${it.tables.length} 表 · ${it.routes.length} 路由`;
  const r = await api.ifaceLibrarySave({ name, iface: it, sourceProject: S.project.name, description: desc, tags: [S.project.name] });
  if (!r.ok) return toast('保存失败：' + String(r.error || '').slice(0, 180), 6500);
  toast(`已存入接口库「${r.name}」`);
}

async function showIfaceLibrary() {
  const r = await api.ifaceLibrary();
  if (!r.ok) return toast('读取接口库失败：' + r.error);
  const row = (x) => {
    const kind = x.kind === 'builtin' ? '内置' : '我的';
    const source = x.source || '接口库';
    return `<div class="lib-row flex items-center gap-3 p-2 border-b border-neutral-200" data-lib-row data-kind="${x.kind}" data-name="${esc(x.name)}" data-source="${esc(source)}">
      <div class="w-8 h-8 shrink-0 border border-neutral-900 flex items-center justify-center mono text-[10px]">${kind}</div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2"><b class="text-[12px]">${esc(x.name)}</b>
          <span class="text-[10px] text-neutral-500 mono">${x.counts.tables} 表 · ${x.counts.routes} 路由</span></div>
        <div class="text-[10px] text-neutral-500 truncate">${esc(source)}${x.description ? ' · ' + esc(x.description) : ''}</div>
      </div>
      <button class="btn thin shrink-0" data-lib-add="${esc(x.id)}">插入</button>
      ${x.kind === 'user' ? `<button class="btn thin shrink-0" data-lib-del="${esc(x.id)}">删除</button>` : ''}
    </div>`;
  };
  modal(`<div class="p-4">
    <div class="flex items-center gap-2 mb-3"><b class="text-[13px]">接口库</b>
      <span class="pill">${r.list.length} 个接口</span>
      <span class="text-[11px] text-neutral-500">内置 ${r.list.filter((x) => x.kind === 'builtin').length} 个 · 自存不重名</span>
      <button class="btn thin ml-auto" id="libSave">存当前接口</button>
      <button class="btn thin" id="libClose">关闭</button></div>
    <div class="flex items-center gap-2 mb-2">
      <input id="libQ" class="border border-neutral-300 px-2 py-1 text-[12px] w-64" placeholder="搜接口名 / 来源">
      <button class="btn thin" data-lib-kind="all">全部</button>
      <button class="btn thin" data-lib-kind="builtin">内置</button>
      <button class="btn thin" data-lib-kind="user">我的</button>
      <span id="libCount" class="text-[11px] text-neutral-500 ml-auto"></span>
    </div>
    <div id="libList" class="border border-neutral-300 max-h-[64vh] overflow-auto">
      ${r.list.map(row).join('')}
    </div>
    <div class="text-[11px] text-neutral-500 mt-2">插入只追加到当前工程，不覆盖已有接口；同名接口、表名、basePath 会自动加序号避重。</div>
  </div>`, (root) => {
    let kind = 'all';
    const apply = () => {
      const q = String(root.querySelector('#libQ').value || '').trim().toLowerCase();
      let shown = 0;
      root.querySelectorAll('[data-lib-row]').forEach((el) => {
        const hitKind = kind === 'all' || el.dataset.kind === kind;
        const hay = `${el.dataset.name} ${el.dataset.source}`.toLowerCase();
        const hit = hitKind && (!q || hay.includes(q));
        el.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      root.querySelector('#libCount').textContent = `显示 ${shown} / ${r.list.length}`;
    };
    root.querySelector('#libClose').onclick = closeModal;
    root.querySelector('#libSave').onclick = () => { closeModal(); showSaveIface(); };
    root.querySelector('#libQ').oninput = apply;
    root.querySelectorAll('[data-lib-kind]').forEach((b) => {
      b.onclick = () => { kind = b.dataset.libKind; apply(); };
    });
    root.querySelectorAll('[data-lib-add]').forEach((b) => {
      b.onclick = async () => {
        const got = await api.ifaceLibraryInsert(S.project, b.dataset.libAdd);
        if (!got.ok) return toast('插入失败：' + String(got.error || '').slice(0, 200), 6500);
        S.project = got.project;
        S.cat = got.category;
        S.selId = got.ifaceId;
        S.mode = 'editor'; S.tab = 'tables'; S.problems = [];
        await api.save(S.project);
        closeModal(); render();
        toast(`已插入「${got.name}」${got.renamed ? '（同名，已自动加序号）' : ''}`);
      };
    });
    root.querySelectorAll('[data-lib-del]').forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmBox('删除接口', '确定从接口库删除这个自存接口？不影响当前工程。'))) return;
        const d = await api.ifaceLibraryRemove(b.dataset.libDel);
        if (!d.ok) return toast(d.error || '删除失败');
        closeModal(); showIfaceLibrary();
      };
    });
    apply();
  });
}

/* ---------------- 插件 / Defender ---------------- */
async function showPlugins() {
  const r = await api.plugins();
  if (!r.ok) return toast('读取插件失败');
  modal(`<div class="p-4">
    <div class="flex items-center gap-2 mb-3"><b class="text-[13px]">插件</b>
      <span class="pill">${r.list.length} 个</span>
      <button class="btn thin ml-auto" id="plInstall">安装插件</button>
      <button class="btn thin" id="plClose">关闭</button></div>
    <div class="border border-neutral-300 max-h-[46vh] overflow-auto">
      ${r.list.map((p) => `<div class="flex items-center gap-3 p-2 border-b border-neutral-200">
        <label class="flex items-center gap-2"><input type="checkbox" data-pl="${esc(p.id)}" ${p.enabled ? 'checked' : ''}>
          <b>${esc(p.name)}</b></label>
        <span class="pill">${esc(p.id)}</span><span class="text-[11px] text-neutral-500 mono">v${esc(p.version)}</span>
        <span class="text-[11px] text-neutral-500">${p.source === 'builtin' ? '内置' : '我的'}</span>
        <div class="text-[12px] text-neutral-600 flex-1 truncate" title="${esc(p.description)}">${esc(p.description)}</div>
        ${p.source === 'user' ? `<button class="btn thin" data-pl-del="${esc(p.id)}">卸载</button>` : ''}
      </div>`).join('') || '<div class="p-4 text-neutral-500">还没有插件。点“安装插件”选一个带 plugin.json 的文件夹。</div>'}
    </div>
    <div class="text-[11px] text-neutral-500 mt-2">插件在主进程里执行，等同于本地脚本，只安装你信任的。启用的插件会在生成服务时注入函数/接口/脚本改写。</div>

    <div class="help-h">Windows Defender 信任目录</div>
    <div class="flex items-center gap-2">
      <button class="btn thin" id="plTrust">加入排除项</button>
      <span class="text-[11px] text-neutral-500">工程目录、runtime/node、node_modules，并排除 node.exe / electron.exe</span>
    </div>
    <div class="mono text-[11px] text-neutral-600 mt-2 flex gap-3">
      <button class="btn thin" id="plOpenRepo">打开内置插件目录</button>
      <button class="btn thin" id="plOpenUser">打开我的插件目录</button>
    </div>
    <pre id="plOut" class="monoarea text-[11px] border border-neutral-300 p-2 mt-2 max-h-24 overflow-auto whitespace-pre-wrap hidden"></pre>
  </div>`, (root) => {
    const out = root.querySelector('#plOut');
    root.querySelector('#plClose').onclick = closeModal;
    root.querySelectorAll('[data-pl]').forEach((cb) => {
      cb.onchange = async () => {
        const d = await api.pluginEnable(cb.dataset.pl, cb.checked);
        if (!d.ok) toast(d.error || '切换失败'); else toast(`${cb.checked ? '已启用' : '已禁用'} ${cb.dataset.pl}`);
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
      closeModal(); showPlugins(); toast('已安装 ' + d.id);
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
  return {
    id: Math.random().toString(16).slice(2, 10),
    key: kind, name: meta[0], method: meta[1], path: meta[2], auth: false,
    roles: [],
    proxy: { enabled: kind === 'proxy', upstream: '', target: '', stripPrefix: true, forwardHeaders: true, timeout: 15000 },
    script: scripts[kind] || scripts.custom,
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

/* ---------------- 事件绑定 ---------------- */
document.addEventListener('click', (e) => {
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

/* ---------------- 主题 ---------------- */
function applyTheme(t) {
  const th = t || {};
  const root = document.documentElement.style;
  root.setProperty('--cb-head', th.head || '#ffffff');
  root.setProperty('--cb-headtext', th.headText || '#111111');
  root.setProperty('--cb-accent', th.accent || '#111111');
  root.setProperty('--cb-footer', th.footer || '#f4f4f4');
  root.setProperty('--cb-font', th.font || '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif');
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

function showSettings() {
  const ai = aiDefaults();
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
          <button class="btn thin w-full mt-2" id="setTheme">主题、页眉页脚与字体</button>
          <div class="text-[10px] text-neutral-500 mt-2">语言在顶部语言菜单切换，选择后界面会立即重载。</div>
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
  });
}

function showTheme() {
  const t = { head: '#ffffff', headText: '#111111', accent: '#111111', footer: '#f4f4f4', font: '', ...(S.settings.theme || {}) };
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
      <button class="btn thin" id="thReset">恢复黑白</button>
      <button class="btn thin" id="thClose">取消</button>
      <button class="btn solid" id="thSave">应用</button>
    </div>
  </div>`, (root) => {
    const read = () => ({
      head: root.querySelector('#thHead').value,
      headText: root.querySelector('#thHeadText').value,
      accent: root.querySelector('#thAccent').value,
      footer: root.querySelector('#thFooter').value,
      font: root.querySelector('#thFont').value,
    });
    root.querySelector('#thClose').onclick = closeModal;
    root.querySelector('#thReset').onclick = async () => {
      const next = await api.theme({ head: '#ffffff', headText: '#111111', accent: '#111111', footer: '#f4f4f4', font: '' });
      S.settings.theme = next; applyTheme(next); closeModal(); toast('已恢复黑白');
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

function studioLoadProject(project, binding) {
  if (!project) return;
  const language = String((S.settings && S.settings.language) || 'zh-CN').toLowerCase();
  const lang = language.startsWith('en') ? 'en' : 'zh';
  postToStudio({ type: 'cbs:yxpp:load', project, binding: binding || 'bound', lang, at: studioLastAt });
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
  if (S.view === 'studio' && next === 'api' && studioDirty) saveStudioToProject('切换视图');
  S.view = next;
  const studio = S.view === 'studio';
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
  return [item.name, item.description, ...(item.tags || []), ...(item.tables || [])].join(' ').toLowerCase();
}

function uniqueProjectName(base) {
  const names = new Set([...(S.list || []), ...(HUB.list || [])].map((x) => String(x.name || '').toLowerCase()));
  let next = String(base || '新工程').trim() || '新工程';
  let n = 2;
  while (names.has(next.toLowerCase())) next = `${String(base || '新工程').trim()} ${n++}`;
  return next;
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
    return `<article class="hub-project ${p.missing ? 'missing' : ''}" data-hub-open="${esc(p.name)}">
      <button class="hub-x" data-hub-del="${esc(p.name)}" title="删除工程「${esc(p.name)}」" aria-label="删除工程">×</button>
      <div class="hub-project-top">
        <span class="hub-badge">${p.missing ? 'LOST' : current ? 'CURRENT' : 'PROJECT'}</span>
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
      <div class="hub-brand">ClickBuild<span>PROJECT / HISTORY</span></div>
      <div class="hub-top-note">先选择工程或模版</div>
      <div class="hub-search">
        <input id="hubSearch" placeholder="搜索工程 / 模版 / 标签…" value="${esc(HUB.filter)}" autocomplete="off">
        <button class="btn thin" id="hubNew">新建空白工程</button>
      </div>
      <button class="hub-win" data-hub-win="minimize" title="最小化">—</button>
      <button class="hub-win" data-hub-win="maximize" title="最大化">□</button>
      <button class="hub-win close" data-hub-win="close" title="关闭">×</button>
    </div>
    <div class="hub-body">
      <div class="hub-kicker">PROJECT HUB / 01</div>
      <div class="hub-heading">工程历史</div>
      <div class="hub-sub">打开应用先在这里选择历史工程，选中之后才进入工作台。历史文件、模版和复制入口都在这一页。</div>
      <div id="hubSections"></div>
    </div>
    <div class="hub-footer"><span>CLICKBUILD / PROJECT HUB</span><span>${HUB.list.length} 个历史工程</span><span>${HUB.templates.length} 个模版</span></div>
  </div>`;

  const input = $('#hubSearch');
  input.addEventListener('input', () => { HUB.filter = input.value; renderHubSections(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { HUB.filter = ''; input.value = ''; renderHubSections(); }
  });
  $('#hubNew').onclick = () => hubNewBlank();
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
  if (S.project && !(await confirmBox('套用模版', `用「${got.name}」新建工程并进入工作台？当前工程会先保留在历史里。`))) return;
  const p = got.project;
  p.name = uniqueProjectName(got.name || p.name);
  await api.save(p);
  await enterWorkspace(p);
  toast(`已从模版「${got.name}」新建「${p.name}」`, 4500);
}

async function hubNewBlank() {
  const p = await api.seed();
  p.name = uniqueProjectName('新工程');
  p.description = '空白工程';
  p.interfaces = [];
  delete p.frontend;
  await api.save(p);
  await enterWorkspace(p);
  toast(`已新建「${p.name}」`);
}

async function enterWorkspace(p) {
  if (S.view === 'studio' && studioDirty) saveStudioToProject('打开工程');
  hideProjectHub();
  S.project = p;
  S.cat = (p.categories[0] || {}).id || '';
  S.selId = (p.interfaces[0] || {}).id || '';
  S.mode = 'grid'; S.tab = 'tables'; S.tableKey = ''; S.routeId = '';
  S.problems = (await api.validate(p)).errors || [];
  S.view = 'api';
  S.studioProject = null; studioLoaded = false; studioDirty = false;
  if (!S.help) S.help = await api.help();
  setView('api');
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
  try {
    const b = await api.boot();
    S.list = b.list;
    S.services = b.services;
    S.settings = b.settings;
    try { S.runtimes = await api.runtimes(); } catch (e) { S.runtimes = []; }
    applyTheme(S.settings.theme || {});
    S.help = await api.help();

    const wanted = new URLSearchParams(location.search).get('project');
    const openFile = new URLSearchParams(location.search).get('openFile') || new URLSearchParams(location.search).get('openYxpn');
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
      await enterWorkspace(direct);
      if (openStudio) setView('studio');
    } else {
      if (wanted) toast('找不到文件：' + wanted, 6000);
      await showProjectHub();
    }

    setInterval(async () => {
      if (!S.project) return;
      if ($('#drawer').classList.contains('hidden')) {
        S.services = await api.services();
        renderRibbon();
      }
    }, 4000);
  } catch (e) {
    document.body.innerHTML = `<pre class="p-4">启动失败：${esc(e && e.message || e)}</pre>`;
  }
})();
