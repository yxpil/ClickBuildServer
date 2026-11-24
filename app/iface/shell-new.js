// 作者：yxpil
'use strict';

// Windows 资源管理器「右键 → 新建」集成：注册 .yxpn 的 ShellNew 模板。
// 这里只处理 HKCU，不请求管理员权限；模板是可直接打开的服务器创建配置文件。
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const spec = require('./spec');
const pkg = require('./package');

const EXT = '.yxpn';
const PROG_ID = 'ClickBuild.Yxpn';
const LABEL = 'ClickBuildServer 服务器创建配置文件';
const EXPLORER_HINT = '已通知资源管理器刷新；若“新建”菜单仍未出现，重开一个文件夹窗口即可。';
const EXT_KEY = `HKCU\\Software\\Classes\\${EXT}`;
const PROG_KEY = `HKCU\\Software\\Classes\\${PROG_ID}`;
const SHELL_NEW_KEY = `${EXT_KEY}\\ShellNew`;

function openCommand(opts) {
  const o = opts || {};
  return o.packaged
    ? `"${o.exe}" "%1"`
    : `"${o.exe}" "${o.appDir}" "%1"`;
}

function templatePath(root) {
  return path.join(root, 'shell-new', 'ClickBuildServer-ServerProject.yxpn');
}

// 右键新建复制的是完整 .yxpn，不是 0 字节空文件；打开后就是混合任务起步工程。
function ensureTemplate(opts) {
  const o = opts || {};
  if (!o.root) throw new Error('缺少工程存储目录');
  const template = templatePath(o.root);
  fs.mkdirSync(path.dirname(template), { recursive: true });
  const project = spec.starterProject('mixed');
  project.name = '新建服务器工程';
  project.description = '从资源管理器右键新建的服务器创建配置文件';
  pkg.writeProject(project, template, { port: o.port });
  return template;
}

function registerCommands(opts) {
  const o = opts || {};
  const icon = o.icon || o.exe;
  return [
    ['add', EXT_KEY, '/ve', '/d', PROG_ID, '/f'],
    ['add', PROG_KEY, '/ve', '/d', LABEL, '/f'],
    ['add', PROG_KEY, '/v', 'FriendlyTypeName', '/d', LABEL, '/f'],
    ['add', `${PROG_KEY}\\DefaultIcon`, '/ve', '/d', icon, '/f'],
    ['add', `${PROG_KEY}\\shell\\open\\command`, '/ve', '/d', openCommand(o), '/f'],
    ['add', SHELL_NEW_KEY, '/v', 'FileName', '/d', o.template, '/f'],
    ['add', SHELL_NEW_KEY, '/v', 'ItemName', '/d', LABEL, '/f'],
    ['add', SHELL_NEW_KEY, '/v', 'IconPath', '/d', icon, '/f'],
  ];
}

function unregisterCommands() {
  return [['delete', SHELL_NEW_KEY, '/f']];
}

function runReg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (err, out, errOut) => {
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, out: String(out || errOut || '').trim() });
    });
  });
}

function parseQueryValue(out, name) {
  const re = new RegExp(`${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.*)`, 'i');
  const hit = re.exec(String(out || ''));
  return hit ? hit[1].trim() : '';
}

// 注册表写完不会自动进资源管理器的“新建”缓存，主动通知一次 Shell 关联变化。
function notifyShell() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  const ps = "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class ShellNotify{[DllImport(\"shell32.dll\")]public static extern void SHChangeNotify(int e,uint f,IntPtr a,IntPtr b);}'; [ShellNotify]::SHChangeNotify([int]0x08000000,[uint32]0,[IntPtr]::Zero,[IntPtr]::Zero)";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err) => {
      resolve(!err);
    });
  });
}

async function status(opts) {
  const o = opts || {};
  if (process.platform !== 'win32') {
    return { ok: true, supported: false, registered: false, label: LABEL, template: o.template || '' };
  }
  const sn = await runReg(['query', SHELL_NEW_KEY, '/v', 'FileName']);
  const file = parseQueryValue(sn.out, 'FileName');
  const ext = await runReg(['query', EXT_KEY, '/ve']);
  const prog = parseQueryValue(ext.out, '');
  const open = await runReg(['query', `${PROG_KEY}\\shell\\open\\command`, '/ve']);
  const registered = sn.ok && !!file && fs.existsSync(file) && (!o.template || path.resolve(file) === path.resolve(o.template));
  return {
    ok: true,
    supported: true,
    registered,
    label: LABEL,
    template: file || o.template || '',
    expected: o.template || '',
    progId: prog,
    openCommand: parseQueryValue(open.out, ''),
    explorerHint: registered ? EXPLORER_HINT : '',
  };
}

async function register(opts) {
  const o = opts || {};
  if (process.platform !== 'win32') {
    return { ok: false, supported: false, error: '右键新建目前只支持 Windows' };
  }
  if (!o.exe || !o.template) return { ok: false, error: '缺少程序路径或模板路径' };
  if (!fs.existsSync(o.template)) return { ok: false, error: `模板不存在：${o.template}` };
  for (const args of registerCommands(o)) {
    const r = await runReg(args);
    if (!r.ok) return { ok: false, error: r.out || '注册表写入失败', step: args[3] || args[1] };
  }
  const notified = await notifyShell();
  return {
    ok: true,
    supported: true,
    registered: true,
    notified,
    label: LABEL,
    template: o.template,
    explorerHint: EXPLORER_HINT,
  };
}

async function unregister() {
  if (process.platform !== 'win32') return { ok: false, supported: false, error: '右键新建目前只支持 Windows' };
  for (const args of unregisterCommands()) {
    const r = await runReg(args);
    if (!r.ok && !/找不到|not find|unable to find/i.test(r.out)) return { ok: false, error: r.out, step: args[1] };
  }
  return { ok: true, supported: true, registered: false };
}

module.exports = { EXT, PROG_ID, LABEL, openCommand, templatePath, ensureTemplate, registerCommands, unregisterCommands, status, register, unregister, parseQueryValue };
