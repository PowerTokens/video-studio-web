/*
 * Tiny i18n core. Each language lives in its own file under js/lang/ and calls VSI18n.register().
 * English is the fallback for missing keys. Wording follows the desktop app's i18n.py where the feature is the same.
 */
(function (root) {
  'use strict';
  var STRINGS = {};
  var META = {
    zh: { name: '中文', htmlLang: 'zh-CN', match: ['zh'], script: 'lang/zh.js?v=20261126-quiet402' },
    en: { name: 'English', htmlLang: 'en', match: ['en'], script: 'lang/en.js?v=20261126-quiet402' },
    es: { name: 'Español', htmlLang: 'es', match: ['es'], script: 'lang/es.js?v=20261126-quiet402' },
    pt: { name: 'Português', htmlLang: 'pt', match: ['pt'], script: 'lang/pt.js?v=20261126-quiet402' },
    ja: { name: '日本語', htmlLang: 'ja', match: ['ja'], script: 'lang/ja.js?v=20261126-quiet402' },
    ko: { name: '한국어', htmlLang: 'ko', match: ['ko'], script: 'lang/ko.js?v=20261126-quiet402' }
  };
  var ORDER = Object.keys(META);
  var pending = {};
  // Capture while this regular script executes, before an injected pack becomes currentScript.
  var base = root.document && root.document.currentScript && root.document.currentScript.src;

  function known(code) { return Object.prototype.hasOwnProperty.call(META, code); }

  function load(code) {
    code = known(code) ? code : FALLBACK;
    if (STRINGS[code]) return Promise.resolve(code);
    if (pending[code]) return pending[code];
    pending[code] = new Promise(function (resolve, reject) {
      var script = root.document.createElement('script');
      script.src = base ? new URL(META[code].script, base).href : 'js/' + META[code].script;
      script.onload = function () {
        if (STRINGS[code]) resolve(code);
        else { delete pending[code]; reject(new Error('Language pack did not register: ' + code)); }
      };
      script.onerror = function () {
        delete pending[code];
        script.remove();
        reject(new Error('Language pack failed: ' + code));
      };
      root.document.head.appendChild(script);
    });
    return pending[code];
  }

  // A failed selected pack can still render English. If both fail, callers retain HTML defaults.
  function ensure(code) {
    return load(code).catch(function (error) {
      if (code === FALLBACK) throw error;
      return load(FALLBACK);
    });
  }
  var FALLBACK = 'en';

  function register(code, meta, strings) {
    if (!known(code)) return;
    STRINGS[code] = strings || {};
  }

  function fmt(str, args) {
    var i = 0;
    return String(str).replace(/%(%|s|d)/g, function (m, k) {
      if (k === '%') return '%';
      var v = args[i++];
      if (k === 'd') return String(Math.trunc(Number(v)));
      return String(v);
    });
  }

  /** Pick the first catalog language that matches the browser's language list; else English. */
  function detectLanguage(nav) {
    var langs = (nav && (nav.languages && nav.languages.length ? nav.languages : [nav.language])) || [];
    for (var i = 0; i < langs.length; i++) {
      var l = String(langs[i] || '').toLowerCase();
      for (var j = 0; j < ORDER.length; j++) {
        var match = (META[ORDER[j]].match || [ORDER[j]]);
        for (var k = 0; k < match.length; k++) {
          if (l === match[k].toLowerCase() || l.indexOf(match[k].toLowerCase() + '-') === 0) return ORDER[j];
        }
      }
    }
    return FALLBACK;
  }

  function t(lang, key) {
    var table = STRINGS[lang] || {};
    var fb = STRINGS[FALLBACK] || {};
    var s = table.hasOwnProperty(key) ? table[key] : (fb.hasOwnProperty(key) ? fb[key] : key);
    return arguments.length > 2 ? fmt(s, Array.prototype.slice.call(arguments, 2)) : s;
  }

  root.VSI18n = {
    register: register,
    known: known,
    load: ensure,
    languages: function () { return ORDER.slice(); },
    meta: function (code) { return META[code]; },
    has: function (code) { return STRINGS.hasOwnProperty(code); },
    STRINGS: STRINGS,
    fmt: fmt,
    detectLanguage: detectLanguage,
    t: t
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
