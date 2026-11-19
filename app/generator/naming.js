'use strict';

const RESERVED = new Set(['class', 'module', 'type', 'match', 'impl', 'fn', 'let', 'use', 'mod', 'crate', 'self', 'super', 'where', 'move', 'ref', 'pub', 'const', 'static', 'async', 'await', 'dyn', 'loop', 'trait', 'enum', 'struct', 'return', 'package', 'public', 'private', 'void', 'int', 'long', 'short', 'byte', 'new', 'if', 'else', 'for', 'while', 'switch', 'case', 'default']);

const toWords = (s) => String(s)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[^a-zA-Z0-9]+/)
  .filter(Boolean);

const pascal = (s) => toWords(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') || 'X';
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };
const snake = (s) => toWords(s).map((w) => w.toLowerCase()).join('_') || 'x';
const kebab = (s) => toWords(s).map((w) => w.toLowerCase()).join('-');
const moduleDir = (id) => String(id).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const safeIdent = (s) => { const v = snake(s); return RESERVED.has(v) ? `${v}_x` : v; };
const safePkg = (s) => String(s).split('.').map((p) => p.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean).join('.');
const artifact = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';

const TABLE_SUFFIX = ['_table', '_tbl'];
const tableClass = (name) => pascal(name);

module.exports = { pascal, camel, snake, kebab, moduleDir, safeIdent, safePkg, artifact, tableClass, toWords };
