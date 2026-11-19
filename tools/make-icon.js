'use strict';
// 用 Node 生成 ICO（避免 PowerShell 文本管道把二进制写成 UTF-8 替换字符）
const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const root = path.join(__dirname, '..');
const src = process.argv[2] || path.join(root, 'assets', 'logo.png');
const out = process.argv[3] || path.join(root, 'build', 'icon.ico');

pngToIco(src).then((buf) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  const b = fs.readFileSync(out);
  console.log(JSON.stringify({ out, bytes: b.length, head: b.subarray(0, 8).toString('hex') }));
}).catch((err) => {
  console.error(err && err.message || err);
  process.exit(1);
});
