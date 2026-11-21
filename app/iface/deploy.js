// 作者：yxpil
'use strict';

// 更新部署：保存当前工程后，重新生成前后端文件并重启生成服务。
// 与“生成服务”不同，这里会复用当前正在运行的服务目录，确保代码和前端一起生效。
const fs = require('fs');
const path = require('path');

const spec = require('./spec');
const codegen = require('./codegen');
const plugins = require('./plugins');
const services = require('./services');
const store = require('../store');

function safeDirName(name) {
  return String(name || '接口服务').replace(/[\\/:*?"<>|]/g, '_');
}

// 只清理生成器自己的产物：接口模块目录和编号 SQL、旧的生成首页/前端目录。
// src/modules/_ 开头的目录、用户自己加的 SQL 和非生成文件都保留。
function pruneGenerated(dir, files) {
  const keepModules = new Set();
  const keepSql = new Set();
  const keepPublicIndex = files.includes('public/index.html');
  const keepFrontend = files.some((f) => String(f).startsWith('frontend/'));

  for (const rel of files) {
    const m = /^src\/modules\/([^/]+)\//.exec(rel);
    if (m) keepModules.add(m[1]);
    const s = /^sql\/([^/]+)$/.exec(rel);
    if (s) keepSql.add(s[1]);
  }

  const modulesDir = path.join(dir, 'src', 'modules');
  if (fs.existsSync(modulesDir)) {
    for (const ent of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (keepModules.has(ent.name) || ent.name.startsWith('_')) continue;
      fs.rmSync(path.join(modulesDir, ent.name), { recursive: true, force: true });
    }
  }

  const sqlDir = path.join(dir, 'sql');
  if (fs.existsSync(sqlDir)) {
    for (const ent of fs.readdirSync(sqlDir, { withFileTypes: true })) {
      if (!ent.isFile() || !/^\d{2}_.*\.sql$/.test(ent.name) || keepSql.has(ent.name)) continue;
      fs.rmSync(path.join(sqlDir, ent.name), { force: true });
    }
  }

  const publicIndex = path.join(dir, 'public', 'index.html');
  if (!keepPublicIndex && fs.existsSync(publicIndex)) fs.rmSync(publicIndex, { force: true });

  const frontendDir = path.join(dir, 'frontend');
  if (!keepFrontend && fs.existsSync(frontendDir)) fs.rmSync(frontendDir, { recursive: true, force: true });
}

function targetDir(project, opts, prev) {
  if (opts.dir) return opts.dir;
  if (prev.dir && fs.existsSync(prev.dir)) return prev.dir;
  return path.join(store.defaultGeneratedRoot(), 'iface', safeDirName(project.name));
}

async function deploy(project, opts) {
  const o = opts || {};
  const base = spec.normalizeProject(project);
  const plugged = plugins.apply(base);
  const p = plugged.project;
  const v = spec.validateProject(p);
  if (!v.ok) return { ok: false, error: v.errors.join('\n'), problems: v.errors };

  const prev = services.serverInfo();
  const target = targetDir(p, o, prev);
  const wasRunning = !!(prev.child && !prev.child.killed);
  const runtime = o.runtime || prev.runtime || 'node';
  const hot = wasRunning ? !!prev.hot : !!o.hot;
  const port = services.settings().ports.http;

  // 端口被非本应用启动的服务占用时不能安全覆盖：先明确报错，避免生成完却起不来。
  if (!wasRunning && await services.isPortOpen(port)) {
    return { ok: false, dir: target, error: `端口 ${port} 已被其他进程占用，请先停止后再更新部署` };
  }

  if (wasRunning) {
    await services.stopServer();
    if (!(await services.waitPortClosed(port, 4000))) {
      return { ok: false, dir: target, error: `旧服务已停止，但端口 ${port} 仍被占用，未写入也没有重启` };
    }
  }

  let gen;
  try {
    gen = codegen.writeTo(p, target, { port });
    pruneGenerated(target, gen.files);
  } catch (e) {
    if (wasRunning) await services.startServer(target, { runtime, hot }).catch(() => {});
    return { ok: false, dir: target, error: '写入生成目录失败：' + String((e && e.message) || e) };
  }

  let started;
  try {
    started = await services.startServer(target, { runtime, hot });
  } catch (e) {
    started = { ok: false, error: String((e && e.message) || e) };
  }
  if (started.ok === false) {
    return { ok: false, dir: target, files: gen.files, error: started.error || '生成服务启动失败' };
  }

  const listening = await services.isPortOpen(port);
  if (!listening) {
    return { ok: false, dir: target, files: gen.files, error: `更新已写入，但服务没有监听 ${port}，请查看日志` };
  }

  return {
    ok: true,
    dir: target,
    files: gen.files,
    warnings: plugged.warnings || [],
    restarted: wasRunning,
    started: !wasRunning,
    runtime,
    hot,
    port,
    at: new Date().toISOString(),
  };
}

module.exports = { deploy, pruneGenerated, targetDir };
