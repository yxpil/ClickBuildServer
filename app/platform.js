// 作者：yxpil
'use strict';

// 跨平台底座：路径、进程、端口、技能探测都收在这里。
// Windows 继续走 taskkill / PowerShell / netstat；Linux/macOS 走 /proc 与 POSIX 信号。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const platform = process.platform;
const isWindows = platform === 'win32';
const isLinux = platform === 'linux';
const isMac = platform === 'darwin';

const ELECTRON_NAMES = new Set(['electron', 'electron.exe', 'clickbuildserver', 'ClickBuildServer']);

function exeName(base) {
  return isWindows ? `${base}.exe` : base;
}

function serviceLayout(root) {
  return {
    root,
    mariadbd: path.join(root, 'MariaDB', 'bin', exeName('mariadbd')),
    installDb: path.join(root, 'MariaDB', 'bin', isWindows ? 'mariadb-install-db.exe' : 'mariadb-install-db'),
    redis: path.join(root, 'Redis', exeName('redis-server')),
    rustfs: path.join(root, 'RustFS', isWindows ? 'rustfs-windows-x86_64.exe' : 'rustfs'),
  };
}

function ownerNames(root) {
  const layout = serviceLayout(root);
  return {
    mysql: path.basename(layout.mariadbd),
    redis: path.basename(layout.redis),
    s3: path.basename(layout.rustfs),
    s3Console: path.basename(layout.rustfs),
  };
}

function bundledNode(resourceRoot) {
  const candidates = [
    path.join(resourceRoot, 'runtime', 'node', exeName('node')),
    path.join(resourceRoot, 'runtime', 'node', 'bin', exeName('node')),
    path.join(resourceRoot, 'runtime', 'node-linux', 'bin', 'node'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

function userDataFallback() {
  if (isWindows) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'click-build-server');
  if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'click-build-server');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'click-build-server');
}

function pathKey(p) {
  const abs = path.resolve(String(p || ''));
  return isWindows ? abs.toLowerCase() : abs;
}

function samePath(a, b) {
  return !!a && !!b && pathKey(a) === pathKey(b);
}

function isUnder(child, parent) {
  const c = pathKey(child);
  const p = pathKey(parent);
  if (!c || !p) return false;
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function looksLikeElectron(p) {
  if (!p) return false;
  const base = path.basename(String(p));
  if (ELECTRON_NAMES.has(base)) return true;
  return isLinux && /\/electron$/i.test(String(p));
}

function which(cmd) {
  if (!cmd) return '';
  if (cmd.includes('/') || cmd.includes('\\')) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK);
      return cmd;
    } catch (e) { return ''; }
  }
  if (isWindows) {
    try {
      const out = execFileSync('where.exe', [cmd], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      return String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
    } catch (e) { return ''; }
  }
  const pathList = String(process.env.PATH || '').split(path.delimiter);
  const exts = [''];
  for (const dir of pathList) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch (e) { /* 继续找 */ }
    }
  }
  return '';
}

function serviceSpawnOptions(extra) {
  const base = isWindows ? { windowsHide: true } : { detached: true };
  return { ...base, ...(extra || {}) };
}

function baseSpawnOptions(extra) {
  return { ...(isWindows ? { windowsHide: true } : {}), ...(extra || {}) };
}

function readProcStatus(pid) {
  try {
    const text = fs.readFileSync(`/proc/${Number(pid)}/status`, 'utf8');
    const out = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch (e) {
    return null;
  }
}

function processInfo(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (isWindows) {
    try {
      const ps = `$p=(Get-CimInstance Win32_Process -Filter "ProcessId=${n}" -ErrorAction SilentlyContinue); if($p){$p | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress}`;
      const raw = String(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 6000 }) || '').trim();
      if (!raw || raw === 'null') return null;
      const p = JSON.parse(raw);
      const exePath = String(p.ExecutablePath || '');
      return {
        pid: Number(p.ProcessId || n),
        parentPid: Number(p.ParentProcessId || 0),
        name: String(p.Name || (exePath ? path.basename(exePath) : '')),
        path: exePath,
        commandLine: String(p.CommandLine || ''),
      };
    } catch (e) {
      return null;
    }
  }
  const st = readProcStatus(n);
  if (!st) return null;
  let exePath = '';
  let commandLine = '';
  try { exePath = fs.readlinkSync(`/proc/${n}/exe`); } catch (e) { /* 权限不足 */ }
  try { commandLine = fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch (e) { /* 忽略 */ }
  return {
    pid: n,
    parentPid: Number(st.PPid || 0),
    name: String(st.Name || (exePath ? path.basename(exePath) : '')),
    path: exePath,
    commandLine: commandLine || [exePath, st.Name].filter(Boolean).join(' '),
  };
}

function listProcPids() {
  try {
    return fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).map(Number);
  } catch (e) {
    return [];
  }
}

function childrenMap() {
  const map = new Map();
  for (const pid of listProcPids()) {
    const st = readProcStatus(pid);
    if (!st) continue;
    const ppid = Number(st.PPid || 0);
    if (!map.has(ppid)) map.set(ppid, []);
    map.get(ppid).push(pid);
  }
  return map;
}

function descendants(pid) {
  if (isWindows) return [Number(pid)];
  const map = childrenMap();
  const out = [];
  const queue = [Number(pid)];
  const seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const child of (map.get(cur) || [])) queue.push(child);
  }
  return out;
}

function signalPid(pid, sig) {
  try { process.kill(Number(pid), sig); } catch (e) { /* 已退出 */ }
}

async function killTree(pid, timeoutMs) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return;
  if (isWindows) {
    await new Promise((resolve) => {
      const k = spawn('taskkill', ['/PID', String(n), '/T', '/F'], { windowsHide: true });
      k.on('close', () => resolve());
      k.on('error', () => resolve());
    });
    return;
  }
  const all = descendants(n);
  // 先按进程组杀，覆盖 detached 启动的服务；再逐个补刀，覆盖非组长的 dev.js 树。
  try { process.kill(-n, 'SIGTERM'); } catch (e) { /* 不是组长 */ }
  for (const p of all) signalPid(p, 'SIGTERM');
  const deadline = Date.now() + (timeoutMs || 5000);
  while (Date.now() < deadline) {
    const alive = all.filter((p) => {
      try { process.kill(p, 0); return true; } catch (e) { return false; }
    });
    if (!alive.length) return;
    await new Promise((r) => setTimeout(r, 120));
  }
  try { process.kill(-n, 'SIGKILL'); } catch (e) { /* 不是组长 */ }
  for (const p of all) signalPid(p, 'SIGKILL');
}

function processNameByPid(pid) {
  if (isWindows) return '';
  try { return String(fs.readFileSync(`/proc/${Number(pid)}/comm`, 'utf8')).trim(); } catch (e) { return ''; }
}

function socketPidMap() {
  const map = new Map();
  for (const pid of listProcPids()) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch (e) { continue; }
    for (const fd of fds) {
      try {
        const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
        const m = link.match(/^socket:\[(\d+)\]$/);
        if (m && !map.has(Number(m[1]))) map.set(Number(m[1]), pid);
      } catch (e) { /* fd 已关闭 */ }
    }
  }
  return map;
}

function procListener(port) {
  let found = null;
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let rows = [];
    try { rows = fs.readFileSync(file, 'utf8').split('\n').slice(1); } catch (e) { continue; }
    for (const row of rows) {
      const parts = row.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const local = parts[1] || '';
      const state = parts[3] || '';
      const inode = parts[9] || '';
      if (state !== '0A') continue;
      const localPort = Number.parseInt((local.split(':').pop() || ''), 16);
      if (localPort === Number(port)) { found = Number(inode); break; }
    }
    if (found) break;
  }
  if (!found) return null;
  const pid = socketPidMap().get(found);
  if (!pid) return { pid: 0, name: '', path: '', commandLine: '' };
  return processInfo(pid) || { pid, name: processNameByPid(pid), path: '', commandLine: '' };
}

function listenerInfo(port) {
  if (!isWindows) {
    try {
      const out = String(execFileSync('ss', ['-ltnpH', `sport = :${Number(port)}`], { encoding: 'utf8', timeout: 5000 }) || '');
      const line = out.split('\n').find((x) => x.includes(`:${Number(port)}`));
      if (line) {
        const m = line.match(/pid=(\d+)/);
        if (m) return processInfo(m[1]) || { pid: Number(m[1]), name: processNameByPid(m[1]), path: '', commandLine: '' };
      }
    } catch (e) { /* 没有 ss，退回 /proc */ }
    return procListener(port);
  }
  try {
    const out = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const line = String(out).split(/\r?\n/).find((l) => {
      const m = l.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
      return m && Number(m[1]) === Number(port);
    });
    if (!line) return null;
    const pid = Number((line.match(/LISTENING\s+(\d+)\s*$/) || [])[1]);
    if (!pid) return null;
    const info = processInfo(pid);
    if (info) return info;
    let name = '';
    try {
      const rows = String(execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }) || '');
      const m = rows.match(/^"([^"]+)"/);
      name = m ? m[1] : '';
    } catch (e) { /* 忽略 */ }
    return { pid, name, path: '', commandLine: '' };
  } catch (e) {
    return null;
  }
}

function listBundledProcesses(root) {
  const layout = serviceLayout(root);
  const names = new Set([path.basename(layout.mariadbd), path.basename(layout.redis), path.basename(layout.rustfs)].map((x) => (isWindows ? x.toLowerCase() : x)));
  if (isWindows) {
    try {
      const ps = [
        `$names=@(${Array.from(names).map((x) => `'${x}'`).join(',')})`,
        "Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name } | ForEach-Object { \"$($_.ProcessId)|$($_.ExecutablePath)\" }",
      ].join('; ');
      const out = String(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 12000 }) || '');
      return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const [pidText, ...rest] = line.split('|');
        return { pid: Number(pidText), path: rest.join('|') };
      }).filter((x) => x.pid && x.path && isUnder(x.path, root));
    } catch (e) {
      return [];
    }
  }
  const out = [];
  for (const pid of listProcPids()) {
    let exePath = '';
    try { exePath = fs.readlinkSync(`/proc/${pid}/exe`); } catch (e) { continue; }
    const base = path.basename(exePath);
    if (!names.has(base)) continue;
    if (!isUnder(exePath, root)) continue;
    out.push({ pid, path: exePath });
  }
  return out;
}

function processMemoryMap(pids) {
  const map = new Map();
  if (isWindows) return map;
  for (const pid of pids) {
    const st = readProcStatus(pid);
    if (!st) continue;
    // /proc/<pid>/status 的 VmRSS 形如 "12345 kB"，Number() 会得到 NaN。
    const kb = Number.parseInt(String(st.VmRSS || '0').replace(/[^\d]/g, ''), 10) || 0;
    map.set(Number(pid), { name: st.Name || '', bytes: kb * 1024 });
  }
  return map;
}

function networkTotals() {
  if (isWindows) return null;
  let rx = 0;
  let tx = 0;
  try {
    const text = fs.readFileSync('/proc/net/dev', 'utf8');
    for (const line of text.split('\n').slice(2)) {
      const m = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (!m) continue;
      const name = m[1].trim();
      if (name === 'lo') continue;
      const nums = m[2].trim().split(/\s+/).map(Number);
      if (nums.length < 9) continue;
      rx += nums[0] || 0;
      tx += nums[8] || 0;
    }
  } catch (e) {
    return null;
  }
  return { rx, tx };
}

module.exports = {
  platform, isWindows, isLinux, isMac,
  exeName, serviceLayout, ownerNames, bundledNode, userDataFallback,
  pathKey, samePath, isUnder, looksLikeElectron,
  which, serviceSpawnOptions, baseSpawnOptions,
  processInfo, listenerInfo, listBundledProcesses, processMemoryMap,
  descendants, killTree, networkTotals, processNameByPid,
};
