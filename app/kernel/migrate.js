// 作者：yxpil
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeRegistry } = require('./metamodel');
const { dialectOf } = require('./dialects');

const fieldKey = (f) => [
  f.type, f.length || '', f.precision || '', f.scale == null ? '' : f.scale,
  f.nullable ? 'null' : 'notnull', f.autoIncrement ? 'auto' : '', f.unique ? 'unique' : '',
  f.default == null ? '' : String(f.default), f.onUpdate || '', f.comment || '',
].join('|');

function dependencyOrder(entities) {
  const byName = new Map(entities.map((e) => [e.name, e]));
  const visited = new Set();
  const visiting = new Set();
  const out = [];
  const visit = (e) => {
    if (visited.has(e.name)) return;
    if (visiting.has(e.name)) return; // 环由后续 ALTER 外键处理，建表阶段不阻塞
    visiting.add(e.name);
    for (const r of e.relations || []) {
      if (r.kind === 'many-to-one' || r.kind === 'one-to-one') {
        const target = byName.get(r.target);
        if (target) visit(target);
      }
    }
    visiting.delete(e.name);
    visited.add(e.name);
    out.push(e);
  };
  entities.forEach(visit);
  return out;
}

function checksumOf(m) {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: m.version, name: m.name, dialect: m.dialect, fromVersion: m.fromVersion, up: m.up, down: m.down,
  })).digest('hex');
}

function migrationDoc(m) {
  const header = [
    `-- ClickBuild migration ${m.version} · ${m.name}`,
    `-- dialect: ${m.dialect}  from: ${m.fromVersion || 'empty'}  checksum: ${m.checksum}`,
    `-- 自动生成，请勿手改；需要调整时改元模型后重新生成。`,
    '',
  ];
  const up = ['-- >>> UP'];
  up.push(...(m.up.length ? m.up : ['-- 本次没有结构变化。']));
  const down = ['', '-- >>> DOWN'];
  down.push(...(m.down.length ? m.down : ['-- 本次没有可逆操作。']));
  return [...header, ...up, ...down, ''].join('\n');
}

function makeMigration({ version, name, dialect, fromVersion, up, down, warnings }) {
  const m = {
    version: String(version),
    name: String(name || 'schema change'),
    dialect: dialect.id,
    fromVersion: fromVersion == null ? null : String(fromVersion),
    up: up || [],
    down: down || [],
    warnings: warnings || [],
  };
  m.checksum = checksumOf(m);
  m.sql = migrationDoc(m);
  m.changed = m.up.some((s) => !/^--/.test(s.trim()));
  return m;
}

function initMigration(registry, dialectName, opts) {
  const d = typeof dialectName === 'string' ? dialectOf(dialectName) : dialectName;
  const reg = normalizeRegistry(registry);
  const up = [];
  const down = [];
  const warnings = [];
  const ordered = dependencyOrder(reg.entities);
  for (const e of ordered) {
    up.push(...d.createTable(e));
    for (const idx of e.indexes || []) up.push(d.createIndex(e, idx));
  }
  if (reg.options.foreignKeys) {
    for (const e of reg.entities) {
      for (const r of e.relations || []) {
        if (r.kind === 'many-to-one' || r.kind === 'one-to-one') {
          const fk = d.addForeignKey ? d.addForeignKey(e, r) : null;
          if (fk) up.push(fk);
          else if (fk === null) warnings.push(`${d.label} 暂不支持建表后追加外键，${e.name}.${r.name} 只保留元数据`);
        }
      }
    }
  }
  for (const e of [...ordered].reverse()) down.push(d.dropTable(e.name, { ifExists: true, entity: e }));
  return makeMigration({
    version: (opts && opts.version) || '0001',
    name: (opts && opts.name) || 'init schema',
    dialect: d,
    fromVersion: null,
    up,
    down,
    warnings,
  });
}

function compareField(oldEntity, newEntity, oldField, newField, d, up, down) {
  if (fieldKey(oldField) !== fieldKey(newField)) {
    up.push(...d.alterColumn(oldEntity, newEntity, oldField, newField));
    down.push(...d.alterColumn(newEntity, oldEntity, newField, oldField));
  }
}

function compareIndexes(oldEntity, newEntity, d, up, down) {
  const oldMap = new Map((oldEntity.indexes || []).map((x) => [x.name, x]));
  const newMap = new Map((newEntity.indexes || []).map((x) => [x.name, x]));
  for (const [name, idx] of oldMap) {
    if (!newMap.has(name)) {
      up.push(d.dropIndex(oldEntity, idx));
      down.push(d.createIndex(oldEntity, idx));
    }
  }
  for (const [name, idx] of newMap) {
    const old = oldMap.get(name);
    const changed = !old || old.unique !== idx.unique || old.columns.join(',') !== idx.columns.join(',');
    if (changed) {
      if (old) up.push(d.dropIndex(oldEntity, old));
      up.push(d.createIndex(newEntity, idx));
      down.push(d.dropIndex(newEntity, idx));
      if (old) down.push(d.createIndex(oldEntity, old));
    }
  }
  // 字段上的 unique 变化落到列定义里；普通索引变化按名字处理。
}

function indexSignature(entity) {
  return (entity.indexes || []).map((x) => `${x.name}:${x.unique ? 'u' : 'n'}:${x.columns.join(',')}`).sort().join('|');
}

function fieldSignature(entity) {
  return entity.fields.map((f) => `${f.name}:${fieldKey(f)}`).sort().join('\n');
}

function diffMigration(previous, next, dialectName, opts) {
  const d = typeof dialectName === 'string' ? dialectOf(dialectName) : dialectName;
  const oldReg = normalizeRegistry(previous);
  const newReg = normalizeRegistry(next);
  const oldByName = new Map(oldReg.entities.map((e) => [e.name, e]));
  const newByName = new Map(newReg.entities.map((e) => [e.name, e]));
  const oldById = new Map(oldReg.entities.map((e) => [e.id || e.name, e.name]));
  const up = [];
  const down = [];
  const warnings = [];

  for (const old of oldReg.entities) {
    if (!oldByName.has(old.name)) continue;
    const newName = oldById.get(old.id || old.name);
    if (newName && old.name !== newName) {
      const target = newByName.get(newName);
      if (target && !newByName.has(old.name)) {
        up.push(d.renameTable(old.name, newName));
        down.push(d.renameTable(newName, old.name));
      }
    }
  }

  const targets = new Set(newReg.entities.map((e) => e.name));
  for (const old of oldReg.entities) {
    const renamedTo = oldById.get(old.id || old.name);
    if ((renamedTo && targets.has(renamedTo)) || targets.has(old.name)) continue;
    up.push(d.dropTable(old.name, { entity: old }));
    down.push(...d.createTable(old, { ifNotExists: true }));
    warnings.push(`删除表 ${old.name}：UP 会丢数据，DOWN 只能还原空表`);
  }

  for (const nextEntity of newReg.entities) {
    let oldEntity = oldByName.get(nextEntity.name);
    const renamedFrom = oldById.get(nextEntity.id || nextEntity.name);
    if (!oldEntity && renamedFrom && oldByName.has(renamedFrom) && !newByName.has(renamedFrom)) {
      oldEntity = oldByName.get(renamedFrom);
    }
    if (!oldEntity) {
      up.push(...d.createTable(nextEntity, { ifNotExists: true }));
      for (const idx of nextEntity.indexes || []) up.push(d.createIndex(nextEntity, idx));
      down.push(d.dropTable(nextEntity.name, { ifExists: true, entity: nextEntity }));
      continue;
    }
    // 表刚被 RENAME 后，后续 ALTER 必须针对新表名；拷贝一份 old 视图避免
    // SQLite 重建和 DOWN 回滚继续引用旧表名。
    const oldView = oldEntity.name === nextEntity.name ? oldEntity : { ...oldEntity, name: nextEntity.name };

    // SQLite 的 ALTER 能力很窄；任何字段/索引变化都合并成一次表重建，
    // 避免“先改列、后删列”时 DOWN 顺序把列提前删掉。
    if (d.id === 'sqlite' && (fieldSignature(oldView) !== fieldSignature(nextEntity) || indexSignature(oldView) !== indexSignature(nextEntity))) {
      const removed = oldView.fields.filter((f) => !nextEntity.fields.some((x) => x.name === f.name));
      for (const f of removed) warnings.push(`删除字段 ${nextEntity.name}.${f.name}：UP 会丢数据，DOWN 只能还原空列`);
      up.push(...d.rebuildTable(oldView, nextEntity));
      down.push(...d.rebuildTable(nextEntity, oldView));
      continue;
    }

    const oldFields = new Map(oldView.fields.map((f) => [f.name, f]));
    const newFields = new Map(nextEntity.fields.map((f) => [f.name, f]));
    for (const f of nextEntity.fields) {
      if (!oldFields.has(f.name)) {
        up.push(d.addColumn(nextEntity, f));
        down.push(d.dropColumn(nextEntity, f.name));
      }
    }
    for (const f of oldView.fields) {
      if (!newFields.has(f.name)) {
        up.push(d.dropColumn(nextEntity, f.name));
        down.push(d.addColumn(oldView, f));
        warnings.push(`删除字段 ${nextEntity.name}.${f.name}：UP 会丢数据，DOWN 只能还原空列`);
      }
    }
    for (const f of nextEntity.fields) {
      const old = oldFields.get(f.name);
      if (old) compareField(oldView, nextEntity, old, f, d, up, down);
    }
    compareIndexes(oldView, nextEntity, d, up, down);

    if (oldView.comment !== nextEntity.comment && d.id === 'mysql') {
      up.push(`ALTER TABLE ${d.tableName(nextEntity.name, nextEntity)} COMMENT='${String(nextEntity.comment).replace(/'/g, "''")}';`);
      down.push(`ALTER TABLE ${d.tableName(oldView.name, oldView)} COMMENT='${String(oldView.comment).replace(/'/g, "''")}';`);
    }
  }

  if (!up.length) warnings.push('元模型没有产生结构变化。');
  const version = String((opts && opts.version) || inferVersion(previous, next));
  return makeMigration({
    version,
    name: (opts && opts.name) || inferName(previous, next),
    dialect: d,
    fromVersion: (opts && opts.fromVersion) || previous && previous.version,
    up,
    down,
    warnings,
  });
}

function inferVersion(previous, next, explicit) {
  if (explicit) return String(explicit);
  const prev = Number(previous && previous.version) || 0;
  return String(prev + 1).padStart(4, '0');
}

function inferName(previous, next) {
  const oldCount = (previous && previous.entities || []).length;
  const newCount = (next && next.entities || []).length;
  if (!oldCount && newCount) return 'init schema';
  if (newCount > oldCount) return `add ${newCount - oldCount} entities`;
  if (newCount < oldCount) return `drop ${oldCount - newCount} entities`;
  return 'schema change';
}

function migrationPath(m, dir) {
  return path.join(dir, `${m.version}_${String(m.name).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 48)}.sql`);
}

function writeMigration(m, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = migrationPath(m, dir);
  fs.writeFileSync(file, m.sql, 'utf8');
  return file;
}

function ensureMigrationTable(db, d) {
  db.exec(d.createMigrationTable());
}

function appliedVersions(db, d) {
  const rows = db.prepare(`SELECT ${d.quote('version')} AS version FROM ${d.quote('schema_migrations')} ORDER BY ${d.quote('version')}`).all();
  return new Set(rows.map((r) => r.version));
}

function applySqlite(db, m) {
  const d = dialectOf('sqlite');
  ensureMigrationTable(db, d);
  const applied = appliedVersions(db, d);
  if (applied.has(m.version)) return { applied: false, skipped: true };
  db.exec('BEGIN');
  try {
    for (const sql of m.up) db.exec(sql);
    db.exec(d.migrationInsert(m));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { applied: true, skipped: false };
}

function rollbackSqlite(db, m) {
  const d = dialectOf('sqlite');
  ensureMigrationTable(db, d);
  db.exec('BEGIN');
  try {
    for (const sql of m.down) db.exec(sql);
    db.exec(d.migrationDelete(m.version));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return true;
}

async function applyMysql(pool, m) {
  const d = dialectOf('mysql');
  await pool.query(d.createMigrationTable());
  const [rows] = await pool.query('SELECT `version` FROM `schema_migrations` WHERE `version` = ?', [m.version]);
  if (rows.length) return { applied: false, skipped: true };
  const conn = pool.getConnection ? await pool.getConnection() : pool;
  try {
    for (const sql of m.up) await conn.query(sql);
    await conn.query(d.migrationInsert(m));
    return { applied: true, skipped: false };
  } finally {
    if (conn.release) conn.release();
  }
}

module.exports = {
  dependencyOrder,
  initMigration,
  diffMigration,
  makeMigration,
  migrationDoc,
  migrationPath,
  writeMigration,
  applySqlite,
  rollbackSqlite,
  applyMysql,
};
