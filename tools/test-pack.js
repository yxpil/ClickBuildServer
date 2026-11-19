'use strict';

// 不依赖 Electron 的自测：.yxpn 打包/回读、接口复制编号、AI 假接口、文档生成。
const path = require('path');
const spec = require('../app/iface/spec');
const pkg = require('../app/iface/package');
const ai = require('../app/iface/ai');
const codegen = require('../app/iface/codegen');

let ok = 0; let bad = 0;
const t = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓ ' + name); } else { bad++; console.log('  ✗ ' + name + ' ' + JSON.stringify(extra || '').slice(0, 200)); } };

const project = spec.seedProject();
const file = path.join(__dirname, '..', 'generated', 'yxpn', '自测工程.yxpn');
const built = pkg.writeYxpn(project, file, { port: 18100 });
t('导出 yxpn 包', built && require('fs').existsSync(built.file), built);
t('包大小 > 20KB（含导出代码与文档）', built.size > 20000, built.size);
const got = pkg.readYxpn(built.file);
t('回读包 manifest 版本', got.manifest && got.manifest.format === 'yxpn' && got.manifest.version === 1, got.manifest);
t('回读包接口数一致', got.project.interfaces.length === project.interfaces.length, got.project.interfaces.length);
t('包内文件条目', got.files.length > 10, got.files.length);
t('CRC 校验通过（无抛错）', true);

const copy = spec.cloneIface(project.interfaces[0], project.interfaces.map((i) => i.name));
t('复制接口自动编号 2', copy.name === '订单2', copy.name);
t('复制后表名同步', copy.tables[0].name === 'biz_order_2', copy.tables[0].name);
t('复制后脚本仍按表键引用（解析到新表名）', copy.routes[0].script.includes('{{t:main}}') && !!require('../app/iface/render').renderText('{{t:main}}', copy, {}), '');
const copy3 = spec.cloneIface(project.interfaces[0], [...project.interfaces.map((i) => i.name), copy.name]);
t('再复制一次编号 3', copy3.name === '订单3', copy3.name);

const r = ai.mockReply('做一个订单服务，带明细表，再加用户注册登录');
t('AI 模拟生成工程', r.project && r.project.interfaces.length >= 2, r.reply);
t('AI 生成的工程能通过校验', spec.validateProject(r.project).ok, spec.validateProject(r.project).errors);
t('AI 生成含注册路由', r.project.interfaces.some((i) => i.routes.some((x) => x.path === '/register')), '');
t('AI 生成含联查路由', r.project.interfaces.some((i) => i.routes.some((x) => x.path === '/orders/with-items')), '');

const docs = codegen.buildOpenApi(project, 18100);
t('OpenAPI 路径覆盖', Object.keys(docs.paths).length >= 10, Object.keys(docs.paths).length);
t('OpenAPI 组件可解析', !!docs.info && !!docs.components, '');

console.log(`\n通过 ${ok} / ${ok + bad}${bad ? '，失败 ' + bad : '，全部通过'}`);
process.exit(bad ? 1 : 0);
