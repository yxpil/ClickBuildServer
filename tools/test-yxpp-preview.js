// 作者：yxpil
'use strict';
// 校验 4 套真实案例的 .yxpp 画布预览：
// - 原生组件案例：每页由原生元素拼成，点页面导航真的换页，改文字后重新渲染能进 HTML；
// - app 案例（历史工程）：由 app-runtime 读取 project.app + seed 渲染，点顶部导航真的切换视图。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const templates = require('../app/iface/templates');
const frontend = require('../app/iface/frontend');
const nativeHtml = require('../app/iface/native-html');

const CHROME = process.env.CBS_CHROME || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

// 编辑链路必须完整：属性提交 -> 请求重建运行时 -> 回填 previewHtml -> 重画画布。
const studioSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'studio.html'), 'utf8');
const benchSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'wbench.js'), 'utf8');
const wiring = [
  ['studio 发送重建请求', studioSrc.indexOf("type: 'cbs:yxpp:preview'") >= 0],
  ['studio 接收重建结果', studioSrc.indexOf("'cbs:yxpp:preview-result'") >= 0],
  ['studio 回填预览并重画画布', studioSrc.indexOf('function applyAppPreviewResult') >= 0 && /renderCanvas\(\)/.test(studioSrc)],
  ['主进程响应重建请求', benchSrc.indexOf("d.type === 'cbs:yxpp:preview'") >= 0],
  ['appview 提交触发重建', /n\.type === 'appview'\)\s*requestAppPreview\(\)/.test(studioSrc)],
];
const badWiring = wiring.filter((x) => !x[1]);
if (badWiring.length) {
  console.error('编辑链路断裂：\n' + badWiring.map((x) => '  - ' + x[0]).join('\n'));
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-yxpp-preview-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cases = templates.list().filter((t) => t.kind === 'builtin');
  const rows = [];
  for (const item of cases) {
    const got = templates.get(item.id);
    const p = got.project && got.project.frontend && got.project.frontend.project;
    if (!p) continue;
    if (p.nativeCase) {
      const file = path.join(tmp, `${item.id.replace(/[^a-z0-9]+/gi, '_')}-native.html`);
      const html = nativeHtml.build(p, { name: item.name });
      fs.writeFileSync(file, html, 'utf8');
      rows.push({ id: item.id, name: item.name, native: true, nav: (p.pages[1] || {}).id, file, bytes: fs.statSync(file).size, project: p });
      continue;
    }
    if (!p.app || !p.app.mode) continue;
    const file = path.join(tmp, `${item.id.replace(/[^a-z0-9]+/gi, '_')}.html`);
    const html = frontend.previewHtml(p, { name: item.name });
    fs.writeFileSync(file, html, 'utf8');
    rows.push({ id: item.id, name: item.name, brand: p.app.brand, file, bytes: fs.statSync(file).size, project: p });
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
    if (row.native) {
      await call('Page.navigate', { url: 'file:///' + row.file.replace(/\\/g, '/') });
      await wait(1200);
      const initial = await call('Runtime.evaluate', {
        expression: `(()=>{const x=document.querySelector('#ps-root');return {text:x?x.innerText.replace(/\\s+/g,' ').trim():'',pages:document.querySelectorAll('.ps-page').length,visible:[...document.querySelectorAll('.ps-page')].filter(p=>getComputedStyle(p).display!=='none').map(p=>p.getAttribute('data-ps-page'))}})()`,
        returnByValue: true,
      });
      const iv = initial.result.value || {};
      const target = row.nav;
      await call('Runtime.evaluate', { expression: `(()=>{const b=document.querySelector('[data-ps-go=${JSON.stringify(target)}]');if(b)b.click();return !!b})()`, returnByValue: true });
      await wait(500);
      const after = await call('Runtime.evaluate', {
        expression: `(()=>{const x=document.querySelector('#ps-root');return {text:x?x.innerText.replace(/\\s+/g,' ').trim():'',visible:[...document.querySelectorAll('.ps-page')].filter(p=>getComputedStyle(p).display!=='none').map(p=>p.getAttribute('data-ps-page'))}})()`,
        returnByValue: true,
      });
      const av = after.result.value || {};
      const clickOk = av.visible && av.visible[0] === target && av.text && av.text !== iv.text;
      let editOk = false;
      let editedText = '';
      if (clickOk) {
        const edited = JSON.parse(JSON.stringify(row.project));
        const marker = '实时编辑验收 · ' + row.id;
        const hit = (edited.pages[1].elements || []).find((e) => e.type === 'text' || e.type === 'heading');
        if (hit) {
          hit.props = hit.props || {};
          hit.props.text = (hit.props.text || '') + ' ' + marker;
          const editedFile = path.join(tmp, `${row.id.replace(/[^a-z0-9]+/gi, '_')}-native-edited.html`);
          fs.writeFileSync(editedFile, nativeHtml.build(edited, { name: row.name }), 'utf8');
          await call('Page.navigate', { url: 'file:///' + editedFile.replace(/\\/g, '/') });
          await wait(1200);
          await call('Runtime.evaluate', { expression: `(()=>{const b=document.querySelector('[data-ps-go=${JSON.stringify(target)}]');if(b)b.click();return !!b})()`, returnByValue: true });
          await wait(500);
          const editedAfter = await call('Runtime.evaluate', { expression: `(()=>{const x=document.querySelector('#ps-root');return x?x.innerText.replace(/\\s+/g,' ').trim():''})()`, returnByValue: true });
          editedText = editedAfter.result.value || '';
          editOk = editedText.indexOf(marker) >= 0;
        }
      }
      if (clickOk && editOk) pass += 1;
      console.log(`${clickOk && editOk ? 'OK ' : 'BAD'} ${row.id} ${row.name} ${row.bytes}B 原生${iv.pages}页 ${iv.visible} -> ${av.visible}${editOk ? ' | 文字覆盖生效' : ' | 文字覆盖未生效 ' + editedText.slice(0, 80)}`);
      continue;
    }
    await call('Page.navigate', { url: 'file:///' + row.file.replace(/\\/g, '/') });
    await wait(1800);
    const r = await call('Runtime.evaluate', {
      expression: `(()=>{const m=document.querySelector('main'); const t=m?m.innerText.replace(/\\s+/g,' ').trim():''; return {text:t, preview:!!window.CBS_PREVIEW, fetch:String(window.fetch).slice(0,24)}})()`,
      returnByValue: true,
    });
    const v = r.result.value || {};
    const ok = v.preview && v.fetch.indexOf('function (input') === 0 && v.text.length > 20
      && !/读取失败|无法连接服务/.test(v.text)
      && (!row.brand || v.text.indexOf(row.brand) >= 0);
    const target = await call('Runtime.evaluate', {
      expression: `(()=>{const b=document.querySelectorAll('[data-nav]')[1]; if(!b) return ''; const v=b.getAttribute('data-nav'); b.click(); return v;})()`,
      returnByValue: true,
    });
    await wait(1300);
    const after = await call('Runtime.evaluate', {
      expression: `(()=>{const a=document.querySelector('[data-nav].on');const m=document.querySelector('main');return {view:a?a.getAttribute('data-nav'):'',text:m?m.innerText.replace(/\\s+/g,' ').trim():'',html:m?m.innerHTML.slice(0,120):'',toast:(document.querySelector('.toast-wrap')||{}).innerText||''};})()`,
      returnByValue: true,
    });
    const av = after.result.value || {};
    const clickOk = !!target.result.value && av.view === target.result.value && av.text.length > 20 && av.text !== v.text;
    // 属性面板改页面标题后，运行时必须优先使用 app.viewTitles，而不是写死文案。
    // 这一步直接渲染“已编辑”的工程副本，证明编辑结果真的会进运行时，而不是只改了 JSON。
    let editOk = false;
    let editedText = '';
    if (clickOk) {
      const edited = JSON.parse(JSON.stringify(row.project));
      const marker = '实时编辑验收 · ' + row.id;
      edited.app = edited.app || {};
      edited.app.viewTitles = Object.assign({}, edited.app.viewTitles, { [av.view]: marker });
      edited.app.viewSubs = Object.assign({}, edited.app.viewSubs, { [av.view]: '说明也来自属性面板' });
      const editedFile = path.join(tmp, `${row.id.replace(/[^a-z0-9]+/gi, '_')}-edited.html`);
      fs.writeFileSync(editedFile, frontend.previewHtml(edited, { name: row.name }), 'utf8');
      await call('Page.navigate', { url: 'file:///' + editedFile.replace(/\\/g, '/') });
      await wait(1800);
      await call('Runtime.evaluate', {
        expression: `(()=>{const b=document.querySelectorAll('[data-nav]')[1]; if(b) b.click(); return true;})()`,
        returnByValue: true,
      });
      await wait(1300);
      const editedAfter = await call('Runtime.evaluate', {
        expression: `(()=>{const m=document.querySelector('main');return m?m.innerText.replace(/\\s+/g,' ').trim():'';})()`,
        returnByValue: true,
      });
      editedText = editedAfter.result.value || '';
      editOk = editedText.indexOf(marker) >= 0;
    }
    if (ok && clickOk && editOk) pass += 1;
    console.log(`${ok && clickOk && editOk ? 'OK ' : 'BAD'} ${row.id} ${row.name} ${row.bytes}B ${v.text.slice(0, 60)} -> ${clickOk ? av.view + ' ' + av.text.slice(0, 50) : '点击无变化 ' + JSON.stringify({ target: target.result.value, view: av.view, same: av.text === v.text, len: av.text.length, html: av.html, toast: av.toast })}${editOk ? ' | 标题覆盖生效' : ' | 标题覆盖未生效 ' + editedText.slice(0, 80)}`);
  }
  ws.close(); proc.kill();
  console.log(`\n${pass}/${rows.length} 套案例画布预览渲染通过`);
  console.log('临时目录：' + tmp);
  process.exit(pass === rows.length ? 0 : 1);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
