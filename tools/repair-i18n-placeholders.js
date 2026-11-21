'use strict';

// 找出语言包里占位符数量/序号不正确的句式，从正式包和进度文件中移除，
// 之后运行 generate-i18n.js --all --incremental 只会补译这些句式。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'app/i18n/locales');
const PROGRESS_DIR = path.join(ROOT, 'tools/.i18n-progress');

function placeholderCount(src) {
  const s = String(src);
  let n = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
      }
      if (j < s.length) { n++; i = j + 1; continue; }
    }
    if (s[i] === '{' && s[i + 1] === '{') {
      const end = s.indexOf('}}', i + 2);
      if (end > 0) { n++; i = end + 2; continue; }
    }
    i++;
  }
  return n;
}

function badPattern(p) {
  const n = placeholderCount(p.src);
  const used = [...String(p.dst || '').matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  return used.length !== n || used.some((x) => x < 1 || x > n);
}

let total = 0;
for (const file of fs.readdirSync(PACK_DIR).filter((x) => x.endsWith('.json'))) {
  const full = path.join(PACK_DIR, file);
  const pack = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(pack.patterns)) continue;
  const removed = pack.patterns.filter(badPattern);
  if (!removed.length) continue;
  pack.patterns = pack.patterns.filter((p) => !badPattern(p));
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, full);
  total += removed.length;
  console.log(`${file}: 移除 ${removed.length} 条待重译句式`);
  for (const p of removed) console.log(`  - ${p.src}`);

  const locale = file.replace(/\.json$/, '');
  const progressFile = path.join(PROGRESS_DIR, `${locale}.json`);
  if (fs.existsSync(progressFile)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      for (const p of removed) delete progress.patterns[p.src];
      fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2) + '\n', 'utf8');
    } catch (e) { /* ignore */ }
  }
}
console.log(`共 ${total} 条句式需要重新生成`);
