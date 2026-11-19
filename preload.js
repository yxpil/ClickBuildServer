'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// contextBridge 的返回对象是代理，直接回传会被主进程序列化器拒绝（"could not be cloned"）。
// 项目配置本来就是纯 JSON，传之前先做一次 JSON 归一化。
const plain = (v) => (v === undefined || typeof v === 'function' ? v : JSON.parse(JSON.stringify(v)));

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args.map(plain));

contextBridge.exposeInMainWorld('icb', {
  win: (action) => invoke('win:action', action),
  onWinState: (cb) => {
    const fn = (e, state) => cb(state);
    ipcRenderer.on('win:state', fn);
    return () => ipcRenderer.removeListener('win:state', fn);
  },
  boot: () => invoke('iface:boot'),
  projects: () => invoke('iface:projects'),
  load: (name) => invoke('iface:load', name),
  save: (project) => invoke('iface:save', project),
  remove: (name) => invoke('iface:delete', name),
  duplicateProject: (name) => invoke('iface:projects:duplicate', name),
  seed: () => invoke('iface:seed'),
  blank: (opts) => invoke('iface:blank', opts || {}),
  ident: (name, prefix) => invoke('iface:ident', name, prefix || 'tbl'),
  validate: (project) => invoke('iface:validate', project),
  preview: (payload) => invoke('iface:preview', payload),
  checkScript: (text) => invoke('iface:script:check', text),
  help: () => invoke('iface:help'),
  ddl: (iface) => invoke('iface:ddl', iface),
  generate: (project, dir, opts) => invoke('iface:generate', project, dir, opts),
  deploy: (project, opts) => invoke('iface:deploy', project, opts || {}),
  services: () => invoke('iface:services'),
  startService: (id) => invoke('iface:services:start', id || ''),
  stopService: (id) => invoke('iface:services:stop', id || ''),
  logs: (id) => invoke('iface:services:logs', id),
  setPorts: (patch) => invoke('iface:ports:set', patch),
  startServer: (dir, opts) => invoke('iface:server:start', dir, opts || {}),
  runtimes: () => invoke('iface:runtimes'),
  stopServer: () => invoke('iface:server:stop'),
  serverLogs: () => invoke('iface:server:logs'),
  test: (payload) => invoke('iface:test', payload),
  console: () => invoke('iface:openConsole'),
  openPath: (p) => invoke('iface:openPath', p),
  exists: (p) => invoke('iface:exists', p),
  openUrl: (url) => invoke('iface:openUrl', url),
  clone: (iface, names) => invoke('iface:clone', iface, names || []),
  exportYxpn: (project) => invoke('iface:exportYxpn', project),
  exportProject: (project, opts) => invoke('iface:exportProject', project, opts || {}),
  openInIdea: (dir) => invoke('iface:openInIdea', dir),
  importYxpn: () => invoke('iface:importYxpn'),
  importYxpnPath: (file) => invoke('iface:importYxpnPath', file),
  assocYxpn: () => invoke('app:assocYxpn'),
  docs: (project) => invoke('iface:docs', project),
  monitor: (tail) => invoke('iface:monitor', tail),
  ai: (prompt) => invoke('iface:ai', prompt),
  theme: (patch) => invoke('iface:theme', patch),
  templates: () => invoke('iface:templates:list'),
  templateGet: (id) => invoke('iface:templates:get', id),
  templateSave: (payload) => invoke('iface:templates:save', payload),
  templateRemove: (id) => invoke('iface:templates:remove', id),
  ifaceLibrary: () => invoke('iface:library:list'),
  ifaceLibraryGet: (id) => invoke('iface:library:get', id),
  ifaceLibrarySave: (payload) => invoke('iface:library:save', payload),
  ifaceLibraryRemove: (id) => invoke('iface:library:remove', id),
  ifaceLibraryInsert: (project, id) => invoke('iface:library:insert', project, id),
  plugins: () => invoke('iface:plugins:list'),
  pluginEnable: (id, on) => invoke('iface:plugins:enable', id, !!on),
  pluginApply: (project) => invoke('iface:plugins:apply', project),
  pluginInstall: () => invoke('iface:plugins:install'),
  pluginUninstall: (id) => invoke('iface:plugins:uninstall', id),
  pluginOpenDir: (which) => invoke('iface:plugins:openDir', which),
  defenderList: () => invoke('iface:defender:list'),
  defenderTrust: (extra) => invoke('iface:defender:trust', extra || []),
  settings: () => invoke('iface:settings:get'),
  saveSettings: (patch) => invoke('iface:settings:set', patch),
  i18n: () => invoke('i18n:get'),
  i18nSync: () => ipcRenderer.sendSync('i18n:get-sync'),
  setLocale: (locale) => invoke('i18n:set', locale),
  newWindow: (projectName) => invoke('window:new', projectName || ''),
  studioHtml: () => invoke('iface:studioHtml'),
  frontendBuild: (payload) => invoke('iface:frontend:build', payload),
  frontendImport: () => invoke('iface:frontend:import'),
});

contextBridge.exposeInMainWorld('cbs', {
  info: () => invoke('app:info'),
  catalog: () => invoke('catalog:list'),
  project: {
    blank: () => invoke('project:default'),
    list: () => invoke('project:list'),
    save: (project) => invoke('project:save', project),
    load: (name) => invoke('project:load', name),
    remove: (name) => invoke('project:delete', name),
    importFile: () => invoke('project:import'),
    exportFile: (project) => invoke('project:export', project),
  },
  preview: (project) => invoke('generate:preview', project),
  code: (project, filePath) => invoke('generate:code', project, filePath),
  run: (project, outDir) => invoke('generate:run', project, outDir),
  zip: (project) => invoke('generate:zip', project),
  pickDir: () => invoke('dialog:pickDir'),
  openPath: (target) => invoke('shell:openPath', target),
  openExternal: (url) => invoke('shell:openExternal', url),
  build: (payload) => invoke('build:run', payload),
  onBuildLog: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('build:log', handler);
    return () => ipcRenderer.removeListener('build:log', handler);
  },
  onMenu: (cb) => {
    const handler = (_event, action) => cb(action);
    ipcRenderer.on('menu:action', handler);
    return () => ipcRenderer.removeListener('menu:action', handler);
  },
});
