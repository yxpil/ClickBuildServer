'use strict';

// 为全部内置案例补齐 .yxpp 前端：PageStudio 工程 + 可直接运行的案例控制台 HTML。
// 用法：node tools/make-case-frontends.js [--check]
// 生成后写入 app/iface/cases/*.json 的 frontend 字段；--check 只校验，不改文件。

const fs = require('fs');
const path = require('path');

const CASES = path.join(__dirname, '..', 'app', 'iface', 'cases');
const checkOnly = process.argv.includes('--check');
const UPDATED = '2026-11-20T00:00:00.000Z';

const META = {
  blog: { code: 'BLOG', accent: '#7A3E2E', kicker: '内容 / CMS', line: '文章、分类、标签与评论，一条完整的发布流。' },
  booking: { code: 'BOOK', accent: '#2F5D50', kicker: '本地生活 / 预约', line: '项目、时段、容量校验与取消释放。' },
  chat: { code: 'CHAT', accent: '#2C4A63', kicker: 'IM / 消息', line: '会话、收发、已读回执与未读数。' },
  crm: { code: 'CRM', accent: '#8A5A2B', kicker: '客户 / 商机', line: '客户、联系人、阶段推进与金额统计。' },
  crossdb: { code: 'XDB', accent: '#4B3F72', kicker: '跨库 / 事务', line: '主库订单与辅库明细，同事务提交或一起回滚。' },
  decoration: { code: 'DECO', accent: '#8A4B32', kicker: '报价 / 审批', line: '面积基价、项目明细、折扣提交与审批。' },
  edu: { code: 'EDU', accent: '#3D5A40', kicker: '课程 / 学习', line: '课程、课时、报名与学习进度。' },
  event: { code: 'EVENT', accent: '#A24D2A', kicker: '活动 / 票务', line: '活动发布、余票、购票与电子票核销。' },
  finance: { code: 'FIN', accent: '#2F5D50', kicker: '报销 / 审批', line: '提交、审批留痕与按分类汇总。' },
  freight: { code: 'FRT', accent: '#4A5568', kicker: '货运 / 报价', line: '线路基价与公斤价，实重和体积重取大计费。' },
  hospital: { code: 'MED', accent: '#2F5A67', kicker: '医疗 / 挂号', line: '科室、医生、号源与挂号取消。' },
  iot: { code: 'IOT', accent: '#3D5A40', kicker: '设备 / 遥测', line: '注册、密钥校验、遥测上报与温度告警。' },
  logistics: { code: 'LOG', accent: '#6B4E2E', kicker: '运单 / 轨迹', line: '运单、节点、状态推进与全程联查。' },
  mall: { code: 'MALL', accent: '#B24A2F', kicker: '电商 / 交易', line: '商品、购物车、库存防超卖与下单事务。' },
  meeting: { code: 'MEET', accent: '#2C4A63', kicker: '会议 / 协作', line: '会议室、加入离开、结束会议与纪要。' },
  netcourse: { code: 'NET', accent: '#3D5A40', kicker: '网课 / 考试', line: '课程、课时、学习进度、考试判分与成绩单。' },
  printing: { code: 'PRINT', accent: '#6B4E2E', kicker: '印刷 / 算价', line: '尺寸、数量、纸价、制版费与后道工艺逐项累加。' },
  restaurant: { code: 'DINE', accent: '#A24D2A', kicker: '餐饮 / 点餐', line: '菜单、桌台、开台、加菜与结账。' },
  social: { code: 'SOCIAL', accent: '#2C4A63', kicker: '社交 / 接口库', line: '账户、好友、私聊、群聊、动态与通知，一套完整社交底座。' },
  softquote: { code: 'QUOTE', accent: '#4B3F72', kicker: '软件 / 报价', line: '客户、人天单价、模块工作量与版本报价。' },
  ticket: { code: 'TICKET', accent: '#2F5D50', kicker: '工单 / 客服', line: '客户、工单、回复、指派与状态统计。' },
  video: { code: 'VIDEO', accent: '#2C4A63', kicker: '视频 / 内容', line: '分区、视频、评论、收藏、上传与播放计数。' },
};

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

function makeCaseData(file, project) {
  const meta = META[file] || { code: file.toUpperCase(), accent: '#0B0B0B', kicker: '案例 / API', line: project.description || '' };
  const cats = (project.categories || []).map((c) => ({ id: c.id, name: c.name }));
  const interfaces = (project.interfaces || []).map((i) => {
    const tableFields = ((i.tables || [])[0] && (i.tables || [])[0].fields || [])
      .map((f) => f.name)
      .filter((f) => !/^(id|created_at|updated_at|only_id|user_only_id|owner_only_id|password_hash)$/.test(f));
    return {
      id: i.id,
      name: i.name,
      categoryId: i.categoryId,
      basePath: i.basePath || '',
      routes: (i.routes || []).map((r) => {
        const explicit = bodyFieldNames(r);
        const fallback = ['create', 'update'].includes(r.key) || /^(新建|更新|保存)$/.test(r.name || '');
        return {
          id: r.id,
          method: r.method,
          path: r.path,
          name: r.name,
          summary: r.summary || (r.docs && r.docs.summary) || '',
          auth: !!r.auth,
          body: explicit.length ? explicit : (fallback ? tableFields : []),
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
    code: meta.code,
    accent: meta.accent,
    kicker: meta.kicker,
    line: meta.line,
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

function studioProject(data) {
  const [titleA, titleB] = String(data.name).split(/\s+/).length > 1
    ? [String(data.name).split(/\s+/)[0], String(data.name).split(/\s+/).slice(1).join(' ')]
    : [data.name, ''];
  const elements = [];
  elements.push(
    N('box', 'case-side', 0, 0, 240, 1080, { clip: true }, { background: '#0B0B0B', radius: 0 }),
    N('box', 'case-accent', 240, 0, 8, 1080, {}, { background: data.accent, radius: 0 }),
    N('text', 'case-code', 26, 34, 188, 18, { text: `CASE / ${data.code}`, size: 10, weight: 600, ls: 2.2, color: '#B9B5AA' }),
    N('heading', 'case-title', 26, 68, 188, 78, { text: data.name, size: 24, weight: 600, lh: 1.25, ls: -0.4, color: '#FFFFFF', tag: 'h2' }),
    N('text', 'case-kicker', 26, 158, 188, 18, { text: data.kicker, size: 10.5, weight: 400, ls: 1.2, color: '#8E8B82' }),
    N('divider', 'case-side-line', 26, 196, 188, 1, {}, { background: '#3A3A36' }),
    N('text', 'case-side-nav-label', 26, 218, 188, 18, { text: '案例目录', size: 10, weight: 600, ls: 1.8, color: '#8E8B82' }),
  );
  data.categories.slice(0, 9).forEach((c, i) => {
    elements.push(N('text', `case-cat-${i}`, 26, 252 + i * 30, 188, 18, {
      text: `${String(i + 1).padStart(2, '0')}  ${c.name}`, size: 11.5, weight: 400, color: '#D8D4C8',
    }));
  });
  elements.push(
    N('divider', 'case-side-foot-line', 26, 992, 188, 1, {}, { background: '#3A3A36' }),
    N('text', 'case-side-foot', 26, 1008, 188, 18, { text: 'CLICKBUILD / CASE', size: 9.5, ls: 1.4, color: '#8E8B82' }),

    N('badge', 'case-badge', 280, 38, 136, 26, { text: data.kicker, size: 10, weight: 500, align: 'center', color: '#FFFFFF' }, { background: data.accent, radius: 999, border: 0 }),
    N('heading', 'case-title-main', 280, 76, 780, 100, { text: data.name, size: 42, weight: 600, lh: 1.14, ls: -1, color: '#0B0B0B', tag: 'h1' }),
    N('text', 'case-desc', 280, 190, 740, 60, { text: data.line, size: 14, weight: 400, lh: 1.8, color: '#5F5B52' })
  );

  const metrics = [
    [String(data.counts.interfaces), '业务接口'],
    [String(data.counts.routes), '可调用路由'],
    [String(data.counts.tables), '数据表'],
  ];
  metrics.forEach((m, i) => {
    const x = 280 + i * 220;
    elements.push(N('box', `case-metric-${i}`, x, 272, 200, 96, {}, { background: '#FFFFFF', border: 1, borderColor: '#D8D4C8', radius: 2 }, [
      N('heading', `case-metric-v-${i}`, 18, 14, 164, 44, { text: m[0], size: 30, weight: 700, lh: 1.1, ls: -0.8, color: '#0B0B0B', tag: 'h3' }),
      N('text', `case-metric-l-${i}`, 18, 64, 164, 16, { text: m[1], size: 10.5, weight: 400, ls: 1.1, color: '#8E8B82' }),
    ]));
  });

  elements.push(N('text', 'case-cats-label', 280, 398, 780, 18, { text: '案例分类', size: 10, weight: 600, ls: 1.8, color: '#8E8B82' }));
  data.categories.slice(0, 9).forEach((c, i) => {
    const x = 280 + (i % 3) * 220;
    const y = 426 + Math.floor(i / 3) * 92;
    const n = data.interfaces.filter((it) => it.categoryId === c.id).length;
    elements.push(N('box', `case-cat-box-${i}`, x, y, 200, 76, {}, { background: '#FFFFFF', border: 1, borderColor: '#D8D4C8', radius: 2 }, [
      N('text', `case-cat-name-${i}`, 14, 14, 172, 20, { text: c.name, size: 13, weight: 600, color: '#0B0B0B' }),
      N('text', `case-cat-count-${i}`, 14, 42, 172, 16, { text: `${n} 个接口`, size: 10.5, color: '#8E8B82' }),
    ]));
  });

  elements.push(N('text', 'case-ifaces-label', 280, 748, 780, 18, { text: '接口清单', size: 10, weight: 600, ls: 1.8, color: '#8E8B82' }));
  const half = Math.ceil(data.interfaces.length / 2);
  [data.interfaces.slice(0, half), data.interfaces.slice(half)].forEach((list, i) => {
    elements.push(N('list', `case-ifaces-${i}`, 280 + i * 400, 778, 380, 140, {
      text: list.map((it) => `${it.name}  /  ${it.routes.length} 路由`).join('\n'),
      size: 11.5, lh: 1.85, color: '#3A3A36', bullet: false, weight: 400,
    }));
  });

  elements.push(
    N('box', 'case-cta', 280, 944, 860, 62, {}, { background: '#0B0B0B', radius: 2 }, [
      N('text', 'case-cta-label', 22, 20, 320, 20, { text: '打开案例控制台', size: 14, weight: 600, color: '#FFFFFF' }),
      N('text', 'case-cta-path', 700, 21, 136, 18, { text: '/  ·  /docs  ·  /help', size: 10, align: 'right', color: '#B9B5AA' }),
    ]),
    N('divider', 'case-footer-line', 280, 1036, 860, 1, {}, { background: '#D8D4C8' }),
    N('text', 'case-footer-l', 280, 1050, 500, 16, { text: 'CLICKBUILD · CASE FRONTEND · 2026', size: 9.5, ls: 1.2, color: '#8E8B82' }),
    N('text', 'case-footer-r', 820, 1050, 320, 16, { text: `${data.code} / API READY`, size: 9.5, align: 'right', ls: 1.2, color: '#8E8B82' })
  );

  return {
    name: `${data.name} · 案例前端`,
    framework: 'tailwind',
    page: { w: 1200, h: 1080, bg: '#F4F2EB' },
    theme: { font: '"Space Grotesk","Noto Sans SC",sans-serif', accent: data.accent, radius: 2, grid: 8, showGrid: true },
    assets: [],
    elements,
  };
}

function caseHtml(data) {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  const title = esc(`${data.name} · 案例前端`);
  const accent = esc(data.accent);
  const desc = esc(data.line);
  const name = esc(data.name);
  const kicker = esc(data.kicker);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{--ink:#0B0B0B;--paper:#F4F2EB;--card:#FFFFFF;--line:#D8D4C8;--soft:#8E8B82;--accent:${accent}}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);font-family:"Space Grotesk","Noto Sans SC","Microsoft YaHei",sans-serif}
a{color:inherit}
button{font:inherit;cursor:pointer}
.top{position:sticky;top:0;z-index:30;height:64px;background:var(--ink);color:#fff;display:flex;align-items:center;gap:22px;padding:0 22px;border-bottom:1px solid #000}
.brand{display:flex;align-items:center;gap:12px;min-width:250px}
.mark{display:inline-flex;align-items:center;justify-content:center;min-width:54px;height:24px;padding:0 8px;background:var(--accent);color:#fff;font-size:10px;letter-spacing:2px}
.brand b{font-size:14px;font-weight:600;letter-spacing:.02em}
.topnav{display:flex;align-items:center;gap:18px;font-size:11px;color:#C9C5BA;margin-left:auto}
.topnav a{text-decoration:none}
.topnav a:hover{color:#fff}
.authbox{display:flex;align-items:center;gap:8px;margin-left:14px}
.authbox input{width:176px;height:30px;border:1px solid #3A3A36;background:#171715;color:#fff;padding:0 9px;font-size:11px;outline:0}
.authbox input::placeholder{color:#8E8B82}
.ghost{height:30px;padding:0 11px;border:1px solid #5C5A54;background:transparent;color:#fff;font-size:11px}
.ghost:hover{border-color:#fff}
.shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:calc(100vh - 64px)}
.side{border-right:1px solid var(--line);background:#EEECE4;padding:20px 0 30px;position:sticky;top:64px;height:calc(100vh - 64px);overflow:auto}
.side-head{padding:0 20px 14px;border-bottom:1px solid var(--line);font-size:10px;letter-spacing:1.8px;color:var(--soft);display:flex;justify-content:space-between}
.side-head span{color:var(--ink)}
.cat{padding:16px 20px 4px;font-size:10px;letter-spacing:1.2px;color:var(--soft)}
.nav-item{display:block;width:100%;border:0;background:transparent;text-align:left;padding:8px 20px;color:#3A3A36;font-size:12px}
.nav-item:hover{background:#fff}
.nav-item.on{background:#fff;box-shadow:inset 3px 0 0 var(--accent);color:var(--ink);font-weight:600}
.side-foot{padding:22px 20px;font-size:9.5px;line-height:1.8;letter-spacing:.08em;color:var(--soft);border-top:1px solid var(--line);margin-top:24px}
main{padding:32px 36px 56px;min-width:0}
.home{max-width:1040px}
.kicker{font-size:10px;letter-spacing:2px;color:var(--soft);text-transform:uppercase}
h1{font-family:Georgia,"Songti SC","Noto Serif SC",serif;font-size:44px;line-height:1.14;letter-spacing:-.04em;margin:14px 0 12px;max-width:820px}
.lead{font-size:14px;line-height:1.85;color:#5F5B52;max-width:720px;margin:0 0 24px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}
.chip{border:1px solid var(--line);background:#fff;padding:5px 9px;font-size:10px;letter-spacing:.05em}
.chip.hot{border-color:var(--accent);color:var(--accent)}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0 30px}
.metric{border:1px solid var(--line);background:#fff;padding:16px 16px 13px;position:relative}
.metric:after{content:"";position:absolute;left:0;top:0;width:4px;height:100%;background:var(--accent)}
.metric b{display:block;font-size:29px;line-height:1;letter-spacing:-.04em}
.metric span{display:block;margin-top:10px;font-size:10px;letter-spacing:1.1px;color:var(--soft)}
.section-title{display:flex;align-items:center;gap:12px;margin:30px 0 12px}
.section-title h2{font-size:11px;letter-spacing:1.7px;font-weight:600;margin:0;text-transform:uppercase}
.section-title:after{content:"";height:1px;background:var(--line);flex:1}
.cat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.cat-card{border:1px solid var(--line);background:#fff;padding:14px 15px}
.cat-card b{display:block;font-size:13px;margin-bottom:6px}
.cat-card span{font-size:10px;color:var(--soft)}
.iface-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.iface-card{border:1px solid var(--line);background:#fff;padding:16px;text-align:left;display:flex;flex-direction:column;gap:8px;min-height:120px}
.iface-card:hover{border-color:var(--ink);transform:translateY(-1px)}
.iface-card .row{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.iface-card b{font-size:15px}
.iface-card .path{font-family:Consolas,monospace;font-size:10px;color:var(--soft)}
.iface-card .meta{font-size:10.5px;color:var(--soft);line-height:1.65}
.breadcrumb{display:flex;align-items:center;gap:10px;margin-bottom:26px}
.back{border:1px solid var(--line);background:#fff;padding:7px 11px;font-size:11px}
.back:hover{border-color:var(--ink)}
.detail-kicker{font-size:10px;letter-spacing:1.8px;color:var(--soft)}
.detail-head{display:flex;align-items:flex-start;gap:22px;margin:10px 0 16px}
.detail-head h1{font-size:36px;margin:0}
.pill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border:1px solid var(--line);font-size:10px;color:var(--soft)}
.schema{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 22px}
.field{border:1px solid var(--line);background:#fff;padding:4px 8px;font-size:10px;font-family:Consolas,monospace}
.field i{font-style:normal;color:var(--soft);margin-left:5px}
.routes{border:1px solid var(--line);background:#fff}
.route{display:grid;grid-template-columns:64px minmax(0,1fr) 88px;gap:14px;align-items:center;padding:12px 14px;border-bottom:1px solid #E8E5DC}
.route:last-child{border-bottom:0}
.method{display:inline-flex;align-items:center;justify-content:center;height:22px;border:1px solid var(--line);font-family:Consolas,monospace;font-size:10px;letter-spacing:.06em}
.method.GET{background:#EEF3ED;border-color:#9BAE99;color:#2F5D50}
.method.POST{background:var(--ink);border-color:var(--ink);color:#fff}
.method.PUT{background:#F4EFE5;border-color:#BDAE90;color:#715E3D}
.method.DELETE{background:#F6EAE7;border-color:#C99C91;color:#8A3F32}
.route .rname{font-size:12.5px;font-weight:600;margin-bottom:4px}
.route .rpath{font-family:Consolas,monospace;font-size:10px;color:var(--soft)}
.route .rsum{font-size:10.5px;line-height:1.55;color:#6B675E;margin-top:3px}
.run{border:1px solid var(--ink);background:#fff;height:30px;font-size:10.5px}
.run:hover{background:var(--ink);color:#fff}
.split{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);gap:18px;margin-top:26px;align-items:start}
.panel{border:1px solid var(--line);background:var(--card);padding:16px}
.panel h3{font-size:10px;letter-spacing:1.4px;margin:0 0 12px;color:var(--soft);font-weight:600}
.empty{border:1px dashed var(--line);padding:22px;text-align:center;color:var(--soft);font-size:11.5px;line-height:1.7}
.resp-status{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-family:Consolas,monospace;font-size:11px}
.badge-ok{color:#2F5D50}.badge-bad{color:#8A3F32}
pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace;font-size:11px;line-height:1.7;background:#FAF9F4;border:1px solid #E8E5DC;padding:12px;max-height:360px;overflow:auto}
.tablewrap{overflow:auto;border:1px solid #E8E5DC}
table{border-collapse:collapse;width:100%;font-size:11px}
th,td{border-bottom:1px solid #E8E5DC;padding:7px 8px;text-align:left;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
th{background:#F7F5EE;color:#6B675E;font-weight:600}
label{display:block;font-size:10px;letter-spacing:.06em;color:var(--soft);margin:12px 0 6px}
input[type=text],textarea{width:100%;border:1px solid var(--line);background:#fff;color:var(--ink);font-family:Consolas,monospace;font-size:11px;padding:9px;outline:0}
textarea{min-height:74px;resize:vertical}
.btn{height:36px;border:1px solid var(--ink);background:var(--ink);color:#fff;padding:0 14px;font-size:11px;letter-spacing:.06em;margin-top:12px;width:100%}
.btn:hover{background:var(--accent);border-color:var(--accent)}
.btn.secondary{background:#fff;color:var(--ink);border-color:var(--line);margin-top:8px}
.btn.secondary:hover{border-color:var(--ink);background:#fff;color:var(--ink)}
.overlay{position:fixed;inset:0;z-index:50;background:rgba(11,11,11,.55);display:none;align-items:center;justify-content:center;padding:20px}
.overlay.on{display:flex}
.modal{width:min(440px,100%);background:var(--paper);border:1px solid var(--ink);box-shadow:8px 8px 0 rgba(0,0,0,.22);padding:22px}
.modal h2{font-family:Georgia,"Songti SC",serif;font-size:24px;margin:0 0 6px;letter-spacing:-.02em}
.modal p{font-size:11.5px;color:var(--soft);line-height:1.7;margin:0 0 10px}
.modal .close{float:right;border:0;background:transparent;font-size:18px;line-height:1}
.msg{font-size:11px;line-height:1.6;margin-top:10px;color:var(--soft)}
.msg.bad{color:#8A3F32}
.foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;font-size:9.5px;letter-spacing:.08em;color:var(--soft)}
@media(max-width:900px){.shell{grid-template-columns:1fr}.side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}.side nav{display:grid;grid-template-columns:repeat(2,1fr)}main{padding:24px 18px}.iface-grid,.cat-grid,.metrics,.split{grid-template-columns:1fr}.topnav{display:none}.authbox input{width:130px}h1{font-size:34px}}
</style>
</head>
<body>
<header class="top">
  <div class="brand"><span class="mark">${data.code}</span><b>${name}</b></div>
  <nav class="topnav"><a href="/docs">接口文档</a><a href="/_docs">OpenAPI</a><a href="/console">控制台</a><a href="/help">帮助</a></nav>
  <div class="authbox"><input id="token" placeholder="Bearer token（可选）"><button class="ghost" id="loginOpen">登录</button></div>
</header>
<div class="shell">
  <aside class="side">
    <div class="side-head"><span>案例目录</span><span>${data.counts.interfaces}</span></div>
    <nav id="nav"></nav>
    <div class="side-foot">${kicker}<br>${data.counts.routes} 路由 · ${data.counts.tables} 表<br>API PREFIX ${data.api}</div>
  </aside>
  <main>
    <section class="home" id="home">
      <div class="kicker">${data.code} / CASE FRONTEND</div>
      <h1>${name}</h1>
      <p class="lead">${desc}</p>
      <div class="chips" id="catChips"></div>
      <div class="metrics">
        <div class="metric"><b>${data.counts.interfaces}</b><span>业务接口</span></div>
        <div class="metric"><b>${data.counts.routes}</b><span>可调用路由</span></div>
        <div class="metric"><b>${data.counts.tables}</b><span>数据表</span></div>
      </div>
      <div class="section-title"><h2>案例分类</h2></div>
      <div class="cat-grid" id="catGrid"></div>
      <div class="section-title"><h2>接口能力</h2></div>
      <div class="iface-grid" id="ifaceGrid"></div>
      <div class="foot"><span>CLICKBUILD · ${data.code} · 2026</span><span>API ${data.api}</span></div>
    </section>
    <section id="detail" hidden>
      <div class="breadcrumb"><button class="back" id="back">← 返回案例概览</button><span class="kicker">接口详情</span></div>
      <div class="detail-kicker" id="ifaceCat"></div>
      <div class="detail-head"><h1 id="ifaceName"></h1><span class="pill" id="ifaceCount"></span></div>
      <div class="schema" id="schema"></div>
      <div class="section-title"><h2>路由与请求</h2></div>
      <div class="routes" id="routes"></div>
      <div class="split">
        <div class="panel"><h3>数据预览</h3><div id="table"><div class="empty">选择左侧路由并点击「运行」，这里会显示返回数据。</div></div><pre id="output" hidden></pre></div>
        <div class="panel"><h3>请求演练</h3><label>请求路径</label><input type="text" id="reqPath"><label id="queryLabel" hidden>Query JSON</label><textarea id="reqQuery" hidden></textarea><label id="bodyLabel">Body JSON</label><textarea id="reqBody"></textarea><button class="btn" id="send">发送请求</button><button class="btn secondary" id="clear">清空结果</button><div class="msg" id="reqMsg"></div></div>
      </div>
    </section>
  </main>
</div>
<div class="overlay" id="loginModal">
  <div class="modal">
    <button class="close" id="loginClose">×</button>
    <h2>登录案例</h2>
    <p>使用案例自带的登录接口获取 token。首次使用可以先注册一个演示账号。</p>
    <label>用户名</label><input type="text" id="loginUser" value="demo">
    <label>密码</label><input type="text" id="loginPass" value="123456">
    <div id="extraFields"></div>
    <button class="btn" id="doLogin">登录</button>
    <button class="btn secondary" id="doRegister">注册并登录</button>
    <div class="msg" id="loginMsg"></div>
  </div>
</div>
<script>
const CASE = ${payload};
const $ = (id) => document.getElementById(id);
const state = { iface: null, route: null, token: localStorage.getItem('cbs_case_token_' + CASE.code) || '' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ifaceById = (id) => CASE.interfaces.find((x) => x.id === id);
const routeById = (id) => state.iface && state.iface.routes.find((x) => x.id === id);
const catName = (id) => (CASE.categories.find((c) => c.id === id) || {}).name || '未分类';
const fullPath = (iface, route) => CASE.api + (iface.basePath || '') + route.path;
const firstList = (iface) => iface.routes.find((r) => r.method === 'GET' && !r.path.includes(':')) || iface.routes.find((r) => r.method === 'GET') || iface.routes[0];
const loginRoute = CASE.interfaces.flatMap((i) => i.routes.map((r) => ({ iface: i, route: r }))).find((x) => !x.route.auth && (x.route.name === '登录' || x.route.path === '/login' || x.route.path.endsWith('/login')));
const registerRoute = CASE.interfaces.flatMap((i) => i.routes.map((r) => ({ iface: i, route: r }))).find((x) => !x.route.auth && (x.route.name.includes('注册') || x.route.path.endsWith('/register')));

function sampleValue(field, unique) {
  const f = String(field || '').toLowerCase();
  if (f.includes('password')) return '123456';
  if (f.includes('username')) return unique ? 'demo' + String(Date.now()).slice(-6) : 'demo';
  if (f.includes('phone') || f.includes('mobile')) return '138' + String(Date.now()).slice(-8);
  if (f.includes('email') || f.includes('mail')) return 'demo' + String(Date.now()).slice(-6) + '@example.com';
  if (f === 'display_name' || f.includes('nickname') || f === 'name' || f.includes('receiver')) return '演示用户';
  if (f.includes('title') || f.includes('subject')) return '示例' + (f.includes('title') ? '标题' : '主题');
  if (f.includes('price') || f.includes('amount') || f.includes('fee') || f.includes('salary')) return 99;
  if (f.includes('qty') || f.includes('count') || f.includes('stock') || f.includes('seat')) return 1;
  if (f === 'status' || f.includes('state') || f.includes('enabled')) return 1;
  if (f.includes('address')) return '昆明市示例路 1 号';
  if (f.includes('category') || f.includes('type') || f.includes('kind')) return '默认分类';
  if (f.includes('content') || f.includes('description') || f.includes('remark') || f.includes('reason')) return '这是一条演示数据';
  if (f.includes('date') || f.includes('time') || f.includes('start') || f.includes('end')) return '2026-11-20 10:00:00';
  return '示例';
}
function defaultBody(route, unique) {
  const out = {};
  const fields = route.body && route.body.length ? route.body : (route.method === 'POST' ? ['name'] : []);
  fields.forEach((f) => { out[f] = sampleValue(f, unique); });
  return out;
}
function defaultQuery(route) {
  const out = {};
  (route.query || []).forEach((f) => {
    if (f === 'page') out[f] = 1;
    else if (f === 'pageSize' || f === 'limit') out[f] = 20;
    else if (f === 'keyword') out[f] = '';
    else out[f] = '';
  });
  return out;
}

function renderNav() {
  const groups = CASE.categories.map((c) => {
    const items = CASE.interfaces.filter((i) => i.categoryId === c.id);
    return '<div class="cat">' + esc(c.name) + '</div>' + items.map((i) => '<button class="nav-item" data-iface="' + esc(i.id) + '">' + esc(i.name) + '<span style="float:right;color:#A6A197">' + i.routes.length + '</span></button>').join('');
  }).join('');
  $('nav').innerHTML = groups;
  $('nav').querySelectorAll('[data-iface]').forEach((b) => { b.onclick = () => openIface(b.dataset.iface); });
}
function renderHome() {
  $('catChips').innerHTML = CASE.categories.map((c) => '<span class="chip">' + esc(c.name) + '</span>').join('');
  $('catGrid').innerHTML = CASE.categories.map((c) => {
    const n = CASE.interfaces.filter((i) => i.categoryId === c.id).length;
    return '<div class="cat-card"><b>' + esc(c.name) + '</b><span>' + n + ' 个接口</span></div>';
  }).join('');
  $('ifaceGrid').innerHTML = CASE.interfaces.map((i) => {
    const tables = i.tables.length;
    return '<button class="iface-card" data-open="' + esc(i.id) + '"><span class="row"><b>' + esc(i.name) + '</b><span class="path">' + esc(CASE.api + (i.basePath || '')) + '</span></span><span class="meta">' + i.routes.length + ' 条路由 · ' + tables + ' 张表<br>' + esc(i.routes.slice(0, 3).map((r) => r.method + ' ' + r.path).join(' / ')) + '</span></button>';
  }).join('');
  $('ifaceGrid').querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openIface(b.dataset.open); });
}

function openIface(id) {
  state.iface = ifaceById(id);
  state.route = null;
  $('home').hidden = true;
  $('detail').hidden = false;
  $('ifaceCat').textContent = catName(state.iface.categoryId) + ' / ' + String(CASE.interfaces.indexOf(state.iface) + 1).padStart(2, '0');
  $('ifaceName').textContent = state.iface.name;
  $('ifaceCount').textContent = state.iface.routes.length + ' 路由 / ' + state.iface.tables.length + ' 表';
  const fields = [];
  (state.iface.tables || []).forEach((t) => (t.fields || []).forEach((f) => { if (!fields.some((x) => x.name === f.name)) fields.push(f); }));
  $('schema').innerHTML = fields.map((f) => '<span class="field">' + esc(f.name) + '<i>' + esc(f.type || '') + '</i></span>').join('') || '<span class="field">暂无字段</span>';
  $('routes').innerHTML = state.iface.routes.map((r) => '<div class="route"><span class="method ' + r.method + '">' + r.method + '</span><div><div class="rname">' + esc(r.name) + (r.auth ? ' · <span style="font-weight:400;color:#8A3F32">鉴权</span>' : '') + '</div><div class="rpath">' + esc(fullPath(state.iface, r)) + '</div>' + (r.summary ? '<div class="rsum">' + esc(r.summary) + '</div>' : '') + '</div><button class="run" data-run="' + esc(r.id) + '">运行 →</button></div>').join('');
  $('routes').querySelectorAll('[data-run]').forEach((b) => { b.onclick = () => selectRoute(b.dataset.run); });
  const r = firstList(state.iface);
  if (r) {
    selectRoute(r.id);
    if (r.method === 'GET' && !r.auth) setTimeout(send, 50);
  }
}
function selectRoute(id) {
  state.route = routeById(id);
  if (!state.route) return;
  const route = state.route;
  $('reqPath').value = fullPath(state.iface, route).replace(/:([A-Za-z0-9_]+)/g, '1');
  const q = defaultQuery(route);
  const qKeys = Object.keys(q);
  $('queryLabel').hidden = !qKeys.length;
  $('reqQuery').hidden = !qKeys.length;
  $('reqQuery').value = qKeys.length ? JSON.stringify(q, null, 2) : '';
  const showBody = !['GET', 'HEAD', 'DELETE'].includes(route.method) || (route.body || []).length;
  $('bodyLabel').hidden = !showBody;
  $('reqBody').hidden = !showBody;
  $('reqBody').value = showBody ? JSON.stringify(defaultBody(route), null, 2) : '';
  $('reqMsg').textContent = route.auth ? '该路由需要登录 token 或 cookie。' : '可直接发送。';
  $('reqMsg').className = 'msg';
}
function unwrap(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if ('data' in obj && (obj.ok === true || obj.ok === false)) return obj.data;
  return obj;
}
function rowsOf(data) {
  if (Array.isArray(data)) return { rows: data };
  if (!data || typeof data !== 'object') return null;
  for (const k of ['rows', 'list', 'items', 'records', 'data']) if (Array.isArray(data[k])) return { rows: data[k], key: k };
  return null;
}
function renderTable(rows, iface) {
  const cols = [];
  rows.slice(0, 5).forEach((row) => { if (row && typeof row === 'object') Object.keys(row).forEach((k) => { if (!cols.includes(k)) cols.push(k); }); });
  if (!cols.length) {
    (iface.tables || []).forEach((t) => (t.fields || []).forEach((f) => { if (!cols.includes(f.name)) cols.push(f.name); }));
  }
  const head = cols.slice(0, 9).map((c) => '<th>' + esc(c) + '</th>').join('');
  const body = rows.slice(0, 20).map((row) => '<tr>' + cols.slice(0, 9).map((c) => '<td>' + esc(typeof row[c] === 'object' && row[c] !== null ? JSON.stringify(row[c]) : row[c]) + '</td>').join('') + '</tr>').join('');
  $('table').innerHTML = '<div class="tablewrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div><div class="msg">共 ' + rows.length + ' 条，显示前 ' + Math.min(rows.length, 20) + ' 条</div>';
}
async function send() {
  if (!state.route) return;
  const route = state.route;
  const path = $('reqPath').value.trim();
  let query = {};
  if (!$('reqQuery').hidden && $('reqQuery').value.trim()) {
    try { query = JSON.parse($('reqQuery').value); } catch (e) { $('reqMsg').textContent = 'Query JSON 无效：' + e.message; $('reqMsg').className = 'msg bad'; return; }
  }
  const url = path + (Object.keys(query).length ? '?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, v == null ? '' : String(v)])).toString() : '');
  const headers = {};
  const opts = { method: route.method, headers };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  if (!$('reqBody').hidden && $('reqBody').value.trim()) {
    try { opts.body = JSON.stringify(JSON.parse($('reqBody').value)); headers['content-type'] = 'application/json'; } catch (e) { $('reqMsg').textContent = 'Body JSON 无效：' + e.message; $('reqMsg').className = 'msg bad'; return; }
  }
  $('reqMsg').textContent = '请求中…'; $('reqMsg').className = 'msg';
  const t0 = Date.now();
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    const data = json ? unwrap(json) : text;
    const rows = rowsOf(data);
    if (rows) renderTable(rows.rows, state.iface);
    else $('table').innerHTML = '<div class="empty">这条路由不返回列表。</div>';
    $('output').hidden = false;
    $('output').textContent = json ? JSON.stringify(json, null, 2) : text;
    $('reqMsg').textContent = res.status + ' · ' + (Date.now() - t0) + 'ms';
    $('reqMsg').className = 'msg ' + (res.ok ? '' : 'bad');
  } catch (e) {
    $('reqMsg').textContent = '请求失败：' + e.message;
    $('reqMsg').className = 'msg bad';
    $('output').hidden = true;
    $('table').innerHTML = '<div class="empty">请求失败，检查服务是否在运行。</div>';
  }
}
function openLogin() {
  $('loginModal').classList.add('on');
  const extra = registerRoute ? document.createElement('div') : null;
  if (extra) {
    const fields = (registerRoute.route.body || []).filter((f) => !['username', 'password'].includes(f));
    extra.innerHTML = fields.map((f) => '<label>' + esc(f) + '</label><input type="text" data-extra="' + esc(f) + '" value="' + esc(sampleValue(f, true)) + '">').join('');
    $('extraFields').replaceChildren(extra);
  } else $('extraFields').replaceChildren();
}
function closeLogin() { $('loginModal').classList.remove('on'); }
function loginBody() {
  return { username: $('loginUser').value.trim(), password: $('loginPass').value.trim() };
}
function registerBody() {
  const out = { username: 'demo' + String(Date.now()).slice(-6), password: $('loginPass').value.trim() };
  const fields = (registerRoute && registerRoute.route.body) || [];
  fields.forEach((f) => {
    if (['username', 'password'].includes(f)) return;
    const el = document.querySelector('[data-extra="' + f + '"]');
    out[f] = el ? el.value : sampleValue(f, true);
  });
  return out;
}
async function callAuth(target, body) {
  const url = fullPath(target.iface, target.route);
  const res = await fetch(url, { method: target.route.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error || res.status) + (data.message ? ' · ' + data.message : ''));
  const token = data.token || (data.data && data.data.token);
  if (token) {
    state.token = token;
    localStorage.setItem('cbs_case_token_' + CASE.code, token);
    $('token').value = token;
  }
  return data;
}
async function doLogin() {
  $('loginMsg').textContent = '登录中…'; $('loginMsg').className = 'msg';
  try {
    if (!loginRoute) throw new Error('这个案例没有登录接口');
    await callAuth(loginRoute, loginBody());
    $('loginMsg').textContent = '登录成功，token 已保存。';
    setTimeout(closeLogin, 700);
  } catch (e) { $('loginMsg').textContent = '登录失败：' + e.message; $('loginMsg').className = 'msg bad'; }
}
async function doRegister() {
  if (!registerRoute) { $('loginMsg').textContent = '这个案例没有注册接口。'; $('loginMsg').className = 'msg bad'; return; }
  $('loginMsg').textContent = '注册中…'; $('loginMsg').className = 'msg';
  try {
    const body = registerBody();
    await callAuth(registerRoute, body);
    $('loginUser').value = body.username;
    $('loginPass').value = body.password;
    if (loginRoute) await doLogin(); else { $('loginMsg').textContent = '注册成功。'; setTimeout(closeLogin, 700); }
  } catch (e) { $('loginMsg').textContent = '注册失败：' + e.message; $('loginMsg').className = 'msg bad'; }
}

$('token').value = state.token;
$('token').onchange = () => {
  state.token = $('token').value.trim();
  if (state.token) localStorage.setItem('cbs_case_token_' + CASE.code, state.token);
  else localStorage.removeItem('cbs_case_token_' + CASE.code);
};
$('back').onclick = () => { $('home').hidden = false; $('detail').hidden = true; state.iface = null; state.route = null; };
$('send').onclick = send;
$('clear').onclick = () => { $('output').hidden = true; $('output').textContent = ''; $('table').innerHTML = '<div class="empty">选择左侧路由并点击「运行」，这里会显示返回数据。</div>'; $('reqMsg').textContent = ''; };
$('loginOpen').onclick = openLogin;
$('loginClose').onclick = closeLogin;
$('doLogin').onclick = doLogin;
$('doRegister').onclick = doRegister;
if (!loginRoute && !registerRoute) $('loginOpen').style.display = 'none';
renderNav();
renderHome();
</script>
</body>
</html>`;
}

function build(file, project) {
  const data = makeCaseData(file, project);
  const yxpp = {
    format: 'yxpp',
    version: 1,
    name: `${project.name} · 案例前端`,
    framework: 'tailwind',
    createdAt: UPDATED,
    updatedAt: UPDATED,
    project: studioProject(data),
    html: caseHtml(data),
  };
  return yxpp;
}

function validate(yxpp, project) {
  const errors = [];
  if (!yxpp.project || !yxpp.project.page || !Array.isArray(yxpp.project.elements)) errors.push('project 缺少 page/elements');
  if (!yxpp.project.elements.length) errors.push('project 没有元素');
  if (!String(yxpp.html || '').includes(project.name)) errors.push('html 缺少案例名');
  if (!String(yxpp.html || '').includes('fetch(')) errors.push('html 没有接口调用');
  if (!String(yxpp.html || '').includes('const CASE = ')) errors.push('html 没有注入案例数据');
  if (String(yxpp.html || '').length < 8000) errors.push('html 体积过小');
  return errors;
}

let ok = 0;
let bad = 0;
for (const file of fs.readdirSync(CASES).filter((f) => f.endsWith('.json')).sort()) {
  const base = file.replace(/\.json$/, '');
  const full = path.join(CASES, file);
  const project = JSON.parse(fs.readFileSync(full, 'utf8'));
  const yxpp = build(base, project);
  const errors = validate(yxpp, project);
  if (errors.length) {
    bad++;
    console.log(`FAIL  ${file}  ${errors.join(' | ')}`);
    continue;
  }
  ok++;
  console.log(`PASS  ${file}  ${project.interfaces.length} 接口 / ${yxpp.project.elements.length} 元素 / ${Math.round(yxpp.html.length / 1024)} KB HTML`);
  if (!checkOnly) {
    project.frontend = yxpp;
    fs.writeFileSync(full, JSON.stringify(project, null, 2) + '\n', 'utf8');
  }
}
console.log(`\n${ok}/${ok + bad} 案例前端生成${checkOnly ? '校验' : ''}通过`);
process.exit(bad ? 1 : 0);
