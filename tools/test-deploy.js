'use strict';

// 更新部署的生成目录清理验收：不启动 Electron、不连接数据库。
// 用法：node tools\test-deploy.js

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const deploy = require(path.join(root, 'app/iface/deploy'));

let ok = 0;
let bad = 0;
const t = (name, cond, extra) => {
  if (cond) { ok++; console.log('  ✓ ' + name); } else { bad++; console.log('  ✗ ' + name + ' → ' + JSON.stringify(extra)); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clickbuild-deploy-'));
const out = path.join(tmp, 'iface');
fs.mkdirSync(path.join(out, 'src', 'modules', '01_old'), { recursive: true });
fs.mkdirSync(path.join(out, 'src', 'modules', '_custom'), { recursive: true });
fs.mkdirSync(path.join(out, 'sql'), { recursive: true });
fs.mkdirSync(path.join(out, 'public'), { recursive: true });
fs.mkdirSync(path.join(out, 'frontend'), { recursive: true });
fs.writeFileSync(path.join(out, 'src', 'modules', '01_old', 'index.js'), 'old');
fs.writeFileSync(path.join(out, 'src', 'modules', '_custom', 'index.js'), 'custom');
fs.writeFileSync(path.join(out, 'sql', '01_old.sql'), 'old');
fs.writeFileSync(path.join(out, 'sql', 'custom.sql'), 'custom');
fs.writeFileSync(path.join(out, 'public', 'index.html'), 'old frontend');
fs.writeFileSync(path.join(out, 'frontend', 'index.yxpp'), '{}');

deploy.pruneGenerated(out, [
  'src/modules/02_new/index.js',
  'src/modules/index.js',
  'sql/02_new.sql',
  'server.js',
]);

t('删除已移除的接口模块', !fs.existsSync(path.join(out, 'src', 'modules', '01_old')));
t('保留下划线开头的自定义模块', fs.existsSync(path.join(out, 'src', 'modules', '_custom', 'index.js')));
t('删除已移除的编号 SQL', !fs.existsSync(path.join(out, 'sql', '01_old.sql')));
t('保留用户自定义 SQL', fs.existsSync(path.join(out, 'sql', 'custom.sql')));
t('没有前端时删除旧生成首页', !fs.existsSync(path.join(out, 'public', 'index.html')));
t('没有前端工程时删除旧 frontend 目录', !fs.existsSync(path.join(out, 'frontend')));

fs.writeFileSync(path.join(out, 'public', 'index.html'), 'new frontend');
fs.mkdirSync(path.join(out, 'frontend'), { recursive: true });
fs.writeFileSync(path.join(out, 'frontend', 'index.yxpp'), '{}');
deploy.pruneGenerated(out, ['public/index.html', 'frontend/index.yxpp']);
t('有前端时保留生成首页', fs.existsSync(path.join(out, 'public', 'index.html')));
t('有前端时保留 frontend 目录', fs.existsSync(path.join(out, 'frontend', 'index.yxpp')));

t('目标目录优先使用调用方指定目录', deploy.targetDir({ name: 'demo' }, { dir: out }, {}) === out);
t('指定目录尚不存在时也直接采用', deploy.targetDir({ name: 'demo' }, { dir: path.join(tmp, 'new-out') }, {}) === path.join(tmp, 'new-out'));
t('未指定目录时回落到默认生成根', deploy.targetDir({ name: 'demo' }, {}, {}).includes(path.join('generated', 'iface', 'demo')));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n结果：${ok} 通过，${bad} 失败`);
process.exit(bad ? 1 : 0);
