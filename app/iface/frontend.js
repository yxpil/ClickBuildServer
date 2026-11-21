// 作者：yxpil
'use strict';

// .yxpp：PageStudio 前端工程（单文件 JSON），可以单独存在，也可以被 .yxpn 内嵌。
// 格式：{ format:'yxpp', version:1, name, framework, project:{page,elements,...}, html, createdAt, updatedAt }
// 兼容直接导入 PageStudio 原生的「保存项目 JSON」（它只有 page/elements）。

const fs = require('fs');
const path = require('path');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeHtml = (h) => String(h || '')
  .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
  .replace(/<\s*script[^>]*>/gi, '')
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/javascript:/gi, '');

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function px(v) { return `${num(v)}px`; }

const ICON_PATHS = {
  'arrow-right': 'M4 12h15M13 6l6 6-6 6', 'arrow-left': 'M20 12H5M11 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'M6 6l12 12M18 6L6 18',
  check: 'M4 12.5l5 5L20 6.5', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4',
  star: 'M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c0-4 3.6-6 8-6s8 2 8 6',
  home: 'M4 11l8-7 8 7M6 10v10h12V10', settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  download: 'M12 3v12M7 11l5 5 5-5M4 20h16', upload: 'M12 20V8M7 12l5-5 5 5M4 4h16',
  link: 'M10 14a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6l-2 2M14 10a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6-6l2-2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4', play: 'M8 5l11 7-11 7z',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4', layers: 'M12 3l9 5-9 5-9-5zM3 13.5l9 5 9-5',
  cart: 'M3 4h3l2.5 11h10.5l2-8H7.5', tag: 'M4 4h8l8 8-8 8-8-8z', bookmark: 'M7 3h10v18l-5-4-5 4z',
  alert: 'M12 4l9 16H3zM12 10v5M12 18h.01', info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 9h.01M12 12v5',
  chat: 'M4 5h16v10H10l-4 4v-4H4z', bell: 'M6 17h12M8 17V10a4 4 0 0 1 8 0v7M10 20h4',
  shield: 'M12 3l7 3v5c0 5-4 8-7 10-3-2-7-5-7-10V6z', zap: 'M13 3L5 14h6l-1 7 8-11h-6z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6', phone: 'M8 3H6a2 2 0 0 0-2 2v2c0 8 6 14 14 14h2a2 2 0 0 0 2-2v-2l-4-1-2 2c-3-1-5-3-6-6l2-2z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4', clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 8v5l3 2',
  file: 'M6 3h8l4 4v15H6zM14 3v5h4', folder: 'M3 7h7l2 2h9v11H3z',
  square: 'M4 4h16v16H4z', box: 'M4 4h16v16H4zM4 9h16', quote: 'M6 8h4v6a3 3 0 0 1-3 3M14 8h4v6a3 3 0 0 1-3 3',
};

function iconSvg(name, w, h, color, stroke) {
  const d = ICON_PATHS[name] || ICON_PATHS.square;
  return `<svg width="${num(w)}" height="${num(h)}" viewBox="0 0 24 24" fill="none" stroke="${esc(color || '#0B0B0B')}" stroke-width="${num(stroke, 1.6)}" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="${d}"/></svg>`;
}

function styleOf(n) {
  const s = (n && n.style) || {};
  const out = [];
  if (s.background) out.push(`background:${esc(s.background)}`);
  if (s.border) out.push(`border:${num(s.border)}px solid ${esc(s.borderColor || '#D4D4CE')}`);
  if (s.radius != null) out.push(`border-radius:${px(s.radius)}`);
  if (s.padding != null) out.push(`padding:${px(s.padding)}`);
  if (s.opacity != null) out.push(`opacity:${num(s.opacity, 1)}`);
  return out.join(';');
}

function nodeHtml(n) {
  if (!n || n.hidden) return '';
  const type = String(n.type || 'container');
  const x = num(n.x), y = num(n.y), w = num(n.w), h = num(n.h);
  const base = `position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};box-sizing:border-box;`;
  const st = styleOf(n);
  const p = (n && n.props) || {};
  const common = `${base}${st}`;
  const textStyle = (extra = '') => {
    const align = p.align || 'left';
    const color = p.color || '#0B0B0B';
    const size = num(p.size, 14);
    const weight = num(p.weight, 400);
    const lh = p.leading != null ? num(p.leading, 1.4) : (p.lh != null ? num(p.lh, 1.4) : 1.45);
    const ls = p.ls != null ? num(p.ls, 0) : 0;
    return `color:${esc(color)};font-size:${px(size)};font-weight:${weight};line-height:${lh};letter-spacing:${ls}px;text-align:${esc(align)};white-space:pre-wrap;${extra}`;
  };
  const txt = (v) => esc(v).replace(/\r/g, '').replace(/\n/g, '<br>');
  if (type === 'text' || type === 'heading' || type === 'badge' || type === 'link') {
    const tag = type === 'heading' ? (p.tag || 'h2') : (type === 'link' ? 'a' : 'div');
    const href = type === 'link' ? ` href="${esc(p.href || '#')}"` : '';
    return `<${tag}${href} style="${common};${textStyle(type === 'link' ? 'text-decoration:underline;' : '')}">${txt(p.text)}</${tag}>`;
  }
  if (type === 'button') {
    const bg = (n.style && n.style.background) || '#0B0B0B';
    const fg = p.color || '#FFFFFF';
    return `<div style="${common};background:${esc(bg)};color:${esc(fg)};display:flex;align-items:center;justify-content:center;font-size:${px(num(p.size, 12))};font-weight:${num(p.weight, 500)};border-radius:${px(num((n.style || {}).radius, 3))}">${esc(p.text)}</div>`;
  }
  if (type === 'divider' || type === 'spacer') {
    return `<div style="${common};background:${esc((n.style && n.style.background) || (type === 'divider' ? '#D4D4CE' : 'transparent'))}"></div>`;
  }
  if (type === 'html') return `<div style="${common};overflow:hidden">${safeHtml(p.code)}</div>`;
  if (type === 'image' || type === 'svg') {
    const src = p.src || p.svg || '';
    if (/^data:image\//.test(src) || /^https?:\/\//.test(src)) {
      return `<img src="${esc(src)}" alt="${esc(p.alt || n.name || '')}" style="${common};object-fit:${esc(p.fit || 'contain')}">`;
    }
    if (String(src).trim().startsWith('<svg')) return `<div style="${common}">${safeHtml(src)}</div>`;
    return `<div style="${common};display:flex;align-items:center;justify-content:center;color:${esc(p.color || '#0B0B0B')};font-size:${px(num(p.size, 12))}">${esc(p.alt || '')}</div>`;
  }
  if (type === 'icon') {
    if (p.svg && String(p.svg).trim().startsWith('<svg')) return `<div style="${common}">${safeHtml(p.svg)}</div>`;
    return `<div style="${common};display:flex;align-items:center;justify-content:center">${iconSvg(p.icon, w, h, p.color, p.stroke)}</div>`;
  }
  if (type === 'input') {
    return `<input type="text" placeholder="${esc(p.placeholder || '')}" style="${common};${textStyle('')};padding:0 10px;outline:0;border:1px solid ${esc((n.style && n.style.borderColor) || '#D4D4CE')}">`;
  }
  if (type === 'appview') {
    const bg = p.bg || '#F6F3EC';
    const ink = p.accent || '#2F5D50';
    const brand = esc(p.brand || p.name || '业务应用');
    const view = esc(p.view || 'home');
    const nav = String(p.nav || '').split('\n').map((s) => s.split('|')[0]).filter(Boolean).slice(0, 6);
    return `<div class="appview-block" data-appview="1" data-view="${view}" style="${common};background:${esc(bg)};border:1px solid #D8D3C8;border-radius:${px(num((n.style || {}).radius, 12))};overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif">
<div style="height:56px;display:flex;align-items:center;gap:10px;padding:0 18px;background:#fff;border-bottom:1px solid #E4E0D6">
<span style="width:30px;height:30px;border-radius:9px;background:${esc(ink)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">${esc(String(p.mark || 'AP').slice(0, 2))}</span>
<b style="font-size:15px;color:#171613">${brand}</b>
<span style="margin-left:auto;font-size:10px;color:#8A8A84">真实接口数据</span>
</div>
<div style="display:flex;height:calc(100% - 56px)">
<div style="width:180px;background:#fff;border-right:1px solid #E4E0D6;padding:12px 10px">${nav.map((x) => `<div style="padding:7px 9px;border-radius:7px;font-size:11px;color:#3A3A36">${esc(x)}</div>`).join('')}</div>
<div style="flex:1;padding:18px;min-width:0">
<div style="font-size:10px;letter-spacing:.12em;color:#8A8A84">${esc(String(p.kicker || 'BUSINESS APP').toUpperCase())}</div>
<h2 style="margin:4px 0 6px;font-size:26px;color:#171613">${esc(p.title || brand)}</h2>
<p style="margin:0;font-size:12px;line-height:1.6;color:#5F5F5A">${esc(p.sub || '')}</p>
</div></div></div>`;
  }
  if (type === 'list') {
    const items = String(p.text || '').split('\n').map((line) => `<li>${esc(line)}</li>`).join('');
    const bullets = p.bullet === false ? 'list-style:none;padding-left:0' : 'list-style:disc;padding-left:18px';
    return `<div style="${common};${textStyle('')}"><ul style="margin:0;${bullets}">${items}</ul></div>`;
  }
  const children = (Array.isArray(n.children) ? n.children : []).map(nodeHtml).join('');
  return `<div style="${common};overflow:${p.clip ? 'hidden' : 'visible'}">${children}</div>`;
}

function readRuntimeFile(name) {
  const file = path.join(__dirname, 'runtime', name);
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
}

// 把案例 seed.sql 拆成预览表数据；只在 PageStudio 画布预览里使用，不改生成服务。
function splitSqlTuples(text) {
  const out = [];
  let depth = 0, quote = false, start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" && text[i - 1] !== '\\') {
      if (quote && text[i + 1] === "'") { i += 1; continue; }
      quote = !quote;
    } else if (!quote) {
      if (c === '(') { if (depth === 0) start = i + 1; depth += 1; }
      else if (c === ')') { depth -= 1; if (depth === 0 && start >= 0) { out.push(text.slice(start, i)); start = -1; } }
    }
  }
  return out;
}

function splitSqlFields(text) {
  const out = [];
  let quote = false, start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" && text[i - 1] !== '\\') {
      if (quote && text[i + 1] === "'") { i += 1; continue; }
      quote = !quote;
    } else if (c === ',' && !quote) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((x) => x.trim());
}

function parseSqlValue(raw) {
  const text = String(raw || '').trim();
  if (/^null$/i.test(text)) return null;
  if (/^'.*'$/.test(text)) return text.slice(1, -1).replace(/''/g, "'");
  if (/^now\(\)$/i.test(text) || /^current_timestamp$/i.test(text)) return new Date().toISOString();
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function seedTables(sql) {
  const tables = {};
  const re = /INSERT\s+INTO\s+([A-Za-z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(String(sql || '')))) {
    const name = m[1];
    const cols = m[2].split(',').map((x) => x.trim().replace(/^`|`$/g, ''));
    const rows = splitSqlTuples(m[3]).map((tuple) => {
      const vals = splitSqlFields(tuple).map(parseSqlValue);
      const row = {};
      cols.forEach((c, i) => { row[c] = vals[i]; });
      return row;
    });
    tables[name] = (tables[name] || []).concat(rows);
  }
  return tables;
}

function routeRegex(routePath) {
  const keys = [];
  const pathText = String(routePath || '');
  let src = '';
  let last = 0;
  pathText.replace(/:([A-Za-z0-9_]+)/g, (all, key, index) => {
    src += pathText.slice(last, index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    src += '([^/]+)';
    keys.push(key);
    last = index + all.length;
    return all;
  });
  src += pathText.slice(last).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { source: '^' + src + '$', keys };
}

function appPreviewData(app, seed) {
  const a = app || {};
  const tables = seedTables(seed && seed.sql);
  const routes = [];
  (a.interfaces || []).forEach((iface) => {
    const tableMap = {};
    (iface.tables || []).forEach((t) => { tableMap[t.key || 'main'] = t.name; });
    (iface.routes || []).forEach((r) => {
      const full = '/api' + String(iface.basePath || '') + String(r.path || '');
      const table = tableMap[r.table || 'main'] || ((iface.tables || [])[0] || {}).name || '';
      const rx = routeRegex(full);
      routes.push({ method: String(r.method || 'GET').toUpperCase(), path: full, source: rx.source, keys: rx.keys, table });
    });
  });
  const auth = a.auth || {};
  const userTable = ((a.interfaces || []).find((i) => i.name === auth.iface) || {}).tables || [];
  const userRows = userTable.length ? (tables[userTable[0].name] || []) : [];
  return { tables, routes, user: userRows[0] || { only_id: 'preview_user', nickname: '预览用户', username: 'preview' } };
}

function previewRuntimeScript(data) {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script>
(function(){
  window.CBS_PREVIEW = true;
  var P = ${payload};
  window.CBS_PREVIEW_AUTH = { token: 'preview-token', user: P.user || {} };
  var tables = P.tables || {};
  var routes = P.routes || [];
  var seq = 9000;
  function bodyOf(init) {
    try { return init && init.body ? JSON.parse(init.body) : {}; } catch (e) { return {}; }
  }
  function dataRes(data, status) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, data: data }), { status: status || 200, headers: { 'content-type': 'application/json' } }));
  }
  function matchRoute(method, path) {
    var hit = null;
    routes.forEach(function (r) {
      if (r.method !== method) return;
      var m = path.match(new RegExp(r.source));
      if (!m) return;
      var params = {};
      (r.keys || []).forEach(function (k, i) { params[k] = decodeURIComponent(m[i + 1] || ''); });
      hit = { route: r, params: params };
    });
    return hit;
  }
  function rowsFor(route) { return (tables[route.table] || []).slice(); }
  function findRow(rows, id) {
    var key = ['id', 'only_id', 'code', 'order_no'].filter(function (k) { return rows[0] && rows[0][k] !== undefined; })[0] || 'id';
    return rows.find(function (x) { return String(x[key]) === String(id); }) || rows[0] || null;
  }
  window.fetch = function (input, init) {
    var raw = String(input && input.url ? input.url : input);
    var path = (raw.match(/\\/api\\/[^?#]*/) || [''])[0];
    var method = String((init && init.method) || 'GET').toUpperCase();
    var hit = matchRoute(method, path);
    if (!hit) return dataRes({ rows: [], total: 0 });
    var route = hit.route;
    var rows = rowsFor(route);
    if (method === 'GET') {
      if (Object.keys(hit.params).length) {
        var row = findRow(rows, hit.params.id || hit.params[Object.keys(hit.params)[0]]);
        return dataRes(row || {});
      }
      return dataRes({ rows: rows, total: rows.length, page: 1, pageSize: rows.length });
    }
    if (method === 'POST' && /\\/login$|\\/register$/.test(path)) {
      return dataRes({ token: 'preview-token', user: P.user });
    }
    if (method === 'POST' && /\\/add$/.test(path)) return dataRes({ ok: true });
    if (method === 'POST' || method === 'PUT') {
      var body = bodyOf(init);
      var id = body.id || (hit.params && (hit.params.id || hit.params[Object.keys(hit.params)[0]])) || (++seq);
      body.id = Number(id) || id;
      tables[route.table] = rows.filter(function (x) { return String(x.id) !== String(id); }).concat([body]);
      return dataRes(body, method === 'POST' ? 201 : 200);
    }
    if (method === 'DELETE') {
      tables[route.table] = rows.filter(function (x) { return String(x.id) !== String(hit.params.id); });
      return dataRes({ deleted: 1 });
    }
    return dataRes({ ok: true });
  };
})();
</script>`;
}

// app 模式：project.app 是业务应用描述（模式、接口、菜单、动作、权限）。
// 页面由 PageStudio 的「业务应用」组件声明，运行时按同一份描述渲染真实列表、表单、详情和流程。
function htmlFromApp(studioProject, meta) {
  const p = studioProject || {};
  const app = p.app || {};
  const title = esc(meta && meta.name ? meta.name : (app.name || p.name || 'ClickBuild 应用'));
  const css = readRuntimeFile('app.css');
  const js = readRuntimeFile('app-runtime.js');
  const preview = meta && meta.preview && app.mode;
  const previewInfo = preview ? appPreviewData(app, p.previewSeed || (app.seed && app.seed.sql ? app.seed : null)) : null;
  const appForPayload = Object.assign({}, app);
  delete appForPayload.seed;
  const payload = JSON.stringify(appForPayload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const previewScript = previewInfo ? previewRuntimeScript(previewInfo) : '';
  if (!css || !js) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title></head><body>
<div style="font:14px/1.7 system-ui;padding:40px;max-width:720px;margin:0 auto">
<h1>应用运行时未安装</h1><p>这个 .yxpp 使用业务应用模式，但当前环境缺少 <code>app/iface/runtime/app-runtime.js</code> 或 <code>app.css</code>。</p>
</div></body></html>`;
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
<header id="topbar" class="topbar"></header>
<main id="app"></main>
<div id="toasts" class="toast-wrap"></div>
<script>window.CASE = ${payload}; window.UX = window.CASE;${preview ? ` window.CBS_PREVIEW_VIEW = ${JSON.stringify(meta.view || 'home')};` : ''}</script>
${previewScript}
<script>
${js}
</script>
</body>
</html>
`;
}

function htmlFromProject(studioProject, meta) {
  const p = studioProject || {};
  if (p.app && p.app.mode) return htmlFromApp(p, meta);
  const page = p.page || { w: 1200, h: 880, bg: '#FFFFFF' };
  const theme = p.theme || {};
  const nodes = (Array.isArray(p.elements) ? p.elements : []).map(nodeHtml).join('\n');
  const title = esc(meta && meta.name ? meta.name : (p.name || 'ClickBuild 前端页面'));
  const font = esc(theme.font || 'system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:${esc(page.bg || '#FFFFFF')};font-family:${font};color:#0B0B0B}
body{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:24px}
.page{position:relative;width:${num(page.w, 1200)}px;height:${num(page.h, 880)}px;background:${esc(page.bg || '#FFFFFF')};overflow:hidden;flex:none;box-shadow:0 0 0 1px #E5E5E0}
@media (max-width:1300px){body{padding:12px}.page{transform:scale(.82);transform-origin:top center;margin-bottom:-${Math.round(num(page.h, 880) * 0.18)}px}}
</style>
</head>
<body>
<div class="page">
${nodes}
</div>
</body>
</html>
`;
}

function normalizeStudioProject(input) {
  const p = input && typeof input === 'object' ? input : null;
  if (p && p.app && p.app.mode) {
    if (!p.page) p.page = { w: 1200, h: 880, bg: p.app.bg || '#F6F3EC' };
    if (!Array.isArray(p.elements)) p.elements = [];
    return p;
  }
  if (!p || !p.page || !Array.isArray(p.elements)) {
    throw new Error('不是有效的前端工程：需要 page 和 elements 数组，或 app 业务应用描述');
  }
  return p;
}

function parseYxpp(input, fallbackName) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的 .yxpp：不是 JSON 对象');
  let project;
  let meta = {};
  if (raw.format === 'yxpp' && raw.project) {
    project = normalizeStudioProject(raw.project);
    meta = raw;
  } else {
    project = normalizeStudioProject(raw);
    meta = { name: raw.name || fallbackName || '前端工程', framework: raw.framework || 'tailwind' };
  }
  const yxpp = {
    format: 'yxpp',
    version: 1,
    name: String(meta.name || fallbackName || project.name || '前端工程'),
    framework: String(meta.framework || project.framework || 'tailwind'),
    createdAt: meta.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project,
    html: String(meta.html || '').trim() || htmlFromProject(project, { name: meta.name || fallbackName }),
  };
  return yxpp;
}

function attach(project, yxpp) {
  const p = project || {};
  return {
    ...p,
    frontend: {
      format: 'yxpp',
      version: 1,
      name: yxpp.name,
      framework: yxpp.framework || 'tailwind',
      updatedAt: yxpp.updatedAt || new Date().toISOString(),
      project: yxpp.project,
      html: yxpp.html || htmlFromProject(yxpp.project, { name: yxpp.name }),
    },
  };
}

function readYxpp(file) {
  return parseYxpp(fs.readFileSync(file, 'utf8'), path.basename(file, path.extname(file)));
}

function writeYxpp(file, yxpp) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(yxpp, null, 2) + '\n', 'utf8');
  return { file, size: fs.statSync(file).size };
}

function previewHtml(studioProject, meta) {
  return htmlFromProject(studioProject, Object.assign({ preview: true }, meta || {}));
}

module.exports = { parseYxpp, attach, htmlFromProject, previewHtml, readYxpp, writeYxpp };
