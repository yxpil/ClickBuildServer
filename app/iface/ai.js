'use strict';

// AI 生成接口工程：优先调用用户配置的 OpenAI 兼容接口（/v1/chat/completions），
// 没配或失败就退回本地模拟（离线可用，方便演示与测试）。

const spec = require('./spec');

function mockReply(prompt) {
  const p = String(prompt || '');
  const wantsUser = /用户|注册|登录|账号|会员/.test(p);
  const wantsOrder = /订单|商品|库存|销售|商城/.test(p);
  const wantsFile = /附件|文件|图片|上传/.test(p);

  const categories = [
    { id: 'biz', name: '业务表格' },
    { id: 'sys', name: '平台表格' },
  ];
  const interfaces = [];

  if (wantsOrder || !wantsUser) {
    const order = spec.newIface('订单', 'biz');
    order.comment = '订单主表 + 明细表（AI 生成）';
    const fields = [
      { ...spec.newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false, comment: '主键' },
      { ...spec.newField('order_no', 'varchar'), search: true, comment: '订单号' },
      { ...spec.newField('customer', 'varchar'), search: true, comment: '客户' },
      { ...spec.newField('amount', 'decimal'), comment: '金额' },
      { ...spec.newField('status', 'tinyint'), comment: '0 待付 1 已付 2 完成' },
      ...(wantsFile ? [{ ...spec.newField('file_key', 'varchar'), hidden: true, comment: '附件对象键' }] : []),
      { ...spec.newField('created_at', 'datetime'), writable: false, default: 'CURRENT_TIMESTAMP' },
    ];
    order.tables = [
      { key: 'main', name: 'biz_order', schema: '', comment: '订单主表', fields },
      {
        key: 'item', name: 'biz_order_item', schema: '', comment: '订单明细',
        fields: [
          { ...spec.newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false },
          { ...spec.newField('order_id', 'bigint'), comment: '订单主键' },
          { ...spec.newField('sku', 'varchar'), search: true, comment: '商品编码' },
          { ...spec.newField('qty', 'int'), comment: '数量' },
          { ...spec.newField('price', 'decimal'), comment: '单价' },
        ],
      },
    ];
    order.routes = ['list', 'detail', 'create', 'update', 'delete'].map((k) => spec.newRoute(k, order));
    order.routes.push({
      ...spec.newRoute('custom', order, 0),
      name: '订单+明细',
      method: 'GET',
      path: '/orders/with-items',
      summary: '主表 LEFT JOIN 明细',
      script: [
        'LET $rows = QUERY SELECT o.id, o.order_no, o.customer, o.amount, o.status, i.sku, i.qty, i.price FROM {{t:main}} o LEFT JOIN {{t:item}} i ON i.order_id = o.id WHERE {{where:main}} ORDER BY o.id DESC LIMIT {{limit}} OFFSET {{offset}};',
        'RETURN 200 { "rows": $rows.rows };',
      ].join('\n'),
      cache: { enabled: false, key: '', ttl: 60 },
    });
    interfaces.push(order);
  }

  if (wantsUser) {
    const user = spec.newIface('用户注册', 'sys');
    user.comment = '注册 / 登录 / 当前用户（AI 生成）';
    user.tables = [{
      key: 'main', name: 'sys_user', schema: '', comment: '用户表',
      fields: [
        { ...spec.newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false },
        { ...spec.newField('only_id', 'char'), hidden: true, comment: '唯一ID' },
        { ...spec.newField('username', 'varchar'), search: true, comment: '用户名' },
        { ...spec.newField('password_hash', 'varchar'), hidden: true, comment: 'SM4 加密密码' },
        { ...spec.newField('nickname', 'varchar'), search: true, comment: '昵称' },
        { ...spec.newField('created_at', 'datetime'), writable: false, default: 'CURRENT_TIMESTAMP' },
      ],
    }];
    user.routes = [
      {
        ...spec.newRoute('custom', user, 0), name: '注册', method: 'POST', path: '/register',
        summary: '查重 → 插入 → 发 token',
        script: [
          'LET $exists = QUERY SELECT id FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
          'IF LEN($exists.rows) > 0',
          '  RETURN 409 { "ok": false, "error": "USER_EXISTS" };',
          'END',
          'EXEC INSERT INTO {{t:main}} (only_id, username, password_hash, nickname) VALUES ({{onlyId}}, {{body.username}}, SM4_ENC({{body.password}}, \'clickbuild-key\'), {{body.nickname}});',
          'LET $t = TOKEN NEW { "onlyId": {{onlyId}}, "username": {{body.username}} };',
          'RETURN 201 { "ok": true, "onlyId": {{onlyId}}, "token": $t.token };',
        ].join('\n'),
        cache: { enabled: false, key: '', ttl: 60 },
      },
      {
        ...spec.newRoute('custom', user, 1), name: '登录', method: 'POST', path: '/login',
        script: [
          'LET $u = QUERY SELECT only_id, password_hash FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
          'IF LEN($u.rows) == 0',
          '  RETURN 401 { "ok": false, "error": "NO_USER" };',
          'END',
          'IF SM4_DEC($u.rows[0].password_hash, \'clickbuild-key\') != {{body.password}}',
          '  RETURN 401 { "ok": false, "error": "BAD_PASSWORD" };',
          'END',
          'LET $t = TOKEN NEW { "onlyId": $u.rows[0].only_id, "username": {{body.username}} };',
          'RETURN 200 { "ok": true, "token": $t.token };',
        ].join('\n'),
        cache: { enabled: false, key: '', ttl: 60 },
      },
      {
        ...spec.newRoute('custom', user, 2), name: '当前用户', method: 'GET', path: '/me', auth: true,
        script: ['RETURN 200 { "user": $user };'].join('\n'),
        cache: { enabled: false, key: '', ttl: 60 },
      },
      spec.newRoute('list', user),
    ];
    user.routes[3].path = '/users';
    interfaces.push(user);
  }

  const project = spec.normalizeProject({
    name: /订单|商城|商品/.test(p) ? '订单服务' : '接口工程',
    description: p.slice(0, 120) || 'AI 生成的接口工程',
    categories,
    interfaces,
    functions: [{ name: 'MASK_PHONE', params: ['v'], body: 'CONCAT(SUBSTR(v, 0, 3), "****", SUBSTR(v, 7, 4))' }],
  });
  return {
    project,
    reply: [
      `已经按「${p.slice(0, 60) || '通用接口'}」生成 ${project.interfaces.length} 个接口、${project.interfaces.reduce((n, i) => n + i.tables.length, 0)} 张表。`,
      '每个接口都能多表联查、写路由默认带事务；账号接口用 SM4 存密码、注册即发 token。',
      '下一步可以点“生成服务”，再在控制台里逐条试。',
    ].join('\n'),
    mode: 'mock',
  };
}

async function callOpenAi(prompt, cfg) {
  const base = String(cfg.endpoint || '').replace(/\/$/, '');
  if (!base) throw new Error('没有配置 AI 接口');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '你是 ClickBuild 的接口工程生成器。只输出 JSON：{ project: {...}, reply: "..." }。project 里每个接口包含 tables 与 routes，route.script 使用 LET/EXEC/QUERY/RETURN 语法。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(Number(cfg.timeout || 30000)),
  });
  if (!res.ok) throw new Error(`AI 接口 ${res.status}`);
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('AI 返回里没有 JSON');
  const parsed = JSON.parse(m[0]);
  if (!parsed.project) throw new Error('AI 返回缺少 project');
  return { project: spec.normalizeProject(parsed.project), reply: parsed.reply || '已生成', mode: 'api' };
}

async function complete(prompt, cfg) {
  const conf = cfg || {};
  if (conf.endpoint) {
    try { return await callOpenAi(prompt, conf); } catch (e) {
      const mock = mockReply(prompt);
      return { ...mock, reply: `${mock.reply}\n（外部 AI 调用失败：${e.message}，已用本地模拟）` };
    }
  }
  return mockReply(prompt);
}

module.exports = { complete, mockReply };
