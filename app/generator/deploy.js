'use strict';
/**
 * 部署与编排产物：拓扑导出、多库集群说明、网关配置、微服务拆分清单与构建脚本。
 * 这些文件不参与代码编译，但决定"这套工程怎么落地成一堆节点"。
 */

const N = require('./naming');

function safeName(s) {
  return N.kebab(String(s || 'node')).replace(/_/g, '-');
}

/** 拓扑图：优先用画布上的节点/连线，没有就按服务与库自动排。 */
function flowDiagram(ir) {
  const p = ir.project;
  const nodes = ir.topology.nodes;
  const edges = ir.topology.edges;
  const lines = ['flowchart LR'];
  const id = (x) => safeName(x);

  if (nodes.length) {
    nodes.forEach((n) => {
      const shape = n.kind === 'db' ? `[(${n.name})]`
        : n.kind === 'redis' ? `[(${n.name})]`
          : n.kind === 'gateway' ? `{{${n.name}}}`
            : n.kind === 'storage' ? `[(${n.name})]`
              : `[${n.name}]`;
      lines.push(`  ${id(n.id)}${shape}`);
    });
    edges.forEach((e) => lines.push(`  ${id(e.from)} -->${e.label ? `|${e.label}|` : ''} ${id(e.to)}`));
  } else {
    lines.push(`  client[客户端] --> ${id(p.name)}["${p.name}"]`);
    ir.services.forEach((s) => lines.push(`  ${id(p.name)} --> ${id(s.id)}["${s.name} :${s.port}"]`));
    (ir.clusters || []).forEach((c) => lines.push(`  ${id(p.name)} --> ${id(c.name)}[("${c.name} ${c.host}:${c.port}")]`));
  }
  return lines.join('\n');
}

/** ER 图：按"模块 → 表"的分组关系画（没有外键信息时这是最稳的近似）。 */
function erDiagram(ir) {
  const lines = ['erDiagram'];
  const groups = new Map();
  ir.tables.forEach((t) => {
    const g = t.moduleId || 'other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  });
  [...groups.keys()].forEach((g) => lines.push(`  ${safeName(g)} ||--o{ ${safeName(g)}_tables : "包含"`.replace(/"/g, '')));
  // 表与字段（只画主键与几个关键列，避免图过大）
  ir.tables.slice(0, 40).forEach((t) => {
    lines.push(`  ${safeName(t.name)} {`);
    const cols = t.columns.slice(0, 6);
    cols.forEach((c) => lines.push(`    ${String(c.type || 'varchar').replace(/[^A-Za-z0-9_()]/g, '')} ${safeName(c.name)}`));
    lines.push('  }');
  });
  return lines.join('\n');
}

function topologyMd(ir) {
  const p = ir.project;
  const svc = ir.services.map((s) => `- \`${s.id}\`（${s.name}）端口 ${s.port}${s.prefix ? `，网关前缀 \`/${s.prefix}\`` : ''}：${s.modules.join(', ')}`).join('\n');
  const db = (ir.clusters || []).map((c) => `- \`${c.name}\` ${c.role}${c.readonly ? '（只读）' : ''} ${c.host}:${c.port} 权重 ${c.weight}`).join('\n');
  return `# 拓扑 / ER / 脑图

> 这份文件由画布导出。改拓扑请回工具里拖节点，不要手改这里（会被覆盖）。

## 服务与节点（flowchart）

\`\`\`mermaid
${flowDiagram(ir)}
\`\`\`

## 服务清单

${svc}

## 数据库集群

${db}

- 分流策略：\`${p.database.routing.strategy}\`，读写分离：${p.database.routing.readWriteSplit ? '开' : '关'}
- 防脑裂：${p.database.failover.enabled && p.database.failover.splitBrainGuard ? `开（租约 ${p.database.failover.leaseSeconds}s，quorum ${p.database.failover.quorum}）` : '关'}
- 健康检查：每 ${p.database.routing.healthCheckMs}ms，连续失败 ${p.database.routing.failoverThreshold} 次摘除

## ER（模块 → 表）

\`\`\`mermaid
${erDiagram(ir)}
\`\`\`

## 脑图

\`\`\`
${p.name}
${ir.services.map((s) => `├─ ${s.name} (${s.id})\n${s.modules.map((m) => `│   ├─ ${m}`).join('\n')}`).join('\n')}
└─ 基础设施
${(ir.clusters || []).map((c) => `    ├─ ${c.name} ${c.host}:${c.port}`).join('\n')}
${p.redis.enabled ? '    ├─ redis\n' : ''}${p.storage.provider !== 'local' ? `    └─ ${p.storage.provider} ${p.storage.bucket}` : ''}
\`\`\`
`;
}

function onrouterYaml(ir) {
  const g = ir.gateway;
  const p = ir.project;
  const routes = (g.routes.length ? g.routes : ir.services.filter((s) => s.prefix).map((s) => ({ id: s.id, prefix: `/${s.prefix}`, upstream: `http://${s.id}:${s.port}`, stripPrefix: true })))
    .map((r) => `  - id: ${r.id}
    prefix: ${r.prefix}
    upstream: ${r.upstream}
    strip_prefix: ${r.stripPrefix !== false}`).join('\n');
  return `# ONRouter 网关配置（ClickBuildServer 生成）
# 字段名按 ONRouter 你自己的版本微调；这里是"能跑通的最小骨架"。
# upstream 默认写的是容器服务名（docker compose 网络内可直接用）；
# 本机裸跑时把主机名换成 127.0.0.1、端口保持不变。
server:
  port: ${g.port}
  # 网关自身也要有一层闸：限流 + 安全头
  rate_limit:
    enabled: ${g.rateLimit.enabled}
    rps: ${g.rateLimit.rps}

auth:
  jwt:
    enabled: ${g.jwtVerify}
    secret: "${p.security.jwtSecret}"
    header: "Authorization"
    cookie: "${p.security.cookieName}"
    # 透传给后端的用户身份（后端会先看 X-Luid 头）
    inject_headers:
      X-Luid: "$luid"
      X-User-Id: "$uid"

routes:
${routes || '  []'}

cors:
  enabled: ${ir.waf.cors.enabled}
  origins: [${ir.waf.cors.origins.map((o) => `"${o}"`).join(', ')}]
  credentials: ${ir.waf.cors.credentials}
`;
}

function gatewayReadme(ir) {
  const g = ir.gateway;
  return `# 网关（ONRouter）

生成物：

- \`gateway/onrouter.yaml\` —— 路由表 + JWT 透传 + 限流 + CORS
- \`scripts/fetch-onrouter.ps1\` / \`.sh\` —— 把你的 ONRouter 仓库拉下来并构建

## 拉源码

\`\`\`powershell
.\\scripts\\fetch-onrouter.ps1 -Repo <你的仓库地址>
\`\`\`

\`\`\`bash
bash scripts/fetch-onrouter.sh <你的仓库地址>
\`\`\`

拉下来之后按仓库自己的构建方式编译（脚本会自动识别 Cargo / go.mod / package.json）。
仓库地址留空时脚本不会乱猜，直接报错让你填。

## 路由约定

| 前缀 | 上游 |
| --- | --- |
${(g.routes.length ? g.routes : []).map((r) => `| \`${r.prefix}\` | ${r.upstream} |`).join('\n') || '| （未启用微服务，单应用直连） |  |'}

- 网关只做三件事：鉴权（校验 JWT，注入 \`X-Luid\`）、限流、按前缀转发；
- 业务权限仍由各服务自己判（网关不替你做数据归属）；
- 想换成 Nginx / APISIX，改 \`gateway/\` 下的配置即可，路由表是同一份结构。
`;
}

function fetchPs1() {
  return `# ONRouter 源码拉取 + 构建（Windows）
param(
  [Parameter(Mandatory = $false)][string]$Repo = "",
  [string]$Dir = "gateway/onrouter-src"
)
$ErrorDetected = $false
if (-not $Repo) {
  Write-Error "未提供仓库地址。用法：.\\scripts\\fetch-onrouter.ps1 -Repo https://github.com/<you>/onrouter.git"
  exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "未找到 git"
  exit 1
}
if (Test-Path $Dir) {
  Push-Location $Dir
  git pull --ff-only
  Pop-Location
} else {
  git clone --depth 1 $Repo $Dir
}
Push-Location $Dir
if (Test-Path "Cargo.toml") {
  cargo build --release
} elseif (Test-Path "go.mod") {
  go build -o onrouter.exe ./...
} elseif (Test-Path "package.json") {
  npm ci
  npm run build
} else {
  Write-Error "无法识别工程类型（Cargo.toml / go.mod / package.json 都没有）"
  $ErrorDetected = $true
}
Pop-Location
if ($ErrorDetected) { exit 1 }
Write-Output "完成：$Dir"
`;
}

function fetchSh() {
  return `#!/usr/bin/env bash
# ONRouter 源码拉取 + 构建（Linux / macOS）
set -e
REPO="\${1:-}"
DIR="\${2:-gateway/onrouter-src}"
if [ -z "$REPO" ]; then
  echo "未提供仓库地址。用法：bash scripts/fetch-onrouter.sh <git-url>" >&2
  exit 1
fi
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"
if [ -f Cargo.toml ]; then
  cargo build --release
elif [ -f go.mod ]; then
  go build -o onrouter ./...
elif [ -f package.json ]; then
  npm ci && npm run build
else
  echo "无法识别工程类型" >&2
  exit 1
fi
echo "完成：$DIR"
`;
}

function servicesCompose(ir) {
  const p = ir.project;
  const lang = p.lang;
  const serviceBlocks = ir.services.map((s) => `  ${s.id}:
    build:
      context: ../services/${s.id}
    restart: unless-stopped
    ports: ["${s.port}:${s.port}"]
    environment:
      PORT: "${s.port}"
      DB_MODE: "cluster"
    depends_on:${(ir.clusters || []).map((c) => `\n      - ${safeName('mysql-' + c.name)}`).join('')}${p.redis.enabled ? '\n      - redis' : ''}`).join('\n\n');

  const gatewayBlock = ir.gateway.enabled ? `

  gateway:
    image: ${ir.gateway.image || 'onrouter:latest'}
    restart: unless-stopped
    ports: ["${ir.gateway.port}:${ir.gateway.port}"]
    volumes:
      - ../gateway/onrouter.yaml:/etc/onrouter/onrouter.yaml:ro
    depends_on:${ir.services.map((s) => `\n      - ${s.id}`).join('')}` : '';

  return `# 只包含「服务 + 网关」这一层，基础设施（MySQL 集群 / Redis / MinIO）复用主编排：
#   docker compose up -d          # 先起主 docker-compose.yml 的基础设施
#   docker compose -f deploy/compose-services.yml up -d --build
# 下面的外部网络名就是主编排的默认网络（${safeName(p.name)}_default）。
name: ${safeName(p.name)}-services

services:
${serviceBlocks}${gatewayBlock}

networks:
  default:
    external: true
    name: ${safeName(p.name)}_default
`;
}

function buildPs1(ir) {
  return `# 逐服务生成独立工程（多 jar / 多二进制）
# 生成物本身不含生成器，所以要把 ClickBuildServer 目录告诉脚本：
#   $env:CBS_HOME = "D:\\tools\\ClickBuildServer"; .\\build-services.ps1
# 或：.\\build-services.ps1 -Cbs "D:\\tools\\ClickBuildServer" -Zip
param(
  [string]$Cbs = $env:CBS_HOME,
  [switch]$Zip,
  [string]$Lang = "${ir.project.lang}"
)
$ErrorActionPreference = "Stop"
if (-not $Cbs) { throw "请先用 -Cbs 参数或环境变量 CBS_HOME 指定 ClickBuildServer 目录" }
$cli = Join-Path $Cbs "app\\gen-cli.js"
if (-not (Test-Path $cli)) { throw "找不到生成器：$cli" }
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "dist"
New-Item -ItemType Directory -Force $out | Out-Null
$argv = @($cli, "--lang", $Lang, "--out", $out)
if ($Zip) { $argv += "--zip" }
Get-ChildItem (Join-Path $root "services") -Directory | ForEach-Object {
  $proj = Join-Path $_.FullName "project.json"
  if (Test-Path $proj) {
    Write-Output "==> $($_.Name)"
    & node @argv --project $proj --name $_.Name
    if ($LASTEXITCODE -ne 0) { throw "生成失败：$($_.Name)" }
  }
}
Write-Output "完成：$out（每个服务一个可独立构建的工程）"
`;
}

function buildSh(ir) {
  return `#!/usr/bin/env bash
# 逐服务生成独立工程（多 jar / 多二进制）
# 用法：CBS_HOME=/path/to/ClickBuildServer ./build-services.sh [lang]
set -e
LANG="\${1:-${ir.project.lang}}"
: "\${CBS_HOME:?请先设置 CBS_HOME 指向 ClickBuildServer 目录}"
CLI="$CBS_HOME/app/gen-cli.js"
[ -f "$CLI" ] || { echo "找不到生成器：$CLI" >&2; exit 1; }
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/dist"
mkdir -p "$OUT"
cd "$ROOT"
for d in services/*/; do
  if [ -f "\${d}project.json" ]; then
    name="$(basename "$d")"
    echo "==> $name"
    node "$CLI" --lang "$LANG" --out "$OUT" --project "\${d}project.json" --name "$name"
  fi
done
echo "完成：$OUT（每个服务一个可独立构建的工程）"
`;
}

function serviceProject(ir, s) {
  const p = JSON.parse(JSON.stringify(ir.project));
  p.name = s.name || s.id;
  p.artifact = safeName(s.id);
  p.port = s.port;
  p.modules = s.modules;
  p.microservices = { enabled: false, mode: 'module-group' };
  p.topology = { nodes: [], edges: [] };
  p.gateway = { ...p.gateway, enabled: false, routes: [] };
  return JSON.stringify(p, null, 2) + '\n';
}

function serviceReadme(ir, s) {
  return `# ${s.name}（${s.id}）

- 端口：${s.port}
- 网关前缀：\`${s.prefix ? '/' + s.prefix : '（无）'}\`
- 模块：${s.modules.join(', ')}
- 表：${s.tables.map((t) => t.name).join(', ') || '（无）'}

## 单独生成

\`\`\`bash
node app/gen-cli.js --project services/${s.id}/project.json --out dist --name ${s.id}
\`\`\`

或者一把梭：

\`\`\`bash
bash build-services.sh     # 或 .\\build-services.ps1
\`\`\`

产物是独立工程，可以单独打 jar / 打二进制；网关按 \`gateway/onrouter.yaml\` 的前缀转发过来。
`;
}

function clustersMd(ir) {
  const p = ir.project;
  const rows = (ir.clusters || []).map((c) => `| \`${c.name}\` | ${c.role} | ${c.readonly ? '只读' : '可写'} | ${c.host}:${c.port} | ${c.weight} |`).join('\n');
  return `# 多库多集群 / 主从 / 分流 / 防脑裂

| 节点 | 角色 | 读写 | 地址 | 权重 |
| --- | --- | --- | --- | --- |
${rows}

## 生成出来的行为

- **分流**：\`${p.database.routing.strategy}\`（round-robin / weighted / hash）
- **读写分离**：${p.database.routing.readWriteSplit ? 'GET 与只读事务走从库，写走主库' : '关闭，全部走主库'}
- **健康检查**：每 ${p.database.routing.healthCheckMs}ms 探活，连续失败 ${p.database.routing.failoverThreshold} 次摘除，恢复自动加回
- **防脑裂**：写之前抢 Redis 租约（\`db:leader:<app>\`，TTL ${p.database.failover.leaseSeconds}s）；抢不到就拒写并返回 503
- **主从**：\`docker-compose.yml\` 里每个节点一个 MySQL；从库用 \`--read-only\`，\`scripts/setup-replica.sh\` 生成复制配置

## 为什么这样防脑裂

租约是"唯一写入口"的弱共识：网络分区时，只有能刷新 Redis 的那一侧继续写；另一侧写请求直接 503，不会出现两个主库各写一半。
要更强的保证，把 \`quorum\` 调到奇数并把租约换成 etcd / Raft —— 代码里的位置就是 \`ensureLeader()\`。
`;
}

function generateDeploy(ir) {
  const p = ir.project;
  const files = [
    { path: 'deploy/topology.md', content: topologyMd(ir) },
    { path: 'deploy/topology.json', content: JSON.stringify({ nodes: ir.topology.nodes, edges: ir.topology.edges, services: ir.services.map((s) => ({ id: s.id, name: s.name, port: s.port, prefix: s.prefix, modules: s.modules })) }, null, 2) + '\n' },
    { path: 'deploy/db-clusters.md', content: clustersMd(ir) },
  ];

  if (ir.gateway.enabled) {
    files.push({ path: 'gateway/onrouter.yaml', content: onrouterYaml(ir) });
    files.push({ path: 'gateway/README.md', content: gatewayReadme(ir) });
    files.push({ path: 'scripts/fetch-onrouter.ps1', content: fetchPs1() });
    files.push({ path: 'scripts/fetch-onrouter.sh', content: fetchSh() });
  }

  if (p.microservices && p.microservices.enabled) {
    ir.services.forEach((s) => {
      files.push({ path: `services/${s.id}/project.json`, content: serviceProject(ir, s) });
      files.push({ path: `services/${s.id}/README.md`, content: serviceReadme(ir, s) });
    });
    files.push({ path: 'deploy/compose-services.yml', content: servicesCompose(ir) });
    files.push({ path: 'build-services.ps1', content: buildPs1(ir) });
    files.push({ path: 'build-services.sh', content: buildSh(ir) });
  }

  return files;
}

module.exports = { generateDeploy, flowDiagram, erDiagram, onrouterYaml };
