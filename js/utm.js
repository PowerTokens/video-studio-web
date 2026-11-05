/*
 * Shared UTM attribution for Video Studio Web.
 * Backend reports use UTM only. Persist first/last touch.
 * Signup, OAuth authorize, the footer site, and billing / chat_billing force
 * product utm_source/medium/campaign (videostudio / web / video-studio) so an
 * ad last-touch cannot override when the user leaves VS web. Click ids still
 * forward. The download jump keeps last-touch in storage and does not put
 * UTM on the GitHub EXE URL.
 * Keys: localStorage vsw.utm.first / vsw.utm.last (JSON objects).
 */
(function (root) {
  'use strict';

  var FIRST_KEY = 'vsw.utm.first';
  var LAST_KEY = 'vsw.utm.last';
  var TRACK_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'dclid', 'ttclid', 'twclid',
    'li_fat_id', 'yclid', 'epik', 'rdt_cid'
  ];
  var DEFAULTS = {
    utm_source: 'videostudio',
    utm_medium: 'web',
    utm_campaign: 'video-studio'
  };
  var CONTENT = {
    oauth: 'web.oauth_authorize',
    billing: 'web.billing',
    signup: 'web.signup',
    site: 'web.footer_site',
    chat_billing: 'web.chat_billing',
    download: 'web.download_jump'
  };
  // Product exits. download is omitted on purpose (EXE URL stays raw).
  var FORCE_PRODUCT_CONTENT = {};
  ['oauth', 'signup', 'site', 'billing', 'chat_billing'].forEach(function (k) {
    FORCE_PRODUCT_CONTENT[CONTENT[k]] = 1;
  });

  function readJson(key) {
    try {
      var raw = root.localStorage.getItem(key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function writeJson(key, obj) {
    try {
      root.localStorage.setItem(key, JSON.stringify(obj || {}));
      return true;
    } catch (e) {
      return false;
    }
  }

  function pickTrack(src) {
    var out = {};
    if (!src) return out;
    TRACK_KEYS.forEach(function (k) {
      var v = null;
      if (typeof src.get === 'function') v = src.get(k);
      else if (Object.prototype.hasOwnProperty.call(src, k)) v = src[k];
      if (v != null && String(v) !== '') out[k] = String(v);
    });
    return out;
  }

  function hasAny(obj) {
    return !!(obj && Object.keys(obj).length);
  }

  function mergeDefaults(params) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = DEFAULTS[k]; });
    if (params) {
      Object.keys(params).forEach(function (k) {
        if (params[k] != null && params[k] !== '') out[k] = String(params[k]);
      });
    }
    return out;
  }

  function captureFromSearch(search) {
    var inbound;
    try {
      inbound = pickTrack(new URLSearchParams(search == null ? (root.location && root.location.search) || '' : search));
    } catch (e) {
      inbound = {};
    }
    if (!hasAny(inbound)) {
      // Organic: ensure first exists so reports are not empty.
      if (!readJson(FIRST_KEY)) writeJson(FIRST_KEY, mergeDefaults({}));
      if (!readJson(LAST_KEY)) writeJson(LAST_KEY, mergeDefaults({}));
      return readJson(LAST_KEY) || mergeDefaults({});
    }
    var first = readJson(FIRST_KEY);
    if (!hasAny(first)) writeJson(FIRST_KEY, mergeDefaults(inbound));
    writeJson(LAST_KEY, mergeDefaults(inbound));
    return readJson(LAST_KEY) || mergeDefaults(inbound);
  }

  function firstTouch() {
    return mergeDefaults(readJson(FIRST_KEY) || {});
  }

  function lastTouch() {
    return mergeDefaults(readJson(LAST_KEY) || {});
  }

  /**
   * Params for outbound / OAuth. Always includes core UTM (defaults fill gaps).
   * content: touchpoint string, e.g. web.oauth_authorize — always set when provided.
   * opts.forceProduct: keep click ids (and utm_term) from last-touch but force
   *   utm_source/medium/campaign to product defaults.
   * Signup, OAuth, footer site, and billing contents force even without the flag.
   */
  function shouldForceProduct(content, opts) {
    if (opts && opts.forceProduct) return true;
    return !!(content && FORCE_PRODUCT_CONTENT[String(content)]);
  }

  function paramsFor(content, opts) {
    opts = opts || {};
    var p = lastTouch();
    if (shouldForceProduct(content, opts)) {
      p.utm_source = DEFAULTS.utm_source;
      p.utm_medium = DEFAULTS.utm_medium;
      p.utm_campaign = DEFAULTS.utm_campaign;
    }
    if (content) p.utm_content = String(content);
    return p;
  }

  function applyToSearchParams(sp, opts) {
    opts = opts || {};
    var p = paramsFor(opts.content, opts);
    Object.keys(p).forEach(function (k) {
      if (p[k] != null && p[k] !== '') sp.set(k, p[k]);
    });
    return sp;
  }

  function buildOutbound(base, content, opts) {
    var url;
    try { url = new URL(String(base || ''), root.location ? root.location.href : undefined); }
    catch (e) { return base; }
    TRACK_KEYS.forEach(function (k) { url.searchParams.delete(k); });
    applyToSearchParams(url.searchParams, Object.assign({ content: content }, opts || {}));
    return url.toString();
  }

  // Capture landing params immediately on load.
  try { captureFromSearch(); } catch (eBoot) { /* ignore */ }

  root.VSUtm = {
    TRACK_KEYS: TRACK_KEYS,
    DEFAULTS: DEFAULTS,
    CONTENT: CONTENT,
    FORCE_PRODUCT_CONTENT: FORCE_PRODUCT_CONTENT,
    captureFromSearch: captureFromSearch,
    firstTouch: firstTouch,
    lastTouch: lastTouch,
    paramsFor: paramsFor,
    applyToSearchParams: applyToSearchParams,
    buildOutbound: buildOutbound,
    FIRST_KEY: FIRST_KEY,
    LAST_KEY: LAST_KEY
  };
})(window);
