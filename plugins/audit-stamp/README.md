# 审计字段（内置示例插件）

演示插件 API v2：

- `api.commands.register` 注册「补审计字段」「插件报告」两个工作台命令
- `api.project.addField` 给当前表加 `updated_by`
- `api.hooks.on('generate.before')` 在生成服务前注入 `PLUGIN_AUDIT()`
- `api.templates.register` 往模版库注册「审计示例」

启用后，工作台 Ribbon 会出现「插件」组；更多操作里能启停、重载和查看日志。
