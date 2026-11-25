// 作者：yxpil
// 1.1.90 真实服务回归：自定义 Redis / S3 连接、键浏览、命令台、桶与对象。
'use strict';
const net = require('net');
const path = require('path');

const root = path.join(__dirname, '..');
const infra = require(path.join(root, 'app/iface/infra-admin'));
const Minio = require(path.join(root, 'node_modules/minio'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
function reachable(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (v) => { try { s.destroy(); } catch (e) { /* ignore */ } resolve(v); };
    s.setTimeout(1200, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}
function project(extra) {
  return {
    name: '1.1.90 真实连接验收',
    connections: {
      mysql: [{ key: 'main', label: '本机 MariaDB', host: '127.0.0.1', port: 13306, user: 'root', password: '', database: 'clickbuild' }],
      redis: [{ key: 'main', label: '本机 Redis', host: '127.0.0.1', port: 16379, password: '', db: 0, tls: false }],
      s3: [{ key: 'main', label: '本机 RustFS', endpoint: '127.0.0.1', port: 19000, useSSL: false, region: '', accessKey: 'clickbuild', secretKey: 'clickbuild123', bucket: 'clickbuild' }],
    },
    ...(extra || {}),
  };
}

(async () => {
  console.log('== MariaDB ==');
  if (await reachable(13306)) {
    const r = await infra.test(project(), { kind: 'mysql', connKey: 'main' });
    ok('MariaDB 连接测试', r.ok === true, r);
  } else {
    console.log('  - 跳过：127.0.0.1:13306 没启动');
  }

  console.log('== 自定义 Redis ==');
  if (!(await reachable(16379))) {
    console.log('  - 跳过：127.0.0.1:16379 没启动');
  } else {
    const p = project();
    const t = await infra.test(p, { kind: 'redis', connKey: 'main' });
    ok('Redis 连接测试', t.ok === true && !!t.version, t);
    const o = await infra.redisOverview(p, { connKey: 'main', db: 0 });
    ok('Redis INFO 与 DBSIZE', o.ok === true && Number(o.dbSize) >= 0, o);

    const key = `cbs:infra:test:${Date.now()}`;
    const set = await infra.redisCommand(p, { connKey: 'main', db: 0, command: `SET ${key} hello-1.1.90` });
    ok('Redis 命令台写 SET', set.ok === true && set.value === 'OK', set);
    const scan = await infra.redisScan(p, { connKey: 'main', db: 0, pattern: key });
    ok('Redis SCAN 命中新键', scan.ok === true && scan.keys.some((k) => k.key === key && k.type === 'string'), scan);
    const info = await infra.redisKey(p, { connKey: 'main', db: 0, key });
    ok('Redis 读取键值与 TTL', info.ok === true && info.type === 'string' && info.value === 'hello-1.1.90', info);
    const del = await infra.redisDelete(p, { connKey: 'main', db: 0, key });
    ok('Redis 删除键', del.ok === true && del.deleted === 1, del);

    const block = await infra.redisCommand(p, { connKey: 'main', db: 0, command: 'FLUSHALL' });
    ok('Redis 拦截 FLUSHALL', block.ok === false && block.code === 'BLOCKED', block);

    const ro = project({ connections: { ...project().connections, redis: [{ ...project().connections.redis[0], readonly: true }] } });
    const roSet = await infra.redisCommand(ro, { connKey: 'main', db: 0, command: `SET ${key} blocked` });
    ok('Redis 只读连接拒绝写入', roSet.ok === false && roSet.code === 'ER_READONLY', roSet);
  }

  console.log('== 自定义对象存储 ==');
  if (!(await reachable(19000))) {
    console.log('  - 跳过：127.0.0.1:19000 没启动');
  } else {
    const p = project();
    const t = await infra.test(p, { kind: 's3', connKey: 'main' });
    ok('S3 连接测试与 ListBuckets', t.ok === true && Number(t.buckets) >= 1, t);
    const b = await infra.s3Buckets(p, { connKey: 'main' });
    ok('S3 桶列表', b.ok === true && b.buckets.some((x) => x.name === 'clickbuild'), b);

    const client = new Minio.Client({ endPoint: '127.0.0.1', port: 19000, useSSL: false, accessKey: 'clickbuild', secretKey: 'clickbuild123' });
    const key = `cbs-infra-test/${Date.now()}.txt`;
    const body = Buffer.from('clickbuild 1.1.90 object test');
    await client.putObject('clickbuild', key, body, body.length);
    ok('真实上传一个测试对象', true);

    const list = await infra.s3Objects(p, { connKey: 'main', bucket: 'clickbuild', prefix: 'cbs-infra-test/', limit: 50 });
    ok('S3 前缀浏览对象', list.ok === true && list.objects.some((x) => x.key === key && x.size === body.length), list);
    const st = await infra.s3Stat(p, { connKey: 'main', bucket: 'clickbuild', key });
    ok('S3 读取对象元信息', st.ok === true && st.size === body.length, st);
    const url = await infra.s3Url(p, { connKey: 'main', bucket: 'clickbuild', key });
    ok('S3 生成预签名下载链接', url.ok === true && /^https?:/.test(url.url || ''), url);
    const del = await infra.s3Delete(p, { connKey: 'main', bucket: 'clickbuild', key });
    ok('S3 删除对象', del.ok === true, del);
    const after = await infra.s3Objects(p, { connKey: 'main', bucket: 'clickbuild', prefix: 'cbs-infra-test/', limit: 50 });
    ok('S3 删除后列表不再出现', after.ok === true && !after.objects.some((x) => x.key === key), after);

    const ro = project({ connections: { ...project().connections, s3: [{ ...project().connections.s3[0], readonly: true }] } });
    const roDel = await infra.s3Delete(ro, { connKey: 'main', bucket: 'clickbuild', key: 'cbs-infra-test/not-exist.txt' });
    ok('S3 只读连接拒绝删除', roDel.ok === false && roDel.code === 'ER_READONLY', roDel);
  }

  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? '，失败 ' + fail : '，全部通过'}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
