// 作者：yxpil
'use strict';

// 打包前确认内置服务与运行时完整；缺少就明确提示，避免打出没有数据库/缓存/对象存储的安装包。
const fs = require('fs');
const path = require('path');
const platform = require('../app/platform');

const appRoot = path.resolve(__dirname, '..');
const isWindows = platform.isWindows;
const root = path.join(appRoot, 'vendor', isWindows ? 'services' : 'services-linux');
const layout = platform.serviceLayout(root);
const node = platform.bundledNode(appRoot);

const expected = [
  ['MariaDB', layout.mariadbd],
  ['MariaDB 初始化器', layout.installDb],
  ['Redis', layout.redis],
  ['RustFS', layout.rustfs],
  ['内置 Node', node],
];

const missing = expected.filter(([, file]) => !file || !fs.existsSync(file));
if (missing.length) {
  console.error(`打包缺少内置组件（${platform.platform}）：${missing.map(([name]) => name).join('、')}`);
  console.error(isWindows
    ? '先运行 npm run vendor:services，或把服务包解压到 vendor/services。'
    : '先运行 bash tools/vendor-services-linux.sh，或把 Linux 服务包解压到 vendor/services-linux。');
  for (const [name, file] of missing) console.error(` - ${name}: ${file || '(未找到)'}`);
  process.exit(1);
}

const manifest = path.join(root, 'manifest.json');
if (fs.existsSync(manifest)) {
  const size = JSON.parse(fs.readFileSync(manifest, 'utf8')).totalSize || 0;
  console.log(`内置服务 ${(size / 1024 / 1024).toFixed(1)} MB：${root}`);
} else {
  console.log(`内置服务目录：${root}`);
}
console.log(`内置 Node：${node}`);
