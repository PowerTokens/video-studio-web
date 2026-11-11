/**
 * Minimal PostHog capture client for Video Studio web.
 *
 * Not the official posthog-js SDK: no autocapture, session replay, heatmaps, or
 * person-profile enrichment. Only allowlisted critical events are sent. Prompts,
 * keys, tokens, emails, assets, raw error text, OAuth codes, and URL query
 * strings are never accepted. Fail open; bounded queue only after opt-in when
 * a destination exists. No identifiers are stored before consent. This MVP
 * uses a random install UUID as distinct_id and does not link accounts.
 * The ingest host may still see the client IP; $geoip_disable and
 * $process_person_profile=false are set, and we do not claim IP anonymity.
 */
(function (root) {
  'use strict';

  var EVENTS = {
    app_open: true,
    login_success: true,
    generation_start: true,
    generation_success: true,
    generation_failed: true,
    video_download: true,
    chat_submit: true,
    chat_success: true,
    chat_failed: true,
    pwa_standalone_launch: true
  };

  var ALLOWED_PROPS = {
    platform: true, app_version: true, session_id: true, install_id: true,
    surface: true, model: true, duration_ms: true, error_code: true,
    generation_id: true, requested_duration_s: true, key_applied: true,
    environment: true, test_run_id: true, chat_id: true
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
  var SAFE_SURFACES = { generate: true, compare: true, batch: true, chat: true };
  var MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  var ALLOWED_INGEST_HOSTS = {
    'https://us.i.posthog.com': true,
    'https://eu.i.posthog.com': true
  };
  var FINAL_FAILURE = {
    AUTH: true, QUOTA: true, NOT_ALLOWED: true, PARAM: true, VALIDATION: true,
    REJECTED: true, POOL_EXHAUSTED: true, SERVER_FAILED: true, FAILED: true,
    CANCELLED: true, STORAGE: true, UNCERTAIN: true, UNKNOWN: true
  };
  var PLATFORM = 'web';
  var QUEUE_MAX = 50;
  var SESSION_IDLE_MS = 30 * 60 * 1000;
  var LIB_NAME = 'video-studio-web-analytics';
  var LIB_VERSION = '1.0.0';
  var APP_VERSION = 'web-1.17';
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


  function opaqueAccountId(userId, cb) {
    // MVP: no account linkage. Do not hash user ids.
    if (cb) cb(null);
  }


  function normalizeErrorCode(code) {
    var text = String(code || '').trim().toUpperCase().replace(/[-\s]/g, '_');
    if (SAFE_ERROR[text]) return text;
    return ERROR_ALIAS[text] || 'UNKNOWN';
  }


  var SAFE_ENVIRONMENTS = { synthetic: true, test: true, production: true };
  var TEST_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  var PROJECT_KEY_RE = /^phc_[A-Za-z0-9_-]{4,}$/;

  function sanitizeEnvironment(value) {
    var text = String(value || '').trim().toLowerCase();
    return SAFE_ENVIRONMENTS[text] ? text : null;
  }

  function sanitizeTestRunId(value) {
    var text = String(value || '').trim();
    return text && TEST_RUN_ID_RE.test(text) ? text : null;
  }

  function publicProjectKey(raw) {
    var key = String(raw || '').trim();
    return PROJECT_KEY_RE.test(key) ? key : '';
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
      } else if (key === 'key_applied') {
        value = !!value;
      } else if (key === 'environment') {
        value = sanitizeEnvironment(value);
        if (!value) continue;
      } else if (key === 'test_run_id') {
        value = sanitizeTestRunId(value);
        if (!value) continue;
      } else if (key === 'model') {
        text = String(value || '').trim();
        if (!MODEL_ID_RE.test(text) || text.indexOf('@') >= 0) continue;
        value = text;
      } else if (key === 'generation_id' || key === 'chat_id' || key === 'session_id' || key === 'install_id' || key === 'app_version' || key === 'platform') {
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
    account_distinct_id: '', login_success_token: '', chat_seen: {}, pwa_standalone_session: '' };
  var flushTimer = null;
  var flushing = false;
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
      state.account_distinct_id = '';
      state.login_success_token = saved.login_success_token || '';
      state.chat_seen = saved.chat_seen || {};
      state.pwa_standalone_session = saved.pwa_standalone_session || '';
    }
    if (state.consent !== CONSENT_GRANTED) {
      state.queue = [];
      if (state.consent !== CONSENT_DENIED) {
        state.install_id = '';
        state.session_id = '';
        state.app_open_session = '';
        state.login_success_token = '';
      }
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
    var chatKeys = Object.keys(state.chat_seen || {});
    if (chatKeys.length > 200) {
      var keepChat = {};
      chatKeys.slice(-200).forEach(function (k) { keepChat[k] = state.chat_seen[k]; });
      state.chat_seen = keepChat;
    }
    safeSet(LS_STATE, state);
  }

  function config() {
    var cfg = root.VS_ANALYTICS_CONFIG || {};
    var key = publicProjectKey(root.VS_POSTHOG_PROJECT_KEY || cfg.posthogProjectKey || '');
    var host = String(root.VS_POSTHOG_HOST || cfg.posthogHost || 'https://us.i.posthog.com').trim().replace(/\/$/, '');
    if (host && !ALLOWED_INGEST_HOSTS[host]) host = '';
    if (!host) host = 'https://us.i.posthog.com';
    return {
      projectKey: key,
      host: host,
      environment: sanitizeEnvironment(root.VS_ANALYTICS_ENVIRONMENT || cfg.environment) || 'production',
      testRunId: sanitizeTestRunId(root.VS_ANALYTICS_TEST_RUN_ID || cfg.testRunId) || ''
    };
  }

  function hasDestination() {
    if (deps.transport) return true;
    var cfg = config();
    return !!(cfg.projectKey && ALLOWED_INGEST_HOSTS[cfg.host]);
  }

  function consentState() {
    ensureLoaded();
    return state.consent === CONSENT_GRANTED || state.consent === CONSENT_DENIED ? state.consent : CONSENT_UNSET;
  }

  function isEnabled() {
    return consentState() === CONSENT_GRANTED;
  }

  function ensureSession() {
    if (consentState() !== CONSENT_GRANTED) return '';
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
    if (event === 'pwa_standalone_launch') {
      if (state.pwa_standalone_session && state.pwa_standalone_session === state.session_id) return false;
      state.pwa_standalone_session = state.session_id;
      return true;
    }
    if (event === 'chat_submit' || event === 'chat_success' || event === 'chat_failed') {
      gen = String(clean.chat_id || '').trim();
      if (!gen) return false;
      already = (state.chat_seen[gen] || []).slice();
      if (event === 'chat_submit') {
        if (already.indexOf('submit') >= 0) return false;
        already.push('submit');
      } else {
        if (already.indexOf('terminal') >= 0) return false;
        already.push('terminal');
      }
      state.chat_seen[gen] = already;
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
      token = state.session_id || '';
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
    if (consentState() !== CONSENT_GRANTED) return false;
    var sessionId = ensureSession();
    if (!state.install_id) {
      state.install_id = uuid();
      persist();
    }
    if (!sessionId || !state.install_id) return false;
    if (!acceptUnique(event, clean)) return false;
    clean.session_id = sessionId;
    clean.install_id = state.install_id;
    clean.app_version = APP_VERSION;
    var cfgNow = config();
    var envName = sanitizeEnvironment(clean.environment || cfgNow.environment);
    if (envName) clean.environment = envName;
    var runId = sanitizeTestRunId(clean.test_run_id || cfgNow.testRunId);
    if (runId) clean.test_run_id = runId;
    var item = {
      event: event,
      distinct_id: state.install_id,
      properties: clean,
      timestamp: new Date(now()).toISOString()
    };
    if (!hasDestination()) return true;
    enqueue(item);
    persist();
    scheduleFlush();
    return true;
  }

  function captureAppOpen() {
    var ok = track('app_open', {});
    maybeStandaloneLaunch();
    return ok;
  }

  function isStandaloneDisplay() {
    try {
      if (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* ignore */ }
    try {
      if (root.navigator && root.navigator.standalone === true) return true;
    } catch (e2) { /* ignore */ }
    return false;
  }

  function maybeStandaloneLaunch() {
    // Observable only: the page is already running as a standalone display.
    // There is no in-app install CTA or manifest, so this is not proof of an
    // in-product install flow, and it must not be used to fake an iOS add.
    if (!isStandaloneDisplay()) return false;
    return track('pwa_standalone_launch', {});
  }

  function notifyChatSubmit(chatId, opts) {
    opts = opts || {};
    var props = { chat_id: chatId, surface: 'chat' };
    if (opts.model) props.model = opts.model;
    return track('chat_submit', props);
  }

  function notifyChatFinish(chatId, ok, opts) {
    opts = opts || {};
    var props = { chat_id: chatId, surface: 'chat' };
    if (opts.model) props.model = opts.model;
    if (!ok) props.error_code = normalizeErrorCode(opts.errorCode);
    return track(ok ? 'chat_success' : 'chat_failed', props);
  }

  function setConsent(granted) {
    ensureLoaded();
    state.consent = granted ? CONSENT_GRANTED : CONSENT_DENIED;
    state.queue = [];
    state.account_distinct_id = '';
    persist();
    if (granted) {
      if (!state.install_id) state.install_id = uuid();
      persist();
      ensureSession();
      captureAppOpen();
      scheduleFlush();
    }
  }

  function identifyAccount(userId, cb) {
    // MVP: no account linkage.
    if (cb) cb(null);
    return null;
  }


  function clearAccount() {
    ensureLoaded();
    state.account_distinct_id = '';
    persist();
  }

  function notifyLoginSuccess(opts) {
    opts = opts || {};
    if (consentState() !== CONSENT_GRANTED) return false;
    var props = {};
    if (typeof opts.keyApplied === 'boolean') props.key_applied = opts.keyApplied;
    return track('login_success', props);
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
    if (!ALLOWED_INGEST_HOSTS[cfg.host]) { cb(false); return; }
    // Official anonymous capture: https://posthog.com/docs/api/capture
    // The ingest host still sees the TCP/TLS client IP; $ip is omitted.
    props.$lib = LIB_NAME;
    props.$lib_version = LIB_VERSION;
    props.$geoip_disable = true;
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
    if (flushing) return;
    flushing = true;
    function next() {
      if (!state.queue || !state.queue.length) {
        flushing = false;
        return;
      }
      var item = state.queue[0];
      deliver(item, function (ok) {
        if (!ok) {
          flushing = false;
          return;
        }
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
    if (consentState() === CONSENT_GRANTED) {
      ensureSession();
      captureAppOpen();
    }
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
    isFinalGenerationFailure: function (code) {
      return !!FINAL_FAILURE[normalizeErrorCode(code)];
    },
    sanitizeEnvironment: sanitizeEnvironment,
    sanitizeTestRunId: sanitizeTestRunId,
    publicProjectKey: publicProjectKey,
    sanitizeModel: function (value) {
      var text = String(value || '').trim();
      return MODEL_ID_RE.test(text) ? text : null;
    },
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
    notifyChatSubmit: notifyChatSubmit,
    notifyChatFinish: notifyChatFinish,
    isStandaloneDisplay: isStandaloneDisplay,
    pending: pending,
    flush: flush,
    ensureSession: ensureSession,
    touchActivity: touchActivity,
    resetForTests: function (options) {
      state = { consent: CONSENT_UNSET, install_id: '', session_id: '', session_started_at: 0,
        last_activity: 0, app_open_session: '', queue: [], generation_seen: {},
        account_distinct_id: '', login_success_token: '', chat_seen: {}, pwa_standalone_session: '' };
      booted = false;
      flushing = false;
      flushTimer = null;
      deps = {};
      try { storage().removeItem(LS_STATE); } catch (e) { /* ignore */ }
      if (options) boot(options);
    }
  };

  root.VSAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
