// 作者：yxpil
// Excel / CSV 导入建表的永久回归：不依赖 xlsx 包，自己造一个最小 XLSX。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const ti = require('../app/iface/table-import');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok ${passed} - ${name}`); }
  catch (e) { console.error(`  not ok - ${name}`); throw e; }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const payload = Buffer.concat([local, nameBuf, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    locals.push(payload);
    offset += payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

function xlsxFixture() {
  const sst = ['订单号', '客户', '金额', '下单日期', '备注', '张三', '李四', '加急'];
  return zipStore({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets><sheet name="订单明细" sheetId="1" r:id="rId1"/><sheet name="客户" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sst.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    'xl/styles.xml': '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>SO-001</t></is></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>128.5</v></c><c r="D2" s="1"><v>45900</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>SO-002</t></is></c><c r="B3" t="s"><v>6</v></c><c r="C3"><v>99</v></c><c r="D3" s="1"><v>45901</v></c><c r="E3" t="s"><v>7</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>客户名称</t></is></c><c r="B1" t="inlineStr"><is><t>手机号</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>张三</t></is></c><c r="B2" t="inlineStr"><is><t>13800138000</t></is></c></row></sheetData></worksheet>',
  });
}

console.log('table-import regression');
ok('CSV 表头、中文映射与类型推断', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-'));
  const file = path.join(dir, '学生名单.csv');
  fs.writeFileSync(file, '\uFEFF姓名,年龄,手机号,成绩,创建日期,备注\n张三,18,13800138000,95.5,2026-01-02,三好学生\n李四,19,13900139000,88,2026-02-03,\n');
  const r = ti.parseFile(file);
  const t = r.tables[0];
  assert.equal(t.rowCount, 2);
  const by = Object.fromEntries(t.fields.map((f) => [f.name, f]));
  assert.equal(by.name.type, 'varchar');
  assert.equal(by.age.type, 'int');
  assert.equal(by.phone.type, 'varchar');
  assert.equal(by.score.type, 'decimal');
  assert.equal(by.date.type, 'date');
  assert.equal(by.remark.comment, '备注');
  assert.equal(t.preview.rows[0][3], '13800138000');
});

ok('CSV 引号、换行、分号分隔', () => {
  const rows = ti.parseDelimited('名称;备注\n"甲;乙";"第一行\n第二行"\n"含""引号";x\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], '甲;乙');
  assert.equal(rows[1][1], '第一行\n第二行');
  assert.equal(rows[2][0], '含"引号');
});

ok('GBK 中文 CSV 自动解码', () => {
  const b = Buffer.from('0NXD+yzE6sHkLLG416IK1cXI/SwxOCy12tK70NAKwO7LxCwxOSwiuqwstrq6xSIK', 'base64');
  const r = ti.parseBuffer(b, 'gbk.csv');
  assert.equal(r.tables[0].fields[1].name, 'name');
  assert.equal(r.tables[0].preview.rows[0][1], '张三');
});

ok('重复表头、空表头、保留字段名避让', () => {
  const r = ti.parseBuffer(Buffer.from('name,id,created_at,name,,手机号\nA,1,2020-01-01,B,,138\n'), 'dup.csv');
  const names = r.tables[0].fields.map((f) => f.name);
  assert(names.includes('id'));
  assert(names.includes('source_id'));
  assert(names.includes('source_created_at'));
  assert(names.includes('name_2'));
  assert(names.includes('col_5'));
  assert(names.includes('phone'));
});

ok('长数字与手机号不被转成数值', () => {
  const r = ti.parseBuffer(Buffer.from('手机号,编号,金额\n13800138000,00123,12.5\n13900139000,00456,13\n'), 'phone.csv');
  assert.equal(r.tables[0].fields[1].type, 'varchar');
  assert.equal(r.tables[0].fields[2].type, 'varchar');
  assert.equal(r.tables[0].fields[3].type, 'decimal');
});

ok('xlsx 多工作表、共享字符串、内联字符串和日期', () => {
  const r = ti.parseBuffer(xlsxFixture(), 'orders.xlsx');
  assert.equal(r.tables.length, 2);
  assert.equal(r.tables[0].key, 'orders_1');
  assert.equal(r.tables[0].source.sheet, '订单明细');
  assert.equal(r.tables[0].fields.find((f) => f.name === 'order_date').type, 'date');
  assert.equal(r.tables[0].preview.rows[0][4], '2025-08-31');
  assert.equal(r.tables[1].key, 'orders_2');
  assert.equal(r.tables[1].fields[1].name, 'customer_name');
  assert.equal(r.tables[1].preview.rows[0][2], '13800138000');
});

ok('xlsx 走真实文件读取', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-x-'));
  const file = path.join(dir, '订单.xlsx');
  fs.writeFileSync(file, xlsxFixture());
  const r = ti.parseFile(file);
  assert.equal(r.format, 'xlsx');
  assert.equal(r.tables.length, 2);
  assert.equal(r.tables[0].fields[0].name, 'id');
});

ok('.xls 给出明确错误', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-e-'));
  const file = path.join(dir, 'old.xls');
  fs.writeFileSync(file, 'not excel');
  assert.throws(() => ti.parseFile(file), /另存为 \.xlsx/);
});

ok('损坏的 xlsx 被拒绝', () => {
  assert.throws(() => ti.parseBuffer(Buffer.from('not a zip'), 'bad.xlsx'), /不是有效的 \.xlsx/);
});

ok('空 CSV 被拒绝', () => {
  assert.throws(() => ti.parseBuffer(Buffer.from('\n\n'), 'empty.csv'), /文件是空的/);
});

console.log(`\n${passed} passed`);
