// 作者：yxpil
// 真实 MySQL/MariaDB 回归：初始化、增量 ALTER、反向工程。
// 默认连本机 13306 root 空密码；可用 CBS_TEST_MYSQL_PORT/HOST/USER/PASSWORD 覆盖。
const assert = require('assert');
const mysql = require('mysql2/promise');
const { normalizeRegistry, validateRegistry } = require('../app/kernel/metamodel');
const { initMigration, diffMigration } = require('../app/kernel/migrate');
const { introspectMysql } = require('../app/kernel/introspect');
const { projectFromRegistry } = require('../app/kernel/to-project');
const spec = require('../app/iface/spec');

const config = {
  host: process.env.CBS_TEST_MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.CBS_TEST_MYSQL_PORT || 13306),
  user: process.env.CBS_TEST_MYSQL_USER || 'root',
  password: process.env.CBS_TEST_MYSQL_PASSWORD || '',
};

(async () => {
  let admin;
  try {
    admin = await mysql.createConnection({ ...config, database: 'mysql' });
  } catch (err) {
    console.log(`skip 本地 MariaDB 不可用：${err.message}`);
    return;
  }
  const db = `cb_kernel_test_${Date.now()}`;
  let conn;
  try {
    await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4;`);
    conn = await mysql.createConnection({ ...config, database: db });

    const sample = normalizeRegistry({
      entities: [{
        name: 'users', comment: '用户',
        fields: [
          { name: 'id', type: 'bigint', pk: true, autoIncrement: true, comment: '主键' },
          { name: 'email', type: 'varchar', length: 320, nullable: false, unique: true },
          { name: 'name', type: 'varchar', length: 80, nullable: true },
        ],
        indexes: [{ name: 'idx_users_name', columns: ['name'] }],
      }],
    });
    const v = validateRegistry(sample);
    assert.strictEqual(v.ok, true, v.errors.join(';'));
    for (const sql of initMigration(sample, 'mysql', { version: '0001' }).up) await conn.query(sql);
    await conn.query("INSERT INTO users (email, name) VALUES ('a@b.c', '阿猫')");

    const next = normalizeRegistry({
      ...sample,
      version: 2,
      entities: [{
        ...sample.entities[0],
        fields: sample.entities[0].fields.map((f) => f.name === 'name' ? { ...f, length: 120, nullable: false, default: '匿名' } : f)
          .concat([{ name: 'display_name', type: 'varchar', length: 80, nullable: true }]),
        indexes: sample.entities[0].indexes.concat([{ name: 'idx_users_display', columns: ['display_name'] }]),
      }],
    });
    const m = diffMigration(sample, next, 'mysql', { version: '0002' });
    for (const sql of m.up) await conn.query(sql);
    const row = (await conn.query('SELECT * FROM users'))[0][0];
    assert.strictEqual(row.email, 'a@b.c');
    assert.strictEqual(row.name, '阿猫');
    assert.strictEqual(row.display_name, null);
    const [idx] = await conn.query("SHOW INDEX FROM users WHERE Key_name = 'idx_users_display'");
    assert.ok(idx.length >= 1);

    const back = await introspectMysql(conn, { schema: db });
    const users = back.entities.find((x) => x.name === 'users');
    assert.ok(users);
    assert.strictEqual(users.fields.find((f) => f.name === 'display_name').length, 80);
    assert.ok(users.indexes.some((x) => x.name === 'idx_users_display'));

    const project = spec.normalizeProject(projectFromRegistry(back, { name: 'MySQL 反向工程' }));
    const pv = spec.validateProject(project);
    assert.strictEqual(pv.errors.length, 0, pv.errors.join(';'));
    console.log(`ok   MySQL 初始化/ALTER/反向工程（${back.entities.length} 张表）`);
  } finally {
    if (conn) await conn.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${db}\`;`);
    await admin.end();
  }
})().catch((err) => { console.error(`FAIL ${err.message}`); process.exitCode = 1; });
