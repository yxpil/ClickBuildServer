// 作者：yxpil
'use strict';
// 在渲染进程里跑一段表达式并打印结果：node tools/ui-eval.js "expr" [port]
const port = Number(process.argv[3] || 9222);
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((x) => x.type === 'page' && /wbench/.test(x.url)) || list.find((x) => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === 1) {
      console.log(JSON.stringify(m.result, null, 2));
      ws.close();
      process.exit(0);
    }
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: process.argv[2], awaitPromise: true, returnByValue: true, includeCommandLineAPI: true } }));
  setTimeout(() => process.exit(3), 15000);
})();
