// 作者：yxpil
'use strict';

// 工程存储：一个工程就是一个 .yxpn 包，目录里的 .cache 只是可读工作副本。
// 旧版 <工程名>.json 在首次扫描/打开时迁移成 .yxpn，并保留 .json.bak。
const fs = require('fs');
const path = require('path');
const store = require('../store');
const spec = require('./spec');
const pkg = require('./package');

const INDEX_NAME = 'projects.index';
const CACHE_NAME = '.cache';
const EXT = '.yxpn';
const LEGACY_EXT = '.json';

function root() {
  const dir = path.join(store.root(), 'iface-projects');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileOf(name) {
  return path.join(root(), `${store.slug(name)}${EXT}`);
}

function legacyOf(name) {
  return path.join(root(), `${store.slug(name)}${LEGACY_EXT}`);
}

function cacheOf(name) {
  return path.join(root(), CACHE_NAME, store.slug(name));
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
    name: project.name || path.basename(file, path.extname(file)),
    file,
    description: project.description || '',
    taskType: project.taskType || 'mixed',
    count: ifaces.length,
    tables: ifaces.flatMap((i) => (i.tables || []).map((t) => t.name)),
    routes: ifaces.reduce((n, i) => n + (i.routes || []).length, 0),
    updatedAt: Number(updatedAt || Date.now()),
  };
}

function writeCache(file, name) {
  const dir = cacheOf(name);
  const staging = `${dir}.tmp-${process.pid}`;
  try {
    const entries = pkg.unzip(fs.readFileSync(file));
    fs.rmSync(staging, { recursive: true, force: true });
    for (const entry of Object.keys(entries)) {
      const out = path.join(staging, entry);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, entries[entry]);
    }
    fs.writeFileSync(path.join(staging, 'README.cache.txt'), [
      '这是 ClickBuild 自动生成的可读工作副本，不是工程本体。',
      `工程本体：${file}`,
      '修改这里的文件不会自动同步；请在 ClickBuild 中编辑并保存。',
    ].join('\n'), 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
    return dir;
  } catch (e) {
    // 工作缓存只是方便查看；被编辑器占用或权限不足时不能拖垮工程保存。
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch (e2) { /* 忽略 */ }
    return null;
  }
}

function readProject(file) {
  if (file.toLowerCase().endsWith(EXT)) return pkg.readYxpn(file).project;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function backupLegacy(file) {
  let bak = file + '.bak';
  let n = 2;
  while (fs.existsSync(bak)) bak = `${file}.bak${n++}`;
  fs.renameSync(file, bak);
  return bak;
}

function migrateLegacy(file) {
  if (!file.toLowerCase().endsWith(LEGACY_EXT)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    const name = String(data.name || path.basename(file, LEGACY_EXT));
    const target = fileOf(name);
    if (!fs.existsSync(target)) {
      const stat = fs.statSync(file);
      const saved = spec.normalizeProject({ ...data, name, updatedAt: data.updatedAt || stat.mtimeMs });
      pkg.writeProject(saved, target, { updatedAt: saved.updatedAt, createdAt: stat.birthtime.toISOString() });
      writeCache(target, name);
      const index = readIndex().filter((e) => e.name !== name && path.resolve(e.file) !== path.resolve(target));
      index.push(entryOf(saved, target, saved.updatedAt));
      writeIndex(index);
    }
    backupLegacy(file);
    return entryOf(readProject(target), target, fs.statSync(target).mtimeMs);
  } catch (e) { return null; }
}

function list() {
  const dir = root();
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    if (f === INDEX_NAME) continue;
    const file = path.join(dir, f);
    if (f.toLowerCase().endsWith(EXT)) {
      try {
        const data = readProject(file);
        if (!data || typeof data !== 'object') continue;
        found.push(entryOf(data, file, fs.statSync(file).mtimeMs));
      } catch (e) { /* 损坏的工程包不进历史，避免整页打不开 */ }
    } else if (f.toLowerCase().endsWith(LEGACY_EXT)) {
      const migrated = migrateLegacy(file);
      if (migrated) found.push(migrated);
    }
  }

  const indexed = readIndex();
  const merged = [];
  for (const e of found) merged.push({ ...e, missing: false });
  for (const e of indexed) {
    let file = e.file;
    if (String(file).toLowerCase().endsWith(LEGACY_EXT)) {
      const next = file.slice(0, -LEGACY_EXT.length) + EXT;
      if (fs.existsSync(next)) file = next;
      else continue; // 旧索引里的 .json 已迁移或早已不存在，不再造一条幽灵记录
    }
    if (merged.some((x) => x.name === e.name || path.resolve(x.file) === path.resolve(file))) continue;
    merged.push({ ...e, file, missing: !fs.existsSync(file) });
  }
  merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  writeIndex(merged);
  return merged;
}

function save(project) {
  const name = String(project.name || '接口工作台').trim() || '接口工作台';
  const saved = spec.normalizeProject({ ...project, name, updatedAt: Date.now() });
  const file = fileOf(name);
  pkg.writeProject(saved, file, { updatedAt: saved.updatedAt });
  writeCache(file, name);
  const index = readIndex().filter((e) => e.name !== name && path.resolve(e.file) !== path.resolve(file));
  index.push(entryOf(saved, file, saved.updatedAt));
  writeIndex(index);
  return file;
}

function load(name) {
  let file = fileOf(name);
  if (!fs.existsSync(file)) {
    const legacy = legacyOf(name);
    if (!fs.existsSync(legacy)) return null;
    const migrated = migrateLegacy(legacy);
    if (!migrated) return null;
    file = migrated.file;
  }
  try {
    return readProject(file);
  } catch (e) { return null; }
}

function remove(name) {
  const file = fileOf(name);
  const cache = cacheOf(name);
  const legacy = legacyOf(name);
  let active = fs.existsSync(file) || fs.existsSync(legacy);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.rmSync(cache, { recursive: true, force: true });
  for (const f of [legacy, legacy + '.bak']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  const remaining = readIndex().filter((e) => e.name !== name && path.resolve(e.file) !== path.resolve(file) && path.resolve(e.file) !== path.resolve(legacy));
  writeIndex(remaining);
  return { ok: true, name, removed: active, missing: !active };
}

function duplicate(name) {
  const src = load(name);
  if (!src) return { ok: false, error: '找不到工程：' + name };
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

module.exports = { root, fileOf, cacheOf, list, save, load, remove, duplicate, boot, ensure };
