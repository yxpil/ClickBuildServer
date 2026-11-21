// 作者：yxpil
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const spec = require('../app/iface/spec');
const docs = require('../app/iface/docs');
const codegen = require('../app/iface/codegen');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

function projectFile() {
  const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(base, 'click-build-server', 'clickbuild', 'iface-projects', '社交接口库-2.json');
}

const file = projectFile();
assert(fs.existsSync(file), `缺少真实工程：${file}`);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const iface = raw.interfaces.find((x) => x.name === '搜索');
assert(iface, '缺少“搜索”接口');

console.log('docs inference');

ok('每个路由都有非空说明、请求示例、响应示例', () => {
  for (const route of iface.routes) {
    const facts = docs.inferRouteDocs(iface, route);
    assert(facts.description.length > 20, `${route.method} ${route.path} 说明过短`);
    assert(facts.requestExample.length > 10, `${route.method} ${route.path} 请求示例为空`);
    assert(facts.responseExample.length > 10, `${route.method} ${route.path} 响应示例为空`);
  }
});

ok('响应示例不再出现未解析的“示例值”占位', () => {
  for (const route of iface.routes) {
    const facts = docs.inferRouteDocs(iface, route);
    assert(!/"示例值"/.test(facts.responseExample), `${route.method} ${route.path} 仍有占位值`);
  }
});

ok('搜索路由从 SQL 推导出 q 参数与 401', () => {
  const route = iface.routes.find((r) => r.method === 'GET' && r.path === '/search');
  const facts = docs.inferRouteDocs(iface, route);
  assert(facts.parameters.some((p) => p.in === 'query' && p.name === 'q'), '缺少 query.q');
  assert(facts.errors.some((e) => e.status === 401 && e.code === 'UNAUTHORIZED'), '缺少 401');
  assert(facts.errors.some((e) => e.code === 'EMPTY_KEYWORD'), '缺少业务错误码');
  assert(/Authorization: Bearer/.test(facts.requestExample), '请求示例缺少鉴权头');
});

ok('normalize 后空文档会被自动补全并标记 docsAuto', () => {
  const copy = JSON.parse(JSON.stringify(raw));
  const target = copy.interfaces.find((x) => x.name === '搜索');
  for (const route of target.routes) route.docs = { summary: '', description: '', requestExample: '', responseExample: '' };
  const normalized = spec.normalizeProject(copy);
  const out = normalized.interfaces.find((x) => x.name === '搜索');
  for (const route of out.routes) {
    assert(route.docs.description, `${route.path} 说明未补全`);
    assert(route.docs.requestExample, `${route.path} 请求示例未补全`);
    assert(route.docs.responseExample, `${route.path} 响应示例未补全`);
    assert(route.docsAuto && route.docsAuto.fields.length > 0, `${route.path} 未记录自动字段`);
  }
});

ok('脚本变化只覆盖自动字段，保留手写说明', () => {
  const copy = JSON.parse(JSON.stringify(raw));
  const target = copy.interfaces.find((x) => x.name === '搜索');
  const route = target.routes.find((r) => r.method === 'GET' && r.path === '/search');
  route.docs = { summary: '', description: 'HAND WRITTEN', requestExample: '', responseExample: '' };
  route.docsAuto = { fingerprint: 'old', fields: ['summary', 'requestExample', 'responseExample'] };
  route.script += '\n// changed\n';
  const facts = docs.applyRouteDocs(target, route);
  assert(route.docs.description === 'HAND WRITTEN', '手写说明被覆盖');
  assert(route.docs.requestExample === facts.requestExample, '自动请求示例未刷新');
  assert(!route.docsAuto.fields.includes('description'), '手写字段被误标为自动');
});

ok('OpenAPI 带真实参数、示例与错误响应', () => {
  const copy = JSON.parse(JSON.stringify(raw));
  const openapi = codegen.buildOpenApi(copy, 18080);
  const op = openapi.paths['/api/social/search'].get;
  assert(op, '缺少 /api/social/search');
  assert(op.parameters && op.parameters.some((p) => p.name === 'q' && p.in === 'query'), '缺少 q 参数');
  assert(op['x-examples'] && op['x-examples'].request, '缺少请求示例');
  assert(op.responses['401'], '缺少 401 响应');
  assert(op.responses['400'], '缺少 400 响应');
});

ok('生成的 /docs 页面直接展示请求与响应示例', () => {
  const copy = JSON.parse(JSON.stringify(raw));
  const html = codegen.docsPage(copy, 18080);
  assert(html.includes('请求示例'), '页面缺少请求示例区');
  assert(html.includes('响应示例'), '页面缺少响应示例区');
  assert(html.includes('401 UNAUTHORIZED'), '页面缺少 401 错误码');
});

console.log(`\n${passed} passed`);
