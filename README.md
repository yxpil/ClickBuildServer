# ClickBuildServer

> ⚠️ **未定稿 · WIP**：本项目仍在开发中，由 AI 持续编写。接口、配置字段、生成物结构都还会变，请勿直接用于生产；遇到不一致以仓库最新提交为准。

**服务器快速制造工具** —— 勾选业务模块，直接产出一台能跑的服务器工程：**Java JAR / Java WAR / Node.js / Go**（Rust 为实验性），同时生成 MySQL 建表脚本、Docker 编排、接口文档、权限矩阵。

不是脚手架模板拼接：所有产物由同一份 **IR（中间表示）** 渲染，所以业务表、权限码、路由、缓存键、搜索字段在四种语言里严格一致，工程之间可以相互转换——同一个 `clickbuild.json`，换个 `lang` 重新生成就是另一套栈。

---

## 快速开始

```bash
npm install
npm start
```

无 GUI 也可用 CLI 出活：

```bash
node app/gen-cli.js --self-test                              # 生成四套样例 + ZIP
node app/gen-cli.js --all-modules --lang go --out ./generated
node app/gen-cli.js --project samples/commerce-project.json --lang node
node app/gen-cli.js --help
```

生成出来的工程各自怎么跑：

| 语言 | 构建 / 启动 | 依赖 |
| --- | --- | --- |
| Java | `mvn -B -DskipTests package` → `java -jar target/click-server.jar` | JDK 17+、Maven |
| Node.js | `npm install && npm start` | Node 18+ |
| Go | `go mod tidy && go build ./...` → `./click-server` | Go 1.22+ |
| Rust（实验） | `cargo build --release` | Rust + MSVC |

四种语言都支持 `--selfcheck`：不连数据库，打印表、路由、模块清单，用来确认生成物自洽。

---

## 界面：六步

| 步骤 | 做什么 |
| --- | --- |
| 1 业务模块 | 48 个内置模块 + 自定义表。点卡片即入购物车，自动补齐依赖（审核 → 文件 → 账号 → 角色） |
| 2 拓扑编排 | ComfyUI 式画布：左侧节点库（服务 / 网关 / 数据库 / Redis / 对象存储 / 客户端 / 模块），中间拖动摆放、连线，右侧改属性。画布即部署结构，也是微服务切分依据 |
| 3 工程配置 | 语言 / 包类型 / ID 策略 / MySQL / **集群与分流** / Redis / 对象存储 / 搜索 / 安全（含 **LUID**、数据归属、验证码通道）/ **防护 WAF** / **网关与微服务** |
| 4 自定义表 / 数据源 | 写 `字段|类型|注释|标记` 就能建表；引擎选 CSV / JSON / Excel 时文件直接当数据库；同页可加**自定义 SQL 查询**与**自定义积木** |
| 5 权限矩阵 | 自动推导的 `模块:动作` 权限码 × 角色，只读预览 |
| 6 生成预览 | 文件树 + 源码查看 + 一键生成 / ZIP / 本地编译 |

右侧是"已选业务"购物车：像加购物车一样加模块，点 `×` 移除；被依赖的模块会拦住你，避免生成出半台服务器。

---

## 内置业务（49 个）

### 平台能力（15）

| 模块 | 说明 | 关键能力 |
| --- | --- | --- |
| 统一登录 `auth` | JWT + HttpOnly Cookie + 会话表校验 | 登录 / 登出 / me / refresh |
| 账号 `account` | 用户、部门、状态 | 增删改查、禁用 |
| 角色权限 `rbac` | 角色、权限点、角色权限、用户角色 | `*` 超管、按接口鉴权 |
| 操作日志 `audit-log` | 中间件 / 切面落库 | 谁在何时改了哪条数据 |
| 审核流 `approval` | 提交 → 待办 → 通过 / 驳回 | 任意业务表可挂审核 |
| 字典 `dict` | 数据字典与字典项 | 前端下拉统一来源 |
| 多租户 `tenant` | 租户表 + `tenant_id` 过滤 | 一套库多客户 |
| 开放接口 `api-key` | 第三方密钥、配额 | 无 Cookie 调用 |
| 验证码 `captcha` | 图形 / 行为验证 | 登录防刷 |
| 短信邮箱验证码 `verify-code` | `sys_verify_code` + 通道适配 | `/captcha/send`、`/captcha/verify`，接你自建网关 |
| 任务 `task` | 定时任务登记与执行记录 | 手动触发 + 周期 |
| 通知 `notify` | 站内信 / 邮件 / Webhook 模板 | 业务事件通知 |
| 文件 `file` | 元数据 + 对象存储直传 | 预签名上传 / 下载 |
| 搜索 `search` | 任意表自定义搜索字段 | Redis 倒排 / Elasticsearch |
| 缓存 `cache` | Redis 旁路缓存 + 精准失效 | 按表开关、TTL 可调 |

### 交易与内容（19）

| 模块 | 说明 |
| --- | --- |
| 订单 `order` | 下单、状态机、金额、明细、审核 |
| 商品 `product` | SPU / SKU / 上下架 |
| 商品多规格 `product-variant` | 规格组 + 一商品多图多视频（`biz_product_spec` / `biz_product_media`） |
| 库存 `inventory` | 可用量、锁定、流水 |
| 支付 `payment` | 支付单、渠道、回调、退款流水 |
| 客户 `customer` | 客户档案、等级 |
| 购物车 `cart` | 加购、选中、数量 |
| 地址 `address` | 收货地址、默认地址 |
| 优惠券 `coupon` | 券模板、领取、核销 |
| 内容 `cms` | 栏目、文章、发布 |
| 评论 `comment` | 多级评论、审核 |
| 视频上传 `media-upload` | 按扩展名判定音频 / 文档 / 演示 / 视频 |
| 视频播放 `media-play` | 播放地址、鉴权、分区插件 |
| 视频分区 `media-partition` | 一个门户多分区，每分区挂不同插件 |
| 报表 `report` | 聚合查询与导出 |
| 导入导出 `import-export` | Excel / CSV 批量 |
| Webhook `webhook` | 事件推送、重试 |
| 供应商 `supplier` | 供应商档案、结算 |
| 合同 `contract` | 合同、附件、到期提醒 |

### 运营与社区（15）

`工单 ticket` · `积分 points` · `会员 member` · `签到 signin` · `钱包 wallet`（含提现） · `退款售后 refund` · `物流 logistics` · `评价 review` · `收藏 favorite` · `弹幕 danmaku` · `公告 notice` · `标签 tag` · `秒杀 seckill` · `发票 invoice` · `客服会话 im`

模块表定义在 `app/catalog.js`，加一个模块就是加一段声明——不用改生成器。

---

## 增删改查之外：条件查询

每张表（内置表、自定义表、CSV/JSON/Excel 文件表）都自动带一套统一的条件查询语法，四种语言实现一致：

```http
GET /api/order/biz-order?keyword=SO2026
GET /api/order/biz-order?status=1&amount__gte=100
GET /api/order/biz-order?created_at__between=2026-01-01,2026-02-01
GET /api/order/biz-order?filter={"status":{"in":[1,2]},"remark":{"like":"加急"}}&sort=created_at:desc&page=2&pageSize=20
```

| 参数 | 说明 |
| --- | --- |
| `keyword=` | 命中该表配置的 `search` 字段（LIKE 或倒排） |
| `字段=值` | 等值 |
| `字段__op=值` | `eq ne gt gte lt lte like in between isnull notnull` |
| `filter=` | JSON 组合条件，可嵌套 and/or |
| `sort=` | `a:desc,b:asc` |
| `page` / `pageSize` | 分页，上限 200 |

列名在生成期白名单化，运行期拼 SQL 只用白名单里的列，注入面为零。

### 条件增删改

除了按 id 增删改，每张表还生成三条"条件版"接口（Node / Go / Java 一致）：

```http
POST   /api/order/biz-order/batch        # body 是 JSON 数组：一次插入多条
PATCH  /api/order/biz-order?status=0     # body 是 { "set": {...} } 或直接字段：把条件命中的行改掉
DELETE /api/order/biz-order?status=0     # 不带 id：按条件批量删（有 deleted 列则逻辑删除）
```

条件是同一套 `字段 / 字段__op / filter / sort` 语法；模型表不支持的（文件表条件更新/删除）会明确报错，不做伪实现。

---

## 数据归属：按用户 / 按 ID 控权

角色权限回答"这个角色能不能调用这个接口"；数据归属回答"这条数据是不是你的"：

- 登录时服务端给每条数据打 `created_by`（可改列名，`tableConfig.<表>.ownerField`）；
- 列表 / 详情 / 更新 / 删除时，非超管（没有 `*`）自动附加 `created_by = 当前用户`；
- 超管（`*`）不受限；`security.ownerGuard=false` 可整体关掉；
- 条件查询 / 条件更新 / 条件删除同样带归属过滤，不会越权刷到别人的行。

---

## 逻辑用户编号（LUID）

前端不该知道真实 `userId`。登录后服务端签发一个 LUID（`L` + 时间戳 + 随机），把 `userId / username / perms` 写进 Redis（或进程内缓存），令牌里只放 LUID：

```json
{ "token": "...", "userId": 1, "username": "admin", "luid": "Lm3k9x7f2a1", "perms": ["*"] }
```

- 请求带 `X-Luid`（或令牌里的 `luid` claim）时直接命中缓存，**不查库**；
- 登出、刷新会让旧 LUID 立即失效；
- 业务里可以把 LUID 当作"逻辑用户编号"做更细的权限判定（比如按 `ownerField` 记录归属、按分区/插件放开）。

配置在 `security.luid`：

```json
"luid": { "enabled": true, "cache": "auto", "ttlSeconds": 3600, "headerName": "X-Luid" }
```

`cache=auto`：有 Redis 用 Redis（多实例共享），没有就退到进程内内存。

---

## 自定义积木

"我们不做服务器，我们做服务器的积木盒子"——除了内置模块，你还能写自己的工具，一个积木就是一条带鉴权的路由：

```json
"blocks": [
  {
    "id": "order-stat",
    "name": "订单统计",
    "method": "POST",
    "perm": "order:list",
    "params": ["day"],
    "code": "const rows = await ctx.db.query('SELECT COUNT(*) AS n FROM biz_order'); return { total: rows[0].n };"
  }
]
```

生成后：

| 语言 | 产物 | 你改哪里 |
| --- | --- | --- |
| Node | `src/blocks.js` | 直接改 `handler(ctx)`，`ctx` 里有 `db / cache / ids / user` |
| Go | `internal/blocks/blocks.go` | 改 `Handler(c *Ctx)`；原 JS 片段以注释保留 |
| Java | `modules/blocks/BlockRegistry.java` | 改 `private Map<String,Object> xxx(...)` 方法体 |

- 路由统一 `/api/blocks/<id>`（Java 为 `/blocks/<id>`），另有 `GET /api/blocks` 列出全部积木；
- `perm` 为空表示登录即可，填了按权限码校验；
- Node 侧生成期会**先校验你写的 JS 语法**：不合法就降级成注释 + 可运行骨架，不会把整个工程弄崩；Go / Java 侧本来就是"注释 + 骨架"，照着自己的栈重写。

---

## 短信 / 邮箱验证码（只做对接）

不做短信/邮件服务，只做**对接层**：生成 `sys_verify_code` 表、`/captcha/send|verify|channels` 接口，以及一个把验证码 POST 到你自建网关的适配器。

```json
"verification": {
  "sms":   { "provider": "http", "endpoint": "https://sms.example.com/send", "signName": "ClickBuild", "templateCode": "SMS_123" },
  "email": { "provider": "http", "host": "https://mail.example.com/send", "from": "noreply@example.com" }
}
```

- `provider=none`（默认）：只打 `dry-run` 日志，验证码照常入库，方便本地联调；
- `provider=http`：把 `{target, code, scene, signName, templateCode}` POST 给网关，网关返回 2xx 即视为发送成功；
- 校验时缓存优先、回落 `sys_verify_code`，用过即 `used=1`；
- 你要接阿里云/腾讯云/SES，就在适配器里加一个 provider 分支——接口形状已经留好。

---

## 自定义 SQL

界面「自定义表 / 数据源」页下方，或直接写进 `clickbuild.json`：

```json
"queries": [
  {
    "name": "order-status-report",
    "method": "GET",
    "perm": "report:list",
    "params": ["beginDate", "endDate"],
    "sql": "SELECT status, COUNT(*) AS cnt FROM biz_order WHERE created_at BETWEEN :beginDate AND :endDate GROUP BY status"
  }
]
```

生成后就是一条带鉴权的固定接口：

```http
GET /api/query/order-status-report?beginDate=2026-01-01&endDate=2026-02-01
```

- SQL 文本在生成期固化在 `schema.queries`（Node/Go）/ `QueryDef`（Java）里，运行期**不接受用户传入 SQL**；
- `:param` 在运行期只做绑定（Node `?` 占位、Go 预编译、Java `NamedParameterJdbcTemplate`）；
- `perm` 为空表示"登录即可"，填了就按权限码鉴权。

适合跨表聚合、报表、看板这类"条件查询拼不出来"的查询。

---

## 视频上传怎么限制类型

`media-upload` 模块按扩展名判定资产类型，服务端拿扩展名 + MIME 双检，桶里按 `业务/年/月/uuid.ext` 分目录：

| 业务 | 允许 |
| --- | --- |
| 音频 | mp3 / wav / flac / aac / ogg / m4a |
| 文档 | doc / docx / pdf / txt / md |
| 演示 | ppt / pptx |
| 表格 | xls / xlsx |
| 视频 | mp4 / mov / mkv / avi / webm / flv |
| 图片 | png / jpg / jpeg / gif / webp |

上传接口返回 `assetType`（audio/video/doc/image/archive/other），前端按它分目录展示。

---

## 视频分区 × 插件

一个播放站点常有多个分区（电影 / 课程 / 短视频 / 音乐），每个分区想用不同的播放策略——`media-partition` 模块就是干这个的：

```
media_partition(partition_code, partition_name, plugin_code, plugin_config, sort, status)
media_plugin(plugin_code, plugin_name, kind, version, config_schema, enabled)
media_partition_asset(partition_id, asset_id, sort)
```

内置插件：`passthrough`（直链）、`signed`（签名防盗链）、`watermark`（水印）、`drm`（密钥鉴权）。加插件就是加一条 `media_plugin` 记录；播放路由固定为：

```http
GET /api/media/play/<partition>/<assetId>
```

服务端按 `partition_code` 查插件配置再决定返回直链还是签名地址——本质是同一个播放逻辑，不同分区不同策略。

---

## 数据源：文件也能当数据库

「自定义表」里把引擎设为 CSV / JSON / Excel，填字段即可：

```
name|varchar(64)|姓名|req,search
age|int|年龄
```

生成器会：

1. 在 `data/` 放带表头的样例文件；
2. 生成文件表访问层（Java `FileTableStore` / Node `filesource.js` / Go `filesource.go`）；
3. 提供与 MySQL 表完全相同的 REST 接口（分页、详情、增删改、条件查询）；
4. 写入回写文件（Excel 运行时只读，建议 CSV / JSON）。

适合配置表、字典、小批量主数据；超过 20 万行请导 MySQL。

---

## MySQL 集群 / Redis / 对象存储

- **读写分离**：`database.cluster.enabled` + `readHosts`，或直接填 `database.clusters[]`。读走从库、写走主库（Node 双池、Go 双 `*sql.DB`、Java dynamic-datasource）。
- **多库多集群**：`clusters` 里每个节点写 `名称 | primary/replica | host:port | 权重`。生成期落到 `DbClusterRegistry`（Java）/ `pickWrite/pickRead`（Node）/ `internal/db`（Go）：每集群独立连接池、健康检查摘除与恢复、`round-robin` / `weighted` 分流。
- **防脑裂**：写之前抢 Redis 租约 `db:leader:<app>`（`SET … NX EX`）；抢不到的实例写请求直接 503，不会出现两个主库各写一半。`failover.quorum` 记录期望的法定人数。
- **Redis**：单机 / 哨兵 / 集群三套配置分别生成，用作会话、权限缓存、行缓存、搜索倒排；表级 `cache` + `cacheTtl` 可单独开关。
- **对象存储**：MinIO / S3 兼容 / 本地磁盘。前端直传不过服务器，服务端只发预签名。
- **Compose**：`docker compose up -d` 按 `clusters` 拉起每个 MySQL 节点（主库带 `--log-bin`，从库 `--read-only`）、Redis、MinIO（自动建 bucket）、应用/各微服务、网关；从库复制用 `scripts/setup-replica.sh`。

---

## 防护：WAF / CORS（三种语言都有）

进程内第一道闸，生成期变成 `WafFilter`（Java `@Order(1)`）/ `waf.js`（Node）/ `internal/waf`（Go）：

| 能力 | 配置 | 行为 |
| --- | --- | --- |
| SQL 注入 | `waf.sqlInjection` / `sqlInjectionBody` | URI + query 二次 `URLDecode` 后匹配，命中 403 |
| XSS | `waf.xss` | 同上，`<script>`、`onerror=` 等 |
| 路径穿越 | `waf.pathTraversal` | `../`、`..\`、`%2e%2e` 解码后判断 |
| CC 限流 | `waf.cc{rps,burst}` | 按 IP 令牌桶，超突发直接 403 |
| 并发上限 | `waf.ddos{maxConcurrent}` | 并发超过阈值直接 503，防基础 DDoS |
| CORS | `waf.cors{origins,credentials}` | 预检 204 + 精确 `Access-Control-Allow-Origin` |
| 安全头 | `waf.headers{frameOptions,hsts}` | `X-Frame-Options`、`X-Content-Type-Options`、HSTS |

请求体检测默认关（正文里出现 SQL 关键字太正常），需要时单独打开。

---

## 网关（ONRouter）与微服务

- **网关**：勾「生成 ONRouter 网关配置」后产出 `gateway/onrouter.yaml`（路由表、JWT 校验、`X-Luid`/`X-User-Id` 透传、限流、CORS）与 `scripts/fetch-onrouter.*`（填你自己的仓库地址就能克隆 + 构建，未填则只生成配置）。
- **微服务**：勾「导出微服务」后按**画布上的服务节点**切分（没画节点就按模块分组），每个服务一个完整工程：`services/<id>/project.json` + `README.md`，端口 `basePort + 10n`，前缀 `/svc-xxx`。
- **多 jar**：`build-services.ps1` / `.sh` 逐个服务调 CLI 生成独立工程，得到 N 个可独立构建部署的 jar（Java）/ 二进制（Go）。
- **编排**：`docker-compose.yml` 里直接就是「基础设施 + 各服务 + 网关」；`deploy/compose-services.yml` 是只含服务与网关的增量编排，复用主编排网络。

---

## 生成物长什么样

```
<项目名>/
├── pom.xml            # Java
├── go.mod / main.go   # Go
├── package.json       # Node
├── Cargo.toml         # Rust
├── sql/
│   ├── 00_database.sql
│   ├── 01_auth.sql … NN_seed.sql
│   └── FILE_DATASOURCES.md
├── data/                      CSV / JSON 数据源样例
├── docker-compose.yml         MySQL 集群 + Redis + MinIO + 应用/微服务 + 网关
├── Dockerfile
├── gateway/                   ONRouter 配置 + 使用说明（勾了网关才有）
├── services/<id>/             每个微服务的 project.json（勾了微服务才有）
├── deploy/                    拓扑图 / ER / 脑图 / 集群说明 / 服务编排
├── build-services.ps1|.sh     逐服务生成独立工程（多 jar）
├── docs/{API,PERMISSIONS,DATASOURCES,ARCHITECTURE}.md
├── clickbuild.json            ★ 项目源文件，可回灌重新生成
└── README.md
```

Java 是 `src/main/java/<pkg>/…`（Controller / Service / Entity / Mapper / 配置），Node 是 `server.js + src/*.js`，Go 是 `main.go + internal/*`，Rust 是 `src/*.rs + src/api/*`。

---

## 统一约定

- **统一 ID**：所有表主键都叫 `id`，由统一 ID 生成器产生；雪花 / ULID / UUID / 自增可切换，换语言不变。
- **公共字段**：`version` 乐观锁、`created_at/updated_at`、`created_by/updated_by`、`deleted` 逻辑删除，多租户再加 `tenant_id`。
- **权限**：`模块:动作`，如 `order:audit`、`file:upload`。超管 `*`。
- **返回体**：`{ code, message, data }`。
- **认证**：登录下发 JWT，同时写 HttpOnly Cookie + 会话表；后续请求 Cookie 或 `Authorization: Bearer` 二选一。

---

## 四种语言，一份配置

```bash
node app/gen-cli.js --project my.json --lang java --package war
node app/gen-cli.js --project my.json --lang node
node app/gen-cli.js --project my.json --lang go
```

`clickbuild.json` 里存的是业务语义（模块、表、字段、搜索、缓存、权限、自定义 SQL），不是某语言的代码。所以：

- 换语言是**重新渲染**，不是翻译；
- 表结构和权限码在四边完全一致；
- 已经上线的工程可以随时"反悔"换栈。

实测：48 模块 / 74 表的全量工程，Java `mvn package` 通过、Go `go build ./...` 通过、Node 全文件 `node --check` 通过。

---

## 架构

```
renderer (HTML/CSS/JS)
   │  IPC（contextIsolation，无 nodeIntegration）
main.js ── app/ipc.js ── app/generator/index.js
                              │
              ┌───────────────┼──────────────┐
           ir.js           sql.js        docs / docker
      （唯一真相源）      （DDL+seed）    （部署与文档）
              │
   ┌──────┬───┴────┬──────────┬──────────┐
 java.js  nodejs.js  go.js   rust.js
 +javaSupport +nodejsData +goData +rustSupport
             +nodejsServer +goData2
```

- `app/catalog.js`：48 个模块的定义（表、字段 DSL、能力、依赖）。
- `app/generator/ir.js`：把"勾选 + 自定义表 + 表级配置 + 自定义 SQL"归一化成扁平的 `modules/tables/queries/perms`。
- 语言生成器只读 IR，不读 UI 状态——CLI 与界面产出完全一致。

---

## CLI

```bash
node app/gen-cli.js --help
  --project <file>            读取项目 JSON
  --lang java|node|go|rust    目标语言
  --package jar|war           仅 Java
  --all-modules               全量模块
  --modules a,b,c             指定模块
  --name <name>               项目名
  --out <dir>                 输出根目录（默认 ./generated）
  --zip                       同时打 ZIP
  --self-test                 四套样例 + 校验
```

## 测试：静态三层 + 运行时冒烟

静态（不启动服务，几秒钟）：

```bash
npm test          # 前端 id 一致性 + 15 个生成用例 + 四套样例 self-test
```

运行时（真生成工程、真启动进程、真打 HTTP，约 20 秒）：

```bash
npm run test:runtime        # Node 版本，会顺带 npm install
npm run test:runtime:go     # Go 版本，需要 PATH 里有 go
```

它断言的是**行为**而不是文件存在，共 20 项：

| 断言 | 期望 | 为什么值得测 |
|---|---|---|
| `GET /api/health` | 200 + JSON | 容器/网关探活，不鉴权也不查业务表 |
| 未登录访问受保护接口 | 401 | 权限拦截真的在跑，不是只生成了注解 |
| `?id=1' or 1=1` | 403 | SQL 注入过滤器 |
| `?keyword=<script>` | 403 | XSS 过滤器 |
| `?path=../../etc/passwd` | 403 | 路径穿越 |
| `?id=1%2527...` | 403 | 二次编码绕过 |
| 请求体是坏 JSON | 400 | 之前会静默当 `{}` 然后 500 |
| 数据库连不上 | 503 且不含 `127.0.0.1:3306` | 之前把内网地址原样回给客户端 |
| 未知路由 | 404 + JSON | 不吐 HTML 堆栈 |
| CORS 预检 | 204 + ACAO | 跨域策略 |
| `X-Frame-Options` / `X-Content-Type-Options` | `DENY` / `nosniff` | 安全头 |
| 连打 60 次 | 出现 429 | CC 令牌桶 |
| `node server.js --selfcheck` | 列出全部路由 | 不装依赖也能自检 |

生成物里还留了 `npm run selfcheck`（即 `node server.js --selfcheck`），它把表数、查询数、165 条路由全打出来，适合丢进 CI 当"架构没被改坏"的守卫。

**故障处理策略**（运行时测试顺手定下的规矩）：数据库连不上 → 5 秒内 503，不透传内网地址；Redis 连不上 → 立刻降级到进程内缓存，不排队、不挂请求；坏 JSON → 400。缓存/日志这类旁路故障一律不影响主流程。

---

## 健康检查

三种语言都生成了 `GET <context-path>/health`（默认 `/api/health`），不鉴权、不查业务表：

```json
{"status":"UP","app":"rtshop","uptime":36,"db":true,"redis":"configured","time":"..."}
```

数据库节点全被摘除时 `status` 变 `DEGRADED` 但仍回 200——让编排器知道"活着但降级"，不触发反复重启。`docker-compose.yml` 里每个应用容器都挂了 healthcheck（Node/Go 用 `wget` 打 `/api/health`，Java 精简镜像用 `bash` 探 TCP 端口），微服务模式下每个 `svc-*` 容器各有一份。

---
检查：Java 包名 / 类型名 / 括号配平、Node 语法（vm 编译）与 require 路径、Go 括号与 go.mod、Rust 括号、SQL 主键与重名、自定义 SQL 的 `:param` 与路由、积木注册文件与路由、验证码适配文件、LUID 逻辑、ZIP 结构、模板未替换值。

---

## 已知限制

- **Rust 生成器是实验性的**：依赖能拉下来，但生成代码仍有类型错误未修；要 Rust 请当"半成品"看，生产用 Java / Go / Node。Rust 侧也还没生成验证码接口与积木。
- Go 工程首次构建需要 `go mod tidy`（生成的 `go.mod` 只含直接依赖），并需要能访问 goproxy。
- Java 本地编译需要 `mvn` 与 JDK 17+；JDK 24+ 上已显式配置 Lombok 注解处理器，否则 getter/setter 不生成。
- MySQL 分片（sharding）目前只保留配置位，未生成路由代码；读写分离已可用。
- Excel 文件表运行期只读，要写请用 CSV / JSON；Java 侧 Excel 支持会引入 `poi-ooxml`。
- 文件表（CSV / JSON / Excel）支持条件查询，但条件更新 / 条件删除会明确报错，请逐条改。
- 积木里写的 JS 片段在 Go / Java 侧只作为注释保留，需要你按 `Handler` / `Registry` 方法体重写；Node 侧会先校验语法再内联。
- LUID 默认进程内缓存无法跨实例共享，多实例部署请开启 Redis（`cache=auto` 会自动切）。
- **ONRouter 只出配置，不出二进制**：网关侧的 `gateway/onrouter.yaml`、`services/<id>/project.json`、`compose-services.yml` 是模板；`gateway.repo` 留空就只生成配置，填了 git 地址才会附带 `scripts/fetch-onrouter.*` 去拉源码。仓库 schema 随版本变化，拿到真实仓库后请对照调整 yaml 字段。
- **本机没有 docker**：`docker-compose.yml` 的结构由静态校验保证，未跑过 `docker compose config`；`build-services.ps1` 也只验证了生成、未在真机编译全部服务。
- **微服务是"一份配置拆多工程"**：每个服务都是独立可编译的完整工程（含自己的 WAF / 集群 / 缓存），但服务之间没有共享订单表这类跨库事务；跨服务数据请走网关路由 + 各自 API。
- 拓扑画布是纯前端 SVG 实现（无第三方图库）：节点可拖动、可连线、可自动排布，但不支持缩放与分组框；节点超过 40 个时建议按服务拆多个视图。
- WAF 的 CC / DDoS 计数在进程内存里，多实例部署时每个实例独立计数；要做全局限流请交给网关（`gateway.rateLimit`）。

---

## License

内部工具，随用随改。
