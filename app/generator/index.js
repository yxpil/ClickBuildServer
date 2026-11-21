// 作者：yxpil
'use strict';

const fs = require('fs');
const path = require('path');

const { normalizeProject, blankProject, DEFAULT_PROJECT } = require('./ir');
const { generateSql } = require('./sql');
const { generateJava } = require('./java');
const { generateNode } = require('./nodejs');
const { generateGo } = require('./go');
const { generateRust } = require('./rust');
const { generateDocker } = require('./docker');
const { generateDocs } = require('./docs');
const { generateDeploy } = require('./deploy');
const { zip } = require('./zip');

/**
 * 从一份项目配置生成全部产物。
 * @param {object} input 项目配置（可以是 clickbuild.json 原样回灌）
 * @returns {{ir:object, files:{path:string,content:string}[], warnings:string[]}}
 */
function generate(input) {
  const ir = normalizeProject(input);
  const p = ir.project;
  const bag = new Map();
  const add = (list) => {
    (list || []).forEach((f) => {
      if (!f || !f.path) return;
      bag.set(String(f.path).replace(/\\/g, '/'), f.content == null ? '' : f.content);
    });
  };

  if (p.lang === 'rust') add(generateRust(ir));
  else if (p.lang === 'node') add(generateNode(ir));
  else if (p.lang === 'go') add(generateGo(ir));
  else add(generateJava(ir));

  add(generateSql(ir).files);
  add(generateDocker(ir));
  add(generateDocs(ir));
  add(generateDeploy(ir));

  // 文件数据源样例（Java 内部已生成 csv/json，这里补齐 excel 说明与 Rust 的空样例）
  ir.fileTables.forEach((t) => {
    const file = t.filePath || `data/${t.name}.${t.engine === 'excel' ? 'xlsx' : t.engine}`;
    if (bag.has(file)) return;
    if (t.engine === 'csv') bag.set(file, t.columns.map((c) => c.name).join(',') + '\n');
    else if (t.engine === 'json') bag.set(file, '[\n]\n');
    else bag.set(file.replace(/\.xlsx$/, '.README.md'), excelNote(t));
  });

  const files = [...bag.entries()].map(([filePath, content]) => ({ path: filePath, content }));
  return { ir, files, warnings: ir.warnings };
}

function excelNote(t) {
  return `# Excel 数据源：${t.name}

运行时按只读方式加载。请把 \`${t.name}.xlsx\` 放在同目录，第一行必须是表头：

${t.columns.map((c) => `- ${c.name} (${c.type}) ${c.comment || ''}`).join('\n')}

若需要写入，请改用 CSV / JSON，或把该表切到 MySQL。
`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 把文件清单落盘。同名文件直接覆盖（生成目录本身就是产物，不承载用户数据）。
 * @returns {string[]} 写入的相对路径
 */
function writeTo(outDir, files) {
  ensureDir(outDir);
  const written = [];
  files.forEach((f) => {
    const target = path.join(outDir, f.path);
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, f.content, 'utf8');
    written.push(f.path);
  });
  return written;
}

function zipBuffer(files, rootName) {
  const prefix = rootName ? `${rootName}/` : '';
  return zip(files.map((f) => ({ path: prefix + f.path.replace(/\\/g, '/'), content: f.content })));
}

function listTree(files) {
  const tree = {};
  files.forEach((f) => {
    const parts = f.path.split('/');
    let node = tree;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node[part] = null;
      else {
        node[part] = node[part] || {};
        node = node[part];
      }
    });
  });
  return tree;
}

module.exports = {
  generate,
  writeTo,
  zipBuffer,
  listTree,
  normalizeProject,
  blankProject,
  DEFAULT_PROJECT,
};
