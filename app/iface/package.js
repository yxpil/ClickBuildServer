'use strict';

// .yxpn 工程包：一个 zip，里面装工程定义、SQL、文档和导出代码。
// 结构：
//   manifest.json      格式版本、生成时间、工程摘要
//   project.json       完整工程（可直接导入）
//   interfaces.json    运行时用的接口定义
//   sql/*.sql          建表脚本
//   docs/openapi.json
//   README.md
// 纯 Node（zlib）实现，不依赖第三方 zip 库。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const spec = require('./spec');
const codegen = require('./codegen');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function zip(entries) {
  const now = dosTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

function unzip(buf) {
  const out = {};
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const csize = buf.readUInt32LE(i + 18);
    const usize = buf.readUInt32LE(i + 22);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const dataStart = i + 30 + nlen + elen;
    const body = buf.slice(dataStart, dataStart + csize);
    let data = body;
    if (method === 8) data = zlib.inflateRawSync(body);
    if (crc32(data) !== crc) throw new Error(`包内文件校验失败：${name}`);
    out[name] = data;
    i = dataStart + csize;
    if (usize === 0 && csize === 0) i += 0;
  }
  return out;
}

function build(project, opts) {
  const p = spec.normalizeProject(project);
  const o = opts || {};
  const entries = [];
  const files = codegen.generate(p, { port: o.port }).files;
  const manifest = {
    format: 'yxpn',
    version: 1,
    name: p.name,
    createdAt: new Date().toISOString(),
    counts: {
      interfaces: p.interfaces.length,
      tables: p.interfaces.reduce((n, i) => n + i.tables.length, 0),
      routes: p.interfaces.reduce((n, i) => n + i.routes.length, 0),
      functions: p.functions.length,
    },
    runtime: { node: '>=18', deps: ['mysql2', 'ioredis', 'minio'] },
    frontend: p.frontend ? { format: 'yxpp', name: p.frontend.name, framework: p.frontend.framework, file: 'frontend/index.yxpp' } : null,
  };
  entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  entries.push({ name: 'project.json', data: JSON.stringify(p, null, 2) });
  for (const f of files) entries.push({ name: f.path, data: f.content });
  return { buffer: zip(entries), manifest, files: files.map((f) => f.path) };
}

function writeYxpn(project, outFile, opts) {
  const built = build(project, opts);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, built.buffer);
  return { file: outFile, size: built.buffer.length, manifest: built.manifest, files: built.files };
}

function readYxpn(file) {
  const entries = unzip(fs.readFileSync(file));
  if (!entries['project.json']) throw new Error('不是有效的 .yxpn：缺少 project.json');
  return { project: JSON.parse(entries['project.json'].toString('utf8')), manifest: entries['manifest.json'] ? JSON.parse(entries['manifest.json'].toString('utf8')) : null, files: Object.keys(entries) };
}

module.exports = { zip, unzip, build, writeYxpn, readYxpn, crc32 };
