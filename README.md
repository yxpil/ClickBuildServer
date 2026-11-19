# ClickBuildServer · 接口工作台

[![CI](https://github.com/yxpil/ClickBuildServer/actions/workflows/ci.yml/badge.svg)](https://github.com/yxpil/ClickBuildServer/actions/workflows/ci.yml)
[![Release](https://github.com/yxpil/ClickBuildServer/actions/workflows/release.yml/badge.svg)](https://github.com/yxpil/ClickBuildServer/actions/workflows/release.yml)

> 黑白 Excel 风的“服务器制造台”：**一个接口一条线，接口里挂多张表、多个库，每条路由写一段自己的 SQL 脚本**，点一下生成可运行的服务。
>
> 工作中间版本，接口与数据结构仍可能调整。

---

## 它是什么

不是“勾模块 → 整台服务器一次生成”。最小单位是**接口**：

```
接口（订单）
├─ 表 biz_order      （主表，连接 main）
├─ 表 biz_order_item （明细表，可换库/换连接）
└─ 路由
   ├─ GET    /orders          列表（条件查询 + Redis 缓存）
   ├─ GET    /orders/:id      详情
   ├─ POST   /orders          新建（默认事务）
   ├─ PUT    /orders/:id      更新（默认事务）
   ├─ DELETE /orders/:id      删除（默认事务）
   ├─ GET    /orders/with-items   多表 LEFT JOIN
   └─ POST   /orders/tx-demo      插两张表再回滚（演示原子性）
```

每个接口、每条路由都可以单独改 SQL、单独开缓存、单独限流/定时窗/熔断；互不牵连。

## 前端模式（PageStudio / .yxpp）

页眉的「接口 / 前端」切换进入内置 PageStudio（`renderer/studio.html`，来自 yxpil.com/studio 的单文件编辑器）。

- 在画布上拖拽排版，点「保存到当前工程」把设计存成 `.yxpp`（JSON：`format/version/name/framework/project/html`）。
- 「导出 .yxpp」得到独立前端工程；「导入 .yxpp」可把已有工程重新挂回项目。
- 生成服务时，`.yxpp` 会一起写入产物：`frontend/index.yxpp`、`frontend/project.json`、`public/index.html`。服务的 `/` 优先返回前端页面，`/frontend/index.yxpp` 提供只读工程。
- `.yxpn` 工程包里同样带 `frontend/index.yxpp`，manifest 里有 `frontend` 元信息，换机器也能继续编辑。
- 22 套内置案例全部预置 `.yxpp` 前端；套用模版后可直接在「前端」里编辑，或生成服务访问 `/` 使用案例控制台（登录、路由试运行、数据表格、JSON 响应）。

## 快速开始

### 直接安装（Windows）

```text
dist\ClickBuildServer-Setup-1.1.4.exe
```

也可以从 GitHub Releases 下载最新版：[ClickBuildServer Releases](https://github.com/yxpil/ClickBuildServer/releases/latest)。

1.0.4 起，生成服务自带 `/help` 帮助页（快速入口、接口路由、请求约定、SQL 占位符、脚本语句、内置函数、curl 示例），并在 `/docs` 和 `/console` 页眉提供入口。1.0.5 统一了失败响应的顶层 `error` / `message`，并修正 7 条内置案例详情路由缺失 404 的问题。1.0.6 把 MariaDB / Redis / RustFS 一并打进安装包，服务路径只从安装资源解析，不再依赖任何用户目录。1.0.7 增加独立工程导出，带 `.idea` 与 Node 运行配置，IntelliJ IDEA 可直接打开。1.0.8 把生成服务改成模块化单体：一个接口一个 `src/modules/` 目录，自动加载，公共能力留在 `server.js`。1.0.9 重做多表切换栏：表多时横向滚动 + 快速下拉，表名/库/注释移到独立一行，不再挤掉右侧控件。1.0.10 补齐空白区域右键菜单、表/字段右键操作和快捷键；自动保存改静默，底栏显示未保存/保存中/已保存。生成服务新增全局 404/500 错误页、`dev.js` 热部署和 Node/Bun/Java/Go 启动选择；导出工程时可关闭错误页或 500 详情。1.1.0 新增「社交接口库」预置工程：9 个接口、86 条路由、18 张唯一表，覆盖账户、好友、私聊、群聊、动态、搜索、通知、收藏、文件、举报和统计；统一用 `onlyId` 标识用户，登录自动下发 HttpOnly cookie，所有表默认无主键。1.1.1 新增单接口库：22 套模版里的 63 个内置接口都能单独浏览、搜索、插入，编辑后的接口可命名存入本地接口库，自存接口重名直接拒绝；插入时接口名、表名、basePath 自动避重。1.1.2 补默认错误语义：新建接口的详情/更新/删除/附件路由对不存在的记录统一返回 404；路径存在但方法不对返回 405 并带 `Allow`；超过 64MB 的请求体返回 413；OpenAPI 补齐 404/405/413 等默认响应。1.1.3 给全部 22 套案例工程补齐完整的 `.yxpp` 前端：每套案例都带 PageStudio 工程、可直接运行的案例控制台和按案例定制的导航/指标/分类/接口清单；套用模版即可切到前端模式，生成服务的 `/` 直接打开案例前端，支持登录、路由试运行、数据表格与 JSON 响应。1.1.4 把「新建接口」改成四步创建引导：先配接口名/分类/路径前缀，再定主表名与初始业务字段，随后选择基础路由与鉴权方式，最后预览确认；未点确认前不会写入工程，取消也不产生改动。

安装包已内置便携 Node（`resources\runtime\node\node.exe`）与三台本地服务（`resources\services\`），不依赖系统 Node，也不要求电脑上预先装数据库；安装时注册 `.yxpn` 文件关联。运行时数据只写用户数据目录，源码和配置里不写死盘符。

### 从源码运行

```bash
npm install
npm start                 # Electron 界面
```

源码运行前先生成内置服务目录（默认从仓库旁边的 `ClickBuild` 复制，也可以用 `CBS_SERVICES_SRC` 指定源目录）：

```powershell
npm run vendor:services
```

脚本只收 MariaDB 必需 bin/lib/share、Redis 运行文件和 RustFS，产物约 432 MB，落在 `vendor/services`（不提交到 Git）。界面右侧“本地服务”里点启动，会拉起这三台内置服务：

| 服务 | 默认端口 | 用途 |
| --- | --- | --- |
| MariaDB | 13306 | 业务表 + 日志表 |
| Redis | 16379 | 缓存 / token / 限流 / 服务间消息 |
| RustFS（S3 兼容） | 19000（控制台 19001） | 附件对象存储 |

再点“生成服务”，产物落在 `generated/iface/<工程名>`，用内置 Node 启动：

```powershell
cd generated\iface\接口工程
$repo = (Resolve-Path '..\..\..').Path
$env:NODE_PATH = Join-Path $repo 'node_modules'
$env:RESET_DB='1'
Join-Path $repo 'runtime\node\node.exe' server.js
```

打开 <http://127.0.0.1:18100/> 是生成服务的控制台，`/docs` 是自动 API 文档，`/help` 是运行时帮助与脚本语法页。

## 不用界面也能生成 / 测试

```bash
runtime\node\node.exe tools\build-iface.js --seed     # 用示例工程生成
runtime\node\node.exe tools\e2e.js http://127.0.0.1:18100   # 23 项端到端断言
runtime\node\node.exe tools\test-pack.js               # .yxpn 打包 / 复制接口 / AI / 文档
runtime\node\node.exe tools\ui-smoke.js 9222           # 界面冒烟（需 --remote-debugging-port=9222）
```

## 界面

- **Excel 网格**：行号 + A–E 列；双击行进入接口编辑器，分类在底部 sheet 页（双击改名、右键新建/导出）。
- **全局搜索** `Ctrl+K`：接口 / 表 / 字段 / 路由 / SQL 一把搜。
- **六页编辑器**：表结构、路由脚本、缓存存储、接口文档、测试、生成导出。
- **Ribbon**：文件、接口、表结构、脚本、服务、视图、工程、模版与插件、扩展。
- **模版库**：22 套内置工程（商城 / 视频站 / 博客 / 工单 / 预约 / 跨库订单 / 社交接口库 / 聊天等），一键替换当前工程；当前工程也能“存模版”。
- **插件**：`plugins/<id>/plugin.json + index.js` 可注入自定义函数、接口、路由、改写脚本；面板里启停/安装/卸载。
- **Defender**：插件面板里可一键把仓库、运行时、生成目录加入 Windows Defender 排除项。
- **右键**：接口行、分类 sheet、路由都能右键（打开 / 复制 / 重命名 / 删除 / 导出）。
- **复制接口**：自动编号 `订单2`、`订单3`，表名同时加后缀，路由路径自动避让。
- **主题**：页眉/页脚/强调色/字体，存在本机设置。
- **截图**：`docs/screenshots`（运行时截）。

## 脚本语法（每条路由一段）

```text
LET $u = QUERY SELECT id, password_hash FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 401 { "ok": false, "error": "NO_USER" };
END
IF SM4_DEC($u.rows[0].password_hash, 'clickbuild-key') != {{body.password}}
  RETURN 401 { "ok": false, "error": "BAD_PASSWORD" };
END
LET $t = TOKEN NEW { "onlyId": $u.rows[0].only_id, "username": {{body.username}} };
LOG INFO '登录成功';
RETURN 200 { "ok": true, "token": $t.token };
```

支持：

- `LET $x = QUERY|EXEC SQL;`、`LET $x = 表达式;`
- `IF / ELSEIF / ELSE / END`、`FOREACH $row IN $list / END`
- `TX BEGIN|COMMIT|ROLLBACK`（写路由默认自动事务）
- `HTTP GET|POST|PUT|DELETE 'url' {json}`（服务间调用）
- `PUBLISH 'channel' expr`（Redis 消息）
- `TOKEN NEW|GET|DEL`（onlyId + token 会话）
- `LOG TRACE|DEBUG|INFO|WARN|ERROR|FATAL expr`（彩色控制台 + 落库 + SSE）
- `RETURN [status] {json};`

函数：`HASH / MD5 / SHA1 / SHA256 / SM3 / SM4_ENC / SM4_DEC / SUBSTR / LEFT / RIGHT / LEN / UPPER / LOWER / TRIM / CONCAT / REPLACE / SPLIT / JOIN / NOW / TODAY / UUID / BASE64 / URL_ENC / RAND_INT / MASK / JSON_GET / IF / IN / COALESCE …`，另可在“导出处”写自定义函数。

SQL 里也能直接写这些函数（执行前由解释器算成参数再下发，避免不同数据库函数名打架）。

SQL 里还能引用脚本变量：`$i.product_id` 会自动换成参数，`$oid.rows.0.id` 取上一句结果；显式写法是 `{{vars.i.product_id}}` / `{{last.insertId}}`。

## 占位符

| 占位符 | 展开 |
| --- | --- |
| `{{t:key}}` / `{{table:key}}` | 表名（可带库名） |
| `{{columns:key}}` | 查询列（`*` 或字段列表） |
| `{{insertColumns:key}}` / `{{insertValues:key}}` | 插入列 / 值（值走 `?` 参数） |
| `{{updateSet:key}}` | UPDATE SET 片段 |
| `{{where:key}}` / `{{orderBy:key}}` | 条件（支持 `__gte/lte/gt/lt/like/in/between/ne`、`keyword`、`sort` 白名单） |
| `{{idColumn:key}}` / `{{limit}}` / `{{offset}}` / `{{page}}` | 主键列 / 分页 |
| `{{body.x}}` / `{{query.x}}` / `{{path.x}}` / `{{user.x}}` | 请求与登录态 |
| `{{onlyId}}` / `{{token}}` / `{{uuid}}` / `{{now}}` / `{{remoteIp}}` / `{{traceId}}` | 平台值 |
| `{{objectKey}}` / `{{objectUrl}}` / `{{bucket}}` | 对象存储上传结果 |

## 一条接口连多库多表

每个接口的每张表可选 `conn`（main / 你新加的 mysql 连接）；脚本里可以混着查，事务只对同池生效，跨池失败会写 FATAL 日志并回滚已进入的连接（尽力补偿，不做分布式两阶段）。

服务之间：脚本里 `HTTP` 直连别的服务，或 `PUBLISH` 到 Redis 频道；默认约定 Redis `db0` + `icb:*` 前缀。

## 导出工程（IDEA 可直接打开）

`工程 → 导出工程`（或「生成导出」页）选一个父目录，会在里面新建 `<工程名>` 独立目录，写入完整源码、SQL、文档、`package.json`、`.env` 和 `.idea`。

- `.idea/clickbuild.iml` + `modules.xml`：IDEA 选 **File → Open** 直接识别工程。
- `.run/启动接口服务.run.xml`：IDEA 里一键运行 `server.js`。
- `README-IDEA.md`：首次打开、`npm install`、改 `.env` 的步骤。
- 导出目录里的 `server.js` 会自动读取同目录 `.env`，终端 `npm start` 和 IDEA 运行配置行为一致。
- 导出的工程不依赖 ClickBuild 的安装目录，换机器只要 Node 和依赖装好即可；数据库 / Redis / RustFS 可连本机已有的，也可在 ClickBuild 里启动内置的。

`服务 → 微服务` 的独立服务产物同样带 `.idea`，弹窗里可以直接「用 IDEA 打开」。

## .yxpn 工程包

`导出包` 生成 ZIP（纯 Node 实现，带 CRC32）：`manifest.json` + `project.json` + `interfaces.json` + `sql/*` + `docs/*` + 导出代码；如果工程绑定了前端，还会带 `frontend/index.yxpp`、`frontend/project.json` 和 `public/index.html`，manifest 里有 `frontend` 元信息。`导入包` / 双击 `.yxpn` 直接打开（`关联` 按钮写入 HKCU 文件关联）。

## AI 生成

`AI 生成` 打开对话框：不配 API 时走本地模拟（按关键词产出订单/用户等接口工程）；配了 OpenAI 兼容接口就用真模型。配置在 `%APPDATA%\click-build-server\clickbuild\settings.json`：

```json
{ "ai": { "endpoint": "https://api.example.com/v1", "apiKey": "sk-...", "model": "gpt-4o-mini" } }
```

## 生成出来的服务

- 模块化单体：每个接口一个 `src/modules/<序号_接口名>/` 目录，`index.js` 导出表结构、路由、存储与文档；`src/modules/index.js` 按目录名自动加载，`server.js` 只保留数据库、缓存、鉴权、事务、日志这些公共运行时。
- 多 MySQL 连接池、按连接执行 `sql/*.sql`
- 事务 / 限流 / 时间窗 / 熔断
- 分级日志：控制台彩色 + 内存环形 + SSE + 按等级落 `sys_log`（可换库）
- onlyId + token（Redis，Bearer 或 cookie）
- 对象存储 presigned 上传、回填对象键
- `/_health` `/_meta` `/_routes` `/_docs`(OpenAPI) `/docs`(HTML) `/help`(帮助/语法) `/_logs` `/_logs/stream`
- `RESET_DB=1`：启动时清空本工程库，互不牵连

### 扩展一个接口模块

模块里直接改 `routes` 即可；需要脚本解释器表达不了的逻辑时，给路由加 `handler(ctx, api)`：

```js
module.exports.routes.push({
  method: 'GET', path: '/orders/stat', name: '订单统计',
  handler: async (ctx, api) => ({
    ok: true,
    total: (await api.db.query('SELECT COUNT(*) AS n FROM biz_order'))[0].n,
  }),
});
```

`handler` 和脚本路由共用鉴权、限流、时间窗、事务和 Redis 缓存；`api` 提供 `db.query / db.execute`、`redis`、`s3`、`log`。模块还可导出 `async setup(api)`，在 MySQL / Redis / S3 就绪后做索引、预热、定时任务等初始化，`setup` 里同样能用 `api.db`。新增模块只要往 `src/modules/` 放一个目录，不用改 `server.js`。


## 模版 / 插件 / 文档

- 模版：`app/iface/templates.js`，内置 22 套业务工程（商城 / 视频站 / 博客 / 工单 / 预约 / 跨库订单 / 社交接口库 / 聊天 / 视频会议 / CRM / 在线课程 / 餐饮 / 物流 / 预约挂号 / 费用报销 / IoT / 活动票务 / 网课系统 / 装修报价 / 印刷报价 / 软件项目报价 / 货运报价），用户模版落 `%APPDATA%\click-build-server\clickbuild\templates\`。
- 插件：`app/iface/plugins.js`，仓库 `plugins/trace-tag` 是最小示例（注入 `REQ_TAG()`）；生成时自动应用，插件失败只记 warning。
- 接口文档：编辑器第 3 页可填接口级 7 项 + 每条路由 4 项，直接进 `docs/openapi.json` 与 `/docs`。
- Defender：`app/iface/defender.js`，读写 `Get-MpPreference`；权限不足会原样报错。

### 社交接口库（builtin:social）

- 位置：`app/iface/cases/social.json`，由 `tools/make-social-case.js` 生成；模版卡片显示 **9 接口 · 46 表引用 · 86 路由**，实际落库 18 张唯一表，全部无主键。
- 覆盖：账户身份、好友关系、私聊消息、群聊、动态社区、搜索、通知收藏、文件与安全、统计运维；路由统一前缀 `/social`。
- 身份：注册 / 登录返回 `onlyId` 与 Bearer token，同时下发 `Set-Cookie: icb_token=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`。所有受保护路由只认 token / cookie 里的 `onlyId`，写操作不接受请求体伪造用户 ID；退出登录返回 `Max-Age=0` 清除 cookie。
- 无主键：表结构不强制主键，DDL 不生成空 `PRIMARY KEY ()`，模型校验只给 warning；新建空白表默认只有 `created_at / updated_at`。
- 验收：`node tools/test-social.js http://127.0.0.1:18100`，会真实跑完全部 86 条路由、cookie 下发/清除、私聊/群聊权限、文件上传与统计，结果 **117/117**。

### 单接口库（1.1.1）

- 位置：`app/iface/iface-library.js`；内置条目从 22 套工程模版自动拆出，共 **63 个**，社交接口库贡献 9 个。
- 入口：Ribbon「模版与插件」组新增 **接口库** 与 **存接口**。接口库支持按名称/来源搜索、全部/内置/我的筛选、插入与删除；存接口把当前编辑的接口连表、路由、文档、脚本一起保存。
- 不重名：自存接口名按 `trim + NFKC + 小写` 比较，和全部内置/自存条目都不能重名，重复直接返回“接口库里已有同名接口：…”，不会覆盖。内置条目之间历史遗留的重名仍可浏览，但不会新增同名自存条目。
- 插入避重：只追加、不覆盖。同名接口自动加 ` (2)`；表名冲突加 `_2`；`basePath` 冲突加 `_2`；接口 id 重新生成，插入后整体过模型校验。
- 存储：`%APPDATA%\click-build-server\clickbuild\iface-library\`，一条自存接口一个 JSON；删除只影响接口库，不动当前工程。
- 双保险：原有“把当前工程存为模版”也新增模版同名拒绝（内置与自定义一起比较），覆盖“编辑后的接口库另存为工程模版”的用法。
- 验收：`node tools/test-iface-library.js`，内置 63、社交 9、保存/同名拒绝/插入/自动避重/删除/工程模版重名全部覆盖，结果 **19/19**；真实 UI 冒烟覆盖 63 条渲染、搜索、筛选、插入与删除。

## 微服务 / 守护进程

- `服务 → 微服务`（或接口右键）：按接口 / 分类导出独立服务到 `generated/iface/<名字>`，勾分类自动带整类接口。
- 每个产物自带 `daemon/watchdog.js`（崩溃退避重启，1s→10s）、`daemon/start.ps1`、`daemon/install-service.ps1`（登录自启计划任务）。
- 拆分后记得改 `.env` 的 `PORT`、`MYSQL_DB`、`CACHE_PREFIX`；跨服务用 `HTTP` / Redis `PUBLISH`。

## CI/CD

GitHub Actions 工作流在 `.github/workflows/`：

- `ci.yml`：推送到 `main`、PR、手动触发；Windows runner 上先还原 `vendor/services`，再 `npm ci` → 模型/模版/工程包测试 → `npm run dist:dir` 构建 unpacked 版，并校验 `dist/win-unpacked/ClickBuildServer.exe` 存在。
- `release.yml`：推送 `v*` 标签触发；还原 `vendor/services`，跑同一套回归测试 → `npm run dist` 构建 NSIS 安装包 → 输出 SHA256 到 Actions Summary → 用 `softprops/action-gh-release` 创建 Release 并上传 `.exe` 与 `.blockmap`。

`vendor/services` 不进 Git，CI 从 `services-v1` Release 的 `vendor-services.zip` 还原（约 139.5 MB）；本机构建用 `npm run vendor:services` 从旁边的 `ClickBuild` 目录收集，打包前 `npm run check:services` 会核对 MariaDB / Redis / RustFS 是否齐全。

本地等价命令：

```powershell
npm ci
npm run vendor:services
node tools/test-new-iface.js
node tools/test-templates.js --gen
node tools/test-pack.js
npm run dist:dir   # CI 构建
npm run dist       # 发布安装包
```

`test-help.js` 需要本机 MariaDB / Redis / RustFS（13306 / 16379 / 19000），因此放在本地真实验收，不放进无服务的 GitHub runner。

## 测试

| 套件 | 结果 |
| --- | --- |
| `tools/test-templates.js --gen`（22 套模版 + 插件 + 文档 + 每条详情 404） | **165/165** |
| `tools/e2e-cases.js`（21 套行业案例真实 HTTP） | **106/106** |
| `tools/test-help.js`（生成服务 `/help`、404/405/413、OpenAPI 默认响应） | **28/28** |
| `tools/test-new-iface.js`（新建接口默认路由、404 与创建引导参数） | **16/16** |
| `tools/test-social.js`（社交接口库 86 条路由真实 HTTP） | **117/117** |
| `tools/test-iface-library.js`（单接口库 63 内置 / 保存 / 重名 / 插入避重） | **19/19** |
| `tools/test-case-frontends.js`（22 套案例完整 .yxpp / 生成产物 / 真实 `/`） | **48/48** |
| `tools/ui-smoke.js`（真实 Electron 渲染进程，含案例 PageStudio 载入与新建引导） | **63/63** |
| `tools/test-pack.js`（.yxpn 打包回读 / 复制编号 / AI / OpenAPI） | **19/19** |
| 生成服务真实验收（注册/登录/CRUD/缓存/事务/限流/上传/日志/CORS） | **30/30** |


## 已知限制

- 跨 MySQL 实例不做两阶段提交，只做单池事务 + 补偿回滚 + 日志追。
- 验证码样式、短信脚本示例还没内置成品，只能自己用 `HTTP` + 自定义函数拼。
- 原生菜单已去掉，但窗口边框仍是系统标题栏；完全自绘标题栏还没做。
- Java / Go 目前是启动器，内核仍复用 Node；要真正的语言版服务还需要单独的代码生成器。

## 文档

- `docs/执行文档.md`：完整设计、语法、数据模型、测试与后续计划
