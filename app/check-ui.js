'use strict';
// 前端引用一致性检查：app.js 里用到的元素 id 必须在 index.html 里存在
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');

const ids = new Set();
const re = /(?:\$\('#([\w-]+)'\)|val\('([\w-]+)'\)|setVal\('([\w-]+)'|getElementById\('([\w-]+)'\))/g;
let m;
while ((m = re.exec(js))) {
  const id = m[1] || m[2] || m[3] || m[4];
  if (id) ids.add(id);
}

const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
const unused = [...html.matchAll(/id="([\w-]+)"/g)].map((x) => x[1]).filter((id) => !ids.has(id));

console.log(`引用 id ${ids.size} 个，缺失 ${missing.length} 个`);
if (missing.length) console.log('缺失：', missing.join(', '));
if (unused.length) console.log('HTML 中未被 app.js 引用的 id：', unused.join(', '));
process.exit(missing.length ? 1 : 0);
