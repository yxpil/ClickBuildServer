/* 目录/预约模式：到店预约、课程报名、网课学习、医院挂号。 */
function catalogRows() { return state.rows[UX.primary.iface] || []; }

function catalogCard(row) {
  const title = row.title || row.name || '未命名';
  const sub = row.teacher || row.floor || row.duration || '';
  const price = row.price != null ? fmtMoney(row.price) : (row.fee != null ? '挂号费 ' + fmtMoney(row.fee) : '');
  const meta = UX.flow === 'course' || UX.flow === 'netcourse'
    ? ('名额 ' + esc(row.enrolled || 0) + ' / ' + esc(row.seats || '不限'))
    : (UX.flow === 'hospital' ? ('楼层 ' + esc(row.floor || '—')) : ('时长 ' + esc(row.duration || '—') + ' 分钟'));
  return '<article class="card" onclick="App.openCatalogItem(' + JSON.stringify(row.id) + ')">' +
    '<div class="card-cover">' + coverHtml(row, { label: UX.itemLabel }) + '</div>' +
    '<div class="card-body"><div class="card-kicker"><span>' + esc(sub || UX.kicker) + '</span><span>' + esc(meta) + '</span></div>' +
    '<h3>' + esc(title) + '</h3><p>' + esc(plain(row.intro || row.requirement || row.name || '', 100) || '打开查看可约时间与详情。') + '</p>' +
    '<div class="card-foot"><span class="price">' + esc(price || '免费') + '</span><span>查看 →</span></div></div></article>';
}

async function catalogHome() {
  setMain(loadingHtml());
  try {
    const rows = rowsOf(await api(UX.primary.iface, UX.primary.list));
    state.rows[UX.primary.iface] = rows;
    const list = filterKeyword(rows, UX.flow === 'hospital' ? ['name', 'floor'] : ['title', 'name', 'teacher']);
    const hero = '<section class="hero"><div class="hero-card">' +
      '<div class="eyebrow">' + esc(UX.home.kicker) + '</div><h1>' + esc(UX.home.title) + '</h1><p>' + esc(UX.home.sub) + '</p>' +
      '<div class="hero-actions"><button class="btn" onclick="App.go(\'collection\')">' + esc(UX.home.cta) + '</button>' +
      (UX.auth ? '<button class="btn ghost" onclick="App.login()">登录 / 注册</button>' : '') + '</div></div>' +
      '<div class="hero-art"><div class="hero-art-head"><span>可约目录</span><span>' + esc(UX.mark) + '</span></div>' +
      (list[0] ? '<div class="hero-feature"><span class="big">' + esc(String(list.length)) + '</span><b>' + esc(list[0].title || list[0].name) + '</b><span>现在可以开始选择</span></div>' : '') +
      '<div class="hero-list">' + list.slice(0, 4).map((r) => '<div><span>' + esc(short(r.title || r.name, 20)) + '</span><em>' + esc(r.price != null ? fmtMoney(r.price) : (r.floor || '—')) + '</em></div>').join('') + '</div></div></section>';
    setMain('<div class="page">' + hero + '<section class="section"><div class="section-head"><div><h2>全部' + esc(UX.itemLabel) + '</h2><p>共 ' + list.length + ' 个可选项目</p></div></div>' +
      (list.length ? '<div class="grid">' + list.map(catalogCard).join('') + '</div>' : emptyHtml('还没有可选项', '到管理后台先建一个。')) + '</section>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

async function catalogCollection() { return catalogHome(); }

App.openCatalogItem = (id) => {
  state.params = { id };
  state.view = 'item';
  renderChrome();
  App.render();
};

async function catalogItem() {
  if (UX.flow === 'booking') return bookingItem();
  if (UX.flow === 'hospital') return hospitalItem();
  return courseItem();
}

/* ---- 到店预约 ---- */
async function bookingItem() {
  const id = state.params.id;
  setMain(loadingHtml());
  try {
    const services = await (async () => {
      if (state.rows[UX.primary.iface]) return state.rows[UX.primary.iface];
      const d = rowsOf(await api(UX.primary.iface, UX.primary.list)); state.rows[UX.primary.iface] = d; return d;
    })();
    const service = services.find((x) => String(x.id) === String(id));
    if (!service) throw new Error('服务不存在');
    const slots = rowsOf(await api(UX.slot.iface, UX.slot.list));
    state.rows[UX.slot.iface] = slots;
    const mine = slots.filter((s) => String(s.service_id) === String(id));
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回服务列表</button><span class="pill ok">' + esc(service.status == 1 ? '可预约' : '暂停预约') + '</span></div>' +
      '<div class="panel" style="padding:30px"><div class="eyebrow">' + esc(UX.kicker) + '</div><h1 style="font-size:32px;margin:10px 0 12px">' + esc(service.name) + '</h1>' +
      '<p class="muted">时长 ' + esc(service.duration) + ' 分钟 · ' + fmtMoney(service.price) + '</p>' +
      '<div class="section" style="margin-top:26px"><div class="section-head"><h2 style="font-size:17px">可约时段</h2><span class="faint">选中后提交预约，名额实时扣减</span></div>' +
      (mine.length ? mine.map((s) => {
        const left = Number(s.capacity) - Number(s.booked);
        const dayText = fmtDay(s.day);
        const timeMatch = (v) => { const m = String(v || '').match(/(\d{1,2}:\d{2})/); return m ? m[1] : String(v || ''); };
        return '<div class="cart-line"><div class="thumb">' + esc(dayText.slice(5)) + '</div><div class="info"><b>' + esc(dayText) + ' · ' + esc(timeMatch(s.start_time)) + ' - ' + esc(timeMatch(s.end_time)) + '</b><span>剩余 ' + left + ' / ' + s.capacity + ' 个名额</span></div>' +
          '<button class="btn sm primary" ' + (left <= 0 ? 'disabled' : '') + ' onclick="App.bookSlot(' + JSON.stringify(s.id) + ')">' + (left <= 0 ? '已满' : '预约') + '</button></div>';
      }).join('') : emptyHtml('这个项目还没有开放时段', '到预约管理里先放号。')) + '</div></div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('打不开预约页', e.message) + '</div>'); }
}

App.bookSlot = (slotId) => {
  const phone = storeGet('cbs-app:' + CASE.code + ':phone', '');
  modal({
    title: '填写预约信息',
    desc: '提交后会占用一个名额，取消预约会释放。',
    width: 520,
    body: '<div class="form"><div class="field"><label>姓名</label><input data-field="customer" placeholder="怎么称呼你"></div>' +
      '<div class="field"><label>电话</label><input data-field="phone" value="' + esc(phone) + '" placeholder="方便店家联系"></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.submitBooking(' + JSON.stringify(slotId) + ')">确认预约</button>',
  });
};

App.submitBooking = async (slotId) => {
  const data = readForm($('#modal-body'));
  if (!data.customer || !data.phone) { toast('姓名和电话都要填', 'err'); return; }
  try {
    await api(UX.record.iface, UX.record.create, { method: 'POST', body: { slot_id: slotId, service_id: state.params.id, customer: data.customer, phone: data.phone } });
    storeSet('cbs-app:' + CASE.code + ':phone', data.phone);
    App.closeModal();
    toast('预约成功', 'ok');
    App.render();
  } catch (e) { toast(e.message, 'err'); }
};

/* ---- 课程 / 网课 ---- */
async function courseItem() {
  const id = state.params.id;
  setMain(loadingHtml());
  try {
    const d = await api(UX.primary.iface, UX.primary.detail, { params: { id } });
    const course = itemOf(d);
    const lessons = course.__lessons || d.lessons || [];
    const enrolled = rowsOf(state.rows[UX.record.iface] || []);
    let mine = null;
    if (state.token) {
      try { mine = rowsOf(await api(UX.record.iface, UX.record.mine)).find((x) => String(x.course_id || x.title) === String(course.id) || x.title === course.title); } catch (e) {}
    }
    const published = UX.flow === 'netcourse' ? course.status === 'published' : true;
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回课程</button><span class="pill ' + (published ? 'ok' : 'warn') + '">' + (published ? '可报名' : esc(course.status || '未发布')) + '</span></div>' +
      '<div class="panel" style="padding:30px"><div class="eyebrow">' + esc(UX.kicker) + '</div><h1 style="font-size:32px;margin:10px 0 12px">' + esc(course.title) + '</h1>' +
      '<p class="muted">' + esc(course.intro || course.teacher || '') + '</p>' +
      '<div class="detail-grid"><div><label>价格</label><b>' + fmtMoney(course.price) + '</b></div>' +
      (UX.flow === 'course' ? '<div><label>讲师</label><b>' + esc(course.teacher || '—') + '</b></div><div><label>名额</label><b>' + esc(course.enrolled || 0) + ' / ' + esc(course.seats || '不限') + '</b></div>' : '<div><label>课时</label><b>' + esc(course.lesson_count || lessons.length) + '</b></div>') +
      '<div><label>浏览</label><b>' + esc(course.views || 0) + '</b></div></div>' +
      '<div class="hero-actions">' + (mine
        ? '<button class="btn dark" onclick="App.go(\'my\')">已报名 · 去学习</button>'
        : '<button class="btn primary" onclick="App.enrollCourse(' + JSON.stringify(course.id) + ')" ' + (!published ? 'disabled' : '') + '>立即报名</button>') +
      '<button class="btn" onclick="App.goBack(\'collection\')">看看别的</button></div>' +
      '<div class="section"><div class="section-head"><h2 style="font-size:17px">课程目录</h2><span class="faint">' + lessons.length + ' 个课时</span></div>' +
      (lessons.length ? lessons.map((l, i) => '<div class="cart-line"><div class="thumb">' + String(i + 1).padStart(2, '0') + '</div><div class="info"><b>' + esc(l.title) + '</b><span>' + esc(l.duration || 0) + ' 分钟' + (l.video_url ? ' · 视频' : '') + '</span></div>' +
        (l.video_url ? '<a class="btn sm" href="' + esc(l.video_url) + '" target="_blank" rel="noreferrer">预览</a>' : '') + '</div>').join('') : emptyHtml('还没有课时', '讲师还在备课。')) + '</div>' +
      '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('打不开课程', e.message) + '</div>'); }
}

App.enrollCourse = async (id) => {
  if (!requireAuth('登录后才能报名')) return;
  try {
    await api(UX.record.iface, UX.record.create, { method: 'POST', params: { id }, body: {} });
    toast('报名成功', 'ok');
    App.go('my');
  } catch (e) { toast(e.message, 'err'); }
};

/* ---- 医院 ---- */
async function hospitalItem() {
  const id = state.params.id;
  setMain(loadingHtml());
  try {
    const depts = state.rows[UX.primary.iface] || rowsOf(await api(UX.primary.iface, UX.primary.list));
    const dept = depts.find((x) => String(x.id) === String(id));
    if (!dept) throw new Error('科室不存在');
    const doctors = rowsOf(await api(UX.doctor.iface, UX.doctor.list, { params: { id } }));
    const slots = rowsOf(await api(UX.slot.iface, UX.slot.list));
    state.rows[UX.doctor.iface] = doctors;
    state.rows[UX.slot.iface] = slots;
    setMain('<div class="page narrow"><div class="detail-head"><button class="back" onclick="App.goBack(\'collection\')">← 返回科室</button><span class="pill">' + esc(dept.floor || '门诊') + '</span></div>' +
      '<div class="panel" style="padding:30px"><div class="eyebrow">' + esc(UX.kicker) + '</div><h1 style="font-size:32px;margin:10px 0 12px">' + esc(dept.name) + '</h1>' +
      '<p class="muted">楼层 ' + esc(dept.floor || '—') + ' · 电话 ' + esc(dept.phone || '—') + '</p>' +
      '<div class="section"><div class="section-head"><h2 style="font-size:17px">出诊医生</h2><span class="faint">选择医生后查看号源</span></div>' +
      (doctors.length ? '<div class="grid">' + doctors.map((doc) => '<article class="card"><div class="card-body"><div class="card-kicker"><span>' + esc(doc.title || '医生') + '</span><span>' + fmtMoney(doc.fee) + '</span></div><h3>' + esc(doc.name) + '</h3>' +
        '<button class="btn sm primary" style="margin-top:auto" onclick="App.showDoctorSlots(' + JSON.stringify(doc.id) + ')">查看号源</button></div></article>').join('') + '</div>' : emptyHtml('科室还没有医生', '到门诊管理里添加。')) + '</div></div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('打不开科室', e.message) + '</div>'); }
}

App.showDoctorSlots = (doctorId) => {
  const slots = (state.rows[UX.slot.iface] || []).filter((s) => String(s.doctor_id) === String(doctorId));
  const doc = (state.rows[UX.doctor.iface] || []).find((x) => String(x.id) === String(doctorId));
  modal({
    title: (doc ? doc.name : '医生') + ' 的号源',
    desc: '挂号会占用号源；取消挂号会释放。',
    width: 600,
    body: slots.length ? slots.map((s) => {
      const left = Number(s.capacity) - Number(s.booked);
      return '<div class="cart-line"><div class="thumb">' + esc(String(s.day).slice(5, 10)) + '</div><div class="info"><b>' + esc(s.day) + ' · ' + esc(doc ? doc.name : '') + '</b><span>剩余 ' + left + ' / ' + s.capacity + '</span></div>' +
        '<button class="btn sm primary" ' + (left <= 0 ? 'disabled' : '') + ' onclick="App.bookAppointment(' + JSON.stringify(s.id) + ')">' + (left <= 0 ? '已满' : '挂号') + '</button></div>';
    }).join('') : emptyHtml('这个医生还没有号源', '到门诊管理里放号。'),
    foot: '<button class="btn" onclick="App.closeModal()">关闭</button>',
  });
};

App.bookAppointment = async (slotId) => {
  if (!requireAuth('登录后才能挂号')) return;
  try {
    await api(UX.record.iface, UX.record.create, { method: 'POST', body: { slot_id: slotId } });
    App.closeModal();
    toast('挂号成功', 'ok');
    App.go('my');
  } catch (e) { toast(e.message, 'err'); }
};

/* ---- 我的 ---- */
async function catalogMy() {
  if (UX.flow === 'booking') {
    setMain(loadingHtml());
    try {
      const rows = rowsOf(await api(UX.record.iface, UX.record.list));
      state.rows[UX.record.iface] = rows;
      setMain('<div class="page">' + pageTitle('我的预约', '所有预约单都在这里，可以取消释放名额。') +
        (rows.length ? tableHTML(UX.record.iface, rows, ['customer', 'phone', 'service_id', 'slot_id', 'status'], {
          emptyTitle: '还没有预约',
          actions: (row) => '<button class="btn sm danger" onclick="event.stopPropagation();App.cancelBooking(' + JSON.stringify(row.id) + ')">取消</button>',
        }) : emptyHtml('还没有预约', '去选一个服务和时间。')) + pageFoot() + '</div>');
    } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
    return;
  }
  if (UX.flow === 'hospital') {
    if (!state.token) { setMain('<div class="page">' + emptyHtml('登录后查看挂号', '挂号记录按账号保存。') + '<div style="text-align:center"><button class="btn primary" onclick="App.login()">登录</button></div></div>'); return; }
    setMain(loadingHtml());
    try {
      const rows = rowsOf(await api(UX.record.iface, UX.record.mine));
      state.rows[UX.record.iface] = rows;
      setMain('<div class="page">' + pageTitle('我的挂号', '取消后号源会立即释放。') +
        (rows.length ? tableHTML(UX.record.iface, rows, ['doctor', 'day', 'status'], {
          emptyTitle: '还没有挂号',
          actions: (row) => '<button class="btn sm danger" onclick="event.stopPropagation();App.cancelAppointment(' + JSON.stringify(row.id) + ')">取消</button>',
        }) : emptyHtml('还没有挂号', '去科室页选医生和号源。')) + pageFoot() + '</div>');
    } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
    return;
  }
  if (!state.token) { setMain('<div class="page">' + emptyHtml('登录后查看我的课程', '学习进度按账号保存。') + '<div style="text-align:center"><button class="btn primary" onclick="App.login()">登录</button></div></div>'); return; }
  setMain(loadingHtml());
  try {
    const courses = rowsOf(await api(UX.record.iface, UX.record.mine));
    state.rows[UX.record.iface] = courses;
    let exams = [];
    if (UX.record.exams) { try { exams = rowsOf(await api(UX.record.iface, UX.record.exams)); } catch (e) {} }
    setMain('<div class="page">' + pageTitle('我的学习', '进度、考试和成绩都是真实数据。') +
      (courses.length ? '<div class="grid">' + courses.map((c) => '<article class="card"><div class="card-body"><div class="card-kicker"><span>' + esc(c.teacher || '课程') + '</span><span>进度 ' + esc(c.progress || 0) + '%</span></div><h3>' + esc(c.title) + '</h3>' +
        '<div style="height:7px;background:var(--soft);border-radius:99px;overflow:hidden;margin-top:6px"><div style="height:100%;width:' + Math.max(0, Math.min(100, Number(c.progress || 0))) + '%;background:var(--accent)"></div></div>' +
        '<div class="card-foot"><button class="btn sm" onclick="App.updateProgress(' + JSON.stringify(c.id) + ',' + JSON.stringify(c.progress || 0) + ')">更新进度</button>' +
        (UX.record.exam ? '<button class="btn sm primary" onclick="App.takeExam(' + JSON.stringify(c.course_id || c.id) + ')">提交考试</button>' : '') + '</div></div></article>').join('') + '</div>' : emptyHtml('还没有报名课程', '去课程库挑一门。')) +
      (exams.length ? '<section class="section"><div class="section-head"><h2>我的成绩</h2></div>' + tableHTML(UX.record.iface, exams, ['title', 'score', 'passed'], { emptyTitle: '还没有成绩' }) + '</section>' : '') +
      pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('读取失败', e.message) + '</div>'); }
}

App.cancelBooking = async (id) => {
  if (!(await confirmBox('取消这条预约？名额会释放。'))) return;
  try { await api(UX.record.iface, UX.record.cancel, { method: 'POST', params: { id }, body: {} }); toast('已取消', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};
App.cancelAppointment = async (id) => {
  if (!(await confirmBox('取消这次挂号？号源会释放。'))) return;
  try { await api(UX.record.iface, UX.record.cancel, { method: 'PUT', params: { id }, body: {} }); toast('已取消', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};

App.updateProgress = (id, current) => {
  modal({
    title: '更新学习进度',
    body: '<div class="form"><div class="field full"><label>完成进度（0-100）</label><input data-field="progress" type="number" min="0" max="100" value="' + esc(current) + '"></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.saveProgress(' + JSON.stringify(id) + ')">保存</button>',
  });
};
App.saveProgress = async (id) => {
  const data = readForm($('#modal-body'));
  try { await api(UX.record.iface, UX.record.progress, { method: 'PUT', params: { id }, body: { progress: Number(data.progress || 0) } }); App.closeModal(); toast('已更新', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};
App.takeExam = (courseId) => {
  modal({
    title: '提交考试',
    desc: '填写分数，服务端会根据 60 分线自动判分。',
    body: '<div class="form"><div class="field full"><label>分数</label><input data-field="score" type="number" min="0" max="100" value="80"></div></div>',
    foot: '<button class="btn" onclick="App.closeModal()">取消</button><button class="btn primary" onclick="App.submitExam(' + JSON.stringify(courseId) + ')">提交</button>',
  });
};
App.submitExam = async (courseId) => {
  const data = readForm($('#modal-body'));
  try { await api(UX.record.iface, UX.record.exam, { method: 'POST', body: { course_id: courseId, score: Number(data.score || 0) } }); App.closeModal(); toast('成绩已记录', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};

/* ---- 管理 ---- */
async function catalogAdmin() {
  setMain(loadingHtml());
  try {
    if (UX.flow === 'booking') {
      const services = rowsOf(await api(UX.primary.iface, UX.primary.list));
      const slots = rowsOf(await api(UX.slot.iface, UX.slot.list));
      const bookings = rowsOf(await api(UX.record.iface, UX.record.list));
      state.rows[UX.primary.iface] = services; state.rows[UX.slot.iface] = slots; state.rows[UX.record.iface] = bookings;
      setMain('<div class="page">' + pageTitle('预约管理', '服务、时段、预约单三层联动。') +
        '<div class="toolbar"><button class="btn primary" onclick="App.newService()">+ 新增服务</button><button class="btn" onclick="App.newSlot()">+ 放号</button></div>' +
        '<div class="panel"><div class="panel-head"><h3>服务项目</h3></div>' + tableHTML(UX.primary.iface, services, ['name', 'price', 'duration', 'status']) + '</div>' +
        '<div class="panel"><div class="panel-head"><h3>时段</h3></div>' + tableHTML(UX.slot.iface, slots, ['service_id', 'day', 'start_time', 'end_time', 'capacity', 'booked']) + '</div>' +
        '<div class="panel"><div class="panel-head"><h3>预约单</h3></div>' + tableHTML(UX.record.iface, bookings, ['customer', 'phone', 'service_id', 'slot_id', 'status']) + '</div>' + pageFoot() + '</div>');
      return;
    }
    if (UX.flow === 'hospital') {
      const depts = rowsOf(await api(UX.primary.iface, UX.primary.list));
      const slots = rowsOf(await api(UX.slot.iface, UX.slot.list));
      state.rows[UX.primary.iface] = depts; state.rows[UX.slot.iface] = slots;
      setMain('<div class="page">' + pageTitle('门诊管理', '科室、医生、号源层层挂接。') +
        '<div class="toolbar"><button class="btn primary" onclick="App.newDepartment()">+ 新增科室</button><button class="btn" onclick="App.newDoctor()">+ 新增医生</button><button class="btn" onclick="App.newHospitalSlot()">+ 放号</button></div>' +
        '<div class="panel"><div class="panel-head"><h3>科室</h3></div>' + tableHTML(UX.primary.iface, depts, ['name', 'floor', 'phone'], {
          actions: (row) => '<button class="btn sm" onclick="event.stopPropagation();App.listDoctors(' + JSON.stringify(row.id) + ')">医生</button>',
        }) + '</div>' +
        '<div class="panel"><div class="panel-head"><h3>号源</h3></div>' + tableHTML(UX.slot.iface, slots, ['doctor_id', 'day', 'capacity', 'booked']) + '</div>' + pageFoot() + '</div>');
      return;
    }
    const courses = rowsOf(await api(UX.primary.iface, UX.primary.list));
    state.rows[UX.primary.iface] = courses;
    setMain('<div class="page">' + pageTitle(UX.flow === 'netcourse' ? '讲师后台' : '课程管理', '建课、加课时、发布，全部真实落库。') +
      '<div class="toolbar"><button class="btn primary" onclick="App.newCourse()">+ ' + esc(UX.writeLabel) + '</button></div>' +
      '<div class="panel"><div class="panel-head"><h3>课程</h3><span class="faint">' + courses.length + ' 门</span></div>' +
      tableHTML(UX.primary.iface, courses, ['title', 'price', 'status', 'created_at'], {
        actions: (row) => '<button class="btn sm" onclick="event.stopPropagation();App.addLesson(' + JSON.stringify(row.id) + ')">加课时</button>' +
          (UX.primary.publish ? '<button class="btn sm primary" onclick="event.stopPropagation();App.publishCourse(' + JSON.stringify(row.id) + ')">发布</button>' : ''),
      }) + '</div>' + pageFoot() + '</div>');
  } catch (e) { setMain('<div class="page">' + emptyHtml('后台读取失败', e.message) + '</div>'); }
}

App.newService = () => openForm({ title: '新增服务', iface: UX.primary.iface, path: UX.primary.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: d }); toast('已创建', 'ok'); await App.render(); } });
App.newSlot = () => openForm({ title: '放号', iface: UX.slot.iface, path: UX.slot.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.slot.iface, UX.slot.create, { method: 'POST', body: d }); toast('已放号', 'ok'); await App.render(); } });
App.newDepartment = () => openForm({ title: '新增科室', iface: UX.primary.iface, path: UX.primary.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: d }); toast('已创建', 'ok'); await App.render(); } });
App.newDoctor = () => openForm({ title: '新增医生', iface: UX.doctor.iface, path: UX.doctor.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.doctor.iface, UX.doctor.create, { method: 'POST', body: d }); toast('已创建', 'ok'); await App.render(); } });
App.newHospitalSlot = () => openForm({ title: '放号', iface: UX.slot.iface, path: UX.slot.create, submitLabel: '创建', onSubmit: async (d) => { await api(UX.slot.iface, UX.slot.create, { method: 'POST', body: d }); toast('已放号', 'ok'); await App.render(); } });
App.listDoctors = async (deptId) => {
  try {
    const docs = rowsOf(await api(UX.doctor.iface, UX.doctor.list, { params: { id: deptId } }));
    modal({ title: '科室医生', body: docs.length ? docs.map((d) => '<div class="cart-line"><div class="thumb">' + esc(String(d.name).slice(0, 1)) + '</div><div class="info"><b>' + esc(d.name) + '</b><span>' + esc(d.title || '') + ' · ' + fmtMoney(d.fee) + '</span></div></div>').join('') : emptyHtml('还没有医生', ''), foot: '<button class="btn" onclick="App.closeModal()">关闭</button>' });
  } catch (e) { toast(e.message, 'err'); }
};
App.newCourse = () => openForm({ title: UX.writeLabel, iface: UX.primary.iface, path: UX.primary.create, submitLabel: '创建课程', onSubmit: async (d) => { await api(UX.primary.iface, UX.primary.create, { method: 'POST', body: d }); toast('已创建', 'ok'); await App.render(); } });
App.addLesson = (id) => openForm({ title: '添加课时', iface: UX.lesson.iface, path: UX.lesson.add, params: { id }, submitLabel: '添加', onSubmit: async (d) => { await api(UX.lesson.iface, UX.lesson.add, { method: 'POST', params: { id }, body: d }); toast('已添加', 'ok'); await App.render(); } });
App.publishCourse = async (id) => {
  try { await api(UX.primary.iface, UX.primary.publish, { method: 'PUT', params: { id }, body: {} }); toast('已发布', 'ok'); App.render(); } catch (e) { toast(e.message, 'err'); }
};

MODES.catalog = {
  home: catalogHome,
  collection: catalogCollection,
  item: catalogItem,
  my: catalogMy,
  admin: catalogAdmin,
};
