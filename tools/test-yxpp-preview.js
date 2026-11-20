'use strict';
// 校验 24 套 app 案例的 .yxpp 画布预览：不是通用骨架，而是由 app-runtime 读取 project.app + seed 渲染的真实业务页面。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const templates = require('../app/iface/templates');
const frontend = require('../app/iface/frontend');

const CHROME = process.env.CBS_CHROME || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-yxpp-preview-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cases = templates.list().filter((t) => t.kind === 'builtin');
  const rows = [];
  for (const item of cases) {
    const got = templates.get(item.id);
    const p = got.project && got.project.frontend && got.project.frontend.project;
    if (!p || !p.app || !p.app.mode) continue;
    const file = path.join(tmp, `${item.id.replace(/[^a-z0-9]+/gi, '_')}.html`);
    const html = frontend.previewHtml(p, { name: item.name });
    fs.writeFileSync(file, html, 'utf8');
    rows.push({ id: item.id, name: item.name, brand: p.app.brand, file, bytes: fs.statSync(file).size });
  }
  if (!CHROME) {
    console.error('未找到 Chrome / Edge，无法做真实运行时渲染校验');
    process.exit(2);
  }
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=9345`, `--user-data-dir=${path.join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  await wait(2500);
  const page = (await (await fetch('http://127.0.0.1:9345/json')).json()).find((x) => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id); waiting.delete(m.id);
      m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await call('Runtime.enable');
  await call('Page.enable');
  let pass = 0;
  for (const row of rows) {
    await call('Page.navigate', { url: 'file:///' + row.file.replace(/\\/g, '/') });
    await wait(1200);
    const r = await call('Runtime.evaluate', {
      expression: `(()=>{const m=document.querySelector('main'); const t=m?m.innerText.replace(/\\s+/g,' ').trim():''; return {text:t, preview:!!window.CBS_PREVIEW, fetch:String(window.fetch).slice(0,24)}})()`,
      returnByValue: true,
    });
    const v = r.result.value || {};
    const ok = v.preview && v.fetch.indexOf('function (input') === 0 && v.text.length > 20
      && !/读取失败|无法连接服务/.test(v.text)
      && (!row.brand || v.text.indexOf(row.brand) >= 0);
    if (ok) pass += 1;
    console.log(`${ok ? 'OK ' : 'BAD'} ${row.id} ${row.name} ${row.bytes}B ${v.text.slice(0, 80)}`);
  }
  ws.close(); proc.kill();
  console.log(`\n${pass}/${rows.length} 套 app 案例画布预览渲染通过`);
  console.log('临时目录：' + tmp);
  process.exit(pass === rows.length ? 0 : 1);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
