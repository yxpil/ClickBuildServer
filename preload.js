'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// contextBridge 的返回对象是代理，直接回传会被主进程序列化器拒绝（"could not be cloned"）。
// 项目配置本来就是纯 JSON，传之前先做一次 JSON 归一化。
const plain = (v) => (v === undefined || typeof v === 'function' ? v : JSON.parse(JSON.stringify(v)));

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args.map(plain));

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
