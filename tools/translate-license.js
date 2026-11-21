'use strict';

// 用 Index-Translate 预生成安装器许可证正文，避免日语/德语等安装器界面是本地语言、许可证却仍是英文。
// 源文：build/license_en_US.txt；繁体中文从 build/license_zh_CN.txt 转写。
// 用法：node tools/translate-license.js
//      node tools/translate-license.js --locale ja_JP,de_DE
//      node tools/translate-license.js --force

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const API_BASE = process.env.INDEX_TRANSLATE_BASE || 'https://index-translate.bilibili.com/v1';
const MODEL = 'Index-Translate-35B-A3B';
const FORCE = process.argv.includes('--force');
const LOG_FILE = path.join(ROOT, 'license-i18n.log');

const LANGS = {
  zh_TW: { name: 'Traditional Chinese (Taiwan)', source: 'zh_CN' },
  ja_JP: { name: 'Japanese' },
  ko_KR: { name: 'Korean' },
  fr_FR: { name: 'French' },
  de_DE: { name: 'German' },
  es_ES: { name: 'Spanish (Spain)' },
  pt_BR: { name: 'Brazilian Portuguese' },
  it_IT: { name: 'Italian' },
  ru_RU: { name: 'Russian' },
  ar_SA: { name: 'Modern Standard Arabic' },
  nl_NL: { name: 'Dutch' },
  pl_PL: { name: 'Polish' },
  tr_TR: { name: 'Turkish' },
  th_TH: { name: 'Thai' },
  vi_VN: { name: 'Vietnamese' },
  cs_CZ: { name: 'Czech' },
  sv_SE: { name: 'Swedish' },
};

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG_FILE, text + '\n');
}

function prompts(lang, name, sourceName) {
  return [
    `You are translating the ClickBuildServer installer terms of use from ${sourceName} into ${name}.`,
    'Translate the complete text faithfully and keep the legal register. Do not summarize, shorten, merge or add clauses.',
    '',
    'Hard rules:',
    '- Output plain text only: no Markdown fences, no commentary, no "translation:" prefix.',
    '- Keep the same structure: title line, blank lines, sections "1." to "4.", headings, paragraphs and the final copyright line.',
    '- Keep the URL https://www.apache.org/licenses/LICENSE-2.0 exactly.',
    '- Keep ClickBuildServer, Apache License, Apache License 2.0, LICENSE, NOTICE, AS IS and yxpil unchanged.',
    '- Do not translate the copyright year or the © symbol.',
    '- After the title line, add exactly one line: a faithful translation of "Machine translation of the English original; if there is any discrepancy, the English text prevails."',
    '- Do not wrap long paragraphs manually; keep one paragraph per line.',
  ].join('\n');
}

async function callApiRaw(content, maxTokens) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content }],
    temperature: 0,
    max_tokens: maxTokens || 4096,
    chat_template_kwargs: { enable_thinking: false },
  };
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ClickBuildServer-license-i18n/1.1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const json = JSON.parse(raw);
  const contentText = json?.choices?.[0]?.message?.content || '';
  return String(contentText).trim();
}

async function callApi(lang, name, sourceText, sourceName) {
  return callApiRaw(`${prompts(lang, name, sourceName)}\n\nText:\n${sourceText}`, 4096);
}

async function translateByParagraph(lang, name, sourceText, sourceName) {
  const paragraphs = sourceText.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const para of paragraphs) {
    if (/^https?:\/\//i.test(para)) { out.push(para); continue; }
    const prompt = [
      `Translate this single paragraph of the ClickBuildServer installer terms from ${sourceName} into ${name}.`,
      'Translate faithfully in legal register. Output the translated paragraph only, no commentary.',
      'Keep section numbers, URLs, ClickBuildServer, Apache License, LICENSE, NOTICE, AS IS, yxpil and © 2026 unchanged.',
    ].join('\n');
    let translated = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        translated = clean(await callApiRaw(`${prompt}\n\nParagraph:\n${para}`, 1200));
        if (translated) break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    out.push(translated);
  }
  return out.join('\n\n');
}

function clean(text) {
  return text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .replace(/^(translation|译文|翻譯)\s*[:：]\s*/i, '')
    .trim();
}

function validate(lang, text) {
  if (!text || text.length < 500) throw new Error('too short');
  if (!text.includes('https://www.apache.org/licenses/LICENSE-2.0')) throw new Error('missing license URL');
  if (!/apache/i.test(text)) throw new Error('missing Apache License');
  if (!/©\s*2026\s+yxpil/i.test(text)) throw new Error('missing copyright');
  const sections = (text.match(/^\s*(?:[1-4][.．、]|[一二三四][、.．])\s*\S/gm) || []).length;
  if (sections < 4) throw new Error(`sections=${sections}`);
  if (lang !== 'zh_TW' && lang !== 'ja_JP' && /[\u4e00-\u9fff]/.test(text)) throw new Error('contains Chinese');
  if (lang === 'ja_JP' && !/[\u3040-\u30ff]/.test(text)) throw new Error('no Japanese kana');
  return true;
}

async function translateOne(lang, meta) {
  const out = path.join(BUILD_DIR, `license_${lang}.txt`);
  if (!FORCE && fs.existsSync(out)) { log(`${lang}: exists, skip`); return; }
  const sourceFile = meta.source === 'zh_CN' ? 'license_zh_CN.txt' : 'license_en_US.txt';
  const sourceName = meta.source === 'zh_CN' ? 'Simplified Chinese' : 'English';
  const sourceText = fs.readFileSync(path.join(BUILD_DIR, sourceFile), 'utf8').replace(/^\uFEFF/, '');
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log(`${lang}: request attempt ${attempt}`);
      const text = clean(await callApi(lang, meta.name, sourceText, sourceName));
      fs.writeFileSync(path.join(BUILD_DIR, `.license-debug-${lang}.txt`), text, 'utf8');
      validate(lang, text);
      fs.writeFileSync(out, '\uFEFF' + text + '\n', 'utf8');
      log(`${lang}: wrote ${Buffer.byteLength(text, 'utf8')} bytes`);
      return;
    } catch (e) {
      lastError = e;
      log(`${lang}: attempt ${attempt} failed: ${e.message}`);
      if (e.message.startsWith('HTTP 504')) break;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  // 长段落在网关超时时会 504，切成段落逐段翻译再拼回，结构不变。
  try {
    log(`${lang}: falling back to paragraph mode`);
    const text = clean(await translateByParagraph(lang, meta.name, sourceText, sourceName));
    fs.writeFileSync(path.join(BUILD_DIR, `.license-debug-${lang}.txt`), text, 'utf8');
    validate(lang, text);
    fs.writeFileSync(out, '\uFEFF' + text + '\n', 'utf8');
    log(`${lang}: wrote ${Buffer.byteLength(text, 'utf8')} bytes (paragraph mode)`);
    return;
  } catch (e) {
    throw new Error(`${lang}: ${lastError ? lastError.message : ''} / paragraph: ${e.message}`);
  }
}

async function main() {
  const argIndex = process.argv.indexOf('--locale');
  const only = argIndex >= 0 && process.argv[argIndex + 1]
    ? process.argv[argIndex + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : Object.keys(LANGS);
  log(`start: ${only.join(', ')}`);
  const failures = [];
  for (const lang of only) {
    const meta = LANGS[lang];
    if (!meta) { failures.push(`${lang}: unknown locale`); continue; }
    try { await translateOne(lang, meta); }
    catch (e) { failures.push(e.message); }
  }
  if (failures.length) {
    log(`FAILED ${failures.length}: ${failures.join(' | ')}`);
    process.exitCode = 1;
  } else {
    log('all licenses generated');
  }
}

main();
