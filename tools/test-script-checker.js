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

if (failed) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
