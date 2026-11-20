/* 内容站模式：博客 / 小说 / 音乐 / 视频。真实写作、发布、阅读、评论、收藏。 */
function contentRows() { return state.rows[UX.primary.iface] || []; }

async function loadContentRows(force) {
  if (!force && state.rows[UX.primary.iface]) return contentRows();
  const d = await api(UX.primary.iface, UX.primary.list);
  const rows = rowsOf(d);
  state.rows[UX.primary.iface] = rows;
  return rows;
}

async function loadCategories() {
  if (!UX.category) return [];
  if (state.rows[UX.category.iface]) return state.rows[UX.category.iface];
  try {
    const d = await api(UX.category.iface, UX.category.list);
    state.rows[UX.category.iface] = rowsOf(d);
  } catch (e) { state.rows[UX.category.iface] = []; }
  return state.rows[UX.category.iface];
}

function categoryName(list, id) {
  const c = (list || []).find((x) => String(x.id) === String(id));
  return c ? (c.name || c.title || '') : '';
}

function contentVisible(rows) {
  const statusKey = UX.fields.status;
  const hasPublished = rows.some((r) => String(r[statusKey]) === '1');
  let out = hasPublished ? rows.filter((r) => String(r[statusKey]) === '1') : rows.slice();
  const kw = searchValue().toLowerCase();
  if (kw) out = out.filter((r) => JSON.stringify(r).toLowerCase().indexOf(kw) >= 0);
  if (state.params.category) out = out.filter((r) => String(r[UX.fields.category]) === String(state.params.category));
  return out.sort((a, b) => String(b[UX.fields.date] || b.published_at || b.id).localeCompare(String(a[UX.fields.date] || a.published_at || a.id)));
}

function contentCard(row, catList) {
  const title = row[UX.fields.title] || '未命名';
  const date = row[UX.fields.date] || row.published_at || row.created_at;
  const views = row[UX.fields.views] || 0;
  const cat = categoryName(catList, row[UX.fields.category]) || (row.paper || '');
  const unit = UX.media ? ' 次播放' : ' 次阅读';
  return '<article class="card" onclick="App.openContentItem(' + HQ(row.id) + ')">' +
    '<div class="card-cover">' + coverHtml(row, { label: cat || UX.itemLabel }) + '</div>' +
    '<div class="card-body"><div class="card-kicker"><span>' + esc(cat || UX.kicker) + '</span><span>' + esc(fmtDate(date)) + '</span></div>' +
    '<h3>' + esc(title) + '</h3><p>' + esc(plain(row[UX.fields.body], 120) || '打开查看详情。') + '</p>' +
    '<div class="card-foot"><span>' + esc(views) + unit + '</span><span>' + esc(UX.itemLabel) + ' →</span></div></div></article>';
}

async function contentHome() {
  setMain(loadingHtml());
  try {
    const rows = await loadContentRows(true);
    const cats = await loadCategories();
    const list = contentVisible(rows);
    const featured = list[0];
    const rest = (list.length === 1 ? list : list.slice(1, 10));
    const top = rows.slice().sort((a, b) => Number(b[UX.fields.views] || 0) - Number(a[UX.fields.views] || 0)).slice(0, 5);
    const hero = '<section class="hero"><div class="hero-card">' +
      '<div class="eyebrow">' + esc(UX.home.kicker) + '</div><h1>' + esc(UX.home.title) + '</h1>' +
      '<p>' + esc(UX.home.sub) + '</p><div class="hero-actions">' +
      '<button class="btn" onclick="App.go(\'collection\')">' + esc(UX.home.cta) + '</button>' +
      (UX.auth ? '<button class="btn ghost" onclick="App.go(\'admin\')">' + esc(UX.writeLabel) + '</button>' : '') +
      '</div></div>' +
      '<div class="hero-art"><div class="hero-art-head"><span>本期焦点</span><span>' + esc(UX.brand) + '</span></div>' +
      (featured ? '<div class="hero-feature"><span class="big">' + esc(String(featured[UX.fields.views] || 0)) + '</span>' +
        '<b>' + esc(featured[UX.fields.title]) + '</b><span>' + esc(categoryName(cats, featured[UX.fields.category]) || UX.itemLabel) + ' · ' + esc(fmtDate(featured[UX.fields.date])) + '</span></div>' : '<div class="hero-feature"><b>还没有内容</b><span>注册后发布第一篇。</span></div>') +
      '<div class="hero-list">' + top.slice(0, 4).map((r, i) => '<div onclick="App.openContentItem(' + HQ(r.id) + ')" style="cursor:pointer"><span>' + String(i + 1).padStart(2, '0') + ' · ' + esc(short(r[UX.fields.title], 22)) + '</span><em>' + esc(r[UX.fields.views] || 0) + '</em></div>').join('') + '</div>' +
      '</div></section>';
    const chips = '<div class="chips"><button class="chip ' + (!state.params.category ? 'on' : '') + '" onclick="App.go(\'collection\')">全部</button>' +
      cats.map((c) => '<button class="chip ' + (String(state.params.category) === String(c.id) ? 'on' : '') + '" onclick="App.filterCategory(' + HQ(c.id) + ')">' + esc(c.name) + '</button>').join('') + '</div>';
    const section = '<section class="section"><div class="section-head"><div><h2>最新' + esc(UX.itemLabel) + '</h2><p>' + esc(list.length) + ' 条真实内容，按发布时间排序</p></div>' + chips + '</div>' +
      (rest.length ? '<div class="grid">' + rest.map((r) => contentCard(r, cats)).join('') + '</div>' : emptyHtml('还没有公开的' + UX.itemLabel, '到后台' + (UX.media ? '上传' : '写') + '一篇，发布后会出现在这里。')) + '</section>';
    setMain('<div class="page">' + hero + section + pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page">' + emptyHtml('读取失败', e.message) + pageFoot() + '</div>');
  }
}

async function contentCollection() {
  setMain(loadingHtml());
  try {
    const rows = await loadContentRows();
    const cats = await loadCategories();
    const list = contentVisible(rows);
    setMain('<div class="page">' + pageTitle('全部' + UX.itemLabel, '共 ' + list.length + ' 条，点击任意一张进入真实详情页。') +
      toolbar('') +
      '<div class="chips" style="margin-bottom:20px"><button class="chip ' + (!state.params.category ? 'on' : '') + '" onclick="App.go(\'collection\')">全部</button>' +
      cats.map((c) => '<button class="chip ' + (String(state.params.category) === String(c.id) ? 'on' : '') + '" onclick="App.filterCategory(' + HQ(c.id) + ')">' + esc(c.name) + '</button>').join('') + '</div>' +
      (list.length ? '<div class="grid">' + list.map((r) => contentCard(r, cats)).join('') + '</div>' : emptyHtml('没有找到匹配的' + UX.itemLabel, '换一个关键词或分类试试。')) +
      pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>');
  }
}

App.filterCategory = (id) => {
  state.params.category = id;
  App.render();
};

App.openContentItem = (id) => {
  state.params = { id };
  state.view = 'item';
  renderChrome();
  if (UX.primary.read) api(UX.primary.iface, UX.primary.read, { params: { id } }).catch(() => null);
  App.render();
};

function richBody(text) {
  const src = String(text || '').trim();
  if (!src) return '<p class="muted">作者还没有填正文。</p>';
  const blocks = src.split(/\n{2,}/);
  return blocks.map((b) => {
    const t = b.trim();
    if (!t) return '';
    if (/^#{1,3}\s+/.test(t)) return '<h2>' + esc(t.replace(/^#{1,3}\s+/, '')) + '</h2>';
    if (/^[-*]\s+/m.test(t)) {
      return '<ul>' + t.split('\n').filter((x) => /^[-*]\s+/.test(x.trim())).map((x) => '<li>' + esc(x.replace(/^[-*]\s+/, '')) + '</li>').join('') + '</ul>';
    }
    return '<p>' + esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

async function loadComments(row) {
  const c = UX.comments;
  if (!c) return [];
  try {
    let path = c.list;
    let query = null;
    if (path.indexOf(':id') >= 0) path = path.replace(':id', row.id);
    else query = { [c.foreign]: row.id };
    const d = await api(c.iface, path, { query });
    return rowsOf(d);
  } catch (e) { return []; }
}

function mediaUrl(row) {
  if (!row) return '';
  const raw = row.file_url || row.file_key || '';
  if (!raw) return '';
  if (/^https?:|^\//.test(raw)) return raw;
  return '/uploads/' + raw.replace(/^uploads\//, '');
}

function mediaBlock(row) {
  if (!UX.media) return '';
  const url = mediaUrl(row);
  if (!url) {
    return '<div class="empty" style="padding:22px;margin:18px 0">' +
      (state.token ? '还没有上传' + (UX.media === 'audio' ? '音频' : '视频') + '。<button class="btn sm primary" style="margin-left:8px" onclick="App.uploadMedia(' + HQ(row.id) + ')">上传文件</button>' : '作者还没有上传' + (UX.media === 'audio' ? '音频' : '视频') + '。') + '</div>';
  }
  const playHandler = UX.primary.play ? ' onplay="App.mediaPlay(' + JSON.stringify(row.id) + ')"' : '';
  return '<div class="media-box" style="margin:18px 0;background:#0d0d0d;border-radius:14px;overflow:hidden">' +
    (UX.media === 'audio'
      ? '<div style="padding:18px 20px;color:#eee;font-size:13px">' + esc(row.title || '') + '</div><audio controls preload="metadata" src="' + esc(url) + '" style="width:100%;padding:0 14px 14px"' + playHandler + '></audio>'
      : '<video controls preload="metadata" src="' + esc(url) + '" style="width:100%;display:block;max-height:62vh;background:#000"' + playHandler + '></video>') +
    '</div>';
}

App.mediaPlay = (id) => {
  if (!UX.primary.play || state.played[String(id)]) return;
  state.played[String(id)] = true;
  api(UX.primary.iface, UX.primary.play, { params: { id } }).then(() => {
    const row = (state.rows[UX.primary.iface] || []).find((x) => String(x.id) === String(id));
    if (row) row[UX.fields.views] = Number(row[UX.fields.views] || 0) + 1;
    const meta = document.querySelector('.article-meta [data-views]');
    if (meta) meta.textContent = String((parseInt(meta.textContent, 10) || 0) + 1) + (UX.media ? ' 次播放' : ' 次阅读');
  }).catch(() => { state.played[String(id)] = false; });
};

App.uploadMedia = (id) => {
  if (!requireAuth('登录后才能上传')) return;
  if (!UX.primary.upload) { toast('这个案例还没有配置上传接口', 'err'); return; }
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = UX.media === 'audio' ? 'audio/*' : 'video/*';
  picker.onchange = async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    toast('正在上传 ' + file.name + '…', 'ok');
    const fd = new FormData();
    fd.append('file', file, file.name);
    try {
      const res = await fetch(apiUrl(UX.primary.iface, UX.primary.upload, { id }), {
        method: 'POST',
        headers: state.token ? { authorization: 'Bearer ' + state.token } : {},
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.message || json.error || ('上传失败 ' + res.status));
      toast('上传完成', 'ok');
      await App.render();
    } catch (e) { toast(e.message, 'err'); }
  };
  picker.click();
};

function durationText(value) {
  const sec = Number(value || 0);
  if (!sec) return '';
  return sec < 60 ? Math.round(sec) + ' 秒' : Math.round(sec / 60) + ' 分钟';
}

async function contentItem() {
  const id = state.params.id;
  const p = UX.primary;
  setMain(loadingHtml('正在打开' + UX.itemLabel + '…'));
  try {
    const d = await api(p.iface, p.detail, { params: { id } });
    const row = itemOf(d);
    if (!row || !row.id) throw new Error('内容不存在');
    if (p.read) api(p.iface, p.read, { params: { id } }).catch(() => {});
    const comments = await loadComments(row);
    const cats = await loadCategories();
    const cat = categoryName(cats, row[UX.fields.category]);
    let faved = false;
    if (UX.favorites && state.token) {
      try {
        const f = rowsOf(await api(UX.favorites.iface, UX.favorites.list));
        faved = f.some((x) => String(x[UX.favorites.foreign] || x.id) === String(row.id));
      } catch (e) { /* 忽略 */ }
    }
    const actions = [];
    if (UX.favorites) {
      actions.push('<button class="btn ' + (faved ? 'dark' : '') + '" onclick="App.toggleFavorite(' + HQ(row.id) + ')">' + (faved ? '已收藏' : '收藏') + '</button>');
    }
    if (state.token && UX.auth) {
      actions.push('<button class="btn" onclick="App.editContent(' + HQ(row.id) + ')">编辑</button>');
      if (p.publish) actions.push('<button class="btn" onclick="App.publishContent(' + HQ(row.id) + ')">发布</button>');
    }
    const commentHtml = UX.comments ? (
      '<section class="comments"><h3>讨论 · ' + comments.length + '</h3>' +
      (comments.length ? comments.map((c) => '<div class="comment">' + avatar(c[UX.comments.author] || c.author || '读') +
        '<div class="comment-main"><b>' + esc(c[UX.comments.author] || c.author || '读者') + '</b><time>' + esc(fmtDate(c.created_at, true)) + '</time>' +
        '<p>' + esc(c.content) + '</p></div></div>').join('') : '<div class="empty" style="padding:30px">还没有评论，来说第一句。</div>') +
      (state.token
        ? '<div class="comment-form"><textarea id="comment-text" placeholder="写下你的想法…"></textarea><button class="btn primary" onclick="App.submitComment(' + HQ(row.id) + ')">发表评论</button></div>'
        : '<div class="empty" style="padding:24px">登录后参与讨论。<button class="btn sm primary" style="margin-left:8px" onclick="App.login()">登录</button></div>') +
      '</section>'
    ) : '';
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回' + esc(UX.itemLabel) + '</button>' +
      '<span class="pill">' + esc(cat || UX.itemLabel) + '</span></div>' +
      '<article class="article"><div class="eyebrow">' + esc(UX.kicker) + ' · ' + esc(cat || UX.itemLabel) + '</div>' +
      '<h1>' + esc(row[UX.fields.title] || '未命名') + '</h1>' +
      '<div class="article-meta"><span>' + esc(fmtDate(row[UX.fields.date] || row.created_at, true)) + '</span><span data-views>' + esc(row[UX.fields.views] || 0) + (UX.media ? ' 次播放' : ' 次阅读') + '</span>' +
      (row[UX.fields.duration] ? '<span>' + esc(durationText(row[UX.fields.duration])) + '</span>' : '') + '</div>' +
      '<div class="article-cover">' + coverHtml(row, { label: cat || '' }) + '</div>' +
      mediaBlock(row) +
      ((UX.media && !(row.description || row.intro)) ? '' : '<div class="article-body">' + richBody(UX.media ? (row.description || row.intro) : row[UX.fields.body]) + '</div>') +
      '<div class="article-actions">' + actions.join('') + '<button class="btn" onclick="App.goBack(\'collection\')">继续浏览</button></div>' +
      commentHtml + '</article>' + pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page narrow">' + emptyHtml('打不开这个' + UX.itemLabel, e.message) + pageFoot() + '</div>');
  }
}

App.submitComment = async (id) => {
  if (!requireAuth('登录后才能评论')) return;
  const box = $('#comment-text');
  const text = box ? box.value.trim() : '';
  if (!text) { toast('评论不能为空', 'err'); return; }
  const c = UX.comments;
  const body = { content: text };
  body[c.foreign] = id;
  if (c.author === 'author') body.author = (state.user && state.user.name) || '读者';
  else {
    body[c.author] = state.user && state.user.onlyId;
    if (!body[c.author]) { toast('缺少用户身份，请重新登录', 'err'); return; }
  }
  if (c.create === '/comments') body.status = 1;
  try {
    await api(c.iface, c.create, { method: 'POST', body });
    toast('评论已发表', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.toggleFavorite = async (id) => {
  if (!requireAuth('登录后才能收藏')) return;
  try {
    await api(UX.favorites.iface, UX.favorites.toggle, { method: 'POST', body: { [UX.favorites.foreign]: id } });
    toast('收藏状态已更新', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.openRecord = (iface, row) => App.openDetail(iface, row);

App.publishContent = async (id) => {
  const p = UX.primary;
  try {
    await api(p.iface, p.publish, { method: 'POST', params: { id }, body: {} });
    toast('已发布', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.editContent = (id) => {
  const row = (state.rows[UX.primary.iface] || []).find((x) => String(x.id) === String(id));
  if (!row) { toast('请先刷新列表', 'err'); return; }
  openForm({
    title: '编辑' + UX.itemLabel,
    iface: UX.primary.iface,
    path: UX.primary.update,
    fields: contentWriteFields(),
    values: row,
    submitLabel: '保存修改',
    onSubmit: async (data) => {
      await api(UX.primary.iface, UX.primary.update, { method: 'PUT', params: { id }, body: data });
      toast('已保存', 'ok');
      await App.render();
    },
  });
};

function contentWriteFields() {
  return UX.fieldKeys || (UX.media ? ['title', 'category_id', 'duration', 'status'] : ['title', 'slug', 'category_id', 'content', 'status']);
}

async function contentAdmin() {
  const tab = state.params.tab || 'primary';
  setMain(loadingHtml());
  try {
    const cats = await loadCategories();
    const primaryRows = await loadContentRows(true);
    let commentRows = [];
    if (tab === 'comments' && UX.comments) {
      try { commentRows = rowsOf(await api(UX.comments.iface, UX.comments.list.replace(':id', ''))); } catch (e) { commentRows = []; }
    }
    const tabs = [
      { id: 'primary', label: UX.itemLabel },
      { id: 'categories', label: UX.category ? '分类' : '—' },
      { id: 'comments', label: '评论' },
    ].filter((x) => x.label !== '—');
    const tabsHtml = '<div class="chips" style="margin-bottom:18px">' + tabs.map((t) =>
      '<button class="chip ' + (tab === t.id ? 'on' : '') + '" onclick="App.adminTab(' + HQ(t.id) + ')">' + esc(t.label) + '</button>').join('') + '</div>';
    let body = '';
    if (tab === 'primary') {
      body = '<div class="toolbar"><button class="btn primary" onclick="App.newContent()">+ ' + esc(UX.writeLabel) + '</button><span class="spacer"></span>' +
        '<span class="faint">共 ' + primaryRows.length + ' 条</span></div>' +
        tableHTML(UX.primary.iface, primaryRows, ['title', 'status', 'views', 'created_at'], {
          emptyTitle: '还没有' + UX.itemLabel,
          actions: (row) => '<button class="btn sm" onclick="event.stopPropagation();App.editContent(' + HQ(row.id) + ')">编辑</button>' +
            (UX.media ? '<button class="btn sm primary" onclick="event.stopPropagation();App.uploadMedia(' + HQ(row.id) + ')">上传文件</button>' : '') +
            (UX.primary.publish ? '<button class="btn sm" onclick="event.stopPropagation();App.publishContent(' + HQ(row.id) + ')">发布</button>' : '') +
            '<button class="btn sm danger" onclick="event.stopPropagation();App.deleteContent(' + HQ(row.id) + ')">删除</button>',
        });
    } else if (tab === 'categories') {
      body = '<div class="toolbar"><button class="btn primary" onclick="App.newCategory()">+ 新建分类</button><span class="spacer"></span><span class="faint">共 ' + cats.length + ' 个分类</span></div>' +
        tableHTML(UX.category.iface, cats, ['name', 'slug', 'sort'], {
          emptyTitle: '还没有分类',
          actions: (row) => '<button class="btn sm danger" onclick="event.stopPropagation();App.deleteCategory(' + HQ(row.id) + ')">删除</button>',
        });
    } else {
      body = tableHTML(UX.comments.iface, commentRows, ['author', 'content', 'status', 'created_at'], {
        emptyTitle: '还没有评论',
        actions: (row) => '<button class="btn sm danger" onclick="event.stopPropagation();App.deleteComment(' + HQ(row.id) + ')">删除</button>',
      });
    }
    setMain('<div class="page">' + pageTitle('内容后台', '在这里写、改、发布，也可以管理分类和评论。') + tabsHtml + body + pageFoot() + '</div>');
  } catch (e) {
    setMain('<div class="page">' + emptyHtml('后台读取失败', e.message) + '</div>');
  }
}

App.adminTab = (tab) => { state.params.tab = tab; App.render(); };

App.newContent = () => {
  if (!requireAuth()) return;
  const p = UX.primary;
  openForm({
    title: UX.writeLabel,
    desc: '标题和正文是必填项；保存后可以再点“发布”。',
    iface: p.iface,
    path: p.create,
    fields: contentWriteFields(),
    submitLabel: '保存草稿',
    onSubmit: async (data) => {
      if (!data[UX.fields.title]) throw new Error('标题不能为空');
      const created = await api(p.iface, p.create, { method: 'POST', body: data });
      toast('已保存，可在列表里继续编辑或发布', 'ok');
      await App.render();
      if (UX.media && created && created.id) App.uploadMedia(created.id);
    },
  });
};

App.newCategory = () => {
  if (!requireAuth()) return;
  openForm({
    title: '新建分类', iface: UX.category.iface, path: UX.category.create, submitLabel: '创建',
    onSubmit: async (data) => {
      await api(UX.category.iface, UX.category.create, { method: 'POST', body: data });
      toast('分类已创建', 'ok');
      await App.render();
    },
  });
};

App.deleteContent = async (id) => {
  if (!(await confirmBox('删除这条内容？删除后不能恢复。'))) return;
  try {
    await api(UX.primary.iface, UX.primary.remove, { method: 'DELETE', params: { id } });
    toast('已删除', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.deleteCategory = async (id) => {
  if (!(await confirmBox('删除这个分类？'))) return;
  try {
    await api(UX.category.iface, UX.category.remove, { method: 'DELETE', params: { id } });
    toast('已删除', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

App.deleteComment = async (id) => {
  if (!(await confirmBox('删除这条评论？'))) return;
  try {
    await api(UX.comments.iface, UX.comments.remove, { method: 'DELETE', params: { id } });
    toast('已删除', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

async function contentMy() {
  if (!UX.favorites) { App.go('admin'); return; }
  if (!state.token) { setMain('<div class="page">' + emptyHtml('登录后查看收藏', '收藏数据按账号保存。') + '<div style="text-align:center"><button class="btn primary" onclick="App.login()">登录</button></div></div>'); return; }
  setMain(loadingHtml());
  try {
    const rows = rowsOf(await api(UX.favorites.iface, UX.favorites.list));
    setMain('<div class="page">' + pageTitle('我的收藏', '共 ' + rows.length + ' 条，收藏关系存在真实数据表里。') +
      (rows.length ? '<div class="grid">' + rows.map((r) => {
        const title = r.title || r.name || '未命名';
        return '<div class="card" onclick="App.openContentItem(' + HQ(r[UX.favorites.foreign] || r.id) + ')"><div class="card-cover">' + coverHtml(r) + '</div><div class="card-body"><h3>' + esc(title) + '</h3><div class="card-foot"><span>已收藏</span><span>' + esc(UX.itemLabel) + ' →</span></div></div></div>';
      }).join('') + '</div>' : emptyHtml('还没有收藏', '点开一首歌或一个视频，点“收藏”就会出现在这里。')) + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

MODES.content = {
  home: contentHome,
  collection: contentCollection,
  item: contentItem,
  admin: contentAdmin,
  my: contentMy,
};
