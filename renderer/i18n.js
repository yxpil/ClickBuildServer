'use strict';

(() => {
  let state = {
    locale: 'zh-CN',
    source: 'zh-CN',
    dir: 'ltr',
    locales: [],
    system: 'zh-CN',
    dict: {},
    patterns: [],
  };
  try {
    if (window.icb && window.icb.i18nSync) state = window.icb.i18nSync() || state;
  } catch (e) { /* 主进程还没准备好时保持中文 */ }

  const dict = state.dict || {};
  const rawPatterns = state.patterns || [];
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
  const patterns = rawPatterns.map((p) => ({ re: compile(p.src), dst: String(p.dst || '') })).filter((p) => p.dst);

  function fill(template, values) {
    return String(template).replace(/\$(\d+)/g, (all, n) => {
      const value = values[Number(n)];
      if (value == null) return '';
      return Object.prototype.hasOwnProperty.call(dict, value) ? dict[value] : value;
    });
  }

  function translate(value) {
    const text = String(value == null ? '' : value);
    if (!text || state.locale === state.source) return text;
    if (Object.prototype.hasOwnProperty.call(dict, text)) return dict[text];
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (m) return fill(p.dst, m);
    }
    return text;
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE', 'TEMPLATE']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

  function ignored(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body) {
      if (SKIP.has(el.tagName) || el.getAttribute('translate') === 'no' || el.hasAttribute('data-i18n-ignore')) return true;
      el = el.parentElement;
    }
    return false;
  }

  function translateTextNode(node) {
    if (!node.nodeValue || ignored(node)) return;
    const raw = node.nodeValue;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    if (!m) return;
    const next = translate(m[2]);
    if (next !== m[2]) node.nodeValue = m[1] + next + m[3];
  }

  function translateElement(el) {
    if (!el || el.nodeType !== 1) return;
    for (const name of ATTRS) {
      if (!el.hasAttribute(name)) continue;
      const raw = el.getAttribute(name);
      const next = translate(raw);
      if (next !== raw) el.setAttribute(name, next);
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) {
      const raw = el.value;
      const next = translate(raw);
      if (next !== raw) el.value = next;
    }
    if (ignored(el)) return;
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (child.nodeType === 3) translateTextNode(child);
      else if (child.nodeType === 1) translateElement(child);
    }
  }

  function apply(root) {
    const doc = root || document;
    const dir = state.dir || 'ltr';
    if (doc === document) {
      document.documentElement.lang = state.locale;
      document.documentElement.dir = dir;
      if (document.title) document.title = translate(document.title);
    }
    if (doc.body) translateElement(doc.body);
  }

  function schedule(node) {
    if (!node) return;
    queueMicrotask(() => {
      if (node.nodeType === 3) translateTextNode(node);
      else if (node.nodeType === 1) translateElement(node);
    });
  }

  let observer = null;
  function watch() {
    if (observer || state.locale === state.source || !document.body) return;
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') schedule(r.target);
        else if (r.type === 'attributes') {
          const el = r.target;
          if (ATTRS.includes(r.attributeName)) schedule(el);
        } else {
          for (const n of r.addedNodes) schedule(n);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  async function setLocale(next) {
    if (!next || next === state.locale) return true;
    if (!window.icb || !window.icb.setLocale) throw new Error('语言切换接口不可用');
    await window.icb.setLocale(next);
    location.reload();
    return true;
  }

  function currentLocale() {
    return (state.locales || []).find((x) => x.id === state.locale) || null;
  }

  window.__i18n = {
    get locale() { return state.locale; },
    get source() { return state.source; },
    get dir() { return state.dir || 'ltr'; },
    get locales() { return state.locales || []; },
    get current() { return currentLocale(); },
    get dict() { return dict; },
    get patterns() { return rawPatterns; },
    translate,
    apply,
    setLocale,
    refresh() {
      state = (window.icb && window.icb.i18nSync && window.icb.i18nSync()) || state;
      apply(document);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { apply(document); watch(); });
  } else {
    apply(document);
    watch();
  }
  window.addEventListener('load', () => apply(document));
})();
