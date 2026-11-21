// 作者：yxpil
'use strict';

// 真实 Ollama 验收：读取本机模型，携带当前工程追加一个接口，打印可核对的摘要。
// 用法：node tools/test-ai-ollama.js [--model qwen3.8:27b] [--timeout 300000]

const spec = require('../app/iface/spec');
const ai = require('../app/iface/ai');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const model = getArg('model', 'qwen3.8:27b');
const endpoint = getArg('endpoint', 'http://127.0.0.1:11434');
const timeout = Number(getArg('timeout', '300000'));
const prompt = getArg('prompt', '当前工程已有会员接口和会员表。只追加一个优惠券接口（表 biz_coupon，字段 code、amount、status），路由只要列表、创建、更新；不要重复会员接口和已有的表。');

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
    name: 'Ollama 上下文验收',
    description: '验证真实模型是否理解当前工程',
    categories: [{ id: 'biz', name: '业务表格' }],
    interfaces: [member],
    frontend: {
      format: 'yxpp', version: 1, name: '验收前端', framework: 'tailwind',
      project: { elements: [{ id: 'e1', type: 'text' }] },
      html: '<html><body>ollama</body></html>',
    },
    functions: [{ name: 'CUSTOM_FN', params: ['v'], body: 'CONCAT(SUBSTR(v, 0, 3), "****", SUBSTR(v, 7, 4))' }],
  });
}

async function main() {
  const st = await ai.status({ provider: 'ollama', endpoint, timeout: 8000 });
  console.log(`status: ${st.ok ? 'ok' : 'fail'} ${st.message || st.error}`);
  if (!st.ok) {
    console.log(`models: ${(st.models || []).map((m) => m.name).join(', ') || '(none)'}`);
    process.exitCode = 1;
    return;
  }
  const name = (st.models || []).some((m) => m.name === model) ? model : ((st.models || [])[0] || {}).name;
  if (!name) throw new Error('Ollama 没有可用模型');
  if (name !== model) console.log(`requested model ${model} 不存在，改用 ${name}`);
  const project = currentProject();
  const t0 = Date.now();
  const r = await ai.complete({
    prompt,
    project,
    selectedId: project.interfaces[0].id,
    applyMode: 'append',
  }, { provider: 'ollama', endpoint, model: name, timeout, maxTokens: 3200, think: false, temperature: 0.1 });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`model: ${name}  elapsed: ${sec}s`);
  console.log(`project: ${r.project.name}  interfaces: ${r.project.interfaces.length}  contextUsed: ${r.contextUsed}`);
  console.log(`context: ${JSON.stringify(r.context)}`);
  console.log(`names: ${r.project.interfaces.map((it) => it.name).join(' / ')}`);
  console.log(`tables: ${r.project.interfaces.flatMap((it) => it.tables.map((t) => t.name)).join(' / ')}`);
  console.log(`routes: ${r.project.interfaces.flatMap((it) => it.routes.map((x) => x.method + ' ' + x.path)).join(' / ')}`);
  console.log(`frontend: ${r.project.frontend ? r.project.frontend.name : '(none)'}`);
  console.log(`customFn: ${r.project.functions.some((f) => f.name === 'CUSTOM_FN')}`);
  console.log(`skipped: ${r.skipped.join(',') || '(none)'}`);
  console.log(`reply: ${r.reply}`);
  if (r.project.name !== project.name) throw new Error(`工程名被改成 ${r.project.name}`);
  if (!r.project.interfaces.some((it) => it.name === '会员')) throw new Error('追加模式丢了已有会员接口');
  if (!r.project.interfaces.some((it) => /优惠券/.test(it.name))) throw new Error('没有生成优惠券接口');
  const coupon = r.project.interfaces.find((it) => /优惠券/.test(it.name));
  if (coupon.routes.length < 3) throw new Error(`优惠券路由只有 ${coupon.routes.length} 条`);
  if (!r.project.frontend) throw new Error('前端被清空');
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exitCode = 1;
});
