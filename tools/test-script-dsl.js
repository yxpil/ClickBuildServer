// 作者：yxpil
// 接口脚本 DSL 第二轮回归：表达式判断、错误捕获、固定次数循环、断言、嵌套赋值与 SQL 隔离。
// 用法：node tools/test-script-dsl.js
'use strict';
const assert = require('assert');
const script = require('../app/iface/script');
const codegen = require('../app/iface/codegen');

let ok = 0;
const t = async (name, fn) => {
  await fn();
  ok += 1;
  console.log('ok  ' + name);
};
const j = (...lines) => lines.join('\n');

async function run(src) {
  return script.runScript(src, {
    ctx: { body: {}, query: {}, params: {}, vars: {} },
    iface: null,
    vars: {},
    idents: {},
    customFuncs: {},
  });
}

function expectParseError(src, pattern) {
  const r = script.checkScript(src);
  assert.strictEqual(r.ok, false, `应该报错：${src}`);
  assert.ok(r.problems.length > 0, `应该报错：${src}`);
  assert.ok(r.problems.some((x) => pattern.test(x)), `错误信息不匹配：${r.problems.join('；')}`);
}

const helpers = `
const toList = (v) => (Array.isArray(v) ? v : (v && v.rows) || []);
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v && v !== 0 && v !== '');
const BTW = (v, lo, hi) => Number(v) >= Number(lo) && Number(v) <= Number(hi);
const LK = (text, pattern) => {
  const t = String(text == null ? '' : text).toLowerCase();
  const p = String(pattern == null ? '' : pattern).toLowerCase();
  const memo = new Map();
  const match = (i, j) => {
    const key = i + ':' + j;
    if (memo.has(key)) return memo.get(key);
    let hit;
    if (j >= p.length) hit = i >= t.length;
    else if (p[j] === '%') hit = match(i, j + 1) || (i < t.length && match(i + 1, j));
    else if (p[j] === '_') hit = i < t.length && match(i + 1, j + 1);
    else hit = i < t.length && t[i] === p[j] && match(i + 1, j + 1);
    memo.set(key, hit);
    return hit;
  };
  return match(0, 0);
};
const L = () => {};
const Q = async () => ({ rows: [] });
const X = async () => ({ affectedRows: 0 });
const H = async () => ({ status: 200, ok: true, body: {} });
const CR = async () => ({ ok: true });
const T = async () => ({ token: 't' });
const TD = async () => true;
const TX = async () => null;
const P = async () => null;
const F = () => null;
const V = () => null;
`;

(async () => {
  await t('表达式：三元与空值合并', async () => {
    const r = await run(j(
      'LET $n = 7',
      "LET $size = $n > 5 ? 'big' : 'small'",
      'LET $missing = $n.none ?? 42',
      'LET $zero = 0 ?? 9',
    ));
    assert.deepStrictEqual(r.vars.size, 'big');
    assert.strictEqual(r.vars.missing, 42);
    assert.strictEqual(r.vars.zero, 0);
  });

  await t('表达式：AND / OR / NOT 关键字和比较优先级', async () => {
    const r = await run(j(
      'LET $a = 0',
      'LET $notCmp = NOT $a > 3',
      'LET $logic = 1 AND NOT 0',
      'LET $or = 0 OR 2',
      'LET $not = NOT 0',
      'LET $paren = NOT (0 > 3)',
    ));
    assert.strictEqual(r.vars.notCmp, true);
    assert.strictEqual(r.vars.logic, true);
    assert.strictEqual(r.vars.or, true);
    assert.strictEqual(r.vars.not, true);
    assert.strictEqual(r.vars.paren, true);
  });

  await t('表达式：IN / NOT IN / LIKE / BETWEEN / IS NULL', async () => {
    const r = await run(j(
      'LET $list = [1, 2, 3]',
      'LET $inArray = 2 IN [1, 2, 3]',
      'LET $inList = 3 IN $list',
      'LET $notIn = 4 NOT IN $list',
      "LET $like = '张三' LIKE '张%'",
      "LET $likeOne = 'abc' LIKE 'a_c'",
      "LET $notLike = '张三' NOT LIKE '李%'",
      'LET $between = 5 BETWEEN 1 AND 10',
      'LET $notBetween = 12 NOT BETWEEN 1 AND 10',
      'LET $null = null',
      'LET $isNull = $null IS NULL',
      'LET $notNull = 0 IS NOT NULL',
    ));
    assert.strictEqual(r.vars.inArray, true);
    assert.strictEqual(r.vars.inList, true);
    assert.strictEqual(r.vars.notIn, true);
    assert.strictEqual(r.vars.like, true);
    assert.strictEqual(r.vars.likeOne, true);
    assert.strictEqual(r.vars.notLike, true);
    assert.strictEqual(r.vars.between, true);
    assert.strictEqual(r.vars.notBetween, true);
    assert.strictEqual(r.vars.isNull, true);
    assert.strictEqual(r.vars.notNull, true);
  });

  await t('表达式：BETWEEN 的 AND 不和逻辑 AND 抢', async () => {
    const r = await run(j(
      'LET $a = 5 BETWEEN 1 AND 10 AND 2 < 3',
      'LET $b = 5 BETWEEN 1 AND 10 && 2 < 3',
      'LET $c = 5 BETWEEN 1 AND 10 OR 0',
    ));
    assert.strictEqual(r.vars.a, true);
    assert.strictEqual(r.vars.b, true);
    assert.strictEqual(r.vars.c, true);
  });

  await t('嵌套赋值、自增、数组前插与追加', async () => {
    const r = await run(j(
      "LET $user = { \"name\": 'A', \"score\": 1, \"tags\": ['x'] }",
      "$user.name = 'B'",
      'SET $user.score += 2',
      'INC $user.score BY 3',
      'DEC $user.score',
      "$user.tags[0] = 'first'",
      "APPEND $user.tags, 'y'",
      "PREPEND $user.tags, 'z'",
      'LET $list = [1, 2]',
      'INC $list[1] BY 5',
    ));
    assert.deepStrictEqual(r.vars.user, { name: 'B', score: 5, tags: ['z', 'first', 'y'] });
    assert.deepStrictEqual(r.vars.list, [1, 7]);
  });

  await t('嵌套路径父级不存在时给出明确错误', async () => {
    await assert.rejects(
      () => run(j('LET $user = {}', "$user.profile.name = 'A'")),
      /路径 .* 不存在/,
    );
  });

  await t('REPEAT 固定次数与索引', async () => {
    const r = await run(j(
      'LET $sum = 0',
      'REPEAT 5 TIMES AS $i',
      '  $sum += $i',
      'END',
      'LET $last = $i',
    ));
    assert.strictEqual(r.vars.sum, 15);
    assert.strictEqual(r.vars.last, 5);
  });

  await t('REPEAT 无索引、BREAK、CONTINUE 与数量夹取', async () => {
    const r = await run(j(
      'LET $count = 0',
      'REPEAT 5 TIMES',
      '  INC $count',
      '  IF $count == 3',
      '    BREAK',
      '  END',
      'END',
      'LET $skip = 0',
      'REPEAT 4 TIMES AS $n',
      '  IF $n == 2',
      '    CONTINUE',
      '  END',
      '  INC $skip',
      'END',
      'LET $clamped = 0',
      'REPEAT 1005 TIMES',
      '  INC $clamped',
      'END',
      'LET $negative = 0',
      'REPEAT -3 TIMES',
      '  INC $negative',
      'END',
    ));
    assert.strictEqual(r.vars.count, 3);
    assert.strictEqual(r.vars.skip, 3);
    assert.strictEqual(r.vars.clamped, 1000);
    assert.strictEqual(r.vars.negative, 0);
  });

  await t('TRY / CATCH：捕获错误并绑定 $err', async () => {
    const r = await run(j(
      'LET $fin = 0',
      'TRY',
      "  THROW 'boom'",
      'CATCH $err',
      '  LOG ERROR $err.message',
      'FINALLY',
      '  INC $fin',
      'END',
      'LET $after = 1',
    ));
    assert.strictEqual(r.logs.length, 1);
    assert.strictEqual(r.logs[0].level, 'ERROR');
    assert.strictEqual(r.logs[0].message, 'boom');
    assert.strictEqual(r.vars.fin, 1);
    assert.strictEqual(r.vars.after, 1);
  });

  await t('TRY / CATCH 省略变量时默认 $err', async () => {
    const r = await run(j(
      'TRY',
      "  THROW 'default-name'",
      'CATCH',
      '  LOG INFO $err.message',
      'END',
    ));
    assert.strictEqual(r.logs[0].message, 'default-name');
  });

  await t('TRY / FINALLY：无 CATCH 时 finally 仍执行并继续抛错', async () => {
    let caught = null;
    const src = j(
      'LET $fin = 0',
      'TRY',
      "  THROW 'keep-throw'",
      'FINALLY',
      '  INC $fin',
      'END',
    );
    try {
      await run(src);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
    assert.strictEqual(caught.message, 'keep-throw');
  });

  await t('TRY 内 RETURN 会先执行 FINALLY', async () => {
    const r = await run(j(
      'LET $fin = 0',
      'TRY',
      '  RETURN 200 { "ok": true }',
      'FINALLY',
      '  LOG INFO \'finally-ran\'',
      'END',
    ));
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, { ok: true });
    assert.strictEqual(r.logs[0].message, 'finally-ran');
  });

  await t('TRY 缺 CATCH / FINALLY 直接报错', () => {
    expectParseError(j('TRY', "  THROW 'x'", 'END'), /至少要有 CATCH 或 FINALLY/);
  });

  await t('ASSERT 通过与失败信息', async () => {
    await run(j('ASSERT 1 == 1, \'never\''));

    let caught = null;
    try {
      await run(j("ASSERT 1 == 2, '金额必须大于 0'"));
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
    assert.strictEqual(caught.message, '金额必须大于 0');
  });

  await t('ASSERT 可被 TRY 捕获', async () => {
    const r = await run(j(
      'LET $message = \'\'',
      'TRY',
      "  ASSERT 0 == 1, 'assert-caught'",
      'CATCH $err',
      '  $message = $err.message',
      'END',
    ));
    assert.strictEqual(r.vars.message, 'assert-caught');
  });

  await t('SQL 隔离：裸 SQL 仍被拦截', () => {
    for (const src of [
      'SELECT 1;',
      'UPDATE t SET a = 1;',
      'CALL proc();',
      'SET x = 1;',
      'INSERT INTO t (a) VALUES (1);',
    ]) expectParseError(src, /SQL 语句不能裸写/);

    const parsed = script.parseScript(j('QUERY SELECT 1;', 'EXEC UPDATE t SET a = 1;', 'LET $x = 1;', 'SET $x += 1')
      .replace('SET $x += 1', 'RUN noop();'));
    assert.strictEqual(parsed.errors.length, 0);
    assert.strictEqual(parsed.ast.filter((x) => x.k === 'sql').length, 2);
  });

  await t('Lint：CATCH / REPEAT AS 变量不报未声明，嵌套赋值为已声明变量', () => {
    const r = script.checkScript(j(
      'LET $user = {}',
      "$user.name = 'A'",
      'LET $sum = 0',
      'REPEAT 3 TIMES AS $i',
      '  $sum += $i',
      'END',
      'TRY',
      '  ASSERT $sum > 0, \'ok\'',
      'CATCH $err',
      '  LOG ERROR $err.message',
      'END',
    ));
    const warnings = r.diagnostics.filter((d) => d.code === 'UNDECLARED_VARIABLE');
    assert.deepStrictEqual(warnings, []);
  });

  await t('导出 JS：新语法全部有输出并能编译', () => {
    const src = j(
      "LET $user = { \"name\": 'A', \"score\": 1, \"tags\": ['x'] }",
      'INC $user.score BY 2',
      "PREPEND $user.tags, 'z'",
      "LET $label = $user.score BETWEEN 1 AND 10 ? 'ok' : 'bad'",
      "LET $like = $user.name LIKE 'A%'",
      'LET $sum = 0',
      'REPEAT 3 TIMES AS $i',
      '  $sum += $i',
      'END',
      'TRY',
      '  ASSERT $sum > 0, \'sum\'',
      'CATCH $err',
      '  LOG ERROR $err.message',
      'FINALLY',
      '  LOG DEBUG \'finally\'',
      'END',
    );
    const parsed = script.parseScript(src);
    assert.strictEqual(parsed.errors.length, 0);
    const js = script.scriptToJs(parsed.ast);
    assert.match(js, /try \{/);
    assert.match(js, /catch \(\$err\)/);
    assert.match(js, /finally/);
    assert.match(js, /BTW\(/);
    assert.match(js, /LK\(/);
    assert.match(js, /PREPEND|\[\"z\"\]\.concat/);
    const fn = new Function('ctx', `${helpers}\nreturn (async () => {\n${js}\nreturn { user: $user, label: $label, like: $like, sum: $sum };\n})();`);
    return fn({}).then((out) => {
      assert.deepStrictEqual(out.user, { name: 'A', score: 3, tags: ['z', 'x'] });
      assert.strictEqual(out.label, 'ok');
      assert.strictEqual(out.like, true);
      assert.strictEqual(out.sum, 6);
    });
  });

  await t('导出 JS：codegen.exportJs 包含 LK / truthy / BTW helper 且可编译', () => {
    const iface = {
      id: 'i1', name: 'DSL', basePath: '', tables: [],
      storage: {}, page: {},
      routes: [],
    };
    const route = { id: 'r1', name: '测试', method: 'GET', path: '/dsl', script: j(
      "LET $v = '张三' LIKE '张%'",
      'LET $n = 5 BETWEEN 1 AND 9 ? 1 : 0',
      'TRY',
      "  ASSERT $v, 'x'",
      'FINALLY',
      '  LOG INFO \'done\'',
      'END',
    ), cache: {}, output: {} };
    const js = codegen.exportJs(iface, route);
    assert.match(js, /const LK = /);
    assert.match(js, /const truthy = /);
    assert.match(js, /const BTW = /);
    assert.doesNotThrow(() => new Function('require', 'module', js));
  });

  await t('表达式非法写法给出明确错误', () => {
    const bad = script.parseScript('LET $x = 1 +');
    assert.ok(bad.errors.length > 0);
  });

  console.log(`\n${ok} passed`);
})().catch((e) => {
  console.error('\nFAILED', e && e.message);
  console.error(e && e.stack);
  process.exit(1);
});



