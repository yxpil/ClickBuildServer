// 作者：yxpil
'use strict';

// 深色模式表格头回归：接口类型表 / 实时数据等共用 help-grid，不能出现白底白字。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dark = fs.readFileSync(path.join(root, 'renderer', 'wbench-dark.css'), 'utf8');
const bench = fs.readFileSync(path.join(root, 'renderer', 'wbench.js'), 'utf8');
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};

check('深色 help-grid 表头有独立深色背景', /html\.cb-dark\s+\.help-grid\s+th\s*\{[^}]*background:\s*#141a21/.test(dark));
check('深色 help-grid 表头文字不是浅底浅字', /html\.cb-dark\s+\.help-grid\s+th\s*\{[^}]*color:\s*#9ba9ba/.test(dark));
check('深色 help-grid 单元格文字可读', /html\.cb-dark\s+\.help-grid\s+td\s*\{[^}]*color:\s*#c3cddc/.test(dark));
check('深色表格容器边框跟随主题', /html\.cb-dark\s+\.help-table-frame\s*\{[^}]*border-color:\s*var\(--cb-line\)/.test(dark));
check('接口类型表不再使用硬编码浅色边框', !bench.includes('style="overflow:auto;border:1px solid #d4d4d4"'));
check('接口类型表两张表都套 help-table-frame', (bench.match(/class="help-table-frame"/g) || []).length >= 2);
check('深色主题颜色选择器不再白底', /html\.cb-dark\s+input\[type="color"\]\s*\{[^}]*background:\s*#10161d/.test(dark));
check('深色主题颜色选择器声明 color-scheme dark', /html\.cb-dark\s+input\[type="color"\]\s*\{[^}]*color-scheme:\s*dark/.test(dark));

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
