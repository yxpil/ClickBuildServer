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
