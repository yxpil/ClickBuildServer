// 作者：yxpil
'use strict';

// AI 生成接口工程：支持本机 Ollama、OpenAI 兼容接口与本地模拟。
// 关键约束：真实模型失败必须作为错误返回，绝不静默用本地模拟替换当前工程。

const spec = require('./spec');
const script = require('./script');
const frontend = require('./frontend');

const DEFAULT_AI = {
  provider: 'ollama', // ollama | openai | mock
  endpoint: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
  timeout: 180000,
  temperature: 0.2,
  maxTokens: 4096,
  think: false,
  fallbackMock: false,
};

const trimBase = (s) => String(s || '').trim().replace(/\/+$/, '');
const providerOf = (cfg) => {
  const p = String((cfg && cfg.provider) || '').toLowerCase();
  if (['ollama', 'openai', 'mock'].includes(p)) return p;
  return /11434|ollama/i.test(String((cfg && cfg.endpoint) || '')) ? 'ollama' : 'openai';
};

function ollamaRoot(endpoint) {
  return trimBase(endpoint)
    .replace(/\/api\/chat$/i, '')
    .replace(/\/api\/tags$/i, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1$/i, '')
    .replace(/\/api$/i, '');
}

function openAiUrl(endpoint) {
  const base = trimBase(endpoint);
  if (!base) throw new Error('没有配置 AI 接口地址');
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function errorText(e) {
  if (!e) return '未知错误';
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return '请求超时';
  if (e.cause && e.cause.code === 'ECONNREFUSED') return '连接被拒绝（服务没有启动？）';
  return e.message || String(e);
}

function jsonObject(text) {
  let s = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
  if (!s) throw new Error('模型没有返回内容');
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(s);
  if (fence) s = fence[1].trim();
  try {
    const v = JSON.parse(s);
    if (v && typeof v === 'object') return v;
  } catch { /* 继续按括号扫描 */ }

  // 只截取平衡的顶层对象，避免贪婪正则把解释文字或第二个 JSON 一起吞掉。
  const candidates = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '{') continue;
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let j = i; j < s.length; j += 1) {
      const ch = s[j];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"') { quote = ch; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(s.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object' && (v.project || v.interfaces)) return v;
    } catch { /* 试下一个 */ }
  }
  throw new Error('模型返回不是有效 JSON（可能被截断或夹带说明文字）');
}

function contextOf(project, selectedId) {
  if (!project || typeof project !== 'object' || !Array.isArray(project.interfaces)) return null;
  const p = spec.normalizeProject(project);
  const selected = p.interfaces.find((it) => it.id === selectedId) || null;
  const interfaces = p.interfaces.map((it) => ({
    id: it.id,
    name: it.name,
    comment: it.comment,
    category: (p.categories.find((c) => c.id === it.categoryId) || {}).name || it.categoryId,
    basePath: it.basePath || '',
    tables: it.tables.map((t) => ({
      key: t.key,
      name: t.name,
      comment: t.comment,
      fields: t.fields.map((f) => ({ name: f.name, type: f.type, pk: !!f.pk, comment: f.comment })),
    })),
    routes: it.routes.map((r) => ({ key: r.key, name: r.name, method: r.method, path: r.path, auth: !!r.auth })),
  }));
  const front = p.frontend;
  return {
    name: p.name,
    description: p.description,
    categories: p.categories.map((c) => ({ id: c.id, name: c.name })),
    functions: p.functions.map((f) => f.name),
    interfaces,
    frontend: front ? {
      name: front.name,
      framework: front.framework,
      elements: Array.isArray(front.project && front.project.elements) ? front.project.elements.length : 0,
      elementSample: Array.isArray(front.project && front.project.elements)
        ? front.project.elements.slice(0, 12).map((e) => ({
          type: e.type,
          text: String((e.props && e.props.text) || '').slice(0, 40),
        }))
        : [],
      htmlLength: String(front.html || '').length,
    } : null,
    selected: selected ? { id: selected.id, name: selected.name } : null,
    stats: {
      interfaces: p.interfaces.length,
      tables: p.interfaces.reduce((n, it) => n + it.tables.length, 0),
      routes: p.interfaces.reduce((n, it) => n + it.routes.length, 0),
    },
  };
}

function systemPrompt() {
  return [
    '你是 ClickBuildServer 的接口工程生成器。只输出一个 JSON 对象，不要输出解释、Markdown 围栏或多个 JSON。',
    '顶层结构：{"project":{"name":"工程名","description":"说明","categories":[{"id":"biz","name":"业务表格"}],"interfaces":[...],"functions":[{"name":"FUNC","params":["v"],"body":"..."}]},"reply":"给用户看的简短中文说明"}',
    '每个 interface：{"name":"接口名","comment":"说明","categoryId":"biz","tables":[{"key":"main","name":"biz_order","comment":"主表","fields":[{"name":"id","type":"bigint","pk":true,"autoIncrement":true,"comment":"主键"}]}],"routes":[{"key":"list","name":"列表","method":"GET","path":"/orders","summary":"分页列表"}]}。',
    `字段 type 只能是：${spec.TYPE_KEYS.join(', ')}。表名、字段名只用小写字母、数字、下划线，且以字母或下划线开头。`,
    '路由优先使用内置 key：list、detail、create、update、delete；省略 script 时平台会自动套用对应模板。自定义路由（注册、登录、统计等）必须给出 script，脚本使用 LET、QUERY、EXEC、RETURN 语法，表占位符用 {{t:表key}}，请求体用 {{body.字段}}，查询参数用 {{query.字段}}。',
    '当前工程上下文只用于理解已有命名、分类、表结构和选中项。replace 模式生成完整的新接口集合；append 模式只生成需要新增的接口，不得重复已有接口名或表名。',
    '只有用户明确要求生成或修改前端页面时，才在 project 内增加 frontend；否则不要输出 frontend，平台会保留原前端。',
    'frontend 格式：{"name":"前端工程名","framework":"tailwind","project":{"page":{"w":1200,"h":900,"bg":"#FFFFFF"},"elements":[{"id":"e1","type":"heading","x":40,"y":40,"w":600,"h":48,"props":{"text":"页面标题","size":28,"weight":700}}]}}。',
    'element 坐标以 1200×900 画布为准，type 可用 container、heading、text、button、input、list、divider、image、icon；文本放 props.text，按钮放 props.text，输入框放 props.placeholder，容器把子元素放 children。页面要像可直接使用的业务界面，不要只放一句占位文字；不要写外部 CDN、远程图片或外链脚本。',
    '如果用户只要前端，interfaces 可以保持当前工程不变；如果同时要接口和前端，就一并输出。',
  ].join('\n');
}

function userPrompt(payload, ctx) {
  const mode = payload.applyMode === 'append' ? 'append' : 'replace';
  return [
    `生成模式：${mode}（${mode === 'append' ? '保留当前接口，只追加新接口' : '替换接口集合，但工程名、前端、连接、主题由系统保留'}）`,
    ctx ? `当前工程上下文：\n${JSON.stringify(ctx)}` : '当前没有可用的工程上下文，请仅按需求生成。',
    payload.selectedId && ctx && ctx.selected ? `当前选中接口：${ctx.selected.name}` : '',
    `用户需求：\n${String(payload.prompt || '').trim()}`,
  ].filter(Boolean).join('\n\n');
}

async function chatOllama(payload, conf, ctx) {
  const root = ollamaRoot(conf.endpoint);
  if (!root) throw new Error('没有配置 Ollama 地址');
  if (!conf.model) throw new Error('没有选择 Ollama 模型');
  const timeout = Math.max(3000, Number(conf.timeout || DEFAULT_AI.timeout));
  const url = `${root}/api/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(conf.apiKey ? { authorization: `Bearer ${conf.apiKey}` } : {}) },
    body: JSON.stringify({
      model: conf.model,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: userPrompt(payload, ctx) },
      ],
      stream: false,
      format: 'json',
      think: conf.think === true,
      options: {
        temperature: Number(conf.temperature == null ? DEFAULT_AI.temperature : conf.temperature),
        num_predict: Math.max(256, Number(conf.maxTokens || DEFAULT_AI.maxTokens)),
        num_ctx: Math.max(4096, Number(conf.numCtx || 8192)),
      },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 下面统一报错 */ }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text.slice(0, 240) || res.statusText;
    throw new Error(`Ollama HTTP ${res.status}：${msg}`);
  }
  if (!data) throw new Error('Ollama 返回的不是 JSON');
  if (data.error) throw new Error(`Ollama：${data.error}`);
  const content = data.message && data.message.content;
  if (!content) throw new Error('Ollama 模型没有返回内容（可能被截断或只返回了思考内容）');
  return {
    text: content,
    usage: data.prompt_eval_count || data.eval_count ? {
      prompt: data.prompt_eval_count || 0,
      completion: data.eval_count || 0,
    } : null,
  };
}

async function chatOpenAi(payload, conf, ctx) {
  if (!conf.model) throw new Error('没有填写模型名称');
  const url = openAiUrl(conf.endpoint);
  const timeout = Math.max(3000, Number(conf.timeout || DEFAULT_AI.timeout));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(conf.apiKey ? { authorization: `Bearer ${conf.apiKey}` } : {}) },
    body: JSON.stringify({
      model: conf.model,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: userPrompt(payload, ctx) },
      ],
      temperature: Number(conf.temperature == null ? DEFAULT_AI.temperature : conf.temperature),
      max_tokens: Math.max(256, Number(conf.maxTokens || DEFAULT_AI.maxTokens)),
    }),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 下面统一报错 */ }
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error)) || text.slice(0, 240) || res.statusText;
    throw new Error(`AI 接口 HTTP ${res.status}：${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  if (!data) throw new Error('AI 接口返回的不是 JSON');
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  const content = msg && (msg.content || (Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : ''));
  if (!content) throw new Error('AI 接口没有返回内容（choices[0].message.content 为空）');
  return { text: content, usage: data.usage || null };
}

function colorLum(c) {
  const s = String(c || '').trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function fixElementContrast(node, parentBg) {
  if (!node || typeof node !== 'object') return node;
  const type = String(node.type || '');
  const p = node.props && typeof node.props === 'object' ? node.props : (node.props = {});
  const ownBg = node.style && node.style.background ? node.style.background : '';
  const darkBg = (colorLum(ownBg) != null && colorLum(ownBg) < 0.45) || (colorLum(parentBg) != null && colorLum(parentBg) < 0.45);
  if ((type === 'heading' || type === 'text' || type === 'badge' || type === 'link') && colorLum(p.color) != null && colorLum(p.color) > 0.9 && !darkBg) {
    p.color = '#0B0B0B';
  }
  if (type === 'button') {
    const bg = ownBg || '#0B0B0B';
    if (colorLum(bg) != null && colorLum(bg) < 0.45 && (colorLum(p.color) == null || colorLum(p.color) < 0.7)) p.color = '#FFFFFF';
    if (!String(p.text || '').trim()) p.text = '操作';
  }
  if (Array.isArray(node.children)) {
    const bg = ownBg || parentBg;
    node.children = node.children.map((child) => fixElementContrast(child, bg));
  }
  return node;
}

function normalizeAiFrontend(raw, fallbackName) {
  if (!raw) return null;
  let obj = typeof raw === 'string' ? { html: raw } : raw;
  if (!obj || typeof obj !== 'object') throw new Error('AI 返回的 frontend 不是对象');
  if (obj.yxpp && typeof obj.yxpp === 'object') obj = { ...obj.yxpp, ...obj };
  const name = String(obj.name || fallbackName || 'AI 前端工程').trim();
  const html = String(obj.html || obj.code || '').trim();
  if (html.length > 200000) throw new Error('AI 生成的前端 HTML 超过 200000 字符');
  let project = obj.project;
  if (!project || !project.page || !Array.isArray(project.elements)) {
    if (!html) throw new Error('AI 返回的 frontend 缺少 project.elements 或 html');
    const body = (() => {
      const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
      if (m) return m[1];
      return html
        .replace(/<!doctype[\s\S]*?<html[^>]*>/i, '')
        .replace(/<\/html>[\s\S]*$/i, '');
    })();
    project = {
      page: { w: 1200, h: 900, bg: '#FFFFFF' },
      elements: [{
        id: 'ai-page',
        type: 'html',
        x: 0, y: 0, w: 1200, h: 900,
        props: { code: body.slice(0, 120000) },
      }],
    };
  }
  if (!project.elements.length && !html) throw new Error('AI 返回的前端工程没有任何元素');
  project.elements = project.elements.map((e) => fixElementContrast(e, ''));
  try {
    return frontend.parseYxpp({
      format: 'yxpp', version: 1, name,
      framework: String(obj.framework || 'tailwind'),
      project, html,
    }, name);
  } catch (e) {
    throw new Error(`AI 返回的前端工程无效：${e.message || e}`);
  }
}

function normalizeAiProject(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('AI 返回缺少 project');
  if (!Array.isArray(raw.interfaces) || !raw.interfaces.length) throw new Error('AI 返回的 project.interfaces 为空');
  for (const [i, it] of raw.interfaces.entries()) {
    if (!it || typeof it !== 'object') throw new Error(`第 ${i + 1} 个接口不是对象`);
    if (!it.name) throw new Error(`第 ${i + 1} 个接口没有名称`);
    if (!Array.isArray(it.tables) || !it.tables.length) throw new Error(`接口「${it.name}」没有表`);
    for (const t of it.tables) {
      if (!t || !t.name) throw new Error(`接口「${it.name}」有表缺少表名`);
      if (!Array.isArray(t.fields) || !t.fields.length) throw new Error(`表「${t.name}」没有字段`);
    }
  }
  // 模型可能把上下文里的函数名抄回来却给出坏表达式；函数是可选增强，坏的就丢弃。
  const functions = (Array.isArray(raw.functions) ? raw.functions : []).filter((f) => {
    if (!f || !f.name || !f.body) return false;
    try { script.parseExpr(String(f.body)); return true; } catch { return false; }
  });
  const generatedFrontend = normalizeAiFrontend(raw.frontend, raw.name);
  const p = spec.normalizeProject({ ...raw, frontend: generatedFrontend, functions });
  const v = spec.validateProject(p);
  if (v.errors.length) throw new Error(`AI 生成的工程未通过校验：${v.errors.slice(0, 5).join('；')}`);
  return p;
}

function uniqueId(used, base) {
  let id = base;
  let n = 2;
  while (used.has(id)) { id = `${base}${n}`; n += 1; }
  used.add(id);
  return id;
}

function mergeAiProject(current, generated, applyMode) {
  if (!current) {
    return { project: generated, skipped: [], note: '', frontendUpdated: !!generated.frontend };
  }
  const base = spec.normalizeProject(current);
  const mode = applyMode === 'append' ? 'append' : 'replace';
  if (mode === 'append') {
    const skipped = [];
    const names = new Set(base.interfaces.map((it) => it.name));
    const tableNames = new Set(base.interfaces.flatMap((it) => it.tables.map((t) => t.name)));
    const catIds = new Set(base.categories.map((c) => c.id));
    const catNames = new Set(base.categories.map((c) => c.name));
    const newCats = [];
    for (const c of generated.categories) {
      if (!catIds.has(c.id) && !catNames.has(c.name)) {
        newCats.push(c); catIds.add(c.id); catNames.add(c.name);
      }
    }
    const newIfaces = [];
    for (const it of generated.interfaces) {
      const dupName = names.has(it.name);
      const dupTable = it.tables.some((t) => tableNames.has(t.name));
      if (dupName || dupTable) {
        skipped.push(it.name);
        continue;
      }
      let cat = it.categoryId;
      if (!catIds.has(cat)) {
        const c = { id: cat || `ai${newCats.length + 1}`, name: cat || 'AI 新增' };
        newCats.push(c); catIds.add(c.id); catNames.add(c.name);
        cat = c.id;
      }
      it.categoryId = cat;
      it.id = uniqueId(new Set([...base.interfaces.map((x) => x.id), ...newIfaces.map((x) => x.id)]), it.id);
      newIfaces.push(it);
      names.add(it.name);
      it.tables.forEach((t) => tableNames.add(t.name));
    }
    if (!newIfaces.length) throw new Error(`AI 生成的接口与当前工程重复：${skipped.join('、')}；没有可追加的新接口`);
    const functions = [...base.functions];
    for (const f of generated.functions) {
      if (!functions.some((x) => x.name === f.name)) functions.push(f);
    }
    const merged = spec.normalizeProject({
      ...base,
      categories: [...base.categories, ...newCats],
      interfaces: [...base.interfaces, ...newIfaces],
      functions,
      frontend: generated.frontend || base.frontend,
      updatedAt: new Date().toISOString(),
    });
    const v = spec.validateProject(merged);
    if (v.errors.length) throw new Error(`追加后工程未通过校验：${v.errors.slice(0, 5).join('；')}`);
    return {
      project: merged,
      skipped,
      note: skipped.length ? `（已跳过同名/同表接口：${skipped.join('、')}）` : '',
      frontendUpdated: !!generated.frontend,
    };
  }

  const functions = [...base.functions];
  for (const f of generated.functions) {
    if (!functions.some((x) => x.name === f.name)) functions.push(f);
  }
  const merged = spec.normalizeProject({
    ...generated,
    name: base.name,
    description: base.description || generated.description,
    functions,
    connections: base.connections,
    log: base.log,
    token: base.token,
    docs: base.docs,
    errors: base.errors,
    services: base.services,
    theme: base.theme,
    isolation: base.isolation,
    frontend: generated.frontend || base.frontend,
    updatedAt: new Date().toISOString(),
  });
  const v = spec.validateProject(merged);
  if (v.errors.length) throw new Error(`生成工程未通过校验：${v.errors.slice(0, 5).join('；')}`);
  return { project: merged, skipped: [], note: '', frontendUpdated: !!generated.frontend };
}

function parseResult(text, payload, context) {
  const parsed = jsonObject(text);
  let raw = parsed.project || parsed.Project;
  if (!raw) throw new Error('AI 返回缺少 project 字段');
  if (!raw.frontend && parsed.frontend) raw = { ...raw, frontend: parsed.frontend };
  if ((!Array.isArray(raw.interfaces) || !raw.interfaces.length) && raw.frontend && payload.project) {
    const base = spec.normalizeProject(payload.project);
    raw = { ...raw, categories: raw.categories || base.categories, interfaces: base.interfaces };
  }
  const generated = normalizeAiProject(raw);
  const mode = payload.applyMode === 'append' ? 'append' : 'replace';
  const merge = mergeAiProject(payload.project, generated, mode);
  const reply = String(parsed.reply == null ? '' : parsed.reply).trim() || `已生成 ${generated.interfaces.length} 个接口。`;
  return {
    project: merge.project,
    reply: `${reply}${merge.note}`,
    applyMode: mode,
    contextUsed: !!context,
    context: context ? {
      projectName: context.name,
      interfaces: context.stats.interfaces,
      tables: context.stats.tables,
      selected: context.selected,
    } : null,
    skipped: merge.skipped,
    frontendUpdated: !!merge.frontendUpdated,
    frontendName: merge.project.frontend ? merge.project.frontend.name : '',
  };
}

async function complete(input, cfg) {
  const conf = { ...DEFAULT_AI, ...(cfg || {}) };
  const explicitCfg = !!cfg && typeof cfg === 'object' && Object.keys(cfg).length > 0;
  const payload = typeof input === 'string' ? { prompt: input } : (input && typeof input === 'object' ? input : {});
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) throw new Error('请输入生成需求');
  const provider = providerOf(conf);
  const context = payload.project ? contextOf(payload.project, payload.selectedId) : null;
  const started = Date.now();

  if (!payload.project && payload.applyMode === 'append') {
    throw new Error('追加模式需要当前工程上下文');
  }
  if (provider === 'mock' || !explicitCfg || (!trimBase(conf.endpoint) && !conf.model)) {
    const mock = mockReply(prompt);
    const merged = payload.project && payload.project.interfaces ? mergeAiProject(payload.project, mock.project, payload.applyMode) : { project: mock.project, skipped: [], note: '' };
    return {
      ...mock,
      project: merged.project,
      reply: `${mock.reply}${merged.note}\n（当前为本地模拟，没有调用真实模型。）`,
      provider: 'mock',
      model: '',
      elapsedMs: Date.now() - started,
      contextUsed: !!context,
      context: context ? { projectName: context.name, interfaces: context.stats.interfaces, tables: context.stats.tables, selected: context.selected } : null,
      skipped: merged.skipped,
    };
  }

  try {
    const out = provider === 'ollama' ? await chatOllama(payload, conf, context) : await chatOpenAi(payload, conf, context);
    const parsed = parseResult(out.text, payload, context);
    return {
      ...parsed,
      mode: 'api',
      provider,
      model: conf.model,
      elapsedMs: Date.now() - started,
      usage: out.usage,
    };
  } catch (e) {
    const msg = errorText(e);
    if (conf.fallbackMock) {
      const mock = mockReply(prompt);
      const merged = payload.project && payload.project.interfaces ? mergeAiProject(payload.project, mock.project, payload.applyMode) : { project: mock.project, skipped: [], note: '' };
      return {
        ...mock,
        project: merged.project,
        reply: `${mock.reply}${merged.note}\n（真实 AI 调用失败：${msg}；已按设置回退到本地模拟。）`,
        provider: 'mock',
        mode: 'mock',
        model: conf.model || '',
        elapsedMs: Date.now() - started,
        fallback: true,
        error: msg,
        contextUsed: !!context,
        skipped: merged.skipped,
      };
    }
    throw new Error(`AI 调用失败：${msg}`);
  }
}

async function status(cfg) {
  const conf = { ...DEFAULT_AI, ...(cfg || {}) };
  const provider = providerOf(conf);
  if (provider === 'mock') return { ok: true, provider: 'mock', models: [], message: '本地模拟，不需要连接' };
  const base = trimBase(conf.endpoint);
  if (!base) return { ok: false, provider, error: '没有配置接口地址' };
  const timeout = Math.min(10000, Math.max(2000, Number(conf.timeout || 10000)));
  try {
    if (provider === 'ollama') {
      const root = ollamaRoot(base);
      const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* 下面报错 */ }
      if (!res.ok) throw new Error(`HTTP ${res.status}${data && data.error ? `：${data.error}` : ''}`);
      const models = (data && data.models ? data.models : []).map((m) => ({
        name: m.name,
        size: m.size,
        family: (m.details && m.details.family) || '',
        parameter: (m.details && m.details.parameter_size) || '',
        capabilities: m.capabilities || [],
      }));
      return { ok: true, provider, endpoint: root, models, message: `Ollama 已连接，找到 ${models.length} 个模型` };
    }
    const url = `${trimBase(openAiUrl(base).replace(/\/chat\/completions$/i, ''))}/models`;
    const res = await fetch(url, {
      headers: conf.apiKey ? { authorization: `Bearer ${conf.apiKey}` } : {},
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 下面报错 */ }
    if (!res.ok) throw new Error(`HTTP ${res.status}${data && data.error ? `：${JSON.stringify(data.error)}` : ''}`);
    const models = (data && data.data ? data.data : []).map((m) => ({ name: m.id }));
    return { ok: true, provider, endpoint: base, models, message: `OpenAI 兼容接口已连接，找到 ${models.length} 个模型` };
  } catch (e) {
    return { ok: false, provider, endpoint: base, models: [], error: errorText(e) };
  }
}

function mockReply(prompt) {
  const p = String(prompt || '');
  const wantsUser = /用户|注册|登录|账号|会员/.test(p);
  const wantsOrder = /订单|商品|库存|销售|商城/.test(p);
  const wantsFile = /附件|文件|图片|上传/.test(p);

  const categories = [
    { id: 'biz', name: '业务表格' },
    { id: 'sys', name: '平台表格' },
  ];
  const interfaces = [];

  if (wantsOrder || !wantsUser) {
    const order = spec.newIface('订单', 'biz');
    order.comment = '订单主表 + 明细表（本地模拟）';
    const fields = [
      { ...spec.newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false, comment: '主键' },
      { ...spec.newField('order_no', 'varchar'), search: true, comment: '订单号' },
      { ...spec.newField('customer', 'varchar'), search: true, comment: '客户' },
      { ...spec.newField('amount', 'decimal'), comment: '金额' },
      { ...spec.newField('status', 'tinyint'), comment: '0 待付 1 已付 2 完成' },
      ...(wantsFile ? [{ ...spec.newField('file_key', 'varchar'), hidden: true, comment: '附件对象键' }] : []),
      { ...spec.newField('created_at', 'datetime'), writable: false, default: 'CURRENT_TIMESTAMP' },
    ];
    order.tables = [
      { key: 'main', name: 'biz_order', schema: '', comment: '订单主表', fields },
      {
        key: 'item', name: 'biz_order_item', schema: '', comment: '订单明细',
        fields: [
          { ...spec.newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false },
          { ...spec.newField('order_id', 'bigint'), comment: '订单主键' },
          { ...spec.newField('sku', 'varchar'), search: true, comment: '商品编码' },
          { ...spec.newField('qty', 'int'), comment: '数量' },
          { ...spec.newField('price', 'decimal'), comment: '单价' },
        ],
      },
    ];
    order.routes = ['list', 'detail', 'create', 'update', 'delete'].map((k) => spec.newRoute(k, order));
    order.routes.push({
      ...spec.newRoute('custom', order, 0),
      name: '订单+明细',
      method: 'GET',
      path: '/orders/with-items',
      summary: '主表 LEFT JOIN 明细',
      script: [
        'LET $rows = QUERY SELECT o.id, o.order_no, o.customer, o.amount, o.status, i.sku, i.qty, i.price FROM {{t:main}} o LEFT JOIN {{t:item}} i ON i.order_id = o.id WHERE {{where:main}} ORDER BY o.id DESC LIMIT {{limit}} OFFSET {{offset}};',
        'RETURN 200 { "rows": $rows.rows };',
      ].join('\n'),
      cache: { enabled: false, key: '', ttl: 60 },
    });
    interfaces.push(order);
  }

  if (wantsUser) {
    const user = spec.newIface('用户注册', 'sys');
    user.comment = '注册 / 登录 / 当前用户（本地模拟）';
    user.tables = [{
      key: 'main', name: 'sys_user', schema: '', comment: '用户表',
      fields: [
        { ...spec.newField('id', 'bigint'), pk: true, autoIncrement: true, nullable: false, query: false, writable: false },
        { ...spec.newField('only_id', 'char'), hidden: true, comment: '唯一ID' },
        { ...spec.newField('username', 'varchar'), search: true, comment: '用户名' },
        { ...spec.newField('password_hash', 'varchar'), hidden: true, comment: 'SM4 加密密码' },
        { ...spec.newField('nickname', 'varchar'), search: true, comment: '昵称' },
        { ...spec.newField('created_at', 'datetime'), writable: false, default: 'CURRENT_TIMESTAMP' },
      ],
    }];
    user.routes = [
      {
        ...spec.newRoute('custom', user, 0), name: '注册', method: 'POST', path: '/register',
        summary: '查重 → 插入 → 发 token',
        script: [
          'LET $exists = QUERY SELECT id FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
          'IF LEN($exists.rows) > 0',
          '  RETURN 409 { "ok": false, "error": "USER_EXISTS" };',
          'END',
          'EXEC INSERT INTO {{t:main}} (only_id, username, password_hash, nickname) VALUES ({{onlyId}}, {{body.username}}, SM4_ENC({{body.password}}, \'clickbuild-key\'), {{body.nickname}});',
          'LET $t = TOKEN NEW { "onlyId": {{onlyId}}, "username": {{body.username}} };',
          'RETURN 201 { "ok": true, "onlyId": {{onlyId}}, "token": $t.token };',
        ].join('\n'),
        cache: { enabled: false, key: '', ttl: 60 },
      },
      {
        ...spec.newRoute('custom', user, 1), name: '登录', method: 'POST', path: '/login',
        script: [
          'LET $u = QUERY SELECT only_id, password_hash FROM {{t:main}} WHERE username = {{body.username}} LIMIT 1;',
          'IF LEN($u.rows) == 0',
          '  RETURN 401 { "ok": false, "error": "NO_USER" };',
          'END',
          'IF SM4_DEC($u.rows[0].password_hash, \'clickbuild-key\') != {{body.password}}',
          '  RETURN 401 { "ok": false, "error": "BAD_PASSWORD" };',
          'END',
          'LET $t = TOKEN NEW { "onlyId": $u.rows[0].only_id, "username": {{body.username}} };',
          'RETURN 200 { "ok": true, "token": $t.token };',
        ].join('\n'),
        cache: { enabled: false, key: '', ttl: 60 },
      },
      {
        ...spec.newRoute('custom', user, 2), name: '当前用户', method: 'GET', path: '/me', auth: true,
        script: ['RETURN 200 { "user": $user };'].join('\n'),
        cache: { enabled: false, key: '', ttl: 60 },
      },
      spec.newRoute('list', user),
    ];
    user.routes[3].path = '/users';
    interfaces.push(user);
  }

  const project = spec.normalizeProject({
    name: /订单|商城|商品/.test(p) ? '订单服务' : '接口工程',
    description: p.slice(0, 120) || 'AI 生成的接口工程',
    categories,
    interfaces,
    functions: [{ name: 'MASK_PHONE', params: ['v'], body: 'CONCAT(SUBSTR(v, 0, 3), "****", SUBSTR(v, 7, 4))' }],
  });
  return {
    project,
    reply: [
      `已经按「${p.slice(0, 60) || '通用接口'}」生成 ${project.interfaces.length} 个接口、${project.interfaces.reduce((n, i) => n + i.tables.length, 0)} 张表。`,
      '每个接口都能多表联查、写路由默认带事务；账号接口用 SM4 存密码、注册即发 token。',
      '下一步可以点“生成服务”，再在控制台里逐条试。',
    ].join('\n'),
    mode: 'mock',
  };
}

module.exports = { complete, mockReply, status, contextOf, DEFAULT_AI, normalizeAiFrontend, parseResult };
