'use strict';

// 通用元模型：只描述“业务世界”，不认识 ClickBuild 的接口、路由和脚本。
// 实体 / 字段 / 关联 / 枚举 / 校验规则都进同一份 registry，后续方言、迁移、
// 反向工程和代码渲染器只依赖这里，不再直接读 project.interfaces[].tables。

const LOGICAL_TYPES = [
  'bigint', 'int', 'smallint', 'tinyint', 'bool',
  'decimal', 'float', 'double',
  'varchar', 'char', 'text', 'longtext',
  'datetime', 'date', 'time', 'json',
  'token', 'url', 'file', 'image', 'video', 'audio', 'pdf', 'doc', 'excel', 'archive',
];

const INTEGER_TYPES = new Set(['bigint', 'int', 'smallint', 'tinyint', 'bool']);
const RELATION_KINDS = new Set(['many-to-one', 'one-to-many', 'many-to-many', 'one-to-one']);
const RULE_KINDS = new Set(['required', 'nullable', 'minLength', 'maxLength', 'pattern', 'min', 'max', 'unique', 'enum', 'custom']);
const ON_ACTIONS = new Set(['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION']);

const safe = (s) => String(s == null ? '' : s).trim();
const ident = (s, fallback) => {
  const raw = safe(s).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z_]/.test(raw) ? raw : fallback;
};

function typeDefaults(type) {
  const t = LOGICAL_TYPES.includes(type) ? type : 'varchar';
  if (t === 'varchar') return { type: t, length: 255 };
  if (t === 'char') return { type: t, length: 32 };
  if (t === 'decimal') return { type: t, precision: 18, scale: 2 };
  if (['token', 'url', 'file', 'image', 'video', 'audio', 'pdf', 'doc', 'excel', 'archive'].includes(t)) {
    return { type: t, length: t === 'url' || t === 'token' ? 1024 : 512 };
  }
  return { type: t };
}

function normalizeField(raw, idx, entityName) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const base = typeDefaults(f.type);
  const name = ident(f.name || `field_${idx + 1}`, `field_${idx + 1}`);
  const field = {
    id: safe(f.id) || `${entityName}.${name}`,
    name,
    type: base.type,
    length: Number(f.length || base.length || 0) || undefined,
    precision: Number(f.precision || base.precision || 0) || undefined,
    scale: f.scale != null ? Number(f.scale) : base.scale,
    nullable: f.nullable !== false,
    primaryKey: !!(f.primaryKey || f.pk),
    autoIncrement: !!f.autoIncrement,
    unique: !!f.unique,
    indexed: !!f.indexed,
    default: f.default == null ? null : f.default,
    onUpdate: safe(f.onUpdate || f.autoUpdate),
    comment: safe(f.comment),
    enumRef: safe(f.enumRef || f.enum),
    secret: !!f.secret || ['token', 'password_hash'].includes(name),
    hidden: !!f.hidden,
    writable: f.writable !== false,
    queryable: f.queryable !== false && f.query !== false,
    searchable: !!f.searchable || !!f.search,
    format: safe(f.format),
  };
  if (field.primaryKey) field.nullable = false;
  if (field.autoIncrement) field.nullable = false;
  return field;
}

function normalizeIndex(raw, entityName, idx, fields) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const columns = (Array.isArray(it.columns) ? it.columns : []).map(safe).filter(Boolean);
  if (!columns.length) return null;
  const name = ident(it.name || `idx_${entityName}_${columns.join('_')}`, `idx_${entityName}_${idx + 1}`);
  return {
    id: safe(it.id) || `${entityName}.${name}`,
    name,
    columns,
    unique: !!it.unique,
    comment: safe(it.comment),
  };
}

function normalizeRelation(raw, entityName, idx, entityNames) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = RELATION_KINDS.has(r.kind) ? r.kind : 'many-to-one';
  const target = safe(r.target || r.to);
  const name = safe(r.name) || `${entityName}_${kind}_${target || idx + 1}`;
  return {
    id: safe(r.id) || `${entityName}.${name}`,
    name,
    kind,
    target,
    field: safe(r.field || r.foreignKey || (kind === 'many-to-one' || kind === 'one-to-one' ? `${target}_id` : '')),
    foreignKey: safe(r.foreignKey || r.field || ''),
    targetKey: safe(r.targetKey || r.references || 'id'),
    through: safe(r.through),
    sourceForeignKey: safe(r.sourceForeignKey),
    targetForeignKey: safe(r.targetForeignKey),
    onDelete: ON_ACTIONS.has(String(r.onDelete || '').toUpperCase()) ? String(r.onDelete).toUpperCase() : 'RESTRICT',
    onUpdate: ON_ACTIONS.has(String(r.onUpdate || '').toUpperCase()) ? String(r.onUpdate).toUpperCase() : 'NO ACTION',
    comment: safe(r.comment),
  };
}

function normalizeEntity(raw, idx) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const name = ident(e.name || `entity_${idx + 1}`, `entity_${idx + 1}`);
  const fields = (Array.isArray(e.fields) && e.fields.length ? e.fields : [])
    .map((f, i) => normalizeField(f, i, name));
  let pkList = Array.isArray(e.primaryKeys)
    ? e.primaryKeys.map(safe).filter(Boolean)
    : Array.isArray(e.primaryKey)
      ? e.primaryKey.map(safe).filter(Boolean)
      : [safe(e.primaryKey || e.pk)].filter(Boolean);
  if (!pkList.length) {
    const marked = fields.filter((f) => f.primaryKey).map((f) => f.name);
    if (marked.length) pkList = marked;
    else {
      const idField = fields.find((f) => f.name === 'id');
      if (idField) pkList = ['id'];
    }
  }
  pkList = Array.from(new Set(pkList));
  fields.forEach((f) => { f.primaryKey = pkList.includes(f.name); });
  const indexes = (Array.isArray(e.indexes) ? e.indexes : [])
    .map((x, i) => normalizeIndex(x, name, i, fields))
    .filter(Boolean);
  const relations = (Array.isArray(e.relations) ? e.relations : [])
    .map((r, i) => normalizeRelation(r, name, i));
  return {
    id: safe(e.id) || name,
    name,
    label: safe(e.label || e.title || e.comment || name),
    comment: safe(e.comment),
    module: safe(e.module || e.moduleId),
    category: safe(e.category),
    schema: safe(e.schema),
    primaryKey: pkList[0] || '',
    primaryKeys: pkList,
    fields,
    indexes,
    relations,
    options: {
      engine: safe(e.options && e.options.engine) || safe(e.engine) || '',
      softDelete: !!(e.options && e.options.softDelete) || !!e.softDelete,
      timestamps: !!(e.options && e.options.timestamps),
    },
    source: e.source && typeof e.source === 'object' ? { ...e.source } : null,
  };
}

function normalizeEnum(raw, idx) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const name = ident(e.name || `enum_${idx + 1}`, `enum_${idx + 1}`);
  const values = (Array.isArray(e.values) ? e.values : []).map((v, i) => {
    if (v && typeof v === 'object') {
      return { value: safe(v.value != null ? v.value : v.name != null ? v.name : i + 1), label: safe(v.label || v.text || v.value), color: safe(v.color) };
    }
    return { value: safe(v), label: safe(v), color: '' };
  }).filter((v) => v.value !== '');
  return { name, label: safe(e.label || name), comment: safe(e.comment), values };
}

function normalizeRule(raw, idx) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = RULE_KINDS.has(r.kind) ? r.kind : 'custom';
  return {
    id: safe(r.id) || `rule_${idx + 1}`,
    entity: safe(r.entity || r.table),
    field: safe(r.field || r.column),
    kind,
    value: r.value == null ? null : r.value,
    message: safe(r.message || r.msg),
    severity: r.severity === 'warning' ? 'warning' : 'error',
  };
}

function normalizeRegistry(input) {
  const src = input && typeof input === 'object' ? input : {};
  const entities = (Array.isArray(src.entities) ? src.entities : Object.values(src.entities || {}))
    .map((e, i) => normalizeEntity(e, i));
  let enums = src.enums || [];
  if (!Array.isArray(enums)) enums = Object.entries(enums).map(([name, values]) => ({ name, values }));
  const normalizedEnums = enums.map((e, i) => normalizeEnum(e, i));
  const rules = (Array.isArray(src.rules) ? src.rules : []).map((r, i) => normalizeRule(r, i));
  return {
    version: Number(src.version) || 1,
    name: safe(src.name),
    entities,
    enums: normalizedEnums,
    rules,
    options: src.options && typeof src.options === 'object' ? { ...src.options } : {},
  };
}

function validateRegistry(input) {
  const registry = normalizeRegistry(input);
  const errors = [];
  const warnings = [];
  const entityMap = new Map();
  const enumMap = new Map(registry.enums.map((e) => [e.name, e]));
  for (const e of registry.entities) {
    if (entityMap.has(e.name)) errors.push(`实体重名：${e.name}`);
    entityMap.set(e.name, e);
    if (!e.fields.length) errors.push(`实体 ${e.name} 没有字段`);
    const fieldMap = new Map();
    for (const f of e.fields) {
      if (fieldMap.has(f.name)) errors.push(`实体 ${e.name} 字段重名：${f.name}`);
      fieldMap.set(f.name, f);
      if (f.autoIncrement && (f.primaryKey !== true || !INTEGER_TYPES.has(f.type))) {
        errors.push(`实体 ${e.name}.${f.name}：只有整数主键能自增`);
      }
      if (f.enumRef && !enumMap.has(f.enumRef)) errors.push(`实体 ${e.name}.${f.name} 引用了不存在的枚举 ${f.enumRef}`);
      if (f.enumRef && enumMap.has(f.enumRef) && !['varchar', 'char', 'int', 'smallint', 'tinyint'].includes(f.type)) {
        warnings.push(`实体 ${e.name}.${f.name}：枚举字段建议用 varchar / int`);
      }
    }
    for (const pk of e.primaryKeys || []) {
      if (!fieldMap.has(pk)) errors.push(`实体 ${e.name} 主键不存在：${pk}`);
    }
    if (!(e.primaryKeys || []).length) warnings.push(`实体 ${e.name} 没有主键，迁移时只能整表处理`);
    if ((e.primaryKeys || []).length > 1 && e.fields.some((f) => f.autoIncrement)) {
      errors.push(`实体 ${e.name}：复合主键不能有自增列`);
    }
    for (const idx of e.indexes) {
      if (!idx.columns.length) errors.push(`实体 ${e.name} 索引 ${idx.name} 没有列`);
      for (const col of idx.columns) if (!fieldMap.has(col)) errors.push(`实体 ${e.name} 索引 ${idx.name} 列不存在：${col}`);
    }
    const idxNames = new Set();
    for (const idx of e.indexes) {
      if (idxNames.has(idx.name)) errors.push(`实体 ${e.name} 索引重名：${idx.name}`);
      idxNames.add(idx.name);
    }
    for (const r of e.relations) {
      if (!r.target) errors.push(`实体 ${e.name} 关联 ${r.name} 没有目标实体`);
      else if (!registry.entities.some((x) => x.name === r.target)) errors.push(`实体 ${e.name} 关联 ${r.name} 目标不存在：${r.target}`);
      if ((r.kind === 'many-to-one' || r.kind === 'one-to-one') && r.field && !fieldMap.has(r.field)) {
        errors.push(`实体 ${e.name} 关联 ${r.name} 字段不存在：${r.field}`);
      }
      if (r.kind === 'one-to-many' && r.foreignKey) {
        const target = registry.entities.find((x) => x.name === r.target);
        if (target && !target.fields.some((f) => f.name === r.foreignKey)) {
          errors.push(`实体 ${e.name} 关联 ${r.name}：${r.target} 上没有外键字段 ${r.foreignKey}`);
        }
      }
      if (r.kind === 'many-to-many') {
        if (!r.through) warnings.push(`实体 ${e.name} 关联 ${r.name}：多对多没有 through 表，只保留元数据`);
        else if (!registry.entities.some((x) => x.name === r.through)) errors.push(`实体 ${e.name} 关联 ${r.name} through 表不存在：${r.through}`);
      }
    }
  }
  for (const rule of registry.rules) {
    const e = entityMap.get(rule.entity);
    if (!e) { errors.push(`规则 ${rule.id} 指向不存在的实体：${rule.entity}`); continue; }
    if (rule.field && !e.fields.some((f) => f.name === rule.field)) errors.push(`规则 ${rule.id} 字段不存在：${rule.entity}.${rule.field}`);
    if (rule.kind === 'pattern') {
      try { new RegExp(String(rule.value || '')); } catch (err) { errors.push(`规则 ${rule.id} 正则无效：${rule.value}`); }
    }
  }
  return { ok: errors.length === 0, errors, warnings, registry };
}

function registryFromEntities(entities, extra) {
  return normalizeRegistry({ entities, ...(extra || {}) });
}

function entityByName(registry, name) {
  return (registry.entities || []).find((e) => e.name === name) || null;
}

module.exports = {
  LOGICAL_TYPES,
  INTEGER_TYPES,
  RELATION_KINDS,
  RULE_KINDS,
  typeDefaults,
  normalizeField,
  normalizeEntity,
  normalizeEnum,
  normalizeRule,
  normalizeRegistry,
  validateRegistry,
  registryFromEntities,
  entityByName,
};
