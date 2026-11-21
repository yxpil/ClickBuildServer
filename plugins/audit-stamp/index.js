// 作者：yxpil
'use strict';

// 内置示例：展示插件 API v2 的四类能力 —— 命令、工程写入、生成钩子、模版。
// 这里故意不 require 任何 Node 模块，插件在独立 vm 上下文里只通过 api 做事。

module.exports = {
  activate(api) {
    api.commands.register('add-audit', async (ctx) => {
      const it = api.project.findIface(ctx.project, ctx.ifaceId) || ctx.project.interfaces[0];
      if (!it) return { ok: false, error: '当前工程没有接口' };
      const table = api.project.findTable(ctx.project, it.id, ctx.tableKey) || it.tables[0];
      if (!table) return { ok: false, error: '当前接口没有表' };
      const field = api.project.addField(ctx.project, it.id, table.key, {
        name: 'updated_by',
        type: 'varchar',
        comment: '最后修改人（审计字段插件）',
        search: true,
        nullable: true,
      });
      api.log(field ? `已给 ${table.name} 加 updated_by` : `${table.name} 已有 updated_by`);
      return {
        ok: true,
        message: field ? `已给 ${table.name} 补 updated_by` : `${table.name} 已经有 updated_by，不重复加`,
        project: ctx.project,
      };
    });

    api.commands.register('report', async (ctx) => {
      const p = ctx.project;
      const tables = p.interfaces.reduce((n, i) => n + i.tables.length, 0);
      const routes = p.interfaces.reduce((n, i) => n + i.routes.length, 0);
      const audit = p.interfaces.filter((i) => i.tables.some((t) => t.fields.some((f) => f.name === 'updated_by'))).length;
      return {
        ok: true,
        html: `<div class="text-[13px]">
          <div class="text-[15px] font-semibold mb-3">审计字段 · 插件报告</div>
          <div class="grid grid-cols-4 gap-2 mb-3">
            <div class="border border-neutral-300 p-2"><b class="text-[18px]">${p.interfaces.length}</b><div class="text-[11px] text-neutral-500">接口</div></div>
            <div class="border border-neutral-300 p-2"><b class="text-[18px]">${tables}</b><div class="text-[11px] text-neutral-500">表</div></div>
            <div class="border border-neutral-300 p-2"><b class="text-[18px]">${routes}</b><div class="text-[11px] text-neutral-500">路由</div></div>
            <div class="border border-neutral-300 p-2"><b class="text-[18px]">${audit}</b><div class="text-[11px] text-neutral-500">已审计接口</div></div>
          </div>
          <div class="text-neutral-600">生成服务时会自动注入 <span class="mono">PLUGIN_AUDIT()</span> 函数；点「补审计字段」可给当前表加 <span class="mono">updated_by</span>。</div>
        </div>`,
      };
    });

    api.hooks.on('generate.before', (ctx) => {
      const ok = api.project.addFunction(ctx.project, 'PLUGIN_AUDIT', [], 'CONCAT("AUDIT-", SUBSTR(HASH(UUID()), 0, 8))');
      api.log(ok ? '已注入 PLUGIN_AUDIT()' : 'PLUGIN_AUDIT() 已存在');
    });

    const seed = api.project.seed();
    seed.name = '审计示例';
    seed.description = '账号审计最小工程：用户注册 + updated_by';
    seed.interfaces = seed.interfaces.filter((i) => i.name === '用户注册');
    if (seed.interfaces[0] && seed.interfaces[0].tables[0]) {
      const t = seed.interfaces[0].tables[0];
      if (!t.fields.some((f) => f.name === 'updated_by')) {
        t.fields.push({
          ...api.spec.newField('updated_by', 'varchar'),
          comment: '最后修改人（审计字段插件）',
          search: true,
          nullable: true,
        });
      }
    }
    api.templates.register({
      id: 'audit-demo',
      name: '审计示例',
      description: '从插件注册的模版：用户注册表带 updated_by 审计字段。',
      tags: ['插件', '审计'],
      project: seed,
    });
  },
};
