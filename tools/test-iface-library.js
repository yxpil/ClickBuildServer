#!/usr/bin/env node
'use strict';
// 接口库回归：内置条目、单接口保存、同名拒绝、插入去重、删除清理。
const assert = require('node:assert/strict');
const crypto = require('crypto');
const spec = require('../app/iface/spec');
const templates = require('../app/iface/templates');
const lib = require('../app/iface/iface-library');

const stamp = Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
let checks = 0;
const failures = [];
function ok(cond, name, info) { checks++; if (cond) console.log(`  ok  ${name}${info ? ' · ' + info : ''}`); else { failures.push(name); console.log(`  FAIL ${name}${info ? ' · ' + info : ''}`); } }

function main() {
  const list = lib.list();
  ok(list.filter((x) => x.kind === 'builtin').length >= 63, '内置接口条目 >= 63', String(list.filter((x) => x.kind === 'builtin').length));
  const social = list.filter((x) => x.kind === 'builtin' && x.sourceId === 'builtin:social');
  ok(social.length === 9, '社交接口库贡献 9 个内置接口', String(social.length));
  ok(social.some((x) => x.name === '账户身份' && x.counts.routes === 10), '内置账户身份 10 条路由');

  const src = lib.get(social.find((x) => x.name === '账户身份').id);
  const name = `验收接口-${stamp}`;
  const saved = lib.save({ name, iface: src.iface, sourceProject: '社交接口库', description: '接口库验收', tags: ['验收'] });
  ok(saved.ok && saved.id.startsWith('user:'), '保存单个接口成功', saved.id);
  ok(lib.list().some((x) => x.id === saved.id && x.kind === 'user' && x.name === name), '接口库列表包含自存接口');

  let dup = null;
  try { lib.save({ name: `  ${name}  `, iface: src.iface }); } catch (e) { dup = e.message; }
  ok(dup && /同名/.test(dup), '同名接口被拒绝', dup || '');

  let builtinDup = null;
  try { lib.save({ name: '账户身份', iface: src.iface }); } catch (e) { builtinDup = e.message; }
  ok(builtinDup && /同名/.test(builtinDup), '与内置接口同名也被拒绝', builtinDup || '');

  const base = templates.get('builtin:social').project;
  const before = { ifaces: base.interfaces.length, routes: base.interfaces.reduce((n, i) => n + i.routes.length, 0) };
  const oldTables = new Set(base.interfaces.flatMap((i) => i.tables.map((t) => t.name)));
  const oldPaths = new Set(base.interfaces.map((i) => i.basePath).filter(Boolean));
  const ins = lib.insert(base, saved.id);
  const added = ins.project.interfaces[ins.project.interfaces.findIndex((x) => x.id === ins.ifaceId)];
  ok(ins.ok && ins.project.interfaces.length === before.ifaces + 1, '插入后接口数 +1');
  ok(ins.project.interfaces.reduce((n, i) => n + i.routes.length, 0) === before.routes + added.routes.length, '路由数按新接口增加');
  ok(added.name === name, '不撞名时保持原接口名', added.name);
  ok(added.basePath === '/social_2', 'basePath 自动避重', added.basePath);
  ok(added.tables.every((t) => !oldTables.has(t.name)), '表名自动避重', added.tables.map((t) => t.name).join(','));
  ok(!oldPaths.has(added.basePath), '新 basePath 不与工程已有前缀重复');
  const v = spec.validateProject(spec.normalizeProject(ins.project));
  ok(v.ok, '插入后的工程模型校验通过', `${v.errors.length} errors / ${v.warnings.length} warnings`);

  // 工程里已有同名接口时，插入自动加序号。
  const collide = JSON.parse(JSON.stringify(base));
  collide.interfaces[0].name = name;
  const ins2 = lib.insert(collide, saved.id);
  const added2 = ins2.project.interfaces.find((x) => x.id === ins2.ifaceId);
  ok(added2.name === `${name} (2)`, '同名接口插入时自动加序号', added2.name);

  lib.remove(saved.id);
  ok(!lib.list().some((x) => x.id === saved.id), '删除自存接口后列表不再出现');
  let gone = null;
  try { lib.get(saved.id); } catch (e) { gone = e.message; }
  ok(gone && /没有/.test(gone), '删除后 get 失败');

  // 自定义工程模版同样不允许重名。
  const tplName = `验收模版-${stamp}`;
  const p = templates.get('builtin:blog').project;
  const t = templates.saveAs(tplName, p, { description: 'dup-test' });
  let tplDup = null;
  try { templates.saveAs(tplName, p); } catch (e) { tplDup = e.message; }
  ok(tplDup && /已存在/.test(tplDup), '自定义模版同名被拒绝', tplDup || '');
  let builtinTpl = null;
  try { templates.saveAs('同频社区', p); } catch (e) { builtinTpl = e.message; }
  ok(builtinTpl && /已存在/.test(builtinTpl), '与内置模版同名也被拒绝', builtinTpl || '');
  templates.remove(t.id);

  console.log(`\n结果：${checks - failures.length}/${checks} 通过`);
  if (failures.length) process.exitCode = 1;
}

try { main(); } catch (e) {
  console.error('接口库回归中断：', e && e.stack || e);
  process.exitCode = 1;
}
