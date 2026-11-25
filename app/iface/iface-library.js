// 作者：yxpil
'use strict';

// 接口库：把单个接口（表 + 路由 + 文档 + 脚本）存成可复用条目。
// 内置条目来自 22 套工程模版，自定义条目落用户目录；自定义名称只允许唯一。
// 插入当前工程时自动给接口名、表名、basePath 去重，避免撞库表和撞路由。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const spec = require('./spec');
const store = require('../store');
const templates = require('./templates');

const DIR = 'iface-library';
const META_FILE = '_meta.json';
const MAX_TABLE = 64;
const MAX_CATEGORY = 20;

// 预设接口套件：不是散装接口，而是一套共享同一批表、登录态和路由的业务闭环。
// 每个套件直接复用已经验收过的内置案例，避免另造一份会漂移的数据。
const KITS = [
  {
    key: 'mall', templateId: 'builtin:mall', name: '商城交易系统',
    summary: '注册登录、商品库存、购物车、下单，一条完整的交易闭环；商品表被购物车和订单共用。',
    tags: ['电商', '交易', '库存'], useCases: ['网店', '内部采购', '积分兑换'],
  },
  {
    key: 'blog', templateId: 'builtin:blog', name: '内容博客系统',
    summary: '作者、文章、分类、标签、评论；发布、浏览、评论和标签联查都能直接跑。',
    tags: ['内容', 'CMS', '评论'], useCases: ['公司博客', '知识库', '个人站点'],
  },
  {
    key: 'social', templateId: 'builtin:social', name: '同频社区系统',
    summary: '账户身份、好友、私聊、群聊、动态、搜索、通知、文件与统计，一套完整社区后端。',
    tags: ['社区', '社交', 'IM'], useCases: ['兴趣社区', '内部论坛', '会员空间'],
  },
  {
    key: 'ticket', templateId: 'builtin:ticket', name: '客服工单系统',
    summary: '客户、工单、回复；派单、回复回写与状态统计相互咬合，不再是一张孤立工单表。',
    tags: ['客服', '工单', 'B2B'], useCases: ['售后', 'IT 支持', '内部流转'],
  },
  {
    key: 'crm', templateId: 'builtin:crm', name: 'CRM 客户系统',
    summary: '客户、联系人、商机阶段与金额统计；一个客户挂多个联系人和多条商机。',
    tags: ['CRM', '销售', '客户'], useCases: ['销售管理', '渠道跟进', '客户台账'],
  },
  {
    key: 'booking', templateId: 'builtin:booking', name: '预约服务系统',
    summary: '服务项目、时段、预约；名额容量校验、取消释放和事务提交都已配好。',
    tags: ['预约', '本地生活', '库存'], useCases: ['门店预约', '体检挂号', '场地预订'],
  },
  {
    key: 'edu', templateId: 'builtin:edu', name: '在线课程系统',
    summary: '课程、课时、报名与学习进度；报名事务校验名额，重复报名会拦下。',
    tags: ['教育', '课程', '报名'], useCases: ['培训平台', '企业学习', '网课'],
  },
  {
    key: 'survey', templateId: 'builtin:survey', name: '问卷收集系统',
    summary: '公开填写、后台编辑、答卷统计与 CSV 导出；前后端和演示问卷都齐。',
    tags: ['问卷', '表单', '统计'], useCases: ['满意度调查', '需求收集', '活动登记'],
  },
];

// 表格套件默认覆盖全部内置工程模版：8 套接口套件优先排在最前，
// 其余模版按名称表组补齐，避免“预设表”只覆盖少数业务。
const TABLE_KITS = KITS.concat(
  templates.listAll()
    .filter((x) => x.kind === 'builtin' && !KITS.some((k) => k.templateId === x.id))
    .filter((x) => x.counts && x.counts.tables > 0)
    .map((x) => ({
      key: String(x.id || '').replace(/^builtin:/, ''),
      templateId: x.id,
      name: x.name,
      summary: x.description || '',
      tags: x.tags || [],
      useCases: [],
    }))
    .filter((x) => x.key)
);

function dir() {
  const d = path.join(store.root(), DIR);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readMeta() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir(), META_FILE), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (e) {
    return {};
  }
}

function writeMeta(meta) {
  const file = path.join(dir(), META_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function cleanCategory(value, fallback) {
  const s = String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY);
  return s || fallback || '未分类';
}

function decorate(entry, meta) {
  const m = (meta || readMeta())[entry.id] || {};
  const fallback = entry.kind === 'builtin' ? '内置模板' : '未分类';
  return {
    ...entry,
    favorite: m.favorite === true,
    category: cleanCategory(m.category, fallback),
    description: m.description != null ? String(m.description).slice(0, 200) : entry.description,
    uses: Number(m.uses) || 0,
    lastUsedAt: m.lastUsedAt || '',
    updatedAt: m.updatedAt || entry.createdAt || '',
  };
}


function counts(iface) {
  return { tables: iface.tables.length, routes: iface.routes.length };
}

function normName(s) {
  return String(s || '').trim().normalize('NFKC').toLowerCase();
}

function plain(iface, source, extra) {
  return {
    id: source.id,
    kind: source.kind,
    name: iface.name,
    source: source.name,
    sourceId: source.sourceId || '',
    description: iface.docs && iface.docs.summary ? iface.docs.summary : '',
    counts: counts(iface),
    createdAt: extra && extra.createdAt || null,
    file: extra && extra.file || '',
  };
}

let builtinCache = null;

function builtinEntries() {
  if (builtinCache) return builtinCache;
  const out = [];
  for (const t of templates.BUILTINS) {
    try {
      const project = templates.get(t.id).project;
      project.interfaces.forEach((iface, index) => {
        out.push(plain(iface, { id: `builtin:${t.id.slice(8)}:${index}`, kind: 'builtin', name: t.name, sourceId: t.id }, null));
      });
    } catch (e) {
      // 单个内置工程坏了不影响其它条目。
    }
  }
  builtinCache = out;
  return out;
}

function customEntries() {
  return fs.readdirSync(dir()).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => {
    const file = path.join(dir(), f);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const iface = spec.normalizeProject({
        name: '接口库', categories: [{ id: 'lib', name: '接口库' }], interfaces: [data.iface],
      }).interfaces[0];
      return plain(iface, { id: `user:${f.replace(/\.json$/, '')}`, kind: 'user', name: data.source && data.source.project || '我的接口' }, { createdAt: data.createdAt, file });
    } catch (e) {
      return null;
    }
  }).filter(Boolean).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function list() {
  const meta = readMeta();
  return [...builtinEntries(), ...customEntries()].map((x) => decorate(x, meta));
}

function nameExists(name, exceptId) {
  const key = normName(name);
  return list().some((x) => x.id !== exceptId && normName(x.name) === key);
}

function kitDef(id) {
  const key = String(id || '').replace(/^kit:/, '');
  return KITS.find((k) => k.key === key || k.templateId === id) || null;
}

function kitProject(def) {
  return templates.get(def.templateId).project;
}

// 表格套件和接口套件共用同一批已验收案例，但只抽“物理表”这一层：
// 同一张表在多个接口里重复定义（如商品表被商品和购物车引用）时只留一份。
function tableKitSource(def) {
  const project = kitProject(def);
  const tableDefs = new Map();
  const tables = new Map();
  const union = (list, key) => {
    const seen = new Set();
    return (list || []).filter((x) => {
      const k = key(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  for (const iface of project.interfaces) {
    for (const t of iface.tables) {
      tableDefs.set(t.name, (tableDefs.get(t.name) || 0) + 1);
      const prev = tables.get(t.name);
      if (!prev) {
        tables.set(t.name, JSON.parse(JSON.stringify(t)));
        continue;
      }
      // 同一张表在多个接口里有不同定义时合并，而不是只看字段最多的那一份：
      // 字段按名字并集，索引与关系按结构并集，连接/store/注释保留最完整的一份。
      const fields = new Set((prev.fields || []).map((f) => f.name));
      for (const f of t.fields || []) {
        if (!fields.has(f.name)) {
          prev.fields = prev.fields || [];
          prev.fields.push(JSON.parse(JSON.stringify(f)));
          fields.add(f.name);
        }
      }
      prev.indexes = union([...(prev.indexes || []), ...(t.indexes || [])], (x) => JSON.stringify(x));
      prev.relations = union([...(prev.relations || []), ...(t.relations || [])], (x) => JSON.stringify(x));
      if (!prev.comment && t.comment) prev.comment = t.comment;
      if ((!prev.conn || prev.conn === 'main') && t.conn) prev.conn = t.conn;
      if (t.store && (!prev.store || prev.store.mode === 'mysql')) prev.store = JSON.parse(JSON.stringify(t.store));
    }
  }
  return { project, tableDefs, tables: [...tables.values()] };
}

function tableKitDef(id) {
  const key = String(id || '').replace(/^tablekit:/, '');
  return TABLE_KITS.find((k) => k.key === key) || null;
}

function tableKitEntry(def, meta) {
  const { project, tableDefs, tables } = tableKitSource(def);
  const count = (fn) => tables.reduce((n, t) => n + fn(t), 0);
  const m = (meta || readMeta())[`tablekit:${def.key}`] || {};
  return {
    id: `tablekit:${def.key}`,
    kind: 'tablekit',
    name: `${def.name}表组`,
    summary: def.summary,
    tags: def.tags,
    useCases: def.useCases,
    source: project.name,
    counts: {
      tables: tables.length,
      tableDefs: [...tableDefs.values()].reduce((n, x) => n + x, 0),
      fields: count((t) => (t.fields || []).length),
      indexes: count((t) => (t.indexes || []).length),
      relations: count((t) => (t.relations || []).length),
      sharedTables: [...tableDefs.values()].filter((n) => n > 1).length,
    },
    tables: tables.map((t) => ({
      name: t.name,
      comment: t.comment || '',
      fields: (t.fields || []).length,
      indexes: (t.indexes || []).length,
      relations: (t.relations || []).length,
      shared: (tableDefs.get(t.name) || 0) > 1,
      fieldNames: (t.fields || []).map((f) => f.name),
    })),
    uses: Number(m.uses) || 0,
    lastUsedAt: m.lastUsedAt || '',
  };
}

function tableKits() {
  const meta = readMeta();
  return TABLE_KITS.map((def) => {
    try { return tableKitEntry(def, meta); } catch (e) { return null; }
  }).filter(Boolean);
}

function tableKitGet(id) {
  const def = tableKitDef(id);
  if (!def) throw new Error('没有这个表格套件');
  return tableKitEntry(def);
}


// 套件不是静态清单：接口、共享表、路由和“是否带演示数据/页面”都从真实案例算出来。
function kitEntry(def, meta) {
  const project = kitProject(def);
  const tableUse = new Map();
  const physical = new Set();
  let authed = false;
  let upload = false;
  for (const iface of project.interfaces) {
    for (const t of iface.tables) {
      physical.add(t.name);
      tableUse.set(t.name, (tableUse.get(t.name) || 0) + 1);
    }
    for (const r of iface.routes || []) {
      if (/\bTOKEN\s+NEW\b/i.test(String(r.script || ''))) authed = true;
      if (r.io && (r.io.response === 'file' || String(r.io.storage || '') === 's3')) upload = true;
    }
  }
  const shared = [...tableUse].filter(([, n]) => n > 1).map(([name, n]) => ({ name, definitions: n }));
  const m = (meta || readMeta())[`kit:${def.key}`] || {};
  return {
    id: `kit:${def.key}`,
    kind: 'kit',
    name: def.name,
    summary: def.summary,
    description: def.summary,
    tags: def.tags,
    useCases: def.useCases,
    templateId: def.templateId,
    source: project.name,
    counts: {
      interfaces: project.interfaces.length,
      tables: physical.size,
      tableDefs: project.interfaces.reduce((n, i) => n + i.tables.length, 0),
      routes: project.interfaces.reduce((n, i) => n + (i.routes || []).length, 0),
      sharedTables: shared.length,
    },
    readiness: {
      auth: authed,
      seed: !!(project.seed && project.seed.sql),
      frontend: !!(project.frontend && project.frontend.html),
      upload,
    },
    shared,
    interfaces: project.interfaces.map((i) => ({
      name: i.name,
      basePath: i.basePath || '',
      tables: i.tables.map((t) => ({ key: t.key, name: t.name })),
      routes: (i.routes || []).length,
    })),
    uses: Number(m.uses) || 0,
    lastUsedAt: m.lastUsedAt || '',
  };
}

function kits() {
  const meta = readMeta();
  return KITS.map((def) => {
    try { return kitEntry(def, meta); } catch (e) { return null; }
  }).filter(Boolean);
}

function kitGet(id) {
  const def = kitDef(id);
  if (!def) throw new Error('没有这个接口套件');
  return kitEntry(def);
}

function get(id) {
  const key = String(id || '');
  if (key.startsWith('builtin:')) {
    const parts = key.split(':');
    const index = Number(parts.pop());
    const sourceId = 'builtin:' + parts.slice(1).join(':');
    const t = templates.BUILTINS.find((x) => x.id === sourceId);
    if (!t) throw new Error('没有这个内置来源');
    const project = templates.get(sourceId).project;
    const iface = project.interfaces[index];
    if (!iface) throw new Error('没有这个内置接口');
    return { ...decorate(plain(iface, { id: key, kind: 'builtin', name: t.name, sourceId: t.id }, null)), iface };
  }
  if (key.startsWith('user:')) {
    const file = path.join(dir(), `${key.slice(5)}.json`);
    if (!fs.existsSync(file)) throw new Error('没有这个自定义接口');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const project = spec.normalizeProject({ name: '接口库', categories: [{ id: 'lib', name: '接口库' }], interfaces: [data.iface] });
    const iface = project.interfaces[0];
    const entry = plain(iface, { id: key, kind: 'user', name: data.source && data.source.project || '我的接口' }, { createdAt: data.createdAt, file });
    return { ...decorate({ ...entry, description: data.description || entry.description }), iface };
  }
  throw new Error('接口库 id 不合法');
}

function save(payload) {
  const name = String(payload && payload.name || '').trim();
  if (!name) throw new Error('接口名不能为空');
  if (name.length > 40) throw new Error('接口名最多 40 个字');
  if (nameExists(name)) throw new Error(`接口库里已有同名接口：${name}`);
  const source = payload.iface || {};
  const project = spec.normalizeProject({
    name: '接口库',
    categories: [{ id: 'lib', name: '接口库' }],
    interfaces: [{ ...source, name, categoryId: 'lib', id: source.id || crypto.randomUUID().replace(/-/g, '') }],
  });
  const v = spec.validateProject(project);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  const iface = project.interfaces[0];
  const id = `${store.slug(name)}-${crypto.randomUUID().slice(0, 6)}`;
  const data = {
    name,
    description: String(payload.description || '').slice(0, 200),
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 8).map(String) : ['自定义接口'],
    createdAt: new Date().toISOString(),
    source: { project: String(payload.sourceProject || ''), iface: source.name || '' },
    iface,
  };
  const file = path.join(dir(), `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  const meta = readMeta();
  meta[`user:${id}`] = {
    favorite: payload.favorite === true,
    category: cleanCategory(payload.category, '未分类'),
    description: String(payload.description || '').slice(0, 200),
    uses: 0,
    lastUsedAt: '',
    updatedAt: new Date().toISOString(),
  };
  writeMeta(meta);
  const entry = decorate(plain(iface, { id: `user:${id}`, kind: 'user', name: data.source.project || '我的接口' }, { createdAt: data.createdAt, file }), meta);
  return { ok: true, id: `user:${id}`, name, file, entry };
}

function update(id, patch) {
  const key = String(id || '');
  if (!key.startsWith('user:') && !key.startsWith('builtin:')) throw new Error('接口库 id 不合法');
  const entry = get(key);
  const meta = readMeta();
  const m = { ...(meta[key] || {}) };
  const p = patch && typeof patch === 'object' ? patch : {};

  if (p.favorite != null) m.favorite = p.favorite === true;
  if (p.category != null) m.category = cleanCategory(p.category, entry.category || '未分类');
  if (p.description != null) m.description = String(p.description).replace(/\s+/g, ' ').trim().slice(0, 200);
  m.updatedAt = new Date().toISOString();

  if (p.name != null && String(p.name).trim() !== entry.name) {
    if (entry.kind === 'builtin') throw new Error('内置接口不能改名');
    const name = String(p.name).trim();
    if (!name) throw new Error('接口名不能为空');
    if (name.length > 40) throw new Error('接口名最多 40 个字');
    if (nameExists(name, key)) throw new Error(`接口库里已有同名接口：${name}`);
    const file = path.join(dir(), `${key.slice(5)}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const old = data.name;
    data.name = name;
    if (data.iface) {
      data.iface.name = name;
      if (data.iface.docs && data.iface.docs.title === old) data.iface.docs.title = name;
    }
    if (p.description == null && data.description) m.description = String(data.description).slice(0, 200);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }
  if (p.description != null && entry.kind === 'user') {
    const file = path.join(dir(), `${key.slice(5)}.json`);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.description = m.description;
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    }
  }
  meta[key] = m;
  writeMeta(meta);
  return { ok: true, entry: get(key) };
}

function remove(id) {
  const key = String(id || '');
  if (!key.startsWith('user:')) throw new Error('内置接口不能删除');
  const file = path.join(dir(), `${key.slice(5)}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const meta = readMeta();
  if (meta[key]) { delete meta[key]; writeMeta(meta); }
  return { ok: true };
}

function uniqueIfaceName(base, used) {
  let name = String(base || '接口').trim() || '接口';
  let i = 2;
  while (used.has(normName(name))) {
    name = `${String(base || '接口').trim() || '接口'} (${i++})`;
  }
  used.add(normName(name));
  return name;
}

function uniqueTableName(base, used) {
  let name = String(base || 'table').trim() || 'table';
  let i = 2;
  const fit = (s) => s.length > MAX_TABLE ? s.slice(0, MAX_TABLE - 2) + '_' + i : s;
  while (used.has(name)) name = fit(`${String(base || 'table').trim() || 'table'}_${i++}`);
  used.add(name);
  return name;
}

function uniqueBasePath(base, used) {
  let p = String(base || '').replace(/\/+$/, '');
  if (!p) return p;
  let i = 2;
  while (used.has(p)) p = `${String(base || '').replace(/\/+$/, '')}_${i++}`;
  used.add(p);
  return p;
}

function uniqueTableKey(base, used) {
  let key = String(base || 'tbl').replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(key)) key = `t_${key}`;
  if (!key) key = 'tbl';
  let i = 2;
  while (used.has(key)) key = `${String(base || 'tbl').replace(/[^A-Za-z0-9_]/g, '_')}_${i++}`;
  used.add(key);
  return key;
}

function tableKitLabel(name) {
  return String(name || '数据表')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '数据表';
}

function uniqueRoutePath(base, method, used, prefix) {
  let p = String(base || '').trim() || '/';
  const keyOf = (x) => `${String(method || 'GET').toUpperCase()} ${String(prefix || '')}${String(x).replace(/\/+$/, '')}`;
  if (!used.has(keyOf(p))) { used.add(keyOf(p)); return p; }
  let i = 2;
  const original = p;
  do {
    const segs = original.split('/');
    const last = segs[segs.length - 1] || '';
    if (last.startsWith(':')) {
      if (segs.length > 2) segs[segs.length - 2] = `${segs[segs.length - 2]}-${i}`;
      else segs.splice(segs.length - 1, 0, `copy-${i}`);
    } else {
      segs[segs.length - 1] = `${last}-${i}`;
    }
    p = segs.join('/');
    i++;
  } while (used.has(keyOf(p)));
  used.add(keyOf(p));
  return p;
}

function insert(project, id) {
  const key = String(id || '');
  const p = spec.normalizeProject(project);
  const entry = get(id);
  const src = JSON.parse(JSON.stringify(entry.iface));
  const ifaceNames = new Set(p.interfaces.map((x) => normName(x.name)));
  const tableNames = new Set(p.interfaces.flatMap((x) => x.tables.map((t) => t.name)));
  const basePaths = new Set(p.interfaces.map((x) => String(x.basePath || '').replace(/\/+$/, '')).filter(Boolean));
  const routeKeys = new Set(p.interfaces.flatMap((x) => (x.routes || []).map((r) => `${String(r.method || 'GET').toUpperCase()} ${String(r.path || '').replace(/\/+$/, '')}`)));
  const origName = src.name;
  src.id = crypto.randomUUID().replace(/-/g, '');
  src.name = uniqueIfaceName(src.name, ifaceNames);
  if (!p.categories.some((c) => c.id === src.categoryId)) src.categoryId = p.categories[0] ? p.categories[0].id : '';
  if (!src.categoryId) {
    p.categories.push({ id: 'lib', name: '接口库' });
    src.categoryId = 'lib';
  }
  src.basePath = uniqueBasePath(src.basePath, basePaths);
  const tableMap = new Map();
  for (const t of src.tables) {
    const old = t.name;
    t.name = uniqueTableName(t.name, tableNames);
    tableMap.set(old, t.name);
  }
  let routesRenamed = 0;
  for (const r of (src.routes || [])) {
    const before = String(r.path || '');
    let path = before;
    for (const [old, next] of tableMap) {
      if (old === next) continue;
      const esc = String(old).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      path = path.replace(new RegExp(`(^|/)${esc}(?=/|$)`, 'g'), `$1${next}`);
    }
    const safe = uniqueRoutePath(path, r.method, routeKeys);
    r.path = safe;
    if (safe !== before) routesRenamed++;
  }
  if (src.docs && src.docs.title === origName) src.docs.title = src.name;
  p.interfaces.push(src);
  const next = spec.normalizeProject(p);
  const v = spec.validateProject(next);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  const meta = readMeta();
  const m = { ...(meta[key] || {}) };
  m.uses = (Number(m.uses) || 0) + 1;
  m.lastUsedAt = new Date().toISOString();
  meta[key] = m;
  writeMeta(meta);
  return { ok: true, project: next, ifaceId: src.id, category: src.categoryId, name: src.name, renamed: src.name !== origName, routesRenamed, warnings: v.warnings };
}

function insertKit(project, id) {
  const def = kitDef(id);
  if (!def) throw new Error('没有这个接口套件');
  const p = spec.normalizeProject(project);
  const source = kitProject(def);
  const srcIfaces = JSON.parse(JSON.stringify(source.interfaces));

  const ifaceNames = new Set(p.interfaces.map((x) => normName(x.name)));
  const tableNames = new Set(p.interfaces.flatMap((x) => x.tables.map((t) => t.name)));
  const basePaths = new Set(p.interfaces.map((x) => String(x.basePath || '').replace(/\/+$/, '')).filter(Boolean));
  const routeKeys = new Set(p.interfaces.flatMap((x) => (x.routes || []).map((r) => `${String(r.method || 'GET').toUpperCase()} ${String(x.basePath || '')}${String(r.path || '').replace(/\/+$/, '')}`)));

  // 分类：同名直接归并，同名不同 id 新建一个分类，保证接口仍能落到正确分类。
  const catMap = new Map();
  const catIds = new Set(p.categories.map((c) => c.id));
  for (const c of source.categories) {
    const same = p.categories.find((x) => normName(x.name) === normName(c.name));
    if (same) { catMap.set(c.id, same.id); continue; }
    let cid = String(c.id || `cat${p.categories.length + 1}`);
    let n = 2;
    while (catIds.has(cid)) cid = `${String(c.id || 'cat')}_${n++}`;
    catIds.add(cid);
    p.categories.push({ id: cid, name: c.name });
    catMap.set(c.id, cid);
  }

  // 自定义函数：同实现只留一份；同名不同实现就改名，脚本里同步替换。
  const fnRename = new Map();
  for (const fn of source.functions || []) {
    const same = p.functions.find((x) => x.name === fn.name);
    if (same) {
      if (JSON.stringify(same.params) === JSON.stringify(fn.params) && same.body === fn.body) continue;
      let name = `${fn.name}_KIT`;
      let n = 2;
      while (p.functions.some((x) => x.name === name)) name = `${fn.name}_KIT${n++}`;
      fnRename.set(fn.name, name);
      p.functions.push({ ...fn, name });
      continue;
    }
    p.functions.push(JSON.parse(JSON.stringify(fn)));
  }

  // 共享表：同一个物理表在一套件里出现多次（如商品表同时被商品、购物车引用）只改一次名。
  const tableMap = new Map();
  const tableUse = new Map();
  for (const iface of srcIfaces) {
    for (const t of iface.tables) {
      const old = t.name;
      tableUse.set(old, (tableUse.get(old) || 0) + 1);
      if (!tableMap.has(old)) tableMap.set(old, uniqueTableName(old, tableNames));
    }
  }

  const replaceIdent = (text, oldName, nextName) => {
    if (!text || oldName === nextName) return text;
    const esc = String(oldName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(text).replace(new RegExp(`(^|[^A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, 'g'), `$1${nextName}`);
  };

  const added = [];
  const renamedTableSet = new Set();
  let renamedIfaces = 0;
  let renamedBasePaths = 0;
  let routesRenamed = 0;

  // 套件接口原本共用根路径时，如果当前工程已经有同 method + path，就给整套加一个业务前缀，
  // 而不是把 /register 改成 /register-2 这种越来越难认的路径。
  const rootCollision = srcIfaces.some((i) => !String(i.basePath || '')
    && (i.routes || []).some((r) => routeKeys.has(`${String(r.method || 'GET').toUpperCase()} ${String(r.path || '').replace(/\/+$/, '')}`)));
  const fallbackBase = rootCollision ? uniqueBasePath(`/${def.key}`, basePaths) : '';

  for (const src of srcIfaces) {
    const origName = src.name;
    src.id = crypto.randomUUID().replace(/-/g, '');
    src.name = uniqueIfaceName(src.name, ifaceNames);
    if (src.name !== origName) renamedIfaces++;
    if (src.docs && src.docs.title === origName) src.docs.title = src.name;
    src.categoryId = catMap.get(src.categoryId) || (p.categories[0] && p.categories[0].id) || '';

    const oldBase = String(src.basePath || '');
    if (!oldBase && fallbackBase) src.basePath = fallbackBase;
    else src.basePath = uniqueBasePath(src.basePath, basePaths);
    if (src.basePath !== oldBase) renamedBasePaths++;

    for (const t of src.tables) {
      const old = t.name;
      const next = tableMap.get(old) || old;
      if (next !== old) renamedTableSet.add(old);
      t.name = next;
    }

    for (const r of (src.routes || [])) {
      const before = String(r.path || '');
      let path = before;
      for (const [old, next] of tableMap) path = replaceIdent(path, old, next);
      let script = String(r.script || '');
      for (const [old, next] of tableMap) script = replaceIdent(script, old, next);
      for (const [old, next] of fnRename) script = replaceIdent(script, old, next);
      r.script = script;
      const safe = uniqueRoutePath(path, r.method, routeKeys, src.basePath);
      r.path = safe;
      if (safe !== before) routesRenamed++;
    }
    p.interfaces.push(src);
    added.push(src.name);
  }

  const next = spec.normalizeProject(p);
  const v = spec.validateProject(next);
  if (!v.ok) throw new Error(v.errors.join('\n'));

  const meta = readMeta();
  const km = { ...(meta[`kit:${def.key}`] || {}) };
  km.uses = (Number(km.uses) || 0) + 1;
  km.lastUsedAt = new Date().toISOString();
  meta[`kit:${def.key}`] = km;
  writeMeta(meta);

  const shared = [...tableUse].filter(([, n]) => n > 1).map(([name, n]) => ({ name, target: tableMap.get(name), definitions: n }));
  const addedTables = new Set(next.interfaces.slice(-srcIfaces.length).flatMap((i) => i.tables.map((t) => t.name)));
  return {
    ok: true,
    project: next,
    kit: kitEntry(def, meta),
    added,
    ifaceIds: next.interfaces.slice(-srcIfaces.length).map((i) => i.id),
    counts: {
      interfaces: srcIfaces.length,
      tables: addedTables.size,
      routes: srcIfaces.reduce((n, i) => n + (i.routes || []).length, 0),
    },
    shared,
    renamed: { interfaces: renamedIfaces, tables: renamedTableSet.size, basePaths: renamedBasePaths, routes: routesRenamed },
    warnings: v.warnings,
  };
}

function insertTableKit(project, id, opts) {
  const def = tableKitDef(id);
  if (!def) throw new Error('没有这个表格套件');
  const o = opts || {};
  const p = spec.normalizeProject(project);
  const { tables: sourceTables } = tableKitSource(def);
  const wanted = o.tableName
    ? sourceTables.filter((t) => t.name === String(o.tableName))
    : sourceTables.slice();
  if (!wanted.length) throw new Error('没有这张预设表');

  const ifaceNames = new Set(p.interfaces.map((x) => normName(x.name)));
  const catIds = new Set(p.categories.map((c) => c.id));
  const catName = '数据表';

  let createdIface = false;
  let target = o.ifaceId ? p.interfaces.find((x) => x.id === String(o.ifaceId)) : null;
  const allNames = new Set(p.interfaces.flatMap((x) => x.tables.map((t) => t.name)));
  const targetNames = new Set(target ? target.tables.map((t) => t.name) : []);
  const keys = new Set(target ? target.tables.map((t) => t.key) : []);
  const nameMap = new Map();
  const plan = [];
  for (const t of wanted) {
    if (targetNames.has(t.name)) {
      nameMap.set(t.name, t.name);
      plan.push({ src: t, name: t.name, skip: true });
      continue;
    }
    const name = uniqueTableName(t.name, allNames);
    nameMap.set(t.name, name);
    plan.push({ src: t, name, skip: false });
  }

  if (!target) {
    // 只有新建表接口才需要「数据表」分类；往现有接口加表不应该凭空多出一个分类。
    let cat = p.categories.find((c) => normName(c.name) === normName(catName));
    if (!cat) {
      let cid = 'data';
      let n = 2;
      while (catIds.has(cid)) cid = `data_${n++}`;
      cat = { id: cid, name: catName };
      p.categories.push(cat);
      catIds.add(cid);
    }
    const first = plan.find((x) => !x.skip);
    const name = uniqueIfaceName(`${tableKitLabel(def.name.replace(/系统$/, ''))}表组`, ifaceNames);
    // 表组接口保留一组基础 CRUD 路由，第一张表仍是 main；这样表接进来就能直接查。
    target = spec.newIface(name, cat.id, {
      scenario: 'blank',
      tableName: first ? first.name : undefined,
      routeKinds: ['list', 'detail', 'create', 'update', 'delete'],
    });
    target.tables = [];
    target.basePath = '';
    target.docs = { ...(target.docs || {}), summary: `预设表组：${def.summary}`, description: '' };
    p.interfaces.push(target);
    createdIface = true;
  }

  const added = [];
  const skipped = [];
  let addedFields = 0;
  for (const item of plan) {
    if (item.skip) { skipped.push(item.src.name); continue; }
    const key = keys.size === 0 ? 'main' : uniqueTableKey(item.name, keys);
    if (keys.size === 0) keys.add(key);
    const copy = JSON.parse(JSON.stringify(item.src));
    copy.name = item.name;
    copy.key = key;
    copy.relations = (copy.relations || []).map((r) => ({
      ...r,
      target: nameMap.get(r.target) || r.target,
      through: nameMap.get(r.through) || r.through,
    }));
    target.tables.push(copy);
    targetNames.add(item.name);
    added.push(item.name);
    addedFields += (copy.fields || []).length;
  }

  const next = spec.normalizeProject(p);
  const v = spec.validateProject(next);
  if (!v.ok) throw new Error(v.errors.join('\n'));

  if (added.length) {
    const meta = readMeta();
    const tm = { ...(meta[`tablekit:${def.key}`] || {}) };
    tm.uses = (Number(tm.uses) || 0) + 1;
    tm.lastUsedAt = new Date().toISOString();
    meta[`tablekit:${def.key}`] = tm;
    writeMeta(meta);
  }

  return {
    ok: true,
    project: next,
    tableKit: tableKitEntry(def),
    ifaceId: target.id,
    targetName: target.name,
    createdIface,
    added,
    skipped,
    counts: { tables: added.length, fields: addedFields },
    warnings: v.warnings,
  };
}

module.exports = { list, get, save, update, remove, insert, kits, kitGet, insertKit, tableKits, tableKitGet, insertTableKit, counts, DIR, KITS };

