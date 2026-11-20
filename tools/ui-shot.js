'use strict';
// 用 CDP 截渲染进程整页：node tools/ui-shot.js <out.png> [port] [可选JS] [目标页关键字]
const fs = require('fs');
const out = process.argv[2] || 'ui.png';
const port = Number(process.argv[3] || 9222);
const evalJs = process.argv[4] || '';
const target = process.argv[5] || 'wbench';
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((x) => x.type === 'page' && new RegExp(target).test(x.url)) || list.find((x) => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  if (evalJs) {
    const r = await call('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    if (r.result && r.result.value !== undefined) console.log('eval:', typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value));
  }
  await new Promise((r) => setTimeout(r, 500));
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out, fs.statSync(out).size);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
