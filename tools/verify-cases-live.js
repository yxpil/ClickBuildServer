// 作者：yxpil
// 逐套启动真实生成服务：验证首页是业务应用、公开列表接口真实返回、进程可退出。
// 前置：本机 MariaDB 13306、Redis 16379 已启动。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const codegen = require('../app/iface/codegen');

const NODE = process.execPath;
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'clickbuild-cases-live');
const PORT = 18997;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function get(base, p) {
  const r = await fetch(base + p, { headers: { accept: 'application/json' } });
  return { status: r.status, text: await r.text() };
}

async function waitHealth(base, child) {
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode != null) throw new Error('服务提前退出 ' + child.exitCode);
    try {
      const r = await fetch(base + '/_health');
      if (r.ok) return;
    } catch (e) { /* 等待端口 */ }
    await sleep(250);
  }
  throw new Error('健康检查超时');
}

function publicRoute(p) {
  const app = p.frontend && p.frontend.project && p.frontend.project.app;
  for (const it of (p.interfaces || [])) {
    for (const r of (it.routes || [])) {
      if (String(r.method).toUpperCase() !== 'GET') continue;
      if (r.auth) continue;
      if (String(r.path).includes(':')) continue;
      return { url: '/api' + (it.basePath || '') + r.path, name: r.name };
    }
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(path.join(ROOT, 'app', 'iface', 'cases'))
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !process.argv.slice(2).length || process.argv.slice(2).some((k) => f.includes(k)))
    .sort();
  const results = [];
  for (const file of files) {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'iface', 'cases', file), 'utf8'));
    const db = 'cbs_live_' + String(p.code || file.replace('.json', '')).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (p.connections && Array.isArray(p.connections.mysql)) {
      p.connections.mysql.forEach((c) => { c.database = db; });
    }
    const code = String(p.name || file).replace(/[^\w\u4e00-\u9fa5-]/g, '_');
    const dir = path.join(OUT, code);
    fs.rmSync(dir, { recursive: true, force: true });
    codegen.writeTo(p, dir, { port: PORT });
    const child = spawn(NODE, ['server.js'], {
      cwd: dir,
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(PORT),
        MYSQL_PORT: '13306',
        MYSQL_DB: db,
        REDIS_PORT: '16379',
        RESET_DB: '1',
        NODE_PATH: path.join(ROOT, 'node_modules'),
        CACHE_PREFIX: 'icb:live:' + Date.now() + ':' + code,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const base = `http://127.0.0.1:${PORT}`;
    const errs = [];
    try {
      await waitHealth(base, child);
      const home = await get(base, '/');
      const html = home.text;
      const app = p.frontend && p.frontend.project && p.frontend.project.app;
      if (home.status !== 200) errs.push('首页状态 ' + home.status);
      if (html.length < 8000) errs.push('首页过小 ' + html.length);
      if (app) {
        if (!html.includes('window.CASE =')) errs.push('首页缺业务运行时');
        if (!html.includes('id="app"')) errs.push('首页缺应用容器');
        const nav = Array.isArray(app.nav) ? app.nav.length : 0;
        if (nav < 1) errs.push('导航过少 ' + nav);
      }
      if (/接口清单|CASE FRONTEND|API 调试/.test(html)) errs.push('首页仍是接口清单');
      const route = publicRoute(p);
      if (route) {
        const api = await get(base, route.url);
        let body = null;
        try { body = JSON.parse(api.text); } catch (e) { /* 非 JSON */ }
        if (api.status !== 200 || !body || body.ok !== true) errs.push(`${route.name} ${route.url} -> ${api.status}`);
      }
      results.push({ file, ok: errs.length === 0, note: `${html.length} B / ${route ? route.url : '无公开 GET'}`, errs });
      console.log(`${errs.length ? 'FAIL' : 'PASS'}  ${p.name}  ${results[results.length - 1].note}${errs.length ? '  ' + errs.join(' | ') : ''}`);
    } catch (e) {
      results.push({ file, ok: false, note: e.message, errs: [e.message] });
      console.log(`FAIL  ${p.name}  ${e.message}`);
    } finally {
      child.kill();
      await sleep(300);
      if (child.exitCode == null) child.kill('SIGKILL');
    }
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  console.log('产物目录：' + OUT);
  process.exit(failed.length ? 1 : 0);
})();
