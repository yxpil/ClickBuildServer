// 作者：yxpil
// 真实 MariaDB 验收：连接、库表、建表、增删改、SQL、结构、删表。
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../app/iface/db-admin');

const project = JSON.parse(fs.readFileSync(path.join(__dirname, '../app/iface/cases/booking.json'), 'utf8'));
const table = 'cbs_dbadmin_live_test';
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : extra); }
}

(async () => {
  const t = await db.test(project, { connKey: 'main' });
  ok('连接测试', t.ok, t);
  if (!t.ok) return finish();
  ok('返回版本与运行库', !!t.version && t.database === 'clickbuild', t.version);

  const dbs = await db.listDatabases(project, { connKey: 'main' });
  ok('列出数据库', dbs.ok && dbs.databases.some((x) => x.name === 'clickbuild'), dbs.error);

  const tables = await db.listTables(project, { connKey: 'main', database: 'clickbuild' });
  ok('列出库表', tables.ok && Array.isArray(tables.tables), tables.error);

  const drop0 = await db.dropTable(project, { connKey: 'main', database: 'clickbuild', table });
  ok('预清理旧测试表', drop0.ok || drop0.code === 'ER_BAD_TABLE_ERROR', drop0);

  const cr = await db.createTable(project, {
    connKey: 'main', database: 'clickbuild', table,
    fields: [
      { name: 'id', type: 'INT', length: 11, primary: true, auto: true, nullable: false },
      { name: 'name', type: 'VARCHAR', length: 40, primary: false, auto: false, nullable: true },
      { name: 'qty', type: 'INT', length: 11, primary: false, auto: false, nullable: true },
    ],
  });
  ok('建表', cr.ok, cr);

  const ins = await db.insertRow(project, { connKey: 'main', database: 'clickbuild', table, values: { name: '第一行', qty: '7' } });
  ok('插入行', ins.ok && ins.affected === 1, ins);

  const sel = await db.selectRows(project, { connKey: 'main', database: 'clickbuild', table, page: 1, size: 20 });
  ok('分页读表', sel.ok && sel.rows.length === 1 && sel.rows[0].name === '第一行', sel);
  const key = sel.rows[0] && sel.rows[0].id;

  const upd = await db.updateRow(project, { connKey: 'main', database: 'clickbuild', table, key: 'id', keyValue: key, values: { name: '改过', qty: '9' } });
  ok('按主键更新', upd.ok && upd.affected >= 1, upd);

  const sel2 = await db.selectRows(project, { connKey: 'main', database: 'clickbuild', table, page: 1, size: 20 });
  ok('更新已落库', sel2.ok && sel2.rows[0].name === '改过' && String(sel2.rows[0].qty) === '9', sel2.rows[0]);

  const desc = await db.describe(project, { connKey: 'main', database: 'clickbuild', table });
  ok('读结构', desc.ok && desc.columns.length === 3 && desc.primary.includes('id'), desc);

  const sql = await db.runSql(project, { connKey: 'main', database: 'clickbuild', sql: "SELECT COUNT(*) AS n FROM `" + table + "`; UPDATE `" + table + "` SET qty = 11 WHERE id = " + Number(key) + ";" });
  ok('SQL 多句执行', sql.ok && sql.sets && sql.sets.length === 2, sql);

  const del = await db.deleteRow(project, { connKey: 'main', database: 'clickbuild', table, key: 'id', keyValue: key });
  ok('删除行', del.ok && del.affected === 1, del);

  const ren = await db.renameTable(project, { connKey: 'main', database: 'clickbuild', table, next: table + '_r' });
  ok('重命名表', ren.ok, ren);
  const drop = await db.dropTable(project, { connKey: 'main', database: 'clickbuild', table: table + '_r' });
  ok('删表清理', drop.ok, drop);

  const roProject = JSON.parse(JSON.stringify(project));
  roProject.connections.mysql[0].readonly = true;
  const ro = await db.insertRow(roProject, { connKey: 'main', database: 'clickbuild', table: 'cbs_nope', values: { a: '1' } });
  ok('只读连接拦截写操作', !ro.ok && ro.code === 'ER_READONLY', ro);
  finish();
})().catch((e) => { fail++; console.error(e); finish(); });

function finish() {
  console.log(`\n${pass}/${pass + fail} 通过`);
  process.exit(fail ? 1 : 0);
}
