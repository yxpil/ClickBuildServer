// 作者：yxpil
'use strict';

// 连接级 SSH 本地端口转发：给 MySQL / Redis 这类 TCP 服务用。
// 每次真实操作开一条短隧道，操作结束立即关闭，不把 SSH 凭据或隧道状态留在磁盘。
const fs = require('fs');
const net = require('net');
const { Client } = require('ssh2');

function sshOptions(conn) {
  const c = conn || {};
  if (!c.sshEnabled) return null;
  const host = String(c.sshHost || '').trim();
  if (!host) throw new Error('SSH 已启用，但没有填 SSH 主机');
  const opts = {
    host,
    port: Number(c.sshPort || 22),
    username: String(c.sshUser || '').trim(),
    readyTimeout: Math.max(3000, Math.min(15000, Number(c.sshTimeout || 8000))),
    keepaliveInterval: 1000,
    keepaliveCountMax: 3,
  };
  if (!opts.username) throw new Error('SSH 已启用，但没有填 SSH 用户名');
  if (c.sshKeyPath) {
    const file = String(c.sshKeyPath);
    if (!fs.existsSync(file)) throw new Error(`找不到 SSH 私钥文件：${file}`);
    try { opts.privateKey = fs.readFileSync(file); } catch (e) { throw new Error(`读取 SSH 私钥失败：${e.message}`); }
  } else if (c.sshKey) {
    opts.privateKey = String(c.sshKey);
  }
  if (c.sshPassphrase) opts.passphrase = String(c.sshPassphrase);
  if (c.sshPassword) opts.password = String(c.sshPassword);
  if (!opts.privateKey && !opts.password) throw new Error('SSH 已启用，但没有填密码或私钥');
  return opts;
}

function waitListen(server) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => { server.off('listening', onOk); reject(e); };
    const onOk = () => { server.off('error', onErr); resolve(); };
    server.once('listening', onOk);
    server.once('error', onErr);
    server.listen(0, '127.0.0.1');
  });
}

function connectClient(opts) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
      if (err) { try { client.end(); } catch (_) { /* noop */ } reject(err); } else resolve(client);
    };
    const onReady = () => done(null);
    const onError = (e) => done(e);
    client.once('ready', onReady);
    client.once('error', onError);
    try { client.connect(opts); } catch (e) { done(e); }
  });
}

async function openTunnel(conn, targetHost, targetPort) {
  const opts = sshOptions(conn);
  if (!opts) return null;
  const destinationHost = String(targetHost || '127.0.0.1');
  const destinationPort = Number(targetPort || 0);
  if (!destinationPort) throw new Error('SSH 隧道缺少目标端口');
  let client;
  try {
    client = await connectClient(opts);
  } catch (e) {
    throw new Error(`SSH 连接 ${opts.host}:${opts.port} 失败：${e.message}`);
  }
  const sockets = new Set();
  const server = net.createServer((local) => {
    sockets.add(local);
    local.on('close', () => sockets.delete(local));
    local.on('error', () => { try { local.destroy(); } catch (_) { /* noop */ } });
    client.forwardOut('127.0.0.1', local.remotePort || 0, destinationHost, destinationPort, (err, stream) => {
      if (err) {
        try { local.destroy(); } catch (_) { /* noop */ }
        return;
      }
      stream.on('close', () => { try { local.destroy(); } catch (_) { /* noop */ } });
      stream.on('error', () => { try { local.destroy(); } catch (_) { /* noop */ } });
      local.pipe(stream).pipe(local);
    });
  });
  try {
    await waitListen(server);
  } catch (e) {
    try { client.end(); } catch (_) { /* noop */ }
    throw new Error(`SSH 本地转发端口创建失败：${e.message}`);
  }
  const port = server.address().port;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const s of sockets) { try { s.destroy(); } catch (_) { /* noop */ } }
    sockets.clear();
    try { server.close(); } catch (_) { /* noop */ }
    try { client.end(); } catch (_) { /* noop */ }
  };
  return { host: '127.0.0.1', port, targetHost: destinationHost, targetPort: destinationPort, close };
}

function sshSummary(conn) {
  const c = conn || {};
  if (!c.sshEnabled) return null;
  return {
    enabled: true,
    host: c.sshHost || '',
    port: Number(c.sshPort || 22),
    user: c.sshUser || '',
    hasPassword: !!c.sshPassword,
    hasKey: !!(c.sshKeyPath || c.sshKey),
  };
}

module.exports = { openTunnel, sshOptions, sshSummary };
