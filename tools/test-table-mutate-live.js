// 作者：yxpil
// 实时数据页写回验收：readTable + mutateTable 走真实 MariaDB。
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../app/iface/db-admin');
const tableData = require('../app/iface/table-data');

const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../app/iface/cases/booking.json'), 'utf8'));
const table = 'cbs_live_mutate_test';
const project = (() => {
  const p = JSON.parse(JSON.stringify(base));
  const src = p.interfaces[0];
  src.id = 'live-test';
  src.name = '实时写回测试';
  src.tables = [{
    ...(src.tables[0] || {}),
    key: 'main', name: table, conn: 'main', schema: 'clickbuild',
    fields: [{ name: 'id', type: 'bigint', pk: true }, { name: 'name', type: 'varchar' }, { name: 'qty', type: 'int' }],
  }];
  p.interfaces = [src];
  if (p.categories && p.categories[0]) src.categoryId = p.categories[0].id;
  return p;
})();
let pass = 0;
let fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra)); } }

(async () => {
  await db.dropTable(base, { connKey: 'main', database: 'clickbuild', table });
  const cr = await db.createTable(base, { connKey: 'main', database: 'clickbuild', table, fields: [
    { name: 'id', type: 'INT', primary: true, auto: true },
    { name: 'name', type: 'VARCHAR', length: 40, nullable: true },
    { name: 'qty', type: 'INT', nullable: true },
  ] });
  ok('建测试表', cr.ok, cr);

  const empty = await tableData.readTable(project, { ifaceId: 'live-test', tableKey: 'main', page: 1, size: 20 });
  ok('空表可写标记', empty.ok && empty.writable === true && empty.primary.includes('id'), empty);

  const ins = await tableData.mutateTable(project, { ifaceId: 'live-test', tableKey: 'main', mode: 'insert', values: { name: '实时插', qty: '3' } });
  ok('实时新增', ins.ok && ins.affectedRows === 1, ins);

  const one = await tableData.readTable(project, { ifaceId: 'live-test', tableKey: 'main', page: 1, size: 20 });
  ok('读到新增行', one.ok && one.rows.length === 1 && one.rows[0].name === '实时插', one);

  const upd = await tableData.mutateTable(project, { ifaceId: 'live-test', tableKey: 'main', mode: 'update', key: 'id', keyValue: one.rows[0].id, values: { name: '实时改', qty: '8' } });
  ok('实时更新', upd.ok && upd.affectedRows >= 1, upd);

  const two = await tableData.readTable(project, { ifaceId: 'live-test', tableKey: 'main', page: 1, size: 20 });
  ok('更新写回', two.rows[0].name === '实时改' && String(two.rows[0].qty) === '8', two.rows[0]);

  const del = await tableData.mutateTable(project, { ifaceId: 'live-test', tableKey: 'main', mode: 'delete', key: 'id', keyValue: two.rows[0].id });
  ok('实时删除', del.ok && del.affectedRows === 1, del);

  const noPkTable = table + '_nopk';
  await db.dropTable(base, { connKey: 'main', database: 'clickbuild', table: noPkTable });
  const crNoPk = await db.createTable(base, { connKey: 'main', database: 'clickbuild', table: noPkTable, fields: [
    { name: 'name', type: 'VARCHAR', length: 40, nullable: true },
    { name: 'qty', type: 'INT', nullable: true },
  ] });
  ok('建无主键表', crNoPk.ok, crNoPk);
  const noPkProject = JSON.parse(JSON.stringify(project));
  noPkProject.interfaces[0].tables[0].name = noPkTable;
  noPkProject.interfaces[0].tables[0].fields = [];
  const noPk = await tableData.readTable(noPkProject, { ifaceId: 'live-test', tableKey: 'main', page: 1, size: 20 });
  ok('无主键识别为只读', noPk.ok && noPk.primary.length === 0, noPk);
  const noPkMut = await tableData.mutateTable(noPkProject, { ifaceId: 'live-test', tableKey: 'main', mode: 'delete', key: 'id', keyValue: 1 });
  ok('无主键拒绝按行删除', !noPkMut.ok && noPkMut.code === 'NO_PK', noPkMut);
  await db.dropTable(base, { connKey: 'main', database: 'clickbuild', table: noPkTable });

  const roProject = JSON.parse(JSON.stringify(project));
  roProject.connections.mysql.forEach((c) => { c.readonly = true; });
  const roRead = await tableData.readTable(roProject, { ifaceId: 'live-test', tableKey: 'main', page: 1, size: 20 });
  ok('只读连接读到 writable=false', roRead.ok && roRead.writable === false, roRead);
  const roMut = await tableData.mutateTable(roProject, { ifaceId: 'live-test', tableKey: 'main', mode: 'insert', values: { name: '不应写入' } });
  ok('只读连接拒绝写入', !roMut.ok && roMut.code === 'READONLY', roMut);

  await db.dropTable(base, { connKey: 'main', database: 'clickbuild', table });
  console.log(`\n${pass}/${pass + fail} 通过`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { fail++; console.error(e); console.log(`\n${pass}/${pass + fail} 通过`); process.exit(1); });
