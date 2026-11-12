/**
 * Minimal PostHog capture client for Video Studio web.
 *
 * Not the official posthog-js SDK: no autocapture, session replay, heatmaps, or
 * person-profile enrichment. Only allowlisted critical events are sent. Prompts,
 * keys, tokens, emails, assets, raw error text, OAuth codes, and URL query
 * strings are never accepted. Fail open; bounded queue when
 * a destination exists. Analytics is default on. This MVP
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
    pwa_standalone_launch: true,
    pwa_offer_shown: true,
    pwa_offer_dismissed: true,
    pwa_install_click: true,
    pwa_install_accepted: true,
    pwa_install_prompt_dismissed: true,
    session_end: true,
    login_start: true,
    login_failed: true,
    logout: true,
    billing_click: true,
    desktop_download_click: true,
    surface_open: true,
    key_verified: true,
    key_verify_failed: true,
    language_set: true
  };

  var ALLOWED_PROPS = {
    platform: true, app_version: true, session_id: true, install_id: true,
    surface: true, model: true, duration_ms: true, error_code: true,
    generation_id: true, requested_duration_s: true, key_applied: true,
    environment: true, test_run_id: true, chat_id: true,
    cta_kind: true, active_ms: true, source: true, language: true,
    input_mode: true
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
  var SAFE_SURFACES = { generate: true, compare: true, batch: true, chat: true, tasks: true, account: true, history: true, keys: true };
  var SAFE_CTA_KIND = {
    'native-prompt': true,
    'ios-safari-sheet': true,
    'ios-other-sheet': true,
    'android-menu-sheet': true,
    'none': true
  };
  var SAFE_INPUT_MODE = { t2v: true, i2v: true };
  var SAFE_LANGUAGES = { zh: true, en: true, es: true, pt: true, ja: true, ko: true };
  var SAFE_BILLING_SOURCE = {
    header: true, account: true, quota: true, credits_chip: true, chat: true
  };
  var SAFE_DOWNLOAD_SOURCE = { cta: true, releases: true, redirect: true };
  var SESSION_MAX_MS = 12 * 60 * 60 * 1000;
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
      } else if (key === 'duration_ms' || key === 'active_ms') {
        value = parseInt(value, 10);
        if (!isFinite(value) || value < 0) continue;
        value = Math.floor(value);
        if (value > SESSION_MAX_MS) value = SESSION_MAX_MS;
      } else if (key === 'language') {
        value = String(value || '').trim().toLowerCase();
        if (!SAFE_LANGUAGES[value]) continue;
      } else if (key === 'input_mode') {
        value = String(value || '').trim().toLowerCase();
        if (!SAFE_INPUT_MODE[value]) continue;
      } else if (key === 'source') {
        value = String(value || '').trim().toLowerCase();
        if (!(SAFE_BILLING_SOURCE[value] || SAFE_DOWNLOAD_SOURCE[value])) continue;
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
      } else if (key === 'cta_kind') {
        value = String(value || '').trim();
        if (!SAFE_CTA_KIND[value]) continue;
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
    account_distinct_id: '', login_success_token: '', chat_seen: {}, pwa_standalone_session: '',
    pwa_offer_session: '', pwa_accepted: false, active_ms: 0, active_started_at: 0,
    session_end_id: '', surfaces_seen: {} };
  var flushTimer = null;
  var flushing = false;
  var openingAppOpen = false;
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
      state.pwa_offer_session = saved.pwa_offer_session || '';
      state.pwa_accepted = !!saved.pwa_accepted;
      state.active_ms = parseInt(saved.active_ms, 10) || 0;
      if (state.active_ms < 0) state.active_ms = 0;
      state.active_started_at = parseInt(saved.active_started_at, 10) || 0;
      state.session_end_id = saved.session_end_id || '';
      state.surfaces_seen = saved.surfaces_seen && typeof saved.surfaces_seen === 'object' ? saved.surfaces_seen : {};
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
    state.consent = CONSENT_GRANTED;
    persist();
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
    return CONSENT_GRANTED;
  }

  function isEnabled() {
    return hasDestination();
  }

  function isPageVisible() {
    try {
      if (deps && typeof deps.isVisible === 'function') return !!deps.isVisible();
      if (root.document && root.document.visibilityState) return root.document.visibilityState === 'visible';
      if (root.document && typeof root.document.hidden === 'boolean') return !root.document.hidden;
    } catch (e) { /* ignore */ }
    return true;
  }

  function capDuration(ms) {
    ms = parseInt(ms, 10);
    if (!isFinite(ms) || ms < 0) return 0;
    return ms > SESSION_MAX_MS ? SESSION_MAX_MS : Math.floor(ms);
  }

  function pauseActive(at) {
    if (!state.active_started_at) return;
    var slice = Math.max(0, at - state.active_started_at);
    state.active_ms = capDuration((state.active_ms || 0) + slice);
    state.active_started_at = 0;
  }

  function resumeActive(at) {
    if (consentState() !== CONSENT_GRANTED) return;
    if (!state.session_id || state.session_end_id === state.session_id) return;
    if (state.active_started_at) return;
    state.active_started_at = at;
  }

  function finalizeActive(at) {
    pauseActive(at);
    var duration = capDuration(at - (state.session_started_at || at));
    var active = capDuration(state.active_ms || 0);
    if (active > duration) active = duration;
    return { duration_ms: duration, active_ms: active };
  }

  function enqueueSessionEnd(endAt, sessionId) {
    sessionId = sessionId || state.session_id;
    if (!sessionId) return false;
    if (state.session_end_id && state.session_end_id === sessionId) return false;
    if (consentState() !== CONSENT_GRANTED) return false;
    if (!state.install_id) return false;
    var times = finalizeActive(endAt || now());
    state.session_end_id = sessionId;
    var props = {
      duration_ms: times.duration_ms,
      active_ms: times.active_ms,
      session_id: sessionId,
      install_id: state.install_id,
      app_version: APP_VERSION,
      platform: PLATFORM
    };
    var cfgNow = config();
    var envName = sanitizeEnvironment(cfgNow.environment);
    if (envName) props.environment = envName;
    var runId = sanitizeTestRunId(cfgNow.testRunId);
    if (runId) props.test_run_id = runId;
    var item = {
      event: 'session_end',
      distinct_id: state.install_id,
      properties: props,
      timestamp: new Date(endAt || now()).toISOString()
    };
    if (hasDestination()) enqueue(item);
    persist();
    return true;
  }

  function beginNewSession(t) {
    state.session_id = uuid();
    state.session_started_at = t;
    state.last_activity = t;
    state.app_open_session = '';
    state.pwa_standalone_session = '';
    state.pwa_offer_session = '';
    state.login_success_token = '';
    state.surfaces_seen = {};
    state.active_ms = 0;
    state.active_started_at = isPageVisible() ? t : 0;
    state.session_end_id = '';
    persist();
    return state.session_id;
  }

  function isIdleSince(t) {
    return !!(state.last_activity && (t - state.last_activity > SESSION_IDLE_MS));
  }

  function ensureSession() {
    if (consentState() !== CONSENT_GRANTED) return '';
    var t = now();
    var idle = isIdleSince(t);
    if (state.session_id && idle && state.session_end_id !== state.session_id) {
      enqueueSessionEnd(state.last_activity || t, state.session_id);
      if (hasDestination()) scheduleFlush();
    }
    if (!state.session_id || idle || (state.session_end_id && state.session_end_id === state.session_id)) {
      return beginNewSession(t);
    }
    state.last_activity = t;
    if (isPageVisible()) resumeActive(t);
    persist();
    return state.session_id;
  }

  function recoverClosedSession() {
    // Fresh boot / crash: end an unterminated previous session before app_open.
    if (consentState() !== CONSENT_GRANTED) return false;
    var sid = state.session_id;
    if (!sid || state.session_end_id === sid) return false;
    var endAt = state.last_activity || state.session_started_at || now();
    enqueueSessionEnd(endAt, sid);
    return true;
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
    if (event === 'pwa_offer_shown') {
      if (state.pwa_offer_session && state.pwa_offer_session === state.session_id) return false;
      state.pwa_offer_session = state.session_id;
      return true;
    }
    if (event === 'pwa_install_accepted') {
      if (state.pwa_accepted) return false;
      state.pwa_accepted = true;
      return true;
    }
    if (event === 'session_end') {
      var sid = String((clean && clean.session_id) || state.session_id || '').trim();
      if (!sid) return false;
      if (state.session_end_id && state.session_end_id === sid) return false;
      state.session_end_id = sid;
      return true;
    }
    if (event === 'surface_open') {
      var surf = String((clean && clean.surface) || '').trim().toLowerCase();
      if (!surf || !SAFE_SURFACES[surf]) return false;
      var bag = state.surfaces_seen || {};
      var seen = bag[state.session_id] || [];
      if (seen.indexOf(surf) >= 0) return false;
      seen = seen.concat([surf]);
      bag[state.session_id] = seen;
      state.surfaces_seen = bag;
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
    if (event === 'session_end') {
      return enqueueSessionEnd(now(), (clean && clean.session_id) || state.session_id);
    }
    var sessionId = ensureSession();
    if (!state.install_id) {
      state.install_id = uuid();
      persist();
    }
    if (!sessionId || !state.install_id) return false;
    if (event !== 'app_open' && event !== 'session_end' && !openingAppOpen && state.app_open_session !== sessionId) {
      openingAppOpen = true;
      try { captureAppOpen(); } finally { openingAppOpen = false; }
    }
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
    // This is not "install accepted". iOS Add to Home Screen cannot be
    // confirmed at add time (the app only opens a guide sheet); a later
    // standalone launch is the only later signal for those installs.
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
    ensureSession();
    captureAppOpen();
    scheduleFlush();
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

  function notifyLoginStart() {
    return track('login_start', {});
  }

  function notifyLoginFailed(opts) {
    opts = opts || {};
    return track('login_failed', { error_code: normalizeErrorCode(opts.errorCode) });
  }

  function notifyLogout() {
    return track('logout', {});
  }

  function notifyLoginSuccess(opts) {
    opts = opts || {};
    if (consentState() !== CONSENT_GRANTED) return false;
    var props = {};
    if (typeof opts.keyApplied === 'boolean') props.key_applied = opts.keyApplied;
    return track('login_success', props);
  }

  function notifyBillingClick(source) {
    return track('billing_click', { source: source });
  }

  function notifyDesktopDownloadClick(source) {
    return track('desktop_download_click', { source: source || 'cta' });
  }

  function notifySurfaceOpen(surface) {
    return track('surface_open', { surface: surface });
  }

  function notifyKeyVerified() {
    return track('key_verified', {});
  }

  function notifyKeyVerifyFailed(opts) {
    opts = opts || {};
    return track('key_verify_failed', { error_code: normalizeErrorCode(opts.errorCode) });
  }

  function notifyLanguageSet(language) {
    return track('language_set', { language: language });
  }

  function notifyGenerationStart(generationId, opts) {
    opts = opts || {};
    var props = { generation_id: generationId, surface: opts.surface || 'generate' };
    if (opts.model) props.model = opts.model;
    if (opts.requestedDurationS != null) props.requested_duration_s = opts.requestedDurationS;
    if (opts.inputMode) props.input_mode = opts.inputMode;
    return track('generation_start', props);
  }

  function notifyGenerationFinish(generationId, ok, opts) {
    opts = opts || {};
    var props = { generation_id: generationId, surface: opts.surface || 'generate' };
    if (opts.model) props.model = opts.model;
    if (opts.durationMs != null) props.duration_ms = opts.durationMs;
    if (opts.inputMode) props.input_mode = opts.inputMode;
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

  function deliver(item, cb, useBeacon) {
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
      if (useBeacon && root.navigator && typeof root.navigator.sendBeacon === 'function') {
        var blob = new Blob([body], { type: 'application/json' });
        cb(!!root.navigator.sendBeacon(url, blob));
        return;
      }
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

  function flush(opts) {
    opts = opts || {};
    if (!isEnabled() || !hasDestination()) return;
    if (flushing && !opts.unload) return;
    flushing = true;
    var useBeacon = !!opts.unload;
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

  var lifecycleBound = false;
  var bootMode = 'app';

  function handleHidden() {
    if (!booted || consentState() !== CONSENT_GRANTED) return;
    var t = now();
    pauseActive(t);
    if (state.session_id) {
      state.last_activity = t;
      persist();
    }
  }

  function handleVisible() {
    if (!booted || consentState() !== CONSENT_GRANTED) return;
    ensureLoaded();
    var t = now();
    if (state.session_id && state.session_end_id !== state.session_id && isIdleSince(t)) {
      enqueueSessionEnd(state.last_activity || t, state.session_id);
      beginNewSession(t);
      captureAppOpen();
      if (hasDestination()) scheduleFlush();
      return;
    }
    if (state.session_id && state.session_end_id !== state.session_id) {
      resumeActive(t);
      state.last_activity = t;
      persist();
    }
  }

  function handlePageLeaving(persisted) {
    if (bootMode === 'download') return;
    if (!booted || consentState() !== CONSENT_GRANTED) return;
    if (persisted) {
      handleHidden();
      return;
    }
    if (state.session_id && state.session_end_id !== state.session_id) {
      enqueueSessionEnd(now(), state.session_id);
      if (hasDestination()) flush({ unload: true });
    }
  }

  function bindLifecycle() {
    if (lifecycleBound || bootMode === 'download') return;
    lifecycleBound = true;
    try {
      if (root.document && root.document.addEventListener) {
        root.document.addEventListener('visibilitychange', function () {
          if (!root.document) return;
          if (root.document.visibilityState === 'hidden' || root.document.hidden) handleHidden();
          else handleVisible();
        });
      }
      if (root.addEventListener) {
        root.addEventListener('pagehide', function (ev) {
          handlePageLeaving(!!(ev && ev.persisted));
        });
        root.addEventListener('beforeunload', function () {
          handlePageLeaving(false);
        });
      }
    } catch (e) { /* ignore */ }
  }

  function boot(options) {
    deps = options || {};
    if (deps.appVersion) APP_VERSION = String(deps.appVersion);
    bootMode = deps.page === 'download' ? 'download' : 'app';
    if (!booted) loadState();
    booted = true;
    if (bootMode !== 'download') bindLifecycle();
    if (consentState() === CONSENT_GRANTED) {
      if (bootMode === 'download') {
        // Interstitial only: do not rotate sessions or fire app_open / session_end.
      } else {
        if (recoverClosedSession() && hasDestination()) scheduleFlush();
        ensureSession();
        captureAppOpen();
      }
    }
    return api;
  }

  function touchActivity() {
    if (!booted) return;
    handleVisible();
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
    notifyLoginStart: notifyLoginStart,
    notifyLoginFailed: notifyLoginFailed,
    notifyLogout: notifyLogout,
    notifyLoginSuccess: notifyLoginSuccess,
    notifyBillingClick: notifyBillingClick,
    notifyDesktopDownloadClick: notifyDesktopDownloadClick,
    notifySurfaceOpen: notifySurfaceOpen,
    notifyKeyVerified: notifyKeyVerified,
    notifyKeyVerifyFailed: notifyKeyVerifyFailed,
    notifyLanguageSet: notifyLanguageSet,
    notifyGenerationStart: notifyGenerationStart,
    notifyGenerationFinish: notifyGenerationFinish,
    notifyVideoDownload: notifyVideoDownload,
    handleHidden: handleHidden,
    handleVisible: handleVisible,
    handlePageLeaving: handlePageLeaving,
    SESSION_MAX_MS: SESSION_MAX_MS,
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
        account_distinct_id: '', login_success_token: '', chat_seen: {}, pwa_standalone_session: '',
    pwa_offer_session: '', pwa_accepted: false, active_ms: 0, active_started_at: 0,
    session_end_id: '', surfaces_seen: {} };
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
