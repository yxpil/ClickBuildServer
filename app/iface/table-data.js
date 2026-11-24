// 作者：yxpil
'use strict';

// 表格实时数据：只读查询工程配置的 MariaDB。鉴权仍走生成服务，这里只服务于工作台预览。
const mysql = require('mysql2/promise');
const TYPES = require('mysql2').Types;
const spec = require('./spec');

const MAX_SIZE = 200;
const DEFAULT_SIZE = 20;

function ident(name) {
  return /^[A-Za-z0-9_$]+$/.test(String(name || '')) ? String(name) : '';
}

function safeSize(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(5, Math.min(MAX_SIZE, Math.round(n)));
}

function resolveTarget(project, opts) {
  const p = spec.normalizeProject(project || {});
  const o = opts || {};
  const iface = p.interfaces.find((x) => x.id === o.ifaceId) || p.interfaces[0];
  if (!iface) throw new Error('工程里没有接口，无法查看表数据');
  const table = iface.tables.find((x) => x.key === o.tableKey) || iface.tables[0];
  if (!table) throw new Error('这个接口还没有表');
  const tableName = ident(table.name);
  if (!tableName) throw new Error('表名不合法，只允许字母、数字、下划线和 $');
  const list = (p.connections && p.connections.mysql) || [];
  const conn = list.find((x) => x.key === table.conn) || list.find((x) => x.key === 'main') || list[0];
  if (!conn) throw new Error('工程没有配置 MariaDB 连接');
  const database = ident(table.schema || conn.database || 'clickbuild');
  if (!database) throw new Error('数据库名不合法，只允许字母、数字、下划线和 $');
  const size = safeSize(o.size);
  const rawPage = Number(o.page);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const pk = (table.fields || []).find((f) => f.pk && ident(f.name));
  return {
    project: p,
    iface,
    table,
    conn,
    database,
    size,
    page,
    offset: (page - 1) * size,
    orderBy: pk ? ident(pk.name) : '',
    host: conn.host || '127.0.0.1',
    port: Number(conn.port || 3306),
    user: conn.user || 'root',
  };
}

function typeName(type) {
  const hit = Object.keys(TYPES).find((k) => TYPES[k] === type);
  return hit ? hit.toLowerCase() : String(type || '');
}

function normalizeCell(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) {
    const hex = v.toString('hex');
    return hex.length > 64 ? `0x${hex.slice(0, 64)}… (${v.length} B)` : `0x${hex}`;
  }
  if (typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  return v;
}

function friendlyError(e, target) {
  const code = (e && e.code) || '';
  const base = { ok: false, code, error: (e && e.message) || '查询失败' };
  const at = `${target.host}:${target.port}/${target.database}`;
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') {
    return {
      ...base,
      hint: `连不上 MariaDB ${at}。先点“启动本机 MariaDB”，或检查这个接口表的连接配置。`,
      action: 'start-mysql',
    };
  }
  if (code === 'ER_NO_SUCH_TABLE') {
    return { ...base, hint: `表 ${target.database}.${target.table.name} 还没建。先生成服务并启动一次，让它执行建表 SQL。`, action: 'generate' };
  }
  if (code === 'ER_BAD_DB_ERROR') {
    return { ...base, hint: `数据库 ${target.database} 不存在。先生成服务并启动，或确认连接里的库名。`, action: 'generate' };
  }
  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return { ...base, hint: `账号 ${target.user} 没有访问 ${target.database} 的权限，检查工程连接配置。`, action: '' };
  }
  if (code === 'ENOTFOUND') {
    return { ...base, hint: `解析不到数据库主机 ${target.host}，检查连接配置或网络。`, action: '' };
  }
  return { ...base, hint: e && e.message ? e.message : '查询失败，检查数据库连接。', action: '' };
}

async function readTable(project, opts) {
  let target;
  try {
    target = resolveTarget(project, opts);
  } catch (e) {
    return { ok: false, code: 'TARGET', error: e.message, hint: e.message, action: '' };
  }

  const started = Date.now();
  let conn;
  try {
    conn = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.conn.password || '',
      database: target.database,
      charset: 'utf8mb4',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: 5000,
      multipleStatements: false,
    });

    const qTable = `\`${ident(target.table.name)}\``;
    const [countRows] = await conn.query(`SELECT COUNT(*) AS total FROM ${qTable}`);
    const total = Number((countRows[0] || {}).total || 0);
    const lastPage = Math.max(1, Math.ceil(total / target.size));
    const page = Math.min(target.page, lastPage);
    const offset = (page - 1) * target.size;
    const order = target.orderBy ? ` ORDER BY \`${target.orderBy}\` DESC` : '';
    const [rows, fields] = await conn.query(
      `SELECT * FROM ${qTable}${order} LIMIT ${target.size} OFFSET ${offset}`
    );
    const columns = (fields || []).map((f) => ({ name: f.name, type: typeName(f.type), length: f.columnLength || 0 }));
    return {
      ok: true,
      connection: {
        key: target.table.conn || 'main',
        label: target.conn.label || target.table.conn || 'MariaDB',
        host: target.host,
        port: target.port,
        database: target.database,
        user: target.user,
      },
      ifaceId: target.iface.id,
      ifaceName: target.iface.name,
      tableKey: target.table.key,
      tableName: target.table.name,
      storeMode: (target.table.store && target.table.store.mode) || 'mysql',
      columns,
      rows: (rows || []).map((r) => {
        const out = {};
        for (const k of Object.keys(r)) out[k] = normalizeCell(r[k]);
        return out;
      }),
      total,
      page,
      size: target.size,
      pages: lastPage,
      offset,
      elapsed: Date.now() - started,
      readonly: true,
      queriedAt: new Date().toISOString(),
    };
  } catch (e) {
    return friendlyError(e, target);
  } finally {
    if (conn) { try { await conn.end(); } catch (_) { /* 连接已断 */ } }
  }
}

module.exports = { readTable, resolveTarget, normalizeCell, friendlyError, safeSize, MAX_SIZE };
