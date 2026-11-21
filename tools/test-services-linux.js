// 作者：yxpil
'use strict';

// Linux 内置服务集成测试：走 app/iface/services.js 的真实启动/停止路径，
// 验证 vendor/services-linux 布局、端口探测、/proc 进程识别和 killTree。
// 用法：node tools/test-services-linux.js（仅 Linux）
const path = require('path');
const platform = require('../app/platform');

if (!platform.isLinux) {
  console.log('跳过：此测试只在 Linux 上运行');
  process.exit(0);
}

const services = require('../app/iface/services');

async function main() {
  console.log('services root:', services.settings().servicesRoot);
  const progress = [];
  const r = await services.startAll((p) => {
    progress.push(`${p.name}: ${p.status} ${p.text}${p.detail ? ' ' + p.detail : ''}`);
    console.log(' -', progress[progress.length - 1]);
  });
  const ok = ['mysql', 'redis', 's3'].every((k) => r[k] && r[k].ok);
  if (!ok) {
    for (const k of ['mysql', 'redis', 's3']) {
      if (!(r[k] && r[k].ok)) {
        console.error(`\n[${k}] 启动失败：${(r[k] && r[k].error) || '未知错误'}`);
        console.error(services.logs(k).split('\n').slice(-20).join('\n'));
      }
    }
    await services.stopAll().catch(() => {});
    process.exit(1);
  }

  const st = await services.status();
  for (const id of ['mysql', 'redis', 's3']) {
    const row = st.items.find((x) => x.id === id);
    console.log(`${id}: running=${row.running} pid=${row.pid} port=${row.port}`);
    if (!row.running) throw new Error(`${id} 未在运行`);
  }

  const stopped = await services.stopAll();
  console.log('stopAll:', JSON.stringify(stopped));
  if (!stopped.ok) throw new Error(stopped.error || '停止失败');

  for (const port of [services.settings().ports.mysql, services.settings().ports.redis, services.settings().ports.s3]) {
    if (await services.isPortOpen(port)) throw new Error(`端口 ${port} 停止后仍被占用`);
  }
  console.log('Linux 服务集成测试通过');
}

main().catch(async (e) => {
  console.error(e.stack || e.message);
  await services.stopAll().catch(() => {});
  process.exit(1);
});
