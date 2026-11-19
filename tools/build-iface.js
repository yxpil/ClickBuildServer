'use strict';

// 命令行生成入口：和界面里“生成服务”走同一套 codegen
const path = require('path');
const spec = require('../app/iface/spec');
const codegen = require('../app/iface/codegen');
const projects = require('../app/iface/project-store');
const services = require('../app/iface/services');

const args = process.argv.slice(2);
const useSeed = args.includes('--seed');
const name = args.find((a) => !a.startsWith('--')) || projects.boot();
const stored = useSeed ? spec.seedProject() : (projects.load(name) || spec.seedProject());
const project = spec.normalizeProject(stored);
if (useSeed) projects.save(project);
const check = spec.validateProject(project);
if (!check.ok) {
  console.error('校验没过：\n' + check.errors.join('\n'));
  process.exit(1);
}
const outDir = path.join(__dirname, '..', 'generated', 'iface', project.name);
const gen = codegen.writeTo(project, outDir, { port: services.settings().ports.http });
console.log(JSON.stringify({ dir: gen.dir, files: gen.files.length, interfaces: project.interfaces.length }, null, 2));
