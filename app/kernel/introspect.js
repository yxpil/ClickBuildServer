// 作者：yxpil
'use strict';

// 反向工程：数据库元数据 -> 通用元模型。先做 MySQL/MariaDB 与 SQLite；
// PostgreSQL 走同一张 information_schema，后续补一个 reader 即可。
// 这里只产出 registry，不直接改 UI 工程。

const { normalizeRegistry } = require('./metamodel');

const text = (v) => (v == null ? '' : String(v));
const num = (v) => (v == null ? undefined : Number(v));

const MYSQL_TYPE = {
  bigint: 'bigint', int: 'int', mediumint: 'int', smallint: 'smallint', tinyint: 'tinyint',
  decimal: 'decimal', numeric: 'decimal', float: 'float', double: 'double', real: 'double',
  varchar: 'varchar', char: 'char', text: 'text', tinytext: 'text', mediumtext: 'longtext', longtext: 'longtext',
  datetime: 'datetime', timestamp: 'datetime', date: 'date', time: 'time',
  json: 'json',
};

function parseEnumValues(columnType) {
  const m = /^enum\((.*)\)$/i.exec(text(columnType));
  if (!m) return null;
  return m[1].split(',').map((x) => x.trim().replace(/^'/, '').replace(/'$/, '').replace(/''/g, "'"));
}

function mapMysqlField(row, tableName, enumPrefix, enums) {
  const dataType = text(row.DATA_TYPE).toLowerCase();
  const columnType = text(row.COLUMN_TYPE).toLowerCase();
  const enumValues = parseEnumValues(columnType);
  let type = MYSQL_TYPE[dataType] || 'varchar';
  if (dataType === 'tinyint' && /^tinyint\(1\)/.test(columnType)) type = 'bool';
  let enumRef = '';
  if (enumValues && enumValues.length) {
    enumRef = `${tableName}_${row.COLUMN_NAME}_enum`;
    if (!enums.some((e) => e.name === enumRef)) enums.push({ name: enumRef, label: `${tableName}.${row.COLUMN_NAME}`, values: enumValues });
  }
  return {
    name: row.COLUMN_NAME,
    type,
    length: num(row.CHARACTER_MAXIMUM_LENGTH),
    precision: num(row.NUMERIC_PRECISION),
    scale: num(row.NUMERIC_SCALE),
    nullable: text(row.IS_NULLABLE).toUpperCase() === 'YES',
    primaryKey: text(row.COLUMN_KEY).toUpperCase() === 'PRI',
    autoIncrement: /auto_increment/i.test(text(row.EXTRA)),
    default: row.COLUMN_DEFAULT == null ? null : row.COLUMN_DEFAULT,
    comment: text(row.COLUMN_COMMENT),
    enumRef,
    source: { kind: 'database', dialect: 'mysql', column: row.COLUMN_NAME },
  };
}

async function introspectMysql(pool, opts) {
  const o = opts || {};
  const schema = o.schema || o.database;
  if (!schema) throw new Error('反向工程 MySQL 需要 schema/database');
  const [cols] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
            COLUMN_KEY, EXTRA, COLUMN_COMMENT, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [schema],
  );
  const [idxRows] = await pool.query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [schema],
  );
  const [fks] = await pool.query(
    `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    [schema],
  );

  const tables = new Map();
  const enums = [];
  for (const row of cols) {
    if (row.TABLE_NAME === 'schema_migrations' && !o.includeInternal) continue;
    if (!tables.has(row.TABLE_NAME)) tables.set(row.TABLE_NAME, { name: row.TABLE_NAME, primaryKeys: [], fields: [], indexes: [], relations: [], source: { kind: 'database', dialect: 'mysql', schema, table: row.TABLE_NAME } });
    const t = tables.get(row.TABLE_NAME);
    const field = mapMysqlField(row, row.TABLE_NAME, row.TABLE_NAME, enums);
    t.fields.push(field);
    if (field.primaryKey) t.primaryKeys.push(field.name);
  }

  const idxMap = new Map();
  for (const row of idxRows) {
    if (text(row.INDEX_NAME).toUpperCase() === 'PRIMARY') continue;
    const key = `${row.TABLE_NAME}.${row.INDEX_NAME}`;
    if (!idxMap.has(key)) idxMap.set(key, { name: row.INDEX_NAME, unique: Number(row.NON_UNIQUE) === 0, columns: [] });
    idxMap.get(key).columns.push(row.COLUMN_NAME);
  }
  for (const [key, idx] of idxMap) {
    const table = key.split('.')[0];
    if (tables.has(table)) tables.get(table).indexes.push(idx);
  }

  const fkMap = new Map();
  for (const row of fks) {
    const key = `${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`;
    if (!fkMap.has(key)) fkMap.set(key, { name: row.CONSTRAINT_NAME, table: row.TABLE_NAME, columns: [], target: row.REFERENCED_TABLE_NAME, targetColumns: [] });
    fkMap.get(key).columns.push(row.COLUMN_NAME);
    fkMap.get(key).targetColumns.push(row.REFERENCED_COLUMN_NAME);
  }
  for (const fk of fkMap.values()) {
    if (!tables.has(fk.table) || !tables.has(fk.target)) continue;
    tables.get(fk.table).relations.push({
      name: fk.name,
      kind: 'many-to-one',
      target: fk.target,
      field: fk.columns.length === 1 ? fk.columns[0] : undefined,
      targetKey: fk.targetColumns.length === 1 ? fk.targetColumns[0] : undefined,
      comment: '反向工程外键',
    });
  }

  const registry = normalizeRegistry({ version: (o && o.version) || 1, name: o.name || schema, entities: [...tables.values()], enums });
  registry.options.dialect = 'mysql';
  registry.options.schema = schema;
  return registry;
}

const SQLITE_TYPE = { integer: 'bigint', int: 'int', bigint: 'bigint', smallint: 'smallint', tinyint: 'tinyint', real: 'double', float: 'float', double: 'double', numeric: 'decimal', decimal: 'decimal', text: 'text', varchar: 'varchar', char: 'char', json: 'json', datetime: 'datetime', date: 'date', time: 'time', boolean: 'bool', bool: 'bool' };

function sqliteType(type, pk, auto) {
  const raw = text(type).toLowerCase().replace(/\(.*/, '').trim();
  let t = SQLITE_TYPE[raw] || 'varchar';
  if (pk && auto && (t === 'bigint' || t === 'int')) return 'bigint';
  if (raw === 'integer' && pk) return 'bigint';
  return t;
}

function introspectSqlite(db, opts) {
  const o = opts || {};
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const entities = [];
  const enums = [];
  for (const table of tables) {
    if (table.name === 'schema_migrations' && !o.includeInternal) continue;
    if (table.name.startsWith('sqlite_')) continue;
    const info = db.prepare(`PRAGMA table_info(${JSON.stringify(table.name)})`).all();
    const auto = /AUTOINCREMENT/i.test(text(table.sql));
    const fields = info.map((c) => ({
      name: c.name,
      type: sqliteType(c.type, c.pk > 0, auto),
      nullable: c.notnull === 0 && !(c.pk > 0),
      primaryKey: c.pk > 0,
      autoIncrement: auto && c.pk > 0,
      default: c.dflt_value == null ? null : String(c.dflt_value).replace(/^'|'$/g, '').replace(/''/g, "'"),
      source: { kind: 'database', dialect: 'sqlite', column: c.name },
    }));
    const indexes = [];
    for (const idx of db.prepare(`PRAGMA index_list(${JSON.stringify(table.name)})`).all()) {
      if (idx.origin === 'pk') continue;
      const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all().map((x) => x.name).filter(Boolean);
      if (cols.length) indexes.push({ name: idx.name, unique: Number(idx.unique) === 1, columns: cols });
    }
    const relations = [];
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table.name)})`).all()) {
      relations.push({ name: `fk_${table.name}_${fk.from}`, kind: 'many-to-one', target: fk.table, field: fk.from, targetKey: fk.to, comment: '反向工程外键' });
    }
    entities.push({ name: table.name, primaryKeys: fields.filter((f) => f.primaryKey).map((f) => f.name), fields, indexes, relations, source: { kind: 'database', dialect: 'sqlite', table: table.name } });
  }
  const registry = normalizeRegistry({ version: o.version || 1, name: o.name || 'sqlite', entities, enums });
  registry.options.dialect = 'sqlite';
  return registry;
}

function introspectPostgres(pool, opts) {
  // 与 MySQL 同一个信息模型；先把接口留出来，下一轮接 pg 驱动时不用改元模型。
  throw new Error('PostgreSQL 反向工程尚未接线，请先用 MySQL/SQLite；方言 DDL 已支持 postgres。');
}

module.exports = { introspectMysql, introspectSqlite, introspectPostgres, parseEnumValues };
