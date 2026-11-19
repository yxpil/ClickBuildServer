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
  await val(`(()=>{S.mode='grid';S.cat=(S.project.categories[0]||{}).id;render();})()`);
  await wait(300);
  t('Ribbon 有工程/扩展组', await val(`!!document.querySelector('[data-action="exportYxpn"]') && !!document.querySelector('[data-action="ai"]')`));
  t('表格有接口行', await val(`document.querySelectorAll('#workspace tr[data-iface]').length >= 1`), await val(`document.querySelectorAll('#workspace tr[data-iface]').length`));
  t('分类 sheet 存在', await val(`document.querySelectorAll('#sheetbar .sheet[data-sheet]').length >= 2`), await val(`document.querySelectorAll('#sheetbar .sheet[data-sheet]').length`));

  // 全局搜索
  const firstName = await val(`S.project.interfaces[0].name`);
  await val(`document.querySelector('#search').value=${JSON.stringify(firstName)}; document.querySelector('#search').dispatchEvent(new Event('input'))`);
  await wait(300);
  t('全局搜索有结果', await val(`document.querySelectorAll('#searchPanel [data-res]').length > 0`), await val(`document.querySelector('#searchPanel').innerText.slice(0,80)`));
  await val(`document.querySelector('#search').value=''; document.querySelector('#search').dispatchEvent(new Event('input'))`);

  // 复制接口（自动编号）
  const firstTable = await val(`S.project.interfaces[0].tables[0].name`);
  await val(`S.selId = S.project.interfaces[0].id; act('dupIface')`);
  await wait(600);
  t('复制接口生成副本', await val(`S.project.interfaces.some(i=>i.name===${JSON.stringify(firstName + '2')})`), await val(`S.project.interfaces.map(i=>i.name)`));
  t('复制后表名带 _2', await val(`!!S.project.interfaces.find(i=>i.name===${JSON.stringify(firstName + '2')}).tables.find(t=>t.name===${JSON.stringify(firstTable + '_2')})`));

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
  if (eproj && eproj.ok && eproj.dir) console.log('  · 导出工程目录 ' + eproj.dir);

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

  // 单接口库
  t('Ribbon 有接口库/存接口入口', await val(`!!document.querySelector('[data-action="ifaceLib"]') && !!document.querySelector('[data-action="saveIface"]')`));
  await val(`act('ifaceLib')`);
  await wait(500);
  t('接口库内置接口不少于 63 个', await val(`document.querySelectorAll('[data-lib-row][data-kind="builtin"]').length >= 63`), await val(`document.querySelectorAll('[data-lib-row][data-kind="builtin"]').length`));
  t('接口库搜索能过滤', await val(`(()=>{const q=document.querySelector('#libQ');q.value='账户';q.dispatchEvent(new Event('input'));const shown=Array.from(document.querySelectorAll('[data-lib-row]')).filter(x=>x.style.display!='none').length;const all=document.querySelectorAll('[data-lib-row]').length;q.value='';q.dispatchEvent(new Event('input'));return shown>0 && shown<all;})()`));
  t('接口库有全部/内置/我的筛选', await val(`document.querySelectorAll('[data-lib-kind]').length === 3`));
  await val(`closeModal()`);

  await val(`act('templates')`);
  await wait(400);
  await val(`document.querySelector('[data-tpl-apply="builtin:blog"]').click()`);
  await wait(300);
  await val(`document.querySelector('#cYes').click()`);
  await wait(1200);
  t('套用博客模版替换工程', await val(`S.project.name.includes('博客')`), await val(`S.project.name`));
  t('博客模版带 5 个接口', await val(`S.project.interfaces.length === 5`), await val(`S.project.interfaces.length`));
  t('博客模版带完整 .yxpp 前端', await val(`!!(S.project.frontend && S.project.frontend.project && S.project.frontend.project.elements && S.project.frontend.project.elements.length > 10 && S.project.frontend.html && S.project.frontend.html.length > 8000)`), await val(`S.project.frontend ? S.project.frontend.name : '-'`));
  await val(`setView('studio')`);
  await wait(1800);
  t('前端模式载入当前工程 .yxpp', await val(`(()=>{const f=document.querySelector('#studioFrame');const d=f&&f.contentDocument;return !!(d && d.querySelectorAll('#pageRoot > [data-id]').length === S.project.frontend.project.elements.length);})()`), await val(`(()=>{const f=document.querySelector('#studioFrame');return f&&f.contentDocument ? f.contentDocument.querySelectorAll('#pageRoot > [data-id]').length : -1;})()`));
  t('前端状态栏显示已绑定案例', await val(`document.querySelector('#studioState').textContent.includes('已绑定') && document.querySelector('#studioState').textContent.includes('案例前端') && document.querySelector('#studioState').textContent.includes('自动保存')`), await val(`document.querySelector('#studioState').textContent`));
  t('前端工坊品牌属于 ClickBuild', await val(`(()=>{const d=document.querySelector('#studioFrame').contentDocument;return d.querySelector('.brand-name').textContent.includes('CLICKBUILD')&&d.querySelector('.brand-name').textContent.includes('FRONTEND');})()`));
  const studioSrc = await val(`api.studioHtml()`);
  t('前端页面已移除旧站品牌与浏览器草稿', !/PageStudio|PAGESTUDIO|localStorage|static\.cloudflareinsights|__CF\$cv\$params/.test(String(studioSrc || '')));
  t('前端页面保留 ClickBuild 工程桥', /cbs:yxpp:load/.test(String(studioSrc || '')) && /cbs:yxpp:dirty/.test(String(studioSrc || '')));;
  // 编辑画布后自动回写当前工程
  const autoSavedBg = await val(`(()=>{const w=document.querySelector('#studioFrame').contentWindow;w.S.proj.page.bg='#FBFBFA';w.scheduleSave();return w.S.proj.page.bg;})()`);
  await wait(3600);
  t('前端编辑自动回写当前工程', await val(`!!(S.project.frontend&&S.project.frontend.project&&S.project.frontend.project.page.bg==='#FBFBFA')`), await val(`S.project.frontend&&S.project.frontend.project&&S.project.frontend.project.page.bg`));
  t('前端状态栏显示已同步到工程', await val(`(()=>{const d=document.querySelector('#studioFrame').contentDocument;return d.querySelector('#stSave').textContent.includes('已同步到当前工程');})()`), await val(`(()=>{const d=document.querySelector('#studioFrame').contentDocument;return d.querySelector('#stSave').textContent;})()`));
  t('案例可交互 HTML 不被设计自动保存冲掉', await val(`!!(S.project.frontend&&/<script[\\s>]/i.test(S.project.frontend.html))`), await val(`S.project.frontend?S.project.frontend.html.length:0`));
  const genWithFront = await val(`api.generate(S.project)`);
  t('生成工程写入网页首页', !!(genWithFront && genWithFront.ok && await val(`api.exists(${JSON.stringify((genWithFront.dir || '') + '\\public\\index.html')})`)), genWithFront && genWithFront.dir);
  let genHtml = '';
  try { genHtml = fs.readFileSync((genWithFront.dir || '') + '\\public\\index.html', 'utf8'); } catch (e) { genHtml = ''; }
  t('生成首页保留案例运行时脚本', /<script[\s>]/i.test(genHtml), genHtml.length);
  await val(`setView('api')`);
  await wait(400);

  // 新建接口先走创建引导，未确认前不能新增
  const guideBefore = await val(`S.project.interfaces.length`);
  await val(`(()=>{act('newIface'); return 'opened';})()`);
  await wait(500);
  t('新建接口打开创建引导且不提前创建', await val(`S.project.interfaces.length === ${guideBefore} && document.querySelector('#modal').innerText.includes('创建引导')`), await val(`S.project.interfaces.length + ' / ' + (document.querySelector('#modal') ? document.querySelector('#modal').innerText.split('\\n')[0] : '无弹窗')`));
  await val(`document.querySelector('#guideClose').click()`);
  await wait(300);
  t('取消创建引导不改工程', await val(`S.project.interfaces.length === ${guideBefore}`), await val(`S.project.interfaces.length`));
  await val(`(()=>{act('newIface'); return 'opened';})()`);
  await wait(500);
  await val(`(()=>{const set=(id,v)=>{const e=document.querySelector(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};set('#guideName','引导测试接口');set('#guidePrefix','v1/guide');set('#guideComment','UI 引导创建');document.querySelector('#guideNext').click();})()`);
  await wait(300);
  await val(`(()=>{const set=(id,v)=>{const e=document.querySelector(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};set('#guideTable','guide_ui_table');set('#guideFields','title varchar 标题\\nprice decimal 价格');document.querySelector('#guideNext').click();})()`);
  await wait(300);
  t('创建引导第二步可配置主表与字段', await val(`document.querySelector('#guideBody').innerText.includes('第三步 · 路由') && document.querySelector('#guideBody').innerText.includes('/api/v1/guide/guide_ui_table')`));
  await val(`(()=>{const u=document.querySelector('[data-guide-route][value="update"]');u.checked=false;u.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#guideAuth').value='write';document.querySelector('#guideAuth').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#guideNext').click();})()`);
  await wait(300);
  t('创建引导预览确认页', await val(`document.querySelector('#guideBody').innerText.includes('第四步 · 确认创建') && document.querySelector('#guideBody').innerText.includes('guide_ui_table') && !document.querySelector('#guideCreate').classList.contains('hidden')`));
  await val(`document.querySelector('#guideCreate').click()`);
  await wait(1200);
  const newGuide = await val(`(()=>{const i=S.project.interfaces.find(x=>x.name==='引导测试接口');return i?JSON.stringify({n:S.project.interfaces.length,table:i.tables[0].name,fields:i.tables[0].fields.map(f=>f.name),routes:i.routes.map(r=>r.method+' '+r.path),auth:i.routes.map(r=>r.auth),base:i.basePath}):'';})()`);
  const ng = newGuide ? JSON.parse(newGuide) : {};
  t('创建引导确认后写入工程', ng.n === guideBefore + 1 && ng.table === 'guide_ui_table' && ng.base === '/v1/guide' && ng.fields.includes('title') && ng.fields.includes('price') && ng.routes.length === 4 && ng.auth.slice(2).every(Boolean), newGuide);

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

  // 启动按钮要跟网页服务状态一起变，并且默认入口是主页
  const ribbonStart = await val(`(()=>{const keep=S.services;const items=(keep.items||[]).map(x=>({...x,running:false}));S.services={...keep,items};renderRibbon();const el=document.querySelector('#ribbon [data-action="launchWeb"]');const home=document.querySelector('#ribbon [data-action="home"]');const out={start:el?el.innerText:'无',home:home?home.innerText:'无'};S.services=keep;renderRibbon();return JSON.stringify(out);})()`);
  const rs = JSON.parse(ribbonStart);
  t('网页停止时启动按钮为“启动”', /启动/.test(rs.start), ribbonStart);
  t('Ribbon 默认提供打开主页入口', /打开主页/.test(rs.home), ribbonStart);
  const ribbonStop = await val(`(()=>{const keep=S.services;const items=(keep.items||[]).map(x=>({...x,running:true}));S.services={...keep,items};renderRibbon();const el=document.querySelector('#ribbon [data-action="stopServer"]');const txt=el?el.innerText:'无';S.services=keep;renderRibbon();return txt;})()`);
  t('网页运行时按钮变“停止”', /停止/.test(ribbonStop), ribbonStop);

  // 更新部署入口：顶部、服务组、前端工坊各一个
  const deployUI = await val(`JSON.stringify({
    header: !!document.querySelector('header.appbar [data-action="deployUpdate"]'),
    ribbon: !!document.querySelector('#ribbon [data-action="deployUpdate"]'),
    studio: !!document.querySelector('#yxppDeploy')
  })`);
  const du = JSON.parse(deployUI);
  t('顶部有更新部署按钮', du.header, deployUI);
  t('服务组有更新按钮', du.ribbon, deployUI);
  t('前端工坊有更新部署按钮', du.studio, deployUI);

  // 没有 .yxpp 时进入前端工坊：显示空白画布，首次编辑自动绑定并保存
  await val(`(async()=>{S.project=await api.seed();S.cat=(S.project.categories[0]||{}).id;S.selId=(S.project.interfaces[0]||{}).id;S.mode='grid';render();setView('studio');return true})()`, true);
  await wait(1800);
  t('无前端工程时显示空白画布而非示例站点', await val(`S.project.frontend===undefined && document.querySelector('#studioState').textContent.includes('空白画布')`), await val(`document.querySelector('#studioState').textContent`));
  await val(`(()=>{const w=document.querySelector('#studioFrame').contentWindow;w.S.proj.page.bg='#FAFAF8';w.scheduleSave();return true})()`);
  await wait(3600);
  t('空白画布首次编辑自动绑定 .yxpp', await val(`!!(S.project.frontend&&S.project.frontend.project&&S.project.frontend.project.page.bg==='#FAFAF8'&&S.project.frontend.html)`), await val(`S.project.frontend?S.project.frontend.name:'无'`));
  await val(`setView('api')`);
  await wait(300);

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
