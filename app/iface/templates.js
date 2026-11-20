'use strict';

// 工程模版（案例）：内置主流业务工程 + 把当前工程存成自己的模版。
// 内置案例是完整工程 JSON（app/iface/cases/<file>），和手工/AI 生成走同一套 normalize / validate。
// 这样案例可被审查、可单独改、也可以作为 .yxpn 的种子。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const spec = require('./spec');
const store = require('../store');

const CASES_DIR = path.join(__dirname, 'cases');

const BUILTINS = [
  {
    id: 'builtin:mall', name: '商城', file: 'mall.json',
    description: '用户、商品、购物车、订单；库存防超卖 + 下单两表事务 + 对象存储封面',
    tags: ['电商', '订单', '库存', '用户'],
  },
  {
    id: 'builtin:video', name: '视频站', file: 'video.json',
    description: '用户、分区、视频、评论、收藏；文件上传、播放计数、收藏切换',
    tags: ['内容', '视频', '上传', '互动'],
  },
  {
    id: 'builtin:music', name: '音乐网站', file: 'music.json',
    description: '用户、曲风、歌曲、评论、收藏；音频上传、封面、播放计数与收藏切换',
    tags: ['内容', '音乐', '音频', '互动'],
  },
  {
    id: 'builtin:blog', name: '博客', file: 'blog.json',
    description: '作者、文章、分类、标签、评论；发布流、浏览量、标签多表联查',
    tags: ['内容', 'CMS', '标签'],
  },
  {
    id: 'builtin:novel', name: '小说网站', file: 'novel.json',
    description: '作者、小说、分类、标签、评论；发布流、阅读计数、标签多表联查',
    tags: ['内容', '小说', 'CMS', '标签'],
  },
  {
    id: 'builtin:ticket', name: '工单', file: 'ticket.json',
    description: '客户、工单、回复；派单、回复回写、状态统计',
    tags: ['B2B', '客服', '统计'],
  },
  {
    id: 'builtin:survey', name: '问卷系统', file: 'survey.json',
    description: '公开填写、后台编辑、答卷统计与 CSV 导出；自带可直接使用的问卷前端',
    tags: ['问卷', '表单', '统计'],
  },
  {
    id: 'builtin:signup', name: '活动报名', file: 'signup.json',
    description: '公开报名、名额与重复手机号校验、后台发布、报名名单与 CSV 导出',
    tags: ['活动', '报名', '名额'],
  },
  {
    id: 'builtin:booking', name: '预约', file: 'booking.json',
    description: '服务项目、时段、预约；容量校验、取消释放，全部事务',
    tags: ['本地生活', '预约', '库存'],
  },
  {
    id: 'builtin:crossdb', name: '跨库订单', file: 'crossdb.json',
    description: '订单主表在主库、明细在 clickbuild_aux；两个连接同事务提交，异常一起回滚',
    tags: ['跨库', '事务', '订单'],
  },
  {
    id: 'builtin:social', name: '同频社区', file: 'social.json',
    description: '账户、好友、私聊、群聊、动态、搜索、通知、收藏、文件、举报与统计；onlyId 定身份，打开就是可用的社区业务页面',
    tags: ['社交', '社区', '动态', 'IM'],
  },
  {
    id: 'builtin:chat', name: '聊天 / 即时通讯', file: 'chat.json',
    description: '私聊会话、消息收发、已读回执、未读数；token 识别用户，会话与用户表联查',
    tags: ['IM', '聊天', '消息'],
  },
  {
    id: 'builtin:meeting', name: '视频会议', file: 'meeting.json',
    description: '创建会议室、加入/离开、结束会议并写纪要；参会人数联查',
    tags: ['会议', '视频', '协作'],
  },
  {
    id: 'builtin:crm', name: 'CRM 客户', file: 'crm.json',
    description: '客户、联系人、商机推进与阶段金额统计；一个客户挂多个联系人',
    tags: ['CRM', '销售', '客户'],
  },
  {
    id: 'builtin:edu', name: '在线课程', file: 'edu.json',
    description: '课程、课时、报名与学习进度；报名事务校验名额，防重复报名',
    tags: ['教育', '课程', '报名'],
  },
  {
    id: 'builtin:restaurant', name: '餐饮点餐', file: 'restaurant.json',
    description: '菜单、桌台、开台、加菜、结账；订单金额与库存同事务累计',
    tags: ['餐饮', '点餐', '桌台'],
  },
  {
    id: 'builtin:logistics', name: '物流轨迹', file: 'logistics.json',
    description: '运单、轨迹节点、状态推进；按运单号联查全部节点',
    tags: ['物流', '运单', '轨迹'],
  },
  {
    id: 'builtin:hospital', name: '预约挂号', file: 'hospital.json',
    description: '科室、医生、号源、挂号与取消；号源容量在事务内校验',
    tags: ['医疗', '挂号', '号源'],
  },
  {
    id: 'builtin:finance', name: '费用报销', file: 'finance.json',
    description: '报销提交、审批留痕、按分类汇总；审批人与申请人分离',
    tags: ['财务', '报销', '审批'],
  },
  {
    id: 'builtin:iot', name: 'IoT 设备监控', file: 'iot.json',
    description: '设备注册、SM4 密钥校验、遥测上报、最新值、温度告警',
    tags: ['IoT', '设备', '监控'],
  },
  {
    id: 'builtin:event', name: '活动票务', file: 'event.json',
    description: '活动发布、余票、购票事务、电子票核销与我的票联查',
    tags: ['票务', '活动', '核销'],
  },
  {
    id: 'builtin:netcourse', name: '网课系统', file: 'netcourse.json',
    description: '课程发布、课时目录、报名防重、学习进度、在线考试判分与成绩单',
    tags: ['教育', '网课', '考试'],
  },
  {
    id: 'builtin:decoration', name: '装修报价', file: 'decoration.json',
    description: '面积基价、项目明细、折扣提交与审批；三表联查报价详情',
    tags: ['装修', '报价', '明细'],
  },
  {
    id: 'builtin:printing', name: '印刷报价', file: 'printing.json',
    description: '尺寸/数量/双面/纸价/制版费自动算价，后道工艺逐项累加',
    tags: ['印刷', '报价', '制造'],
  },
  {
    id: 'builtin:softquote', name: '软件项目报价', file: 'softquote.json',
    description: '人天单价、模块工作量、折扣与成交；模块金额自动汇总到项目',
    tags: ['软件', '报价', '项目'],
  },
  {
    id: 'builtin:freight', name: '货运报价', file: 'freight.json',
    description: '线路基价 + 公斤价，实重与体积重取大计费，报价可确认成交',
    tags: ['货运', '报价', '物流'],
  },
];

function projectOf(file) {
  const raw = fs.readFileSync(path.join(CASES_DIR, file), 'utf8');
  return spec.normalizeProject(JSON.parse(raw));
}

function counts(project) {
  return {
    interfaces: project.interfaces.length,
    tables: project.interfaces.reduce((n, i) => n + i.tables.length, 0),
    routes: project.interfaces.reduce((n, i) => n + i.routes.length, 0),
  };
}

function templateDir() {
  const dir = path.join(store.root(), 'templates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 模版名唯一：内置与自定义一起比较，避免模版库出现同名条目。
function nameTaken(name) {
  const key = String(name || '').trim().normalize('NFKC').toLowerCase();
  return list().some((t) => String(t.name || '').trim().normalize('NFKC').toLowerCase() === key);
}

function list() {
  const builtins = BUILTINS.map((t) => {
    try {
      const project = projectOf(t.file);
      return { id: t.id, name: t.name, description: t.description, tags: t.tags, kind: 'builtin', counts: counts(project), createdAt: null };
    } catch (e) {
      return { id: t.id, name: t.name, description: t.description, tags: t.tags, kind: 'builtin', counts: { interfaces: 0, tables: 0, routes: 0 }, createdAt: null, error: e.message };
    }
  });
  const files = fs.readdirSync(templateDir()).filter((f) => f.endsWith('.json'));
  const user = files.map((f) => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(templateDir(), f), 'utf8'));
      return { id: `user:${f.replace(/\.json$/, '')}`, name: data.name, description: data.description || '', tags: data.tags || [], kind: 'user', counts: counts(spec.normalizeProject(data.project)), createdAt: data.createdAt, file: path.join(templateDir(), f) };
    } catch (e) { return null; }
  }).filter(Boolean).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return [...builtins, ...user];
}

function get(id) {
  const key = String(id || '');
  if (key.startsWith('builtin:')) {
    const b = BUILTINS.find((x) => x.id === key);
    if (!b) throw new Error('没有这个内置模版');
    return { kind: 'builtin', name: b.name, file: b.file, project: projectOf(b.file) };
  }
  if (key.startsWith('user:')) {
    const file = path.join(templateDir(), `${key.slice(5)}.json`);
    if (!fs.existsSync(file)) throw new Error('没有这个自定义模版');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { kind: 'user', name: data.name, project: spec.normalizeProject(data.project) };
  }
  throw new Error('模版 id 不合法');
}

function saveAs(name, project, opts) {
  const clean = String(name || '').trim() || '未命名模版';
  if (nameTaken(clean)) throw new Error(`模版名已存在：${clean}`);
  const id = `${store.slug(clean)}-${crypto.randomUUID().slice(0, 6)}`;
  const data = {
    name: clean,
    description: (opts && opts.description) || `${clean}（从工程保存）`,
    tags: (opts && opts.tags) || ['自定义'],
    createdAt: new Date().toISOString(),
    project: spec.normalizeProject(project),
  };
  fs.writeFileSync(path.join(templateDir(), `${id}.json`), JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, id: `user:${id}`, name: clean, file: path.join(templateDir(), `${id}.json`) };
}

function remove(id) {
  const key = String(id || '');
  if (!key.startsWith('user:')) throw new Error('内置模版不能删除');
  const file = path.join(templateDir(), `${key.slice(5)}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { ok: true };
}

module.exports = { BUILTINS, list, get, saveAs, remove, counts };
