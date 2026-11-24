#!/usr/bin/env node
// 作者：yxpil
'use strict';
// 预设接口套件回归：目录、共享表、整套插入、碰撞避重、函数合并、生成代码里的建表顺序。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-iface-kits-'));
const prevAppData = process.env.APPDATA;
const prevHome = process.env.HOME;
process.env.APPDATA = tmpHome;
process.env.HOME = tmpHome;

const spec = require('../app/iface/spec');
const templates = require('../app/iface/templates');
const lib = require('../app/iface/iface-library');
const codegen = require('../app/iface/codegen');

let checks = 0;
const failures = [];
function ok(cond, name, info) {
  checks++;
  if (cond) console.log(`  ok  ${name}${info ? ' · ' + info : ''}`);
  else { failures.push(name); console.log(`  FAIL ${name}${info ? ' · ' + info : ''}`); }
}

function emptyProject(name) {
  return spec.normalizeProject({
    name: name || '套件验收',
    categories: [{ id: 'biz', name: '业务表格' }],
    interfaces: [],
    functions: [],
  });
}

function routeKeys(project) {
  return project.interfaces.flatMap((x) => (x.routes || []).map((r) => `${r.method} ${x.basePath || ''}${r.path}`));
}

function sqlFiles(project) {
  const out = codegen.generate(project, { runtimeOnly: true });
  return (out.files || []).filter((f) => /^sql\//.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
}

function main() {
  const kits = lib.kits();
  ok(kits.length >= 8, '预设套件至少 8 套', String(kits.length));
  ok(new Set(kits.map((x) => x.id)).size === kits.length, '套件 id 不重复');
  ok(kits.every((x) => x.counts.interfaces > 0 && x.counts.routes > 0), '每套都有接口与路由');
  ok(kits.every((x) => x.readiness.frontend && x.readiness.seed), '每套都带演示数据和业务页面');

  const mall = kits.find((x) => x.id === 'kit:mall');
  ok(mall && mall.counts.interfaces === 4 && mall.counts.routes === 19, '商城套件 4 接口 / 19 路由', `${mall.counts.interfaces}/${mall.counts.routes}`);
  ok(mall.counts.tables === 5 && mall.counts.tableDefs === 6, '商城 6 条表定义归并为 5 张物理表', `${mall.counts.tableDefs} -> ${mall.counts.tables}`);
  ok(mall.shared.length === 1 && mall.shared[0].name === 'shop_product', '商城共享表是 shop_product', mall.shared[0].name);
  ok(mall.readiness.auth && mall.readiness.upload, '商城带登录态与文件上传');

  const social = kits.find((x) => x.id === 'kit:social');
  ok(social && social.counts.interfaces === 9 && social.counts.routes === 86, '社区套件 9 接口 / 86 路由');
  ok(social.counts.tables === 18 && social.counts.tableDefs === 46, '社区 46 条表定义归并为 18 张物理表', `${social.counts.tableDefs} -> ${social.counts.tables}`);

  const p0 = emptyProject();
  const got = lib.insertKit(p0, 'kit:mall');
  ok(got.ok && got.project.interfaces.length === 4, '商城套件整套接入空工程', String(got.project.interfaces.length));
  ok(got.added.join('|') === '用户注册|商品|购物车|订单', '接入接口清单与套件一致', got.added.join('|'));
  const product = got.project.interfaces.find((x) => x.name === '商品');
  const cart = got.project.interfaces.find((x) => x.name === '购物车');
  ok(!!product && !!cart, '商品与购物车都存在');
  ok(cart.tables.find((t) => t.key === 'prod').name === product.tables[0].name, '购物车引用同一张商品表，不生成 _2', cart.tables.find((t) => t.key === 'prod').name);
  ok(got.project.interfaces.every((x) => !x.tables.some((t) => /^shop_product_[0-9]+$/.test(t.name))), '空工程接入不出现 shop_product_2');
  ok(got.renamed.interfaces === 0 && got.renamed.tables === 0, '空工程接入保持原名和原表名');
  ok(got.project.functions.some((x) => x.name === 'REQ_TAG') && got.project.functions.some((x) => x.name === 'MASK_PHONE'), '套件自定义函数一并接入');
  const v0 = spec.validateProject(got.project);
  ok(v0.ok, '空工程接入后的工程校验通过', v0.errors.slice(0, 3).join(' | '));

  const sql = sqlFiles(got.project);
  ok(sql.length === 4, '商城生成 4 个接口 SQL 文件', String(sql.length));
  const productSql = sql.find((f) => /商品/.test(f.content) || f.path.includes('shang-pin'));
  ok(!!productSql && /stock/.test(productSql.content) && /shop_product/.test(productSql.content), '商品建表最先落 stock 字段的完整结构');
  const cartSql = sql.find((f) => /购物车/.test(f.content) || f.path.includes('gou-wu-che'));
  ok(!!cartSql && /shop_product/.test(cartSql.content), '购物车 SQL 复用同一张 shop_product', cartSql ? cartSql.path : '');

  // 已有同名接口 + 同名表：整套加 /mall 前缀并一致改名。
  const base = templates.get('builtin:mall').project;
  const collide = lib.insertKit(base, 'kit:mall');
  ok(collide.ok, '同表同名的工程里再次整套接入');
  ok(collide.renamed.interfaces === 4, '4 个接口同名自动加序号', String(collide.renamed.interfaces));
  const cProduct = collide.project.interfaces.find((x) => x.name === '商品 (2)');
  const cCart = collide.project.interfaces.find((x) => x.name === '购物车 (2)');
  ok(cProduct && cCart, '第二次接入的接口被命名为 商品 (2) / 购物车 (2)');
  ok(cProduct.tables[0].name === 'shop_product_2' && cCart.tables.find((t) => t.key === 'prod').name === 'shop_product_2', '第二次接入仍共享同一张商品表');
  ok(collide.project.interfaces.filter((x) => !x.name.endsWith('(2)')).every((x) => x.basePath === '' || x.basePath === '/mall'), '第二套不污染原有接口路径');
  ok(cProduct.basePath === '/mall' && cCart.basePath === '/mall', '整套补 /mall 前缀，路由路径本身不改成 -2', `${cProduct.basePath}${cProduct.routes[0].path}`);
  ok(cProduct.routes[0].path === '/products', '路由路径保持原样', cProduct.routes[0].path);
  const v1 = spec.validateProject(collide.project);
  ok(v1.ok, '碰撞改名后的工程校验通过', v1.errors.slice(0, 3).join(' | '));
  const keys = routeKeys(collide.project);
  ok(keys.length === new Set(keys).size, '碰撞改名后全工程路由不重复', `${keys.length} 条`);

  // 同名函数实现不同：源套件函数改名，脚本一起改。
  const fnBase = emptyProject('函数冲突');
  fnBase.functions.push({ name: 'REQ_TAG', params: [], body: '"X"' });
  const fnGot = lib.insertKit(fnBase, 'kit:mall');
  ok(fnGot.project.functions.some((x) => x.name === 'REQ_TAG_KIT'), '同名不同实现的自定义函数自动改名', fnGot.project.functions.map((x) => x.name).join(','));
  ok(fnGot.project.functions.some((x) => x.name === 'REQ_TAG' && x.body === '"X"') && fnGot.project.functions.some((x) => x.name === 'MASK_PHONE'), '原工程函数保留，套件其它函数照常接入');
  ok(spec.validateProject(fnGot.project).ok, '函数改名后的工程校验通过');

  // 一套套接入都必须过校验，且生成代码不抛错。
  for (const kit of kits) {
    const r = lib.insertKit(emptyProject(kit.name), kit.id);
    const v = spec.validateProject(r.project);
    ok(v.ok, `套件 ${kit.name} 整套接入校验通过`, r.counts.interfaces + ' 接口');
    const gen = codegen.generate(r.project, { runtimeOnly: true });
    ok(gen.files && gen.files.length > 0, `套件 ${kit.name} 可生成服务代码`, `${gen.files.length} 文件`);
  }

  let missing = null;
  try { lib.kitGet('kit:not-exist'); } catch (e) { missing = e.message; }
  ok(missing && /没有/.test(missing), '不存在的套件返回明确错误', missing || '');

  console.log(`\n结果：${checks - failures.length}/${checks} 通过`);
  if (failures.length) process.exitCode = 1;
}

try { main(); } catch (e) {
  console.error('套件回归中断：', e && e.stack || e);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  if (prevAppData == null) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
  if (prevHome == null) delete process.env.HOME; else process.env.HOME = prevHome;
}
