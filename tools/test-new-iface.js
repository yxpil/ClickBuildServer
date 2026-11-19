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
ok('第二个中文接口不会撞表名', () => {
  const b = spec.newIface('问候接口', 'biz');
  assert.notStrictEqual(b.tables[0].name, it.tables[0].name);
});

console.log(`通过 ${pass} / ${pass}`);
