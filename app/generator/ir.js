'use strict';

const { MODULES, getModule, permsOf, resolveSelection } = require('../catalog');
const N = require('./naming');

const DEFAULT_PROJECT = {
  name: 'ClickServer',
  artifact: 'click-server',
  groupId: 'com.clickbuild',
  lang: 'java',
  packageType: 'jar',
  version: '1.0.0',
  port: 8080,
  contextPath: '/api',
  idStrategy: 'snowflake',
  database: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    name: 'click_server',
    user: 'root',
    password: 'root123',
    pool: { max: 20, min: 5 },
    cluster: { enabled: false, mode: 'replication', readHosts: [], shardCount: 2 },
    // 多库多集群：每个集群一条记录，weight 用于分流，readonly 表示只读从库
    clusters: [],
    routing: { strategy: 'round-robin', readWriteSplit: true, healthCheckMs: 5000, failoverThreshold: 2 },
    failover: { enabled: true, quorum: 2, leaseSeconds: 10, splitBrainGuard: true },
  },
  redis: {
    enabled: true,
    mode: 'standalone',
    nodes: ['127.0.0.1:6379'],
    password: '',
    db: 0,
    keyPrefix: 'cb',
  },
  storage: {
    provider: 'minio',
    endpoint: 'http://127.0.0.1:9000',
    publicBase: 'http://127.0.0.1:9000',
    bucket: 'clickbuild',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    localDir: './storage',
  },
  search: { engine: 'redis', esNodes: ['http://127.0.0.1:9200'] },
  integrations: {
    docker: true,
    swagger: true,
    actuator: false,
    prometheus: false,
    kafka: false,
    rabbitmq: false,
    mail: false,
    sms: false,
    websocket: false,
    rateLimit: true,
    idempotent: false,
    ffmpeg: false,
    nginx: false,
    ci: false,
    tenant: false,
  },
  security: {
    jwtSecret: 'change-me-click-build-server-secret-key-32bytes',
    cookieName: 'CB_TOKEN',
    ttlSeconds: 7200,
    initAdmin: 'admin',
    initPassword: 'Admin@123456',
    luid: {
      enabled: true,
      cache: 'auto',
      ttlSeconds: 3600,
      headerName: 'X-Luid',
    },
    ownerGuard: true,
    // 基础防护：SQL 注入 / XSS / 路径穿越 / CC / 慢请求 / CORS / 安全头
    waf: {
      enabled: true,
      sqlInjection: true,
      xss: true,
      pathTraversal: true,
      cc: { enabled: true, rps: 20, burst: 40 },
      ddos: { enabled: true, maxConcurrent: 200, requestTimeoutMs: 15000 },
      cors: {
        enabled: true,
        origins: ['*'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'X-Luid', 'X-Requested-With'],
        credentials: false,
      },
      headers: { frameOptions: 'DENY', contentTypeOptions: true, hsts: false },
    },
  },
  verification: {
    sms: { provider: 'none', endpoint: '', signName: '', templateCode: '', accessKey: '', secretKey: '' },
    email: { provider: 'none', host: '', port: 465, user: '', password: '', from: '' },
  },
  // 网关（ONRouter）：可只生成配置，也可一并拉源码/镜像
  gateway: {
    enabled: false,
    kind: 'onrouter',
    repo: '',
    image: '',
    port: 8089,
    routesMode: 'path',
    jwtVerify: true,
    rateLimit: { enabled: true, rps: 50 },
  },
  // 微服务：按拓扑 service 节点或模块分组拆成多个可独立部署的工程
  microservices: { enabled: false, mode: 'module-group' },
  // 拓扑 / ER / 脑图：拖拽出来的节点与连线
  topology: { nodes: [], edges: [] },
  blocks: [],
  modules: ['auth', 'account', 'rbac', 'audit-log', 'order'],
  tableConfig: {},
  customTables: [],
  fileSources: [],
  queries: [],
  roles: [],
};

const deepMerge = (a, b) => {
  if (Array.isArray(a)) return Array.isArray(b) ? b : a;
  if (a && typeof a === 'object') {
    const out = { ...a };
    for (const k of Object.keys(b || {})) out[k] = k in a ? deepMerge(a[k], b[k]) : b[k];
    return out;
  }
  return b === undefined ? a : b;
};

const COMMON_MYSQL = (idStrategy, tenant) => {
  const idType = idStrategy === 'ulid' ? 'varchar(32)' : idStrategy === 'uuid' ? 'varchar(36)' : 'bigint';
  const cols = [{ name: 'id', type: idType, comment: '主键ID', flags: ['pk', 'req'], pk: true, auto: idStrategy === 'auto' }];
  if (tenant) cols.push({ name: 'tenant_id', type: 'bigint', comment: '租户ID', flags: ['req', 'idx'], required: true });
  cols.push(
    { name: 'version', type: 'int', comment: '乐观锁版本', flags: [], required: true },
    { name: 'created_at', type: 'datetime', comment: '创建时间', flags: [] },
    { name: 'updated_at', type: 'datetime', comment: '更新时间', flags: [] },
    { name: 'created_by', type: 'bigint', comment: '创建人', flags: [] },
    { name: 'updated_by', type: 'bigint', comment: '更新人', flags: [] },
    { name: 'deleted', type: 'tinyint', comment: '逻辑删除 0否1是', flags: ['idx'], required: true },
  );
  return cols;
};

const COMMON_FILE = () => ([
  { name: 'id', type: 'varchar(64)', comment: '主键ID', flags: ['pk', 'req'], pk: true, required: true },
  { name: 'created_at', type: 'datetime', comment: '创建时间', flags: [] },
  { name: 'updated_at', type: 'datetime', comment: '更新时间', flags: [] },
]);

/** 支持 UI 直接给 "name|type|comment|flags" 的多行文本 */
const parseDsl = (input) => {
  if (Array.isArray(input)) return input;
  return String(input || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [name, type, comment, flags] = line.split('|').map((s) => (s || '').trim());
      return { name, type: type || 'varchar(255)', comment: comment || '', flags: (flags || '').split(',').filter(Boolean) };
    })
    .filter((c) => c.name);
};

const normColumn = (c) => {
  const flags = Array.isArray(c.flags) ? c.flags : String(c.flags || '').split(',').filter(Boolean);
  return {
    name: N.safeIdent(c.name),
    rawName: c.name,
    type: String(c.type || 'varchar(255)').trim(),
    comment: String(c.comment || ''),
    required: c.required !== undefined ? !!c.required : (flags.includes('req') || flags.includes('pk')),
    unique: c.unique !== undefined ? !!c.unique : flags.includes('uniq'),
    indexed: c.indexed !== undefined ? !!c.indexed : (flags.includes('idx') || flags.includes('pk')),
    searchable: c.searchable !== undefined ? !!c.searchable : flags.includes('search'),
    pk: !!c.pk || flags.includes('pk'),
    auto: !!c.auto,
    flags,
  };
};

const buildTable = (t, opts) => {
  const engine = t.engine || 'mysql';
  const common = engine === 'mysql' ? COMMON_MYSQL(opts.idStrategy, opts.tenant) : COMMON_FILE();
  const userCols = (t.columns || []).map(normColumn);
  // 用户显式提供 id 时以用户的为准
  const hasId = userCols.some((c) => c.name === 'id');
  const commonCols = hasId ? common.filter((c) => c.name !== 'id') : common;
  const columns = [...commonCols.map(normColumn), ...userCols].filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i);
  const cfg = opts.tableConfig[t.name] || {};
  const searchFields = (cfg.search !== undefined ? cfg.search : (t.search || []))
    .map((f) => N.safeIdent(f))
    .filter((f) => columns.some((c) => c.name === f));
  if (cfg.search === undefined && searchFields.length === 0) {
    columns.filter((c) => c.searchable && c.name !== 'id').forEach((c) => searchFields.push(c.name));
  }
  const cache = (cfg.cache !== undefined ? cfg.cache : t.cache) !== false && opts.redisEnabled;
  return {
    name: t.name,
    comment: t.comment || t.name,
    engine,
    columns,
    search: searchFields,
    cache,
    cacheTtl: cfg.cacheTtl || t.cacheTtl || 300,
    class: N.tableClass(t.name),
    route: N.kebab(t.name),
    filePath: t.path || cfg.path || '',
    indexes: t.indexes || [],
  };
};

function normalizeProject(input) {
  const warnings = [];
  const project = deepMerge(JSON.parse(JSON.stringify(DEFAULT_PROJECT)), input || {});
  project.name = String(project.name || 'ClickServer').trim() || 'ClickServer';
  project.artifact = N.artifact(project.artifact || project.name);
  project.groupId = N.safePkg(project.groupId || 'com.clickbuild');
  project.lang = ['rust', 'node', 'go'].includes(project.lang) ? project.lang : 'java';
  project.packageType = project.packageType === 'war' ? 'war' : 'jar';
  project.modules = Array.isArray(project.modules) ? project.modules : [];
  project.tableConfig = project.tableConfig && typeof project.tableConfig === 'object' ? project.tableConfig : {};

  // 自定义 SQL：{ name, sql, method, perm, params:[] }
  project.queries = (Array.isArray(project.queries) ? project.queries : [])
    .filter((q) => q && String(q.name || '').trim() && String(q.sql || '').trim())
    .map((q) => ({
      name: N.safeIdent(String(q.name).trim()).replace(/_/g, '-'),
      method: String(q.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
      sql: String(q.sql).trim(),
      perm: String(q.perm || 'system:manage'),
      params: Array.isArray(q.params) ? q.params.map((s) => String(s).trim()).filter(Boolean) : [],
      comment: String(q.comment || ''),
    }));

  const tenant = !!project.integrations.tenant || project.modules.includes('tenant');
  project.integrations.tenant = tenant;

  // 逻辑用户编号（LUID）：token 里带的不透明编号，服务端用它换用户与权限
  const luidCfg = project.security.luid || {};
  const luidCache = luidCfg.cache === 'redis' || luidCfg.cache === 'memory'
    ? luidCfg.cache
    : (project.redis.enabled ? 'redis' : 'memory');
  project.security.luid = {
    enabled: luidCfg.enabled !== false,
    cache: luidCache,
    ttlSeconds: Number(luidCfg.ttlSeconds) > 0 ? Number(luidCfg.ttlSeconds) : 3600,
    headerName: String(luidCfg.headerName || 'X-Luid'),
  };
  project.security.ownerGuard = project.security.ownerGuard !== false;

  // 验证码通道：只生成对接骨架，不代发短信/邮件
  const ver = project.verification || {};
  project.verification = {
    sms: {
      provider: String((ver.sms || {}).provider || 'none'),
      endpoint: String((ver.sms || {}).endpoint || ''),
      signName: String((ver.sms || {}).signName || ''),
      templateCode: String((ver.sms || {}).templateCode || ''),
      accessKey: String((ver.sms || {}).accessKey || ''),
      secretKey: String((ver.sms || {}).secretKey || ''),
    },
    email: {
      provider: String((ver.email || {}).provider || 'none'),
      host: String((ver.email || {}).host || ''),
      port: Number((ver.email || {}).port) || 465,
      user: String((ver.email || {}).user || ''),
      password: String((ver.email || {}).password || ''),
      from: String((ver.email || {}).from || ''),
    },
  };

  // 自定义积木：用户自己写的工具/接口，生成后独立成块并注册路由
  project.blocks = (Array.isArray(project.blocks) ? project.blocks : [])
    .filter((b) => b && String(b.id || b.name || '').trim())
    .map((b) => {
      const raw = String(b.id || b.name).trim();
      const id = N.safeIdent(raw).replace(/_/g, '-');
      // 路由统一为 /blocks/<id>：用户就算手写了 /blocks/xxx 也只会得到一次前缀
      const path = `/blocks/${id}`;
      return {
        id,
        name: String(b.name || raw),
        method: String(b.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
        path,
        perm: String(b.perm || ''),
        params: Array.isArray(b.params) ? b.params.map((x) => String(x).trim()).filter(Boolean) : [],
        code: String(b.code || ''),
        comment: String(b.comment || ''),
      };
    });

  const customDefs = [];
  // 自定义 MySQL 表 -> 独立模块
  (project.customTables || []).forEach((t, i) => {
    if (!t || !t.name) return;
    const id = `custom-${N.kebab(t.name)}`;
    customDefs.push({
      id,
      name: t.comment || t.name,
      group: '自定义',
      abbr: 'CU',
      tagline: t.engine === 'mysql' ? '自建表 · 全自动 CRUD' : `文件数据源 · ${String(t.engine || '').toUpperCase()}`,
      desc: t.comment || `自定义表 ${t.name}`,
      requires: ['auth', 'rbac'],
      features: { custom: true, search: true, cache: true, export: true, import: true },
      tables: [{ ...t, columns: parseDsl(t.columns), engine: t.engine || 'mysql' }],
      builtin: false,
    });
  });
  // 文件数据源 -> 独立模块
  (project.fileSources || []).forEach((s) => {
    if (!s || !s.name) return;
    const type = String(s.type || s.engine || 'csv').toLowerCase();
    customDefs.push({
      id: `source-${N.kebab(s.name)}`,
      name: s.name,
      group: '数据源',
      abbr: 'DS',
      tagline: `${String(type).toUpperCase()} 文件当数据库`,
      desc: `以 ${s.path || s.name} 为数据源，按给定字段直接查询/写入`,
      requires: [],
      features: { custom: true, fileSource: true, search: true, cache: false },
      tables: [{
        name: s.table || `src_${N.snake(s.name)}`,
        comment: s.comment || `${s.name} 数据源`,
        engine: type === 'json' ? 'json' : type === 'excel' ? 'excel' : 'csv',
        columns: parseDsl(s.columns),
        path: s.path || '',
        search: s.search || [],
        cache: false,
      }],
      builtin: false,
    });
  });

  const allModules = [...MODULES, ...customDefs];
  // 自定义表 / 文件数据源一旦存在就必须参与生成
  project.modules = [...new Set([...project.modules, ...customDefs.map((d) => d.id)])];
  const requested = project.modules.filter((id) => allModules.some((m) => m.id === id));
  const unknown = project.modules.filter((id) => !allModules.some((m) => m.id === id));
  unknown.forEach((id) => warnings.push(`未找到模块：${id}`));

  // 依赖闭包
  const byId = new Map(allModules.map((m) => [m.id, m]));
  const resolved = new Set();
  const walk = (id) => {
    if (resolved.has(id)) return;
    const m = byId.get(id);
    if (!m) return;
    resolved.add(id);
    (m.requires || []).forEach(walk);
  };
  requested.forEach(walk);

  // 能力驱动的自动补依赖：勾了审核 / 存储 / 搜索，就把对应基础模块带上
  const hasFeature = (fn) => [...resolved].map((id) => byId.get(id)).some((m) => m && fn(m));
  if (hasFeature((m) => m.features && m.features.audit)) walk('approval');
  if (hasFeature((m) => m.features && m.features.storage)) walk('file');
  if (hasFeature((m) => (m.tables || []).some((t) => (t.search || []).length > 0 || (t.columns || []).some((c) => String(c.flags || '').includes('search'))))) {
    walk('search');
  }
  if (hasFeature((m) => (m.tables || []).some((t) => t.cache !== false))) walk('cache');

  if (resolved.has('search') || project.search.engine === 'elasticsearch') {
    if (!resolved.has('cache') && project.redis.enabled) resolved.add('cache');
  }
  if (project.search.engine === 'elasticsearch' && !resolved.has('search')) resolved.add('search');

  const modules = [...resolved].map((id) => byId.get(id)).filter(Boolean).map((m) => ({
    ...m,
    dir: N.moduleDir(m.id),
    perms: permsOf(m),
  }));

  // 表汇总
  const tables = [];
  modules.forEach((m) => {
    (m.tables || []).forEach((t) => {
      const normalized = buildTable(t, {
        idStrategy: project.idStrategy,
        tenant,
        tableConfig: project.tableConfig,
        redisEnabled: project.redis.enabled,
      });
      tables.push({
        ...normalized,
        moduleId: m.id,
        moduleDir: m.dir,
        moduleName: m.name,
        perms: m.perms,
        features: m.features,
        route: `/${m.dir}/${N.kebab(t.name)}`,
        javaPackage: `${project.groupId}.modules.${m.dir}`,
        rustModule: N.snake(m.dir),
        tenant,
      });
    });
  });

  // 表名去重
  const seen = new Map();
  tables.forEach((t) => {
    if (seen.has(t.name)) warnings.push(`表名重复：${t.name}（仅保留第一处）`);
    seen.set(t.name, true);
  });

  // 数据归属：非超管只能操作自己创建的数据（按 ID 控制）
  tables.forEach((t) => {
    const cfg = project.tableConfig[t.name] || {};
    if (cfg.ownerField === false) t.ownerField = '';
    else if (typeof cfg.ownerField === 'string' && cfg.ownerField) t.ownerField = cfg.ownerField;
    else if (t.engine === 'mysql' && project.security.ownerGuard && t.columns.some((c) => c.name === 'created_by')) t.ownerField = 'created_by';
    else t.ownerField = '';
  });

  // ---- 基础防护：SQL 注入 / XSS / 路径穿越 / CC / 慢请求 / CORS / 安全头 ----
  const wafIn = project.security.waf || {};
  const ccIn = wafIn.cc || {};
  const ddIn = wafIn.ddos || {};
  const corsIn = wafIn.cors || {};
  const hdrIn = wafIn.headers || {};
  const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);
  project.security.waf = {
    enabled: wafIn.enabled !== false,
    sqlInjection: wafIn.sqlInjection !== false,
    sqlInjectionBody: !!wafIn.sqlInjectionBody,
    xss: wafIn.xss !== false,
    pathTraversal: wafIn.pathTraversal !== false,
    cc: { enabled: ccIn.enabled !== false, rps: pos(ccIn.rps, 20), burst: pos(ccIn.burst, 40) },
    ddos: { enabled: ddIn.enabled !== false, maxConcurrent: pos(ddIn.maxConcurrent, 200), requestTimeoutMs: pos(ddIn.requestTimeoutMs, 15000) },
    cors: {
      enabled: corsIn.enabled !== false,
      origins: (Array.isArray(corsIn.origins) && corsIn.origins.length ? corsIn.origins : ['*']).map((s) => String(s).trim()).filter(Boolean),
      methods: (Array.isArray(corsIn.methods) && corsIn.methods.length ? corsIn.methods : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).map((s) => String(s).toUpperCase()),
      headers: (Array.isArray(corsIn.headers) && corsIn.headers.length ? corsIn.headers : ['Content-Type', 'Authorization', 'X-Luid', 'X-Requested-With']).map(String),
      credentials: !!corsIn.credentials,
    },
    headers: {
      frameOptions: String(hdrIn.frameOptions || 'DENY').toUpperCase(),
      contentTypeOptions: hdrIn.contentTypeOptions !== false,
      hsts: !!hdrIn.hsts,
    },
  };

  // ---- 多库多集群 / 主从 / 分流 / 防脑裂 ----
  const dbIn = project.database || {};
  const parseHost = (h) => {
    const s = String(h || '').trim();
    if (!s) return null;
    const i = s.lastIndexOf(':');
    if (i > 0 && /^\d+$/.test(s.slice(i + 1))) return { host: s.slice(0, i), port: Number(s.slice(i + 1)) };
    return { host: s, port: Number(dbIn.port) || 3306 };
  };
  let clusters = (Array.isArray(dbIn.clusters) ? dbIn.clusters : [])
    .filter((c) => c && (c.host || c.name))
    .map((c, i) => {
      const role = c.role === 'replica' || c.role === 'slave' ? 'replica' : 'primary';
      const host = parseHost(c.host || dbIn.host) || { host: '127.0.0.1', port: 3306 };
      return {
        name: N.safeIdent(String(c.name || `${role}${i + 1}`)),
        role,
        host: host.host,
        port: pos(c.port, host.port),
        weight: pos(c.weight, role === 'replica' ? 1 : 10),
        readonly: role === 'replica' || !!c.readonly,
        database: String(c.database || dbIn.name),
        user: String(c.user || dbIn.user),
        password: String(c.password || dbIn.password),
      };
    });
  if (!clusters.length) {
    // 老配置推导：主库 + readHosts 当从库
    clusters.push({
      name: 'primary',
      role: 'primary',
      host: dbIn.host,
      port: pos(dbIn.port, 3306),
      weight: 10,
      readonly: false,
      database: dbIn.name,
      user: dbIn.user,
      password: dbIn.password,
    });
    const reads = (dbIn.cluster && Array.isArray(dbIn.cluster.readHosts)) ? dbIn.cluster.readHosts : [];
    reads.forEach((h, i) => {
      const host = parseHost(h);
      if (!host) return;
      clusters.push({
        name: `replica${i + 1}`,
        role: 'replica',
        host: host.host,
        port: host.port,
        weight: 1,
        readonly: true,
        database: dbIn.name,
        user: dbIn.user,
        password: dbIn.password,
      });
    });
  }
  const routingIn = dbIn.routing || {};
  const failIn = dbIn.failover || {};
  project.database.clusters = clusters;
  project.database.routing = {
    strategy: ['round-robin', 'weighted', 'hash'].includes(routingIn.strategy) ? routingIn.strategy : 'round-robin',
    readWriteSplit: routingIn.readWriteSplit !== false,
    healthCheckMs: pos(routingIn.healthCheckMs, 5000),
    failoverThreshold: pos(routingIn.failoverThreshold, 2),
  };
  project.database.failover = {
    enabled: failIn.enabled !== false,
    quorum: pos(failIn.quorum, Math.max(1, Math.ceil(clusters.length / 2))),
    leaseSeconds: pos(failIn.leaseSeconds, 10),
    splitBrainGuard: failIn.splitBrainGuard !== false,
  };

  // ---- 拓扑 / ER / 脑图：拖拽出来的节点与连线 ----
  const topoIn = project.topology || {};
  const nodeKinds = ['service', 'module', 'table', 'gateway', 'db', 'redis', 'storage', 'client'];
  project.topology = {
    nodes: (Array.isArray(topoIn.nodes) ? topoIn.nodes : [])
      .filter((n) => n && (n.id || n.name))
      .map((n) => {
        const raw = String(n.id || n.name).trim();
        return {
          id: N.safeIdent(raw).replace(/_/g, '-') || `node-${Math.random().toString(36).slice(2, 8)}`,
          kind: nodeKinds.includes(n.kind) ? n.kind : 'service',
          name: String(n.name || raw),
          x: Math.round(Number(n.x) || 0),
          y: Math.round(Number(n.y) || 0),
          modules: Array.isArray(n.modules) ? n.modules.map(String) : [],
          note: String(n.note || ''),
        };
      }),
    edges: (Array.isArray(topoIn.edges) ? topoIn.edges : [])
      .filter((e) => e && e.from && e.to)
      .map((e) => ({ from: String(e.from), to: String(e.to), label: String(e.label || '') })),
  };

  // ---- 微服务切分 ----
  const msIn = project.microservices || {};
  const msOn = msIn.enabled === true;
  const basePort = pos(project.port, 8080);
  let services = [];
  if (!msOn) {
    services = [{
      id: N.kebab(project.artifact) || 'app',
      name: project.name,
      modules: modules.map((m) => m.id),
      port: basePort,
      prefix: '',
      isAll: true,
      tables: [],
    }];
  } else {
    const platformIds = modules.filter((m) => m.group === '平台').map((m) => m.id);
    const svcNodes = project.topology.nodes.filter((n) => n.kind === 'service' && n.modules.length);
    const assigned = new Set();
    const GROUP_SLUG = {
      平台: 'platform', 交易: 'trade', 商品: 'product', 营销: 'marketing',
      内容: 'content', 媒体: 'media', 供应链: 'supply', 服务: 'service',
      会员: 'member', 自定义: 'custom', 数据源: 'datasource', default: 'core',
    };
    const taken = new Set();
    const uniq = (base) => {
      let id = base;
      let n = 2;
      while (taken.has(id)) id = `${base}-${n++}`;
      taken.add(id);
      return id;
    };
    if (svcNodes.length) {
      svcNodes.forEach((n, i) => {
        const ids = n.modules.filter((id) => modules.some((m) => m.id === id));
        ids.forEach((id) => assigned.add(id));
        const first = modules.find((m) => ids.includes(m.id) && m.group !== '平台') || modules.find((m) => ids.includes(m.id));
        const counts = new Map();
        ids.forEach((id) => {
          const m = modules.find((x) => x.id === id && x.group !== '平台');
          if (m) counts.set(m.group, (counts.get(m.group) || 0) + 1);
        });
        const topGroup = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const label = (topGroup && GROUP_SLUG[topGroup[0]])
          || String(n.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          || (first && GROUP_SLUG[first.group])
          || `s${i + 1}`;
        const svcId = uniq(`svc-${label}`);
        services.push({
          id: svcId,
          name: n.name,
          modules: [...new Set([...platformIds, ...ids])],
          port: basePort + (i + 1) * 10,
          prefix: svcId,
          isAll: false,
          tables: [],
        });
      });
    } else {
      const groups = [...new Set(modules.filter((m) => m.group !== '平台').map((m) => m.group))];
      const pool = groups.length ? groups : ['default'];
      pool.forEach((g, i) => {
        const ids = modules.filter((m) => m.group === g).map((m) => m.id);
        const slug = GROUP_SLUG[g] || `g${i + 1}`;
        const svcId = uniq(`svc-${slug}`);
        services.push({
          id: svcId,
          name: String(g),
          modules: [...new Set([...platformIds, ...ids])],
          port: basePort + (i + 1) * 10,
          prefix: svcId,
          isAll: false,
          tables: [],
        });
      });
    }
    // 没被拓扑认领的模块兜底进第一个服务，避免模块凭空消失
    const left = modules.filter((m) => !assigned.has(m.id) && m.group !== '平台').map((m) => m.id);
    if (left.length && services.length) {
      services[0].modules = [...new Set([...services[0].modules, ...left])];
    }
  }
  // 每个服务带自己的表清单，供 Java / Node / Go 生成器按服务出工程
  services.forEach((s) => {
    const ids = new Set(s.modules);
    s.tables = tables.filter((t) => ids.has(t.moduleId));
  });

  // ---- 网关（ONRouter）----
  const gwIn = project.gateway || {};
  const gwOn = gwIn.enabled === true;
  const rlIn = gwIn.rateLimit || {};
  project.gateway = {
    enabled: gwOn,
    kind: String(gwIn.kind || 'onrouter'),
    repo: String(gwIn.repo || ''),
    image: String(gwIn.image || ''),
    port: pos(gwIn.port, 8089),
    routesMode: gwIn.routesMode === 'header' ? 'header' : 'path',
    jwtVerify: gwIn.jwtVerify !== false,
    rateLimit: { enabled: rlIn.enabled !== false, rps: pos(rlIn.rps, 50) },
    routes: msOn
      ? services.map((s) => ({
        id: s.id,
        prefix: `/${s.prefix}`,
        // 容器内用服务名互访；本机直跑时改回 127.0.0.1
        upstream: `http://${s.id}:${s.port}`,
        stripPrefix: true,
      }))
      : [],
  };

  // 搜索/缓存汇总
  const searchTables = tables.filter((t) => t.search.length > 0 && t.engine !== 'mysql' ? true : t.search.length > 0);
  const cacheTables = tables.filter((t) => t.cache);
  const mysqlTables = tables.filter((t) => t.engine === 'mysql');
  const fileTables = tables.filter((t) => t.engine !== 'mysql');

  const perms = [];
  modules.forEach((m) => m.perms.forEach((p) => perms.push({ ...p, moduleId: m.id })));
  // 补齐平台权限
  ['system:manage', 'system:log', 'file:upload', 'file:download'].forEach((code) => {
    if (!perms.some((p) => p.code === code)) perms.push({ code, name: code, moduleId: 'platform' });
  });

  const defaultRoles = [
    { code: 'super_admin', name: '超级管理员', perms: perms.map((p) => p.code), dataScope: 1 },
    { code: 'operator', name: '业务操作员', perms: perms.filter((p) => !/:(delete|audit)$/.test(p.code) && p.moduleId !== 'platform').map((p) => p.code), dataScope: 3 },
    { code: 'auditor', name: '审核员', perms: perms.filter((p) => /:(audit|list|detail)$/.test(p.code)).map((p) => p.code), dataScope: 1 },
  ];
  const roles = (project.roles && project.roles.length ? project.roles : defaultRoles).map((r) => ({
    code: N.safeIdent(r.code),
    name: r.name || r.code,
    perms: Array.isArray(r.perms) ? r.perms : [],
    dataScope: r.dataScope || 1,
  }));

  const stats = {
    modules: modules.length,
    tables: tables.length,
    mysqlTables: mysqlTables.length,
    fileTables: fileTables.length,
    searchTables: searchTables.length,
    cacheTables: cacheTables.length,
    permissions: perms.length,
    blocks: project.blocks.length,
    services: services.length,
    clusters: clusters.length,
    endpoints: tables.length * 8 + project.blocks.length + (modules.some((m) => m.features.audit) ? 5 : 0) + 6,
  };

  const pkgPath = project.groupId.replace(/\./g, '/');

  return {
    project,
    modules,
    tables,
    mysqlTables,
    fileTables,
    searchTables,
    cacheTables,
    queries: project.queries,
    blocks: project.blocks,
    luid: project.security.luid,
    verification: project.verification,
    waf: project.security.waf,
    database: project.database,
    clusters,
    failover: project.database.failover,
    topology: project.topology,
    services,
    gateway: project.gateway,
    perms,
    roles,
    tenant,
    stats,
    warnings,
    pkgPath,
    meta: {
      generatedAt: new Date().toISOString(),
      generator: 'ClickBuildServer 1.0.0',
      lang: project.lang,
      packageType: project.packageType,
    },
  };
}

function blankProject() {
  return JSON.parse(JSON.stringify(DEFAULT_PROJECT));
}

module.exports = { normalizeProject, blankProject, DEFAULT_PROJECT, deepMerge, normColumn };
