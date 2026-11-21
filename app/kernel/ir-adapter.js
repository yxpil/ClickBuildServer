// 作者：yxpil
'use strict';

const { normalizeRegistry } = require('./metamodel');

// 旧生成器 IR（app/generator/ir.js 的 tables）→ 通用元模型。
// 这是过渡适配器：主生成链路切换完成后可以删掉，但迁移期间它让方言/迁移器
// 能直接吃现有 IR，而不用改 26 套案例和 UI。

function parseType(raw) {
  const s = String(raw || 'varchar(255)').trim().toLowerCase();
  const m = /^([a-z]+)(?:\((\d+)(?:,(\d+))?\))?/.exec(s);
  const base = m ? m[1] : 'varchar';
  const a = m && m[2] ? Number(m[2]) : undefined;
  const b = m && m[3] ? Number(m[3]) : undefined;
  const map = {
    bigint: 'bigint', int: 'int', integer: 'int', mediumint: 'int', smallint: 'smallint', tinyint: 'tinyint',
    bool: 'bool', boolean: 'bool', decimal: 'decimal', numeric: 'decimal', float: 'float', double: 'double',
    varchar: 'varchar', char: 'char', text: 'text', tinytext: 'text', mediumtext: 'longtext', longtext: 'longtext',
    datetime: 'datetime', timestamp: 'datetime', date: 'date', time: 'time', json: 'json', jsonb: 'json',
  };
  const type = map[base] || 'varchar';
  const out = { type };
  if (type === 'varchar' || type === 'char') out.length = a || (type === 'char' ? 32 : 255);
  if (type === 'decimal') { out.precision = a || 18; out.scale = b == null ? 2 : b; }
  return out;
}

const textType = (type) => ['varchar', 'char', 'text', 'longtext', 'json'].includes(type);

function defaultFor(name, type, required) {
  if (name === 'created_at' && type === 'datetime') return 'CURRENT_TIMESTAMP';
  if (name === 'updated_at' && type === 'datetime') return 'CURRENT_TIMESTAMP';
  if (type === 'date' && required) return '1970-01-01';
  if (textType(type) && required) return '';
  if (['bigint', 'int', 'smallint', 'tinyint', 'bool'].includes(type) && required) return '0';
  if (['decimal', 'float', 'double'].includes(type) && required) return '0';
  return null;
}

function columnToField(c, idStrategy) {
  const t = parseType(c.type);
  const name = c.name;
  const auto = !!c.auto || (name === 'id' && idStrategy === 'auto');
  return {
    name,
    type: t.type,
    length: t.length,
    precision: t.precision,
    scale: t.scale,
    nullable: c.required === false || (!c.required && !c.pk),
    primaryKey: !!c.pk,
    autoIncrement: auto,
    unique: !!c.unique,
    default: c.pk ? null : defaultFor(name, t.type, !!c.required),
    onUpdate: name === 'updated_at' && t.type === 'datetime' ? 'CURRENT_TIMESTAMP' : '',
    comment: c.comment || '',
    searchable: !!c.searchable,
  };
}

function entityFromIrTable(table, idStrategy) {
  const fields = (table.columns || []).map((c) => columnToField(c, idStrategy));
  const pks = fields.filter((f) => f.primaryKey).map((f) => f.name);
  const indexes = [];
  const seen = new Set();
  const addIndex = (name, columns, unique) => {
    const key = `${unique ? 'u' : 'n'}:${columns.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    indexes.push({ name: name || `idx_${table.name}_${columns.join('_')}`, columns, unique: !!unique });
  };
  for (const idx of table.indexes || []) {
    const cols = (idx.columns || []).map(String).filter(Boolean);
    if (cols.length) addIndex(idx.name, cols, idx.unique);
  }
  for (const f of fields) {
    if (f.primaryKey || f.unique) continue;
    if (f.indexed || (table.search || []).includes(f.name)) addIndex(`idx_${table.name}_${f.name}`, [f.name], false);
  }
  return {
    id: `${table.moduleId || 'module'}:${table.name}`,
    name: table.name,
    label: table.comment || table.name,
    comment: table.comment || '',
    module: table.moduleId || '',
    primaryKey: pks[0] || '',
    primaryKeys: pks,
    fields,
    indexes,
    relations: [],
    options: { engine: '' },
    source: { kind: 'generator-ir', moduleId: table.moduleId, table: table.name },
  };
}

function registryFromIr(ir) {
  const tables = (ir && ir.tables) || [];
  return normalizeRegistry({
    version: 1,
    name: (ir && ir.project && ir.project.name) || '',
    entities: tables.map((t) => entityFromIrTable(t, ir.project && ir.project.idStrategy)),
  });
}

module.exports = { parseType, columnToField, entityFromIrTable, registryFromIr };
