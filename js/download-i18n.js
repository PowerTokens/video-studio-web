/**
 * Download-page language: reuse VSI18n, read/write the same vsw.lang
 * (or vsw.mock.lang when ?mock=1) preference as the main app, without loading api.js.
 */
(function () {
  'use strict';

  var I = window.VSI18n;
  var LANG_KEY = 'lang';
  var MOCK = /[?&]mock=1(?:&|$)/.test(window.location ? window.location.search : '');
  var PREFIX = MOCK ? 'vsw.mock.' : 'vsw.';
  var lang = 'en';

  function ready() {
    var body = document.body;
    if (body && body.classList) body.classList.add('is-ready');
    else if (body) body.className += (body.className ? ' ' : '') + 'is-ready';
  }

  function t(key) {
    return I.t.apply(I, [lang, key].concat(Array.prototype.slice.call(arguments, 1)));
  }

  function readSavedLang() {
    try {
      var raw = window.localStorage.getItem(PREFIX + LANG_KEY);
      if (raw == null) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeSavedLang(code) {
    try {
      window.localStorage.setItem(PREFIX + LANG_KEY, JSON.stringify(code));
    } catch (e) { /* ignore */ }
  }

  function apply() {
    var meta = I.meta(lang) || {};
    document.documentElement.lang = meta.htmlLang || lang;
    document.title = t('dl_page_title');
    document.querySelectorAll('[data-i18n]').forEach(function (n) {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (n) {
      n.innerHTML = t(n.getAttribute('data-i18n-html'));
    });
    var sel = document.getElementById('lang-select');
    if (sel) {
      sel.setAttribute('aria-label', t('dl_lang_label'));
      if (sel.value !== lang) sel.value = lang;
    }
  }

  function setLang(code, persist) {
    var prev = lang;
    lang = I.has(code) ? code : 'en';
    if (persist) writeSavedLang(lang);
    if (persist && lang && lang !== prev) {
      try {
        if (window.VSAnalytics && window.VSAnalytics.notifyLanguageSet) {
          window.VSAnalytics.notifyLanguageSet(lang);
        }
      } catch (e) { /* ignore */ }
    }
    apply();
  }

  function buildSwitcher() {
    var sel = document.getElementById('lang-select');
    if (!sel) return;
    var codes = I.languages();
    sel.innerHTML = '';
    codes.forEach(function (code) {
      var meta = I.meta(code) || {};
      var o = document.createElement('option');
      o.value = code;
      o.textContent = meta.name || code;
      sel.appendChild(o);
    });
    sel.value = lang;
    sel.setAttribute('aria-label', t('dl_lang_label'));
    if (sel._vswLangBound) return;
    sel._vswLangBound = true;
    var queued = null;
    function queueLang() {
      var code = sel.value;
      if (!I.has(code)) return;
      if (queued && queued.code !== code && code === lang) return;
      if (!queued && code === lang) return;
      if (queued) clearTimeout(queued.timer);
      var timer = setTimeout(function () {
        queued = null;
        setLang(code, true);
        if (sel.value !== lang) sel.value = lang;
      }, 0);
      queued = { code: code, timer: timer };
    }
    sel.addEventListener('change', queueLang);
    sel.addEventListener('input', queueLang);
  }

  try {
    if (!I) return;
    var saved = readSavedLang();
    lang = saved && I.has(saved) ? saved : I.detectLanguage(window.navigator || navigator);
    buildSwitcher();
    setLang(lang, false);
  } finally {
    ready();
  }
})();
