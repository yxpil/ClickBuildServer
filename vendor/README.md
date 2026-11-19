# vendor/services

打包用的内置运行时服务目录，不提交到 Git。

- 本机生成：`npm run vendor:services`，默认从仓库旁边的 `ClickBuild` 收集 MariaDB / Redis / RustFS；也可以设 `CBS_SERVICES_SRC` 指定源目录。
- CI：从 `services-v1` Release 的 `vendor-services.zip` 还原到 `vendor/services`。
- 打包：`npm run dist` 前会跑 `npm run check:services`，缺文件直接失败。

产物只记录相对路径和校验和，见 `vendor/services/manifest.json`。
