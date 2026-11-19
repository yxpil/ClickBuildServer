'use strict';
// 普通用户新建接口回归：中文名、自动建表、默认 main 表键、路由路径合法。
const assert = require('assert');
const spec = require('../app/iface/spec');

let pass = 0;
function ok(msg, fn) {
  fn();
  pass++;
  console.log('  ✓ ' + msg);
}

const project = spec.seedProject();
const it = spec.newIface('问候接口', 'biz');
project.interfaces.push(it);
const normalized = spec.normalizeProject(project);
const errors = spec.validateProject(normalized).errors;

ok('中文接口名保留为显示名', () => assert.strictEqual(it.name, '问候接口'));
ok('表名自动转为 ASCII 标识符', () => assert.match(it.tables[0].name, /^[A-Za-z_][A-Za-z0-9_]{0,63}$/));
ok('首张表键固定为 main', () => assert.strictEqual(it.tables[0].key, 'main'));
ok('默认路由路径合法', () => assert.ok(it.routes.every((r) => /^[A-Za-z0-9_/:.-]*$/.test(r.path))));
ok('整工程校验无错误', () => assert.deepStrictEqual(errors, []));
ok('DDL 可生成且包含安全表名', () => {
  const ddl = spec.ddlOf(it);
  assert.ok(ddl.includes(it.tables[0].name));
});
ok('默认详情路由对不存在记录返回 404', () => {
  const detail = it.routes.find((r) => r.key === 'detail');
  assert.ok(detail.script.includes('RETURN 404'));
});
for (const kind of ['update', 'delete']) {
  ok(`默认${kind}路由对不存在记录返回 404`, () => {
    const r = it.routes.find((x) => x.key === kind);
    assert.ok(r && r.script.includes('RETURN 404'), kind);
  });
}
ok('第二个中文接口不会撞表名', () => {
  const b = spec.newIface('问候接口', 'biz');
  assert.notStrictEqual(b.tables[0].name, it.tables[0].name);
});

const guided = spec.newIface('商品', 'biz', {
  tableName: 'guide_product',
  tableComment: '引导创建商品表',
  basePath: 'v1/catalog',
  comment: '创建引导测试',
  fields: [
    { name: 'title', type: 'varchar', comment: '标题' },
    { name: 'price', type: 'decimal', comment: '价格' },
    { name: 'status', type: 'tinyint', comment: '状态' },
  ],
  routeKinds: ['list', 'detail', 'create', 'delete'],
  authMode: 'write',
});
ok('引导配置使用指定主表名与注释', () => {
  assert.strictEqual(guided.tables[0].name, 'guide_product');
  assert.strictEqual(guided.tables[0].comment, '引导创建商品表');
});
ok('引导配置补齐路径前缀与说明', () => {
  assert.strictEqual(guided.basePath, '/v1/catalog');
  assert.strictEqual(guided.comment, '创建引导测试');
  assert.strictEqual(guided.docs.summary, '创建引导测试');
});
ok('引导配置保留 id/时间戳并加入业务字段', () => {
  const names = guided.tables[0].fields.map((f) => f.name);
  assert.deepStrictEqual(names, ['id', 'created_at', 'updated_at', 'title', 'price', 'status']);
});
ok('引导配置只生成选中的四条路由', () => {
  assert.deepStrictEqual(guided.routes.map((r) => r.key), ['list', 'detail', 'create', 'delete']);
});
ok('引导配置按写操作开启鉴权', () => {
  assert.deepStrictEqual(guided.routes.map((r) => r.auth), [false, false, true, true]);
  const byKey = Object.fromEntries(guided.routes.map((r) => [r.key, r.auth]));
  assert.strictEqual(byKey.list, false);
  assert.strictEqual(byKey.detail, false);
  assert.strictEqual(byKey.create, true);
  assert.strictEqual(byKey.delete, true);
});
ok('引导创建工程校验无错误', () => {
  const p = spec.seedProject();
  p.interfaces.push(guided);
  assert.deepStrictEqual(spec.validateProject(spec.normalizeProject(p)).errors, []);
});

console.log(`通过 ${pass} / ${pass}`);
