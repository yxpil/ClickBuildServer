'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, execFileSync, spawnSync } = require('child_process');
const store = require('../store');

const PORTS = { mysql: 13306, redis: 16379, s3: 19000, s3Console: 19001, http: 18100 };

const state = {
  mysql: { child: null, log: [] },
  redis: { child: null, log: [] },
  s3: { child: null, log: [] },
  server: { child: null, log: [], dir: '' },
};

// 服务二进制只从安装包资源里找，不记录、不依赖任何用户目录。
// 源码运行用仓库 vendor/services，安装版用 resources/services。
function bundledServicesRoot() {
  const candidates = [
    path.join(store.resourceRoot(), 'services'),
    path.join(store.APP_ROOT, 'vendor', 'services'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'MariaDB', 'bin', 'mariadbd.exe'))) || candidates[0];
}

function settings() {
  const s = store.readSettings();
  return {
    servicesRoot: bundledServicesRoot(),
    ports: { ...PORTS, ...(s.ports || {}) },
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
    child = spawn(exe, args, { windowsHide: true, ...(opts || {}) });
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
    if (s.child === child) { s.child = null; s.pid = null; }
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

async function status() {
  const { ports, servicesRoot } = settings();
  const mysqlOpen = await isPortOpen(ports.mysql);
  const redisOpen = await isPortOpen(ports.redis);
  const s3Open = await isPortOpen(ports.s3);
  const httpOpen = await isPortOpen(ports.http);
  const bin = {
    mariadbd: path.join(servicesRoot, 'MariaDB', 'bin', 'mariadbd.exe'),
    installDb: path.join(servicesRoot, 'MariaDB', 'bin', 'mariadb-install-db.exe'),
    redis: path.join(servicesRoot, 'Redis', 'redis-server.exe'),
    rustfs: path.join(servicesRoot, 'RustFS', 'rustfs-windows-x86_64.exe'),
  };
  const missing = Object.entries(bin).filter(([, v]) => !fs.existsSync(v)).map(([k]) => k);
  return {
    servicesRoot,
    bundled: missing.length === 0,
    missing,
    ports,
    binaries: Object.fromEntries(Object.entries(bin).map(([k, v]) => [k, { path: v, exists: fs.existsSync(v) }])),
    items: [
      { id: 'mysql', name: 'MariaDB', port: ports.mysql, running: mysqlOpen, pid: state.mysql.pid || null, note: 'skip-grant-tables 本地测试实例' },
      { id: 'redis', name: 'Redis', port: ports.redis, running: redisOpen, pid: state.redis.pid || null, note: 'Cygwin 构建，RedisService 托管' },
      { id: 's3', name: 'RustFS', port: ports.s3, running: s3Open, pid: state.s3.pid || null, note: `S3 兼容，控制台 ${ports.s3Console}` },
      { id: 'server', name: '生成的服务', port: ports.http, running: httpOpen, pid: state.server.pid || null, dir: state.server.dir, hot: !!state.server.hot, runtime: state.server.runtime || 'node' },
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
  const { servicesRoot, ports } = settings();
  const bin = path.join(servicesRoot, 'MariaDB', 'bin');
  const datadir = path.join(runtimeRoot(), 'mariadb');
  const installDb = path.join(bin, 'mariadb-install-db.exe');
  const mariadbd = path.join(bin, 'mariadbd.exe');
  if (!fs.existsSync(mariadbd)) return { ok: false, error: `找不到 ${mariadbd}` };
  if (!fs.existsSync(path.join(datadir, 'mysql'))) {
    fs.mkdirSync(datadir, { recursive: true });
    pushLog('mysql', '初始化数据目录…');
    const r = await new Promise((resolve) => {
      const c = spawn(installDb, ['--datadir', datadir], { windowsHide: true });
      let out = '';
      c.stdout.on('data', (d) => { out += d; pushLog('mysql', d.toString()); });
      c.stderr.on('data', (d) => { out += d; pushLog('mysql', d.toString()); });
      c.on('close', (code) => resolve({ code, out }));
      c.on('error', (e) => resolve({ code: -1, out: e.message }));
    });
    if (r.code !== 0) return { ok: false, error: '数据目录初始化失败：' + r.out.slice(-600) };
    // 初始化器会在数据目录写 my.ini，里面带绝对路径；运行时用 --no-defaults，不需要它。
    try { fs.rmSync(path.join(datadir, 'my.ini'), { force: true }); } catch (e) { /* 忽略 */ }
  }
  const res = spawnSvc('mysql', mariadbd, [
    '--no-defaults',
    '--datadir', datadir,
    '--port', String(ports.mysql),
    '--bind-address=127.0.0.1',
    '--skip-grant-tables',
    '--skip-name-resolve',
    '--innodb-buffer-pool-size=64M',
    '--console',
  ]);
  if (res.ok) await waitPort(ports.mysql, 20000);
  return res;
}

function cygPath(p) {
  const abs = path.resolve(p);
  return `/cygdrive/${abs[0].toLowerCase()}${abs.slice(2).replace(/\\/g, '/')}`;
}

async function startRedis() {
  const { servicesRoot, ports } = settings();
  const exe = path.join(servicesRoot, 'Redis', 'redis-server.exe');
  if (!fs.existsSync(exe)) return { ok: false, error: `找不到 ${exe}` };
  const dir = path.join(runtimeRoot(), 'redis');
  fs.mkdirSync(dir, { recursive: true });
  // 这个构建是 Cygwin 版，--dir 只认 /cygdrive/... 形式；RedisService 包装器会先退出，
  // 直接托管 redis-server.exe 才能拿到稳定的进程句柄用于停止。
  const res = spawnSvc('redis', exe, ['--port', String(ports.redis), '--dir', cygPath(dir)]);
  if (res.ok) await waitPort(ports.redis, 12000);
  return res;
}

async function startS3() {
  const { servicesRoot, ports } = settings();
  const exe = path.join(servicesRoot, 'RustFS', 'rustfs-windows-x86_64.exe');
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
  if (res.ok) await waitPort(ports.s3, 20000);
  return res;
}

async function stopOne(name) {
  const s = state[name];
  if (!s || !s.child) {
    // 没有子进程句柄时，按端口找进程会误伤，直接返回
    return { ok: true, already: true };
  }
  const pid = s.child.pid;
  await new Promise((resolve) => {
    const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    k.on('close', () => resolve());
    k.on('error', () => resolve());
  });
  s.child = null;
  s.pid = null;
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
  try {
    const out = execFileSync('where.exe', [cmd], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
  } catch (e) {
    return '';
  }
}

function probe(exe, args) {
  if (!exe) return '';
  try {
    // .cmd 不能直接 spawn（Windows 会 EINVAL）；用 cmd /c 按 PATH 里的命令名执行
    const isCmd = /\.(cmd|bat)$/i.test(exe);
    const cmd = isCmd ? 'cmd.exe' : exe;
    const cmdArgs = isCmd ? ['/d', '/c', [path.basename(exe, path.extname(exe)), ...args].join(' ')] : args;
    const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    const text = String((r.stdout || '') + (r.stderr || ''));
    return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
  } catch (e) {
    return '';
  }
}

function runtimes() {
  const node = nodeBin();
  const bun = which('bun.exe') || which('bun.cmd') || which('bun');
  const java = which('java.exe') || which('java');
  const go = which('go.exe') || which('go.cmd') || which('go');
  return [
    // 显示真正用来跑服务的 node.exe 版本，而不是 Electron 内置的 process.version
    { id: 'node', name: 'Node', version: probe(node, ['--version']) || process.version, path: node, available: fs.existsSync(node) || node === 'node', native: true, note: '内置 Node.js，直接运行 server.js' },
    { id: 'bun', name: 'Bun', version: probe(bun, ['--version']), path: bun, available: !!bun, native: true, note: '需要系统已安装 Bun，兼容 Node API' },
    { id: 'java', name: 'Java', version: probe(java, ['-version']), path: java, available: !!java, native: false, note: 'Java 启动器，内核仍为 Node' },
    { id: 'go', name: 'Go', version: probe(go, ['version']), path: go, available: !!go, native: false, note: 'Go 启动器，内核仍为 Node' },
  ];
}

async function startServer(dir, opts) {
  const { ports } = settings();
  if (state.server.child && !state.server.child.killed) return { ok: true, already: true, pid: state.server.pid, hot: state.server.hot, runtime: state.server.runtime };
  const o = opts || {};
  const runtime = o.runtime || 'node';
  const hot = !!o.hot;
  if (!['node', 'bun', 'java', 'go'].includes(runtime)) return { ok: false, error: `暂不支持 ${runtime} 运行时` };
  let exe = nodeBin();
  let args = [hot && fs.existsSync(path.join(dir, 'dev.js')) ? 'dev.js' : 'server.js'];
  if (runtime === 'bun') {
    exe = which('bun.exe') || which('bun.cmd') || which('bun');
    if (!exe) return { ok: false, error: '没有找到 Bun，请先安装 Bun 或切换到 Node' };
  } else if (runtime === 'java') {
    exe = which('java.exe') || which('java');
    if (!exe) return { ok: false, error: '没有找到 Java，请先安装 JDK 11+ 或切换到 Node' };
    if (!fs.existsSync(path.join(dir, 'launcher', 'Server.java'))) return { ok: false, error: '生成目录缺少 launcher/Server.java，请重新生成服务' };
    args = ['launcher/Server.java', hot ? 'dev.js' : 'server.js'];
  } else if (runtime === 'go') {
    exe = which('go.exe') || which('go');
    if (!exe) return { ok: false, error: '没有找到 Go，请先安装 Go 或切换到 Node' };
    if (!fs.existsSync(path.join(dir, 'launcher', 'main.go'))) return { ok: false, error: '生成目录缺少 launcher/main.go，请重新生成服务' };
    args = ['run', 'launcher/main.go', hot ? 'dev.js' : 'server.js'];
  }
  const entry = args[args.length - 1];
  if (!fs.existsSync(path.join(dir, entry))) return { ok: false, error: `生成目录里找不到 ${entry}` };
  const res = spawnSvc('server', exe, args, {
    cwd: dir,
    shell: /\.(cmd|bat)$/i.test(exe),
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
  if (res.ok) await waitPort(ports.http, 20000);
  return { ...res, port: ports.http, hot, runtime, entry };
}

async function stopServer() {
  return stopOne('server');
}

async function startAll() {  const out = { mysql: await startMysql(), redis: await startRedis(), s3: await startS3() };
  return out;
}

async function stopAll() {
  for (const n of ['server', 'mysql', 'redis', 's3']) await stopOne(n);
  return { ok: true };
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
  runtimes, startServer, stopServer,
};
