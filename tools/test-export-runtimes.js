'use strict';
/*
导出多语言回归：把工程导出到临时目录，编译 Java / Go 路由骨架，
再用 Node / Bun / Java / Go 四种启动器分别拉起同一个生成服务。
用法：
  node tools/test-export-runtimes.js
  node tools/test-export-runtimes.js --no-serve
  node tools/test-export-runtimes.js --project <工程.json> --go <go.exe>
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const projectExport = require('../app/iface/project-export');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const noServe = args.includes('--no-serve');
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const projectFile = argValue('--project', path.join(ROOT, 'app', 'iface', 'cases', 'social.json'));
const goExe = argValue('--go', 'go');

let passed = 0;
let failed = 0;
function t(name, ok, detail) {
  if (ok) { passed += 1; console.log('  ✓ ' + name); }
  else { failed += 1; console.log('  ✗ ' + name + (detail ? ' → ' + JSON.stringify(detail) : '')); }
}
function has(cmd) {
  const r = spawnSync(cmd, cmd.endsWith('go') || cmd.endsWith('go.exe') ? ['version'] : ['--version'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}
function hasNpm() {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8', windowsHide: true, shell: true });
  return r.status === 0;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

(async () => {
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  const base = path.join(os.tmpdir(), 'icb-export-runtime-' + Date.now());
  fs.mkdirSync(base, { recursive: true });
  const written = projectExport.writeProject(project, base, { port: 19120, errors: null });
  const dir = written.dir;
  console.log('· 导出目录 ' + dir);

  const javaFiles = fs.readdirSync(path.join(dir, 'export', 'java')).filter((f) => f.endsWith('.java'));
  const goFiles = fs.readdirSync(path.join(dir, 'export', 'go')).filter((f) => f.endsWith('.go'));
  t('导出 Java 路由骨架', javaFiles.length > 0, javaFiles.length);
  t('导出 Go 路由骨架', goFiles.length > 0, goFiles.length);
  t('导出 Go 模块', fs.existsSync(path.join(dir, 'go.mod')));
  t('导出 Java 启动器', fs.existsSync(path.join(dir, 'launcher', 'Server.java')));
  t('导出 Go 启动器', fs.existsSync(path.join(dir, 'launcher', 'main.go')));
  t('导出 Python Flask 运行时', fs.existsSync(path.join(dir, 'native', 'python', 'app.py')));
  t('导出 Python service.json', fs.existsSync(path.join(dir, 'native', 'python', 'service.json')));
  t('导出 Python 依赖清单', fs.existsSync(path.join(dir, 'native', 'python', 'requirements.txt')));
  const configFile = path.join(dir, 'config.json');
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  t('导出根目录 config.json', fs.existsSync(configFile));
  t('config.json 含 21 个可改参数', Object.keys(config).length === 21 && config.PORT === 19120, { keys: Object.keys(config).length, port: config.PORT });
  t('config.json 含数据库/缓存/对象存储键', ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DB', 'REDIS_PORT', 'S3_PORT', 'MAX_BODY_MB'].every((k) => k in config));
  const envFile = path.join(dir, '.env');
  const envLines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.trim()) : ['missing'];
  t('.env 只作为注释示例，不覆盖 config.json', envLines.every((l) => l.trim().startsWith('#')));
  t('Java 类名与文件名一致', javaFiles.every((f) => {
    const src = fs.readFileSync(path.join(dir, 'export', 'java', f), 'utf8');
    const m = src.match(/public\s+class\s+([A-Za-z_$][\w$]*)/);
    return m && m[1] + '.java' === f;
  }));
  t('Java 类名无重复', new Set(javaFiles).size === javaFiles.length);
  t('Go 路由函数无重复', new Set(goFiles.map((f) => {
    const src = fs.readFileSync(path.join(dir, 'export', 'go', f), 'utf8');
    const m = src.match(/func\s+(Handle[A-Za-z0-9_]+)/);
    return m ? m[1] : f;
  })).size === goFiles.length);

  if (has('javac')) {
    const out = path.join(base, 'java-out');
    const r = spawnSync('javac', ['-encoding', 'UTF-8', '-d', out, ...javaFiles.map((f) => path.join(dir, 'export', 'java', f))], { encoding: 'utf8', windowsHide: true });
    const classes = fs.existsSync(out) ? fs.readdirSync(out, { recursive: true }).filter((f) => String(f).endsWith('.class')).length : 0;
    t('全部 Java 路由骨架编译通过', r.status === 0 && classes >= javaFiles.length, r.stderr.slice(0, 500));
  } else t('跳过 Java 编译（未安装 javac）', true);

  if (has(goExe)) {
    const r = spawnSync(goExe, ['build', './export/go'], { cwd: dir, encoding: 'utf8', windowsHide: true, env: { ...process.env } });
    t('全部 Go 路由骨架编译通过', r.status === 0, (r.stderr || r.stdout).slice(0, 500));
    const rb = spawnSync(goExe, ['build', '-o', path.join(base, 'launcher.exe'), './launcher'], { cwd: dir, encoding: 'utf8', windowsHide: true, env: { ...process.env } });
    t('Go 启动器编译通过', rb.status === 0, (rb.stderr || rb.stdout).slice(0, 500));
  } else t('跳过 Go 编译（未安装 go）', true);

  if (noServe) {
    console.log(`\n结果：${passed} 通过，${failed} 失败（--no-serve 已跳过运行时启动）`);
    process.exit(failed ? 1 : 0);
  }

  if (!fs.existsSync(path.join(dir, 'node_modules', 'mysql2')) && hasNpm()) {
    const ni = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 180000, shell: true });
    t('导出工程 npm install 成功', ni.status === 0, (ni.stderr || ni.stdout || '').slice(-800));
  }

  const runtimes = [
    { name: 'Node', cmd: process.execPath, args: ['server.js'], port: 19121 },
    { name: 'Bun', cmd: path.join(process.env.APPDATA || '', 'npm', 'bun.cmd'), args: ['server.js'], port: 19122, shell: true },
    { name: 'Java 启动器', cmd: 'java', args: ['launcher/Server.java', 'server.js'], port: 19123, nodeBin: true },
    { name: 'Go 启动器', cmd: goExe, args: ['run', 'launcher/main.go', 'server.js'], port: 19124, nodeBin: true },
  ];

  for (const rt of runtimes) {
    if (rt.name === 'Bun' && !fs.existsSync(rt.cmd)) { t('跳过 Bun（未找到 bun.cmd）', true); continue; }
    if (rt.name === 'Java 启动器' && !has('java')) { t('跳过 Java 启动器（未安装 java）', true); continue; }
    if (rt.name === 'Go 启动器' && !has(goExe)) { t('跳过 Go 启动器（未安装 go）', true); continue; }
    let child;
    let log = '';
    let ok = false;
    let detail = '';
    try {
      child = spawn(rt.cmd, rt.args, {
        cwd: dir,
        shell: !!rt.shell,
        windowsHide: true,
        env: { ...process.env, PORT: String(rt.port), NODE_BIN: rt.nodeBin ? process.execPath : undefined },
      });
      child.stdout.on('data', (d) => { log += d.toString(); });
      child.stderr.on('data', (d) => { log += d.toString(); });
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        try {
          const res = await fetch(`http://127.0.0.1:${rt.port}/_meta`);
          if (res.ok) {
            const j = await res.json();
            const routes = await fetch(`http://127.0.0.1:${rt.port}/_routes`).then((r) => r.json());
            ok = j && j.name === project.name && Array.isArray(routes.routes);
            detail = { status: res.status, name: j && j.name, routes: routes.routes && routes.routes.length };
            break;
          }
        } catch (e) { /* 还没起来 */ }
      }
    } catch (err) {
      detail = err.message;
    } finally {
      killTree(child);
    }
    t(`${rt.name} 启动导出服务并响应 /_meta、/_routes`, ok, ok ? detail : { detail, log: log.slice(-1500) });
    await sleep(1000);
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
