// 作者：yxpil
'use strict';

// 底部状态条的硬件/进程资源采样。这里只读，不启动、不停止任何服务。
// 采样策略：系统 CPU/内存/磁盘/网络每次调用都取；tasklist 全量扫描较重，按 PID 集合缓存 6 秒。
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');
const store = require('../store');

let prevCpu = null;
let prevNet = null;
let taskCache = { at: 0, key: '', map: null };

function sumCpus() {
  const list = os.cpus();
  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;
  for (const c of list) {
    user += c.times.user;
    nice += c.times.nice;
    sys += c.times.sys;
    idle += c.times.idle;
    irq += c.times.irq;
  }
  return { user, nice, sys, idle, irq, total: user + nice + sys + idle + irq, cores: list.length };
}

function sampleCpu() {
  const cur = sumCpus();
  let percent = null;
  if (prevCpu && cur.total > prevCpu.total) {
    const dt = cur.total - prevCpu.total;
    const di = cur.idle - prevCpu.idle;
    percent = Math.max(0, Math.min(100, 100 * (1 - di / dt)));
  }
  prevCpu = cur;
  return { percent, cores: cur.cores };
}

function sampleMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return { total, free, used, percent: total ? (used / total) * 100 : 0 };
}

function sampleDisk() {
  try {
    const root = path.parse(store.root()).root || 'C:\\';
    const st = fs.statfsSync(root);
    const total = Number(st.bsize) * Number(st.blocks);
    const free = Number(st.bsize) * Number(st.bavail);
    const used = total - free;
    return {
      root,
      label: root.replace(/\\$/, ''),
      total,
      free,
      used,
      percent: total ? (used / total) * 100 : 0,
    };
  } catch (e) {
    return null;
  }
}

function sampleNet() {
  try {
    const out = String(execFileSync('netstat.exe', ['-e'], { encoding: 'utf8', windowsHide: true, timeout: 4000 }) || '');
    // netstat 的表头会跟随系统语言（中文系统是“字节”），不能按 Bytes 匹配；
    // 第一行“两个数字列”就是累计收/发字节。
    let m = null;
    for (const line of out.split(/\r?\n/)) {
      m = line.match(/^[^\d]*([\d,]+)\s+([\d,]+)\s*$/);
      if (m) break;
    }
    if (!m) {
      const alt = out.match(/^\s*Bytes\s+(\d+)\s+(\d+)\s*$/mi);
      if (!alt) return null;
      m = alt;
    }
    const rx = Number(String(m[1]).replace(/,/g, ''));
    const tx = Number(String(m[2]).replace(/,/g, ''));
    const now = Date.now();
    let rxRate = 0;
    let txRate = 0;
    if (prevNet && now > prevNet.at) {
      const dt = (now - prevNet.at) / 1000;
      rxRate = Math.max(0, (rx - prevNet.rx) / dt);
      txRate = Math.max(0, (tx - prevNet.tx) / dt);
    }
    prevNet = { at: now, rx, tx };
    return { rx, tx, rxRate, txRate };
  } catch (e) {
    return null;
  }
}

function sampleApp() {
  try {
    const metrics = app.getAppMetrics();
    let cpu = 0;
    let memKb = 0;
    const kinds = {};
    for (const m of metrics) {
      const p = Number(m.cpu && m.cpu.percentCPUUsage) || 0;
      cpu += p;
      const w = Number(m.memory && m.memory.workingSetSize) || 0;
      memKb += w;
      const k = m.type || 'Process';
      kinds[k] = (kinds[k] || 0) + 1;
    }
    return { processes: metrics.length, cpuPercent: cpu, memBytes: memKb * 1024, kinds };
  } catch (e) {
    return { processes: 0, cpuPercent: 0, memBytes: 0, kinds: {} };
  }
}

function parseTasklist(out) {
  const map = new Map();
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)","[^"]*","\d+","([\d,]+|N\/A) K"$/);
    if (!m) continue;
    const pid = Number(m[2]);
    const kib = m[3] === 'N/A' ? 0 : Number(m[3].replace(/,/g, ''));
    if (pid && Number.isFinite(kib)) map.set(pid, { name: m[1], bytes: kib * 1024 });
  }
  return map;
}

function serviceMemory(pids) {
  const key = pids.join(',');
  const now = Date.now();
  if (taskCache.map && taskCache.key === key && now - taskCache.at < 6000) return taskCache.map;
  let map = new Map();
  if (pids.length) {
    try {
      const out = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 6000 });
      map = parseTasklist(out);
    } catch (e) {
      map = new Map();
    }
  }
  taskCache = { at: now, key, map };
  return map;
}

function cleanItems(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items.slice(0, 12) : []) {
    if (!it || typeof it !== 'object') continue;
    const pid = Number(it.pid);
    out.push({
      id: String(it.id || '').slice(0, 24),
      name: String(it.name || '').slice(0, 40),
      port: Number(it.port) || 0,
      running: !!it.running,
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    });
  }
  return out;
}

function analyze(s) {
  const notes = [];
  let level = 'ok';
  const bump = (v) => { if (v === 'bad' || (v === 'warn' && level === 'ok')) level = v; };
  if (s.cpu.percent != null) {
    if (s.cpu.percent >= 85) { bump('bad'); notes.push(`CPU 高负载：${s.cpu.percent.toFixed(1)}%，检查生成服务脚本或依赖启动。`); }
    else if (s.cpu.percent >= 65) { bump('warn'); notes.push(`CPU 偏高：${s.cpu.percent.toFixed(1)}%，观察是否有生成服务在持续编译或重试。`); }
  }
  if (s.memory.percent >= 90) { bump('bad'); notes.push(`内存占用过高：${s.memory.percent.toFixed(1)}%，MariaDB 缓冲池和生成服务堆内存是主要排查对象。`); }
  else if (s.memory.percent >= 80) { bump('warn'); notes.push(`内存偏高：${s.memory.percent.toFixed(1)}%，优先看服务进程合计与生成服务运行时。`); }
  if (s.disk) {
    if (s.disk.free < 3 * 1024 ** 3 || s.disk.percent >= 97) { bump('bad'); notes.push(`磁盘空间紧张：${s.disk.label} 盘剩余 ${fmt(s.disk.free)}，已用 ${s.disk.percent.toFixed(0)}%。`); }
    else if (s.disk.free < 10 * 1024 ** 3 || s.disk.percent >= 90) { bump('warn'); notes.push(`磁盘使用偏高：${s.disk.label} 盘已用 ${s.disk.percent.toFixed(0)}%，可用 ${fmt(s.disk.free)}。`); }
  }
  const running = s.services.filter((x) => x.running).length;
  const off = s.services.filter((x) => !x.running).map((x) => x.name).filter(Boolean);
  if (off.length) {
    bump('warn');
    notes.push(`依赖服务未全部在线：${off.join('、')}；${running}/${s.services.length} 运行。`);
  }
  const withMem = s.services.filter((x) => x.memBytes > 0).sort((a, b) => b.memBytes - a.memBytes);
  if (withMem.length) {
    const top = withMem[0];
    const sum = withMem.reduce((n, x) => n + x.memBytes, 0);
    const pct = s.memory.total ? (sum / s.memory.total) * 100 : 0;
    notes.push(`服务内存合计 ${fmt(sum)}，占系统内存 ${pct.toFixed(1)}%；最大是 ${top.name}（${fmt(top.memBytes)}）。`);
  }
  if (!notes.length) notes.push('资源处于正常区间，CPU、内存、磁盘都没有接近瓶颈。');
  return { level, notes };
}

function fmt(n) {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return (v / 1024 ** 3).toFixed(v >= 10 * 1024 ** 3 ? 1 : 2) + ' GB';
  if (v >= 1024 ** 2) return (v / 1024 ** 2).toFixed(1) + ' MB';
  if (v >= 1024) return (v / 1024).toFixed(0) + ' KB';
  return v + ' B';
}

function snapshot(items) {
  const servicesIn = cleanItems(items);
  const pids = servicesIn.map((x) => x.pid).filter(Boolean);
  const memMap = serviceMemory(pids);
  const services = servicesIn.map((x) => {
    const hit = x.pid ? memMap.get(x.pid) : null;
    return { ...x, memBytes: hit ? hit.bytes : 0, process: hit ? hit.name : '' };
  });
  const s = {
    at: Date.now(),
    cpu: sampleCpu(),
    memory: sampleMemory(),
    disk: sampleDisk(),
    net: sampleNet(),
    app: sampleApp(),
    services,
  };
  const serviceMem = services.reduce((n, x) => n + x.memBytes, 0);
  const running = services.filter((x) => x.running).length;
  s.serviceMem = serviceMem;
  s.serviceRunning = running;
  s.analysis = analyze(s);
  return s;
}

// 模块加载时先取一次 CPU 基线，首次打开工作台就能得到有意义的百分比。
prevCpu = sumCpus();

module.exports = { snapshot };
