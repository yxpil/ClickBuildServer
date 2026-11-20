/* 即时聊天模式：会话列表、消息流、发送、已读、未读数。 */

function chatRows() { return state.rows['__chat'] || []; }

async function chatLoad() {
  const data = {};
  data.conversations = rowsOf(await api(UX.auth.iface, UX.routes.conversations));
  data.inbox = rowsOf(await api(UX.auth.iface, UX.routes.messages));
  try { data.unread = itemOf(await api(UX.auth.iface, UX.routes.unread)); } catch (e) { data.unread = {}; }
  state.rows['__chat'] = data;
  return data;
}

function chatPeer(row) {
  return row.peer_only_id || row.only_id || row.from_only_id || row.sender_only_id || row.to_only_id || row.user_only_id || '';
}
function chatPeerName(row) {
  return row.peer_name || row.from_name || row.sender_name || row.nickname || row.name || chatPeer(row) || '对方';
}
function chatText(row) { return row.last_message || row.body || row.content || row.message || ''; }
function chatTime(row) { return row.updated_at || row.created_at || row.sent_at || ''; }
function chatMine(row) {
  const me = state.user && state.user.onlyId;
  if (!me) return false;
  return String(row.from_only_id || row.sender_only_id || '') === String(me);
}

async function chatHome() {
  if (!requireAuth('登录后才能查看会话')) return;
  setMain(loadingHtml('正在读取会话…'));
  try {
    const d = await chatLoad();
    const convs = d.conversations || [];
    const inbox = d.inbox || [];
    const unread = Number(d.unread && (d.unread.count || d.unread.total || d.unread.unread) || 0);
    const rows = convs.length ? convs : inbox;
    const list = rows.length ? rows.map((c) => {
      const active = String(state.params.conv || '') === String(c.id || c.conv_id || chatPeer(c));
      return '<button class="conv ' + (active ? 'on' : '') + '" onclick="App.openChat(' + JSON.stringify(c.id || c.conv_id || chatPeer(c)) + ',' + JSON.stringify(chatPeer(c)) + ',' + JSON.stringify(chatPeerName(c)) + ')">' +
        avatar(chatPeerName(c)) +
        '<span class="conv-main"><b>' + esc(chatPeerName(c)) + '</b><em>' + esc(plain(chatText(c), 34) || '还没有消息') + '</em></span>' +
        '<span class="conv-side"><i>' + esc(fmtDate(chatTime(c), true)) + '</i></span></button>';
    }).join('') : emptyHtml('还没有会话', '注册第二个账号，给对方发第一条消息。');
    setMain('<div class="page chat-page"><div class="chat-shell">' +
      '<aside class="chat-side"><div class="chat-side-head"><b>消息</b><span>' + (unread ? unread + ' 未读' : '全部已读') + '</span></div>' +
      '<div class="chat-side-list">' + list + '</div>' +
      '<button class="btn primary chat-new" onclick="App.newChat()">发起新会话</button></aside>' +
      '<main class="chat-main"><div class="chat-empty"><span class="big-mark">' + esc((UX.mark || 'IM').slice(0, 2)) + '</span><h2>' + esc(UX.home.title) + '</h2><p>' + esc(UX.home.sub) + '</p>' +
      '<div class="chat-meta"><span>会话 ' + convs.length + '</span><span>收件 ' + inbox.length + '</span><span>未读 ' + unread + '</span></div></div></main>' +
      '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('会话读取失败', e.message) + '</div>'); }
}

async function chatThread() {
  if (!requireAuth('登录后才能查看消息')) return;
  setMain(loadingHtml('正在读取消息…'));
  try {
    const d = await chatLoad();
    const peer = state.params.peer || '';
    const convId = state.params.conv || '';
    const inbox = d.inbox || [];
    let msgs = [];
    if (convId && UX.routes.thread) {
      msgs = rowsOf(await api(UX.auth.iface, UX.routes.thread, { params: { id: convId } }));
    } else {
      msgs = inbox.filter((m) => {
        const p = chatPeer(m);
        return (convId && String(m.conv_id || m.conversation_id || '') === String(convId)) || (peer && String(p) === String(peer));
      });
    }
    const incomingUnread = inbox.filter((m) => String(m.conv_id || '') === String(convId) && !chatMine(m) && !Number(m.read_flag));
    if (incomingUnread.length && UX.routes.read) {
      await Promise.all(incomingUnread.map((m) => api(UX.auth.iface, UX.routes.read, { method: 'PUT', params: { id: m.id } }).catch(() => null)));
    }
    msgs = msgs.slice().sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)));
    const list = (d.conversations || []);
    const side = list.length ? list.map((c) => {
      const active = String(convId) === String(c.id || c.conv_id || chatPeer(c));
      return '<button class="conv ' + (active ? 'on' : '') + '" onclick="App.openChat(' + JSON.stringify(c.id || c.conv_id || chatPeer(c)) + ',' + JSON.stringify(chatPeer(c)) + ',' + JSON.stringify(chatPeerName(c)) + ')">' +
        avatar(chatPeerName(c)) + '<span class="conv-main"><b>' + esc(chatPeerName(c)) + '</b><em>' + esc(plain(chatText(c), 30) || '还没有消息') + '</em></span></button>';
    }).join('') : '<div class="chat-side-empty">暂无会话</div>';
    const bubbles = msgs.length ? msgs.map((m) => '<div class="bubble-row ' + (chatMine(m) ? 'mine' : '') + '">' +
      (!chatMine(m) ? avatar(chatPeerName(m)) : '') +
      '<div class="bubble"><p>' + esc(m.body || m.content || m.message || '') + '</p><span>' + esc(fmtDate(m.created_at, true)) + '</span></div></div>').join('')
      : '<div class="chat-empty small"><h3>还没有消息</h3><p>在下面输入第一句，消息会真实写入数据库。</p></div>';
    setMain('<div class="page chat-page"><div class="chat-shell">' +
      '<aside class="chat-side"><div class="chat-side-head"><b>会话</b><span>' + list.length + '</span></div><div class="chat-side-list">' + side + '</div>' +
      '<button class="btn primary chat-new" onclick="App.newChat()">发起新会话</button></aside>' +
      '<main class="chat-main"><div class="chat-thread-head"><div>' + avatar(chatPeerName({ peer_name: state.params.name })) +
      '<b>' + esc(state.params.name || peer || '会话') + '</b><span>真实会话 · ' + msgs.length + ' 条消息</span></div>' +
      '<button class="mini" onclick="App.refreshChat()">刷新</button></div>' +
      '<div class="chat-thread" id="chat-thread">' + bubbles + '</div>' +
      '<div class="chat-compose"><textarea id="chat-input" placeholder="输入消息，Enter 发送"></textarea><button class="btn primary" onclick="App.sendChat()">发送</button></div>' +
      '</main></div>' + pageFoot() + '</div>');
    const input = $('#chat-input');
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.sendChat(); } };
    const thread = $('#chat-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  } catch (e) { setMain('<div class="page">' + emptyHtml('消息读取失败', e.message) + '</div>'); }
}

App.openChat = (conv, peer, name) => {
  state.view = 'thread';
  state.params = { conv, peer, name };
  renderChrome();
  App.render();
};

App.refreshChat = () => App.render();

App.sendChat = async () => {
  const input = $('#chat-input');
  const body = input ? input.value.trim() : '';
  if (!body) return;
  const peer = state.params.peer;
  if (!peer) { toast('缺少收件人 ID，请从新会话发起', 'err'); return; }
  try {
    await api(UX.auth.iface, UX.routes.send, { method: 'POST', body: { to: peer, body, msg_type: 'text' } });
    input.value = '';
    toast('已发送', 'ok');
    await App.render();
  } catch (e) { toast(e.message || '发送失败', 'err'); }
};

App.newChat = () => {
  App.modal({
    title: '发起新会话',
    desc: '输入对方的 only_id。注册另一个账号后，在「我的」里可以看到自己的 only_id。',
    body: '<div class="form"><div class="field"><label>对方 only_id</label><input id="chat-to" placeholder="例如 u_xxxxx"></div>' +
      '<div class="field"><label>第一条消息</label><textarea id="chat-first" placeholder="写点什么…"></textarea></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.startChat()">发送</button>',
  });
};

App.startChat = async () => {
  const to = ($('#chat-to') && $('#chat-to').value || '').trim();
  const body = ($('#chat-first') && $('#chat-first').value || '').trim();
  if (!to) { toast('先填对方 only_id', 'err'); return; }
  if (!body) { toast('先写第一条消息', 'err'); return; }
  try {
    await api(UX.auth.iface, UX.routes.send, { method: 'POST', body: { to, body, msg_type: 'text' } });
    App.closeModal();
    toast('已发送', 'ok');
    App.openChat('', to, to);
  } catch (e) { toast(e.message || '发送失败', 'err'); }
};
