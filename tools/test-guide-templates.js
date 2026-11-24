// 作者：yxpil
'use strict';

// 创建引导的 21 个模板：从 renderer/wbench.js 读取常量并做结构回归。
// 不启动 Electron，检查字段类型、路由 key、表名唯一与分组覆盖。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TYPE_KEYS, ROUTE_KINDS } = require('../app/iface/spec');

const root = path.join(__dirname, '..');
const file = path.join(root, 'renderer', 'wbench.js');
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('const GUIDE_TEMPLATE_GROUPS =');
const end = src.indexOf('const GUIDE_PRESETS =');
if (start < 0 || end <= start) throw new Error('找不到 GUIDE_TEMPLATE_GROUPS / GUIDE_TEMPLATES 常量');

const slice = src.slice(start, end);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${slice}\nglobalThis.__TEMPLATES__={GUIDE_TEMPLATE_GROUPS,GUIDE_TEMPLATES};`, sandbox);
const { GUIDE_TEMPLATE_GROUPS: groups, GUIDE_TEMPLATES: templates } = sandbox.__TEMPLATES__;

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed += 1; console.log(`  ok ${passed} - ${name}`); }
  else { failed += 1; console.log(`  not ok - ${name}${detail ? `: ${detail}` : ''}`); }
}

ok('模板总数为 21', templates.length === 21, templates.length);
ok('场景分组至少 5 组', groups.length >= 5, groups.length);
ok('模板 key 唯一', new Set(templates.map((t) => t.key)).size === templates.length);
ok('分组 key 唯一', new Set(groups.map((g) => g.key)).size === groups.length);
const rbac = templates.find((t) => t.key === 'rbac');
ok('账号权限预设存在并默认推荐', !!rbac && rbac.recommended === true);
ok('账号权限预设覆盖登录注册与查询', !!rbac && ['login', 'register', 'me', 'logout', 'list', 'detail', 'search'].every((k) => rbac.routes.includes(k)), rbac && rbac.routes.join(','));
ok('账号权限预设默认全部 token 鉴权', !!rbac && rbac.authMode === 'all', rbac && rbac.authMode);

const groupKeys = new Set(groups.map((g) => g.key));
const tableNames = new Set();
const routeKeys = new Set(ROUTE_KINDS);
const typeKeys = new Set(TYPE_KEYS);

for (const t of templates) {
  const label = `[${t.key}]`;
  ok(`${label} 有分组、名称和提示`, groupKeys.has(t.group) && !!t.label && !!t.hint, `${t.group} / ${t.label}`);
  ok(`${label} 表名安全且工程内唯一`, t.key === 'blank' ? !t.tableName : (/^[a-z_][a-z0-9_]{0,63}$/.test(t.tableName || '') && !tableNames.has(t.tableName)), t.tableName);
  if (t.tableName) tableNames.add(t.tableName);
  ok(`${label} 鉴权模式合法`, ['none', 'write', 'all'].includes(t.authMode), t.authMode);
  ok(`${label} 至少一条路由且不重复`, Array.isArray(t.routes) && t.routes.length > 0 && new Set(t.routes).size === t.routes.length, t.routes && t.routes.join(','));
  ok(`${label} 路由 key 都在后端白名单`, (t.routes || []).every((r) => routeKeys.has(r)), (t.routes || []).filter((r) => !routeKeys.has(r)).join(','));

  const fields = String(t.fields || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const names = [];
  let fieldOk = fields.length > 0;
  let fieldDetail = '';
  for (const line of fields) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:[\s,，]+([A-Za-z]+))?(?:[\s,，]+(.+))?$/);
    if (!m) { fieldOk = false; fieldDetail = line; break; }
    const name = m[1].toLowerCase();
    const type = (m[2] || 'varchar').toLowerCase();
    if (!/^[a-z_][a-z0-9_]{0,47}$/.test(name) || ['id', 'created_at', 'updated_at'].includes(name) || names.includes(name) || !typeKeys.has(type)) {
      fieldOk = false; fieldDetail = `${name}:${type}`; break;
    }
    names.push(name);
  }
  ok(`${label} 字段名/类型合法且无系统字段`, fieldOk, fieldDetail);
}
ok('模板表名互不冲突', tableNames.size === templates.filter((t) => !!t.tableName).length);
ok('字段数/路由数能用于卡片展示', templates.every((t) => String(t.fields || '').split(/\r?\n/).filter((x) => x.trim()).length > 0 && t.routes.length > 0));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
