#!/usr/bin/env node
'use strict';

// 内核命令行：工程 JSON -> 元模型 -> 方言 DDL / migration；数据库 -> 元模型 -> 工程。
// 用法：
//   node tools/kernel-cli.js inspect <project.json>
//   node tools/kernel-cli.js init <project.json> <outDir> --dialect mysql|postgres|sqlite
//   node tools/kernel-cli.js diff <old.json> <new.json> <outDir> --dialect sqlite --version 0002
//   node tools/kernel-cli.js ddl <project.json> --dialect postgres
//   node tools/kernel-cli.js reverse-mysql --database cb --out project.json
//   node tools/kernel-cli.js reverse-sqlite <db.sqlite> --out project.json

const fs = require('fs');
const path = require('path');
const { registryFromProject } = require('../app/kernel/project-adapter');
const { validateRegistry } = require('../app/kernel/metamodel');
const { initMigration, diffMigration, writeMigration } = require('../app/kernel/migrate');
const { introspectMysql, introspectSqlite } = require('../app/kernel/introspect');
const { projectFromRegistry } = require('../app/kernel/to-project');

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function readProject(file) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  return p;
}

function registryOf(file, opts) {
  return registryFromProject(readProject(file), opts);
}

function printRegistry(reg, opt) {
  const v = validateRegistry(reg);
  console.log(`工程：${reg.name || '(未命名)'}  方言：${(opt && opt.dialect) || reg.options.dialect || 'mysql'}`);
  console.log(`实体 ${reg.entities.length} · 枚举 ${reg.enums.length} · 规则 ${reg.rules.length}`);
  for (const e of reg.entities) {
    const pk = e.primaryKey || '(无主键)';
    console.log(`- ${e.name}  pk=${pk}  fields=${e.fields.length}  relations=${e.relations.length}  indexes=${e.indexes.length}`);
    for (const f of e.fields) {
      console.log(`    ${f.name}: ${f.type}${f.length ? `(${f.length})` : ''}${f.nullable ? '' : ' NOT NULL'}${f.primaryKey ? ' PK' : ''}${f.enumRef ? ` enum=${f.enumRef}` : ''}`);
    }
  }
  if (v.errors.length) console.log(`\n错误 ${v.errors.length}：\n${v.errors.join('\n')}`);
  if (v.warnings.length) console.log(`\n警告 ${v.warnings.length}：\n${v.warnings.slice(0, 20).join('\n')}`);
  if (reg.options.importWarnings) console.log(`\n导入提示 ${reg.options.importWarnings.length}：\n${reg.options.importWarnings.slice(0, 10).join('\n')}`);
  return v.ok ? 0 : 1;
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  const file = a._[1];
  if (!cmd) {
    console.log('用法：node tools/kernel-cli.js inspect|init|diff|ddl|reverse-mysql|reverse-sqlite ...');
    return 2;
  }
  if (cmd === 'inspect') {
    const reg = registryOf(file);
    return printRegistry(reg);
  }
  if (cmd === 'ddl' || cmd === 'init') {
    const reg = registryOf(file);
    const dialect = a.dialect || 'mysql';
    const m = initMigration(reg, dialect, { version: a.version || '0001', name: a.name || 'init schema' });
    if (cmd === 'ddl') { console.log(m.sql); return 0; }
    const out = a._[2] || a.out;
    if (!out) throw new Error('init 需要输出目录');
    const written = writeMigration(m, out);
    console.log(`写入 ${written}（${m.up.length} 条 SQL）`);
    return 0;
  }
  if (cmd === 'diff') {
    const nextFile = a._[2];
    const out = a._[3] || a.out;
    if (!nextFile || !out) throw new Error('diff 需要 old.json new.json outDir');
    const oldReg = registryOf(file);
    const newReg = registryOf(nextFile);
    const dialect = a.dialect || 'mysql';
    const m = diffMigration(oldReg, newReg, dialect, { version: a.version, name: a.name, fromVersion: oldReg.version });
    const written = writeMigration(m, out);
    console.log(`写入 ${written}（${m.up.length} 条 UP，${m.warnings.length} 条提示）`);
    for (const w of m.warnings) console.log(`- ${w}`);
    return 0;
  }
  if (cmd === 'reverse-mysql') {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      host: a.host || '127.0.0.1', port: Number(a.port || 3306),
      user: a.user || 'root', password: a.password || '',
      database: a.database || a.db || 'mysql',
    });
    try {
      const reg = await introspectMysql(conn, { schema: a.schema || a.database || a.db, name: a.name });
      const project = projectFromRegistry(reg, { name: a.name || `${a.database || a.db} 反向工程` });
      if (a.out) { fs.writeFileSync(a.out, JSON.stringify(project, null, 2), 'utf8'); console.log(`写入 ${a.out}`); }
      else console.log(JSON.stringify(project, null, 2));
    } finally { await conn.end(); }
    return 0;
  }
  if (cmd === 'reverse-sqlite') {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file);
    try {
      const reg = introspectSqlite(db, { name: a.name });
      const project = projectFromRegistry(reg, { name: a.name || `${path.basename(file)} 反向工程` });
      if (a.out) { fs.writeFileSync(a.out, JSON.stringify(project, null, 2), 'utf8'); console.log(`写入 ${a.out}`); }
      else console.log(JSON.stringify(project, null, 2));
    } finally { db.close(); }
    return 0;
  }
  throw new Error(`未知命令：${cmd}`);
}

main().then((code) => { process.exitCode = code || 0; }).catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
