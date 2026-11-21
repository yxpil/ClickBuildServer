// 作者：yxpil
'use strict';

// 插件系统 v2：插件是 plugins/<id>/ 下的一个文件夹（plugin.json + 入口模块）。
//
// 两代插件都兼容：
//   - 旧插件：module.exports = function apply(project, api) { ... }，只在“生成服务”时改工程。
//   - 新插件：module.exports = { activate(api) { ... } }，可以注册命令、Ribbon 入口、
//     生命周期钩子、模版、工程字段/表/路由，并使用插件数据目录。
//
// 插件在 Electron 主进程的独立 vm 上下文里执行，默认拿不到 require / process / 全局文件系统。
// 注意：vm 不是操作系统级沙箱，插件仍然是本地代码；只安装你信任的插件。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { createRequire } = require('module');
const spec = require('./spec');
const store = require('../store');

const API_VERSION = '2.0';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

const HOOKS = [
  { name: 'app.start', when: '插件全部加载完成后触发一次' },
  { name: 'app.shutdown', when: '应用退出前触发一次' },
  { name: 'project.open', when: '工程打开后、进入工作台前' },
  { name: 'project.beforeSave', when: '保存工程前，可返回 { project } 改写' },
  { name: 'project.afterSave', when: '工程写盘后' },
  { name: 'template.apply', when: '从模版新建工程前' },
  { name: 'generate.before', when: '生成服务前，可返回 { project } 改写' },
  { name: 'generate.after', when: '生成目录写完后' },
  { name: 'export.before', when: '导出工程前，可返回 { project } 改写' },
  { name: 'export.after', when: '导出工程完成后' },
  { name: 'server.beforeStart', when: '启动生成服务前' },
  { name: 'server.afterStart', when: '生成服务已监听端口后' },
  { name: 'server.beforeStop', when: '停止生成服务前' },
];
const HOOK_NAMES = HOOKS.map((x) => x.name);

const PERMISSIONS = [
  { name: 'project:read', desc: '读取工程、查询接口/表/字段、返回报告', level: '' },
  { name: 'project:write', desc: '新增/修改字段、表、路由、函数和脚本', level: '写' },
  { name: 'ui:commands', desc: '在工作台 Ribbon 和插件面板注册命令', level: '写' },
  { name: 'templates', desc: '向模版库注册工程模版', level: '写' },
  { name: 'files', desc: '读写插件自己的 assets/ 与数据目录', level: '写' },
  { name: 'network', desc: '调用 api.fetch 访问外部 HTTP', level: '网络' },
  { name: 'node', desc: '通过 api.node.require 加载 Node 模块（高权限）', level: '高' },
];

const state = {
  loaded: false,
  loading: false,
  registry: [],
  commands: new Map(),
  hooks: new Map(),
  templates: new Map(),
  logs: [],
  bus: new Map(),
  lastReload: '',
  startFired: false,
};

function repoPluginsDir() {
  return path.join(__dirname, '..', '..', 'plugins');
}
function userPluginsDir() {
  const dir = path.join(store.root(), 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function dataRoot() {
  const dir = path.join(store.root(), 'plugin-data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function dataDir(id) {
  const dir = path.join(dataRoot(), String(id).replace(/[^A-Za-z0-9_.-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logLine(plugin, text, level) {
  const line = `[${new Date().toISOString()}] [${level || 'info'}] ${plugin ? plugin.id : '-'}: ${text}`;
  state.logs.push(line);
  if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500);
  console.log(`[plugin] ${line}`);
}

function readMeta(dir) {
  const file = path.join(dir, 'plugin.json');
  if (!fs.existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  if (!ID_RE.test(id) || !name) return null;
  const main = String(raw.main || 'index.js').replace(/\\/g, '/');
  if (!main || main.includes('..') || path.isAbsolute(main)) return null;
  const permissions = Array.isArray(raw.permissions) ? raw.permissions.map((x) => String(x)).filter(Boolean) : [];
  const contributes = (raw.contributes && typeof raw.contributes === 'object') ? raw.contributes : {};
  const commands = Array.isArray(contributes.commands) ? contributes.commands.filter((c) => c && c.id).map((c) => ({
    id: String(c.id),
    title: String(c.title || c.id),
    icon: String(c.icon || 'more'),
    description: String(c.description || ''),
    group: String(c.group || '插件'),
  })) : [];
  return {
    id, name,
    version: String(raw.version || '0.0.1'),
    description: String(raw.description || ''),
    author: String(raw.author || ''),
    homepage: String(raw.homepage || ''),
    main,
    permissions,
    contributes: { ...contributes, commands },
    dir,
  };
}

function scan(root, source) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const meta = readMeta(path.join(root, d.name));
    if (!meta) return null;
    return { ...meta, source };
  }).filter(Boolean);
}

function enabledMap() {
  const s = store.readSettings();
  return (s.plugins && s.plugins.enabled) || {};
}

function hasPerm(plugin, perm) {
  return plugin.permissions.includes(perm);
}

function commandFullId(plugin, id) {
  const short = String(id || '').trim();
  if (!short) return '';
  if (short.startsWith(`${plugin.id}:`)) return short;
  if (short.includes(':')) return short;
  return `${plugin.id}:${short}`;
}

function commandMeta(plugin, id) {
  const declared = (plugin.contributes.commands || []).find((c) => {
    const full = commandFullId(plugin, c.id);
    return full === id || c.id === id;
  });
  return declared || null;
}

function buildApi(plugin) {
  const api = {
    apiVersion: API_VERSION,
    meta: {
      id: plugin.id, name: plugin.name, version: plugin.version,
      author: plugin.author, dir: plugin.dir, permissions: plugin.permissions.slice(),
    },
    log: (msg) => logLine(plugin, msg, 'info'),
    warn: (msg) => logLine(plugin, msg, 'warn'),
    hasPermission: (perm) => hasPerm(plugin, perm),
    spec,
    commands: {
      register(id, handler, meta) {
        if (!hasPerm(plugin, 'ui:commands')) {
          api.warn(`没有 ui:commands 权限，命令 ${id} 未注册`);
          return false;
        }
        if (typeof handler !== 'function') return false;
        const full = commandFullId(plugin, id);
        if (!full) return false;
        const declared = commandMeta(plugin, full) || commandMeta(plugin, id) || {};
        const item = {
          id: full,
          short: String(id).replace(`${plugin.id}:`, ''),
          title: String((meta && meta.title) || declared.title || full),
          icon: String((meta && meta.icon) || declared.icon || 'more'),
          description: String((meta && meta.description) || declared.description || ''),
        };
        state.commands.set(full, { pluginId: plugin.id, id: full, handler });
        const old = plugin.commands.findIndex((x) => x.id === full);
        const entry = { ...item, registered: true };
        if (old >= 0) plugin.commands[old] = entry; else plugin.commands.push(entry);
        return full;
      },
    },
    hooks: {
      on(name, handler) {
        if (!HOOK_NAMES.includes(name)) { api.warn(`未知钩子 ${name}`); return false; }
        if (typeof handler !== 'function') return false;
        if (!state.hooks.has(name)) state.hooks.set(name, []);
        state.hooks.get(name).push({ pluginId: plugin.id, plugin, fn: handler });
        if (!plugin.hooks.includes(name)) plugin.hooks.push(name);
        return true;
      },
    },
    templates: {
      register(def) {
        if (!hasPerm(plugin, 'templates')) { api.warn('没有 templates 权限，模版未注册'); return false; }
        if (!def || !def.project) return false;
        const short = String(def.id || def.name || '').trim();
        if (!short) return false;
        const id = short.startsWith(`plugin:${plugin.id}:`) ? short : `plugin:${plugin.id}:${short}`;
        const project = spec.normalizeProject(JSON.parse(JSON.stringify(def.project)));
        const counts = {
          interfaces: project.interfaces.length,
          tables: project.interfaces.reduce((n, i) => n + i.tables.length, 0),
          routes: project.interfaces.reduce((n, i) => n + i.routes.length, 0),
        };
        const item = {
          id, pluginId: plugin.id, name: String(def.name || short),
          description: String(def.description || '来自插件的工程模版'), tags: def.tags || [],
          project, counts,
        };
        state.templates.set(id, item);
        if (!plugin.templates.includes(id)) plugin.templates.push(id);
        return id;
      },
    },
    events: {
      on(name, handler) {
        if (typeof handler !== 'function') return false;
        if (!state.bus.has(name)) state.bus.set(name, []);
        state.bus.get(name).push({ pluginId: plugin.id, fn: handler });
        return true;
      },
      emit(name, payload) {
        const list = state.bus.get(name) || [];
        for (const h of list) {
          try { h.fn(payload, { from: plugin.id }); } catch (e) { api.warn(`事件 ${name} 处理失败：${e.message}`); }
        }
        return list.length;
      },
    },
    settings: {
      get(key) {
        const s = store.readSettings();
        const cfg = (s.plugins && s.plugins.config && s.plugins.config[plugin.id]) || {};
        return key == null ? cfg : cfg[key];
      },
      set(patch) {
        const s = store.readSettings();
        const cfg = { ...((s.plugins && s.plugins.config && s.plugins.config[plugin.id]) || {}), ...(patch || {}) };
        store.writeSettings({ plugins: { config: { ...((s.plugins && s.plugins.config) || {}), [plugin.id]: cfg } } });
        return cfg;
      },
    },
    data: {
      dir: dataDir(plugin.id),
      read(name, fallback) {
        if (!hasPerm(plugin, 'files')) { api.warn('没有 files 权限，data.read 被拒绝'); return fallback; }
        try { return JSON.parse(fs.readFileSync(path.join(dataDir(plugin.id), safeName(name)), 'utf8')); }
        catch (e) { return fallback; }
      },
      write(name, value) {
        if (!hasPerm(plugin, 'files')) { api.warn('没有 files 权限，data.write 被拒绝'); return false; }
        fs.writeFileSync(path.join(dataDir(plugin.id), safeName(name)), JSON.stringify(value, null, 2), 'utf8');
        return true;
      },
    },
    files: {
      readText(rel) {
        if (!hasPerm(plugin, 'files')) { api.warn('没有 files 权限，files.read 被拒绝'); return null; }
        try { return fs.readFileSync(safeJoin(plugin.dir, rel), 'utf8'); } catch (e) { return null; }
      },
      writeText(rel, text) {
        if (!hasPerm(plugin, 'files')) { api.warn('没有 files 权限，files.write 被拒绝'); return false; }
        try {
          const file = safeJoin(plugin.dir, rel);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, String(text), 'utf8');
          return true;
        } catch (e) { return false; }
      },
      list(rel) {
        if (!hasPerm(plugin, 'files')) return [];
        try { return fs.readdirSync(safeJoin(plugin.dir, rel || '.')); } catch (e) { return []; }
      },
    },
    fetch: (url, init) => {
      if (!hasPerm(plugin, 'network')) return Promise.reject(new Error('没有 network 权限'));
      return fetch(url, init);
    },
    node: {
      require(name) {
        if (!hasPerm(plugin, 'node')) throw new Error('没有 node 权限');
        return createRequire(path.join(plugin.dir, 'index.js'))(name);
      },
    },
    project: {
      seed: () => JSON.parse(JSON.stringify(spec.seedProject())),
      normalize: (p) => spec.normalizeProject(JSON.parse(JSON.stringify(p))),
      validate: (p) => spec.validateProject(spec.normalizeProject(JSON.parse(JSON.stringify(p)))),
      clone: (p) => JSON.parse(JSON.stringify(p)),
      findIface(project, key) {
        return (project.interfaces || []).find((i) => i.id === key || i.name === key) || null;
      },
      findTable(project, ifaceKey, tableKey) {
        const it = api.project.findIface(project, ifaceKey);
        if (!it) return null;
        return (it.tables || []).find((t) => t.key === tableKey || t.name === tableKey) || null;
      },
      addFunction(project, name, params, body) {
        if (!hasPerm(plugin, 'project:write')) return false;
        const fnName = String(name || '').toUpperCase();
        if (!fnName || !body) return false;
        project.functions = project.functions || [];
        if (project.functions.some((f) => f.name === fnName)) return false;
        project.functions.push({
          name: fnName,
          params: Array.isArray(params) ? params : String(params || '').split(',').map((s) => s.trim()).filter(Boolean),
          body: String(body),
        });
        return true;
      },
      addInterface(project, raw) {
        if (!hasPerm(plugin, 'project:write')) return null;
        const it = spec.normalizeIface(raw, project, (project.interfaces || []).length);
        project.interfaces = project.interfaces || [];
        project.interfaces.push(it);
        return it;
      },
      addRoute(project, ifaceKey, patch) {
        if (!hasPerm(plugin, 'project:write')) return null;
        const target = api.project.findIface(project, ifaceKey);
        if (!target) return null;
        const r = spec.newRoute('custom', target, target.routes.length);
        Object.assign(r, patch || {});
        r.method = String(r.method || 'GET').toUpperCase();
        if (!r.path) r.path = `/plugin-${target.routes.length + 1}`;
        target.routes.push(r);
        return r;
      },
      addTable(project, ifaceKey, raw) {
        if (!hasPerm(plugin, 'project:write')) return null;
        const target = api.project.findIface(project, ifaceKey);
        if (!target) return null;
        const used = new Set((target.tables || []).map((t) => t.key));
        const table = spec.normalizeTable(raw || {}, target.tables.length, used);
        target.tables.push(table);
        return table;
      },
      addField(project, ifaceKey, tableKey, patch) {
        if (!hasPerm(plugin, 'project:write')) return null;
        const table = api.project.findTable(project, ifaceKey, tableKey);
        if (!table) return null;
        const p = patch || {};
        if (table.fields.some((f) => f.name === p.name)) return null;
        const field = { ...spec.newField(p.name || 'field', p.type || 'varchar'), ...p };
        table.fields.push(field);
        return field;
      },
      transformScripts(project, fn) {
        if (!hasPerm(plugin, 'project:write') || typeof fn !== 'function') return 0;
        let n = 0;
        (project.interfaces || []).forEach((it) => (it.routes || []).forEach((r) => {
          const out = fn(String(r.script || ''), it, r, project);
          if (typeof out === 'string' && out !== r.script) { r.script = out; n += 1; }
        }));
        return n;
      },
    },
  };
  return api;
}

function safeName(name) {
  return String(name || 'data.json').replace(/[^A-Za-z0-9_.-]/g, '_') || 'data.json';
}
function safeJoin(root, rel) {
  const base = path.resolve(root);
  const full = path.resolve(base, String(rel || '.'));
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('路径越界');
  return full;
}

function loadOne(plugin) {
  plugin.loaded = false;
  plugin.legacy = false;
  plugin.commands = [];
  plugin.hooks = [];
  plugin.templates = [];
  plugin.errors = [];
  const mainFile = path.join(plugin.dir, plugin.main);
  if (!fs.existsSync(mainFile)) {
    plugin.errors.push(`缺入口 ${plugin.main}`);
    return;
  }
  let code;
  try { code = fs.readFileSync(mainFile, 'utf8'); } catch (e) { plugin.errors.push(`读入口失败：${e.message}`); return; }
  const api = buildApi(plugin);
  plugin.api = api;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    api,
    console: {
      log: (...a) => logLine(plugin, a.map(String).join(' '), 'info'),
      warn: (...a) => logLine(plugin, a.map(String).join(' '), 'warn'),
      error: (...a) => logLine(plugin, a.map(String).join(' '), 'error'),
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    __dirname: plugin.dir,
    __filename: mainFile,
  };
  if (hasPerm(plugin, 'node')) {
    try { sandbox.require = createRequire(mainFile); sandbox.Buffer = Buffer; sandbox.process = process; } catch (e) { /* 忽略 */ }
  }
  if (hasPerm(plugin, 'network')) sandbox.fetch = (url, init) => global.fetch(url, init);
  try {
    vm.createContext(sandbox);
    const wrapper = vm.runInContext(
      `(function(module,exports,api,require,__dirname,__filename){\n${code}\n})`,
      sandbox,
      { filename: mainFile, timeout: 3000 }
    );
    wrapper(module, module.exports, api, sandbox.require, plugin.dir, mainFile);
    const exp = module.exports;
    plugin.instance = exp;
    if (typeof exp === 'function') {
      plugin.legacy = true;
      plugin.loaded = true;
    } else if (exp && typeof exp.activate === 'function') {
      exp.activate(api);
      plugin.loaded = true;
    } else if (exp && typeof exp.apply === 'function') {
      plugin.legacy = true;
      plugin.loaded = true;
    } else {
      plugin.errors.push('入口没有导出 activate() 或 apply()');
    }
  } catch (e) {
    plugin.errors.push(`加载失败：${e.message}`);
    logLine(plugin, `加载失败：${e.stack || e.message}`, 'error');
  }
  for (const declared of plugin.contributes.commands || []) {
    const full = commandFullId(plugin, declared.id);
    if (!plugin.commands.some((c) => c.id === full)) {
      plugin.commands.push({
        id: full, short: declared.id, title: declared.title, icon: declared.icon,
        description: declared.description, registered: false,
      });
    }
  }
}

function publicPlugin(p) {
  return {
    id: p.id, name: p.name, version: p.version, description: p.description, author: p.author,
    homepage: p.homepage, source: p.source, dir: p.dir, enabled: p.enabled !== false,
    loaded: !!p.loaded, legacy: !!p.legacy, errors: p.errors || [],
    permissions: p.permissions.slice(), commands: p.commands || [], hooks: p.hooks || [],
    templates: p.templates || [],
  };
}

function reload() {
  if (state.loading) return summary();
  state.loading = true;
  for (const p of state.registry) {
    try {
      if (p.instance && typeof p.instance.deactivate === 'function') p.instance.deactivate(p.api);
    } catch (e) { logLine(p, `deactivate 失败：${e.message}`, 'warn'); }
  }
  state.registry = [];
  state.commands.clear();
  state.hooks.clear();
  state.templates.clear();
  state.bus.clear();
  state.logs = [];
  const enabled = enabledMap();
  const seen = new Map();
  for (const p of [...scan(repoPluginsDir(), 'builtin'), ...scan(userPluginsDir(), 'user')]) {
    seen.set(p.id, p);
  }
  state.registry = Array.from(seen.values()).map((p) => {
    p.enabled = enabled[p.id] !== false;
    p.commands = []; p.hooks = []; p.templates = []; p.errors = [];
    if (p.enabled) loadOne(p);
    else { p.loaded = false; p.errors = []; }
    return p;
  });
  state.lastReload = new Date().toISOString();
  state.loading = false;
  state.loaded = true;
  state.startFired = false;
  fireNow('app.start', { apiVersion: API_VERSION, plugins: state.registry.filter((p) => p.enabled).length });
  return summary();
}

function ensureLoaded() {
  if (!state.loaded && !state.loading) reload();
}

async function fireNow(name, payload) {
  const ctx = { ...(payload || {}) };
  const handlers = state.hooks.get(name) || [];
  for (const h of handlers) {
    const plugin = state.registry.find((p) => p.id === h.pluginId);
    if (!plugin || !plugin.enabled || !plugin.loaded) continue;
    try {
      const out = await h.fn(ctx, { plugin: publicPlugin(plugin) });
      if (out === false) { ctx.canceled = true; break; }
      if (out && typeof out === 'object') {
        if (out.project && Array.isArray(out.project.interfaces)) ctx.project = out.project;
        for (const k of Object.keys(out)) if (k !== 'project') ctx[k] = out[k];
      }
    } catch (e) {
      plugin.errors.push(`钩子 ${name} 失败：${e.message}`);
      logLine(plugin, `钩子 ${name} 失败：${e.stack || e.message}`, 'error');
    }
  }
  return ctx;
}

async function fire(name, payload) {
  ensureLoaded();
  return fireNow(name, payload);
}

function legacyApplyOne(plugin, project, warnings) {
  const mod = plugin.instance;
  if (!mod) { if (plugin.errors.length) warnings.push(`${plugin.name}：${plugin.errors[0]}`); return project; }
  if (typeof mod !== 'function' && typeof mod.apply !== 'function') return project;
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
    findIface(name) { return project.interfaces.find((i) => i.name === name) || null; },
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
    transformScripts(fn) { if (typeof fn === 'function') transforms.push(fn); },
    log(msg) { logLine(plugin, msg, 'info'); },
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
    logLine(plugin, `执行失败：${e.stack || e.message}`, 'error');
  }
  plugin.counters = counters;
  return project;
}

function apply(project, opts) {
  ensureLoaded();
  const warnings = [];
  let p = spec.normalizeProject(JSON.parse(JSON.stringify(project)));
  const only = opts && Array.isArray(opts.only) ? opts.only : null;
  for (const pl of state.registry) {
    if (!pl.enabled || (only && !only.includes(pl.id))) continue;
    if (pl.errors.length) { warnings.push(`${pl.name}：${pl.errors[0]}`); continue; }
    if (pl.legacy) p = legacyApplyOne(pl, p, warnings);
  }
  p = spec.normalizeProject(p);
  return { project: p, warnings, applied: state.registry.filter((pl) => pl.enabled).map((pl) => pl.id) };
}

async function runCommand(id, payload) {
  ensureLoaded();
  const entry = state.commands.get(String(id || ''));
  if (!entry) return { ok: false, error: `没有插件命令 ${id}` };
  const plugin = state.registry.find((p) => p.id === entry.pluginId);
  if (!plugin || !plugin.enabled) return { ok: false, error: `插件 ${entry.pluginId} 未启用` };
  const ctx = { ...(payload || {}) };
  if (ctx.project) ctx.project = spec.normalizeProject(JSON.parse(JSON.stringify(ctx.project)));
  ctx.plugin = publicPlugin(plugin);
  try {
    const result = await entry.handler(ctx, { plugin: publicPlugin(plugin) });
    const out = { ok: true, ...(result || {}) };
    if (out.ok === false) return { ok: false, error: out.error || out.message || '插件命令失败' };
    if (out.project) out.project = spec.normalizeProject(JSON.parse(JSON.stringify(out.project)));
    logLine(plugin, `命令 ${id} 执行完成`, 'info');
    return out;
  } catch (e) {
    plugin.errors.push(`命令 ${id} 失败：${e.message}`);
    logLine(plugin, `命令 ${id} 失败：${e.stack || e.message}`, 'error');
    return { ok: false, error: `插件命令失败：${e.message}` };
  }
}

function summary() {
  ensureLoaded();
  const commands = [];
  for (const p of state.registry) {
    if (!p.enabled) continue;
    for (const c of p.commands) commands.push({ ...c, pluginId: p.id, pluginName: p.name });
  }
  return {
    ok: true,
    apiVersion: API_VERSION,
    loadedAt: state.lastReload,
    list: state.registry.map(publicPlugin),
    commands,
    hooks: HOOKS.slice(),
    permissions: PERMISSIONS.slice(),
    dirs: { repo: repoPluginsDir(), user: userPluginsDir(), data: dataRoot() },
  };
}

function list() { return summary().list; }
function find(id) { return summary().list.find((p) => p.id === id) || null; }
function setEnabled(id, on) {
  const s = store.readSettings();
  const enabled = { ...((s.plugins && s.plugins.enabled) || {}), [id]: !!on };
  store.writeSettings({ plugins: { enabled } });
  reload();
  return { ok: true, id, enabled: !!on };
}

function templates() {
  ensureLoaded();
  return Array.from(state.templates.values()).map((t) => ({
    id: t.id, name: t.name, description: t.description, tags: t.tags,
    kind: 'plugin', counts: t.counts, pluginId: t.pluginId,
  }));
}
function getTemplate(id) {
  ensureLoaded();
  const t = state.templates.get(String(id || ''));
  if (!t) return { ok: false, error: '没有这个插件模版' };
  return { ok: true, id: t.id, name: t.name, description: t.description, counts: t.counts, project: t.project };
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const d of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, d.name);
    const b = path.join(to, d.name);
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

function installFromDir(dir) {
  const meta = readMeta(dir);
  if (!meta) return { ok: false, error: '这个文件夹里没有合法的 plugin.json（至少需要 id / name，id 只能包含字母数字 . _ -）' };
  const target = path.join(userPluginsDir(), meta.id);
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  copyDir(dir, target);
  setEnabled(meta.id, true);
  return { ok: true, id: meta.id, dir: target, summary: summary() };
}

function uninstall(id) {
  const p = state.registry.find((x) => x.id === id) || find(id);
  if (!p) return { ok: false, error: '没有这个插件' };
  if (p.source === 'builtin') return { ok: false, error: '内置插件不能删除，可以禁用' };
  if (fs.existsSync(p.dir)) fs.rmSync(p.dir, { recursive: true, force: true });
  const s = store.readSettings();
  const enabled = { ...((s.plugins && s.plugins.enabled) || {}) };
  delete enabled[id];
  store.writeSettings({ plugins: { enabled } });
  reload();
  return { ok: true, id, summary: summary() };
}

function scaffold(name) {
  const wanted = String(name || 'hello-plugin').trim();
  let id = wanted.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!ID_RE.test(id)) id = `hello-plugin-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(userPluginsDir(), id);
  if (fs.existsSync(dir)) return { ok: false, error: `插件目录已存在：${dir}` };
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    id,
    name: wanted || 'Hello 插件',
    version: '1.0.0',
    description: '一个能注册命令、监听生成钩子的最小插件。',
    main: 'index.js',
    author: '你',
    permissions: ['project:read', 'ui:commands'],
    contributes: {
      commands: [{ id: 'hello', title: '问候', icon: 'help', description: '弹出一条插件消息' }],
    },
  };
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.js'), `'use strict';

module.exports = {
  activate(api) {
    api.commands.register('hello', async (ctx) => ({
      ok: true,
      message: '你好，' + (ctx.project ? ctx.project.name : '世界') + '！这条消息来自插件 ' + api.meta.name,
    }));

    api.hooks.on('generate.before', (ctx) => {
      api.log('准备生成：' + ctx.project.name);
    });
  },
};
`, 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${manifest.name}

这是一个 ClickBuildServer 插件。修改 \`index.js\` 后，在「插件」面板点「重新加载」即可生效。

- \`api.commands.register(id, handler)\` 注册工作台命令
- \`api.hooks.on(name, handler)\` 监听生命周期
- \`api.project.addField / addTable / addRoute\` 修改当前工程
- \`api.templates.register({ id, name, project })\` 往模版库加模版

插件运行在主进程的独立 vm 上下文，默认没有 require / process / 文件系统。
只安装你信任的插件。
`, 'utf8');
  reload();
  return { ok: true, id, dir, files: ['plugin.json', 'index.js', 'README.md'], summary: summary() };
}

function docs() {
  return {
    ok: true,
    apiVersion: API_VERSION,
    hooks: HOOKS,
    permissions: PERMISSIONS,
    api: [
      { name: 'api.commands.register(id, fn, meta?)', desc: '注册工作台命令，fn(ctx) 可返回 { message, project, html, openUrl }' },
      { name: 'api.hooks.on(name, fn)', desc: '监听生命周期；返回 { project } 可改写工程，返回 false 可取消' },
      { name: 'api.templates.register({ id, name, project })', desc: '向模版库注册工程模版' },
      { name: 'api.project.seed()', desc: '拿一份内置示例工程副本' },
      { name: 'api.project.addField(project, iface, table, field)', desc: '给表加字段' },
      { name: 'api.project.addTable(project, iface, table)', desc: '给接口加表' },
      { name: 'api.project.addRoute(project, iface, route)', desc: '给接口加路由' },
      { name: 'api.project.addFunction(project, name, params, body)', desc: '加脚本函数' },
      { name: 'api.project.transformScripts(project, fn)', desc: '统一改写全部路由脚本' },
      { name: 'api.data.read/write(name, value)', desc: '插件私有 JSON 数据' },
      { name: 'api.files.readText/writeText(rel)', desc: '插件目录内的文件' },
      { name: 'api.settings.get/set', desc: '插件自己的设置项' },
      { name: 'api.events.on/emit', desc: '插件之间通信' },
      { name: 'api.fetch(url, init)', desc: '需要 network 权限' },
      { name: 'api.node.require(name)', desc: '需要 node 权限' },
    ],
    manifest: {
      id: 'hello-plugin',
      name: 'Hello 插件',
      version: '1.0.0',
      main: 'index.js',
      permissions: ['project:read', 'ui:commands'],
      contributes: { commands: [{ id: 'hello', title: '问候', icon: 'help' }] },
    },
    example: `module.exports = {
  activate(api) {
    api.commands.register('hello', async (ctx) => ({
      ok: true,
      message: '你好，' + ctx.project.name,
    }));
    api.hooks.on('generate.before', (ctx) => {
      api.log('准备生成：' + ctx.project.name);
    });
  },
};`,
  };
}

function logs() { ensureLoaded(); return state.logs.slice(); }

function shutdown() {
  for (const p of state.registry) {
    try { if (p.instance && typeof p.instance.deactivate === 'function') p.instance.deactivate(p.api); } catch (e) { /* 忽略 */ }
  }
  return fireNow('app.shutdown', {});
}

module.exports = {
  API_VERSION, HOOKS, PERMISSIONS,
  list, find, summary, setEnabled, apply, installFromDir, uninstall,
  repoPluginsDir, userPluginsDir, dataRoot,
  templates, getTemplate, runCommand, fire, reload, scaffold, docs, logs, shutdown,
};
