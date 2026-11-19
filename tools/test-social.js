#!/usr/bin/env node
/**
 * 社交接口库真实 HTTP 验收脚本。
 * 覆盖 /api/social 下全部 86 条预置路由：账户、好友、私聊、群聊、动态、搜索、通知、文件、统计。
 * 使用 onlyId 作为身份字段，cookie/Bearer 二选一维持登录态，并在过程中验证 Set-Cookie 与退出清除。
 *
 * 用法：node tools/test-social.js [baseUrl]
 * 默认 baseUrl=http://127.0.0.1:18100
 */
const assert = require('node:assert/strict');

const BASE = (process.argv[2] || 'http://127.0.0.1:18100').replace(/\/+$/, '');
const API = BASE + '/api/social';
const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let checks = 0;
const failures = [];
const covered = new Set();
const expected = new Set();

function pass(name, info) {
  checks++;
  console.log(`  ok  ${name}${info ? ' · ' + info : ''}`);
}
function fail(name, err, info) {
  checks++;
  failures.push({ name, err: String(err && err.stack || err), info });
  console.log(`  FAIL ${name}${info ? ' · ' + info : ''}`);
}
function check(cond, name, info) {
  if (cond) pass(name, info); else fail(name, new Error('assertion failed'), info);
}

class Client {
  constructor(label) { this.label = label; this.token = ''; this.cookie = ''; this.onlyId = ''; }
  absorbCookie(res) {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    this.lastSetCookie = sc;
    for (const line of sc) {
      const m = /^icb_token=([^;]*)/.exec(line);
      if (!m) continue;
      if (/Max-Age=0/i.test(line)) this.cookie = '';
      else this.cookie = decodeURIComponent(m[1]);
    }
  }
  async req(method, path, opt = {}) {
    const { body, form, auth = 'token', expect = 200, key } = opt;
    const headers = {};
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json; charset=utf-8';
      payload = JSON.stringify(body);
    }
    if (auth === 'token' && this.token) headers.authorization = 'Bearer ' + this.token;
    if (auth !== 'none' && this.cookie) headers.cookie = 'icb_token=' + encodeURIComponent(this.cookie);
    const res = await fetch(API + path, { method, headers, body: payload });
    this.absorbCookie(res);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (key) covered.add(key);
    const result = { status: res.status, body: json, data: json && json.data, headers: res.headers };
    if (expect !== null) {
      if (!Array.isArray(expect) ? res.status !== expect : !expect.includes(res.status)) {
        throw new Error(`${method} ${path} 期望 ${expect} 实际 ${res.status}: ${text.slice(0, 500)}`);
      }
      if (res.status >= 400 && json && json.ok !== false) throw new Error(`${method} ${path} 失败响应未带 ok:false`);
    }
    return result;
  }
  async ok(method, path, opt = {}) {
    const r = await this.req(method, path, { ...opt, expect: opt.expect === undefined ? null : opt.expect });
    if (r.status < 200 || r.status >= 300) throw new Error(`${method} ${path} 非 2xx: ${r.status} ${JSON.stringify(r.body).slice(0, 800)}`);
    if (!r.body || r.body.ok !== true) throw new Error(`${method} ${path} ok!=true: ${JSON.stringify(r.body).slice(0, 500)}`);
    return r.data;
  }
  async bad(method, path, code, opt = {}) {
    const r = await this.req(method, path, { ...opt, expect: code });
    check(r.body && r.body.ok === false, `${method} ${path} 返回业务错误`, `${code} ${r.body && r.body.error}`);
    return r.body;
  }
}

async function run() {
  console.log(`社交接口库验收 · ${BASE}`);
  const routesRes = await fetch(BASE + '/_routes');
  const routesJson = await routesRes.json();
  for (const r of routesJson.routes || []) {
    const p = r.path.replace(/^\/api\/social/, '');
    expected.add(`${r.method} ${p}`);
  }
  console.log(`  发现路由 ${expected.size} 条`);

  const A = new Client('A');
  const B = new Client('B');
  const C = new Client('C');
  const D = new Client('D');
  const E = new Client('E');
  const anon = new Client('anon');

  // ---------- 账户 ----------
  for (const [c, name] of [[A, '甲'], [B, '乙'], [C, '丙'], [D, '丁'], [E, '戊']]) {
    const data = await c.ok('POST', '/register', {
      auth: 'none',
      key: 'POST /register',
      body: { username: `soc_${stamp}_${name}`, password: 'pass1234', nickname: `测试${name}`, device: 'test-social' },
    });
    c.onlyId = data.onlyId;
    c.token = data.token;
    check(!!data.onlyId && data.onlyId.length >= 16, `注册返回 onlyId (${c.label})`, data.onlyId);
    check(!!data.token, `注册返回 token (${c.label})`);
  }
  check(!!A.cookie, '注册自动下发 cookie');
  check((A.lastSetCookie || []).some(x => /HttpOnly/i.test(x) && /SameSite=Lax/i.test(x) && /Max-Age=7200/i.test(x)), '注册 Set-Cookie 带 HttpOnly/SameSite=Lax/Max-Age=7200');
  check(!!A.token, '注册同时返回 bearer token');

  const unameA = `soc_${stamp}_甲`;
  const taken = await A.ok('GET', '/check-username?username=' + encodeURIComponent(unameA), { key: 'GET /check-username', auth: 'none' });
  check(taken.available === false, '用户名查重：已占用');
  const free = await A.ok('GET', '/check-username?username=' + encodeURIComponent(unameA + '_free'), { key: 'GET /check-username', auth: 'none' });
  check(free.available === true, '用户名查重：可用');

  // 登录用独立客户端，验证 cookie 和 token 都会重新下发
  const B2 = new Client('B2');
  const loginB = await B2.ok('POST', '/login', { auth: 'none', key: 'POST /login', body: { username: `soc_${stamp}_乙`, password: 'pass1234', device: 'test-social-login' } });
  B2.onlyId = loginB.onlyId; B2.token = loginB.token;
  check(!!B2.cookie, '登录自动下发 cookie');
  check((B2.lastSetCookie || []).some(x => /HttpOnly/i.test(x) && /Max-Age=7200/i.test(x)), '登录 Set-Cookie 可维持登录态');
  check(B2.onlyId === B.onlyId, '登录返回同一 onlyId');

  const me = await A.ok('GET', '/me', { auth: 'cookie', key: 'GET /me' });
  check(me.user && me.user[0] && me.user[0].only_id === A.onlyId, '仅 cookie 可识别用户', me.user && me.user[0] && me.user[0].only_id);
  check(me.identityFrom === 'onlyId', '响应声明身份来自 onlyId');
  check(me.auth === 'cookie-or-bearer', '响应声明 cookie 或 Bearer 登录');

  const anonMe = await anon.req('GET', '/me', { auth: 'none', key: 'GET /me', expect: 401 });
  check(anonMe.status === 401, '无 cookie/token 访问受保护路由返回 401');

  const updated = await A.ok('PUT', '/me', { key: 'PUT /me', body: { nickname: `测试甲-改`, bio: '社交接口库验收账号', region: '昆明', gender: 1 } });
  check(updated.onlyId === A.onlyId, '更新资料使用 token 内 onlyId');

  const session = await A.ok('GET', '/session', { auth: 'cookie', key: 'GET /session' });
  check(session.tokenPresent === true && session.cookieName === 'icb_token', '会话状态可读 cookie 名');

  const logs = await A.ok('GET', '/login-logs', { key: 'GET /login-logs' });
  check(Array.isArray(logs.rows) && logs.rows.length >= 1, '登录记录已落库', `${logs.rows && logs.rows.length} 条`);

  const pwd = await A.ok('PUT', '/password', { key: 'PUT /password', body: { old_password: 'pass1234', new_password: 'pass5678' } });
  check(pwd.ok === true, '旧密码校验后修改密码');
  const loginA2 = await anon.ok('POST', '/login', { auth: 'none', key: 'POST /login', body: { username: unameA, password: 'pass5678', device: 'test-social-newpwd' } });
  check(loginA2.onlyId === A.onlyId, '新密码可登录');

  // ---------- 好友 ----------
  const searchU = await A.ok('GET', '/friends/search?q=' + encodeURIComponent(`soc_${stamp}_乙`), { key: 'GET /friends/search' });
  check(searchU.rows.length >= 1 && searchU.rows.some(x => x.only_id === B.onlyId), '好友页搜索用户命中乙');

  const fr = await A.ok('POST', '/friends/requests', { key: 'POST /friends/requests', body: { to_only_id: B.onlyId, message: '交个朋友' } });
  const reqId = fr.reqId;
  check(!!reqId, '发送好友申请返回 reqId');

  const pending = await B.ok('GET', '/friends/requests', { key: 'GET /friends/requests' });
  check(pending.incoming.some(x => x.req_id === reqId), '乙收到好友申请');
  const accept = await B.ok('PUT', '/friends/requests/' + reqId, { key: 'PUT /friends/requests/:req_id', body: { action: 'accept' } });
  check(accept.status === 'accepted', '通过好友申请');

  const friendsA = await A.ok('GET', '/friends', { key: 'GET /friends' });
  check(friendsA.rows.some(x => x.only_id === B.onlyId && x.nickname), '甲好友列表包含乙');
  const statusAB = await A.ok('GET', '/friends/status/' + B.onlyId, { key: 'GET /friends/status/:only_id' });
  check(statusAB.friend === true, '好友状态 friend=true');
  const suggest = await A.ok('GET', '/friends/suggest', { key: 'GET /friends/suggest' });
  check(Array.isArray(suggest.rows), '好友推荐返回数组');

  const block = await A.ok('POST', '/blocks', { key: 'POST /blocks', body: { blocked_only_id: C.onlyId, reason: '验收拉黑' } });
  check(block.ok === true, '拉黑丙');
  const blocks = await A.ok('GET', '/blocks', { key: 'GET /blocks' });
  check(blocks.rows.some(x => x.only_id === C.onlyId), '黑名单包含丙');
  const unblock = await A.ok('DELETE', '/blocks/' + C.onlyId, { key: 'DELETE /blocks/:only_id' });
  check(unblock.ok === true, '解除拉黑丙');

  // ---------- 私聊 ----------
  const m1 = await A.ok('POST', '/messages', { key: 'POST /messages', body: { to: B.onlyId, body: '你好，乙', msg_type: 'text' } });
  check(!!m1.convId && !!m1.msgId, '发送私聊返回会话与消息 ID');
  const convId = m1.convId;
  const m2 = await A.ok('POST', '/messages', { key: 'POST /messages', body: { to: B.onlyId, body: '这条会被撤回', msg_type: 'text' } });

  const convs = await A.ok('GET', '/conversations', { key: 'GET /conversations' });
  check(convs.rows.some(x => x.conv_id === convId && x.peer_only_id === B.onlyId), '会话列表包含与乙的会话');
  const conv = await A.ok('GET', '/conversations/' + convId, { key: 'GET /conversations/:conv_id' });
  check(Array.isArray(conv.conversation) && conv.conversation.length === 1, '会话详情按会话 ID 命中');

  const history = await A.ok('GET', '/messages/' + convId, { key: 'GET /messages/:conv_id' });
  check(history.rows.length >= 2, '消息历史包含两条私聊', `${history.rows.length} 条`);

  const unreadB = await B.ok('GET', '/unread', { key: 'GET /unread' });
  check(unreadB.private >= 2, '乙私聊未读数 >= 2', String(unreadB.private));
  const read1 = await B.ok('PUT', '/messages/' + m1.msgId + '/read', { key: 'PUT /messages/:msg_id/read' });
  check(read1.ok === true, '标记单条私聊已读');
  const readConv = await B.ok('PUT', '/conversations/' + convId + '/read', { key: 'PUT /conversations/:conv_id/read' });
  check(readConv.ok === true, '标记会话全部已读');

  const recall = await A.ok('PUT', '/messages/' + m2.msgId + '/recall', { key: 'PUT /messages/:msg_id/recall' });
  check(recall.ok === true, '撤回私聊消息');
  const delMsg = await A.ok('DELETE', '/messages/' + m2.msgId, { key: 'DELETE /messages/:msg_id' });
  check(delMsg.ok === true, '删除私聊消息');

  const reply = await B.ok('POST', '/messages', { key: 'POST /messages', body: { to: A.onlyId, body: '收到，甲', msg_type: 'text' } });
  check(reply.convId === convId, '回复复用同一会话');
  const typing = await A.ok('POST', '/typing', { key: 'POST /typing', body: { to: B.onlyId } });
  check(typing.ok === true, 'typing 事件发布成功');

  // ---------- 群聊 ----------
  const g = await A.ok('POST', '/groups', { key: 'POST /groups', body: { name: `验收群-${stamp}`, intro: '接口库验收群', join_mode: 1 } });
  const gid = g.groupId;
  check(!!gid, '创建群返回 groupId');

  const myGroups = await A.ok('GET', '/groups', { key: 'GET /groups' });
  check(myGroups.rows.some(x => x.group_id === gid && x.role === 'owner'), '我的群包含新群且角色 owner');
  const gs = await A.ok('GET', '/groups/search?q=' + encodeURIComponent(`验收群-${stamp}`), { key: 'GET /groups/search' });
  check(gs.rows.some(x => x.group_id === gid), '搜索群命中新群');
  const gd = await A.ok('GET', '/groups/' + gid, { key: 'GET /groups/:group_id' });
  check(gd.group && gd.group[0] && gd.group[0].name.indexOf('验收群') === 0, '群详情返回名称');
  const gu = await A.ok('PUT', '/groups/' + gid, { key: 'PUT /groups/:group_id', body: { intro: '更新后的群简介' } });
  check(gu.ok === true, '群主更新群资料');

  const ann = await A.ok('POST', '/groups/' + gid + '/announcements', { key: 'POST /groups/:group_id/announcements', body: { content: '欢迎加入验收群' } });
  check(!!ann.announceId, '发布群公告');
  const anns = await A.ok('GET', '/groups/' + gid + '/announcements', { key: 'GET /groups/:group_id/announcements' });
  check(anns.rows.some(x => x.announce_id === ann.announceId), '群公告列表包含新公告');

  const addB = await A.ok('POST', '/groups/' + gid + '/members', { key: 'POST /groups/:group_id/members', body: { only_id: B.onlyId } });
  check(addB.ok === true, '群主添加乙入群');
  const members = await A.ok('GET', '/groups/' + gid + '/members', { key: 'GET /groups/:group_id/members' });
  check(members.rows.some(x => x.only_id === B.onlyId && x.role === 'member'), '群成员列表包含乙');

  const mute = await A.ok('PUT', '/groups/' + gid + '/members/' + B.onlyId + '/mute', { key: 'PUT /groups/:group_id/members/:only_id/mute', body: { mute: 1 } });
  check(mute.ok === true, '禁言乙');
  await B.bad('POST', '/groups/' + gid + '/messages', 403, { key: 'POST /groups/:group_id/messages', body: { body: '禁言期间发言' } });
  const unmute = await A.ok('PUT', '/groups/' + gid + '/members/' + B.onlyId + '/mute', { key: 'PUT /groups/:group_id/members/:only_id/mute', body: { mute: 0 } });
  check(unmute.ok === true, '解除禁言乙');
  const gm = await B.ok('POST', '/groups/' + gid + '/messages', { key: 'POST /groups/:group_id/messages', body: { body: '群消息验收', msg_type: 'text' } });
  check(!!gm.msgId, '解除禁言后乙可发群消息');
  const gmh = await A.ok('GET', '/groups/' + gid + '/messages', { key: 'GET /groups/:group_id/messages' });
  check(gmh.rows.some(x => x.msg_id === gm.msgId), '群消息历史包含乙的消息');

  const transfer = await A.ok('POST', '/groups/' + gid + '/transfer', { key: 'POST /groups/:group_id/transfer', body: { to_only_id: B.onlyId } });
  check(transfer.ok === true, '转让群主给乙');

  const joinC = await C.ok('POST', '/groups/' + gid + '/join', { key: 'POST /groups/:group_id/join' });
  check(joinC.joined === true, '丙通过开放模式加群');
  const leaveC = await C.ok('POST', '/groups/' + gid + '/leave', { key: 'POST /groups/:group_id/leave' });
  check(leaveC.ok === true, '丙退出群');
  const addC = await B.ok('POST', '/groups/' + gid + '/members', { key: 'POST /groups/:group_id/members', body: { only_id: C.onlyId } });
  check(addC.ok === true, '新群主乙重新添加丙');
  const rmC = await B.ok('DELETE', '/groups/' + gid + '/members/' + C.onlyId, { key: 'DELETE /groups/:group_id/members/:only_id' });
  check(rmC.ok === true, '群主乙移除丙');
  const leaveA = await A.ok('POST', '/groups/' + gid + '/leave', { key: 'POST /groups/:group_id/leave' });
  check(leaveA.ok === true, '甲以管理员身份退出群');

  // ---------- 动态 ----------
  const mo = await A.ok('POST', '/moments', { key: 'POST /moments', body: { content: `动态验收 ${stamp}`, images: '[]', visibility: 1 } });
  const momentId = mo.momentId;
  check(!!momentId, '发布动态返回 momentId');
  const feedA = await A.ok('GET', '/moments', { key: 'GET /moments' });
  check(feedA.rows.some(x => x.moment_id === momentId), '好友动态流包含自己的动态');
  const feedB = await B.ok('GET', '/moments', { key: 'GET /moments' });
  check(feedB.rows.some(x => x.moment_id === momentId), '乙好友动态流包含甲的动态');
  const detail = await A.ok('GET', '/moments/' + momentId, { key: 'GET /moments/:moment_id' });
  check(detail.moment && detail.moment[0] && detail.moment[0].moment_id === momentId, '动态详情命中');
  const like = await B.ok('POST', '/moments/' + momentId + '/like', { key: 'POST /moments/:moment_id/like' });
  check(like.liked === true, '乙点赞动态');
  const cmt = await B.ok('POST', '/moments/' + momentId + '/comments', { key: 'POST /moments/:moment_id/comments', body: { content: '评论验收' } });
  check(!!cmt.commentId, '乙发表评论');
  const cmts = await A.ok('GET', '/moments/' + momentId + '/comments', { key: 'GET /moments/:moment_id/comments' });
  check(cmts.rows.some(x => x.comment_id === cmt.commentId), '评论列表包含乙评论');
  const dc = await A.ok('DELETE', '/moments/' + momentId + '/comments/' + cmt.commentId, { key: 'DELETE /moments/:moment_id/comments/:comment_id' });
  check(dc.ok === true, '动态作者删除评论');
  const userMoments = await A.ok('GET', '/moments/user/' + A.onlyId, { key: 'GET /moments/user/:only_id' });
  check(userMoments.rows.some(x => x.moment_id === momentId), '用户动态包含自己的动态');
  const hot = await A.ok('GET', '/moments/hot', { key: 'GET /moments/hot' });
  check(Array.isArray(hot.rows), '热门动态返回数组');

  // ---------- 搜索（在删除群/动态之前） ----------
  const kw = `验收`;
  const global = await A.ok('GET', '/search?q=' + encodeURIComponent(kw), { key: 'GET /search' });
  check(global.users.length >= 1 && global.groups.length >= 1 && global.moments.length >= 1, '全局搜索同时命中用户/群/动态', `u${global.users.length} g${global.groups.length} m${global.moments.length}`);
  const su = await A.ok('GET', '/search/users?q=' + encodeURIComponent(`soc_${stamp}_乙`), { key: 'GET /search/users' });
  check(su.rows.some(x => x.only_id === B.onlyId), '搜用户命中乙');
  const sg = await A.ok('GET', '/search/groups?q=' + encodeURIComponent(`验收群-${stamp}`), { key: 'GET /search/groups' });
  check(sg.rows.some(x => x.group_id === gid), '搜群命中验收群');
  const sm = await A.ok('GET', '/search/moments?q=' + encodeURIComponent(stamp), { key: 'GET /search/moments' });
  check(sm.rows.some(x => x.moment_id === momentId), '搜动态命中验收动态');
  const smsg = await A.ok('GET', '/search/messages?q=' + encodeURIComponent('收到，甲'), { key: 'GET /search/messages' });
  check(smsg.rows.length >= 1, '搜消息命中乙的回复');
  const sh = await A.ok('GET', '/search/history', { key: 'GET /search/history' });
  check(sh.rows.length >= 1 && sh.rows[0].keyword === kw, '搜索历史已记录');
  const hotw = await A.ok('GET', '/search/hot', { auth: 'none', key: 'GET /search/hot' });
  check(hotw.rows.length >= 1 && hotw.rows[0].n >= 1, '搜索热词统计有数据');
  const shClear = await A.ok('DELETE', '/search/history', { key: 'DELETE /search/history' });
  check(shClear.ok === true, '清空搜索历史');
  const shAfter = await A.ok('GET', '/search/history', { key: 'GET /search/history' });
  check(shAfter.rows.length === 0, '清空后搜索历史为空');

  // ---------- 通知 ----------
  const notices = await A.ok('GET', '/notifications', { key: 'GET /notifications' });
  check(notices.rows.length >= 1, '甲有通知', `${notices.rows.length} 条`);
  const noticeId = notices.rows[0].notice_id;
  const nUnread = await A.ok('GET', '/notifications/unread', { key: 'GET /notifications/unread' });
  check(nUnread.unread >= 1, '未读通知数 >= 1', String(nUnread.unread));
  const nRead = await A.ok('PUT', '/notifications/' + noticeId + '/read', { key: 'PUT /notifications/:notice_id/read' });
  check(nRead.ok === true, '单条通知标记已读');
  const nAll = await A.ok('PUT', '/notifications/read-all', { key: 'PUT /notifications/read-all' });
  check(nAll.ok === true, '全部通知标记已读');
  const nDel = await A.ok('DELETE', '/notifications/' + noticeId, { key: 'DELETE /notifications/:notice_id' });
  check(nDel.ok === true, '删除单条通知');

  // ---------- 收藏 ----------
  const fav = await A.ok('POST', '/favorites', { key: 'POST /favorites', body: { target_type: 'moment', target_id: momentId, title: '验收收藏' } });
  check(fav.ok === true, '收藏动态');
  const favs = await A.ok('GET', '/favorites', { key: 'GET /favorites' });
  check(favs.rows.some(x => x.target_id === momentId), '收藏列表包含动态');
  const favCheck = await A.ok('GET', `/favorites/check/moment/${momentId}`, { key: 'GET /favorites/check/:target_type/:target_id' });
  check(favCheck.favorited === true, '检查收藏返回 true');
  const favDel = await A.ok('DELETE', `/favorites/moment/${momentId}`, { key: 'DELETE /favorites/:target_type/:target_id' });
  check(favDel.ok === true, '取消收藏');

  // ---------- 文件与安全 ----------
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('social upload acceptance')], { type: 'text/plain' }), `acceptance-${stamp}.txt`);
  const up = await A.ok('POST', '/files', { key: 'POST /files', form: fd });
  check(!!up.fileId && !!up.url, '上传附件返回 fileId 与 URL');
  const files = await A.ok('GET', '/files', { key: 'GET /files' });
  check(files.rows.some(x => x.file_id === up.fileId), '我的附件包含上传文件');
  const delFile = await A.ok('DELETE', '/files/' + up.fileId, { key: 'DELETE /files/:file_id' });
  check(delFile.ok === true, '删除附件');

  const av = new FormData();
  av.append('file', new Blob([Buffer.from('avatar acceptance')], { type: 'text/plain' }), `avatar-${stamp}.txt`);
  const avatar = await A.ok('POST', '/profile/avatar', { key: 'POST /profile/avatar', form: av });
  check(!!avatar.avatar && !!avatar.fileId, '上传头像并更新用户 avatar');

  const rep = await A.ok('POST', '/reports', { key: 'POST /reports', body: { target_type: 'user', target_id: C.onlyId, reason: 'spam', detail: '验收举报' } });
  check(!!rep.reportId, '提交举报');
  const myRep = await A.ok('GET', '/reports/mine', { key: 'GET /reports/mine' });
  check(myRep.rows.some(x => x.report_id === rep.reportId), '我的举报包含记录');

  const privacy = await A.ok('GET', '/privacy', { key: 'GET /privacy' });
  check(privacy.privacy && Array.isArray(privacy.privacy), '读取隐私设置');
  const privUp = await A.ok('PUT', '/privacy', { key: 'PUT /privacy', body: { allow_search: 0, allow_stranger: 0 } });
  check(privUp.ok === true, '更新隐私设置');
  const privacy2 = await A.ok('GET', '/privacy', { key: 'GET /privacy' });
  check(privacy2.privacy[0].allow_search === 0 && privacy2.privacy[0].allow_stranger === 0, '隐私设置落库生效');

  // ---------- 统计 ----------
  const stats = await A.ok('GET', '/stats', { key: 'GET /stats' });
  check(stats.friends >= 1 && stats.messagesSent >= 1, '我的统计包含好友与消息', JSON.stringify(stats));
  const overview = await A.ok('GET', '/stats/overview', { key: 'GET /stats/overview' });
  check(overview.users >= 5 && overview.groups >= 1, '平台概览包含用户与群', JSON.stringify(overview));
  const trend = await A.ok('GET', '/stats/trend', { key: 'GET /stats/trend' });
  check(Array.isArray(trend.search), '搜索趋势返回数组');

  // ---------- 删除群/动态，验证 owner 权限 ----------
  const delGroup = await B.ok('DELETE', '/groups/' + gid, { key: 'DELETE /groups/:group_id' });
  check(delGroup.ok === true, '新群主乙解散群');
  const delMoment = await A.ok('DELETE', '/moments/' + momentId, { key: 'DELETE /moments/:moment_id' });
  check(delMoment.ok === true, '动态作者删除动态');
  const delFriend = await A.ok('DELETE', '/friends/' + B.onlyId, { key: 'DELETE /friends/:only_id' });
  check(delFriend.ok === true, '删除好友关系');

  // ---------- 退出与停用 ----------
  const logout = await E.ok('POST', '/logout', { key: 'POST /logout', body: { device: 'test-social' } });
  check(logout.ok === true, '戊退出登录');
  check((E.lastSetCookie || []).some(x => /Max-Age=0/i.test(x)), '退出登录 Set-Cookie 清除 cookie');
  const clearCookie = await E.req('GET', '/me', { auth: 'none', key: 'GET /me', expect: 401 });
  check(clearCookie.status === 401, '退出后 cookie 已清除，受保护路由 401');
  const delAcc = await D.ok('POST', '/deactivate', { key: 'POST /deactivate' });
  check(delAcc.ok === true, '丁停用账号');
  const loginD = await anon.req('POST', '/login', { auth: 'none', key: 'POST /login', body: { username: `soc_${stamp}_丁`, password: 'pass1234' }, expect: 403 });
  check(loginD.body && loginD.body.ok === false && loginD.body.error === 'ACCOUNT_DISABLED', '停用账号无法登录', loginD.body && loginD.body.error);

  // ---------- 路由覆盖 ----------
  const missing = [...expected].filter(k => !covered.has(k));
  const extra = [...covered].filter(k => !expected.has(k));
  if (missing.length || extra.length) {
    fail('86 条路由全部覆盖', new Error('覆盖不全'), `missing=${missing.join(', ')} extra=${extra.join(', ')}`);
  } else {
    pass('86 条路由全部覆盖', `${covered.size}/${expected.size}`);
  }

  console.log(`\n结果：${checks - failures.length}/${checks} 通过，路由覆盖 ${covered.size}/${expected.size}`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`- ${f.name}${f.info ? ' · ' + f.info : ''}\n  ${f.err.split('\n')[0]}`);
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error('\n验收中断：', e && e.stack || e);
  process.exitCode = 1;
});
