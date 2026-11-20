'use strict';

// 生成「社交接口库」预置工程：账户、好友、私聊、群聊、动态、搜索、通知、收藏、文件、举报、统计。
// 设计约束：用户身份一律取 token 里的 user.onlyId；浏览器登录态靠 HttpOnly cookie；所有表默认无主键。
// 用法：runtime\node\node.exe tools/make-social-case.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const spec = require('../app/iface/spec');

const OUT = path.join(__dirname, '..', 'app', 'iface', 'cases', 'social.json');
const id = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

const f = (name, type = 'varchar', o = {}) => ({
  name, type, comment: o.comment || '', pk: !!o.pk, autoIncrement: !!o.autoIncrement,
  nullable: o.nullable !== false, search: o.search, hidden: !!o.hidden,
  query: o.query, writable: o.writable, default: o.default || '',
});
const oid = (comment = '用户 onlyId') => f('only_id', 'char', { comment, search: true, hidden: true });
const created = (name = 'created_at') => f(name, 'datetime', { comment: '创建时间', writable: false, default: 'CURRENT_TIMESTAMP' });
const updated = (name = 'updated_at') => f(name, 'datetime', { comment: '更新时间', writable: false, default: 'CURRENT_TIMESTAMP' });
const table = (key, name, comment, fields) => ({ key, name, schema: '', conn: 'main', comment, fields });

// 全部表都不设主键：用 only_id / 业务 UUID 做身份与关联，不依赖自增 id。
const T = {
  user: table('user', 'sc_user', '社交用户', [
    oid('唯一用户标识'), f('username', 'varchar', { comment: '登录名', search: true }),
    f('password_hash', 'varchar', { comment: 'SM4 密码', hidden: true, search: true }),
    f('nickname', 'varchar', { comment: '昵称', search: true }), f('avatar', 'text', { comment: '头像 URL' }),
    f('bio', 'text', { comment: '简介', search: true }), f('gender', 'tinyint', { comment: '性别 0/1/2', default: '0' }),
    f('region', 'varchar', { comment: '地区', search: true }), f('status', 'tinyint', { comment: '1 正常 0 停用', default: '1' }),
    f('allow_search', 'tinyint', { comment: '允许被搜索', default: '1' }),
    f('allow_stranger', 'tinyint', { comment: '允许陌生人私聊', default: '1' }),
    f('last_seen_at', 'datetime', { comment: '最后在线' }), created(), updated(),
  ]),
  login: table('login', 'sc_login_log', '登录记录', [
    oid('登录用户'), f('ip', 'varchar', { comment: 'IP' }), f('device', 'varchar', { comment: '设备/UA' }),
    f('result', 'varchar', { comment: 'login/logout/register' }), created(),
  ]),
  friend: table('friend', 'sc_friend', '好友关系', [
    f('owner_only_id', 'char', { comment: '归属用户', search: true }), f('friend_only_id', 'char', { comment: '好友 onlyId', search: true }),
    f('alias', 'varchar', { comment: '备注' }), f('source', 'varchar', { comment: '来源' }), created(),
  ]),
  friendReq: table('friendReq', 'sc_friend_request', '好友申请', [
    f('req_id', 'char', { comment: '申请 UUID', search: true }), f('from_only_id', 'char', { comment: '申请人', search: true }),
    f('to_only_id', 'char', { comment: '被申请人', search: true }), f('message', 'varchar', { comment: '附言', search: true }),
    f('status', 'tinyint', { comment: '0 待处理 1 通过 2 拒绝', default: '0' }),
    f('handled_at', 'datetime', { comment: '处理时间' }), created(),
  ]),
  block: table('block', 'sc_block', '黑名单', [
    oid('拉黑发起人'), f('blocked_only_id', 'char', { comment: '被拉黑用户', search: true }),
    f('reason', 'varchar', { comment: '原因' }), created(),
  ]),
  conv: table('conv', 'sc_conversation', '私聊会话', [
    f('conv_id', 'char', { comment: '会话 UUID', search: true }), f('owner_only_id', 'char', { comment: '发起人' }),
    f('peer_only_id', 'char', { comment: '对方' }), f('last_message', 'text', { comment: '最后一条', search: true }),
    f('last_at', 'datetime', { comment: '最后消息时间', default: 'CURRENT_TIMESTAMP' }), created(),
  ]),
  msg: table('msg', 'sc_message', '消息（私聊/群聊）', [
    f('msg_id', 'char', { comment: '消息 UUID', search: true }), f('conv_id', 'char', { comment: '私聊会话 UUID' }),
    f('group_id', 'char', { comment: '群聊 UUID' }), f('from_only_id', 'char', { comment: '发送人', search: true }),
    f('to_only_id', 'char', { comment: '接收人' }), f('body', 'text', { comment: '消息正文', search: true }),
    f('msg_type', 'varchar', { comment: 'text/image/file/voice', default: 'text' }), f('media_url', 'varchar', { comment: '媒体 URL' }),
    f('reply_to', 'char', { comment: '引用消息 UUID' }), f('status', 'tinyint', { comment: '1 正常 2 撤回', default: '1' }),
    f('read_flag', 'tinyint', { comment: '0 未读 1 已读', default: '0' }), created(),
  ]),
  group: table('group', 'sc_group', '群聊', [
    f('group_id', 'char', { comment: '群 UUID', search: true }), f('owner_only_id', 'char', { comment: '群主' }),
    f('name', 'varchar', { comment: '群名', search: true }), f('intro', 'text', { comment: '群简介', search: true }),
    f('avatar', 'varchar', { comment: '群头像' }), f('member_count', 'int', { comment: '成员数', default: '1' }),
    f('max_members', 'int', { comment: '上限', default: '500' }), f('join_mode', 'tinyint', { comment: '1 自由 2 审批 3 邀请', default: '1' }),
    f('status', 'tinyint', { comment: '1 正常 0 解散', default: '1' }), created(), updated(),
  ]),
  groupMember: table('groupMember', 'sc_group_member', '群成员', [
    f('group_id', 'char', { comment: '群 UUID' }), oid('成员 onlyId'), f('role', 'varchar', { comment: 'owner/admin/member', default: 'member' }),
    f('mute', 'tinyint', { comment: '1 禁言', default: '0' }), f('joined_at', 'datetime', { default: 'CURRENT_TIMESTAMP' }),
    f('last_read_at', 'datetime', { comment: '最后阅读' }), created(),
  ]),
  announce: table('announce', 'sc_group_announce', '群公告', [
    f('announce_id', 'char', { comment: '公告 UUID' }), f('group_id', 'char'), oid('发布人'),
    f('content', 'text', { comment: '公告内容', search: true }), created(),
  ]),
  moment: table('moment', 'sc_moment', '动态', [
    f('moment_id', 'char', { comment: '动态 UUID', search: true }), oid('作者'),
    f('content', 'text', { comment: '正文', search: true }), f('images', 'text', { comment: '图片 URL，逗号分隔' }),
    f('visibility', 'tinyint', { comment: '1 公开 2 好友 3 私密', default: '1' }),
    f('like_count', 'int', { comment: '点赞数', default: '0' }), f('comment_count', 'int', { comment: '评论数', default: '0' }), created(),
  ]),
  momentLike: table('momentLike', 'sc_moment_like', '动态点赞', [
    f('moment_id', 'char'), oid('点赞人'), created(),
  ]),
  momentComment: table('momentComment', 'sc_moment_comment', '动态评论', [
    f('comment_id', 'char', { comment: '评论 UUID' }), f('moment_id', 'char'), oid('评论人'),
    f('reply_to', 'char', { comment: '回复评论 UUID' }), f('content', 'text', { comment: '评论内容', search: true }), created(),
  ]),
  notice: table('notice', 'sc_notification', '通知', [
    f('notice_id', 'char', { comment: '通知 UUID' }), oid('接收人'), f('type', 'varchar', { comment: 'friend/message/group/like/comment/system' }),
    f('title', 'varchar', { comment: '标题', search: true }), f('body', 'text', { comment: '内容', search: true }),
    f('ref_type', 'varchar', { comment: '关联类型' }), f('ref_id', 'char', { comment: '关联 UUID' }),
    f('read_flag', 'tinyint', { comment: '0 未读', default: '0' }), created(),
  ]),
  favorite: table('favorite', 'sc_favorite', '收藏', [
    oid('收藏人'), f('target_type', 'varchar', { comment: 'moment/message/group/user' }),
    f('target_id', 'char', { comment: '目标 UUID' }), f('title', 'varchar', { comment: '标题', search: true }), created(),
  ]),
  file: table('file', 'sc_attachment', '附件', [
    f('file_id', 'char', { comment: '附件 UUID' }), oid('上传人'), f('filename', 'varchar', { comment: '文件名', search: true }),
    f('content_type', 'varchar', { comment: 'MIME' }), f('size', 'bigint', { comment: '字节数' }),
    f('object_key', 'varchar', { comment: '对象键' }), f('object_url', 'text', { comment: '访问 URL' }),
    f('scene', 'varchar', { comment: '场景 avatar/chat/moment' }), created(),
  ]),
  report: table('report', 'sc_report', '举报', [
    f('report_id', 'char', { comment: '举报 UUID' }), oid('举报人'), f('target_type', 'varchar', { comment: 'user/group/moment/message' }),
    f('target_id', 'char', { comment: '目标 UUID' }), f('reason', 'varchar', { comment: '原因', search: true }),
    f('detail', 'text', { comment: '补充说明', search: true }), f('status', 'tinyint', { comment: '0 待处理 1 已处理', default: '0' }), created(),
  ]),
  search: table('search', 'sc_search_log', '搜索记录', [
    oid('搜索人'), f('keyword', 'varchar', { comment: '关键词', search: true }), f('scene', 'varchar', { comment: '搜索场景' }), created(),
  ]),
};

const route = (key, name, method, p, script, o = {}) => ({
  id: id(name + method + p), key, name, method, path: p, auth: !!o.auth, summary: o.summary || name,
  guard: {
    tx: o.tx != null ? o.tx : ['POST', 'PUT', 'DELETE'].includes(method),
    rate: { enabled: !!o.rate, limit: 120, window: 60 },
    schedule: { enabled: false, from: '', to: '' },
    breaker: { enabled: false, threshold: 5, cooldown: 30 },
  },
  script, cache: { enabled: false, key: '', ttl: 60 },
  docs: { summary: o.summary || name, description: o.desc || '', requestExample: o.req || '', responseExample: o.res || '' },
});

const iface = (name, cat, tables, routes, docs = {}) => ({
  id: id(name), name, comment: docs.comment || name, categoryId: cat, basePath: '/social',
  tables, routes,
  storage: { enabled: true, bucket: 'clickbuild', bindField: 'object_key' }, page: { size: 20 },
  docs: {
    summary: docs.summary || name, description: docs.desc || '', owner: 'ClickBuild 接口库',
    version: '2.0.0', tags: docs.tags || ['社交', 'IM'],
  },
});
const pick = (...keys) => keys.map((k) => T[k]);

/* ---------------- 账户与身份 ---------------- */
const account = iface('账户身份', 'account', pick('user', 'login'), [
  route('custom', '注册', 'POST', '/register', `LET $u = QUERY SELECT only_id FROM {{t:user}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($u.rows) > 0
  RETURN 409 { "ok": false, "error": "USERNAME_TAKEN", "message": "用户名已被占用" };
END
LET $oid = {{uuid}};
EXEC INSERT INTO {{t:user}} (only_id, username, password_hash, nickname, avatar, bio, region) VALUES ({{vars.oid}}, {{body.username}}, SM4_ENC({{body.password}}, 'clickbuild-key'), {{body.nickname}}, '', '', '');
EXEC INSERT INTO {{t:login}} (only_id, ip, device, result) VALUES ({{vars.oid}}, {{remoteIp}}, {{body.device}}, 'register');
LET $t = TOKEN NEW { "onlyId": {{vars.oid}}, "username": {{body.username}} };
RETURN 201 { "ok": true, "onlyId": {{vars.oid}}, "token": $t.token, "loginBy": "cookie" };`, {
    summary: '注册并直接登录，签发 token 并自动种 HttpOnly cookie',
    req: '{"username":"alice","password":"123456","nickname":"Alice","device":"Chrome"}',
    res: '{"ok":true,"onlyId":"...","token":"...","loginBy":"cookie"}',
  }),
  route('custom', '登录', 'POST', '/login', `LET $u = QUERY SELECT only_id, password_hash, nickname, status FROM {{t:user}} WHERE username = {{body.username}} LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 401 { "ok": false, "error": "BAD_CREDENTIALS", "message": "用户名或密码错误" };
END
IF $u.rows[0].status != 1
  RETURN 403 { "ok": false, "error": "ACCOUNT_DISABLED" };
END
IF SM4_DEC($u.rows[0].password_hash, 'clickbuild-key') != {{body.password}}
  EXEC INSERT INTO {{t:login}} (only_id, ip, device, result) VALUES ($u.rows[0].only_id, {{remoteIp}}, {{body.device}}, 'failed');
  RETURN 401 { "ok": false, "error": "BAD_CREDENTIALS", "message": "用户名或密码错误" };
END
EXEC UPDATE {{t:user}} SET last_seen_at = NOW() WHERE only_id = $u.rows[0].only_id;
EXEC INSERT INTO {{t:login}} (only_id, ip, device, result) VALUES ($u.rows[0].only_id, {{remoteIp}}, {{body.device}}, 'login');
LET $t = TOKEN NEW { "onlyId": $u.rows[0].only_id, "username": {{body.username}} };
RETURN 200 { "ok": true, "onlyId": $u.rows[0].only_id, "nickname": $u.rows[0].nickname, "token": $t.token, "loginBy": "cookie" };`, {
    summary: '账号密码登录，响应种 cookie；之后只靠 cookie 访问受保护接口',
    req: '{"username":"alice","password":"123456","device":"Chrome"}',
  }),
  route('custom', '当前用户', 'GET', '/me', `LET $u = QUERY SELECT only_id, username, nickname, avatar, bio, gender, region, status, allow_search, allow_stranger, last_seen_at, created_at FROM {{t:user}} WHERE only_id = {{user.onlyId}} LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_USER" };
END
RETURN 200 { "ok": true, "user": $u.rows, "identityFrom": "onlyId", "auth": "cookie-or-bearer" };`, { auth: true, summary: '从 cookie/token 里的 onlyId 取当前用户' }),
  route('custom', '更新资料', 'PUT', '/me', `EXEC UPDATE {{t:user}} SET nickname = IFNULL({{body.nickname}}, nickname), avatar = IFNULL({{body.avatar}}, avatar), bio = IFNULL({{body.bio}}, bio), gender = IFNULL({{body.gender}}, gender), region = IFNULL({{body.region}}, region), updated_at = NOW() WHERE only_id = {{user.onlyId}};
RETURN 200 { "ok": true, "onlyId": {{user.onlyId}} };`, { auth: true, summary: '更新昵称、头像、简介、性别、地区' }),
  route('custom', '退出登录', 'POST', '/logout', `TOKEN DEL {{token}};
EXEC INSERT INTO {{t:login}} (only_id, ip, device, result) VALUES ({{user.onlyId}}, {{remoteIp}}, {{body.device}}, 'logout');
RETURN 200 { "ok": true, "message": "已退出，cookie 已清除" };`, { auth: true, summary: '删除 token 并清除 cookie' }),
  route('custom', '修改密码', 'PUT', '/password', `LET $u = QUERY SELECT password_hash FROM {{t:user}} WHERE only_id = {{user.onlyId}} LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_USER" };
END
IF SM4_DEC($u.rows[0].password_hash, 'clickbuild-key') != {{body.old_password}}
  RETURN 401 { "ok": false, "error": "BAD_OLD_PASSWORD" };
END
EXEC UPDATE {{t:user}} SET password_hash = SM4_ENC({{body.new_password}}, 'clickbuild-key'), updated_at = NOW() WHERE only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '校验旧密码后更新' }),
  route('custom', '登录记录', 'GET', '/login-logs', `LET $rows = QUERY SELECT ip, device, result, created_at FROM {{t:login}} WHERE only_id = {{user.onlyId}} ORDER BY created_at DESC LIMIT 20;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '最近 20 条登录/退出记录' }),
  route('custom', '停用账号', 'POST', '/deactivate', `EXEC UPDATE {{t:user}} SET status = 0, updated_at = NOW() WHERE only_id = {{user.onlyId}};
TOKEN DEL {{token}};
RETURN 200 { "ok": true, "message": "账号已停用" };`, { auth: true, summary: '软停用并清 cookie' }),
  route('custom', '检查用户名', 'GET', '/check-username', `LET $u = QUERY SELECT only_id FROM {{t:user}} WHERE username = {{query.username}} LIMIT 1;
RETURN 200 { "available": LEN($u.rows) == 0 };`, { auth: false, tx: false, summary: '注册前查重' }),
  route('custom', '会话状态', 'GET', '/session', `LET $u = QUERY SELECT only_id, nickname, avatar, status FROM {{t:user}} WHERE only_id = {{user.onlyId}} LIMIT 1;
RETURN 200 { "ok": true, "user": $u.rows, "tokenPresent": LEN({{token}}) > 0, "cookieName": "icb_token" };`, { auth: true, tx: false, summary: '只验证 cookie 登录态，不返回密码' }),
], { summary: '账户、登录、cookie 会话', desc: 'onlyId 是唯一用户身份；登录脚本签发 token 后服务自动写 HttpOnly cookie，后续接口只认 cookie/token 里的 onlyId。' });

/* ---------------- 好友关系 ---------------- */
const friends = iface('好友关系', 'friend', pick('user', 'friend', 'friendReq', 'block', 'notice'), [
  route('custom', '好友列表', 'GET', '/friends', `LET $rows = QUERY SELECT f.friend_only_id AS only_id, f.alias, f.source, f.created_at, u.nickname, u.avatar, u.bio, u.region, u.last_seen_at FROM {{t:friend}} f LEFT JOIN {{t:user}} u ON u.only_id = f.friend_only_id WHERE f.owner_only_id = {{user.onlyId}} ORDER BY f.created_at DESC;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '我的好友及资料' }),
  route('custom', '搜索用户', 'GET', '/friends/search', `LET $kw = {{query.q}};
IF LEN($kw) == 0
  RETURN 200 { "rows": [] };
END
LET $rows = QUERY SELECT only_id, username, nickname, avatar, bio, region, last_seen_at FROM {{t:user}} WHERE status = 1 AND allow_search = 1 AND (username LIKE CONCAT('%', $kw, '%') OR nickname LIKE CONCAT('%', $kw, '%') OR bio LIKE CONCAT('%', $kw, '%')) LIMIT 30;
RETURN 200 { "keyword": $kw, "rows": $rows.rows };`, { auth: true, tx: false, summary: '按用户名/昵称/简介搜索可公开用户' }),
  route('custom', '发送好友申请', 'POST', '/friends/requests', `IF {{body.to_only_id}} == {{user.onlyId}}
  RETURN 400 { "ok": false, "error": "SELF" };
END
LET $u = QUERY SELECT only_id, allow_stranger, status FROM {{t:user}} WHERE only_id = {{body.to_only_id}} LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_USER" };
END
IF $u.rows[0].status != 1
  RETURN 403 { "ok": false, "error": "TARGET_DISABLED" };
END
LET $b = QUERY SELECT only_id FROM {{t:block}} WHERE only_id = {{body.to_only_id}} AND blocked_only_id = {{user.onlyId}} LIMIT 1;
IF LEN($b.rows) > 0
  RETURN 403 { "ok": false, "error": "BLOCKED_BY_TARGET" };
END
LET $f = QUERY SELECT friend_only_id FROM {{t:friend}} WHERE owner_only_id = {{user.onlyId}} AND friend_only_id = {{body.to_only_id}} LIMIT 1;
IF LEN($f.rows) > 0
  RETURN 409 { "ok": false, "error": "ALREADY_FRIENDS" };
END
LET $p = QUERY SELECT req_id FROM {{t:friendReq}} WHERE from_only_id = {{user.onlyId}} AND to_only_id = {{body.to_only_id}} AND status = 0 LIMIT 1;
IF LEN($p.rows) > 0
  RETURN 409 { "ok": false, "error": "REQUEST_PENDING" };
END
LET $rid = {{uuid}};
EXEC INSERT INTO {{t:friendReq}} (req_id, from_only_id, to_only_id, message) VALUES ({{vars.rid}}, {{user.onlyId}}, {{body.to_only_id}}, {{body.message}});
LET $nid = {{uuid}};
EXEC INSERT INTO {{t:notice}} (notice_id, only_id, type, title, body, ref_type, ref_id) VALUES ({{vars.nid}}, {{body.to_only_id}}, 'friend', '好友申请', {{body.message}}, 'friend_request', {{vars.rid}});
RETURN 201 { "ok": true, "reqId": {{vars.rid}} };`, { auth: true, summary: '校验拉黑、已是好友、重复申请后发申请' }),
  route('custom', '好友申请列表', 'GET', '/friends/requests', `LET $in = QUERY SELECT r.req_id, r.from_only_id, r.message, r.status, r.created_at, u.nickname, u.avatar FROM {{t:friendReq}} r LEFT JOIN {{t:user}} u ON u.only_id = r.from_only_id WHERE r.to_only_id = {{user.onlyId}} ORDER BY r.created_at DESC;
LET $out = QUERY SELECT r.req_id, r.to_only_id, r.message, r.status, r.created_at, u.nickname, u.avatar FROM {{t:friendReq}} r LEFT JOIN {{t:user}} u ON u.only_id = r.to_only_id WHERE r.from_only_id = {{user.onlyId}} ORDER BY r.created_at DESC;
RETURN 200 { "incoming": $in.rows, "outgoing": $out.rows };`, { auth: true, tx: false, summary: '收到的和发出的申请' }),
  route('custom', '处理好友申请', 'PUT', '/friends/requests/:req_id', `LET $r = QUERY SELECT req_id, from_only_id, to_only_id, status FROM {{t:friendReq}} WHERE req_id = {{path.req_id}} AND to_only_id = {{user.onlyId}} LIMIT 1;
IF LEN($r.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_REQUEST" };
END
IF $r.rows[0].status != 0
  RETURN 409 { "ok": false, "error": "ALREADY_HANDLED" };
END
LET $action = {{body.action}};
IF $action == 'accept'
  EXEC UPDATE {{t:friendReq}} SET status = 1, handled_at = NOW() WHERE req_id = {{path.req_id}};
  EXEC DELETE FROM {{t:friend}} WHERE (owner_only_id = {{user.onlyId}} AND friend_only_id = $r.rows[0].from_only_id) OR (owner_only_id = $r.rows[0].from_only_id AND friend_only_id = {{user.onlyId}});
  EXEC INSERT INTO {{t:friend}} (owner_only_id, friend_only_id, alias, source) VALUES ({{user.onlyId}}, $r.rows[0].from_only_id, '', 'request');
  EXEC INSERT INTO {{t:friend}} (owner_only_id, friend_only_id, alias, source) VALUES ($r.rows[0].from_only_id, {{user.onlyId}}, '', 'request');
  LET $nid = {{uuid}};
  EXEC INSERT INTO {{t:notice}} (notice_id, only_id, type, title, body, ref_type, ref_id) VALUES ({{vars.nid}}, $r.rows[0].from_only_id, 'friend', '好友申请已通过', '', 'friend', {{user.onlyId}});
  RETURN 200 { "ok": true, "status": "accepted" };
END
IF $action == 'reject'
  EXEC UPDATE {{t:friendReq}} SET status = 2, handled_at = NOW() WHERE req_id = {{path.req_id}};
  RETURN 200 { "ok": true, "status": "rejected" };
END
RETURN 400 { "ok": false, "error": "BAD_ACTION", "message": "action 只能是 accept/reject" };`, { auth: true, summary: '通过则双向建好友关系并通知' }),
  route('custom', '删除好友', 'DELETE', '/friends/:only_id', `EXEC DELETE FROM {{t:friend}} WHERE (owner_only_id = {{user.onlyId}} AND friend_only_id = {{path.only_id}}) OR (owner_only_id = {{path.only_id}} AND friend_only_id = {{user.onlyId}});
RETURN 200 { "ok": true };`, { auth: true, summary: '双向删除好友' }),
  route('custom', '好友状态', 'GET', '/friends/status/:only_id', `LET $f = QUERY SELECT owner_only_id FROM {{t:friend}} WHERE owner_only_id = {{user.onlyId}} AND friend_only_id = {{path.only_id}} LIMIT 1;
LET $b = QUERY SELECT only_id FROM {{t:block}} WHERE only_id = {{user.onlyId}} AND blocked_only_id = {{path.only_id}} LIMIT 1;
LET $p = QUERY SELECT req_id, status FROM {{t:friendReq}} WHERE from_only_id = {{user.onlyId}} AND to_only_id = {{path.only_id}} ORDER BY created_at DESC LIMIT 1;
RETURN 200 { "friend": LEN($f.rows) > 0, "blocked": LEN($b.rows) > 0, "request": $p.rows };`, { auth: true, tx: false, summary: '是否好友/拉黑/最近申请' }),
  route('custom', '拉黑', 'POST', '/blocks', `IF {{body.blocked_only_id}} == {{user.onlyId}}
  RETURN 400 { "ok": false, "error": "SELF" };
END
LET $b = QUERY SELECT only_id FROM {{t:block}} WHERE only_id = {{user.onlyId}} AND blocked_only_id = {{body.blocked_only_id}} LIMIT 1;
IF LEN($b.rows) == 0
  EXEC INSERT INTO {{t:block}} (only_id, blocked_only_id, reason) VALUES ({{user.onlyId}}, {{body.blocked_only_id}}, {{body.reason}});
END
EXEC DELETE FROM {{t:friend}} WHERE (owner_only_id = {{user.onlyId}} AND friend_only_id = {{body.blocked_only_id}}) OR (owner_only_id = {{body.blocked_only_id}} AND friend_only_id = {{user.onlyId}});
RETURN 200 { "ok": true };`, { auth: true, summary: '拉黑并同时解除好友' }),
  route('custom', '黑名单', 'GET', '/blocks', `LET $rows = QUERY SELECT b.blocked_only_id AS only_id, b.reason, b.created_at, u.nickname, u.avatar FROM {{t:block}} b LEFT JOIN {{t:user}} u ON u.only_id = b.blocked_only_id WHERE b.only_id = {{user.onlyId}} ORDER BY b.created_at DESC;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '我的黑名单' }),
  route('custom', '解除拉黑', 'DELETE', '/blocks/:only_id', `EXEC DELETE FROM {{t:block}} WHERE only_id = {{user.onlyId}} AND blocked_only_id = {{path.only_id}};
RETURN 200 { "ok": true };`, { auth: true, summary: '从黑名单移除' }),
  route('custom', '好友推荐', 'GET', '/friends/suggest', `LET $rows = QUERY SELECT only_id, nickname, avatar, region, last_seen_at FROM {{t:user}} WHERE status = 1 AND allow_search = 1 AND only_id != {{user.onlyId}} AND only_id NOT IN (SELECT friend_only_id FROM {{t:friend}} WHERE owner_only_id = {{user.onlyId}}) ORDER BY last_seen_at DESC LIMIT 10;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '排除已有好友的推荐' }),
], { summary: '好友、申请、黑名单', desc: '所有写操作都用当前 token 的 user.onlyId，不接受请求体伪造身份。' });

/* ---------------- 私聊 ---------------- */
const chatIface = iface('私聊消息', 'im', pick('user', 'friend', 'conv', 'msg', 'block', 'notice', 'groupMember'), [
  route('custom', '会话列表', 'GET', '/conversations', `LET $rows = QUERY SELECT c.conv_id, c.last_message, c.last_at, c.created_at, CASE WHEN c.owner_only_id = {{user.onlyId}} THEN c.peer_only_id ELSE c.owner_only_id END AS peer_only_id, u.nickname AS peer_name, u.avatar AS peer_avatar FROM {{t:conv}} c LEFT JOIN {{t:user}} u ON u.only_id = CASE WHEN c.owner_only_id = {{user.onlyId}} THEN c.peer_only_id ELSE c.owner_only_id END WHERE c.owner_only_id = {{user.onlyId}} OR c.peer_only_id = {{user.onlyId}} ORDER BY c.last_at DESC;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '按最后消息时间排序' }),
  route('custom', '会话详情', 'GET', '/conversations/:conv_id', `LET $c = QUERY SELECT conv_id, owner_only_id, peer_only_id, last_message, last_at FROM {{t:conv}} WHERE conv_id = {{path.conv_id}} AND (owner_only_id = {{user.onlyId}} OR peer_only_id = {{user.onlyId}}) LIMIT 1;
IF LEN($c.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_CONVERSATION" };
END
RETURN 200 { "conversation": $c.rows };`, { auth: true, tx: false, summary: '只允许会话双方查看' }),
  route('custom', '发送私聊', 'POST', '/messages', `IF {{body.to}} == {{user.onlyId}}
  RETURN 400 { "ok": false, "error": "SELF" };
END
LET $u = QUERY SELECT only_id, allow_stranger, status FROM {{t:user}} WHERE only_id = {{body.to}} LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_USER" };
END
LET $b = QUERY SELECT only_id FROM {{t:block}} WHERE (only_id = {{body.to}} AND blocked_only_id = {{user.onlyId}}) OR (only_id = {{user.onlyId}} AND blocked_only_id = {{body.to}}) LIMIT 1;
IF LEN($b.rows) > 0
  RETURN 403 { "ok": false, "error": "BLOCKED" };
END
LET $f = QUERY SELECT friend_only_id FROM {{t:friend}} WHERE owner_only_id = {{user.onlyId}} AND friend_only_id = {{body.to}} LIMIT 1;
IF LEN($f.rows) == 0
  IF $u.rows[0].allow_stranger != 1
    RETURN 403 { "ok": false, "error": "STRANGER_NOT_ALLOWED" };
  END
END
LET $cid = '';
LET $c = QUERY SELECT conv_id FROM {{t:conv}} WHERE (owner_only_id = {{user.onlyId}} AND peer_only_id = {{body.to}}) OR (owner_only_id = {{body.to}} AND peer_only_id = {{user.onlyId}}) LIMIT 1;
IF LEN($c.rows) > 0
  SET $cid = $c.rows[0].conv_id;
ELSE
  LET $newCid = {{uuid}};
  EXEC INSERT INTO {{t:conv}} (conv_id, owner_only_id, peer_only_id, last_message) VALUES ({{vars.newCid}}, {{user.onlyId}}, {{body.to}}, {{body.body}});
  SET $cid = $newCid;
END
LET $mid = {{uuid}};
EXEC INSERT INTO {{t:msg}} (msg_id, conv_id, from_only_id, to_only_id, body, msg_type, media_url, reply_to) VALUES ({{vars.mid}}, {{vars.cid}}, {{user.onlyId}}, {{body.to}}, {{body.body}}, {{body.msg_type}}, {{body.media_url}}, {{body.reply_to}});
EXEC UPDATE {{t:conv}} SET last_message = {{body.body}}, last_at = NOW() WHERE conv_id = {{vars.cid}};
LET $nid = {{uuid}};
EXEC INSERT INTO {{t:notice}} (notice_id, only_id, type, title, body, ref_type, ref_id) VALUES ({{vars.nid}}, {{body.to}}, 'message', '新私聊消息', {{body.body}}, 'message', {{vars.mid}});
PUBLISH 'social:private' { "msgId": {{vars.mid}}, "from": {{user.onlyId}}, "to": {{body.to}} };
RETURN 201 { "ok": true, "convId": {{vars.cid}}, "msgId": {{vars.mid}} };`, {
    auth: true, summary: '自动建会话、写消息、通知、Redis 发布',
    req: '{"to":"对方onlyId","body":"你好","msg_type":"text"}',
  }),
  route('custom', '消息历史', 'GET', '/messages/:conv_id', `LET $c = QUERY SELECT conv_id FROM {{t:conv}} WHERE conv_id = {{path.conv_id}} AND (owner_only_id = {{user.onlyId}} OR peer_only_id = {{user.onlyId}}) LIMIT 1;
IF LEN($c.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_CONVERSATION" };
END
LET $rows = QUERY SELECT m.msg_id, m.from_only_id, m.to_only_id, m.body, m.msg_type, m.media_url, m.reply_to, m.status, m.read_flag, m.created_at, u.nickname AS from_name FROM {{t:msg}} m LEFT JOIN {{t:user}} u ON u.only_id = m.from_only_id WHERE m.conv_id = {{path.conv_id}} ORDER BY m.created_at DESC LIMIT 50;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '最近 50 条，按时间倒序' }),
  route('custom', '标记单条已读', 'PUT', '/messages/:msg_id/read', `EXEC UPDATE {{t:msg}} SET read_flag = 1 WHERE msg_id = {{path.msg_id}} AND to_only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '只允许收件人标记' }),
  route('custom', '标记会话已读', 'PUT', '/conversations/:conv_id/read', `EXEC UPDATE {{t:msg}} SET read_flag = 1 WHERE conv_id = {{path.conv_id}} AND to_only_id = {{user.onlyId}} AND read_flag = 0;
RETURN 200 { "ok": true };`, { auth: true, summary: '把该会话未读全部置为已读' }),
  route('custom', '撤回消息', 'PUT', '/messages/:msg_id/recall', `EXEC UPDATE {{t:msg}} SET status = 2 WHERE msg_id = {{path.msg_id}} AND from_only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '仅发送人可撤回' }),
  route('custom', '删除消息', 'DELETE', '/messages/:msg_id', `EXEC DELETE FROM {{t:msg}} WHERE msg_id = {{path.msg_id}} AND from_only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '仅发送人可删除' }),
  route('custom', '未读数', 'GET', '/unread', `LET $p = QUERY SELECT COUNT(*) AS n FROM {{t:msg}} WHERE to_only_id = {{user.onlyId}} AND read_flag = 0;
LET $g = QUERY SELECT COUNT(*) AS n FROM {{t:msg}} m JOIN {{t:groupMember}} gm ON gm.group_id = m.group_id AND gm.only_id = {{user.onlyId}} WHERE m.group_id != '' AND m.from_only_id != {{user.onlyId}} AND (gm.last_read_at IS NULL OR m.created_at > gm.last_read_at);
LET $np = $p.rows[0].n;
LET $ng = $g.rows[0].n;
RETURN 200 { "private": $np, "group": $ng, "total": $np + $ng };`, { auth: true, tx: false, summary: '私聊 + 群聊未读' }),
  route('custom', '正在输入', 'POST', '/typing', `PUBLISH 'social:typing' { "from": {{user.onlyId}}, "to": {{body.to}} };
RETURN 200 { "ok": true };`, { auth: true, tx: false, summary: '仅广播 Redis 事件，不落库' }),
], { summary: '私聊会话与消息', desc: '消息用 UUID，不依赖自增主键；身份和权限都从 onlyId 推导。' });

/* ---------------- 群聊 ---------------- */
const groups = iface('群聊', 'group', pick('user', 'group', 'groupMember', 'announce', 'msg', 'notice'), [
  route('custom', '创建群', 'POST', '/groups', `LET $gid = {{uuid}};
EXEC INSERT INTO {{t:group}} (group_id, owner_only_id, name, intro, avatar, member_count, max_members, join_mode) VALUES ({{vars.gid}}, {{user.onlyId}}, {{body.name}}, {{body.intro}}, {{body.avatar}}, 1, 500, {{body.join_mode}});
EXEC INSERT INTO {{t:groupMember}} (group_id, only_id, role) VALUES ({{vars.gid}}, {{user.onlyId}}, 'owner');
RETURN 201 { "ok": true, "groupId": {{vars.gid}} };`, { auth: true, summary: '创建群并把自己设为群主' }),
  route('custom', '我的群', 'GET', '/groups', `LET $rows = QUERY SELECT g.group_id, g.name, g.intro, g.avatar, g.member_count, g.join_mode, g.updated_at, gm.role, gm.mute FROM {{t:group}} g JOIN {{t:groupMember}} gm ON gm.group_id = g.group_id WHERE gm.only_id = {{user.onlyId}} AND g.status = 1 ORDER BY g.updated_at DESC;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '我加入的群和我的角色' }),
  route('custom', '搜索群', 'GET', '/groups/search', `LET $kw = {{query.q}};
IF LEN($kw) == 0
  RETURN 200 { "rows": [] };
END
LET $rows = QUERY SELECT group_id, name, intro, avatar, member_count, join_mode, owner_only_id FROM {{t:group}} WHERE status = 1 AND (name LIKE CONCAT('%', $kw, '%') OR intro LIKE CONCAT('%', $kw, '%')) LIMIT 30;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '按群名/简介搜索' }),
  route('custom', '群详情', 'GET', '/groups/:group_id', `LET $g = QUERY SELECT group_id, owner_only_id, name, intro, avatar, member_count, max_members, join_mode, status, created_at FROM {{t:group}} WHERE group_id = {{path.group_id}} LIMIT 1;
IF LEN($g.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_GROUP" };
END
LET $m = QUERY SELECT role, mute, joined_at FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
RETURN 200 { "group": $g.rows, "me": $m.rows };`, { auth: true, tx: false, summary: '群信息 + 我的角色' }),
  route('custom', '更新群资料', 'PUT', '/groups/:group_id', `LET $m = QUERY SELECT role FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
IF $m.rows[0].role != 'owner'
  IF $m.rows[0].role != 'admin'
    RETURN 403 { "ok": false, "error": "NOT_ADMIN" };
  END
END
EXEC UPDATE {{t:group}} SET name = IFNULL({{body.name}}, name), intro = IFNULL({{body.intro}}, intro), avatar = IFNULL({{body.avatar}}, avatar), join_mode = IFNULL({{body.join_mode}}, join_mode), updated_at = NOW() WHERE group_id = {{path.group_id}};
RETURN 200 { "ok": true };`, { auth: true, summary: '群主/管理员改资料' }),
  route('custom', '解散群', 'DELETE', '/groups/:group_id', `LET $g = QUERY SELECT owner_only_id FROM {{t:group}} WHERE group_id = {{path.group_id}} LIMIT 1;
IF LEN($g.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_GROUP" };
END
IF $g.rows[0].owner_only_id != {{user.onlyId}}
  RETURN 403 { "ok": false, "error": "NOT_OWNER" };
END
EXEC DELETE FROM {{t:groupMember}} WHERE group_id = {{path.group_id}};
EXEC DELETE FROM {{t:announce}} WHERE group_id = {{path.group_id}};
EXEC DELETE FROM {{t:msg}} WHERE group_id = {{path.group_id}};
EXEC UPDATE {{t:group}} SET status = 0, member_count = 0, updated_at = NOW() WHERE group_id = {{path.group_id}};
RETURN 200 { "ok": true };`, { auth: true, summary: '群主解散，逻辑删除群' }),
  route('custom', '群成员', 'GET', '/groups/:group_id/members', `LET $m = QUERY SELECT role FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
LET $rows = QUERY SELECT gm.only_id, gm.role, gm.mute, gm.joined_at, gm.last_read_at, u.nickname, u.avatar, u.last_seen_at FROM {{t:groupMember}} gm LEFT JOIN {{t:user}} u ON u.only_id = gm.only_id WHERE gm.group_id = {{path.group_id}} ORDER BY gm.joined_at;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '仅成员可看成员列表' }),
  route('custom', '添加群成员', 'POST', '/groups/:group_id/members', `LET $m = QUERY SELECT role FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
LET $u = QUERY SELECT only_id FROM {{t:user}} WHERE only_id = {{body.only_id}} AND status = 1 LIMIT 1;
IF LEN($u.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_USER" };
END
LET $dup = QUERY SELECT only_id FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{body.only_id}} LIMIT 1;
IF LEN($dup.rows) > 0
  RETURN 409 { "ok": false, "error": "ALREADY_MEMBER" };
END
EXEC INSERT INTO {{t:groupMember}} (group_id, only_id, role) VALUES ({{path.group_id}}, {{body.only_id}}, 'member');
EXEC UPDATE {{t:group}} SET member_count = member_count + 1, updated_at = NOW() WHERE group_id = {{path.group_id}};
LET $nid = {{uuid}};
EXEC INSERT INTO {{t:notice}} (notice_id, only_id, type, title, body, ref_type, ref_id) VALUES ({{vars.nid}}, {{body.only_id}}, 'group', '你已加入群聊', '', 'group', {{path.group_id}});
RETURN 201 { "ok": true };`, { auth: true, summary: '添加成员、人数 +1、通知' }),
  route('custom', '移除群成员', 'DELETE', '/groups/:group_id/members/:only_id', `LET $me = QUERY SELECT role FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($me.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
LET $g = QUERY SELECT owner_only_id FROM {{t:group}} WHERE group_id = {{path.group_id}} LIMIT 1;
IF $g.rows[0].owner_only_id == {{path.only_id}}
  RETURN 409 { "ok": false, "error": "CANNOT_REMOVE_OWNER" };
END
IF {{path.only_id}} != {{user.onlyId}}
  IF $me.rows[0].role != 'owner'
    IF $me.rows[0].role != 'admin'
      RETURN 403 { "ok": false, "error": "NOT_ADMIN" };
    END
  END
END
LET $del = QUERY SELECT only_id FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{path.only_id}} LIMIT 1;
IF LEN($del.rows) > 0
  EXEC DELETE FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{path.only_id}};
  EXEC UPDATE {{t:group}} SET member_count = member_count - 1, updated_at = NOW() WHERE group_id = {{path.group_id}};
END
RETURN 200 { "ok": true };`, { auth: true, summary: '群主/管理员踢人；成员可自退' }),
  route('custom', '加入群', 'POST', '/groups/:group_id/join', `LET $g = QUERY SELECT group_id, join_mode, status FROM {{t:group}} WHERE group_id = {{path.group_id}} LIMIT 1;
IF LEN($g.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_GROUP" };
END
IF $g.rows[0].status != 1
  RETURN 410 { "ok": false, "error": "GROUP_CLOSED" };
END
LET $m = QUERY SELECT only_id FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) > 0
  RETURN 200 { "ok": true, "joined": true };
END
IF $g.rows[0].join_mode == 3
  RETURN 403 { "ok": false, "error": "INVITE_ONLY" };
END
IF $g.rows[0].join_mode == 2
  LET $nid = {{uuid}};
  EXEC INSERT INTO {{t:notice}} (notice_id, only_id, type, title, body, ref_type, ref_id) VALUES ({{vars.nid}}, {{user.onlyId}}, 'group', '入群申请已提交', '', 'group', {{path.group_id}});
  RETURN 202 { "ok": true, "pending": true };
END
EXEC INSERT INTO {{t:groupMember}} (group_id, only_id, role) VALUES ({{path.group_id}}, {{user.onlyId}}, 'member');
EXEC UPDATE {{t:group}} SET member_count = member_count + 1, updated_at = NOW() WHERE group_id = {{path.group_id}};
RETURN 200 { "ok": true, "joined": true };`, { auth: true, summary: '自由加入 / 审批占位 / 邀请制拒绝' }),
  route('custom', '退出群', 'POST', '/groups/:group_id/leave', `LET $g = QUERY SELECT owner_only_id FROM {{t:group}} WHERE group_id = {{path.group_id}} LIMIT 1;
IF LEN($g.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_GROUP" };
END
IF $g.rows[0].owner_only_id == {{user.onlyId}}
  RETURN 409 { "ok": false, "error": "OWNER_NEED_TRANSFER" };
END
LET $m = QUERY SELECT only_id FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) > 0
  EXEC DELETE FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}};
  EXEC UPDATE {{t:group}} SET member_count = member_count - 1, updated_at = NOW() WHERE group_id = {{path.group_id}};
END
RETURN 200 { "ok": true };`, { auth: true, summary: '群主需先转让' }),
  route('custom', '发布群公告', 'POST', '/groups/:group_id/announcements', `LET $m = QUERY SELECT role FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
IF $m.rows[0].role != 'owner'
  IF $m.rows[0].role != 'admin'
    RETURN 403 { "ok": false, "error": "NOT_ADMIN" };
  END
END
LET $aid = {{uuid}};
EXEC INSERT INTO {{t:announce}} (announce_id, group_id, only_id, content) VALUES ({{vars.aid}}, {{path.group_id}}, {{user.onlyId}}, {{body.content}});
RETURN 201 { "ok": true, "announceId": {{vars.aid}} };`, { auth: true, summary: '群主/管理员发布' }),
  route('custom', '群公告', 'GET', '/groups/:group_id/announcements', `LET $m = QUERY SELECT only_id FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
LET $rows = QUERY SELECT a.announce_id, a.content, a.created_at, a.only_id, u.nickname FROM {{t:announce}} a LEFT JOIN {{t:user}} u ON u.only_id = a.only_id WHERE a.group_id = {{path.group_id}} ORDER BY a.created_at DESC;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '仅成员可看' }),
  route('custom', '发送群消息', 'POST', '/groups/:group_id/messages', `LET $m = QUERY SELECT role, mute FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
IF $m.rows[0].mute == 1
  RETURN 403 { "ok": false, "error": "MUTED" };
END
LET $mid = {{uuid}};
EXEC INSERT INTO {{t:msg}} (msg_id, group_id, from_only_id, body, msg_type, media_url, reply_to) VALUES ({{vars.mid}}, {{path.group_id}}, {{user.onlyId}}, {{body.body}}, {{body.msg_type}}, {{body.media_url}}, {{body.reply_to}});
EXEC UPDATE {{t:group}} SET updated_at = NOW() WHERE group_id = {{path.group_id}};
PUBLISH 'social:group' { "msgId": {{vars.mid}}, "groupId": {{path.group_id}}, "from": {{user.onlyId}} };
RETURN 201 { "ok": true, "msgId": {{vars.mid}} };`, { auth: true, summary: '校验成员/禁言后发群消息' }),
  route('custom', '群消息历史', 'GET', '/groups/:group_id/messages', `LET $m = QUERY SELECT only_id FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
LET $rows = QUERY SELECT m.msg_id, m.from_only_id, m.body, m.msg_type, m.media_url, m.reply_to, m.status, m.created_at, u.nickname AS from_name, u.avatar AS from_avatar FROM {{t:msg}} m LEFT JOIN {{t:user}} u ON u.only_id = m.from_only_id WHERE m.group_id = {{path.group_id}} ORDER BY m.created_at DESC LIMIT 50;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '最近 50 条群消息' }),
  route('custom', '设置禁言', 'PUT', '/groups/:group_id/members/:only_id/mute', `LET $m = QUERY SELECT role FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 403 { "ok": false, "error": "NOT_MEMBER" };
END
IF $m.rows[0].role != 'owner'
  IF $m.rows[0].role != 'admin'
    RETURN 403 { "ok": false, "error": "NOT_ADMIN" };
  END
END
EXEC UPDATE {{t:groupMember}} SET mute = {{body.mute}} WHERE group_id = {{path.group_id}} AND only_id = {{path.only_id}};
RETURN 200 { "ok": true };`, { auth: true, summary: '管理员可禁言/解禁成员' }),
  route('custom', '转让群主', 'POST', '/groups/:group_id/transfer', `LET $g = QUERY SELECT owner_only_id FROM {{t:group}} WHERE group_id = {{path.group_id}} LIMIT 1;
IF LEN($g.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_GROUP" };
END
IF $g.rows[0].owner_only_id != {{user.onlyId}}
  RETURN 403 { "ok": false, "error": "NOT_OWNER" };
END
LET $m = QUERY SELECT only_id FROM {{t:groupMember}} WHERE group_id = {{path.group_id}} AND only_id = {{body.to_only_id}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 404 { "ok": false, "error": "NOT_MEMBER" };
END
EXEC UPDATE {{t:group}} SET owner_only_id = {{body.to_only_id}}, updated_at = NOW() WHERE group_id = {{path.group_id}};
EXEC UPDATE {{t:groupMember}} SET role = 'owner' WHERE group_id = {{path.group_id}} AND only_id = {{body.to_only_id}};
EXEC UPDATE {{t:groupMember}} SET role = 'admin' WHERE group_id = {{path.group_id}} AND only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '群主转让，自己降为管理员' }),
], { summary: '群聊与群管理', desc: '建群、成员、公告、群消息、禁言、转让、解散，全部按 onlyId 鉴权。' });

/* ---------------- 动态社区 ---------------- */
const moments = iface('动态社区', 'feed', pick('user', 'friend', 'moment', 'momentLike', 'momentComment'), [
  route('custom', '发布动态', 'POST', '/moments', `LET $mid = {{uuid}};
EXEC INSERT INTO {{t:moment}} (moment_id, only_id, content, images, visibility) VALUES ({{vars.mid}}, {{user.onlyId}}, {{body.content}}, {{body.images}}, {{body.visibility}});
RETURN 201 { "ok": true, "momentId": {{vars.mid}} };`, { auth: true, summary: '文字 + 逗号分隔图片，默认公开' }),
  route('custom', '好友动态流', 'GET', '/moments', `LET $rows = QUERY SELECT m.moment_id, m.only_id, m.content, m.images, m.visibility, m.like_count, m.comment_count, m.created_at, u.nickname, u.avatar FROM {{t:moment}} m LEFT JOIN {{t:user}} u ON u.only_id = m.only_id WHERE (m.only_id = {{user.onlyId}} OR m.only_id IN (SELECT friend_only_id FROM {{t:friend}} WHERE owner_only_id = {{user.onlyId}})) AND (m.visibility = 1 OR m.visibility = 2) ORDER BY m.created_at DESC LIMIT 50;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '自己和好友的动态' }),
  route('custom', '动态详情', 'GET', '/moments/:moment_id', `LET $m = QUERY SELECT m.moment_id, m.only_id, m.content, m.images, m.visibility, m.like_count, m.comment_count, m.created_at, u.nickname, u.avatar FROM {{t:moment}} m LEFT JOIN {{t:user}} u ON u.only_id = m.only_id WHERE m.moment_id = {{path.moment_id}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_MOMENT" };
END
LET $l = QUERY SELECT moment_id FROM {{t:momentLike}} WHERE moment_id = {{path.moment_id}} AND only_id = {{user.onlyId}} LIMIT 1;
LET $c = QUERY SELECT comment_id, only_id, reply_to, content, created_at FROM {{t:momentComment}} WHERE moment_id = {{path.moment_id}} ORDER BY created_at;
RETURN 200 { "moment": $m.rows, "liked": LEN($l.rows) > 0, "comments": $c.rows };`, { auth: true, tx: false, summary: '详情 + 我是否点赞 + 评论' }),
  route('custom', '删除动态', 'DELETE', '/moments/:moment_id', `LET $m = QUERY SELECT only_id FROM {{t:moment}} WHERE moment_id = {{path.moment_id}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_MOMENT" };
END
IF $m.rows[0].only_id != {{user.onlyId}}
  RETURN 403 { "ok": false, "error": "NOT_OWNER" };
END
EXEC DELETE FROM {{t:momentLike}} WHERE moment_id = {{path.moment_id}};
EXEC DELETE FROM {{t:momentComment}} WHERE moment_id = {{path.moment_id}};
EXEC DELETE FROM {{t:moment}} WHERE moment_id = {{path.moment_id}};
RETURN 200 { "ok": true };`, { auth: true, summary: '作者删除，连带点赞评论' }),
  route('custom', '点赞/取消点赞', 'POST', '/moments/:moment_id/like', `LET $l = QUERY SELECT moment_id FROM {{t:momentLike}} WHERE moment_id = {{path.moment_id}} AND only_id = {{user.onlyId}} LIMIT 1;
IF LEN($l.rows) > 0
  EXEC DELETE FROM {{t:momentLike}} WHERE moment_id = {{path.moment_id}} AND only_id = {{user.onlyId}};
  EXEC UPDATE {{t:moment}} SET like_count = like_count - 1 WHERE moment_id = {{path.moment_id}};
  RETURN 200 { "ok": true, "liked": false };
END
EXEC INSERT INTO {{t:momentLike}} (moment_id, only_id) VALUES ({{path.moment_id}}, {{user.onlyId}});
EXEC UPDATE {{t:moment}} SET like_count = like_count + 1 WHERE moment_id = {{path.moment_id}};
RETURN 200 { "ok": true, "liked": true };`, { auth: true, summary: '存在则取消，不存在则点赞' }),
  route('custom', '评论列表', 'GET', '/moments/:moment_id/comments', `LET $rows = QUERY SELECT c.comment_id, c.only_id, c.reply_to, c.content, c.created_at, u.nickname, u.avatar FROM {{t:momentComment}} c LEFT JOIN {{t:user}} u ON u.only_id = c.only_id WHERE c.moment_id = {{path.moment_id}} ORDER BY c.created_at;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '按时间正序' }),
  route('custom', '发表评论', 'POST', '/moments/:moment_id/comments', `LET $m = QUERY SELECT moment_id FROM {{t:moment}} WHERE moment_id = {{path.moment_id}} LIMIT 1;
IF LEN($m.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_MOMENT" };
END
LET $cid = {{uuid}};
EXEC INSERT INTO {{t:momentComment}} (comment_id, moment_id, only_id, reply_to, content) VALUES ({{vars.cid}}, {{path.moment_id}}, {{user.onlyId}}, {{body.reply_to}}, {{body.content}});
EXEC UPDATE {{t:moment}} SET comment_count = comment_count + 1 WHERE moment_id = {{path.moment_id}};
RETURN 201 { "ok": true, "commentId": {{vars.cid}} };`, { auth: true, summary: '可选 reply_to 回复某条评论' }),
  route('custom', '删除评论', 'DELETE', '/moments/:moment_id/comments/:comment_id', `LET $c = QUERY SELECT only_id FROM {{t:momentComment}} WHERE comment_id = {{path.comment_id}} AND moment_id = {{path.moment_id}} LIMIT 1;
IF LEN($c.rows) == 0
  RETURN 404 { "ok": false, "error": "NO_COMMENT" };
END
LET $m = QUERY SELECT only_id FROM {{t:moment}} WHERE moment_id = {{path.moment_id}} LIMIT 1;
IF $c.rows[0].only_id != {{user.onlyId}}
  IF $m.rows[0].only_id != {{user.onlyId}}
    RETURN 403 { "ok": false, "error": "NOT_ALLOWED" };
  END
END
EXEC DELETE FROM {{t:momentComment}} WHERE comment_id = {{path.comment_id}};
EXEC UPDATE {{t:moment}} SET comment_count = comment_count - 1 WHERE moment_id = {{path.moment_id}};
RETURN 200 { "ok": true };`, { auth: true, summary: '评论人或动态作者可删' }),
  route('custom', '用户动态', 'GET', '/moments/user/:only_id', `LET $rows = QUERY SELECT m.moment_id, m.only_id, m.content, m.images, m.like_count, m.comment_count, m.created_at, u.nickname, u.avatar FROM {{t:moment}} m LEFT JOIN {{t:user}} u ON u.only_id = m.only_id WHERE m.only_id = {{path.only_id}} AND m.visibility != 3 ORDER BY m.created_at DESC LIMIT 50;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '某人的公开动态' }),
  route('custom', '热门动态', 'GET', '/moments/hot', `LET $rows = QUERY SELECT moment_id, only_id, content, images, like_count, comment_count, created_at FROM {{t:moment}} WHERE visibility = 1 ORDER BY like_count DESC, comment_count DESC LIMIT 20;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '按点赞/评论排序，公开动态' }),
], { summary: '动态、点赞、评论', desc: '动态和评论都用 UUID 关联，无自增键。' });

/* ---------------- 搜索 ---------------- */
const search = iface('搜索', 'search', pick('user', 'friend', 'group', 'groupMember', 'msg', 'moment', 'search'), [
  route('custom', '全局搜索', 'GET', '/search', `LET $kw = {{query.q}};
IF LEN($kw) == 0
  RETURN 400 { "ok": false, "error": "EMPTY_KEYWORD" };
END
LET $users = QUERY SELECT only_id, nickname, avatar, bio, region FROM {{t:user}} WHERE status = 1 AND allow_search = 1 AND (username LIKE CONCAT('%', $kw, '%') OR nickname LIKE CONCAT('%', $kw, '%') OR bio LIKE CONCAT('%', $kw, '%')) LIMIT 10;
LET $groups = QUERY SELECT group_id, name, intro, avatar, member_count FROM {{t:group}} WHERE status = 1 AND (name LIKE CONCAT('%', $kw, '%') OR intro LIKE CONCAT('%', $kw, '%')) LIMIT 10;
LET $moments = QUERY SELECT moment_id, only_id, content, images, like_count, created_at FROM {{t:moment}} WHERE visibility = 1 AND content LIKE CONCAT('%', $kw, '%') ORDER BY created_at DESC LIMIT 10;
LET $msgs = QUERY SELECT msg_id, conv_id, group_id, from_only_id, body, created_at FROM {{t:msg}} WHERE body LIKE CONCAT('%', $kw, '%') AND (from_only_id = {{user.onlyId}} OR to_only_id = {{user.onlyId}} OR group_id IN (SELECT group_id FROM {{t:groupMember}} WHERE only_id = {{user.onlyId}})) ORDER BY created_at DESC LIMIT 10;
EXEC INSERT INTO {{t:search}} (only_id, keyword, scene) VALUES ({{user.onlyId}}, $kw, 'all');
RETURN 200 { "keyword": $kw, "users": $users.rows, "groups": $groups.rows, "moments": $moments.rows, "messages": $msgs.rows };`, { auth: true, tx: false, summary: '一次搜用户/群/动态/消息，并记录关键词' }),
  route('custom', '搜用户', 'GET', '/search/users', `LET $kw = {{query.q}};
LET $rows = QUERY SELECT only_id, username, nickname, avatar, bio, region, last_seen_at FROM {{t:user}} WHERE status = 1 AND allow_search = 1 AND (username LIKE CONCAT('%', $kw, '%') OR nickname LIKE CONCAT('%', $kw, '%') OR bio LIKE CONCAT('%', $kw, '%')) LIMIT 30;
RETURN 200 { "keyword": $kw, "rows": $rows.rows };`, { auth: true, tx: false, summary: '只搜可公开用户' }),
  route('custom', '搜群', 'GET', '/search/groups', `LET $kw = {{query.q}};
LET $rows = QUERY SELECT group_id, name, intro, avatar, member_count, join_mode, owner_only_id FROM {{t:group}} WHERE status = 1 AND (name LIKE CONCAT('%', $kw, '%') OR intro LIKE CONCAT('%', $kw, '%')) LIMIT 30;
RETURN 200 { "keyword": $kw, "rows": $rows.rows };`, { auth: true, tx: false, summary: '搜公开群' }),
  route('custom', '搜动态', 'GET', '/search/moments', `LET $kw = {{query.q}};
LET $rows = QUERY SELECT moment_id, only_id, content, images, like_count, created_at FROM {{t:moment}} WHERE visibility = 1 AND content LIKE CONCAT('%', $kw, '%') ORDER BY created_at DESC LIMIT 30;
RETURN 200 { "keyword": $kw, "rows": $rows.rows };`, { auth: true, tx: false, summary: '只搜公开动态' }),
  route('custom', '搜消息', 'GET', '/search/messages', `LET $kw = {{query.q}};
LET $rows = QUERY SELECT msg_id, conv_id, group_id, from_only_id, body, created_at FROM {{t:msg}} WHERE body LIKE CONCAT('%', $kw, '%') AND (from_only_id = {{user.onlyId}} OR to_only_id = {{user.onlyId}} OR group_id IN (SELECT group_id FROM {{t:groupMember}} WHERE only_id = {{user.onlyId}})) ORDER BY created_at DESC LIMIT 30;
RETURN 200 { "keyword": $kw, "rows": $rows.rows };`, { auth: true, tx: false, summary: '只搜自己可见的私聊/群聊' }),
  route('custom', '搜索热词', 'GET', '/search/hot', `LET $rows = QUERY SELECT keyword, COUNT(*) AS n FROM {{t:search}} GROUP BY keyword ORDER BY n DESC LIMIT 10;
RETURN 200 { "rows": $rows.rows };`, { auth: false, tx: false, summary: '按搜索次数排序' }),
  route('custom', '我的搜索历史', 'GET', '/search/history', `LET $rows = QUERY SELECT keyword, scene, created_at FROM {{t:search}} WHERE only_id = {{user.onlyId}} ORDER BY created_at DESC LIMIT 20;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '最近 20 次' }),
  route('custom', '清空搜索历史', 'DELETE', '/search/history', `EXEC DELETE FROM {{t:search}} WHERE only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '只清自己的记录' }),
], { summary: '用户/群/动态/消息搜索', desc: '搜索权限按 onlyId 限定；消息只返回自己参与的会话。' });

/* ---------------- 通知与收藏 ---------------- */
const inbox = iface('通知收藏', 'notify', pick('notice', 'favorite'), [
  route('custom', '通知列表', 'GET', '/notifications', `LET $rows = QUERY SELECT notice_id, type, title, body, ref_type, ref_id, read_flag, created_at FROM {{t:notice}} WHERE only_id = {{user.onlyId}} ORDER BY created_at DESC LIMIT 50;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '最近 50 条' }),
  route('custom', '未读通知数', 'GET', '/notifications/unread', `LET $r = QUERY SELECT COUNT(*) AS n FROM {{t:notice}} WHERE only_id = {{user.onlyId}} AND read_flag = 0;
RETURN 200 { "unread": $r.rows[0].n };`, { auth: true, tx: false, summary: '未读计数' }),
  route('custom', '全部已读', 'PUT', '/notifications/read-all', `EXEC UPDATE {{t:notice}} SET read_flag = 1 WHERE only_id = {{user.onlyId}} AND read_flag = 0;
RETURN 200 { "ok": true };`, { auth: true, summary: '一键已读' }),
  route('custom', '单条已读', 'PUT', '/notifications/:notice_id/read', `EXEC UPDATE {{t:notice}} SET read_flag = 1 WHERE notice_id = {{path.notice_id}} AND only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '只改自己的通知' }),
  route('custom', '删除通知', 'DELETE', '/notifications/:notice_id', `EXEC DELETE FROM {{t:notice}} WHERE notice_id = {{path.notice_id}} AND only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '只删自己的通知' }),
  route('custom', '收藏', 'POST', '/favorites', `LET $f = QUERY SELECT only_id FROM {{t:favorite}} WHERE only_id = {{user.onlyId}} AND target_type = {{body.target_type}} AND target_id = {{body.target_id}} LIMIT 1;
IF LEN($f.rows) > 0
  RETURN 200 { "ok": true, "already": true };
END
EXEC INSERT INTO {{t:favorite}} (only_id, target_type, target_id, title) VALUES ({{user.onlyId}}, {{body.target_type}}, {{body.target_id}}, {{body.title}});
RETURN 201 { "ok": true };`, { auth: true, summary: '同一目标幂等收藏' }),
  route('custom', '收藏列表', 'GET', '/favorites', `LET $rows = QUERY SELECT target_type, target_id, title, created_at FROM {{t:favorite}} WHERE only_id = {{user.onlyId}} ORDER BY created_at DESC;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '我的收藏' }),
  route('custom', '检查收藏', 'GET', '/favorites/check/:target_type/:target_id', `LET $f = QUERY SELECT target_id FROM {{t:favorite}} WHERE only_id = {{user.onlyId}} AND target_type = {{path.target_type}} AND target_id = {{path.target_id}} LIMIT 1;
RETURN 200 { "favorited": LEN($f.rows) > 0 };`, { auth: true, tx: false, summary: '是否已收藏' }),
  route('custom', '取消收藏', 'DELETE', '/favorites/:target_type/:target_id', `EXEC DELETE FROM {{t:favorite}} WHERE only_id = {{user.onlyId}} AND target_type = {{path.target_type}} AND target_id = {{path.target_id}};
RETURN 200 { "ok": true };`, { auth: true, summary: '按类型 + UUID 删除' }),
], { summary: '通知与收藏', desc: '通知/收藏都绑定 onlyId。' });

/* ---------------- 文件与安全 ---------------- */
const safety = iface('文件与安全', 'asset', pick('user', 'file', 'report'), [
  route('upload', '上传附件', 'POST', '/files', `LET $fid = {{uuid}};
EXEC INSERT INTO {{t:file}} (file_id, only_id, filename, content_type, size, object_key, object_url, scene) VALUES ({{vars.fid}}, {{user.onlyId}}, {{filename}}, {{contentType}}, {{size}}, {{objectKey}}, {{objectUrl}}, 'chat');
RETURN 201 { "ok": true, "fileId": {{vars.fid}}, "url": {{objectUrl}}, "key": {{objectKey}}, "name": {{filename}}, "size": {{size}} };`, {
    auth: true, tx: false, summary: 'multipart 上传，服务器先写对象存储再入库',
    desc: '请求头 X-Filename / X-Content-Type，body 为二进制。',
  }),
  route('custom', '我的附件', 'GET', '/files', `LET $rows = QUERY SELECT file_id, filename, content_type, size, object_key, object_url, scene, created_at FROM {{t:file}} WHERE only_id = {{user.onlyId}} ORDER BY created_at DESC;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '只列自己的文件' }),
  route('custom', '删除附件', 'DELETE', '/files/:file_id', `EXEC DELETE FROM {{t:file}} WHERE file_id = {{path.file_id}} AND only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '只删自己的记录（对象存储由运维清理）' }),
  route('upload', '上传头像', 'POST', '/profile/avatar', `LET $fid = {{uuid}};
EXEC INSERT INTO {{t:file}} (file_id, only_id, filename, content_type, size, object_key, object_url, scene) VALUES ({{vars.fid}}, {{user.onlyId}}, {{filename}}, {{contentType}}, {{size}}, {{objectKey}}, {{objectUrl}}, 'avatar');
EXEC UPDATE {{t:user}} SET avatar = {{objectUrl}}, updated_at = NOW() WHERE only_id = {{user.onlyId}};
RETURN 201 { "ok": true, "fileId": {{vars.fid}}, "avatar": {{objectUrl}} };`, {
    auth: true, tx: false, summary: '上传后直接更新头像',
  }),
  route('custom', '举报', 'POST', '/reports', `IF {{body.target_type}} == 'user'
  IF {{body.target_id}} == {{user.onlyId}}
    RETURN 400 { "ok": false, "error": "SELF" };
  END
END
LET $rid = {{uuid}};
EXEC INSERT INTO {{t:report}} (report_id, only_id, target_type, target_id, reason, detail) VALUES ({{vars.rid}}, {{user.onlyId}}, {{body.target_type}}, {{body.target_id}}, {{body.reason}}, {{body.detail}});
RETURN 201 { "ok": true, "reportId": {{vars.rid}} };`, { auth: true, summary: '举报用户/群/动态/消息' }),
  route('custom', '我的举报', 'GET', '/reports/mine', `LET $rows = QUERY SELECT report_id, target_type, target_id, reason, detail, status, created_at FROM {{t:report}} WHERE only_id = {{user.onlyId}} ORDER BY created_at DESC;
RETURN 200 { "rows": $rows.rows };`, { auth: true, tx: false, summary: '举报记录' }),
  route('custom', '隐私设置', 'GET', '/privacy', `LET $u = QUERY SELECT allow_search, allow_stranger, region, status FROM {{t:user}} WHERE only_id = {{user.onlyId}} LIMIT 1;
RETURN 200 { "privacy": $u.rows };`, { auth: true, tx: false, summary: '查看搜索/陌生人策略' }),
  route('custom', '更新隐私', 'PUT', '/privacy', `EXEC UPDATE {{t:user}} SET allow_search = IFNULL({{body.allow_search}}, allow_search), allow_stranger = IFNULL({{body.allow_stranger}}, allow_stranger), updated_at = NOW() WHERE only_id = {{user.onlyId}};
RETURN 200 { "ok": true };`, { auth: true, summary: '只改当前用户' }),
], { summary: '上传、举报、隐私', desc: '文件先入对象存储再写 sc_attachment；举报与隐私都按 onlyId。' });

/* ---------------- 统计 ---------------- */
const stats = iface('统计运维', 'ops', pick('user', 'friend', 'group', 'groupMember', 'msg', 'moment', 'notice', 'favorite', 'search'), [
  route('custom', '我的统计', 'GET', '/stats', `LET $fr = QUERY SELECT COUNT(*) AS n FROM {{t:friend}} WHERE owner_only_id = {{user.onlyId}};
LET $gr = QUERY SELECT COUNT(*) AS n FROM {{t:groupMember}} WHERE only_id = {{user.onlyId}};
LET $ms = QUERY SELECT COUNT(*) AS n FROM {{t:msg}} WHERE from_only_id = {{user.onlyId}};
LET $mo = QUERY SELECT COUNT(*) AS n FROM {{t:moment}} WHERE only_id = {{user.onlyId}};
LET $no = QUERY SELECT COUNT(*) AS n FROM {{t:notice}} WHERE only_id = {{user.onlyId}} AND read_flag = 0;
LET $fa = QUERY SELECT COUNT(*) AS n FROM {{t:favorite}} WHERE only_id = {{user.onlyId}};
RETURN 200 { "friends": $fr.rows[0].n, "groups": $gr.rows[0].n, "messagesSent": $ms.rows[0].n, "moments": $mo.rows[0].n, "unreadNotices": $no.rows[0].n, "favorites": $fa.rows[0].n };`, { auth: true, tx: false, summary: '好友/群/消息/动态/通知/收藏计数' }),
  route('custom', '平台概览', 'GET', '/stats/overview', `LET $u = QUERY SELECT COUNT(*) AS n FROM {{t:user}} WHERE status = 1;
LET $g = QUERY SELECT COUNT(*) AS n FROM {{t:group}} WHERE status = 1;
LET $m = QUERY SELECT COUNT(*) AS n FROM {{t:msg}};
LET $mo = QUERY SELECT COUNT(*) AS n FROM {{t:moment}};
RETURN 200 { "users": $u.rows[0].n, "groups": $g.rows[0].n, "messages": $m.rows[0].n, "moments": $mo.rows[0].n };`, { auth: true, tx: false, summary: '平台级总量（仅登录用户可看）' }),
  route('custom', '搜索趋势', 'GET', '/stats/trend', `LET $s = QUERY SELECT DATE(created_at) AS day, COUNT(*) AS n FROM {{t:search}} GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 14;
RETURN 200 { "search": $s.rows };`, { auth: true, tx: false, summary: '最近 14 天搜索量' }),
], { summary: '统计', desc: '按 onlyId 统计个人数据；平台概览只对登录用户开放。' });

const base = spec.seedProject();
const project = {
  ...base,
  name: '同频社区',
  description: '账户、好友、私聊、群聊、动态、搜索、通知、收藏、文件、举报、统计；onlyId 定身份，数据真实落表。',
  categories: [
    { id: 'account', name: '账户身份' }, { id: 'friend', name: '好友关系' },
    { id: 'im', name: '私聊消息' }, { id: 'group', name: '群聊' },
    { id: 'feed', name: '动态社区' }, { id: 'search', name: '搜索' },
    { id: 'notify', name: '通知收藏' }, { id: 'asset', name: '文件与安全' },
    { id: 'ops', name: '统计运维' },
  ],
  interfaces: [account, friends, chatIface, groups, moments, search, inbox, safety, stats],
  functions: [
    { name: 'REQ_TAG', params: [], body: 'CONCAT("REQ-", SUBSTR(HASH(UUID()), 0, 10))' },
    { name: 'MASK_ID', params: ['v'], body: 'CONCAT(SUBSTR(v, 0, 4), "****", SUBSTR(v, 24, 8))' },
  ],
  // token 同时支持 Authorization 和 cookie；登录响应会自动 Set-Cookie。
  token: { ttl: 7200, header: 'authorization', cookie: 'icb_token' },
  docs: {
    title: '同频社区 API', version: '2.0.0',
    description: '同频社区：onlyId 统一定义用户身份，HttpOnly cookie 维持登录态，账户、好友、动态、私聊和群聊真实落表。',
  },
  theme: {
    ...base.theme, headerTitle: '同频社区', footerText: 'ClickBuild · 内置业务应用', pattern: 'none',
  },
  // 固定时间，保证重复生成得到同一份模版文件（避免每次跑测试都改 updatedAt）。
  updatedAt: '2026-11-20T00:00:00.000Z',
};

const normalized = spec.normalizeProject(project);
fs.writeFileSync(OUT, JSON.stringify(normalized, null, 2));
const routeCount = normalized.interfaces.reduce((n, i) => n + i.routes.length, 0);
const tableCount = normalized.interfaces.reduce((n, i) => n + i.tables.length, 0);
console.log(`写入 ${OUT}`);
console.log(`${normalized.interfaces.length} 接口 / ${tableCount} 表（含重复引用）/ ${routeCount} 路由`);
console.log(`无主键表: ${normalized.interfaces.flatMap((i) => i.tables).filter((t) => !t.fields.some((f) => f.pk)).length}/${tableCount}`);
