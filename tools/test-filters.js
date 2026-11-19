'use strict';

// 接口查询过滤器单元测试：不启动数据库，只验证 {{where}} 拼出的 SQL 与参数。
// 用法：node tools/test-filters.js
const render = require('../app/iface/render');

const iface = {
  name: '过滤测试',
  tables: [{
    key: 'main', name: 'filter_items', schema: '', conn: 'main',
    fields: [
      { name: 'name', type: 'varchar', search: true },
      { name: 'role', type: 'varchar', search: true },
      { name: 'age', type: 'int' },
      { name: 'price', type: 'decimal' },
      { name: 'created_at', type: 'datetime' },
    ],
  }],
};
const base = 'SELECT * FROM {{t:main}} WHERE {{where:main}}';
let ok = 0; let bad = 0;
const t = (name, cond, extra) => {
  if (cond) { ok++; console.log('PASS  ' + name); }
  else { bad++; console.log('FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
};
const build = (query) => render.renderSqlText(base, iface, { query });

let r = build({ name: 'A', age__gte: '18', price__lt: '99.5' });
t('等值与范围', /name = \?/.test(r.sql) && /age >= \?/.test(r.sql) && /price < \?/.test(r.sql), r.sql);
t('等值参数保持顺序', JSON.stringify(r.params) === JSON.stringify(['A', 18, 99.5]), JSON.stringify(r.params));

r = build({ name__ne: 'A', role__in: 'admin,guest', age__between: '18,30' });
t('不相等 / IN / BETWEEN', /name <> \?/.test(r.sql) && /role IN \(\?, \?\)/.test(r.sql) && /age BETWEEN \? AND \?/.test(r.sql), r.sql);
t('IN 与 BETWEEN 参数', r.params.length === 5 && r.params[1] === 'admin' && r.params[2] === 'guest', JSON.stringify(r.params));

r = build({ name__like: 'a%', role__contains: 'root', name__startswith: 'A', role__endswith: 'x' });
t('LIKE 与包含/前后缀', /name LIKE \?/.test(r.sql) && /role LIKE \?/.test(r.sql), r.sql);
t('包含/前缀/后缀通配符', r.params[1] === '%root%' && r.params[2] === 'A%' && r.params[3] === '%x', JSON.stringify(r.params));

r = build({ name__regex: '^(A|B)+$', role__iregex: 'admin', name__notregex: 'test' });
t('正则 / 忽略大小写 / 非匹配', /name REGEXP \?/.test(r.sql) && /role REGEXP \?/.test(r.sql) && /name NOT REGEXP \?/.test(r.sql), r.sql);
t('iregex 自动加 (?i)', r.params[1] === '(?i)admin', JSON.stringify(r.params));

r = build({ age__isnull: '1', created_at__notnull: '1' });
t('NULL / NOT NULL', /age IS NULL/.test(r.sql) && /created_at IS NOT NULL/.test(r.sql), r.sql);
t('NULL 不产生参数', r.params.length === 0, JSON.stringify(r.params));

r = build({ keyword: 'abc', keywordRegex: 'a.c' });
t('keyword 走 LIKE', /\(name LIKE \? OR role LIKE \?\)/.test(r.sql), r.sql);
t('keywordRegex 走 REGEXP', /\(name REGEXP \? OR role REGEXP \?\)/.test(r.sql), r.sql);
t('keyword 与正则参数数量', r.params.length === 4 && r.params[0] === '%abc%' && r.params[2] === 'a.c', JSON.stringify(r.params));

r = build({ evil__regex: 'x', 'name; DROP': 'x' });
t('未声明字段与非法键被忽略', r.sql === 'SELECT * FROM filter_items WHERE 1 = 1' && r.params.length === 0, r.sql);

r = build({ name__startswith: 'a%b_c' });
t('前后缀过滤转义 LIKE 通配符', r.params[0] === 'a\\%b\\_c%', JSON.stringify(r.params));

console.log(`\n${ok}/${ok + bad} 通过`);
process.exit(bad ? 1 : 0);
