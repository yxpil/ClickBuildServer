'use strict';
// 资源面板的真实采样回归。必须用 Electron 跑：node tools/test-resources.js 拿不到 app.getAppMetrics。
const assert = require('assert');
const { app } = require('electron');
const resources = require('../app/iface/resources');

app.whenReady().then(() => {
  const items = [{ id: 'self', name: '资源采样测试进程', port: 0, running: true, pid: process.pid }];
  const first = resources.snapshot(items);
  assert(first.cpu.cores > 0, 'CPU 核数应为正数');
  assert(first.memory.total > 0, '系统总内存应为正数');
  assert(first.memory.percent > 0 && first.memory.percent < 100, '内存占用应在 0-100 之间');
  assert(first.app.processes > 0, '应拿到本应用进程数');
  assert(first.app.memBytes > 0, '应拿到本应用内存');
  assert(first.services[0].memBytes > 0, 'tasklist 应能读到测试进程内存');
  assert(Array.isArray(first.analysis.notes) && first.analysis.notes.length > 0, '应给出资源分析结论');
  if (first.disk) {
    assert(first.disk.total > 0 && first.disk.free >= 0, '磁盘总量与可用量应有效');
    assert(first.disk.percent >= 0 && first.disk.percent <= 100, '磁盘占用应在 0-100 之间');
  }
  if (first.net) {
    assert(first.net.rx >= 0 && first.net.tx >= 0, '网络累计字节应有效');
  }

  setTimeout(() => {
    const second = resources.snapshot(items);
    assert(second.cpu.percent != null, '第二次采样应得到 CPU 百分比');
    if (second.net && first.net) {
      assert(second.net.rxRate >= 0 && second.net.txRate >= 0, '网络速率应有效');
    }
    console.log('资源采样回归');
    console.log('  ✓ CPU / 内存 / 磁盘 / 网络字段有效');
    console.log('  ✓ tasklist 读到进程内存');
    console.log('  ✓ 分析结论非空');
    console.log('  ✓ 第二次采样有 CPU 百分比与网络速率');
    console.log('结果：1 通过，0 失败');
    app.quit();
  }, 1200);
}).catch((e) => {
  console.error('FAIL', e.stack || e.message);
  app.exit(1);
});
