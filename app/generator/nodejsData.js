'use strict';
const N = require('./naming');

/** 生成物里的表结构快照：所有通用引擎都读它 */
function schemaFile(ir) {
  const tables = ir.tables.map((t) => ({
    name: t.name,
    module: t.moduleId,
    dir: t.moduleDir,
    route: t.route,
    engine: t.engine,
    path: t.filePath || t.path || '',
    comment: t.comment,
    search: t.search || [],
    cache: t.cache !== false,
    cacheTtl: t.cacheTtl || 300,
    pk: t.pk || 'id',
    columns: (t.columns || []).map((c) => ({
      name: c.name,
      type: c.type,
      flags: c.flags || [],
      required: !!c.required,
      unique: !!c.unique,
      pk: !!c.pk,
      auto: !!c.auto,
    })),
  }));
  const queries = (ir.queries || []).map((q) => ({
    name: q.name, method: q.method, perm: q.perm, sql: q.sql, params: q.params || [], comment: q.comment || '',
  }));
  return `'use strict';
/** 由 ClickBuildServer 生成：表结构 / 自定义 SQL / 权限 / 角色。请勿手改，改项目 JSON 重新生成。 */
module.exports = ${JSON.stringify({ tables, queries, perms: ir.perms, roles: ir.roles }, null, 2)};
`;
}

function queryFile() {
  return `'use strict';
/**
 * 条件查询解析器（所有 list 接口共用）
 * 支持：
 *   ?keyword=xx                  → 命中表的 search 列（OR LIKE）
 *   ?name=张三&status=1           → 精确匹配
 *   ?price__gte=10&price__lt=99   → 比较：eq ne gt gte lt lte like in between isnull
 *   ?filter={"price":{"gte":10},"status":[1,2]}  → 结构化过滤（与上面等价）
 *   ?sort=created_at:desc,name:asc
 *   ?page=1&pageSize=20           → 分页（pageSize 上限 200）
 * 只接受 schema 中存在的列，列名/排序字段全部白名单化，杜绝注入。
 */
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in', 'between', 'isnull', 'notnull'];

function colMap(table) {
  return new Map(table.columns.map((c) => [c.name, c]));
}

function parseValue(v) {
  if (v == null) return null;
  const s = String(v);
  if (s === 'true') return 1;
  if (s === 'false') return 0;
  return s;
}

function collectConditions(table, query) {
  const cols = colMap(table);
  const out = [];
  const body = query.filter ? safeJson(query.filter) : null;

  for (const [key, value] of Object.entries(query)) {
    if (['keyword', 'sort', 'page', 'pageSize', 'filter'].includes(key)) continue;
    if (cols.has(key)) {
      out.push({ column: key, op: 'eq', value: Array.isArray(value) ? value : [parseValue(value)] });
      continue;
    }
    const m = key.match(/^([a-z0-9_]+)__(eq|ne|gt|gte|lt|lte|like|in|between|isnull|notnull)$/i);
    if (!m || !cols.has(m[1])) continue;
    const op = m[2];
    let v = value;
    if (op === 'in') v = String(value).split(',').map(parseValue);
    else if (op === 'between') {
      const parts = String(value).split(',');
      v = [parseValue(parts[0]), parseValue(parts[1])];
    }
    out.push({ column: m[1], op, value: Array.isArray(v) && op !== 'in' && op !== 'between' ? v : (op === 'in' || op === 'between' ? v : parseValue(value)) });
  }

  if (body && typeof body === 'object') {
    for (const [col, spec] of Object.entries(body)) {
      if (!cols.has(col)) continue;
      if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
        for (const [op, v] of Object.entries(spec)) {
          if (OPS.includes(op)) out.push({ column: col, op, value: v });
        }
      } else if (Array.isArray(spec)) {
        out.push({ column: col, op: 'in', value: spec });
      } else {
        out.push({ column: col, op: 'eq', value: spec });
      }
    }
  }
  return out;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/** 生成 MySQL WHERE 片段 + 参数 */
function toSqlWhere(table, query) {
  const cols = colMap(table);
  const parts = [];
  const params = [];

  if (cols.has('deleted')) {
    parts.push('deleted = 0');
  }

  const conds = collectConditions(table, query);
  for (const c of conds) {
    const col = c.column;
    switch (c.op) {
      case 'eq': parts.push(col + ' = ?'); params.push(normalize(c.value)); break;
      case 'ne': parts.push(col + ' <> ?'); params.push(normalize(c.value)); break;
      case 'gt': parts.push(col + ' > ?'); params.push(normalize(c.value)); break;
      case 'gte': parts.push(col + ' >= ?'); params.push(normalize(c.value)); break;
      case 'lt': parts.push(col + ' < ?'); params.push(normalize(c.value)); break;
      case 'lte': parts.push(col + ' <= ?'); params.push(normalize(c.value)); break;
      case 'like': parts.push(col + ' LIKE ?'); params.push('%' + String(c.value) + '%'); break;
      case 'in': {
        const arr = Array.isArray(c.value) ? c.value : [c.value];
        if (!arr.length) { parts.push('1 = 0'); break; }
        parts.push(col + ' IN (' + arr.map(() => '?').join(',') + ')');
        arr.forEach((v) => params.push(normalize(v)));
        break;
      }
      case 'between': {
        const arr = Array.isArray(c.value) ? c.value : [];
        parts.push(col + ' BETWEEN ? AND ?');
        params.push(normalize(arr[0]), normalize(arr[1]));
        break;
      }
      case 'isnull': parts.push('(' + col + ' IS NULL OR ' + col + " = '')"); break;
      case 'notnull': parts.push(col + ' IS NOT NULL'); break;
      default: break;
    }
  }

  const keyword = String(query.keyword || '').trim();
  if (keyword) {
    const keys = table.search && table.search.length ? table.search : [];
    if (keys.length) {
      parts.push('(' + keys.map((k) => k + ' LIKE ?').join(' OR ') + ')');
      keys.forEach(() => params.push('%' + keyword + '%'));
    }
  }

  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', params };
}

function normalize(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** 排序：只允许 schema 里的列，direction 只允许 asc/desc */
function toSqlOrder(table, query) {
  const cols = colMap(table);
  const raw = String(query.sort || '').trim();
  if (!raw) return 'id DESC';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const out = [];
  for (const p of parts) {
    const [name, dirRaw] = p.split(':');
    const dir = String(dirRaw || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    if (cols.has(name)) out.push(name + ' ' + dir);
  }
  return out.length ? out.join(', ') : 'id DESC';
}

function pagination(query) {
  const page = Math.max(1, Number(query.page || 1));
  const size = Math.min(200, Math.max(1, Number(query.pageSize || query.size || 20)));
  return { page, size, offset: (page - 1) * size };
}

/** 文件表（CSV/JSON/Excel）内存过滤 */
function filterRows(rows, table, query) {
  const conds = collectConditions(table, query);
  const keyword = String(query.keyword || '').trim().toLowerCase();
  const searchCols = table.search || [];
  return rows.filter((row) => {
    for (const c of conds) {
      const v = row[c.column];
      const want = c.value;
      switch (c.op) {
        case 'eq': if (String(v) !== String(want)) return false; break;
        case 'ne': if (String(v) === String(want)) return false; break;
        case 'gt': if (!(Number(v) > Number(want))) return false; break;
        case 'gte': if (!(Number(v) >= Number(want))) return false; break;
        case 'lt': if (!(Number(v) < Number(want))) return false; break;
        case 'lte': if (!(Number(v) <= Number(want))) return false; break;
        case 'like': if (!String(v || '').toLowerCase().includes(String(want).toLowerCase())) return false; break;
        case 'in': if (!(Array.isArray(want) ? want : [want]).some((x) => String(x) === String(v))) return false; break;
        case 'between': if (!(Number(v) >= Number(want[0]) && Number(v) <= Number(want[1]))) return false; break;
        case 'isnull': if (v != null && v !== '') return false; break;
        case 'notnull': if (v == null || v === '') return false; break;
        default: break;
      }
    }
    if (keyword && searchCols.length) {
      return searchCols.some((k) => String(row[k] || '').toLowerCase().includes(keyword));
    }
    return true;
  });
}

function sortRows(rows, table, query) {
  const cols = colMap(table);
  const raw = String(query.sort || '').trim();
  if (!raw) return rows;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const keys = parts.map((p) => p.split(':')).filter(([n]) => cols.has(n)).map(([n, d]) => ({ n, desc: String(d || '').toLowerCase() === 'desc' }));
  if (!keys.length) return rows;
  return rows.slice().sort((a, b) => {
    for (const k of keys) {
      const av = a[k.n];
      const bv = b[k.n];
      const na = Number(av);
      const nb = Number(bv);
      const cmp = (!Number.isNaN(na) && !Number.isNaN(nb)) ? na - nb : String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv));
      if (cmp) return k.desc ? -cmp : cmp;
    }
    return 0;
  });
}

module.exports = { toSqlWhere, toSqlOrder, pagination, filterRows, sortRows, collectConditions, colMap };
`;
}

function crudFile(ir) {
  return `'use strict';
const db = require('./db');
const cache = require('./cache');
const ids = require('./id');
const files = require('./filesource');
const search = require('./search');
const q = require('./query');
const schema = require('./schema');
const cfg = require('./config');

const tableMap = new Map(schema.tables.map((t) => [t.name, t]));

function dbTable(name) {
  return tableMap.has(name) ? tableMap.get(name) : null;
}

function writableCols(table, body, user) {
  const out = {};
  for (const c of table.columns) {
    if (c.pk) continue;
    if (['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted', 'version'].includes(c.name)) continue;
    if (!(c.name in body)) continue;
    out[c.name] = body[c.name];
  }
  if (user) out.created_by = user.userId;
  return out;
}

function cacheKey(table, id) {
  return cfg.app.keyPrefix + ':' + table.name + ':' + id;
}

/* --------------------------- 数据归属（按 ID 控制） --------------------------- */

function isSuper(user) {
  return !user || (user.perms || []).includes('*');
}

/** 非超管只能看/改自己创建的数据，列名来自生成期白名单（table.ownerField）。 */
function ownerWhere(table, user) {
  if (!cfg.app.ownerGuard || !table.ownerField || isSuper(user)) return { sql: '', params: [] };
  return { sql: ' AND ' + table.ownerField + ' = ?', params: [user.userId] };
}

function owned(table, row, user) {
  if (!cfg.app.ownerGuard || !table.ownerField || isSuper(user) || !row) return true;
  return String(row[table.ownerField]) === String(user.userId);
}

async function invalidate(table, id) {
  await cache.del(cacheKey(table, id));
}

/* ------------------------------- MySQL ------------------------------- */

async function mysqlList(table, query, user) {
  const where = q.toSqlWhere(table, query);
  const own = ownerWhere(table, user);
  const order = q.toSqlOrder(table, query);
  const page = q.pagination(query);
  const rows = await db.query(
    'SELECT * FROM ' + table.name + ' WHERE ' + where.sql + own.sql + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?',
    [...where.params, ...own.params, page.size, page.offset],
    { read: true },
  );
  const total = await db.query('SELECT COUNT(1) AS n FROM ' + table.name + ' WHERE ' + where.sql + own.sql, [...where.params, ...own.params], { read: true });
  return { rows, total: Number(total[0].n), page: page.page, pageSize: page.size };
}

async function mysqlDetail(table, id) {
  if (table.cache) {
    return cache.wrap(cacheKey(table, id), table.cacheTtl, async () => {
      const rows = await db.query('SELECT * FROM ' + table.name + ' WHERE ' + table.pk + ' = ? LIMIT 1', [id], { read: true });
      return rows[0] || null;
    });
  }
  const rows = await db.query('SELECT * FROM ' + table.name + ' WHERE ' + table.pk + ' = ? LIMIT 1', [id], { read: true });
  return rows[0] || null;
}

async function mysqlCreate(table, body, user) {
  const cols = writableCols(table, body, user);
  const id = ids.next();
  const hasId = table.columns.some((c) => c.name === table.pk && !c.auto);
  if (hasId) cols[table.pk] = id == null ? body[table.pk] : id;

  const names = Object.keys(cols);
  const marks = names.map(() => '?');
  const params = names.map((n) => cols[n]);
  const extraCols = [];
  const extraVals = [];
  if (table.columns.some((c) => c.name === 'created_at')) { extraCols.push('created_at'); extraVals.push('NOW()'); }
  if (table.columns.some((c) => c.name === 'updated_at')) { extraCols.push('updated_at'); extraVals.push('NOW()'); }
  if (table.columns.some((c) => c.name === 'deleted')) { extraCols.push('deleted'); extraVals.push('0'); }

  const sql = 'INSERT INTO ' + table.name + ' (' + [...names, ...extraCols].join(',') + ') VALUES (' +
    [...marks, ...extraVals].join(',') + ')';
  const r = await db.query(sql, params);
  const newId = hasId ? cols[table.pk] : r.insertId;

  const text = table.search.map((c) => body[c]).filter(Boolean).join(' ');
  if (table.search.length && text) await search.index(table.name, String(newId), text);
  return newId;
}

async function mysqlUpdate(table, id, body, user) {
  if (table.ownerField && !isSuper(user)) {
    const row = await mysqlDetail(table, id);
    if (!owned(table, row, user)) {
      const e = new Error('无权修改他人数据');
      e.status = 403;
      throw e;
    }
  }
  const cols = writableCols(table, body, null);
  const names = Object.keys(cols);
  if (!names.length) return false;
  const sets = names.map((n) => n + ' = ?');
  if (table.columns.some((c) => c.name === 'updated_at')) sets.push('updated_at = NOW()');
  if (user && table.columns.some((c) => c.name === 'updated_by')) sets.push('updated_by = ?');
  const params = names.map((n) => cols[n]);
  if (user && table.columns.some((c) => c.name === 'updated_by')) params.push(user.userId);
  params.push(id);
  await db.query('UPDATE ' + table.name + ' SET ' + sets.join(', ') + ' WHERE ' + table.pk + ' = ?', params);
  await invalidate(table, id);
  const text = table.search.map((c) => body[c]).filter(Boolean).join(' ');
  if (table.search.length && text) await search.index(table.name, String(id), text);
  return true;
}

async function mysqlDelete(table, id, user) {
  if (table.ownerField && !isSuper(user)) {
    const row = await mysqlDetail(table, id);
    if (!owned(table, row, user)) {
      const e = new Error('无权删除他人数据');
      e.status = 403;
      throw e;
    }
  }
  if (table.columns.some((c) => c.name === 'deleted')) {
    await db.query('UPDATE ' + table.name + ' SET deleted = 1 WHERE ' + table.pk + ' = ?', [id]);
  } else {
    await db.query('DELETE FROM ' + table.name + ' WHERE ' + table.pk + ' = ?', [id]);
  }
  await invalidate(table, id);
  return true;
}

/* --------------------- 条件增：批量新增 / 条件更新 / 条件删除 --------------------- */

async function mysqlInsertMany(table, items, user) {
  const list = Array.isArray(items) ? items : [];
  const idsOut = [];
  for (const body of list) idsOut.push(await mysqlCreate(table, body || {}, user));
  return { count: idsOut.length, ids: idsOut };
}

/** 条件更新：where 支持全部条件查询语法，body 为要设置的字段。 */
async function mysqlPatchByWhere(table, query, body, user) {
  const where = q.toSqlWhere(table, query);
  const own = ownerWhere(table, user);
  const cols = writableCols(table, body || {}, null);
  const names = Object.keys(cols);
  if (!names.length) return { matched: 0, changed: 0 };

  const sets = names.map((n) => n + ' = ?');
  if (table.columns.some((c) => c.name === 'updated_at')) sets.push('updated_at = NOW()');
  if (user && table.columns.some((c) => c.name === 'updated_by')) sets.push('updated_by = ?');
  const params = names.map((n) => cols[n]);
  if (user && table.columns.some((c) => c.name === 'updated_by')) params.push(user.userId);

  const matchedRows = await db.query(
    'SELECT ' + table.pk + ' AS id FROM ' + table.name + ' WHERE ' + where.sql + own.sql,
    [...where.params, ...own.params],
    { read: true },
  );
  if (!matchedRows.length) return { matched: 0, changed: 0 };

  const r = await db.query(
    'UPDATE ' + table.name + ' SET ' + sets.join(', ') + ' WHERE ' + where.sql + own.sql,
    [...params, ...where.params, ...own.params],
  );
  for (const row of matchedRows) await invalidate(table, row.id);
  return { matched: matchedRows.length, changed: r.affectedRows || matchedRows.length };
}

/** 条件删除：不带 id，按条件批量删（逻辑删除优先）。 */
async function mysqlDeleteByWhere(table, query, user) {
  const where = q.toSqlWhere(table, query);
  const own = ownerWhere(table, user);
  const matched = await db.query(
    'SELECT ' + table.pk + ' AS id FROM ' + table.name + ' WHERE ' + where.sql + own.sql,
    [...where.params, ...own.params],
    { read: true },
  );
  if (!matched.length) return { matched: 0, deleted: 0 };
  const sql = table.columns.some((c) => c.name === 'deleted')
    ? 'UPDATE ' + table.name + ' SET deleted = 1 WHERE ' + where.sql + own.sql
    : 'DELETE FROM ' + table.name + ' WHERE ' + where.sql + own.sql;
  await db.query(sql, [...where.params, ...own.params]);
  for (const row of matched) await invalidate(table, row.id);
  return { matched: matched.length, deleted: matched.length };
}

/* ---------------------------- 文件数据源 ---------------------------- */

function fileStore(table) {
  return files.load({ name: table.name, engine: table.engine, path: table.path, columns: table.columns });
}

async function fileList(table, query) {
  const store = fileStore(table);
  let rows = q.filterRows(store.rows.map((r) => files.toObject(store, r)), table, query);
  rows = q.sortRows(rows, table, query);
  const page = q.pagination(query);
  return { rows: rows.slice(page.offset, page.offset + page.size), total: rows.length, page: page.page, pageSize: page.size };
}

async function fileDetail(table, id) {
  const store = fileStore(table);
  const row = store.rows.find((r) => String(r[store.header.indexOf(table.pk)]) === String(id));
  return row ? files.toObject(store, row) : null;
}

async function fileCreate(table, body) {
  const store = fileStore(table);
  const id = ids.next() || String(store.rows.length + 1);
  const values = store.header.map((h) => (h === table.pk ? String(id) : (body[h] == null ? '' : body[h])));
  store.rows.push(values);
  files.flush(store);
  return id;
}

async function fileUpdate(table, id, body) {
  const store = fileStore(table);
  const idx = store.header.indexOf(table.pk);
  const row = store.rows.find((r) => String(r[idx]) === String(id));
  if (!row) return false;
  store.header.forEach((h, i) => { if (h !== table.pk && body[h] !== undefined) row[i] = body[h]; });
  files.flush(store);
  return true;
}

async function fileDelete(table, id) {
  const store = fileStore(table);
  const idx = store.header.indexOf(table.pk);
  const before = store.rows.length;
  store.rows = store.rows.filter((r) => String(r[idx]) !== String(id));
  files.flush(store);
  return store.rows.length < before;
}

async function fileInsertMany(table, items) {
  const list = Array.isArray(items) ? items : [];
  const idsOut = [];
  for (const body of list) idsOut.push(await fileCreate(table, body || {}));
  return { count: idsOut.length, ids: idsOut };
}

async function filePatchByWhere(table, query, body) {
  const store = fileStore(table);
  const idx = store.header.indexOf(table.pk);
  const matched = q.filterRows(store.rows.map((r) => files.toObject(store, r)), table, query);
  let changed = 0;
  matched.forEach((obj) => {
    const row = store.rows.find((r) => String(r[idx]) === String(obj[table.pk]));
    if (!row) return;
    store.header.forEach((h, i) => { if (h !== table.pk && body && body[h] !== undefined) row[i] = body[h]; });
    changed++;
  });
  if (changed) files.flush(store);
  return { matched: matched.length, changed };
}

async function fileDeleteByWhere(table, query) {
  const store = fileStore(table);
  const idx = store.header.indexOf(table.pk);
  const matched = q.filterRows(store.rows.map((r) => files.toObject(store, r)), table, query).map((r) => String(r[table.pk]));
  const before = store.rows.length;
  store.rows = store.rows.filter((r) => !matched.includes(String(r[idx])));
  files.flush(store);
  return { matched: matched.length, deleted: before - store.rows.length };
}

/* ------------------------------- 对外 ------------------------------- */

function make(tableName) {
  const table = dbTable(tableName);
  if (!table) throw new Error('未知表：' + tableName);
  const isFile = table.engine !== 'mysql';

  return {
    table,
    async list(query, user) { return isFile ? fileList(table, query) : mysqlList(table, query, user); },
    async detail(id) { return isFile ? fileDetail(table, id) : mysqlDetail(table, id); },
    async create(body, user) { return isFile ? fileCreate(table, body) : mysqlCreate(table, body, user); },
    async update(id, body, user) { return isFile ? fileUpdate(table, id, body) : mysqlUpdate(table, id, body, user); },
    async remove(id, user) { return isFile ? fileDelete(table, id) : mysqlDelete(table, id, user); },
    async insertMany(items, user) { return isFile ? fileInsertMany(table, items) : mysqlInsertMany(table, items, user); },
    async patchWhere(query, body, user) { return isFile ? filePatchByWhere(table, query, body) : mysqlPatchByWhere(table, query, body, user); },
    async removeWhere(query, user) { return isFile ? fileDeleteByWhere(table, query) : mysqlDeleteByWhere(table, query, user); },
  };
}

module.exports = { make, dbTable, tableMap };
`;
}

function customSqlFile(ir) {
  return `'use strict';
const db = require('./db');
const schema = require('./schema');

/** 自定义 SQL：SQL 文本在生成时固化在 schema.queries 里，运行期不接受用户传入的 SQL。 */
function bind(sql, params, source) {
  const names = [];
  let out = '';
  let i = 0;
  let quoted = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') quoted = !quoted;
    if (!quoted && ch === ':' && sql[i + 1] && /[a-zA-Z_]/.test(sql[i + 1]) && sql[i - 1] !== ':') {
      let j = i + 1;
      let name = '';
      while (j < sql.length && /[\\w]/.test(sql[j])) { name += sql[j]; j++; }
      if (name) {
        names.push(name);
        out += '?';
        i = j;
        continue;
      }
    }
    out += ch;
    i++;
  }
  const values = names.map((n) => {
    const v = source[n];
    if (v === undefined) {
      const e = new Error('缺少参数：' + n);
      e.status = 400;
      throw e;
    }
    return v;
  });
  return { sql: out, values, names };
}

async function run(name, source) {
  const item = schema.queries.find((x) => x.name === name);
  if (!item) {
    const e = new Error('未找到查询：' + name);
    e.status = 404;
    throw e;
  }
  const bound = bind(item.sql, item.params, source || {});
  const rows = await db.query(bound.sql, bound.values, { read: item.sql.trim().toUpperCase().startsWith('SELECT') });
  return { query: item.name, rows, sql: bound.sql };
}

function list() {
  return schema.queries.map((q) => ({ name: q.name, method: q.method, perm: q.perm, comment: q.comment }));
}

module.exports = { run, list, bind };
`;
}

module.exports = { schemaFile, queryFile, crudFile, customSqlFile };
