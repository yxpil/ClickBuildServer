// 作者：yxpil
'use strict';

// 数据库工作台：连接、库表、结构、分页数据、SQL 与行级增删改。
// 这是 HeidiSQL / Navicat 的“基本可用集”：先保证真实读写，不做只读展示。
const mysql = require('mysql2/promise');
const spec = require('./spec');
const sshTunnel = require('./ssh-tunnel');
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
    ssh: sshTunnel.sshSummary(c),
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
    sshEnabled: !!hit.sshEnabled, sshHost: hit.sshHost || '', sshPort: Number(hit.sshPort || 22),
    sshUser: hit.sshUser || '', sshPassword: hit.sshPassword || '', sshKeyPath: hit.sshKeyPath || '',
    sshKey: hit.sshKey || '', sshPassphrase: hit.sshPassphrase || '',
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
  let tunnel = null;
  if (ctx.conn.sshEnabled) {
    tunnel = await sshTunnel.openTunnel(ctx.conn, ctx.conn.host, ctx.conn.port);
    ctx.tunnel = tunnel;
  }
  const c = await mysql.createConnection({
    host: tunnel ? tunnel.host : ctx.conn.host,
    port: tunnel ? tunnel.port : ctx.conn.port,
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
    if (ctx && ctx.tunnel) { try { ctx.tunnel.close(); } catch (_) { /* 已关闭 */ } }
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

function safeFileName(name, ext) {
  const base = String(name || 'export').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'export';
  return ext && !new RegExp(`\\.${ext}$`, 'i').test(base) ? `${base}.${ext}` : base;
}
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function tableDdl(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  if (!table) throw new Error('表名不合法');
  return withConn(project, o, async (conn, ctx) => {
    const [rows] = await conn.query(`SHOW CREATE TABLE ${q(table)}`);
    const row = (rows && rows[0]) || {};
    return { ok: true, table, ddl: row['Create Table'] || row['Create View'] || '' };
  });
}

async function exportData(project, opts) {
  const o = opts || {};
  const format = ['csv', 'sql', 'json'].includes(String(o.format || '').toLowerCase()) ? String(o.format).toLowerCase() : 'csv';
  const limit = Math.max(1, Math.min(5000, Number(o.limit || 1000)));
  const table = o.table ? ident(o.table) : '';
  const sql = String(o.sql || '').trim();
  if (!table && !sql) throw new Error('缺少表名或查询 SQL');
  return withConn(project, o, async (conn, ctx) => {
    let columns = [];
    let rows = [];
    let source = table;
    let ddl = '';
    if (table) {
      const [cols] = await conn.query(`SHOW FULL COLUMNS FROM ${q(table)}`);
      columns = cols.map((c) => c.Field);
      const [data, fields] = await conn.query(`SELECT * FROM ${q(table)} LIMIT ${limit}`);
      if (!columns.length && fields) columns = fields.map((f) => f.name);
      rows = data;
      if (format === 'sql') {
        const [ddlRows] = await conn.query(`SHOW CREATE TABLE ${q(table)}`);
        ddl = ((ddlRows && ddlRows[0]) || {})['Create Table'] || '';
      }
    } else {
      const statements = splitSql(sql);
      if (statements.length !== 1) throw new Error('导出查询只能包含一条 SELECT / SHOW 语句');
      const [data, fields] = await conn.query(statements[0]);
      if (!Array.isArray(data)) throw new Error('这条 SQL 没有结果集，不能导出');
      rows = data;
      columns = (fields || []).map((f) => f.name);
      source = 'query';
      if (format === 'sql') throw new Error('查询结果只支持 CSV / JSON 导出');
    }
    const trimmed = rows.slice(0, limit);
    let content = '';
    if (format === 'csv') {
      content = '\ufeff' + [columns.map(csvCell).join(','), ...trimmed.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n');
    } else if (format === 'json') {
      content = JSON.stringify(trimmed.map((r) => {
        const x = {};
        for (const c of columns) x[c] = normalizeCell(r[c]);
        return x;
      }), null, 2);
    } else {
      const lines = [
        `-- ClickBuild export ${new Date().toISOString()}`,
        `-- source: ${ctx.conn.host}:${ctx.conn.port}/${ctx.database} · ${source}`,
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS=0;',
        `DROP TABLE IF EXISTS ${q(table)};`,
        ddl ? `${ddl};` : '',
      ];
      const colSql = columns.map((c) => q(c)).join(', ');
      for (const r of trimmed) {
        lines.push(`INSERT INTO ${q(table)} (${colSql}) VALUES (${columns.map((c) => conn.escape(normalizeCell(r[c]))).join(', ')});`);
      }
      lines.push('SET FOREIGN_KEY_CHECKS=1;', '');
      content = lines.filter((x) => x !== null && x !== undefined && x !== '').join('\n');
    }
    const ext = format === 'sql' ? 'sql' : format === 'json' ? 'json' : 'csv';
    const name = `${safeFileName(table || `query-${stamp()}`, ext)}`;
    return {
      ok: true,
      format, name, content, bytes: Buffer.byteLength(content),
      rows: trimmed.length, columns, truncated: rows.length > limit,
      source, table: table || '', database: ctx.database,
    };
  });
}

async function importSql(project, opts) {
  const o = opts || {};
  const text = String(o.sql || '');
  if (!text.trim()) return { ok: false, code: 'EMPTY_SQL', error: 'SQL 文件是空的', hint: '换一个包含语句的文件' };
  if (text.length > 12 * 1024 * 1024) return { ok: false, code: 'TOO_LARGE', error: 'SQL 文件超过 12 MB', hint: '拆成多个文件再导入' };
  const statements = splitSql(text);
  if (!statements.length) return { ok: false, code: 'EMPTY_SQL', error: '没有解析到可执行语句' };
  if (statements.length > 5000) return { ok: false, code: 'TOO_MANY', error: `语句太多（${statements.length} 条）`, hint: '单个文件最多 5000 条语句，请拆分后导入' };
  const started = Date.now();
  return withConn(project, o, async (conn, ctx) => {
    requireWritable(ctx);
    const done = [];
    let failed = null;
    for (let i = 0; i < statements.length; i++) {
      const sql = statements[i];
      const t0 = Date.now();
      try {
        const [result, fields] = await conn.query(sql);
        const rows = Array.isArray(result);
        done.push({
          index: i + 1, sql: sql.slice(0, 300), ok: true, elapsed: Date.now() - t0,
          kind: rows ? 'rows' : 'command',
          rows: rows ? result.length : 0,
          affected: rows ? 0 : Number((result && result.affectedRows) || 0),
        });
      } catch (e) {
        failed = { index: i + 1, sql: sql.slice(0, 300), error: e.message || String(e), code: e.code || '' };
        done.push({ ...failed, ok: false, elapsed: Date.now() - t0 });
        if (o.continueOnError !== true) break;
      }
    }
    return {
      ok: !failed, partial: !!failed && done.filter((x) => x.ok).length > 0,
      total: statements.length, done: done.filter((x) => x.ok).length, failed,
      statements: done, elapsed: Date.now() - started,
      database: ctx.database,
      hint: failed ? `第 ${failed.index} 条失败：${failed.error}` : '',
    };
  });
}

function grantObject(database, table) {
  const db = String(database || '*');
  const tb = String(table || '*');
  if (db === '*') return '*.*';
  const qd = ident(db);
  if (!qd) throw new Error('数据库名不合法');
  if (tb === '*') return `${q(db)}.*`;
  const qt = ident(tb);
  if (!qt) throw new Error('表名不合法');
  return `${q(db)}.${q(tb)}`;
}

function accountSql(conn, user, host) {
  const u = String(user || '').trim();
  if (!u) throw new Error('用户名不能为空');
  const h = String(host || '%').trim() || '%';
  return `${conn.escape(u)}@${conn.escape(h)}`;
}

const GRANT_PRIVS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX', 'REFERENCES',
  'CREATE TEMPORARY TABLES', 'LOCK TABLES', 'EXECUTE', 'CREATE VIEW', 'SHOW VIEW',
  'CREATE ROUTINE', 'ALTER ROUTINE', 'EVENT', 'TRIGGER', 'ALL PRIVILEGES',
]);

function normalizePrivileges(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x || '').trim().toUpperCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (!list.length) throw new Error('至少选择一项权限');
  for (const p of list) if (!GRANT_PRIVS.has(p)) throw new Error(`不支持授权 ${p}`);
  return [...new Set(list)].join(', ');
}

async function userAction(project, opts) {
  const o = opts || {};
  const action = String(o.action || '');
  // GRANT/REVOKE 的目标库可能写的是 *，不能把它当成连接库名，否则会连到一个不存在的库。
  const isGrant = action === 'grant' || action === 'revoke';
  const grantTarget = isGrant ? grantObject(o.database, o.table) : null;
  const grantPriv = isGrant ? normalizePrivileges(o.privileges) : null;
  const connOpts = isGrant ? { ...o, database: null } : o;
  return withConn(project, connOpts, async (conn, ctx) => {
    requireWritable(ctx);
    if (action === 'create') {
      const account = accountSql(conn, o.user, o.host);
      const password = String(o.password || '');
      if (!password) throw new Error('新用户密码不能为空');
      await conn.query(`CREATE USER ${account} IDENTIFIED BY ${conn.escape(password)}`);
      return { ok: true, action, user: o.user, host: o.host || '%' };
    }
    if (action === 'drop') {
      const account = accountSql(conn, o.user, o.host);
      await conn.query(`DROP USER ${account}`);
      return { ok: true, action, user: o.user, host: o.host || '%' };
    }
    if (action === 'password') {
      const account = accountSql(conn, o.user, o.host);
      const password = String(o.password || '');
      if (!password) throw new Error('新密码不能为空');
      await conn.query(`ALTER USER ${account} IDENTIFIED BY ${conn.escape(password)}`);
      return { ok: true, action, user: o.user, host: o.host || '%' };
    }
    if (isGrant) {
      const account = accountSql(conn, o.user, o.host);
      await conn.query(`${action === 'grant' ? 'GRANT' : 'REVOKE'} ${grantPriv} ON ${grantTarget} ${action === 'grant' ? 'TO' : 'FROM'} ${account}`);
      return { ok: true, action, user: o.user, host: o.host || '%', privileges: grantPriv, object: grantTarget };
    }
    throw new Error(`不支持的用户操作：${action}`);
  });
}

async function listUsers(project, opts) {
  const o = opts || {};
  return withConn(project, o, async (conn, ctx) => {
    const [rows] = await conn.query('SELECT User, Host FROM mysql.user ORDER BY User, Host');
    const users = [];
    for (const r of rows.slice(0, 200)) {
      let grants = [];
      try {
        const [g] = await conn.query(`SHOW GRANTS FOR ${conn.escape(r.User)}@${conn.escape(r.Host)}`);
        grants = g.map((x) => Object.values(x)[0]).filter(Boolean);
      } catch (e) {
        grants = [`读取失败：${e.message}`];
      }
      users.push({ user: r.User, host: r.Host, grants });
    }
    return { ok: true, users, count: rows.length };
  });
}

async function createDatabase(project, opts) {
  const o = opts || {};
  const name = ident(o.name);
  if (!name) throw new Error('数据库名不合法');
  return withConn(project, { ...o, database: null }, async (conn, ctx) => {
    requireWritable(ctx);
    await conn.query(`CREATE DATABASE IF NOT EXISTS ${q(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    return { ok: true, name };
  });
}

async function dropDatabase(project, opts) {
  const o = opts || {};
  const name = ident(o.name);
  if (!name) throw new Error('数据库名不合法');
  return withConn(project, { ...o, database: null }, async (conn, ctx) => {
    requireWritable(ctx);
    await conn.query(`DROP DATABASE ${q(name)}`);
    return { ok: true, name };
  });
}

async function serverInfo(project, opts) {
  const o = opts || {};
  return withConn(project, o, async (conn, ctx) => {
    const started = Date.now();
    let processlist = [];
    let processError = '';
    try {
      const [rows] = await conn.query('SHOW FULL PROCESSLIST');
      processlist = rows.map((r) => ({
        id: r.Id, user: r.User, host: r.Host, db: r.db, command: r.Command,
        time: Number(r.Time || 0), state: r.State || '', info: String(r.Info || '').slice(0, 300),
      }));
    } catch (e) {
      processError = e.message;
    }
    const [vars] = await conn.query('SHOW GLOBAL VARIABLES');
    const [status] = await conn.query('SHOW GLOBAL STATUS');
    const wantedVars = ['version', 'version_comment', 'character_set_server', 'collation_server', 'max_connections', 'wait_timeout', 'innodb_buffer_pool_size', 'datadir'];
    const wantedStatus = ['Uptime', 'Threads_connected', 'Threads_running', 'Queries', 'Slow_queries', 'Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Bytes_received', 'Bytes_sent', 'Innodb_buffer_pool_reads', 'Innodb_buffer_pool_read_requests'];
    const varMap = Object.fromEntries(vars.map((r) => [r.Variable_name, r.Value]));
    const statusMap = Object.fromEntries(status.map((r) => [r.Variable_name, Number.isFinite(Number(r.Value)) ? Number(r.Value) : r.Value]));
    return {
      ok: true, elapsed: Date.now() - started,
      variables: wantedVars.filter((k) => k in varMap).map((k) => ({ name: k, value: String(varMap[k]) })),
      status: wantedStatus.filter((k) => k in statusMap).map((k) => ({ name: k, value: statusMap[k] })),
      processlist, processError,
    };
  });
}

async function alterTable(project, opts) {
  const o = opts || {};
  const table = ident(o.table);
  if (!table) throw new Error('表名不合法');
  const actions = Array.isArray(o.actions) ? o.actions : [];
  if (!actions.length) throw new Error('没有要修改的结构');
  return withConn(project, o, async (conn, ctx) => {
    requireWritable(ctx);
    const clauses = [];
    for (const a of actions) {
      const type = String(a.type || '');
      if (type === 'add') {
        const def = buildColumn({ ...a, type: a.dataType || a.columnType || a.typeName });
        let pos = '';
        if (a.first) pos = ' FIRST';
        else if (a.after) pos = ` AFTER ${q(a.after)}`;
        clauses.push(`ADD COLUMN ${def}${pos}`);
      } else if (type === 'modify') {
        const old = ident(a.name);
        if (!old) throw new Error('要修改的字段名不合法');
        const nextName = a.newName ? ident(a.newName) : old;
        if (!nextName) throw new Error('新字段名不合法');
        const def = buildColumn({ ...a, name: nextName, type: a.dataType || a.columnType || a.typeName });
        clauses.push(`CHANGE COLUMN ${q(old)} ${def}`);
      } else if (type === 'drop') {
        const name = ident(a.name);
        if (!name) throw new Error('要删除的字段名不合法');
        clauses.push(`DROP COLUMN ${q(name)}`);
      } else if (type === 'addIndex') {
        const name = a.name ? ident(a.name) : '';
        const cols = (Array.isArray(a.columns) ? a.columns : []).map(ident).filter(Boolean);
        if (!cols.length) throw new Error('索引至少需要一列');
        const prefix = a.unique ? 'ADD UNIQUE INDEX' : 'ADD INDEX';
        clauses.push(`${prefix}${name ? ` ${q(name)}` : ''} (${cols.map(q).join(', ')})`);
      } else if (type === 'dropIndex') {
        const name = ident(a.name);
        if (!name) throw new Error('索引名不合法');
        clauses.push(`DROP INDEX ${q(name)}`);
      } else if (type === 'comment') {
        clauses.push(`COMMENT=${conn.escape(String(a.comment || ''))}`);
      } else {
        throw new Error(`不支持的结构修改：${type}`);
      }
    }
    const sql = `ALTER TABLE ${q(table)} ${clauses.join(', ')}`;
    const [result] = await conn.query(sql);
    return { ok: true, table, sql, clauses, warningStatus: Number((result && result.warningStatus) || 0) };
  });
}

module.exports = {
  connectionsOf, test, listDatabases, listTables, describe, selectRows,
  runSql, insertRow, updateRow, deleteRow, createTable, dropTable, renameTable,
  splitSql, normalizeCell,
  tableDdl, exportData, importSql, alterTable, listUsers, userAction, createDatabase, dropDatabase, serverInfo,
};
