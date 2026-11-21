// 作者：yxpil
'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../store');
const spec = require('./spec');

const INDEX_NAME = 'projects.index';

function root() {
  const dir = path.join(store.root(), 'iface-projects');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileOf(name) {
  return path.join(root(), `${store.slug(name)}.json`);
}

function indexPath() {
  return path.join(root(), INDEX_NAME);
}

function readIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
    if (!Array.isArray(data.entries)) return [];
    return data.entries.filter((e) => e && e.name && e.file);
  } catch (e) { return []; }
}

function writeIndex(entries) {
  const clean = entries.map((e) => ({
    name: e.name,
    file: e.file,
    description: e.description || '',
    taskType: e.taskType || 'mixed',
    count: Number(e.count || 0),
    tables: Array.isArray(e.tables) ? e.tables : [],
    routes: Number(e.routes || 0),
    updatedAt: Number(e.updatedAt || 0),
  })).sort((a, b) => b.updatedAt - a.updatedAt);
  fs.writeFileSync(indexPath(), JSON.stringify({ version: 1, entries: clean }, null, 2), 'utf8');
  return clean;
}

function entryOf(project, file, updatedAt) {
  const ifaces = project.interfaces || [];
  return {
    name: project.name || path.basename(file, '.json'),
    file,
    description: project.description || '',
    taskType: project.taskType || 'mixed',
    count: ifaces.length,
    tables: ifaces.flatMap((i) => (i.tables || []).map((t) => t.name)),
    routes: ifaces.reduce((n, i) => n + (i.routes || []).length, 0),
    updatedAt: Number(updatedAt || Date.now()),
  };
}

function list() {
  const dir = root();
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === INDEX_NAME) continue;
    const file = path.join(dir, f);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || typeof data !== 'object') continue;
      found.push(entryOf(data, file, fs.statSync(file).mtimeMs));
    } catch (e) { /* 损坏的 JSON 不进历史，避免整页打不开 */ }
  }

  const indexed = readIndex();
  const merged = [];
  for (const e of found) merged.push({ ...e, missing: false });
  for (const e of indexed) {
    if (merged.some((x) => x.name === e.name || path.resolve(x.file) === path.resolve(e.file))) continue;
    merged.push({ ...e, missing: !fs.existsSync(e.file) });
  }
  merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  writeIndex(merged);
  return merged;
}

function save(project) {
  const name = String(project.name || '接口工作台').trim() || '接口工作台';
  const file = fileOf(name);
  const saved = { ...project, name, updatedAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(saved, null, 2), 'utf8');
  const index = readIndex().filter((e) => e.name !== name && path.resolve(e.file) !== path.resolve(file));
  index.push(entryOf(saved, file, saved.updatedAt));
  writeIndex(index);
  return file;
}

function load(name) {
  const file = fileOf(name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { return null; }
}

function remove(name) {
  const file = fileOf(name);
  const existed = fs.existsSync(file);
  if (existed) fs.unlinkSync(file);
  const remaining = readIndex().filter((e) => e.name !== name && path.resolve(e.file) !== path.resolve(file));
  writeIndex(remaining);
  return { ok: true, name, removed: existed, missing: !existed };
}

function duplicate(name) {
  const src = load(name);
  if (!src) return { ok: false, error: '找不到文件：' + name };
  const taken = new Set(list().map((x) => String(x.name).toLowerCase()));
  let next = `${String(name).trim()} 副本`;
  let n = 2;
  while (taken.has(next.toLowerCase())) { next = `${String(name).trim()} 副本 ${n++}`; }
  const copy = JSON.parse(JSON.stringify(src));
  copy.name = next;
  const file = save(copy);
  return { ok: true, name: next, file, project: spec.normalizeProject(copy) };
}

function boot() {
  const items = list();
  if (items.length) return items[0].name;
  const seed = spec.seedProject();
  save(seed);
  return seed.name;
}

function ensure(name) {
  const p = load(name);
  if (p) return p;
  return { name, interfaces: [] };
}

module.exports = { root, list, save, load, remove, duplicate, boot, ensure };
