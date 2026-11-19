'use strict';

// 打包前确认 vendor/services 完整；缺少就明确提示，避免打出没有数据库/缓存/对象存储的安装包。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'vendor', 'services');
const required = [
  'MariaDB/bin/mariadbd.exe',
  'MariaDB/bin/mariadb-install-db.exe',
  'Redis/redis-server.exe',
  'RustFS/rustfs-windows-x86_64.exe',
];

const missing = required.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  console.error('打包缺少内置服务：' + missing.join('、'));
  console.error('先运行 npm run vendor:services，或把服务包解压到 vendor/services。');
  process.exit(1);
}

const manifest = path.join(root, 'manifest.json');
if (fs.existsSync(manifest)) {
  const size = JSON.parse(fs.readFileSync(manifest, 'utf8')).totalSize || 0;
  console.log(`内置服务 ${(size / 1024 / 1024).toFixed(1)} MB：${root}`);
} else {
  console.log('内置服务目录：' + root);
}
