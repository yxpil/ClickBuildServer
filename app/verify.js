'use strict';

const path = require('path');
const vm = require('vm');
const gen = require('./generator');
const { blankProject } = require('./generator/ir');
const { MODULES } = require('./catalog');
const { zip } = require('./generator/zip');

let fails = 0;
const fail = (msg) => {
  fails++;
  console.log('  ✗ ' + msg);
};
const ok = (msg) => console.log('  ✓ ' + msg);

/** 去掉注释与字符串字面量后检查括号配平 */
function balance(src) {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
    i++;
  }
  return { braces, parens, brackets };
}

function checkJava(files, ir) {
  const pkgRoot = `src/main/java/${ir.pkgPath}/`;
  let count = 0;
  files.filter((f) => f.path.endsWith('.java')).forEach((f) => {
    count++;
    const name = path.basename(f.path, '.java');
    const src = String(f.content);

    const pkg = (src.match(/^package\s+([\w.]+);/m) || [])[1];
    if (!pkg) return fail(`${f.path} 缺少 package`);
    const pkgPath = pkg.replace(/\./g, '/') + '/';
    if (!f.path.startsWith(pkgRoot + '') && !f.path.includes(pkgPath)) {
      return fail(`${f.path} package 与路径不一致：${pkg}`);
    }

    const b = balance(src);
    if (b.braces !== 0) fail(`${f.path} 大括号不平衡（${b.braces}）`);
    if (b.parens !== 0) fail(`${f.path} 圆括号不平衡（${b.parens}）`);

    const pub = src.match(new RegExp(`public\\s+(?:final\\s+|abstract\\s+)?(?:class|interface|enum|record)\\s+${name}\\b`));
    if (!pub && !name.endsWith('Application')) {
      const anyType = src.match(/public\s+(?:class|interface|enum|record)\s+(\w+)/);
      if (anyType && anyType[1] !== name) fail(`${f.path} 顶层类型是 ${anyType[1]}，与文件名不符`);
    }

    if (/TODO_GEN|undefined|NaN|\[object Object\]/.test(src)) fail(`${f.path} 存在未替换的模板值`);
    if (/\(\)\s*\(\)/.test(src)) fail(`${f.path} 存在重复调用括号 ()()`);
  });
  ok(`Java 文件 ${count} 个：包名 / 类型名 / 括号 全部通过`);
}

function checkRust(files) {
  let count = 0;
  files.filter((f) => f.path.endsWith('.rs')).forEach((f) => {
    count++;
    const src = String(f.content);
    const b = balance(src);
    if (b.braces !== 0) fail(`${f.path} 大括号不平衡（${b.braces}）`);
    if (b.parens !== 0) fail(`${f.path} 圆括号不平衡（${b.parens}）`);
    if (/undefined|NaN|\[object Object\]/.test(src)) fail(`${f.path} 存在未替换的模板值`);
    if (/fn\s+\w+[^(\n]*\//.test(src)) fail(`${f.path} 疑似非法函数名（含斜杠）`);
  });
  ok(`Rust 文件 ${count} 个：括号配平`);
}

function checkNode(files) {
  const js = files.filter((f) => f.path.endsWith('.js'));
  if (!js.length) return fail('Node 工程没有任何 .js 文件');
  js.forEach((f) => {
    const src = String(f.content);
    try {
      new vm.Script(src, { filename: f.path });
    } catch (err) {
      fail(`${f.path} 语法错误：${err.message}`);
    }
    if (/REPLACE_MODULE|\[object Object\]/.test(src)) fail(`${f.path} 存在未替换的模板值`);
  });

  // require('./x') 必须能找到同目录文件
  const paths = new Set(files.map((f) => f.path));
  files.filter((f) => f.path.endsWith('.js')).forEach((f) => {
    const src = String(f.content);
    const dir = path.posix.dirname(f.path);
    const re = /require\(\s*'\.\/([^']+)'\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const target = path.posix.join(dir, m[1]);
      if (!paths.has(target) && !paths.has(`${target}.js`)) {
        fail(`${f.path} require('./${m[1]}') 没有对应文件`);
      }
    }
  });
  ok(`Node 文件 ${js.length} 个：语法 / 模板值 / require 路径 全部通过`);
}

function checkGo(files) {
  const gos = files.filter((f) => f.path.endsWith('.go'));
  if (!gos.length) return fail('Go 工程没有任何 .go 文件');
  const mod = (files.find((f) => f.path === 'go.mod') || {}).content || '';
  if (!/module\s+\S+/.test(mod)) fail('go.mod 缺少 module 声明');
  gos.forEach((f) => {
    const src = String(f.content);
    const b = balance(src);
    if (b.braces !== 0) fail(`${f.path} 大括号不平衡（${b.braces}）`);
    if (b.parens !== 0) fail(`${f.path} 圆括号不平衡（${b.parens}）`);
    if (/REPLACE_MODULE|\[object Object\]/.test(src)) fail(`${f.path} 存在未替换的模板值`);
  });
  ok(`Go 文件 ${gos.length} 个：括号配平 / module / 模板值 全部通过`);
}

function checkBlocks(files, ir) {
  const blocks = ir.blocks || [];
  if (!blocks.length) return;
  const paths = new Set(files.map((f) => f.path));
  const lang = ir.project.lang;
  blocks.forEach((b) => {
    if (!b.id) return fail('存在没有 id 的积木');
    if (lang === 'node' && !paths.has('src/blocks.js')) fail('Node 缺少 src/blocks.js');
    if (lang === 'go' && !paths.has('internal/blocks/blocks.go')) fail('Go 缺少 internal/blocks/blocks.go');
    if (lang === 'java' && !paths.has('src/main/java/com/clickbuild/modules/blocks/BlockRegistry.java')) {
      const javaBlock = files.find((f) => f.path.endsWith('/blocks/BlockRegistry.java'));
      if (!javaBlock) fail('Java 缺少 BlockRegistry.java');
    }
    const routes = files.filter((f) => String(f.content).includes(b.id));
    if (!routes.length) fail(`积木 ${b.id} 没有被任何产物引用`);
  });
  ok(`自定义积木 ${blocks.length} 个：注册文件与路由均已生成`);
}

function checkVerify(files, ir) {
  if (!(ir.modules || []).some((m) => m.id === 'verify-code')) return;
  const lang = ir.project.lang;
  if (lang === 'rust') return ok('Rust 为实验性目标：验证码只保留表结构，未生成接口');
  const hit = files.filter((f) => /verifycode|verifyCode/i.test(f.path));
  if (!hit.length) fail(`${lang} 缺少验证码适配文件`);
  const sendOk = lang === 'java'
    ? files.some((f) => String(f.content).includes('RequestMapping("/captcha")') && String(f.content).includes('PostMapping("/send")'))
    : files.some((f) => String(f.content).includes('/captcha/send'));
  if (!sendOk) fail(`${lang} 缺少 /captcha/send 路由`);
  ok(`${lang} 验证码：适配文件与 /captcha/send 路由已生成（通道 = 你自建网关）`);
}

function checkLuid(files, ir) {
  const luid = (ir.project.security || {}).luid || {};
  if (luid.enabled === false) return;
  const hits = files.filter((f) => /luid/i.test(String(f.content)));
  if (!hits.length) fail('启用了 LUID 但产物中没有 LUID 逻辑');
  ok(`LUID：${hits.length} 个文件包含逻辑用户编号处理`);
}

function checkQueries(files, ir) {
  const qs = ir.queries || [];
  if (!qs.length) return;
  qs.forEach((q) => {
    if (!q.sql) return fail(`查询 ${q.name} 缺少 SQL`);
    const bound = new Set((q.sql.match(/:\w+/g) || []).map((s) => s.slice(1)));
    bound.forEach((name) => {
      if (!(q.params || []).includes(name)) fail(`查询 ${q.name} 的 :${name} 未在参数列表中声明`);
    });
    const routes = files.filter((f) => String(f.content).includes(q.name));
    if (!routes.length) fail(`查询 ${q.name} 没有被任何产物引用`);
  });
  ok(`自定义 SQL ${qs.length} 条：参数绑定与路由均已生成`);
}

function checkSql(files) {
  const sqls = files.filter((f) => f.path.endsWith('.sql'));
  const tables = new Map();
  sqls.forEach((f) => {
    const src = String(f.content).replace(/--.*$/gm, '');
    const creates = src.match(/CREATE TABLE[\s\S]*?;/g) || [];
    creates.forEach((block) => {
      const name = (block.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?/i) || [])[1];
      if (!name) return fail(`${f.path} 有无法解析的 CREATE TABLE`);
      if (tables.has(name)) fail(`表 ${name} 重复定义（${f.path} 与 ${tables.get(name)}）`);
      tables.set(name, f.path);
      if (!/PRIMARY KEY/.test(block)) fail(`${f.path} 表 ${name} 缺少 PRIMARY KEY`);
    });
    if (!src.trim()) fail(`${f.path} 为空`);
  });
  ok(`SQL 脚本 ${sqls.length} 个：${tables.size} 张表，主键齐全，无重名`);
}

function checkDeploy(files, ir) {
  const p = ir.project;
  const paths = new Set(files.map((f) => f.path));
  // 部署说明永远有
  ['deploy/topology.md', 'deploy/topology.json', 'deploy/db-clusters.md'].forEach((f) => {
    if (!paths.has(f)) fail(`缺少 ${f}`);
  });
  // 集群 → compose 里必须有对应 mysql 节点
  const compose = (files.find((f) => f.path === 'docker-compose.yml') || {}).content || '';
  (ir.clusters || []).forEach((c) => {
    const svc = `mysql-${String(c.name).toLowerCase().replace(/_/g, '-')}`;
    if (!compose.includes(`${svc}:`)) fail(`compose 缺少数据库节点 ${svc}`);
  });
  if ((ir.clusters || []).some((c) => c.role === 'replica') && !paths.has('scripts/setup-replica.sh')) {
    fail('有从库但缺少 scripts/setup-replica.sh');
  }
  // 网关
  if (ir.gateway.enabled) {
    if (!paths.has('gateway/onrouter.yaml')) fail('启用了网关但缺少 gateway/onrouter.yaml');
    if (!paths.has('scripts/fetch-onrouter.ps1')) fail('缺少 scripts/fetch-onrouter.ps1');
    const gw = files.find((f) => f.path === 'gateway/onrouter.yaml').content;
    if (!/inject_headers/.test(gw)) fail('网关配置缺少 X-Luid 透传');
    if (!compose.includes('gateway:')) fail('compose 缺少 gateway 服务');
  }
  // 微服务
  if (p.microservices && p.microservices.enabled) {
    ir.services.forEach((s) => {
      if (!paths.has(`services/${s.id}/project.json`)) fail(`缺少 services/${s.id}/project.json`);
    });
    if (!paths.has('deploy/compose-services.yml')) fail('缺少 deploy/compose-services.yml');
    if (!paths.has('build-services.ps1')) fail('缺少 build-services.ps1');
    if (!/^  app:/m.test(compose) && ir.services[0]) {
      // 微服务模式下主 compose 由服务替代 app
      if (!compose.includes(`${ir.services[0].id}:`)) fail('微服务模式下 compose 缺少服务块');
    }
    // 子工程要能回灌
    const sub = files.find((f) => f.path === `services/${ir.services[0].id}/project.json`);
    if (sub) {
      try {
        const parsed = JSON.parse(sub.content);
        if (!Array.isArray(parsed.modules) || !parsed.modules.length) fail('子工程 modules 为空');
      } catch (e) {
        fail('子工程 project.json 不是合法 JSON');
      }
    }
  }
  ok(`部署产物：${(ir.clusters || []).length} 个库节点 / 网关 ${ir.gateway.enabled ? '开' : '关'} / 服务 ${ir.services.length} 个`);
}

function checkZip(files) {
  const buf = zip(files.map((f) => ({ path: f.path, content: f.content })));
  if (buf.readUInt32LE(0) !== 0x04034b50) return fail('ZIP 起始签名错误');
  const eocd = buf.length - 22;
  if (buf.readUInt32LE(eocd) !== 0x06054b50) return fail('ZIP 中央目录结束记录缺失');
  const total = buf.readUInt16LE(eocd + 10);
  if (total !== files.length) fail(`ZIP 条目数 ${total} 与文件数 ${files.length} 不符`);
  else ok(`ZIP 打包通过：${files.length} 条目 / ${(buf.length / 1024).toFixed(1)} KB`);
}

function run(label, project) {
  console.log(`\n[${label}]`);
  const { ir, files } = gen.generate(project);
  const unique = new Set(files.map((f) => f.path.toLowerCase()));
  if (unique.size !== files.length) fail('存在重复路径');
  if (project.lang === 'rust') checkRust(files);
  else if (project.lang === 'node') checkNode(files);
  else if (project.lang === 'go') checkGo(files);
  else checkJava(files, ir);
  checkSql(files);
  checkQueries(files, ir);
  checkBlocks(files, ir);
  checkVerify(files, ir);
  checkLuid(files, ir);
  checkDeploy(files, ir);
  checkZip(files);
}

console.log('ClickBuildServer 产物校验');
const base = blankProject();
run('java-jar（默认）', base);

const war = { ...base, packageType: 'war', modules: MODULES.map((m) => m.id) };
run('java-war（全模块）', war);

const rs = { ...base, lang: 'rust', modules: MODULES.map((m) => m.id) };
run('rust（全模块）', rs);

run('node（全模块）', { ...base, lang: 'node', modules: MODULES.map((m) => m.id) });
run('go（全模块）', { ...base, lang: 'go', modules: MODULES.map((m) => m.id) });

const withQueries = {
  ...base,
  modules: ['auth', 'account', 'order', 'report', 'media-upload', 'media-play', 'product-variant', 'media-partition'],
  queries: [
    {
      name: 'order-status-report',
      method: 'GET',
      perm: 'report:list',
      params: ['beginDate', 'endDate'],
      sql: 'SELECT status, COUNT(*) AS cnt FROM biz_order WHERE created_at BETWEEN :beginDate AND :endDate GROUP BY status',
    },
  ],
};
run('java + 自定义 SQL', withQueries);
run('go + 自定义 SQL', { ...withQueries, lang: 'go' });
run('node + 自定义 SQL', { ...withQueries, lang: 'node' });

const custom = {
  ...base,
  customTables: [{ name: 'demo_asset', comment: '素材', engine: 'mysql', columns: 'title|varchar(128)|标题|req\nurl|varchar(255)|地址|search\nsize|int|大小' }],
  fileSources: [{ name: 'students', engine: 'csv', path: 'data/students.csv', columns: 'name|varchar(64)|姓名|req,search\nage|int|年龄' }],
};
run('自定义表 + 文件数据源', custom);

const blocks = {
  ...base,
  modules: [...base.modules, 'verify-code'],
  blocks: [
    { id: 'ping', name: '连通性探针', method: 'GET', perm: '', params: ['name'], code: 'return { pong: true };' },
    { id: 'order-stat', name: '订单统计', method: 'POST', perm: 'order:list', params: ['day'], code: '' },
  ],
};
run('积木 + 验证码（java）', blocks);
run('积木 + 验证码（node）', { ...blocks, lang: 'node' });
run('积木 + 验证码（go）', { ...blocks, lang: 'go' });

// 集群 + 网关 + 微服务（按画布切分）
const clusterMs = {
  ...base,
  modules: ['auth', 'account', 'rbac', 'order', 'product', 'media-upload', 'media-play', 'approval', 'audit-log'],
  database: {
    ...base.database,
    clusters: [
      { name: 'primary', role: 'primary', host: '10.0.0.1', port: 3306, weight: 10 },
      { name: 'replica1', role: 'replica', host: '10.0.0.2', port: 3306, weight: 2 },
    ],
    routing: { strategy: 'weighted', readWriteSplit: true, healthCheckMs: 5000, failoverThreshold: 2 },
    failover: { enabled: true, quorum: 2, leaseSeconds: 10, splitBrainGuard: true },
  },
  security: {
    ...base.security,
    waf: {
      enabled: true,
      sqlInjection: true,
      xss: true,
      pathTraversal: true,
      cc: { enabled: true, rps: 20, burst: 40 },
      ddos: { enabled: true, maxConcurrent: 200 },
      cors: { enabled: true, origins: ['https://a.com'], credentials: true },
      headers: { frameOptions: 'DENY', contentTypeOptions: true, hsts: false },
    },
  },
  gateway: { enabled: true, port: 8089, jwtVerify: true, rateLimit: { enabled: true, rps: 50 } },
  microservices: { enabled: true, mode: 'topology' },
  topology: {
    nodes: [
      { id: 'service-1', kind: 'service', name: '交易服务', x: 100, y: 50, modules: ['order', 'approval'] },
      { id: 'service-2', kind: 'service', name: '内容服务', x: 100, y: 160, modules: ['product', 'media-upload', 'media-play'] },
      { id: 'db-1', kind: 'db', name: 'MySQL', x: 320, y: 100, modules: [] },
    ],
    edges: [{ from: 'service-1', to: 'db-1' }, { from: 'service-2', to: 'db-1' }],
  },
};
run('集群 + 网关 + 微服务（java）', clusterMs);
run('集群 + 网关（node 单应用）', { ...clusterMs, lang: 'node', microservices: { enabled: false, mode: 'module-group' }, topology: { nodes: [], edges: [] } });

console.log(fails ? `\n校验失败：${fails} 项` : '\n全部通过');
process.exit(fails ? 1 : 0);
