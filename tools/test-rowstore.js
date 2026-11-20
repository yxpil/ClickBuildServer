'use strict';
const assert = require('assert');
const { create } = require('../app/iface/rowstore');

const store = { mode: 'redis', ttl: 0, max: 10000, flushMs: 5000 };
const iface = {
  id: 'blog', name: '博客',
  tables: [
    { name: 'posts', store, fields: [
      { name: 'id', type: 'int', pk: true, autoIncrement: true },
      { name: 'title', type: 'string' },
      { name: 'status', type: 'string' },
    ] },
    { name: 'comments', store, fields: [
      { name: 'id', type: 'int', pk: true, autoIncrement: true },
      { name: 'post_id', type: 'int' },
      { name: 'body', type: 'string' },
    ] },
  ],
};

// 最小 Redis 哈希 mock，验证跨实例持久化
const hashes = new Map();
const redis = {
  pipeline() {
    const ops = [];
    const p = {
      del(key) { ops.push(() => hashes.delete(key)); return p; },
      hset(key, obj) { ops.push(() => { const h = hashes.get(key) || {}; Object.assign(h, obj); hashes.set(key, h); }); return p; },
      expire() { return p; },
      async exec() { for (const fn of ops) fn(); return []; },
    };
    return p;
  },
  async hgetall(key) { return hashes.get(key) || {}; },
  async pttl() { return -1; },
};

(async () => {
  const a = create({ project: { name: 'test' }, interfaces: [iface], redis: () => redis });
  await a.init();
  let r = await a.exec(iface, 'INSERT INTO `posts` (`title`,`status`) VALUES (?,?)', ['第一篇', 'open']);
  assert.strictEqual(r.insertId, 1);
  await a.exec(iface, 'INSERT INTO `posts` (`title`,`status`) VALUES (?,?)', ['第二篇', 'closed']);
  let rows = await a.query(iface, 'SELECT `id`,`title` FROM `posts` WHERE `status` = ? ORDER BY `id` DESC LIMIT ? OFFSET ?', ['open', 10, 0]);
  assert.deepStrictEqual(rows, [{ id: 1, title: '第一篇' }]);
  let cnt = await a.query(iface, 'SELECT COUNT(*) AS total FROM `posts` WHERE `status` <> ?', ['x']);
  assert.strictEqual(cnt[0].total, 2);
  await a.exec(iface, 'INSERT INTO `comments` (`post_id`,`body`) VALUES (?,?)', [1, '好文']);
  let joined = await a.query(iface, 'SELECT p.`title`, c.`body` FROM `posts` p JOIN `comments` c ON c.`post_id` = p.`id` WHERE p.`id` = ?', [1]);
  assert.deepStrictEqual(joined, [{ title: '第一篇', body: '好文' }]);
  await a.exec(iface, 'UPDATE `posts` SET `status` = ? WHERE `id` = ?', ['archived', 1]);
  await a.exec(iface, 'DELETE FROM `comments` WHERE `post_id` = ?', [1]);
  assert.strictEqual((await a.query(iface, 'SELECT * FROM `comments`', [])).length, 0);

  // 模拟重启：新实例从 Redis 恢复
  const b = create({ project: { name: 'test' }, interfaces: [iface], redis: () => redis });
  await b.init();
  const restored = await b.query(iface, 'SELECT `id`,`title`,`status` FROM `posts` ORDER BY `id`', []);
  assert.deepStrictEqual(restored, [{ id: 1, title: '第一篇', status: 'archived' }, { id: 2, title: '第二篇', status: 'closed' }]);

  // 事务回滚不写 Redis
  b.begin();
  await b.exec(iface, 'INSERT INTO `posts` (`title`,`status`) VALUES (?,?)', ['临时', 'draft']);
  b.rollback();
  assert.strictEqual((await b.query(iface, 'SELECT * FROM `posts`', [])).length, 2);

  // LRU 上限
  const lruIface = { tables: [{ name: 'hot', store: { mode: 'lru', max: 2 }, fields: [
    { name: 'id', type: 'int', pk: true, autoIncrement: true },
    { name: 'v', type: 'varchar' },
  ] }] };
  const l = create({ project: { name: 'lru' }, interfaces: [lruIface], redis: () => null });
  await l.init();
  for (const v of ['a', 'b', 'c']) await l.exec(lruIface, 'INSERT INTO `hot` (`v`) VALUES (?)', [v]);
  assert.deepStrictEqual(await l.query(lruIface, 'SELECT `v` FROM `hot` ORDER BY `id`', []), [{ v: 'b' }, { v: 'c' }]);

  // TTL 到点后内存表清空
  const ttlIface = { tables: [{ name: 'tmp', store: { mode: 'redis', ttl: 1 }, fields: [
    { name: 'id', type: 'int', pk: true, autoIncrement: true },
    { name: 'v', type: 'varchar' },
  ] }] };
  const t = create({ project: { name: 'ttl' }, interfaces: [ttlIface], redis: () => redis });
  await t.init();
  await t.exec(ttlIface, 'INSERT INTO `tmp` (`v`) VALUES (?)', ['x']);
  assert.strictEqual((await t.query(ttlIface, 'SELECT * FROM `tmp`', [])).length, 1);
  await new Promise((r) => setTimeout(r, 1200));
  assert.strictEqual((await t.query(ttlIface, 'SELECT * FROM `tmp`', [])).length, 0);

  console.log('rowstore ok:', JSON.stringify(restored));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
