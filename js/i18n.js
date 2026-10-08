/*
 * Tiny i18n core. Each language lives in its own file under js/lang/ and calls VSI18n.register().
 * English is the fallback for missing keys. Wording follows the desktop app's i18n.py where the feature is the same.
 */
(function (root) {
  'use strict';
  var STRINGS = {};
  var META = {};
  var ORDER = [];
  var FALLBACK = 'en';

  function register(code, meta, strings) {
    if (!STRINGS[code]) ORDER.push(code);
    META[code] = meta || { name: code, htmlLang: code, match: [code] };
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

  /** Pick the first registered language that matches the browser's language list; else English. */
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
    return STRINGS[FALLBACK] ? FALLBACK : ORDER[0];
  }

  function t(lang, key) {
    var table = STRINGS[lang] || {};
    var fb = STRINGS[FALLBACK] || {};
    var s = table.hasOwnProperty(key) ? table[key] : (fb.hasOwnProperty(key) ? fb[key] : key);
    return arguments.length > 2 ? fmt(s, Array.prototype.slice.call(arguments, 2)) : s;
  }

  root.VSI18n = {
    register: register,
    languages: function () { return ORDER.slice(); },
    meta: function (code) { return META[code]; },
    has: function (code) { return STRINGS.hasOwnProperty(code); },
    STRINGS: STRINGS,
    fmt: fmt,
    detectLanguage: detectLanguage,
    t: t
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
