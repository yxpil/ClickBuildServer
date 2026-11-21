'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../store');
const { SOURCE, LOCALES } = require('./catalog');

const ROOT = path.join(__dirname, 'locales');

function normalize(value) {
  const raw = String(value || '').trim().replace(/_/g, '-');
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const exact = LOCALES.find((x) => x.id.toLowerCase() === lower);
  if (exact) return exact.id;
  const lang = lower.split('-')[0];
  if (lang === 'zh') return /hant|tw|hk|mo/.test(lower) ? 'zh-TW' : 'zh-CN';
  if (lang === 'en') return 'en-US';
  if (lang === 'pt') return 'pt-BR';
  const hit = LOCALES.find((x) => x.id.toLowerCase().split('-')[0] === lang);
  return hit ? hit.id : '';
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

function installLocale(app) {
  const file = path.join(store.root(), 'install-language.txt');
  if (!fs.existsSync(file)) return '';
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    const id = normalize(raw);
    let supported = !!id && LOCALES.some((x) => x.id === id);
    // 旧安装器会把非中文系统一律写成 en-US；如果机器明显是其他语言，首次启动以系统语言为准。
    if (supported && id === 'en-US') {
      const sys = systemLocale(app);
      if (sys && sys !== 'en-US') supported = false;
    }
    try { fs.unlinkSync(file); } catch (e) { /* 下次启动再清理 */ }
    if (!supported) return '';
    store.writeSettings({ language: id });
    return id;
  } catch (e) {
    try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
    return '';
  }
}

function requestedLocale(app) {
  const fromInstaller = installLocale(app);
  if (fromInstaller) return fromInstaller;
  const saved = normalize(store.readSettings().language);
  return saved || systemLocale(app);
}

function readPack(locale) {
  const id = normalize(locale) || 'en-US';
  const empty = { locale: id, source: SOURCE, dir: (LOCALES.find((x) => x.id === id) || {}).dir || 'ltr', dict: {}, patterns: [] };
  if (id === SOURCE) return empty;
  const file = path.join(ROOT, `${id}.json`);
  if (!fs.existsSync(file)) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      locale: id,
      source: SOURCE,
      dir: (LOCALES.find((x) => x.id === id) || {}).dir || 'ltr',
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
  if (!id || !LOCALES.some((x) => x.id === id)) throw new Error(`不支持的语言：${locale}`);
  store.writeSettings({ language: id });
  return current(app);
}

function localeList() {
  return LOCALES.slice();
}

module.exports = { SOURCE, LOCALES, normalize, systemLocale, requestedLocale, current, setLocale, localeList };
