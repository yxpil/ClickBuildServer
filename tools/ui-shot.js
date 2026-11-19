'use strict';
// 用 CDP 截渲染进程整页：node tools/ui-shot.js <out.png> [port]
const fs = require('fs');
const out = process.argv[2] || 'ui.png';
const port = Number(process.argv[3] || 9222);
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((x) => x.type === 'page' && /wbench/.test(x.url)) || list.find((x) => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === 1) {
      fs.writeFileSync(out, Buffer.from(m.result.data, 'base64'));
      console.log('saved', out, fs.statSync(out).size);
      ws.close();
      process.exit(0);
    }
  };
  ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: false } }));
  setTimeout(() => process.exit(3), 15000);
})();
