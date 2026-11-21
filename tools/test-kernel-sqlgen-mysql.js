// 作者：yxpil
// 生成器 SQL 接线 + 真实 MariaDB 回归：把生成出来的 MySQL 脚本整套执行。
const assert = require('assert');
const mysql = require('mysql2/promise');
const ir = require('../app/generator/ir');
const { generateSql } = require('../app/generator/sql');

const HOST = process.env.CB_MYSQL_HOST || '127.0.0.1';
const PORT = Number(process.env.CB_MYSQL_PORT || 13306);
const USER = process.env.CB_MYSQL_USER || 'root';
const PASS = process.env.CB_MYSQL_PASSWORD || '';

async function main() {
  const project = ir.normalizeProject({
    name: 'SQL 生成验收',
    idStrategy: 'auto',
    modules: [],
    customTables: [{
      name: 'biz_order',
      comment: '订单',
      columns: [
        { name: 'id', type: 'bigint', pk: true, auto: true, required: true, comment: '主键' },
        { name: 'order_no', type: 'varchar(64)', required: true, comment: '单号' },
        { name: 'amount', type: 'decimal(18,2)', required: true, comment: '金额' },
        { name: 'created_at', type: 'datetime', comment: '创建时间' },
        { name: 'updated_at', type: 'datetime', comment: '更新时间' },
      ],
    }],
  });
  const dbName = `cb_sqlgen_${Date.now()}`;
  const conn = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASS, multipleStatements: true });
  try {
    const r = generateSql(project, { dialect: 'mysql' });
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    for (const f of r.files) {
      const sql = f.content.replaceAll(project.database.name, dbName);
      await conn.query(sql);
    }
    const [rows] = await conn.query(`SHOW CREATE TABLE \`${dbName}\`.\`biz_order\``);
    const createSql = rows[0]['Create Table'];
    assert.match(createSql, /ENGINE=InnoDB/);
    assert.match(createSql, /AUTO_INCREMENT/);
    assert.match(createSql, /decimal\(18,2\)/i);
    const [cols] = await conn.query(`SELECT COLUMN_NAME, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='biz_order'`, [dbName]);
    const id = cols.find((c) => c.COLUMN_NAME === 'id');
    assert.ok(id && /auto_increment/i.test(id.EXTRA), 'id 应为 auto_increment');
    console.log('ok   真实 MariaDB 执行生成脚本');
    console.log('1 passed');
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``).catch(() => {});
    await conn.end();
  }
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exitCode = 1;
});
