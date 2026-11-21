'use strict';
// 停止按钮的真实后端回归：本进程启动、重启后的孤儿进程、以及端口被别的程序占用。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const store = require('../app/store');
const services = require('../app/iface/services');

const TEST_PORT = 49258;
const runtimeNode = store.bundledNode();
const markerPath = path.join(store.root(), 'runtime', 'server.json');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitOpen(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 10000);
  while (Date.now() < deadline) {
    if (await services.isPortOpen(port)) return true;
    await sleep(100);
  }
  return false;
}

async function waitClosed(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 10000);
  while (Date.now() < deadline) {
    if (!(await services.isPortOpen(port))) return true;
    await sleep(100);
  }
  return false;
}

function writeMarker(data) {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify(data, null, 2), 'utf8');
}

function spawnServer(exe, dir, port) {
  return spawn(exe, ['server.js'], {
    cwd: dir,
    windowsHide: true,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
}

async function main() {
  const oldPorts = JSON.parse(JSON.stringify(store.readSettings().ports || {}));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clickbuild-stop-'));
  fs.writeFileSync(path.join(dir, 'server.js'), `
const http = require('http');
http.createServer((req, res) => { res.writeHead(200); res.end('ok'); }).listen(Number(process.env.PORT), '127.0.0.1');
`, 'utf8');
  const oldMarker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8') : '';
  services.setPorts({ ...oldPorts, http: TEST_PORT });

  try {
    // 1. 本进程持有 child 的正常路径
    const started = await services.startServer(dir, { runtime: 'node', hot: false });
    assert.strictEqual(started.ok, true, '启动生成服务失败：' + (started.error || ''));
    assert.strictEqual(await waitOpen(TEST_PORT), true, '生成服务没有监听测试端口');
    assert.strictEqual(fs.existsSync(markerPath), true, '启动后没有写入 PID 标记');
    const stopped = await services.stopServer();
    assert.strictEqual(stopped.ok, true, '正常停止失败：' + (stopped.error || ''));
    assert.strictEqual(await waitClosed(TEST_PORT), true, '正常停止后端口仍开着');
    assert.strictEqual(fs.existsSync(markerPath), false, '正常停止后 PID 标记没有清理');
    console.log('  ✓ 本进程启动后停止');

    // 2. 模拟重启后的孤儿：没有 child 句柄，端口上是便携 node 的 server.js，且有 PID 标记
    const orphan = spawnServer(runtimeNode, dir, TEST_PORT);
    assert.strictEqual(await waitOpen(TEST_PORT), true, '孤儿服务没有监听测试端口');
    writeMarker({ pid: orphan.pid, dir, entry: 'server.js', runtime: 'node', hot: false, port: TEST_PORT });
    const stoppedOrphan = await services.stopServer();
    assert.strictEqual(stoppedOrphan.ok, true, '孤儿停止失败：' + (stoppedOrphan.error || ''));
    assert.strictEqual(stoppedOrphan.adopted, true, '孤儿停止没有走认领路径');
    assert.strictEqual(await waitClosed(TEST_PORT), true, '孤儿停止后端口仍开着');
    assert.strictEqual(fs.existsSync(markerPath), false, '孤儿停止后 PID 标记没有清理');
    console.log('  ✓ 重启后按 PID 标记停止孤儿');

    // 3. 重启时端口已有生成服务：preparePorts 应认领 http，而不是把它当冲突避让
    const orphanAdopt = spawnServer(runtimeNode, dir, TEST_PORT);
    assert.strictEqual(await waitOpen(TEST_PORT), true, '待认领服务没有监听测试端口');
    writeMarker({ pid: orphanAdopt.pid, dir, entry: 'server.js', runtime: 'node', hot: false, port: TEST_PORT });
    const ports = await services.preparePorts({ ...oldPorts, http: TEST_PORT });
    assert.strictEqual(Number(ports.http), TEST_PORT, '重启后没有认领生成服务端口');
    const adoptedStatus = (await services.status()).items.find((x) => x.id === 'server');
    assert.strictEqual(adoptedStatus.adopted, true, '状态里没有标记 http 为认领');
    assert.strictEqual(adoptedStatus.pid, orphanAdopt.pid, '状态里的生成服务 PID 不是标记 PID');
    const stoppedAdopt = await services.stopServer();
    assert.strictEqual(stoppedAdopt.ok, true, '认领后停止失败：' + (stoppedAdopt.error || ''));
    assert.strictEqual(await waitClosed(TEST_PORT), true, '认领后停止端口仍开着');
    console.log('  ✓ 重启后认领端口并可直接停止');

    // 4. 模拟没有 PID 标记的孤儿：仍按便携 node + server.js 命令行确认归属
    const orphan2 = spawnServer(runtimeNode, dir, TEST_PORT);
    assert.strictEqual(await waitOpen(TEST_PORT), true, '无标记孤儿没有监听测试端口');
    const stoppedOrphan2 = await services.stopServer();
    assert.strictEqual(stoppedOrphan2.ok, true, '无标记孤儿停止失败：' + (stoppedOrphan2.error || ''));
    assert.strictEqual(await waitClosed(TEST_PORT), true, '无标记孤儿停止后端口仍开着');
    console.log('  ✓ 重启后无标记也能停止孤儿');

    // 5. 热部署树且没有标记：node dev.js → server.js，停止必须连 dev.js 根一起结束
    fs.writeFileSync(path.join(dir, 'dev.js'), `
const { spawn } = require('child_process');
spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
setInterval(() => {}, 1000);
`, 'utf8');
    const hot = spawn(runtimeNode, ['dev.js'], { cwd: dir, windowsHide: true, env: { ...process.env, PORT: String(TEST_PORT) }, stdio: 'ignore' });
    assert.strictEqual(await waitOpen(TEST_PORT), true, '热部署树没有监听测试端口');
    const stoppedHot = await services.stopServer();
    assert.strictEqual(stoppedHot.ok, true, '热部署树停止失败：' + (stoppedHot.error || ''));
    assert.strictEqual(await waitClosed(TEST_PORT), true, '热部署树停止后端口仍开着');
    assert.strictEqual(await services.waitPortClosed(TEST_PORT, 100), true);
    let hotParentAlive = true;
    try { process.kill(hot.pid, 0); } catch (e) { hotParentAlive = false; }
    assert.strictEqual(hotParentAlive, false, 'dev.js 根进程没有被结束，会继续复活服务');
    console.log('  ✓ 无标记热部署树从 dev.js 根进程停止');

    // 6. 端口被别的程序占用时必须失败，不能误杀
    if (path.resolve(process.execPath).toLowerCase() !== path.resolve(runtimeNode).toLowerCase()) {
      const stranger = spawnServer(process.execPath, dir, TEST_PORT);
      assert.strictEqual(await waitOpen(TEST_PORT), true, '外部程序没有监听测试端口');
      const refused = await services.stopServer();
      assert.strictEqual(refused.ok, false, '外部程序占用端口时不应返回成功');
      assert.strictEqual(await services.isPortOpen(TEST_PORT), true, '外部程序被误杀');
      stranger.kill();
      await waitClosed(TEST_PORT);
      console.log('  ✓ 端口被别的程序占用时拒绝并报错');
    } else {
      console.log('  - 测试 Node 与便携 Node 相同，跳过误杀检查');
    }

    console.log('停止生成服务回归通过');
  } finally {
    services.setPorts(oldPorts);
    try { if (oldMarker) fs.writeFileSync(markerPath, oldMarker, 'utf8'); else if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch (e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch((e) => {
  console.error(e && e.stack || e);
  process.exitCode = 1;
});
