# ClickBuildServer 插件系统 v2

插件不是“生成时顺手改一下工程”的附属功能，而是工作台的一等扩展点：可以在 Ribbon 注册命令、接管保存/生成/导出/服务启停、往模版库塞工程模版、保存自己的设置和数据、读写插件目录、访问网络，或者在明确授权后加载 Node 模块。

> 插件仍然是本地代码。`vm` 上下文只是减少误用，不是操作系统级沙箱；只安装你信任的插件。

## 1. 最小插件

目录结构：

```text
plugins/my-plugin/
├─ plugin.json
├─ index.js
└─ README.md
```

`plugin.json`：

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "一句话说明它能做什么",
  "main": "index.js",
  "author": "你的名字",
  "permissions": ["project:read", "project:write", "ui:commands", "templates"],
  "contributes": {
    "commands": [
      { "id": "hello", "title": "问候", "icon": "help", "description": "弹一条消息" }
    ]
  }
}
```

`index.js`：

```js
module.exports = {
  activate(api) {
    api.commands.register('hello', async (ctx) => ({
      ok: true,
      message: `你好，${ctx.project ? ctx.project.name : '世界'}！`,
    }));

    api.hooks.on('generate.before', (ctx) => {
      api.project.addFunction(ctx.project, 'PLUGIN_HELLO', [], '"hello"');
      return { project: ctx.project };
    });
  },
  deactivate(api) {
    // 可选：清理定时器、取消订阅
  },
};
```

启用后，Ribbon 会自动出现「插件」组和「问候」按钮；点一下就走 `hello`。

也可以在插件面板点「新建插件」生成同样的脚手架，直接在「打开我的插件目录」里改。

## 2. 旧插件兼容

旧写法继续有效，但只在生成服务时执行：

```js
module.exports = function apply(project, api) {
  api.addFunction('REQ_TAG', [], 'UUID()');
  api.transformScripts((script) => script.replace(/FROM/g, 'FROM'));
};
```

新插件不要再写 `apply`；用 `activate(api)` 注册命令和钩子，能力更多，也不会在每次生成时重复跑一遍。

## 3. 权限

权限按 manifest 的 `permissions` 授予，没授予的 API 会拒绝并写 warn 日志。

| 权限 | 能做什么 |
| --- | --- |
| `project:read` | 读工程、查接口/表/字段，生成报告 |
| `project:write` | 加字段、加表、加接口、加路由、加函数、改脚本 |
| `ui:commands` | 注册工作台命令，进入 Ribbon / 插件面板 |
| `templates` | 向模版库注册工程模版 |
| `files` | 读写插件目录与私有数据目录 |
| `network` | 使用 `api.fetch` |
| `node` | 使用 `api.node.require` 加载 Node 模块（高权限） |

没有 `project:write` 时，`api.project.addField()` 等写操作返回 `null` / `false`，原工程不变。

## 4. 命令

```js
api.commands.register(id, handler, meta?)
```

- `id` 可以写短名 `hello`，系统自动加前缀成 `my-plugin:hello`；也可以写完整 ID。
- `meta` 可覆盖 manifest 里的 `title / icon / description`。
- `handler(ctx)` 可以是 async，返回值支持：

```js
{
  ok: true,
  message: '给用户看的提示',
  project: ctx.project,      // 改了工程就带回来，工作台会刷新并自动保存
  html: '<div>自定义面板</div>', // 用内置弹窗显示
  openUrl: 'https://example.com' // 交给系统浏览器打开
}
```

`ctx` 里有：

- `project`：当前工程（已深拷贝并归一化）
- `ifaceId`：当前选中接口
- `tableKey`：当前选中表
- `plugin`：插件自身元信息

返回 `{ ok:false, error }` 时工作台显示为失败，不改工程。

## 5. 生命周期钩子

```js
api.hooks.on(name, handler);
```

| 钩子 | 时机 | 可改写 / 取消 |
| --- | --- | --- |
| `app.start` | 插件全部加载完成后 | 否 |
| `app.shutdown` | 应用退出前 | 否 |
| `project.open` | 工程打开后、进工作台前 | 返回 `{ project }` |
| `project.beforeSave` | 保存前 | 返回 `{ project }`，或 `false` 取消 |
| `project.afterSave` | 写盘后 | 否 |
| `template.apply` | 从模版新建工程前 | 返回 `{ project }`，或 `false` 取消 |
| `generate.before` | 生成服务前 | 返回 `{ project }`，或 `false` 取消 |
| `generate.after` | 生成目录写完后 | 否 |
| `export.before` | 导出工程前 | 返回 `{ project }`，或 `false` 取消 |
| `export.after` | 导出完成后 | 否 |
| `server.beforeStart` | 启动生成服务前 | `false` 取消 |
| `server.afterStart` | 服务监听端口后 | 否 |
| `server.beforeStop` | 停止生成服务前 | 否 |

返回对象里的 `project` 会被归一化后再继续后续流程，所以钩子改字段、补表、注入函数都能落盘或进生成产物。

## 6. 工程变更 API

这些方法都要求 `project:write`（`seed / normalize / validate / clone / find*` 只需要 `project:read`）：

```js
api.project.seed()                         // 一份内置示例工程副本
api.project.normalize(project)
api.project.validate(project)
api.project.clone(project)
api.project.findIface(project, idOrName)
api.project.findTable(project, iface, tableKeyOrName)
api.project.addFunction(project, name, params, body)
api.project.addInterface(project, rawIface)
api.project.addTable(project, iface, rawTable)
api.project.addRoute(project, iface, patch)
api.project.addField(project, iface, table, patch)
api.project.transformScripts(project, fn)
```

`addField` 遇到同名字段返回 `null`，不会重复加；`addFunction` 同名也返回 `false`。

## 7. 模版

```js
api.templates.register({
  id: 'audit-demo',
  name: '审计示例',
  description: '带 updated_by 的最小工程',
  tags: ['审计'],
  project: seedProject,
});
```

需要 `templates` 权限。模版会出现在：

- 工作台「更多 → 模版库」
- 启动预览页的模版卡片
- 插件面板的「插件模版」

从插件模版新建工程同样遵守“先保存当前工程，再新建”的规则，不会覆盖当前内容。

## 8. 设置、数据、文件、网络、Node

```js
api.settings.get(key?)       // 读插件自己的设置
api.settings.set(patch)      // 合并写入

api.data.dir                 // 插件私有数据目录
api.data.read(name, fallback)
api.data.write(name, value)

api.files.readText(rel)
api.files.writeText(rel, text)
api.files.list(rel)

api.fetch(url, init)         // 需要 network
api.node.require(name)       // 需要 node
```

`data` 和 `files` 需要 `files` 权限，路径被限制在插件目录 / 插件数据目录内。

## 9. 插件间事件

```js
api.events.on('order.created', (payload, from) => {});
api.events.emit('order.created', { id: 1 });
```

适合把“导入插件 → 校验插件 → 报表插件”拆开，不必互相 `require`。

## 10. Ribbon 与插件面板

- 启用插件注册的命令会出现在 Ribbon 的「插件」组，最多展示前 3 个，避免工具栏被撑爆。
- 「插件…」按钮打开管理面板：启停、重新加载、新建脚手架、安装、卸载、命令、模版、钩子、日志、开发者文档、Defender 信任目录和插件目录入口。
- 插件命令返回的 `html` 会用内置弹窗渲染；返回的 `openUrl` 交给系统浏览器。
- 插件改了工程并返回 `project` 时，工作台会立即刷新并自动保存。

## 11. 日志与调试

- `api.log / warn / error` 写入插件日志缓冲。
- 插件面板「查看日志」显示最近日志；重新加载会清空缓冲。
- 加载失败、命令失败、钩子失败都会写日志，并在插件列表显示错误数。
- 修改 `index.js` 后在插件面板点「重新加载」，不需要重启应用。

## 12. 安全边界

- 插件入口用 `vm.runInContext` 执行，默认没有 `require`、`process`、`fs`、`fetch`。
- 需要 Node 能力必须在 manifest 声明 `node`；需要联网声明 `network`。
- 文件读写被限制在插件自己的目录和数据目录。
- `vm` 不是进程级沙箱；插件代码仍可能通过高权限 API 影响本机。只从可信来源安装。
- 内置插件不能卸载，只能禁用。

## 13. 测试清单

一个插件至少应验证：

1. 禁用状态下不加载、不注册命令。
2. 缺少 `project:write` 时写操作被拒绝，工程不变。
3. 命令返回 `project` 后字段/表/路由真的写进工程。
4. `generate.before` 注入的函数出现在生成产物 `interfaces.json`。
5. `project.beforeSave` 返回 `false` 时保存被取消。
6. 钩子返回 `{ project }` 时保存内容被改写。
7. 模版注册后能从插件面板新建工程。
8. 脚手架生成的文件能被重新加载。
9. 日志、错误数、开发者文档能打开。

仓库自带 `tools/test-plugins-v2.js` 覆盖以上主路径；`tools/ui-smoke.js` 覆盖 Ribbon 命令、插件面板和“新建/模版不覆盖”的 UI 路径。

## 14. 示例

内置 `plugins/audit-stamp` 演示四类能力：

- 命令「补审计字段」：给当前表加 `updated_by`
- 命令「插件报告」：统计接口/表/路由并返回 HTML
- `generate.before`：向工程注入 `PLUGIN_AUDIT()`
- 模版「审计示例」：注册一个带审计字段的工程模版

另一个内置 `plugins/trace-tag` 是旧写法示例，只在生成时注入 `REQ_TAG()`。
