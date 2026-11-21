// 作者：yxpil
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const store = require('../store');
const platform = require('../platform');

const PORTS = { mysql: 13306, redis: 16379, s3: 19000, s3Console: 19001, http: 18100 };

const state = {
  mysql: { child: null, log: [] },
  redis: { child: null, log: [] },
  s3: { child: null, log: [] },
  server: { child: null, log: [], dir: '' },
};

// 本次运行实际使用的端口。用户设置里的端口只是“首选”，被占用时会依次向上避让。
const boot = { ports: null, conflicts: [], adopted: {}, adoptedPid: {} };

// 服务二进制只从安装包资源里找，不记录、不依赖任何用户目录。
// 源码运行用仓库 vendor/services，安装版用 resources/services。
function bundledServicesRoot() {
  const candidates = [
    path.join(store.resourceRoot(), 'services'),
    path.join(store.APP_ROOT, 'vendor', 'services-linux'),
    path.join(store.APP_ROOT, 'vendor', 'services'),
  ];
  return candidates.find((dir) => fs.existsSync(platform.serviceLayout(dir).mariadbd)) || candidates[0];
}

function desiredPorts() {
  const s = store.readSettings();
  return { ...PORTS, ...(s.ports || {}) };
}

function settings() {
  const want = desiredPorts();
  const ports = { ...want, ...(boot.ports || {}) };
  return {
    servicesRoot: bundledServicesRoot(),
    ports,
    desiredPorts: want,
    conflicts: boot.conflicts.slice(),
    adopted: { ...boot.adopted },
  };
}

function runtimeRoot() {
  const dir = path.join(store.root(), 'runtime');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pushLog(name, text) {
  const s = state[name];
  if (!s) return;
  s.log.push(String(text).replace(/\r/g, ''));
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

function spawnSvc(name, exe, args, opts) {
  const s = state[name];
  if (s.child && !s.child.killed) return { ok: true, already: true, pid: s.child.pid };
  pushLog(name, `$ ${exe} ${args.join(' ')}`);
  let child;
  try {
    child = spawn(exe, args, platform.serviceSpawnOptions(opts));
  } catch (e) {
    pushLog(name, 'spawn 失败：' + e.message);
    return { ok: false, error: e.message };
  }
  s.child = child;
  s.pid = child.pid;
  child.stdout.on('data', (d) => pushLog(name, d.toString()));
  child.stderr.on('data', (d) => pushLog(name, d.toString()));
  child.on('error', (e) => pushLog(name, 'error: ' + e.message));
  child.on('close', (code) => {
    pushLog(name, `进程退出 code=${code}`);
    if (s.child === child) {
      s.child = null;
      s.pid = null;
      if (name === 'server') clearServerMarker(child.pid);
    }
  });
  return { ok: true, pid: child.pid };
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(700);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

function processInfo(pid) {
  return platform.processInfo(pid);
}

function listenerInfo(port) {
  return platform.listenerInfo(port);
}

function isBundledProcess(info, exeName) {
  if (!info || !info.path) return false;
  const base = path.basename(info.path);
  const want = platform.isWindows ? String(exeName).toLowerCase() : String(exeName);
  if ((platform.isWindows ? base.toLowerCase() : base) !== want) return false;
  return platform.isUnder(info.path, bundledServicesRoot());
}

function serverMarkerPath() {
  return path.join(runtimeRoot(), 'server.json');
}

function readServerMarker() {
  try {
    const file = serverMarkerPath();
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && data.pid ? data : null;
  } catch (e) {
    return null;
  }
}

function writeServerMarker(data) {
  try {
    fs.writeFileSync(serverMarkerPath(), JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (e) { /* 标记失败不影响启动 */ }
}

function clearServerMarker(pid) {
  try {
    const file = serverMarkerPath();
    if (!fs.existsSync(file)) return;
    if (pid) {
      const cur = readServerMarker();
      if (cur && Number(cur.pid) !== Number(pid)) return;
    }
    fs.unlinkSync(file);
  } catch (e) { /* 忽略 */ }
}

// 生成服务由本应用启动。Node 用安装包独有的便携 node.exe 判定；
// 其他运行时（Bun / Java / Go / Python）靠上次启动写入的 PID 标记 + 命令行入口判定。
function isGeneratedServer(info, marker) {
  if (!info || !info.pid || !info.path) return false;
  const cmd = String(info.commandLine || '').toLowerCase();
  const exePath = String(info.path);
  const exe = path.basename(exePath);
  const norm = (x) => (platform.isWindows ? String(x).toLowerCase() : String(x));
  if (marker && Number(marker.pid) === Number(info.pid)) {
    const entry = path.basename(String(marker.entry || '')).toLowerCase();
    const markerExe = path.basename(String(marker.exe || ''));
    if (entry && cmd.includes(entry) && (!markerExe || norm(markerExe) === norm(exe))) return true;
  }
  const bundled = store.bundledNode();
  if (!bundled) return false;
  if (norm(exe) !== norm(path.basename(bundled))) return false;
  const entryRe = /(?:^|[\s"'\\/])(?:server|dev)\.js(?:[\s"']|$)/i;
  if (!entryRe.test(cmd)) return false;
  return platform.isUnder(exePath, path.dirname(bundled));
}

function findGeneratedServer(port) {
  const marker = readServerMarker();
  // 优先用上次启动记录的 PID：热部署时 node dev.js 会再拉起 server.js 子进程，
  // 只杀监听子进程会留下 dev.js 继续复活服务，必须从记录的根进程整棵树结束。
  if (marker && marker.pid) {
    const proc = processInfo(marker.pid);
    if (proc && isGeneratedServer(proc, marker)) return { info: proc, marker, killPid: proc.pid };
  }
  const info = port ? listenerInfo(port) : null;
  if (!info || !isGeneratedServer(info, marker)) return null;
  let root = info;
  for (let i = 0; i < 4 && root.parentPid; i += 1) {
    const parent = processInfo(root.parentPid);
    if (!parent || !isGeneratedServer(parent, marker)) break;
    root = parent;
  }
  return { info: root, listener: info, marker, killPid: root.pid };
}

function listBundledProcesses() {
  return platform.listBundledProcesses(bundledServicesRoot()).filter((x) => x.pid !== process.pid);
}

async function killTree(pid) {
  await platform.killTree(pid);
}

async function waitPidGone(pid, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000);
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (e) { return true; }
    await new Promise((r) => setTimeout(r, 120));
  }
  try { process.kill(pid, 0); return false; } catch (e) { return true; }
}

async function cleanupOrphans() {
  const stale = listBundledProcesses().filter((x) => x.pid !== process.pid);
  if (!stale.length) return { ok: true, stopped: [] };
  for (const x of stale) await killTree(x.pid);
  await Promise.all(stale.map((x) => waitPidGone(x.pid, 6000)));
  boot.ports = null;
  boot.conflicts = [];
  boot.adopted = {};
  boot.adoptedPid = {};
  return { ok: true, stopped: stale.map((x) => ({ pid: x.pid, name: path.basename(x.path) })) };
}

async function nextFreePort(start, skip) {
  const used = skip || new Set();
  for (let p = start; p < start + 40; p += 1) {
    if (used.has(p)) continue;
    if (!(await isPortOpen(p))) return p;
  }
  return 0;
}

// 首选端口可用就直接用；如果是本安装包自己的服务，认领现有进程；
// 否则向后找第一个空端口，并记下“从哪避让到哪”，供启动页和侧栏显示。
async function preparePorts(wantOverride) {
  if (boot.ports && !wantOverride) return settings().ports;
  const want = { ...desiredPorts(), ...(wantOverride || {}) };
  const ports = { ...want };
  const conflicts = [];
  const adopted = {};
  const adoptedPid = {};
  const owners = platform.ownerNames(bundledServicesRoot());
  const targets = [
    { key: 'mysql', owner: owners.mysql, label: 'MariaDB' },
    { key: 'redis', owner: owners.redis, label: 'Redis' },
    { key: 's3', owner: owners.s3, label: 'RustFS' },
    { key: 's3Console', owner: owners.s3Console, label: 'RustFS 控制台' },
    { key: 'http', owner: '', label: '生成的服务' },
  ];
  for (const item of targets) {
    const preferred = Number(want[item.key]);
    if (!(await isPortOpen(preferred))) { ports[item.key] = preferred; continue; }
    const owner = listenerInfo(preferred);
    if (item.key !== 'http' && item.owner && isBundledProcess(owner, item.owner)) {
      ports[item.key] = preferred;
      adopted[item.key] = true;
      adoptedPid[item.key] = owner.pid;
      continue;
    }
    if (item.key === 'http' && isGeneratedServer(owner, readServerMarker())) {
      ports[item.key] = preferred;
      adopted[item.key] = true;
      adoptedPid[item.key] = owner.pid;
      continue;
    }
    const used = new Set(Object.entries(ports).filter(([k]) => k !== item.key).map(([, v]) => Number(v)));
    const free = await nextFreePort(preferred + 1, used);
    if (!free) throw new Error(`${item.label} 端口 ${preferred} 被占用，且后面 40 个端口也不可用`);
    ports[item.key] = free;
    conflicts.push({ key: item.key, label: item.label, from: preferred, to: free, reason: (owner && owner.name) || 'unknown' });
  }
  boot.ports = ports;
  boot.conflicts = conflicts;
  boot.adopted = adopted;
  boot.adoptedPid = adoptedPid;
  return ports;
}

async function status() {
  const { ports, servicesRoot } = settings();
  const [mysqlOpen, redisOpen, s3Open, httpOpen] = await Promise.all([
    isPortOpen(ports.mysql),
    isPortOpen(ports.redis),
    isPortOpen(ports.s3),
    isPortOpen(ports.http),
  ]);
  const layout = platform.serviceLayout(servicesRoot);
  const bin = {
    mariadbd: layout.mariadbd,
    installDb: layout.installDb,
    redis: layout.redis,
    rustfs: layout.rustfs,
  };
  const missing = Object.entries(bin).filter(([, v]) => !fs.existsSync(v)).map(([k]) => k);
  const srvMarker = readServerMarker();
  const srvPid = state.server.pid || boot.adoptedPid.http || (httpOpen && srvMarker ? srvMarker.pid : null);
  return {
    servicesRoot,
    bundled: missing.length === 0,
    missing,
    ports,
    desiredPorts: settings().desiredPorts,
    conflicts: settings().conflicts,
    adopted: settings().adopted,
    binaries: Object.fromEntries(Object.entries(bin).map(([k, v]) => [k, { path: v, exists: fs.existsSync(v) }])),
    items: [
      { id: 'mysql', name: 'MariaDB', port: ports.mysql, running: mysqlOpen, pid: state.mysql.pid || boot.adoptedPid.mysql || null, note: 'skip-grant-tables 本地测试实例', adopted: !!boot.adopted.mysql },
      { id: 'redis', name: 'Redis', port: ports.redis, running: redisOpen, pid: state.redis.pid || boot.adoptedPid.redis || null, note: platform.isWindows ? 'Cygwin 构建，RedisService 托管' : '原生 redis-server 托管', adopted: !!boot.adopted.redis },
      { id: 's3', name: 'RustFS', port: ports.s3, running: s3Open, pid: state.s3.pid || boot.adoptedPid.s3 || null, note: `S3 兼容，控制台 ${ports.s3Console}`, adopted: !!boot.adopted.s3 },
      { id: 'server', name: '生成的服务', port: ports.http, running: httpOpen, pid: srvPid, dir: state.server.dir || (httpOpen && srvMarker ? srvMarker.dir : ''), hot: !!state.server.hot, runtime: state.server.runtime || (httpOpen && srvMarker ? srvMarker.runtime : '') || 'node', adopted: !!boot.adopted.http },
    ],
  };
}

async function waitPort(ports, timeoutMs) {
  const list = Array.isArray(ports) ? ports : [ports];
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    let all = true;
    for (const p of list) {
      if (!(await isPortOpen(p))) { all = false; break; }
    }
    if (all) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function startMysql() {
  const ports = await preparePorts();
  const servicesRoot = bundledServicesRoot();
  if (boot.adopted.mysql) return { ok: true, already: true, adopted: true, port: ports.mysql };
  const layout = platform.serviceLayout(servicesRoot);
  const mariadbRoot = path.join(servicesRoot, 'MariaDB');
  const datadir = path.join(runtimeRoot(), 'mariadb');
  if (!fs.existsSync(layout.mariadbd)) return { ok: false, error: `找不到 ${layout.mariadbd}` };
  if (!fs.existsSync(path.join(datadir, 'mysql'))) {
    fs.mkdirSync(datadir, { recursive: true });
    pushLog('mysql', '初始化数据目录…');
    const initArgs = ['--datadir', datadir, '--basedir', mariadbRoot];
    if (!platform.isWindows) {
      // mariadb-install-db 默认把 datadir chown 给 mysql 用户；普通用户没有这个权限，
      // 直接指定当前用户，初始化器就不会再尝试切换属主。
      initArgs.push('--user', os.userInfo().username);
    }
    const r = await new Promise((resolve) => {
      const c = spawn(layout.installDb, initArgs, platform.baseSpawnOptions());
      let out = '';
      c.stdout.on('data', (d) => { out += d; pushLog('mysql', d.toString()); });
      c.stderr.on('data', (d) => { out += d; pushLog('mysql', d.toString()); });
      c.on('close', (code) => resolve({ code, out }));
      c.on('error', (e) => resolve({ code: -1, out: e.message }));
    });
    if (r.code !== 0) return { ok: false, error: '数据目录初始化失败：' + r.out.slice(-600) };
    // 初始化器会写带绝对路径的 my.ini / my.cnf；运行时用 --no-defaults，不需要它。
    for (const name of ['my.ini', 'my.cnf']) {
      try { fs.rmSync(path.join(datadir, name), { force: true }); } catch (e) { /* 忽略 */ }
    }
  }
  const args = [
    '--no-defaults',
    '--datadir', datadir,
    '--port', String(ports.mysql),
    '--bind-address=127.0.0.1',
    '--skip-grant-tables',
    '--skip-name-resolve',
    '--innodb-buffer-pool-size=64M',
  ];
  if (platform.isWindows) {
    args.push('--console');
  } else {
    args.push('--lc-messages-dir', path.join(mariadbRoot, 'share'));
  }
  const res = spawnSvc('mysql', layout.mariadbd, args, {
    env: {
      ...process.env,
      ...(platform.isWindows ? {} : { LD_LIBRARY_PATH: [path.join(mariadbRoot, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter) }),
    },
  });
  if (res.ok) {
    const up = await waitPort(ports.mysql, 30000);
    if (!up) return { ...res, ok: false, port: ports.mysql, error: `MariaDB 没有在 30 秒内监听 ${ports.mysql}` };
  }
  return { ...res, port: ports.mysql };
}

function cygPath(p) {
  const abs = path.resolve(p);
  return `/cygdrive/${abs[0].toLowerCase()}${abs.slice(2).replace(/\\/g, '/')}`;
}

async function startRedis() {
  const ports = await preparePorts();
  const servicesRoot = bundledServicesRoot();
  if (boot.adopted.redis) return { ok: true, already: true, adopted: true, port: ports.redis };
  const exe = platform.serviceLayout(servicesRoot).redis;
  if (!fs.existsSync(exe)) return { ok: false, error: `找不到 ${exe}` };
  const dir = path.join(runtimeRoot(), 'redis');
  fs.mkdirSync(dir, { recursive: true });
  // Windows 版是 Cygwin 构建，--dir 只认 /cygdrive/... 形式；Linux/macOS 直接用绝对路径。
  const dirArg = platform.isWindows ? cygPath(dir) : dir;
  const res = spawnSvc('redis', exe, ['--port', String(ports.redis), '--dir', dirArg, '--daemonize', 'no']);
  if (res.ok) {
    const up = await waitPort(ports.redis, 12000);
    if (!up) return { ...res, ok: false, port: ports.redis, error: `Redis 没有在 12 秒内监听 ${ports.redis}` };
  }
  return { ...res, port: ports.redis };
}

async function startS3() {
  const ports = await preparePorts();
  const servicesRoot = bundledServicesRoot();
  if (boot.adopted.s3) return { ok: true, already: true, adopted: true, port: ports.s3 };
  const exe = platform.serviceLayout(servicesRoot).rustfs;
  if (!fs.existsSync(exe)) return { ok: false, error: `找不到 ${exe}` };
  const dir = path.join(runtimeRoot(), 'rustfs');
  fs.mkdirSync(dir, { recursive: true });
  const res = spawnSvc('s3', exe, ['server', '--address', `127.0.0.1:${ports.s3}`, '--console-enable', '--console-address', `127.0.0.1:${ports.s3Console}`, dir], {
    env: {
      ...process.env,
      RUSTFS_ACCESS_KEY: 'clickbuild',
      RUSTFS_SECRET_KEY: 'clickbuild123',
    },
  });
  if (res.ok) {
    const up = await waitPort(ports.s3, 20000);
    if (!up) return { ...res, ok: false, port: ports.s3, error: `RustFS 没有在 20 秒内监听 ${ports.s3}` };
  }
  return { ...res, port: ports.s3 };
}

function clearBootPort(name) {
  if (!boot.ports) return;
  // 生成服务停掉后保留本次实际端口。若删掉，状态探测会退回首选端口，
  // 一旦首选端口上有别的程序（例如 18100 上的测试服务），就会误报“生成的服务正在运行”。
  if (name !== 'server') delete boot.ports[name];
  if (name === 's3') delete boot.ports.s3Console;
  const adoptKey = name === 'server' ? 'http' : name;
  delete boot.adopted[adoptKey];
  delete boot.adoptedPid[adoptKey];
  if (name === 's3') { delete boot.adopted.s3Console; delete boot.adoptedPid.s3Console; }
  boot.conflicts = boot.conflicts.filter((c) => c.key !== adoptKey && !(name === 's3' && c.key === 's3Console'));
}

async function stopOne(name) {
  const s = state[name];
  if (!s || !s.child) {
    // 没有子进程句柄时，只有确认监听进程就是本安装包的服务才允许停，避免误伤别的程序。
    if (name === 'server') {
      const port = (boot.ports && boot.ports.http) || settings().ports.http || (readServerMarker() || {}).port;
      const found = findGeneratedServer(port);
      if (found) {
        const killPid = found.killPid || found.info.pid;
        await killTree(killPid);
        await waitPidGone(killPid, 6000);
        clearServerMarker();
        clearBootPort('server');
        pushLog('server', `已停止认领的生成服务 PID ${killPid}`);
        return { ok: true, pid: killPid, adopted: true };
      }
      clearServerMarker();
      clearBootPort('server');
      if (port && await isPortOpen(port)) {
        return { ok: false, error: `端口 ${port} 仍被其他程序占用，无法确认是本应用启动的生成服务` };
      }
      return { ok: true, already: true };
    }
    const owners = platform.ownerNames(bundledServicesRoot());
    const port = boot.ports && boot.ports[name];
    const owner = port ? listenerInfo(port) : null;
    if (owners[name] && owner && isBundledProcess(owner, owners[name])) {
      await killTree(owner.pid);
      clearBootPort(name);
      pushLog(name, '已停止认领的进程');
      return { ok: true, pid: owner.pid, adopted: true };
    }
    clearBootPort(name);
    return { ok: true, already: true };
  }
  const pid = s.child.pid;
  await killTree(pid);
  s.child = null;
  s.pid = null;
  if (name === 'server') clearServerMarker(pid);
  clearBootPort(name);
  pushLog(name, '已停止');
  return { ok: true, pid };
}

function nodeBin() {
  // 解释器跟着项目走：resources\runtime\node\node.exe（源码运行则是仓库 runtime），找不到才退回系统 node
  const bundled = store.bundledNode();
  if (bundled) return bundled;
  if (process.env.NODE_BIN) return process.env.NODE_BIN;
  if (process.env.npm_node_execpath) return process.env.npm_node_execpath;
  return 'node';
}

function which(cmd) {
  return platform.which(cmd);
}

function probe(exe, args) {
  if (!exe) return '';
  try {
    // .cmd 不能直接 spawn（Windows 会 EINVAL）；用 cmd /c 按 PATH 里的命令名执行
    const isCmd = platform.isWindows && /\.(cmd|bat)$/i.test(exe);
    const cmd = isCmd ? 'cmd.exe' : exe;
    const cmdArgs = isCmd ? ['/d', '/c', [path.basename(exe, path.extname(exe)), ...args].join(' ')] : args;
    const r = spawnSync(cmd, cmdArgs, platform.baseSpawnOptions({ encoding: 'utf8', timeout: 8000 }));
    const text = String((r.stdout || '') + (r.stderr || ''));
    return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
  } catch (e) {
    return '';
  }
}

function shortVersion(text) {
  return String(text || '')
    .replace(/^java version\s+/i, '')
    .replace(/^go version\s+/i, '')
    .replace(/^git version\s+/i, '')
    .replace(/^rustc\s+/i, '')
    .replace(/^Python\s+/i, '')
    .replace(/"/g, '')
    .split(/\s+/)[0] || '';
}

function runtimes() {
  const node = nodeBin();
  const bun = which('bun.exe') || which('bun.cmd') || which('bun');
  const java = which('java.exe') || which('java');
  const javac = which('javac.exe') || which('javac');
  const go = which('go.exe') || which('go.cmd') || which('go');
  const python = which('python.exe') || which('python') || which('python3.exe') || which('python3');
  return [
    // 显示真正用来跑服务的 node.exe 版本，而不是 Electron 内置的 process.version
    { id: 'node', name: 'Node', version: probe(node, ['--version']) || process.version, path: node, available: fs.existsSync(node) || node === 'node', native: true, note: platform.isWindows ? '内置 Node.js，直接运行 server.js' : '内置 Linux Node.js，直接运行 server.js' },
    { id: 'bun', name: 'Bun', version: shortVersion(probe(bun, ['--version'])), path: bun, available: !!bun, native: true, note: '需要系统已安装 Bun，兼容 Node API' },
    { id: 'java', name: 'Java', version: shortVersion(probe(java, ['-version'])), path: java, available: !!(java && javac), native: true, note: javac ? 'Java 原生服务：javac 编译 native/java 后直连 MySQL，不调用 Node' : '只找到 java，没有 javac；请安装完整 JDK 17+' },
    { id: 'go', name: 'Go', version: shortVersion(probe(go, ['version'])), path: go, available: !!go, native: true, note: 'Go 原生服务：go build 后直接运行 native/go，不调用 Node' },
    { id: 'python', name: 'Python', version: shortVersion(python ? probe(python, ['--version']) : ''), path: python, available: !!python, native: true, note: 'Python Flask 原生服务：python native/python/app.py，依赖见 requirements.txt' },
  ];
}

function environment() {
  const list = runtimes();
  const rustc = which('rustc.exe') || which('rustc');
  const cargo = which('cargo.exe') || which('cargo');
  const git = which('git.exe') || which('git');
  const extras = [
    { id: 'rust', name: 'Rust', version: shortVersion(rustc ? probe(rustc, ['--version']) : ''), path: cargo || rustc, available: !!(rustc && cargo), native: true, kind: 'compiler', note: 'Rust 代码生成用；需要 rustc + cargo' },
    { id: 'git', name: 'Git', version: shortVersion(git ? probe(git, ['--version']) : ''), path: git, available: !!git, native: false, kind: 'tool', note: '导入模版、拉取依赖时用' },
  ];
  const tools = list.map((r) => ({ ...r, kind: 'runtime' }));
  return {
    tools: tools.concat(extras),
    runtimes: list,
    available: tools.concat(extras).filter((t) => t.available).length,
    total: tools.length + extras.length,
  };
}

async function startServer(dir, opts) {
  const ports = await preparePorts();
  if (state.server.child && !state.server.child.killed) return { ok: true, already: true, pid: state.server.pid, hot: state.server.hot, runtime: state.server.runtime, port: ports.http };
  if (boot.adopted.http) {
    const marker = readServerMarker() || {};
    return {
      ok: true,
      already: true,
      adopted: true,
      pid: boot.adoptedPid.http,
      port: ports.http,
      dir: marker.dir || dir,
      hot: !!marker.hot,
      runtime: marker.runtime || 'node',
      entry: marker.entry || '',
    };
  }
  const o = opts || {};
  const runtime = o.runtime || 'node';
  const hot = !!o.hot;
  if (!['node', 'bun', 'java', 'go', 'python'].includes(runtime)) return { ok: false, error: `暂不支持 ${runtime} 运行时` };
  let exe = nodeBin();
  let args = [hot && fs.existsSync(path.join(dir, 'dev.js')) ? 'dev.js' : 'server.js'];
  let cwd = dir;
  if (runtime === 'bun') {
    exe = which('bun.exe') || which('bun.cmd') || which('bun');
    if (!exe) return { ok: false, error: '没有找到 Bun，请先安装 Bun 或切换到 Node' };
  } else if (runtime === 'java') {
    exe = which('java.exe') || which('java');
    if (!exe) return { ok: false, error: '没有找到 Java，请先安装 JDK 17+ 或切换到 Node' };
    const nativeDir = path.join(dir, 'native', 'java');
    if (fs.existsSync(path.join(nativeDir, 'src', 'icb', 'Main.java'))) {
      const javac = which('javac.exe') || which('javac');
      if (!javac) return { ok: false, error: '没有找到 javac，请安装完整 JDK（不是只装 JRE）' };
      const binDir = path.join(nativeDir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const sources = fs.readdirSync(path.join(nativeDir, 'src', 'icb')).filter((f) => f.endsWith('.java')).map((f) => path.join('src', 'icb', f));
      const built = spawnSync(javac, ['-encoding', 'UTF-8', '-cp', 'lib/*', '-d', 'bin', ...sources], {
        cwd: nativeDir,
        encoding: 'utf8',
        timeout: 120000,
      });
      if (built.status !== 0) {
        return { ok: false, error: 'Java 编译失败：' + String(built.stderr || built.stdout || '').trim().split(/\r?\n/).slice(-4).join(' | ') };
      }
      exe = which('java.exe') || which('java');
      args = ['-cp', ['bin', 'lib/*'].join(path.delimiter), 'icb.Main'];
      cwd = nativeDir;
    } else {
      return { ok: false, error: '生成目录缺少 native/java，请重新生成服务' };
    }
  } else if (runtime === 'go') {
    exe = which('go.exe') || which('go.cmd') || which('go');
    if (!exe) return { ok: false, error: '没有找到 Go，请先安装 Go 1.21+ 或切换到 Node' };
    const nativeDir = path.join(dir, 'native', 'go');
    if (!fs.existsSync(path.join(nativeDir, 'service.json'))) return { ok: false, error: '生成目录缺少 native/go/service.json，请重新生成服务' };
    const binDir = path.join(nativeDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const outExe = path.join(binDir, platform.exeName('server'));
    const goEnv = { ...process.env, GOPROXY: process.env.GOPROXY || 'https://goproxy.cn,direct' };
    if (!fs.existsSync(path.join(nativeDir, 'go.sum'))) {
      const tidy = spawnSync(exe, ['mod', 'tidy'], { cwd: nativeDir, encoding: 'utf8', shell: platform.isWindows && /\.(cmd|bat)$/i.test(exe), env: goEnv, timeout: 180000 });
      if (tidy.status !== 0) {
        return { ok: false, error: 'Go 依赖准备失败：' + String(tidy.stderr || tidy.stdout || '').trim().split(/\r?\n/).slice(-3).join(' | ') };
      }
    }
    const built = spawnSync(exe, ['build', '-o', outExe, '.'], {
      cwd: nativeDir,
      encoding: 'utf8',
      shell: platform.isWindows && /\.(cmd|bat)$/i.test(exe),
      env: goEnv,
      timeout: 180000,
    });
    if (built.status !== 0) {
      return { ok: false, error: 'Go 编译失败：' + String(built.stderr || built.stdout || '').trim().split(/\r?\n/).slice(-3).join(' | ') };
    }
    exe = outExe;
    args = [];
    cwd = nativeDir;
  } else if (runtime === 'python') {
    exe = which('python.exe') || which('python') || which('python3.exe') || which('python3');
    if (!exe) return { ok: false, error: '没有找到 Python，请先安装 Python 3.10+ 或切换到 Node' };
    const nativeDir = path.join(dir, 'native', 'python');
    if (!fs.existsSync(path.join(nativeDir, 'app.py')) || !fs.existsSync(path.join(nativeDir, 'service.json'))) {
      return { ok: false, error: '生成目录缺少 native/python/app.py 或 service.json，请重新生成服务' };
    }
    const dep = spawnSync(exe, ['-c', 'import flask, pymysql, requests, redis, minio'], { cwd: nativeDir, encoding: 'utf8', timeout: 30000 });
    if (dep.status !== 0) {
      return { ok: false, error: 'Python 依赖缺失，请在 native/python 执行 pip install -r requirements.txt' };
    }
    args = ['app.py'];
    cwd = nativeDir;
  }
  const nativeRun = runtime === 'go' || runtime === 'python' || (runtime === 'java' && cwd !== dir);
  const entry = runtime === 'go' ? `native/go/bin/${platform.exeName('server')}` : runtime === 'python' ? 'native/python/app.py' : args[args.length - 1];
  if (!nativeRun && !fs.existsSync(path.join(dir, entry))) return { ok: false, error: `生成目录里找不到 ${entry}` };
  const res = spawnSvc('server', exe, args, {
    cwd,
    shell: platform.isWindows && /\.(cmd|bat)$/i.test(exe),
    env: {
      ...process.env,
      PORT: String(ports.http),
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: String(ports.mysql),
      MYSQL_USER: 'root',
      MYSQL_PASSWORD: '',
      MYSQL_DB: 'clickbuild',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(ports.redis),
      REDIS_DB: '0',
      S3_ENDPOINT: '127.0.0.1',
      S3_PORT: String(ports.s3),
      S3_ACCESS_KEY: 'clickbuild',
      S3_SECRET_KEY: 'clickbuild123',
      S3_SSL: 'false',
      NODE_PATH: store.nodeModulesRoot(),
      NODE_BIN: nodeBin(),
      HOT_RELOAD: hot ? '1' : '0',
    },
  });
  state.server.dir = dir;
  state.server.hot = hot;
  state.server.runtime = runtime;
  if (res.ok) {
    writeServerMarker({ pid: res.pid, dir, entry, runtime, hot, port: ports.http, exe, args });
    const up = await waitPort(ports.http, 20000);
    if (!up) return { ...res, ok: false, port: ports.http, error: `生成的服务没有在 20 秒内监听 ${ports.http}` };
  }
  return { ...res, port: ports.http, hot, runtime, entry };
}

async function stopServer() {
  return stopOne('server');
}

function serverInfo() {
  return {
    dir: state.server.dir || '',
    runtime: state.server.runtime || 'node',
    hot: !!state.server.hot,
    child: state.server.child || null,
    pid: state.server.pid || null,
  };
}

async function waitPortClosed(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 3000);
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !(await isPortOpen(port));
}

async function startAll(progress) {
  const notify = typeof progress === 'function' ? progress : () => {};
  const items = [
    { id: 'mysql', name: 'MariaDB', start: startMysql },
    { id: 'redis', name: 'Redis', start: startRedis },
    { id: 's3', name: 'RustFS', start: startS3 },
  ];
  const out = {};
  for (const it of items) {
    notify({ id: it.id, name: it.name, status: 'running', text: `正在启动 ${it.name}` });
    let r;
    try { r = await it.start(); } catch (e) { r = { ok: false, error: e.message }; }
    out[it.id] = r;
    const port = r && r.port ? `:${r.port}` : '';
    notify({ id: it.id, name: it.name, status: r && r.ok ? 'done' : 'error', text: r && r.ok ? `${it.name} 已就绪${port}${r.adopted ? '（认领现有进程）' : ''}` : `${it.name} 启动失败`, detail: (r && r.error) || '' });
  }
  return out;
}

async function stopAll() {
  const results = {};
  for (const n of ['server', 'mysql', 'redis', 's3']) results[n] = await stopOne(n);
  boot.adopted = {};
  boot.adoptedPid = {};
  const failed = Object.entries(results).filter(([, r]) => r && r.ok === false);
  return {
    ok: failed.length === 0,
    results,
    error: failed.length ? failed.map(([n, r]) => `${n}: ${r.error || '停止失败'}`).join('；') : '',
  };
}

// 退出应用时用：先停掉本次启动的所有服务，再等端口真正释放。
async function shutdown(onStep) {
  const notify = typeof onStep === 'function' ? onStep : () => {};
  const ports = settings().ports;
  const owned = {
    server: !!state.server.child,
    mysql: !!state.mysql.child || !!boot.adopted.mysql,
    redis: !!state.redis.child || !!boot.adopted.redis,
    s3: !!state.s3.child || !!boot.adopted.s3,
  };
  const steps = [
    ['server', '生成的服务'],
    ['redis', 'Redis'],
    ['s3', 'RustFS'],
    ['mysql', 'MariaDB'],
  ];
  for (const [id, label] of steps) {
    notify({ id, status: 'running', text: `正在停止 ${label}` });
    try { await stopOne(id); } catch (e) { /* 继续关下一个 */ }
    notify({ id, status: 'done', text: `${label} 已停止` });
  }
  const waits = [];
  if (owned.server) waits.push(waitPortClosed(ports.http, 8000));
  if (owned.redis) waits.push(waitPortClosed(ports.redis, 8000));
  if (owned.s3) waits.push(waitPortClosed(ports.s3, 8000));
  if (owned.mysql) waits.push(waitPortClosed(ports.mysql, 8000));
  const closed = await Promise.all(waits);
  boot.ports = null;
  boot.conflicts = [];
  boot.adopted = {};
  boot.adoptedPid = {};
  return { ok: closed.every(Boolean), closed, ports, owned };
}

function logs(id) {
  const s = state[id];
  return s ? s.log.slice(-200).join('\n') : '';
}

function setPorts(patch) {
  const cur = store.readSettings();
  const next = { ...PORTS, ...(cur.ports || {}), ...patch };
  store.writeSettings({ ports: next });
  return next;
}

module.exports = {
  PORTS, settings, status, startMysql, startRedis, startS3, startAll, stopOne, stopAll, logs, setPorts, isPortOpen, waitPort,
  preparePorts, environment, cleanupOrphans, shutdown, runtimes, startServer, stopServer, serverInfo, waitPortClosed,
};
