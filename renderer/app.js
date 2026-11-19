'use strict';

const api = window.cbs;

const state = {
  project: null,
  catalog: [],
  view: 'modules',
  group: 'all',
  search: '',
  preview: null,
  selectedFile: null,
  settings: {},
  previewTimer: null,
  building: false,
  topoSelected: null,
  topoLink: false,
  topoLinkFrom: null,
};

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

window.__cbsState = state;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function toast(msg, isErr) {
  const node = $('#toast');
  node.textContent = msg;
  node.classList.toggle('err', !!isErr);
  node.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.remove('show'), 3200);
}

const fmtSize = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

const val = (id) => {
  const n = document.getElementById(id);
  if (!n) return '';
  return n.type === 'checkbox' ? n.checked : n.value;
};
const setVal = (id, v) => {
  const n = document.getElementById(id);
  if (!n) return;
  if (n.type === 'checkbox') n.checked = !!v;
  else n.value = v == null ? '' : v;
};
const num = (v, d) => {
  if (v === '' || v === null || v === undefined) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* ------------------------------------------------------------------ */
/* 项目 <-> 表单                                                       */
/* ------------------------------------------------------------------ */

function blank() {
  return api.project.blank();
}

/** 旧版本项目文件可能缺字段，先补齐再渲染，避免半个表单把 init 打断 */
function ensureShape(p) {
  p.modules = Array.isArray(p.modules) ? p.modules : [];
  p.queries = Array.isArray(p.queries) ? p.queries : [];
  p.blocks = Array.isArray(p.blocks) ? p.blocks : [];
  p.customTables = Array.isArray(p.customTables) ? p.customTables : [];
  p.fileSources = Array.isArray(p.fileSources) ? p.fileSources : [];

  p.database = p.database || {};
  p.database.pool = p.database.pool || { min: 2, max: 20 };
  p.database.cluster = p.database.cluster || { enabled: false, readHosts: [] };
  p.database.clusters = Array.isArray(p.database.clusters) ? p.database.clusters : [];
  p.database.routing = p.database.routing || {};
  p.database.failover = p.database.failover || {};

  p.redis = p.redis || {};
  p.redis.nodes = Array.isArray(p.redis.nodes) ? p.redis.nodes : [];
  p.storage = p.storage || {};
  p.search = p.search || {};
  p.integrations = p.integrations || {};

  p.security = p.security || {};
  p.security.luid = p.security.luid || {};
  p.security.waf = p.security.waf || {};
  p.security.waf.cc = p.security.waf.cc || {};
  p.security.waf.ddos = p.security.waf.ddos || {};
  p.security.waf.cors = p.security.waf.cors || {};
  p.security.waf.cors.origins = Array.isArray(p.security.waf.cors.origins) ? p.security.waf.cors.origins : ['*'];
  p.security.waf.headers = p.security.waf.headers || {};

  p.verification = p.verification || {};
  p.verification.sms = p.verification.sms || {};
  p.verification.email = p.verification.email || {};

  p.gateway = p.gateway || {};
  p.gateway.rateLimit = p.gateway.rateLimit || {};
  p.microservices = p.microservices || { enabled: false, mode: 'module-group' };
  p.topology = p.topology || { nodes: [], edges: [] };
  if (!Array.isArray(p.topology.nodes)) p.topology.nodes = [];
  if (!Array.isArray(p.topology.edges)) p.topology.edges = [];
  return p;
}

function writeForm() {
  const p = ensureShape(state.project);
  setVal('f-name', p.name);
  setVal('f-group', p.groupId);
  setVal('f-port', p.port);
  setVal('f-context', p.contextPath);
  setVal('f-id', p.idStrategy);

  setVal('f-db-host', p.database.host);
  setVal('f-db-port', p.database.port);
  setVal('f-db-name', p.database.name);
  setVal('f-db-user', p.database.user);
  setVal('f-db-pass', p.database.password);
  setVal('f-db-min', p.database.pool.min);
  setVal('f-db-max', p.database.pool.max);
  setVal('f-cluster', p.database.cluster && p.database.cluster.enabled);
  setVal('f-cluster-read', ((p.database.cluster && p.database.cluster.readHosts) || []).join(','));

  setVal('f-redis', p.redis.enabled);
  setVal('f-redis-mode', p.redis.mode);
  setVal('f-redis-nodes', (p.redis.nodes || []).join(','));
  setVal('f-redis-prefix', p.redis.keyPrefix);
  setVal('f-redis-ttl', p.redis.cacheTtl);

  setVal('f-storage', p.storage.provider);
  setVal('f-storage-endpoint', p.storage.endpoint);
  setVal('f-storage-bucket', p.storage.bucket);
  setVal('f-storage-ak', p.storage.accessKey);
  setVal('f-storage-sk', p.storage.secretKey);

  setVal('f-search', p.search.engine);
  setVal('f-cookie', p.security.cookieName);
  setVal('f-ttl', p.security.ttlSeconds);
  setVal('f-jwt', p.security.jwtSecret);
  setVal('f-admin', p.security.initAdmin);
  setVal('f-admin-pass', p.security.initPassword);

  const luid = p.security.luid || {};
  setVal('f-luid', luid.enabled !== false);
  setVal('f-luid-cache', luid.cache || 'auto');
  setVal('f-luid-ttl', luid.ttlSeconds || 7200);
  setVal('f-luid-header', luid.headerName || 'X-Luid');
  setVal('f-owner-guard', p.security.ownerGuard !== false);

  const ver = p.verification || {};
  const sms = ver.sms || {};
  const email = ver.email || {};
  setVal('f-sms-provider', sms.provider || 'none');
  setVal('f-sms-endpoint', sms.endpoint || '');
  setVal('f-sms-sign', sms.signName || '');
  setVal('f-sms-template', sms.templateCode || '');
  setVal('f-email-provider', email.provider || 'none');
  setVal('f-email-host', email.host || '');
  setVal('f-email-from', email.from || '');

  setVal('f-docker', p.integrations.docker);
  setVal('f-swagger', p.integrations.swagger);
  setVal('f-rate', p.integrations.rateLimit);
  setVal('f-nginx', p.integrations.nginx);
  setVal('f-tenant', p.integrations.tenant);

  const waf = p.security.waf || {};
  setVal('f-waf', waf.enabled !== false);
  setVal('f-waf-sqli', waf.sqlInjection !== false);
  setVal('f-waf-xss', waf.xss !== false);
  setVal('f-waf-traversal', waf.pathTraversal !== false);
  setVal('f-waf-body', !!waf.sqlInjectionBody);
  setVal('f-cc', (waf.cc || {}).enabled !== false);
  setVal('f-cc-rps', (waf.cc || {}).rps || 20);
  setVal('f-cc-burst', (waf.cc || {}).burst || 40);
  setVal('f-ddos', (waf.ddos || {}).enabled !== false);
  setVal('f-ddos-max', (waf.ddos || {}).maxConcurrent || 200);
  setVal('f-cors', (waf.cors || {}).enabled !== false);
  setVal('f-cors-origins', ((waf.cors || {}).origins || ['*']).join(','));
  setVal('f-cors-cred', !!(waf.cors || {}).credentials);
  setVal('f-frame', (waf.headers || {}).frameOptions || 'DENY');
  setVal('f-hsts', !!(waf.headers || {}).hsts);

  const db = p.database;
  setVal('f-db-strategy', (db.routing || {}).strategy || 'round-robin');
  setVal('f-db-split', (db.routing || {}).readWriteSplit !== false);
  setVal('f-db-health', (db.routing || {}).healthCheckMs || 5000);
  setVal('f-db-threshold', (db.routing || {}).failoverThreshold || 2);
  setVal('f-db-failover', (db.failover || {}).enabled !== false);
  setVal('f-db-lease', (db.failover || {}).leaseSeconds || 10);
  setVal('f-db-quorum', (db.failover || {}).quorum || 2);
  setVal('f-db-clusters', ((db.clusters || []).length
    ? db.clusters.map((c) => `${c.name} | ${c.role} | ${c.host}:${c.port} | ${c.weight || 1}`).join('\n')
    : ''));

  const gw = p.gateway || {};
  setVal('f-gateway', !!gw.enabled);
  setVal('f-gw-port', gw.port || 8089);
  setVal('f-gw-repo', gw.repo || '');
  setVal('f-gw-image', gw.image || '');
  setVal('f-gw-jwt', gw.jwtVerify !== false);
  setVal('f-ms', !!(p.microservices || {}).enabled);
  setVal('f-ms-mode', (p.microservices || {}).mode || 'module-group');

  $$('#seg-lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === p.lang));
  $$('#seg-package button').forEach((b) => {
    b.classList.toggle('active', b.dataset.package === p.packageType);
    b.disabled = (p.lang === 'rust' || p.lang === 'node' || p.lang === 'go') && b.dataset.package === 'war';
  });

  renderCart();
  renderModules();
  renderCustom();
  renderQueries();
  renderBlocks();
  renderTopology();
  if (state.preview) {
    renderStats();
    renderWarnings();
    renderTree();
    renderPerms();
  }
}

function gather() {
  const p = ensureShape(state.project);
  p.name = val('f-name').trim() || 'ClickServer';
  p.groupId = val('f-group').trim() || 'com.clickbuild';
  p.port = num(val('f-port'), 8080);
  p.contextPath = val('f-context').trim() || '/api';
  p.idStrategy = val('f-id');

  p.database.host = val('f-db-host').trim() || '127.0.0.1';
  p.database.port = num(val('f-db-port'), 3306);
  p.database.name = val('f-db-name').trim() || 'click_server';
  p.database.user = val('f-db-user').trim() || 'root';
  p.database.password = val('f-db-pass');
  p.database.pool.min = num(val('f-db-min'), 2);
  p.database.pool.max = num(val('f-db-max'), 20);
  p.database.cluster.enabled = !!val('f-cluster');
  p.database.cluster.readHosts = String(val('f-cluster-read'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  p.redis.enabled = !!val('f-redis');
  p.redis.mode = val('f-redis-mode');
  p.redis.nodes = String(val('f-redis-nodes')).split(',').map((s) => s.trim()).filter(Boolean);
  p.redis.keyPrefix = val('f-redis-prefix').trim() || 'cbs';
  p.redis.cacheTtl = num(val('f-redis-ttl'), 300);

  p.storage.provider = val('f-storage');
  p.storage.endpoint = val('f-storage-endpoint').trim();
  p.storage.bucket = val('f-storage-bucket').trim() || 'click';
  p.storage.accessKey = val('f-storage-ak');
  p.storage.secretKey = val('f-storage-sk');

  p.search.engine = val('f-search');
  p.security.cookieName = val('f-cookie').trim() || 'CB_TOKEN';
  p.security.ttlSeconds = num(val('f-ttl'), 7200);
  p.security.jwtSecret = val('f-jwt');
  p.security.initAdmin = val('f-admin').trim() || 'admin';
  p.security.initPassword = val('f-admin-pass');

  p.security.luid = {
    enabled: !!val('f-luid'),
    cache: val('f-luid-cache') || 'auto',
    ttlSeconds: num(val('f-luid-ttl'), 7200),
    headerName: val('f-luid-header').trim() || 'X-Luid',
  };
  p.security.ownerGuard = !!val('f-owner-guard');

  p.verification = p.verification || { sms: {}, email: {} };
  p.verification.sms = {
    provider: val('f-sms-provider') || 'none',
    endpoint: val('f-sms-endpoint').trim(),
    signName: val('f-sms-sign').trim(),
    templateCode: val('f-sms-template').trim(),
  };
  p.verification.email = {
    provider: val('f-email-provider') || 'none',
    host: val('f-email-host').trim(),
    from: val('f-email-from').trim(),
  };

  p.integrations.docker = !!val('f-docker');
  p.integrations.swagger = !!val('f-swagger');
  p.integrations.rateLimit = !!val('f-rate');
  p.integrations.nginx = !!val('f-nginx');
  p.integrations.tenant = !!val('f-tenant');

  p.security.waf = {
    enabled: !!val('f-waf'),
    sqlInjection: !!val('f-waf-sqli'),
    sqlInjectionBody: !!val('f-waf-body'),
    xss: !!val('f-waf-xss'),
    pathTraversal: !!val('f-waf-traversal'),
    cc: { enabled: !!val('f-cc'), rps: num(val('f-cc-rps'), 20), burst: num(val('f-cc-burst'), 40) },
    ddos: { enabled: !!val('f-ddos'), maxConcurrent: num(val('f-ddos-max'), 200) },
    cors: {
      enabled: !!val('f-cors'),
      origins: String(val('f-cors-origins') || '*').split(',').map((s) => s.trim()).filter(Boolean),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'X-Luid', 'X-Requested-With'],
      credentials: !!val('f-cors-cred'),
    },
    headers: { frameOptions: val('f-frame') || 'DENY', contentTypeOptions: true, hsts: !!val('f-hsts') },
  };

  p.database.routing = {
    strategy: val('f-db-strategy') || 'round-robin',
    readWriteSplit: !!val('f-db-split'),
    healthCheckMs: num(val('f-db-health'), 5000),
    failoverThreshold: num(val('f-db-threshold'), 2),
  };
  p.database.failover = {
    enabled: !!val('f-db-failover'),
    quorum: num(val('f-db-quorum'), 2),
    leaseSeconds: num(val('f-db-lease'), 10),
    splitBrainGuard: true,
  };
  p.database.clusters = String(val('f-db-clusters'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [name, role, host, weight] = line.split('|').map((s) => s.trim());
      const addr = (host || '127.0.0.1').split(':');
      return {
        name: name || `node${i + 1}`,
        role: role === 'replica' || role === 'slave' ? 'replica' : 'primary',
        host: addr[0] || '127.0.0.1',
        port: num(addr[1], 3306),
        weight: num(weight, 1),
      };
    });

  p.gateway = {
    enabled: !!val('f-gateway'),
    kind: 'onrouter',
    repo: val('f-gw-repo').trim(),
    image: val('f-gw-image').trim(),
    port: num(val('f-gw-port'), 8089),
    routesMode: 'path',
    jwtVerify: !!val('f-gw-jwt'),
    rateLimit: { enabled: true, rps: 50 },
  };
  p.microservices = { enabled: !!val('f-ms'), mode: val('f-ms-mode') || 'module-group' };
  if (p.lang !== 'java') p.microservices.enabled = p.microservices.enabled || false;
  if (p.lang !== 'java') p.packageType = 'jar';
  return p;
}

/* ------------------------------------------------------------------ */
/* 模块货架                                                             */
/* ------------------------------------------------------------------ */

const byId = (id) => state.catalog.find((m) => m.id === id);

function toggleModule(id) {
  const p = state.project;
  const has = p.modules.includes(id);
  if (has) {
    const dependents = p.modules.filter((x) => {
      const m = byId(x);
      return m && (m.requires || []).includes(id);
    });
    if (dependents.length) {
      toast(`「${byId(id) ? byId(id).name : id}」被 ${dependents.map((d) => byId(d).name).join('、')} 依赖，先移除它们`, true);
      return;
    }
    p.modules = p.modules.filter((x) => x !== id);
  } else {
    const add = [id];
    const walk = (mid) => {
      const m = byId(mid);
      if (!m) return;
      (m.requires || []).forEach((req) => {
        if (!add.includes(req)) {
          add.push(req);
          walk(req);
        }
      });
    };
    walk(id);
    p.modules = [...new Set([...p.modules, ...add])];
  }
  gather();
  writeForm();
  schedule();
}

function renderModules() {
  const wrap = $('#module-groups');
  wrap.innerHTML = '';
  if (!state.catalog.length) return;

  const q = state.search.trim().toLowerCase();
  const selected = new Set(state.project.modules);
  const groups = new Map();

  state.catalog.forEach((m) => {
    if (state.group !== 'all' && m.group !== state.group) return;
    if (q && !(`${m.name} ${m.id} ${m.tagline} ${m.desc}`.toLowerCase().includes(q))) return;
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push(m);
  });

  if (!groups.size) {
    wrap.appendChild(el('div', 'hint', '没有匹配的模块'));
    return;
  }

  groups.forEach((list, group) => {
    const box = el('div', 'group');
    const title = el('h3', 'group-title', `${group} · ${list.length}`);
    const grid = el('div', 'cards-grid');

    list.forEach((m) => {
      const on = selected.has(m.id);
      const card = el('div', `mod${on ? ' on' : ''}`);
      card.dataset.id = m.id;

      const top = el('div', 'mod-top');
      top.appendChild(el('div', 'mod-abbr', m.abbr || m.name.slice(0, 2)));
      top.appendChild(el('div', 'mod-name', m.name));
      top.appendChild(el('div', 'mod-check', '✓'));
      card.appendChild(top);
      card.appendChild(el('div', 'mod-tagline', m.tagline || m.desc || ''));

      const meta = el('div', 'mod-meta');
      if (m.tables.length) meta.appendChild(el('span', 'pill', `${m.tables.length} 表`));
      meta.appendChild(el('span', 'pill', `${m.perms.length} 权限`));
      Object.keys(m.features || {}).forEach((f) => {
        if (['audit', 'cache', 'search', 'storage', 'export', 'import', 'fileSource'].includes(f) && m.features[f]) {
          meta.appendChild(el('span', 'pill acc', f));
        }
      });
      (m.requires || []).forEach((r) => {
        const dep = byId(r);
        meta.appendChild(el('span', 'pill req', `+${dep ? dep.name : r}`));
      });
      card.appendChild(meta);

      card.addEventListener('click', () => toggleModule(m.id));
      grid.appendChild(card);
    });

    box.appendChild(title);
    box.appendChild(grid);
    wrap.appendChild(box);
  });
}

/* ------------------------------------------------------------------ */
/* 购物车                                                               */
/* ------------------------------------------------------------------ */

function renderCart() {
  const list = $('#cart-list');
  if (!list) return;
  list.innerHTML = '';
  const selected = state.project.modules
    .map((id) => byId(id))
    .filter(Boolean);

  $('#cart-count').textContent = String(selected.length);
  selected.forEach((m) => {
    const row = el('div', 'cart-item');
    row.appendChild(el('span', 'dot'));
    const nm = el('div', 'nm', m.name);
    nm.title = m.tagline || m.desc || '';
    row.appendChild(nm);
    row.appendChild(el('div', 'tb', `${m.tables.length}T`));
    const x = el('button', '', '×');
    x.addEventListener('click', () => toggleModule(m.id));
    row.appendChild(x);
    list.appendChild(row);
  });

  const tables = selected.reduce((n, m) => n + m.tables.length, 0);
  const perms = selected.reduce((n, m) => n + m.perms.length, 0);
  const stats = $('#cart-stats');
  stats.innerHTML = '';
  const pairs = [
    ['模块', selected.length],
    ['数据表', tables],
    ['权限点', perms],
    ['文件', state.preview ? state.preview.files.length : '—'],
  ];
  pairs.forEach(([k, v]) => {
    const d = el('div');
    d.appendChild(document.createTextNode(`${k} `));
    d.appendChild(el('b', '', String(v)));
    stats.appendChild(d);
  });

  const tool = { rust: 'cargo', node: 'node', go: 'go' }[state.project.lang] || 'maven';
  $('#cart-hint').textContent = state.preview
    ? `预计 ${fmtSize(state.preview.totalBytes)} · ${tool} 工程`
    : '勾选模块后自动计算表与权限';
}

/* ------------------------------------------------------------------ */
/* 自定义表                                                             */
/* ------------------------------------------------------------------ */

const ctColumns = () => String(val('ct-columns')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function parseCols() {
  return ctColumns().map((line) => {
    const [name, type, comment, flags] = line.split('|').map((s) => (s || '').trim());
    return { name, type: type || 'varchar(255)', comment: comment || '', flags: (flags || '').split(',').filter(Boolean) };
  }).filter((c) => c.name);
}

function renderColPreview() {
  const box = $('#ct-preview');
  const cols = parseCols();
  box.innerHTML = '';
  if (!cols.length) {
    box.appendChild(el('div', 'hint', '填字段后这里显示预览'));
    return;
  }
  const table = el('table');
  const head = el('tr');
  ['字段', '类型', '注释', '主键', '必填', '唯一', '索引', '搜索'].forEach((h) => head.appendChild(el('th', '', h)));
  table.appendChild(head);
  cols.forEach((c) => {
    const tr = el('tr');
    tr.appendChild(el('td', '', c.name || '—'));
    tr.appendChild(el('td', '', c.type));
    tr.appendChild(el('td', '', c.comment || '—'));
    const mark = (on) => el('td', on ? 'tick' : 'cross', on ? '✓' : '·');
    tr.appendChild(mark(c.flags.includes('pk')));
    tr.appendChild(mark(c.flags.includes('req')));
    tr.appendChild(mark(c.flags.includes('uniq')));
    tr.appendChild(mark(c.flags.includes('idx')));
    tr.appendChild(mark(c.flags.includes('search')));
    table.appendChild(tr);
  });
  const wrap = el('div', 'table-wrap');
  wrap.appendChild(table);
  box.appendChild(wrap);
}

function addQuery() {
  const p = state.project;
  const name = val('q-name').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) return toast('先填查询名称', true);
  const sql = val('q-sql').trim();
  if (!sql) return toast('SQL 不能为空', true);

  p.queries = p.queries || [];
  if (p.queries.some((q) => q.name === name)) return toast('查询名已存在', true);
  p.queries.push({
    name,
    method: val('q-method') || 'GET',
    perm: val('q-perm').trim(),
    sql,
    params: String(val('q-params')).split(',').map((s) => s.trim()).filter(Boolean),
    comment: '',
  });

  setVal('q-name', '');
  setVal('q-perm', '');
  setVal('q-params', '');
  renderQueries();
  schedule();
  toast(`已添加查询 ${name}`);
}

function renderQueries() {
  const box = $('#query-list');
  if (!box) return;
  box.innerHTML = '';
  const list = (state.project.queries || []);
  if (!list.length) {
    box.appendChild(el('div', 'hint', '还没有自定义 SQL。'));
    return;
  }
  list.forEach((q) => {
    const row = el('div', 'list-row');
    const info = el('div');
    info.appendChild(el('div', 'title', `${q.method} /api/query/${q.name}`));
    info.appendChild(el('div', 'sub', `${q.perm || '登录即可'} · 参数 ${(q.params || []).join(', ') || '无'}`));
    row.appendChild(info);
    const ops = el('div', 'ops');
    const del = el('button', 'link', '移除');
    del.addEventListener('click', () => {
      state.project.queries = (state.project.queries || []).filter((x) => x.name !== q.name);
      renderQueries();
      schedule();
    });
    ops.appendChild(del);
    row.appendChild(ops);
    box.appendChild(row);
  });
}

function addBlock() {
  const p = state.project;
  const id = val('b-id').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) return toast('先填积木 ID', true);
  p.blocks = p.blocks || [];
  if (p.blocks.some((b) => b.id === id)) return toast('这个积木 ID 已存在', true);
  p.blocks.push({
    id,
    name: val('b-name').trim() || id,
    method: val('b-method') === 'POST' ? 'POST' : 'GET',
    path: `/blocks/${id}`,
    perm: val('b-perm').trim(),
    params: String(val('b-params')).split(',').map((s) => s.trim()).filter(Boolean),
    code: val('b-code'),
    comment: '',
  });
  setVal('b-id', '');
  setVal('b-name', '');
  setVal('b-perm', '');
  setVal('b-params', '');
  renderBlocks();
  schedule();
  toast(`已添加积木 ${id}`);
}

function renderBlocks() {
  const box = $('#block-list');
  if (!box) return;
  box.innerHTML = '';
  const list = state.project.blocks || [];
  const count = $('#block-count');
  if (count) count.textContent = String(list.length);
  if (!list.length) {
    box.appendChild(el('div', 'hint', '还没有自定义积木。'));
    return;
  }
  list.forEach((b) => {
    const row = el('div', 'list-row');
    const info = el('div');
    info.appendChild(el('div', 'title', `${b.method} /api/blocks/${b.id}`));
    info.appendChild(el('div', 'sub', `${b.name} · ${b.perm || '登录即可'} · 参数 ${(b.params || []).join(', ') || '无'}`));
    row.appendChild(info);
    const ops = el('div', 'ops');
    const del = el('button', 'link', '移除');
    del.addEventListener('click', () => {
      state.project.blocks = (state.project.blocks || []).filter((x) => x.id !== b.id);
      renderBlocks();
      schedule();
    });
    ops.appendChild(del);
    row.appendChild(ops);
    box.appendChild(row);
  });
}

function addCustom() {
  const p = state.project;
  const name = val('ct-name').trim();
  if (!name) return toast('先填表名', true);
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(name)) return toast('表名用小写字母/数字/下划线，且以字母开头', true);
  const cols = parseCols();
  if (!cols.length) return toast('至少一个字段', true);
  p.customTables = p.customTables || [];
  if (p.customTables.some((t) => t.name === name)) return toast('表名已存在', true);

  const engine = val('ct-engine');
  p.customTables.push({
    name,
    comment: val('ct-comment').trim() || name,
    engine,
    path: val('ct-path').trim(),
    columns: ctColumns(),
    search: String(val('ct-search')).split(',').map((s) => s.trim()).filter(Boolean),
  });
  if (!p.modules.includes(`custom-${name.replace(/_/g, '-')}`)) p.modules.push(`custom-${name.replace(/_/g, '-')}`);

  setVal('ct-name', '');
  setVal('ct-comment', '');
  setVal('ct-path', '');
  gather();
  writeForm();
  schedule();
  toast(`已添加 ${name}`);
}

function renderCustom() {
  const box = $('#custom-list');
  if (!box) return;
  box.innerHTML = '';
  const list = state.project.customTables || [];
  $('#custom-count').textContent = String(list.length);
  if (!list.length) {
    box.appendChild(el('div', 'hint', '还没有自定义表。左侧填写后点「添加到项目」。'));
    return;
  }
  list.forEach((t) => {
    const row = el('div', 'list-row');
    const info = el('div');
    info.appendChild(el('div', 'title', `${t.name} · ${t.comment || ''}`));
    info.appendChild(el('div', 'sub', `${String(t.engine).toUpperCase()} · ${String(t.columns || '').split(/\r?\n/).filter(Boolean).length} 字段`));
    row.appendChild(info);
    const ops = el('div', 'ops');
    const del = el('button', 'link', '移除');
    del.addEventListener('click', () => {
      state.project.customTables = state.project.customTables.filter((x) => x.name !== t.name);
      const mid = `custom-${t.name.replace(/_/g, '-')}`;
      state.project.modules = state.project.modules.filter((x) => x !== mid);
      gather();
      writeForm();
      schedule();
    });
    ops.appendChild(del);
    row.appendChild(ops);
    box.appendChild(row);
  });
}

/* ------------------------------------------------------------------ */
/* 权限                                                                 */
/* ------------------------------------------------------------------ */

function renderPerms() {
  const pr = state.preview;
  if (!pr) return;
  $('#perm-count').textContent = String(pr.perms.length);

  const roles = $('#role-list');
  roles.innerHTML = '';
  pr.roles.forEach((r) => {
    const row = el('div', 'list-row');
    const info = el('div');
    info.appendChild(el('div', 'title', `${r.name}  ${r.code}`));
    info.appendChild(el('div', 'sub', `${r.perms.includes('*') ? '全部权限' : r.perms.length + ' 项权限'} · 数据范围 ${r.dataScope === 1 ? '全部' : r.dataScope === 2 ? '本部门' : '仅本人'}`));
    row.appendChild(info);
    roles.appendChild(row);
  });

  const tags = $('#perm-list');
  tags.innerHTML = '';
  pr.perms.forEach((x) => tags.appendChild(el('span', 'tag', x.code)));

  const wrap = $('#perm-matrix');
  wrap.innerHTML = '';
  const table = el('table');
  const head = el('tr');
  head.appendChild(el('th', '', '权限码'));
  pr.roles.forEach((r) => head.appendChild(el('th', '', r.name)));
  table.appendChild(head);
  pr.perms.forEach((x) => {
    const tr = el('tr');
    tr.appendChild(el('td', '', x.code));
    pr.roles.forEach((r) => {
      const on = r.perms.includes('*') || r.perms.includes(x.code);
      tr.appendChild(el('td', on ? 'tick' : 'cross', on ? '✓' : '—'));
    });
    table.appendChild(tr);
  });
  const scroll = el('div', 'table-wrap');
  scroll.appendChild(table);
  wrap.appendChild(scroll);
}

/* ------------------------------------------------------------------ */
/* 预览                                                                 */
/* ------------------------------------------------------------------ */

function schedule() {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(refreshPreview, 260);
}

async function refreshPreview() {
  gather();
  try {
    const pr = await api.preview(state.project);
    state.preview = pr;
    renderStats();
    renderWarnings();
    renderTree();
    renderPerms();
    renderCart();
    if (state.view === 'preview') $('#out-dir').value = state.settings.outDir || '';
  } catch (e) {
    toast(`预览失败：${e.message}`, true);
  }
}

function renderStats() {
  const pr = state.preview;
  if (!pr) return;
  const box = $('#stats');
  box.innerHTML = '';
  const items = [
    ['模块', pr.stats.modules],
    ['数据表', pr.stats.tables],
    ['权限点', pr.stats.permissions],
    ['文件', pr.files.length],
    ['体积', fmtSize(pr.totalBytes)],
    ['语言', { rust: 'Rust / axum', node: 'Node.js / 原生 http', go: 'Go / net-http' }[pr.project.lang] || `Java / ${pr.project.packageType.toUpperCase()}`],
  ];
  items.forEach(([k, v], i) => {
    const c = el('div', 'stat');
    c.appendChild(el('div', 'k', k));
    c.appendChild(el('div', `v${i === 4 ? ' acc' : ''}`, String(v)));
    box.appendChild(c);
  });
}

function renderWarnings() {
  const box = $('#warnings');
  box.innerHTML = '';
  (state.preview.warnings || []).forEach((w) => box.appendChild(el('div', 'warn-row', w)));
}

const openDirs = new Set(['src', 'sql', 'docs', 'data', 'docker', 'scripts']);

function renderTree() {
  const box = $('#file-tree');
  box.innerHTML = '';
  const pr = state.preview;
  if (!pr) return;
  $('#file-count').textContent = String(pr.files.length);

  const q = $('#file-search').value.trim().toLowerCase();
  const files = pr.files.filter((f) => !q || f.path.toLowerCase().includes(q));

  const tree = {};
  files.forEach((f) => {
    const parts = f.path.split('/');
    let node = tree;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node[part] = f;
      else {
        node[part] = node[part] || {};
        node = node[part];
      }
    });
  });

  const renderNode = (name, node, depth) => {
    const row = el('div');
    if (node && node.path) {
      row.className = `node${state.selectedFile === node.path ? ' on' : ''}`;
      row.style.paddingLeft = `${6 + depth * 10}px`;
      row.appendChild(el('span', '', '·'));
      row.appendChild(el('span', '', name));
      row.appendChild(el('span', 'size', fmtSize(node.size)));
      row.addEventListener('click', () => openFile(node.path));
    } else {
      row.className = 'node dir';
      row.style.paddingLeft = `${6 + depth * 10}px`;
      row.appendChild(el('span', '', openDirs.has(name) || depth === 0 ? '▾' : '▸'));
      row.appendChild(el('span', '', name));
    }
    box.appendChild(row);
    if (node && !node.path) {
      Object.keys(node).sort((a, b) => {
        const an = node[a] && node[a].path ? 1 : 0;
        const bn = node[b] && node[b].path ? 1 : 0;
        return an - bn || a.localeCompare(b);
      }).forEach((k) => renderNode(k, node[k], depth + 1));
    }
  };

  Object.keys(tree).sort().forEach((k) => renderNode(k, tree[k], 0));
}

async function openFile(path) {
  state.selectedFile = path;
  $('#code-title').textContent = path;
  const code = $('#code-view');
  code.textContent = '加载中…';
  try {
    const text = await api.code(state.project, path);
    const max = 400000;
    code.textContent = text == null ? '（空文件）' : text.length > max ? text.slice(0, max) + '\n\n… 已截断' : text;
    renderTree();
  } catch (e) {
    code.textContent = `读取失败：${e.message}`;
  }
}

/* ------------------------------------------------------------------ */
/* 动作                                                                 */
/* ------------------------------------------------------------------ */

async function doGenerate() {
  gather();
  try {
    const r = await api.run(state.project, state.settings.outDir);
    state.settings.outDir = r.outRoot;
    $('#out-dir').value = r.outRoot;
    toast(`已生成 ${r.files} 个文件 → ${r.dir}`);
    $('#cart-hint').textContent = `已生成到 ${r.dir}`;
  } catch (e) {
    toast(`生成失败：${e.message}`, true);
  }
}

async function doZip() {
  gather();
  try {
    const p = await api.zip(state.project);
    if (p) toast(`已导出 ${p}`);
  } catch (e) {
    toast(`打包失败：${e.message}`, true);
  }
}

async function doBuild() {
  if (state.building) return;
  gather();
  const lang = state.project.lang;
  const r = await api.run(state.project, state.settings.outDir);
  state.building = true;
  const cmdText = {
    rust: 'cargo build --release',
    go: 'go mod tidy && go build ./...',
    node: 'npm install && node server.js --selfcheck',
  }[lang] || 'mvn -B -DskipTests package';
  $('#build-log').textContent = `$ ${cmdText}\n`;
  $('#btn-build').disabled = true;
  try {
    const res = await api.build({ dir: r.dir, lang });
    if (res.error) {
      $('#build-log').textContent += `\n${res.error}\n`;
      toast(res.error, true);
    } else if (res.code === 0) {
      toast('编译通过');
      $('#build-log').textContent += '\n[exit 0] 编译成功\n';
    } else {
      toast(`编译失败，退出码 ${res.code}`, true);
      $('#build-log').textContent += `\n[exit ${res.code}]\n`;
    }
  } catch (e) {
    $('#build-log').textContent += `\n${e.message}\n`;
    toast(e.message, true);
  } finally {
    state.building = false;
    $('#btn-build').disabled = false;
  }
}

async function saveProject(silent) {
  gather();
  try {
    const r = await api.project.save(state.project);
    state.settings.lastProject = state.project.name;
    if (!silent) toast(`已保存：${r.file}`);
  } catch (e) {
    toast(`保存失败：${e.message}`, true);
  }
}

async function openProjectDialog() {
  const list = await api.project.list();
  const body = $('#modal-body');
  body.innerHTML = '';
  if (!list.length) body.appendChild(el('div', 'hint', '还没有保存的项目'));
  list.forEach((p) => {
    const row = el('div', 'list-row');
    const info = el('div');
    info.appendChild(el('div', 'title', p.name));
    info.appendChild(el('div', 'sub', `${p.lang}/${p.packageType} · ${p.modules} 模块 · ${new Date(p.updatedAt).toLocaleString()}`));
    row.appendChild(info);
    const ops = el('div', 'ops');
    const open = el('button', 'btn ghost', '打开');
    open.addEventListener('click', async () => {
      const data = await api.project.load(p.name);
      if (data) {
        state.project = data;
        writeForm();
        schedule();
      }
      $('#modal').classList.add('hidden');
    });
    const del = el('button', 'btn ghost danger', '删除');
    del.addEventListener('click', async () => {
      await api.project.remove(p.name);
      row.remove();
      toast('已删除');
    });
    ops.appendChild(open);
    ops.appendChild(del);
    row.appendChild(ops);
    body.appendChild(row);
  });
  $('#modal-title').textContent = '打开项目';
  $('#modal').classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* 拓扑编排（ComfyUI 那种画布）                                          */
/* ------------------------------------------------------------------ */

const TOPO_KINDS = {
  service: '服务', gateway: '网关', db: '数据库', redis: 'Redis',
  storage: '对象存储', client: '客户端', module: '模块',
};
const TOPO_W = 152;
const TOPO_H = 62;

function topoModel() {
  const p = state.project;
  if (!p.topology) p.topology = { nodes: [], edges: [] };
  if (!Array.isArray(p.topology.nodes)) p.topology.nodes = [];
  if (!Array.isArray(p.topology.edges)) p.topology.edges = [];
  p.topology.nodes.forEach((n) => {
    if (!Number.isFinite(n.x)) n.x = 80;
    if (!Number.isFinite(n.y)) n.y = 80;
    if (!Array.isArray(n.modules)) n.modules = [];
  });
  return p.topology;
}

function topoNextId(kind) {
  const t = topoModel();
  let i = 1;
  while (t.nodes.some((n) => n.id === `${kind}-${i}`)) i += 1;
  return `${kind}-${i}`;
}

function addTopoNode(kind) {
  const t = topoModel();
  const cols = { client: 0, gateway: 1, service: 2, module: 3, db: 4, redis: 4, storage: 4 };
  const col = cols[kind] ?? 2;
  const sameCol = t.nodes.filter((n) => (cols[n.kind] ?? 2) === col).length;
  const id = topoNextId(kind);
  const label = TOPO_KINDS[kind] || kind;
  t.nodes.push({
    id,
    kind,
    name: `${label} ${id.split('-')[1] || ''}`.trim(),
    x: 16 + col * 170,
    y: 26 + sameCol * 92,
    modules: [],
  });
  state.topoSelected = id;
  renderTopology();
  const sel = document.querySelector('.topo-node.sel');
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  gather();
  schedule();
}

function renderTopology() {
  const host = $('#topo-nodes');
  if (!host) return;
  const t = topoModel();
  host.innerHTML = '';
  t.nodes.forEach((n) => {
    const node = el('div', `topo-node kind-${n.kind}`);
    node.style.left = `${n.x}px`;
    node.style.top = `${n.y}px`;
    node.dataset.id = n.id;
    if (n.id === state.topoSelected) node.classList.add('sel');
    node.appendChild(el('div', 'topo-node-name', n.name || n.id));
    node.appendChild(el('div', 'topo-node-sub',
      `${TOPO_KINDS[n.kind] || n.kind}${n.modules && n.modules.length ? ` · ${n.modules.length} 模块` : ''}`));
    node.appendChild(el('div', 'topo-node-id', n.id));
    host.appendChild(node);
    bindNodeDrag(node, n);
  });
  drawEdges();
  renderTopoProps();
}

function drawEdges() {
  const svg = $('#topo-edges');
  if (!svg) return;
  const t = topoModel();
  const w = 1600;
  const h = 1200;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.innerHTML = '';
  const map = new Map(t.nodes.map((n) => [n.id, n]));
  t.edges.forEach((e) => {
    const a = map.get(e.from);
    const b = map.get(e.to);
    if (!a || !b) return;
    const x1 = a.x + TOPO_W;
    const y1 = a.y + TOPO_H / 2;
    const x2 = b.x;
    const y2 = b.y + TOPO_H / 2;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'topo-edge');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', x2);
    dot.setAttribute('cy', y2);
    dot.setAttribute('r', 3);
    dot.setAttribute('class', 'topo-edge-dot');
    svg.appendChild(line);
    svg.appendChild(dot);
  });
}

function selectTopoNode(id) {
  state.topoSelected = id;
  if (state.topoLink && state.topoLinkFrom && state.topoLinkFrom !== id) {
    const t = topoModel();
    const exists = t.edges.some((e) => e.from === state.topoLinkFrom && e.to === id);
    if (!exists) t.edges.push({ from: state.topoLinkFrom, to: id });
    state.topoLinkFrom = null;
    gather();
    schedule();
  } else if (state.topoLink) {
    state.topoLinkFrom = id;
  }
  renderTopology();
}

function renderTopoProps() {
  const body = $('#topo-props-body');
  if (!body) return;
  const t = topoModel();
  const node = t.nodes.find((n) => n.id === state.topoSelected);
  body.innerHTML = '';
  if (!node) {
    body.appendChild(el('p', 'hint', '点画布里的节点来编辑。'));
    return;
  }

  const field = (label, input) => {
    const wrap = el('label', 'field');
    wrap.appendChild(el('span', null, label));
    wrap.appendChild(input);
    return wrap;
  };

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = node.name || '';
  nameInput.addEventListener('input', () => {
    node.name = nameInput.value;
    renderTopology();
  });

  const kindSel = document.createElement('select');
  Object.entries(TOPO_KINDS).forEach(([k, v]) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = v;
    if (k === node.kind) o.selected = true;
    kindSel.appendChild(o);
  });
  kindSel.addEventListener('change', () => {
    node.kind = kindSel.value;
    renderTopology();
  });

  const modsInput = document.createElement('input');
  modsInput.type = 'text';
  modsInput.placeholder = 'order,product,media-upload';
  modsInput.value = (node.modules || []).join(',');
  modsInput.addEventListener('input', () => {
    node.modules = modsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    renderTopology();
  });

  body.appendChild(field('显示名', nameInput));
  body.appendChild(field('类型', kindSel));
  if (node.kind === 'service' || node.kind === 'module') {
    body.appendChild(field('包含模块（逗号分隔）', modsInput));
    const hint = el('p', 'hint', '服务节点带模块时，微服务切分按画布来；空着就按模块分组自动切。');
    body.appendChild(hint);
  }
  body.appendChild(el('p', 'hint', `节点 ID：${node.id}`));

  const del = el('button', 'btn ghost', '删除节点');
  del.addEventListener('click', () => {
    const t2 = topoModel();
    t2.nodes = t2.nodes.filter((n) => n.id !== node.id);
    t2.edges = t2.edges.filter((e) => e.from !== node.id && e.to !== node.id);
    state.topoSelected = null;
    renderTopology();
    gather();
    schedule();
  });
  body.appendChild(del);
}

function bindNodeDrag(nodeEl, n) {
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;
  let moved = false;

  nodeEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    baseX = n.x;
    baseY = n.y;
    moved = false;
    nodeEl.classList.add('dragging');

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      n.x = Math.max(0, baseX + dx);
      n.y = Math.max(0, baseY + dy);
      nodeEl.style.left = `${n.x}px`;
      nodeEl.style.top = `${n.y}px`;
      drawEdges();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      nodeEl.classList.remove('dragging');
      if (moved) {
        gather();
        schedule();
      } else {
        selectTopoNode(n.id);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function autoLayoutTopology() {
  const t = topoModel();
  const cols = { client: 0, gateway: 1, service: 2, module: 3, db: 4, redis: 4, storage: 4 };
  const counters = {};
  t.nodes.forEach((n) => {
    const c = cols[n.kind] ?? 2;
    counters[c] = (counters[c] || 0) + 1;
    n.x = 16 + c * 170;
    n.y = 22 + (counters[c] - 1) * 90;
  });
  renderTopology();
  gather();
  schedule();
}

function bindTopo() {
  $$('.topo-item').forEach((b) => {
    b.addEventListener('click', () => addTopoNode(b.dataset.kind));
  });
  $('#topo-auto').addEventListener('click', autoLayoutTopology);
  $('#topo-clear').addEventListener('click', () => {
    state.project.topology = { nodes: [], edges: [] };
    state.topoSelected = null;
    renderTopology();
    gather();
    schedule();
    toast('画布已清空');
  });
  $('#topo-link').addEventListener('click', () => {
    state.topoLink = !state.topoLink;
    state.topoLinkFrom = null;
    $('#topo-link').classList.toggle('on', state.topoLink);
    toast(state.topoLink ? '连线模式：先点起点，再点终点' : '已退出连线模式');
  });
  const canvas = $('#topo-canvas');
  if (canvas) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.target === canvas || e.target.id === 'topo-edges') {
        state.topoSelected = null;
        renderTopology();
      }
    });
  }
  window.addEventListener('resize', drawEdges);
}

/* ------------------------------------------------------------------ */
/* 绑定                                                                 */
/* ------------------------------------------------------------------ */

function bindNav() {
  $$('.nav-item').forEach((b) => {
    b.addEventListener('click', () => {
      $$('.nav-item').forEach((x) => x.classList.toggle('active', x === b));
      $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === b.dataset.view));
      state.view = b.dataset.view;
      document.body.classList.toggle('topo-mode', state.view === 'topology');
      if (state.view === 'preview') {
        refreshPreview();
        $('#out-dir').value = state.settings.outDir || '';
      }
      if (state.view === 'topology') renderTopology();
    });
  });
}

function bindForm() {
  const ids = ['f-name', 'f-group', 'f-port', 'f-context', 'f-id', 'f-db-host', 'f-db-port', 'f-db-name', 'f-db-user', 'f-db-pass', 'f-db-min', 'f-db-max', 'f-cluster', 'f-cluster-read', 'f-redis', 'f-redis-mode', 'f-redis-nodes', 'f-redis-prefix', 'f-redis-ttl', 'f-storage', 'f-storage-endpoint', 'f-storage-bucket', 'f-storage-ak', 'f-storage-sk', 'f-search', 'f-cookie', 'f-ttl', 'f-jwt', 'f-admin', 'f-admin-pass', 'f-docker', 'f-swagger', 'f-rate', 'f-nginx', 'f-tenant', 'f-waf', 'f-waf-sqli', 'f-waf-xss', 'f-waf-traversal', 'f-waf-body', 'f-cc', 'f-cc-rps', 'f-cc-burst', 'f-ddos', 'f-ddos-max', 'f-cors', 'f-cors-origins', 'f-cors-cred', 'f-frame', 'f-hsts', 'f-db-strategy', 'f-db-split', 'f-db-health', 'f-db-threshold', 'f-db-failover', 'f-db-lease', 'f-db-quorum', 'f-db-clusters', 'f-gateway', 'f-gw-port', 'f-gw-repo', 'f-gw-image', 'f-gw-jwt', 'f-ms', 'f-ms-mode'];
  ids.forEach((id) => {
    const n = document.getElementById(id);
    if (!n) return;
    const ev = n.type === 'checkbox' || n.tagName === 'SELECT' ? 'change' : 'input';
    n.addEventListener(ev, () => {
      gather();
      renderCart();
      schedule();
    });
  });

  $('#seg-lang').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.project.lang = b.dataset.lang;
    gather();
    writeForm();
    schedule();
  });
  $('#seg-package').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    state.project.packageType = b.dataset.package;
    gather();
    writeForm();
    schedule();
  });

  $('#ct-columns').addEventListener('input', renderColPreview);
  $('#ct-add').addEventListener('click', addCustom);
  const qAdd = $('#q-add');
  if (qAdd) qAdd.addEventListener('click', addQuery);
  const bAdd = $('#b-add');
  if (bAdd) bAdd.addEventListener('click', addBlock);

  $('#module-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderModules();
  });
  $('#group-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.group = b.dataset.group;
    $$('#group-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    renderModules();
  });

  $('#file-search').addEventListener('input', () => renderTree());

  $('#btn-refresh').addEventListener('click', refreshPreview);
  $('#btn-generate').addEventListener('click', doGenerate);
  $('#btn-zip').addEventListener('click', doZip);
  $('#btn-build').addEventListener('click', doBuild);

  $('#btn-pick-dir').addEventListener('click', async () => {
    const dir = await api.pickDir();
    if (dir) {
      state.settings.outDir = dir;
      $('#out-dir').value = dir;
    }
  });
  $('#btn-open-dir').addEventListener('click', () => {
    if (state.settings.outDir) api.openPath(state.settings.outDir);
  });

  $('#btn-new').addEventListener('click', async () => {
    state.project = await blank();
    state.preview = null;
    writeForm();
    refreshPreview();
    toast('已新建项目');
  });
  $('#btn-open').addEventListener('click', openProjectDialog);
  $('#btn-save').addEventListener('click', () => saveProject(false));
  $('#btn-import').addEventListener('click', async () => {
    const r = await api.project.importFile();
    if (!r) return;
    state.project = r.project;
    writeForm();
    refreshPreview();
    toast(`已导入 ${r.file}`);
  });
  $('#btn-export').addEventListener('click', async () => {
    gather();
    const p = await api.project.exportFile(state.project);
    if (p) toast(`已导出 ${p}`);
  });
  $('#btn-cart-generate').addEventListener('click', doGenerate);
  $('#cart-clear').addEventListener('click', () => {
    state.project.modules = [];
    gather();
    writeForm();
    schedule();
  });

  $('#modal-close').addEventListener('click', () => $('#modal').classList.add('hidden'));
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') $('#modal').classList.add('hidden');
  });

  $$('.chip[data-preset]').forEach((b) => {
    b.addEventListener('click', () => {
      const presets = {
        min: ['auth', 'account', 'rbac', 'order'],
        commerce: ['auth', 'account', 'rbac', 'audit-log', 'approval', 'order', 'product', 'inventory', 'payment', 'customer', 'cart', 'address', 'coupon', 'report'],
        content: ['auth', 'account', 'rbac', 'audit-log', 'file', 'media-upload', 'media-play', 'cms', 'comment', 'search'],
        all: state.catalog.map((m) => m.id),
      };
      state.project.modules = presets[b.dataset.preset] || [];
      gather();
      writeForm();
      schedule();
      toast(`已套用预设：${b.textContent}`);
    });
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveProject(false);
    }
  });
}

function bindMenu() {
  api.onMenu(async (action) => {
    if (action === 'project:new') $('#btn-new').click();
    else if (action === 'project:open') $('#btn-open').click();
    else if (action === 'project:save') saveProject(false);
    else if (action === 'project:import') $('#btn-import').click();
    else if (action === 'project:export') $('#btn-export').click();
    else if (action === 'generate:preview') refreshPreview();
    else if (action === 'generate:run') doGenerate();
    else if (action === 'generate:zip') doZip();
    else if (action === 'output:open') {
      if (state.settings.outDir) api.openPath(state.settings.outDir);
    } else if (action === 'help:docs') {
      toast('使用说明见项目 README.md；生成物自带 docs/API.md');
    }
  });
  api.onBuildLog(({ text }) => {
    const log = $('#build-log');
    log.textContent += text;
    log.scrollTop = log.scrollHeight;
  });
}

async function init() {
  try {
    const info = await api.info();
    state.settings = info.settings || {};
    state.catalog = await api.catalog();
    $('#out-dir').value = state.settings.outDir || '';

    const last = state.settings.lastProject ? await api.project.load(state.settings.lastProject) : null;
    state.project = last || (await blank());

    bindNav();
    bindForm();
    bindMenu();
    bindTopo();
    writeForm();
    renderColPreview();
    await refreshPreview();
  } catch (e) {
    toast(`初始化失败：${e.message}`, true);
    console.error(e);
  }
}

init();
