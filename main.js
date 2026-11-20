'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const { registerIpc } = require('./app/ipc');
const { registerIpc: registerIfaceIpc } = require('./app/iface/ipc');
const { runStartup, STEPS } = require('./app/startup');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;
  let splash = null;
  let mainReady = false;
  let bootDone = false;
  let lastStartupReport = null;
  const startupSnapshot = {
    version: app.getVersion(),
    steps: STEPS.map((s) => ({ ...s, status: 'waiting', text: s.hint })),
    tools: [],
    services: [],
    progress: 0,
    current: '正在准备启动环境',
    done: false,
  };

  function splashSend(data) {
    if (splash && !splash.isDestroyed() && !splash.webContents.isDestroyed()) splash.webContents.send('startup:update', data);
  }

  function applyStartupUpdate(u) {
    if (!u || typeof u !== 'object') return;
    if (Array.isArray(u.steps)) startupSnapshot.steps = u.steps;
    if (u.step) {
      const hit = startupSnapshot.steps.find((s) => s.id === u.step.id);
      if (hit) Object.assign(hit, u.step); else startupSnapshot.steps.push(u.step);
    }
    if (Array.isArray(u.tools)) startupSnapshot.tools = u.tools;
    if (u.service) {
      const hit = startupSnapshot.services.find((s) => s.id === u.service.id);
      if (hit) Object.assign(hit, u.service); else startupSnapshot.services.push(u.service);
    }
    if (typeof u.progress === 'number') startupSnapshot.progress = Math.max(startupSnapshot.progress, Math.min(1, u.progress));
    if (u.current) startupSnapshot.current = u.current;
    if (u.type === 'done') {
      startupSnapshot.done = true;
      startupSnapshot.report = u.report || null;
    }
    splashSend({ ...u, snapshot: startupSnapshot });
  }

  function maybeShowMain() {
    if (!mainReady || !bootDone || !win || win.isDestroyed()) return;
    win.show();
    win.focus();
    if (splash && !splash.isDestroyed()) setTimeout(() => { if (splash && !splash.isDestroyed()) splash.close(); }, 620);
  }

  function windowState(w) {
    return { maximized: !!(w && w.isMaximized()), minimized: !!(w && w.isMinimized()), fullScreen: !!(w && w.isFullScreen()) };
  }

  function registerWindowIpc() {
    ipcMain.handle('win:action', (e, action) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || w.isDestroyed()) return { ok: false };
      if (action === 'minimize') w.minimize();
      else if (action === 'maximize') { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
      else if (action === 'close') w.close();
      else if (action === 'state') return { ok: true, ...windowState(w) };
      return { ok: true, ...windowState(w) };
    });
  }

  const send = (action) => {
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', action);
  };

  function buildMenu() {
    const template = [
      {
        label: '文件',
        submenu: [
          { label: '新建接口工程', accelerator: 'CmdOrCtrl+N', click: () => send('project:new') },
          { label: '打开工程', accelerator: 'CmdOrCtrl+O', click: () => send('project:open') },
          { type: 'separator' },
          { label: '保存工程', accelerator: 'CmdOrCtrl+S', click: () => send('project:save') },
          { label: '导入工程 JSON', click: () => send('project:import') },
          { label: '导出工程 JSON', click: () => send('project:export') },
          { type: 'separator' },
          { role: 'quit', label: '退出' },
        ],
      },
      {
        label: '接口',
        submenu: [
          { label: '新增接口', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('iface:new') },
          { label: '新增路由', click: () => send('route:new') },
          { label: '校验当前接口', accelerator: 'F7', click: () => send('iface:validate') },
        ],
      },
      {
        label: '构建',
        submenu: [
          { label: '刷新 SQL 预览', accelerator: 'F5', click: () => send('sql:preview') },
          { label: '生成工程', accelerator: 'CmdOrCtrl+G', click: () => send('generate:run') },
          { type: 'separator' },
          { label: '启动三台服务', click: () => send('services:startAll') },
          { label: '停止三台服务', click: () => send('services:stopAll') },
          { type: 'separator' },
          { label: '启动生成的服务', click: () => send('server:start') },
          { label: '打开接口控制台', click: () => send('server:console') },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '重置缩放' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { role: 'togglefullscreen', label: '全屏' },
        ],
      },
      {
        label: '旧版',
        submenu: [
          {
            label: '打开模块视图（旧）',
            click: () => {
              const legacy = new BrowserWindow({
                width: 1440, height: 920, title: 'ClickBuildServer · 模块视图（旧版）',
                backgroundColor: '#0d1117',
                webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
              });
              legacy.loadFile(path.join(__dirname, 'renderer', 'index.html'));
            },
          },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '关于 ClickBuildServer',
            click: () => dialog.showMessageBox(win, {
              type: 'info',
              title: '关于',
              message: 'ClickBuildServer · 接口工作台',
              detail: `一个接口 = 任意多张表 / 多个库 + 一组路由\n版本 ${app.getVersion()}\n\n逐条管理 SQL、Redis 缓存与对象存储。`,
            }),
          },
        ],
      },
    ];
    return Menu.buildFromTemplate(template);
  }

  function openFileArg(argv) {
    const hit = (argv || []).find((a) => typeof a === 'string' && /\.(yxpn|yxpp)$/i.test(a));
    if (!hit) return '';
    return require('fs').existsSync(hit) ? hit : '';
  }

  function createSplash() {
    splash = new BrowserWindow({
      width: 780,
      height: 548,
      center: true,
      frame: false,
      resizable: false,
      show: false,
      backgroundColor: '#f4f1e9',
      title: 'ClickBuildServer · 正在启动',
      icon: path.join(__dirname, 'assets', 'logo.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
    splash.once('ready-to-show', () => { if (splash && !splash.isDestroyed()) splash.show(); });
    splash.on('closed', () => { splash = null; });
  }

  function createWindow(openFile) {
    win = new BrowserWindow({
      width: 1480,
      height: 940,
      minWidth: 1080,
      minHeight: 700,
      backgroundColor: '#ffffff',
      title: 'ClickBuildServer · 接口工作台',
      icon: path.join(__dirname, 'assets', 'logo.png'),
      frame: false,
      thickFrame: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });

    win.loadFile(path.join(__dirname, 'renderer', 'wbench.html'), { query: openFile ? { openFile } : {} });
    win.once('ready-to-show', () => {
      mainReady = true;
      maybeShowMain();
    });
    win.setMenuBarVisibility(false);
    const pushState = () => { if (!win.isDestroyed()) win.webContents.send('win:state', windowState(win)); };
    win.on('maximize', pushState);
    win.on('unmaximize', pushState);
    win.on('enter-full-screen', pushState);
    win.on('leave-full-screen', pushState);

    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    win.webContents.on('did-fail-load', (event, code, desc) => {
      console.log(`[renderer] did-fail-load ${code} ${desc}`);
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    win.on('closed', () => { win = null; });
  }

  app.whenReady().then(async () => {
    registerWindowIpc();
    registerIpc(win);
    registerIfaceIpc();
    ipcMain.handle('startup:state', () => startupSnapshot);
    ipcMain.handle('startup:report', () => lastStartupReport);
    ipcMain.on('startup:quit', () => app.quit());

    createSplash();
    createWindow(openFileArg(process.argv));
    Menu.setApplicationMenu(null);

    const started = Date.now();
    const minSplash = Math.max(1200, Number(process.env.CBS_SPLASH_MIN_MS || 2600));
    try {
      lastStartupReport = await runStartup(applyStartupUpdate);
    } catch (e) {
      lastStartupReport = { ok: false, errors: [e.message], tools: [], services: {}, conflicts: [], steps: startupSnapshot.steps };
      applyStartupUpdate({ type: 'done', progress: 1, current: '启动失败，正在进入工作台', report: lastStartupReport });
    }
    const remain = minSplash - (Date.now() - started);
    const hold = lastStartupReport && lastStartupReport.ok === false ? Math.max(remain, 5000 - (Date.now() - started)) : remain;
    if (hold > 0) await new Promise((r) => setTimeout(r, hold));
    bootDone = true;
    if (win && !win.isDestroyed()) win.webContents.send('startup:report-ready', lastStartupReport);
    maybeShowMain();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('second-instance', (event, argv) => {
    const file = openFileArg(argv);
    if (win) {
      if (file) win.loadFile(path.join(__dirname, 'renderer', 'wbench.html'), { query: { openFile: file } });
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
