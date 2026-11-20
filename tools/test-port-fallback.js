'use strict';

const net = require('net');
const services = require('../app/iface/services');

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  console.log('端口占用自动避让');
  const blocker = net.createServer((s) => s.end());
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(49100, '127.0.0.1', resolve);
  });

  try {
    t('测试端口确实被占用', await services.isPortOpen(49100));
    const ports = await services.preparePorts({ mysql: 49100, redis: 49110, s3: 49120, s3Console: 49121, http: 49130 });
    t('MariaDB 自动改用 49101', ports.mysql === 49101, `实际 ${ports.mysql}`);
    t('没冲突的 Redis 保持 49110', ports.redis === 49110, `实际 ${ports.redis}`);
    t('没冲突的 RustFS 保持 49120', ports.s3 === 49120, `实际 ${ports.s3}`);
    t('生成服务端口保持 49130', ports.http === 49130, `实际 ${ports.http}`);
    const conflicts = services.settings().conflicts;
    const hit = conflicts.find((c) => c.key === 'mysql');
    t('记录避让来源与目标', !!hit && hit.from === 49100 && hit.to === 49101, JSON.stringify(conflicts));
    t('记录占用进程名', !!hit && /node/i.test(hit.reason || ''), hit && hit.reason);
    t('状态接口带出实际端口', (await services.status()).ports.mysql === 49101);
  } finally {
    await new Promise((r) => blocker.close(r));
  }

  console.log(`\n${pass}/${pass + fail} 通过`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
