'use strict';
// 作者：yxpil
// 把 PageStudio 原生多页 project 渲染成可独立部署的 HTML。
// 不依赖前端工坊：文本/标题/按钮/容器/形状/分割线/表格/表单/JS 全部落成真实 DOM，
// 页面切换、表单提交和业务 JS 在导出后照常运行。
const PAGE_ATTR = 'data-ps-page';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function attr(s) { return esc(s).replace(/\n/g, '&#10;'); }
function px(n) { return Number(n || 0) + 'px'; }
function css(style) {
  const s = style || {};
  const out = [];
  if (s.background) out.push('background:' + s.background);
  if (s.border != null && Number(s.border) > 0) out.push('border:' + Number(s.border) + 'px solid ' + (s.borderColor || '#ddd'));
  if (s.border === 0) out.push('border:0');
  if (s.radius != null) out.push('border-radius:' + px(s.radius));
  if (s.shadow && s.shadow !== 'none') out.push('box-shadow:' + s.shadow);
  if (s.opacity != null && Number(s.opacity) !== 1) out.push('opacity:' + Number(s.opacity));
  if (s.padding) out.push('padding:' + px(s.padding));
  return out.join(';');
}
function textCss(p) {
  const out = ['font-family:' + (p.font || 'Inter, "PingFang SC", sans-serif'), 'font-size:' + px(p.size || 14), 'font-weight:' + Number(p.weight || 400), 'color:' + (p.color || '#222'), 'line-height:' + (p.lh || 1.5), 'letter-spacing:' + px(p.ls || 0), 'text-align:' + (p.align || 'left'), 'white-space:pre-wrap', 'overflow-wrap:break-word'];
  return out.join(';');
}
function tableCsv(raw) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(raw || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function tableHtml(p) {
  const rows = tableCsv(p.data);
  const head = p.header !== false && rows.length ? rows.shift() : null;
  const max = Number(p.maxRows || 0);
  const body = max > 0 ? rows.slice(0, max) : rows;
  const cellStyle = 'padding:' + px(p.padding || 10) + ';border-bottom:1px solid ' + (p.borderColor || '#E5E2D8') + ';font-size:' + px(p.size || 11.5) + ';color:' + (p.color || '#222') + ';vertical-align:middle';
  const th = cellStyle + ';background:' + (p.headBg || '#F0EDE4') + ';font-weight:600;text-align:left';
  if (!head && !body.length) return '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:' + (p.color || '#777') + ';font-size:12px">' + esc(p.empty || '暂无数据') + '</div>';
  return '<div style="height:100%;overflow:auto;border-radius:' + px(p.radius == null ? 8 : p.radius) + '"><table data-ps-table style="width:100%;border-collapse:collapse;background:' + (p.bg || '#fff') + '">' +
    (head ? '<thead><tr>' + head.map((h) => '<th style="' + th + '">' + esc(h) + '</th>').join('') + '</tr></thead>' : '') +
    '<tbody>' + (body.length ? body.map((r) => '<tr>' + r.map((c, i) => '<td style="' + cellStyle + (i === 0 ? ';font-weight:600' : '') + '">' + esc(c) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + ((head && head.length) || 1) + '" style="' + cellStyle + ';text-align:center;padding:24px;color:#8b948d">' + esc(p.empty || '暂无数据') + '</td></tr>') + '</tbody></table></div>';
}
function formFields(raw) {
  return String(raw || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const a = line.split('|');
    return { label: a[0] || '', type: a[1] || 'text', ph: a[2] || '', name: a[3] || a[0] || ('f' + Math.random()), required: /^required$/i.test(a[4] || '') };
  });
}
function formHtml(p) {
  const fields = formFields(p.fields);
  const label = 'display:flex;flex-direction:column;gap:4px;font-size:10px;color:' + (p.labelColor || '#777');
  const input = 'width:100%;box-sizing:border-box;border:1px solid #D4D4CE;border-radius:' + px(p.radius == null ? 5 : p.radius) + ';padding:0 10px;background:' + (p.inputBg || '#fff') + ';color:#333;font-size:' + px(p.size || 12) + ';outline:0;height:32px;font-family:inherit';
  return '<form id="' + attr(p.id) + '" data-ps-form data-mode="' + attr(p.submitMode || 'native') + '" action="' + attr(p.action || '') + '" method="' + attr(String(p.method || 'post').toLowerCase()) + '" data-ps-success="' + attr(p.success || '提交成功') + '" data-ps-custom="' + attr(p.custom || '') + '" style="height:100%;display:flex;flex-direction:column;gap:8px;overflow:auto">' +
    fields.map((f) => {
      const req = f.required ? ' required' : '';
      const ctrl = f.type === 'textarea'
        ? '<textarea name="' + attr(f.name) + '" placeholder="' + attr(f.ph) + '"' + req + ' style="' + input + ';height:64px;padding:8px 10px;resize:none"></textarea>'
        : '<input type="' + attr(f.type) + '" name="' + attr(f.name) + '" placeholder="' + attr(f.ph) + '"' + req + ' style="' + input + '">';
      return '<label style="' + label + '"><span>' + esc(f.label) + (f.required ? ' <b style="color:#B84A33">*</b>' : '') + '</span>' + ctrl + '</label>';
    }).join('') +
    '<button type="submit" style="margin-top:auto;width:100%;height:38px;border:0;border-radius:' + px(p.radius == null ? 5 : p.radius) + ';background:' + (p.submitBg || '#2F4A3C') + ';color:' + (p.submitColor || '#fff') + ';font-size:12px;font-weight:600;cursor:pointer">' + esc(p.submit || '提交') + '</button>' +
    '<div data-ps-form-msg style="min-height:18px;font-size:10.5px;color:' + (p.labelColor || '#777') + '"></div></form>';
}
function elementHtml(n) {
  const p = n.props || {};
  const base = 'position:absolute;left:' + px(n.x) + ';top:' + px(n.y) + ';width:' + px(n.w) + ';height:' + px(n.h) + ';box-sizing:border-box;' + css(n.style) + ';';
  const id = p.id ? ' id="' + attr(p.id) + '"' : '';
  const meta = ' data-ps-id="' + attr(n.id) + '" data-ps-type="' + attr(n.type) + '"';
  if (n.type === 'text') return '<div' + id + meta + ' style="' + base + textCss(p) + '">' + esc(p.text || '') + '</div>';
  if (n.type === 'heading') { const tag = /^h[1-6]$/.test(p.tag || '') ? p.tag : 'h2'; return '<' + tag + id + meta + ' style="' + base + textCss(p) + ';margin:0;font-weight:' + Number(p.weight || 500) + '">' + esc(p.text || '') + '</' + tag + '>'; }
  if (n.type === 'button') return '<button type="button"' + id + meta + ' style="' + base + 'display:flex;align-items:center;justify-content:' + ((p.align || 'center') === 'right' ? 'flex-end' : ((p.align || 'center') === 'left' ? 'flex-start' : 'center')) + ';font-family:' + (p.font || 'inherit') + ';font-size:' + px(p.size || 13) + ';font-weight:' + Number(p.weight || 500) + ';color:' + (p.color || '#222') + ';cursor:pointer;padding:0 4px">' + esc(p.text || '') + '</button>';
  if (n.type === 'shape') { const kind = p.kind || 'rect'; const radius = kind === 'circle' ? '50%' : (kind === 'pill' ? '999px' : px(p.radius == null ? 8 : p.radius)); return '<div' + id + meta + ' style="' + base + 'background:' + (p.fill || '#ddd') + ';border-radius:' + radius + ';' + (p.strokeOn ? 'border:1px solid ' + (p.strokeColor || '#999') : '') + '"></div>'; }
  if (n.type === 'divider') return '<div' + id + meta + ' style="' + base + 'background:' + ((n.style && n.style.background) || '#E5E2D8') + ';height:' + px(n.h || 1) + '"></div>';
  if (n.type === 'box') return '<div' + id + meta + ' style="' + base + '">' + '</div>';
  if (n.type === 'table') return '<div' + id + meta + ' style="' + base + '">' + tableHtml(p) + '</div>';
  if (n.type === 'form') return '<div' + id + meta + ' style="' + base + '">' + formHtml(p) + '</div>';
  if (n.type === 'js') return '<div' + id + meta + ' style="display:none"></div><script data-ps-js>' + String(p.code || '') + '</script>';
  if (n.type === 'image') return '<img' + id + meta + ' src="' + attr(p.src || '') + '" style="' + base + 'object-fit:' + (p.fit || 'cover') + '">';
  if (n.type === 'list') return '<div' + id + meta + ' style="' + base + '">' + String(p.text || '').split('\n').map((t) => '<div style="padding:4px 0">' + esc(t) + '</div>').join('') + '</div>';
  return '<div' + id + meta + ' style="' + base + '"></div>';
}
function build(project, opts) {
  opts = opts || {};
  const pages = (project.pages || []);
  const active = pages[Number(project.active || 0)] || pages[0];
  const title = opts.name || project.name || 'PageStudio';
  const sections = pages.map((pg) => '<section class="ps-page" ' + PAGE_ATTR + '="' + attr(pg.id) + '" style="display:' + (pg === active ? 'block' : 'none') + ';position:relative;width:' + px(project.page && project.page.w || 1200) + ';height:' + px(project.page && project.page.h || 820) + ';background:' + (pg.bg || (project.page && project.page.bg) || '#fff') + ';overflow:hidden">' + (pg.elements || []).map(elementHtml).join('') + '</section>').join('');
  const nav = '<div class="ps-nav" style="display:none">' + pages.map((pg) => '<button class="ps-nav-b" data-ps-go="' + attr(pg.id) + '">' + esc(pg.name || pg.id) + '</button>').join('') + '</div>';
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' +
    '*{box-sizing:border-box}html,body{margin:0;padding:0;background:' + ((project.page && project.page.bg) || '#F4F5EF') + '}body{font-family:' + (project.theme && project.theme.font || 'Inter, "PingFang SC", sans-serif') + ';color:' + (project.theme && project.theme.ink || '#222') + '}#ps-root{width:' + px(project.page && project.page.w || 1200) + ';margin:0 auto;position:relative}.ps-page{position:relative}.ps-page:not(:first-child){display:none}button{font:inherit}input,textarea,select{font:inherit}' +
    '</style></head><body><div id="ps-root">' + nav + sections + '</div><script>(function(){var pages=[].slice.call(document.querySelectorAll(".ps-page"));function go(id){pages.forEach(function(p){p.style.display=p.getAttribute("data-ps-page")===id?"block":"none"});var h=document.querySelector("[data-ps-go=\\\""+id+"\\\"]");if(h)h.classList.add("on");history.replaceState(null,"","#"+id)}document.addEventListener("click",function(e){var b=e.target.closest("[data-ps-go]");if(!b)return;e.preventDefault();go(b.getAttribute("data-ps-go"))});var hash=location.hash.replace("#","");if(hash)go(hash);' +
    'function collect(f){var d={};new FormData(f).forEach(function(v,k){d[k]=v});return d}' +
    'function msg(f,t,ok){var m=f.querySelector("[data-ps-form-msg]");if(m){m.textContent=t;m.style.color=ok?"#2F4A3C":"#B84A33"}}' +
    'document.querySelectorAll("form[data-ps-form]").forEach(function(f){f.addEventListener("submit",function(e){e.preventDefault();var data=collect(f);var mode=f.getAttribute("data-mode")||"native";var success=f.getAttribute("data-ps-success")||"提交成功";' +
    'if(mode==="custom"){var code=f.getAttribute("data-ps-custom")||"";try{var done=function(r){msg(f,success,true);f.reset()};var ret=new Function("data","form","done",code)(data,f,done);if(ret&&typeof ret.then==="function"){ret.then(function(){msg(f,success,true);f.reset()}).catch(function(err){msg(f,err&&err.message?err.message:"提交失败",false)})}else if(!ret){msg(f,success,true);f.reset()}}catch(err){msg(f,err&&err.message?err.message:"提交失败",false)}return}' +
    'var action=f.getAttribute("action")||location.pathname;fetch(action,{method:(f.getAttribute("method")||"post").toUpperCase(),headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}).then(function(){msg(f,success,true);f.reset()}).catch(function(err){msg(f,err.message||"提交失败",false)})});});})();</script></body></html>';
}
module.exports = { build };
