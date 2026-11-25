// 作者：yxpil
// 1.1.90 静态接线：三类自定义连接、Redis 键浏览 / 命令台、S3 桶 / 对象浏览。
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const infra = require(path.join(root, 'app/iface/infra-admin'));
const spec = require(path.join(root, 'app/iface/spec'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const methods = ['test', 'redisOverview', 'redisScan', 'redisKey', 'redisCommand', 'redisDelete', 's3Buckets', 's3Objects', 's3Stat', 's3Url', 's3Delete', 's3CreateBucket'];
ok('infra-admin 导出三类连接方法', methods.every((m) => typeof infra[m] === 'function'), methods.filter((m) => typeof infra[m] !== 'function'));
const adv = ['redisSaveKey', 'redisExpire', 'redisRename', 's3Put', 's3Get', 's3CreateFolder', 's3DeleteBucket'];
ok('infra-admin 导出 Redis / S3 真实写操作', adv.every((m) => typeof infra[m] === 'function'), adv.filter((m) => typeof infra[m] !== 'function'));
ok('三类连接类型', infra.KINDS.join(',') === 'mysql,redis,s3', infra.KINDS);
ok('命令拆分支持引号', JSON.stringify(infra.splitCommand('SET "a b" c')) === JSON.stringify(['SET', 'a b', 'c']));

const custom = spec.normalizeProject({
  name: '外部连接验收',
  connections: {
    mysql: [{ key: 'cloud', label: '云 MySQL', host: 'db.example.com', port: 3307, user: 'app', password: 'secret', database: 'biz', readonly: true }],
    redis: [{ key: 'cache', label: '云 Redis', host: 'redis.example.com', port: 6380, password: 'rp', db: 3, tls: true }],
    s3: [{ key: 'assets', label: '云 S3', endpoint: 's3.example.com', port: 443, useSSL: true, region: 'us-east-1', accessKey: 'AK', secretKey: 'SK', bucket: 'my-assets' }],
  },
  dbProject: {
    kind: 'redis', conn: 'cache', database: '', redisDb: 3, bucket: 'my-assets', table: '',
    lastByKind: {
      mysql: { conn: 'cloud', database: 'biz', table: '' },
      redis: { conn: 'cache', redisDb: 3 },
      s3: { conn: 'assets', bucket: 'my-assets' },
    },
  },
});
ok('自定义 MySQL 地址保留', custom.connections.mysql[0].host === 'db.example.com' && custom.connections.mysql[0].port === 3307, custom.connections.mysql[0]);
ok('自定义 Redis 密码与库号保留', custom.connections.redis[0].password === 'rp' && custom.connections.redis[0].db === 3 && custom.connections.redis[0].tls === true, custom.connections.redis[0]);
ok('自定义 S3 SSL / Region / AK 保留', custom.connections.s3[0].useSSL === true && custom.connections.s3[0].region === 'us-east-1' && custom.connections.s3[0].accessKey === 'AK', custom.connections.s3[0]);
ok('dbProject 保存 kind 与桶', custom.dbProject.kind === 'redis' && custom.dbProject.bucket === 'my-assets', custom.dbProject);
ok('三类连接分别记忆', custom.dbProject.lastByKind.mysql.conn === 'cloud' && custom.dbProject.lastByKind.redis.redisDb === 3 && custom.dbProject.lastByKind.s3.bucket === 'my-assets', custom.dbProject.lastByKind);
const safe = infra.connectionsOf(custom, 'redis');
ok('连接列表不泄露 Redis 密码', !('password' in safe[0]) && safe[0].hasPassword === true, safe[0]);
ok('连接列表不泄露 S3 SecretKey', !('secretKey' in infra.connectionsOf(custom, 's3')[0]), infra.connectionsOf(custom, 's3')[0]);
ok('默认 S3 为明文 HTTP', infra.connectionsOf(spec.starterProject('database'), 's3')[0].useSSL === false);
const dbStarter = spec.starterProject('database');
ok('数据库工程默认 kind=mysql', dbStarter.dbProject.kind === 'mysql', dbStarter.dbProject);

const ipc = read('app/iface/ipc.js');
ok('IPC 注册三类连接', ['iface:infra:connections', 'iface:infra:test', 'iface:redis:scan', 'iface:redis:command', 'iface:s3:buckets', 'iface:s3:objects', 'iface:s3:delete'].every((k) => ipc.includes(k)));
ok('IPC 注册 Redis / S3 写操作', ['iface:redis:save', 'iface:redis:expire', 'iface:redis:rename', 'iface:s3:put', 'iface:s3:get', 'iface:s3:create-folder', 'iface:s3:delete-bucket'].every((k) => ipc.includes(k)));
const preload = read('preload.js');
ok('preload 暴露三类连接', ['infraConnections', 'infraTest', 'redisScan', 'redisCommand', 's3Buckets', 's3Objects', 's3Delete'].every((k) => preload.includes(k)));
ok('preload 暴露 Redis / S3 写操作', ['redisSave', 'redisExpire', 'redisRename', 's3Put', 's3Get', 's3CreateFolder', 's3DeleteBucket'].every((k) => preload.includes(k)));

const wb = read('renderer/wbench.js');
ok('工作台有三类切换与渲染', ['function dbKindBar', 'function renderRedis', 'function renderS3'].every((s) => wb.includes(s)));
ok('连接表单有类型选择', ['dcKind', 'dcRedisPass', 'dcRedisDb', 'dcTls', 'dcAk', 'dcSk', 'dcRegion', 'dcSsl'].every((s) => wb.includes(s)));
ok('Redis 键浏览与命令台', ['data-redis-key', 'data-redis-del', 'data-redis-run', 'redisConsoleBody'].every((s) => wb.includes(s)));
ok('Redis 键可新建编辑与改 TTL', ['function showRedisKeyEditor', 'function showRedisTtl', 'function showRedisRename', 'data-redis-new', 'data-redis-edit', 'data-redis-ttl', 'data-redis-rename'].every((s) => wb.includes(s)));
ok('S3 桶与对象浏览', ['data-s3-object', 'data-s3-url', 'data-s3-del', 'data-s3-create-bucket', 's3BucketsBody'].every((s) => wb.includes(s)));
ok('S3 上传下载目录与删桶', ['function s3UploadFile', 'function s3DownloadObject', 'function s3CreateFolder', 'function s3DeleteBucket', 'data-s3-upload', 'data-s3-download', 'data-s3-folder', 'data-s3-del-bucket'].every((s) => wb.includes(s)));
ok('连接设置提示可填外部服务', wb.includes('云数据库') && wb.includes('AWS S3 / MinIO / RustFS'));
ok('MySQL / Redis 连接支持 SSH', ['dcSsh', 'dcSshHost', 'dcSshPort', 'dcSshUser', 'dcSshPass', 'dcSshKeyPath', 'dcSshPassphrase', 'dc-ssh-fields'].every((s) => wb.includes(s)));
ok('写开关按当前类型保存', wb.includes('S.project.connections = all') && wb.includes('S.project.dbProject.kind = now'));
ok('切换类型记忆各自连接', wb.includes('function rememberDbState') && wb.includes('p.lastByKind[kind]') && wb.includes('rememberDbState(S.db.kind)'));
ok('连接弹窗不再被 640 外框裁切', wb.includes("{ width: 800, maxHeight: '88vh' }") && wb.includes("{ width: 880, maxHeight: '88vh' }"));

const css = read('renderer/wbench-db.css');
ok('多类型工作台样式', ['.db-kind-bar', '.db-stats', '.db-detail', '.db-redis-value'].every((s) => css.includes(s)));

console.log(`\n通过 ${pass} / ${pass + fail}${fail ? '，失败 ' + fail : '，全部通过'}`);
process.exit(fail ? 1 : 0);
