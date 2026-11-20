'use strict';

// 三类工作任务：只前端 / 只后端 / 混合（默认）。用临时 APPDATA，不碰真实工程。
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clickbuild-tasktype-'));
process.env.APPDATA = tmp;

const projects = require(path.join(root, 'app/iface/project-store'));
const spec = require(path.join(root, 'app/iface/spec'));

let ok = 0;
let bad = 0;
const t = (name, cond, extra) => {
  if (cond) { ok++; console.log('  ✓ ' + name); } else { bad++; console.log('  ✗ ' + name + ' → ' + JSON.stringify(extra)); }
};

t('任务类型常量覆盖三种', spec.TASK_TYPES.join(',') === 'frontend,backend,mixed', spec.TASK_TYPES);
t('示例工程默认混合任务', spec.seedProject().taskType === 'mixed', spec.seedProject().taskType);

for (const kind of ['frontend', 'backend', 'mixed']) {
  const p = spec.normalizeProject({ ...spec.seedProject(), taskType: kind });
  t(`保存后保留 ${kind}`, p.taskType === kind, p.taskType);
}
const badKind = spec.normalizeProject({ ...spec.seedProject(), taskType: 'unknown' });
t('非法任务类型回退为混合', badKind.taskType === 'mixed', badKind.taskType);
const legacy = spec.normalizeProject({ name: '旧工程', interfaces: [] });
t('旧工程没有字段时默认混合', legacy.taskType === 'mixed', legacy.taskType);

const front = spec.normalizeProject({ ...spec.seedProject(), name: '只前端任务', taskType: 'frontend', interfaces: [] });
front.description = '只写页面';
const file = projects.save(front);
t('只前端任务落盘', fs.existsSync(file), file);
t('重新读取仍是只前端', projects.load('只前端任务').taskType === 'frontend', projects.load('只前端任务').taskType);
const list = projects.list();
const entry = list.find((x) => x.name === '只前端任务');
t('历史索引带任务类型', !!entry && entry.taskType === 'frontend', entry);
t('历史索引统计空白接口为 0', entry.count === 0, entry.count);

const copy = projects.duplicate('只前端任务');
t('复制工程保留任务类型', copy.ok && copy.project.taskType === 'frontend', copy.project && copy.project.taskType);

const back = spec.normalizeProject({ ...spec.seedProject(), name: '只后端任务', taskType: 'backend', interfaces: [] });
projects.save(back);
const mixed = spec.normalizeProject({ ...spec.seedProject(), name: '混合任务', taskType: 'mixed' });
projects.save(mixed);
const kinds = projects.list().map((x) => `${x.name}:${x.taskType}`);
t('三种任务都能并存', ['只前端任务:frontend', '只后端任务:backend', '混合任务:mixed'].every((k) => kinds.includes(k)), kinds);

console.log(`\n通过 ${ok} / ${ok + bad}${bad ? '，失败 ' + bad : '，全部通过'}`);
process.exit(bad ? 1 : 0);
