// 作者：yxpil
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// contextBridge 的返回对象是代理，直接回传会被主进程序列化器拒绝（"could not be cloned"）。
// 项目配置本来就是纯 JSON，传之前先做一次 JSON 归一化。
const plain = (v) => (v === undefined || typeof v === 'function' ? v : JSON.parse(JSON.stringify(v)));

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args.map(plain));

contextBridge.exposeInMainWorld('icb', {
  platform: process.platform,
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
  starter: (taskType) => invoke('iface:starter', taskType || 'mixed'),
  tableData: (payload) => invoke('iface:table-data', payload || {}),
  tableMutate: (payload) => invoke('iface:table-mutate', payload || {}),
  dbConnections: (project) => invoke('iface:db:connections', project || {}),
  dbTest: (payload) => invoke('iface:db:test', payload || {}),
  dbDatabases: (payload) => invoke('iface:db:databases', payload || {}),
  dbTables: (payload) => invoke('iface:db:tables', payload || {}),
  dbDescribe: (payload) => invoke('iface:db:describe', payload || {}),
  dbSelect: (payload) => invoke('iface:db:select', payload || {}),
  dbQuery: (payload) => invoke('iface:db:query', payload || {}),
  dbInsert: (payload) => invoke('iface:db:insert', payload || {}),
  dbUpdate: (payload) => invoke('iface:db:update', payload || {}),
  dbDeleteRow: (payload) => invoke('iface:db:delete', payload || {}),
  dbCreateTable: (payload) => invoke('iface:db:create-table', payload || {}),
  dbDropTable: (payload) => invoke('iface:db:drop-table', payload || {}),
  dbRenameTable: (payload) => invoke('iface:db:rename-table', payload || {}),
  dbTableDdl: (payload) => invoke('iface:db:table-ddl', payload || {}),
  dbExport: (payload) => invoke('iface:db:export', payload || {}),
  dbImportSql: (payload) => invoke('iface:db:import-sql', payload || {}),
  dbAlterTable: (payload) => invoke('iface:db:alter-table', payload || {}),
  dbUsers: (payload) => invoke('iface:db:users', payload || {}),
  dbUserAction: (payload) => invoke('iface:db:user-action', payload || {}),
  dbCreateDatabase: (payload) => invoke('iface:db:create-database', payload || {}),
  dbDropDatabase: (payload) => invoke('iface:db:drop-database', payload || {}),
  dbServerInfo: (payload) => invoke('iface:db:server-info', payload || {}),
  openTextFile: (opts) => invoke('iface:file:open-text', opts || {}),
  saveTextFile: (opts) => invoke('iface:file:save-text', opts || {}),
  saveBase64File: (opts) => invoke('iface:file:save-base64', opts || {}),
  infraConnections: (project) => invoke('iface:infra:connections', project || {}),
  infraTest: (payload) => invoke('iface:infra:test', payload || {}),
  redisOverview: (payload) => invoke('iface:redis:overview', payload || {}),
  redisScan: (payload) => invoke('iface:redis:scan', payload || {}),
  redisKey: (payload) => invoke('iface:redis:key', payload || {}),
  redisCommand: (payload) => invoke('iface:redis:command', payload || {}),
  redisDelete: (payload) => invoke('iface:redis:delete', payload || {}),
  redisSave: (payload) => invoke('iface:redis:save', payload || {}),
  redisExpire: (payload) => invoke('iface:redis:expire', payload || {}),
  redisRename: (payload) => invoke('iface:redis:rename', payload || {}),
  s3Buckets: (payload) => invoke('iface:s3:buckets', payload || {}),
  s3Objects: (payload) => invoke('iface:s3:objects', payload || {}),
  s3Stat: (payload) => invoke('iface:s3:stat', payload || {}),
  s3Url: (payload) => invoke('iface:s3:url', payload || {}),
  s3Delete: (payload) => invoke('iface:s3:delete', payload || {}),
  s3CreateBucket: (payload) => invoke('iface:s3:create-bucket', payload || {}),
  s3Put: (payload) => invoke('iface:s3:put', payload || {}),
  s3Get: (payload) => invoke('iface:s3:get', payload || {}),
  s3CreateFolder: (payload) => invoke('iface:s3:create-folder', payload || {}),
  s3DeleteBucket: (payload) => invoke('iface:s3:delete-bucket', payload || {}),
  blank: (opts) => invoke('iface:blank', opts || {}),
  ident: (name, prefix) => invoke('iface:ident', name, prefix || 'tbl'),
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || (file && file.path) || ''; } catch (e) { return (file && file.path) || ''; }
  },
  importTable: (file) => invoke('iface:tableImport', file),
  importTableBuffer: (payload) => invoke('iface:tableImportBuffer', payload),
  pickTable: () => invoke('iface:tablePick'),
  validate: (project) => invoke('iface:validate', project),
  preview: (payload) => invoke('iface:preview', payload),
  checkScript: (text) => invoke('iface:script:check', text),
  inferDocs: (iface, route) => invoke('iface:docs:infer', iface, route),
  probeUpstream: (payload) => invoke('iface:upstream:probe', payload || {}),
  listS3: (payload) => invoke('iface:s3:list', payload || {}),
  tryRoute: (payload) => invoke('iface:tryRoute', payload || {}),
  help: () => invoke('iface:help'),
  ddl: (iface) => invoke('iface:ddl', iface),
  generate: (project, dir, opts) => invoke('iface:generate', project, dir, opts),
  generateTests: (project, dir, opts) => invoke('iface:generateTests', project, dir, opts),
  deploy: (project, opts) => invoke('iface:deploy', project, opts || {}),
  services: () => invoke('iface:services'),
  resources: (items) => invoke('iface:resources', items || []),
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
  exportYxpn: (project, opts) => invoke('iface:exportYxpn', project, opts || {}),
  exportProject: (project, opts) => invoke('iface:exportProject', project, opts || {}),
  openInIdea: (dir) => invoke('iface:openInIdea', dir),
  importYxpn: () => invoke('iface:importYxpn'),
  importYxpnPath: (file) => invoke('iface:importYxpnPath', file),
  importYxppPath: (file) => invoke('iface:importYxppPath', file),
  assocYxpn: () => invoke('app:assocYxpn'),
  shellNewStatus: () => invoke('app:shellNewStatus'),
  shellNewRegister: () => invoke('app:shellNewRegister'),
  docs: (project) => invoke('iface:docs', project),
  monitor: (tail) => invoke('iface:monitor', tail),
  ai: (payload) => invoke('iface:ai', payload),
  aiStatus: (cfg) => invoke('iface:ai:status', cfg),
  theme: (patch) => invoke('iface:theme', patch),
  templates: () => invoke('iface:templates:list'),
  templateGet: (id) => invoke('iface:templates:get', id),
  templateSave: (payload) => invoke('iface:templates:save', payload),
  templateRemove: (id) => invoke('iface:templates:remove', id),
  ifaceLibrary: () => invoke('iface:library:list'),
  ifaceLibraryGet: (id) => invoke('iface:library:get', id),
  ifaceLibrarySave: (payload) => invoke('iface:library:save', payload),
  ifaceLibraryUpdate: (id, patch) => invoke('iface:library:update', id, patch),
  ifaceLibraryRemove: (id) => invoke('iface:library:remove', id),
  ifaceLibraryInsert: (project, id) => invoke('iface:library:insert', project, id),
  ifaceLibraryKits: () => invoke('iface:library:kits'),
  ifaceLibraryKitGet: (id) => invoke('iface:library:kitGet', id),
  ifaceLibraryKitInsert: (project, id) => invoke('iface:library:kitInsert', project, id),
  ifaceLibraryTableKits: () => invoke('iface:library:tableKits'),
  ifaceLibraryTableKitGet: (id) => invoke('iface:library:tableKitGet', id),
  ifaceLibraryTableKitInsert: (project, id, opts) => invoke('iface:library:tableKitInsert', project, id, opts || {}),
  plugins: () => invoke('iface:plugins:list'),
  pluginSummary: () => invoke('iface:plugins:summary'),
  pluginEnable: (id, on) => invoke('iface:plugins:enable', id, !!on),
  pluginApply: (project) => invoke('iface:plugins:apply', project),
  pluginInstall: () => invoke('iface:plugins:install'),
  pluginUninstall: (id) => invoke('iface:plugins:uninstall', id),
  pluginOpenDir: (which) => invoke('iface:plugins:openDir', which),
  pluginRun: (id, payload) => invoke('iface:plugins:run', id, payload || {}),
  pluginTemplates: () => invoke('iface:plugins:templates'),
  pluginTemplateGet: (id) => invoke('iface:plugins:templateGet', id),
  pluginReload: () => invoke('iface:plugins:reload'),
  pluginScaffold: (name) => invoke('iface:plugins:scaffold', name),
  pluginDocs: () => invoke('iface:plugins:docs'),
  pluginLogs: () => invoke('iface:plugins:logs'),
  defenderList: () => invoke('iface:defender:list'),
  defenderTrust: (extra) => invoke('iface:defender:trust', extra || []),
  settings: () => invoke('iface:settings:get'),
  saveSettings: (patch) => invoke('iface:settings:set', patch),
  i18n: () => invoke('i18n:get'),
  i18nSync: () => ipcRenderer.sendSync('i18n:get-sync'),
  setLocale: (locale) => invoke('i18n:set', locale),
  newWindow: (projectName) => invoke('window:new', projectName || ''),
  studioHtml: () => invoke('iface:studioHtml'),
  studioPreview: (payload) => invoke('iface:studioPreview', payload),
  frontendBuild: (payload) => invoke('iface:frontend:build', payload),
  frontendImport: () => invoke('iface:frontend:import'),
  startupState: () => invoke('startup:state'),
  startupReport: () => invoke('startup:report'),
  onStartup: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('startup:update', handler);
    return () => ipcRenderer.removeListener('startup:update', handler);
  },
  onStartupReport: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('startup:report-ready', handler);
    return () => ipcRenderer.removeListener('startup:report-ready', handler);
  },
  startupQuit: () => ipcRenderer.send('startup:quit'),
  shutdownState: () => invoke('shutdown:state'),
  onShutdown: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('shutdown:update', handler);
    return () => ipcRenderer.removeListener('shutdown:update', handler);
  },
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
