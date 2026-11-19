'use strict';

const fs = require('fs');
const path = require('path');
const spec = require('./spec');
const script = require('./script');

const DEFAULT_PORTS = { mysql: 13306, redis: 16379, s3: 19000, s3Console: 19001, http: 18100 };

function slug(text, fallback) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || (fallback || 'item');
}

function engine(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

function template(name) {
  return fs.readFileSync(path.join(__dirname, 'template', name), 'utf8');
}

function exportJs(iface, route) {
  const ast = script.parseScript(route.script || '').ast;
  const body = script.scriptToJs(ast, 2);
  const ifaceJson = JSON.stringify({ id: iface.id, name: iface.name, tables: iface.tables, storage: iface.storage, page: iface.page }, null, 2);
  const prefix = iface.basePath || '';
  return `// 自动导出：${iface.name} / ${route.name} — ${route.method} ${prefix}${route.path}
// 由 ClickBuild 的脚本语法直接转成 JS，逻辑与服务器上跑的完全一致。
'use strict';

const render = require('../../src/render');
const funcs = require('../../src/funcs');

const IFACE = ${ifaceJson};

module.exports = {
  method: '${route.method}',
  path: '${prefix}${route.path}',
  cache: ${JSON.stringify(route.cache || {})},
  async handler(ctx, db) {
    const Q = async (sqlText) => {
      const built = render.renderSqlText(sqlText, IFACE, ctx);
      return { rows: await db.query(built.sql, built.params), sql: built.sql, params: built.params };
    };
    const X = async (sqlText) => {
      const built = render.renderSqlText(sqlText, IFACE, ctx);
      return db.execute(built.sql, built.params);
    };
    const F = (name, args) => funcs.call(name, args);
    const V = (token) => render.valueOf(token, ctx, IFACE);
    const toList = (v) => (Array.isArray(v) ? v : (v && v.rows) || []);
    const H = async (method, url, body) => {
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body == null || method === 'GET' ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let data = text;
      try { data = JSON.parse(text); } catch (e) {}
      return { status: res.status, ok: res.ok, body: data };
    };
    const T = async (action, arg) => {
      if (!db.token) throw new Error('导出代码需要 db.token 会话实现');
      return action === 'NEW' ? db.token.mint(arg) : db.token.get(arg);
    };
    const TD = async (token) => (db.token ? db.token.del(token) : false);
    const TX = async (action) => (db.tx ? db.tx(action) : null);
    const P = async (channel, payload) => (db.publish ? db.publish(channel, payload) : null);
    const L = (level, message) => console.log(\`[\${level}] \${message}\`);

${body}
  },
};
`;
}

function exportJava(iface, route) {
  const cls = `Iface${slug(iface.name).replace(/(^|-)(\w)/g, (_, a, b) => b.toUpperCase())}${slug(route.name).split('-').map((s) => s[0] ? s[0].toUpperCase() + s.slice(1) : '').join('')}Route`;
  const sqls = (route.script || '').split(/\r?\n/).filter((l) => /^(LET\s+\$[A-Za-z0-9_]+\s*=\s*)?(QUERY|EXEC)\s+/i.test(l.trim()));
  return `// 自动导出：${iface.name} / ${route.name} — ${route.method} ${route.path}
// Java 侧给的是"路由 + SQL"骨架：SQL 已经按表结构生成好，接上 JdbcTemplate 即可。
// 脚本里的判断/循环（IF / FOREACH）用注释标出，按需搬进 service。
package clickbuild.export;

import java.util.*;

public class ${cls} {
    public static final String METHOD = "${route.method}";
    public static final String PATH = "${route.path}";
    public static final boolean CACHE = ${route.cache && route.cache.enabled ? 'true' : 'false'};

${sqls.map((l, i) => `    // ${l.trim().replace(/[`$]/g, ' ')}\n    public static final String SQL_${i + 1} = "${l.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/^.*?(QUERY|EXEC)\s+/i, '')}";`).join('\n\n')}

    // 入参：ctx（query / body / path / id / file），返回 Map 即响应体
    public Map<String, Object> handle(Map<String, Object> ctx) {
        Map<String, Object> out = new LinkedHashMap<>();
        // TODO 用 JdbcTemplate 依次执行上面的 SQL，并把结果按脚本逻辑组装
        out.put("ok", true);
        return out;
    }
}
`;
}

function exportGo(iface, route) {
  const fn = `Handle${slug(iface.name).split('-').map((s) => s[0] ? s[0].toUpperCase() + s.slice(1) : '').join('')}${slug(route.name).split('-').map((s) => s[0] ? s[0].toUpperCase() + s.slice(1) : '').join('')}`;
  const sqls = (route.script || '').split(/\r?\n/).filter((l) => /^(LET\s+\$[A-Za-z0-9_]+\s*=\s*)?(QUERY|EXEC)\s+/i.test(l.trim()));
  return `// 自动导出：${iface.name} / ${route.name} — ${route.method} ${route.path}
// Go 侧给的是"路由 + SQL"骨架，占位符与服务器一致，换成 database/sql 即可。
package export

import "context"

const (
	Method = "${route.method}"
	Path   = "${route.path}"
)

var SqlList = []string{
${sqls.map((l) => `\t"${l.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/^.*?(QUERY|EXEC)\s+/i, '')}",`).join('\n')}
}

func ${fn}(ctx context.Context, params map[string]any) (map[string]any, error) {
	// TODO 用 sqlx / database/sql 执行 SqlList，并按脚本逻辑组装结果
	return map[string]any{"ok": true}, nil
}
`;
}

function buildOpenApi(project, port) {
  const p = spec.normalizeProject(project);
  const paths = {};
  p.interfaces.forEach((iface) => {
    (iface.routes || []).forEach((route) => {
      const full = (`/api${iface.basePath || ''}${route.path}`).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const op = {
        tags: [iface.name],
        summary: (route.docs && route.docs.summary) || route.summary || route.name,
        description: [
          (route.docs && route.docs.description) || '',
          (iface.docs && iface.docs.description) || iface.comment || '',
          (route.docs && route.docs.notes) || '',
        ].filter(Boolean).join('\n\n'),
        operationId: `${iface.id}_${route.key}_${route.method}`.replace(/[^A-Za-z0-9_]/g, '_'),
        responses: { 200: { description: 'OK' }, 400: { description: '参数/业务错误' }, 401: { description: '未授权' }, 429: { description: '限流' }, 503: { description: '熔断/时间窗' } },
        security: route.auth ? [{ bearer: [] }] : undefined,
        'x-clickbuild': { kind: route.key, tx: !!(route.guard && route.guard.tx), cache: route.cache },
        'x-examples': {
          request: (route.docs && route.docs.requestExample) || '',
          response: (route.docs && route.docs.responseExample) || '',
        },
      };
      const params = [];
      route.path.split('/').filter((s) => s.startsWith(':')).forEach((s) => params.push({ name: s.slice(1), in: 'path', required: true, schema: { type: 'string' } }));
      if (route.key === 'list' || route.key === 'custom') ['page', 'size', 'keyword', 'sort'].forEach((q) => params.push({ name: q, in: 'query', required: false, schema: { type: 'string' } }));
      if (params.length) op.parameters = params;
      if (route.method !== 'GET') {
        const props = {};
        ((iface.tables[0] || {}).fields || []).filter((f) => f.writable !== false && !f.pk).forEach((f) => {
          props[f.name] = { type: f.type === 'json' ? 'object' : /int|decimal|float|double|bool/i.test(f.type) ? 'number' : 'string', description: f.comment || '' };
        });
        op.requestBody = { content: { 'application/json': { schema: { type: 'object', properties: props } } } };
      }
      paths[full] = { ...(paths[full] || {}), [route.method.toLowerCase()]: op };
    });
  });
  return {
    openapi: '3.0.3',
    info: { title: (p.docs && p.docs.title) || p.name, version: (p.docs && p.docs.version) || '1.0.0', description: (p.docs && p.docs.description) || p.description || '' },
    servers: [{ url: `http://127.0.0.1:${port || DEFAULT_PORTS.http}` }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    paths,
  };
}

function docsPage(project, port) {
  const specOut = buildOpenApi(project, port);
  const rows = [];
  spec.normalizeProject(project).interfaces.forEach((iface) => {
    (iface.routes || []).forEach((route) => {
      rows.push(`<tr><td>${route.method}</td><td><code>${'/api' + (iface.basePath || '') + route.path}</code></td><td>${iface.name}</td><td>${route.name}</td><td>${route.summary || ''}</td><td>${route.auth ? 'token' : '—'}</td><td>${route.guard && route.guard.tx ? '事务' : ''}${route.cache && route.cache.enabled ? ' 缓存' : ''}${route.guard && route.guard.rate && route.guard.rate.enabled ? ` ${route.guard.rate.limit}/${route.guard.rate.window}s` : ''}</td></tr>`);
    });
  });
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${specOut.info.title}</title>
<style>body{font:14px/1.6 -apple-system,Segoe UI,"Microsoft YaHei",sans-serif;margin:32px;color:#111;background:#fff}h1{font-size:20px;font-weight:600}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #e2e2e2;padding:6px 8px;text-align:left}th{background:#fafafa;font-weight:500}code{font-family:ui-monospace,Consolas,monospace}a{color:#111}</style>
<h1>${specOut.info.title} <small>v${specOut.info.version}</small></h1><p>${specOut.info.description || ''}</p>
<p><a href="/_docs">OpenAPI JSON</a> · <a href="/_meta">元信息</a> · <a href="/_routes">路由</a></p>
<table><thead><tr><th>方法</th><th>路径</th><th>接口</th><th>名称</th><th>说明</th><th>鉴权</th><th>特性</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<p style="color:#777;margin-top:24px">由 ClickBuild 生成 · ${new Date().toISOString()}</p></body></html>`;
}

function addIdeaFiles(add) {
  add('.idea/modules.xml', `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectModuleManager">
    <modules>
      <module fileurl="file://$PROJECT_DIR$/.idea/clickbuild.iml" filepath="$PROJECT_DIR$/.idea/clickbuild.iml" />
    </modules>
  </component>
</project>
`);
  add('.idea/clickbuild.iml', `<?xml version="1.0" encoding="UTF-8"?>
<module type="EMPTY_MODULE" version="4">
  <component name="NewModuleRootManager" inherit-compiler-output="true">
    <exclude-output />
    <content url="file://$MODULE_DIR$/..">
      <excludeFolder url="file://$MODULE_DIR$/../node_modules" />
      <excludeFolder url="file://$MODULE_DIR$/../.git" />
    </content>
    <orderEntry type="sourceFolder" forTests="false" />
  </component>
</module>
`);
  add('.idea/misc.xml', `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectRootManager" version="2" />
</project>
`);
  add('.idea/.gitignore', `workspace.xml
usage.statistics.xml
shelf/
`);
  add('.run/启动接口服务.run.xml', `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="启动接口服务" type="jsNodeRunConfiguration" factoryName="Node.js">
    <option name="NODE_PARAMETERS" value="" />
    <option name="PARAMETERS" value="" />
    <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$" />
    <option name="IS_PARAMETERS_FROM_SCRIPT" value="true" />
    <option name="SCRIPT_NAME" value="server.js" />
    <method v="2" />
  </configuration>
</component>
`);
}

function generate(project, options) {
  const opts = options || {};
  let p = spec.normalizeProject(project);
  if (Array.isArray(opts.only) && opts.only.length) {
    p = { ...p, interfaces: p.interfaces.filter((i) => opts.only.includes(i.id) || opts.only.includes(i.name)) };
  }
  if (opts.category) {
    p = { ...p, interfaces: p.interfaces.filter((i) => i.categoryId === opts.category) };
  }
  const files = [];

  const add = (rel, content) => files.push({ path: rel, content: String(content).replace(/\r\n/g, '\n') });

  add('server.js', template('server.js'));
  add('src/render.js', engine('render.js'));
  add('src/funcs.js', engine('funcs.js'));
  add('src/script.js', engine('script.js'));
  add('public/console.html', template('console.html'));

  p.interfaces.forEach((it, idx) => {
    const name = `${String(idx + 1).padStart(2, '0')}_${slug(it.name, 'iface')}.sql`;
    add(`sql/${name}`, `-- 接口：${it.name}\n-- ${it.comment || ''}\n\n${spec.ddlOf(it)}\n`);
  });

  if (p.frontend && p.frontend.project) {
    const yxpp = {
      format: 'yxpp', version: 1, name: p.frontend.name || `${p.name} 前端`,
      framework: p.frontend.framework || 'tailwind', createdAt: p.frontend.updatedAt || new Date().toISOString(),
      updatedAt: p.frontend.updatedAt || new Date().toISOString(),
      project: p.frontend.project, html: p.frontend.html || '',
    };
    add('frontend/index.yxpp', JSON.stringify(yxpp, null, 2));
    add('frontend/project.json', JSON.stringify(p.frontend.project, null, 2));
    add('frontend/README.md', [
      `# ${yxpp.name}`, '', '这是随接口服务一起打包的 PageStudio 前端工程（.yxpp）。',
      '', '- 生成服务的 `/` 会优先返回该前端页面。', '- 可以在 ClickBuild 的「前端」模式里继续编辑，再导出 .yxpp。',
    ].join('\n'));
    if (p.frontend.html) add('public/index.html', p.frontend.html);
  }

  add('interfaces.json', JSON.stringify({
    name: p.name, description: p.description, categories: p.categories,
    functions: p.functions, interfaces: p.interfaces,
    connections: p.connections, log: p.log, token: p.token, docs: p.docs,
    services: p.services, theme: p.theme, isolation: p.isolation,
    frontend: p.frontend ? { name: p.frontend.name, framework: p.frontend.framework, updatedAt: p.frontend.updatedAt } : null,
    generatedAt: new Date().toISOString(),
  }, null, 2));

  add('docs/openapi.json', JSON.stringify(buildOpenApi(p, opts.port || DEFAULT_PORTS.http), null, 2));
  add('docs/index.html', docsPage(p, opts.port || DEFAULT_PORTS.http));
  add('docs/README.md', [
    `# ${p.name} 接口文档`, '',
    '接口清单、参数和鉴权说明都在这里。',
    '',
    `- 运行时文档：http://127.0.0.1:${opts.port || DEFAULT_PORTS.http}/docs`,
    `- 帮助 / 语法：http://127.0.0.1:${opts.port || DEFAULT_PORTS.http}/help`,
    `- OpenAPI：http://127.0.0.1:${opts.port || DEFAULT_PORTS.http}/_docs`,
    '', '字段注释就是文档说明，路由的 summary 会出现在文档摘要里。',
  ].join('\n'));

  add('package.json', JSON.stringify({
    name: slug(p.name, 'clickbuild-server'),
    version: '1.0.0',
    private: true,
    description: p.description || 'ClickBuild 生成的接口服务',
    main: 'server.js',
    scripts: { start: 'node server.js' },
    dependencies: { mysql2: '^3.11.0', ioredis: '^5.4.1', minio: '^8.0.1' },
  }, null, 2));

  if (opts.ide) addIdeaFiles(add);

  add('.env', [
    '# MySQL（ClickBuild 内置临时实例）',
    `MYSQL_HOST=127.0.0.1`,
    `MYSQL_PORT=${DEFAULT_PORTS.mysql}`,
    `MYSQL_USER=root`,
    `MYSQL_PASSWORD=`,
    `MYSQL_DB=clickbuild`,
    '',
    '# Redis',
    `REDIS_HOST=127.0.0.1`,
    `REDIS_PORT=${DEFAULT_PORTS.redis}`,
    `REDIS_DB=0`,
    '',
    '# 对象存储 RustFS / S3',
    `S3_ENDPOINT=127.0.0.1`,
    `S3_PORT=${DEFAULT_PORTS.s3}`,
    `S3_ACCESS_KEY=clickbuild`,
    `S3_SECRET_KEY=clickbuild123`,
    `S3_SSL=false`,
    '',
    `PORT=${opts.port || DEFAULT_PORTS.http}`,
    `API_PREFIX=/api`,
    '',
  ].join('\n'));

  add('daemon/watchdog.js', `#!/usr/bin/env node
/* ClickBuild 守护进程：拉起 server.js，异常退出后按退避重启 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const log = path.join(__dirname, 'daemon.log');
let child = null;
let stopping = false;
let backoff = 1000;

function write(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  try { fs.appendFileSync(log, line + '\\n'); } catch (_) {}
  console.log(line);
}

function start() {
  child = spawn(process.execPath, [path.join(dir, 'server.js')], { cwd: dir, stdio: 'inherit', env: process.env });
  write('started pid=' + child.pid);
  child.on('exit', (code, signal) => {
    write('exit code=' + code + ' signal=' + signal);
    child = null;
    if (stopping) process.exit(0);
    const delay = backoff;
    backoff = Math.min(backoff * 2, 10000);
    setTimeout(start, delay);
  });
}
function stop() {
  stopping = true;
  if (child) child.kill('SIGTERM');
  else process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
`);

  add('daemon/start.ps1', `# 前台守护：Ctrl+C 结束
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$node = if (Test-Path 'runtime\\node\\node.exe') { 'runtime\\node\\node.exe' } else { 'node' }
& $node 'daemon\\watchdog.js'
`);

  add('daemon/install-service.ps1', `# 登录自启（不需要管理员）；卸载：schtasks /Delete /TN "<任务名>" /F
param([string]$TaskName = 'ClickBuild_${slug(p.name, 'service')}')
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $PSScriptRoot
$node = if (Test-Path (Join-Path $dir 'runtime\\node\\node.exe')) { Join-Path $dir 'runtime\\node\\node.exe' } else { 'node' }
$cmd = '"' + $node + '" "' + (Join-Path $dir 'daemon\\watchdog.js') + '"'
schtasks /Create /TN $TaskName /TR $cmd /SC ONLOGON /RL LIMITED /F
if ($LASTEXITCODE -ne 0) { throw 'schtasks 创建失败，可改用 daemon\\start.ps1 手动前台启动' }
Write-Host "已创建登录自启任务：$TaskName"
`);

  add('README.md', [
    `# ${p.name}`,
    '',
    'ClickBuild 生成的接口服务：一个接口挂多张表，每条路由一段脚本。',
    '',
    `- 接口数：${p.interfaces.length}`,
    `- 表数：${p.interfaces.reduce((n, i) => n + i.tables.length, 0)}`,
    `- 路由数：${p.interfaces.reduce((n, i) => n + i.routes.length, 0)}`,
    '',
    '```bash',
    'node server.js',
    '```',
    '',
    `启动后：控制台 http://127.0.0.1:${opts.port || DEFAULT_PORTS.http}/ ，文档 /docs ，路由清单 /_routes ，元信息 /_meta ，日志流 /_logs/stream 。`,
    '',
    '- 数据落 MySQL，GET 结果可走 Redis 旁路缓存，附件进 RustFS。',
    '- 写路由可开事务（guard.tx），脚本异常自动回滚并写 FATAL 日志。',
    '- 路由支持限流（rate）、时间窗（schedule）、熔断（breaker）、token 鉴权（auth）。',
    '- 日志可按等级落库：`sys_log` 表（可在项目里改库/表）。',
    '- 账号体系：注册签发唯一ID + token（Redis 会话），密码 SM4 加密存储。',
    '',
    '## 守护进程',
    '',
    '- 前台守护：`powershell -ExecutionPolicy Bypass -File daemon/start.ps1`（崩溃自动重启，日志 `daemon/daemon.log`）',
    '- 登录自启：`powershell -ExecutionPolicy Bypass -File daemon/install-service.ps1`（创建计划任务，名字可传参）',
  ].join('\n'));

  p.interfaces.forEach((it) => {
    const mainTable = ((it.tables || []).find((t) => (t.key || 'main') === 'main') || (it.tables || [])[0] || {}).name || '';
    (it.routes || []).forEach((r, ri) => {
      const base = `${slug(mainTable || it.name, 'iface')}-${slug(r.kind || r.name, `route-${ri + 1}`)}-${ri + 1}`;
      add(`export/js/${base}.js`, exportJs(it, r));
      add(`export/java/${base}.java`, exportJava(it, r));
      add(`export/go/${base}.go`, exportGo(it, r));
    });
  });

  return { project: p, files, ports: DEFAULT_PORTS };
}

function writeTo(project, outDir, options) {
  const result = generate(project, options);
  const dir = outDir;
  fs.mkdirSync(dir, { recursive: true });
  for (const f of result.files) {
    const full = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content, 'utf8');
  }
  return { dir, files: result.files.map((f) => f.path), project: result.project };
}

module.exports = { DEFAULT_PORTS, generate, writeTo, slug, exportJs, exportJava, exportGo, buildOpenApi, docsPage };
