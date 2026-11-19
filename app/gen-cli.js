'use strict';

const fs = require('fs');
const path = require('path');
const gen = require('./generator');
const { MODULES } = require('./catalog');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function allModules() {
  return MODULES.map((m) => m.id);
}

function summarize(label, files) {
  let bytes = 0;
  files.forEach((f) => (bytes += Buffer.byteLength(String(f.content))));
  console.log(`\n[${label}]`);
  console.log(`  文件 ${files.length} 个 / ${(bytes / 1024).toFixed(1)} KB`);
  const byExt = {};
  files.forEach((f) => {
    const ext = path.extname(f.path) || '(none)';
    byExt[ext] = (byExt[ext] || 0) + 1;
  });
  console.log('  ' + Object.entries(byExt).map(([e, n]) => `${e}:${n}`).join('  '));
}

function runOne(name, project, outRoot) {
  const { ir, files, warnings } = gen.generate(project);
  summarize(name, files);
  if (warnings.length) warnings.forEach((w) => console.log('  ! ' + w));
  const dir = path.join(outRoot, project.name || name);
  gen.writeTo(dir, files);
  console.log('  -> ' + dir);
  return { ir, files, dir };
}

function usage() {
  console.log(`ClickBuildServer 生成器 CLI

  node app/gen-cli.js [选项]

  --project <file>     读取项目 JSON（默认空项目）
  --lang <java|node|go|rust>  目标语言
  --package <jar|war>  仅 Java：打包方式
  --modules a,b,c      指定模块
  --all-modules        全部模块
  --name <name>        项目名（同时作为输出子目录）
  --out <dir>          输出根目录（默认 generated/）
  --zip                额外产出 zip
  --self-test          生成演示工程并自检
  --help               显示本帮助`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(args.out || path.join(__dirname, '..', 'generated'));

  if (args.help || args.h) {
    usage();
    return;
  }

  if (args['self-test']) {
    const base = gen.blankProject();
    const javaJar = JSON.parse(JSON.stringify(base));
    javaJar.name = 'demo-java-jar';
    runOne('java-jar', javaJar, outRoot);

    const javaWar = JSON.parse(JSON.stringify(base));
    javaWar.name = 'demo-java-war';
    javaWar.packageType = 'war';
    javaWar.modules = allModules();
    javaWar.redis = { ...javaWar.redis, enabled: true };
    javaWar.search = { ...javaWar.search, engine: 'elasticsearch' };
    javaWar.storage = { ...javaWar.storage, provider: 'minio' };
    javaWar.database = { ...javaWar.database, cluster: { enabled: true, readHosts: ['127.0.0.1:3307'] } };
    javaWar.integrations = { ...javaWar.integrations, nginx: true, tenant: true };
    runOne('java-war-all', javaWar, outRoot);

    const rust = JSON.parse(JSON.stringify(base));
    rust.name = 'demo-rust';
    rust.lang = 'rust';
    rust.modules = allModules();
    rust.redis = { ...rust.redis, enabled: true, mode: 'cluster' };
    rust.storage = { ...rust.storage, provider: 'minio' };
    rust.database = { ...rust.database, cluster: { enabled: true, readHosts: ['127.0.0.1:3307'] } };
    rust.fileSources = [
      { name: 'student', comment: '学生名单', engine: 'csv', filePath: 'data/student.csv', columns: 'id|varchar(64)|编号|req\nname|varchar(64)|姓名|search\nage|int|年龄' },
      { name: 'course', comment: '课程表', engine: 'json', filePath: 'data/course.json', columns: 'id|varchar(64)|编号|req\ntitle|varchar(128)|名称|search' },
    ];
    runOne('rust-all', rust, outRoot);

    const node = JSON.parse(JSON.stringify(javaWar));
    node.name = 'demo-node';
    node.lang = 'node';
    runOne('node-all', node, outRoot);

    const go = JSON.parse(JSON.stringify(javaWar));
    go.name = 'demo-go';
    go.lang = 'go';
    runOne('go-all', go, outRoot);

    const zipBuf = gen.zipBuffer(gen.generate(base).files, 'demo-java-jar');
    const zipPath = path.join(outRoot, 'demo-java-jar.zip');
    fs.writeFileSync(zipPath, zipBuf);
    console.log(`\n[zip] ${zipPath} (${(zipBuf.length / 1024).toFixed(1)} KB)`);
    console.log('\nself-test 完成');
    return;
  }

  let project = gen.blankProject();
  if (args.project) {
    project = JSON.parse(fs.readFileSync(path.resolve(args.project), 'utf8'));
  }
  if (args.lang) project.lang = args.lang;
  if (args.war) project.packageType = 'war';
  if (args.modules) project.modules = String(args.modules).split(',').filter(Boolean);
  if (args.name) project.name = args.name;
  if (args['all-modules']) project.modules = allModules();

  const { ir, files } = runOne(args.name || project.name || 'server', project, outRoot);
  if (args.zip) {
    const zipPath = path.join(outRoot, (project.name || 'server') + '.zip');
    fs.writeFileSync(zipPath, gen.zipBuffer(files, project.name || 'server'));
    console.log('  zip -> ' + zipPath);
  }
  console.log(`\n模块 ${ir.stats.modules} / 表 ${ir.stats.tables} / 权限 ${ir.stats.permissions}`);
}

main();
