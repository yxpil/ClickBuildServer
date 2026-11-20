// 脚本检查器回归：注释、跨行 SQL、行号定位、占位符与变量分析。
const { checkScript } = require('../app/iface/script');

let failed = 0;
function expect(name, script, checks) {
  const r = checkScript(script);
  const missing = [];
  for (const [key, value] of Object.entries(checks)) {
    const actual = key === 'errors' ? r.errorCount
      : key === 'warnings' ? r.warningCount
      : key === 'firstLine' ? (r.diagnostics[0] && r.diagnostics[0].line)
      : key === 'firstColumn' ? (r.diagnostics[0] && r.diagnostics[0].column)
      : key === 'firstEnd' ? (r.diagnostics[0] && r.diagnostics[0].endColumn)
      : key === 'firstCode' ? (r.diagnostics[0] && r.diagnostics[0].code)
      : r[key];
    if (actual !== value) missing.push(`${key}=${JSON.stringify(actual)}，期望 ${JSON.stringify(value)}`);
  }
  if (missing.length) {
    failed++;
    console.log(`FAIL ${name}: ${missing.join('；')}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function expectCode(name, script, code, checks) {
  const r = checkScript(script);
  const d = r.diagnostics.find((x) => x.code === code);
  const missing = [];
  if (!d) missing.push(`没有 ${code}`);
  else for (const [key, value] of Object.entries(checks)) {
    if (d[key] !== value) missing.push(`${code}.${key}=${JSON.stringify(d[key])}，期望 ${JSON.stringify(value)}`);
  }
  if (missing.length) {
    failed++;
    console.log(`FAIL ${name}: ${missing.join('；')}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

expect('合法脚本与跨行 SQL', `# 登录\nLET $u = QUERY SELECT id FROM {{t:main}}\n  WHERE username = {{body.username}}\n  LIMIT 1;\nIF LEN($u.rows) == 0\n  RETURN 401 { "ok": false };\nEND\nRETURN 200 { "id": $u.rows[0].id };`, { errors: 0, warnings: 0, ok: true });

expect('字符串里的 // 与 # 不误判', `# 注释\nLET $u = QUERY SELECT id FROM t WHERE url = 'http://a//b#c';\nRETURN 200 { "u": $u.rows[0] };`, { errors: 0, warnings: 0 });

expect('跨行块注释', `/* 第一行\n 第二行 */\nLET $x = QUERY SELECT 1 FROM t;\nRETURN 200 {};`, { errors: 0, warnings: 1 });

expect('LET 缺表达式定位到第 2 行', `# c\nLET $x = ;\nRETURN 200 {};`, { errors: 1, firstLine: 2, firstCode: 'SYNTAX' });

expect('IF 缺 END 报 IF 起始行', `IF LEN($x.rows) > 0\n  LOG INFO 'x';\n`, { errors: 1, firstLine: 1, firstCode: 'MISSING_END' });

expect('对象占位符', `RETURN 200 { "u": {{user}} };`, { errors: 1, firstLine: 1, firstCode: 'OBJECT_PLACEHOLDER' });

expect('未知占位符', `RETURN 200 { "x": {{nope.x}} };`, { errors: 1, firstCode: 'UNKNOWN_PLACEHOLDER' });

expect('未声明变量是警告', `RETURN 200 { "x": $nope };`, { errors: 0, warnings: 1, ok: true });

expect('声明未使用是警告', `LET $x = 1;\nRETURN 200 {};`, { errors: 0, warnings: 1, ok: true });

expect('跨行 JSON', `RETURN 200 {\n  "ok": true,\n  "name": "x"\n};`, { errors: 0, warnings: 0, ok: true });

expect('未闭合括号定位到具体列', `LET $x = (1 + 2;\nRETURN 200 $x;`, { errors: 1, firstLine: 1, firstColumn: 10, firstEnd: 11, firstCode: 'UNCLOSED_BRACKET' });

expectCode('括号不匹配', `RETURN 200 [1, 2);`, 'BRACKET_MISMATCH', { line: 1, column: 17, message: '括号不匹配：) 没有对应的 (' });

expectCode('未闭合占位符', `LET $x = QUERY SELECT * FROM t WHERE id = {{body.id};\nRETURN 200 {};`, 'UNCLOSED_PLACEHOLDER', { line: 1, column: 43 });

expectCode('未闭合字符串', `LET $x = "abc;\nRETURN 200 {};`, 'UNCLOSED_STRING', { line: 1, column: 10 });

expect('未闭合块注释', `/* 没有结束\nRETURN 200 {};`, { errors: 1, firstLine: 1, firstColumn: 1, firstCode: 'UNCLOSED_COMMENT' });

expect('空 QUERY', `QUERY;\nRETURN 200 {};`, { errors: 1, firstLine: 1, firstColumn: 1, firstCode: 'EMPTY_SQL' });

expect('LET 后空 QUERY', `LET $x = QUERY;\nRETURN 200 $x;`, { errors: 1, firstLine: 1, firstCode: 'EMPTY_SQL' });

expect('合法 SQL 括号与 JSON 不误判', `LET $rows = QUERY SELECT * FROM t WHERE id IN (1, 2) AND name = 'a(b)';\nRETURN 200 { "rows": $rows.rows };`, { errors: 0, ok: true });

if (failed) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
