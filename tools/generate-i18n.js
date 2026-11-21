// 作者：yxpil
'use strict';

// 用 B 站 Index-Translate 免费公网 API 预生成全部界面语言包。
// 文档：https://index-translate.bilibili.com/
// 接口：https://index-translate.bilibili.com/v1/chat/completions（OpenAI 兼容，无需 API Key）
//
// 用法：
//   node tools/generate-i18n.js --locale ja-JP
//   node tools/generate-i18n.js --locale ja-JP,ko-KR,fr-FR
//   node tools/generate-i18n.js --all
//   node tools/generate-i18n.js --all --concurrency 3
//   node tools/generate-i18n.js --locale en-US --incremental
//
// 设计：
// 1. 词条源仍是 en-US.json 的中文 key + tools/i18n-extra-zh.json，保证所有语言覆盖同一套 UI 串。
// 2. ${...} / {{...}} 先换 @@PHn@@，模型不能动占位符；回填时句式还原为 $1 $2。
// 3. 每批成功即写进度文件，进程中断后可续跑；全部成功后才原子替换正式语言包。
// 4. 严格校验条数、空值、占位符、中文残留；失败自动重试、拆批。

const fs = require('fs');
const path = require('path');
const { SOURCE, LOCALES } = require('../app/i18n/catalog');

const ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'app/i18n/locales');
const EN_FILE = path.join(PACK_DIR, 'en-US.json');
const EXTRA_FILE = path.join(ROOT, 'tools/i18n-extra-zh.json');
const EN_PACK = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));
const PROGRESS_DIR = path.join(ROOT, 'tools/.i18n-progress');
const API_BASE = process.env.INDEX_TRANSLATE_BASE || 'https://index-translate.bilibili.com/v1';
const MODEL = process.argv.includes('--model')
  ? process.argv[process.argv.indexOf('--model') + 1]
  : 'Index-Translate-35B-A3B';
const INCREMENTAL = process.argv.includes('--incremental');
const ALL = process.argv.includes('--all');
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.argv.includes('--concurrency') ? process.argv[process.argv.indexOf('--concurrency') + 1] : 2) || 2));

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const HANGUL = /[\uac00-\ud7af]/;
const SIMPLIFIED_MARKERS = /[这个说时间设页关开发数据网络络终应项图标视选择删创编编辑辑复导运务点确错帮档统录册码验证类称状态试脚缓权对详链钮单题备认级础义体颜边圆阴层锁隐扩资盘进协议请响参变条断异获抛滚询连关联组过虑页计汇总户内]/;

// API 偶尔在繁体输出里留下个别简体字；这里只做字形纠正，不替代翻译。
const TRAD_FIX = {
  这: '這', 个: '個', 说: '說', 时: '時', 间: '間', 设: '設', 页: '頁', 关: '關', 开: '開', 发: '發',
  数: '數', 据: '據', 网: '網', 络: '絡', 终: '終', 应: '應', 项: '項', 图: '圖', 标: '標', 视: '視',
  选: '選', 择: '擇', 删: '刪', 创: '創', 编: '編', 辑: '輯', 复: '復', 导: '導', 运: '運', 务: '務',
  点: '點', 确: '確', 错: '錯', 帮: '幫', 档: '檔', 统: '統', 录: '錄', 册: '冊', 码: '碼', 验: '驗',
  证: '證', 类: '類', 称: '稱', 状: '狀', 态: '態', 试: '試', 脚: '腳', 缓: '緩', 权: '權', 对: '對',
  详: '詳', 链: '鏈', 钮: '鈕', 单: '單', 题: '題', 备: '備', 认: '認', 级: '級', 础: '礎', 义: '義',
  体: '體', 颜: '顏', 边: '邊', 圆: '圓', 阴: '陰', 层: '層', 锁: '鎖', 隐: '隱', 扩: '擴', 资: '資',
  盘: '盤', 进: '進', 协: '協', 议: '議', 请: '請', 响: '響', 参: '參', 变: '變', 条: '條', 断: '斷',
  异: '異', 获: '獲', 抛: '拋', 滚: '滾', 询: '詢', 连: '連', 联: '聯', 组: '組', 过: '過', 虑: '慮',
  计: '計', 汇: '匯', 总: '總', 户: '戶', 内: '內',
};

function fixTraditional(text) {
  return String(text)
    .replace(/复制/g, '複製')
    .replace(/复原/g, '復原')
    .replace(/恢复/g, '恢復')
    .replace(/重复/g, '重複')
    .replace(/复杂/g, '複雜')
    .replace(/[这个说时间设页关开发数据网络络终应项图标视选择删创编编辑辑复导运务点确错帮档统录册码验证类称状态试脚缓权对详链钮单题备认级础义体颜边圆阴层锁隐扩资盘进协议请响参变条断异获抛滚询连关联组过虑页计汇总户内]/g, (c) => TRAD_FIX[c] || c);
}
const BATCH_MAX_CHARS = 3000;
const BATCH_MAX_ITEMS = 8;
const PATTERN_MAX_CHARS = 2800;
const PATTERN_MAX_ITEMS = 8;

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

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function promptFor(locale, kind, count) {
  const target = locale.target || locale.id;
  const common = [
    `You are localizing a Windows desktop application from Simplified Chinese to ${target} (${locale.id}).`,
    'Translate every input string. Do not summarize, explain, or leave Chinese.',
    'Style: concise, professional desktop UI wording. Buttons use imperative verbs; labels use the target language’s standard software terminology.',
    '',
    'Hard rules:',
    `- Return exactly ${count} lines. Each line must start with its 1-based input number and ">> ", for example "3>> translation". No JSON, no Markdown, no explanation.`,
    '- Never merge two inputs into one line and never skip an input.',
    '- Keep every @@PHn@@ token exactly as written. Do not translate, remove, reorder, or add tokens.',
    '- Keep product names ClickBuildServer / ClickBuild and technical terms MariaDB, Redis, RustFS, SQL, JSON, HTTP, API, .yxpp, .yxpn unchanged.',
    '- Do not translate code identifiers, file extensions, keyboard shortcuts, URLs or numeric units.',
    '- Use the same translation for the same source term across this batch to keep UI wording consistent.',
    '- Do not put line breaks inside a translation; use spaces instead.',
  ];
  if (locale.id === 'en-US') {
    common.push(`- Glossary: ${GLOSSARY}.`);
  }
  if (locale.id === 'zh-TW') {
    common.push('- Use Traditional Chinese as written in Taiwan. Never output Simplified Chinese characters.');
  }
  if (locale.id === 'ja-JP') {
    common.push('- Use natural Japanese UI wording with kanji and kana. Do not copy the Chinese source verbatim when a Japanese term exists.');
  }
  if (locale.id === 'ko-KR') {
    common.push('- Use natural Korean UI wording in Hangul. Do not use Hanja or leave Chinese characters.');
  }
  if (locale.id === 'ar-SA') {
    common.push('- Use Modern Standard Arabic. Keep UI labels short; placeholders may appear anywhere natural in the sentence.');
  }
  common.push(kind === 'patterns'
    ? '- These strings are UI sentence patterns. Preserve the meaning and keep every @@PHn@@ token in a natural position.'
    : '- These strings are exact-match UI dictionary entries, including labels, buttons, menus, validation messages and help text.');
  return common.join('\n');
}

function protect(text) {
  const map = [];
  const s = String(text);
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
      }
      if (j < s.length) {
        map.push(s.slice(i, j + 1));
        out += `@@PH${map.length}@@`;
        i = j + 1;
        continue;
      }
    }
    if (s[i] === '{' && s[i + 1] === '{') {
      const end = s.indexOf('}}', i + 2);
      if (end > 0) {
        map.push(s.slice(i, end + 2));
        out += `@@PH${map.length}@@`;
        i = end + 2;
        continue;
      }
    }
    out += s[i];
    i += 1;
  }
  return { text: out, map };
}

function restore(text, map, asPattern, raw) {
  let out = String(text);
  for (let i = 0; i < map.length; i++) {
    const token = `@@PH${i + 1}@@`;
    if (!out.includes(token)) {
      // 句式开头就是变量时，模型偶尔会只译标签、吞掉第一个 %PHn%。
      if (asPattern && i === 0 && String(raw || '').trim().startsWith(map[0])) {
        out = token + ' ' + out;
        continue;
      }
      throw new Error(`missing placeholder ${token}`);
    }
    out = out.split(token).join(asPattern ? `$${i + 1}` : map[i]);
  }
  const extra = /@@PH\d+@@/.exec(out);
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

function parseNumbered(raw, count) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const out = new Array(count).fill('');
  let hits = 0;
  let last = -1;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d{1,3})\s*>>\s?(.*)$/.exec(line);
    if (m) {
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < count) {
        out[idx] = String(m[2] || '').trim();
        last = idx;
        hits += 1;
      }
      continue;
    }
    if (last >= 0 && line.trim()) out[last] += ' ' + line.trim();
  }
  if (hits === 1 && count > 1) {
    const parts = out[0].split(/","/).map((x) => x.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean);
    if (parts.length === count) return parts;
    return null;
  }
  return hits >= Math.max(1, Math.ceil(count / 2)) ? out : null;
}

function parseRows(raw, count) {
  let text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const rows = [];
  const push = (body) => {
    const value = String(body || '').trim();
    // 模型偶尔把多行挤成一行，用 "," 连接多个带引号的译文。
    if ((value.match(/","/g) || []).length >= 2) {
      for (const part of value.split(/","/)) {
        const item = part.trim().replace(/^["']|["']$/g, '').trim();
        if (item) rows.push(item);
      }
      return;
    }
    rows.push(value);
  };
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*>>\s?(.*)$/.exec(line);
    if (m) push(m[1]);
    else if (rows.length && line.trim()) rows[rows.length - 1] += ' ' + line.trim();
  }
  if (rows.length === count) return rows;
  // 模型有时只在第一行加 >>，后面每行直接放译文。
  const plainLines = text.split(/\r?\n/)
    .map((line) => line.replace(/^\s*>>\s?/, '').trim())
    .filter(Boolean);
  if (plainLines.length === count) return plainLines;
  if (count === 1 && rows.length) return [rows.join(' ')];
  // 兼容模型偶尔仍返回 JSON 数组的情况。
  try {
    const parsed = parseJsonArray(text);
    if (Array.isArray(parsed) && parsed.length === count) return parsed;
  } catch (e) { /* fall through */ }
  throw new Error(`expected ${count} >> lines, got ${rows.length}: ${text.slice(0, 300)}`);
}

async function callApi(locale, texts, kind) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: `${promptFor(locale, kind, texts.length)}\n\nInput strings (${texts.length}):\n${JSON.stringify(texts)}` }],
    temperature: 0,
    max_tokens: 6144,
    chat_template_kwargs: { enable_thinking: false },
  };
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ClickBuildServer-i18n/1.1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const content = json && json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content
    : '';
  return parseNumbered(content, texts.length) || parseRows(content, texts.length);
}

function validateText(locale, source, text, kind) {
  if (!text) throw new Error(`empty translation for ${source.id}`);
  if (text.trim() === source.raw.trim() && HAN.test(source.raw) && source.raw.length > 4 && locale.id !== 'ja-JP' && locale.id !== 'zh-TW') {
    throw new Error(`untranslated source for ${source.id}: ${text}`);
  }
  if (locale.id !== 'ja-JP' && locale.id !== 'zh-TW' && HAN.test(text)) {
    throw new Error(`Chinese residue for ${source.id}: ${text}`);
  }
  if (locale.id === 'zh-TW' && SIMPLIFIED_MARKERS.test(text)) {
    const bad = [...new Set(text.match(SIMPLIFIED_MARKERS) || [])].join('');
    throw new Error(`Simplified residue ${bad} for ${source.id}: ${text}`);
  }
  if (locale.id === 'ko-KR' && !HANGUL.test(text) && source.raw.length > 4) {
    throw new Error(`missing Hangul for ${source.id}: ${text}`);
  }
  const suffixFragment = /^[」』”’]/u.test(source.raw) && source.raw.length <= 6;
  const shortFragment = source.raw.length <= 4;
  if (!suffixFragment && !shortFragment && kind !== 'patterns' && /^[\s\p{P}\p{S}]+$/u.test(text) && /\p{Script=Han}/u.test(source.raw)) {
    throw new Error(`translation lost content for ${source.id}: [${source.raw}] -> [${text}]`);
  }
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

async function translateBatch(locale, batch, kind, translated) {
  let pending = batch;
  let lastError = null;
  for (let attempt = 1; attempt <= 4 && pending.length; attempt++) {
    try {
      const rows = await callApi(locale, pending.map((x) => x.s), kind);
      if (rows.length !== pending.length) throw new Error(`expected ${pending.length} rows, got ${rows.length}`);
      const failed = [];
      for (let i = 0; i < pending.length; i++) {
        const source = pending[i];
        const row = rows[i];
        try {
          if (row && typeof row === 'object') throw new Error(`unexpected object row at ${source.id}`);
          const rawText = String(row == null ? '' : row).trim();
          const text = locale.id === 'zh-TW' ? fixTraditional(rawText) : rawText;
          validateText(locale, source, text, kind);
          translated.set(source.id, restore(text, source.map, kind === 'patterns', source.raw));
        } catch (e) {
          failed.push(source);
          lastError = e;
          if (pending.length <= 4) console.log(`  [${locale.id}] ${kind} item failed: ${e.message} :: ${source.raw.slice(0, 80)}`);
        }
      }
      if (!failed.length) return;
      pending = failed;
      console.log(`  [${locale.id}] retry ${attempt}/4 ${kind} ${pending.length} failed item(s)`);
    } catch (e) {
      lastError = e;
      console.log(`  [${locale.id}] retry ${attempt}/4 ${kind} batch of ${pending.length}: ${e.message}`);
    }
    if (pending.length) await new Promise((r) => setTimeout(r, Math.min(15000, attempt * 2000)));
  }
  if (pending.length === 1 && locale.id !== 'en-US') {
    const source = pending[0];
    const fallback = kind === 'dict'
      ? (EN_PACK.dict && EN_PACK.dict[source.raw])
      : ((EN_PACK.patterns || []).find((p) => p.src === source.raw) || {}).dst;
    if (typeof fallback === 'string' && fallback.trim()) {
      translated.set(source.id, fallback);
      console.log(`  [${locale.id}] fallback to pre-generated English for: ${source.raw.slice(0, 60)}`);
      return;
    }
  }
  if (pending.length > 1) {
    const mid = Math.floor(pending.length / 2);
    console.log(`  [${locale.id}] split ${kind} batch ${pending.length} -> ${mid} + ${pending.length - mid}`);
    await translateBatch(locale, pending.slice(0, mid), kind, translated);
    await translateBatch(locale, pending.slice(mid), kind, translated);
    return;
  }
  throw lastError || new Error(`missing translation in ${kind}`);
}

function normalizePattern(src, dst) {
  // 源句式以变量开头时，译文也必须以 $1 开头，避免“Interface 3”这类错位。
  if (!/^\s*\$\{[^{}]+\}/.test(src)) return dst;
  if (!/\$1/.test(dst) || dst.trim().startsWith('$1')) return dst;
  const rest = dst.replace('$1', '').replace(/\s{2,}/g, ' ').trim();
  return rest ? `$1 ${rest}` : '$1';
}

function writeProgress(locale, progress) {
  fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  const file = path.join(PROGRESS_DIR, `${locale.id}.json`);
  fs.writeFileSync(file, JSON.stringify(progress, null, 2) + '\n', 'utf8');
}

function readProgress(locale) {
  const file = path.join(PROGRESS_DIR, `${locale.id}.json`);
  if (!fs.existsSync(file)) return { dict: {}, patterns: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { dict: raw.dict && typeof raw.dict === 'object' ? raw.dict : {}, patterns: raw.patterns && typeof raw.patterns === 'object' ? raw.patterns : {} };
  } catch (e) {
    return { dict: {}, patterns: {} };
  }
}

async function generateLocale(locale) {
  if (locale.id === SOURCE) return;
  fs.mkdirSync(PACK_DIR, { recursive: true });
  const packFile = path.join(PACK_DIR, `${locale.id}.json`);
  const pack = fs.existsSync(packFile)
    ? JSON.parse(fs.readFileSync(packFile, 'utf8'))
    : { locale: locale.id, source: SOURCE, dict: {}, patterns: [] };
  const en = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));
  const extra = fs.existsSync(EXTRA_FILE) ? JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf8')) : { dict: [], patterns: [] };
  const progress = INCREMENTAL ? readProgress(locale) : { dict: {}, patterns: {} };

  const dictKeys = [...new Set([...Object.keys(en.dict || {}), ...Object.keys(pack.dict || {}), ...(extra.dict || []).filter((x) => typeof x === 'string')])];
  const patternSources = [...new Set([...(en.patterns || []).map((p) => p.src), ...(pack.patterns || []).map((p) => p.src), ...(extra.patterns || []).filter((x) => typeof x === 'string')])]
    .filter((src) => typeof src === 'string' && src);

  const knownDict = (key) => {
    if (progress.dict[key] && typeof progress.dict[key] === 'string') return progress.dict[key];
    if (INCREMENTAL && pack.dict && typeof pack.dict[key] === 'string' && pack.dict[key] && (locale.id === 'ja-JP' || locale.id === 'zh-TW' || !HAN.test(pack.dict[key]))) return pack.dict[key];
    return '';
  };
  const knownPattern = (src) => {
    if (progress.patterns[src] && typeof progress.patterns[src] === 'string') return progress.patterns[src];
    const old = (pack.patterns || []).find((p) => p.src === src);
    if (INCREMENTAL && old && old.dst && (locale.id === 'ja-JP' || locale.id === 'zh-TW' || !HAN.test(old.dst))) return old.dst;
    return '';
  };

  const dictEntries = dictKeys
    .filter((key) => HAN.test(key))
    .filter((key) => !knownDict(key))
    .map((key, id) => {
      const p = protect(key);
      return { id, raw: key, s: p.text, map: p.map };
    });
  const patternEntries = patternSources
    .filter((src) => !knownPattern(src))
    .map((src, id) => {
      const prot = protect(src);
      return { id, raw: src, s: prot.text, map: prot.map };
    });

  console.log(`\n[${locale.id}] ${locale.target}: 待翻译 ${dictEntries.length} 词条 / ${patternEntries.length} 句式`);
  if (process.argv.includes('--dry')) {
    console.log(`  dict batches ${batchesFor(dictEntries, BATCH_MAX_CHARS, BATCH_MAX_ITEMS).length}, pattern batches ${batchesFor(patternEntries, PATTERN_MAX_CHARS, PATTERN_MAX_ITEMS).length}`);
    return;
  }

  for (const [kind, entries, maxChars, maxItems] of [
    ['dict', dictEntries, BATCH_MAX_CHARS, BATCH_MAX_ITEMS],
    ['patterns', patternEntries, PATTERN_MAX_CHARS, PATTERN_MAX_ITEMS],
  ]) {
    const batches = batchesFor(entries, maxChars, maxItems);
    let done = 0;
    for (const batch of batches) {
      const translated = new Map();
      await translateBatch(locale, batch, kind, translated);
      for (const item of batch) {
        const value = translated.get(item.id);
        if (!value) throw new Error(`missing translation for ${item.raw}`);
        progress[kind][item.raw] = value;
      }
      writeProgress(locale, progress);
      done += batch.length;
      if (entries.length) console.log(`  [${locale.id}] ${kind}: ${done}/${entries.length} (${Math.round(done / entries.length * 100)}%)`);
    }
  }

  const nextDict = {};
  for (const key of dictKeys) {
    if (!HAN.test(key)) {
      nextDict[key] = (pack.dict && pack.dict[key]) || key;
      continue;
    }
    const value = progress.dict[key] || (INCREMENTAL && pack.dict && pack.dict[key]);
    if (!value || (locale.id !== 'ja-JP' && locale.id !== 'zh-TW' && HAN.test(value))) throw new Error(`missing translation for ${key}`);
    nextDict[key] = value;
  }

  const nextPatterns = patternSources.map((src) => {
    const dst = progress.patterns[src] || (INCREMENTAL ? (pack.patterns || []).find((p) => p.src === src) || {} : {}).dst;
    if (!dst) throw new Error(`missing translation for pattern ${src}`);
    return { src, dst: normalizePattern(src, dst) };
  });

  const next = { locale: locale.id, source: SOURCE, dict: nextDict, patterns: nextPatterns };
  const tmp = `${packFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, packFile);
  const progressFile = path.join(PROGRESS_DIR, `${locale.id}.json`);
  try { fs.unlinkSync(progressFile); } catch (e) { /* ignore */ }
  console.log(`[${locale.id}] 写入 ${packFile}: dict ${Object.keys(nextDict).length}, patterns ${nextPatterns.length}`);
}

async function main() {
  if (!fs.existsSync(EN_FILE)) throw new Error('缺少 en-US.json，无法确定源词条集合');
  const raw = arg('--locale', '');
  const ids = ALL
    ? LOCALES.filter((x) => x.id !== SOURCE).map((x) => x.id)
    : raw.split(',').map((x) => x.trim()).filter(Boolean);
  const targets = ids.map((id) => {
    const hit = LOCALES.find((x) => x.id.toLowerCase() === id.toLowerCase());
    if (!hit) throw new Error(`未知语言：${id}`);
    return hit;
  });
  if (!targets.length) throw new Error('请传 --all 或 --locale ja-JP,ko-KR');

  console.log(`Index-Translate: ${API_BASE} · ${MODEL} · 并发 ${CONCURRENCY}`);
  const queue = targets.slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const locale = queue.shift();
      await generateLocale(locale);
    }
  });
  await Promise.all(workers);
  console.log('\n全部完成。');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
