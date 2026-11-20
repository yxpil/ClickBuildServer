'use strict';

const net = require('net');
const services = require('../app/iface/services');

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function blockerOn(port) {
  const server = net.createServer((s) => s.end());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

(async () => {
  console.log('端口占用自动避让');
  // 同时占住 MySQL、RustFS、RustFS 控制台与生成服务首选端口，验证各自避让、S3 / 控制台不撞端口，
  // 并验证停止生成服务后状态仍按实际端口探测，而不是退回被别的程序占用的首选端口。
  const blockers = await Promise.all([blockerOn(49100), blockerOn(49120), blockerOn(49121), blockerOn(49130)]);

  try {
    t('测试端口确实被占用', await services.isPortOpen(49100));
    const ports = await services.preparePorts({ mysql: 49100, redis: 49110, s3: 49120, s3Console: 49121, http: 49130 });
    t('MariaDB 自动改用 49101', ports.mysql === 49101, `实际 ${ports.mysql}`);
    t('没冲突的 Redis 保持 49110', ports.redis === 49110, `实际 ${ports.redis}`);
    t('RustFS 自动改用 49122', ports.s3 === 49122, `实际 ${ports.s3}`);
    t('RustFS 控制台自动改用 49123', ports.s3Console === 49123, `实际 ${ports.s3Console}`);
    t('RustFS 与控制台不撞同一端口', ports.s3 !== ports.s3Console, `${ports.s3} / ${ports.s3Console}`);
    t('生成服务自动改用 49131', ports.http === 49131, `实际 ${ports.http}`);
    const conflicts = services.settings().conflicts;
    const hit = conflicts.find((c) => c.key === 'mysql');
    t('记录避让来源与目标', !!hit && hit.from === 49100 && hit.to === 49101, JSON.stringify(conflicts));
    t('记录占用进程名', !!hit && /node/i.test(hit.reason || ''), hit && hit.reason);
    t('状态接口带出实际端口', (await services.status()).ports.mysql === 49101);
    await services.stopServer();
    const after = await services.status();
    t('停止后仍按实际端口 49131 探测', after.ports.http === 49131 && !after.items.find((x) => x.id === 'server').running,
      `${after.ports.http} / ${after.items.find((x) => x.id === 'server').running}`);
  } finally {
    await Promise.all(blockers.map((b) => new Promise((r) => b.close(r))));
  }

  console.log(`\n${pass}/${pass + fail} 通过`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
