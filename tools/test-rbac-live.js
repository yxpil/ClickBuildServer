// 真实服务验收：账号权限预设一次生成登录、注册、当前用户、退出、列表、详情、搜索，
// 并验证 token 会话与 admin/user 角色权限。依赖本机 MariaDB + Redis。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-rbac-'));
process.env.APPDATA = tmp;
process.env.HOME = tmp;

const spec = require(path.join(root, 'app', 'iface', 'spec'));
const codegen = require(path.join(root, 'app', 'iface', 'codegen'));
const services = require(path.join(root, 'app', 'iface', 'services'));

async function call(base, method, p, body, token) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, data };
}

function bodyRows(r) {
  return (r.data && r.data.data && r.data.data.rows) || [];
}

function payload(r) {
  return (r.data && r.data.data) || {};
}

(async () => {
  let started = null;
  let srv = null;
  const checks = [];
  const ok = (name, cond, info) => {
    checks.push({ name, cond: !!cond, info });
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (info ? ' → ' + info : ''));
  };
  try {
    started = await services.startAll((x) => console.log('[svc]', x.name, x.status, x.text || ''));
    const bad = Object.entries(started).filter(([, v]) => !v || !v.ok);
    if (bad.length) throw new Error('服务未就绪：' + bad.map(([k, v]) => `${k}:${v && v.error}`).join('；'));

    const project = spec.normalizeProject({
      name: '账号权限真实验收', categories: [], interfaces: [], functions: [],
      permissions: { roles: [{ key: 'admin', name: '管理员' }, { key: 'user', name: '普通用户' }], enforce: true },
    });
    project.interfaces.push(spec.newIface('账号权限', 'biz', { scenario: 'rbac' }));
    const iface = project.interfaces[0];
    const routes = iface.routes.map((r) => `${r.method} ${r.path} auth=${r.auth} roles=${r.roles.join(',')}`);
    console.log('路由：\n  ' + routes.join('\n  '));
    ok('预设生成 7 条账号路由',
      iface.routes.length === 7 && ['login', 'register', 'me', 'logout', 'list', 'detail', 'search'].every((k) => iface.routes.some((r) => r.key === k)));
    ok('登录注册公开，其余全部要求 token',
      !iface.routes.find((r) => r.key === 'login').auth &&
      !iface.routes.find((r) => r.key === 'register').auth &&
      iface.routes.filter((r) => !['login', 'register'].includes(r.key)).every((r) => r.auth));
    ok('列表/详情/搜索只允许 admin',
      ['list', 'detail', 'search'].every((k) => {
        const r = iface.routes.find((x) => x.key === k);
        return r.roles.length === 1 && r.roles[0] === 'admin';
      }));
    ok('密码字段隐藏且不参与查询',
      iface.tables[0].fields.some((f) => f.name === 'password_hash' && f.hidden && !f.query));

    const dir = path.join(tmp, 'gen');
    codegen.writeTo(project, dir, { runtime: 'node', runtimeOnly: true });
    console.log('生成目录：', dir);

    srv = await services.startServer(dir, { runtime: 'node' });
    if (!srv.ok) throw new Error('服务启动失败：' + srv.error);
    const baseUrl = `http://127.0.0.1:${srv.port || 18100}`;
    console.log('服务：', baseUrl);

    const health = await call(baseUrl, 'GET', '/_health');
    ok('服务健康检查', health.status === 200, health.status);

    const noTokenMe = await call(baseUrl, 'GET', '/api/auth/me');
    ok('未登录访问当前用户返回 401', noTokenMe.status === 401, noTokenMe.status + ' ' + JSON.stringify(noTokenMe.data).slice(0, 120));
    const noTokenList = await call(baseUrl, 'GET', '/api/sys_account');
    ok('未登录访问用户列表返回 401', noTokenList.status === 401, noTokenList.status + ' ' + JSON.stringify(noTokenList.data).slice(0, 120));

    const stamp = Date.now().toString().slice(-8);
    const admin = { username: 'admin' + stamp, password: 'Pass!' + stamp, nickname: '首个管理员' };
    const reg1 = await call(baseUrl, 'POST', '/api/auth/register', admin);
    const reg1Body = payload(reg1);
    console.log('首个注册：', reg1.status, JSON.stringify(reg1.data));
    ok('首个注册账号成功并自动成为 admin', reg1.status === 201 && reg1Body.role === 'admin' && reg1Body.token, reg1.status + ' role=' + reg1Body.role);
    const adminToken = reg1Body.token;

    const me1 = await call(baseUrl, 'GET', '/api/auth/me', null, adminToken);
    console.log('管理员 me：', me1.status, JSON.stringify(me1.data));
    const meUser = payload(me1).user;
    ok('token 可读取当前用户且带 admin 角色',
      me1.status === 200 && meUser && String(meUser.role || meUser.data && meUser.data.role) === 'admin' && String(meUser.username || meUser.data && meUser.data.username) === admin.username,
      me1.status + ' ' + JSON.stringify(meUser));

    const list1 = await call(baseUrl, 'GET', '/api/sys_account', null, adminToken);
    const rows1 = bodyRows(list1);
    ok('管理员可查询用户列表且能读到注册账号',
      list1.status === 200 && rows1.some((r) => r.username === admin.username),
      list1.status + ' rows=' + rows1.length);
    ok('列表响应不泄露密码字段',
      rows1.length > 0 && rows1.every((r) => !Object.prototype.hasOwnProperty.call(r, 'password_hash')),
      Object.keys(rows1[0] || {}).join(','));

    const detail1 = await call(baseUrl, 'GET', '/api/sys_account/' + reg1Body.id, null, adminToken);
    ok('管理员可查询用户详情', detail1.status === 200 && payload(detail1).row, detail1.status);

    const search1 = await call(baseUrl, 'GET', '/api/sys_account/search?keyword=' + encodeURIComponent(admin.username), null, adminToken);
    const searchRows = bodyRows(search1);
    ok('管理员可搜索用户', search1.status === 200 && searchRows.some((r) => r.username === admin.username), search1.status + ' rows=' + searchRows.length);

    const user = { username: 'user' + stamp, password: 'Pass!' + stamp, nickname: '普通用户' };
    const reg2 = await call(baseUrl, 'POST', '/api/auth/register', user);
    const reg2Body = payload(reg2);
    console.log('第二个注册：', reg2.status, JSON.stringify(reg2.data));
    ok('后续注册账号自动成为 user', reg2.status === 201 && reg2Body.role === 'user' && reg2Body.token, reg2.status + ' role=' + reg2Body.role);
    const userToken = reg2Body.token;

    const me2 = await call(baseUrl, 'GET', '/api/auth/me', null, userToken);
    const me2User = payload(me2).user || {};
    ok('普通用户 token 可读取当前用户', me2.status === 200 && String(me2User.role || me2User.data && me2User.data.role) === 'user', me2.status);
    const list2 = await call(baseUrl, 'GET', '/api/sys_account', null, userToken);
    ok('普通用户访问用户列表被角色拦截', list2.status === 403, list2.status + ' ' + JSON.stringify(list2.data).slice(0, 120));

    const login1 = await call(baseUrl, 'POST', '/api/auth/login', { username: admin.username, password: admin.password });
    const login1Body = payload(login1);
    console.log('管理员登录：', login1.status, JSON.stringify(login1.data));
    ok('管理员密码登录签发带角色 token',
      login1.status === 200 && login1Body.token && login1Body.user && login1Body.user.role === 'admin',
      login1.status + ' role=' + (login1Body.user && login1Body.user.role));

    const badLogin = await call(baseUrl, 'POST', '/api/auth/login', { username: admin.username, password: 'wrong-password' });
    ok('错误密码被拒绝', badLogin.status === 401, badLogin.status);

    const logout = await call(baseUrl, 'POST', '/api/auth/logout', null, userToken);
    ok('退出登录成功', logout.status === 200, logout.status + ' ' + JSON.stringify(logout.data));
    const meAfterLogout = await call(baseUrl, 'GET', '/api/auth/me', null, userToken);
    ok('退出后 token 立即失效', meAfterLogout.status === 401, meAfterLogout.status);

    const failed = checks.filter((c) => !c.cond);
    console.log(`\n通过 ${checks.length - failed.length} / ${checks.length}`);
    if (failed.length) throw new Error('失败：' + failed.map((c) => c.name).join('；'));
    console.log('REAL_RBAC_E2E_OK');
  } catch (e) {
    console.error('\nREAL_RBAC_E2E_FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    try { if (srv) await services.stopServer(); } catch (e) {}
    try { await services.stopAll(); } catch (e) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
})();
