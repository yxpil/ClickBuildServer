'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const store = require('../store');

const PORTS = { mysql: 13306, redis: 16379, s3: 19000, s3Console: 19001, http: 18100 };

const state = {
  mysql: { child: null, log: [] },
  redis: { child: null, log: [] },
  s3: { child: null, log: [] },
  server: { child: null, log: [], dir: '' },
};

function settings() {
  const s = store.readSettings();
  return {
    servicesRoot: s.servicesRoot || 'C:\\Users\\Admin\\OneDrive\\Desktop\\ClickBuild',
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
    mariadbd: path.join(servicesRoot, 'MariaDB 13.0', 'bin', 'mariadbd.exe'),
    installDb: path.join(servicesRoot, 'MariaDB 13.0', 'bin', 'mariadb-install-db.exe'),
    redis: path.join(servicesRoot, 'WorkWithRedis', 'RedisService.exe'),
    rustfs: path.join(servicesRoot, 'binaries', 'rustfs-windows-x86_64.exe'),
  };
  return {
    servicesRoot,
    ports,
    binaries: Object.fromEntries(Object.entries(bin).map(([k, v]) => [k, { path: v, exists: fs.existsSync(v) }])),
    items: [
      { id: 'mysql', name: 'MariaDB', port: ports.mysql, running: mysqlOpen, pid: state.mysql.pid || null, note: 'skip-grant-tables 本地测试实例' },
      { id: 'redis', name: 'Redis', port: ports.redis, running: redisOpen, pid: state.redis.pid || null, note: 'Cygwin 构建，RedisService 托管' },
      { id: 's3', name: 'RustFS', port: ports.s3, running: s3Open, pid: state.s3.pid || null, note: `S3 兼容，控制台 ${ports.s3Console}` },
      { id: 'server', name: '生成的服务', port: ports.http, running: httpOpen, pid: state.server.pid || null, dir: state.server.dir },
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
  const bin = path.join(servicesRoot, 'MariaDB 13.0', 'bin');
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
  const exe = path.join(servicesRoot, 'WorkWithRedis', 'redis-server.exe');
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
  const exe = path.join(servicesRoot, 'binaries', 'rustfs-windows-x86_64.exe');
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

async function startServer(dir) {
  const { ports } = settings();
  if (state.server.child && !state.server.child.killed) return { ok: true, already: true, pid: state.server.pid };
  const res = spawnSvc('server', nodeBin(), ['server.js'], {
    cwd: dir,
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
    },
  });
  state.server.dir = dir;
  if (res.ok) await waitPort(ports.http, 20000);
  return { ...res, port: ports.http };
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

function setServicesRoot(dir) {
  store.writeSettings({ servicesRoot: dir });
  return dir;
}

module.exports = {
  PORTS, settings, status, startMysql, startRedis, startS3, startAll, stopOne, stopAll, logs, setPorts, setServicesRoot, isPortOpen, waitPort,
  startServer, stopServer,
};
