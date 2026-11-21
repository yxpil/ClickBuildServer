// 作者：yxpil
'use strict';

// 校正所有语言包里“源句式以变量开头、译文却把变量放到后面”的句式顺序。
// 只调整 $1 的位置，不改动任何译文用词；可重复运行。

const fs = require('fs');
const path = require('path');

const PACK_DIR = path.join(__dirname, '..', 'app/i18n/locales');

function normalize(src, dst) {
  if (!/^\s*\$\{[^{}]+\}/.test(src)) return dst;
  if (!/\$1/.test(dst) || dst.trim().startsWith('$1')) return dst;
  const rest = dst.replace('$1', '').replace(/\s{2,}/g, ' ').trim();
  return rest ? `$1 ${rest}` : '$1';
}

let changed = 0;
for (const file of fs.readdirSync(PACK_DIR).filter((x) => x.endsWith('.json'))) {
  const full = path.join(PACK_DIR, file);
  const pack = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(pack.patterns)) continue;
  let dirty = false;
  for (const item of pack.patterns) {
    if (!item || typeof item.src !== 'string' || typeof item.dst !== 'string') continue;
    const next = normalize(item.src, item.dst);
    if (next !== item.dst) {
      item.dst = next;
      dirty = true;
      changed += 1;
    }
  }
  if (dirty) {
    const tmp = `${full}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(pack, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, full);
    console.log(`修正 ${file}`);
  }
}
console.log(`共修正 ${changed} 条句式`);
