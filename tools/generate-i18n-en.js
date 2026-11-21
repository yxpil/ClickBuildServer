// 作者：yxpil
'use strict';

// 兼容旧命令：英文包生成已并入 tools/generate-i18n.js 的多语言生成器。
// 用法：node tools\generate-i18n-en.js [--model ...] [--dry] [--incremental]
const { spawnSync } = require('child_process');
const path = require('path');

const args = [path.join(__dirname, 'generate-i18n.js'), '--locale', 'en-US', ...process.argv.slice(2)];
const run = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(run.status == null ? 1 : run.status);
