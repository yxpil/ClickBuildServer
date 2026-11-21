// 作者：yxpil
'use strict';

const services = require('./iface/services');
const projects = require('./iface/project-store');

const STEPS = [
  { id: 'env', label: '环境与工具链', hint: '解释器 / 编译器' },
  { id: 'ports', label: '端口分配', hint: '占用自动避让' },
  { id: 'services', label: '内置服务', hint: 'MariaDB / Redis / RustFS' },
  { id: 'workspace', label: '工作台', hint: '载入工程索引' },
];

// 启动编排：先查环境，再定端口，再起三台服务，最后载入工程索引。
// 每一步都推送状态给启动页，失败也继续往下走，保证主界面能打开并显示原因。
async function runStartup(onUpdate) {
  const send = typeof onUpdate === 'function' ? onUpdate : () => {};
  const started = Date.now();
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    steps: STEPS.map((s) => ({ ...s, status: 'waiting', text: s.hint })),
    tools: [],
    services: {},
    conflicts: [],
    orphans: [],
    ports: null,
    projectCount: 0,
    errors: [],
  };

  const step = (id, status, text, extra) => {
    const s = report.steps.find((x) => x.id === id);
    if (s) { s.status = status; s.text = text; }
    send({ step: { id, status, text }, current: text, ...(extra || {}) });
  };

  send({ steps: report.steps, current: '正在读取启动配置', progress: 0.02 });

  step('env', 'running', '检查本机的解释器和编译环境', { progress: 0.08 });
  let env = { tools: [], available: 0, total: 0 };
  try {
    env = services.environment();
    report.tools = env.tools;
    send({ tools: env.tools });
    const missing = env.tools.filter((t) => !t.available);
    step('env', 'done', `找到 ${env.available}/${env.total} 个可用工具链`, {
      detail: missing.length ? `未找到：${missing.map((t) => t.name).join('、')}` : '全部可用',
      progress: 0.22,
    });
  } catch (e) {
    report.errors.push(`环境检查失败：${e.message}`);
    step('env', 'error', '环境检查失败', { detail: e.message, progress: 0.22 });
  }

  step('ports', 'running', '清理上次遗留的内置服务，再分配端口', { progress: 0.26 });
  let cleaned = { stopped: [] };
  try {
    cleaned = await services.cleanupOrphans();
    report.orphans = cleaned.stopped || [];
  } catch (e) { report.errors.push(`清理遗留服务失败：${e.message}`); }
  step('ports', 'running', '检查端口占用，必要时自动避让', { progress: 0.28 });
  let ports = null;
  try {
    ports = await services.preparePorts();
    report.ports = ports;
    report.conflicts = services.settings().conflicts || [];
    const first = report.conflicts[0];
    const portText = report.conflicts.length === 0
      ? '首选端口全部可用'
      : (report.conflicts.length === 1
        ? `${first.label} 的 ${first.from} 被占用，已改用 ${first.to}`
        : `${report.conflicts.length} 个端口被占用，已自动避让（${first.label} ${first.from}→${first.to} 等）`);
    const cleanText = `上次遗留进程 ${report.orphans.length} 个；`;
    const parts = [];
    if (report.orphans.length) parts.push(`已停止 ${report.orphans.map((x) => `${x.name}(${x.pid})`).join('、')}`);
    parts.push(...report.conflicts.map((c) => `${c.label} ${c.from} → ${c.to}（${c.reason}）`));
    step('ports', 'done', cleanText + portText, { detail: parts.join('；') || `${ports.mysql} / ${ports.redis} / ${ports.s3}`, progress: 0.34, conflicts: report.conflicts });
  } catch (e) {
    report.errors.push(`端口分配失败：${e.message}`);
    step('ports', 'error', '端口分配失败', { detail: e.message, progress: 0.34 });
  }

  step('services', 'running', '启动 MariaDB、Redis 与 RustFS', { progress: 0.38 });
  let infra = {};
  if (ports) {
    let completed = 0;
    try {
      infra = await services.startAll((p) => {
        if (p.status !== 'running') completed += 1;
        send({
          service: { id: p.id, name: p.name, status: p.status, text: p.text, detail: p.detail || '' },
          current: p.text,
          progress: Math.min(0.86, 0.38 + completed * 0.15 + (p.status === 'running' ? 0.05 : 0)),
        });
      });
    } catch (e) {
      report.errors.push(`内置服务启动失败：${e.message}`);
    }
  } else {
    report.errors.push('端口未分配，跳过内置服务');
  }
  report.services = infra;
  const failed = Object.entries(infra).filter(([, v]) => !v || !v.ok);
  if (failed.length) {
    report.errors.push(...failed.map(([k, v]) => `${k} 启动失败：${(v && v.error) || '未知错误'}`));
    step('services', 'error', `${failed.length} 台服务没起来`, { detail: failed.map(([k, v]) => `${k}: ${(v && v.error) || '未知错误'}`).join('；') });
  } else {
    step('services', 'done', '三台内置服务已就绪', { detail: ports ? `MariaDB ${ports.mysql} · Redis ${ports.redis} · RustFS ${ports.s3}` : '', progress: 0.9 });
  }

  step('workspace', 'running', '载入工程索引与最近项目', { progress: 0.92 });
  try {
    const list = projects.list();
    report.projectCount = (list || []).length;
    step('workspace', 'done', `已载入 ${report.projectCount} 个工程`, { detail: '准备进入工作台', progress: 1 });
  } catch (e) {
    report.errors.push(`工程索引读取失败：${e.message}`);
    step('workspace', 'error', '工程索引读取失败', { detail: e.message, progress: 1 });
  }

  report.ok = report.errors.length === 0;
  report.durationMs = Date.now() - started;
  send({ type: 'done', progress: 1, current: report.ok ? '准备完成，正在进入工作台' : '启动完成，有项目需要留意', report });
  return report;
}

module.exports = { runStartup, STEPS };
