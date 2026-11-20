'use strict';

const assert = require('assert');
const spec = require('../app/iface/spec');
const docs = require('../app/iface/docs');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log('semantic field types');

ok('类型扩展集包含 token 与文件/文档类型', () => {
  for (const key of ['token', 'url', 'file', 'image', 'video', 'audio', 'pdf', 'doc', 'excel', 'archive']) {
    const meta = spec.TYPES.find((t) => t.key === key);
    assert(meta, `缺少类型 ${key}`);
    assert(meta.sql && meta.label && meta.group, `类型 ${key} 缺少 sql/label/group`);
  }
});

ok('token 默认隐藏且不参与查询', () => {
  const f = spec.newField('api_token', 'token');
  assert(f.hidden === true, 'token 未默认隐藏');
  assert(f.query === false, 'token 未默认关闭查询');
  assert(f.search === false, 'token 未默认关闭搜索');
});

ok('规范化旧表字段时 token 自动隐藏', () => {
  const table = spec.normalizeTable({ name: 't', fields: [{ name: 'api_token', type: 'token' }] }, 0, new Set());
  assert(table.fields[0].hidden === true, 'token 未自动隐藏');
  assert(table.fields[0].query === false, 'token 未自动关闭查询');
});

ok('DDL 把语义类型落成可索引文本列', () => {
  const iface = {
    name: '文件库',
    tables: [{ key: 'main', name: 'files', schema: '', fields: [
      { name: 'api_token', type: 'token' },
      { name: 'contract', type: 'doc' },
      { name: 'report', type: 'excel' },
      { name: 'cover', type: 'image' },
    ] }],
  };
  const ddl = spec.ddlOf(iface);
  assert(/`api_token` VARCHAR\(1024\)/.test(ddl), 'token DDL 不对');
  assert(/`contract` VARCHAR\(512\)/.test(ddl), 'doc DDL 不对');
  assert(/`report` VARCHAR\(512\)/.test(ddl), 'excel DDL 不对');
});

ok('文档示例按语义类型生成，不泄露真实 token', () => {
  const iface = {
    tables: [{
      key: 'main',
      name: 'files',
      fields: [
        { name: 'api_token', type: 'token' },
        { name: 'contract', type: 'doc' },
        { name: 'report', type: 'excel' },
      ],
    }],
  };
  const route = {
    method: 'GET',
    path: '/files',
    auth: true,
    script: 'LET $rows = QUERY SELECT api_token, contract, report FROM {{t:main}};\nRETURN 200 { "rows": $rows.rows };',
  };
  const facts = docs.inferRouteDocs(iface, route);
  assert(facts.responseExample.includes('<token>'), 'token 示例未脱敏');
  assert(facts.responseExample.includes('uploads/'), '文件示例未生成');
});

ok('OpenAPI 给 token/url/文件类型加格式标记', () => {
  const iface = {
    tables: [{
      key: 'main',
      name: 'files',
      fields: [
        { name: 'api_token', type: 'token' },
        { name: 'link', type: 'url' },
        { name: 'contract', type: 'doc' },
      ],
    }],
  };
  const route = {
    method: 'POST',
    path: '/x',
    script: 'LET $x = QUERY SELECT * FROM {{t:main}} WHERE api_token={{body.api_token}} AND link={{body.link}} AND contract={{body.contract}}; RETURN 200 { "ok": true };',
  };
  const facts = docs.inferRouteDocs(iface, route);
  const byName = Object.fromEntries(facts.parameters.map((p) => [p.name, p]));
  assert(byName.api_token.schema.format === 'password', 'token 未标记 password');
  assert(byName.api_token.description === '访问令牌', 'token 参数说明不对');
  assert(byName.link.schema.format === 'uri', 'url 未标记 uri');
  assert(byName.contract.schema['x-file-kind'] === 'doc', 'doc 未标记 x-file-kind');
});

console.log(`\n${passed} passed`);
