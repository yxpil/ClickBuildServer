'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, BrowserWindow, app, screen } = require('electron');

const spec = require('./spec');
const render = require('./render');
const script = require('./script');
const docs = require('./docs');
const funcs = require('./funcs');
const codegen = require('./codegen');
const services = require('./services');
const projects = require('./project-store');
const pkg = require('./package');
const ai = require('./ai');
const templates = require('./templates');
const ifaceLibrary = require('./iface-library');
const plugins = require('./plugins');
const defender = require('./defender');
const frontend = require('./frontend');
const projectExport = require('./project-export');
const deployer = require('./deploy');
const store = require('../store');
const i18n = require('../i18n');

function ctxOf(payload) {
  const query = {};
  for (const [k, v] of Object.entries((payload && payload.query) || {})) {
    if (v !== '' && v != null) query[k] = v;
  }
  let body = {};
  if (payload && payload.bodyText) {
    try { body = JSON.parse(payload.bodyText); } catch (e) { body = {}; }
  }
  return {
    query,
    body,
    path: {},
    id: (payload && payload.id) || query.id || body.id || null,
    uuid: '00000000-0000-0000-0000-000000000000',
    now: '2026-01-01 00:00:00',
    file: { filename: 'demo.png', contentType: 'image/png', size: 1024, objectKey: 'demo/object.png', objectUrl: 's3://demo' },
  };
}

function pickRoute(iface, routeId) {
  const it = spec.normalizeIface(iface, { categories: [{ id: 'biz', name: '默认' }] }, 0);
  const route = it.routes.find((r) => r.id === routeId) || it.routes[0];
  return { iface: it, route };
}

function preview(payload) {
  try {
    const { iface, route } = pickRoute(payload.iface, payload.routeId);
    const ctx = ctxOf(payload);
    const ast = script.parseScript(route.script || '').ast;
    const statements = [];
    const walk = (list) => list.forEach((st) => {
      if ((st.k === 'let' && st.from) || st.k === 'sql') {
        const built = render.renderSqlText(st.sql, iface, ctx);
        statements.push({ mode: st.from || st.mode || 'QUERY', name: st.name || '', sql: built.sql, params: built.params });
      }
      if (st.k === 'if') st.branches.forEach((b) => walk(b.body));
      if (st.k === 'if' && st.elseBody) walk(st.elseBody);
      if (st.k === 'foreach') walk(st.body);
    });
    walk(ast);
    const cacheKey = route.cache && route.cache.enabled ? render.renderText(route.cache.key || '', iface, ctx) : '';
    return { ok: true, statements, cacheKey, ddl: spec.ddlOf(iface) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function requestServer(payload) {
  const ports = services.settings().ports;
  const target = new URL(`http://127.0.0.1:${ports.http}${payload.path}`);
  for (const [k, v] of Object.entries(payload.query || {})) {
    if (v !== '' && v != null) target.searchParams.set(k, v);
  }
  const init = { method: payload.method || 'GET', headers: {} };
  if (payload.file && payload.file.base64) {
    init.headers['content-type'] = payload.file.contentType || 'application/octet-stream';
    init.headers['x-filename'] = payload.file.filename || 'upload.bin';
    init.body = Buffer.from(payload.file.base64, 'base64');
  } else if (payload.bodyText) {
    init.headers['content-type'] = 'application/json';
    init.body = payload.bodyText;
  }
  const started = Date.now();
  const res = await fetch(target, init);
  const text = await res.text();
  return { status: res.status, ms: Date.now() - started, body: text };
}

async function probeUpstream(baseUrl, timeout) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^http(s)?:\/\//i.test(base)) throw new Error('baseUrl 需要 http(s):// 开头');
  const candidates = [`${base}/openapi.json`, `${base}/swagger.json`, `${base}/api-docs`];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(Number(timeout) || 8000), headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const text = await r.text();
      const data = JSON.parse(text);
      const paths = data.paths || data.swagger?.paths || {};
      const routes = [];
      for (const [p, methods] of Object.entries(paths)) {
        for (const [m, def] of Object.entries(methods || {})) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(String(m).toLowerCase())) continue;
          routes.push({ method: String(m).toUpperCase(), path: p, name: (def && (def.summary || def.operationId)) || p });
        }
      }
      return { ok: true, url, title: data.info?.title || '', version: data.info?.version || '', routes };
    } catch (e) { /* 试下一个 */ }
  }
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(Number(timeout) || 8000) });
    return { ok: r.ok, url: base, title: r.headers.get('server') || '', routes: [], note: r.ok ? '未找到 OpenAPI，但上游可访问' : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, url: base, routes: [], error: e.message };
  }
}

function s3ClientOf(project) {
  const Minio = require('minio');
  const ports = services.settings().ports;
  const c = ((project && project.connections && project.connections.s3) || [])[0] || {};
  return new Minio.Client({
    endPoint: c.endpoint || '127.0.0.1',
    port: Number(c.port || ports.s3),
    useSSL: false,
    accessKey: c.accessKey || 'clickbuild',
    secretKey: c.secretKey || 'clickbuild123',
  });
}

function listS3Objects(project, bucket, prefix, marker) {
  const client = s3ClientOf(project);
  const bucketName = String(bucket || 'clickbuild');
  const rows = [];
  return new Promise((resolve, reject) => {
    const stream = client.listObjectsV2(bucketName, String(prefix || ''), true, String(marker || ''));
    stream.on('data', (o) => rows.push({ key: o.name, name: String(o.name || '').split('/').pop(), size: o.size, etag: o.etag, lastModified: o.lastModified }));
    stream.on('end', () => resolve({ ok: true, bucket: bucketName, rows }));
    stream.on('error', (e) => reject(e));
  });
}

async function tryRoute(project, ifaceId, routeId, bodyText, query) {
  const p = spec.normalizeProject(project);
  const it = (p.interfaces || []).find((x) => x.id === ifaceId);
  if (!it) throw new Error('接口不存在');
  const route = (it.routes || []).find((x) => x.id === routeId) || it.routes[0];
  if (!route) throw new Error('路由不存在');
  let path = `${it.basePath || ''}${route.path || ''}`;
  const pathKeys = new Set();
  path = path.replace(/:([A-Za-z0-9_]+)/g, (m, k) => {
    pathKeys.add(k);
    return encodeURIComponent((query && query[k]) || (query && query.id) || '1');
  });
  const ports = services.settings().ports;
  const target = new URL(`http://127.0.0.1:${ports.http}/api${path.startsWith('/') ? '' : '/'}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (pathKeys.has(k)) continue;
    if (v !== '' && v != null) target.searchParams.set(k, v);
  }
  const init = { method: route.method || 'GET', headers: {} };
  if (bodyText && !['GET', 'HEAD'].includes(String(route.method).toUpperCase())) {
    init.headers['content-type'] = 'application/json';
    init.body = bodyText;
  }
  const started = Date.now();
  const res = await fetch(target, init);
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch (e) { /* text */ }
  return { ok: res.ok, status: res.status, ms: Date.now() - started, url: target.toString(), body: parsed, raw: text.slice(0, 20000) };
}


function registerIpc() {
  ipcMain.handle('iface:boot', async () => {
    const name = projects.boot();
    const stored = projects.load(name) || spec.seedProject();
    const project = spec.normalizeProject(stored);
    return { name, project, list: projects.list(), services: await services.status(), settings: services.settings() };
  });

  ipcMain.handle('iface:projects', () => projects.list());
  ipcMain.handle('iface:load', async (e, name) => {
    const p = projects.load(name);
    if (!p) return null;
    const normalized = spec.normalizeProject(p);
    const hooked = await plugins.fire('project.open', { project: normalized, name });
    return spec.normalizeProject(hooked.project || normalized);
  });
  ipcMain.handle('iface:save', async (e, project) => {
    let p = spec.normalizeProject(project);
    const hooked = await plugins.fire('project.beforeSave', { project: p });
    if (hooked.canceled) return { ok: false, error: '插件取消了保存', problems: [] };
    if (hooked.project) p = spec.normalizeProject(hooked.project);
    const v = spec.validateProject(p);
    const file = projects.save(p);
    await plugins.fire('project.afterSave', { project: p, file });
    return { ok: true, file, problems: v.errors, project: p };
  });
  ipcMain.handle('iface:delete', (e, name) => projects.remove(name));
  ipcMain.handle('iface:projects:duplicate', (e, name) => projects.duplicate(name));
  ipcMain.handle('iface:seed', () => spec.seedProject());
  ipcMain.handle('iface:blank', (e, opts) => spec.newIface((opts && opts.name) || '新接口', (opts && opts.categoryId) || 'biz', opts || {}));
  ipcMain.handle('iface:ident', (e, name, prefix) => spec.safeIdent(name, prefix || 'tbl'));

  ipcMain.handle('iface:validate', (e, project) => spec.validateProject(spec.normalizeProject(project)));
  ipcMain.handle('iface:preview', (e, payload) => preview(payload));
  ipcMain.handle('iface:script:check', (e, text) => script.checkScript(text));
  ipcMain.handle('iface:docs:infer', (e, iface, route) => docs.inferRouteDocs(iface, route));
  ipcMain.handle('iface:upstream:probe', async (e, payload) => {
    try { return await probeUpstream(payload && payload.baseUrl, payload && payload.timeout); }
    catch (err) { return { ok: false, routes: [], error: err.message }; }
  });
  ipcMain.handle('iface:s3:list', async (e, payload) => {
    try { return await listS3Objects(payload && payload.project, payload && payload.bucket, payload && payload.prefix, payload && payload.marker); }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('iface:tryRoute', async (e, payload) => {
    try { return await tryRoute(payload && payload.project, payload && payload.ifaceId, payload && payload.routeId, payload && payload.bodyText, payload && payload.query); }
    catch (err) { return { ok: false, status: 0, error: err.message, body: '' }; }
  });
  ipcMain.handle('iface:help', () => ({
    builtins: funcs.NAMES,
    types: spec.TYPES,
    routes: spec.ROUTE_META,
    templates: spec.ROUTE_TEMPLATES,
  }));
  ipcMain.handle('iface:ddl', (e, iface) => {
    try { return { ok: true, ddl: spec.ddlOf(spec.normalizeIface(iface, { categories: [{ id: 'biz' }] }, 0)) }; } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('iface:generate', async (e, project, outDir, opts) => {
    const base = spec.normalizeProject(project);
    const plugged = plugins.apply(base);
    const hooked = await plugins.fire('generate.before', { project: plugged.project, outDir, opts: opts || {} });
    if (hooked.canceled) return { ok: false, error: '插件取消了生成' };
    const p = spec.normalizeProject(hooked.project || plugged.project);
    const v = spec.validateProject(p);
    if (!v.ok) return { ok: false, error: v.errors.join('\n'), problems: v.errors };
    const o = opts || {};
    const dirName = String(o.dirName || p.name || '接口服务').replace(/[\\/:*?"<>|]/g, '_');
    const target = outDir || path.join(store.defaultGeneratedRoot(), 'iface', dirName);
    const gen = codegen.writeTo(p, target, { port: services.settings().ports.http, only: o.only, category: o.category, ide: !!o.ide });
    await plugins.fire('generate.after', { project: p, dir: gen.dir, count: gen.files.length });
    return { ok: true, dir: gen.dir, files: gen.files.map((f) => ({ path: f, size: 0 })), ports: gen.ports, warnings: plugged.warnings, count: gen.project.interfaces.length };
  });

  ipcMain.handle('iface:services', async () => services.status());
  ipcMain.handle('iface:services:start', async (e, id) => {
    if (id === 'mysql') return services.startMysql();
    if (id === 'redis') return services.startRedis();
    if (id === 's3') return services.startS3();
    return services.startAll();
  });
  ipcMain.handle('iface:services:stop', async (e, id) => (id ? services.stopOne(id) : services.stopAll()));
  ipcMain.handle('iface:services:logs', (e, id) => services.logs(id));
  ipcMain.handle('iface:ports:set', (e, patch) => services.setPorts(patch));

  ipcMain.handle('iface:server:start', async (e, dir, opts) => {
    const hooked = await plugins.fire('server.beforeStart', { dir, opts: opts || {} });
    if (hooked.canceled) return { ok: false, error: '插件取消了启动' };
    const r = await services.startServer(dir, opts || {});
    await plugins.fire('server.afterStart', { dir, result: r });
    return r;
  });
  ipcMain.handle('iface:deploy', async (e, project, opts) => deployer.deploy(project, opts || {}));
  ipcMain.handle('iface:runtimes', () => services.runtimes());
  ipcMain.handle('iface:server:stop', async () => {
    await plugins.fire('server.beforeStop', {});
    return services.stopServer();
  });
  ipcMain.handle('iface:server:logs', () => services.logs('server'));

  ipcMain.handle('iface:test', async (e, payload) => {
    try { return { ok: true, ...(await requestServer(payload)) }; } catch (err) { return { ok: false, error: `请求失败：${err.message}（先启动生成的服务，端口 ${services.settings().ports.http}）` }; }
  });
  ipcMain.handle('iface:openConsole', async () => {
    const port = services.settings().ports.http;
    await shell.openExternal(`http://127.0.0.1:${port}/`);
    return `http://127.0.0.1:${port}/`;
  });
  ipcMain.handle('iface:openPath', (e, p) => shell.openPath(p));
  ipcMain.handle('iface:exists', (e, p) => fs.existsSync(p));
  ipcMain.handle('iface:openUrl', (e, url) => shell.openExternal(String(url)));

  ipcMain.handle('iface:clone', (e, iface, names) => spec.cloneIface(iface, names || []));

  ipcMain.handle('iface:exportProject', async (e, project, opts) => {
    const o = opts || {};
    let parent = o.parent || '';
    if (!parent) {
      const r = await dialog.showOpenDialog({ title: '选择导出位置（会新建一个工程目录）', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      parent = r.filePaths[0];
    }
    try {
      let p = spec.normalizeProject(project);
      const hooked = await plugins.fire('export.before', { project: p, parent });
      if (hooked.canceled) return { ok: false, error: '插件取消了导出' };
      if (hooked.project) p = spec.normalizeProject(hooked.project);
      const r = projectExport.writeProject(p, parent, { port: services.settings().ports.http, errors: o.errors || null, runtime: o.runtime || 'node', runtimeOnly: !!o.runtimeOnly });
      await plugins.fire('export.after', { project: p, parent, result: r });
      return r;
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('iface:openInIdea', (e, dir) => projectExport.openInIdea(dir));

  ipcMain.handle('iface:exportYxpn', (e, project) => {
    try {
      const p = spec.normalizeProject(project);
      const outDir = path.join(store.defaultGeneratedRoot(), 'yxpn');
      const file = path.join(outDir, `${String(p.name || '接口工程').replace(/[\\/:*?"<>|]/g, '_')}.yxpn`);
      const r = pkg.writeYxpn(p, file, { port: services.settings().ports.http });
      return { ok: true, file: r.file, size: r.size, manifest: r.manifest };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('iface:importYxpn', async () => {
    const r = await dialog.showOpenDialog({ title: '打开 .yxpn 工程包', properties: ['openFile'], filters: [{ name: 'ClickBuild 工程包', extensions: ['yxpn'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const got = pkg.readYxpn(r.filePaths[0]);
      return { ok: true, project: got.project, manifest: got.manifest, files: got.files, file: r.filePaths[0] };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('iface:importYxpnPath', async (e, file) => {
    if (!file || !fs.existsSync(file)) return { ok: false, error: '找不到这个工程包' };
    try {
      const got = pkg.readYxpn(file);
      return { ok: true, project: got.project, manifest: got.manifest, files: got.files, file };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('iface:importYxppPath', async (e, file) => {
    if (!file || !fs.existsSync(file)) return { ok: false, error: '找不到这个前端工程' };
    try {
      const yxpp = frontend.readYxpp(file);
      return { ok: true, yxpp, file };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('app:assocYxpn', async () => {
    if (process.platform !== 'win32') return { ok: false, error: '目前只处理 Windows 关联' };
    const { execFile } = require('child_process');
    const cmd = (args) => new Promise((resolve) => execFile('reg', args, { windowsHide: true }, (err, out, errOut) => resolve({ ok: !err, out: String(out || errOut || '').trim() })));
    const exe = process.execPath;
    const appDir = store.resourceRoot();
    const icon = path.join(appDir, 'logo.png');
    const openCmd = store.isPackaged() ? `"${exe}" "%1"` : `"${exe}" "${appDir}" "%1"`;
    const types = [
      { ext: 'yxpn', id: 'ClickBuild.Yxpn', label: 'ClickBuild 接口工程包' },
      { ext: 'yxpp', id: 'ClickBuild.Yxpp', label: 'ClickBuild 前端工程' },
    ];
    let last = { ok: true };
    for (const t of types) {
      await cmd(['add', `HKCU\\Software\\Classes\\.${t.ext}`, '/ve', '/d', t.id, '/f']);
      await cmd(['add', `HKCU\\Software\\Classes\\${t.id}`, '/ve', '/d', t.label, '/f']);
      await cmd(['add', `HKCU\\Software\\Classes\\${t.id}\\DefaultIcon`, '/ve', '/d', icon, '/f']);
      last = await cmd(['add', `HKCU\\Software\\Classes\\${t.id}\\shell\\open\\command`, '/ve', '/d', openCmd, '/f']);
      if (!last.ok) return last;
    }
    return { ok: true, exe, appDir, types: types.map((t) => t.ext) };
  });

  ipcMain.handle('iface:docs', (e, project) => {
    const p = spec.normalizeProject(project);
    return { ok: true, openapi: codegen.buildOpenApi(p, services.settings().ports.http), html: codegen.docsPage(p, services.settings().ports.http) };
  });

  ipcMain.handle('iface:ai', async (e, payload) => {
    try {
      const conf = (store.readSettings().ai) || {};
      const p = payload && typeof payload === 'object' ? payload : { prompt: payload };
      return await ai.complete(p, { ...conf, ...(p.config || {}) });
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('iface:ai:status', async (e, cfg) => {
    const stored = (store.readSettings().ai) || {};
    return ai.status({ ...stored, ...(cfg || {}) });
  });

  ipcMain.handle('iface:monitor', async (e, tail) => {
    const base = `http://127.0.0.1:${services.settings().ports.http}`;
    try {
      const [logs, health, routes] = await Promise.all([
        fetch(`${base}/_logs?tail=${Number(tail) || 200}`).then((r) => r.json()),
        fetch(`${base}/_health`).then((r) => r.json()),
        fetch(`${base}/_routes`).then((r) => r.json()),
      ]);
      return { ok: true, logs: logs.logs || [], health, routes: routes.routes || [] };
    } catch (err) {
      return { ok: false, error: `服务没起来或端口不对：${err.message}`, logs: [], health: null, routes: [] };
    }
  });

  ipcMain.handle('iface:theme', (e, patch) => {
    const next = store.writeSettings({ theme: { ...(store.readSettings().theme || {}), ...(patch || {}) } });
    return next.theme || {};
  });

  ipcMain.handle('iface:templates:list', () => {
    try { return { ok: true, list: templates.list() }; } catch (e) { return { ok: false, error: e.message, list: [] }; }
  });
  ipcMain.handle('iface:templates:get', (e, id) => {
    try { return { ok: true, ...templates.get(id) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('iface:templates:save', (e, payload) => {
    try {
      const p = spec.normalizeProject(payload.project);
      const v = spec.validateProject(p);
      if (!v.ok) return { ok: false, error: v.errors.join('\n'), problems: v.errors };
      const r = templates.saveAs(payload.name, p, { description: payload.description, tags: payload.tags });
      return { ...r, list: templates.list() };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('iface:templates:remove', (e, id) => {
    try { return { ok: true, ...templates.remove(id), list: templates.list() }; } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('iface:library:list', () => {
    try { return { ok: true, list: ifaceLibrary.list() }; } catch (e) { return { ok: false, error: e.message, list: [] }; }
  });
  ipcMain.handle('iface:library:get', (e, id) => {
    try { return { ok: true, ...ifaceLibrary.get(id) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('iface:library:save', (e, payload) => {
    try { return { ok: true, ...ifaceLibrary.save(payload), list: ifaceLibrary.list() }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('iface:library:remove', (e, id) => {
    try { return { ok: true, ...ifaceLibrary.remove(id), list: ifaceLibrary.list() }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('iface:library:insert', (e, project, id) => {
    try { return { ok: true, ...ifaceLibrary.insert(project, id) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('iface:plugins:list', () => ({ ok: true, list: plugins.list(), repoDir: plugins.repoPluginsDir(), userDir: plugins.userPluginsDir() }));
  ipcMain.handle('iface:plugins:summary', () => plugins.summary());
  ipcMain.handle('iface:plugins:enable', (e, id, on) => plugins.setEnabled(id, on));
  ipcMain.handle('iface:plugins:apply', (e, project) => {
    const r = plugins.apply(project);
    return { ok: true, project: r.project, warnings: r.warnings, applied: r.applied };
  });
  ipcMain.handle('iface:plugins:install', async () => {
    const r = await dialog.showOpenDialog({ title: '选择插件文件夹（里面要有 plugin.json）', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    try { return { ...plugins.installFromDir(r.filePaths[0]), list: plugins.list() }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('iface:plugins:uninstall', (e, id) => {
    try { return { ...plugins.uninstall(id), list: plugins.list() }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('iface:plugins:openDir', async (e, which) => {
    const dir = which === 'user' ? plugins.userPluginsDir() : plugins.repoPluginsDir();
    await shell.openPath(dir);
    return dir;
  });
  ipcMain.handle('iface:plugins:run', async (e, id, payload) => {
    try { return await plugins.runCommand(id, payload || {}); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('iface:plugins:templates', () => ({ ok: true, list: plugins.templates() }));
  ipcMain.handle('iface:plugins:templateGet', (e, id) => {
    try { return plugins.getTemplate(id); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('iface:plugins:reload', () => plugins.reload());
  ipcMain.handle('iface:plugins:scaffold', (e, name) => {
    try { return plugins.scaffold(name); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('iface:plugins:docs', () => plugins.docs());
  ipcMain.handle('iface:plugins:logs', () => ({ ok: true, logs: plugins.logs() }));

  ipcMain.handle('iface:defender:list', () => defender.list());
  ipcMain.handle('iface:defender:trust', async (e, extra) => defender.trust(extra || []));

  ipcMain.handle('iface:settings:get', () => store.readSettings());
  ipcMain.handle('iface:settings:set', (e, patch) => store.writeSettings(patch || {}));

  ipcMain.handle('i18n:get', () => i18n.current(app));
  ipcMain.handle('i18n:set', (e, locale) => i18n.setLocale(app, locale));
  ipcMain.on('i18n:get-sync', (e) => { e.returnValue = i18n.current(app); });

  ipcMain.handle('window:new', async (e, projectName) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const parentBox = parent && !parent.isDestroyed() ? parent.getBounds() : { x: 80, y: 80, width: 1480, height: 940 };
    const area = screen.getDisplayMatching(parentBox).workArea;
    const width = Math.min(1480, Math.max(1080, area.width - 80));
    const height = Math.min(940, Math.max(700, area.height - 80));
    const x = Math.min(parentBox.x + 36, area.x + area.width - width - 16);
    const y = Math.min(parentBox.y + 36, area.y + area.height - height - 16);
    // 和主窗口共用一套无边框自绘标题栏；新窗口仍然是一个完整的多项目工作区。
    const win = new BrowserWindow({
      width, height, x: Math.max(area.x, x), y: Math.max(area.y, y),
      minWidth: 1080, minHeight: 700, show: false,
      backgroundColor: '#ffffff',
      title: `ClickBuildServer · ${projectName || '项目工作台'}`,
      icon: path.join(__dirname, '..', '..', 'assets', 'logo.png'),
      frame: false, thickFrame: true, autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    const file = path.join(__dirname, '..', '..', 'renderer', 'wbench.html');
    win.loadFile(file, { query: projectName ? { project: projectName } : {} });
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
    win.setMenuBarVisibility(false);
    // 子窗口最大化后也要把状态回给自绘标题栏，否则按钮图标会停在“最大化”。
    const pushState = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('win:state', { maximized: win.isMaximized(), minimized: win.isMinimized(), fullScreen: win.isFullScreen() });
    };
    win.on('maximize', pushState);
    win.on('unmaximize', pushState);
    win.on('enter-full-screen', pushState);
    win.on('leave-full-screen', pushState);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    return { ok: true, id: win.id };
  });

  ipcMain.handle('iface:studioHtml', () => fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'studio.html'), 'utf8'));
  // .yxpp：ClickBuild 前端工程 → 可打包的前端快照
  ipcMain.handle('iface:frontend:build', (e, payload) => {
    const p = payload || {};
    const yxpp = frontend.parseYxpp({
      format: 'yxpp',
      name: p.name || '前端工程',
      framework: p.framework || 'tailwind',
      project: p.project,
      html: p.html || '',
    }, p.name);
    return { ok: true, yxpp };
  });
  ipcMain.handle('iface:frontend:import', async () => {
    const r = await dialog.showOpenDialog({
      title: '导入 .yxpp 前端工程', properties: ['openFile'],
      filters: [{ name: 'ClickBuild 前端工程', extensions: ['yxpp', 'json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      const yxpp = frontend.readYxpp(r.filePaths[0]);
      return { ok: true, yxpp, file: r.filePaths[0] };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerIpc, preview };
