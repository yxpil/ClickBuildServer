// 作者：yxpil
'use strict';
const assert = require('assert');
const spec = require('../app/iface/spec');
const script = require('../app/iface/script');

(async () => {
  let ok = 0;
  const t = (name, fn) => { fn(); ok++; console.log('ok  ' + name); };

  const base = spec.seedProject();
  const p = spec.normalizeProject({
    ...base,
    upstreams: [{ id: 'crm', name: 'CRM', baseUrl: 'http://127.0.0.1:18901/', timeout: 5000 }],
    permissions: { enforce: true, roles: [{ key: 'admin', name: '管理员' }, { key: 'auditor', name: '审核员' }] },
  });
  t('上游客栈归一化', () => {
    assert.equal(p.upstreams.length, 1);
    assert.equal(p.upstreams[0].baseUrl, 'http://127.0.0.1:18901');
    assert.equal(p.permissions.enforce, true);
    assert.equal(p.permissions.roles.length, 2);
  });

  const iface = spec.normalizeIface({
    id: 'x', name: '集成接口', tables: [{ key: 'main', name: 'x_table', fields: [{ name: 'id', type: 'bigint', pk: true }] }],
    objects: { enabled: true, bucket: 'docs', prefix: 'pub/', pageSize: 10 },
    routes: [
      { id: 'r1', key: 'proxy', name: '转发', method: 'POST', path: '/proxy', roles: ['admin'], proxy: { enabled: true, upstream: 'crm', target: '/v1/users', timeout: 5000 } },
      { id: 'r2', key: 'objects', name: '对象表', method: 'GET', path: '/objects' },
    ],
  }, p, 0);
  t('代理/对象路由与角色归一化', () => {
    assert.equal(iface.routes[0].key, 'proxy');
    assert.deepEqual(iface.routes[0].roles, ['admin']);
    assert.equal(iface.routes[0].proxy.upstream, 'crm');
    assert.equal(iface.routes[1].key, 'objects');
    assert.equal(iface.objects.enabled, true);
    assert.equal(iface.objects.bucket, 'docs');
  });

  const parsed = script.parseScript('WAIT 20;\nLET $page = CRAWL \'https://example.com\' { "maxBytes": 1024 };\nRETURN 200 { "title": $page.title };');
  t('WAIT / CRAWL 解析', () => {
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.ast[0].k, 'wait');
    assert.equal(parsed.ast[1].from, 'crawl');
    assert.equal(parsed.ast[1].url, 'https://example.com');
  });

  const started = Date.now();
  let crawled = null;
  const result = await script.runScript(parsed.ast, {
    crawl: async (url, options) => { crawled = { url, options }; return { title: 'Example', text: 'hi', links: [] }; },
  });
  t('WAIT 实际延时', () => assert.ok(Date.now() - started >= 18));
  t('CRAWL 返回进入变量', () => {
    assert.equal(crawled.url, 'https://example.com');
    assert.equal(result.status, 200);
    assert.equal(result.body.title, 'Example');
  });

  const bad = script.parseScript('WAIT ;');
  t('WAIT 缺少数值报错', () => assert.ok(bad.errors.length > 0));

  console.log(`\n${ok}/${ok} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
