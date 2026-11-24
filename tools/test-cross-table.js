// 作者：yxpil
'use strict';

// 同一工程内跨接口表引用：项目目录、渲染、列/条件占位符、全限定与歧义报错。
const assert = require('assert');
const spec = require('../app/iface/spec');
const render = require('../app/iface/render');
const native = require('../app/iface/native');

let ok = 0;
const t = (name, fn) => {
  fn();
  ok++;
  console.log('  ok  ' + name);
};

function project() {
  return spec.normalizeProject({
    name: '跨表自测',
    interfaces: [
      {
        id: 'iface_order', name: '订单', basePath: '/orders', tables: [
          { key: 'main', name: 'shop_order', comment: '订单主表', fields: [
            { name: 'id', type: 'bigint', pk: true, autoIncrement: true },
            { name: 'user_id', type: 'bigint' },
            { name: 'amount', type: 'decimal' },
          ], routes: [{ id: 'list', key: 'list', method: 'GET', path: '/list' }] },
          { key: 'item', name: 'shop_order_item', fields: [
            { name: 'id', type: 'bigint', pk: true },
            { name: 'order_id', type: 'bigint' },
            { name: 'sku', type: 'varchar' },
          ], routes: [{ id: 'list', key: 'list', method: 'GET', path: '/list' }] },
        ], routes: [{ id: 'list', key: 'list', method: 'GET', path: '/list' }] },
      {
        id: 'iface_account', name: '账号', basePath: '/accounts', tables: [
          { key: 'main', name: 'sys_account', schema: 'db2', comment: '账号表', fields: [
            { name: 'id', type: 'bigint', pk: true },
            { name: 'username', type: 'varchar' },
            { name: 'password', type: 'varchar', hidden: true },
          ], routes: [{ id: 'list', key: 'list', method: 'GET', path: '/list' }] },
          { key: 'shared', name: 'sys_shared', comment: '账号也复用的公共表', fields: [
            { name: 'id', type: 'bigint', pk: true },
            { name: 'code', type: 'varchar' },
          ], routes: [{ id: 'list', key: 'list', method: 'GET', path: '/list' }] },
        ], routes: [{ id: 'list', key: 'list', method: 'GET', path: '/list' }] },
      {
        id: 'iface_shared', name: '共享', tables: [
          { key: 'main', name: 'sys_shared', comment: '被复用的表', fields: [
            { name: 'id', type: 'bigint', pk: true },
            { name: 'code', type: 'varchar' },
          ], routes: [{ id: 'list', key: 'list', method: 'GET', path: '/list' }] },
        ], routes: [{ id: 'list', key: 'list', method: 'GET', path: '/list' }] },
    ],
  });
}

const p = project();
const catalog = spec.projectTableCatalog(p);
const order = p.interfaces[0];
const account = p.interfaces[1];
order.projectTables = catalog;
account.projectTables = catalog;

const ctx = { query: { username: 'tom', page: '2', pageSize: '5' }, body: {}, path: {}, id: 1 };

t('项目表目录覆盖所有接口', () => {
  assert.deepEqual(catalog.map((x) => x.name).sort(), ['shop_order', 'shop_order_item', 'sys_account', 'sys_shared']);
});
t('项目表目录带来源接口和全限定引用', () => {
  const acc = catalog.find((x) => x.name === 'sys_account');
  assert.equal(acc.ifaceName, '账号');
  assert.equal(acc.ifaceId, 'iface_account');
  assert.equal(acc.ref, 'db2.sys_account');
});
t('共享表只保留一条并记录多个接口', () => {
  const hits = catalog.filter((x) => x.name === 'sys_shared');
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].ifaceNames.sort(), ['共享', '账号'].sort());
});

t('本接口表键优先，不被其它接口同名短键抢走', () => {
  assert.equal(render.renderText('{{t:main}}', account, ctx), 'sys_account');
});
t('按真实表名跨接口解析', () => {
  assert.equal(render.renderText('{{t:shop_order}}', account, ctx), 'shop_order');
});
t('按接口id.表键定向解析', () => {
  assert.equal(render.renderText('{{t:iface_order.item}}', account, ctx), 'shop_order_item');
});
t('按库名.表名全限定解析', () => {
  assert.equal(render.renderText('{{t:db2.sys_account}}', order, ctx), 'sys_account');
});
t('跨接口 columns 跳过隐藏字段', () => {
  assert.equal(render.renderText('{{columns:sys_account}}', order, ctx), 'id, username');
});
t('跨接口 allColumns 含隐藏字段', () => {
  assert.equal(render.renderText('{{allColumns:sys_account}}', order, ctx), 'id, username, password');
});
t('跨接口 where 按目标表字段生成', () => {
  const out = render.renderSqlText('SELECT 1 WHERE {{where:sys_account}}', order, ctx);
  assert.equal(out.sql, 'SELECT 1 WHERE username = ?');
});
t('跨接口 idColumn 取目标表主键', () => {
  assert.equal(render.renderText('{{idColumn:sys_account}}', order, ctx), 'id');
});
t('跨接口 LEFT JOIN 完整渲染', () => {
  const text = 'SELECT o.id, a.username FROM {{t:main}} o LEFT JOIN {{t:sys_account}} a ON a.id = o.user_id WHERE {{where:sys_account}} ORDER BY o.id DESC LIMIT {{limit}} OFFSET {{offset}}';
  const out = render.renderSqlText(text, order, ctx);
  assert.ok(out.sql.includes('FROM shop_order o LEFT JOIN sys_account a'));
  assert.ok(out.sql.includes('username = ?'));
  assert.equal(out.sql.includes('{{'), false);
});
t('未知表名给出跨接口提示', () => {
  assert.throws(() => render.renderText('{{t:no_such_table}}', order, ctx), /跨接口请写项目里的真实表名/);
});
t('没有项目目录时仍按旧表键工作', () => {
  const bare = { ...order, projectTables: [] };
  assert.equal(render.renderText('{{t:main}}', bare, ctx), 'shop_order');
});
t('原生 serviceSnapshot 每个接口都带项目表目录', () => {
  const snap = native.serviceSnapshot(p);
  assert.ok(snap.interfaces.every((x) => Array.isArray(x.projectTables) && x.projectTables.length === catalog.length));
  const acc = snap.interfaces.find((x) => x.name === '账号');
  assert.ok(acc.projectTables.some((x) => x.name === 'shop_order' && x.ifaceName === '订单'));
});

console.log(`\n${ok}/${ok} passed`);
