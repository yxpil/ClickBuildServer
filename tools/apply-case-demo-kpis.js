const fs = require('fs');
const path = require('path');
const seeds = require('./case-seeds');
const kpis = {
  blog: [['已发布文章', '6'], ['作者', '2'], ['分类', '4'], ['评论', '4']],
  booking: [['今日预约', '4'], ['可约时段', '5'], ['服务项目', '4'], ['到店率', '75%']],
  chat: [['未读消息', '1'], ['会话', '1'], ['联系人', '2'], ['今日消息', '3']],
  crm: [['客户', '6'], ['高价值客户', '3'], ['进行中商机', '3'], ['本月赢单', '1']],
  crossdb: [['订单', '5'], ['待处理', '2'], ['已完成', '2'], ['跨库明细', '5']],
  decoration: [['待审报价', '1'], ['已通过', '2'], ['客户', '5'], ['合同额', '¥15.1万']],
  edu: [['在读课程', '3'], ['课程总数', '4'], ['平均进度', '62%'], ['授课老师', '4']],
  event: [['在售活动', '4'], ['已售票', '5'], ['待核销', '4'], ['剩余库存', '165']],
  finance: [['待审批', '2'], ['已通过', '3'], ['本月报销', '¥7,438'], ['已驳回', '1']],
  freight: [['待报价', '1'], ['已确认', '3'], ['线路', '4'], ['本月货量', '9.7 吨']],
  hospital: [['今日号源', '47'], ['已预约', '3'], ['科室', '4'], ['医生', '6']],
  iot: [['在线设备', '4'], ['遥测记录', '15'], ['冷库温度', '4.2°C'], ['离线设备', '1']],
  logistics: [['在途运单', '3'], ['已签收', '1'], ['待揽收', '1'], ['运单总数', '5']],
  mall: [['在售商品', '8'], ['低库存', '1'], ['订单', '3'], ['销售额', '¥533']],
  meeting: [['进行中', '2'], ['今日会议', '3'], ['会议室', '4'], ['待写纪要', '3']],
  music: [['曲库', '8'], ['收藏', '2'], ['曲风', '4'], ['评论', '2']],
  netcourse: [['在学', '2'], ['已完成', '1'], ['课程', '4'], ['平均进度', '61%']],
  novel: [['连载作品', '6'], ['分类', '4'], ['总阅读', '6,280'], ['评论', '3']],
  printing: [['待确认', '1'], ['生产中', '2'], ['报价单', '5'], ['本月金额', '¥19,488']],
  restaurant: [['开台', '3'], ['在售菜品', '8'], ['今日流水', '¥310'], ['空桌', '3']],
  signup: [['开放活动', '4'], ['已报名', '100'], ['剩余名额', '55'], ['到场率', '86%']],
  social: [['好友', '2'], ['动态', '3'], ['群聊', '1'], ['群消息', '2']],
  softquote: [['待审项目', '1'], ['已通过', '2'], ['客户', '5'], ['报价总额', '¥46,872']],
  survey: [['进行中问卷', '2'], ['已回收答卷', '5'], ['归档问卷', '1'], ['完成率', '83%']],
  ticket: [['待处理', '2'], ['处理中', '3'], ['已关闭', '1'], ['SLA 达标', '92%']],
  video: [['视频', '8'], ['收藏', '2'], ['分区', '4'], ['评论', '3']]
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
