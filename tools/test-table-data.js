// 作者：yxpil
'use strict';

// 表格实时数据：不连真实库也能覆盖表名/库名解析、分页、单元格归一化和错误提示。
const path = require('path');

const root = path.join(__dirname, '..');
const spec = require(path.join(root, 'app/iface/spec'));
const live = require(path.join(root, 'app/iface/table-data'));

let ok = 0;
let bad = 0;
const t = (name, cond, extra) => {
  if (cond) { ok++; console.log('  ✓ ' + name); }
  else { bad++; console.log('  ✗ ' + name + ' → ' + JSON.stringify(extra)); }
};

const project = spec.normalizeProject(spec.seedProject());
const iface = project.interfaces[0];
const table = iface.tables[0];
table.name = 'live_demo';
table.schema = 'live_db';
table.conn = 'main';
table.fields = [
  { name: 'id', type: 'bigint', pk: true, nullable: false, autoIncrement: true },
  { name: 'title', type: 'varchar', nullable: true },
];
project.connections.mysql[0].port = 13306;

const target = live.resolveTarget(project, { ifaceId: iface.id, tableKey: table.key, page: 3, size: 50 });
t('解析到指定接口的表', target.table.name === 'live_demo' && target.table.key === table.key, target.table.name);
t('库名优先用表上的 schema', target.database === 'live_db' && target.host === '127.0.0.1' && target.port === 13306, target);
t('分页算出正确 offset', target.page === 3 && target.size === 50 && target.offset === 100, target);
t('有主键时按主键倒序', target.orderBy === 'id', target.orderBy);
t('每页行数限制在 5-200', live.safeSize(0) === 5 && live.safeSize(9999) === live.MAX_SIZE && live.safeSize('30') === 30, [live.safeSize(0), live.safeSize(9999), live.safeSize('30')]);
t('非法页码回到第一页', live.resolveTarget(project, { page: -2, size: 20 }).page === 1);

const badName = { ...project, interfaces: [{ ...iface, tables: [{ ...table, name: 'live; drop table x' }] }] };
t('拒绝带分号的表名', (() => { try { live.resolveTarget(badName, { ifaceId: iface.id }); return false; } catch (e) { return /表名不合法/.test(e.message); } })());
const badDb = { ...project, interfaces: [{ ...iface, tables: [{ ...table, schema: 'live db' }] }] };
t('拒绝带空格的库名', (() => { try { live.resolveTarget(badDb, { ifaceId: iface.id }); return false; } catch (e) { return /数据库名不合法/.test(e.message); } })());

t('NULL 与 undefined 归一为 null', live.normalizeCell(null) === null && live.normalizeCell(undefined) === null);
t('BigInt 转字符串不丢精度', live.normalizeCell(9007199254740993n) === '9007199254740993', live.normalizeCell(9007199254740993n));
t('Buffer 显示十六进制', live.normalizeCell(Buffer.from([1, 2, 3])) === '0x010203');
t('Date 转 ISO 字符串', live.normalizeCell(new Date('2026-11-25T00:00:00Z')) === '2026-11-25T00:00:00.000Z');
t('对象转 JSON 文本', live.normalizeCell({ a: 1 }) === '{"a":1}');
t('普通字符串和数字原样返回', live.normalizeCell('abc') === 'abc' && live.normalizeCell(42) === 42);

const refused = live.friendlyError({ code: 'ECONNREFUSED', message: 'connect refused' }, target);
t('连不上时给启动本机 MariaDB', refused.action === 'start-mysql' && /启动本机 MariaDB/.test(refused.hint), refused);
const noTable = live.friendlyError({ code: 'ER_NO_SUCH_TABLE', message: 'table missing' }, target);
t('表不存在时建议生成服务', noTable.action === 'generate' && /还没建/.test(noTable.hint), noTable);
const noDb = live.friendlyError({ code: 'ER_BAD_DB_ERROR', message: 'db missing' }, target);
t('库不存在时建议生成服务', noDb.action === 'generate' && /不存在/.test(noDb.hint), noDb);
const denied = live.friendlyError({ code: 'ER_ACCESS_DENIED_ERROR', message: 'denied' }, target);
t('权限错误不提供错误动作', denied.action === '' && /权限/.test(denied.hint), denied);
const unknown = live.friendlyError({ message: 'boom' }, target);
t('未知错误保留原始信息', unknown.ok === false && unknown.error === 'boom' && /boom/.test(unknown.hint), unknown);

t('没有接口时给出工程错误', (() => { try { live.resolveTarget({ ...project, interfaces: [] }, {}); return false; } catch (e) { return /没有接口/.test(e.message); } })());
t('表 schema 为空时回退连接库名', live.resolveTarget({ ...project, interfaces: [{ ...iface, tables: [{ ...table, schema: '' }] }] }, {}).database === 'clickbuild');

(async () => {
  const dead = JSON.parse(JSON.stringify(project));
  dead.connections.mysql[0].port = 1;
  const r = await live.readTable(dead, { ifaceId: iface.id, tableKey: table.key, page: 1, size: 20 });
  t('真实连接被拒时返回结构化错误', r.ok === false && r.code === 'ECONNREFUSED' && r.action === 'start-mysql', r);

  console.log(`\n通过 ${ok} / ${ok + bad}${bad ? '，失败 ' + bad : '，全部通过'}`);
  process.exit(bad ? 1 : 0);
})();
