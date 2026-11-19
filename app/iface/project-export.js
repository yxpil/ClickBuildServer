'use strict';

// 把一个接口工程导出成独立目录：源码、文档、SQL、依赖描述都在里面。
// 带一套极简 .idea 配置，IntelliJ IDEA 选“打开”就能直接认出工程；
// 不写任何用户目录，工程内的路径全部使用 IDEA 的 $PROJECT_DIR$ 变量。

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');
const spec = require('./spec');
const codegen = require('./codegen');

function safeName(text) {
  return String(text || '接口工程').replace(/[\\/:*?"<>|]/g, '_').replace(/^\s+|\s+$/g, '') || '接口工程';
}

function uniqueDir(parent, name) {
  const base = path.join(parent, safeName(name));
  if (!fs.existsSync(base)) return base;
  for (let i = 2; i < 100; i++) {
    const next = `${base}-${i}`;
    if (!fs.existsSync(next)) return next;
  }
  return `${base}-${Date.now()}`;
}

function readme(projectName) {
  return `# 用 IntelliJ IDEA 打开

这个目录是 ClickBuild 导出的完整工程，已经带 \`.idea\` 配置。

1. IDEA 菜单 **File → Open**，选择本目录（${projectName}）。
2. 首次打开如提示选择 Node 解释器，指向系统 \`node.exe\`；IDEA Ultimate 已内置 JavaScript / Node.js 插件。
3. 终端执行：

\`\`\`bash
npm install
npm start
\`\`\`

默认端口 ${codegen.DEFAULT_PORTS.http}，启动后打开 \`http://127.0.0.1:${codegen.DEFAULT_PORTS.http}/\`。
数据库、Redis、S3 连接在 \`.env\` 里改；本机没装这三样时，先在 ClickBuild 里启动内置服务。

工程里的 \`server.js\` 是入口，\`src/modules/\` 每个目录是一个接口模块，\`src/\` 还有解释器，\`sql/\` 是建表脚本，\`docs/\` 是接口文档，\`export/\` 是每条路由的 JS / Java / Go 参考实现。

## 启动方式

- Node：\`node server.js\`；热部署：\`node dev.js\`（监听 src/public/sql/interfaces.json 自动重启）。
- Bun：\`bun server.js\`；热部署：\`bun dev.js\`。
- Java 启动器（JDK 11+）：\`java launcher/Server.java\`；热部署传 \`dev.js\`。
- Go 启动器：\`go run launcher/main.go\`；热部署传 \`dev.js\`；\`export/go/\` 路由骨架可 \`go build ./export/go\` 编译检查。

## 错误页

浏览器请求 404/500 默认显示错误页，API 客户端仍收到 JSON。预览：\`/_errors/404\`、\`/_errors/500\`；导出时可以在 ClickBuild 里关闭错误页或 500 详情。
`;
}

function gitignore() {
  return `node_modules/
.env.local
daemon/daemon.log
.idea/workspace.xml
.idea/usage.statistics.xml
.idea/shelf/
`;
}

function writeProject(project, parentDir, opts) {
  const p = spec.normalizeProject(project);
  if (opts && opts.errors) p.errors = { ...p.errors, ...opts.errors };
  const parent = parentDir || os.tmpdir();
  const dir = uniqueDir(parent, p.name);
  const gen = codegen.writeTo(p, dir, { port: (opts && opts.port) || codegen.DEFAULT_PORTS.http, ide: true });
  fs.writeFileSync(path.join(dir, 'README-IDEA.md'), readme(p.name), 'utf8');
  fs.writeFileSync(path.join(dir, '.gitignore'), gitignore(), 'utf8');
  return {
    ok: true,
    dir,
    name: p.name,
    files: [...gen.files, '.gitignore', 'README-IDEA.md'],
  };
}

function ideaCandidates() {
  const out = [];
  const env = process.env;
  const push = (p) => { if (p && fs.existsSync(p)) out.push(p); };
  if (env.IDEA_HOME) {
    push(path.join(env.IDEA_HOME, 'bin', 'idea64.exe'));
    push(path.join(env.IDEA_HOME, 'bin', 'idea.exe'));
  }
  const roots = [
    env.ProgramFiles && path.join(env.ProgramFiles, 'JetBrains'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'JetBrains'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'JetBrains', 'Toolbox', 'apps'),
  ].filter(Boolean);
  for (const root of roots) {
    let names = [];
    try { names = fs.readdirSync(root); } catch (e) { continue; }
    for (const name of names) {
      if (!/^IntelliJ IDEA/i.test(name) && !/^IDEA/i.test(name)) continue;
      push(path.join(root, name, 'bin', 'idea64.exe'));
      push(path.join(root, name, 'bin', 'idea.exe'));
    }
  }
  try {
    const where = execFileSync('where.exe', ['idea64.exe'], { encoding: 'utf8', windowsHide: true });
    String(where).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach(push);
  } catch (e) { /* 没装或不在 PATH */ }
  return [...new Set(out)];
}

function openInIdea(dir) {
  if (process.platform !== 'win32') return { ok: false, error: '目前只处理 Windows 上的 IDEA' };
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: '工程目录不存在' };
  const exe = ideaCandidates()[0];
  if (!exe) return { ok: false, error: '没有找到 IntelliJ IDEA，可先打开目录再手动 File → Open', dir };
  try {
    const child = spawn(exe, [dir], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return { ok: true, exe, dir, pid: child.pid };
  } catch (err) {
    return { ok: false, error: err.message, dir };
  }
}

module.exports = { safeName, uniqueDir, writeProject, ideaCandidates, openInIdea };
