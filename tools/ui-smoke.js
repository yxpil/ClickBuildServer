'use strict';

// 真实 UI 冒烟：通过 Chromium 远程调试协议驱动渲染进程，点按钮、填弹窗、读 DOM。
// 用法：先 electron . --remote-debugging-port=9222，再 runtime\node\node.exe tools\ui-smoke.js

const PORT = Number(process.argv[2] || 9222);
const os = require('os');
const fs = require('fs');

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      eval: (expr, awaitPromise) => new Promise((res2, rej2) => {
        const mid = ++id;
        pending.set(mid, { res2, rej2 });
        ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: !!awaitPromise, returnByValue: true } }));
      }),
      close: () => ws.close(),
    });
    ws.onerror = (e) => reject(e);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej2(new Error(msg.error.message)); else p.res2(msg.result);
      }
    };
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0; let bad = 0;
const t = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓ ' + name); } else { bad++; console.log('  ✗ ' + name + ' → ' + String(JSON.stringify(extra)).slice(0, 200)); } };

(async () => {
  const list = await targets();
  const page = list.find((x) => x.type === 'page' && /wbench/.test(x.url)) || list.find((x) => x.type === 'page');
  if (!page) throw new Error('没找到渲染进程页面');
  const c = await connect(page.webSocketDebuggerUrl);

  const val = async (expr) => {
    const r = await c.eval(expr, true);
    return r.result ? r.result.value : undefined;
  };

  t('页面已加载接口工作台', await val(`document.title.includes('ClickBuildServer')`), await val('document.title'));
  t('Ribbon 有工程/扩展组', await val(`!!document.querySelector('[data-action="exportYxpn"]') && !!document.querySelector('[data-action="ai"]')`));
  t('表格有接口行', await val(`document.querySelectorAll('#workspace tr[data-iface]').length >= 1`), await val(`document.querySelectorAll('#workspace tr[data-iface]').length`));
  t('分类 sheet 存在', await val(`document.querySelectorAll('#sheetbar .sheet[data-sheet]').length >= 2`), await val(`document.querySelectorAll('#sheetbar .sheet[data-sheet]').length`));

  // 全局搜索
  await val(`document.querySelector('#search').value='订单'; document.querySelector('#search').dispatchEvent(new Event('input'))`);
  await wait(300);
  t('全局搜索有结果', await val(`document.querySelectorAll('#searchPanel [data-res]').length > 0`), await val(`document.querySelector('#searchPanel').innerText.slice(0,80)`));
  await val(`document.querySelector('#search').value=''; document.querySelector('#search').dispatchEvent(new Event('input'))`);

  // 复制接口（自动编号）
  await val(`S.selId = S.project.interfaces[0].id; act('dupIface')`);
  await wait(600);
  t('复制接口生成 订单2', await val(`S.project.interfaces.some(i=>i.name==='订单2')`), await val(`S.project.interfaces.map(i=>i.name)`));
  t('复制后表名带 _2', await val(`!!S.project.interfaces.find(i=>i.name==='订单2').tables.find(t=>t.name==='biz_order_2')`));

  // 导出 .yxpn（接口 + 文件落盘）
  const exp = await val(`api.exportYxpn(S.project)`);
  t('导出接口返回成功', exp && exp.ok, exp);
  t('导出文件存在且够大', exp && exp.size > 10000, exp && exp.size);
  await val(`act('exportYxpn')`);
  await wait(400);

  // 导出独立工程（IDEA）
  t('Ribbon 有导出工程按钮', await val(`!!document.querySelector('[data-action="exportProject"]')`));
  const eproj = await val(`api.exportProject(S.project, { parent: ${JSON.stringify(os.tmpdir())} })`);
  t('导出工程返回成功', !!(eproj && eproj.ok), eproj);
  t('导出工程带 .idea 模块', !!(eproj && eproj.ok && await val(`api.exists(${JSON.stringify((eproj.dir || '') + '\\.idea\\modules.xml')})`)), eproj && eproj.dir);
  t('导出工程带 IDEA 运行配置', !!(eproj && eproj.ok && await val(`api.exists(${JSON.stringify((eproj.dir || '') + '\\.run\\启动接口服务.run.xml')})`)), eproj && eproj.dir);
  if (eproj && eproj.ok && eproj.dir) fs.rmSync(eproj.dir, { recursive: true, force: true });

  // AI 对话框：填需求 → 生成
  await val(`act('ai')`);
  await wait(300);
  t('AI 弹窗出现', await val(`!!document.querySelector('#aiPrompt')`));
  await val(`document.querySelector('#aiPrompt').value='做一个订单服务，带明细表，再加用户注册登录，密码用 SM4'; document.querySelector('#aiGo').click()`);
  await wait(1500);
  t('AI 生成后工程被替换', await val(`S.project.interfaces.some(i=>i.name==='用户注册')`), await val(`S.project.interfaces.map(i=>i.name)`));
  t('AI 对话记录有内容', await val(`document.querySelector('#aiLog').innerText.includes('AI')`), await val(`document.querySelector('#aiLog').innerText.slice(-80)`));
  await val(`closeModal()`);

  // 监控抽屉
  await val(`act('monitor')`);
  await wait(2500);
  t('监控抽屉打开', await val(`!document.querySelector('#drawer').classList.contains('hidden')`));
  t('监控显示健康状态', await val(`document.querySelector('#monHealth').textContent.length > 0`), await val(`document.querySelector('#monHealth').textContent`));
  await val(`document.querySelector('#monClose').click()`);

  // 主题：改强调色
  await val(`act('theme')`);
  await wait(300);
  t('主题弹窗出现', await val(`!!document.querySelector('#thAccent')`));
  await val(`document.querySelector('#thAccent').value='#444444'; document.querySelector('#thSave').click()`);
  await wait(800);
  t('主题写入设置', await val(`!!(S.settings.theme && S.settings.theme.accent)`), await val(`JSON.stringify(S.settings.theme)`));
  t('CSS 变量生效', await val(`getComputedStyle(document.documentElement).getPropertyValue('--cb-accent').trim()`) === '#444444', await val(`getComputedStyle(document.documentElement).getPropertyValue('--cb-accent')`));
  // 恢复黑白
  await val(`api.theme({accent:'#111111',head:'#ffffff',headText:'#111111',footer:'#f4f4f4'}).then(t=>{S.settings.theme=t;applyTheme(t)})`, true);

  // 文档预览
  await val(`act('docs')`);
  await wait(500);
  t('文档预览出现', await val(`!!document.querySelector('#docOpen')`));
  t('文档含 paths', await val(`document.querySelector('#modal pre').textContent.includes('"paths"')`));
  await val(`closeModal()`);

  // 右键菜单
  const ctx = await val(`(()=>{S.mode='grid';render();const tr=document.querySelector('#workspace tr[data-iface]');if(!tr)return 'no-row';tr.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:300}));return document.querySelector('#ctxmenu').innerText;})()`);
  t('右键菜单有打开/复制/删除', /打开接口/.test(ctx) && /复制/.test(ctx) && /删除/.test(ctx), ctx);
  await val(`document.querySelector('#ctxmenu').classList.add('hidden')`);

  // 模版库
  t('Ribbon 有模版与插件入口', await val(`!!document.querySelector('[data-action="templates"]') && !!document.querySelector('[data-action="plugins"]')`));
  await val(`act('templates')`);
  await wait(500);
  t('模版库列出 22 个内置模版', await val(`document.querySelectorAll('[data-tpl-apply]').length >= 22`), await val(`document.querySelectorAll('[data-tpl-apply]').length`));
  t('社交接口库卡片统计 9 接口 / 46 表 / 86 路由', await val(`(()=>{const b=document.querySelector('[data-tpl-apply="builtin:social"]');const card=b&&b.parentElement&&b.parentElement.parentElement;return !!card && card.innerText.includes('9 接口') && card.innerText.includes('46 表') && card.innerText.includes('86 路由');})()`));
  t('模版卡片有接口/表统计', await val(`document.querySelector('#modal').innerText.includes('接口 ·')`));
  await val(`document.querySelector('[data-tpl-apply="builtin:blog"]').click()`);
  await wait(300);
  await val(`document.querySelector('#cYes').click()`);
  await wait(1200);
  t('套用博客模版替换工程', await val(`S.project.name.includes('博客')`), await val(`S.project.name`));
  t('博客模版带 5 个接口', await val(`S.project.interfaces.length === 5`), await val(`S.project.interfaces.length`));

  // 接口文档页
  await val(`S.mode='editor'; S.selId=S.project.interfaces[0].id; S.tab='docs'; render()`);
  await wait(300);
  t('接口文档页有 7 项接口字段', await val(`document.querySelectorAll('[data-df]').length >= 7`), await val(`document.querySelectorAll('[data-df]').length`));
  t('接口文档页有每条路由的文档', await val(`document.querySelectorAll('[data-route-doc]').length === S.project.interfaces[0].routes.length`), await val(`document.querySelectorAll('[data-route-doc]').length`));
  await val(`(()=>{const el=document.querySelector('[data-df="owner"]');el.value='张三';el.dispatchEvent(new Event('input'));})()`);
  t('文档字段写回模型', await val(`S.project.interfaces[0].docs.owner === '张三'`), await val(`S.project.interfaces[0].docs.owner`));

  // 微服务导出
  t('Ribbon 有微服务导出入口', await val(`!!document.querySelector('[data-action="microExport"]')`));
  await val(`closeModal(); act('microExport')`);
  await wait(300);
  t('微服务弹窗列出分类/接口', await val(`document.querySelectorAll('.mexIface').length === S.project.interfaces.length && document.querySelectorAll('.mexCat').length === S.project.categories.length`), await val(`document.querySelectorAll('.mexIface').length + '/' + S.project.categories.length`));
  await val(`document.querySelector('.mexIface').checked=true; document.querySelector('#mexYes').click()`);
  await wait(300);
  t('微服务导出弹名称框', await val(`!!document.querySelector('#askIn')`));
  await val(`document.querySelector('#askIn').value='微服务测试'; document.querySelector('#askYes').click()`);
  await wait(1800);
  t('微服务导出产物落盘', await val(`!!document.querySelector('#mxOpen') && document.querySelector('#modal').innerText.includes('已导出 1 个接口')`), await val(`document.querySelector('#modal').innerText.slice(0,100)`));
  await val(`closeModal()`);

  // 插件面板
  await val(`act('plugins')`);
  await wait(500);
  t('插件面板列出内置插件', await val(`document.querySelectorAll('[data-pl]').length >= 1`), await val(`document.querySelectorAll('[data-pl]').length`));
  t('插件面板有 Defender 按钮', await val(`!!document.querySelector('#plTrust')`));
  const dl = await val(`api.defenderList()`);
  t('Defender 设置可读', dl && (dl.ok || dl.error), dl && (dl.error || ''));

  // 多表：12 张表时标签栏可滚动，当前标签和右侧控件不能越界
  const layout = await val(`(()=>{
    const it=S.project.interfaces[0];
    const base=JSON.parse(JSON.stringify(it.tables[0]));
    while(it.tables.length<12){
      const i=it.tables.length+1;
      const c=JSON.parse(JSON.stringify(base));
      c.key='ui_table_'+i; c.name='ui_table_'+i; it.tables.push(c);
    }
    S.selId=it.id; S.mode='editor'; S.tab='tables'; S.tableKey=it.tables[it.tables.length-1].key; render();
    const bar=document.querySelector('#tableTabs');
    const active=bar.querySelector('.bg-neutral-900');
    const row2=document.querySelector('#tName').closest('.flex');
    return {
      tables:it.tables.length,
      scrollable:bar.scrollWidth>bar.clientWidth,
      activeVisible:active.getBoundingClientRect().right<=bar.getBoundingClientRect().right+1,
      select:document.querySelector('#tSelect').value,
      row2:row2.getBoundingClientRect().bottom<=innerHeight,
      row2Left:row2.getBoundingClientRect().left>=0,
    };
  })()`);
  t('12 张表标签栏可横向滚动', layout.scrollable, layout);
  t('当前表标签完整可见', layout.activeVisible, layout);
  t('快速切表选中最后一张', layout.select === 'ui_table_12', layout);
  t('表名/库/注释行未被挤掉', layout.row2 && layout.row2Left, layout);

  // 空白区域右键：不能没反应
  const gridCtx = await val(`(()=>{S.mode='grid';S.tab='tables';render();document.querySelector('#workspace').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));const t=document.querySelector('#ctxmenu').innerText;closeCtx();return t;})()`);
  t('表格空白右键有新建入口', /新建接口/.test(gridCtx) && /新建分类/.test(gridCtx), gridCtx);
  const editorCtx = await val(`(()=>{S.mode='editor';S.tab='tables';render();document.querySelector('#tabBody').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));const t=document.querySelector('#ctxmenu').innerText;closeCtx();return t;})()`);
  t('编辑器空白右键有字段/生成入口', /添加字段/.test(editorCtx) && /生成服务/.test(editorCtx), editorCtx);

  // 自动保存静默，且状态栏可见
  const dirty = await val(`(()=>{S.project.name=S.project.name+'x';scheduleSave();render();return document.querySelector('#saveState').textContent;})()`);
  await wait(1100);
  const saved = await val(`document.querySelector('#saveState').textContent`);
  t('自动保存静默且状态可见', /未保存|保存中/.test(dirty) && saved.includes('已保存'), `${dirty} → ${saved}`);

  // 启动按钮要跟运行状态一起变
  const ribbonStop = await val(`(()=>{const keep=S.services;const items=(keep.items||[]).map(x=>({...x,running:true}));S.services={...keep,items};renderRibbon();const el=document.querySelector('#ribbon [data-action="stopAll"]');const txt=el?el.innerText:'无';S.services=keep;renderRibbon();return txt;})()`);
  t('全部服务运行时按钮变“停止”', /停止/.test(ribbonStop), ribbonStop);

  // 测试页有运行时选择与热部署
  const testTools = await val(`(()=>{S.mode='editor';S.tab='test';render();return JSON.stringify({rt:!!document.querySelector('#tRuntime'),hot:!!document.querySelector('#tHot'),checked:document.querySelector('#tHot')&&document.querySelector('#tHot').checked,opts:Array.from(document.querySelectorAll('#tRuntime option')).map(o=>o.textContent)});})()`);
  const tt = JSON.parse(testTools);
  t('测试页可选运行时与热部署', tt.rt && tt.hot && tt.checked && tt.opts.length >= 4, testTools);

  // 导出对话框有 404/500 与详情开关
  const exportText = await val(`(()=>{act('exportProject');const t=document.querySelector('#modal')?document.querySelector('#modal').innerText:'';closeModal();return t;})()`);
  t('导出对话框含错误页开关', /404 \/ 500/.test(exportText) && /错误详情/.test(exportText), exportText.slice(0, 80));

  // 回到表格，恢复 seed
  await val(`closeModal()`);
  await val(`api.seed().then(p=>{S.project=p;S.cat=p.categories[0].id;S.selId=p.interfaces[0].id;S.mode='grid';return api.save(p)}).then(()=>render())`, true);

  const err = await val(`(window.__cbErrors||[]).join('\\n')`);
  t('渲染进程无未捕获错误', !err, err);

  c.close();
  console.log(`\n通过 ${ok} / ${ok + bad}${bad ? '，失败 ' + bad : '，全部通过'}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('UI 冒烟崩了：', e.message); process.exit(2); });
