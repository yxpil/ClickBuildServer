/* 社交社区模式：动态流、点赞评论、好友、私聊、通知、资料。 */

function socialIface(path, method) {
  const list = CASE.interfaces || [];
  const hit = list.find((i) => (i.routes || []).some((r) => r.path === path && (!method || r.method === method)));
  return hit ? hit.name : (UX.auth && UX.auth.iface);
}
function socialApi(path, opts) {
  opts = opts || {};
  return api(socialIface(path, opts.method || 'GET'), path, opts);
}
async function socialRows(path, opts) { return rowsOf(await socialApi(path, opts)); }
function momentAuthor(m) {
  return m.author_name || m.nickname || m.display_name || m.peer_name || m.only_id || '好友';
}
function momentText(m) { return m.content || m.body || m.text || ''; }
function momentId(m) { return m.id || m.moment_id; }

function momentCard(m) {
  const id = momentId(m);
  const images = String(m.images || '').split(/[,，]/).filter(Boolean);
  return '<article class="moment"><div class="moment-head">' + avatar(momentAuthor(m)) +
    '<div><b>' + esc(momentAuthor(m)) + '</b><span>' + esc(fmtDate(m.created_at, true)) + '</span></div>' +
    '<button class="mini" onclick="App.likeMoment(' + JSON.stringify(id) + ')">♡ ' + esc(m.like_count || m.likes || 0) + '</button></div>' +
    '<p>' + esc(momentText(m)).replace(/\n/g, '<br>') + '</p>' +
    (images.length ? '<div class="moment-images">' + images.slice(0, 3).map((src) => src && /^(https?:|\/)/.test(src) ? '<img src="' + esc(src) + '">' : '').join('') + '</div>' : '') +
    '<div class="moment-foot"><button class="mini" onclick="App.openMoment(' + JSON.stringify(id) + ')">评论 ' + esc(m.comment_count || 0) + '</button>' +
    '<button class="mini" onclick="App.shareMoment(' + JSON.stringify(id) + ')">转发</button></div></article>';
}

async function socialHome() {
  if (!requireAuth('登录后才能查看好友动态')) return;
  setMain(loadingHtml('正在读取动态…'));
  try {
    const moments = await socialRows(UX.routes.moments);
    const friends = await socialRows(UX.routes.friends).catch(() => []);
    const unread = itemOf(await socialApi(UX.routes.unread).catch(() => ({})));
    const list = moments.slice(0, 20);
    setMain('<div class="page social-page"><div class="social-layout">' +
      '<main class="social-feed"><div class="composer"><div class="composer-head">' + avatar((state.user && state.user.name) || '我') +
      '<button class="composer-input" onclick="App.newMoment()">分享一点真实的事…</button></div>' +
      '<div class="composer-foot"><span>动态 ' + moments.length + '</span><span>好友 ' + friends.length + '</span><span>未读 ' + esc(unread.count || unread.unread || unread.total || 0) + '</span></div></div>' +
      (list.length ? list.map(momentCard).join('') : emptyHtml('还没有动态', '发第一条，好友会在这里看到。')) +
      '</main><aside class="social-side"><div class="side-card"><h3>好友</h3>' +
      (friends.slice(0, 8).map((f) => '<div class="friend-row">' + avatar(f.nickname || f.name || f.only_id) + '<span><b>' + esc(f.nickname || f.name || f.only_id) + '</b><em>' + esc(f.bio || f.region || '') + '</em></span></div>').join('') || '<p class="muted">还没有好友</p>') +
      '<button class="btn ghost" onclick="App.go(\'friends\')">管理好友</button></div>' +
      '<div class="side-card"><h3>通知</h3><button class="btn ghost" onclick="App.go(\'notifications\')">查看通知</button></div></aside>' +
      '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('动态读取失败', e.message) + '</div>'); }
}

App.newMoment = () => {
  if (!requireAuth('登录后才能发动态')) return;
  App.openForm({
    title: '发布动态',
    iface: socialIface('/moments', 'POST'),
    path: '/moments',
    desc: '内容会直接进入好友动态流。',
    fields: ['content', 'images'],
    submitLabel: '发布',
    onSubmit: async (data) => {
      await socialApi('/moments', { method: 'POST', body: { ...data, visibility: 1 } });
      toast('已发布', 'ok');
      state.view = 'home';
      await App.render();
    },
  });
};

App.likeMoment = async (id) => {
  try { await socialApi('/moments/' + encodeURIComponent(id) + '/like', { method: 'POST', body: {} }); await App.render(); }
  catch (e) { toast(e.message || '操作失败', 'err'); }
};

App.shareMoment = (id) => {
  const url = location.origin + location.pathname + '#moment-' + id;
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('链接已复制', 'ok')).catch(() => toast(url));
  else toast(url);
};

App.openMoment = (id) => {
  state.view = 'moment';
  state.params = { id };
  renderChrome();
  App.render();
};

async function socialMoment() {
  if (!requireAuth('登录后才能查看动态')) return;
  setMain(loadingHtml('正在读取动态和评论…'));
  try {
    const d = await socialApi('/moments/' + encodeURIComponent(state.params.id));
    const m = itemOf(d);
    const comments = rowsOf(await socialApi('/moments/' + encodeURIComponent(state.params.id) + '/comments').catch(() => ({})));
    setMain('<div class="page social-page"><button class="mini" onclick="App.go(\'home\')">← 返回动态</button>' +
      '<div class="social-layout"><main class="social-feed" style="margin-top:16px">' + momentCard(m) +
      '<section class="section"><div class="section-head"><div><h2>评论</h2><p>' + comments.length + ' 条真实评论</p></div></div>' +
      (comments.length ? comments.map((c) => '<div class="comment"><b>' + esc(c.author_name || c.nickname || c.only_id || '好友') + '</b><p>' + esc(c.content || c.body || '') + '</p><span>' + esc(fmtDate(c.created_at, true)) + '</span></div>').join('') : '<div class="empty">还没有评论，写下第一条。</div>') +
      '<div class="comment-form"><textarea id="comment-input" placeholder="说点什么…"></textarea><button class="btn primary" onclick="App.sendComment()">发表评论</button></div></section></main></div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('动态读取失败', e.message) + '</div>'); }
}

App.sendComment = async () => {
  const input = $('#comment-input');
  const body = input && input.value.trim();
  if (!body) return;
  try {
    await socialApi('/moments/' + encodeURIComponent(state.params.id) + '/comments', { method: 'POST', body: { content: body } });
    input.value = '';
    toast('评论已发表', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '评论失败', 'err'); }
};

async function socialFriends() {
  if (!requireAuth('登录后查看好友')) return;
  setMain(loadingHtml('正在读取好友…'));
  try {
    const friends = await socialRows(UX.routes.friends);
    const requests = await socialRows(UX.routes.friendRequests).catch(() => []);
    const suggest = await socialRows(UX.routes.friendSuggest).catch(() => []);
    setMain('<div class="page social-page">' + pageTitle('好友', '好友、申请和推荐都来自真实关系表') +
      '<section class="section"><div class="section-head"><div><h2>我的好友</h2><p>' + friends.length + ' 位</p></div></div>' +
      (friends.length ? '<div class="friend-grid">' + friends.map((f) => '<div class="friend-card">' + avatar(f.nickname || f.name || f.only_id) +
        '<b>' + esc(f.nickname || f.name || f.only_id) + '</b><span>' + esc(f.bio || f.region || f.signature || '') + '</span>' +
        '<div class="friend-actions"><button class="mini" onclick="App.chatWithFriend(' + JSON.stringify(f.only_id) + ',' + JSON.stringify(f.nickname || f.name || f.only_id) + ')">私聊</button>' +
        '<button class="mini danger" onclick="App.removeFriend(' + JSON.stringify(f.only_id) + ')">删除</button></div></div>').join('') + '</div>' : emptyHtml('还没有好友', '从推荐或搜索里加一个。')) + '</section>' +
      '<section class="section"><div class="section-head"><div><h2>好友申请</h2><p>' + requests.length + ' 条待处理</p></div></div>' +
      (requests.length ? requests.map((r) => '<div class="request-row"><span><b>' + esc(r.nickname || r.name || r.from_only_id || r.only_id) + '</b><em>' + esc(r.message || r.reason || '') + '</em></span>' +
        '<button class="mini" onclick="App.handleFriend(' + JSON.stringify(r.req_id || r.id) + ',\'accept\')">通过</button>' +
        '<button class="mini danger" onclick="App.handleFriend(' + JSON.stringify(r.req_id || r.id) + ',\'reject\')">拒绝</button></div>').join('') : '<div class="empty">没有待处理申请。</div>') + '</section>' +
      '<section class="section"><div class="section-head"><div><h2>可能认识</h2><p>来自好友推荐</p></div></div>' +
      (suggest.length ? '<div class="friend-grid">' + suggest.slice(0, 12).map((f) => '<div class="friend-card">' + avatar(f.nickname || f.name || f.only_id) +
        '<b>' + esc(f.nickname || f.name || f.only_id) + '</b><span>' + esc(f.bio || '') + '</span>' +
        '<button class="mini" onclick="App.addFriend(' + JSON.stringify(f.only_id) + ')">加好友</button></div>').join('') + '</div>' : '<div class="empty">暂时没有推荐。</div>') + '</section>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('好友读取失败', e.message) + '</div>'); }
}

App.addFriend = async (onlyId) => {
  try { await socialApi('/friends/requests', { method: 'POST', body: { to: onlyId, message: '你好，想加你为好友。' } }); toast('申请已发送', 'ok'); }
  catch (e) { toast(e.message || '申请失败', 'err'); }
};
App.handleFriend = async (reqId, action) => {
  try { await socialApi('/friends/requests/' + encodeURIComponent(reqId), { method: 'PUT', body: { action } }); toast('已处理', 'ok'); await App.render(); }
  catch (e) { toast(e.message || '处理失败', 'err'); }
};
App.removeFriend = (onlyId) => App.confirm('确认删除这位好友？').then(async (ok) => {
  if (!ok) return;
  try { await socialApi('/friends/' + encodeURIComponent(onlyId), { method: 'DELETE' }); toast('已删除', 'ok'); await App.render(); }
  catch (e) { toast(e.message || '删除失败', 'err'); }
});

App.chatWithFriend = (onlyId, name) => {
  state.view = 'messages';
  state.params = { peer: onlyId, name };
  renderChrome();
  App.render();
};

async function socialMessages() {
  if (!requireAuth('登录后查看私聊')) return;
  setMain(loadingHtml('正在读取会话…'));
  try {
    const convs = await socialRows(UX.routes.conversations);
    const unread = itemOf(await socialApi('/unread').catch(() => ({})));
    const peer = state.params.peer;
    let thread = [];
    let active = null;
    if (peer) {
      const conv = convs.find((c) => String(c.peer_only_id || c.only_id) === String(peer));
      active = conv || { peer_only_id: peer, peer_name: state.params.name, id: '' };
    } else if (convs[0]) active = convs[0];
    if (active) thread = rowsOf(await socialApi('/messages/' + encodeURIComponent(active.id || active.conv_id), { params: {} }).catch(() => ({})));
    const side = convs.length ? convs.map((c) => '<button class="conv ' + (active && String(c.id) === String(active.id) ? 'on' : '') + '" onclick="App.openSocialChat(' + JSON.stringify(c.id) + ',' + JSON.stringify(c.peer_only_id || c.only_id) + ',' + JSON.stringify(c.peer_name || '') + ')">' +
      avatar(c.peer_name || c.peer_only_id) + '<span class="conv-main"><b>' + esc(c.peer_name || c.peer_only_id) + '</b><em>' + esc(plain(c.last_message, 30) || '') + '</em></span></button>').join('') : '<div class="chat-side-empty">还没有会话</div>';
    const msgs = thread.length ? thread.map((m) => {
      const mine = state.user && String(m.from_only_id || m.sender_only_id) === String(state.user.onlyId);
      return '<div class="bubble-row ' + (mine ? 'mine' : '') + '"><div class="bubble"><p>' + esc(m.content || m.body || '') + '</p><span>' + esc(fmtDate(m.created_at, true)) + '</span></div></div>';
    }).join('') : '<div class="chat-empty small"><h3>还没有消息</h3><p>在下面发第一条。</p></div>';
    setMain('<div class="page chat-page social-page"><div class="chat-shell">' +
      '<aside class="chat-side"><div class="chat-side-head"><b>私聊</b><span>' + (unread.count || unread.unread || 0) + ' 未读</span></div><div class="chat-side-list">' + side + '</div>' +
      '<button class="btn primary chat-new" onclick="App.newSocialChat()">发起私聊</button></aside>' +
      '<main class="chat-main"><div class="chat-thread-head"><div>' + avatar(active && (active.peer_name || active.peer_only_id)) + '<b>' + esc(active ? (active.peer_name || active.peer_only_id) : '选择会话') + '</b></div></div>' +
      '<div class="chat-thread">' + msgs + '</div>' +
      (active ? '<div class="chat-compose"><textarea id="social-input" placeholder="输入消息，Enter 发送"></textarea><button class="btn primary" onclick="App.sendSocial()">发送</button></div>' : '') +
      '</main></div>' + pageFoot() + '</div>');
    const input = $('#social-input');
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.sendSocial(); } };
  } catch (e) { setMain('<div class="page">' + emptyHtml('私聊读取失败', e.message) + '</div>'); }
}

App.openSocialChat = (convId, peer, name) => {
  state.view = 'messages';
  state.params = { conv: convId, peer, name };
  renderChrome();
  App.render();
};

App.sendSocial = async () => {
  const input = $('#social-input');
  const body = input && input.value.trim();
  if (!body) return;
  const peer = state.params.peer || '';
  if (!peer) { toast('缺少对方 only_id', 'err'); return; }
  try {
    await socialApi('/messages', { method: 'POST', body: { to: peer, content: body, body } });
    input.value = '';
    toast('已发送', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '发送失败', 'err'); }
};

App.newSocialChat = () => {
  App.modal({
    title: '发起私聊',
    desc: '输入对方的 only_id。',
    body: '<div class="form"><div class="field"><label>对方 only_id</label><input id="social-to"></div><div class="field"><label>第一条消息</label><textarea id="social-first"></textarea></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.startSocialChat()">发送</button>',
  });
};

App.startSocialChat = async () => {
  const to = ($('#social-to') && $('#social-to').value || '').trim();
  const body = ($('#social-first') && $('#social-first').value || '').trim();
  if (!to || !body) { toast('收件人和消息都要填', 'err'); return; }
  try {
    await socialApi('/messages', { method: 'POST', body: { to, content: body, body } });
    App.closeModal();
    state.view = 'messages';
    state.params = { peer: to, name: to };
    toast('已发送', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '发送失败', 'err'); }
};

async function socialNotifications() {
  if (!requireAuth('登录后查看通知')) return;
  setMain(loadingHtml('正在读取通知…'));
  try {
    const list = await socialRows(UX.routes.notifications);
    const unread = itemOf(await socialApi(UX.routes.unread).catch(() => ({})));
    setMain('<div class="page social-page">' + pageTitle('通知', (unread.count || unread.unread || 0) + ' 条未读') +
      '<div class="toolbar"><span class="spacer"></span><button class="btn ghost" onclick="App.readAll()">全部已读</button></div>' +
      (list.length ? list.map((n) => '<div class="notice ' + (n.is_read ? '' : 'unread') + '"><div class="notice-main"><b>' + esc(n.title || n.type || '通知') + '</b><p>' + esc(n.content || n.body || '') + '</p><span>' + esc(fmtDate(n.created_at, true)) + '</span></div>' +
        '<button class="mini" onclick="App.readNotice(' + JSON.stringify(n.id) + ')">标记已读</button></div>').join('') : emptyHtml('没有通知', '有人点赞、评论或加好友时会出现在这里。')) +
      pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('通知读取失败', e.message) + '</div>'); }
}
App.readAll = async () => {
  try { await socialApi(UX.routes.readAll, { method: 'PUT', body: {} }); toast('已全部标记已读', 'ok'); await App.render(); }
  catch (e) { toast(e.message || '操作失败', 'err'); }
};
App.readNotice = async (id) => {
  try { await socialApi('/notifications/' + encodeURIComponent(id) + '/read', { method: 'PUT', body: {} }); await App.render(); }
  catch (e) { toast(e.message || '操作失败', 'err'); }
};

async function socialProfile() {
  if (!requireAuth('登录后查看资料')) return;
  setMain(loadingHtml('正在读取资料…'));
  try {
    const d = await socialApi('/me');
    const u = itemOf(d);
    const stats = itemOf(await socialApi('/stats').catch(() => ({})));
    setMain('<div class="page social-page">' + pageTitle(u.nickname || u.display_name || '我的资料', u.bio || '') +
      '<div class="profile-grid"><div class="profile-card">' + avatar(u.nickname || u.display_name || '我') +
      '<h3>' + esc(u.nickname || u.display_name || '') + '</h3><p>' + esc(u.bio || '') + '</p>' +
      '<div class="profile-meta"><span>only_id</span><b>' + esc(u.only_id || '') + '</b></div>' +
      '<div class="profile-meta"><span>地区</span><b>' + esc(u.region || '—') + '</b></div>' +
      '<button class="btn ghost" onclick="App.editProfile()">编辑资料</button></div>' +
      '<div class="profile-stats">' + ['moments', 'friends', 'messages', 'notifications'].map((k) => '<div class="kpi"><span>' + esc(k) + '</span><b>' + esc(stats[k] || stats[k + '_count'] || 0) + '</b></div>').join('') + '</div></div>' +
      pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('资料读取失败', e.message) + '</div>'); }
}
App.editProfile = () => {
  App.openForm({
    title: '编辑资料', iface: socialIface('/me', 'PUT'), path: '/me', submitLabel: '保存',
    fields: ['nickname', 'bio', 'region'],
    values: state.user || {},
    onSubmit: async (data) => {
      await socialApi('/me', { method: 'PUT', body: data });
      state.user = Object.assign({}, state.user || {}, data);
      saveSession();
      toast('已保存', 'ok');
      renderChrome();
      await App.render();
    },
  });
};
