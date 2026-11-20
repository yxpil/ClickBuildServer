'use strict';

const fs = require('fs');
const path = require('path');
const spec = require('./spec');
const script = require('./script');
const docs = require('./docs');
const native = require('./native');
const fe = require('./frontend');
const testgen = require('./testgen');

const DEFAULT_PORTS = { mysql: 13306, redis: 16379, s3: 19000, s3Console: 19001, http: 18100 };

// 导出工程的主配置文件。键名和运行时的环境变量一一对应，
// Node / Python / Go / Java 都优先读 process.env，再读 config.json，最后用内置默认值。
function runtimeConfig(project, opts) {
  const p = project || {};
  const o = opts || {};
  return {
    PORT: Number(o.port || DEFAULT_PORTS.http),
    API_PREFIX: '/api',
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: DEFAULT_PORTS.mysql,
    MYSQL_USER: 'root',
    MYSQL_PASSWORD: '',
    MYSQL_DB: 'clickbuild',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: DEFAULT_PORTS.redis,
    REDIS_DB: 0,
    S3_ENDPOINT: '127.0.0.1',
    S3_PORT: DEFAULT_PORTS.s3,
    S3_ACCESS_KEY: 'clickbuild',
    S3_SECRET_KEY: 'clickbuild123',
    S3_SSL: false,
    ERROR_PAGES: (p.errors && p.errors.pages) !== false,
    ERROR_DETAIL: (p.errors && p.errors.detail) !== false,
    LOG_LEVEL: 'INFO',
    CACHE_PREFIX: `icb:cache:${p.name || 'project'}`,
    MAX_BODY_MB: 64,
    RESET_DB: false,
  };
}

const CONFIG_KEYS = [
  ['PORT', '服务端口'],
  ['API_PREFIX', '接口前缀'],
  ['MYSQL_HOST', 'MySQL 主机'],
  ['MYSQL_PORT', 'MySQL 端口'],
  ['MYSQL_USER', 'MySQL 用户'],
  ['MYSQL_PASSWORD', 'MySQL 密码'],
  ['MYSQL_DB', 'MySQL 数据库'],
  ['REDIS_HOST', 'Redis 主机'],
  ['REDIS_PORT', 'Redis 端口'],
  ['REDIS_DB', 'Redis 库号'],
  ['S3_ENDPOINT', 'S3 主机'],
  ['S3_PORT', 'S3 端口'],
  ['S3_ACCESS_KEY', 'S3 AccessKey'],
  ['S3_SECRET_KEY', 'S3 SecretKey'],
  ['S3_SSL', 'S3 是否 HTTPS'],
  ['ERROR_PAGES', '是否启用错误页'],
  ['ERROR_DETAIL', '500 是否显示详情'],
  ['LOG_LEVEL', '日志等级'],
  ['CACHE_PREFIX', 'Redis 缓存前缀'],
  ['MAX_BODY_MB', '请求体上限 MB'],
  ['RESET_DB', '启动时重置数据库'],
];

function slug(text, fallback) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || (fallback || 'item');
}

function pascal(text, fallback) {
  let s = String(text || '').split(/[^a-z0-9]+/i).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  if (!s) s = fallback || 'Route';
  if (!/^[A-Za-z]/.test(s)) s = 'X' + s;
  return s;
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

function exportJava(iface, route, base) {
  const cls = pascal(base || `${slug(iface.name, 'iface')}-${slug(route.method, 'route')}-${slug(route.path, 'path')}`, 'Route');
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

function exportGo(iface, route, base) {
  const suffix = pascal(base || `${slug(iface.name, 'iface')}-${slug(route.method, 'route')}-${slug(route.path, 'path')}`, 'Route');
  const fn = `Handle${suffix}`;
  const sqls = (route.script || '').split(/\r?\n/).filter((l) => /^(LET\s+\$[A-Za-z0-9_]+\s*=\s*)?(QUERY|EXEC)\s+/i.test(l.trim()));
  return `// 自动导出：${iface.name} / ${route.name} — ${route.method} ${route.path}
// Go 侧给的是"路由 + SQL"骨架，占位符与服务器一致，换成 database/sql 即可。
package export

import "context"

const (
	Method${suffix} = "${route.method}"
	Path${suffix}   = "${route.path}"
)

var SqlList${suffix} = []string{
${sqls.map((l) => `\t"${l.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/^.*?(QUERY|EXEC)\s+/i, '')}",`).join('\n')}
}

func ${fn}(ctx context.Context, params map[string]any) (map[string]any, error) {
	// TODO 用 sqlx / database/sql 执行 SqlList${suffix}，并按脚本逻辑组装结果
	return map[string]any{"ok": true}, nil
}
`;
}

function buildOpenApi(project, port) {
  const p = spec.normalizeProject(project);
  const paths = {};
  p.interfaces.forEach((iface) => {
    (iface.routes || []).forEach((route) => {
      const facts = docs.inferRouteDocs(iface, route);
      const doc = docs.mergeRouteDocs(iface, route);
      const full = (`/api${iface.basePath || ''}${route.path}`).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const responses = { 200: { description: '成功' } };
      for (const e of facts.errors || []) responses[e.status] = { description: `${e.code}：${e.message}` };
      if (route.auth && !responses[401]) responses[401] = { description: 'UNAUTHORIZED：未登录或 token 无效' };
      const op = {
        tags: [iface.name],
        summary: doc.summary,
        description: [
          doc.description,
          (iface.docs && iface.docs.description) || iface.comment || '',
          (route.docs && route.docs.notes) || '',
        ].filter(Boolean).join('\n\n'),
        operationId: `${iface.id}_${route.key}_${route.method}`.replace(/[^A-Za-z0-9_]/g, '_'),
        responses,
        security: route.auth ? [{ bearer: [] }] : undefined,
        'x-clickbuild': { kind: route.key, io: route.io, tx: !!(route.guard && route.guard.tx), cache: route.cache },
        'x-examples': {
          request: doc.requestExample,
          response: doc.responseExample,
        },
      };
      const params = (facts.parameters || []).filter((x) => x.in !== 'body').map((x) => ({
        name: x.name,
        in: x.in,
        required: !!x.required,
        description: x.description,
        example: x.example,
        schema: x.schema,
      }));
      if (params.length) op.parameters = params;
      const bodyParams = (facts.parameters || []).filter((x) => x.in === 'body');
      if (bodyParams.length) {
        const props = {};
        for (const x of bodyParams) {
          props[x.name] = { ...x.schema, description: x.description, example: x.example };
          if (x.name === 'file') props[x.name] = { type: 'string', format: 'binary', description: x.description };
        }
        op.requestBody = {
          required: true,
          content: {
            [bodyParams.some((x) => x.name === 'file') ? 'multipart/form-data' : 'application/json']: {
              schema: { type: 'object', properties: props },
            },
          },
        };
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

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function docsPage(project, port) {
  const specOut = buildOpenApi(project, port);
  const rows = [];
  spec.normalizeProject(project).interfaces.forEach((iface) => {
    (iface.routes || []).forEach((route) => {
      const doc = docs.mergeRouteDocs(iface, route);
      const facts = docs.inferRouteDocs(iface, route);
      const detail = [
        doc.requestExample ? `<details><summary>请求示例</summary><pre>${escHtml(doc.requestExample)}</pre></details>` : '',
        doc.responseExample ? `<details><summary>响应示例</summary><pre>${escHtml(doc.responseExample)}</pre></details>` : '',
        facts.errors.length ? `<details><summary>错误码</summary><ul>${facts.errors.map((e) => `<li><code>${e.status} ${escHtml(e.code)}</code> ${escHtml(e.message)}</li>`).join('')}</ul></details>` : '',
      ].join('');
      rows.push(`<tr><td>${route.method}</td><td><code>${escHtml('/api' + (iface.basePath || '') + route.path)}</code></td><td>${escHtml(iface.name)}</td><td>${escHtml(route.name)}</td><td>${escHtml(doc.summary)}${doc.description ? `<div class="muted">${escHtml(doc.description).replace(/\n/g, '<br>')}</div>` : ''}${detail}</td><td>${route.auth ? 'token' : '—'}</td><td>${route.guard && route.guard.tx ? '事务' : ''}${route.cache && route.cache.enabled ? ' 缓存' : ''}${route.guard && route.guard.rate && route.guard.rate.enabled ? ` ${route.guard.rate.limit}/${route.guard.rate.window}s` : ''}</td></tr>`);
    });
  });
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escHtml(specOut.info.title)}</title>
<style>body{font:13px/1.6 -apple-system,Segoe UI,"Microsoft YaHei",sans-serif;margin:32px;color:#111;background:#fff}h1{font-size:20px;font-weight:600}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #e2e2e2;padding:6px 8px;text-align:left;vertical-align:top}th{background:#fafafa;font-weight:500}code,pre{font-family:ui-monospace,Consolas,monospace}pre{background:#f7f7f4;border:1px solid #e4e4de;padding:8px;max-width:720px;overflow:auto;white-space:pre-wrap}.muted{color:#666;margin-top:4px}details{margin-top:6px}a{color:#111}</style>
<h1>${escHtml(specOut.info.title)} <small>v${escHtml(specOut.info.version)}</small></h1><p>${escHtml(specOut.info.description || '')}</p>
<p><a href="/_docs">OpenAPI JSON</a> · <a href="/_meta">元信息</a> · <a href="/_routes">路由</a></p>
<table><thead><tr><th>方法</th><th>路径</th><th>接口</th><th>名称</th><th>说明与示例</th><th>鉴权</th><th>特性</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<p style="color:#777;margin-top:24px">文档由 ClickBuild 从路由脚本自动推导 · ${new Date().toISOString()}</p></body></html>`;
}

function addIdeaFiles(add, runtime, runtimeOnly) {
  runtime = String(runtime || 'node').toLowerCase();
  const nodeRun = !runtimeOnly || runtime === 'node' || runtime === 'bun';
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
  if (nodeRun) add('.run/启动接口服务.run.xml', `<component name="ProjectRunConfigurationManager">
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

function moduleDirName(it, idx) {
  const label = String(it.name || it.id || 'iface').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').trim() || 'iface';
  return `${String(idx + 1).padStart(2, '0')}_${label}`;
}

function moduleSource(it) {
  const data = JSON.parse(JSON.stringify(it || {}));
  return `'use strict';

// 模块：${data.name || data.id || '未命名接口'}
// 一个接口 = 一个模块。服务启动时由 src/modules/index.js 自动加载，不需要改 server.js。
// 可直接在下面改 routes / tables，也可以在 routes 里加 handler 写自定义逻辑。

module.exports = ${JSON.stringify(data, null, 2)};

/*
扩展示例：

module.exports.setup = async (api) => {
  // 数据库、Redis、对象存储都已就绪；适合建索引、预热缓存、启动定时任务
};

module.exports.routes.push({
  id: '${data.id || 'iface'}_custom_ping',
  key: 'custom',
  method: 'GET',
  path: '/ping',
  name: '自定义 ping',
  summary: '不走脚本，直接返回模块状态',
  handler: async (ctx, api) => ({ ok: true, module: '${data.name || data.id || 'iface'}', at: new Date().toISOString() }),
});
*/
`;
}

function moduleReadme(it) {
  const routes = (it.routes || []).map((r) => `| ${r.method} | \`${(it.basePath || '') + (r.path || '')}\` | ${r.name || ''} | ${r.script ? '脚本' : (r.handler ? 'handler' : '—')} |`).join('\n');
  return `# 模块：${it.name || it.id}

这个目录就是一个独立接口模块，运行时由 \`src/modules/index.js\` 自动发现。

## 路由

| 方法 | 路径 | 名称 | 实现 |
| --- | --- | --- | --- |
${routes || '| - | - | - | - |'}

## 扩展

- 改路由：直接编辑 \`index.js\` 的 \`routes\`，服务重启后生效。
- 自定义逻辑：给路由加 \`handler\`，返回对象即响应体；\`return { status: 201, body: {...} }\` 可指定状态码。
- handler 可用 \`api.db.query / api.db.execute\`、\`api.redis\`、\`api.s3\`、\`api.log\`。
- 模块初始化：导出 \`async setup(api)\`，在数据库、Redis、对象存储就绪后调用；\`api.db.query / execute\` 可直接用，默认走本模块第一张表的连接。
- 新增模块：在 \`src/modules/\` 下新建目录并放 \`index.js\`，无需改 \`server.js\`。
`;
}

function modulesRegistry() {
  return `'use strict';

// 模块注册表：扫描本目录下的每个子目录，加载 index.js。
// 新增接口模块只要放一个目录进来；顺序按目录名前缀（01_、02_...）。
const fs = require('fs');
const path = require('path');

const modules = [];
for (const ent of fs.readdirSync(__dirname, { withFileTypes: true })) {
  if (!ent.isDirectory() || ent.name.startsWith('_')) continue;
  const file = path.join(__dirname, ent.name, 'index.js');
  if (!fs.existsSync(file)) continue;
  const mod = require(file);
  const m = mod && mod.default ? mod.default : mod;
  if (!m || !m.id) {
    console.error('[modules] 跳过无效模块', ent.name);
    continue;
  }
  m.__dir = ent.name;
  modules.push(m);
}

module.exports = modules;
`;
}

function generate(project, options) {
  const opts = options || {};
  const runtime = String(opts.runtime || 'node').toLowerCase();
  const runtimeOnly = !!opts.runtimeOnly;
  const wantNode = !runtimeOnly || runtime === 'node' || runtime === 'bun';
  const wantGo = !runtimeOnly || runtime === 'go';
  const wantJava = !runtimeOnly || runtime === 'java';
  const wantPython = !runtimeOnly || runtime === 'python';
  const runtimeName = ({ node: 'Node.js', bun: 'Bun', go: 'Go 原生', java: 'Java 原生', python: 'Python Flask' })[runtime] || 'Node.js';
  let p = spec.normalizeProject(project);
  if (Array.isArray(opts.only) && opts.only.length) {
    p = { ...p, interfaces: p.interfaces.filter((i) => opts.only.includes(i.id) || opts.only.includes(i.name)) };
  }
  if (opts.category) {
    p = { ...p, interfaces: p.interfaces.filter((i) => i.categoryId === opts.category) };
  }
  const files = [];
  const testSuite = testgen.build(p, { port: opts.port || DEFAULT_PORTS.http });

  const add = (rel, content) => files.push({ path: rel, content: String(content).replace(/\r\n/g, '\n') });

  if (wantNode) {
  add('server.js', template('server.js'));
  add('src/render.js', engine('render.js'));
  add('src/funcs.js', engine('funcs.js'));
  add('src/rowstore.js', engine('rowstore.js'));
  add('src/script.js', engine('script.js'));
  add('public/console.html', template('console.html'));
  if (p.seed && p.seed.enabled && p.seed.sql) add('src/seed.json', JSON.stringify(p.seed, null, 2));
  }

  p.interfaces.forEach((it, idx) => {
    const name = `${String(idx + 1).padStart(2, '0')}_${slug(it.name, 'iface')}.sql`;
    add(`sql/${name}`, `-- 接口：${it.name}\n-- ${it.comment || ''}\n\n${spec.ddlOf(it)}\n`);
  });

  if (wantNode) {
  // 模块化单体：每个接口一个目录，server.js 只负责通用运行时。
  add('src/modules/index.js', modulesRegistry());
  add('src/modules/README.md', [
    '# 接口模块',
    '',
    '每个子目录是一个接口模块，`index.js` 导出接口定义（tables / routes / storage / docs）。',
    '服务启动时按目录名排序自动加载；新接口由 ClickBuild 生成，也可以手写目录。',
    '',
    '- `handler(ctx, api)`：路由级自定义逻辑，优先于脚本执行。',
    '- `setup(api)`：模块初始化钩子，在 MySQL / Redis / S3 就绪后执行。',
    '- `src/modules/_` 开头的目录不会被加载，可放草稿或公共代码。',
  ].join('\n'));
  p.interfaces.forEach((it, idx) => {
    const dir = moduleDirName(it, idx);
    add(`src/modules/${dir}/index.js`, moduleSource(it));
    add(`src/modules/${dir}/README.md`, moduleReadme(it));
  });
  }

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
      `# ${yxpp.name}`, '', '这是随接口服务一起打包的 ClickBuild 前端工程（.yxpp）。',
      '', '- 生成服务的 `/` 会优先返回该前端页面。', '- 可以在 ClickBuild 的「前端」模式里继续编辑，再导出 .yxpp。',
    ].join('\n'));
    let html = p.frontend.html || '';
    if (p.frontend.project && p.frontend.project.app && p.frontend.project.app.mode) {
      html = fe.htmlFromProject(p.frontend.project, { name: yxpp.name });
      yxpp.html = html;
      add('frontend/index.yxpp', JSON.stringify(yxpp, null, 2));
    }
    if (html) add('public/index.html', html);
  }

  add('interfaces.json', JSON.stringify({
    name: p.name, description: p.description, categories: p.categories,
    functions: p.functions, interfaces: p.interfaces,
    connections: p.connections, log: p.log, token: p.token, docs: p.docs, errors: p.errors,
    services: p.services, theme: p.theme, isolation: p.isolation,
    upstreams: p.upstreams, permissions: p.permissions,
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

  // 自动测试套件：与接口一起生成，默认只读，写入生命周期需显式开启。
  add('tests/api.test.js', testSuite.test);
  add('tests/plan.json', JSON.stringify(testSuite.plan, null, 2));
  add('tests/README.md', testSuite.readme);

  if (wantNode) {
  add('package.json', JSON.stringify({
    name: slug(p.name, 'clickbuild-server'),
    version: '1.0.0',
    private: true,
    description: p.description || 'ClickBuild 生成的接口服务',
    main: 'server.js',
    scripts: { start: 'node server.js', dev: 'node dev.js', hot: 'node dev.js', 'test:api': 'node --test tests/api.test.js' },
    dependencies: { mysql2: '^3.11.0', ioredis: '^5.4.1', minio: '^8.0.1', alasql: '^4.23.1' },
  }, null, 2));
  }

  if (opts.ide) addIdeaFiles(add, runtime, runtimeOnly);

  const conf = runtimeConfig(p, opts);
  add('config.json', JSON.stringify(conf, null, 2));
  add('.env', [
    '# config.json 是主配置；本文件只作为可选的本地覆盖。',
    '# 需要覆盖时取消下面对应行的注释，或直接用真正的系统环境变量。',
    '# 优先级：系统环境变量 > config.json > 本文件。',
    '',
    ...CONFIG_KEYS.map(([k, label]) => `# ${k}=${JSON.stringify(conf[k])}   # ${label}`),
    '',
  ].join('\n'));

  // 语言版服务：Go 原生运行时。和 server.js 共用同一份项目快照和 AST，
  // 启动后不再调用 Node，可直接 go run / go build。
  const snapshot = native.serviceSnapshot(p);
  if (wantGo) {
  add('native/go/service.json', JSON.stringify(snapshot, null, 2));
  native.runtimeFiles('go').forEach((f) => add(`native/go/${f.path}`, f.content));
  const goModule = `clickbuild.native/${slug(p.name, 'service')}`;
  add('native/go/go.mod', [
    `module ${goModule}`,
    '',
    'go 1.21',
    '',
    'require (',
    '\tgithub.com/emmansun/gmsm v0.30.1',
    '\tgithub.com/go-sql-driver/mysql v1.9.3',
    ')',
    '',
  ].join('\n'));
  add('native/go/README.md', [
    `# ${p.name} · Go 原生服务`,
    '',
    '这个目录不是 Node 启动器，而是直接读取 `service.json`、用 Go 执行脚本和 SQL 的独立服务。',
    '',
    '```bash',
    'go mod tidy',
    'go run .',
    '```',
    '',
    `默认端口与接口前缀读工程根目录 \`config.json\`（键名 \`PORT\` / \`API_PREFIX\`），数据库读 \`MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DB\`；系统环境变量可覆盖配置文件。`,
    '',
    '支持：路由匹配、脚本 IF / FOREACH / RETURN、SQL 占位符、MySQL 查询与写入、TOKEN 会话、内置函数、上传落本地 `uploads/`。',
    '尚未接入：Redis 缓存/发布、S3、外部 HTTP 调用；这些路由会明确报错，不会静默返回假数据。',
    '',
  ].join('\n'));
  }

  // Java 原生运行时：同一份 service.json，JDK + JDBC 直连 MySQL，不启动 Node。
  if (wantJava) {
  add('native/java/service.json', JSON.stringify(snapshot, null, 2));
  native.runtimeFiles('java').forEach((f) => add(`native/java/${f.path}`, f.content));
  add('native/java/README.md', [
    `# ${p.name} · Java 原生服务`,
    '',
    '这个目录用 JDK 直接运行，读取 `service.json` 执行脚本与 SQL，不再启动 Node 启动器。',
    '',
    '```bash',
    'javac -encoding UTF-8 -cp "lib/*" -d bin src/icb/*.java',
    'java -cp "bin;lib/*" icb.Main',
    '```',
    '',
    `默认端口与接口前缀读工程根目录 \`config.json\`（键名 \`PORT\` / \`API_PREFIX\`），数据库读 \`MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DB\`；系统环境变量可覆盖配置文件。`,
    '',
    '依赖 `lib/` 内的 MySQL Connector/J、Gson、BouncyCastle，支持 SM4、AES、TOKEN、事务、上传与脚本内置函数。',
    '尚未接入：Redis 缓存/发布、S3、外部 HTTP 调用；这些路由会明确报错，不会静默返回假数据。',
    '',
  ].join('\n'));
  }

  if (wantPython) {
  add('native/python/service.json', JSON.stringify(snapshot, null, 2));
  native.runtimeFiles('python').forEach((f) => add(`native/python/${f.path}`, f.content));
  add('native/python/README.md', [
    `# ${p.name} · Python Flask 原生服务`,
    '',
    '直接读取 `service.json`，用 Flask + PyMySQL 执行同一套脚本 AST，不启动 Node。',
    '',
    '```bash',
    'cd native/python',
    'python -m venv .venv',
    '.venv\\Scripts\\activate   # Linux/macOS: source .venv/bin/activate',
    'pip install -r requirements.txt',
    'python app.py',
    '```',
    '',
    '支持：路由匹配、IF / FOREACH / RETURN / LET QUERY / EXEC / TX / WAIT / HTTP / CRAWL / TOKEN、SQL 占位符、上传、对象表、上游转发、角色权限。',
    '配置：工程根目录 `config.json` 管端口、MySQL、Redis、S3；系统环境变量优先，`config.json` 次之。',
    '说明：Python 运行时直连 MySQL；Redis / S3 连接不上时会降级为内存 token / 本地 `uploads/`，并在启动日志中标注。',
    '',
  ].join('\n'));
  }

  if (wantNode) {
  add('dev.js', `#!/usr/bin/env node
/* ClickBuild 热部署：监听 src / public / sql / interfaces.json，文件变化后自动重启 server.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
let child = null;
let stopping = false;
let expectedExit = 0;
let pending = false;
let debounce = null;

function start() {
  if (stopping) return;
  pending = false;
  child = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, HOT_RELOAD: '1' } });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) { process.exit(0); return; }
    if (expectedExit > 0) { expectedExit -= 1; return; }
    console.log('[dev] server exit code=' + code + ' signal=' + signal + '，600ms 后重启');
    setTimeout(start, 600);
  });
}

function restart() {
  if (stopping) return;
  if (!child) { start(); return; }
  if (pending) return;
  pending = true;
  const old = child;
  expectedExit += 1;
  console.log('[dev] 检测到文件变化，重启服务…');
  old.once('exit', () => setTimeout(() => { pending = false; start(); }, 300));
  old.kill('SIGTERM');
  setTimeout(() => { try { if (old && old.exitCode == null) old.kill('SIGKILL'); } catch (_) {} }, 900);
}

function shouldWatch(file) {
  const p = String(file || '').replace(/\\\\/g, '/');
  if (/node_modules|\\.git|package-lock|dev\\.js|daemon\\.log|\\.log$/.test(p)) return false;
  return /^src\\/|^public\\/|^sql\\/|^interfaces\\.json$|^server\\.js$|^frontend\\//.test(p);
}

function watch() {
  try {
    fs.watch(ROOT, { recursive: true }, (event, file) => {
      if (!shouldWatch(file)) return;
      clearTimeout(debounce);
      debounce = setTimeout(restart, 350);
    });
    console.log('[dev] 热部署已开启：src/ · public/ · sql/ · interfaces.json');
  } catch (e) {
    console.error('[dev] 文件监听失败：' + e.message);
  }
}

function stop() { stopping = true; if (child) child.kill('SIGTERM'); else process.exit(0); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

start();
watch();
`);

  add('go.mod', `module clickbuild.export

go 1.21
`);

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
  }

  if (wantNode) {
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
    'node server.js      # 普通启动',
    'node dev.js         # 热部署：改 src/public/sql/interfaces.json 自动重启',
    '```',
    '',
    `启动后：控制台 http://127.0.0.1:${opts.port || DEFAULT_PORTS.http}/ ，文档 /docs ，路由清单 /_routes ，元信息 /_meta ，日志流 /_logs/stream 。`,
    `错误页：浏览器请求 404/500 默认显示错误页；API 客户端仍收到 JSON。预览：/_errors/404 、/_errors/500 。`,
    '',
    '## 配置文件',
    '',
    '- 根目录 `config.json` 是主配置：端口、接口前缀、MySQL、Redis、S3、错误页、日志等级、请求体上限都在这里改。',
    '- 键名与运行时环境变量一一对应，例如 `MYSQL_DB`、`MYSQL_PASSWORD`、`PORT`。',
    '- 优先级：系统环境变量 > `config.json` > `.env`；改完重启服务生效。',
    '- Node、Python Flask、Go、Java 四套运行时都读同一份 `config.json`。',
    '',
    '- 数据落 MySQL，GET 结果可走 Redis 旁路缓存，附件进 RustFS。',
    '- 写路由可开事务（guard.tx），脚本异常自动回滚并写 FATAL 日志。',
    '- 路由支持限流（rate）、时间窗（schedule）、熔断（breaker）、token 鉴权（auth）。',
    '- 日志可按等级落库：`sys_log` 表（可在项目里改库/表）。',
    '- 账号体系：注册签发唯一ID + token（Redis 会话），密码 SM4 加密存储。',
    '',
    '## 启动方式',
    '',
    '- Node：`node server.js`，热部署 `node dev.js`',
    '- Bun：`bun server.js`，热部署 `bun dev.js`',
    '- Java 原生（需 JDK 17+）：`cd native/java && javac -encoding UTF-8 -cp "lib/*" -d bin src/icb/*.java && java -cp "bin;lib/*" icb.Main`',
    '- Go 原生（需 Go 1.21+）：`cd native/go && go mod tidy && go run .`；`export/go/` 下的 Go 路由骨架已带 `go.mod`，可 `go build ./export/go` 做编译检查',
    '',
    '## 守护进程',
    '',
    '- 前台守护：`powershell -ExecutionPolicy Bypass -File daemon/start.ps1`（崩溃自动重启，日志 `daemon/daemon.log`）',
    '- 登录自启：`powershell -ExecutionPolicy Bypass -File daemon/install-service.ps1`（创建计划任务，名字可传参）',
  ].join('\n'));
  } else {
  add('README.md', [
    `# ${p.name}`,
    '',
    `ClickBuild 生成的 **${runtimeName}** 接口服务。本目录只包含这一套服务端实现，不再附带其它运行时。`,
    '',
    `- 接口数：${p.interfaces.length}`,
    `- 表数：${p.interfaces.reduce((n, i) => n + i.tables.length, 0)}`,
    `- 路由数：${p.interfaces.reduce((n, i) => n + i.routes.length, 0)}`,
    '',
    '## 启动',
    '',
    ...({
      go: ['```bash', 'cd native/go', 'go mod tidy', 'go run .', '```', '', '需要 Go 1.21+；可直接 `go build` 生成独立二进制。'],
      java: ['```bash', 'cd native/java', 'javac -encoding UTF-8 -cp "lib/*" -d bin src/icb/*.java', 'java -cp "bin;lib/*" icb.Main', '```', '', '需要 JDK 17+。'],
      python: ['```bash', 'cd native/python', 'python -m venv .venv', '.venv\\Scripts\\activate', 'pip install -r requirements.txt', 'python app.py', '```', '', 'Linux/macOS 用 `source .venv/bin/activate`。'],
    }[runtime] || []),
    '',
    '## 配置',
    '',
    '- 根目录 `config.json` 管端口、接口前缀、MySQL、Redis、S3、错误页、日志与请求体上限。',
    '- 优先级：系统环境变量 > `config.json` > `.env`；改完重启服务生效。',
    '- `sql/` 是建表脚本，`docs/` 是接口文档，`public/` 是生成的前端。',
    '',
    `启动后打开 http://127.0.0.1:${opts.port || DEFAULT_PORTS.http}/ 。`,
  ].join('\n'));
  }

  add('runtime.json', JSON.stringify({ runtime, name: runtimeName, port: Number(opts.port || DEFAULT_PORTS.http) }, null, 2));
  const runLines = [
    `# ${p.name} · 运行方式`,
    '',
    runtimeOnly
      ? `导出时选择的类型：**${runtimeName}**。本目录只包含这一套服务端实现，共用 \`config.json\` 和 \`public/\` 前端。`
      : `导出时选择的主运行时：**${runtimeName}**。同一个工程目录带 Node / Go / Java / Python 四套服务端实现，共用 \`service.json\`、\`config.json\` 和 \`public/\` 前端。`,
    '',
    '## 1. ' + runtimeName,
    '',
    ...({
      node: ['```bash', 'npm install', 'node server.js', '```', '', '热部署：`node dev.js`。'],
      bun: ['```bash', 'bun install', 'bun server.js', '```', '', '热部署：`bun dev.js`。'],
      go: ['```bash', 'cd native/go', 'go mod tidy', 'go run .', '```', '', '编译后可直接运行二进制，不依赖 Node。'],
      java: ['```bash', 'cd native/java', 'javac -encoding UTF-8 -cp "lib/*" -d bin src/icb/*.java', 'java -cp "bin;lib/*" icb.Main', '```', '', '需要 JDK 17+，不依赖 Node。'],
      python: ['```bash', 'cd native/python', 'python -m venv .venv', '.venv\\Scripts\\activate', 'pip install -r requirements.txt', 'python app.py', '```', '', 'Linux/macOS 用 `source .venv/bin/activate`，不依赖 Node。'],
    }[runtime] || []),
    '',
  ];
  if (!runtimeOnly) {
    runLines.push(
      '## 2. 其它运行时',
      '',
      '- Node.js：`node server.js` / 热部署 `node dev.js`',
      '- Bun：`bun server.js` / 热部署 `bun dev.js`',
      '- Go：`cd native/go && go mod tidy && go run .`',
      '- Java：`cd native/java && javac -encoding UTF-8 -cp "lib/*" -d bin src/icb/*.java && java -cp "bin;lib/*" icb.Main`',
      '- Python：`cd native/python && pip install -r requirements.txt && python app.py`',
      '',
    );
  }
  runLines.push(
    `数据库、Redis、S3、端口都在根目录 \`config.json\`；系统环境变量优先。启动后打开 http://127.0.0.1:${opts.port || DEFAULT_PORTS.http}/ 。`,
    '',
    '## 前端',
    '',
    '`public/index.html` 由 `.yxpp` 生成，`frontend/index.yxpp` 是 PageStudio 工程源文件。修改 `.yxpp` 后重新导出即可覆盖前端。',
    '',
  );
  add('RUN.md', runLines.join('\n'));

  let routeNo = 0;
  p.interfaces.forEach((it) => {
    const mainTable = ((it.tables || []).find((t) => (t.key || 'main') === 'main') || (it.tables || [])[0] || {}).name || '';
    (it.routes || []).forEach((r) => {
      routeNo += 1;
      const base = `${slug(mainTable || it.name, 'iface')}-${slug(r.kind || r.name, 'route')}-${routeNo}`;
      if (wantNode) add(`export/js/${base}.js`, exportJs(it, r));
      if (wantJava) add(`export/java/${pascal(base, 'Route')}.java`, exportJava(it, r, base));
      if (wantGo) add(`export/go/${base}.go`, exportGo(it, r, base));
    });
  });

  return { project: p, files, ports: DEFAULT_PORTS, tests: testSuite.summary };
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
  // 旧版本生成过 launcher/（Java/Go 启动器已移除）。同一目录重新生成时清掉，
  // 否则用户会看到早就不会再运行的历史文件。
  const legacyLauncher = path.join(dir, 'launcher');
  if (fs.existsSync(legacyLauncher)) fs.rmSync(legacyLauncher, { recursive: true, force: true });
  const runtime = String((options && options.runtime) || 'node').toLowerCase();
  if (!(options && options.runtimeOnly) || runtime === 'java') native.copyAssets('java', dir);  return { dir, files: result.files.map((f) => f.path), project: result.project, tests: result.tests };
}

module.exports = { DEFAULT_PORTS, generate, writeTo, slug, exportJs, exportJava, exportGo, buildOpenApi, docsPage };
