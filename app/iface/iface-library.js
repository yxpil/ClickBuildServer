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

function uniqueRoutePath(base, method, used) {
  let p = String(base || '').trim() || '/';
  const keyOf = (x) => `${String(method || 'GET').toUpperCase()} ${String(x).replace(/\/+$/, '')}`;
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

module.exports = { list, get, save, update, remove, insert, counts, DIR };
