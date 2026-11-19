'use strict';

// 把本机可用的 MariaDB / Redis / RustFS 收进 vendor/services，供打包内置。
// 用法：node tools/vendor-services.js [源目录]
// 源目录默认取仓库旁边的 ClickBuild，也可以用 CBS_SERVICES_SRC 指定。
// 只复制运行必需的文件，不写入任何绝对路径；产物清单只记录相对路径与校验和。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'vendor', 'services');
const SRC = path.resolve(process.argv[2] || process.env.CBS_SERVICES_SRC || path.join(ROOT, '..', 'ClickBuild'));

const MARIA_BIN = ['mariadbd.exe', 'mysqld.exe', 'mariadb-install-db.exe', 'mariadb.exe', 'mysql.exe'];
const REDIS_BIN = ['redis-server.exe', 'redis-cli.exe', 'redis.conf'];

const manifest = [];

function fail(msg) {
  console.error('× ' + msg);
  process.exit(1);
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const rel = path.relative(DEST, to).split(path.sep).join('/');
  const buf = fs.readFileSync(to);
  manifest.push({ path: rel, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
  console.log(`  + ${rel}  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}

function copyDir(from, to, filter) {
  if (!fs.existsSync(from)) fail('缺少目录：' + from);
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(from, src).split(path.sep).join('/');
      return filter ? filter(rel) : true;
    },
  });
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const rel = path.relative(DEST, full).split(path.sep).join('/');
        const buf = fs.readFileSync(full);
        manifest.push({ path: rel, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
      }
    }
  };
  walk(to);
}

function main() {
  if (!fs.existsSync(SRC)) fail('找不到源目录：' + SRC);

  const maria = path.join(SRC, 'MariaDB 13.0');
  const redis = path.join(SRC, 'WorkWithRedis');
  const rustfs = path.join(SRC, 'binaries', 'rustfs-windows-x86_64.exe');

  if (!fs.existsSync(path.join(maria, 'bin', 'mariadbd.exe'))) fail('MariaDB 缺少 bin/mariadbd.exe');
  if (!fs.existsSync(path.join(redis, 'redis-server.exe'))) fail('Redis 缺少 redis-server.exe');
  if (!fs.existsSync(rustfs)) fail('RustFS 缺少 binaries/rustfs-windows-x86_64.exe');

  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });

  console.log('MariaDB');
  for (const name of MARIA_BIN) copyFile(path.join(maria, 'bin', name), path.join(DEST, 'MariaDB', 'bin', name));
  for (const name of fs.readdirSync(path.join(maria, 'bin'))) {
    if (name.toLowerCase().endsWith('.dll')) {
      copyFile(path.join(maria, 'bin', name), path.join(DEST, 'MariaDB', 'bin', name));
    }
  }
  copyDir(path.join(maria, 'lib'), path.join(DEST, 'MariaDB', 'lib'));
  copyDir(path.join(maria, 'share'), path.join(DEST, 'MariaDB', 'share'));
  for (const name of ['COPYING', 'CREDITS', 'THIRDPARTY']) {
    const src = path.join(maria, name);
    if (fs.existsSync(src)) copyFile(src, path.join(DEST, 'MariaDB', name));
  }

  console.log('Redis');
  for (const name of REDIS_BIN) copyFile(path.join(redis, name), path.join(DEST, 'Redis', name));
  for (const name of fs.readdirSync(redis)) {
    if (name.toLowerCase().endsWith('.dll')) copyFile(path.join(redis, name), path.join(DEST, 'Redis', name));
  }
  for (const name of ['README.md', 'README.zh_CN.md']) {
    const src = path.join(redis, name);
    if (fs.existsSync(src)) copyFile(src, path.join(DEST, 'Redis', name));
  }

  console.log('RustFS');
  copyFile(rustfs, path.join(DEST, 'RustFS', 'rustfs-windows-x86_64.exe'));

  const total = manifest.reduce((n, f) => n + f.size, 0);
  fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify({
    generator: 'ClickBuildServer vendor-services',
    files: manifest.sort((a, b) => a.path.localeCompare(b.path)),
    totalSize: total,
  }, null, 2), 'utf8');

  console.log(`\n完成：${DEST}`);
  console.log(`文件 ${manifest.length} 个，总计 ${(total / 1024 / 1024).toFixed(1)} MB`);
}

main();
