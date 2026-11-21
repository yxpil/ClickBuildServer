// 作者：yxpil
'use strict';

// AI 生成链路的离线可复现测试：
// 1) 模拟 Ollama / OpenAI 兼容服务，不依赖外网；
// 2) 覆盖成功、上下文、追加/替换、坏 JSON、HTTP 401/404/500、超时、空响应；
// 3) 断言失败时不会产出可替换工程的假成功结果。

const http = require('http');
const assert = require('assert');
const spec = require('../app/iface/spec');
const ai = require('../app/iface/ai');

const results = [];
function test(name, fn) {
  results.push({ name, fn });
}

function currentProject() {
  const member = spec.newIface('会员', 'biz', {
    tableName: 'biz_member',
    fields: [
      { name: 'nickname', type: 'varchar', comment: '昵称' },
      { name: 'phone', type: 'varchar', comment: '手机号' },
    ],
  });
  member.comment = '已有会员接口';
  return spec.normalizeProject({
    name: '上下文工程-测试',
    description: '用于验证 AI 是否读取当前工程',
    categories: [{ id: 'biz', name: '业务表格' }, { id: 'sys', name: '平台表格' }],
    interfaces: [member],
    frontend: {
      format: 'yxpp', version: 1, name: '上下文前端', framework: 'tailwind',
      project: { elements: [{ id: 'e1', type: 'text' }, { id: 'e2', type: 'button' }] },
      html: '<html><body>ctx</body></html>',
    },
    connections: {
      mysql: [{ key: 'main', host: '127.0.0.1', port: 13306, user: 'root', password: '', database: 'ctxdb' }],
    },
    theme: { headerTitle: '上下文主题', accent: '#111111' },
    functions: [{ name: 'CUSTOM_FN', params: ['v'], body: 'CONCAT(SUBSTR(v, 0, 3), "****", SUBSTR(v, 7, 4))' }],
  });
}

function generatedProject(name) {
  return {
    name: name || '茶饮会员服务',
    description: '模拟服务返回的工程',
    categories: [{ id: 'biz', name: '业务表格' }],
    interfaces: [{
      name: '优惠券',
      comment: '优惠券发放与核销',
      categoryId: 'biz',
      tables: [{
        key: 'main',
        name: 'biz_coupon',
        comment: '优惠券主表',
        fields: [
          { name: 'id', type: 'bigint', pk: true, autoIncrement: true, comment: '主键' },
          { name: 'code', type: 'varchar', search: true, comment: '券码' },
          { name: 'amount', type: 'decimal', comment: '面额' },
          { name: 'status', type: 'tinyint', comment: '状态' },
        ],
      }],
      routes: [
        { key: 'list', name: '列表', method: 'GET', path: '/coupons' },
        { key: 'create', name: '创建', method: 'POST', path: '/coupons' },
      ],
    }],
    functions: [],
  };
}

function payloadFor(prompt, applyMode, project) {
  return {
    prompt,
    project: project || null,
    selectedId: project ? project.interfaces[0].id : '',
    applyMode: applyMode || 'replace',
  };
}

function startMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* 原样记录 */ }
      requests.push({ method: req.method, url: req.url, body, raw });
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/__requests') return send(200, requests);
      if (req.url === '/api/tags') return send(200, {
        models: [
          { name: 'qwen3.8:27b', size: 17000000000, details: { family: 'qwen3', parameter_size: '27B' }, capabilities: ['completion'] },
          { name: 'phi4:latest', size: 9000000000, details: { family: 'phi4', parameter_size: '14B' }, capabilities: ['completion'] },
        ],
      });
      if (req.url === '/v1/models') return send(200, {
        data: [{ id: 'mock-gpt' }, { id: 'qwen3.8:27b' }],
      });
      const userText = String((body && body.messages && body.messages[1] && body.messages[1].content) || '');
      const isOllama = req.url === '/api/chat';
      const isOpenAi = req.url === '/v1/chat/completions';
      if (!isOllama && !isOpenAi) return send(404, { error: 'not found' });
      const model = String((body && body.model) || '');
      if (model === 'missing:latest' || /MODEL404/.test(userText)) {
        return send(404, { error: isOllama ? `model '${model}' not found` : { message: `model '${model}' not found` } });
      }
      if (/AUTH401/.test(userText)) return send(401, { error: isOllama ? 'unauthorized' : { message: 'unauthorized' } });
      if (/HTTP500/.test(userText)) return send(500, { error: isOllama ? 'mock server exploded' : { message: 'mock server exploded' } });
      if (/TIMEOUT/.test(userText)) {
        setTimeout(() => {
          if (!res.writableEnded) send(200, isOllama
            ? { message: { role: 'assistant', content: JSON.stringify({ project: generatedProject('超时不该成功'), reply: 'late' }) } }
            : { choices: [{ message: { role: 'assistant', content: JSON.stringify({ project: generatedProject('超时不该成功'), reply: 'late' }) } }] });
        }, 4500);
        return;
      }
      let content;
      if (/BAD_JSON/.test(userText)) content = '当然可以，下面是工程：project = {name: 茶饮会员服务';
      else if (/EMPTY_RESPONSE/.test(userText)) content = '';
      else if (/EMPTY_PROJECT/.test(userText)) {
        content = JSON.stringify({ project: { name: '空工程', interfaces: [] }, reply: '空' });
      } else {
        const project = /DUPLICATE/.test(userText)
          ? { ...generatedProject('重复工程'), interfaces: [{ ...generatedProject().interfaces[0], name: '会员', tables: [{ ...generatedProject().interfaces[0].tables[0], name: 'biz_member' }] }] }
          : generatedProject();
        const base = JSON.stringify({ project, reply: '已读取当前工程上下文并生成优惠券接口。' });
        content = /FENCED/.test(userText) ? '```json\n' + base + '\n```\n以上。' : base;
      }
      if (isOllama) {
        return send(200, {
          model, message: { role: 'assistant', content }, done: true,
          prompt_eval_count: 123, eval_count: 45,
        });
      }
      return send(200, {
        model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        base: `http://127.0.0.1:${port}`,
        server,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('Ollama 状态探测返回模型列表', async (mock) => {
  const st = await ai.status({ provider: 'ollama', endpoint: mock.base, timeout: 5000 });
  assert.strictEqual(st.ok, true, st.error);
  assert.strictEqual(st.provider, 'ollama');
  assert.deepStrictEqual(st.models.map((m) => m.name), ['qwen3.8:27b', 'phi4:latest']);
  assert.match(st.message, /2 个模型/);
});

test('Ollama 正常生成且请求携带当前工程上下文', async (mock) => {
  const project = currentProject();
  const r = await ai.complete(payloadFor('只追加优惠券接口', 'append', project), {
    provider: 'ollama', endpoint: mock.base, model: 'qwen3.8:27b', timeout: 20000, maxTokens: 600,
  });
  assert.strictEqual(r.mode, 'api');
  assert.strictEqual(r.provider, 'ollama');
  assert.strictEqual(r.contextUsed, true);
  assert.strictEqual(r.context.projectName, '上下文工程-测试');
  assert.strictEqual(r.project.name, '上下文工程-测试');
  assert.strictEqual(r.project.interfaces.length, 2);
  assert.deepStrictEqual(r.project.interfaces.map((it) => it.name).sort(), ['会员', '优惠券'].sort());
  assert.strictEqual(r.project.frontend.name, '上下文前端');
  assert.strictEqual(r.project.connections.mysql[0].database, 'ctxdb');
  assert.strictEqual(r.project.theme.headerTitle, '上下文主题');
  const req = mock.requests.find((q) => q.url === '/api/chat' && q.body);
  assert(req, '没有收到 Ollama 请求');
  assert.strictEqual(req.body.format, 'json');
  assert.strictEqual(req.body.stream, false);
  const sent = req.body.messages[1].content;
  assert.match(sent, /上下文工程-测试/);
  assert.match(sent, /会员/);
  assert.match(sent, /biz_member/);
  assert.match(sent, /当前选中接口：会员/);
  assert.match(sent, /append/);
});

test('OpenAI 兼容正常生成、替换保留工程名/前端/连接', async (mock) => {
  const project = currentProject();
  const r = await ai.complete(payloadFor('生成茶饮会员服务', 'replace', project), {
    provider: 'openai', endpoint: `${mock.base}/v1`, model: 'mock-gpt', timeout: 20000,
  });
  assert.strictEqual(r.provider, 'openai');
  assert.strictEqual(r.project.name, '上下文工程-测试');
  assert.strictEqual(r.project.interfaces.length, 1);
  assert.strictEqual(r.project.interfaces[0].name, '优惠券');
  assert.strictEqual(r.project.frontend.name, '上下文前端');
  assert.strictEqual(r.project.connections.mysql[0].database, 'ctxdb');
  assert.strictEqual(r.project.theme.headerTitle, '上下文主题');
  assert(r.project.functions.some((f) => f.name === 'CUSTOM_FN'), '替换模式丢失了自定义函数');
});

test('追加模式跳过同名接口而不是静默覆盖', async (mock) => {
  const project = currentProject();
  await assert.rejects(
    ai.complete(payloadFor('DUPLICATE 再生成会员', 'append', project), {
      provider: 'ollama', endpoint: mock.base, model: 'qwen3.8:27b', timeout: 20000,
    }),
    /没有可追加的新接口/,
  );
});

test('坏 JSON 明确失败，不返回假工程', async (mock) => {
  const project = currentProject();
  await assert.rejects(
    ai.complete(payloadFor('BAD_JSON 生成', 'replace', project), {
      provider: 'ollama', endpoint: mock.base, model: 'qwen3.8:27b', timeout: 20000,
    }),
    /不是有效 JSON/,
  );
});

test('Markdown 围栏和尾随说明可解析', async (mock) => {
  const project = currentProject();
  const r = await ai.complete(payloadFor('FENCED 生成优惠券', 'replace', project), {
    provider: 'openai', endpoint: `${mock.base}/v1`, model: 'mock-gpt', timeout: 20000,
  });
  assert.strictEqual(r.project.interfaces[0].name, '优惠券');
});

test('HTTP 401 / 404 / 500 都明确报错', async (mock) => {
  for (const [tag, re] of [
    ['AUTH401 生成', /HTTP 401/],
    ['MODEL404 生成', /HTTP 404/],
    ['HTTP500 生成', /HTTP 500/],
  ]) {
    await assert.rejects(
      ai.complete({ prompt: tag }, { provider: 'ollama', endpoint: mock.base, model: 'qwen3.8:27b', timeout: 20000 }),
      re,
    );
  }
});

test('模型不存在时（404 error body）能显示模型名', async (mock) => {
  await assert.rejects(
    ai.complete({ prompt: '生成' }, { provider: 'ollama', endpoint: mock.base, model: 'missing:latest', timeout: 20000 }),
    /model 'missing:latest' not found/,
  );
});

test('超时明确失败', async (mock) => {
  const t0 = Date.now();
  await assert.rejects(
    ai.complete({ prompt: 'TIMEOUT 生成' }, { provider: 'ollama', endpoint: mock.base, model: 'qwen3.8:27b', timeout: 3000 }),
    /超时/,
  );
  assert(Date.now() - t0 < 6000, '超时没有按配置生效');
});

test('空响应明确失败', async (mock) => {
  await assert.rejects(
    ai.complete({ prompt: 'EMPTY_RESPONSE 生成' }, { provider: 'openai', endpoint: `${mock.base}/v1`, model: 'mock-gpt', timeout: 20000 }),
    /没有返回内容/,
  );
});

test('空需求、空接口集合被拒绝', async (mock) => {
  await assert.rejects(ai.complete({ prompt: '   ' }, { provider: 'mock' }), /请输入生成需求/);
  await assert.rejects(
    ai.complete({ prompt: 'EMPTY_PROJECT 生成' }, { provider: 'ollama', endpoint: mock.base, model: 'qwen3.8:27b', timeout: 20000 }),
    /interfaces 为空/,
  );
});

test('无配置默认本地模拟，但不会伪装成真实模型', async () => {
  const r = await ai.complete({ prompt: '做一个订单服务，再加用户注册' });
  assert.strictEqual(r.provider, 'mock');
  assert.strictEqual(r.mode, 'mock');
  assert.match(r.reply, /本地模拟/);
});

test('显式 fallbackMock 才回退，并保留错误原因', async (mock) => {
  const r = await ai.complete({ prompt: 'HTTP500 生成' }, {
    provider: 'ollama', endpoint: mock.base, model: 'qwen3.8:27b', timeout: 20000, fallbackMock: true,
  });
  assert.strictEqual(r.fallback, true);
  assert.match(r.error, /HTTP 500/);
  assert.match(r.reply, /回退到本地模拟/);
  assert.strictEqual(r.project.name, '接口工程');
});

test('无上下文时如实标记未读取上下文', async (mock) => {
  const r = await ai.complete({ prompt: '生成一个独立茶饮工程' }, {
    provider: 'ollama', endpoint: mock.base, model: 'qwen3.8:27b', timeout: 20000,
  });
  assert.strictEqual(r.contextUsed, false);
  assert.strictEqual(r.context, null);
  assert.strictEqual(r.project.name, '茶饮会员服务');
});

test('无上下文时追加模式被拒绝', async () => {
  await assert.rejects(
    ai.complete({ prompt: '追加优惠券', applyMode: 'append' }, { provider: 'mock' }),
    /追加模式需要当前工程上下文/,
  );
});

test('替换模式采用模型返回的前端工程', async () => {
  const base = currentProject();
  const gen = generatedProject();
  gen.frontend = {
    name: '会员管理前端', framework: 'tailwind',
    project: {
      page: { w: 1200, h: 900, bg: '#F5F5F2' },
      elements: [{ id: 'e1', type: 'heading', x: 40, y: 40, w: 600, h: 48, props: { text: '会员管理', size: 28 } }],
    },
  };
  const r = ai.parseResult(JSON.stringify({ project: gen, reply: '已生成前端。' }), payloadFor('生成会员前端', 'replace', base), ai.contextOf(base, base.interfaces[0].id));
  assert.strictEqual(r.frontendUpdated, true);
  assert.strictEqual(r.project.frontend.name, '会员管理前端');
  assert.strictEqual(r.project.frontend.project.elements.length, 1);
  assert.match(r.project.frontend.html, /会员管理/);
  assert.match(r.project.name, /上下文工程-测试/);
});

test('模型只返回前端时保留当前接口', async () => {
  const base = currentProject();
  const r = ai.parseResult(JSON.stringify({
    project: {
      name: '只生成前端', interfaces: [],
      frontend: { html: '<!doctype html><html><body><h1>会员台</h1></body></html>' },
    },
    reply: '只更新前端。',
  }), payloadFor('只改前端', 'replace', base), ai.contextOf(base, base.interfaces[0].id));
  assert.strictEqual(r.frontendUpdated, true);
  assert.strictEqual(r.project.frontend.name, '只生成前端');
  assert.ok(r.project.frontend.project.elements.length >= 1);
  assert.ok(r.project.interfaces.some((it) => it.name === '会员'));
});

test('OpenAI 兼容状态探测', async (mock) => {
  const st = await ai.status({ provider: 'openai', endpoint: `${mock.base}/v1`, timeout: 5000 });
  assert.strictEqual(st.ok, true, st.error);
  assert.deepStrictEqual(st.models.map((m) => m.name).sort(), ['mock-gpt', 'qwen3.8:27b'].sort());
});

async function main() {
  const mock = await startMock();
  let failed = 0;
  for (const t of results) {
    try {
      await t.fn(mock);
      console.log(`ok   ${t.name}`);
    } catch (e) {
      failed += 1;
      console.error(`FAIL ${t.name}\n     ${e.message}`);
    }
  }
  await mock.close();
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
