// 作者：yxpil
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ipcMain, dialog, shell, BrowserWindow, app } = require('electron');

const { MODULES, permsOf } = require('./catalog');
const gen = require('./generator');
const store = require('./store');

function catalogPayload() {
  return MODULES.map((m) => ({
    id: m.id,
    name: m.name,
    group: m.group,
    abbr: m.abbr,
    tagline: m.tagline,
    desc: m.desc,
    requires: m.requires || [],
    features: m.features || {},
    perms: permsOf(m),
    tables: (m.tables || []).map((t) => ({
      name: t.name,
      comment: t.comment,
      engine: t.engine || 'mysql',
      columns: Array.isArray(t.columns) ? t.columns.length : String(t.columns || '').split('\n').filter(Boolean).length,
    })),
  }));
}

function preview(project) {
  const { ir, files, warnings } = gen.generate(project);
  const tables = ir.tables.map((t) => ({
    name: t.name,
    comment: t.comment,
    engine: t.engine,
    moduleId: t.moduleId,
    moduleName: t.moduleName,
    columns: t.columns.map((c) => ({ name: c.name, type: c.type, comment: c.comment, required: c.required, unique: c.unique, indexed: c.indexed })),
    search: t.search,
    cache: t.cache,
    route: t.route,
  }));
  return {
    project: ir.project,
    stats: ir.stats,
    warnings,
    modules: ir.modules.map((m) => ({ id: m.id, name: m.name, group: m.group, tables: (m.tables || []).length, perms: m.perms })),
    tables,
    perms: ir.perms,
    roles: ir.roles,
    files: files.map((f) => ({ path: f.path, size: Buffer.byteLength(String(f.content)) })),
    tree: gen.listTree(files),
    totalBytes: files.reduce((n, f) => n + Buffer.byteLength(String(f.content)), 0),
  };
}

function resolveTarget(project, outDir) {
  const name = String(project.name || 'ClickServer').trim() || 'ClickServer';
  const dir = path.join(outDir, name);
  return { dir, name };
}

function registerIpc(mainWindow) {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    settings: store.readSettings(),
    dataRoot: store.root(),
  }));

  ipcMain.handle('catalog:list', () => catalogPayload());
  ipcMain.handle('project:default', () => gen.blankProject());

  ipcMain.handle('project:list', () => store.listProjects());
  ipcMain.handle('project:save', (e, project) => ({ file: store.saveProject(project) }));
  ipcMain.handle('project:load', (e, name) => store.loadProject(name));
  ipcMain.handle('project:delete', (e, name) => store.deleteProject(name));

  ipcMain.handle('project:import', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '导入项目配置',
      filters: [{ name: 'ClickBuild 配置', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { file, project: data };
  });

  ipcMain.handle('project:export', async (e, project) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '导出项目配置',
      defaultPath: `${String(project.name || 'project').replace(/[\\/:*?"<>|]/g, '_')}.clickbuild.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(project, null, 2), 'utf8');
    return r.filePath;
  });

  ipcMain.handle('generate:preview', (e, project) => preview(project));

  ipcMain.handle('generate:code', (e, project, filePath) => {
    const { files } = gen.generate(project);
    const hit = files.find((f) => f.path.replace(/\\/g, '/') === String(filePath).replace(/\\/g, '/'));
    return hit ? hit.content : null;
  });

  ipcMain.handle('generate:run', async (e, project, outDir) => {
    const target = outDir || store.readSettings().outDir;
    const { files, warnings } = gen.generate(project);
    const { dir, name } = resolveTarget(project, target);
    gen.writeTo(dir, files);
    return { dir, name, files: files.length, warnings, outRoot: target };
  });

  ipcMain.handle('generate:zip', async (e, project) => {
    const { files } = gen.generate(project);
    const { name } = resolveTarget(project, '');
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '导出压缩包',
      defaultPath: path.join(store.readSettings().outDir, `${name}.zip`),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, gen.zipBuffer(files, name));
    return r.filePath;
  });

  ipcMain.handle('dialog:pickDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: '选择输出目录', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.writeSettings({ outDir: r.filePaths[0] });
    return r.filePaths[0];
  });

  ipcMain.handle('shell:openPath', (e, p) => shell.openPath(p));
  ipcMain.handle('shell:openExternal', (e, url) => shell.openExternal(url));

  ipcMain.handle('build:run', async (event, { dir, lang }) => {
    return new Promise((resolve) => {
      let cmd;
      let args;
      let hintCmd;
      if (lang === 'rust') {
        cmd = 'cargo'; args = ['build', '--release']; hintCmd = 'cargo（https://rustup.rs）';
      } else if (lang === 'go') {
        cmd = 'go'; args = ['build', './...']; hintCmd = 'Go（https://go.dev/dl/）';
      } else if (lang === 'node') {
        cmd = 'node'; args = ['server.js', '--selfcheck']; hintCmd = 'Node.js（https://nodejs.org）';
      } else {
        cmd = 'mvn'; args = ['-B', '-DskipTests', 'package']; hintCmd = 'mvn（https://maven.apache.org）';
      }
      let child;
      try {
        child = spawn(cmd, args, { cwd: dir, shell: process.platform === 'win32' });
      } catch (err) {
        resolve({ code: -1, error: `无法启动 ${cmd}：${err.message}` });
        return;
      }
      let output = '';
      const push = (chunk) => {
        const text = chunk.toString();
        output += text;
        event.sender.send('build:log', { dir, text });
      };
      child.stdout.on('data', push);
      child.stderr.on('data', push);
      child.on('error', (err) => {
        const hint = err.code === 'ENOENT'
          ? `未找到 ${cmd}，请先安装：${hintCmd}`
          : err.message;
        resolve({ code: -1, error: hint, output });
      });
      child.on('close', (code) => resolve({ code, output }));
    });
  });
}

module.exports = { registerIpc, preview, catalogPayload };
