// 作者：yxpil
'use strict';

// 把 Excel / CSV 拖进工作台后，先在这里变成“表模型”。
// 只读文件、推断字段，不碰数据库；渲染层确认后再挂到当前接口，保存和生成仍走原有链路。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_FILE_MB = 64;
const MAX_ROWS = 200000;
const MAX_COLUMNS = 256;
const MAX_PREVIEW_ROWS = 6;
const MAX_TEXT = 20000;

const HEADER_WORDS = {
  姓名: 'name', 名字: 'name', 名称: 'name', 标题: 'title', 昵称: 'nickname',
  年龄: 'age', 性别: 'gender', 手机: 'phone', 手机号: 'phone', 电话: 'phone', 联系电话: 'phone',
  邮箱: 'email', 电子邮箱: 'email', 地址: 'address', 住址: 'address',
  状态: 'status', 分类: 'category', 类型: 'type', 内容: 'content', 正文: 'content',
  备注: 'remark', 说明: 'note', 描述: 'description',
  价格: 'price', 单价: 'unit_price', 金额: 'amount', 数量: 'qty', 库存: 'stock',
  编号: 'code', 编码: 'code', 订单号: 'order_no', 单号: 'order_no', 商品: 'product',
  日期: 'date', 创建日期: 'date', 更新日期: 'updated_at', 更新时间: 'updated_at', 时间: 'time', 创建时间: 'created_at',
  客户名称: 'customer_name', 客户: 'customer', 下单日期: 'order_date', 订单日期: 'order_date',
  部门: 'department', 公司: 'company', 城市: 'city', 省份: 'province',
  密码: 'password', 账号: 'username', 用户名: 'username', 角色: 'role',
  总分: 'score', 分数: 'score', 成绩: 'score', 班级: 'class_name', 学校: 'school',
};
const SECRET_HINT = /密码|口令|password|passwd|secret|token|密钥|身份证|证件号/i;
const TEXT_ID_HINT = /手机|电话|phone|mobile|tel|身份证|证件|邮编|zip|编号|编码|单号|卡号|账号|account|code|no\b/i;
const DECIMAL_HINT = /金额|价格|单价|费用|余额|工资|薪资|税额|比例|百分比|amount|price|fee|rate|percent/i;
const INT_HINT = /年龄|数量|库存|次数|人数|个数|qty|count|age|stock/i;
const DATETIME_HINT = /时间|时刻|datetime|timestamp|time\b/i;
const DATE_HINT = /日期|date|day/i;

function fail(message, code) {
  const err = new Error(message);
  err.code = code || 'IMPORT_FAILED';
  return err;
}

function decodeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function attrsOf(text) {
  const out = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(String(text || '')))) out[m[1]] = decodeXml(m[2] == null ? m[3] : m[2]);
  return out;
}

function stripPrefixes(xml) {
  return String(xml || '').replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
}

function decodeText(buf) {
  let text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 2 || /^\uFFFD/.test(text)) {
    for (const enc of ['gb18030', 'gbk']) {
      try {
        const alt = new TextDecoder(enc).decode(buf).replace(/^\uFEFF/, '');
        if (!(alt.match(/\uFFFD/g) || []).length) return alt;
      } catch (e) { /* 当前运行时没有该编码时继续 */ }
    }
  }
  return text;
}

function countOutsideQuotes(line, ch) {
  let quoted = false;
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && c === ch) n++;
  }
  return n;
}

function detectDelimiter(text) {
  const lines = String(text || '').split(/\r?\n/).filter((x) => x.trim()).slice(0, 8);
  let best = ',';
  let bestScore = -1;
  for (const cand of [',', ';', '\t', '|']) {
    const counts = lines.map((line) => countOutsideQuotes(line, cand));
    const positive = counts.filter((n) => n > 0).length;
    const total = counts.reduce((a, b) => a + b, 0);
    const score = positive * 1000 + total;
    if (score > bestScore) { best = cand; bestScore = score; }
  }
  return best;
}

function parseDelimited(text, delimiter) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delim = delimiter || detectDelimiter(clean);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') {
      row.push(cell);
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
      if (rows.length > MAX_ROWS) throw fail(`超过 ${MAX_ROWS} 行，先拆分文件再导入`, 'TOO_MANY_ROWS');
      row = []; cell = '';
    } else cell += ch;
    if (row.length > MAX_COLUMNS) throw fail(`超过 ${MAX_COLUMNS} 列，先精简列再导入`, 'TOO_MANY_COLUMNS');
  }
  if (quoted) throw fail('CSV 引号没有闭合，文件可能损坏');
  row.push(cell);
  if (row.some((x) => String(x).trim() !== '')) rows.push(row);
  return rows;
}

function readZip(buf) {
  let eocd = -1;
  const stop = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw fail('不是有效的 .xlsx（缺少 ZIP 尾部）', 'BAD_XLSX');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset >= buf.length) throw fail('不是有效的 .xlsx（目录偏移越界）', 'BAD_XLSX');
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw fail('.xlsx 目录损坏', 'BAD_XLSX');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (local + 30 > buf.length) throw fail('.xlsx 文件条目越界', 'BAD_XLSX');
    const localName = buf.readUInt16LE(local + 26);
    const localExtra = buf.readUInt16LE(local + 28);
    const dataAt = local + 30 + localName + localExtra;
    const raw = buf.subarray(dataAt, dataAt + csize);
    if (method === 0) entries.set(name, raw);
    else if (method === 8) entries.set(name, zlib.inflateRawSync(raw));
    else throw fail(`.xlsx 使用了不支持的压缩方式 ${method}`, 'BAD_XLSX');
    p = next;
    if (entries.size > 3000) throw fail('.xlsx 内部条目过多', 'BAD_XLSX');
  }
  return entries;
}

function colIndex(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/i);
  if (!m) return -1;
  let n = 0;
  for (const c of m[1].toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function excelDate(serial, date1904) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return String(serial);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = base + Math.round(n * 86400000);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return String(serial);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const hasTime = n - Math.floor(n) > 0.000001;
  if (n < 1 && hasTime) return `${hh}:${mi}:${ss}`;
  return hasTime ? `${y}-${mo}-${da} ${hh}:${mi}:${ss}` : `${y}-${mo}-${da}`;
}

function numericText(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (/^-?\d{16,}$/.test(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return String(n);
}

function readXlsx(file, fileName) {
  const entries = readZip(file);
  const workbookName = 'xl/workbook.xml';
  const workbookXml = entries.get(workbookName);
  if (!workbookXml) throw fail('Excel 缺少 workbook.xml', 'BAD_XLSX');
  const wb = stripPrefixes(workbookXml.toString('utf8'));
  const date1904 = /<workbookPr\b[^>]*date1904\s*=\s*"(?:1|true)"/i.test(wb);
  const relName = 'xl/_rels/workbook.xml.rels';
  const relXml = entries.get(relName);
  const rels = {};
  if (relXml) {
    for (const m of stripPrefixes(relXml.toString('utf8')).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const a = attrsOf(m[1]);
      if (a.Id && a.Target) rels[a.Id] = a.Target;
    }
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = attrsOf(m[1]);
    const rid = a['r:id'] || a.id || '';
    const state = a.state || 'visible';
    const target = rels[rid];
    if (!a.name) continue;
    if (state !== 'visible' && state !== 'veryHidden') continue;
    let filePath = '';
    if (target) {
      const clean = target.replace(/^\//, '');
      filePath = clean.startsWith('xl/') ? clean : path.posix.normalize(`xl/${clean}`);
    } else filePath = `xl/worksheets/sheet${sheets.length + 1}.xml`;
    if (entries.has(filePath)) sheets.push({ name: a.name, xml: entries.get(filePath).toString('utf8'), state });
  }
  const shared = [];
  const sst = entries.get('xl/sharedStrings.xml');
  if (sst) {
    const xml = stripPrefixes(sst.toString('utf8'));
    for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const texts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
      shared.push(texts.join('').replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    }
  }
  const dateStyles = [];
  const styles = entries.get('xl/styles.xml');
  if (styles) {
    const xml = stripPrefixes(styles.toString('utf8'));
    const custom = new Map();
    for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
      const a = attrsOf(m[1]);
      if (a.numFmtId && a.formatCode) custom.set(Number(a.numFmtId), a.formatCode);
    }
    const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (block) {
      for (const m of block[1].matchAll(/<xf\b([^>]*?)\/?>/g)) {
        const a = attrsOf(m[1]);
        const id = Number(a.numFmtId || 0);
        const code = (custom.get(id) || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
        dateStyles.push([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58].includes(id)
          || /[ymdhs]/i.test(code));
      }
    }
  }
  const tables = [];
  const warnings = [];
  const usable = sheets.filter((s) => s.xml);
  if (!usable.length) throw fail('这个 Excel 没有可读取的工作表', 'NO_SHEET');
  for (let si = 0; si < usable.length; si++) {
    const sheet = usable[si];
    const xml = stripPrefixes(sheet.xml);
    const values = [];
    let seenRows = 0;
    let truncated = false;
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      seenRows++;
      if (seenRows > MAX_ROWS) { truncated = true; break; }
      const a = attrsOf(rm[1]);
      const row = [];
      let autoCol = 0;
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attrsOf(cm[1]);
        const idx = ca.r ? colIndex(ca.r) : autoCol;
        if (idx < 0 || idx >= MAX_COLUMNS) { autoCol++; continue; }
        autoCol = idx + 1;
        const body = cm[2] || '';
        const t = ca.t || '';
        const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
        let text = '';
        if (t === 'inlineStr') {
          text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1])).join('');
        } else if (v) {
          const raw = decodeXml(v[1]);
          if (t === 's') text = shared[Number(raw)] || '';
          else if (t === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'str' || t === 'e' || t === 'd') text = raw;
          else if (/^\d+(\.\d+)?$/.test(raw) && dateStyles[Number(ca.s || 0)]) text = excelDate(raw, date1904);
          else text = numericText(raw);
        }
        row[idx] = text;
      }
      const width = row.length;
      const nonEmpty = row.some((x) => String(x == null ? '' : x).trim() !== '');
      if (!nonEmpty) continue;
      const arr = [];
      for (let i = 0; i < width; i++) arr.push(row[i] == null ? '' : String(row[i]));
      values.push(arr);
    }
    if (!values.length) {
      warnings.push(`工作表「${sheet.name}」是空的，已跳过`);
      continue;
    }
    if (truncated) warnings.push(`工作表「${sheet.name}」超过 ${MAX_ROWS} 行，只读取前 ${MAX_ROWS} 行`);
    const maxCols = values.reduce((n, r) => Math.max(n, r.length), 0);
    if (maxCols > MAX_COLUMNS) warnings.push(`工作表「${sheet.name}」超过 ${MAX_COLUMNS} 列，超出部分已忽略`);
    const table = buildTable({
      rows: values,
      fileBase: fileName,
      sheetName: sheet.name,
      sheetIndex: si,
      sheetCount: usable.length,
      fileLabel: fileName,
      warnings,
    });
    if (table) tables.push(table);
  }
  return { format: 'xlsx', tables, warnings };
}

function asciiName(raw, fallback) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (HEADER_WORDS[s]) s = HEADER_WORDS[s];
  s = s.replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  if (/^[a-z_][a-z0-9_]{0,47}$/.test(s)) return s;
  return fallback;
}

function fieldName(raw, i, used) {
  const text = String(raw == null ? '' : raw).trim();
  const normalized = text.toLowerCase();
  let name = HEADER_WORDS[normalized] || asciiName(normalized, '');
  if (!name) name = `col_${i + 1}`;
  if (/^[0-9]/.test(name)) name = `f_${name}`;
  const reserved = ['id', 'created_at', 'updated_at'];
  if (reserved.includes(name)) name = `source_${name}`;
  let base = name;
  let n = 2;
  while (used.has(name)) { name = `${base}_${n++}`; }
  used.add(name);
  return { name, label: text || `第 ${i + 1} 列` };
}

function guessType(values, header) {
  const samples = values.map((v) => String(v == null ? '' : v).trim()).filter((v) => v && v !== '-' && v !== '—' && !/^(null|n\/a|na|nil)$/i.test(v)).slice(0, 1000);
  if (!samples.length) return 'varchar';
  const head = String(header || '').trim();
  if (SECRET_HINT.test(head)) return 'varchar';
  if (TEXT_ID_HINT.test(head)) return 'varchar';
  if (/日期|date|day/i.test(head)) {
    if (samples.every((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(v))) return 'date';
  }
  if (DATETIME_HINT.test(head)) {
    if (samples.every((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}/.test(v))) return 'datetime';
  }
  if (samples.every((v) => /^-?0\d+/.test(v))) return 'varchar';
  if (samples.every((v) => /^-?\d+$/.test(v))) {
    const nums = samples.map(Number);
    if (nums.every((n) => Math.abs(n) <= 2147483647)) return INT_HINT.test(head) ? 'int' : 'int';
    return 'bigint';
  }
  if (samples.every((v) => /^-?\d+(?:\.\d+)?$/.test(v))) {
    return DECIMAL_HINT.test(head) ? 'decimal' : 'decimal';
  }
  if (samples.every((v) => /^(true|false)$/i.test(v))) return 'bool';
  if (samples.every((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(v))) return 'date';
  if (samples.every((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}/.test(v))) return 'datetime';
  if (samples.every((v) => {
    if (!/^[\[{]/.test(v)) return false;
    try { JSON.parse(v); return true; } catch (e) { return false; }
  })) return 'json';
  const max = samples.reduce((n, v) => Math.max(n, v.length), 0);
  if (max > MAX_TEXT) return 'longtext';
  if (max > 255) return 'text';
  return 'varchar';
}

function buildTable(opts) {
  const rows = opts.rows || [];
  if (!rows.length) return null;
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  if (!width) return null;
  const headers = [];
  const used = new Set();
  for (let i = 0; i < width; i++) {
    const h = rows[0][i] == null ? '' : rows[0][i];
    headers.push(fieldName(h, i, used));
  }
  const data = rows.slice(1);
  const fields = headers.map((h, i) => {
    const type = guessType(data.map((r) => r[i]), h.label);
    return {
      name: h.name,
      type,
      comment: h.label,
      pk: false,
      autoIncrement: false,
      nullable: true,
      search: ['varchar', 'char', 'text', 'longtext'].includes(type),
      hidden: SECRET_HINT.test(h.label),
      query: !SECRET_HINT.test(h.label),
      writable: true,
      default: '',
    };
  });
  const defaultNames = ['created_at', 'updated_at'];
  const allFields = [
    { name: 'id', type: 'bigint', comment: '主键', pk: true, autoIncrement: true, nullable: false, search: false, hidden: false, query: false, writable: false, default: '' },
    ...fields,
    ...defaultNames.map((name) => ({ name, type: 'datetime', comment: name === 'created_at' ? '创建时间' : '更新时间', pk: false, autoIncrement: false, nullable: true, search: false, hidden: false, query: true, writable: false, default: 'CURRENT_TIMESTAMP' })),
  ];
  const usedFields = new Set();
  for (const f of allFields) {
    let base = f.name;
    let n = 2;
    while (usedFields.has(f.name)) f.name = `${base}_${n++}`;
    usedFields.add(f.name);
  }
  const baseName = asciiName(opts.fileBase, 'data');
  let tableName = opts.sheetCount > 1 ? `${baseName}_${opts.sheetIndex + 1}` : baseName;
  tableName = tableName.slice(0, 48) || 'data';
  const label = opts.sheetCount > 1 ? `${opts.fileLabel} · ${opts.sheetName}` : (opts.sheetName && opts.sheetName !== 'Sheet1' ? `${opts.fileLabel} · ${opts.sheetName}` : opts.fileLabel);
  const columns = allFields.map((f) => ({ name: f.name, label: f.comment, type: f.type }));
  const previewRows = data.slice(0, MAX_PREVIEW_ROWS).map((r) => allFields.map((f, idx) => {
    if (idx === 0) return '';
    const v = r[idx - 1];
    const s = v == null ? '' : String(v);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  }));
  return {
    key: tableName,
    name: tableName,
    schema: '',
    comment: `导入自 ${label}`,
    source: { file: opts.fileLabel, sheet: opts.sheetName },
    rowCount: data.length,
    columnCount: fields.length,
    fields: allFields,
    columns,
    preview: { columns, rows: previewRows },
  };
}

function parseFile(filePath) {
  const full = path.resolve(String(filePath || ''));
  let st;
  try { st = fs.statSync(full); } catch (e) { throw fail(`读不到文件：${full}`); }
  if (!st.isFile()) throw fail('请拖入一个文件，不是文件夹');
  if (st.size > MAX_FILE_MB * 1024 * 1024) throw fail(`文件超过 ${MAX_FILE_MB} MB，先拆分再导入`, 'TOO_LARGE');
  const ext = path.extname(full).toLowerCase();
  const base = path.basename(full, path.extname(full));
  if (['.csv', '.tsv', '.txt'].includes(ext)) {
    const buf = fs.readFileSync(full);
    let text = decodeText(buf);
    let delimiter = ext === '.tsv' ? '\t' : detectDelimiter(text);
    if (/^sep=([,;\t|])\r?\n/i.test(text)) {
      delimiter = text.match(/^sep=([,;\t|])/i)[1];
      text = text.replace(/^sep=[,;\t|]\r?\n/i, '');
    }
    const rows = parseDelimited(text, delimiter);
    if (!rows.length) throw fail('文件是空的', 'EMPTY');
    const table = buildTable({ rows, fileBase: base || 'data', fileLabel: path.basename(full), sheetName: '', sheetIndex: 0, sheetCount: 1, warnings: [] });
    if (!table) throw fail('没有识别到表头', 'NO_HEADER');
    table.rowCount = Math.max(0, rows.length - 1);
    return {
      ok: true,
      file: path.basename(full), size: st.size, format: ext.replace('.', ''),
      tables: [table],
      warnings: [table.rowCount ? `第一行按表头处理，${table.rowCount} 行作为样例` : '只有表头，没有数据行'],
    };
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    const got = readXlsx(fs.readFileSync(full), base || 'data');
    if (!got.tables.length) throw fail('没有识别到可导入的工作表', 'NO_TABLE');
    return {
      ok: true,
      file: path.basename(full), size: st.size, format: 'xlsx',
      tables: got.tables,
      warnings: got.warnings,
    };
  }
  if (ext === '.xls') throw fail('旧版 .xls 还不能直接读，请在 Excel 里另存为 .xlsx 或 .csv', 'OLD_XLS');
  throw fail(`不支持的文件类型：${ext || '无扩展名'}。支持 .xlsx / .csv / .tsv`, 'BAD_TYPE');
}

function parseBuffer(buf, fileName) {
  const name = String(fileName || 'data.csv');
  const ext = path.extname(name).toLowerCase();
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || '');
  if (buf.length > MAX_FILE_MB * 1024 * 1024) throw fail(`文件超过 ${MAX_FILE_MB} MB，先拆分再导入`, 'TOO_LARGE');
  if (['.csv', '.tsv', '.txt'].includes(ext)) {
    let text = decodeText(buf);
    let delimiter = ext === '.tsv' ? '\t' : detectDelimiter(text);
    if (/^sep=([,;\t|])\r?\n/i.test(text)) {
      delimiter = text.match(/^sep=([,;\t|])/i)[1];
      text = text.replace(/^sep=[,;\t|]\r?\n/i, '');
    }
    const rows = parseDelimited(text, delimiter);
    if (!rows.length) throw fail('文件是空的', 'EMPTY');
    const table = buildTable({ rows, fileBase: path.basename(name, ext) || 'data', fileLabel: name, sheetName: '', sheetIndex: 0, sheetCount: 1, warnings: [] });
    if (!table) throw fail('没有识别到表头', 'NO_HEADER');
    table.rowCount = Math.max(0, rows.length - 1);
    return { ok: true, file: name, size: buf.length, format: ext.replace('.', ''), tables: [table], warnings: [table.rowCount ? `第一行按表头处理，${table.rowCount} 行作为样例` : '只有表头，没有数据行'] };
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    const got = readXlsx(buf, path.basename(name, ext) || 'data');
    if (!got.tables.length) throw fail('没有识别到可导入的工作表', 'NO_TABLE');
    return { ok: true, file: name, size: buf.length, format: 'xlsx', tables: got.tables, warnings: got.warnings };
  }
  if (ext === '.xls') throw fail('旧版 .xls 还不能直接读，请在 Excel 里另存为 .xlsx 或 .csv', 'OLD_XLS');
  throw fail(`不支持的文件类型：${ext || '无扩展名'}。支持 .xlsx / .csv / .tsv`, 'BAD_TYPE');
}

function pickFilters() {
  return [
    { name: 'Excel / CSV', extensions: ['xlsx', 'xlsm', 'csv', 'tsv', 'txt'] },
    { name: 'Excel 工作簿', extensions: ['xlsx', 'xlsm'] },
    { name: 'CSV / TSV', extensions: ['csv', 'tsv', 'txt'] },
  ];
}

module.exports = { parseFile, parseBuffer, pickFilters, MAX_FILE_MB, parseDelimited, guessType };
