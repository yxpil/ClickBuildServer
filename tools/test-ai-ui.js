'use strict';

// 真实 Ollama 的 UI 链路验收：打开 AI 弹窗 → 读取当前工程 → 追加接口 → 保存。
// 用法：node tools/test-ai-ui.js [--port 9222] [--model qwen3.8:27b] [--project AI上下文测试]

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.CBS_DEBUG_PORT || 9222);
const getArg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const MODEL = getArg('model', 'qwen3.8:27b');
const PROJECT = getArg('project', 'AI上下文测试');
const TIMEOUT = Number(getArg('timeout', '240')) * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      eval: (expr, awaitPromise) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: !!awaitPromise, returnByValue: true } }));
      }),
      close: () => ws.close(),
    });
    ws.onerror = reject;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result);
      }
    };
  });
}

(async () => {
  const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
  const page = list.find((x) => x.type === 'page' && /wbench/.test(x.url)) || list.find((x) => x.type === 'page');
  if (!page) throw new Error('没找到渲染进程页面');
  const c = await connect(page.webSocketDebuggerUrl);
  const val = async (expr) => {
    const r = await c.eval(expr, true);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面执行失败');
    return r.result ? r.result.value : undefined;
  };
  const setup = await val(`(async()=>{
    let p = await api.load(${JSON.stringify(PROJECT)});
    if (!p) { p = await api.seed(); p.name=${JSON.stringify(PROJECT)}; await api.save(p); }
    await enterWorkspace(p);
    S.settings.ai = { provider:'ollama', endpoint:'http://127.0.0.1:11434', model:${JSON.stringify(MODEL)}, timeout:180000, temperature:0.1, maxTokens:4096, fallbackMock:false };
    await api.saveSettings({ ai:S.settings.ai });
    act('ai');
    await new Promise(r=>setTimeout(r,600));
    const pv=document.querySelector('#aiProvider'); pv.value='ollama'; pv.dispatchEvent(new Event('change'));
    document.querySelector('#aiEndpoint').value='http://127.0.0.1:11434';
    document.querySelector('#aiModel').value=${JSON.stringify(MODEL)};
    document.querySelector('#aiTimeout').value='180';
    document.querySelector('#aiUseCtx').checked=true;
    document.querySelector('#aiMode').value='append';
    document.querySelector('#aiPrompt').value='当前工程已有接口，只追加一个优惠券接口（表 biz_coupon，字段 code、amount、status），路由只要列表、创建、更新；不要重复已有接口和表。';
    await new Promise(r=>setTimeout(r,400));
    return JSON.stringify({name:S.project.name, interfaces:S.project.interfaces.map(i=>i.name), frontend:S.project.frontend?S.project.frontend.name:null, ctx:document.querySelector('#aiCtxLine').innerText});
  })()`);
  console.log('setup:', setup);
  await val(`document.querySelector('#aiGo').click()`);
  const started = Date.now();
  let logText = '';
  while (Date.now() - started < TIMEOUT) {
    await wait(5000);
    logText = await val(`document.querySelector('#aiLog') ? document.querySelector('#aiLog').innerText : ''`);
    const last = logText.slice(-160).replace(/\n/g, ' | ');
    console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${last}`);
    if (/已追加并保存|已替换并保存|失败：|生成失败/.test(logText)) break;
  }
  const result = await val(`JSON.stringify({name:S.project.name, interfaces:S.project.interfaces.map(i=>({name:i.name,table:i.tables[0].name,routes:i.routes.map(r=>r.method+' '+r.path)})), frontend:S.project.frontend?S.project.frontend.name:null, project:S.project})`);
  const r = JSON.parse(result);
  console.log('result:', JSON.stringify({ name: r.name, interfaces: r.interfaces.map((i) => i.name), frontend: r.frontend }, null, 2));
  console.log('log:', logText.slice(-500));
  const names = r.interfaces.map((i) => i.name);
  if (!/已追加并保存|已替换并保存/.test(logText)) throw new Error('AI 没有成功完成，日志见上');
  if (!names.some((n) => /优惠券/.test(n))) throw new Error(`没有生成优惠券接口：${names.join(',')}`);
  if (r.name !== PROJECT) throw new Error(`工程名被改成 ${r.name}`);
  await val(`closeModal()`);
  const cleanup = await val(`api.remove(${JSON.stringify(PROJECT)}).then(r=>JSON.stringify(r))`);
  console.log('cleanup:', cleanup);
  c.close();
  console.log(`\n通过：真实 Ollama UI 追加生成，${((Date.now() - started) / 1000).toFixed(1)}s`);
})().catch((e) => { console.error(`FAILED: ${e.message}`); process.exitCode = 1; });
