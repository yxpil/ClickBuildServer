'use strict';
/*
导出裁剪回归：导出为项目时选择一种类型，只写这一套服务端实现。
用法：node tools/test-export-single-runtime.js
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const projectExport = require('../app/iface/project-export');

const ROOT = path.resolve(__dirname, '..');
const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'iface', 'cases', 'signup.json'), 'utf8'));
const base = path.join(os.tmpdir(), 'cbs-single-runtime-' + Date.now());
fs.mkdirSync(base, { recursive: true });

let passed = 0;
let failed = 0;
function t(name, ok, detail) {
  if (ok) { passed += 1; console.log('  ✓ ' + name); }
  else { failed += 1; console.log('  ✗ ' + name + (detail ? ' → ' + JSON.stringify(detail) : '')); }
}
function exists(dir, rel) { return fs.existsSync(path.join(dir, rel)); }

const cases = {
  node: { own: 'server.js', forbidden: ['native/go', 'native/java', 'native/python'] },
  bun: { own: 'server.js', forbidden: ['native/go', 'native/java', 'native/python'] },
  go: { own: 'native/go/service.json', forbidden: ['server.js', 'native/java', 'native/python', 'src/render.js'] },
  java: { own: 'native/java/service.json', forbidden: ['server.js', 'native/go', 'native/python', 'src/render.js'] },
  python: { own: 'native/python/service.json', forbidden: ['server.js', 'native/go', 'native/java', 'src/render.js'] },
};

const dirs = {};
for (const runtime of Object.keys(cases)) {
  const out = path.join(base, runtime);
  fs.mkdirSync(out, { recursive: true });
  const r = projectExport.writeProject(project, out, { port: 19999, runtimeOnly: true, runtime });
  dirs[runtime] = r.dir;
  const dir = r.dir;
  const spec = cases[runtime];
  t(runtime + ' 导出成功且 runtime.json 一致', r.ok && JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8')).runtime === runtime);
  t(runtime + ' 带自己的入口 ' + spec.own, exists(dir, spec.own));
  t(runtime + ' 不带其它运行时', spec.forbidden.every((p) => !exists(dir, p)), spec.forbidden.filter((p) => exists(dir, p)));
  t(runtime + ' 带公共配置与文档', exists(dir, 'config.json') && exists(dir, 'interfaces.json') && exists(dir, 'RUN.md') && exists(dir, 'docs/openapi.json'));
  const readmeText = fs.readFileSync(path.join(dir, 'README-IDEA.md'), 'utf8');
  const label = runtime === 'node' || runtime === 'bun' ? 'Node.js' : { go: 'Go 原生', java: 'Java 原生', python: 'Python Flask' }[runtime];
  t(runtime + ' README-IDEA 写明当前类型', /只包含/.test(readmeText) && readmeText.includes(label));
}

const nodeRun = fs.readFileSync(path.join(dirs.node, 'RUN.md'), 'utf8');
t('Node 导出不再声称带四套运行时', !/带 Node \/ Go \/ Java \/ Python 四套/.test(nodeRun));
const goFiles = fs.readFileSync(path.join(dirs.go, 'RUN.md'), 'utf8');
t('Go 导出 RUN.md 只写 Go', /cd native\/go/.test(goFiles) && !/node server\.js/.test(goFiles));
t('Go 导出不带 Node .run 配置', !exists(dirs.go, '.run/启动接口服务.run.xml'));
t('Node 导出仍带 IDEA 运行配置', exists(dirs.node, '.run/启动接口服务.run.xml'));

const nodeExport = projectExport.writeProject(project, path.join(base, 'count-node'), { port: 19999, runtimeOnly: true, runtime: 'node' });
const allExport = projectExport.writeProject(project, path.join(base, 'count-all'), { port: 19999, runtime: 'node' });
const nodeCount = nodeExport.files.length;
const allCount = allExport.files.length;
t('选 Node 的文件数明显少于全量导出', nodeCount < allCount, { nodeCount, allCount });
t('全量导出兼容旧调用', exists(allExport.dir, 'native/go/service.json') && exists(allExport.dir, 'native/java/service.json') && exists(allExport.dir, 'native/python/service.json'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
