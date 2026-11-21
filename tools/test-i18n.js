// 作者：yxpil
'use strict';

// 多语言与安装器验收：不启动 Electron，直接校验语言目录、20 套预生成语言包、
// 繁简/中日韩文字残留、占位符完整性、安装器语言映射与首次启动语言。
// 用法：node tools\test-i18n.js

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-i18n-'));
process.env.APPDATA = tmp;
process.env.XDG_DATA_HOME = tmp;

const { SOURCE, LOCALES } = require(path.join(root, 'app/i18n/catalog'));
const i18n = require(path.join(root, 'app/i18n'));
const templates = require(path.join(root, 'app/iface/templates'));
const library = require(path.join(root, 'app/iface/iface-library'));
const en = JSON.parse(fs.readFileSync(path.join(root, 'app/i18n/locales/en-US.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extra = JSON.parse(fs.readFileSync(path.join(root, 'tools/i18n-extra-zh.json'), 'utf8'));

let ok = 0;
let bad = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + name); }
  else { bad++; console.log('  ✗ ' + name + ' → ' + String(JSON.stringify(detail)).slice(0, 220)); }
};

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const HANGUL = /[\uac00-\ud7af]/;
const SIMPLIFIED = /[这个说时间设页关开发数据网络络终应项图标视选择删创编编辑辑复导运务点确错帮档统录册码验证类称状态试脚缓权对详链钮单题备认级础义体颜边圆阴层锁隐扩资盘进协议请响参变条断异获抛滚询连关联组过虑页计汇总户内]/;

const compile = (src) => {
  const s = String(src);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
      }
      out += '(.+?)';
      i = j;
    } else {
      out += s[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + out + '$');
};

const placeholderCount = (src) => {
  const s = String(src);
  let n = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
      }
      if (j < s.length) { n++; i = j + 1; continue; }
    }
    if (s[i] === '{' && s[i + 1] === '{') {
      const end = s.indexOf('}}', i + 2);
      if (end > 0) { n++; i = end + 2; continue; }
    }
    i++;
  }
  return n;
};

const translator = (pack) => {
  const patterns = (pack.patterns || []).map((p) => ({ re: compile(p.src), dst: String(p.dst || '') })).filter((p) => p.dst);
  return (value) => {
    const text = String(value == null ? '' : value);
    if (Object.prototype.hasOwnProperty.call(pack.dict || {}, text)) return pack.dict[text];
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (m) {
        return p.dst.replace(/\$(\d+)/g, (all, n) => {
          const v = m[Number(n)];
          if (v == null) return '';
          return Object.prototype.hasOwnProperty.call(pack.dict, v) ? pack.dict[v] : v;
        });
      }
    }
    return text;
  };
};

console.log('语言目录');
t('源语言为 zh-CN', SOURCE === 'zh-CN', SOURCE);
t('共 21 种界面语言', LOCALES.length === 21, LOCALES.length);
t('语言 id 唯一', new Set(LOCALES.map((x) => x.id)).size === LOCALES.length);
t('每种语言有本地名/英文名/短码/方向', LOCALES.every((x) => x.label && x.english && x.short && (x.dir === 'ltr' || x.dir === 'rtl')));
t('仅阿拉伯语为 RTL', LOCALES.filter((x) => x.dir === 'rtl').map((x) => x.id).join(',') === 'ar-SA');
t('归一化：zh_CN / zh-Hans / zh-Hant / zh-HK', ['zh_CN', 'zh-Hans', 'zh-Hant', 'zh-HK'].map(i18n.normalize).join(',') === 'zh-CN,zh-CN,zh-TW,zh-TW');
t('归一化：en_GB / pt_PT / fr_CA / de_AT', ['en_GB', 'pt_PT', 'fr_CA', 'de_AT'].map(i18n.normalize).join(',') === 'en-US,pt-BR,fr-FR,de-DE');
t('归一化：es_MX / ar_EG / sv_FI', ['es_MX', 'ar_EG', 'sv_FI'].map(i18n.normalize).join(',') === 'es-ES,ar-SA,sv-SE');
t('未知语言返回空', i18n.normalize('xx-YY') === '', i18n.normalize('xx-YY'));
t('localeList 返回 21 种', i18n.localeList().length === 21);

console.log('\n语言包完整性');
t('英文词典至少 1000 条', Object.keys(en.dict).length >= 1000, Object.keys(en.dict).length);
t('英文模式至少 140 条', en.patterns.length >= 140, en.patterns.length);
t('英文词典没有空值', Object.values(en.dict).every((v) => typeof v === 'string' && v.trim()));
t('英文模式没有空值或残留占位符', en.patterns.every((p) => p.src && p.dst && !/\[\[PH\d+\]\]/.test(p.dst)));

const enKeys = Object.keys(en.dict).sort();
const enPatterns = en.patterns || [];
const enPatternSources = en.patterns.map((p) => p.src).sort();
const missing = [];
const mismatched = [];
for (const locale of LOCALES) {
  if (locale.id === SOURCE) continue;
  const file = path.join(root, 'app/i18n/locales', `${locale.id}.json`);
  if (!fs.existsSync(file)) { missing.push(locale.id); continue; }
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = Object.keys(pack.dict || {}).sort();
  const empty = Object.entries(pack.dict || {}).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k);
  const sameKeys = keys.length === enKeys.length && keys.every((k, i) => k === enKeys[i]);
  const samePatterns = (pack.patterns || []).length === enPatterns.length;
  const chinese = locale.id === 'ja-JP' || locale.id === 'zh-TW'
    ? []
    : Object.entries(pack.dict || {}).filter(([, v]) => HAN.test(v)).map(([k, v]) => `${k} => ${v}`);
  const simplified = locale.id === 'zh-TW'
    ? Object.entries(pack.dict || {}).filter(([, v]) => SIMPLIFIED.test(v)).map(([k, v]) => `${k} => ${v}`)
    : [];
  const noHangul = locale.id === 'ko-KR'
    ? Object.entries(pack.dict || {}).filter(([k, v]) => k.length > 4 && !HANGUL.test(v)).map(([k]) => k)
    : [];
  const badPlaceholders = (pack.patterns || []).filter((p) => {
    const n = placeholderCount(p.src);
    const used = [...String(p.dst || '').matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    return used.length !== n || used.some((x) => x < 1 || x > n);
  }).map((p) => p.src);
  t(`${locale.id} 语言包存在（${locale.target}）`, true);
  t(`${locale.id} 词条与英文源完全对齐`, sameKeys, { keys: keys.length, en: enKeys.length, empty: empty.slice(0, 3) });
  t(`${locale.id} 句式条数一致`, samePatterns, { patterns: (pack.patterns || []).length, en: enPatterns.length });
  t(`${locale.id} 无中文残留`, chinese.length === 0, chinese.slice(0, 3));
  if (locale.id === 'zh-TW') t('zh-TW 无简体字残留', simplified.length === 0, simplified.slice(0, 3));
  if (locale.id === 'ko-KR') t('ko-KR 使用韩文', noHangul.length === 0, noHangul.slice(0, 3));
  t(`${locale.id} 占位符数量与序号正确`, badPlaceholders.length === 0, badPlaceholders.slice(0, 3));
}
t('20 种目标语言包齐全', missing.length === 0, missing);

console.log('\n抽样翻译');
const sample = '接口名「demo」已存在';
const countText = '5 条 · 公开';
for (const locale of LOCALES) {
  if (locale.id === SOURCE || !fs.existsSync(path.join(root, 'app/i18n/locales', `${locale.id}.json`))) continue;
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'app/i18n/locales', `${locale.id}.json`), 'utf8'));
  const tr = translator(pack);
  const confirm = tr('确认');
  const err = tr(sample);
  const count = tr(countText);
  const isCJK = locale.id === 'ja-JP' || locale.id === 'zh-TW';
  t(`${locale.id} 确认 / 接口重名 / 数量句式已翻译`,
    confirm && confirm !== '确认' && err && err !== sample && /demo/.test(err) && count && count !== countText && (isCJK || (!HAN.test(err) && !HAN.test(count))),
    { confirm, err, count });
}

console.log('\n语言包内容覆盖');
t('补充界面词条都有英文', extra.dict.every((k) => en.dict[k] && !HAN.test(en.dict[k])), extra.dict.filter((k) => !en.dict[k] || HAN.test(en.dict[k])));
t('补充界面句式都有英文', extra.patterns.every((s) => { const p = en.patterns.find((x) => x.src === s); return p && p.dst && !HAN.test(p.dst); }));
t('英文覆盖 26 套模版名称与说明', templates.BUILTINS.length === 26 && templates.BUILTINS.every((x) => en.dict[x.name] && en.dict[x.description]));
t('英文覆盖内置模版中文标签', [...new Set(templates.BUILTINS.flatMap((x) => x.tags))].filter((x) => HAN.test(x) && !en.dict[x]).length === 0);
const builtinIfaces = library.list().filter((x) => String(x.id).startsWith('builtin:'));
t('英文覆盖 75 个内置接口名称与说明', builtinIfaces.length === 75 && builtinIfaces.every((x) => en.dict[x.name] && en.dict[x.description]));

console.log('\n安装器语言');
const meta = pkg.build && pkg.build.nsis ? pkg.build.nsis : {};
const expectedLanguages = LOCALES.filter((x) => x.nsis).map((x) => x.nsis).join(',');
const nsh = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8');
const generated = fs.readFileSync(path.join(root, 'build/installer-i18n.nsh'), 'utf8');
t('安装器语言覆盖 19 种 NSIS 语言', Array.isArray(meta.installerLanguages) && meta.installerLanguages.join(',') === expectedLanguages, meta.installerLanguages);
t('安装器开启多语言与语言选择', meta.multiLanguageInstaller === true && meta.displayLanguageSelector === true);
t('安装器包含生成的语言片段', /!include "installer-i18n\.nsh"/.test(nsh));
t('安装器调用首次语言映射', /!insertmacro SetInstallerLocale/.test(nsh) && /!insertmacro SetOptionalPageStrings/.test(nsh));
t('安装器不再硬编码双语', !/\$LANGUAGE == 2052/.test(nsh), nsh.match(/LANGUAGE/g));
t('可选组件页副标题只显示一次', !/MUI_HEADER_TEXT "\$OptTitle" "\$OptSubtitle"/.test(nsh));
const mappings = [...generated.matchAll(/StrCpy \$AppLocale "([^"]+)"/g)].map((m) => m[1]);
t('安装器 locale 映射覆盖 19 种', mappings.length === expectedLanguages.split(',').length && expectedLanguages.split(',').every((x) => mappings.includes(LOCALES.find((l) => l.nsis === x).id)), mappings);
t('安装器包含日文/阿拉伯文/繁体映射', mappings.includes('ja-JP') && mappings.includes('ar-SA') && mappings.includes('zh-TW'), mappings);
t('安装器未知语言不强制写入', /StrCpy \$AppLocale ""/.test(generated));
const licenseFiles = fs.readdirSync(path.join(root, 'build')).filter((x) => /^license_[A-Za-z_]+\.txt$/.test(x));
const missingLicenses = LOCALES.filter((x) => x.nsis && !licenseFiles.includes(`license_${x.nsis}.txt`)).map((x) => x.nsis);
t('安装器 19 种语言都有本地许可证正文', missingLicenses.length === 0, missingLicenses);

console.log('\n首次启动语言');
const dataRoot = path.join(tmp, 'click-build-server', 'clickbuild');
fs.mkdirSync(dataRoot, { recursive: true });
fs.writeFileSync(path.join(dataRoot, 'settings.json'), JSON.stringify({ language: 'zh-CN' }));
fs.writeFileSync(path.join(dataRoot, 'install-language.txt'), 'ja-JP');
const fakeApp = { getPreferredSystemLanguages: () => ['zh-CN'], getLocale: () => 'zh-CN' };
const fromJa = i18n.requestedLocale(fakeApp);
t('安装期语言优先于旧设置', fromJa === 'ja-JP', fromJa);
t('安装期语言落盘到 settings', JSON.parse(fs.readFileSync(path.join(dataRoot, 'settings.json'), 'utf8')).language === 'ja-JP');
t('安装期语言读取后删除标记', !fs.existsSync(path.join(dataRoot, 'install-language.txt')));
fs.writeFileSync(path.join(dataRoot, 'settings.json'), JSON.stringify({ language: 'zh-CN' }));
fs.writeFileSync(path.join(dataRoot, 'install-language.txt'), 'en-US');
t('旧安装器 en-US 遇到中文系统时回退系统语言', i18n.requestedLocale(fakeApp) === 'zh-CN', i18n.requestedLocale(fakeApp));
fs.writeFileSync(path.join(dataRoot, 'install-language.txt'), 'fr-FR');
const fakeDe = { getPreferredSystemLanguages: () => ['de-DE'], getLocale: () => 'de-DE' };
t('安装期法语优先于德语系统', i18n.requestedLocale(fakeDe) === 'fr-FR', i18n.requestedLocale(fakeDe));
t('版本号为语义化 x.y.z', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);

console.log(`\n结果：${ok} 通过，${bad} 失败`);
process.exit(bad ? 1 : 0);
