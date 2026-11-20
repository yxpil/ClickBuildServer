const fs = require('fs');
const path = require('path');
const seeds = require('./case-seeds');
// 全部为 seed 实际写入后的真实行数，不用估算值。
const kpis = {
  blog: [['文章', '6'], ['分类', '4'], ['作者', '2'], ['评论', '4']],
  booking: [['预约', '4'], ['服务', '4'], ['可约时段', '5']],
  chat: [['会话', '1'], ['消息', '3'], ['用户', '2']],
  crm: [['客户', '6'], ['联系人', '4'], ['商机', '5'], ['账号', '2']],
  crossdb: [['主库订单', '5'], ['辅库明细', '5']],
  decoration: [['客户', '5'], ['报价', '5'], ['明细', '5']],
  edu: [['课程', '4'], ['课时', '9'], ['报名', '3'], ['账号', '2']],
  event: [['活动', '4'], ['订单', '3'], ['票码', '5']],
  finance: [['报销单', '6'], ['审批记录', '4'], ['账号', '2']],
  freight: [['报价', '5'], ['线路', '4']],
  hospital: [['预约', '3'], ['科室', '4'], ['医生', '6'], ['号源', '6']],
  iot: [['设备', '5'], ['遥测', '15']],
  logistics: [['运单', '5'], ['轨迹', '6']],
  mall: [['商品', '8'], ['订单', '3'], ['订单明细', '4'], ['账号', '1']],
  meeting: [['会议室', '4'], ['参会人', '3'], ['纪要', '1'], ['账号', '2']],
  music: [['歌曲', '8'], ['曲风', '4'], ['收藏', '2'], ['评论', '2']],
  netcourse: [['课程', '4'], ['课时', '6'], ['报名', '3'], ['考试', '1']],
  novel: [['书籍', '6'], ['分类', '4'], ['评论', '3'], ['标签', '4']],
  printing: [['报价单', '5'], ['工艺记录', '6']],
  restaurant: [['菜品', '8'], ['桌位', '6'], ['订单', '3'], ['明细', '7']],
  signup: [['活动', '4'], ['报名', '6']],
  social: [['用户', '3'], ['好友关系', '4'], ['动态', '3'], ['群聊', '1']],
  softquote: [['客户', '5'], ['项目', '5'], ['模块', '6']],
  survey: [['问卷', '3'], ['答卷', '5']],
  ticket: [['工单', '6'], ['回复', '4'], ['客户', '5']],
  video: [['视频', '8'], ['分区', '4'], ['收藏', '2'], ['评论', '3']]
};

const dir = path.join(__dirname, '..', 'app', 'iface', 'cases');
let n = 0;
for (const [key, seed] of Object.entries(seeds)) {
  const file = path.join(dir, key + '.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pages = (p.frontend && p.frontend.project && p.frontend.project.pages) || [];
  for (const page of pages) {
    for (const el of page.elements || []) {
      if (el.type !== 'appview' || !el.props || !el.props.appJson) continue;
      let app;
      try { app = JSON.parse(el.props.appJson); } catch (e) { continue; }
      app.home = app.home || {};
      app.home.demo = seed.note;
      app.home.kpis = kpis[key] || [];
      el.props.appJson = JSON.stringify(app);
      n += 1;
    }
  }
  fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
}
console.log('appview updated', n);
