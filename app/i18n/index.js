'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../store');

const ROOT = path.join(__dirname, 'locales');
const SOURCE = 'zh-CN';
const LOCALES = [
  { id: 'zh-CN', label: '简体中文', short: '中' },
  { id: 'en-US', label: 'English', short: 'EN' },
];

function normalize(value) {
  const raw = String(value || '').trim().replace('_', '-');
  if (!raw) return '';
  if (/^zh(?:-|$)/i.test(raw)) return 'zh-CN';
  if (/^en(?:-|$)/i.test(raw)) return 'en-US';
  if (/^zh/i.test(raw)) return 'zh-CN';
  if (/^en/i.test(raw)) return 'en-US';
  return '';
}

function systemLocale(app) {
  try {
    const preferred = app.getPreferredSystemLanguages ? app.getPreferredSystemLanguages() : [];
    for (const item of preferred || []) {
      const hit = normalize(item);
      if (hit) return hit;
    }
  } catch (e) { /* older Electron */ }
  return normalize(app.getLocale && app.getLocale()) || 'en-US';
}

function installLocale() {
  const file = path.join(store.root(), 'install-language.txt');
  if (!fs.existsSync(file)) return '';
  try {
    const id = normalize(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim());
    if (!id || !LOCALES.some((x) => x.id === id)) return '';
    store.writeSettings({ language: id });
    try { fs.unlinkSync(file); } catch (e) { /* 下次启动再清理 */ }
    return id;
  } catch (e) {
    return '';
  }
}

function requestedLocale(app) {
  const fromInstaller = installLocale();
  if (fromInstaller) return fromInstaller;
  const saved = normalize(store.readSettings().language);
  return saved || systemLocale(app);
}

function readPack(locale) {
  const id = normalize(locale) || 'en-US';
  const file = path.join(ROOT, `${id}.json`);
  const empty = { locale: id, source: SOURCE, dict: {}, patterns: [] };
  if (id === SOURCE) return empty;
  if (!fs.existsSync(file)) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      locale: id,
      source: SOURCE,
      dict: raw.dict && typeof raw.dict === 'object' ? raw.dict : {},
      patterns: Array.isArray(raw.patterns) ? raw.patterns : [],
    };
  } catch (e) {
    return empty;
  }
}

function current(app) {
  const locale = requestedLocale(app);
  return {
    locale,
    source: SOURCE,
    locales: LOCALES,
    system: systemLocale(app),
    ...readPack(locale),
  };
}

function setLocale(app, locale) {
  const id = normalize(locale);
  if (!LOCALES.some((x) => x.id === id)) throw new Error(`不支持的语言：${locale}`);
  store.writeSettings({ language: id });
  return current(app);
}

function localeList() {
  return LOCALES.slice();
}

module.exports = { SOURCE, LOCALES, normalize, systemLocale, requestedLocale, current, setLocale, localeList };
