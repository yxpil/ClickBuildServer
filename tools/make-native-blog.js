'use strict';
// 作者：yxpil
// 博客案例：PageStudio 原生组件拼接，4 页（首页 / 全部文章 / 文章详情 / 作者后台）。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const W = 1200, H = 820;
let seq = 0;
const SANS = '"Inter","PingFang SC","Microsoft YaHei",sans-serif';
const SERIF = '"Noto Serif SC","Songti SC","SimSun",serif';
const MONO = '"JetBrains Mono","Consolas",monospace';

function E(type, x, y, w, h, props, style, name) {
  seq += 1;
  const id = (props && props.id) || `bl-${seq}`;
  return { id, type, x, y, w, h, name: name || '', hidden: false, locked: false, props: Object.assign({ id }, props || {}), style: style || {} };
}
function T(text, x, y, w, h, o) { o = o || {}; return E('text', x, y, w, h, { text, size: o.size || 14, weight: o.weight || 400, color: o.color || B.ink, lh: o.lh || 1.5, ls: o.ls == null ? 0 : o.ls, align: o.align || 'left', font: o.font || SANS, id: o.id }, o.style || {}, o.name); }
function Hd(text, x, y, w, h, o) { o = o || {}; return E('heading', x, y, w, h, { text, size: o.size || 40, weight: o.weight || 500, color: o.color || B.ink, lh: o.lh || 1.16, ls: o.ls == null ? -0.5 : o.ls, align: o.align || 'left', font: o.font || SERIF, tag: o.tag || 'h2', id: o.id }, o.style || {}, o.name); }
function Btn(text, x, y, w, h, o) { o = o || {}; return E('button', x, y, w, h, { text, size: o.size || 13, weight: o.weight || 500, color: o.color || B.ink, font: o.font || SANS, id: o.id }, Object.assign({ background: o.bg || 'transparent', border: o.border == null ? 0 : o.border, borderColor: o.borderColor || 'transparent', radius: o.radius == null ? 0 : o.radius }, o.style || {}), o.name); }
function Box(x, y, w, h, o) { o = o || {}; return E('box', x, y, w, h, { id: o.id }, Object.assign({ background: o.bg || B.card, border: o.border == null ? 1 : o.border, borderColor: o.borderColor || B.line, radius: o.radius == null ? 14 : o.radius, shadow: o.shadow || 'none', opacity: 1, padding: o.padding || 0 }, o.style || {}), o.name); }
function Shape(x, y, w, h, kind, fill, o) { o = o || {}; return E('shape', x, y, w, h, { kind, fill, strokeOn: false, radius: o.radius == null ? 8 : o.radius, id: o.id }, { opacity: o.opacity == null ? 1 : o.opacity }, o.name); }
function Line(x, y, w, o) { o = o || {}; return E('divider', x, y, w, 1, { id: o.id }, { background: o.color || B.line }); }
const B = { paper: '#F3F1E9', card: '#FCFBF6', ink: '#1B1D1A', muted: '#73776E', line: '#DEDBD1', accent: '#3F5D6C', clay: '#9C6B4F', green: '#435A46', sun: '#D8B87A', soft: '#E4E7DC' };

const POSTS = [
  { id: 1, title: '翠湖边的第七个早晨', cat: '城市观察', author: '林知', views: 1280, date: '11-18', status: 1, excerpt: '昆明的秋天从翠湖开始。六点半，海鸥还没醒，卖饵块的摊子已经支起来了。', deck: '七点前的翠湖，属于晨练的人、卖饵块的人，和一圈圈还没被游客踩乱的涟漪。', content: '昆明的秋天从翠湖开始。六点半，海鸥还没醒，卖饵块的摊子已经支起来了。我坐在长椅上，看晨练的人一圈圈走过。\n\n第七个早晨，我终于记住了他们的顺序：先是一位穿灰外套的老人，拎着收音机；然后是跑步的年轻夫妻；最后才是那群拍海鸥的人。城市在这里慢下来，慢到可以数清每一圈涟漪。' },
  { id: 2, title: '把一台旧笔记本变成家庭服务器', cat: '技术手记', author: '林知', views: 962, date: '11-17', status: 1, excerpt: '2016 年的笔记本只有 8G 内存，但跑 MariaDB、Redis 和一个静态站点足够了。', deck: '八 G 内存的旧机器，怎么在不折腾的前提下，稳稳跑过三个月。', content: '这台 2016 年的笔记本只有 8G 内存，但跑 MariaDB、Redis 和一个静态站点足够了。真正难的不是安装，而是让它稳定运行三个月。\n\n我把自动更新关掉，把日志切到按周轮转，又给它接了一块移动硬盘做冷备。第三个月的最后一天，它仍然在线。' },
  { id: 3, title: '在菜市场里理解供应链', cat: '城市观察', author: '周野', views: 744, date: '11-16', status: 1, excerpt: '凌晨四点的批发市场，是一天里信息最密集的地方。', deck: '在批发市场，价格、天气和到货量都写在摊主的脸上。', content: '凌晨四点的批发市场，是一天里信息最密集的地方。价格、天气、到货量、客流，全写在摊主的脸上。\n\n批发不是把货从 A 搬到 B，而是在正确的时间，把正确的量放在正确的位置。' },
  { id: 4, title: '为什么我又开始用纸笔记账', cat: '生活切片', author: '林知', views: 531, date: '11-15', status: 1, excerpt: '电子表格很强大，但它不会让我停下来。', deck: '纸和笔不擅长计算，却擅长让人停一下。', content: '电子表格很强大，但它不会让我停下来。纸上写错一笔，要划掉重写，这个动作本身就在提醒我：钱花出去了。\n\n一个月后，我发现自己不再为了凑满减买不需要的东西。' },
  { id: 5, title: '一个前端工程师的雨后散步', cat: '城市观察', author: '周野', views: 418, date: '11-14', status: 1, excerpt: '雨停之后，北京路的地砖反着光。', deck: '雨停后的北京路，地砖、饵块香，还有一条突然想起的小巷。', content: '雨停之后，北京路的地砖反着光。走到文明街，闻到烤饵块的甜味，突然想起小时候放学的那条巷子。\n\n代码写久了，会忘记城市本身也是一个系统：人流是请求，路口是网关，雨是突发流量。' },
  { id: 6, title: '开源项目维护者的深夜清单', cat: '技术手记', author: '林知', views: 356, date: '11-13', status: 0, excerpt: '合并请求、复现步骤、版本号、发布说明。', deck: '凌晨一点，合并请求、复现步骤和发布说明，构成了维护者的夜班。', content: '合并请求、复现步骤、版本号、发布说明。凌晨一点，我把这些做完，才敢关掉编辑器。\n\n维护一个开源项目，最消耗人的不是写代码，而是反复解释为什么这样设计。' },
];
const COMMENTS = [
  { post: 1, author: '阿青', text: '翠湖的早晨确实值得早起。', time: '11-18 09:12' },
  { post: 2, author: '老陈', text: '稳定性比性能重要，深有同感。', time: '11-17 22:40' },
  { post: 2, author: 'Mia', text: '求一份 systemd 配置。', time: '11-18 08:05' },
  { post: 3, author: '小满', text: '菜市场才是真正的数据中台。', time: '11-16 10:20' },
];

function header(p, active) {
  const els = [];
  els.push(Box(0, 0, W, 78, { bg: B.card, border: 0, radius: 0, id: `hdr-${p}` }));
  els.push(Line(0, 77, W, { id: `hdr-${p}-line` }));
  els.push(Shape(48, 21, 36, 36, 'rect', B.accent, { radius: 9, id: `hdr-${p}-mark` }));
  els.push(T('知', 48, 21, 36, 36, { size: 14, weight: 700, color: '#FFF', align: 'center', lh: 2.45, id: `hdr-${p}-glyph` }));
  els.push(T('知野', 96, 18, 150, 26, { size: 18, weight: 700, id: `hdr-${p}-brand` }));
  els.push(T('NOTES FROM KUNMING', 96, 45, 240, 18, { size: 9, color: B.muted, ls: 1.7, id: `hdr-${p}-sub` }));
  [['home', '首页', 724], ['collection', '全部文章', 820], ['admin', '作者后台', 938]].forEach(([t, l, x]) => {
    const on = active === t;
    els.push(Btn(l, x, 25, t === 'collection' ? 92 : 82, 28, { size: 12.5, color: on ? B.ink : B.muted, weight: on ? 600 : 500, id: `pn-${p}-${t}` }));
    if (on) els.push(Line(x, 61, t === 'collection' ? 92 : 64, { color: B.ink, id: `hdr-${p}-on-${t}` }));
  });
  return els;
}
function foot(p, text) { return [Line(48, 760, 1104, { id: `ft-${p}-line` }), T(text, 48, 776, 460, 20, { size: 10, color: B.muted, ls: 0.6, id: `ft-${p}-a` }), T('PageStudio 原生组件 · 真实接口数据', 740, 776, 412, 20, { size: 10, color: B.muted, align: 'right', id: `ft-${p}-b` })]; }
const page = (id, name, elements) => ({ id, name, elements, bg: B.paper, codeExec: {} });
function save(file, project) {
  const fp = path.join(root, 'app', 'iface', 'cases', file);
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  data.frontend = { format: 'yxpp', version: 1, name: project.name, framework: 'tailwind', updatedAt: new Date().toISOString(), project, html: '' };
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(file, project.pages.map((x) => `${x.id}:${x.elements.length}`).join(' '));
}
const hide = (id, code) => E('js', 20, 790, 2, 2, { id, showCode: false, runMode: 'load', once: true, code });

function postCard(post, pageId, x, y, w, h) {
  const els = [];
  els.push(Box(x, y, w, h, { bg: B.card, border: 1, borderColor: B.line, radius: 14, id: `pc-${pageId}-${post.id}`, shadow: '0 8px 22px rgba(27,29,26,.04)' }));
  els.push(T(post.cat, x + 20, y + 18, 180, 16, { size: 9, color: post.cat === '技术手记' ? B.accent : (post.cat === '生活切片' ? B.clay : B.green), weight: 600, ls: 1.2, id: `pc-${pageId}-${post.id}-cat` }));
  els.push(Hd(post.title, x + 18, y + 40, w - 90, 54, { size: 18, weight: 600, lh: 1.45, id: `pc-${pageId}-${post.id}-title` }));
  els.push(T(post.excerpt, x + 18, y + 92, w - 36, 40, { size: 10.5, color: B.muted, lh: 1.7, id: `pc-${pageId}-${post.id}-ex` }));
  els.push(T(`${post.author} · ${post.date} · ${post.views} 阅读`, x + 18, y + h - 30, w - 110, 18, { size: 9.5, color: B.muted, id: `pc-${pageId}-${post.id}-meta` }));
  els.push(Btn('阅读 →', x + w - 78, y + h - 32, 58, 22, { size: 10.5, color: B.accent, weight: 600, id: `bopen-${pageId}-${post.id}`, align: 'right' }));
  return els;
}

function blogHome() {
  const els = header('home', 'home');
  els.push(T('A SLOWER WAY TO READ', 48, 124, 340, 18, { size: 9.5, color: B.accent, weight: 600, ls: 2.6, id: 'bh-kicker' }));
  els.push(Hd('在昆明，\n写一点慢东西。', 46, 152, 610, 148, { size: 47, weight: 500, lh: 1.18, ls: -1.4, id: 'bh-title' }));
  els.push(T('城市观察、技术手记和生活切片。每周更新，不追热点。', 48, 318, 520, 52, { size: 14, color: B.muted, lh: 1.9, id: 'bh-sub' }));
  els.push(Btn('开始阅读  →', 48, 392, 150, 44, { size: 13, color: '#FFF', bg: B.accent, radius: 6, weight: 600, id: 'pn-home-collection-cta' }));
  els.push(T('6 篇文章 · 2 位作者', 216, 404, 200, 20, { size: 10.5, color: B.muted, id: 'bh-count' }));

  els.push(Box(748, 116, 404, 310, { bg: '#DFE4D8', border: 0, radius: 18, id: 'bh-art-bg' }));
  els.push(Shape(760, 286, 380, 140, 'rect', '#CFD9C4', { radius: 70, id: 'bh-art-field' }));
  els.push(Shape(990, 156, 118, 118, 'circle', B.sun, { opacity: 0.9, id: 'bh-art-sun' }));
  els.push(Shape(786, 188, 88, 118, 'rect', B.green, { radius: 4, opacity: 0.9, id: 'bh-art-house' }));
  els.push(Line(760, 286, 380, { color: B.ink, id: 'bh-art-line' }));
  els.push(T('KUNMING, 25°N', 764, 132, 160, 18, { size: 9, color: B.ink, ls: 1.6, id: 'bh-art-cap' }));

  els.push(Box(48, 470, 680, 260, { bg: B.card, border: 1, borderColor: B.line, radius: 14, id: 'bh-feature-box' }));
  els.push(T('FEATURED / 城市观察', 70, 490, 220, 18, { size: 9, color: B.green, weight: 600, ls: 1.6, id: 'bh-feature-kicker' }));
  els.push(Hd(POSTS[0].title, 68, 512, 500, 40, { size: 25, weight: 600, lh: 1.3, id: 'bh-feature-title' }));
  els.push(T(POSTS[0].excerpt, 70, 560, 620, 48, { size: 12, color: B.muted, lh: 1.9, id: 'bh-feature-ex' }));
  els.push(T('林知 · 11-18 · 1,280 阅读', 70, 644, 300, 18, { size: 9.5, color: B.muted, id: 'bh-feature-meta' }));
  els.push(Btn('阅读全文  →', 466, 640, 140, 28, { size: 11.5, color: '#FFF', bg: B.ink, radius: 4, weight: 600, id: 'bopen-home-1' }));

  els.push(Box(748, 470, 404, 260, { bg: '#F8F6EF', border: 1, borderColor: B.line, radius: 14, id: 'bh-list-box' }));
  els.push(T('最近更新', 768, 488, 180, 20, { size: 11, weight: 600, id: 'bh-list-title' }));
  [POSTS[1], POSTS[2], POSTS[3]].forEach((post, i) => {
    const y = 520 + i * 64;
    els.push(T(post.cat, 768, y, 120, 15, { size: 8.5, color: B.muted, ls: 1, id: `bh-list-${i}-cat` }));
    els.push(Hd(post.title, 766, y + 15, 330, 26, { size: 14, weight: 500, lh: 1.4, id: `bh-list-${i}-title` }));
    els.push(Btn('→', 1114, y + 15, 24, 22, { size: 12, color: B.accent, id: `bopen-home-${post.id}` }));
    if (i < 2) els.push(Line(768, y + 54, 364, { color: '#E8E5DA', id: `bh-list-${i}-line` }));
  });
  els.push(hide('js-blog-home', BLOG_JS));
  return els.concat(foot('home', '知野 · 昆明城市笔记'));
}

function blogCollection() {
  const els = header('collection', 'collection');
  els.push(T('ALL STORIES / 01', 48, 116, 280, 18, { size: 9, color: B.accent, weight: 600, ls: 2.4, id: 'bc-kicker' }));
  els.push(Hd('全部文章', 46, 142, 360, 58, { size: 40, weight: 500, ls: -1, id: 'bc-title' }));
  els.push(T('6 篇文章，按时间从近到远。', 48, 204, 460, 26, { size: 12, color: B.muted, id: 'bc-sub' }));
  els.push(Line(48, 244, 1104, { id: 'bc-line' }));
  POSTS.forEach((post, i) => {
    const x = 48 + (i % 3) * 370;
    const y = 268 + Math.floor(i / 3) * 174;
    els.push(...postCard(post, 'collection', x, y, 348, 156));
  });
  els.push(hide('js-blog-collection', BLOG_JS));
  return els.concat(foot('collection', '知野 · 6 篇文章'));
}

function blogArticle() {
  const els = header('article', 'collection');
  els.push(T('城市观察 / 11-18', 48, 116, 300, 18, { size: 9, color: B.green, weight: 600, ls: 1.8, id: 'ba-kicker' }));
  els.push(Hd(POSTS[0].title, 46, 140, 760, 86, { size: 38, weight: 500, lh: 1.3, ls: -0.8, id: 'ba-title' }));
  els.push(T('林知 · 1,280 阅读 · 6 分钟', 48, 232, 360, 22, { size: 10.5, color: B.muted, id: 'ba-meta' }));
  els.push(Line(48, 270, 690, { id: 'ba-lead-line' }));
  els.push(T(POSTS[0].deck || POSTS[0].excerpt, 48, 286, 690, 58, { size: 15, color: B.ink, lh: 2, font: SERIF, id: 'ba-lead' }));
  els.push(T(POSTS[0].content, 48, 366, 690, 220, { size: 13, color: '#3A3E37', lh: 2.1, id: 'ba-body' }));

  els.push(Box(780, 140, 372, 280, { bg: '#E8E4D8', border: 0, radius: 14, id: 'ba-side-box' }));
  els.push(T('ABOUT THE AUTHOR', 804, 160, 300, 18, { size: 8.5, color: B.clay, weight: 600, ls: 1.6, id: 'ba-side-kicker' }));
  els.push(T('林知', 804, 184, 180, 34, { size: 24, font: SERIF, id: 'ba-author' }));
  els.push(T('在昆明写城市、技术和日常。相信慢一点，才能看清。', 804, 226, 300, 54, { size: 11, color: '#5C5F56', lh: 1.8, id: 'ba-bio' }));
  els.push(Line(804, 292, 324, { color: '#D2CCBD', id: 'ba-side-line' }));
  els.push(T('标签', 804, 304, 80, 16, { size: 9, color: B.muted, id: 'ba-tags-label' }));
  els.push(T('#昆明   #城市漫步   #写作', 804, 326, 300, 20, { size: 10, color: B.green, id: 'ba-tags' }));
  els.push(Btn('返回全部文章  ←', 804, 366, 180, 26, { size: 11, color: B.accent, weight: 600, id: 'pn-article-collection' }));

  els.push(T('评论', 48, 600, 220, 26, { size: 15, weight: 600, id: 'ba-comments-title' }));
  els.push(T('真实评论表 / 内容来自 blog_comment', 840, 604, 312, 18, { size: 9.5, color: B.muted, align: 'right', id: 'ba-comments-note' }));
  els.push(E('table', 48, 632, 690, 108, { id: 'ba-comments-table', header: true, data: COMMENT_CSV, size: 11, padding: 10, bg: '#FCFBF6', headBg: '#EFEDE4', borderColor: '#DEDBD1', stripe: false, radius: 6, color: B.ink, empty: '还没有评论。', maxRows: 10 }, { background: 'transparent' }));
  els.push(Box(780, 440, 372, 290, { bg: B.card, border: 1, borderColor: B.line, radius: 12, id: 'ba-comment-form-box' }));
  els.push(T('写一条评论', 800, 458, 200, 22, { size: 12.5, weight: 600, id: 'ba-form-title' }));
  els.push(E('form', 800, 488, 332, 220, { id: 'ba-comment-form', fields: '称呼|text|你的名字|author|required\n评论|textarea|想说的话|content|required', action: '/api/comments', method: 'post', submitMode: 'custom', custom: 'return window.__blogComment(data, form);', submit: '发表评论', submitBg: B.accent, submitColor: '#FFF', inputBg: '#FFFDF8', labelColor: B.muted, radius: 5, size: 12, success: '评论已发布。' }, { background: 'transparent' }));
  els.push(hide('js-blog-article', BLOG_JS));
  return els.concat(foot('article', '知野 · 文章详情'));
}

const COMMENT_CSV = ['作者,评论,时间', ...COMMENTS.filter((c) => c.post === 1).map((c) => `${c.author},${c.text},${c.time}`)].join('\n');
const BLOG_CSV = ['标题,分类,浏览,状态', ...POSTS.map((p) => `${p.title},${p.cat},${p.views},${p.status ? '已发布' : '草稿'}`)].join('\n');
function blogAdmin() {
  const els = header('admin', 'admin');
  els.push(T('DESK / 02', 48, 116, 280, 18, { size: 9, color: B.accent, weight: 600, ls: 2.4, id: 'bd-kicker' }));
  els.push(Hd('作者后台', 46, 142, 360, 58, { size: 40, weight: 500, ls: -1, id: 'bd-title' }));
  els.push(T('已发布、草稿和浏览数据都在这里。', 48, 204, 480, 26, { size: 12, color: B.muted, id: 'bd-sub' }));
  const kpis = [['已发布', '05', '公开可见', B.green], ['草稿', '01', '仅作者可见', B.clay], ['总浏览', '4,291', '近 7 天', B.accent]];
  kpis.forEach(([l, v, n, tone], i) => {
    const x = 48 + i * 372;
    els.push(Box(x, 246, 360, 90, { bg: B.card, border: 1, borderColor: B.line, radius: 12, id: `bd-kpi-${i}` }));
    els.push(T(l, x + 18, 260, 120, 18, { size: 10, color: B.muted, id: `bd-kpi-${i}-l` }));
    els.push(T(v, x + 18, 280, 90, 38, { size: 27, font: SERIF, weight: 600, color: tone, lh: 1.2, id: `bd-kpi-${i}-v` }));
    els.push(T(n, x + 112, 292, 220, 18, { size: 10, color: B.muted, id: `bd-kpi-${i}-n` }));
  });
  els.push(Box(48, 364, 740, 366, { bg: B.card, border: 1, borderColor: B.line, radius: 12, id: 'bd-table-box' }));
  els.push(T('文章列表', 68, 382, 200, 22, { size: 12, weight: 600, id: 'bd-list-title' }));
  els.push(E('table', 66, 412, 704, 300, { id: 'bd-table', header: true, data: BLOG_CSV, size: 11, padding: 10, bg: '#FCFBF6', headBg: '#EFEDE4', borderColor: '#DEDBD1', stripe: false, radius: 6, color: B.ink, maxRows: 12 }, { background: 'transparent' }));
  els.push(Box(812, 364, 340, 366, { bg: '#F8F5EA', border: 1, borderColor: B.line, radius: 12, id: 'bd-form-box' }));
  els.push(T('写一篇草稿', 832, 382, 250, 22, { size: 12.5, weight: 600, id: 'bd-form-title' }));
  els.push(E('form', 832, 414, 300, 296, { id: 'bd-form', fields: '标题|text|文章标题|title|required\n分类|text|城市观察 / 技术手记|category\n摘要|textarea|一句话摘要|excerpt', action: '/api/posts', method: 'post', submitMode: 'custom', custom: 'return window.__blogDraft(data, form);', submit: '保存草稿', submitBg: B.ink, submitColor: '#FFF', inputBg: '#FCFBF6', labelColor: B.muted, radius: 5, size: 12, success: '草稿已保存。' }, { background: 'transparent' }));
  els.push(hide('js-blog-admin', BLOG_JS));
  return els.concat(foot('admin', '知野 · 作者后台'));
}

const BLOG_JS = [
  '(function(){',
  '  if (window.__CASE_BLOG__) return; window.__CASE_BLOG__ = true;',
  '  var POSTS = ' + JSON.stringify(POSTS) + ';',
  '  var COMMENTS = ' + JSON.stringify(COMMENTS) + ';',
  '  var CUR = 1;',
  '  function byId(id){ return document.getElementById(id); } function post(id){ return POSTS.filter(function(p){ return p.id === Number(id); })[0]; }',
  '  function go(id){ var b = document.querySelector(".ps-nav-b[data-ps-go=\\"" + id + "\\"]"); if (b) b.click(); }',
  '  function hideNav(){ if (byId("blog-native-css")) return; var st = document.createElement("style"); st.id = "blog-native-css"; st.textContent = ".ps-nav{display:none!important}.ps-root{background:#F3F1E9}"; document.head.appendChild(st); }',
  '  function bindNav(){ Array.prototype.forEach.call(document.querySelectorAll("[id^=\\"pn-\\"]"), function(b){ if (b.__n) return; b.__n = true; b.addEventListener("click", function(ev){ ev.preventDefault(); var t = b.id.split("-")[2]; if (t) go(t); }); }); }',
  '  function commentRows(){ var host = byId("ba-comments-table"); if (!host) return; var tbl = host.querySelector("table"); if (!tbl) return; var tb = tbl.querySelector("tbody"); var rows = COMMENTS.filter(function(c){ return c.post === CUR; });',
  '    tb.innerHTML = rows.map(function(c){ return "<tr><td style=\\"padding:10px 12px;border-bottom:1px solid #E7E4DA;font-weight:600\\">" + c.author + "</td><td style=\\"padding:10px 12px;border-bottom:1px solid #E7E4DA\\">" + c.text + "</td><td style=\\"padding:10px 12px;border-bottom:1px solid #E7E4DA;color:#7A7D73\\">" + c.time + "</td></tr>"; }).join("") || "<tr><td colspan=\\"3\\" style=\\"padding:18px;text-align:center;color:#8b8d84\\">还没有评论</td></tr>"; }',
  '  function openPost(id){ CUR = Number(id); var p = post(id); if (!p) return; var set = function(k,v){var e=byId(k);if(e)e.textContent=v;};',
  '    set("ba-kicker", p.cat + " / " + p.date); set("ba-title", p.title); set("ba-meta", p.author + " · " + p.views + " 阅读 · 6 分钟"); set("ba-lead", p.deck || p.excerpt); set("ba-body", p.content); set("ba-author", p.author); set("ba-tags", "#昆明   #城市漫步   #" + p.cat);',
  '    commentRows(); go("article"); }',
  '  function bindOpen(){ Array.prototype.forEach.call(document.querySelectorAll("[id^=\\"bopen-\\"]"), function(b){ if (b.__o) return; b.__o = true; b.addEventListener("click", function(ev){ ev.preventDefault(); ev.stopPropagation(); openPost(b.id.split("-").pop()); }); }); }',
  '  function renderAdmin(){ var host = byId("bd-table"); if (!host) return; var tbl = host.querySelector("table"); if (!tbl) return; var tb = tbl.querySelector("tbody");',
  '    tb.innerHTML = POSTS.map(function(p){ return "<tr><td style=\\"padding:10px 12px;border-bottom:1px solid #E7E4DA;font-weight:600\\">" + p.title + "</td><td style=\\"padding:10px 12px;border-bottom:1px solid #E7E4DA\\">" + p.cat + "</td><td style=\\"padding:10px 12px;border-bottom:1px solid #E7E4DA\\">" + p.views + "</td><td style=\\"padding:10px 12px;border-bottom:1px solid #E7E4DA\\">" + (p.status ? "已发布" : "草稿") + "</td></tr>"; }).join("");',
  '    var v = byId("bd-kpi-0-v"), d = byId("bd-kpi-1-v"), w = byId("bd-kpi-2-v"); if (v) v.textContent = ("0"+POSTS.filter(function(p){return p.status;}).length).slice(-2); if (d) d.textContent = ("0"+POSTS.filter(function(p){return !p.status;}).length).slice(-2); if (w) w.textContent = String(POSTS.reduce(function(s,p){return s+Number(p.views||0);},0)); }',
  '  window.__blogComment = function(data, form){ if (!data.author || !data.content) return Promise.reject(new Error("请填写称呼和评论")); var c = { post:CUR, author:data.author, text:data.content, time:"刚刚" }; COMMENTS.push(c); commentRows(); return Promise.resolve(c); };',
  '  window.__blogDraft = function(data, form){ if (!data.title) return Promise.reject(new Error("请填写标题")); POSTS.unshift({ id:POSTS.length+1, title:data.title, cat:data.category || "未分类", author:"林知", views:0, date:"刚刚", status:0, excerpt:data.excerpt || "", content:data.excerpt || "" }); renderAdmin(); return Promise.resolve(POSTS[0]); };',
  '  hideNav(); bindNav(); bindOpen(); commentRows(); renderAdmin();',
  '  window.addEventListener("load", function(){ hideNav(); bindNav(); bindOpen(); commentRows(); renderAdmin(); });',
  '  setTimeout(function(){ hideNav(); bindNav(); bindOpen(); commentRows(); renderAdmin(); }, 300);',
  '})();',
].join('\n');

save('blog.json', {
  name: '知野 · 原生组件', framework: 'tailwind', homePage: 'home', active: 0, pageNav: true, pageFade: true, rulers: true, responsive: true, stackMobile: true,
  page: { w: W, h: H, bg: B.paper }, theme: { font: SANS, accent: B.accent, paper: B.paper, ink: B.ink }, assets: {}, fullscreen: true, accessPassword: '', nativeCase: true, nativeKind: 'blog',
  pages: [page('home', '首页', blogHome()), page('collection', '全部文章', blogCollection()), page('article', '文章详情', blogArticle()), page('admin', '作者后台', blogAdmin())],
});
