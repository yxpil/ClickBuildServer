'use strict';

const { normalizeRegistry } = require('./metamodel');

// 元模型 -> ClickBuild 工程 JSON。反向工程或外部 DSL 导入时，先得到 registry，
// 再由这里落成现有 UI 能打开的 interfaces[].tables 结构；不直接改 UI 代码。

function tableFromEntity(entity) {
  return {
    key: entity.name,
    name: entity.name,
    schema: entity.schema || '',
    conn: 'main',
    comment: entity.comment || '',
    store: { mode: (entity.options && entity.options.store) || 'mysql', ttl: 0, max: 10000, flushMs: 5000 },
    fields: entity.fields.map((f) => ({
      name: f.name,
      type: f.type,
      comment: f.comment || '',
      pk: !!f.primaryKey,
      autoIncrement: !!f.autoIncrement,
      nullable: !!f.nullable,
      search: !!f.searchable,
      hidden: !!f.hidden,
      query: f.queryable !== false,
      writable: f.writable !== false,
      default: f.default == null ? '' : String(f.default),
    })),
    indexes: (entity.indexes || []).map((x) => ({ name: x.name, unique: !!x.unique, columns: [...x.columns] })),
    relations: (entity.relations || []).map((r) => ({ ...r })),
  };
}

function projectFromRegistry(registry, opts) {
  const reg = normalizeRegistry(registry);
  const o = opts || {};
  const categories = [];
  const catMap = new Map();
  for (const entity of reg.entities) {
    const module = entity.module || 'imported';
    if (!catMap.has(module)) {
      const cat = { id: module.replace(/[^A-Za-z0-9_-]/g, '') || `cat${categories.length + 1}`, name: module === 'imported' ? '导入表' : module };
      catMap.set(module, cat);
      categories.push(cat);
    }
  }
  if (!categories.length) categories.push({ id: 'imported', name: '导入表' });

  const interfaces = reg.entities.map((entity) => {
    const cat = catMap.get(entity.module || 'imported') || categories[0];
    const iface = {
      id: entity.name,
      name: entity.label || entity.name,
      comment: entity.comment || '',
      categoryId: cat.id,
      basePath: `/api/${entity.name}`,
      tables: [tableFromEntity(entity)],
      routes: [],
      storage: { enabled: true, bucket: 'clickbuild', bindField: 'file_key' },
      objects: { enabled: false, bucket: 'clickbuild', prefix: '', pageSize: 20 },
      page: { size: 20 },
      docs: { summary: entity.comment || entity.name, description: '', owner: '', version: '1.0.0', tags: ['导入'], requestExample: '', responseExample: '', notes: '' },
    };
    // 反向工程默认给一套 CRUD 路由；docs 先放空对象，交给 normalizeRoute 补齐，
    // 否则 spec 的默认路由没有 docs，normalize 时会报 route.docs 未定义。
    try {
      const spec = require('../iface/spec');
      iface.routes = ['list', 'detail', 'create', 'update', 'delete']
        .map((k) => ({ ...spec.newRoute(k, iface), docs: {} }));
    } catch (err) {
      iface.routes = [];
    }
    return iface;
  });

  return {
    name: o.name || reg.name || '反向工程工程',
    description: o.description || '由数据库元数据反向生成',
    categories,
    functions: [],
    interfaces,
    enums: reg.enums,
    rules: reg.rules,
    schemaVersion: reg.version,
    sources: reg.entities.map((e) => ({ entity: e.name, source: e.source })).filter((x) => x.source),
  };
}

module.exports = { projectFromRegistry, tableFromEntity };
