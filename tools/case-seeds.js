// 每套案例的真实演示场景：首次启动且主表为空时自动写入。
// 账号统一 demo / Demo12345（需要登录的案例），密码为 SM4 密文。
const H = 'M8Ica/uoIg9ONHG5oXOlQw==';
module.exports = {
  blog: {
    guard: 'blog_post',
    note: '博客：作者、分类、6 篇文章、评论',
    sql: `
INSERT INTO blog_user (only_id, username, password_hash, display_name, created_at) VALUES
('demo_blog_author_1','demo','${H}','林知',NOW()),
('demo_blog_author_2','editor','${H}','周野',NOW());
INSERT INTO blog_category (id,name,slug,sort,created_at) VALUES
(1,'城市观察','city',1,NOW()),(2,'技术手记','tech',2,NOW()),(3,'生活切片','life',3,NOW()),(4,'编辑推荐','pick',4,NOW());
INSERT INTO blog_tag (id,name,created_at) VALUES
(1,'昆明',NOW()),(2,'写作',NOW()),(3,'开源',NOW()),(4,'咖啡',NOW()),(5,'城市漫步',NOW());
INSERT INTO blog_post (id,title,slug,category_id,author_only_id,cover_key,content,views,status,published_at,created_at,updated_at) VALUES
(1,'翠湖边的第七个早晨','cuihu-morning',1,'demo_blog_author_1','','昆明的秋天从翠湖开始。六点半，海鸥还没醒，卖饵块的摊子已经支起来了。我坐在长椅上，看晨练的人一圈圈走过。',1280,1,'2026-11-18 07:20:00',NOW(),NOW()),
(2,'把一台旧笔记本变成家庭服务器','old-laptop-homelab',2,'demo_blog_author_1','','这台 2016 年的笔记本只有 8G 内存，但跑 MariaDB、Redis 和一个静态站点足够了。真正难的不是安装，而是让它稳定运行三个月。',962,1,'2026-11-17 21:10:00',NOW(),NOW()),
(3,'在菜市场里理解供应链','market-supply-chain',1,'demo_blog_author_2','','凌晨四点的批发市场，是一天里信息最密集的地方。价格、天气、到货量、客流，全写在摊主的脸上。',744,1,'2026-11-16 06:40:00',NOW(),NOW()),
(4,'为什么我又开始用纸笔记账','paper-ledger',3,'demo_blog_author_1','','电子表格很强大，但它不会让我停下来。纸上写错一笔，要划掉重写，这个动作本身就在提醒我：钱花出去了。',531,1,'2026-11-15 20:05:00',NOW(),NOW()),
(5,'一个前端工程师的雨后散步','after-rain-walk',1,'demo_blog_author_2','','雨停之后，北京路的地砖反着光。走到文明街，闻到烤饵块的甜味，突然想起小时候放学的那条巷子。',418,1,'2026-11-14 18:30:00',NOW(),NOW()),
(6,'开源项目维护者的深夜清单','oss-maintainer-night',2,'demo_blog_author_1','','合并请求、复现步骤、版本号、发布说明。凌晨一点，我把这些做完，才敢关掉编辑器。',356,1,'2026-11-13 23:50:00',NOW(),NOW());
INSERT INTO blog_post_tag (post_id,tag_id) VALUES (1,1),(1,5),(2,3),(3,1),(4,2),(5,5),(6,3);
INSERT INTO blog_comment (post_id,author,content,status,created_at) VALUES
(1,'阿青','翠湖的早晨确实值得早起。',1,NOW()),
(2,'老陈','稳定性比性能重要，深有同感。',1,NOW()),
(2,'Mia','求一份 systemd 配置。',1,NOW()),
(3,'小满','菜市场才是真正的数据中台。',1,NOW());
`
  },
  booking: {
    guard: 'bk_service',
    note: '预约：4 个服务、5 个未来时段、4 条预约',
    sql: `
INSERT INTO bk_service (id,name,price,duration,status,created_at) VALUES
(1,'肩颈理疗',168.00,60,1,NOW()),(2,'足部护理',128.00,45,1,NOW()),(3,'头皮养护',198.00,75,1,NOW()),(4,'初次体验',88.00,30,1,NOW());
INSERT INTO bk_slot (id,service_id,day,start_time,end_time,capacity,booked,created_at) VALUES
(1,1,'2026-11-21','09:00','10:00',6,2,NOW()),(2,1,'2026-11-21','14:00','15:00',6,1,NOW()),
(3,2,'2026-11-21','10:30','11:15',4,1,NOW()),(4,3,'2026-11-22','15:30','16:45',3,0,NOW()),
(5,4,'2026-11-22','11:00','11:30',8,0,NOW());
INSERT INTO bk_booking (id,service_id,slot_id,customer,phone,status,created_at) VALUES
(1,1,1,'周敏','13800001234',1,NOW()),(2,1,1,'李哲','13900002345',1,NOW()),
(3,1,2,'王珂','13700003456',1,NOW()),(4,2,3,'陈露','13600004567',1,NOW());
`
  },
  chat: {
    guard: 'chat_message',
    note: '聊天：两个账号、一段真实会话',
    sql: `
INSERT INTO chat_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_chat_a','chatA','${H}','阿哲',1,NOW()),('demo_chat_b','chatB','${H}','小满',1,NOW());
INSERT INTO chat_conversation (id,owner_only_id,peer_only_id,last_message,updated_at) VALUES
(1,'demo_chat_a','demo_chat_b','明天下午三点，老地方见。',NOW());
INSERT INTO chat_message (id,conv_id,from_only_id,to_only_id,body,msg_type,read_flag,created_at) VALUES
(1,1,'demo_chat_a','demo_chat_b','晚上那版接口我改完了，库存扣减放在事务里。','text',1,NOW()),
(2,1,'demo_chat_b','demo_chat_a','收到，我明早跑一遍并发测试。','text',1,NOW()),
(3,1,'demo_chat_a','demo_chat_b','明天下午三点，老地方见。','text',0,NOW());
`
  },
  crm: {
    guard: 'crm_customer',
    note: 'CRM：6 个客户、联系人与商机',
    sql: `
INSERT INTO crm_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_crm_sales','demo','${H}','销售一组',1,NOW()),('demo_crm_manager','manager','${H}','王经理',1,NOW());
INSERT INTO crm_customer (id,name,phone,level,owner_only_id,remark,created_at) VALUES
(1,'昆明云岭科技','13811110001',5,'demo_crm_sales','年度框架客户，关注私有化部署。',NOW()),
(2,'春城文旅集团','13811110002',4,'demo_crm_sales','计划升级票务系统，预算已批。',NOW()),
(3,'滇池咖啡供应链','13811110003',3,'demo_crm_sales','对库存预警模块感兴趣。',NOW()),
(4,'云南建投三公司','13811110004',5,'demo_crm_manager','集团级客户，走招标流程。',NOW()),
(5,'小满设计工作室','13811110005',2,'demo_crm_sales','小型团队，价格敏感。',NOW()),
(6,'西南物流园','13811110006',4,'demo_crm_manager','需要运单轨迹对接。',NOW());
INSERT INTO crm_contact (customer_id,name,title,phone) VALUES
(1,'张工','技术总监','13911110001'),(2,'刘总','信息化负责人','13911110002'),
(2,'杨帆','项目经理','13911110003'),(4,'陈主任','采购主管','13911110004');
INSERT INTO crm_deal (customer_id,title,amount,stage,created_at) VALUES
(1,'私有化部署一期',680000,'proposal',NOW()),(2,'票务系统升级',320000,'contacted',NOW()),
(3,'库存预警模块',86000,'lead',NOW()),(4,'集团数据中台',1200000,'won',NOW()),
(5,'品牌官网改版',42000,'lost',NOW());
`
  },
  crossdb: {
    guard: 'cross_order',
    note: '跨库：主库订单、辅库明细',
    sql: `
INSERT INTO cross_order (id,order_no,user_id,amount,status,created_at) VALUES
(1,'CB20261120001',1001,268.00,1,NOW()),(2,'CB20261120002',1002,89.00,2,NOW()),
(3,'CB20261120003',1003,520.00,1,NOW()),(4,'CB20261120004',1004,36.00,3,NOW()),
(5,'CB20261120005',1005,158.00,2,NOW());
INSERT INTO \`clickbuild_aux\`.cross_order_item (order_id,sku,qty,price,created_at) VALUES
(1,'TEA-001',2,89.00,NOW()),(1,'CUP-002',1,90.00,NOW()),
(2,'COF-003',1,89.00,NOW()),
(3,'GIFT-010',1,520.00,NOW()),
(4,'SNACK-021',2,18.00,NOW()),
(5,'TEA-008',2,79.00,NOW());
`
  },
  decoration: {
    guard: 'deco_quote',
    note: '装修：5 个客户与报价明细',
    sql: `
INSERT INTO deco_customer (id,name,phone,address,created_at) VALUES
(1,'刘先生','13822220001','盘龙区北辰小区 3-1201',NOW()),
(2,'赵女士','13822220002','五华区翠湖俊园 8-902',NOW()),
(3,'杨先生','13822220003','官渡区海伦国际 12-1803',NOW()),
(4,'孙女士','13822220004','西山区滇池路 99 号',NOW()),
(5,'何先生','13822220005','呈贡区七彩云南第壹城',NOW());
INSERT INTO deco_quote (id,customer_id,title,area,labor_rate,material_rate,discount,total,status,created_at) VALUES
(1,1,'北辰小区旧房翻新',89.50,320,680,9.5,48620.00,'approved',NOW()),
(2,2,'翠湖俊园全屋改造',120.00,350,720,9.2,74800.00,'submitted',NOW()),
(3,3,'海伦国际婚房整装',76.00,330,700,9.8,43200.00,'draft',NOW()),
(4,4,'滇池路大平层软装',210.00,300,650,9.0,102000.00,'approved',NOW()),
(5,5,'呈贡小户型局部翻新',45.00,340,690,9.6,29800.00,'rejected',NOW());
INSERT INTO deco_item (quote_id,name,spec,unit,qty,unit_price,amount,created_at) VALUES
(1,'墙面乳胶漆','立邦净味 5L','桶',6,380,2280,NOW()),
(1,'水电改造','国标铜芯线','米',120,45,5400,NOW()),
(2,'定制橱柜','多层实木','延米',4.2,1680,7056,NOW()),
(3,'瓷砖铺贴','800x800 灰砖','平方',76,120,9120,NOW()),
(4,'窗帘软装','遮光棉麻','套',8,850,6800,NOW());
`
  },
  edu: {
    guard: 'edu_course',
    note: '课程：4 门课、课时、报名进度',
    sql: `
INSERT INTO edu_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_edu_user_1','demo','${H}','学员小满',1,NOW()),('demo_edu_teacher','teacher','${H}','李老师',1,NOW());
INSERT INTO edu_course (id,title,teacher,price,seats,enrolled,status,created_at) VALUES
(1,'云南咖啡烘焙入门','李老师',299.00,24,18,1,NOW()),
(2,'零基础数据分析','周老师',399.00,30,26,1,NOW()),
(3,'手机摄影与构图','杨老师',199.00,20,12,1,NOW()),
(4,'小微企业记账实务','陈老师',259.00,16,9,1,NOW());
INSERT INTO edu_lesson (course_id,title,duration) VALUES
(1,'认识咖啡豆',45),(1,'手冲参数',60),(1,'烘焙曲线',55),
(2,'表格清洗',50),(2,'可视化入门',65),
(3,'光线与构图',40),(3,'人像实拍',55),
(4,'原始凭证',45),(4,'月末结账',60);
INSERT INTO edu_enrollment (course_id,user_only_id,progress,created_at) VALUES
(1,'demo_edu_user_1',60,NOW()),(2,'demo_edu_user_1',25,NOW()),(3,'demo_edu_user_1',100,NOW());
`
  },
  event: {
    guard: 'evt_event',
    note: '票务：4 场活动、订单与票码',
    sql: `
INSERT INTO evt_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_evt_user_1','demo','${H}','观众小满',1,NOW());
INSERT INTO evt_event (id,title,venue,start_at,price,stock,status) VALUES
(1,'城市漫步：翠湖到文林街','翠湖公园西门', '2026-12-05 09:30:00',68.00,40,1),
(2,'独立音乐现场 Vol.12','昆明剧院小剧场','2026-12-06 20:00:00',120.00,80,1),
(3,'咖啡杯测体验课','滇池路 88 号','2026-12-07 14:00:00',88.00,20,1),
(4,'亲子自然观察日','郊野公园','2026-12-12 10:00:00',58.00,30,1);
INSERT INTO evt_order (event_id,user_only_id,qty,total,status,created_at) VALUES
(1,'demo_evt_user_1',2,136.00,'paid',NOW()),(2,'demo_evt_user_1',1,120.00,'paid',NOW()),(3,'demo_evt_user_1',2,176.00,'paid',NOW());
INSERT INTO evt_ticket (order_id,code,checked) VALUES
(1,'TKT-8F21A',1),(1,'TKT-8F21B',0),(2,'TKT-91C2D',0),(3,'TKT-A73E1',0),(3,'TKT-A73E2',0);
`
  },
  finance: {
    guard: 'fin_expense',
    note: '报销：6 张单据、审批记录',
    sql: `
INSERT INTO fin_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_fin_user_1','demo','${H}','市场部小满',1,NOW()),('demo_fin_approver','finance','${H}','财务周姐',1,NOW());
INSERT INTO fin_expense (user_only_id,title,amount,category,status,invoice_key,created_at) VALUES
('demo_fin_user_1','昆明客户拜访差旅',1860.00,'差旅','pending','',NOW()),
('demo_fin_user_1','11 月团队咖啡采购',328.00,'办公','approved','',NOW()),
('demo_fin_user_1','产品发布会物料',4200.00,'市场','pending','',NOW()),
('demo_fin_user_1','高铁票（昆明-大理）',290.00,'差旅','approved','',NOW()),
('demo_fin_user_1','客户答谢晚宴',1680.00,'招待','rejected','',NOW()),
('demo_fin_user_1','云服务器续费',960.00,'技术','approved','',NOW());
INSERT INTO fin_approval (expense_id,approver_only_id,action,comment,created_at) VALUES
(2,'demo_fin_approver','approved','票据齐全。',NOW()),
(4,'demo_fin_approver','approved','符合差旅标准。',NOW()),
(5,'demo_fin_approver','rejected','超过招待标准，请拆分。',NOW()),
(6,'demo_fin_approver','approved','按年度预算执行。',NOW());
`
  },
  freight: {
    guard: 'fr_quote',
    note: '货运：4 条线路、5 份报价',
    sql: `
INSERT INTO fr_route (id,origin,destination,base_price,price_per_kg,volume_ratio,active,created_at) VALUES
(1,'昆明','上海',180,3.20,6000,1,NOW()),
(2,'昆明','广州',150,2.80,5800,1,NOW()),
(3,'昆明','成都',120,2.10,5500,1,NOW()),
(4,'昆明','北京',220,3.80,6200,1,NOW());
INSERT INTO fr_quote (customer_name,phone,route_id,weight,volume,chargeable,total,status,created_at) VALUES
('云岭科技','13833330001',1,1200,4.8,2880,11016.00,'approved',NOW()),
('滇池咖啡','13833330002',2,800,3.2,2320,6640.00,'approved',NOW()),
('小满设计','13833330003',3,120,0.8,120,372.00,'draft',NOW()),
('建投三公司','13833330004',4,5000,18.6,11160,42608.00,'submitted',NOW()),
('西南物流园','13833330005',1,2600,12.0,7200,23220.00,'approved',NOW());
`
  },
  hospital: {
    guard: 'hosp_doctor',
    note: '医院：4 个科室、6 位医生、号源与预约',
    sql: `
INSERT INTO hosp_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_hosp_patient','demo','${H}','患者小满',1,NOW());
INSERT INTO hosp_department (id,name,floor,phone) VALUES
(1,'内科','2 楼','0871-63110001'),(2,'儿科','3 楼','0871-63110002'),(3,'骨科','4 楼','0871-63110003'),(4,'皮肤科','5 楼','0871-63110004');
INSERT INTO hosp_doctor (id,department_id,name,title,fee) VALUES
(1,1,'张明远','主任医师',30.00),(2,1,'李静','副主任医师',20.00),(3,2,'王小雨','主治医师',15.00),
(4,3,'陈刚','主任医师',30.00),(5,4,'周敏','副主任医师',20.00),(6,2,'杨帆','住院医师',10.00);
INSERT INTO hosp_slot (id,doctor_id,day,capacity,booked) VALUES
(1,1,'2026-11-21',12,7),(2,2,'2026-11-21',10,4),(3,3,'2026-11-21',15,11),
(4,4,'2026-11-22',12,3),(5,5,'2026-11-22',10,2),(6,6,'2026-11-22',15,5);
INSERT INTO hosp_appointment (slot_id,patient_only_id,status,created_at) VALUES
(1,'demo_hosp_patient','booked',NOW()),(3,'demo_hosp_patient','booked',NOW()),(5,'demo_hosp_patient','canceled',NOW());
`
  },
  iot: {
    guard: 'iot_device',
    note: 'IoT：5 台设备、15 条遥测',
    sql: `
INSERT INTO iot_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_iot_user','demo','${H}','运维小满',1,NOW());
INSERT INTO iot_device (id,device_no,name,secret_hash,status,last_seen) VALUES
(1,'DEV-KM-001','翠湖冷库温度','',1,NOW()),(2,'DEV-KM-002','仓库湿度','',1,NOW()),
(3,'DEV-KM-003','门店空调','',1,NOW()),(4,'DEV-KM-004','咖啡烘焙机','',1,NOW()),(5,'DEV-KM-005','物流车厢温控','',0,NOW());
INSERT INTO iot_telemetry (device_id,temp,humidity,payload,created_at) VALUES
(1,4.2,68.0,'{"door":"closed"}',NOW()),(1,4.5,67.0,'{"door":"closed"}',NOW()),(1,6.8,71.0,'{"door":"open"}',NOW()),
(2,18.4,55.0,'{"battery":92}',NOW()),(2,18.6,54.0,'{"battery":91}',NOW()),
(3,24.1,48.0,'{"mode":"cool"}',NOW()),(3,23.8,47.0,'{"mode":"cool"}',NOW()),
(4,182.0,12.0,'{"stage":"roast"}',NOW()),(4,196.0,10.0,'{"stage":"roast"}',NOW()),
(5,8.9,72.0,'{"door":"closed"}',NOW()),(5,9.3,73.0,'{"door":"closed"}',NOW()),
(1,4.1,66.0,'{"door":"closed"}',NOW()),(3,24.5,49.0,'{"mode":"cool"}',NOW()),(4,205.0,9.0,'{"stage":"cooling"}',NOW()),(5,9.0,72.0,'{"door":"closed"}',NOW());
`
  },
  logistics: {
    guard: 'logi_shipment',
    note: '物流：5 张运单与轨迹',
    sql: `
INSERT INTO logi_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_logi_user','demo','${H}','调度小满',1,NOW());
INSERT INTO logi_shipment (id,tracking_no,sender,receiver,status,created_at) VALUES
(1,'SF20261120001','昆明云岭科技','上海张江仓','transit',NOW()),
(2,'SF20261120002','滇池咖啡','广州天河店','transit',NOW()),
(3,'SF20261120003','小满设计','成都春熙路','delivered',NOW()),
(4,'SF20261120004','建投三公司','北京朝阳','created',NOW()),
(5,'SF20261120005','西南物流园','昆明呈贡','transit',NOW());
INSERT INTO logi_track (shipment_id,node,detail,created_at) VALUES
(1,'昆明转运中心','已装车，发往上海',NOW()),(1,'贵阳中转','车辆正常，预计 18 小时到达',NOW()),
(2,'昆明转运中心','已装车，发往广州',NOW()),(3,'成都分拨中心','已签收，签收人：前台',NOW()),
(4,'昆明仓','等待揽收',NOW()),(5,'昆明呈贡站','派送中，快递员：李师傅',NOW());
`
  },
  mall: {
    guard: 'shop_product',
    note: '商城：8 个商品、订单与明细',
    sql: `
INSERT INTO shop_user (only_id,username,password_hash,nickname,phone,role,created_at) VALUES
('demo_shop_user','demo','${H}','小满','13844440001','user',NOW());
INSERT INTO shop_product (id,title,category,price,stock,sales,cover_key,status,description,created_at,updated_at) VALUES
(1,'云南小粒咖啡 250g','食品',79.00,120,86,'',1,'保山日晒，中浅烘焙。',NOW(),NOW()),
(2,'手工陶瓷马克杯','家居',128.00,34,22,'',1,'建水紫陶，容量 320ml。',NOW(),NOW()),
(3,'普洱熟茶饼 357g','食品',168.00,58,41,'',1,'勐海原料，2019 年压制。',NOW(),NOW()),
(4,'棉麻围巾','服饰',89.00,76,33,'',1,'植物染，两色可选。',NOW(),NOW()),
(5,'香格里拉蜂蜜 500g','食品',69.00,45,28,'',1,'高原百花蜜。',NOW(),NOW()),
(6,'手作银饰耳环','饰品',199.00,18,12,'',1,'鹤庆银匠手工制作。',NOW(),NOW()),
(7,'复古帆布包','箱包',119.00,52,37,'',1,'加厚帆布，内衬防水。',NOW(),NOW()),
(8,'咖啡手冲壶','器具',158.00,26,19,'',1,'304 不锈钢，细口控流。',NOW(),NOW());
INSERT INTO shop_order (id,order_no,user_only_id,receiver,address,amount,status,created_at) VALUES
(1,'SHOP20261120001','demo_shop_user','小满','昆明市五华区文林街 12 号',158.00,1,NOW()),
(2,'SHOP20261120002','demo_shop_user','小满','昆明市五华区文林街 12 号',168.00,2,NOW()),
(3,'SHOP20261120003','demo_shop_user','小满','昆明市五华区文林街 12 号',207.00,1,NOW());
INSERT INTO shop_order_item (order_id,product_id,title,qty,price) VALUES
(1,1,'云南小粒咖啡 250g',2,79.00),(2,3,'普洱熟茶饼 357g',1,168.00),(3,1,'云南小粒咖啡 250g',1,79.00),(3,2,'手工陶瓷马克杯',1,128.00);
`
  },
  meeting: {
    guard: 'meeting_room',
    note: '会议：4 间会议室、参与人与纪要',
    sql: `
INSERT INTO meeting_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_meet_user','demo','${H}','产品小满',1,NOW()),('demo_meet_guest','guest','${H}','研发阿哲',1,NOW());
INSERT INTO meeting_room (room_no,title,host_only_id,status,start_at,end_at,created_at) VALUES
('MR-1001','周会：1.1.29 版本验收','demo_meet_user',1,'2026-11-20 10:00:00','2026-11-20 11:00:00',NOW()),
('MR-1002','客户需求评审：票务系统','demo_meet_user',1,'2026-11-20 14:00:00','2026-11-20 15:30:00',NOW()),
('MR-1003','研发每日站会','demo_meet_guest',0,'2026-11-20 09:30:00','2026-11-20 09:45:00',NOW()),
('MR-1004','设计走查：商城首页','demo_meet_user',0,'2026-11-21 16:00:00','2026-11-21 17:00:00',NOW());
INSERT INTO meeting_participant (room_id,user_only_id,joined_at,left_at) VALUES
(1,'demo_meet_user',NOW(),NULL),(1,'demo_meet_guest',NOW(),NOW()),(2,'demo_meet_user',NOW(),NULL);
INSERT INTO meeting_minutes (room_id,summary,created_at) VALUES
(1,'确认 26 套案例验收口径；音乐/视频收藏 SQL 修复进 1.1.29；剩余 UI E2E 排期。',NOW());
`
  },
  music: {
    guard: 'mus_song',
    note: '音乐：4 个曲风、8 首歌、评论与收藏',
    sql: `
INSERT INTO mus_user (only_id,username,password_hash,nickname,created_at) VALUES
('demo_mus_user','demo','${H}','听众小满',NOW());
INSERT INTO mus_category (id,name,code,sort,created_at) VALUES
(1,'民谣','folk',1,NOW()),(2,'独立摇滚','indie',2,NOW()),(3,'电子','electronic',3,NOW()),(4,'世界音乐','world',4,NOW());
INSERT INTO mus_song (id,title,category_id,cover_key,file_key,duration,views,status,created_at,updated_at) VALUES
(1,'翠湖晚风',1,'','',214,1860,1,NOW(),NOW()),
(2,'北站以南',1,'','',198,1320,1,NOW(),NOW()),
(3,'午夜电台',2,'','',245,980,1,NOW(),NOW()),
(4,'雨落文明街',1,'','',226,760,1,NOW(),NOW()),
(5,'滇池频率',3,'','',312,540,1,NOW(),NOW()),
(6,'山间回声',4,'','',287,430,1,NOW(),NOW()),
(7,'旧城手记',2,'','',233,390,1,NOW(),NOW()),
(8,'清晨六点半',1,'','',205,310,1,NOW(),NOW());
INSERT INTO mus_comment (song_id,user_only_id,content,status,created_at) VALUES
(1,'demo_mus_user','副歌一出来就想起翠湖的晚上。',1,NOW()),
(3,'demo_mus_user','合成器用得克制，很好听。',1,NOW());
INSERT INTO mus_favorite (song_id,user_only_id,created_at) VALUES (1,'demo_mus_user',NOW()),(3,'demo_mus_user',NOW());
`
  },
  netcourse: {
    guard: 'nc_course',
    note: '网课：4 门课、课时、学习与考试',
    sql: `
INSERT INTO nc_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_nc_user','demo','${H}','学员小满',1,NOW()),('demo_nc_teacher','teacher','${H}','李老师',1,NOW());
INSERT INTO nc_course (title,teacher_only_id,intro,price,status,lesson_count,views,created_at) VALUES
('咖啡烘焙从入门到开店','demo_nc_teacher','从生豆挑选到烘焙曲线，再到小店出品。',499.00,'published',12,860,NOW()),
('数据分析实战','demo_nc_teacher','用真实业务表做清洗、建模和可视化。',399.00,'published',10,1200,NOW()),
('手机摄影构图课','demo_nc_teacher','光线、构图、人像与街拍。',199.00,'published',8,640,NOW()),
('小微企业财务入门','demo_nc_teacher','记账、报税、现金流。',299.00,'draft',6,220,NOW());
INSERT INTO nc_lesson (course_id,title,video_url,duration,sort,created_at) VALUES
(1,'认识生豆', '',45,1,NOW()),(1,'烘焙曲线', '',60,2,NOW()),(1,'杯测与出品', '',55,3,NOW()),
(2,'业务表清洗', '',50,1,NOW()),(2,'指标体系', '',65,2,NOW()),
(3,'自然光人像', '',40,1,NOW());
INSERT INTO nc_enroll (course_id,user_only_id,progress,status,created_at) VALUES
(1,'demo_nc_user',60,'learning',NOW()),(2,'demo_nc_user',25,'learning',NOW()),(3,'demo_nc_user',100,'completed',NOW());
INSERT INTO nc_exam (course_id,user_only_id,score,passed,created_at) VALUES
(3,'demo_nc_user',92,1,NOW());
`
  },
  novel: {
    guard: 'novel_book',
    note: '小说：4 个分类、6 本书、评论',
    sql: `
INSERT INTO novel_user (only_id,username,password_hash,display_name,created_at) VALUES
('demo_novel_author','demo','${H}','夜航',NOW()),('demo_novel_author2','writer','${H}','南风',NOW());
INSERT INTO novel_category (id,name,slug,sort,created_at) VALUES
(1,'都市','city',1,NOW()),(2,'悬疑','mystery',2,NOW()),(3,'科幻','sci-fi',3,NOW()),(4,'武侠','wuxia',4,NOW());
INSERT INTO novel_tag (id,name,created_at) VALUES (1,'昆明',NOW()),(2,'群像',NOW()),(3,'时间循环',NOW()),(4,'江湖',NOW());
INSERT INTO novel_book (id,title,slug,category_id,author_only_id,cover_key,content,views,status,published_at,created_at,updated_at) VALUES
(1,'午夜十二点的北京路','midnight-beijing-road',1,'demo_novel_author','','第一章 末班地铁\n\n北京路的灯还亮着，便利店门口的关东煮冒着白气。',1860,1,'2026-11-18 00:10:00',NOW(),NOW()),
(2,'第七次回到翠湖','seventh-cuihu',3,'demo_novel_author','','第一次循环结束时，他以为自己只是做了个梦。',1520,1,'2026-11-17 22:00:00',NOW(),NOW()),
(3,'山城旧案','old-case-mountain',2,'demo_novel_author2','','雨下了三天，派出所的灯也亮了三天。',980,1,'2026-11-16 21:30:00',NOW(),NOW()),
(4,'剑出滇南','sword-south',4,'demo_novel_author2','','马蹄声停在客栈门外，风把门帘吹起一角。',760,1,'2026-11-15 20:00:00',NOW(),NOW()),
(5,'咖啡馆里的陌生人','stranger-cafe',1,'demo_novel_author','','他每周三下午三点来，只点一杯美式。',640,1,'2026-11-14 19:00:00',NOW(),NOW()),
(6,'信号丢失之后','after-signal-lost',3,'demo_novel_author2','','地面站失去联系的第 47 天，天线又收到一段重复信号。',520,1,'2026-11-13 23:00:00',NOW(),NOW());
INSERT INTO novel_book_tag (book_id,tag_id) VALUES (1,1),(1,2),(2,3),(3,2),(4,4),(5,1),(6,3);
INSERT INTO novel_comment (book_id,author,content,status,created_at) VALUES
(1,'读者阿青','昆明人看哭了，细节太真。',1,NOW()),
(2,'Mia','循环设定很有张力。',1,NOW()),
(3,'老陈','案子铺得很稳。',1,NOW());
`
  },
  printing: {
    guard: 'prt_quote',
    note: '印刷：5 份报价与工艺',
    sql: `
INSERT INTO prt_quote (job_name,paper,width,height,qty,sides,unit_price,plate_fee,process_fee,total,status,created_at) VALUES
('云岭科技画册','哑粉纸 157g',210,285,2000,2,1.85,300,680,4988.00,'approved',NOW()),
('滇池咖啡手提袋','牛皮纸 120g',260,320,5000,1,1.20,0,900,6900.00,'approved',NOW()),
('小满设计名片','白卡 300g',90,54,1000,2,0.35,120,180,550.00,'submitted',NOW()),
('建投三公司年报','双胶纸 80g',210,297,800,2,2.10,300,1200,4560.00,'approved',NOW()),
('音乐节海报','铜版纸 200g',420,594,300,1,6.80,0,450,2490.00,'draft',NOW());
INSERT INTO prt_process (quote_id,name,fee,created_at) VALUES
(1,'覆哑膜',220,NOW()),(1,'锁线胶装',460,NOW()),
(2,'手提绳',400,NOW()),(2,'单面覆膜',500,NOW()),
(3,'烫金',120,NOW()),(3,'模切',60,NOW());
`
  },
  restaurant: {
    guard: 'rest_dish',
    note: '餐饮：8 道菜、6 张桌、订单',
    sql: `
INSERT INTO rest_user (only_id,username,password_hash,display_name,status,created_at) VALUES
('demo_rest_user','demo','${H}','店长小满',1,NOW());
INSERT INTO rest_dish (id,name,price,category,stock,status) VALUES
(1,'小锅米线',18.00,'主食',80,1),(2,'汽锅鸡',88.00,'热菜',20,1),
(3,'烤饵块',8.00,'小吃',100,1),(4,'凉拌折耳根',16.00,'凉菜',40,1),
(5,'宣威火腿炒饭',22.00,'主食',50,1),(6,'炸乳扇',26.00,'小吃',30,1),
(7,'酸木瓜鱼',68.00,'热菜',15,1),(8,'冰稀饭',10.00,'甜品',60,1);
INSERT INTO rest_table (table_no,seats,status) VALUES
('A01',4,1),('A02',4,1),('A03',6,1),('B01',2,0),('B02',2,0),('C01',8,1);
INSERT INTO rest_order (table_id,user_only_id,total,status,created_at) VALUES
(1,'demo_rest_user',36.00,'paid',NOW()),
(2,'demo_rest_user',106.00,'open',NOW()),
(3,'demo_rest_user',168.00,'open',NOW());
INSERT INTO rest_order_item (order_id,dish_id,name,price,qty) VALUES
(1,1,'小锅米线',18.00,2),
(2,2,'汽锅鸡',88.00,1),(2,3,'烤饵块',8.00,1),(2,8,'冰稀饭',10.00,1),
(3,7,'酸木瓜鱼',68.00,2),(3,6,'炸乳扇',26.00,1),(3,5,'宣威火腿炒饭',22.00,1);
`
  },
  signup: {
    guard: 'rg_event',
    note: '报名：4 场活动与报名名单',
    sql: `
INSERT INTO rg_event (title,description,location,start_at,capacity,status,registered_count,created_at,updated_at) VALUES
('城市漫步：翠湖到文林街','跟着老街坊走一遍昆明老城。','翠湖公园西门','2026-12-05 09:30:00',30,1,18,NOW(),NOW()),
('咖啡杯测体验课','从酸质、甜感、余韵认识一支豆子。','滇池路 88 号','2026-12-07 14:00:00',20,1,12,NOW(),NOW()),
('亲子自然观察日','观察候鸟、树叶和昆虫。','郊野公园','2026-12-12 10:00:00',25,1,9,NOW(),NOW()),
('独立音乐现场 Vol.12','本地乐队联合演出。','昆明剧院小剧场','2026-12-06 20:00:00',80,1,61,NOW(),NOW());
INSERT INTO rg_signup (event_id,name,phone,remark,created_at) VALUES
(1,'周敏','13855550001','带一位朋友',NOW()),(1,'李哲','13855550002','',NOW()),
(2,'王珂','13855550003','对浅烘感兴趣',NOW()),(2,'陈露','13855550004','',NOW()),
(3,'杨帆','13855550005','两个孩子',NOW()),(4,'小满','13855550006','',NOW());
`
  },
  social: {
    guard: 'sc_moment',
    note: '社区：3 位用户、好友、动态、群聊',
    sql: `
INSERT INTO sc_user (only_id,username,password_hash,nickname,avatar,bio,gender,region,status,allow_search,allow_stranger,last_seen_at,created_at,updated_at) VALUES
('demo_sc_a','demo','${H}','阿哲','','写代码，也写字。',1,'昆明',1,1,1,NOW(),NOW(),NOW()),
('demo_sc_b','xiaoman','${H}','小满','','咖啡与设计。',2,'昆明',1,1,1,NOW(),NOW(),NOW()),
('demo_sc_c','nanfeng','${H}','南风','','在路上的摄影师。',1,'大理',1,1,1,NOW(),NOW(),NOW());
INSERT INTO sc_friend (owner_only_id,friend_only_id,alias,source,created_at) VALUES
('demo_sc_a','demo_sc_b','小满','search',NOW()),('demo_sc_b','demo_sc_a','阿哲','search',NOW()),
('demo_sc_a','demo_sc_c','南风','group',NOW()),('demo_sc_c','demo_sc_a','阿哲','group',NOW());
INSERT INTO sc_moment (moment_id,only_id,content,images,visibility,like_count,comment_count,created_at) VALUES
('m_demo_1','demo_sc_b','翠湖的早上六点半，海鸥比人先到。','[]',1,12,2,NOW()),
('m_demo_2','demo_sc_c','大理的风把云吹成了鱼。','[]',1,8,1,NOW()),
('m_demo_3','demo_sc_a','把旧笔记本装成家庭服务器，今晚终于稳定了。','[]',1,15,3,NOW());
INSERT INTO sc_moment_like (moment_id,only_id,created_at) VALUES ('m_demo_1','demo_sc_a',NOW()),('m_demo_3','demo_sc_b',NOW());
INSERT INTO sc_moment_comment (comment_id,moment_id,only_id,reply_to,content,created_at) VALUES
('c_demo_1','m_demo_1','demo_sc_a','','这个时间点太真实了。',NOW()),
('c_demo_2','m_demo_3','demo_sc_b','','求配置清单。',NOW());
INSERT INTO sc_group (group_id,owner_only_id,name,intro,avatar,member_count,max_members,join_mode,status,created_at,updated_at) VALUES
('g_demo_1','demo_sc_a','昆明周末散步','每周挑一条老街走两小时。','',3,100,1,1,NOW(),NOW());
INSERT INTO sc_group_member (group_id,only_id,role,mute,joined_at,last_read_at,created_at) VALUES
('g_demo_1','demo_sc_a','owner',0,NOW(),NOW(),NOW()),('g_demo_1','demo_sc_b','member',0,NOW(),NOW(),NOW()),('g_demo_1','demo_sc_c','member',0,NOW(),NOW(),NOW());
INSERT INTO sc_group_announce (announce_id,group_id,only_id,content,created_at) VALUES
('a_demo_1','g_demo_1','demo_sc_a','本周六上午九点，翠湖西门集合。',NOW());
INSERT INTO sc_message (msg_id,conv_id,group_id,from_only_id,to_only_id,body,msg_type,media_url,reply_to,status,read_flag,created_at) VALUES
('msg_demo_1','','g_demo_1','demo_sc_a','','周六散步路线定了，走翠湖—文林街—文化巷。','text','','',1,1,NOW()),
('msg_demo_2','','g_demo_1','demo_sc_b','','报名，带相机。','text','','',1,1,NOW());
`
  },
  softquote: {
    guard: 'soft_project',
    note: '软件报价：5 个客户与项目',
    sql: `
INSERT INTO soft_client (id,name,contact,phone,created_at) VALUES
(1,'昆明云岭科技','张工','13866660001',NOW()),
(2,'春城文旅集团','刘总','13866660002',NOW()),
(3,'滇池咖啡供应链','杨帆','13866660003',NOW()),
(4,'小满设计工作室','小满','13866660004',NOW()),
(5,'西南物流园','陈主任','13866660005',NOW());
INSERT INTO soft_project (id,client_id,name,requirement,rate_per_day,discount,total,status,created_at) VALUES
(1,1,'设备管理后台','设备台账、遥测曲线、告警和处理记录。',900,9.5,4072.50,'approved',NOW()),
(2,2,'票务系统升级','在线选座、核销、退票和报表。',1100,9.2,18600.00,'submitted',NOW()),
(3,3,'库存预警小程序','批次、保质期、低库存提醒。',850,9.8,6200.00,'draft',NOW()),
(4,4,'品牌官网改版','作品集、报价器和预约表单。',780,9.0,5200.00,'won',NOW()),
(5,5,'运单轨迹对接','对接三家快递，统一轨迹节点。',1000,9.4,12800.00,'approved',NOW());
INSERT INTO soft_module (project_id,name,days,amount,created_at) VALUES
(1,'需求与设计',5,4275,NOW()),(1,'后端接口',8,6840,NOW()),(2,'选座与支付',12,12144,NOW()),
(3,'预警规则',4,3332,NOW()),(4,'视觉与前端',6,4212,NOW()),(5,'轨迹适配',7,6580,NOW());
`
  },
  survey: {
    guard: 'sv_survey',
    note: '问卷：3 份问卷与 5 份答卷',
    sql: `
INSERT INTO sv_survey (title,description,questions,status,response_count,created_at,updated_at) VALUES
('客户满意度调查','用一分钟告诉我们你的真实感受。','[{"id":"q1","type":"single","title":"你对本次服务满意吗？","required":true,"options":["满意","一般","不满意"]},{"id":"q2","type":"text","title":"还有什么建议？","required":false,"options":[]}]',1,3,NOW(),NOW()),
('产品功能优先级调研','帮助我们把下一版做对。','[{"id":"q1","type":"multi","title":"你最希望优先改进什么？","required":true,"options":["性能","界面","导出","权限"]},{"id":"q2","type":"rating","title":"整体满意度","required":true,"options":[]}]',1,2,NOW(),NOW()),
('已结束的旧版反馈','归档问卷。','[{"id":"q1","type":"text","title":"旧版哪里最不方便？","required":false,"options":[]}]',2,0,NOW(),NOW());
INSERT INTO sv_response (survey_id,respondent,answers,created_at) VALUES
(1,'周敏','{"q1":"满意","q2":"希望导出更快"}',NOW()),
(1,'李哲','{"q1":"一般","q2":"移动端再优化"}',NOW()),
(1,'王珂','{"q1":"满意","q2":""}',NOW()),
(2,'陈露','{"q1":["性能","导出"],"q2":"4"}',NOW()),
(2,'杨帆','{"q1":["权限"],"q2":"3"}',NOW());
`
  },
  ticket: {
    guard: 'biz_ticket',
    note: '工单：5 个客户、6 张工单与回复',
    sql: `
INSERT INTO crm_customer (id,name,phone,level,owner,remark,created_at) VALUES
(1,'昆明云岭科技','13877770001',5,'客服一组','年度服务客户',NOW()),
(2,'春城文旅集团','13877770002',4,'客服二组','票务系统客户',NOW()),
(3,'滇池咖啡供应链','13877770003',3,'客服一组','门店系统',NOW()),
(4,'小满设计工作室','13877770004',2,'客服二组','小型客户',NOW()),
(5,'西南物流园','13877770005',4,'客服三组','接口对接',NOW());
INSERT INTO biz_ticket (id,title,content,customer_id,status,priority,assignee,created_at,updated_at) VALUES
(1,'导出报表中文乱码','CSV 用 Excel 打开后中文显示为乱码。',1,1,2,'工程师张三',NOW(),NOW()),
(2,'票务核销提示重复','同一张票在手持机上核销两次都成功。',2,1,3,'工程师李四',NOW(),NOW()),
(3,'库存预警没有推送','低于安全库存后没有收到通知。',3,2,2,'工程师张三',NOW(),NOW()),
(4,'登录后空白页','Chrome 131 登录后页面空白。',4,0,2,'',NOW(),NOW()),
(5,'运单轨迹缺节点','顺丰和圆通的轨迹字段不一致。',5,1,2,'工程师王五',NOW(),NOW()),
(6,'历史订单无法搜索','订单号搜索无结果。',1,2,1,'工程师张三',NOW(),NOW());
INSERT INTO biz_ticket_reply (ticket_id,author,content,created_at) VALUES
(1,'工程师张三','已复现，CSV 增加 BOM 头，今天发版。',NOW()),
(2,'工程师李四','核销接口加幂等键，正在灰度。',NOW()),
(3,'工程师张三','排查是通知队列积压，已补发。',NOW()),
(5,'工程师王五','已统一为 shipping/delivered/signed 三态。',NOW());
`
  },
  video: {
    guard: 'vid_video',
    note: '视频：4 个分区、8 个视频、评论与收藏',
    sql: `
INSERT INTO vid_user (only_id,username,password_hash,nickname,created_at) VALUES
('demo_vid_user','demo','${H}','观众小满',NOW());
INSERT INTO vid_category (id,name,code,sort,created_at) VALUES
(1,'城市记录','city',1,NOW()),(2,'技术分享','tech',2,NOW()),(3,'美食','food',3,NOW()),(4,'旅行','travel',4,NOW());
INSERT INTO vid_video (id,title,category_id,cover_key,file_key,duration,views,status,created_at,updated_at) VALUES
(1,'凌晨四点的昆明批发市场',1,'','',612,2860,1,NOW(),NOW()),
(2,'用旧笔记本搭家庭服务器',2,'','',1240,1920,1,NOW(),NOW()),
(3,'翠湖海鸥的一天',1,'','',480,1680,1,NOW(),NOW()),
(4,'小锅米线从备料到出锅',3,'','',760,1320,1,NOW(),NOW()),
(5,'大理环洱海骑行',4,'','',1520,980,1,NOW(),NOW()),
(6,'数据库索引到底怎么选',2,'','',1860,760,1,NOW(),NOW()),
(7,'文林街的咖啡馆',1,'','',540,640,1,NOW(),NOW()),
(8,'汽锅鸡的家庭做法',3,'','',880,520,1,NOW(),NOW());
INSERT INTO vid_comment (video_id,user_only_id,content,status,created_at) VALUES
(1,'demo_vid_user','批发市场的烟火气太足了。',1,NOW()),
(2,'demo_vid_user','求配置清单和功耗。',1,NOW()),
(6,'demo_vid_user','讲得很清楚，例子也真实。',1,NOW());
INSERT INTO vid_favorite (video_id,user_only_id,created_at) VALUES (1,'demo_vid_user',NOW()),(2,'demo_vid_user',NOW());
`
  }
};
