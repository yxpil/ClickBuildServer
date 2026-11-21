// 作者：yxpil
'use strict';

// 自动测试生成器：从接口、路由、字段和默认脚本推导 HTTP 用例。
//
// 默认只生成“安全用例”：列表结构、404、未授权 401。
// 写入生命周期（新建 → 详情 → 更新 → 删除）必须显式设置 CBS_WRITE_TESTS=1，
// 以免在真实数据上随手跑测试时留下垃圾记录。

const spec = require('./spec');

const DEFAULT_PORT = 18100;
const MISSING_ID = '999999999999';

function q(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function fullPath(iface, route, idToken) {
  let p = String(route.path || '/');
  if (idToken != null) p = p.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, String(idToken));
  if (!p.startsWith('/')) p = '/' + p;
  const base = String(iface.basePath || '').replace(/\/$/, '');
  return base + p;
}

function routeHasParam(route) {
  return /:[A-Za-z_][A-Za-z0-9_]*/.test(String(route.path || ''));
}

function hasStatus(route, code) {
  return new RegExp(`RETURN\\s+${code}\\b`, 'i').test(String((route && route.script) || ''));
}

function writableFields(iface) {
  const table = (iface.tables || [])[0] || { fields: [] };
  return (table.fields || []).filter((f) => f && f.writable !== false && !f.pk && !f.hidden);
}

function fieldExpr(field) {
  const type = String(field.type || 'varchar').toLowerCase();
  if (['bigint', 'int', 'smallint', 'tinyint'].includes(type)) return '7';
  if (['decimal', 'float', 'double'].includes(type)) return '12.34';
  if (type === 'bool') return 'true';
  if (type === 'date') return "'2026-01-01'";
  if (type === 'datetime') return "'2026-01-01 00:00:00'";
  if (type === 'json') return '{ cbs: tag }';
  if (type === 'url') return "'https://example.com/cbs/' + tag";
  if (['file', 'image', 'video', 'audio', 'pdf', 'doc', 'excel', 'archive'].includes(type)) return "'auto-' + tag + '.txt'";
  return `'auto-' + ${q(field.name)} + '-' + tag`;
}

function payloadSource(iface, tagName) {
  const fields = writableFields(iface);
  if (!fields.length) return null;
  const lines = fields.map((f) => `    ${q(f.name)}: ${fieldExpr(f)},`);
  return `function makeBody(${tagName}) {\n  return {\n${lines.join('\n')}\n  };\n}`;
}

function planFor(project, opts) {
  const p = spec.normalizeProject(project);
  const port = Number((opts && opts.port) || DEFAULT_PORT);
  const prefix = String((opts && opts.apiPrefix) || '/api').replace(/\/$/, '') || '/api';
  const tokenHeader = String((p.token && p.token.header) || 'authorization');
  const cases = [];
  const skipped = [];
  let seq = 0;

  const add = (iface, route, c) => {
    seq += 1;
    cases.push({
      id: `case_${seq}`,
      ifaceId: iface.id,
      iface: iface.name,
      route: route.name,
      method: route.method,
      kind: route.key,
      path: c.path || (prefix + fullPath(iface, route, c.param || null)),
      title: c.title,
      mode: c.mode,
      expect: c.expect || null,
      reason: c.reason || '',
      auth: !!route.auth,
      createPath: c.createPath || '',
      detailPath: c.detailPath || '',
      updatePath: c.updatePath || '',
      deletePath: c.deletePath || '',
      createMethod: c.createMethod || '',
      detailMethod: c.detailMethod || '',
      updateMethod: c.updateMethod || '',
      deleteMethod: c.deleteMethod || '',
    });
    if (c.mode === 'skip' || c.reason) skipped.push({ iface: iface.name, route: route.name, method: route.method, reason: c.reason || '未生成可执行断言' });
  };

  p.interfaces.forEach((iface) => {
    const routes = iface.routes || [];
    const byKey = (key) => routes.find((r) => r.key === key) || null;
    const create = byKey('create');
    const detail = byKey('detail');
    const update = byKey('update');
    const del = byKey('delete');
    const hasLifecycle = !!(create && detail && del && routeHasParam(detail) && routeHasParam(del));
    const fields = writableFields(iface);

    routes.forEach((route) => {
      const method = String(route.method || 'GET').toUpperCase();
      const auth = !!route.auth;
      const path = prefix + fullPath(iface, route, routeHasParam(route) ? MISSING_ID : null);

      if (auth) {
        add(iface, route, {
          title: `${method} ${route.path} 未带 token 返回 401`,
          mode: 'unauthorized',
          expect: 401,
          path,
        });
      }

      if (route.key === 'list') {
        if (!auth) {
          add(iface, route, {
            title: `GET ${route.path} 返回 2xx 且 rows 是数组`,
            mode: 'list',
            expect: 200,
            path,
          });
        }
        return;
      }

      if (['detail', 'update', 'delete'].includes(route.key)) {
        if (!auth && routeHasParam(route) && hasStatus(route, 404)) {
          add(iface, route, {
            title: `${method} ${route.path} 不存在的记录返回 404`,
            mode: 'not-found',
            expect: 404,
            path,
          });
        } else if (!auth && routeHasParam(route)) {
          add(iface, route, {
            title: `${method} ${route.path} 不存在的记录`,
            mode: 'skip',
            reason: '脚本没有声明 RETURN 404，无法安全断言状态码',
            path,
          });
        }
        return;
      }

      if (route.key === 'create') {
        if (!hasLifecycle) {
          add(iface, route, {
            title: `${method} ${route.path} 写入用例`,
            mode: 'skip',
            reason: '缺少详情或删除路由，无法完成生命周期并清理数据',
            path,
          });
        }
        return;
      }

      if (route.key === 'upload') {
        add(iface, route, {
          title: `${method} ${route.path} 文件上传`,
          mode: 'skip',
          reason: 'multipart 上传需要真实文件，默认不生成破坏性用例',
          path,
        });
        return;
      }

      if (route.key === 'proxy') {
        add(iface, route, {
          title: `${method} ${route.path} 上游转发`,
          mode: 'skip',
          reason: route.proxy && route.proxy.upstream ? '上游地址已配置，但测试会触达外部服务' : '尚未配置上游地址',
          path,
        });
        return;
      }

      if (route.key === 'objects') {
        add(iface, route, {
          title: `${method} ${route.path} 对象表`,
          mode: 'skip',
          reason: '依赖真实 S3 桶内容，自动断言会随桶变化',
          path,
        });
        return;
      }

      if (route.key === 'crawl') {
        add(iface, route, {
          title: `${method} ${route.path} 网页抓取`,
          mode: 'skip',
          reason: '会访问外部网页，默认不放进自动回归',
          path,
        });
        return;
      }

      if (route.key === 'custom') {
        add(iface, route, {
          title: `${method} ${route.path} 自定义脚本`,
          mode: 'skip',
          reason: '自定义脚本没有通用断言，请在 tests/api.test.js 里补业务断言',
          path,
        });
      }
    });

    if (hasLifecycle) {
      const createPath = prefix + fullPath(iface, create, null);
      const detailPath = prefix + fullPath(iface, detail, '__ID__');
      const updatePath = update && routeHasParam(update) ? prefix + fullPath(iface, update, '__ID__') : '';
      const deletePath = prefix + fullPath(iface, del, '__ID__');
      const reason = fields.length ? '' : '主表没有可写字段，无法自动拼出新建请求体';
      add(iface, create, {
        title: `写入生命周期：新建 → 详情${update ? ' → 更新' : ''} → 删除`,
        mode: 'lifecycle',
        write: true,
        path: createPath,
        createPath,
        detailPath,
        updatePath,
        deletePath,
        createMethod: String(create.method || 'POST').toUpperCase(),
        detailMethod: String(detail.method || 'GET').toUpperCase(),
        updateMethod: update ? String(update.method || 'PUT').toUpperCase() : '',
        deleteMethod: String(del.method || 'DELETE').toUpperCase(),
        reason,
      });
    }
  });

  const writeCases = cases.filter((c) => c.mode === 'lifecycle' && !c.reason).length;
  const counts = {
    interfaces: p.interfaces.length,
    routes: p.interfaces.reduce((n, i) => n + (i.routes || []).length, 0),
    cases: cases.length,
    runnable: cases.filter((c) => c.mode !== 'skip' && c.mode !== 'lifecycle' && !c.reason).length,
    writeCases,
    skipped: skipped.length,
  };

  return {
    plan: {
      version: 1,
      generatedAt: new Date().toISOString(),
      project: p.name,
      baseUrl: `http://127.0.0.1:${port}`,
      apiPrefix: prefix,
      tokenHeader,
      safety: { writeLifecycle: 'CBS_WRITE_TESTS=1' },
      counts,
      cases,
      skipped,
    },
    project: p,
    counts,
  };
}

function readme(plan) {
  const port = plan.baseUrl.split(':').pop();
  return `# 自动生成的 API 测试

这里的文件由 ClickBuild 根据 \`interfaces.json\` 自动生成；点“生成服务 / 更新部署 / 生成测试”都会覆盖本目录，不要把业务改动写进生成文件。

## 先启动服务

\`\`\`bash
npm start
\`\`\`

默认服务地址：\`${plan.baseUrl}\`，接口前缀：\`${plan.apiPrefix}\`。

## 跑安全用例

\`\`\`bash
npm run test:api
\`\`\`

默认用例只做三件事：

- 列表返回 2xx，且 \`rows\` / \`data\` 是数组；
- 详情 / 更新 / 删除用不存在的 ID，断言默认脚本声明的 404；
- 需要鉴权的路由不带 token，断言 401。

不会新建、修改或删除任何真实记录。

## 跑写入生命周期（可选）

写入用例会新建一条带时间戳的记录，再查详情、更新、删除，最后在 \`finally\` 里兜底删除。只在你确认可以写测试数据的环境里开启：

PowerShell：

\`\`\`powershell
$env:CBS_WRITE_TESTS='1'; npm run test:api
\`\`\`

bash：

\`\`\`bash
CBS_WRITE_TESTS=1 npm run test:api
\`\`\`

## 环境变量

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| \`CBS_BASE_URL\` | \`http://127.0.0.1:${port}\` | 服务地址 |
| \`CBS_API_PREFIX\` | \`${plan.apiPrefix}\` | 接口前缀 |
| \`CBS_TOKEN\` | 空 | 鉴权路由的 Bearer token |
| \`CBS_AUTH_HEADER\` | \`${plan.tokenHeader}\` | 鉴权请求头名 |
| \`CBS_WRITE_TESTS\` | 空 | 设为 \`1\` 才跑写入生命周期 |

## 覆盖范围

本工程自动生成：${plan.counts.cases} 个用例，其中可执行 ${plan.counts.runnable} 个，跳过 ${plan.counts.skipped} 个。跳过原因写在 \`plan.json\`：文件上传、上游转发、对象表、网页抓取和自定义脚本没有通用断言，不会假装通过。
`;
}

function testSource(plan, project) {
  const byId = new Map(project.interfaces.map((i) => [i.id, i]));
  const lines = [];
  lines.push(`'use strict';`);
  lines.push(`// 由 ClickBuild 自动生成：${plan.project}`);
  lines.push(`// 安全默认只读；写入生命周期需 CBS_WRITE_TESTS=1。`);
  lines.push(`const test = require('node:test');`);
  lines.push(`const assert = require('node:assert/strict');`);
  lines.push(`const path = require('node:path');`);
  lines.push(`const fs = require('node:fs');`);
  lines.push(`const plan = ${JSON.stringify(plan)};`);
  lines.push(`const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));`);
  lines.push(`const BASE = String(process.env.CBS_BASE_URL || 'http://127.0.0.1:' + (CONFIG.PORT || ${plan.baseUrl.split(':').pop()})).replace(/\\/$/, '');`);
  lines.push(`const PREFIX = String(process.env.CBS_API_PREFIX || CONFIG.API_PREFIX || ${q(plan.apiPrefix)}).replace(/\\/$/, '');`);
  lines.push(`const TOKEN = String(process.env.CBS_TOKEN || '');`);
  lines.push(`const AUTH_HEADER = String(process.env.CBS_AUTH_HEADER || ${q(plan.tokenHeader)});`);
  lines.push(`const WRITE = process.env.CBS_WRITE_TESTS === '1';`);
  lines.push(`const TAG = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);`);
  lines.push(`function joinUrl(p) { let s = String(p || '/'); if (!s.startsWith('/')) s = '/' + s; return BASE + (s.startsWith(PREFIX + '/') || s === PREFIX ? s : PREFIX + s); }`);
  lines.push(`async function call(method, p, opts) {`);
  lines.push(`  opts = opts || {};`);
  lines.push(`  const headers = { accept: 'application/json' };`);
  lines.push(`  if (opts.body !== undefined) headers['content-type'] = 'application/json';`);
  lines.push(`  if (opts.auth && TOKEN) headers[AUTH_HEADER] = /^Bearer\\s/i.test(TOKEN) ? TOKEN : 'Bearer ' + TOKEN;`);
  lines.push(`  const res = await fetch(joinUrl(p), { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });`);
  lines.push(`  const text = await res.text();`);
  lines.push(`  let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) {}`);
  lines.push(`  return { status: res.status, text, json };`);
  lines.push(`}`);
  lines.push(`function pickId(body) {`);
  lines.push(`  const list = [body && body.id, body && body.insertId, body && body.row && body.row.id, body && body.data && body.data.id, body && body.rows && body.rows[0] && body.rows[0].id];`);
  lines.push(`  const id = list.find((v) => v !== undefined && v !== null && v !== '');`);
  lines.push(`  return id == null ? null : String(id);`);
  lines.push(`}`);
  lines.push(`function statusLine(r) { return r.status + ' · ' + String(r.text || '').slice(0, 180); }`);
  lines.push(`function idPath(template, id) { return String(template).replace(/__ID__/g, encodeURIComponent(String(id))); }`);
  lines.push('');

  if (!plan.cases.length) {
    lines.push(`test('工程没有可生成的路由', { skip: '先建接口和路由，再重新生成测试' }, async () => {});`);
  }

  for (const c of plan.cases) {
    const label = `${c.iface} / ${c.title}`;
    if (c.mode === 'skip') {
      lines.push(`test(${q(label)}, { skip: ${q(c.reason)} }, async () => {});`);
      continue;
    }
    if (c.mode === 'unauthorized') {
      lines.push(`test(${q(label)}, async () => {`);
      lines.push(`  const r = await call(${q(c.method)}, ${q(c.path)});`);
      lines.push(`  assert.equal(r.status, 401, '未带 token 应返回 401，实际 ' + statusLine(r));`);
      lines.push(`});`);
      continue;
    }
    if (c.mode === 'list') {
      lines.push(`test(${q(label)}, async () => {`);
      lines.push(`  const r = await call(${q(c.method)}, ${q(c.path)}, { auth: false });`);
      lines.push(`  assert.ok(r.status >= 200 && r.status < 300, '列表应返回 2xx，实际 ' + statusLine(r));`);
      lines.push(`  const body = r.json || {};`);
      lines.push(`  const box = body.data && !Array.isArray(body.data) ? body.data : body;`);
      lines.push(`  const rows = Array.isArray(body.data) ? body.data : (box.rows || box.data || box.items || box.list);`);
      lines.push(`  assert.ok(Array.isArray(rows), '列表响应应有 rows 或 data 数组，实际 ' + statusLine(r));`);
      lines.push(`});`);
      continue;
    }
    if (c.mode === 'not-found') {
      lines.push(`test(${q(label)}, async () => {`);
      lines.push(`  const r = await call(${q(c.method)}, ${q(c.path)}, { auth: false });`);
      lines.push(`  assert.equal(r.status, 404, '不存在的记录应返回 404，实际 ' + statusLine(r));`);
      lines.push(`});`);
      continue;
    }
    if (c.mode === 'lifecycle') {
      const def = byId.get(c.ifaceId);
      const bodyFn = def ? payloadSource(def, 'tag') : null;
      const updateExpr = bodyFn ? `makeBody('upd')` : null;
      const skipExpr = c.reason
        ? `(!WRITE ? '设置 CBS_WRITE_TESTS=1 才执行写入生命周期' : ${q(c.reason)})`
        : `(!WRITE ? '设置 CBS_WRITE_TESTS=1 才执行写入生命周期' : (${c.auth ? 'true' : 'false'} && !TOKEN ? '设置 CBS_TOKEN 才能执行鉴权路由的写入生命周期' : false))`;
      lines.push(`test(${q(label)}, { skip: ${skipExpr} }, async (t) => {`);
      lines.push(`  let id = null;`);
      if (bodyFn) lines.push(`  ${bodyFn.replace(/\n/g, '\n  ')}`);
      lines.push(`  try {`);
      lines.push(`    const created = await call(${q(c.createMethod)}, ${q(c.createPath)}, { body: makeBody(TAG), auth: ${c.auth ? 'true' : 'false'} });`);
      lines.push(`    assert.ok(created.status >= 200 && created.status < 300, '新建应返回 2xx，实际 ' + statusLine(created));`);
      lines.push(`    id = pickId(created.json);`);
      lines.push(`    if (!id) { t.diagnostic('新建成功但响应没有 id，跳过后续步骤'); return; }`);
      lines.push(`    const detail = await call(${q(c.detailMethod)}, idPath(${q(c.detailPath)}, id), { auth: ${c.auth ? 'true' : 'false'} });`);
      lines.push(`    assert.ok(detail.status >= 200 && detail.status < 300, '新建后详情应返回 2xx，实际 ' + statusLine(detail));`);
      if (c.updatePath && updateExpr) {
        lines.push(`    const updated = await call(${q(c.updateMethod)}, idPath(${q(c.updatePath)}, id), { body: ${updateExpr}, auth: ${c.auth ? 'true' : 'false'} });`);
        lines.push(`    assert.ok(updated.status >= 200 && updated.status < 300, '更新应返回 2xx，实际 ' + statusLine(updated));`);
      }
      lines.push(`    const deleted = await call(${q(c.deleteMethod)}, idPath(${q(c.deletePath)}, id), { auth: ${c.auth ? 'true' : 'false'} });`);
      lines.push(`    assert.ok(deleted.status >= 200 && deleted.status < 300, '删除应返回 2xx，实际 ' + statusLine(deleted));`);
      lines.push(`    id = null;`);
      lines.push(`  } finally {`);
      lines.push(`    if (id != null) { try { await call(${q(c.deleteMethod)}, idPath(${q(c.deletePath)}, id), { auth: ${c.auth ? 'true' : 'false'} }); } catch (_) {} }`);
      lines.push(`  }`);
      lines.push(`});`);
      continue;
    }
  }
  lines.push('');
  return lines.join('\n');
}

function build(project, opts) {
  const result = planFor(project, opts);
  return {
    plan: result.plan,
    test: testSource(result.plan, result.project),
    readme: readme(result.plan),
    summary: result.counts,
  };
}

function writeTests(project, outDir, opts) {
  const fs = require('fs');
  const path = require('path');
  const built = build(project, opts);
  const files = [
    { path: 'tests/api.test.js', content: built.test },
    { path: 'tests/plan.json', content: JSON.stringify(built.plan, null, 2) },
    { path: 'tests/README.md', content: built.readme },
  ];
  files.forEach((f) => {
    const target = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content, 'utf8');
  });
  return { ok: true, dir: outDir, files: files.map((f) => f.path), counts: built.summary };
}

module.exports = { build, writeTests, planFor, fullPath };
