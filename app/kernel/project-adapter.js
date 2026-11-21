// 作者：yxpil
'use strict';

const { normalizeRegistry } = require('./metamodel');

// ClickBuild 工程 JSON -> 通用元模型。这个方向只负责“翻译”，不决定字段怎么落库。
// 反向工程（数据库 -> 元模型）以后从另一个 adapter 进来，最终都汇到同一个 registry。

function fieldFromTable(f, i) {
  const def = f.default == null || String(f.default).trim() === ''
    ? (f.type === 'datetime' && (f.name === 'created_at' || f.name === 'updated_at') ? 'CURRENT_TIMESTAMP' : null)
    : f.default;
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    nullable: f.nullable !== false,
    primaryKey: !!f.pk,
    autoIncrement: !!f.autoIncrement,
    unique: !!f.unique,
    indexed: !!f.indexed,
    default: def,
    onUpdate: f.type === 'datetime' && f.name === 'updated_at' ? 'CURRENT_TIMESTAMP' : '',
    comment: f.comment || '',
    hidden: !!f.hidden,
    writable: f.writable !== false,
    queryable: f.query !== false,
    searchable: !!f.search,
    enumRef: f.enumRef || f.enum || '',
  };
}

function entityFromTable(iface, table) {
  const fields = (table.fields || []).map(fieldFromTable);
  const pks = fields.filter((f) => f.primaryKey).map((f) => f.name);
  return {
    id: `${iface.id}:${table.key || table.name}`,
    name: table.name,
    label: table.comment || table.name,
    comment: table.comment || '',
    module: iface.categoryId || '',
    schema: table.schema || '',
    primaryKey: pks[0] || '',
    primaryKeys: pks,
    fields,
    indexes: Array.isArray(table.indexes) ? table.indexes : [],
    relations: Array.isArray(table.relations) ? table.relations : [],
    options: {
      engine: '',
      store: (table.store && table.store.mode) || 'mysql',
      ifaceId: iface.id,
      ifaceName: iface.name,
      tableKey: table.key,
    },
    source: {
      kind: 'clickbuild',
      ifaceId: iface.id,
      ifaceName: iface.name,
      tableKey: table.key,
      store: (table.store && table.store.mode) || 'mysql',
    },
  };
}

function registryFromProject(project, opts) {
  const p = project && typeof project === 'object' ? project : {};
  const entities = [];
  const byName = new Map();
  const warnings = [];
  for (const iface of Array.isArray(p.interfaces) ? p.interfaces : []) {
    for (const table of Array.isArray(iface.tables) ? iface.tables : []) {
      const entity = entityFromTable(iface, table);
      const existing = byName.get(entity.name);
      if (!existing) {
        byName.set(entity.name, entity);
        entities.push(entity);
        continue;
      }
      // 现有工程里同一张物理表可能被多个接口复用；元模型按表名合并，
      // 但把冲突记进 importWarnings，避免“悄悄合并”掩盖字段歧义。
      const seen = new Map(existing.fields.map((f) => [f.name, f]));
      for (const f of entity.fields) {
        const old = seen.get(f.name);
        if (!old) { existing.fields.push(f); continue; }
        const delta = ['type', 'nullable', 'primaryKey', 'autoIncrement', 'default', 'comment']
          .filter((k) => String(old[k] == null ? '' : old[k]) !== String(f[k] == null ? '' : f[k]));
        if (delta.length) warnings.push(`表 ${entity.name} 在 ${iface.name} 与其它接口字段 ${f.name} 不一致：${delta.join(', ')}（保留第一处）`);
      }
      for (const idx of entity.indexes) {
        if (!(existing.indexes || []).some((x) => x.name === idx.name)) existing.indexes.push(idx);
      }
      for (const r of entity.relations) {
        if (!(existing.relations || []).some((x) => x.id === r.id || x.name === r.name)) existing.relations.push(r);
      }
      existing.source.alsoFrom = [...(existing.source.alsoFrom || []), { ifaceId: iface.id, ifaceName: iface.name, tableKey: table.key }];
      warnings.push(`表 ${entity.name} 在 ${iface.name} 重复定义，已按物理表名合并`);
    }
  }
  const enums = p.enums || (p.meta && p.meta.enums) || [];
  const rules = p.rules || (p.meta && p.meta.rules) || [];
  return normalizeRegistry({
    version: (opts && opts.version) || Number(p.schemaVersion) || 1,
    name: p.name || '',
    entities,
    enums,
    rules,
    options: {
      ...(opts && opts.options || {}),
      projectId: p.id || '',
      projectName: p.name || '',
      importWarnings: warnings,
    },
  });
}

// 给“以后要接 UI 的枚举/规则编辑器”留一个无损回写口：
// 目前只回写元模型里新增的 enums/rules，不触碰 interfaces 里的表。
function applyMetaToProject(project, registry) {
  const p = project && typeof project === 'object' ? project : {};
  const reg = normalizeRegistry(registry);
  return {
    ...p,
    schemaVersion: reg.version,
    enums: reg.enums,
    rules: reg.rules,
  };
}

module.exports = { registryFromProject, entityFromTable, applyMetaToProject };
