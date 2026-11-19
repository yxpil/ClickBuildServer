'use strict';

// 脚本里可以直接调用的函数集（服务器行为的内置扩展）。
// 全部是纯 Node 实现，生成出来的服务原样带走这一份。

const crypto = require('crypto');

const ASCII = (v) => String(v == null ? '' : v);

const hashWith = (algo, v) => crypto.createHash(algo).update(ASCII(v)).digest('hex');

function sm4Key(key) {
  const raw = Buffer.from(ASCII(key), 'utf8');
  if (raw.length === 16) return raw;
  return crypto.createHash('sha256').update(raw).digest().subarray(0, 16);
}

function sm4Encrypt(value, key) {
  const c = crypto.createCipheriv('sm4-ecb', sm4Key(key), null);
  return Buffer.concat([c.update(Buffer.from(ASCII(value), 'utf8')), c.final()]).toString('base64');
}

function sm4Decrypt(value, key) {
  const d = crypto.createDecipheriv('sm4-ecb', sm4Key(key), null);
  const buf = Buffer.from(ASCII(value), 'base64');
  return Buffer.concat([d.update(buf), d.final()]).toString('utf8');
}

function jsonGet(obj, pathStr) {
  const parts = String(pathStr || '').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return null;
    if (Array.isArray(cur) && /^\d+$/.test(p)) cur = cur[Number(p)];
    else cur = cur[p];
  }
  return cur == null ? null : cur;
}

const BUILTINS = {
  HASH: (algo, v) => hashWith(String(algo || 'sha256').toLowerCase(), v),
  MD5: (v) => hashWith('md5', v),
  SHA1: (v) => hashWith('sha1', v),
  SHA256: (v) => hashWith('sha256', v),
  SM3: (v) => hashWith('sm3', v),
  SM4_ENC: (v, key) => sm4Encrypt(v, key),
  SM4_DEC: (v, key) => sm4Decrypt(v, key),
  SUBSTR: (v, start, len) => {
    const s = ASCII(v);
    const from = Number(start) || 0;
    return len == null ? s.slice(from) : s.slice(from, from + Number(len));
  },
  LEFT: (v, n) => ASCII(v).slice(0, Number(n) || 0),
  RIGHT: (v, n) => {
    const s = ASCII(v);
    const k = Number(n) || 0;
    return k <= 0 ? '' : s.slice(-k);
  },
  LEN: (v) => (Array.isArray(v) ? v.length : ASCII(v).length),
  UPPER: (v) => ASCII(v).toUpperCase(),
  LOWER: (v) => ASCII(v).toLowerCase(),
  TRIM: (v) => ASCII(v).trim(),
  CONCAT: (...args) => args.map(ASCII).join(''),
  REPLACE: (v, from, to) => ASCII(v).split(ASCII(from)).join(ASCII(to)),
  SPLIT: (v, sep) => ASCII(v).split(ASCII(sep || ',')),
  JOIN: (arr, sep) => (Array.isArray(arr) ? arr.map(ASCII).join(ASCII(sep == null ? ',' : sep)) : ASCII(arr)),
  NOW: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
  TODAY: () => new Date().toISOString().slice(0, 10),
  UUID: () => crypto.randomUUID(),
  BASE64_ENC: (v) => Buffer.from(ASCII(v), 'utf8').toString('base64'),
  BASE64_DEC: (v) => Buffer.from(ASCII(v), 'base64').toString('utf8'),
  URL_ENC: (v) => encodeURIComponent(ASCII(v)),
  URL_DEC: (v) => decodeURIComponent(ASCII(v)),
  INT: (v) => Number.parseInt(v, 10) || 0,
  FLOAT: (v) => Number(v) || 0,
  STR: (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)),
  ROUND: (v, n) => {
    const k = Math.pow(10, Number(n) || 0);
    return Math.round(Number(v) * k) / k;
  },
  ABS: (v) => Math.abs(Number(v) || 0),
  COALESCE: (...args) => args.find((x) => x !== null && x !== undefined && x !== '') ?? null,
  MASK: (v, start, len, ch) => {
    const s = ASCII(v);
    const from = Number(start) || 0;
    const n = Number(len) || 0;
    return s.slice(0, from) + String(ch == null ? '*' : ch).repeat(n) + s.slice(from + n);
  },
  JSON_GET: jsonGet,
  JSON_STR: (v) => JSON.stringify(v),
  RAND_INT: (a, b) => {
    const min = Number(a) || 0;
    const max = Number(b) || 0;
    return Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1)) + Math.min(min, max);
  },
  IF: (cond, a, b) => (cond ? a : b),
  IN: (v, arr) => (Array.isArray(arr) ? arr.includes(v) : false),
  CONTAINS: (v, sub) => ASCII(v).includes(ASCII(sub)),
  START_WITH: (v, sub) => ASCII(v).startsWith(ASCII(sub)),
  END_WITH: (v, sub) => ASCII(v).endsWith(ASCII(sub)),
};

const NAMES = Object.keys(BUILTINS);

function call(name, args) {
  const fn = BUILTINS[String(name || '').toUpperCase()];
  if (!fn) throw new Error(`未知函数：${name}（在帮助页可以看到全部内置函数与自定义函数）`);
  return fn(...args);
}

module.exports = { BUILTINS, NAMES, call };
