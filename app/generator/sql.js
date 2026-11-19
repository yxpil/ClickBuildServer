'use strict';

const N = require('./naming');

const q = (s) => '`' + String(s).replace(/`/g, '') + '`';
const esc = (s) => String(s == null ? '' : s).replace(/'/g, "''");

function columnSql(col, idStrategy) {
  let type = col.type;
  if (col.pk) {
    if (idStrategy === 'auto') return `${q(col.name)} BIGINT NOT NULL AUTO_INCREMENT COMMENT '${esc(col.comment)}'`;
    if (type === 'bigint') return `${q(col.name)} BIGINT NOT NULL COMMENT '${esc(col.comment)}'`;
    return `${q(col.name)} ${type.toUpperCase()} NOT NULL COMMENT '${esc(col.comment)}'`;
  }
  let nullable = col.required ? 'NOT NULL' : 'NULL';
  let def = '';
  const lower = type.toLowerCase();
  if (lower.startsWith('varchar') || lower.startsWith('char') || lower === 'text' || lower === 'json') {
    if (col.required && !col.pk) def = " DEFAULT ''";
  } else if (lower === 'datetime') {
    if (col.name === 'created_at') def = ' DEFAULT CURRENT_TIMESTAMP';
    else if (col.name === 'updated_at') def = ' DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP';
    else if (!col.required) def = ' DEFAULT NULL';
    else def = ' DEFAULT CURRENT_TIMESTAMP';
  } else if (lower === 'date') {
    def = col.required ? " DEFAULT '1970-01-01'" : ' DEFAULT NULL';
  } else if (lower.includes('int') || lower === 'tinyint' || lower === 'smallint') {
    def = ' DEFAULT 0';
    if (col.name === 'deleted' || col.name === 'version') nullable = 'NOT NULL';
  } else if (lower.startsWith('decimal') || lower.startsWith('numeric')) {
    def = ' DEFAULT 0.00';
  }
  return `${q(col.name)} ${type.toUpperCase()} ${nullable}${def} COMMENT '${esc(col.comment)}'`;
}

function ddl(table, idStrategy) {
  const cols = table.columns.map((c) => '  ' + columnSql(c, idStrategy));
  const keys = [];
  const pk = table.columns.find((c) => c.pk);
  if (pk) keys.push(`  PRIMARY KEY (${q(pk.name)})`);
  table.columns.filter((c) => c.unique && !c.pk).forEach((c) => {
    keys.push(`  UNIQUE KEY ${q('uk_' + table.name + '_' + c.name)} (${q(c.name)})`);
  });
  const indexed = table.columns.filter((c) => (c.indexed || (table.search.includes(c.name))) && !c.pk && !c.unique);
  indexed.forEach((c) => keys.push(`  KEY ${q('idx_' + table.name + '_' + c.name)} (${q(c.name)})`));
  (table.indexes || []).forEach((idx) => {
    const list = (idx.columns || []).map(q).join(', ');
    if (list) keys.push(`  KEY ${q(idx.name || 'idx_' + table.name + '_' + (idx.columns || []).join('_'))} (${list})`);
  });

  return [
    `-- ------------------------------------------------------------`,
    `-- ${table.name} · ${table.comment}  [${table.moduleId}]`,
    `-- ------------------------------------------------------------`,
    `DROP TABLE IF EXISTS ${q(table.name)};`,
    `CREATE TABLE ${q(table.name)} (`,
    [...cols, ...keys].join(',\n'),
    `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='${esc(table.comment)}';`,
    '',
  ].join('\n');
}

function seedSql(ir) {
  const p = ir.project;
  const lines = [];
  lines.push('-- ============================================================');
  lines.push('-- 初始化数据：权限点 / 角色 / 字典');
  lines.push(`-- 管理员账号由应用启动时自动创建：${p.security.initAdmin} / ${p.security.initPassword}`);
  lines.push('-- ============================================================');
  lines.push('SET NAMES utf8mb4;');
  lines.push('');

  let seq = 900000000000000000n;
  const nextId = () => String(++seq);

  const has = (t) => ir.tables.some((x) => x.name === t);
  if (has('sys_permission')) {
    lines.push('-- 权限点');
    const values = ir.perms.map((perm) => `(${nextId()}, '${esc(perm.code)}', '${esc(perm.name)}', '${esc(perm.moduleId)}', 'api', NOW(), NOW(), 0)`).join(',\n');
    lines.push(`INSERT INTO sys_permission (id, perm_code, perm_name, module_id, kind, created_at, updated_at, deleted) VALUES\n${values};`);
    lines.push('');
  }
  if (has('sys_role')) {
    lines.push('-- 角色');
    const roleValues = ir.roles.map((r) => `(${nextId()}, '${esc(r.code)}', '${esc(r.name)}', ${r.dataScope}, 'seed', NOW(), NOW(), 0)`).join(',\n');
    lines.push(`INSERT INTO sys_role (id, role_code, role_name, data_scope, remark, created_at, updated_at, deleted) VALUES\n${roleValues};`);
    lines.push('');
    if (has('sys_role_permission')) {
      const map = [];
      ir.roles.forEach((r) => {
        r.perms.forEach((code) => {
          map.push(`(${nextId()}, (SELECT id FROM sys_role WHERE role_code='${esc(r.code)}' LIMIT 1), '${esc(code)}', NOW(), NOW(), 0)`);
        });
      });
      if (map.length) {
        lines.push(`INSERT INTO sys_role_permission (id, role_id, perm_code, created_at, updated_at, deleted) VALUES\n${map.join(',\n')};`);
        lines.push('');
      }
    }
  }
  if (has('sys_dict')) {
    lines.push('-- 字典示例');
    lines.push(`INSERT INTO sys_dict (id, dict_code, dict_name, remark, created_at, updated_at, deleted) VALUES (${nextId()}, 'order_status', '订单状态', '内置示例', NOW(), NOW(), 0);`);
    const items = [['1', '待审核'], ['2', '已审核'], ['3', '已发货'], ['4', '已完成'], ['5', '已取消']];
    const iv = items.map(([v, l], i) => `(${nextId()}, 'order_status', '${v}', '${l}', ${i + 1}, 'blue', NOW(), NOW(), 0)`).join(',\n');
    if (has('sys_dict_item')) lines.push(`INSERT INTO sys_dict_item (id, dict_code, item_value, item_label, sort, color, created_at, updated_at, deleted) VALUES\n${iv};`);
    lines.push('');
  }
  if (has('sys_search_index')) {
    const rows = ir.searchTables.map((t) => `(${nextId()}, '${esc(t.name)}', '${esc(t.search.join(','))}', '${p.search.engine === 'elasticsearch' ? 'es' : 'redis'}', 0, NOW(), NOW(), NOW(), 0)`);
    if (rows.length) lines.push(`INSERT INTO sys_search_index (id, table_name, fields, engine, doc_count, rebuild_at, created_at, updated_at, deleted) VALUES\n${rows.join(',\n')};`);
    lines.push('');
  }
  lines.push('COMMIT;');
  return lines.join('\n');
}

function generateSql(ir) {
  const p = ir.project;
  const files = [];

  const header = [
    '-- ============================================================',
    `-- ${p.name} · 数据库初始化脚本`,
    `-- 生成器：ClickBuildServer  |  语言：${p.lang}/${p.packageType}  |  ID 策略：${p.idStrategy}`,
    `-- 生成时间：${new Date().toISOString()}`,
    '-- 说明：先执行 00_database.sql，再按序号执行各模块脚本，最后执行 99_seed.sql',
    '-- ============================================================',
    '',
  ].join('\n');

  files.push({
    path: 'sql/00_database.sql',
    content: `${header}
CREATE DATABASE IF NOT EXISTS \`${p.database.name}\`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE \`${p.database.name}\`;
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
`,
  });

  // 按模块分组
  const byModule = new Map();
  ir.tables.forEach((t) => {
    if (t.engine !== 'mysql') return;
    if (!byModule.has(t.moduleId)) byModule.set(t.moduleId, []);
    byModule.get(t.moduleId).push(t);
  });

  let i = 1;
  for (const [moduleId, tables] of byModule) {
    const mod = ir.modules.find((m) => m.id === moduleId);
    const content = [
      `${header}`,
      `-- 模块：${mod ? mod.name : moduleId}（${tables.length} 张表）`,
      '',
      tables.map((t) => ddl(t, p.idStrategy)).join('\n'),
    ].join('\n');
    files.push({ path: `sql/${String(i).padStart(2, '0')}_${moduleId}.sql`, content });
    i += 1;
  }

  files.push({ path: `sql/${String(i).padStart(2, '0')}_seed.sql`, content: `${header}\n${seedSql(ir)}\n` });

  if (ir.fileTables.length) {
    const lines = [
      '文件数据源说明',
      '==============',
      '',
      '以下表使用文件作为存储引擎，不会生成 MySQL 建表语句。',
      '应用启动时会加载文件并在内存中建立索引，写入会回写文件。',
      '',
      '| 表 | 引擎 | 文件 |',
      '| --- | --- | --- |',
      ...ir.fileTables.map((t) => `| ${t.name} | ${t.engine} | ${t.filePath || 'data/' + t.name + '.' + (t.engine === 'excel' ? 'xlsx' : t.engine)} |`),
      '',
      '字段定义见各模块实体类 / Rust model，首行是表头。',
    ];
    files.push({ path: 'sql/FILE_DATASOURCES.md', content: lines.join('\n') });
  }

  return {
    files,
    combined: files.map((f) => `-- >>> ${f.path}\n\n${f.content}`).join('\n\n'),
  };
}

module.exports = { generateSql, ddl, seedSql };
