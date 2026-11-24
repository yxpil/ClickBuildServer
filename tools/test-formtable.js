// 作者：yxpil
'use strict';

// 前端表单增强回归：静默提交、表格表单、按接口生成表单。
// 从 renderer/studio.html 抽取纯函数，用 vm 求值，不启动 Electron。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const file = path.join(root, 'renderer', 'studio.html');
const src = fs.readFileSync(file, 'utf8');

function grab(startMark, endMark) {
  const start = src.indexOf(startMark);
  const end = endMark ? src.indexOf(endMark, start + startMark.length) : src.length;
  if (start < 0 || end <= start) throw new Error('找不到代码段：' + startMark);
  return src.slice(start, end);
}

const escStub = `
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
var FORM_SUBMIT_MODES = [['native','标准提交'],['json','AJAX JSON'],['formdata','AJAX FormData'],['custom','自定义 JS']];
function submitModeOf(p){ var m = String(p && p.submitMode || 'native'); return FORM_SUBMIT_MODES.some(function(x){return x[0]===m;}) ? m : 'native'; }
function authModeOf(p){ return String(p && p.mode || 'login'); }
`;

const code = [
  escStub,
  grab('function formFields(p) {', 'function formTableRows(p, limit)'),
  grab('function formTableRows(p, limit)', 'function formFieldTag(f, kind, style, attrs)'),
  grab('function formFieldTag(f, kind, style, attrs)', 'var FORM_SUBMIT_MODES'),
  grab('function formSubmitAttrs(p, authMode)', 'function formTableInnerMarkup(p, compact)'),
  grab('function formTableInnerMarkup(p, compact)', 'function authAutocomplete(f, mode)'),
  grab('function ifaceWriteRoutes(iface)', 'function ifaceFormAction(iface, route)'),
  grab('function ifaceFormAction(iface, route)', 'function ifaceFormInputType(f)'),
  grab('function ifaceFormInputType(f)', 'function ifaceFormFieldList(iface, route)'),
  grab('function ifaceFormFieldList(iface, route)', 'function ifaceFormFieldsText(fields)'),
  grab('function ifaceFormFieldsText(fields)', 'var ifaceFormState')
].join('\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code + '\nglobalThis.__FT__={formFields,formTableRows,formFieldTag,formSubmitAttrs,formTableInnerMarkup,ifaceWriteRoutes,ifaceFormAction,ifaceFormInputType,ifaceFormFieldList,ifaceFormFieldsText};', sandbox);
const FT = sandbox.__FT__;

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed += 1; console.log(`  ok ${passed} - ${name}`); }
  else { failed += 1; console.log(`  not ok - ${name}${detail ? `: ${detail}` : ''}`); }
}

// formFields / rows
const ff = FT.formFields({ fields: '姓名|text|请输入姓名|name|required\n邮箱|email|you@example.com|email\n备注|textarea|写点什么' });
ok('字段协议解析四段并保留 required 第五段', ff.length === 3 && ff[0].name === 'name' && ff[0].required === true && ff[1].required === false && ff[2].name === 'f3', JSON.stringify(ff));
ok('空行与会空标签被忽略', FT.formFields({ fields: '\n|text|x|a\n有效|text||ok' }).length === 1);
ok('录入行数限制在 1–20', FT.formTableRows({ rows: 0 }) === 1 && FT.formTableRows({ rows: 2 }) === 2 && FT.formTableRows({ rows: 99 }) === 20 && FT.formTableRows({ rows: 8 }, 5) === 5);

// submit attrs
ok('静默提交导出标记与请求方法', FT.formSubmitAttrs({ submitMode: 'json', method: 'put', silent: true, success: '已保存' }).indexOf('data-ps-silent="1"') >= 0 && FT.formSubmitAttrs({ submitMode: 'json', method: 'put' }).indexOf('data-ps-method="PUT"') >= 0);
ok('非静默不产生静默标记', FT.formSubmitAttrs({ submitMode: 'native', method: 'post' }).indexOf('data-ps-silent') < 0);
ok('自定义处理器仍写入 data-ps-custom', FT.formSubmitAttrs({ submitMode: 'custom', custom: 'return 1;' }).indexOf('data-ps-custom="return 1;"') >= 0);

// formtable markup
const ftMarkup = FT.formTableInnerMarkup({ fields: '姓名|text|请输入姓名|name|required\n邮箱|email|you@example.com|email', rows: 2, submit: '保存记录', padding: 6, stripe: true, stripeBg: '#FAFAF7', submitBg: '#123456' });
ok('表格表单生成表头与字段名', ftMarkup.indexOf('姓名') >= 0 && ftMarkup.indexOf('邮箱') >= 0 && ftMarkup.indexOf('name="name"') >= 0 && ftMarkup.indexOf('name="email"') >= 0);
ok('表格表单按行数重复字段', (ftMarkup.match(/name="name"/g) || []).length === 2 && (ftMarkup.match(/name="email"/g) || []).length === 2);
ok('表格表单写入必填与自定义按钮名', ftMarkup.indexOf('required') >= 0 && ftMarkup.indexOf('保存记录') >= 0 && ftMarkup.indexOf('data-ps-form-msg') >= 0);
ok('表格表单支持斑马纹和自定义内边距', ftMarkup.indexOf('background:#FAFAF7') >= 0 && ftMarkup.indexOf('padding:6px') >= 0);
ok('表格表单三行时生成三个重复字段', (FT.formTableInnerMarkup({ fields: 'A|text||a', rows: 3 }).match(/name="a"/g) || []).length === 3);

// iface form
const iface = {
  name: '博客文章',
  basePath: '/v1',
  routes: [
    { key: 'list', method: 'GET', path: '/posts' },
    { key: 'create', method: 'POST', path: '/posts' },
    { key: 'update', method: 'PUT', path: '/posts/:id' },
    { key: 'remove', method: 'DELETE', path: '/posts/:id' }
  ],
  fields: [
    { name: 'id', type: 'bigint', pk: true, autoIncrement: true, nullable: false },
    { name: 'title', type: 'varchar', length: 120, comment: '标题', nullable: false },
    { name: 'status', type: 'varchar', length: 20, comment: '状态', nullable: true },
    { name: 'created_at', type: 'datetime', comment: '创建时间', nullable: false },
    { name: 'secret', type: 'varchar', comment: '隐藏字段', hidden: true },
    { name: 'readonly_note', type: 'varchar', comment: '只读字段', writable: false }
  ]
};
const writes = FT.ifaceWriteRoutes(iface);
ok('写入路由只保留 POST / PUT / PATCH', writes.length === 2 && writes[0].method === 'POST' && writes[1].method === 'PUT');
ok('接口地址拼接 /api + basePath + path', FT.ifaceFormAction(iface, iface.routes[1]) === '/api/v1/posts' && FT.ifaceFormAction({ basePath: '/v1/' }, { path: 'posts' }) === '/api/v1/posts');
ok('空路径返回空地址', FT.ifaceFormAction(iface, {}) === '');

const typeCases = [
  [{ name: 'email', type: 'varchar' }, 'email'],
  [{ name: 'mobile', type: 'varchar' }, 'tel'],
  [{ name: 'birthday', type: 'date' }, 'date'],
  [{ name: 'created_at', type: 'datetime' }, 'datetime-local'],
  [{ name: 'qty', type: 'int' }, 'number'],
  [{ name: 'body', type: 'longtext' }, 'textarea'],
  [{ name: 'enabled', type: 'bool' }, 'checkbox'],
  [{ name: 'password', type: 'varchar' }, 'password'],
  [{ name: 'website', type: 'varchar' }, 'url'],
  [{ name: 'name', type: 'varchar' }, 'text']
];
ok('数据库字段映射到合适的输入控件', typeCases.every((x) => FT.ifaceFormInputType(x[0]) === x[1]), typeCases.map((x) => x[0].name + ':' + FT.ifaceFormInputType(x[0])).join(','));

const byBody = FT.ifaceFormFieldList(iface, { body: ['title', 'status', 'id', 'ghost'] });
ok('按路由 body 生成字段并跳过系统字段', byBody.length === 3 && byBody[0].name === 'title' && byBody[1].name === 'status' && byBody[2].name === 'ghost', JSON.stringify(byBody.map((x) => x.name)));
ok('字段使用表注释作标签并推断必填', byBody[0].label === '标题' && byBody[0].required === true && byBody[1].required === false && byBody[0].type === 'text');
const byCols = FT.ifaceFormFieldList(iface, { body: [] });
ok('没有 body 时只取主表可写字段', byCols.length === 2 && byCols[0].name === 'title' && byCols[1].name === 'status', JSON.stringify(byCols.map((x) => x.name)));
ok('自动字段文本可直接放入检查器', FT.ifaceFormFieldsText(byBody).split('\n')[0] === '标题|text|请输入标题|title|required' && FT.ifaceFormFieldsText(byBody).split('\n').length === 3);
ok('字段标签中的竖线被替换', FT.ifaceFormFieldsText([{ label: 'A|B', type: 'text', placeholder: 'x|y', name: 'ab' }]) === 'A/B|text|x/y|ab');

// source wiring checks
ok('前端类型表包含 formtable', /formtable\s*:\s*\{\s*label:\s*'表格表单'/.test(src) && src.indexOf("'form', 'formtable', 'auth'") >= 0);
ok('表单默认值含静默开关', /case 'form':[\s\S]{0,500}silent:\s*false/.test(src) && /case 'auth':[\s\S]{0,500}silent:\s*false/.test(src));
ok('导出运行时拦截静默原生提交', src.indexOf("&& !silent) return;") >= 0 && src.indexOf("if(mode ===") >= 0 && src.indexOf("data-ps-method") >= 0);
ok('工具栏与属性面板包含接口表单入口', src.indexOf('id="btnIfaceForm"') >= 0 && src.indexOf('表格字段（标签|类型|占位|字段名|可选 required）') >= 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
