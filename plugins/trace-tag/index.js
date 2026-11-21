// 作者：yxpil
'use strict';

// 插件示例：只做两件安全的事 —— 加一个自定义函数，给工程文档补一句。
// 想加接口 / 加路由，用 api.addInterface / api.addRoute；想统一改脚本，用 api.transformScripts。

module.exports = function apply(project, api) {
  const ok = api.addFunction('REQ_TAG', [], 'CONCAT("REQ-", SUBSTR(HASH(UUID()), 0, 10))');
  project.docs = project.docs || {};
  project.docs.description = [project.docs.description, '（已启用插件：请求标记）'].filter(Boolean).join('');
  api.log(ok ? 'REQ_TAG 已注入' : 'REQ_TAG 已存在，跳过');
  return project;
};
