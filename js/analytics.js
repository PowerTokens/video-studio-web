/**
 * Minimal PostHog capture client for Video Studio web.
 *
 * Not the official posthog-js SDK: no autocapture, session replay, heatmaps, or
 * person-profile enrichment. Only allowlisted critical events are sent. Prompts,
 * keys, tokens, emails, assets, raw error text, OAuth codes, and URL query
 * strings are never accepted. Fail open; bounded queue; consent required.
 */
(function (root) {
  'use strict';

  var EVENTS = {
    app_open: true,
    login_success: true,
    generation_start: true,
    generation_success: true,
    generation_failed: true,
    video_download: true
  };

  var ALLOWED_PROPS = {
    platform: true, app_version: true, session_id: true, install_id: true,
    surface: true, model: true, duration_ms: true, error_code: true,
    generation_id: true, requested_duration_s: true, key_applied: true,
    account_linked: true
  };

  var FORBIDDEN = {
    prompt: true, key: true, api_key: true, token: true, access_token: true,
    refresh_token: true, authorization: true, authorization_code: true,
    code: true, oauth_code: true, verifier: true, code_verifier: true,
    email: true, name: true, display_name: true, avatar: true, picture: true,
    messages: true, error: true, error_detail: true, error_text: true,
    error_message: true, message: true, detail: true, exception: true,
    stack: true, traceback: true, url: true, href: true, search: true,
    query: true, current_url: true, $current_url: true, pathname: true,
    $pathname: true, referrer: true, $referrer: true, video_url: true,
    media: true, image: true, assets: true, credits: true, balance: true,
    password: true, secret: true, raw: true, userinfo: true, profile: true,
    sub: true, user_id: true, distinct_email: true
  };

  var SAFE_ERROR = {
    AUTH: true, QUOTA: true, NOT_ALLOWED: true, RATE_LIMIT: true, PARAM: true,
    NETWORK: true, DOWNLOAD: true, PAUSED: true, TIMEOUT: true, UNKNOWN: true,
    SERVER_FAILED: true, QUERY_DOWN: true, QUERY_AUTH: true, READY_NO_URL: true,
    UNCERTAIN: true, STOPPED: true, CANCELLED: true, VALIDATION: true,
    POOL_EXHAUSTED: true, REJECTED: true, STORAGE: true, RANGE_UNSUPPORTED: true,
    NO_RESUME: true, QUERY_FORBIDDEN: true
  };

  var ERROR_ALIAS = { CANCELED: 'CANCELLED', UNCERTAIN_RELOAD: 'UNCERTAIN' };
  var SAFE_SURFACES = { generate: true, compare: true, batch: true };
  var PLATFORM = 'web';
  var QUEUE_MAX = 50;
  var SESSION_IDLE_MS = 30 * 60 * 1000;
  var LIB_NAME = 'video-studio-web-analytics';
  var LIB_VERSION = '1.0.0';
  var APP_VERSION = 'web-1.15';
  var LS_STATE = 'vsw.analytics.state';
  var CONSENT_UNSET = 'unset';
  var CONSENT_GRANTED = 'granted';
  var CONSENT_DENIED = 'denied';

  function now() {
    return deps.now ? deps.now() : Date.now();
  }

  function storage() {
    return deps.storage || root.localStorage;
  }

  function safeGet(key) {
    try {
      var raw = storage().getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      storage().setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function uuid() {
    var buf, i;
    try {
      if (root.crypto && crypto.getRandomValues) {
        buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        var out = '';
        for (i = 0; i < buf.length; i++) out += (buf[i] + 256).toString(16).slice(1);
        return out;
      }
    } catch (e) { /* fall through */ }
    return 'x' + String(now()) + String(Math.random()).slice(2, 14);
  }

  function sha256Hex(text, done) {
    try {
      if (root.crypto && crypto.subtle && typeof TextEncoder === 'function') {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
          var bytes = new Uint8Array(buf);
          var hex = '';
          for (var i = 0; i < bytes.length; i++) hex += (bytes[i] + 256).toString(16).slice(1);
          done(hex.slice(0, 16));
        }, function () { done(''); });
      }
    } catch (e) { /* sync fallback */ }
    // Non-crypto fallback: still not the raw id, but weaker. Prefer subtle when present.
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    done(('00000000' + (h >>> 0).toString(16)).slice(-8) +
         ('00000000' + ((h ^ text.length) >>> 0).toString(16)).slice(-8));
    return Promise.resolve();
  }

  function opaqueAccountId(userId, cb) {
    var raw = String(userId || '').trim();
    if (!raw || raw.indexOf('@') >= 0 || /\s/.test(raw) || raw.length < 2) {
      cb(null);
      return;
    }
    sha256Hex('vs-analytics:' + raw, function (hex) {
      cb(hex ? 'ptu_' + hex : null);
    });
  }

  function normalizeErrorCode(code) {
    var text = String(code || '').trim().toUpperCase().replace(/[-\s]/g, '_');
    if (SAFE_ERROR[text]) return text;
    return ERROR_ALIAS[text] || 'UNKNOWN';
  }

  function sanitize(event, props) {
    if (!EVENTS[event]) return null;
    var clean = {};
    var src = props || {};
    var key, value, text;
    for (key in src) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      if (FORBIDDEN[key] || !ALLOWED_PROPS[key]) continue;
      value = src[key];
      if (key === 'error_code') value = normalizeErrorCode(value);
      else if (key === 'surface') {
        value = String(value || '').trim().toLowerCase();
        if (!SAFE_SURFACES[value]) continue;
      } else if (key === 'duration_ms') {
        value = parseInt(value, 10);
        if (!isFinite(value) || value < 0) continue;
        value = Math.floor(value);
      } else if (key === 'requested_duration_s') {
        value = parseInt(value, 10);
        if (!isFinite(value) || value < 0 || value > 3600) continue;
      } else if (key === 'key_applied' || key === 'account_linked') {
        value = !!value;
      } else if (key === 'model') {
        text = String(value || '').trim();
        if (!text || text.length > 80 || /\s/.test(text) || text.indexOf('@') >= 0) continue;
        value = text;
      } else if (key === 'generation_id' || key === 'session_id' || key === 'install_id' || key === 'app_version' || key === 'platform') {
        text = String(value || '').trim();
        if (!text || text.length > 80) continue;
        value = text;
      }
      clean[key] = value;
    }
    clean.platform = PLATFORM;
    return clean;
  }

  var deps = {};
  var state = { consent: CONSENT_UNSET, install_id: '', session_id: '', session_started_at: 0,
    last_activity: 0, app_open_session: '', queue: [], generation_seen: {},
    account_distinct_id: '', login_success_token: '' };
  var flushTimer = null;
  var booted = false;

  function loadState() {
    var saved = safeGet(LS_STATE);
    if (saved && typeof saved === 'object') {
      state.consent = saved.consent || CONSENT_UNSET;
      state.install_id = saved.install_id || '';
      state.session_id = saved.session_id || '';
      state.session_started_at = saved.session_started_at || 0;
      state.last_activity = saved.last_activity || 0;
      state.app_open_session = saved.app_open_session || '';
      state.queue = Array.isArray(saved.queue) ? saved.queue : [];
      state.generation_seen = saved.generation_seen || {};
      state.account_distinct_id = saved.account_distinct_id || '';
      state.login_success_token = saved.login_success_token || '';
    }
    if (!state.install_id) {
      state.install_id = uuid();
      persist();
    }
  }

  function persist() {
    if (state.queue && state.queue.length > QUEUE_MAX) {
      state.queue = state.queue.slice(-QUEUE_MAX);
    }
    var seenKeys = Object.keys(state.generation_seen || {});
    if (seenKeys.length > 200) {
      var keep = {};
      seenKeys.slice(-200).forEach(function (k) { keep[k] = state.generation_seen[k]; });
      state.generation_seen = keep;
    }
    safeSet(LS_STATE, state);
  }

  function config() {
    var cfg = root.VS_ANALYTICS_CONFIG || {};
    var key = String(root.VS_POSTHOG_PROJECT_KEY || cfg.posthogProjectKey || '').trim();
    var host = String(root.VS_POSTHOG_HOST || cfg.posthogHost || 'https://us.i.posthog.com').trim().replace(/\/$/, '');
    return { projectKey: key, host: host };
  }

  function hasDestination() {
    return !!(deps.transport || config().projectKey);
  }

  function consentState() {
    ensureLoaded();
    return state.consent === CONSENT_GRANTED || state.consent === CONSENT_DENIED ? state.consent : CONSENT_UNSET;
  }

  function isEnabled() {
    return consentState() === CONSENT_GRANTED;
  }

  function ensureSession() {
    var t = now();
    var idle = state.last_activity && (t - state.last_activity > SESSION_IDLE_MS);
    if (!state.session_id || idle) {
      state.session_id = uuid();
      state.session_started_at = t;
      state.app_open_session = '';
    }
    state.last_activity = t;
    persist();
    return state.session_id;
  }

  function acceptUnique(event, clean) {
    var gen, already, token;
    if (event === 'app_open') {
      if (state.app_open_session && state.app_open_session === state.session_id) return false;
      state.app_open_session = state.session_id;
      return true;
    }
    if (event === 'generation_start' || event === 'generation_success' || event === 'generation_failed') {
      gen = String(clean.generation_id || '').trim();
      if (!gen) return false;
      already = (state.generation_seen[gen] || []).slice();
      if (event === 'generation_start') {
        if (already.indexOf('start') >= 0) return false;
        already.push('start');
      } else {
        if (already.indexOf('terminal') >= 0) return false;
        already.push('terminal');
      }
      state.generation_seen[gen] = already;
      return true;
    }
    if (event === 'login_success') {
      token = (state.session_id || '') + ':' + (state.account_distinct_id || 'anon');
      if (state.login_success_token === token) return false;
      state.login_success_token = token;
      return true;
    }
    return true;
  }

  function enqueue(item) {
    state.queue = (state.queue || []).concat([item]);
    if (state.queue.length > QUEUE_MAX) state.queue = state.queue.slice(-QUEUE_MAX);
  }

  function track(event, props) {
    try {
      return trackInner(event, props);
    } catch (e) {
      return false;
    }
  }

  function ensureLoaded() {
    if (booted) return;
    loadState();
    booted = true;
  }

  function trackInner(event, props) {
    ensureLoaded();
    var clean = sanitize(event, props);
    if (!clean) return false;
    if (consentState() === CONSENT_DENIED) return false;
    var sessionId = ensureSession();
    if (!acceptUnique(event, clean)) return false;
    clean.session_id = sessionId;
    clean.install_id = state.install_id;
    clean.app_version = APP_VERSION;
    if (state.account_distinct_id) clean.account_linked = true;
    var item = {
      event: event,
      distinct_id: state.account_distinct_id || state.install_id,
      properties: clean,
      timestamp: new Date(now()).toISOString()
    };
    enqueue(item);
    persist();
    if (consentState() === CONSENT_GRANTED) scheduleFlush();
    return true;
  }

  function captureAppOpen() {
    return track('app_open', {});
  }

  function setConsent(granted) {
    ensureLoaded();
    state.consent = granted ? CONSENT_GRANTED : CONSENT_DENIED;
    if (!granted) {
      state.queue = [];
      state.account_distinct_id = '';
    }
    persist();
    if (granted) {
      ensureSession();
      captureAppOpen();
      scheduleFlush();
    }
  }

  function identifyAccount(userId, cb) {
    ensureLoaded();
    opaqueAccountId(userId, function (opaque) {
      state.account_distinct_id = opaque || '';
      persist();
      if (cb) cb(opaque || null);
    });
  }

  function clearAccount() {
    ensureLoaded();
    state.account_distinct_id = '';
    persist();
  }

  function notifyLoginSuccess(opts) {
    opts = opts || {};
    if (consentState() === CONSENT_DENIED) return false;
    function fire() {
      var props = {};
      if (typeof opts.keyApplied === 'boolean') props.key_applied = opts.keyApplied;
      return track('login_success', props);
    }
    if (opts.userId) {
      identifyAccount(opts.userId, function () { fire(); });
      return consentState() !== CONSENT_DENIED;
    }
    return fire();
  }

  function notifyGenerationStart(generationId, opts) {
    opts = opts || {};
    var props = { generation_id: generationId, surface: opts.surface || 'generate' };
    if (opts.model) props.model = opts.model;
    if (opts.requestedDurationS != null) props.requested_duration_s = opts.requestedDurationS;
    return track('generation_start', props);
  }

  function notifyGenerationFinish(generationId, ok, opts) {
    opts = opts || {};
    var props = { generation_id: generationId, surface: opts.surface || 'generate' };
    if (opts.model) props.model = opts.model;
    if (opts.durationMs != null) props.duration_ms = opts.durationMs;
    if (!ok) props.error_code = normalizeErrorCode(opts.errorCode);
    return track(ok ? 'generation_success' : 'generation_failed', props);
  }

  function notifyVideoDownload(opts) {
    opts = opts || {};
    var props = { surface: opts.surface || 'generate' };
    if (opts.model) props.model = opts.model;
    return track('video_download', props);
  }

  function pending() {
    return (state.queue || []).slice();
  }

  function scheduleFlush() {
    if (!isEnabled() || !hasDestination()) return;
    if (flushTimer) return;
    flushTimer = (deps.setTimeout || setTimeout)(function () {
      flushTimer = null;
      flush();
    }, 0);
  }

  function deliver(item, cb) {
    if (deps.transport) {
      try { deps.transport(item); cb(true); } catch (e) { cb(false); }
      return;
    }
    var cfg = config();
    if (!cfg.projectKey || !cfg.host) { cb(false); return; }
    var props = {};
    var k;
    for (k in item.properties) {
      if (Object.prototype.hasOwnProperty.call(item.properties, k)) props[k] = item.properties[k];
    }
    props.$lib = LIB_NAME;
    props.$lib_version = LIB_VERSION;
    props.$geoip_disable = true;
    props.$ip = null;
    props.$process_person_profile = false;
    var body = JSON.stringify({
      api_key: cfg.projectKey,
      event: item.event,
      distinct_id: item.distinct_id,
      properties: props,
      timestamp: item.timestamp
    });
    var url = cfg.host + '/i/v0/e/';
    try {
      if (typeof root.fetch !== 'function') { cb(false); return; }
      root.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        mode: 'cors'
      }).then(function (res) { cb(!!(res && res.ok)); }, function () { cb(false); });
    } catch (e) {
      cb(false);
    }
  }

  function flush() {
    if (!isEnabled() || !hasDestination()) return;
    function next() {
      if (!state.queue || !state.queue.length) return;
      var item = state.queue[0];
      deliver(item, function (ok) {
        if (!ok) return;
        if (state.queue[0] === item) state.queue.shift();
        else {
          var idx = state.queue.indexOf(item);
          if (idx >= 0) state.queue.splice(idx, 1);
        }
        persist();
        next();
      });
    }
    next();
  }

  function boot(options) {
    deps = options || {};
    if (deps.appVersion) APP_VERSION = String(deps.appVersion);
    if (!booted) loadState();
    booted = true;
    ensureSession();
    captureAppOpen();
    return api;
  }

  function touchActivity() {
    if (!booted) return;
    // Update last_activity only. Never starts a new app_open on tab resume.
    if (state.session_id) {
      state.last_activity = now();
      persist();
    }
  }

  var api = {
    EVENTS: EVENTS,
    ALLOWED_PROPS: ALLOWED_PROPS,
    FORBIDDEN: FORBIDDEN,
    CONSENT_UNSET: CONSENT_UNSET,
    CONSENT_GRANTED: CONSENT_GRANTED,
    CONSENT_DENIED: CONSENT_DENIED,
    SESSION_IDLE_MS: SESSION_IDLE_MS,
    QUEUE_MAX: QUEUE_MAX,
    sanitize: sanitize,
    normalizeErrorCode: normalizeErrorCode,
    opaqueAccountId: opaqueAccountId,
    boot: boot,
    track: track,
    captureAppOpen: captureAppOpen,
    setConsent: setConsent,
    consentState: consentState,
    isEnabled: isEnabled,
    identifyAccount: identifyAccount,
    clearAccount: clearAccount,
    notifyLoginSuccess: notifyLoginSuccess,
    notifyGenerationStart: notifyGenerationStart,
    notifyGenerationFinish: notifyGenerationFinish,
    notifyVideoDownload: notifyVideoDownload,
    pending: pending,
    flush: flush,
    ensureSession: ensureSession,
    touchActivity: touchActivity,
    resetForTests: function (options) {
      state = { consent: CONSENT_UNSET, install_id: '', session_id: '', session_started_at: 0,
        last_activity: 0, app_open_session: '', queue: [], generation_seen: {},
        account_distinct_id: '', login_success_token: '' };
      booted = false;
      deps = {};
      try { storage().removeItem(LS_STATE); } catch (e) { /* ignore */ }
      if (options) boot(options);
    }
  };

  root.VSAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
