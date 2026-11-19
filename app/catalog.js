'use strict';
/**
 * 业务模块货架（Catalog）
 * ---------------------------------------------------------------
 * 每个模块 = 一组表 + 一组权限 + 一组 REST 端点 + 可选能力
 * 生成器只认这份 IR，因此 Java / Rust / SQL 三份产物天然等价，
 * 工程之间可以互相转换（同一份项目 JSON 重新生成即可）。
 *
 * 列写法： 'name|type|comment|flags'
 * flags: req 必填 / uniq 唯一 / idx 普通索引 / search 可搜索 / cache 缓存热字段
 */

const COL = (s) => {
  const [name, type, comment = '', flags = ''] = s.split('|');
  return { name, type, comment, flags: flags.split(',').filter(Boolean) };
};

const T = (name, comment, cols, opt = {}) => ({
  name,
  comment,
  columns: cols.map(COL),
  search: opt.search || [],
  cache: opt.cache !== false,
  cacheTtl: opt.cacheTtl || 300,
  indexes: opt.indexes || [],
});

const M = (o) => ({
  group: '业务',
  requires: [],
  features: {},
  builtin: true,
  ...o,
});

/* ============================ 平台基础 ============================ */

const auth = M({
  id: 'auth',
  name: '统一登录',
  group: '平台',
  abbr: 'AU',
  tagline: '账号密码 + JWT + Cookie 会话',
  desc: '统一认证入口：登录、登出、刷新令牌、当前用户。Token 支持 Header 与 HttpOnly Cookie 双通道，会话落 Redis。',
  requires: ['account', 'rbac'],
  features: { auth: true, cache: true },
  tables: [
    T('sys_session', '登录会话', [
      'token_id|varchar(64)|令牌ID|req,uniq,idx',
      'user_id|bigint|用户ID|req,idx',
      'device|varchar(64)|设备标识',
      'ip|varchar(64)|登录IP',
      'expires_at|datetime|过期时间|req',
      'revoked|tinyint|是否吊销 0否1是',
    ], { search: ['user_id', 'token_id'], cacheTtl: 1800 }),
  ],
});

const account = M({
  id: 'account',
  name: '账号管理',
  group: '平台',
  abbr: 'AC',
  tagline: '用户、部门、状态、密码策略',
  desc: '用户主数据与账号生命周期：新增、禁用、重置密码、部门归属。密码 BCrypt 存储。',
  features: { cache: true },
  tables: [
    T('sys_user', '用户账号', [
      'username|varchar(64)|登录名|req,uniq,search',
      'password|varchar(128)|密码(BCrypt)|req',
      'nickname|varchar(64)|昵称|search',
      'email|varchar(128)|邮箱|idx,search',
      'phone|varchar(32)|手机号|idx,search',
      'dept_id|bigint|部门ID|idx',
      'avatar|varchar(255)|头像地址',
      'status|tinyint|状态 0禁用1正常',
      'last_login_at|datetime|最后登录时间',
      'last_login_ip|varchar(64)|最后登录IP',
    ], { search: ['username', 'nickname', 'email', 'phone'] }),
    T('sys_dept', '部门', [
      'parent_id|bigint|上级部门|idx',
      'dept_name|varchar(64)|部门名称|req,search',
      'leader|varchar(64)|负责人',
      'sort|int|排序',
    ], { search: ['dept_name'] }),
  ],
});

const rbac = M({
  id: 'rbac',
  name: '权限控制',
  group: '平台',
  abbr: 'RB',
  tagline: '角色 · 菜单 · 按钮 · 数据范围',
  desc: 'RBAC 权限模型。所有模块自动注册权限码，生成注解式校验（Java @RequirePerm / Rust extractor），并输出角色-权限矩阵。',
  requires: ['account'],
  features: { cache: true, rbac: true },
  tables: [
    T('sys_role', '角色', [
      'role_code|varchar(64)|角色编码|req,uniq,search',
      'role_name|varchar(64)|角色名称|req,search',
      'data_scope|tinyint|数据范围 1全部2部门3本人',
      'remark|varchar(255)|备注',
    ], { search: ['role_code', 'role_name'] }),
    T('sys_permission', '权限点', [
      'perm_code|varchar(128)|权限码|req,uniq,search',
      'perm_name|varchar(64)|权限名称',
      'module_id|varchar(64)|所属模块|idx',
      'kind|varchar(16)|类型 menu/button/api',
    ], { search: ['perm_code', 'perm_name'] }),
    T('sys_role_permission', '角色权限关系', [
      'role_id|bigint|角色ID|req,idx',
      'perm_code|varchar(128)|权限码|req,idx',
    ]),
    T('sys_user_role', '用户角色关系', [
      'user_id|bigint|用户ID|req,idx',
      'role_id|bigint|角色ID|req,idx',
    ]),
  ],
});

const auditLog = M({
  id: 'audit-log',
  name: '操作日志',
  group: '平台',
  abbr: 'LG',
  tagline: '全链路请求留痕，可检索',
  desc: 'AOP/中间件自动记录：谁、在什么时间、对哪个资源、做了什么、耗时多少、结果如何。支持按模块与操作人检索。',
  requires: ['auth'],
  features: { search: true, export: true },
  tables: [
    T('sys_operation_log', '操作日志', [
      'trace_id|varchar(64)|链路ID|idx',
      'module|varchar(64)|模块|idx,search',
      'action|varchar(64)|动作|search',
      'resource_id|varchar(64)|资源ID|idx',
      'user_id|bigint|操作人|idx,search',
      'username|varchar(64)|操作人名称|search',
      'ip|varchar(64)|IP',
      'method|varchar(16)|HTTP方法',
      'path|varchar(255)|请求路径',
      'params|text|请求参数',
      'result|tinyint|结果 1成功0失败',
      'error|varchar(1000)|错误信息',
      'cost_ms|int|耗时毫秒',
    ], { search: ['module', 'action', 'username', 'user_id'], cache: false }),
  ],
});

const approval = M({
  id: 'approval',
  name: '审核中心',
  group: '平台',
  abbr: 'AP',
  tagline: '提交 · 通过 · 驳回 · 转办',
  desc: '通用审核流。任意业务表挂接审核（订单、合同、工单、文章…），记录审核节点、意见、操作人，支持多级与转办。',
  requires: ['auth', 'rbac'],
  features: { audit: true, search: true },
  tables: [
    T('sys_approval', '审核单', [
      'biz_module|varchar(64)|业务模块|req,idx,search',
      'biz_id|bigint|业务主键|req,idx',
      'title|varchar(255)|审核标题|search',
      'status|tinyint|状态 0待审1通过2驳回3撤销',
      'current_node|int|当前节点',
      'applicant_id|bigint|申请人|idx',
      'applicant_name|varchar(64)|申请人',
      'finished_at|datetime|完成时间',
    ], { search: ['biz_module', 'title', 'applicant_name'] }),
    T('sys_approval_node', '审核节点记录', [
      'approval_id|bigint|审核单ID|req,idx',
      'node_no|int|节点序号',
      'auditor_id|bigint|审核人|idx',
      'auditor_name|varchar(64)|审核人名称',
      'action|varchar(16)|动作 pass/reject/transfer',
      'opinion|varchar(1000)|审核意见',
      'acted_at|datetime|操作时间',
    ], { cache: false }),
  ],
});

const dict = M({
  id: 'dict',
  name: '数据字典',
  group: '平台',
  abbr: 'DC',
  tagline: '枚举统一收口，前端可下拉',
  desc: '字典类型 + 字典项。业务状态、类型值统一维护，避免魔法数字散落在代码里。',
  requires: [],
  features: { cache: true },
  tables: [
    T('sys_dict', '字典类型', [
      'dict_code|varchar(64)|字典编码|req,uniq,search',
      'dict_name|varchar(64)|字典名称|search',
      'remark|varchar(255)|备注',
    ], { search: ['dict_code', 'dict_name'] }),
    T('sys_dict_item', '字典项', [
      'dict_code|varchar(64)|字典编码|req,idx,search',
      'item_value|varchar(64)|值|req',
      'item_label|varchar(64)|显示名|search',
      'sort|int|排序',
      'color|varchar(16)|标签颜色',
    ], { search: ['dict_code', 'item_label'] }),
  ],
});

const tenant = M({
  id: 'tenant',
  name: '多租户',
  group: '平台',
  abbr: 'TN',
  tagline: '一套服务，多套数据',
  desc: '租户隔离。开启后所有业务表自动追加 tenant_id 并在 SQL 层过滤，登录时按租户签发会话。',
  requires: ['account'],
  features: { tenant: true, cache: true },
  tables: [
    T('sys_tenant', '租户', [
      'tenant_code|varchar(64)|租户编码|req,uniq,search',
      'tenant_name|varchar(128)|租户名称|req,search',
      'contact|varchar(64)|联系人',
      'status|tinyint|状态 0停用1启用',
      'expire_at|datetime|到期时间',
    ], { search: ['tenant_code', 'tenant_name'] }),
  ],
});

const apiKey = M({
  id: 'api-key',
  name: '开放接口密钥',
  group: '平台',
  abbr: 'AK',
  tagline: '第三方接入，按 key 限流',
  desc: 'AppKey / AppSecret 管理，签名校验与配额统计，给外部系统调用开放接口。',
  requires: ['account'],
  features: { cache: true },
  tables: [
    T('sys_api_key', '开放接口密钥', [
      'app_key|varchar(64)|AppKey|req,uniq,search',
      'app_secret|varchar(128)|AppSecret|req',
      'app_name|varchar(64)|应用名称|search',
      'owner_id|bigint|负责人|idx',
      'qps|int|QPS限额',
      'status|tinyint|状态 0停用1启用',
      'expire_at|datetime|到期时间',
    ], { search: ['app_key', 'app_name'] }),
  ],
});

const verifyCode = M({
  id: 'verify-code',
  name: '短信 / 邮箱验证码',
  group: '平台',
  abbr: 'VC',
  tagline: '对外通道对接 · 只做骨架',
  desc: '生成验证码的发送 / 校验接口与通道适配器；短信、邮件由你接的第三方服务真正发出，这里不代发。',
  requires: ['auth'],
  features: { cache: true, search: true },
  tables: [
    T('sys_verify_code', '验证码', [
      'channel|varchar(16)|通道 sms/email|req,idx,search',
      'target|varchar(128)|手机号 / 邮箱|req,idx,search',
      'code|varchar(16)|验证码|req',
      'scene|varchar(32)|场景 login/register/reset|idx,search',
      'expire_at|datetime|过期时间|req',
      'used|tinyint|是否已用',
      'sent_at|datetime|发送时间',
      'ip|varchar(64)|来源 IP',
    ], { search: ['target', 'scene'], cache: false }),
  ],
});

const captcha = M({
  id: 'captcha',
  name: '验证码',
  group: '平台',
  abbr: 'CP',
  tagline: '图形 / 滑块 / 短信',
  desc: '登录防刷。验证码存 Redis（TTL 120s），支持图形、算术、短信三种模式。',
  requires: ['cache'],
  features: { cache: true, noTable: true },
  tables: [],
});

const task = M({
  id: 'task',
  name: '定时任务',
  group: '平台',
  abbr: 'JB',
  tagline: 'Cron 调度 + 执行记录',
  desc: '内置调度器（Java ScheduledExecutor / Rust tokio interval），任务可持久化、手动触发、查看执行日志。',
  requires: [],
  features: { cache: true },
  tables: [
    T('sys_job', '定时任务', [
      'job_name|varchar(128)|任务名称|req,search',
      'cron|varchar(64)|Cron 表达式|req',
      'handler|varchar(128)|处理器',
      'status|tinyint|状态 0停用1启用',
      'last_run_at|datetime|上次执行',
      'next_run_at|datetime|下次执行',
    ], { search: ['job_name'] }),
    T('sys_job_log', '任务执行日志', [
      'job_id|bigint|任务ID|req,idx',
      'started_at|datetime|开始时间',
      'finished_at|datetime|结束时间',
      'success|tinyint|是否成功',
      'message|varchar(1000)|输出',
    ], { cache: false }),
  ],
});

const notify = M({
  id: 'notify',
  name: '消息通知',
  group: '平台',
  abbr: 'NT',
  tagline: '站内信 · 邮件 · 短信',
  desc: '统一消息出口：模板渲染、渠道分发（站内信/邮件/短信/webhook）、已读状态。',
  requires: ['account'],
  features: { search: true },
  tables: [
    T('sys_message', '站内消息', [
      'receiver_id|bigint|接收人|req,idx,search',
      'title|varchar(128)|标题|search',
      'content|text|内容',
      'channel|varchar(16)|渠道 inmail/email/sms',
      'biz_module|varchar(64)|来源模块',
      'read_at|datetime|阅读时间',
      'status|tinyint|状态 0未发1已发',
    ], { search: ['title', 'receiver_id'] }),
    T('sys_message_template', '消息模板', [
      'tpl_code|varchar(64)|模板编码|req,uniq,search',
      'channel|varchar(16)|渠道',
      'title|varchar(128)|标题模板',
      'content|text|内容模板',
    ], { search: ['tpl_code'] }),
  ],
});

const file = M({
  id: 'file',
  name: '对象存储',
  group: '平台',
  abbr: 'OS',
  tagline: 'S3 / MinIO 直传与签名 URL',
  desc: '统一文件服务：预签名上传、下载、删除、按业务归档。支持 S3、MinIO、本地磁盘三种后端。',
  requires: [],
  features: { storage: true, cache: true },
  tables: [
    T('sys_file', '文件元数据', [
      'bucket|varchar(64)|存储桶',
      'object_key|varchar(512)|对象 Key|req,uniq,search',
      'origin_name|varchar(255)|原始文件名|search',
      'ext|varchar(32)|扩展名|idx,search',
      'mime|varchar(128)|MIME',
      'size|bigint|字节大小',
      'sha256|varchar(64)|内容哈希|idx',
      'biz_module|varchar(64)|业务模块|idx',
      'biz_id|bigint|业务ID|idx',
      'url|varchar(1024)|访问地址',
      'uploader_id|bigint|上传人',
    ], { search: ['origin_name', 'ext', 'object_key'] }),
  ],
});

const searchMod = M({
  id: 'search',
  name: '搜索引擎',
  group: '平台',
  abbr: 'SE',
  tagline: 'Redis 倒排索引，可选 Elasticsearch',
  desc: '给任意表开搜索：指定可搜字段，自动构建倒排索引与关键词高亮。默认 Redis 实现（零外部依赖），勾选 ES 时切换为 Elasticsearch。',
  requires: ['cache'],
  features: { search: true, cache: true },
  tables: [
    T('sys_search_index', '搜索索引登记', [
      'table_name|varchar(64)|表名|req,uniq,search',
      'fields|varchar(512)|可搜字段(逗号分隔)',
      'engine|varchar(16)|引擎 redis/es',
      'doc_count|bigint|文档数',
      'rebuild_at|datetime|最近重建',
    ], { search: ['table_name'] }),
  ],
});

const cacheMod = M({
  id: 'cache',
  name: 'Redis 选表加速',
  group: '平台',
  abbr: 'RD',
  tagline: '按表开缓存，旁路 + 失效',
  desc: '任选表开启二级缓存：key 规范、TTL、写后失效、空值防穿透、热点计数。生成对应的 CacheService 与配置。',
  requires: [],
  features: { cache: true, noTable: true },
  tables: [],
});

/* ============================ 业务模块 ============================ */

const order = M({
  id: 'order',
  name: '订单管理',
  group: '交易',
  abbr: 'OR',
  tagline: '下单 · 明细 · 状态机 · 审核',
  desc: '订单主表 + 明细表，标准增删改查、状态流转、导出，可挂接审核。金额、买家、状态、时间全字段可检索。',
  requires: ['account', 'rbac'],
  features: { audit: true, search: true, export: true, import: true, cache: true },
  tables: [
    T('biz_order', '订单主表', [
      'order_no|varchar(64)|订单号|req,uniq,search',
      'buyer_id|bigint|买家ID|req,idx',
      'buyer_name|varchar(64)|买家名称|search',
      'total_amount|decimal(14,2)|订单总额|req',
      'pay_amount|decimal(14,2)|实付金额',
      'currency|varchar(8)|币种',
      'pay_status|tinyint|支付状态 0未付1已付2已退',
      'order_status|tinyint|订单状态 1待审2已审3发货4完成5取消',
      'source|varchar(32)|来源渠道|search',
      'receiver|varchar(64)|收货人',
      'receiver_phone|varchar(32)|收货电话',
      'receiver_addr|varchar(512)|收货地址',
      'remark|varchar(500)|备注',
      'paid_at|datetime|支付时间',
    ], { search: ['order_no', 'buyer_name', 'source'] }),
    T('biz_order_item', '订单明细', [
      'order_id|bigint|订单ID|req,idx',
      'product_id|bigint|商品ID|req,idx',
      'product_name|varchar(255)|商品名称|search',
      'sku|varchar(64)|规格',
      'price|decimal(14,2)|单价',
      'quantity|int|数量',
      'amount|decimal(14,2)|小计',
    ], { search: ['product_name'] }),
  ],
});

const product = M({
  id: 'product',
  name: '商品管理',
  group: '商品',
  abbr: 'PD',
  tagline: 'SPU / SKU / 分类 / 上下架',
  desc: '商品主数据与分类树，支持多规格、价格、库存联动、上下架状态与审核。',
  requires: ['account'],
  features: { audit: true, search: true, export: true, cache: true },
  tables: [
    T('biz_product', '商品', [
      'product_no|varchar(64)|商品编码|req,uniq,search',
      'product_name|varchar(255)|商品名称|req,search',
      'category_id|bigint|分类ID|idx',
      'brand|varchar(64)|品牌|search',
      'price|decimal(14,2)|售价',
      'cost|decimal(14,2)|成本价',
      'stock|int|库存',
      'unit|varchar(16)|单位',
      'cover|varchar(512)|主图',
      'detail|text|详情',
      'status|tinyint|状态 0下架1上架2待审',
    ], { search: ['product_name', 'product_no', 'brand'] }),
    T('biz_category', '商品分类', [
      'parent_id|bigint|上级分类|idx',
      'category_name|varchar(64)|分类名称|req,search',
      'sort|int|排序',
    ], { search: ['category_name'] }),
    T('biz_sku', 'SKU 规格', [
      'product_id|bigint|商品ID|req,idx',
      'sku_code|varchar(64)|SKU编码|req,uniq,search',
      'spec|varchar(255)|规格描述',
      'price|decimal(14,2)|价格',
      'stock|int|库存',
    ], { search: ['sku_code'] }),
  ],
});

const inventory = M({
  id: 'inventory',
  name: '库存管理',
  group: '商品',
  abbr: 'IV',
  tagline: '入库 · 出库 · 盘点 · 预警',
  desc: '库存台账与流水，出入库扣减带乐观锁，低库存预警。',
  requires: ['product'],
  features: { search: true, cache: true },
  tables: [
    T('biz_stock', '库存台账', [
      'product_id|bigint|商品ID|req,idx',
      'sku_id|bigint|SKU ID|idx',
      'warehouse|varchar(64)|仓库|search',
      'quantity|int|可用数量',
      'locked|int|锁定数量',
      'warn_line|int|预警线',
    ], { search: ['warehouse'] }),
    T('biz_stock_log', '库存流水', [
      'product_id|bigint|商品ID|req,idx',
      'change|int|变动数量',
      'type|varchar(16)|类型 in/out/check',
      'before_qty|int|变动前',
      'after_qty|int|变动后',
      'biz_no|varchar(64)|关联单号|idx,search',
      'operator_id|bigint|操作人',
    ], { search: ['biz_no'] }),
  ],
});

const payment = M({
  id: 'payment',
  name: '支付管理',
  group: '交易',
  abbr: 'PY',
  tagline: '支付单 · 退款 · 对账',
  desc: '支付流水与退款，支持多渠道（微信/支付宝/余额），幂等与回调验签。',
  requires: ['order'],
  features: { search: true, export: true },
  tables: [
    T('biz_payment', '支付单', [
      'pay_no|varchar(64)|支付单号|req,uniq,search',
      'order_id|bigint|订单ID|req,idx',
      'channel|varchar(32)|渠道 wxpay/alipay/balance|search',
      'amount|decimal(14,2)|金额',
      'status|tinyint|状态 0待付1成功2失败3已退',
      'trade_no|varchar(128)|第三方流水号|idx',
      'paid_at|datetime|支付时间',
      'raw|text|原始回调',
    ], { search: ['pay_no', 'channel'] }),
    T('biz_payment_refund', '支付退款流水', [
      'payment_id|bigint|支付单ID|req,idx',
      'refund_no|varchar(64)|退款单号|req,uniq,search',
      'amount|decimal(14,2)|退款金额',
      'reason|varchar(500)|原因',
      'status|tinyint|状态 0处理中1成功2失败',
    ], { search: ['refund_no'] }),
  ],
});

const customer = M({
  id: 'customer',
  name: '客户管理',
  group: '交易',
  abbr: 'CU',
  tagline: '会员 · 标签 · 消费画像',
  desc: '客户/会员主数据，等级、积分、标签、累计消费，支持搜索与导出。',
  requires: ['account'],
  features: { search: true, export: true, cache: true },
  tables: [
    T('biz_customer', '客户', [
      'customer_no|varchar(64)|客户编号|req,uniq,search',
      'name|varchar(64)|姓名|req,search',
      'phone|varchar(32)|手机号|idx,search',
      'email|varchar(128)|邮箱|search',
      'level|tinyint|等级',
      'points|int|积分',
      'total_amount|decimal(14,2)|累计消费',
      'tags|varchar(255)|标签|search',
      'source|varchar(32)|来源',
    ], { search: ['name', 'phone', 'customer_no', 'tags'] }),
  ],
});

const cart = M({
  id: 'cart',
  name: '购物车',
  group: '交易',
  abbr: 'CT',
  tagline: '加购 · 改数量 · 结算',
  desc: '购物车行项目，按用户隔离，支持增减数量、勾选、清空、合并下单。',
  requires: ['product'],
  features: { cache: true },
  tables: [
    T('biz_cart', '购物车', [
      'user_id|bigint|用户ID|req,idx',
      'product_id|bigint|商品ID|req,idx',
      'sku_id|bigint|SKU ID',
      'quantity|int|数量',
      'checked|tinyint|是否勾选',
    ], { cacheTtl: 600 }),
  ],
});

const address = M({
  id: 'address',
  name: '收货地址',
  group: '交易',
  abbr: 'AD',
  tagline: '地址簿 · 默认地址',
  desc: '用户地址簿，省市区、默认标记、手机号脱敏返回。',
  requires: ['account'],
  features: { cache: true },
  tables: [
    T('biz_address', '收货地址', [
      'user_id|bigint|用户ID|req,idx',
      'receiver|varchar(64)|收货人|req',
      'phone|varchar(32)|手机号|req',
      'province|varchar(64)|省',
      'city|varchar(64)|市',
      'district|varchar(64)|区县',
      'detail|varchar(512)|详细地址',
      'is_default|tinyint|默认地址',
    ], { cacheTtl: 600 }),
  ],
});

const coupon = M({
  id: 'coupon',
  name: '优惠券',
  group: '营销',
  abbr: 'CP',
  tagline: '满减 · 折扣 · 领用核销',
  desc: '优惠券模板与领用记录，支持满减、折扣、有效期、库存与核销。',
  requires: ['order'],
  features: { search: true, cache: true },
  tables: [
    T('biz_coupon', '优惠券', [
      'coupon_code|varchar(64)|券码|req,uniq,search',
      'coupon_name|varchar(128)|名称|search',
      'type|tinyint|类型 1满减2折扣',
      'value|decimal(14,2)|面值/折扣',
      'threshold|decimal(14,2)|门槛',
      'total|int|发放总量',
      'remain|int|剩余',
      'start_at|datetime|开始时间',
      'end_at|datetime|结束时间',
      'status|tinyint|状态',
    ], { search: ['coupon_code', 'coupon_name'] }),
    T('biz_coupon_record', '领用记录', [
      'coupon_id|bigint|券ID|req,idx',
      'user_id|bigint|用户ID|req,idx',
      'order_id|bigint|订单ID',
      'used_at|datetime|核销时间',
      'status|tinyint|状态 0未用1已用2过期',
    ]),
  ],
});

const cms = M({
  id: 'cms',
  name: '内容管理',
  group: '内容',
  abbr: 'CM',
  tagline: '文章 · 栏目 · 发布审核',
  desc: '文章/公告的栏目化内容管理，富文本、封面、发布状态与审核。',
  requires: ['account'],
  features: { audit: true, search: true, storage: true },
  tables: [
    T('cms_article', '文章', [
      'title|varchar(255)|标题|req,search',
      'category_id|bigint|栏目ID|idx',
      'cover|varchar(512)|封面',
      'summary|varchar(500)|摘要|search',
      'content|text|正文',
      'author|varchar(64)|作者|search',
      'status|tinyint|状态 0草稿1待审2已发3下线',
      'published_at|datetime|发布时间',
      'views|bigint|阅读量',
    ], { search: ['title', 'summary', 'author'] }),
    T('cms_category', '栏目', [
      'parent_id|bigint|上级栏目|idx',
      'category_name|varchar(64)|栏目名称|req,search',
      'sort|int|排序',
    ], { search: ['category_name'] }),
  ],
});

const comment = M({
  id: 'comment',
  name: '评论互动',
  group: '内容',
  abbr: 'CO',
  tagline: '评论 · 点赞 · 敏感词',
  desc: '通用评论组件，可挂在任意业务对象（biz_module + biz_id），支持审核与敏感词过滤。',
  requires: ['account'],
  features: { audit: true, search: true },
  tables: [
    T('biz_comment', '评论', [
      'biz_module|varchar(64)|业务模块|req,idx,search',
      'biz_id|bigint|业务ID|req,idx',
      'user_id|bigint|用户ID|req,idx',
      'content|varchar(1000)|内容|search',
      'parent_id|bigint|父评论',
      'like_count|int|点赞数',
      'status|tinyint|状态 0待审1通过2屏蔽',
    ], { search: ['content'] }),
  ],
});

const mediaUpload = M({
  id: 'media-upload',
  name: '媒体上传业务',
  group: '媒体',
  abbr: 'UP',
  tagline: '按扩展名分流：音频/视频/文档',
  desc: '一个上传业务可复制多份：配置允许的扩展名与大小上限，系统自动判定资产类型（音频、视频、Word/PPT/PDF、图片、压缩包），并落到对应目录与元数据。',
  requires: ['file'],
  features: { storage: true, search: true, cache: true },
  tables: [
    T('media_asset', '媒体资产', [
      'asset_no|varchar(64)|资产编号|req,uniq,search',
      'asset_type|varchar(16)|类型 audio/video/doc/image/archive|idx,search',
      'title|varchar(255)|标题|search',
      'bucket|varchar(64)|桶',
      'object_key|varchar(512)|对象Key|req',
      'ext|varchar(32)|扩展名|idx,search',
      'mime|varchar(128)|MIME',
      'size|bigint|大小',
      'duration|int|时长(秒)',
      'width|int|宽',
      'height|int|高',
      'cover|varchar(512)|封面',
      'biz_module|varchar(64)|归属业务|idx',
      'biz_id|bigint|归属ID|idx',
      'status|tinyint|状态 0待转码1可用2禁用',
    ], { search: ['title', 'asset_no', 'ext', 'asset_type'] }),
  ],
});

const mediaPlay = M({
  id: 'media-play',
  name: '视频播放业务',
  group: '媒体',
  abbr: 'PL',
  tagline: '播放列表 · 签名地址 · 进度',
  desc: '播放列表与播放记录：生成带时效的播放地址（防盗链）、续播进度、播放数统计。可按需添加多个播放业务。',
  requires: ['media-upload'],
  features: { storage: true, search: true, cache: true },
  tables: [
    T('media_playlist', '播放列表', [
      'list_name|varchar(128)|列表名称|req,search',
      'cover|varchar(512)|封面',
      'description|varchar(500)|简介|search',
      'asset_count|int|条目数',
      'status|tinyint|状态 0隐藏1公开',
    ], { search: ['list_name', 'description'] }),
    T('media_playlist_item', '播放条目', [
      'playlist_id|bigint|列表ID|req,idx',
      'asset_id|bigint|资产ID|req,idx',
      'sort|int|排序',
    ]),
    T('media_play_record', '播放记录', [
      'asset_id|bigint|资产ID|req,idx,search',
      'user_id|bigint|用户ID|idx,search',
      'progress|int|进度(秒)',
      'duration|int|总时长',
      'finished|tinyint|是否看完',
      'played_at|datetime|播放时间',
    ], { search: ['asset_id', 'user_id'], cache: false }),
  ],
});

const report = M({
  id: 'report',
  name: '报表统计',
  group: '平台',
  abbr: 'RP',
  tagline: '日/周/月快照与看板',
  desc: '按维度聚合的业务指标快照，提供看板接口；也可直接对业务表做分组统计。',
  requires: ['auth'],
  features: { export: true, cache: true },
  tables: [
    T('report_snapshot', '统计快照', [
      'metric|varchar(64)|指标|req,idx,search',
      'dimension|varchar(64)|维度',
      'dim_value|varchar(128)|维度值|idx',
      'period|varchar(16)|周期 day/week/month',
      'stat_date|date|统计日期|idx',
      'value|decimal(20,4)|数值',
      'extra|json|扩展',
    ], { search: ['metric', 'dim_value'], cacheTtl: 60 }),
  ],
});

const importExport = M({
  id: 'import-export',
  name: '导入导出',
  group: '平台',
  abbr: 'IE',
  tagline: 'Excel 批量导入，异步任务',
  desc: '任意表按模板批量导入、异步导出，失败行回写错误原因，任务进度可查。',
  requires: ['file'],
  features: { export: true, import: true },
  tables: [
    T('sys_import_task', '导入任务', [
      'task_no|varchar(64)|任务号|req,uniq,search',
      'biz_module|varchar(64)|目标模块|req,idx,search',
      'file_id|bigint|文件ID',
      'total|int|总行数',
      'success_count|int|成功数',
      'fail_count|int|失败数',
      'status|tinyint|状态 0排队1处理2完成3失败',
      'error_file|varchar(512)|错误文件地址',
    ], { search: ['task_no', 'biz_module'], cache: false }),
  ],
});

const webhook = M({
  id: 'webhook',
  name: '回调通知',
  group: '平台',
  abbr: 'WH',
  tagline: '事件订阅 · 重试 · 签名',
  desc: '业务事件（订单创建、审核通过…）推送到外部 URL，HMAC 签名，失败自动重试。',
  requires: [],
  features: { cache: true },
  tables: [
    T('sys_webhook', '回调配置', [
      'hook_name|varchar(128)|名称|req,search',
      'event|varchar(64)|事件|req,idx,search',
      'url|varchar(1024)|地址|req',
      'secret|varchar(128)|签名密钥',
      'status|tinyint|状态',
      'retry|int|最大重试',
    ], { search: ['hook_name', 'event'] }),
    T('sys_webhook_log', '回调日志', [
      'webhook_id|bigint|配置ID|req,idx',
      'event|varchar(64)|事件',
      'payload|text|报文',
      'response|varchar(1000)|响应',
      'success|tinyint|是否成功',
      'attempt|int|第几次',
    ], { cache: false }),
  ],
});

const supplier = M({
  id: 'supplier',
  name: '供应商管理',
  group: '供应链',
  abbr: 'SP',
  tagline: '档案 · 资质 · 合作状态',
  desc: '供应商档案与资质到期提醒，关联采购与结算。',
  requires: ['account'],
  features: { search: true, audit: true },
  tables: [
    T('biz_supplier', '供应商', [
      'supplier_no|varchar(64)|供应商编码|req,uniq,search',
      'supplier_name|varchar(128)|名称|req,search',
      'contact|varchar(64)|联系人|search',
      'phone|varchar(32)|电话|idx',
      'address|varchar(512)|地址',
      'level|tinyint|等级',
      'status|tinyint|状态 0停用1合作中2待审',
      'license_expire|date|资质到期',
    ], { search: ['supplier_name', 'supplier_no', 'contact'] }),
  ],
});

const contract = M({
  id: 'contract',
  name: '合同管理',
  group: '供应链',
  abbr: 'CN',
  tagline: '起草 · 审批 · 归档 · 到期',
  desc: '合同台账、附件、金额、相对方，走通用审核流，到期预警。',
  requires: ['approval', 'file'],
  features: { audit: true, search: true, storage: true },
  tables: [
    T('biz_contract', '合同', [
      'contract_no|varchar(64)|合同号|req,uniq,search',
      'title|varchar(255)|合同名称|req,search',
      'party|varchar(128)|相对方|search',
      'amount|decimal(16,2)|金额',
      'sign_at|date|签订日期',
      'start_at|date|生效日期',
      'end_at|date|到期日期',
      'file_id|bigint|附件ID',
      'status|tinyint|状态 0草稿1待审2生效3终止',
    ], { search: ['contract_no', 'title', 'party'] }),
  ],
});

const ticket = M({
  id: 'ticket',
  name: '工单系统',
  group: '服务',
  abbr: 'TK',
  tagline: '提交 · 派单 · 处理 · 评价',
  desc: '服务工单：提交、指派、处理、关闭、满意度评价，适合客服与运维场景。',
  requires: ['account', 'approval'],
  features: { audit: true, search: true, cache: true },
  tables: [
    T('biz_ticket', '工单', [
      'ticket_no|varchar(64)|工单号|req,uniq,search',
      'title|varchar(255)|标题|req,search',
      'content|text|描述',
      'type|varchar(32)|类型|search',
      'priority|tinyint|优先级 1低2中3高4紧急',
      'status|tinyint|状态 0待派1处理中2已解决3关闭',
      'reporter_id|bigint|提交人|idx',
      'assignee_id|bigint|处理人|idx,search',
      'satisfaction|tinyint|满意度 1-5',
      'closed_at|datetime|关闭时间',
    ], { search: ['ticket_no', 'title', 'assignee_id'] }),
  ],
});

const points = M({
  id: 'points',
  name: '积分体系',
  group: '营销',
  abbr: 'PT',
  tagline: '获取 · 消耗 · 流水',
  desc: '积分账户与流水，规则化获取/消耗，防并发超扣。',
  requires: ['customer'],
  features: { cache: true },
  tables: [
    T('biz_points_log', '积分流水', [
      'user_id|bigint|用户ID|req,idx,search',
      'change|int|变动值',
      'balance|int|变动后余额',
      'type|varchar(32)|类型|search',
      'biz_no|varchar(64)|关联单号|idx',
      'remark|varchar(255)|备注',
    ], { search: ['user_id', 'type'], cache: false }),
  ],
});

/* ---------- 商品多规格 / 多素材（一个商品挂多个 SKU、多个视频与图片） ---------- */

const productVariant = M({
  id: 'product-variant',
  name: '商品多规格',
  group: '商品',
  abbr: 'PV',
  tagline: '一商品多 SKU · 多规格组 · 多图多视频',
  desc: '把「一个商品」拆成 N 个规格组、N 个 SKU、N 个素材：颜色/尺寸任意组合，每个 SKU 独立价格与库存，每个商品可挂多张图与多段视频。',
  requires: ['product', 'media-upload'],
  features: { search: true, cache: true },
  tables: [
    T('biz_product_spec', '规格组', [
      'product_id|bigint|商品ID|req,idx',
      'spec_name|varchar(64)|规格名 如颜色|req,search',
      'spec_values|varchar(1000)|可选值 逗号分隔',
      'sort|int|排序',
    ], { search: ['spec_name'] }),
    T('biz_product_media', '商品素材', [
      'product_id|bigint|商品ID|req,idx',
      'asset_id|bigint|媒体资产ID|idx',
      'media_type|varchar(16)|类型 image/video|idx,search',
      'url|varchar(512)|地址',
      'sort|int|排序',
      'is_cover|tinyint|是否主图',
    ], { search: ['media_type'] }),
  ],
});

/* ---------- 视频分区 + 插件（同一套插件机制，不同分区挂不同插件） ---------- */

const mediaPartition = M({
  id: 'media-partition',
  name: '视频分区与插件',
  group: '媒体',
  abbr: 'PT2',
  tagline: '分区挂插件：转码/水印/防盗链/弹幕',
  desc: '视频按分区（频道/栏目）组织，每个分区绑定一个插件与一份配置；插件本质是同一套接口（预处理→播放地址→回调），换分区就等于换策略。',
  requires: ['media-upload', 'media-play'],
  features: { search: true, cache: true, plugin: true },
  tables: [
    T('media_partition', '视频分区', [
      'partition_code|varchar(64)|分区编码|req,uniq,search',
      'partition_name|varchar(128)|分区名称|req,search',
      'plugin_code|varchar(64)|插件编码|req,idx',
      'plugin_config|text|插件配置 JSON',
      'sort|int|排序',
      'status|tinyint|状态 0停用1启用',
    ], { search: ['partition_name', 'partition_code'] }),
    T('media_plugin', '插件登记', [
      'plugin_code|varchar(64)|插件编码|req,uniq,search',
      'plugin_name|varchar(128)|插件名称|req',
      'kind|varchar(32)|类型 transcode/watermark/drm/danmaku/playlist|idx,search',
      'version|varchar(32)|版本',
      'config_schema|text|配置模板',
      'enabled|tinyint|是否启用',
    ], { search: ['plugin_name', 'kind'] }),
    T('media_partition_asset', '分区内容', [
      'partition_id|bigint|分区ID|req,idx',
      'asset_id|bigint|资产ID|req,idx',
      'sort|int|排序',
    ]),
  ],
});

/* ---------- 常见业务补齐 ---------- */

const member = M({
  id: 'member',
  name: '会员体系',
  group: '会员',
  abbr: 'MB',
  tagline: '等级 · 成长值 · 权益',
  desc: '会员等级与权益配置，成长值累积自动升级，权益按等级下发。',
  requires: ['customer', 'order'],
  features: { cache: true, search: true },
  tables: [
    T('biz_member_level', '会员等级', [
      'level_code|varchar(32)|等级编码|req,uniq,search',
      'level_name|varchar(64)|等级名称|req,search',
      'growth|int|所需成长值',
      'discount|decimal(5,2)|折扣',
      'rights|varchar(1000)|权益说明',
    ], { search: ['level_name', 'level_code'] }),
    T('biz_member', '会员卡', [
      'user_id|bigint|用户ID|req,uniq,idx,search',
      'level_id|bigint|等级ID|idx',
      'growth|int|成长值',
      'balance|decimal(14,2)|余额',
      'expire_at|datetime|到期时间',
      'status|tinyint|状态 0停用1正常',
    ], { search: ['user_id'] }),
  ],
});

const signin = M({
  id: 'signin',
  name: '签到打卡',
  group: '营销',
  abbr: 'SG',
  tagline: '连续签到 · 补签 · 奖励',
  desc: '每日签到与连续天数统计，支持补签卡与阶梯奖励。',
  requires: ['customer'],
  features: { cache: true, search: true },
  tables: [
    T('biz_signin_log', '签到记录', [
      'user_id|bigint|用户ID|req,idx,search',
      'sign_date|date|签到日期|req,idx',
      'days|int|连续天数',
      'reward|int|获得积分',
      'supplement|tinyint|是否补签',
    ], { search: ['user_id'] }),
  ],
});

const wallet = M({
  id: 'wallet',
  name: '钱包提现',
  group: '交易',
  abbr: 'WL',
  tagline: '余额 · 冻结 · 提现审核',
  desc: '用户钱包余额与流水，提现申请走审核，冻结金额防超提。',
  requires: ['payment', 'customer', 'approval'],
  features: { audit: true, search: true },
  tables: [
    T('biz_wallet', '钱包', [
      'user_id|bigint|用户ID|req,uniq,idx,search',
      'balance|decimal(14,2)|可用余额',
      'frozen|decimal(14,2)|冻结金额',
      'version_lock|int|版本号',
    ], { search: ['user_id'] }),
    T('biz_withdraw', '提现单', [
      'withdraw_no|varchar(64)|提现单号|req,uniq,search',
      'user_id|bigint|用户ID|req,idx,search',
      'amount|decimal(14,2)|金额',
      'channel|varchar(32)|渠道 alipay/wechat/bank|search',
      'account|varchar(128)|收款账号',
      'status|tinyint|状态 0待审1通过2驳回3已打款',
      'audit_remark|varchar(500)|审核备注',
    ], { search: ['withdraw_no', 'user_id', 'channel'] }),
  ],
});

const refund = M({
  id: 'refund',
  name: '退款售后',
  group: '交易',
  abbr: 'RF',
  tagline: '仅退款 · 退货退款 · 仲裁',
  desc: '售后单与退款流水：申请、审核、退货物流、退款执行，支持部分退款。',
  requires: ['payment', 'approval'],
  features: { audit: true, search: true },
  tables: [
    T('biz_refund', '售后单', [
      'refund_no|varchar(64)|售后单号|req,uniq,search',
      'order_id|bigint|订单ID|req,idx,search',
      'user_id|bigint|用户ID|idx',
      'amount|decimal(14,2)|退款金额',
      'reason|varchar(500)|原因',
      'type|varchar(16)|类型 refund/return|search',
      'status|tinyint|状态 0申请1同意2拒绝3退货中4完成',
      'logistics_no|varchar(64)|退货物流单号|search',
    ], { search: ['refund_no', 'order_id'] }),
  ],
});

const logistics = M({
  id: 'logistics',
  name: '物流配送',
  group: '交易',
  abbr: 'LG',
  tagline: '发货 · 轨迹 · 签收',
  desc: '发货单与物流轨迹，多承运商对接，签收状态回写订单。',
  requires: ['order'],
  features: { search: true, cache: true },
  tables: [
    T('biz_shipment', '发货单', [
      'shipment_no|varchar(64)|发货单号|req,uniq,search',
      'order_id|bigint|订单ID|req,idx,search',
      'carrier|varchar(64)|承运商|search',
      'tracking_no|varchar(64)|运单号|idx,search',
      'status|tinyint|状态 0待发货1已发货2运输中3已签收',
      'shipped_at|datetime|发货时间',
      'received_at|datetime|签收时间',
    ], { search: ['shipment_no', 'tracking_no', 'carrier'] }),
    T('biz_shipment_trace', '物流轨迹', [
      'shipment_id|bigint|发货单ID|req,idx',
      'trace_time|datetime|时间',
      'location|varchar(255)|地点',
      'description|varchar(500)|描述|search',
    ], { search: ['description'], cache: false }),
  ],
});

const review = M({
  id: 'review',
  name: '评价晒单',
  group: '商品',
  abbr: 'RV',
  tagline: '评分 · 图文 · 审核 · 回复',
  desc: '订单评价与晒单，星级评分、图片、商家回复，敏感词审核。',
  requires: ['order', 'product'],
  features: { audit: true, search: true, storage: true },
  tables: [
    T('biz_review', '评价', [
      'order_id|bigint|订单ID|req,idx,search',
      'product_id|bigint|商品ID|req,idx,search',
      'user_id|bigint|用户ID|idx',
      'score|tinyint|评分1-5',
      'content|varchar(1000)|评价内容|search',
      'images|varchar(2000)|图片 逗号分隔',
      'reply|varchar(1000)|商家回复',
      'status|tinyint|状态 0待审1通过2隐藏',
    ], { search: ['content', 'product_id'] }),
  ],
});

const favorite = M({
  id: 'favorite',
  name: '收藏夹',
  group: '商品',
  abbr: 'FV',
  tagline: '收藏 · 取消 · 分组',
  desc: '商品/内容收藏，支持分组与批量取消。',
  requires: ['customer', 'product'],
  features: { cache: true, search: true },
  tables: [
    T('biz_favorite', '收藏', [
      'user_id|bigint|用户ID|req,idx,search',
      'biz_type|varchar(32)|业务类型|req,idx,search',
      'biz_id|bigint|业务ID|req,idx',
      'group_name|varchar(64)|分组',
    ], { search: ['biz_type'] }),
  ],
});

const danmaku = M({
  id: 'danmaku',
  name: '弹幕互动',
  group: '媒体',
  abbr: 'DM',
  tagline: '实时弹幕 · 审核 · 屏蔽词',
  desc: '视频弹幕：按时间轴发送、颜色与位置、屏蔽词过滤，播放时按时间窗口拉取。',
  requires: ['media-play'],
  features: { search: true, cache: true },
  tables: [
    T('biz_danmaku', '弹幕', [
      'asset_id|bigint|资产ID|req,idx,search',
      'user_id|bigint|用户ID|idx',
      'content|varchar(500)|内容|search',
      'offset_ms|int|时间轴(毫秒)',
      'color|varchar(16)|颜色',
      'mode|varchar(16)|模式 scroll/top/bottom',
      'status|tinyint|状态 0待审1显示2屏蔽',
    ], { search: ['content'], cache: false }),
  ],
});

const notice = M({
  id: 'notice',
  name: '公告通知',
  group: '平台',
  abbr: 'NT',
  tagline: '站内公告 · 定时发布 · 已读',
  desc: '公告与站内信：富文本、定时发布、按用户已读回执。',
  requires: ['account'],
  features: { cache: true, search: true },
  tables: [
    T('sys_notice', '公告', [
      'title|varchar(255)|标题|req,search',
      'content|text|正文',
      'level|varchar(16)|级别 info/warn/urgent',
      'publish_at|datetime|发布时间',
      'expire_at|datetime|失效时间',
      'status|tinyint|状态 0草稿1已发布2下线',
    ], { search: ['title'] }),
    T('sys_notice_read', '已读回执', [
      'notice_id|bigint|公告ID|req,idx',
      'user_id|bigint|用户ID|req,idx',
      'read_at|datetime|阅读时间',
    ], { cache: false }),
  ],
});

const tag = M({
  id: 'tag',
  name: '标签体系',
  group: '平台',
  abbr: 'TG',
  tagline: '多标签 · 多业务复用',
  desc: '通用标签与标签关系，商品/内容/用户共用一套标签。',
  requires: ['account'],
  features: { search: true, cache: true },
  tables: [
    T('sys_tag', '标签', [
      'tag_name|varchar(64)|标签名|req,uniq,search',
      'tag_type|varchar(32)|类型|idx,search',
      'color|varchar(16)|颜色',
    ], { search: ['tag_name', 'tag_type'] }),
    T('sys_tag_rel', '标签关系', [
      'tag_id|bigint|标签ID|req,idx',
      'biz_type|varchar(32)|业务类型|req,idx',
      'biz_id|bigint|业务ID|req,idx',
    ]),
  ],
});

const seckill = M({
  id: 'seckill',
  name: '秒杀活动',
  group: '营销',
  abbr: 'SK',
  tagline: '限时 · 限购 · 防超卖',
  desc: '秒杀场次与商品，Redis 预扣库存，单用户限购，防超卖。',
  requires: ['product', 'order'],
  features: { cache: true, search: true },
  tables: [
    T('biz_seckill_activity', '秒杀活动', [
      'activity_name|varchar(128)|活动名|req,search',
      'start_at|datetime|开始时间',
      'end_at|datetime|结束时间',
      'status|tinyint|状态 0未开始1进行中2结束',
    ], { search: ['activity_name'] }),
    T('biz_seckill_item', '秒杀商品', [
      'activity_id|bigint|活动ID|req,idx',
      'product_id|bigint|商品ID|req,idx',
      'sku_id|bigint|SKU ID|idx',
      'seckill_price|decimal(14,2)|秒杀价',
      'stock|int|秒杀库存',
      'limit_per_user|int|每人限购',
    ]),
  ],
});

const invoice = M({
  id: 'invoice',
  name: '发票管理',
  group: '交易',
  abbr: 'IV2',
  tagline: '开票 · 抬头 · 红冲',
  desc: '发票申请与开具：抬头、税号、金额、状态流转。',
  requires: ['order'],
  features: { search: true },
  tables: [
    T('biz_invoice', '发票', [
      'invoice_no|varchar(64)|发票号|req,uniq,search',
      'order_id|bigint|订单ID|req,idx,search',
      'title|varchar(128)|抬头|search',
      'tax_no|varchar(64)|税号',
      'amount|decimal(14,2)|金额',
      'type|varchar(16)|类型 personal/company',
      'status|tinyint|状态 0申请1已开2红冲',
    ], { search: ['invoice_no', 'title'] }),
  ],
});

const im = M({
  id: 'im',
  name: '站内私信',
  group: '平台',
  abbr: 'IM',
  tagline: '会话 · 消息 · 未读',
  desc: '站内私信与会话列表，未读数统计与已读回执。',
  requires: ['account', 'notify'],
  features: { search: true, cache: true },
  tables: [
    T('sys_im_session', '会话', [
      'session_key|varchar(64)|会话键|req,uniq,idx,search',
      'user_a|bigint|用户A|req,idx',
      'user_b|bigint|用户B|req,idx',
      'last_msg|varchar(500)|最后一条|search',
      'unread_a|int|A未读',
      'unread_b|int|B未读',
      'last_active_at|datetime|最后活跃时间',
    ], { search: ['session_key', 'last_msg'] }),
    T('sys_im_message', '消息', [
      'session_id|bigint|会话ID|req,idx',
      'from_user|bigint|发送人|req,idx',
      'to_user|bigint|接收人|req,idx',
      'content|varchar(2000)|内容|search',
      'msg_type|varchar(16)|类型 text/image/file',
      'read_flag|tinyint|已读',
    ], { search: ['content'], cache: false }),
  ],
});

const MODULES = [
  auth, account, rbac, auditLog, approval, dict, tenant, apiKey, captcha, task,
  verifyCode,
  notify, file, searchMod, cacheMod,
  order, product, inventory, payment, customer, cart, address, coupon,
  cms, comment, mediaUpload, mediaPlay, report, importExport, webhook,
  supplier, contract, ticket, points,
  productVariant, mediaPartition, member, signin, wallet, refund, logistics,
  review, favorite, danmaku, notice, tag, seckill, invoice, im,
];

/* 生成"标准 CRUD 权限"的规则：每个模块自动注册 */
function permsOf(m) {
  const base = ['list', 'detail', 'create', 'update', 'delete'];
  if (m.features.export) base.push('export');
  if (m.features.import) base.push('import');
  if (m.features.audit) base.push('audit');
  if (m.features.storage) base.push('upload');
  return base.map((a) => ({
    code: `${m.id}:${a}`,
    name: `${m.name}·${({ list: '查询', detail: '详情', create: '新增', update: '修改', delete: '删除', export: '导出', import: '导入', audit: '审核', upload: '上传' })[a]}`,
  }));
}

/* 依赖闭包：勾一个模块，自动把它依赖的模块一起带上 */
function resolveSelection(ids) {
  const byId = new Map(MODULES.map((m) => [m.id, m]));
  const out = new Set();
  const walk = (id) => {
    if (out.has(id)) return;
    const m = byId.get(id);
    if (!m) return;
    out.add(id);
    (m.requires || []).forEach(walk);
  };
  ids.forEach(walk);
  return [...out];
}

function getModule(id) {
  return MODULES.find((m) => m.id === id) || null;
}

module.exports = { MODULES, getModule, permsOf, resolveSelection, COL, T };
