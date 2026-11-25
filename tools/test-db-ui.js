// 作者：yxpil
// 1.1.89 静态接线：数据库工作台、数据库工程、可写数据页、部署设置。
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const dbAdmin = require(path.join(root, 'app/iface/db-admin'));
const tableData = require(path.join(root, 'app/iface/table-data'));
const spec = require(path.join(root, 'app/iface/spec'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const methods = ['test', 'listDatabases', 'listTables', 'describe', 'selectRows', 'runSql', 'insertRow', 'updateRow', 'deleteRow', 'createTable', 'dropTable', 'renameTable', 'splitSql'];
ok('db-admin 导出全部基础方法', methods.every((m) => typeof dbAdmin[m] === 'function'), methods.filter((m) => typeof dbAdmin[m] !== 'function'));
ok('table-data 导出 mutateTable', typeof tableData.mutateTable === 'function');
ok('TASK_TYPES 含 database', spec.TASK_TYPES.join(',') === 'frontend,backend,mixed,database', spec.TASK_TYPES);
const dbStarter = spec.starterProject('database');
ok('数据库工程有 dbProject', !!dbStarter.dbProject && dbStarter.dbProject.conn === 'main', dbStarter.dbProject);
ok('数据库工程不生成接口', dbStarter.interfaces.length === 0, dbStarter.interfaces.length);
ok('数据库工程名称', dbStarter.name === '数据库工程', dbStarter.name);
const dbNormal = spec.normalizeProject({ ...dbStarter, name: '库工程验收' });
ok('normalizeProject 保留 dbProject', !!dbNormal.dbProject && dbNormal.dbProject.database === 'clickbuild', dbNormal.dbProject);

const sqls = dbAdmin.splitSql("SELECT ';' AS a; -- 注释\nUPDATE t SET x='a;b'; /* 块; */ SELECT 3");
ok('splitSql 处理引号与注释', sqls.length === 3, sqls);
ok('只读开关在连接配置', /readonly/.test(read('app/iface/db-admin.js')));

const ipc = read('app/iface/ipc.js');
ok('IPC 注册数据库管理', ['iface:db:connections', 'iface:db:select', 'iface:db:query', 'iface:db:create-table', 'iface:table-mutate'].every((k) => ipc.includes(k)));
const preload = read('preload.js');
ok('preload 暴露数据库方法', ['dbConnections', 'dbSelect', 'dbQuery', 'dbCreateTable', 'tableMutate'].every((k) => preload.includes(k)));

const html = read('renderer/wbench.html');
ok('工作台链接 wbench-db.css', html.includes('href="wbench-db.css"'));
const wb = read('renderer/wbench.js');
ok('数据库工作台渲染函数', ['function renderDB', 'function dbReloadAll', 'function showRowEditor', 'function showCreateTable', 'function runDbSql'].every((s) => wb.includes(s)));
ok('数据库工程进入 db 视图', wb.includes("taskKindOf(S.project) === 'database') setView('db')"));
ok('实时数据页可写入口', ['data-live-add-row', 'data-live-edit-row', 'data-live-del-row', 'tableMutate'].every((s) => wb.includes(s)));
ok('部署设置入口与弹窗', ['showDeploySettings', 'deployPrompt', 'dpPageNav'].every((s) => wb.includes(s)));
ok('部署按钮先走设置', wb.includes('return showDeploySettings(true)'));
const studio = read('renderer/studio.html');
ok('导出弹窗有页面导航条开关', studio.includes('id="optPageNav"'));
ok('前端接收部署选项', studio.includes("cbs:yxpp:deploy-options") && studio.includes('S.proj.pageNav = !!o.pageNav'));

console.log(`\n通过 ${pass} / ${pass + fail}${fail ? '，失败 ' + fail : '，全部通过'}`);
process.exit(fail ? 1 : 0);
