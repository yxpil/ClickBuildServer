// 作者：yxpil
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const spec = require(path.join(root, 'app', 'iface', 'spec'));
const testgen = require(path.join(root, 'app', 'iface', 'testgen'));

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass += 1; console.log(`ok ${name}`); } else { fail += 1; console.error(`not ok ${name}${extra ? ' · ' + extra : ''}`); }
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-testgen-'));
const iface = spec.newIface('自动测试订单', 'biz', {
  tableName: 'cbs_testgen_orders',
  fields: [
    { name: 'name', type: 'varchar', comment: '名称' },
    { name: 'price', type: 'decimal', comment: '价格' },
  ],
});
const project = spec.normalizeProject({
  name: '自动测试回归',
  categories: [{ id: 'biz', name: '业务表格' }],
  interfaces: [iface],
});
const authIface = spec.cloneIface(project.interfaces[0]);
authIface.routes.forEach((r) => { r.auth = true; });
const authProject = spec.normalizeProject({
  name: '自动测试鉴权回归',
  categories: [{ id: 'biz', name: '业务表格' }],
  interfaces: [authIface],
});

const built = testgen.build(project, { port: 18299 });
ok(built.plan.counts.interfaces === 1, '一个接口');
ok(built.plan.counts.routes === 5, '默认五条路由');
ok(built.plan.counts.cases === 5, '五个用例');
ok(built.plan.counts.runnable === 4, '四条只读用例可执行');
ok(built.plan.counts.writeCases === 1, '一条写入生命周期用例');
ok(built.plan.counts.skipped === 0, '没有跳过');
ok(built.test.includes('CBS_WRITE_TESTS'), '测试说明写入开关');
ok(built.test.includes('makeBody(\'upd\')'), '更新请求使用合法请求体');
ok(built.test.includes('不存在的记录应返回 404'), '详情/更新/删除生成 404 用例');

const authBuilt = testgen.build(authProject, { port: 18299 });
ok(authBuilt.test.includes('未带 token 应返回 401'), '鉴权路由生成 401 用例');
ok(authBuilt.plan.counts.cases === 6, '鉴权工程生成五条 401 用例和写入生命周期');
ok(authBuilt.test.includes('设置 CBS_TOKEN'), '写入生命周期提示 CBS_TOKEN');

const written = testgen.writeTests(project, out, { port: 18299 });
ok(written.files.includes('tests/api.test.js'), '写出 tests/api.test.js');
ok(written.files.includes('tests/plan.json'), '写出 tests/plan.json');
ok(written.files.includes('tests/README.md'), '写出 tests/README.md');
const plan = JSON.parse(fs.readFileSync(path.join(out, 'tests', 'plan.json'), 'utf8'));
ok(plan.safety && plan.safety.writeLifecycle === 'CBS_WRITE_TESTS=1', '计划里写明写入开关');
const check = spawnSync(process.execPath, ['--check', path.join(out, 'tests', 'api.test.js')], { encoding: 'utf8' });
ok(check.status === 0, '生成测试通过 node --check', check.stderr || check.stdout);

const skipped = testgen.planFor(spec.seedProject(), { port: 18299 });
ok(skipped.counts.skipped > 0, '种子工程保留跳过项');
ok(skipped.plan.skipped.every((s) => s.reason), '每个跳过项都有原因');

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
