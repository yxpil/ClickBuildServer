'use strict';

// 为全部内置案例生成 PageStudio 原生业务应用：.yxpp project.app + 真实可运行前端。
// 用法：node tools/make-case-frontends.js [--check]
// 生成后写入 app/iface/cases/*.json 的 frontend 字段；--check 只校验，不改文件。

const fs = require('fs');
const path = require('path');
const CONFIG = require('./case-app-config');
const frontend = require('../app/iface/frontend');

const CASES = path.join(__dirname, '..', 'app', 'iface', 'cases');
const checkOnly = process.argv.includes('--check');
const UPDATED = '2026-11-20T00:00:00.000Z';
const SKIP = new Set(['survey', 'signup']); // 这两套已经有独立真实前端，保留不动。

const META = {
  blog: { code: 'BLOG', kicker: '内容 / CMS' },
  booking: { code: 'BOOK', kicker: '本地生活 / 预约' },
  chat: { code: 'CHAT', kicker: 'IM / 消息' },
  crm: { code: 'CRM', kicker: '客户 / 商机' },
  crossdb: { code: 'XDB', kicker: '跨库 / 事务' },
  decoration: { code: 'DECO', kicker: '报价 / 审批' },
  edu: { code: 'EDU', kicker: '课程 / 学习' },
  event: { code: 'EVENT', kicker: '活动 / 票务' },
  finance: { code: 'FIN', kicker: '报销 / 审批' },
  freight: { code: 'FRT', kicker: '货运 / 报价' },
  hospital: { code: 'MED', kicker: '医疗 / 挂号' },
  iot: { code: 'IOT', kicker: '设备 / 遥测' },
  logistics: { code: 'LOG', kicker: '运单 / 轨迹' },
  mall: { code: 'MALL', kicker: '电商 / 交易' },
  meeting: { code: 'MEET', kicker: '会议 / 协作' },
  netcourse: { code: 'NET', kicker: '网课 / 考试' },
  printing: { code: 'PRINT', kicker: '印刷 / 算价' },
  restaurant: { code: 'DINE', kicker: '餐饮 / 点餐' },
  social: { code: 'SOCIAL', kicker: '社交 / 社区' },
  softquote: { code: 'QUOTE', kicker: '软件 / 报价' },
  ticket: { code: 'TICKET', kicker: '工单 / 客服' },
  video: { code: 'VIDEO', kicker: '视频 / 内容' },
};

function bodyFieldNames(route) {
  const out = [];
  const text = String((route && route.script) || '');
  for (const m of text.matchAll(/\{\{\s*body\.([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function queryFieldNames(route) {
  const out = [];
  const text = String((route && route.script) || '');
  for (const m of text.matchAll(/\{\{\s*query\.([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  for (const m of text.matchAll(/\{\{\s*(where|order|page|limit):([A-Za-z0-9_]+)\s*\}\}/g)) {
    for (const k of ['page', 'pageSize', 'keyword', 'sort']) if (!out.includes(k)) out.push(k);
  }
  return out;
}

function routeTableKey(route, tables) {
  const text = String((route && route.script) || '');
  const keys = Array.from(text.matchAll(/\{\{\s*t:([A-Za-z0-9_]+)\s*\}\}/g)).map((m) => m[1]);
  for (const k of keys) {
    if ((tables || []).some((t) => t.key === k)) return k;
  }
  return ((tables || [])[0] || {}).key || 'main';
}

function makeCaseData(file, project) {
  const cats = (project.categories || []).map((c) => ({ id: c.id, name: c.name }));
  const interfaces = (project.interfaces || []).map((i) => {
    return {
      id: i.id,
      name: i.name,
      categoryId: i.categoryId,
      basePath: i.basePath || '',
      routes: (i.routes || []).map((r) => {
        const explicit = bodyFieldNames(r);
        const fallback = ['create', 'update'].includes(r.key) || /^(新建|更新|保存)$/.test(r.name || '');
        const tableKey = routeTableKey(r, i.tables || []);
        const table = (i.tables || []).find((t) => t.key === tableKey) || (i.tables || [])[0] || {};
        const routeFields = ((table.fields || []).map((f) => f.name)
          .filter((f) => !/^(id|created_at|updated_at|only_id|user_only_id|owner_only_id|password_hash)$/.test(f)));
        return {
          id: r.id,
          method: r.method,
          path: r.path,
          name: r.name,
          summary: r.summary || (r.docs && r.docs.summary) || '',
          auth: !!r.auth,
          table: tableKey,
          body: explicit.length ? explicit : (fallback ? routeFields : []),
          query: queryFieldNames(r),
        };
      }),
      tables: (i.tables || []).map((t) => ({
        key: t.key,
        name: t.name,
        fields: (t.fields || []).map((f) => ({ name: f.name, type: f.type, comment: f.comment || '' })),
      })),
    };
  });
  const tables = interfaces.reduce((n, i) => n + i.tables.length, 0);
  const routes = interfaces.reduce((n, i) => n + i.routes.length, 0);
  return {
    code: (META[file] && META[file].code) || file.toUpperCase(),
    kicker: (META[file] && META[file].kicker) || '案例 / 应用',
    name: project.name,
    description: project.description || '',
    api: '/api',
    counts: { interfaces: interfaces.length, categories: cats.length, routes, tables },
    categories: cats,
    interfaces,
  };
}

function N(type, id, x, y, w, h, props, style, children) {
  return {
    id, type, x, y, w, h, name: '', hidden: false, locked: false,
    props: Object.assign({}, props || {}),
    style: Object.assign({}, style || {}),
    children: children || [],
  };
}

function homeElements(ux) {
  const accent = ux.accent || '#2F5D50';
  const nav = (ux.nav || []).slice(0, 5);
  const els = [
    N('box', 'app-bg', 0, 0, 1200, 980, { clip: true }, { background: '#F6F3EC', radius: 0 }),
    N('box', 'app-top', 0, 0, 1200, 68, { clip: true }, { background: '#FFFFFF', border: 1, borderColor: '#DDD8CD', radius: 0 }),
    N('box', 'app-mark', 26, 14, 40, 40, { clip: true }, { background: accent, radius: 11 }),
    N('text', 'app-mark-t', 32, 27, 28, 16, { text: String(ux.mark || ux.code || 'APP').slice(0, 2), size: 12, weight: 700, color: '#FFFFFF', align: 'center' }),
    N('heading', 'app-brand', 78, 16, 220, 26, { text: ux.brand || ux.name, size: 20, weight: 700, color: '#171613', tag: 'h3' }),
    N('text', 'app-kicker', 79, 42, 220, 14, { text: ux.kicker || '', size: 9, ls: 1.6, color: '#9A958B' }),
  ];
  nav.forEach((n, i) => {
    els.push(N('text', `app-nav-${i}`, 360 + i * 92, 24, 86, 20, {
      text: n.label, size: 12, weight: i === 0 ? 600 : 400, align: 'center', color: i === 0 ? '#171613' : '#716D64',
    }));
  });
  els.push(
    N('box', 'app-search', 930, 16, 190, 36, { clip: true }, { background: '#FBFAF6', border: 1, borderColor: '#DDD8CD', radius: 9 }),
    N('text', 'app-search-t', 944, 26, 160, 16, { text: '搜索…', size: 11, color: '#9A958B' }),
    N('box', 'app-login', 1130, 16, 44, 36, {}, { background: accent, radius: 9 }),
    N('text', 'app-login-t', 1130, 26, 44, 16, { text: '登录', size: 11, weight: 600, color: '#FFFFFF', align: 'center' }),

    N('box', 'app-hero', 26, 100, 740, 296, { clip: true }, { background: accent, radius: 20 }),
    N('text', 'app-hero-kicker', 60, 132, 400, 16, { text: ux.home.kicker, size: 10, weight: 700, ls: 2, color: 'rgba(255,255,255,.75)' }),
    N('heading', 'app-hero-title', 60, 162, 640, 92, { text: ux.home.title, size: 38, weight: 700, lh: 1.18, color: '#FFFFFF', tag: 'h1' }),
    N('text', 'app-hero-sub', 60, 264, 600, 62, { text: ux.home.sub, size: 13, lh: 1.9, color: 'rgba(255,255,255,.82)' }),
    N('box', 'app-cta', 60, 340, 138, 38, { clip: true }, { background: '#FFFFFF', radius: 9 }),
    N('text', 'app-cta-t', 60, 351, 138, 18, { text: ux.home.cta || '开始使用', size: 12, weight: 700, align: 'center', color: '#171613' }),
    N('box', 'app-art', 786, 100, 388, 296, { clip: true }, { background: '#FFFFFF', border: 1, borderColor: '#DDD8CD', radius: 20 }),
    N('text', 'app-art-k', 812, 126, 300, 16, { text: '真实业务数据', size: 10, weight: 700, ls: 1.6, color: '#9A958B' }),
    N('heading', 'app-art-v', 812, 154, 330, 62, { text: String((ux.menu || []).length || (ux.counts && ux.counts.interfaces) || 0), size: 48, weight: 800, color: accent, tag: 'h2' }),
    N('text', 'app-art-l', 812, 222, 330, 16, { text: '业务模块', size: 11, color: '#716D64' }),
    N('divider', 'app-art-line', 812, 254, 330, 1, {}, { background: '#EFEBE2' }),
    N('text', 'app-art-list', 812, 272, 330, 100, {
      text: (ux.nav || []).map((n) => n.label).join('\n'), size: 11.5, lh: 1.9, color: '#3A3A36',
    }),

    N('text', 'app-sec-title', 26, 434, 500, 26, { text: '进入业务', size: 20, weight: 700, color: '#171613' }),
    N('text', 'app-sec-sub', 26, 464, 700, 18, { text: '所有列表、表单和操作都打在真实接口上，不是演示数据。', size: 11.5, color: '#716D64' }),
  );
  const cards = [
    { t: '浏览与筛选', d: '真实列表、分类、搜索和分页。', n: '01' },
    { t: '创建与编辑', d: '表单直接写入业务表，带字段校验。', n: '02' },
    { t: '详情与操作', d: '详情联查、状态流转和权限动作。', n: '03' },
  ];
  cards.forEach((c, i) => {
    const x = 26 + i * 388;
    els.push(N('box', `app-card-${i}`, x, 502, 360, 180, { clip: true }, { background: '#FFFFFF', border: 1, borderColor: '#DDD8CD', radius: 14 }, [
      N('text', `app-card-n-${i}`, 22, 22, 40, 20, { text: c.n, size: 10, weight: 700, ls: 1.4, color: accent }),
      N('heading', `app-card-t-${i}`, 22, 54, 300, 30, { text: c.t, size: 18, weight: 700, color: '#171613', tag: 'h3' }),
      N('text', `app-card-d-${i}`, 22, 96, 310, 54, { text: c.d, size: 12, lh: 1.85, color: '#716D64' }),
      N('text', `app-card-go-${i}`, 22, 148, 300, 18, { text: '进入 →', size: 11, weight: 600, color: accent }),
    ]));
  });
  els.push(
    N('divider', 'app-foot-line', 26, 724, 1148, 1, {}, { background: '#DDD8CD' }),
    N('text', 'app-foot-l', 26, 744, 600, 18, { text: `${ux.brand || ux.name} · ${ux.kicker || ''}`, size: 10, ls: 1.2, color: '#9A958B' }),
    N('text', 'app-foot-r', 760, 744, 414, 18, { text: 'CLICKBUILD · 业务应用 · 真实接口', size: 10, align: 'right', ls: 1.2, color: '#9A958B' })
  );
  return els;
}

function appPage(ux, item, index) {
  const label = (item && item.label) || '首页';
  const view = (item && item.view) || 'home';
  const el = N('appview', 'app-view-' + view, 0, 0, 1200, 780, {
    mode: ux.mode || 'content',
    brand: ux.brand || ux.name,
    mark: ux.mark || ux.code || 'APP',
    kicker: ux.kicker || '',
    title: label,
    sub: index === 0 ? (ux.tagline || ux.home && ux.home.sub || '') : (ux.name || '') + ' · ' + label,
    view,
    nav: (ux.nav || []).map((n) => n.label + '|' + n.view).join('\n'),
    iface: ux.primary && ux.primary.iface || '',
    api: ux.api || '/api',
    accent: ux.accent || '#2F5D50',
    bg: '#F6F3EC',
    color: '#171613',
    muted: '#8A8A84',
    radius: 0,
    pad: 22,
    size: 13,
    font: '',
  }, { background: 'transparent', border: 0, radius: 0, padding: 0 });
  return { id: view === 'home' ? 'home' : view, name: label, elements: [el], bg: '' };
}

function projectFor(file, project) {
  const data = makeCaseData(file, project);
  const cfg = CONFIG[file];
  if (!cfg) throw new Error(`缺少 ${file} 的业务页面配置`);
  const ux = Object.assign({}, cfg, {
    code: data.code,
    name: data.name,
    description: data.description,
    api: data.api,
    counts: data.counts,
    categories: data.categories,
    interfaces: data.interfaces,
    kicker: cfg.kicker || data.kicker,
    accent: cfg.accent || '#2F5D50',
  });
  const nav = (ux.nav && ux.nav.length) ? ux.nav.slice(0, 7) : [{ label: '首页', view: 'home' }];
  const pages = nav.map((item, i) => appPage(ux, item, i));
  const els = pages[0].elements;
  return {
    name: `${data.name} · 业务应用`,
    framework: 'app',
    page: { w: 1200, h: 780, bg: '#F6F3EC' },
    theme: { font: '-apple-system,"Segoe UI","Microsoft YaHei","Noto Sans SC",sans-serif', accent: ux.accent, radius: 14, grid: 8, showGrid: false },
    assets: [],
    responsive: true,
    stackMobile: true,
    pageNav: true,
    fullscreen: false,
    homePage: pages[0].id || 'home',
    pages,
    active: 0,
    elements: els,
    app: ux,
  };
}

function build(file, project) {
  const p = projectFor(file, project);
  const yxpp = {
    format: 'yxpp',
    version: 1,
    name: p.name,
    framework: 'app',
    createdAt: UPDATED,
    updatedAt: UPDATED,
    project: p,
    html: frontend.htmlFromProject(p, { name: p.name }),
  };
  return yxpp;
}

function validate(yxpp, project) {
  const errors = [];
  const p = yxpp.project || {};
  if (!p.app || !p.app.mode) errors.push('project 缺少 app 业务应用描述');
  if (!Array.isArray(p.elements) || !p.elements.length) errors.push('project 没有页面元素');
  if (!Array.isArray(p.pages) || !p.pages.length) errors.push('project 没有 pages');
  const html = String(yxpp.html || '');
  if (!html.includes('id="app"')) errors.push('html 缺少应用根节点');
  if (!html.includes('window.CASE =')) errors.push('html 没有注入应用配置');
  if (!html.includes('window.UX =')) errors.push('html 缺少运行时');
  if (html.includes('CASE / ')) errors.push('html 仍是接口案例介绍页');
  if (html.includes('接口清单')) errors.push('html 仍是接口清单');
  if (html.length < 60000) errors.push('html 体积过小，可能没有带入运行时');
  return errors;
}

let ok = 0;
let bad = 0;
let skipped = 0;
for (const file of fs.readdirSync(CASES).filter((f) => f.endsWith('.json')).sort()) {
  const base = file.replace(/\.json$/, '');
  if (SKIP.has(base)) {
    skipped++;
    console.log(`KEEP  ${file}  已有独立真实前端`);
    continue;
  }
  const full = path.join(CASES, file);
  const project = JSON.parse(fs.readFileSync(full, 'utf8'));
  let yxpp;
  let errors = [];
  try {
    yxpp = build(base, project);
    errors = validate(yxpp, project);
  } catch (e) {
    errors = [e.message];
  }
  if (errors.length) {
    bad++;
    console.log(`FAIL  ${file}  ${errors.join(' | ')}`);
    continue;
  }
  ok++;
  console.log(`PASS  ${file}  ${project.interfaces.length} 接口 / ${yxpp.project.elements.length} 元素 / ${yxpp.project.app.mode} / ${Math.round(yxpp.html.length / 1024)} KB HTML`);
  if (!checkOnly) {
    project.frontend = yxpp;
    fs.writeFileSync(full, JSON.stringify(project, null, 2) + '\n', 'utf8');
  }
}
console.log(`\n${ok}/${ok + bad} 案例业务应用生成${checkOnly ? '校验' : ''}通过${skipped ? `，${skipped} 套保留原前端` : ''}`);
process.exit(bad ? 1 : 0);
