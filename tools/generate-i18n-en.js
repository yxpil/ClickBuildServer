'use strict';

// 用 B 站 Index-Translate 免费公网 API 重新生成英文语言包。
// 文档：https://index-translate.bilibili.com/
// 接口：https://index-translate.bilibili.com/v1/chat/completions（OpenAI 兼容，无需 API Key）
// 用法：node tools\generate-i18n-en.js [--model Index-Translate-35B-A3B] [--dry]
//
// 设计要点：
// 1. 不手写译文；中文 UI 串全部交给模型翻译。
// 2. 先把 ${...}、{{...}} 换成 [[PHn]]，避免模型动占位符；回填时句式还原成 $1 $2，词条还原原文。
// 3. 按字符数和条数切批，严格校验返回 JSON、条数、占位符和中文残留，失败重试。
// 4. 全部成功后才覆盖 en-US.json，避免半成品。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_FILE = path.join(ROOT, 'app/i18n/locales/en-US.json');
const EXTRA_FILE = path.join(ROOT, 'tools/i18n-extra-zh.json');
const API_BASE = process.env.INDEX_TRANSLATE_BASE || 'https://index-translate.bilibili.com/v1';
const MODEL = process.argv.includes('--model')
  ? process.argv[process.argv.indexOf('--model') + 1]
  : 'Index-Translate-35B-A3B';
const DRY = process.argv.includes('--dry');
const INCREMENTAL = process.argv.includes('--incremental');

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const BATCH_MAX_CHARS = 4200;
const BATCH_MAX_ITEMS = 16;
const PATTERN_MAX_CHARS = 4000;
const PATTERN_MAX_ITEMS = 12;

const GLOSSARY = [
  '接口=API',
  '工作台=Workbench',
  '工程=Project',
  '主表=main table',
  '表=table',
  '字段=field',
  '路由=route',
  '脚本=script',
  '运行环境=Runtime',
  '生成服务=Generate Service',
  '更新部署=Deploy Update',
  '试运行=Try Run',
  '前端工坊=Frontend Studio',
  '排错=Troubleshooting',
  '业务表格=Business Tables',
  '平台表格=Platform Tables',
].join(', ');

function promptFor(kind) {
  return [
    'You are localizing a Windows desktop application from Simplified Chinese to English (US).',
    'Translate every string in the input JSON array.',
    'Style: concise, professional, consistent desktop UI English. Labels use sentence case; buttons use imperative verbs.',
    '',
    'Hard rules:',
    '- Keep every [[PHn]] token exactly as written, including the double brackets. Do not translate, remove, reorder, or add tokens.',
    '- Keep product names ClickBuildServer / ClickBuild and technical terms MariaDB, Redis, RustFS, SQL, JSON, HTTP, API, .yxpp, .yxpn unchanged.',
    '- Do not translate code identifiers, file extensions, keyboard shortcuts, URLs or numeric units.',
    '- Return a strict JSON array of strings only, with the same length and order as the input. No Markdown, no explanation.',
    `- Glossary: ${GLOSSARY}.`,
    kind === 'patterns'
      ? '- These strings are UI sentence patterns. Preserve the meaning and keep every [[PHn]] token in a natural position.'
      : '- These strings are exact-match UI dictionary entries, including labels, buttons, menus and messages.',
  ].join('\n');
}

function protect(text) {
  const map = [];
  const protectedText = String(text).replace(/\{\{[^{}]+\}\}|\$\{[^{}]+\}/g, (raw) => {
    map.push(raw);
    return `[[PH${map.length}]]`;
  });
  return { text: protectedText, map };
}

function restore(text, map, asPattern) {
  let out = String(text);
  for (let i = 0; i < map.length; i++) {
    const token = `[[PH${i + 1}]]`;
    if (!out.includes(token)) throw new Error(`missing placeholder ${token}`);
    out = out.split(token).join(asPattern ? `$${i + 1}` : map[i]);
  }
  const extra = /\[\[PH\d+\]\]/.exec(out);
  if (extra) throw new Error(`unexpected placeholder ${extra[0]}`);
  return out;
}

function parseJsonArray(raw) {
  let text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('response is not a JSON array');
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('response is not an array');
  return parsed;
}

async function callApi(texts, kind) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: `${promptFor(kind)}\n\nInput JSON:\n${JSON.stringify(texts)}` }],
    temperature: 0,
    max_tokens: 4096,
    chat_template_kwargs: { enable_thinking: false },
  };
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ClickBuildServer-i18n/1.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const content = json && json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content
    : '';
  return parseJsonArray(content);
}

function batchesFor(entries, maxChars, maxItems) {
  const out = [];
  let cur = [];
  let chars = 0;
  for (const entry of entries) {
    const size = entry.s.length + 20;
    if (cur.length && (cur.length >= maxItems || chars + size > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(entry);
    chars += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function translateBatch(batch, kind, translated) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const rows = await callApi(batch.map((x) => x.s), kind);
      if (rows.length !== batch.length) throw new Error(`expected ${batch.length} rows, got ${rows.length}`);
      for (let i = 0; i < batch.length; i++) {
        const source = batch[i];
        const row = rows[i];
        if (row && typeof row === 'object') throw new Error(`unexpected object row at ${source.id}`);
        const text = String(row == null ? '' : row).trim();
        if (!text) throw new Error(`empty translation for ${source.id}`);
        if (HAN.test(text)) throw new Error(`Chinese residue for ${source.id}: ${text}`);
        const restored = restore(text, source.map, kind === 'patterns');
        const suffixFragment = /^[」』”’]/u.test(source.raw) && source.raw.length <= 6;
        if (!suffixFragment && kind !== 'patterns' && /^[\s\p{P}\p{S}]+$/u.test(restored) && /\p{Script=Han}/u.test(source.raw)) {
          throw new Error(`translation lost content for ${source.id}`);
        }
        translated.set(source.id, restored);
      }
      return;
    } catch (e) {
      lastError = e;
      const wait = Math.min(30000, attempt * 3000);
      console.log(`  retry ${attempt}/4 ${kind} batch of ${batch.length}: ${e.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (batch.length > 1) {
    const mid = Math.floor(batch.length / 2);
    console.log(`  split ${kind} batch ${batch.length} -> ${mid} + ${batch.length - mid}`);
    await translateBatch(batch.slice(0, mid), kind, translated);
    await translateBatch(batch.slice(mid), kind, translated);
    return;
  }
  throw lastError;
}

async function translateEntries(entries, kind) {
  const translated = new Map();
  const maxChars = kind === 'patterns' ? PATTERN_MAX_CHARS : BATCH_MAX_CHARS;
  const maxItems = kind === 'patterns' ? PATTERN_MAX_ITEMS : BATCH_MAX_ITEMS;
  const batches = batchesFor(entries, maxChars, maxItems);
  let done = 0;

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    await translateBatch(batch, kind, translated);
    done += batch.length;
    console.log(`  ${kind}: ${done}/${entries.length} (${Math.round(done / entries.length * 100)}%)`);
  }
  return translated;
}

async function main() {
  const pack = JSON.parse(fs.readFileSync(PACK_FILE, 'utf8'));
  const extra = fs.existsSync(EXTRA_FILE) ? JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf8')) : { dict: [], patterns: [] };
  const dictKeys = [...new Set([...Object.keys(pack.dict || {}), ...(extra.dict || []).filter((x) => typeof x === 'string')])];
  const dictEntries = dictKeys
    .filter((key) => HAN.test(key))
    .filter((key) => !(INCREMENTAL && typeof pack.dict[key] === 'string' && pack.dict[key] && !HAN.test(pack.dict[key])))
    .map((key, id) => {
      const p = protect(key);
      return { id, raw: key, s: p.text, map: p.map };
    });

  const patternSources = [...new Set([...(pack.patterns || []).map((p) => p.src), ...(extra.patterns || []).filter((x) => typeof x === 'string')])]
    .filter((src) => typeof src === 'string' && src);
  const patternEntries = patternSources
    .filter((src) => !(INCREMENTAL && (pack.patterns || []).some((p) => p.src === src && p.dst && !HAN.test(p.dst))))
    .map((src, id) => {
      const prot = protect(src);
      return { id, raw: src, s: prot.text, map: prot.map };
    });

  console.log(`Index-Translate: ${API_BASE} · ${MODEL}`);
  console.log(`待翻译：${dictEntries.length} 条词条，${patternEntries.length} 条句式（新增词条 ${dictEntries.filter((x) => !Object.prototype.hasOwnProperty.call(pack.dict, x.raw)).length}，新增句式 ${patternEntries.filter((x) => !(pack.patterns || []).some((p) => p.src === x.raw)).length}）`);
  if (DRY) {
    console.log(batchesFor(dictEntries, BATCH_MAX_CHARS, BATCH_MAX_ITEMS).map((x, i) => `  dict batch ${i + 1}: ${x.length}`).join('\n'));
    console.log(batchesFor(patternEntries, PATTERN_MAX_CHARS, PATTERN_MAX_ITEMS).map((x, i) => `  pattern batch ${i + 1}: ${x.length}`).join('\n'));
    return;
  }

  const dictResult = await translateEntries(dictEntries, 'dict');
  const patternResult = await translateEntries(patternEntries, 'patterns');

  const nextDict = {};
  for (const key of dictKeys) {
    if (!HAN.test(key)) { nextDict[key] = pack.dict[key]; continue; }
    const hit = dictEntries.find((x) => x.raw === key);
    if (hit && dictResult.has(hit.id)) {
      nextDict[key] = dictResult.get(hit.id);
      continue;
    }
    if (typeof pack.dict[key] === 'string' && pack.dict[key] && !HAN.test(pack.dict[key])) {
      nextDict[key] = pack.dict[key];
      continue;
    }
    throw new Error(`missing translation for ${key}`);
  }

  const nextPatterns = patternSources.map((src) => {
    const hit = patternEntries.find((x) => x.raw === src);
    if (hit && patternResult.has(hit.id)) return { src, dst: patternResult.get(hit.id) };
    const old = (pack.patterns || []).find((p) => p.src === src);
    if (old && old.dst && !HAN.test(old.dst)) return { src, dst: old.dst };
    throw new Error(`missing translation for pattern ${src}`);
  });

  if (nextPatterns.some((x) => !x.dst)) throw new Error('some patterns have no translation');
  const next = { locale: 'en-US', source: 'zh-CN', dict: nextDict, patterns: nextPatterns };
  fs.writeFileSync(PACK_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log(`写入 ${PACK_FILE}: dict ${Object.keys(nextDict).length}, patterns ${nextPatterns.length}`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
