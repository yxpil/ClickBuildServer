// 作者：yxpil
// Rust 全栈渲染回归：生成一套真实 Rust 工程，确认无 Node 启动器，并用 cargo 编译。
// 用法：node tools/test-rust-render.js [--no-build]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const templates = require('../app/iface/templates');
const plugins = require('../app/iface/plugins');
const { normalizeProject } = require('../app/generator/ir');
const { generateRust } = require('../app/generator/rust');

const noBuild = process.argv.includes('--no-build');
const outDir = path.join(os.tmpdir(), 'cbs-rust-render');

function write(files) {
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const f of files) {
    const target = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content, 'utf8');
  }
}

function main() {
  const project = plugins.apply(templates.get('builtin:mall').project).project;
  project.lang = 'rust';
  const ir = normalizeProject(project);
  const files = generateRust(ir);
  write(files);

  const checks = [];
  const cargo = fs.readFileSync(path.join(outDir, 'Cargo.toml'), 'utf8');
  const mainRs = fs.readFileSync(path.join(outDir, 'src', 'main.rs'), 'utf8');
  checks.push(['产物含 Cargo.toml', /axum/.test(cargo) && /sqlx/.test(cargo)]);
  checks.push(['产物含原生 main.rs', mainRs.includes('async fn main()')]);
  checks.push(['没有 Node 启动器', !files.some((f) => /launcher|server\.js/.test(f.path))]);
  checks.push(['路由文件按模块生成', files.filter((f) => f.path.startsWith('src/api/')).length >= 3]);
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  const failed = checks.filter(([name, ok]) => !ok);
  if (failed.length) process.exitCode = 1;

  if (noBuild) {
    console.log(`\n${checks.length - failed.length} passed（跳过 cargo）`);
    return;
  }
  console.log('\n运行 cargo check ...');
  const r = spawnSync('cargo', ['check', '--quiet'], { cwd: outDir, encoding: 'utf8', timeout: 600000, shell: true });
  if (r.status !== 0) {
    console.error(r.stdout || '');
    console.error(r.stderr || '');
    console.error('FAIL cargo check');
    process.exitCode = 1;
    return;
  }
  console.log(`ok   cargo check`);
  console.log(`\n${checks.length + 1} passed`);
}

main();
