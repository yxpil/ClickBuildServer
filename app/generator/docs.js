'use strict';

const N = require('./naming');

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));

function clickbuildJson(ir) {
  const project = {
    ...ir.project,
    modules: ir.modules.map((m) => m.id),
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: 'ClickBuildServer 1.0.0',
  };
  return JSON.stringify(project, null, 2);
}

function readme(ir) {
  const p = ir.project;
  const langLabel = p.lang === 'java' ? `Java / Spring Boot 3 · ${p.packageType.toUpperCase()}` : 'Rust / axum';
  const runJava = p.packageType === 'war'
    ? 'mvn clean package\n# 产物 target/*.war，丢进 Tomcat webapps 即可'
    : 'mvn clean package\njava -jar target/*.jar';
  const runRust = 'cargo run --release';
  return `# ${p.name}

> 由 **ClickBuildServer** 生成 · ${ir.stats.modules} 个模块 · ${ir.stats.tables} 张表 · ${ir.stats.permissions} 个权限点

## 技术栈

| 项目 | 选择 |
| --- | --- |
| 语言 / 框架 | ${langLabel} |
| 数据库 | MySQL 8${p.database.cluster && p.database.cluster.enabled ? '（读写分离集群）' : ''} |
| 缓存 | ${p.redis.enabled ? `Redis（${p.redis.mode}）` : '未启用'} |
| 对象存储 | ${p.storage.provider} · bucket \`${p.storage.bucket}\` |
| 搜索 | ${p.search.engine === 'elasticsearch' ? 'Elasticsearch' : 'Redis 倒排索引'} |
| 登录 | JWT + HttpOnly Cookie（双通道） |
| ID | ${p.idStrategy}（所有表统一） |
| 权限 | RBAC（角色 / 权限码 / 数据范围） |

## 目录结构

\`\`\`
${p.lang === 'java' ? `src/main/java/${ir.pkgPath}/
  Application.java
  common/          统一返回、基类、雪花 ID
  config/          数据源、Redis、拦截器、存储
  security/        JWT、Cookie、@RequirePerm、@OpLog
  auth/            登录 / 登出 / 当前用户
  support/         缓存、搜索、存储、日志、自举
  modules/         每个业务模块：Entity / Mapper / Service / Controller`
      : `src/
  main.rs          启动、状态、路由装配
  config.rs        环境变量配置
  db.rs            读写分离连接池
  auth.rs          JWT + Cookie
  rbac.rs          权限加载
  cache.rs         Redis 旁路缓存
  search.rs        倒排索引
  storage.rs       S3/MinIO 预签名
  filesource.rs    CSV / JSON / Excel 当数据库
  api/             每个模块的 REST handler`}
sql/              建库、建表、种子数据
docs/             接口清单 / 权限矩阵 / 架构
data/             文件数据源（CSV / JSON / Excel）
clickbuild.json   项目源文件（可作为二次生成的输入）
\`\`\`

## 快速启动

### 1. 准备数据库

\`\`\`bash
mysql -uroot -p < sql/00_database.sql
mysql -uroot -p ${p.database.name} < sql/01_*.sql
mysql -uroot -p ${p.database.name} < sql/99_seed.sql
\`\`\`

或直接：

\`\`\`bash
docker compose up -d
\`\`\`

### 2. 启动服务

\`\`\`bash
${p.lang === 'java' ? runJava : runRust}
\`\`\`

访问：\`http://localhost:${p.port}${p.contextPath}\`${p.integrations.swagger ? `\n接口文档：\`http://localhost:${p.port}${p.contextPath}/swagger-ui.html\`` : ''}

### 3. 默认账号

\`\`\`
${p.security.initAdmin} / ${p.security.initPassword}
\`\`\`

> 首次启动自动创建。**上线前务必修改** \`app.security.init-password\` 并删除该自举逻辑。

## 登录示例

\`\`\`bash
curl -i -X POST http://localhost:${p.port}${p.contextPath}/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"${p.security.initAdmin}","password":"${p.security.initPassword}"}'
\`\`\`

响应会同时返回 \`token\` 并写入 \`${p.security.cookieName}\`（HttpOnly）。后续请求二选一：

\`\`\`bash
curl http://localhost:${p.port}${p.contextPath}/order/biz-order -H "Authorization: Bearer $TOKEN"
curl http://localhost:${p.port}${p.contextPath}/order/biz-order --cookie "${p.security.cookieName}=$TOKEN"
\`\`\`

## 模块与表

${ir.modules.map((m) => `### ${m.name}（\`${m.id}\`）\n\n${m.desc}\n\n${(m.tables || []).length ? '| 表 | 说明 | 引擎 | 搜索 | 缓存 |\n| --- | --- | --- | --- | --- |\n' + m.tables.map((t) => {
    const tt = ir.tables.find((x) => x.name === t.name) || {};
    return `| \`${t.name}\` | ${t.comment} | ${tt.engine || 'mysql'} | ${(tt.search || []).join(', ') || '—'} | ${tt.cache ? '✓' : '—'} |`;
  }).join('\n') : '_无数据表（能力模块）_'}`).join('\n\n')}

## 统一约定

- **主键**：所有表统一 \`id\`，由 \`IdGen\`（${p.idStrategy}）生成，业务不暴露自增序列。
- **公共字段**：\`tenant_id\`（如启用多租户）、\`version\`（乐观锁）、\`created_at/updated_at\`、\`created_by/updated_by\`、\`deleted\`（逻辑删除）。
- **返回体**：\`{ code, message, data, timestamp }\`，\`code=0\` 表示成功。
- **分页**：\`?page=1&size=20&keyword=xxx\`，返回 \`{ page, size, total, records }\`。
- **权限**：每个接口标注 \`${p.lang === 'java' ? '@RequirePerm' : 'auth::ensure'}\`，权限码规则 \`模块:动作\`。

## 能力开关

| 能力 | 状态 |
| --- | --- |
| 统一登录 / Cookie | 已启用 |
| RBAC 权限 | 已启用 |
| 审核流 | ${ir.tables.some((t) => t.name === 'sys_approval') ? '已启用' : '未启用'} |
| 操作日志 | ${ir.tables.some((t) => t.name === 'sys_operation_log') ? '已启用' : '未启用'} |
| Redis 缓存 | ${p.redis.enabled ? `已启用（${ir.cacheTables.length} 张表）` : '未启用'} |
| 搜索 | ${ir.stats.searchTables} 张表可搜（${p.search.engine}） |
| 对象存储 | ${p.storage.provider} |
| 文件数据源 | ${ir.fileTables.length} 张 |
| Docker | ${p.integrations.docker ? '已生成 compose' : '未生成'} |

${ir.warnings.length ? `## 生成警告\n\n${ir.warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}
## 工程转换

本工程的根目录保留了 \`clickbuild.json\`。把它拖回 ClickBuildServer，切换语言（Java jar / Java war / Rust）重新生成，即可得到等价工程 —— 因为三套代码都由同一份 IR 渲染。

`;
}

function apiDoc(ir) {
  const p = ir.project;
  const rows = [];
  ir.tables.forEach((t) => {
    rows.push(`| ${t.moduleName} | \`GET\` | \`${p.contextPath}${t.route}\` | 分页查询 | \`${t.moduleId}:list\` |`);
    rows.push(`| ${t.moduleName} | \`GET\` | \`${p.contextPath}${t.route}/{id}\` | 详情 | \`${t.moduleId}:detail\` |`);
    rows.push(`| ${t.moduleName} | \`POST\` | \`${p.contextPath}${t.route}\` | 新增 | \`${t.moduleId}:create\` |`);
    rows.push(`| ${t.moduleName} | \`PUT\` | \`${p.contextPath}${t.route}/{id}\` | 修改 | \`${t.moduleId}:update\` |`);
    rows.push(`| ${t.moduleName} | \`DELETE\` | \`${p.contextPath}${t.route}/{id}\` | 删除 | \`${t.moduleId}:delete\` |`);
    if (t.features && t.features.export) {
      rows.push(`| ${t.moduleName} | \`GET\` | \`${p.contextPath}${t.route}/export\` | 导出 CSV | \`${t.moduleId}:export\` |`);
    }
    if (t.features && t.features.audit && ir.tables.some((x) => x.name === 'sys_approval')) {
      rows.push(`| ${t.moduleName} | \`POST\` | \`${p.contextPath}${t.route}/{id}/submit-audit\` | 提交审核 | \`${t.moduleId}:audit\` |`);
    }
  });

  const blockRows = (ir.blocks || []).map((b) => `| 积木 | \`${b.method}\` | \`${p.contextPath}/blocks/${b.id}\` | ${b.name} | ${b.perm || '登录'} |`);
  const captchaRows = ir.tables.some((t) => t.name === 'sys_verify_code')
    ? [
      `| 验证码 | \`POST\` | \`${p.contextPath}/captcha/send\` | 发送（短信 / 邮箱） | 公开 |`,
      `| 验证码 | \`POST\` | \`${p.contextPath}/captcha/verify\` | 校验 | 公开 |`,
      `| 验证码 | \`GET\` | \`${p.contextPath}/captcha/channels\` | 可用通道 | 公开 |`,
    ].join('\n')
    : '';
  const queryRows = [
    `| 通用 | \`GET\` | \`${p.contextPath}/<模块>/<表>?keyword=&字段=&字段__op=&filter=&sort=&page=&pageSize=\` | 条件查询（分页） | <模块>:list |`,
    `| 通用 | \`POST\` | \`${p.contextPath}/<模块>/<表>/batch\` | 批量新增 | <模块>:create |`,
    `| 通用 | \`PATCH\` | \`${p.contextPath}/<模块>/<表>\` | 条件更新（body 带条件 + 数据） | <模块>:update |`,
    `| 通用 | \`DELETE\` | \`${p.contextPath}/<模块>/<表>\` | 条件删除 | <模块>:delete |`,
  ].join('\n');
  return `# 接口清单

项目：${p.name} · 生成时间 ${new Date().toISOString()}

| 模块 | 方法 | 路径 | 说明 | 权限码 |
| --- | --- | --- | --- | --- |
| 认证 | POST | \`${p.contextPath}/auth/login\` | 登录（返回 token + Cookie） | 公开 |
| 认证 | POST | \`${p.contextPath}/auth/logout\` | 登出 | 登录 |
| 认证 | GET | \`${p.contextPath}/auth/me\` | 当前用户与权限 | 登录 |
| 认证 | POST | \`${p.contextPath}/auth/refresh\` | 刷新令牌 | 登录 |
${rows.join('\n')}
${queryRows}
${blockRows.join('\n')}${blockRows.length ? '\n' : ''}${captchaRows ? `${captchaRows}\n` : ''}| 审核 | GET | \`${p.contextPath}/approval/task/todo\` | 待办列表 | \`approval:list\` |
| 审核 | POST | \`${p.contextPath}/approval/task/{id}/pass\` | 通过 | \`approval:audit\` |
| 审核 | POST | \`${p.contextPath}/approval/task/{id}/reject\` | 驳回 | \`approval:audit\` |
| 存储 | POST | \`${p.contextPath}/storage/presign-put\` | 预签名上传 | \`file:upload\` |
| 存储 | GET | \`${p.contextPath}/storage/presign-get\` | 预签名下载 | \`file:download\` |

## 统一响应

\`\`\`json
{ "code": 0, "message": "ok", "data": {}, "timestamp": 1700000000000 }
\`\`\`

错误码：400 参数错误 / 401 未登录 / 403 无权限（含 WAF 拦截）/ 429 限流 / 500 内部错误。

## 条件查询语法（三种语言一致）

| 写法 | 含义 |
| --- | --- |
| \`?keyword=abc\` | 在该表的搜索字段里做模糊匹配 |
| \`?status=paid\` | 等值查询 |
| \`?status__ne=paid\` | 不等 |
| \`?amount__gte=100&amount__lte=500\` | 范围（gt / gte / lt / lte） |
| \`?name__like=张\` | 模糊 |
| \`?type__in=a,b,c\` | 枚举 |
| \`?created_at__between=2025-01-01,2025-12-31\` | 区间 |
| \`?deleted_at__isnull=1\` | 空值 / \`__notnull=1\` 非空 |
| \`?filter={"status":"paid","amount":{"gte":100}}\` | JSON 复合条件 |
| \`?sort=created_at:desc,id:asc\` | 排序 |
| \`?page=1&pageSize=20\` | 分页（上限 200） |

条件增删改：\`POST …/batch\`、\`PATCH …\`、\`DELETE …\`，body 里放同样的条件 + \`data\`。

数据归属：开启 \`ownerGuard\` 后，非超管只能看到 \`ownerField\` 属于自己的行；带 \`X-Luid\` 头时按 LUID 判定。
`;
}

function permissionDoc(ir) {
  const p = ir.project;
  const permGroups = new Map();
  ir.perms.forEach((perm) => {
    if (!permGroups.has(perm.moduleId)) permGroups.set(perm.moduleId, []);
    permGroups.get(perm.moduleId).push(perm);
  });
  const rows = [];
  ir.roles.forEach((r) => {
    const count = r.perms.includes('*') ? '全部' : `${r.perms.length} 项`;
    rows.push(`| ${r.name} | \`${r.code}\` | ${count} | ${r.dataScope === 1 ? '全部数据' : r.dataScope === 2 ? '本部门' : '仅本人'} |`);
  });
  return `# 权限矩阵

> 权限码规则：\`模块:动作\`。超级管理员（super_admin）拥有 \`*\`。

## 角色

| 角色 | 编码 | 权限 | 数据范围 |
| --- | --- | --- | --- |
${rows.join('\n')}

## 权限点

| 模块 | 权限码 | 说明 |
| --- | --- | --- |
${ir.perms.map((x) => `| ${x.moduleId} | \`${x.code}\` | ${x.name} |`).join('\n')}

## 角色 × 权限

| 权限码 | ${ir.roles.map((r) => r.name).join(' | ')} |
| --- | ${ir.roles.map(() => '---').join(' | ')} |
${ir.perms.map((x) => `| \`${x.code}\` | ${ir.roles.map((r) => (r.perms.includes('*') || r.perms.includes(x.code) ? '✓' : '—')).join(' | ')} |`).join('\n')}
`;
}

function dataSourceDoc(ir) {
  const p = ir.project;
  return `# 数据源

## MySQL

- 地址：\`${p.database.host}:${p.database.port}\`
- 库名：\`${p.database.name}\`
- 连接池：${p.database.pool.min} ~ ${p.database.pool.max}
- 集群：${p.database.cluster && p.database.cluster.enabled ? `读写分离（从库：${(p.database.cluster.readHosts || []).join(', ') || '未填写'}）` : '单节点'}

${p.database.cluster && p.database.cluster.enabled ? '写请求走主库，读请求走从库（Java 使用 dynamic-datasource，Rust 使用双连接池）。' : ''}

## 文件数据源

${ir.fileTables.length ? '| 表 | 引擎 | 文件 | 字段 |\n| --- | --- | --- | --- |\n' + ir.fileTables.map((t) => `| \`${t.name}\` | ${t.engine} | \`${t.filePath || 'data/' + t.name + '.' + (t.engine === 'excel' ? 'xlsx' : t.engine)}\` | ${t.columns.map((c) => c.name).join(', ')} |`).join('\n') : '_本次未配置文件数据源。_'}

规则：

1. 首行是表头，列名必须与上面字段一致；
2. 必须包含 \`id\` 列（唯一），没有则新增时自动生成；
3. 写入会直接回写原文件（Excel 运行时只读，建议改 CSV / JSON）；
4. 单文件建议 < 50MB、< 20 万行；超过请导入 MySQL。

## Redis

- 模式：${p.redis.mode}
- 节点：${p.redis.nodes.join(', ')}
- Key 前缀：\`${p.redis.keyPrefix}\`

Key 规范：

\`\`\`
${p.redis.keyPrefix}:{table}:{id}        行缓存
${p.redis.keyPrefix}:perm:{userId}       权限集合
${p.redis.keyPrefix}:session:{tokenId}   登录会话
${p.redis.keyPrefix}:idx:{table}:doc     搜索原文 Hash
${p.redis.keyPrefix}:idx:{table}:tok:*   倒排索引 Set
\`\`\`
`;
}

function architectureDoc(ir) {
  const p = ir.project;
  return `# 架构

\`\`\`
客户端 / 前端
   │  Authorization: Bearer  或  Cookie
   ▼
┌──────────────────────────────────────────────┐
│ 接入层：CORS · 限流 · 请求日志${p.integrations.nginx ? ' · Nginx' : ''}                │
├──────────────────────────────────────────────┤
│ 认证：JWT 校验 → LoginUser → UserContext      │
│ 权限：@RequirePerm / auth::ensure（RBAC）      │
├──────────────────────────────────────────────┤
│ 业务层：每个模块 Entity → Service → Controller │
│ 能力：审核 / 导出 / 缓存 / 搜索 / 存储          │
├──────────────────────────────────────────────┤
│ 数据层：MySQL${p.database.cluster && p.database.cluster.enabled ? '（主从）' : ''} · Redis · 文件数据源 · 对象存储 │
└──────────────────────────────────────────────┘
\`\`\`

## 请求链路

1. 请求进入 → 限流（Redis 计数）；
2. 解析 JWT（Header 或 Cookie）→ 加载权限（Redis 缓存 10 分钟）；
3. 权限拦截器比对 \`@RequirePerm\`；
4. Controller 调 Service；写操作记 \`@OpLog\`；
5. 读命中 \`CacheService\` 直接返回；写后精准失效；
6. 搜索字段变更时同步倒排索引。

## 数据模型

所有业务表共享：\`id\`（${p.idStrategy}）、\`version\`、\`created_at\`、\`updated_at\`、\`created_by\`、\`updated_by\`、\`deleted\`${p.integrations.tenant ? '、`tenant_id`（自动过滤）' : ''}。

表数量：${ir.stats.tables}（MySQL ${ir.stats.mysqlTables} / 文件 ${ir.stats.fileTables}）。
`;
}

function gitignore(ir) {
  const p = ir.project;
  if (p.lang === 'rust') {
    return `/target
.env
storage/
*.log
.idea/
.vscode/
`;
  }
  return `/target
!.mvn/wrapper/maven-wrapper.jar
.env
storage/
*.log
.idea/
*.iml
.vscode/
`;
}

function envExample(ir) {
  const p = ir.project;
  return `# ${p.name} 环境变量
PORT=${p.port}
DB_HOST=${p.database.host}
DB_PORT=${p.database.port}
DB_NAME=${p.database.name}
DB_USER=${p.database.user}
DB_PASSWORD=${p.database.password}
${p.database.cluster && p.database.cluster.enabled ? `DB_READ_URL=mysql://${p.database.user}:${p.database.password}@${p.database.cluster.readHosts[0] || p.database.host}:${p.database.port}/${p.database.name}\n` : ''}${p.redis.enabled ? `REDIS_URL=redis://${p.redis.nodes[0] || '127.0.0.1:6379'}/\nREDIS_MODE=${p.redis.mode}\n` : ''}JWT_SECRET=${p.security.jwtSecret}
TOKEN_TTL=${p.security.ttlSeconds}
INIT_ADMIN=${p.security.initAdmin}
INIT_PASSWORD=${p.security.initPassword}
STORAGE_PROVIDER=${p.storage.provider}
STORAGE_ENDPOINT=${p.storage.endpoint}
STORAGE_BUCKET=${p.storage.bucket}
STORAGE_ACCESS_KEY=${p.storage.accessKey}
STORAGE_SECRET_KEY=${p.storage.secretKey}
`;
}

function generateDocs(ir) {
  return [
    { path: 'README.md', content: readme(ir) },
    { path: 'docs/API.md', content: apiDoc(ir) },
    { path: 'docs/PERMISSIONS.md', content: permissionDoc(ir) },
    { path: 'docs/DATASOURCES.md', content: dataSourceDoc(ir) },
    { path: 'docs/ARCHITECTURE.md', content: architectureDoc(ir) },
    { path: '.env.example', content: envExample(ir) },
    { path: '.gitignore', content: gitignore(ir) },
    { path: 'clickbuild.json', content: clickbuildJson(ir) },
  ];
}

module.exports = { generateDocs, clickbuildJson };
