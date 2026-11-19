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
  valTimer: null,
  problems: [],
  view: 'api',
  studioProject: null,
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
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms || 2200);
}

function modal(html, mount) {
  const box = $('#modal');
  box.classList.remove('hidden');
  box.innerHTML = `<div class="bg-white border border-neutral-900 w-[640px] max-h-[80vh] overflow-auto">${html}</div>`;
  if (mount) mount(box.firstElementChild);
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

const ifaceOf = (id) => S.project.interfaces.find((i) => i.id === id);
const activeIface = () => ifaceOf(S.selId) || S.project.interfaces.find((i) => i.categoryId === S.cat) || S.project.interfaces[0];

function tableOfIface(iface, key) {
  if (!iface) return null;
  return iface.tables.find((t) => t.key === key) || iface.tables[0];
}

function scheduleSave() {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(save, 700);
}

async function save(silent) {
  if (!S.project) return;
  const r = await api.save(S.project);
  S.problems = r.problems || [];
  renderSide();
  if (!silent) toast(r.problems.length ? `已保存，但有 ${r.problems.length} 处问题` : '已保存');
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
    ${rb('startAll', 'play', '启动', '启动 MariaDB / Redis / RustFS')}
    ${rb('stopAll', 'stop', '停止', '停止三台本地服务')}
    ${rb('console', 'console', '控制台', '打开生成服务的控制台')}
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
    ${rb('plugins', 'field', '插件', '插件启停、安装、信任目录')}
  </div><div class="lbl">模版与插件</div></div>

  <div class="ribbon-group"><div class="flex gap-1">
    ${rb('ai', 'iface', 'AI 生成', '用 AI 对话框生成接口工程')}
    ${rb('monitor', 'console', '监控', '实时看请求日志与健康状态')}
    ${rb('theme', 'field', '主题', '改页眉/页脚/强调色/字体')}
    ${rb('assoc', 'page', '关联', '把 .yxpn 设为默认打开')}
    ${rb('newWindow', 'open', '新窗口', '为当前工程再开一个窗口')}
  </div><div class="lbl">扩展</div></div>`;
}

function renderSheets() {
  const tabs = S.project.categories.map((c) => `<div class="sheet ${S.mode === 'grid' && c.id === S.cat ? 'active' : ''}" data-sheet="${c.id}" title="双击重命名">${esc(c.name)}<span class="ml-2 text-neutral-400">${S.project.interfaces.filter((i) => i.categoryId === c.id).length}</span></div>`).join('');
  $('#sheetbar').innerHTML = `${tabs}
    <div class="sheet text-neutral-600" data-action="addCat">＋</div>
    <div class="ml-auto flex items-center gap-2 pr-2 text-[11px] text-neutral-500">
      <span class="mono">${S.project.interfaces.length} 接口</span>
      <span class="mono">${S.project.interfaces.reduce((n, i) => n + i.tables.length, 0)} 表</span>
      <span class="mono">${S.project.interfaces.reduce((n, i) => n + i.routes.length, 0)} 路由</span>
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
  if (S.mode === 'editor' && activeIface()) return renderEditor();
  if (S.mode === 'help') return renderHelp();
  return renderGrid();
}

function renderGrid() {
  const cat = S.project.categories.find((c) => c.id === S.cat) || S.project.categories[0];
  const rows = S.project.interfaces.filter((i) => i.categoryId === cat.id);
  const head = ['A 接口名', 'B 表', 'C 字段', 'D 路由', 'E 备注'];
  $('#workspace').innerHTML = `
  <div class="h-9 shrink-0 flex items-center gap-3 px-3 border-b border-neutral-300 text-[12px]">
    <b>${esc(cat.name)}</b>
    <span class="text-neutral-500">${rows.length} 个接口 · 双击行进入编辑</span>
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
          <tr data-iface="${i.id}" class="${i.id === S.selId ? 'sel' : ''}">
            <td class="rownum">${n + 1}</td>
            <td class="font-medium">${esc(i.name)}</td>
            <td class="mono text-[12px]">${i.tables.map((t) => esc(t.name)).join(', ')}</td>
            <td class="mono text-[12px]">${i.tables.reduce((s, t) => s + t.fields.length, 0)}</td>
            <td class="mono text-[12px]">${i.routes.length}</td>
            <td class="text-[12px] text-neutral-600 truncate">${esc(i.comment)}</td>
          </tr>`).join('') || `<tr><td class="rownum">1</td><td colspan="5" class="text-neutral-500">这个分类还没有接口，点右上角新建。</td></tr>`}
      </tbody>
    </table>
  </div>`;

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
  if (S.tab === 'test') bindTest(it);
  if (S.tab === 'export') bindExport(it);
}

/* ----- 表结构 ----- */
function tabTables(it) {
  const t = tableOfIface(it, S.tableKey);
  if (!t) return '<div class="p-4">没有表。</div>';
  const typeOptions = (cur) => ['bigint', 'int', 'smallint', 'tinyint', 'bool', 'decimal', 'float', 'double', 'varchar', 'char', 'text', 'longtext', 'datetime', 'date', 'json']
    .map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${k}</option>`).join('');
  return `
  <div class="h-full flex flex-col">
    <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-neutral-200 overflow-x-auto">
      ${it.tables.map((x) => `<div class="pill cursor-pointer ${x.key === t.key ? 'bg-neutral-900 text-white' : 'bg-white'}" data-table="${x.key}">${esc(x.key)} · ${esc(x.name)}</div>`).join('')}
      <button class="btn thin" data-action="addTable">＋ 表</button>
      <span class="ml-auto flex items-center gap-2 text-[11px]">
        表名 <input id="tName" class="border border-neutral-300 px-1 py-0.5 mono w-44" value="${esc(t.name)}">
        库 <input id="tSchema" class="border border-neutral-300 px-1 py-0.5 mono w-28" placeholder="留空=默认库" value="${esc(t.schema)}">
        注释 <input id="tComment" class="border border-neutral-300 px-1 py-0.5 w-40" value="${esc(t.comment)}">
        <button class="btn thin" data-action="delTable">删表</button>
      </span>
    </div>
    <div class="flex-1 overflow-auto">
      <table class="gt">
        <thead><tr><th class="rownum"></th><th>A 字段</th><th>B 类型</th><th>C 主键</th><th>D 自增</th><th>E 可空</th><th>F 搜索</th><th>G 隐藏</th><th>H 默认</th><th>I 注释</th><th style="width:56px">J</th></tr></thead>
        <tbody>
          ${t.fields.map((f, i) => `
          <tr>
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
      <span class="text-neutral-500">表键 <b>${esc(t.key)}</b>，脚本里用 {{columns:${esc(t.key)}}}、{{where:${esc(t.key)}}} 引用这张表。</span>
      <button class="btn thin ml-auto" data-action="ddl">看 DDL</button>
    </div>
  </div>`;
}

function bindTables(it) {
  const t = tableOfIface(it, S.tableKey);
  $$('[data-table]').forEach((el) => { el.onclick = () => { S.tableKey = el.dataset.table; renderWorkspace(); }; });
  const name = $('#tName'); if (name) name.oninput = (e) => { t.name = e.target.value; scheduleSave(); };
  const sc = $('#tSchema'); if (sc) sc.oninput = (e) => { t.schema = e.target.value; scheduleSave(); };
  const cm = $('#tComment'); if (cm) cm.oninput = (e) => { t.comment = e.target.value; scheduleSave(); };
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
        </select>
        <button class="btn thin" data-action="addRoute">＋ 加路由</button>
      </div>
    </div>
    <div class="flex-1 flex flex-col min-w-0">
      <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-neutral-200 text-[12px]">
        <input id="rName" class="border border-neutral-300 px-1 py-0.5 w-36" value="${esc(r.name)}">
        <select id="rMethod" class="border border-neutral-300 px-1 py-0.5 mono">
          ${['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => `<option ${m === r.method ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <input id="rPath" class="border border-neutral-300 px-1 py-0.5 mono flex-1 min-w-24" value="${esc(r.path)}">
        <label class="flex items-center gap-1"><input type="checkbox" id="rCache" ${r.cache.enabled ? 'checked' : ''}>Redis 缓存</label>
        <button class="btn thin" data-action="checkOne">校验</button>
        <button class="btn thin" data-action="preview">预览 SQL</button>
        <button class="btn thin" data-action="delRoute">删除</button>
      </div>
      <textarea id="rScript" class="flex-1 min-h-0 border-0 p-3 monoarea outline-none" spellcheck="false">${esc(r.script)}</textarea>
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
function tabTest(it) {
  return `
  <div class="h-full flex flex-col p-3 gap-2 text-[12px] overflow-auto">
    <div class="flex items-center gap-2">
      <select id="tRoute" class="border border-neutral-300 px-1 py-1 mono">
        ${it.routes.map((r) => `<option value="${r.id}">${esc(r.method)} ${esc(r.path)} · ${esc(r.name)}</option>`).join('')}
      </select>
      <input id="tId" class="border border-neutral-300 px-2 py-1 mono w-32" placeholder=":id 的值">
      <button class="btn thin" data-action="startServer">启动生成服务</button>
      <button class="btn thin" data-action="console">打开控制台</button>
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
}

/* ----- 导出 ----- */
function tabExport(it) {
  return `
  <div class="h-full flex flex-col p-3 gap-3 text-[12px] overflow-auto">
    <div class="help-h">生成服务</div>
    <div class="flex items-center gap-2">
      <button class="btn solid" data-action="generate">生成到 generated/iface</button>
      <button class="btn thin" data-action="exportProject">导出工程（IDEA）</button>
      <button class="btn thin" data-action="startServer">启动服务（端口 ${S.settings.ports.http}）</button>
      <button class="btn thin" data-action="stopServer">停止服务</button>
      <button class="btn thin" data-action="console">打开控制台</button>
    </div>
    <div class="text-[11px] text-neutral-500">导出工程会新建一个独立目录，带 <span class="mono">.idea</span> 配置和启动配置，IDEA 里 File → Open 直接打开。</div>
    <div class="mono text-[11px] break-all">${esc(S.genDir || '还没有生成')}</div>

    <div class="help-h">生成物</div>
    <table class="help-grid">
      <thead><tr><th>文件</th><th>用途</th></tr></thead>
      <tbody>
        <tr><td class="mono">server.js</td><td>启动建库建表、挂路由、执行脚本</td></tr>
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
function searchMatches(q) {
  const list = [];
  const low = q.toLowerCase();
  for (const it of S.project.interfaces) {
    const cat = S.project.categories.find((c) => c.id === it.categoryId);
    const push = (kind, text, extra) => list.push({ id: it.id, kind, text, cat: cat ? cat.name : '', extra });
    if (it.name.toLowerCase().includes(low)) push('接口', it.name, '名称');
    if ((it.comment || '').toLowerCase().includes(low)) push('接口', it.comment, '备注');
    for (const t of it.tables) {
      if (t.name.toLowerCase().includes(low)) push('表', t.name, `表键 ${t.key}`);
      for (const f of t.fields) if (f.name.toLowerCase().includes(low)) push('字段', `${t.name}.${f.name}`, f.type);
    }
    for (const r of it.routes) {
      if ((r.name + ' ' + r.path + ' ' + r.script).toLowerCase().includes(low)) push('路由', `${r.method} ${r.path}`, r.name);
    }
  }
  return list.slice(0, 40);
}

function renderSearch() {
  const q = $('#search').value.trim();
  const panel = $('#searchPanel');
  if (!q) { panel.classList.add('hidden'); return; }
  const rows = searchMatches(q);
  panel.classList.remove('hidden');
  panel.innerHTML = rows.length ? rows.map((r, i) => `
    <div class="result-item px-3 py-2 border-b border-neutral-200 cursor-pointer" data-res="${i}">
      <div class="flex gap-2 items-center"><span class="pill">${esc(r.kind)}</span><span>${esc(r.text)}</span></div>
      <div class="text-[11px] text-neutral-500">${esc(r.cat)} · ${esc(r.extra)}</div>
    </div>`).join('') : '<div class="p-3 text-neutral-500 text-[12px]">没有匹配。</div>';
  panel.querySelectorAll('[data-res]').forEach((el) => {
    el.onclick = () => {
      const r = rows[Number(el.dataset.res)];
      const it = ifaceOf(r.id);
      S.cat = it.categoryId;
      if (r.kind === '路由') {
        const path = r.text.split(' ').slice(1).join(' ');
        const route = it.routes.find((x) => x.path === path) || it.routes[0];
        S.routeId = route.id; S.mode = 'editor'; S.tab = 'routes';
      } else if (r.kind === '表' || r.kind === '字段') {
        const key = (it.tables.find((t) => r.text.startsWith(t.name)) || it.tables[0]).key;
        S.tableKey = key; S.mode = 'editor'; S.tab = 'tables';
      } else openIface(it.id);
      panel.classList.add('hidden');
      $('#search').value = '';
      render();
    };
  });
}

/* ---------------- 动作 ---------------- */
async function act(name, el) {
  const it = activeIface();
  if (name === 'save') return save();
  if (name === 'seed') {
    if (!(await confirmBox('重置工程', '会用示例工程覆盖当前内容，先保存的话请点取消。'))) return;
    S.project = await api.seed();
    await api.save(S.project);
    S.cat = S.project.categories[0].id; S.selId = S.project.interfaces[0].id; S.mode = 'grid';
    render(); toast('已重置为示例工程');
    return;
  }
  if (name === 'open') {
    const list = await api.projects();
    if (!list.length) return toast('还没有保存过的工程');
    modal(`<div class="p-3"><div class="font-semibold mb-2">打开工程</div>
      ${list.map((p, i) => `<div class="py-2 border-b border-neutral-200 cursor-pointer hover:bg-neutral-50" data-open="${i}"><b>${esc(p.name)}</b><div class="text-[11px] text-neutral-500">${p.count} 接口 · ${esc((p.tables || []).slice(0, 3).join(', '))}</div></div>`).join('')}
      </div>`, (root) => {
      root.querySelectorAll('[data-open]').forEach((x) => {
        x.onclick = async () => {
          const p = await api.load(list[Number(x.dataset.open)].name);
          if (p) { S.project = p; S.cat = p.categories[0].id; S.selId = p.interfaces[0] && p.interfaces[0].id; S.mode = 'grid'; closeModal(); render(); toast('已打开 ' + p.name); }
        };
      });
    });
    return;
  }
  if (name === 'newIface') {
    const cat = S.project.categories.find((c) => c.id === S.cat) || S.project.categories[0];
    const n = await ask('新接口名字', '新接口', '会自动生成一张主表和 5 条基础路由');
    if (!n) return;
    const blank = await api.blank({ name: n, categoryId: cat.id });
    S.project.interfaces.push(blank); S.cat = cat.id; S.selId = blank.id;
    openIface(blank.id); scheduleSave(); toast('已新建接口');
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
    let key = safe.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'table';
    while (it.tables.some((t) => t.key === key)) key += '_2';
    it.tables.push({ key, name: safe, schema: '', comment: '', fields: defaultFields() });
    S.tableKey = key; S.tab = 'tables'; scheduleSave(); renderWorkspace();
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
  if (name === 'startServer') {
    if (!S.genDir) { toast('先点“生成服务”'); return; }
    const r = await api.startServer(S.genDir);
    if (r.ok === false) toast(r.error || '启动失败');
    else toast(`服务已启动 :${(S.settings.ports || {}).http}`);
    S.services = await api.services(); renderRibbon(); renderSide();
    return;
  }
  if (name === 'stopServer') { await api.stopServer(); S.services = await api.services(); renderRibbon(); renderSide(); toast('已停止服务'); return; }
  if (name === 'startAll') { await api.startService(''); S.services = await api.services(); renderRibbon(); renderSide(); toast('已启动三台服务'); return; }
  if (name === 'stopAll') { await api.stopService(''); S.services = await api.services(); renderRibbon(); renderSide(); toast('已停止'); return; }
  if (name === 'console') { await api.console(); return; }
  if (name === 'logs') { return showLogs(); }
  if (name === 'addFunc') {
    S.project.functions.push({ name: 'MY_FUNC', params: ['v'], body: 'UPPER(v)' });
    scheduleSave(); renderWorkspace();
    return;
  }
  if (name === 'exportProject') {
    const r = await api.exportProject(S.project);
    if (!r) return;
    if (!r.ok) return toast('导出失败：' + String(r.error || '').slice(0, 160), 6000);
    S.exportDir = r.dir;
    modal(`<div class="p-4">
      <div class="text-[13px] font-semibold mb-2">工程已导出 · ${r.files.length} 个文件</div>
      <div class="text-[11px] text-neutral-500 mb-1 mono break-all">${esc(r.dir)}</div>
      <div class="text-[11px] text-neutral-600 mb-3">已带 <span class="mono">.idea</span> 工程配置和「启动接口服务」运行配置。</div>
      <div class="text-[11px] text-neutral-500 mb-4">先 <span class="mono">npm install</span>，再在 IDEA 里运行；数据库、Redis、S3 地址在 <span class="mono">.env</span>。</div>
      <div class="flex justify-end gap-2">
        <button class="btn thin" id="epOpen">打开目录</button>
        <button class="btn solid" id="epIdea">用 IDEA 打开</button>
      </div></div>`, (m) => {
      m.querySelector('#epOpen').onclick = () => api.openPath(r.dir);
      m.querySelector('#epIdea').onclick = async () => {
        const got = await api.openInIdea(r.dir);
        if (got.ok) { closeModal(); toast('已交给 IntelliJ IDEA 打开', 3500); }
        else { toast(got.error || '没有找到 IDEA，已打开目录', 6000); api.openPath(r.dir); }
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
  if (name === 'plugins') return showPlugins();
  if (name === 'monitor') return showMonitor();
  if (name === 'theme') return showTheme();
  if (name === 'newWindow') { await api.newWindow(S.project.name); toast('已打开新窗口，可直接编辑同一工程'); return; }
  if (name === 'assoc') {
    const r = await api.assocYxpn();
    toast(r.ok ? '已把 .yxpn 关联到本软件，双击工程包就能打开' : '关联失败：' + (r.error || r.out || ''), 5000);
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
        S.project = got.project;
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
      <span class="text-[11px] text-neutral-500">工程目录、runtime\node、node_modules，并排除 node.exe / electron.exe</span>
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

function showLogs() {
  const drawer = $('#drawer');
  drawer.classList.remove('hidden');
  drawer.innerHTML = `
    <div class="h-10 shrink-0 border-b border-neutral-900 flex items-center px-3 gap-2">
      <b class="text-[13px]">运行日志</b>
      <select id="logId" class="border border-neutral-300 px-1 py-0.5 text-[12px]">
        <option value="server">生成的服务</option><option value="mysql">MariaDB</option><option value="redis">Redis</option><option value="s3">RustFS</option>
      </select>
      <button class="btn thin ml-auto" id="logRefresh">刷新</button>
      <button class="btn thin" id="logClose">关闭</button>
    </div>
    <pre id="logBody" class="flex-1 overflow-auto monoarea p-3 whitespace-pre-wrap"></pre>`;
  const load = async () => { $('#logBody').textContent = (await api.logs($('#logId').value)) || '（没有日志）'; };
  $('#logId').onchange = load;
  $('#logRefresh').onclick = load;
  $('#logClose').onclick = () => drawer.classList.add('hidden');
  load();
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
    custom: ['自定义', 'POST', '/custom-' + (it.routes.length + 1)],
  }[kind] || ['自定义', 'POST', '/custom'];
  const scripts = {
    list: 'LET $rows = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} ORDER BY {{orderBy:main}} LIMIT {{limit}} OFFSET {{offset}};\nLET $total = QUERY SELECT COUNT(*) AS total FROM {{t:main}} WHERE {{where:main}};\nRETURN 200 { "rows": $rows.rows, "total": $total.rows[0].total };',
    detail: 'LET $row = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{idColumn:main}} = {{id}} LIMIT 1;\nRETURN 200 { "row": $row.rows[0] };',
    create: 'LET $ins = EXEC INSERT INTO {{t:main}} ({{insertColumns:main}}) VALUES ({{insertValues:main}});\nRETURN 201 { "id": $ins.insertId };',
    update: 'LET $upd = EXEC UPDATE {{t:main}} SET {{updateSet:main}} WHERE {{idColumn:main}} = {{id}};\nRETURN 200 { "changed": $upd.affectedRows };',
    delete: 'LET $del = EXEC DELETE FROM {{t:main}} WHERE {{idColumn:main}} = {{id}};\nRETURN 200 { "deleted": $del.affectedRows };',
    upload: 'EXEC UPDATE {{t:main}} SET {{bindColumn:main}} = {{objectKey}} WHERE {{idColumn:main}} = {{id}};\nRETURN 200 { "key": {{objectKey}}, "url": {{objectUrl}} };',
    custom: '# 自定义脚本\nLET $rows = QUERY SELECT {{columns:main}} FROM {{t:main}} WHERE {{where:main}} LIMIT {{limit}};\nRETURN 200 { "rows": $rows.rows };',
  };
  return {
    id: Math.random().toString(16).slice(2, 10),
    key: kind, name: meta[0], method: meta[1], path: meta[2], auth: false,
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

$('#search').addEventListener('input', renderSearch);
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#searchPanel').classList.add('hidden'); }
  if (e.key === 'Enter') { const first = $('#searchPanel [data-res]'); if (first) first.click(); }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  if (e.key === 'Escape') { closeModal(); $('#searchPanel').classList.add('hidden'); }
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
  modal(`<div class="p-4">
    <div class="flex items-center gap-2 mb-2"><b>AI 生成接口工程</b><span class="pill">模拟 API</span>
      <span class="text-[11px] text-neutral-500 ml-2">说清楚要做哪些业务，表、SQL、路由都会生成</span></div>
    <div id="aiLog" class="border border-neutral-300 bg-neutral-50 p-2 h-[220px] overflow-auto text-[12px] mb-2"></div>
    <textarea id="aiPrompt" class="w-full h-[84px] border border-neutral-900 p-2 mono text-[12px]" placeholder="例如：做一个订单服务，主表订单、明细表，支持增删改查和多表联查；再加用户注册登录，密码用 SM4 存"></textarea>
    <div class="flex items-center gap-2 mt-2">
      <span class="text-[11px] text-neutral-500">会覆盖当前工程，先保存就不用怕</span>
      <button class="btn thin ml-auto" id="aiClose">关闭</button>
      <button class="btn solid" id="aiGo">生成</button>
    </div>
  </div>`, (root) => {
    const log = (s) => { const d = root.querySelector('#aiLog'); d.innerHTML += `<div class="border-b border-neutral-200 py-1">${esc(s)}</div>`; d.scrollTop = d.scrollHeight; };
    root.querySelector('#aiClose').onclick = closeModal;
    root.querySelector('#aiGo').onclick = async () => {
      const prompt = root.querySelector('#aiPrompt').value.trim();
      if (!prompt) return log('先写一句要做什么');
      log(`你：${prompt}`);
      log('AI 正在生成…');
      const r = await api.ai(prompt);
      if (r.error) return log(`失败：${r.error}`);
      log(`AI（${r.mode}）：${r.reply}`);
      S.project = r.project;
      S.cat = (r.project.categories[0] || {}).id || '';
      S.selId = (r.project.interfaces[0] || {}).id || '';
      S.mode = 'grid';
      await api.save(r.project);
      render();
      log('已替换当前工程并保存。点“生成服务”就能跑。');
    };
  });
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
    $('#monRows').innerHTML = rows.map((l) => `<div class="px-3 py-1 border-b border-neutral-200 flex gap-2 items-baseline hover:bg-neutral-50">
      <span class="mono text-[10px] text-neutral-400 w-[62px] shrink-0">${esc((l.time || '').slice(11))}</span>
      <span class="mono text-[10px] w-[52px] shrink-0 ${levelClass(l.level)}">${esc(l.level || 'INFO')}</span>
      <span class="mono text-[10px] w-[46px] shrink-0">${esc(String(l.status || ''))}</span>
      <span class="mono text-[10px] w-[52px] shrink-0 text-neutral-500">${esc(String(l.ms || 0) + 'ms')}</span>
      <span class="flex-1 truncate" title="${esc(l.message)}">${esc(l.message)}</span>
      <span class="mono text-[10px] text-neutral-400 shrink-0">${esc(l.iface || '')}</span>
    </div>`).join('') || '<div class="p-4 text-neutral-500">还没有日志，去“测试”页发个请求试试。</div>';
  }
  $('#monPause').onclick = () => { paused = !paused; $('#monPause').textContent = paused ? '继续' : '暂停'; };
  $('#monClose').onclick = () => { clearInterval(timer); drawer.classList.add('hidden'); drawer.innerHTML = ''; };
  $('#monErr').onchange = tick; $('#monIface').onchange = tick;
  tick();
  timer = setInterval(tick, 2000);
}

/* ---------------- 右键菜单 ---------------- */
function openCtx(x, y, items) {
  const box = $('#ctxmenu');
  box.innerHTML = items.map((it, i) => `<div class="px-3 py-1.5 cursor-pointer hover:bg-neutral-900 hover:text-white" data-ctx="${i}">${esc(it.label)}</div>`).join('');
  box.style.left = Math.min(x, window.innerWidth - 200) + 'px';
  box.style.top = Math.min(y, window.innerHeight - items.length * 30 - 10) + 'px';
  box.classList.remove('hidden');
  box.querySelectorAll('[data-ctx]').forEach((el) => {
    el.onclick = () => { box.classList.add('hidden'); const fn = items[Number(el.dataset.ctx)].run; if (fn) fn(); };
  });
}
document.addEventListener('contextmenu', (e) => {
  const sheet = e.target.closest('#sheetbar .sheet[data-sheet]');
  const row = e.target.closest('#workspace tr[data-iface]');
  const routeEl = e.target.closest('#routeList [data-route], [data-route]');
  if (!sheet && !row && !routeEl) return;
  e.preventDefault();
  const close = () => $('#ctxmenu').classList.add('hidden');
  setTimeout(close, 4000);
  if (row) {
    const iface = S.project.interfaces.find((x) => x.id === row.dataset.iface);
    S.selId = iface.id;
    openCtx(e.clientX, e.clientY, [
      { label: '打开接口', run: () => openIface(iface.id) },
      { label: '复制接口（自动编号）', run: () => act('dupIface') },
      { label: '导出此接口为微服务', run: () => showMicroExport(iface.id) },
      { label: '重命名', run: async () => { const n = await ask('接口名', iface.name); if (n) { iface.name = n; scheduleSave(); render(); } } },
      { label: '删除接口', run: () => act('delIface') },
    ]);
  } else if (sheet) {
    const cat = S.project.categories.find((c) => c.id === sheet.dataset.sheet);
    openCtx(e.clientX, e.clientY, [
      { label: '重命名分类', run: async () => { const n = await ask('分类名', cat.name); if (n) { cat.name = n; scheduleSave(); render(); } } },
      { label: '在此分类新建接口', run: async () => { S.cat = cat.id; await act('newIface'); } },
      { label: '导出 .yxpn', run: () => act('exportYxpn') },
    ]);
  } else if (routeEl) {
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
      { label: '删除路由', run: () => { S.routeId = id; act('delRoute'); } },
    ]);
  }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#ctxmenu')) $('#ctxmenu').classList.add('hidden'); });

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

/* ---------------- 前端模式（PageStudio / .yxpp） ---------------- */
let studioHtmlCache = '';
let studioLoaded = false;
let studioSeq = 0;
const studioReqs = new Map();

function studioFrame() { return $('#studioFrame'); }

function postToStudio(msg) {
  const f = studioFrame();
  try { if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*'); } catch (e) { /* retry on ready */ }
}

function refreshStudioState() {
  const el = $('#studioState');
  if (!el) return;
  const f = S.project && S.project.frontend;
  el.textContent = f ? `已绑定：${f.name || '前端工程'} · ${f.framework || 'tailwind'}` : '未绑定 .yxpp（当前为 PageStudio 示例）';
  el.disabled = false;
}

async function ensureStudio() {
  if (studioLoaded) return;
  const f = studioFrame();
  if (!f) return;
  studioLoaded = true;
  try {
    studioHtmlCache = await api.studioHtml();
    f.srcdoc = studioHtmlCache;
  } catch (e) {
    studioLoaded = false;
    toast('PageStudio 加载失败：' + (e.message || e), 5000);
  }
}

function studioLoadProject(project) {
  if (!project) return;
  postToStudio({ type: 'cbs:yxpp:load', project });
}

function captureStudioProject() {
  return new Promise((resolve) => {
    if (!studioLoaded) return resolve(null);
    const id = `r${++studioSeq}`;
    const timer = setTimeout(() => { studioReqs.delete(id); resolve(null); }, 4000);
    studioReqs.set(id, (project) => { clearTimeout(timer); resolve(project); });
    postToStudio({ type: 'cbs:yxpp:get', requestId: id });
  });
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

async function attachStudioToProject() {
  const project = await captureStudioProject();
  if (!project || !project.page) return toast('读取 PageStudio 工程失败，请先在画布上拖入元素', 4000);
  const built = await api.frontendBuild({ project, name: S.project.name, framework: 'tailwind' });
  if (!built || !built.ok) return toast('生成 .yxpp 失败：' + ((built && built.error) || ''), 5000);
  S.project.frontend = built.yxpp;
  await api.save(S.project);
  refreshStudioState();
  toast('已把前端 .yxpp 绑定到当前工程，生成服务后自动作为首页', 4500);
}

async function exportStudioYxpp() {
  const project = await captureStudioProject();
  if (!project || !project.page) return toast('读取 PageStudio 工程失败', 4000);
  const built = await api.frontendBuild({ project, name: S.project.name, framework: 'tailwind' });
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
  studioLoadProject(got.yxpp.project);
  toast(`已导入 .yxpp「${got.yxpp.name}」`, 4000);
}

function setView(view) {
  S.view = view === 'studio' ? 'studio' : 'api';
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
  } else {
    render();
  }
}

window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (d.type === 'cbs:yxpp:project' && d.requestId && studioReqs.has(d.requestId)) {
    const fn = studioReqs.get(d.requestId);
    studioReqs.delete(d.requestId);
    fn(d.project);
  }
  if (d.type === 'cbs:yxpp:ready' && S.project && S.project.frontend && S.project.frontend.project) {
    studioLoadProject(S.project.frontend.project);
  }
});

$('#viewSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});
$('#yxppImport').onclick = () => importStudioYxpp().catch((e) => toast(e.message, 5000));
$('#yxppExport').onclick = () => exportStudioYxpp().catch((e) => toast(e.message, 5000));
$('#yxppAttach').onclick = () => attachStudioToProject().catch((e) => toast(e.message, 5000));

/* ---------------- 启动 ---------------- */
(async function boot() {
  bindWindowControls();
  try {
    const b = await api.boot();
    S.project = b.project;
    S.list = b.list;
    S.services = b.services;
    S.settings = b.settings;
    applyTheme(S.settings.theme || {});
    const wanted = new URLSearchParams(location.search).get('project');
    if (wanted && wanted !== S.project.name) {
      const got = await api.load(wanted);
      if (got) S.project = got;
    }
    const openYxpn = new URLSearchParams(location.search).get('openYxpn');
    if (openYxpn) {
      const r = await api.importYxpnPath(openYxpn);
      if (r && r.ok) {
        S.project = r.project;
        await api.save(S.project);
        toast(`已从工程包打开「${S.project.name}」`, 4000);
      } else {
        toast('工程包打不开：' + ((r && r.error) || '未知错误'), 5000);
      }
    }
    S.cat = (S.project.categories[0] || {}).id || '';
    S.selId = (S.project.interfaces[0] || {}).id || '';
    S.help = await api.help();
    S.problems = (await api.validate(S.project)).errors || [];
    render();
    setInterval(async () => {
      if ($('#drawer').classList.contains('hidden')) {
        S.services = await api.services();
        renderRibbon();
      }
    }, 4000);
  } catch (e) {
    document.body.innerHTML = `<pre class="p-4">启动失败：${esc(e && e.message || e)}</pre>`;
  }
})();
