'use strict';

// 模版 / 插件 / 文档字段的离线回归：不需要数据库，只校验模型与生成产物。
// 用法：runtime\node\node.exe tools\test-templates.js [--gen]

const fs = require('fs');
const path = require('path');
const os = require('os');
const spec = require('../app/iface/spec');
const templates = require('../app/iface/templates');
const plugins = require('../app/iface/plugins');
const codegen = require('../app/iface/codegen');

const gen = process.argv.includes('--gen');
const outRoot = path.join(os.tmpdir(), 'clickbuild-template-test');
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
}

const list = templates.list();
const builtinCount = list.filter((t) => t.kind === 'builtin').length;
check('模版列表返回 24 个内置', builtinCount === 24, list.map((t) => t.name).join('/'));

for (const t of list.filter((x) => x.kind === 'builtin')) {
  const got = templates.get(t.id);
  const p = spec.normalizeProject(got.project);
  const v = spec.validateProject(p);
  check(`模版「${t.name}」模型校验`, v.ok, v.ok ? `${p.interfaces.length} 接口 / ${t.counts.routes} 路由` : v.errors.slice(0, 3).join(' | '));
  const details = p.interfaces.flatMap((i) => i.routes.filter((r) => r.key === 'detail'));
  const badDetails = details.filter((r) => !String(r.script).includes('RETURN 404'));
  check(`模版「${t.name}」详情缺失返回 404`, badDetails.length === 0, `${details.length} 条详情，${badDetails.length} 条缺 404`);
  const ap = plugins.apply(p);
  check(`模版「${t.name}」插件应用无报错`, ap.warnings.filter((w) => !/已存在/.test(w)).length === 0, ap.warnings.join(' | '));
  check(`模版「${t.name}」注入插件函数`, ap.project.functions.some((f) => f.name === 'REQ_TAG'));
  if (gen) {
    const dir = path.join(outRoot, String(t.name));
    const g = codegen.writeTo(ap.project, dir, { port: 18999 });
    check(`模版「${t.name}」生成产物`, g.files.length > 20 && fs.existsSync(path.join(dir, 'server.js')), `${g.files.length} 文件`);
    const srv = fs.readFileSync(path.join(dir, 'server.js'), 'utf8');
    check(`模版「${t.name}」生成服务带 /help`, srv.includes("pathname === '/help'") && srv.includes('function helpHtml'));
    const openapi = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'openapi.json'), 'utf8'));
    check(`模版「${t.name}」OpenAPI 带接口文档`, !!openapi.info.description);
  }
}

const cross = templates.get('builtin:crossdb').project;
const crossIface = cross.interfaces[0];
check('跨库案例：主表走 main', crossIface.tables.find((t) => t.key === 'main').conn === 'main');
check('跨库案例：明细表走 aux + 独立 schema', crossIface.tables.find((t) => t.key === 'item').conn === 'aux' && crossIface.tables.find((t) => t.key === 'item').schema === 'clickbuild_aux');
check('跨库案例：脚本没有 schema 双点', crossIface.routes.every((r) => !String(r.script || '').includes('{{schema:item}}.{{t:item}}')));
check('跨库案例：三条路由（下单/回滚/联查）', crossIface.routes.length === 3);

// 自定义模版往返
const sample = templates.get('builtin:blog').project;
const saved = templates.saveAs(`回归-${Date.now()}`, sample, { description: '测试' });
const back = templates.get(saved.id);
check('自定义模版保存并读回', back.project.interfaces.length === sample.interfaces.length, saved.id);
check('删除自定义模版', templates.remove(saved.id).ok);
check('内置模版不可删除', (() => { try { templates.remove('builtin:mall'); return false; } catch (e) { return true; } })());

// 插件面板
const pluginList = plugins.list();
check('插件列表含内置示例', pluginList.some((p) => p.id === 'trace-tag' && p.source === 'builtin'), pluginList.map((p) => p.id).join(','));

// 文档字段
const p2 = spec.normalizeProject(sample);
p2.interfaces[0].docs.owner = '张三';
p2.interfaces[0].docs.version = '2.1.0';
p2.interfaces[0].docs.tags = ['用户', '登录'];
p2.interfaces[0].routes[0].docs.requestExample = '{"username":"a"}';
const p3 = spec.normalizeProject(JSON.parse(JSON.stringify(p2)));
check('接口文档字段可往返', p3.interfaces[0].docs.owner === '张三' && p3.interfaces[0].docs.tags.length === 2);
const api = codegen.buildOpenApi(p3, 18999);
check('OpenAPI 带 x-examples', !!(api.paths && Object.values(api.paths)[0]));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
