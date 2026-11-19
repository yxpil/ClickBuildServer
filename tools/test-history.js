'use strict';

// 工程历史索引验收：使用临时 APPDATA，不碰用户真实工程。
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clickbuild-history-'));
process.env.APPDATA = tmp;

const projects = require(path.join(root, 'app/iface/project-store'));
const spec = require(path.join(root, 'app/iface/spec'));

let ok = 0;
let bad = 0;
const t = (name, cond, extra) => {
  if (cond) { ok++; console.log('  ✓ ' + name); } else { bad++; console.log('  ✗ ' + name + ' → ' + JSON.stringify(extra)); }
};

const a = spec.seedProject();
a.name = '历史测试A';
a.description = '第一个测试工程';
projects.save(a);
const b = JSON.parse(JSON.stringify(a));
b.name = '历史测试B';
b.description = '第二个测试工程';
projects.save(b);

let list = projects.list();
t('历史列出两个工程', list.length === 2, list);
t('按更新时间倒序', list[0].name === '历史测试B', list.map((x) => x.name));
t('列表带文件路径', list.every((x) => x.file && fs.existsSync(x.file)), list);
t('列表带接口与表统计', list[0].count > 0 && Array.isArray(list[0].tables), list[0]);

const dup = projects.duplicate('历史测试A');
t('复制工程成功', dup.ok === true && dup.name === '历史测试A 副本', dup);
t('复制后文件可读', !!projects.load('历史测试A 副本'));
t('复制后列表 3 个', projects.list().length === 3, projects.list().map((x) => x.name));

// 模拟外部删除文件，历史索引仍要保留一条“找不到文件”。
const fileA = path.join(projects.root(), '历史测试A.json');
fs.unlinkSync(fileA);
list = projects.list();
const lost = list.find((x) => x.name === '历史测试A');
t('外部删除后历史仍显示', !!lost, list.map((x) => x.name));
t('缺失工程标记找不到文件', lost && lost.missing === true, lost);

const missingName = '不存在工程X';
projects.save({ ...a, name: missingName });
const fileX = path.join(projects.root(), `${missingName}.json`);
fs.unlinkSync(fileX);
projects.list();
const rm = projects.remove(missingName);
t('删除缺失工程返回 missing', rm.ok === true && rm.missing === true, rm);
t('删除后历史不再出现', !projects.list().some((x) => x.name === missingName), projects.list().map((x) => x.name));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n结果：${ok} 通过，${bad} 失败`);
process.exit(bad ? 1 : 0);
