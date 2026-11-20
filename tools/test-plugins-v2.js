'use strict';

// 插件系统 v2 回归：命令、权限、钩子、模版、脚手架、旧插件兼容。
// 用临时 APPDATA，避免把测试插件写进真实用户插件目录。

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-plugins-'));
process.env.APPDATA = tmp;

const plugins = require('../app/iface/plugins');
const spec = require('../app/iface/spec');

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}${extra ? ' -> ' + extra : ''}`); }
}

function writePlugin(id, manifest, code) {
  const dir = path.join(plugins.userPluginsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id, name: id, version: '1.0.0', main: 'index.js', ...manifest }, null, 2));
  fs.writeFileSync(path.join(dir, 'index.js'), code, 'utf8');
  return dir;
}

(async () => {
  console.log(`tmp=${tmp}`);

  const s0 = plugins.summary();
  ok(s0.apiVersion === '2.0', 'API 版本是 2.0');
  ok(s0.list.some((p) => p.id === 'audit-stamp' && p.enabled && p.loaded), '内置 audit-stamp 已加载');
  ok(s0.commands.some((c) => c.id === 'audit-stamp:add-audit'), '命令完整 ID 带插件前缀');
  ok(plugins.templates().some((t) => t.id === 'plugin:audit-stamp:audit-demo'), '插件模版已注册');

  const legacy = plugins.apply(spec.seedProject());
  ok(legacy.project.functions.some((f) => f.name === 'REQ_TAG'), '旧 apply 插件 trace-tag 仍生效');

  const base = spec.seedProject();
  base.name = '插件回归';
  const before = base.interfaces[0].tables[0].fields.length;
  const cmd = await plugins.runCommand('audit-stamp:add-audit', { project: base, ifaceId: base.interfaces[0].id, tableKey: base.interfaces[0].tables[0].key });
  ok(cmd.ok && cmd.project, '命令返回工程');
  ok(cmd.project.interfaces[0].tables[0].fields.some((f) => f.name === 'updated_by'), '命令真的加了 updated_by 字段');
  ok(cmd.project.interfaces[0].tables[0].fields.length === before + 1, '字段数量 +1');
  const again = await plugins.runCommand('audit-stamp:add-audit', { project: cmd.project, ifaceId: cmd.project.interfaces[0].id, tableKey: cmd.project.interfaces[0].tables[0].key });
  ok(again.ok && /不重复加/.test(again.message || ''), '重复执行不重复加字段');

  const report = await plugins.runCommand('audit-stamp:report', { project: cmd.project });
  ok(report.ok && /插件报告/.test(report.html || ''), '命令可以返回 HTML 面板');

  const hooked = await plugins.fire('generate.before', { project: cmd.project });
  ok(hooked.project.functions.some((f) => f.name === 'PLUGIN_AUDIT'), 'generate.before 钩子改写工程');

  const tpl = plugins.getTemplate('plugin:audit-stamp:audit-demo');
  ok(tpl.ok && tpl.project.interfaces[0].tables[0].fields.some((f) => f.name === 'updated_by'), '插件模版携带审计字段');

  // 权限：只读插件写字段应被拒绝，并留下警告日志。
  writePlugin('deny-write', { permissions: ['project:read', 'ui:commands'], contributes: { commands: [{ id: 'try-write', title: '尝试写' }] } }, `
module.exports = { activate(api) {
  api.commands.register('try-write', (ctx) => {
    const it = ctx.project.interfaces[0];
    const t = it.tables[0];
    const f = api.project.addField(ctx.project, it.id, t.key, { name: 'denied_field', type: 'varchar' });
    return { ok: true, denied: f === null, message: f ? '写了' : '被拒绝', project: ctx.project };
  });
} };`);
  plugins.reload();
  const deny = await plugins.runCommand('deny-write:try-write', { project: spec.seedProject() });
  ok(deny.ok && deny.denied === true, '没有 project:write 时 addField 返回 null');
  ok(!(deny.project || {}).interfaces?.some((i) => i.tables.some((t) => t.fields.some((f) => f.name === 'denied_field'))), '没有权限时字段没有被写入');
  plugins.setEnabled('deny-write', false);

  // 钩子取消保存。
  writePlugin('cancel-save', { permissions: ['project:read'], contributes: { hooks: ['project.beforeSave'] } }, `
module.exports = { activate(api) { api.hooks.on('project.beforeSave', () => false); } };`);
  plugins.reload();
  const canceled = await plugins.fire('project.beforeSave', { project: spec.seedProject() });
  ok(canceled.canceled === true, '钩子返回 false 可取消保存');
  plugins.setEnabled('cancel-save', false);

  // 钩子改写保存内容。
  writePlugin('rewrite-save', { permissions: ['project:read', 'project:write'], contributes: { hooks: ['project.beforeSave'] } }, `
module.exports = { activate(api) { api.hooks.on('project.beforeSave', (ctx) => {
  const it = ctx.project.interfaces[0]; const t = it.tables[0];
  api.project.addField(ctx.project, it.id, t.key, { name: 'saved_by_hook', type: 'varchar' });
  return { project: ctx.project };
}); } };`);
  plugins.reload();
  const rew = await plugins.fire('project.beforeSave', { project: spec.seedProject() });
  ok(rew.project.interfaces[0].tables[0].fields.some((f) => f.name === 'saved_by_hook'), '钩子返回 {project} 能改写保存内容');
  plugins.setEnabled('rewrite-save', false);

  // 脚手架：真实写盘、重新加载可见、可禁用。
  const sc = plugins.scaffold('回归测试插件');
  ok(sc.ok && fs.existsSync(path.join(sc.dir, 'plugin.json')) && fs.existsSync(path.join(sc.dir, 'index.js')), '脚手架生成 plugin.json/index.js');
  const scSummary = plugins.summary().list.find((p) => p.id === sc.id);
  ok(!!scSummary && scSummary.loaded, '脚手架插件可被加载');
  plugins.setEnabled(sc.id, false);
  ok(plugins.summary().list.find((p) => p.id === sc.id).enabled === false, '插件可禁用');
  plugins.setEnabled(sc.id, true);
  ok(plugins.summary().list.find((p) => p.id === sc.id).enabled === true, '插件可重新启用');

  const docs = plugins.docs();
  ok(docs.ok && docs.hooks.length >= 10 && docs.api.length >= 10, '开发者文档有钩子和 API 清单');

  // 安装：从外部目录复制到用户插件目录，启用并加载；卸载后目录消失。
  const ext = path.join(tmp, 'external', 'install-me');
  fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(path.join(ext, 'plugin.json'), JSON.stringify({ id: 'install-me', name: '安装测试', version: '1.0.0', main: 'index.js', permissions: ['project:read'] }, null, 2));
  fs.writeFileSync(path.join(ext, 'index.js'), 'module.exports = { activate(api) { api.log("installed"); } };', 'utf8');
  const ins = plugins.installFromDir(ext);
  ok(ins.ok && fs.existsSync(path.join(ins.dir, 'plugin.json')), 'installFromDir 复制插件目录');
  ok(plugins.summary().list.some((p) => p.id === 'install-me' && p.loaded), '安装后的插件被加载');
  const un = plugins.uninstall('install-me');
  ok(un.ok && !fs.existsSync(path.join(ins.dir, 'plugin.json')), '卸载删除插件目录');
  ok(!plugins.summary().list.some((p) => p.id === 'install-me'), '卸载后列表移除');

  await plugins.shutdown();
  ok(true, 'shutdown 不抛错');

  console.log(`\n${pass} passed, ${fail} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* Windows 文件占用时忽略 */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
