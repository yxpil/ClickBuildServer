'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const codegen = require('../app/iface/codegen');
const spec = require('../app/iface/spec');

const out = path.join(os.tmpdir(), 'cbs-integration-export');
fs.rmSync(out, { recursive: true, force: true });
const p = spec.seedProject();
p.name = '集成验收';
p.upstreams = [{ id: 'echo', name: 'Echo', baseUrl: 'http://127.0.0.1:18901', timeout: 5000 }];
p.permissions = { enforce: true, roles: [{ key: 'admin', name: '管理员' }] };
const it = p.interfaces[0];
it.objects = { enabled: true, bucket: 'clickbuild', prefix: '', pageSize: 20 };
it.routes.forEach((r) => { r.roles = ['admin']; });
it.routes.push({
  id: 'proxy1', key: 'proxy', name: '回声代理', method: 'POST', path: '/echo/:id', auth: true, roles: ['admin'],
  guard: { tx: false, rate: { enabled: false }, schedule: { enabled: false }, breaker: { enabled: false } },
  script: '# proxy', cache: { enabled: false }, docs: {}, proxy: { enabled: true, upstream: 'echo', target: '/echo', forwardHeaders: true, timeout: 5000 },
});
it.routes.push({
  id: 'crawl1', key: 'crawl', name: '抓取回声', method: 'GET', path: '/crawl-echo', auth: false, roles: [],
  guard: { tx: false, rate: { enabled: false }, schedule: { enabled: false }, breaker: { enabled: false } },
  script: 'LET $page = CRAWL \'http://127.0.0.1:18901/\' { "allowPrivate": true };\nWAIT 30;\nRETURN 200 { "title": $page.title, "bytes": $page.bytes, "status": $page.status };',
  cache: { enabled: false }, docs: {},
});
it.routes.push({
  id: 'obj1', key: 'objects', name: '对象表', method: 'GET', path: '/objects', auth: false, roles: [],
  guard: { tx: false, rate: { enabled: false }, schedule: { enabled: false }, breaker: { enabled: false } },
  script: '# objects', cache: { enabled: false }, docs: {},
});
const result = codegen.writeTo(p, out, { port: 18998 });
console.log(out);
console.log('files', result.files.length);
console.log('python', fs.existsSync(path.join(out, 'native/python/app.py')), fs.existsSync(path.join(out, 'native/python/service.json')));
