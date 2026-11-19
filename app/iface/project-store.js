'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../store');
const spec = require('./spec');

function root() {
  const dir = path.join(store.root(), 'iface-projects');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileOf(name) {
  return path.join(root(), `${store.slug(name)}.json`);
}

function list() {
  const dir = root();
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return {
          file: path.join(dir, f),
          name: data.name || f.replace(/\.json$/, ''),
          count: (data.interfaces || []).length,
          tables: (data.interfaces || []).flatMap((i) => (i.tables || []).map((t) => t.name)),
          updatedAt: fs.statSync(path.join(dir, f)).mtimeMs,
        };
      } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function save(project) {
  const name = String(project.name || '接口工作台').trim() || '接口工作台';
  const file = fileOf(name);
  fs.writeFileSync(file, JSON.stringify({ ...project, name, updatedAt: Date.now() }, null, 2), 'utf8');
  return file;
}

function load(name) {
  const file = fileOf(name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function remove(name) {
  const file = fileOf(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
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

module.exports = { root, list, save, load, remove, boot, ensure };
