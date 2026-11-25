// 作者：yxpil
'use strict';

// 数据库工作台：连接、库表、结构、分页数据、SQL 与行级增删改。
// 这是 HeidiSQL / Navicat 的“基本可用集”：先保证真实读写，不做只读展示。
const mysql = require('mysql2/promise');
const spec = require('./spec');
const { normalizeCell } = require('./table-data');

const DEFAULT_SIZE = 50;
const MAX_SIZE = 500;
const MAX_PREVIEW_ROWS = 1000;

function ident(name) {
  return /^[A-Za-z0-9_$]+$/.test(String(name || '')) ? String(name) : '';
}
function q(name) {
  const v = ident(name);
  if (!v) throw new Error(`非法名称：${name}`);
  return `\`${v}\``;
}
function safeSize(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(5, Math.min(MAX_SIZE, Math.round(n)));
}
function safePage(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}
function typeName(type) {
  const TYPES = require('mysql2').Types;
  const hit = Object.keys(TYPES).find((k) => TYPES[k] === type);
  return hit ? hit.toLowerCase() : String(type || '');
}

function connectionsOf(project) {
  const p = spec.normalizeProject(project || {});
  const list = (p.connections && p.connections.mysql) || [];
  return list.map((c) => ({
    key: c.key,
    label: c.label || c.key || 'MariaDB',
    host: c.host || '127.0.0.1',
    port: Number(c.port || 3306),
    user: c.user || 'root',
    database: c.database || 'clickbuild',
    readonly: !!c.readonly,
  }));
}

function resolveConn(project, connKey, database) {
  const p = spec.normalizeProject(project || {});
  const raw = (p.connections && p.connections.mysql) || [];
  const hit = raw.find((c) => c.key === connKey) || raw[0];
  if (!hit) throw new Error('工程没有配置 MariaDB 连接');
  const conn = {
    key: hit.key, label: hit.label || hit.key || 'MariaDB',
    host: hit.host || '127.0.0.1', port: Number(hit.port || 3306),
    user: hit.user || 'root', database: hit.database || 'clickbuild',
    readonly: !!hit.readonly,
  };
  const db = database === undefined || database === null ? conn.database : database;
  return { project: p, conn, password: hit.password || '', database: db };
}

function endpoint(ctx) {
  return `${ctx.conn.host}:${ctx.conn.port}${ctx.database ? '/' + ctx.database : ''}`;
}

function friendlyError(e, ctx) {
  const code = (e && e.code) || '';
  const base = { ok: false, code, error: (e && e.message) || '数据库操作失败' };
  if (!ctx) return { ...base, hint: base.error };
  const at = endpoint(ctx);
  const hints = {
    ECONNREFUSED: `连不上 MariaDB ${at}。先启动本机 MariaDB，或检查连接设置。`,
    ETIMEDOUT: `连接 MariaDB ${at} 超时，检查主机和端口。`,
    ENOTFOUND: `解析不到数据库主机 ${ctx.conn.host}。`,
    ER_ACCESS_DENIED_ERROR: `账号 ${ctx.conn.user} 没有访问 ${at} 的权限。`,
    ER_BAD_DB_ERROR: `数据库 ${ctx.database || ''} 不存在。`,
    ER_NO_SUCH_TABLE: `表不存在，先刷新库表列表或重新建表。`,
    ER_DUP_ENTRY: '主键或唯一键冲突，换一个值再试。',
    ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: '字段类型和输入值不匹配，检查数字 / 日期格式。',
    ER_READONLY: '这个连接被标成只读；先到连接设置里取消只读。',
  };
  return { ...base, hint: hints[code] || (e && e.message) || '数据库操作失败', action: code === 'ECONNREFUSED' ? 'start-mysql' : '' };
}

async function open(ctx, opts) {
  const o = opts || {};
  const c = await mysql.createConnection({
    host: ctx.conn.host,
    port: ctx.conn.port,
    user: ctx.conn.user,
    password: ctx.password || '',
    database: ctx.database || undefined,
    charset: 'utf8mb4',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: 5000,
    multipleStatements: false,
  });
  return c;
}

function requireWritable(ctx) {
  if (ctx.conn.readonly) {
    const e = new Error('这个连接是只读模式');
    e.code = 'ER_READONLY';
    throw e;
  }
}

async function withConn(project, opts, fn) {
  let ctx;
  try {
    ctx = resolveConn(project, opts.connKey, opts.database);
  } catch (e) {
    return { ok: false, code: 'TARGET', error: e.message, hint: e.message };
  }
  let conn;
  try {
    conn = await open(ctx, opts);
    return await fn(conn, ctx);
  } catch (e) {
    return friendlyError(e, ctx);
  } finally {
    if (conn) { try { await conn.end(); } catch (_) { /* 已断开 */ } }
  }
}

function shapeRows(rows, fields) {
  const columns = (fields || []).map((f) => ({
    name: f.name,
    type: typeName(f.type),
    length: f.columnLength || 0,
    nullable: !!(f.flags & 1),
  }));
  const list = (rows || []).slice(0, MAX_PREVIEW_ROWS).map((r) => {
    const out = {};
    for (const k of Object.keys(r)) out[k] = normalizeCell(r[k]);
    return out;
  });
  return { columns, rows: list, truncated: (rows || []).length > MAX_PREVIEW_ROWS };
}

function splitSql(sql) {
  const text = String(sql || '').trim();
  if (!text) return [];
  const out = [];
  let buf = '';
  let quote = '';
  let line = false;
  let block = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (line) {
      buf += ch;
      if (ch === '\n') line = false;
      continue;
    }
    if (block) {
      buf += ch;
      if (ch === '*' && next === '/') { buf += next; i++; block = false; }
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === '\\' && next) { buf += next; i++; continue; }
      if (ch === quote) {
        if (next === quote) { buf += next; i++; continue; }
        quote = '';
      }
      continue;
    }
    if (ch === '-' && next === '-') { line = true; buf += ch + next; i++; continue; }
    if (ch === '#') { line = true; buf += ch; continue; }
    if (ch === '/' && next === '*') { block = true; buf += ch + next; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; buf += ch; continue; }
    if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function normalizeSummary(result) {
  if (!result || !Array.isArray(result)) return { affected: 0, insertId: null };
  const affected = result.reduce((n, r) => n + Number((r && r.affectedRows) || 0), 0);
  const insertId = result.find((r) => r && r.insertId) ? result.find((r) => r && r.insertId).insertId : null;
  return { affected, insertId, warningStatus: result[0] && result[0].warningStatus || 0 };
}

async function test(project, opts) {
  const o = opts || {};
  const started = Date.now();
  return withConn(project, o, async (conn, ctx) => {
    const [ver] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db, NOW() AS now');
    const [dbs] = await conn.query('SHOW DATABASES');
    return {
      ok: true,
      elapsed: Date.now() - started,
      connection: { ...ctx.conn },
      database: ctx.database,
      version: (ver[0] || {}).version || '',
      serverNow: (ver[0] || {}).now || null,
      databases: dbs.length,
    };
  });
}

async function listDatabases(project, opts) {
  return withConn(project, { ...(opts || {}), database: null }, async (conn, ctx) => {
    const [rows] = await conn.query('SHOW DATABASES');
    return {
      ok: true,
      connection: ctx.conn,
      databases: rows.map((r) => {
        const name = r.Database || r.database || '';
        const system = ['information_schema', 'mysql', 'performance_schema', 'sys'].includes(name);
        return { name, system };
      }),
    };
  });
}

async function listTables(project, opts) {
  const o = opts || {};
  return withConn(project, o, async (conn, ctx) => {
    const [rows] = await conn.query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_ROWS AS \`rows\`,
        TABLE_COMMENT AS comment, CREATE_TIME AS createdAt
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_TYPE, TABLE_NAME`,
      [ctx.database]
    );
    return {
      ok: true,
      connection: ctx.conn,
      database: ctx.database,
      tables: rows.map((r) => ({
        name: String(r.name || ''),
        type: r.type === 'VIEW' ? 'view' : 'table',
        engine: r.engine || '',
        rows: Number(r.rows || 0),
        comment: r.comment || '',
        createdAt: r.createdAt || null,
      })),
    };
  });
}

async function describe(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  if (!table) throw new Error('表名不合法');
  return withConn(project, o, async (conn, ctx) => {
    const [cols] = await conn.query(`SHOW FULL COLUMNS FROM ${q(table)}`);
    const [indexes] = await conn.query(`SHOW INDEX FROM ${q(table)}`);
    const primary = cols.filter((c) => c.Key === 'PRI').map((c) => c.Field);
    const columns = cols.map((c) => ({
      name: c.Field,
      type: c.Type,
      collation: c.Collation || '',
      nullable: c.Null === 'YES',
      key: c.Key || '',
      default: c.Default === null || c.Default === undefined ? null : String(c.Default),
      extra: c.Extra || '',
      comment: c.Comment || '',
      primary: c.Key === 'PRI',
      autoIncrement: /auto_increment/i.test(c.Extra || ''),
    }));
    const idx = new Map();
    for (const r of indexes) {
      const key = r.Key_name;
      if (!idx.has(key)) idx.set(key, { name: key, unique: !Number(r.Non_unique), columns: [] });
      idx.get(key).columns[Number(r.Seq_in_index) - 1] = r.Column_name;
    }
    return {
      ok: true,
      connection: ctx.conn,
      database: ctx.database,
      table,
      columns,
      primary,
      indexes: [...idx.values()].map((x) => ({ ...x, columns: x.columns.filter(Boolean) })),
    };
  });
}

async function selectRows(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  if (!table) throw new Error('表名不合法');
  const size = safeSize(o.size);
  const page = safePage(o.page);
  const started = Date.now();
  return withConn(project, o, async (conn, ctx) => {
    const [cols] = await conn.query(`SHOW FULL COLUMNS FROM ${q(table)}`);
    const primary = cols.filter((c) => c.Key === 'PRI').map((c) => c.Field);
    const orderField = ident(o.orderBy) || primary[0] || '';
    const dir = String(o.orderDir || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const [countRows] = await conn.query(`SELECT COUNT(*) AS total FROM ${q(table)}`);
    const total = Number((countRows[0] || {}).total || 0);
    const lastPage = Math.max(1, Math.ceil(total / size));
    const realPage = Math.min(page, lastPage);
    const offset = (realPage - 1) * size;
    const order = orderField ? ` ORDER BY ${q(orderField)} ${dir}` : '';
    const sql = `SELECT * FROM ${q(table)}${order} LIMIT ${size} OFFSET ${offset}`;
    const [rows, fields] = await conn.query(sql);
    const shaped = shapeRows(rows, fields);
    return {
      ok: true,
      connection: ctx.conn,
      database: ctx.database,
      table,
      columns: shapeRows([], fields).columns,
      primary,
      rows: shaped.rows,
      truncated: shaped.truncated,
      total,
      page: realPage,
      size,
      pages: lastPage,
      offset,
      elapsed: Date.now() - started,
      readonly: ctx.conn.readonly,
    };
  });
}

async function runSql(project, opts) {
  const o = opts || {};
  const statements = splitSql(o.sql);
  if (!statements.length) return { ok: false, code: 'EMPTY_SQL', error: 'SQL 是空的', hint: '先输入要执行的 SQL' };
  const started = Date.now();
  return withConn(project, o, async (conn, ctx) => {
    const sets = [];
    for (const sql of statements) {
      const t0 = Date.now();
      const [result, fields] = await conn.query(sql);
      if (Array.isArray(result)) {
        const shaped = shapeRows(result, fields);
        sets.push({ sql, kind: 'rows', columns: shaped.columns, rows: shaped.rows, truncated: shaped.truncated, total: result.length, elapsed: Date.now() - t0 });
      } else {
        sets.push({
          sql, kind: 'command',
          affected: Number((result && result.affectedRows) || 0),
          insertId: (result && result.insertId) || null,
          warningStatus: Number((result && result.warningStatus) || 0),
          elapsed: Date.now() - t0,
        });
      }
    }
    return {
      ok: true,
      connection: ctx.conn,
      database: ctx.database,
      statements: statements.length,
      sets,
      elapsed: Date.now() - started,
    };
  });
}

function cleanValues(values, columns) {
  const allowed = new Set(columns.map((c) => c.name));
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (!allowed.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v === '' ? null : v;
  }
  return out;
}

async function insertRow(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  if (!table) throw new Error('表名不合法');
  return withConn(project, o, async (conn, ctx) => {
    requireWritable(ctx);
    const [cols] = await conn.query(`SHOW FULL COLUMNS FROM ${q(table)}`);
    const values = cleanValues(o.values, cols.map((c) => ({
      name: c.Field,
      auto: /auto_increment/i.test(c.Extra || ''),
      nullable: c.Null === 'YES',
    })));
    for (const c of cols) {
      if (/auto_increment/i.test(c.Extra || '') && (values[c.Field] === null || values[c.Field] === undefined)) delete values[c.Field];
    }
    let sql;
    let params;
    if (Object.keys(values).length) {
      sql = `INSERT INTO ${q(table)} SET ?`;
      params = [values];
    } else {
      sql = `INSERT INTO ${q(table)} () VALUES ()`;
      params = [];
    }
    const [result] = await conn.query(sql, params);
    return { ok: true, affected: Number(result.affectedRows || 0), insertId: result.insertId || null, table };
  });
}

async function updateRow(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  const key = ident(o.key);
  if (!table || !key) throw new Error('表名或主键不合法');
  if (o.keyValue === undefined || o.keyValue === null) throw new Error('缺少主键值');
  return withConn(project, o, async (conn, ctx) => {
    requireWritable(ctx);
    const [cols] = await conn.query(`SHOW FULL COLUMNS FROM ${q(table)}`);
    const values = cleanValues(o.values, cols.map((c) => ({ name: c.Field })));
    delete values[key];
    if (!Object.keys(values).length) return { ok: true, affected: 0, table, skipped: true };
    const [result] = await conn.query(`UPDATE ${q(table)} SET ? WHERE ${q(key)} = ?`, [values, o.keyValue]);
    return { ok: true, affected: Number(result.affectedRows || 0), table };
  });
}

async function deleteRow(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  const key = ident(o.key);
  if (!table || !key) throw new Error('表名或主键不合法');
  if (o.keyValue === undefined || o.keyValue === null) throw new Error('缺少主键值');
  return withConn(project, o, async (conn, ctx) => {
    requireWritable(ctx);
    const [result] = await conn.query(`DELETE FROM ${q(table)} WHERE ${q(key)} = ?`, [o.keyValue]);
    return { ok: true, affected: Number(result.affectedRows || 0), table };
  });
}

const COLUMN_TYPES = new Set([
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'DECIMAL', 'FLOAT', 'DOUBLE',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'JSON',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'BOOLEAN', 'BOOL', 'BLOB',
]);

function buildColumn(f) {
  const name = ident(f.name);
  if (!name) throw new Error('字段名不合法');
  const auto = !!(f.autoIncrement || f.auto);
  const pk = !!(f.primary || f.pk);
  let type = String(f.type || 'VARCHAR').toUpperCase().replace(/\s+/g, ' ');
  const m = /^([A-Z]+)(\(([0-9]+)(,([0-9]+))?\))?$/.exec(type);
  if (!m || !COLUMN_TYPES.has(m[1])) throw new Error(`字段 ${name} 的类型不支持：${type}`);
  const base = m[1];
  const args = m[3] ? `(${m[3]}${m[5] ? ',' + m[5] : ''})` : (base === 'VARCHAR' || base === 'CHAR' ? '(255)' : '');
  let sql = `${q(name)} ${base}${args}`;
  if (pk || auto) sql += ' NOT NULL';
  else if (!f.nullable) sql += ' NOT NULL';
  if (auto) sql += ' AUTO_INCREMENT';
  if (f.default !== undefined && f.default !== null && String(f.default) !== '') {
    const raw = String(f.default);
    if (/^(NULL|CURRENT_TIMESTAMP|CURRENT_TIMESTAMP\(\)|NOW\(\))$/i.test(raw) || /^-?[0-9]+(\.[0-9]+)?$/.test(raw) || /^(true|false)$/i.test(raw)) {
      sql += ` DEFAULT ${raw.toUpperCase()}`;
    } else {
      sql += ` DEFAULT '${raw.replace(/'/g, "''")}'`;
    }
  }
  if (f.comment) sql += ` COMMENT '${String(f.comment).replace(/'/g, "''")}'`;
  return sql;
}

async function createTable(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  if (!table) throw new Error('表名不合法');
  const fields = Array.isArray(o.fields) ? o.fields : [];
  if (!fields.length) throw new Error('至少需要一个字段');
  return withConn(project, o, async (conn, ctx) => {
    requireWritable(ctx);
    const defs = fields.map(buildColumn);
    const primary = fields.filter((f) => f.primary || f.pk || f.autoIncrement || f.auto).map((f) => q(f.name));
    if (primary.length) defs.push(`PRIMARY KEY (${primary.join(', ')})`);
    const sql = `CREATE TABLE ${o.ifNotExists === false ? '' : 'IF NOT EXISTS '}${q(table)} (${defs.join(', ')})${o.comment ? ` COMMENT='${String(o.comment).replace(/'/g, "''")}'` : ''}`;
    const [result] = await conn.query(sql);
    return { ok: true, table, sql, warningStatus: Number(result.warningStatus || 0) };
  });
}

async function dropTable(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  if (!table) throw new Error('表名不合法');
  return withConn(project, o, async (conn, ctx) => {
    requireWritable(ctx);
    await conn.query(`DROP TABLE ${q(table)}`);
    return { ok: true, table };
  });
}

async function renameTable(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  const next = ident(o.next);
  if (!table || !next) throw new Error('表名不合法');
  return withConn(project, o, async (conn, ctx) => {
    requireWritable(ctx);
    await conn.query(`RENAME TABLE ${q(table)} TO ${q(next)}`);
    return { ok: true, table, next };
  });
}

module.exports = {
  connectionsOf, test, listDatabases, listTables, describe, selectRows,
  runSql, insertRow, updateRow, deleteRow, createTable, dropTable, renameTable,
  splitSql, normalizeCell,
};
