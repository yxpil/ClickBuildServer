// 作者：yxpil
'use strict';

// 从已生成的语言包生成 NSIS 安装器语言片段：
//   build/installer-i18n.nsh
// 用法：node tools/build-installer-i18n.js
//
// 生成内容：
// 1. SetInstallerLocale：把 NSIS $LANGUAGE 映射成应用 locale，写入首次启动语言。
// 2. SetOptionalPageStrings：可选组件页的中文/多语文案，全部来自 Index-Translate 语言包。

const fs = require('fs');
const path = require('path');
const { LOCALES } = require('../app/i18n/catalog');

const ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'app/i18n/locales');
const OUT = path.join(ROOT, 'build/installer-i18n.nsh');
const EN = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'en-US.json'), 'utf8'));

const PAGE_KEYS = [
  ['OptTitle', '可选组件'],
  ['OptSubtitle', '选择需要安装的附加内容；生产环境可以全部取消。'],
  ['OptDocsLabel', '安装使用文档（README 与执行文档）'],
  ['OptSamplesLabel', '安装示例工程（商城工程）'],
  ['OptNote', '程序本体、便携运行时和内置服务始终安装。'],
];

function nsis(value) {
  const s = String(value == null ? '' : value);
  return '"' + s.replace(/\$/g, '$$').replace(/"/g, '$\\"').replace(/\r?\n/g, '$\\r$\\n') + '"';
}

function packFor(locale) {
  if (locale.id === 'zh-CN') return { dict: {} };
  const file = path.join(PACK_DIR, `${locale.id}.json`);
  if (!fs.existsSync(file)) return { dict: {} };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { dict: {} }; }
}

function pageValue(locale, key) {
  const pack = packFor(locale);
  if (locale.id === 'zh-CN') return key;
  const value = pack.dict && pack.dict[key];
  // 繁体中文和日文本来就用汉字；只有其他语言出现汉字才视为残留中文。
  const hanAllowed = locale.id === 'zh-TW' || locale.id === 'ja-JP';
  const han = /[\u3400-\u9fff]/.test(value || '');
  if (value && (hanAllowed || !han)) return value;
  return EN.dict[key] || key;
}

const withInstaller = LOCALES.filter((x) => x.nsis && x.lcid);

const pageLines = [];
withInstaller.forEach((locale, index) => {
  const head = index === 0 ? '${If}' : '${ElseIf}';
  pageLines.push(`  ${head} $LANGUAGE == ${locale.lcid}`);
  PAGE_KEYS.forEach(([varName, key]) => {
    pageLines.push(`    StrCpy $${varName} ${nsis(pageValue(locale, key))}`);
  });
});
pageLines.push('  ${Else}');
PAGE_KEYS.forEach(([varName, key]) => {
  pageLines.push(`    StrCpy $${varName} ${nsis(EN.dict[key] || key)}`);
});
pageLines.push('  ${EndIf}');

const localeLines = [];
withInstaller.forEach((locale, index) => {
  const head = index === 0 ? '${If}' : '${ElseIf}';
  localeLines.push(`  ${head} $LANGUAGE == ${locale.lcid}`);
  localeLines.push(`    StrCpy $AppLocale ${nsis(locale.id)}`);
});
localeLines.push('  ${Else}');
localeLines.push('    StrCpy $AppLocale ""');
localeLines.push('  ${EndIf}');

const text = `; 由 tools/build-installer-i18n.js 自动生成，请勿手改。
; 语言包与语言清单来自 app/i18n/catalog.js + app/i18n/locales/*.json。

!macro SetOptionalPageStrings
${pageLines.join('\n')}
!macroend

!macro SetInstallerLocale
${localeLines.join('\n')}
!macroend
`;

fs.writeFileSync(OUT, text, 'utf8');
console.log(`写入 ${OUT}: ${withInstaller.length} 种安装器语言，${PAGE_KEYS.length} 条可选组件文案`);
