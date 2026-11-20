'use strict';

/**
 * 语言版服务（Go / Java）共用的项目快照。
 * 这里的结构只保留运行时必需字段，避免把编辑器里的临时状态带进生成物。
 */
const fs = require('fs');
const path = require('path');
const script = require('./script');
const spec = require('./spec');

function fieldMeta(f) {
  return {
    name: String(f.name || ''),
    type: String(f.type || 'varchar'),
    pk: !!f.pk,
    auto: !!f.autoIncrement,
    hidden: !!f.hidden,
    query: f.query !== false,
    writable: f.writable !== false && !f.pk && !f.autoIncrement,
    search: !!f.search,
    default: f.default == null ? '' : f.default,
    comment: String(f.comment || ''),
  };
}

function tableMeta(t, index) {
  return {
    key: String(t.key || (index === 0 ? 'main' : `t${index}`)),
    name: String(t.name || ''),
    schema: String(t.schema || ''),
    comment: String(t.comment || t.name || ''),
    store: t.store || { mode: 'mysql', ttl: 0, max: 10000, flushMs: 5000 },
    fields: (t.fields || []).map(fieldMeta),
  };
}

function routeMeta(r) {
  const parsed = script.parseScript(r.script || '');
  return {
    id: String(r.id || ''),
    key: String(r.key || 'custom'),
    name: String(r.name || ''),
    method: String(r.method || 'GET').toUpperCase(),
    path: String(r.path || '/'),
    auth: !!r.auth,
    roles: Array.isArray(r.roles) ? r.roles.map(String) : [],
    proxy: r.proxy || null,
    tx: !!(r.guard && r.guard.tx),
    cache: { enabled: !!(r.cache && r.cache.enabled), ttl: Number((r.cache && r.cache.ttl) || 60) },
    script: String(r.script || ''),
    ast: parsed.ast,
    parseErrors: parsed.errors.map(String),
  };
}

function serviceSnapshot(project) {
  const p = spec.normalizeProject(project);
  return {
    format: 'clickbuild-native',
    version: 1,
    name: p.name,
    apiPrefix: '/api',
    page: p.page || { size: 20 },
    storage: p.storage || {},
    functions: (p.functions || []).map((f) => {
      let ast = null;
      try {
        ast = script.parseExpr(String(f.body || ''));
      } catch (e) {
        ast = null;
      }
      return { name: String(f.name || ''), params: (f.params || []).map(String), ast };
    }),
    interfaces: (p.interfaces || []).map((it) => ({
      id: String(it.id || ''),
      name: String(it.name || ''),
      comment: String(it.comment || ''),
      basePath: String(it.basePath || ''),
      objects: it.objects || { enabled: false },
      tables: (it.tables || []).map(tableMeta),
      routes: (it.routes || []).map(routeMeta),
    })),
    upstreams: p.upstreams || [],
    permissions: p.permissions || {},
    generatedAt: new Date().toISOString(),
  };
}

function runtimeFiles(lang) {
  const dir = path.join(__dirname, 'runtime', lang);
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const walk = (sub) => {
    for (const name of fs.readdirSync(path.join(dir, sub))) {
      const full = path.join(dir, sub, name);
      if (fs.statSync(full).isDirectory()) walk(path.join(sub, name));
      else if (!/\.(jar|class|exe)$/i.test(name)) files.push({ path: path.join(sub, name).replace(/\\/g, '/'), content: fs.readFileSync(full, 'utf8') });
    }
  };
  walk('.');
  return files;
}

/** 二进制依赖（Java 的 JDBC / Gson / BouncyCastle），单独拷贝，不能按文本读。 */
function assetFiles(lang) {
  const dir = path.join(__dirname, 'runtime', lang);
  if (!fs.existsSync(dir)) return [];
  const assets = [];
  const walk = (sub) => {
    for (const name of fs.readdirSync(path.join(dir, sub))) {
      const full = path.join(dir, sub, name);
      const rel = path.join(sub, name).replace(/\\/g, '/');
      if (fs.statSync(full).isDirectory()) walk(rel);
      else if (/\.jar$/i.test(name)) assets.push({ path: rel, data: fs.readFileSync(full) });
    }
  };
  walk('lib');
  return assets;
}

function copyAssets(lang, outDir) {
  for (const a of assetFiles(lang)) {
    const full = path.join(outDir, 'native', lang, a.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, a.data);
  }
}

module.exports = { serviceSnapshot, runtimeFiles, assetFiles, copyAssets, fieldMeta, tableMeta, routeMeta };
