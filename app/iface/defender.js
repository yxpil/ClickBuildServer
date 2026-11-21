// 作者：yxpil
'use strict';

// Windows Defender 信任目录：把工程目录、内置运行时目录加进排除项，
// 避免生成的 server.js / node.exe 被实时扫描拖慢或被误删。
// 需要管理员权限；失败时把原因原样带回去，不假装成功。

const path = require('path');
const { execFile } = require('child_process');
const store = require('../store');

const REPO = store.resourceRoot();

function ps(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 90000 }, (err, out, errOut) => {
      resolve({ ok: !err, out: String(out || '').trim(), err: String(errOut || (err && err.message) || '').trim() });
    });
  });
}

function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function list() {
  if (process.platform !== 'win32') return { ok: false, error: '只有 Windows 有 Defender' };
  const r = await ps('$p = Get-MpPreference; [pscustomobject]@{ paths = @($p.ExclusionPath); processes = @($p.ExclusionProcess) } | ConvertTo-Json -Depth 3');
  if (!r.ok) return { ok: false, error: r.err || '读取 Defender 设置失败' };
  try {
    const data = JSON.parse(r.out || '{}');
    return { ok: true, paths: data.paths || [], processes: data.processes || [] };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function trust(extraPaths) {
  if (process.platform !== 'win32') return { ok: false, error: '只有 Windows 有 Defender' };
  const paths = [...new Set([
    REPO,
    path.join(REPO, 'runtime'),
    path.join(REPO, 'runtime', 'node'),
    path.join(REPO, 'generated'),
    path.join(REPO, 'node_modules'),
    store.defaultGeneratedRoot(),
    ...(Array.isArray(extraPaths) ? extraPaths : []),
  ].filter(Boolean))];
  const commands = paths.map((p) => `Add-MpPreference -ExclusionPath ${q(p)}`);
  commands.push("Add-MpPreference -ExclusionProcess 'node.exe'", "Add-MpPreference -ExclusionProcess 'electron.exe'");
  const r = await ps(commands.join('; '));
  if (!r.ok) {
    const hint = /denied|拒绝|权限|administrator|管理员/i.test(r.err)
      ? '需要以管理员身份运行 ClickBuildServer 才能写排除项。'
      : '';
    return { ok: false, error: [r.err, hint].filter(Boolean).join(' ') || '写入失败', paths };
  }
  const now = await list();
  return { ok: true, paths, ...now };
}

module.exports = { list, trust, REPO };
