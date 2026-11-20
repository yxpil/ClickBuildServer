'use strict';

/*
 * 纯表存储引擎（Node 运行时）
 *
 * 适用 store.mode：
 *   redis       —— 表数据只在 AlaSQL 内存表中，每次写入同步 Redis 哈希；重启从 Redis 恢复
 *   lru         —— 表数据只在 AlaSQL 内存表，按 max 行数淘汰最旧行；重启为空
 *   lru-redis   —— 内存表 + 每次写入同步 Redis；重启恢复
 *   periodic    —— 内存表 + 按 flushMs 定期写 Redis；重启恢复最后一次落盘
 *
 * 其余模式（mysql / cache / redis-mysql）仍由 MySQL 承担写入，缓存只做加速。
 * 本引擎对同一接口内的纯表做 SELECT/INSERT/UPDATE/DELETE，支持多纯表 JOIN。
 * 纯表与 MySQL 表混用会明确报错，避免读到不完整的数据。
 */

const alasql = require('alasql');

const PURE_MODES = new Set(['redis', 'lru', 'lru-redis', 'periodic']);
const IDENT = (s) => '`' + String(s).replace(/`/g, '') + '`';

function pureMode(store) {
  const mode = store && store.mode ? String(store.mode) : 'mysql';
  return PURE_MODES.has(mode) ? mode : '';
}

function columnType(field) {
  const t = String((field && field.type) || 'string').toLowerCase();
  if (['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint'].includes(t)) return 'INT';
  if (['decimal', 'numeric', 'float', 'double', 'real'].includes(t)) return 'NUMBER';
  if (['bool', 'boolean'].includes(t)) return 'BOOLEAN';
  return 'STRING';
}

function normalizeSql(sql) {
  let s = String(sql || '');
  // 去掉库名限定：`blog`.`post` -> `post`
  s = s.replace(/`[^`]+`\s*\.\s*`([^`]+)`/g, '`$1`');
  // AlaSQL 把 total 当保留字；查询别名统一改写，返回后再还原
  s = s.replace(/\bAS\s+`?total`?\b/gi, 'AS row_count');
  return s;
}

function restoreAliases(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    if (!r || typeof r !== 'object' || !Object.prototype.hasOwnProperty.call(r, 'row_count')) return r;
    const out = { ...r, total: r.row_count };
    delete out.row_count;
    return out;
  });
}

function isNumericType(t) {
  return ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint', 'decimal', 'numeric', 'float', 'double', 'real']
    .includes(String(t || '').toLowerCase());
}

function fieldTypes(interfaces) {
  const map = new Map();
  for (const iface of interfaces) {
    for (const t of iface.tables || []) {
      for (const f of t.fields || []) {
        if (!map.has(f.name)) map.set(f.name, f.type);
      }
    }
  }
  return map;
}

function coerceParams(sql, params, types) {
  const out = (params || []).slice();
  if (!out.length) return out;
  const s = String(sql || '');
  const numericFields = new Set();
  for (const [name, type] of types) if (isNumericType(type)) numericFields.add(name);
  const cast = (idx) => {
    if (idx == null || idx < 0 || idx >= out.length) return;
    const v = out[idx];
    if (v == null || typeof v === 'number') return;
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (Number.isFinite(n)) out[idx] = n;
  };
  const countQ = (pos) => (s.slice(0, pos).match(/\?/g) || []).length;
  const clean = (x) => String(x || '').replace(/`/g, '').split('.').pop().trim();

  // INSERT INTO t (a,b) VALUES (?,?)
  const ins = s.match(/INSERT\s+INTO\s+[^\s(]+\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i);
  if (ins) {
    const cols = ins[1].split(',').map(clean);
    let q = 0;
    const valueStart = s.indexOf(ins[2], s.indexOf(ins[0]) + ins[0].indexOf('VALUES'));
    for (let i = 0; i < ins[2].length; i++) {
      if (ins[2][i] !== '?') continue;
      const col = cols[q];
      const pos = valueStart + i;
      if (numericFields.has(col)) cast(countQ(pos));
      q += 1;
    }
  }

  // UPDATE t SET a = ?, b = ?
  const upd = s.match(/UPDATE\s+[^\s]+\s+SET\s+([\s\S]*?)\s+WHERE\s+/i);
  if (upd) {
    const base = s.indexOf(upd[1]);
    const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\?/g;
    let m;
    while ((m = re.exec(upd[1])) !== null) {
      if (numericFields.has(m[1])) cast(countQ(base + m.index));
    }
  }

  // WHERE a = ?, a IN (?, ?)
  const wh = s.match(/WHERE\s+([\s\S]*?)(?=\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|$)/i);
  if (wh) {
    const base = s.indexOf(wh[1]);
    const re = /(?:`?[A-Za-z_][A-Za-z0-9_]*`?\.)?`?([A-Za-z_][A-Za-z0-9_]*)`?\s*(?:=|<>|!=|>=|<=|>|<)\s*\?/g;
    let m;
    while ((m = re.exec(wh[1])) !== null) {
      if (numericFields.has(m[1])) cast(countQ(base + m.index));
    }
    const inRe = /(?:`?[A-Za-z_][A-Za-z0-9_]*`?\.)?`?([A-Za-z_][A-Za-z0-9_]*)`?\s+IN\s*\(([^)]*)\)/gi;
    while ((m = inRe.exec(wh[1])) !== null) {
      if (!numericFields.has(m[1])) continue;
      const innerBase = base + m.index + m[0].indexOf(m[2]);
      for (let i = 0; i < m[2].length; i++) if (m[2][i] === '?') cast(countQ(innerBase + i));
    }
  }
  return out;
}

function create(options) {
  const project = options.project || {};
  const interfaces = options.interfaces || [];
  const getRedis = options.redis || (() => null);
  const db = new alasql.Database('clickbuild_rowstore');
  const meta = new Map(); // table name -> { table, iface, mode, pk, auto, max, ttl, flushMs, seq }
  const dirty = new Set();
  const timers = [];
  let inTx = false;
  let snapshot = null;
  const types = fieldTypes(interfaces);

  function ns() {
    return `icb:table:${project.name || project.id || 'project'}`;
  }

  function keyOf(t) {
    return `${ns()}:${t.name}`;
  }

  function dataOf(t) {
    const m = meta.get(t.name);
    return m ? db.tables[m.table].data : null;
  }

  function nextId(t, m) {
    const data = dataOf(t) || [];
    let max = m.seq || 0;
    for (const row of data) {
      const v = Number(row[m.pk]);
      if (Number.isFinite(v) && v > max) max = v;
    }
    m.seq = max + 1;
    return m.seq;
  }

  async function save(t, force) {
    const m = meta.get(t.name);
    if (!m || !dataOf(t)) return;
    if (m.mode === 'lru') return;
    if (m.mode === 'periodic' && !force) { dirty.add(t.name); return; }
    const client = getRedis();
    if (!client) return;
    const data = dataOf(t);
    const obj = {};
    data.forEach((row, i) => {
      const id = m.pk && row[m.pk] != null ? String(row[m.pk]) : String(i);
      obj[id || String(i)] = JSON.stringify(row);
    });
    const key = keyOf(t);
    try {
      const pipe = client.pipeline();
      pipe.del(key);
      if (Object.keys(obj).length) pipe.hset(key, obj);
      if (m.ttl > 0) pipe.expire(key, m.ttl);
      await pipe.exec();
      if (m.ttl > 0) m.expireAt = Date.now() + m.ttl * 1000;
    } catch (e) {
      console.error(`[rowstore] 写入 Redis 失败 ${key}: ${e.message}`);
    }
  }

  async function load(t) {
    const m = meta.get(t.name);
    const client = getRedis();
    const data = dataOf(t);
    data.length = 0;
    m.expireAt = 0;
    if (!client || m.mode === 'lru') return;
    try {
      const raw = await client.hgetall(keyOf(t));
      if (m.ttl > 0) {
        const pttl = await client.pttl(keyOf(t)).catch(() => -1);
        if (pttl === -2) return;
        if (pttl > 0) m.expireAt = Date.now() + pttl;
      }
      for (const value of Object.values(raw || {})) {
        try { data.push(JSON.parse(value)); } catch (e) { /* 跳过坏行 */ }
      }
    } catch (e) {
      console.error(`[rowstore] 读取 Redis 失败 ${keyOf(t)}: ${e.message}`);
    }
  }

  function dropExpired(t) {
    const m = meta.get(t.name);
    if (!m || !m.ttl || !m.expireAt) return;
    if (Date.now() < m.expireAt) return;
    const data = dataOf(t);
    if (data) data.length = 0;
    m.expireAt = 0;
  }

  async function persistAll() {
    for (const t of tables()) {
      if (dirty.has(t.name)) await save(t, true);
    }
    dirty.clear();
  }

  function tables() {
    const out = [];
    for (const iface of interfaces) {
      for (const t of iface.tables || []) {
        if (meta.has(t.name)) out.push(t);
      }
    }
    return out;
  }

  function referencedTables(sql) {
    const found = [];
    const s = String(sql || '');
    for (const iface of interfaces) {
      for (const t of iface.tables || []) {
        const name = String(t.name || '');
        if (!name) continue;
        const re = new RegExp('(^|[^A-Za-z0-9_])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_])', 'i');
        if (re.test(s)) found.push({ iface, t });
      }
    }
    return found;
  }

  function inspect(sql) {
    const found = referencedTables(sql);
    if (!found.length) return { found: [], pure: [], mixed: null };
    const pure = found.filter((x) => pureMode(x.t.store));
    if (pure.length && pure.length !== found.length) {
      const other = found.find((x) => !pureMode(x.t.store));
      return { found, pure, mixed: other.t.name };
    }
    return { found, pure, mixed: null };
  }

  async function init() {
    for (const iface of interfaces) {
      for (const t of iface.tables || []) {
        const mode = pureMode(t.store);
        if (!mode) continue;
        if (meta.has(t.name)) continue;
        const fields = (t.fields || []).map((f) => `${IDENT(f.name)} ${columnType(f)}`);
        try {
          db.exec(`CREATE TABLE IF NOT EXISTS ${IDENT(t.name)} (${fields.length ? fields.join(',') : '`id` STRING'})`);
        } catch (e) {
          console.error(`[rowstore] 建表失败 ${t.name}: ${e.message}`);
          continue;
        }
        const pkField = (t.fields || []).find((f) => f.pk || (f.name === t.primaryKey));
        const m = {
          table: t.name,
          iface,
          mode,
          pk: pkField ? pkField.name : null,
          auto: !!(pkField && pkField.autoIncrement),
          max: Number(t.store && t.store.max) || 10000,
          ttl: Number(t.store && t.store.ttl) || 0,
          flushMs: Number(t.store && t.store.flushMs) || 5000,
          seq: 0,
          expireAt: 0,
        };
        meta.set(t.name, m);
        dataOf(t).length = 0;
        await load(t);
        for (const row of dataOf(t)) {
          const n = Number(row[m.pk]);
          if (Number.isFinite(n) && n > m.seq) m.seq = n;
        }
        if (mode === 'periodic') {
          dirty.delete(t.name);
          const iv = setInterval(() => {
            if (dirty.has(t.name)) save(t, true).catch((e) => console.error('[rowstore] 定期保存失败', e.message));
          }, Math.max(500, m.flushMs));
          if (iv.unref) iv.unref();
          timers.push(iv);
        }
      }
    }
  }

  async function query(iface, sql, params) {
    const info = inspect(sql);
    if (info.mixed) throw new Error(`表 ${info.mixed} 不是纯表模式，不能和纯表放在同一个查询里；请把两张表改成同一种 store 模式`);
    if (!info.pure.length) return null;
    for (const { t } of info.pure) dropExpired(t);
    const s = normalizeSql(sql);
    const args = coerceParams(sql, params, types);
    let rows;
    try { rows = db.exec(s, args); } catch (e) {
      throw new Error(`纯表 SQL 执行失败：${e.message}（${s}）`);
    }
    if (process.env.ROWSTORE_DEBUG === '1') console.log('[rowstore query]', s, JSON.stringify(args), '=>', JSON.stringify(rows).slice(0, 500));
    return restoreAliases(rows);
  }

  async function exec(iface, sql, params) {
    const info = inspect(sql);
    if (info.mixed) throw new Error(`表 ${info.mixed} 不是纯表模式，不能和纯表放在同一个写入里；请把两张表改成同一种 store 模式`);
    if (!info.pure.length) return null;
    for (const { t } of info.pure) dropExpired(t);
    const before = new Map();
    for (const { t } of info.pure) before.set(t.name, new Set(dataOf(t) || []));
    const s = normalizeSql(sql);
    let result;
    try { result = db.exec(s, coerceParams(sql, params, types)); } catch (e) {
      throw new Error(`纯表 SQL 执行失败：${e.message}（${s}）`);
    }
    if (process.env.ROWSTORE_DEBUG === '1') console.log('[rowstore exec]', s, JSON.stringify(params || []), '=>', JSON.stringify(result));
    let insertId = null;
    for (const { t } of info.pure) {
      const m = meta.get(t.name);
      const data = dataOf(t);
      if (!data) continue;
      const olds = before.get(t.name) || new Set();
      for (const row of data) {
        if (olds.has(row)) continue;
        if (m.pk && m.auto && row[m.pk] == null) row[m.pk] = nextId(t, m);
        if (m.pk && row[m.pk] == null) row[m.pk] = m.auto ? nextId(t, m) : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (insertId == null && m.pk && row[m.pk] != null) insertId = row[m.pk];
      }
      if (m.mode === 'lru' || (m.mode === 'lru-redis')) {
        while (data.length > m.max) data.shift();
      }
      if (!inTx) await save(t); else dirty.add(t.name);
    }
    return {
      affectedRows: typeof result === 'number' ? result : (Array.isArray(result) ? result.length : 0),
      insertId,
      info: '',
    };
  }

  function begin() {
    if (inTx) return;
    inTx = true;
    snapshot = new Map();
    for (const t of tables()) snapshot.set(t.name, JSON.parse(JSON.stringify(dataOf(t) || [])));
  }

  async function commit() {
    if (!inTx) return;
    inTx = false;
    snapshot = null;
    await persistAll();
  }

  function rollback() {
    if (!inTx) return;
    for (const [name, rows] of snapshot || []) {
      const m = meta.get(name);
      if (!m) continue;
      const data = db.tables[m.table].data;
      data.length = 0;
      for (const row of rows) data.push(row);
    }
    inTx = false;
    snapshot = null;
    dirty.clear();
  }

  return { init, query, exec, begin, commit, rollback, persistAll, inspect, PURE_MODES };
}

module.exports = { create, PURE_MODES };
