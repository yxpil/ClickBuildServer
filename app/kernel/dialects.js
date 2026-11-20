'use strict';

// SQL 方言层：元模型只给逻辑类型，这里负责标识符、物理类型、默认值、自增和 ALTER。
// 新增 SQL Server / Oracle 时只加一个 dialect，不再改生成器和迁移器。

const INTEGER = new Set(['bigint', 'int', 'smallint', 'tinyint', 'bool']);
const TEXTUAL = new Set(['varchar', 'char', 'text', 'longtext', 'token', 'url', 'file', 'image', 'video', 'audio', 'pdf', 'doc', 'excel', 'archive']);
const SEMANTIC_LENGTH = { token: 1024, url: 1024, file: 512, image: 512, video: 512, audio: 512, pdf: 512, doc: 512, excel: 512, archive: 512 };

const esc = (s) => String(s == null ? '' : s).replace(/'/g, "''");
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
};

function literalDefault(field) {
  const v = field.default;
  if (v == null) return null;
  const text = String(v).trim();
  if (!text) {
    return TEXTUAL.has(field.type) ? "''" : null;
  }
  if (/^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL|TRUE|FALSE)$/i.test(text)) return text.toUpperCase();
  if (/^[-+]?\d+(\.\d+)?$/.test(text)) return text;
  if (/^(NOW\(\)|CURRENT_TIMESTAMP\(\))$/i.test(text)) return 'CURRENT_TIMESTAMP';
  return `'${esc(text)}'`;
}

function baseDialect(spec) {
  const d = { ...spec };
  d.typeSql = d.typeSql || ((f) => f.type);
  d.defaultSql = literalDefault;
  d.columnDefinition = function columnDefinition(entity, field, opts) {
    const o = opts || {};
    const parts = [d.quote(field.name), d.typeSql(field)];
    if (field.autoIncrement) parts.push(d.autoIncrementSql(field, entity));
    parts.push(field.nullable ? 'NULL' : 'NOT NULL');
    const def = d.defaultSql(field);
    if (def != null && !field.autoIncrement) parts.push(`DEFAULT ${def}`);
    if (d.id === 'mysql' && field.onUpdate) parts.push(`ON UPDATE ${field.onUpdate}`);
    if (d.inlineComment && field.comment) parts.push(`COMMENT '${esc(field.comment)}'`);
    if (d.unsigned && field.type === 'bigint') parts[1] = 'BIGINT';
    return parts.join(' ');
  };
  d.createTable = function createTable(entity, opts) {
    const o = opts || {};
    const name = o.name || entity.name;
    const columns = entity.fields.map((f) => `  ${d.columnDefinition(entity, f, o)}`);
    const pkFields = entity.fields.filter((f) => f.primaryKey);
    if (pkFields.length && !(d.id === 'sqlite' && pkFields.length === 1 && pkFields[0].autoIncrement)) {
      columns.push(`  PRIMARY KEY (${pkFields.map((f) => d.quote(f.name)).join(', ')})`);
    }
    for (const f of entity.fields) {
      if (f.unique && !f.primaryKey) columns.push(`  UNIQUE (${d.quote(f.name)})`);
    }
    const table = [`CREATE TABLE ${o.ifNotExists ? 'IF NOT EXISTS ' : ''}${d.tableName(name, entity, o)} (`];
    table.push(columns.join(',\n'));
    table.push(`)${d.tableOptions(entity, o)}`);
    const out = [table.join('\n')];
    if (d.comments && !o.skipComments) out.push(...d.comments(entity, name));
    return out;
  };
  d.tableName = (name, entity, opts) => {
    const schema = (opts && opts.schema) || (entity && entity.schema);
    // SQLite 没有 schema 概念，工程里的 MySQL 库名不能当 attached database 用。
    if (d.id === 'sqlite') return d.quote(name);
    return schema ? `${d.quote(schema)}.${d.quote(name)}` : d.quote(name);
  };
  d.dropTable = (name, opts) => `DROP TABLE ${opts && opts.ifExists ? 'IF EXISTS ' : ''}${d.tableName(name, opts && opts.entity, opts)};`;
  d.renameTable = (from, to) => (d.id === 'mysql'
    ? `RENAME TABLE ${d.quote(from)} TO ${d.quote(to)};`
    : `ALTER TABLE ${d.quote(from)} RENAME TO ${d.quote(to)};`);
  d.addColumn = (entity, field) => `ALTER TABLE ${d.tableName(entity.name, entity)} ADD COLUMN ${d.columnDefinition(entity, field)};`;
  d.dropColumn = (entity, fieldName) => `ALTER TABLE ${d.tableName(entity.name, entity)} DROP COLUMN ${d.quote(fieldName)};`;
  d.renameColumn = (entity, from, to) => (d.id === 'mysql'
    ? `ALTER TABLE ${d.tableName(entity.name, entity)} RENAME COLUMN ${d.quote(from)} TO ${d.quote(to)};`
    : `ALTER TABLE ${d.quote(entity.name)} RENAME COLUMN ${d.quote(from)} TO ${d.quote(to)};`);
  d.alterColumn = function alterColumn(oldEntity, newEntity, oldField, newField) {
    if (d.id === 'mysql') {
      return [`ALTER TABLE ${d.tableName(newEntity.name, newEntity)} MODIFY COLUMN ${d.columnDefinition(newEntity, newField)};`];
    }
    if (d.id === 'postgres') {
      const out = [];
      out.push(`ALTER TABLE ${d.tableName(newEntity.name, newEntity)} ALTER COLUMN ${d.quote(newField.name)} DROP DEFAULT;`);
      out.push(`ALTER TABLE ${d.tableName(newEntity.name, newEntity)} ALTER COLUMN ${d.quote(newField.name)} TYPE ${d.typeSql(newField)} USING ${d.quote(newField.name)}::${d.typeSql(newField)};`);
      const def = d.defaultSql(newField);
      if (def != null) out.push(`ALTER TABLE ${d.tableName(newEntity.name, newEntity)} ALTER COLUMN ${d.quote(newField.name)} SET DEFAULT ${def};`);
      out.push(`ALTER TABLE ${d.tableName(newEntity.name, newEntity)} ALTER COLUMN ${d.quote(newField.name)} ${newField.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`);
      return out;
    }
    if (d.id === 'sqlite') {
      const shared = newEntity.fields.filter((f) => oldEntity.fields.some((x) => x.name === f.name)).map((f) => d.quote(f.name));
      const tmp = `__cb_tmp_${newEntity.name}`;
      const createTmp = d.createTable({ ...newEntity, name: tmp }, { skipComments: true });
      const out = ['PRAGMA foreign_keys=OFF;', ...createTmp];
      if (shared.length) out.push(`INSERT INTO ${d.quote(tmp)} (${shared.join(', ')}) SELECT ${shared.join(', ')} FROM ${d.quote(oldEntity.name)};`);
      out.push(`DROP TABLE ${d.quote(oldEntity.name)};`);
      out.push(`ALTER TABLE ${d.quote(tmp)} RENAME TO ${d.quote(newEntity.name)};`);
      for (const idx of newEntity.indexes || []) out.push(d.createIndex(newEntity, idx));
      out.push('PRAGMA foreign_keys=ON;');
      return out;
    }
    return [];
  };
  d.rebuildTable = function rebuildTable(oldEntity, newEntity) {
    if (d.id !== 'sqlite') return d.alterColumn(oldEntity, newEntity, null, null);
    const shared = newEntity.fields.filter((f) => oldEntity.fields.some((x) => x.name === f.name)).map((f) => d.quote(f.name));
    const tmp = `__cb_tmp_${newEntity.name}`;
    const out = ['PRAGMA foreign_keys=OFF;'];
    out.push(...d.createTable({ ...newEntity, name: tmp }, { skipComments: true }));
    if (shared.length) out.push(`INSERT INTO ${d.quote(tmp)} (${shared.join(', ')}) SELECT ${shared.join(', ')} FROM ${d.quote(oldEntity.name)};`);
    out.push(`DROP TABLE ${d.quote(oldEntity.name)};`);
    out.push(`ALTER TABLE ${d.quote(tmp)} RENAME TO ${d.quote(newEntity.name)};`);
    for (const idx of newEntity.indexes || []) out.push(d.createIndex(newEntity, idx));
    out.push('PRAGMA foreign_keys=ON;');
    return out;
  };
  d.createIndex = (entity, idx) => `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${d.quote(idx.name)} ON ${d.tableName(entity.name, entity)} (${idx.columns.map(d.quote).join(', ')});`;
  d.dropIndex = (entity, idx) => (d.id === 'mysql'
    ? `DROP INDEX ${d.quote(idx.name)} ON ${d.tableName(entity.name, entity)};`
    : `DROP INDEX ${d.quote(idx.name)};`);
  d.createMigrationTable = () => {
    if (d.id === 'mysql') {
      return [
        'CREATE TABLE IF NOT EXISTS `schema_migrations` (',
        '  `version` VARCHAR(64) NOT NULL,',
        '  `name` VARCHAR(255) NOT NULL,',
        '  `checksum` CHAR(64) NOT NULL,',
        '  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
        '  PRIMARY KEY (`version`)',
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;',
      ].join('\n');
    }
    if (d.id === 'postgres') {
      return [
        'CREATE TABLE IF NOT EXISTS "schema_migrations" (',
        '  "version" VARCHAR(64) NOT NULL,',
        '  "name" VARCHAR(255) NOT NULL,',
        '  "checksum" CHAR(64) NOT NULL,',
        '  "applied_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
        '  PRIMARY KEY ("version")',
        ');',
      ].join('\n');
    }
    return [
      'CREATE TABLE IF NOT EXISTS "schema_migrations" (',
      '  "version" TEXT NOT NULL,',
      '  "name" TEXT NOT NULL,',
      '  "checksum" TEXT NOT NULL,',
      '  "applied_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      '  PRIMARY KEY ("version")',
      ');',
    ].join('\n');
  };
  d.migrationInsert = (m) => (d.id === 'mysql'
    ? `INSERT INTO \`schema_migrations\` (\`version\`, \`name\`, \`checksum\`) VALUES ('${esc(m.version)}', '${esc(m.name)}', '${esc(m.checksum)}');`
    : `INSERT INTO ${d.quote('schema_migrations')} (${d.quote('version')}, ${d.quote('name')}, ${d.quote('checksum')}) VALUES ('${esc(m.version)}', '${esc(m.name)}', '${esc(m.checksum)}');`);
  d.migrationDelete = (version) => (d.id === 'mysql'
    ? `DELETE FROM \`schema_migrations\` WHERE \`version\` = '${esc(version)}';`
    : `DELETE FROM ${d.quote('schema_migrations')} WHERE ${d.quote('version')} = '${esc(version)}';`);
  return d;
}

const mysql = baseDialect({
  id: 'mysql',
  label: 'MySQL / MariaDB',
  quote: (s) => '`' + String(s).replace(/`/g, '') + '`',
  inlineComment: true,
  autoIncrementSql: () => 'AUTO_INCREMENT',
  typeSql(field) {
    const t = field.type;
    if (t === 'bool') return 'TINYINT(1)';
    if (t === 'varchar') return `VARCHAR(${field.length || 255})`;
    if (t === 'char') return `CHAR(${field.length || 32})`;
    if (t === 'decimal') return `DECIMAL(${field.precision || 18},${field.scale == null ? 2 : field.scale})`;
    if (t === 'text') return 'TEXT';
    if (t === 'longtext') return 'LONGTEXT';
    if (t === 'datetime') return 'DATETIME';
    if (t === 'json') return 'JSON';
    if (SEMANTIC_LENGTH[t]) return `VARCHAR(${field.length || SEMANTIC_LENGTH[t]})`;
    return t.toUpperCase();
  },
  comments(entity, name) {
    return [];
  },
  tableOptions(entity, opts) {
    const engine = (opts && opts.engine) || entity.options.engine || 'InnoDB';
    return ` ENGINE=${engine} DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci${entity.comment ? ` COMMENT='${esc(entity.comment)}'` : ''};`;
  },
});

const postgres = baseDialect({
  id: 'postgres',
  label: 'PostgreSQL',
  quote: (s) => '"' + String(s).replace(/"/g, '""') + '"',
  autoIncrementSql: () => 'GENERATED BY DEFAULT AS IDENTITY',
  typeSql(field) {
    const t = field.type;
    if (t === 'bool') return 'BOOLEAN';
    if (t === 'tinyint') return 'SMALLINT';
    if (t === 'int' || t === 'smallint') return t === 'int' ? 'INTEGER' : 'SMALLINT';
    if (t === 'decimal') return `NUMERIC(${field.precision || 18},${field.scale == null ? 2 : field.scale})`;
    if (t === 'float') return 'REAL';
    if (t === 'double') return 'DOUBLE PRECISION';
    if (t === 'varchar') return `VARCHAR(${field.length || 255})`;
    if (t === 'char') return `CHAR(${field.length || 32})`;
    if (t === 'longtext' || t === 'json') return t === 'json' ? 'JSONB' : 'TEXT';
    if (t === 'datetime') return 'TIMESTAMP';
    if (t === 'json') return 'JSONB';
    if (SEMANTIC_LENGTH[t]) return `VARCHAR(${field.length || SEMANTIC_LENGTH[t]})`;
    return t.toUpperCase();
  },
  comments(entity, name) {
    const out = [];
    if (entity.comment) out.push(`COMMENT ON TABLE ${this.tableName(name, entity)} IS '${esc(entity.comment)}';`);
    for (const f of entity.fields) {
      if (f.comment) out.push(`COMMENT ON COLUMN ${this.tableName(name, entity)}.${this.quote(f.name)} IS '${esc(f.comment)}';`);
    }
    return out;
  },
  tableOptions() { return ';'; },
});

const sqlite = baseDialect({
  id: 'sqlite',
  label: 'SQLite',
  quote: (s) => '"' + String(s).replace(/"/g, '""') + '"',
  autoIncrementSql: () => 'PRIMARY KEY AUTOINCREMENT',
  typeSql(field) {
    if (INTEGER.has(field.type)) return 'INTEGER';
    if (['decimal', 'float', 'double'].includes(field.type)) return 'REAL';
    return 'TEXT';
  },
  tableOptions() { return ';'; },
  createIndex: function createIndex(entity, idx) {
    return `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${this.quote(idx.name)} ON ${this.tableName(entity.name, entity)} (${idx.columns.map(this.quote).join(', ')});`;
  },
});

const DIALECTS = { mysql, postgres, sqlite };

function dialectOf(name) {
  const key = String(name || 'mysql').toLowerCase();
  const alias = { mariadb: 'mysql', pg: 'postgres', postgresql: 'postgres', sqlite3: 'sqlite' }[key] || key;
  if (!DIALECTS[alias]) throw new Error(`未实现的 SQL 方言：${name}`);
  return DIALECTS[alias];
}

function listDialects() {
  return Object.keys(DIALECTS);
}

module.exports = { DIALECTS, dialectOf, listDialects, literalDefault };
