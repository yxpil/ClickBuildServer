'use strict';

// 插件系统：插件是放在 plugins/<id>/ 里的一个文件夹，plugin.json + 一个 Node 模块。
// 模块导出 apply(project, api)，可以加自定义函数、加接口、给已有脚本做统一改写。
//
// 注意：插件代码在主进程里执行，等同于用户自己的本地脚本；只安装自己信任的插件。

const fs = require('fs');
const path = require('path');
const spec = require('./spec');
const store = require('../store');

function repoPluginsDir() {
  return path.join(__dirname, '..', '..', 'plugins');
}
function userPluginsDir() {
  const dir = path.join(store.root(), 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readMeta(dir) {
  const file = path.join(dir, 'plugin.json');
  if (!fs.existsSync(file)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!meta.id || !meta.name) return null;
    return { ...meta, main: meta.main || 'index.js', dir };
  } catch (e) { return null; }
}

function scan(root, source) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const meta = readMeta(path.join(root, d.name));
    if (!meta) return null;
    return { id: meta.id, name: meta.name, version: meta.version || '0.0.1', description: meta.description || '', main: meta.main, dir: meta.dir, source };
  }).filter(Boolean);
}

function enabledMap() {
  const s = store.readSettings();
  return (s.plugins && s.plugins.enabled) || {};
}

function list() {
  const enabled = enabledMap();
  return [...scan(repoPluginsDir(), 'builtin'), ...scan(userPluginsDir(), 'user')].map((p) => ({
    ...p,
    enabled: enabled[p.id] !== false,
  }));
}

function find(id) {
  return list().find((p) => p.id === id) || null;
}

function setEnabled(id, on) {
  const s = store.readSettings();
  const next = { enabled: { ...((s.plugins && s.plugins.enabled) || {}), [id]: !!on } };
  store.writeSettings({ plugins: next });
  return { ok: true, id, enabled: !!on };
}

function applyOne(plugin, project, warnings) {
  const mainFile = path.join(plugin.dir, plugin.main);
  if (!fs.existsSync(mainFile)) { warnings.push(`${plugin.name}：缺入口 ${plugin.main}`); return project; }
  let mod;
  try { mod = require(mainFile); } catch (e) { warnings.push(`${plugin.name}：加载失败 ${e.message}`); return project; }
  if (typeof mod !== 'function' && typeof mod.apply !== 'function') { warnings.push(`${plugin.name}：没有导出 apply()`); return project; }
  const counters = { functions: 0, routes: 0, ifaces: 0, scripts: 0 };
  const transforms = [];
  const api = {
    addFunction(name, params, body) {
      const fnName = String(name || '').toUpperCase();
      if (!fnName || !body) return false;
      if ((project.functions || []).some((f) => f.name === fnName)) return false;
      project.functions = project.functions || [];
      project.functions.push({ name: fnName, params: Array.isArray(params) ? params : String(params || '').split(',').map((s) => s.trim()).filter(Boolean), body: String(body) });
      counters.functions += 1;
      return true;
    },
    addInterface(raw) {
      const it = spec.normalizeIface(raw, project, project.interfaces.length);
      project.interfaces.push(it);
      counters.ifaces += 1;
      return it;
    },
    findIface(name) {
      return project.interfaces.find((i) => i.name === name) || null;
    },
    addRoute(ifaceName, patch) {
      const target = api.findIface(ifaceName);
      if (!target) return null;
      const r = spec.newRoute('custom', target, target.routes.length);
      Object.assign(r, patch || {});
      r.method = String(r.method || 'GET').toUpperCase();
      if (!r.path) r.path = `/plugin-${target.routes.length + 1}`;
      target.routes.push(r);
      counters.routes += 1;
      return r;
    },
    transformScripts(fn) {
      if (typeof fn === 'function') transforms.push(fn);
    },
    log(msg) { console.log(`[plugin] ${plugin.name}: ${msg}`); },
    spec,
  };
  try {
    const out = (typeof mod === 'function' ? mod : mod.apply)(project, api) || project;
    if (out && typeof out === 'object') project = out;
    if (transforms.length) {
      project.interfaces.forEach((it) => it.routes.forEach((r) => {
        transforms.forEach((fn) => { r.script = String(fn(r.script, it, r, project) || r.script); counters.scripts += 1; });
      }));
    }
  } catch (e) {
    warnings.push(`${plugin.name}：执行失败 ${e.message}`);
  }
  plugin.counters = counters;
  return project;
}

function apply(project, opts) {
  const warnings = [];
  const p = spec.normalizeProject(project);
  const only = opts && Array.isArray(opts.only) ? opts.only : null;
  list().filter((pl) => pl.enabled && (!only || only.includes(pl.id))).forEach((pl) => applyOne(pl, p, warnings));
  return { project: spec.normalizeProject(p), warnings, applied: list().filter((pl) => pl.enabled).map((pl) => pl.id) };
}

function installFromDir(dir) {
  const meta = readMeta(dir);
  if (!meta) return { ok: false, error: '这个文件夹里没有合法的 plugin.json（至少需要 id / name）' };
  const target = path.join(userPluginsDir(), String(meta.id).replace(/[^A-Za-z0-9_.-]/g, '_'));
  fs.mkdirSync(target, { recursive: true });
  const copy = (from, to) => fs.readdirSync(from, { withFileTypes: true }).forEach((d) => {
    const a = path.join(from, d.name);
    const b = path.join(to, d.name);
    if (d.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); } else fs.copyFileSync(a, b);
  });
  copy(dir, target);
  setEnabled(meta.id, true);
  return { ok: true, id: meta.id, dir: target };
}

function uninstall(id) {
  const p = find(id);
  if (!p) return { ok: false, error: '没有这个插件' };
  if (p.source === 'builtin') return { ok: false, error: '内置插件不能删除，可以禁用' };
  if (fs.existsSync(p.dir)) fs.rmSync(p.dir, { recursive: true, force: true });
  const s = store.readSettings();
  const enabled = { ...((s.plugins && s.plugins.enabled) || {}) };
  delete enabled[id];
  store.writeSettings({ plugins: { enabled } });
  return { ok: true, id };
}

module.exports = { list, find, setEnabled, apply, installFromDir, uninstall, repoPluginsDir, userPluginsDir };
