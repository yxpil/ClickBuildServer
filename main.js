'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { registerIpc } = require('./app/ipc');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;

  const send = (action) => {
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', action);
  };

  function buildMenu() {
    const template = [
      {
        label: '文件',
        submenu: [
          { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => send('project:new') },
          { label: '打开项目', accelerator: 'CmdOrCtrl+O', click: () => send('project:open') },
          { type: 'separator' },
          { label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => send('project:save') },
          { label: '导入 clickbuild.json', click: () => send('project:import') },
          { label: '导出项目配置', click: () => send('project:export') },
          { type: 'separator' },
          { role: 'quit', label: '退出' },
        ],
      },
      {
        label: '构建',
        submenu: [
          { label: '刷新预览', accelerator: 'F5', click: () => send('generate:preview') },
          { label: '生成工程', accelerator: 'CmdOrCtrl+G', click: () => send('generate:run') },
          { label: '导出 ZIP', click: () => send('generate:zip') },
          { type: 'separator' },
          { label: '打开输出目录', click: () => send('output:open') },
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
        label: '帮助',
        submenu: [
          { label: '使用说明', click: () => send('help:docs') },
          {
            label: '关于 ClickBuildServer',
            click: () => dialog.showMessageBox(win, {
              type: 'info',
              title: '关于',
              message: 'ClickBuildServer',
              detail: `服务器快速制造工具\n版本 ${app.getVersion()}\n\n勾选业务 → 自动生成工程 + SQL。`,
            }),
          },
        ],
      },
    ];
    return Menu.buildFromTemplate(template);
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1180,
      minHeight: 760,
      backgroundColor: '#0d1117',
      title: 'ClickBuildServer · 服务器快速制造工具',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });

    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    win.once('ready-to-show', () => win.show());

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) {
        event.preventDefault();
        if (/^https?:/.test(url)) shell.openExternal(url);
      }
    });

    win.on('closed', () => {
      win = null;
    });
  }

  app.whenReady().then(() => {
    createWindow();
    registerIpc(win);
    Menu.setApplicationMenu(buildMenu());
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
