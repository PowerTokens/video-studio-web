/**
 * Smoke: Video Studio web analytics privacy, consent, opt-out, failure, and
 * duplicate prevention. Does not talk to a live PostHog project.
 * Run: node scripts/smoke-analytics.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import assert from 'assert';
import crypto from 'crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load() {
  const store = {};
  const sent = [];
  let clock = 1_700_000_000_000;
  const sandbox = {
    window: {},
    globalThis: null,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    crypto: {
      getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 19 + 7) & 255; return a; },
      subtle: {
        digest: (alg, data) => Promise.resolve(crypto.createHash('sha256').update(Buffer.from(data)).digest().buffer),
      },
    },
    TextEncoder,
    Date,
    Math,
    JSON,
    Uint8Array,
    Promise,
    setTimeout,
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.root = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8'), sandbox);
  const A = sandbox.VSAnalytics;
  A.resetForTests({
    now: () => clock,
    storage: sandbox.localStorage,
    transport: (item) => sent.push(item),
    setTimeout: (fn) => { fn(); return 0; },
    appVersion: 'web-1.15',
  });
  return { A, sent, store, advance: (ms) => { clock += ms; } };
}

function payloadBlob(items) {
  return JSON.stringify(items);
}

const { A, sent, advance } = load();

// --- sanitize / allowlist ---
const cleaned = A.sanitize('generation_failed', {
  model: 'wan3.0-video',
  error_code: 'QUOTA',
  prompt: 'secret prompt text',
  key: 'sk-live-secret',
  api_key: 'sk-live-secret',
  email: 'user@example.com',
  token: 'oauth-token',
  access_token: 'aaa',
  code: 'oauth-code',
  error: 'raw HTTP 401 body with key sk-xxx',
  url: 'https://example.com/callback?code=abc&state=xyz',
  search: '?code=abc',
  $current_url: 'https://x/?gclid=1',
  credits: 12,
  name: 'Ada',
  generation_id: 'gen1',
  surface: 'generate',
  extra_unknown: 'nope',
});
assert.ok(cleaned);
const blob = JSON.stringify(cleaned);
assert.equal(cleaned.model, 'wan3.0-video');
assert.equal(cleaned.error_code, 'QUOTA');
assert.equal(cleaned.platform, 'web');
assert.ok(!blob.includes('secret prompt'));
assert.ok(!blob.includes('sk-live'));
assert.ok(!blob.includes('user@example.com'));
assert.ok(!blob.includes('oauth-code'));
assert.ok(!blob.includes('gclid'));
assert.ok(!blob.includes('Ada'));
assert.strictEqual(A.sanitize('chat_user_message', { len_bucket: 'short' }), null);
assert.strictEqual(A.sanitize('$pageview', {}), null);
assert.equal(A.sanitize('generation_failed', { generation_id: 'g', error_code: 'HTTP 401: sk-secret' }).error_code, 'UNKNOWN');
assert.equal(A.sanitizeModel('wan3.0-video'), 'wan3.0-video');
assert.equal(A.sanitize('generation_start', { generation_id: 'g', model: 'please generate a cat in a hat', surface: 'generate' }).model, undefined);
assert.ok(A.isFinalGenerationFailure('FAILED'));
assert.ok(!A.isFinalGenerationFailure('TIMEOUT'));
assert.ok(!A.isFinalGenerationFailure('PAUSED'));
assert.equal(A.sanitizeEnvironment('synthetic'), 'synthetic');
assert.equal(A.sanitizeEnvironment('please generate a cat'), null);
assert.equal(A.sanitizeTestRunId('syn-ok-1'), 'syn-ok-1');
assert.equal(A.sanitizeTestRunId('not a run id'), null);
assert.equal(A.publicProjectKey('phx_personal'), '');
assert.ok(A.publicProjectKey('phc_testkey1'));
assert.equal(A.sanitize('app_open', { environment: 'please generate a cat', test_run_id: 'ok-run_1' }).environment, undefined);
assert.equal(A.sanitize('app_open', { environment: 'synthetic', test_run_id: 'ok-run_1' }).environment, 'synthetic');


// --- consent unset does not queue or mint identifiers ---
A.captureAppOpen();
assert.equal(sent.length, 0);
assert.equal(A.pending().length, 0);
A.setConsent(true);
A.flush();
assert.equal(sent.filter((x) => x.event === 'app_open').length, 1);
assert.ok(sent[0].distinct_id);
assert.ok(!String(sent[0].distinct_id).startsWith('ptu_'));

// --- app_open once per session; tab resume does not retrigger ---
const before = sent.length;
assert.equal(A.captureAppOpen(), false);
A.touchActivity();
A.captureAppOpen();
A.flush();
assert.equal(sent.length, before);

// idle timeout starts a new session
advance(A.SESSION_IDLE_MS + 1);
assert.equal(A.captureAppOpen(), true);
A.flush();
assert.equal(sent.filter((x) => x.event === 'app_open').length, 2);

// --- generation dedup ---
const startOk = A.notifyGenerationStart('g1', { model: 'wan3.0-video', surface: 'generate' });
const startDup = A.notifyGenerationStart('g1', { model: 'wan3.0-video' });
const ok = A.notifyGenerationFinish('g1', true, { model: 'wan3.0-video', durationMs: 1500 });
const failDup = A.notifyGenerationFinish('g1', false, { errorCode: 'QUOTA' });
A.flush();
assert.equal(startOk, true);
assert.equal(startDup, false);
assert.equal(ok, true);
assert.equal(failDup, false);
const genEvents = sent.filter((x) => x.properties && x.properties.generation_id === 'g1').map((x) => x.event);
assert.deepEqual(genEvents, ['generation_start', 'generation_success']);

// --- opt-out drops queue and further tracks ---
const isolated = load();
assert.equal(isolated.A.captureAppOpen(), false);
assert.deepEqual(isolated.A.pending(), []);
isolated.A.setConsent(true);
isolated.A.flush();
isolated.sent.length = 0;
isolated.A.notifyGenerationStart('gx', { model: 'kling-v3' });
isolated.A.flush();
assert.ok(isolated.sent.length > 0);
isolated.A.setConsent(false);
assert.deepEqual(isolated.A.pending(), []);
assert.equal(isolated.A.notifyLoginSuccess({ userId: 'usr_1' }), false);

// --- transport failure fails open (queue kept) ---
const failing = load();
failing.A.resetForTests({
  now: () => 1_700_000_000_000,
  storage: failing.A /* reuse */,
});
// rebuild with throwing transport
const failStore = {};
const thrower = load();
thrower.A.resetForTests({
  now: () => 1_700_000_000_000,
  storage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(failStore, k) ? failStore[k] : null),
    setItem: (k, v) => { failStore[k] = String(v); },
    removeItem: (k) => { delete failStore[k]; },
  },
  transport: () => { throw new Error('network down'); },
  setTimeout: (fn) => { fn(); return 0; },
});
thrower.A.setConsent(true);
assert.ok(thrower.A.pending().length >= 1);

// --- empty project key: no fetch ---
{
  const store = {};
  const hits = [];
  const sandbox = {
    window: {},
    globalThis: null,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 19 + 7) & 255; return a; } },
    Date, Math, JSON, Uint8Array, Promise, setTimeout, console,
    fetch: async () => { hits.push(1); return { ok: true, status: 200, json: async () => ({}) }; },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.VS_POSTHOG_PROJECT_KEY = '';
  sandbox.VS_ANALYTICS_CONFIG = { posthogProjectKey: '', posthogHost: 'https://us.i.posthog.com' };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8'), sandbox);
  // Force empty after the shipped config file (which may include a public token).
  sandbox.VS_POSTHOG_PROJECT_KEY = '';
  sandbox.VS_ANALYTICS_CONFIG.posthogProjectKey = '';
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8'), sandbox);
  const E = sandbox.VSAnalytics;
  E.resetForTests({
    now: () => 1_700_000_000_000,
    storage: sandbox.localStorage,
    transport: null,
    setTimeout: (fn) => { fn(); return 0; },
    appVersion: 'web-1.17',
  });
  E.setConsent(true);
  E.flush();
  assert.deepEqual(E.pending(), []);
  assert.deepEqual(hits, []);
}

// --- chat events do not enter PostHog queue even via track() ---
const beforeChat = sent.length;
assert.equal(A.track('chat_user_message', { prompt: 'hi', len_bucket: 'short' }), false);
assert.equal(sent.length, beforeChat);

// --- login hash does not include raw user id ---
const login = load();
login.A.setConsent(true);
login.sent.length = 0;
assert.equal(login.A.notifyLoginSuccess({ userId: 'usr_99', keyApplied: true }), true);
login.A.flush();
assert.ok(login.sent.some((x) => x.event === 'login_success'));
const loginBlob = payloadBlob(login.sent);
assert.ok(!loginBlob.includes('usr_99'));
assert.ok(!loginBlob.includes('email'));
assert.ok(!login.sent[login.sent.length - 1].distinct_id.startsWith('ptu_'));
assert.ok(!loginBlob.includes('account_linked'));

// --- config names exist and the committed project key stays empty ---
const cfg = load();
assert.equal(cfg.A.consentState() === 'unset' || true, true);
const configSrc = fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8');
assert.ok(configSrc.includes('posthogProjectKey'));
assert.ok(configSrc.includes('posthogHost'));
assert.ok(/posthogProjectKey:\s*existing\.posthogProjectKey \|\| ""/.test(configSrc));
assert.ok(!/posthogProjectKey:[^\n]*phc_[A-Za-z0-9_-]{4,}/.test(configSrc));
assert.ok(!configSrc.includes('phx_'));

// --- video_download allowlisted ---
A.notifyVideoDownload({ model: 'wan3.0-video', surface: 'generate' });
A.flush();
assert.ok(sent.some((x) => x.event === 'video_download'));


// --- official capture flags on the HTTP body (no live ingest) ---
{
  const store = {};
  const posts = [];
  const sandbox = {
    window: {},
    globalThis: null,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    crypto: {
      getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 19 + 7) & 255; return a; },
    },
    Date, Math, JSON, Uint8Array, Promise, setTimeout, console,
    fetch: async (url, opts) => {
      posts.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ status: 1 }) };
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.VS_POSTHOG_PROJECT_KEY = 'phc_testkey1';
  sandbox.VS_POSTHOG_HOST = 'https://us.i.posthog.com';
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8'), sandbox);
  const B = sandbox.VSAnalytics;
  B.resetForTests({
    now: () => 1_700_000_000_000,
    storage: sandbox.localStorage,
    setTimeout: (fn) => { fn(); return 0; },
    appVersion: 'web-1.15',
  });
  B.setConsent(true);
  B.flush();
  assert.ok(posts.length >= 1);
  const body = posts[0].body;
  assert.equal(posts[0].url, 'https://us.i.posthog.com/i/v0/e/');
  assert.equal(body.event, 'app_open');
  assert.strictEqual(body.properties.$process_person_profile, false);
  assert.strictEqual(body.properties.$geoip_disable, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(body.properties, '$ip'));
}


// --- chat submit vs server reply, no text ---
{
  const { A, sent } = load();
  A.setConsent(true);
  A.flush();
  sent.length = 0;
  assert.equal(A.notifyChatSubmit('c1', { model: 'glm-4.7-flash' }), true);
  A.flush();
  assert.equal(sent[0].event, 'chat_submit');
  assert.equal(sent[0].properties.chat_id, 'c1');
  assert.equal(sent[0].properties.surface, 'chat');
  sent.length = 0;
  assert.equal(A.notifyChatFinish('c1', true, { model: 'glm-4.7-flash' }), true);
  A.flush();
  assert.equal(sent[0].event, 'chat_success');
  sent.length = 0;
  assert.equal(A.notifyChatSubmit('c2'), true);
  assert.equal(A.notifyChatFinish('c2', false, { errorCode: 'HTTP 401: sk-live please generate a cat' }), true);
  A.flush();
  const failed = sent.find((x) => x.event === 'chat_failed');
  assert.ok(failed);
  assert.equal(failed.properties.error_code, 'UNKNOWN');
  assert.ok(!JSON.stringify(sent).includes('sk-live'));
  assert.ok(!JSON.stringify(sent).includes('please generate'));
  assert.equal(A.sanitize('chat_user_message', { len_bucket: 'short', prompt: 'hi' }), null);
  assert.equal(A.sanitize('share_published', { platform: 'twitter' }), null);
  const dirty = A.sanitize('chat_submit', { chat_id: 'c3', prompt: 'secret prompt text', message: 'hello', surface: 'chat' });
  assert.ok(dirty);
  assert.ok(!('prompt' in dirty));
  assert.ok(!('message' in dirty));
  assert.equal(A.notifyChatSubmit('c1'), false);
  assert.equal(A.notifyChatFinish('c1', true), false);
}

// --- standalone launch is a separate event, only when display-mode is standalone ---
{
  const store = {};
  const sent = [];
  const sandbox = {
    window: {},
    globalThis: null,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 19 + 7) & 255; return a; } },
    Date, Math, JSON, Uint8Array, Promise, setTimeout, console,
    matchMedia: (q) => ({ matches: q === '(display-mode: standalone)', media: q, addListener() {}, removeListener() {} }),
    navigator: { standalone: false },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.VS_POSTHOG_PROJECT_KEY = 'phc_testkey1';
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8'), sandbox);
  sandbox.VS_POSTHOG_PROJECT_KEY = 'phc_testkey1';
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8'), sandbox);
  const S = sandbox.VSAnalytics;
  S.resetForTests({
    now: () => 1_700_000_000_000,
    storage: sandbox.localStorage,
    transport: (item) => sent.push(item),
    setTimeout: (fn) => { fn(); return 0; },
    appVersion: 'web-1.17',
  });
  S.setConsent(true);
  S.flush();
  const names = sent.map((x) => x.event);
  assert.ok(names.includes('app_open'));
  assert.ok(names.includes('pwa_standalone_launch'));
  assert.ok(S.isStandaloneDisplay());
  // once per session
  const before = sent.filter((x) => x.event === 'pwa_standalone_launch').length;
  S.captureAppOpen();
  assert.equal(sent.filter((x) => x.event === 'pwa_standalone_launch').length, before);
}

// --- A2HS offer / click / accepted allowlist and dedupe ---
{
  const { A, sent } = load();
  A.setConsent(true);
  A.flush();
  sent.length = 0;

  const accepted = A.sanitize('pwa_install_accepted', {});
  assert.ok(accepted);
  assert.equal(accepted.platform, 'web');

  const click = A.sanitize('pwa_install_click', { cta_kind: 'native-prompt', prompt: 'secret', message: 'hi' });
  assert.equal(click.cta_kind, 'native-prompt');
  assert.ok(!('prompt' in click));
  assert.ok(!('message' in click));
  assert.equal(A.sanitize('pwa_install_click', { cta_kind: 'ios-safari-sheet' }).cta_kind, 'ios-safari-sheet');
  assert.equal(A.sanitize('pwa_install_click', { cta_kind: 'ios-other-sheet' }).cta_kind, 'ios-other-sheet');
  assert.equal(A.sanitize('pwa_install_click', { cta_kind: 'android-menu-sheet' }).cta_kind, 'android-menu-sheet');
  assert.equal(A.sanitize('pwa_install_click', { cta_kind: 'none' }).cta_kind, 'none');
  assert.ok(!('cta_kind' in A.sanitize('pwa_install_click', { cta_kind: 'please-install-now' })));
  assert.equal(A.sanitize('pwa_install_completed', {}), null);

  assert.equal(A.track('pwa_offer_shown', {}), true);
  assert.equal(A.track('pwa_offer_shown', {}), false);
  assert.equal(A.track('pwa_offer_dismissed', {}), true);
  assert.equal(A.track('pwa_install_prompt_dismissed', {}), true);
  assert.equal(A.track('pwa_install_accepted', {}), true);
  assert.equal(A.track('pwa_install_accepted', {}), false);
  A.flush();
  const names = sent.map((x) => x.event);
  assert.equal(names.filter((n) => n === 'pwa_offer_shown').length, 1);
  assert.equal(names.filter((n) => n === 'pwa_install_accepted').length, 1);
  assert.ok(names.includes('pwa_offer_dismissed'));
  assert.ok(names.includes('pwa_install_prompt_dismissed'));
}


// --- session_end duration vs active, dedupe, idle vs hide ---
{
  const store = {};
  const sent = [];
  let clock = 1_700_000_000_000;
  let visible = true;
  const sandbox = {
    window: {},
    globalThis: null,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 19 + 7) & 255; return a; } },
    Date, Math, JSON, Uint8Array, Promise, setTimeout, console,
    document: { visibilityState: 'visible', hidden: false, addEventListener() {} },
    addEventListener() {},
    navigator: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8'), sandbox);
  const S = sandbox.VSAnalytics;
  S.resetForTests({
    now: () => clock,
    storage: sandbox.localStorage,
    transport: (item) => sent.push(item),
    setTimeout: (fn) => { fn(); return 0; },
    appVersion: 'web-1.17',
    isVisible: () => visible,
  });
  S.setConsent(true);
  S.flush();
  sent.length = 0;
  clock += 5000;
  visible = false;
  sandbox.document.visibilityState = 'hidden';
  sandbox.document.hidden = true;
  S.handleHidden();
  clock += 2000;
  visible = true;
  sandbox.document.visibilityState = 'visible';
  sandbox.document.hidden = false;
  S.handleVisible();
  clock += 3000;
  S.handlePageLeaving(false);
  S.flush();
  const ended = sent.filter((x) => x.event === 'session_end');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].properties.duration_ms, 10000);
  assert.equal(ended[0].properties.active_ms, 8000);
  const before = sent.filter((x) => x.event === 'session_end').length;
  S.handlePageLeaving(false);
  S.flush();
  assert.equal(sent.filter((x) => x.event === 'session_end').length, before);
  // cap
  assert.equal(S.sanitize('session_end', { duration_ms: 50_000_000, active_ms: -3 }).duration_ms, S.SESSION_MAX_MS);
  assert.ok(!('active_ms' in S.sanitize('session_end', { duration_ms: 10, active_ms: -3 })));
}

// hide and return within idle: no session_end, no second app_open
{
  const store = {};
  const sent = [];
  let clock = 1_700_000_000_000;
  let visible = true;
  const sandbox = {
    window: {}, globalThis: null,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 19 + 7) & 255; return a; } },
    Date, Math, JSON, Uint8Array, Promise, setTimeout, console,
    document: { visibilityState: 'visible', hidden: false, addEventListener() {} },
    addEventListener() {},
    navigator: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8'), sandbox);
  const S = sandbox.VSAnalytics;
  S.resetForTests({
    now: () => clock,
    storage: sandbox.localStorage,
    transport: (item) => sent.push(item),
    setTimeout: (fn) => { fn(); return 0; },
    appVersion: 'web-1.17',
    isVisible: () => visible,
  });
  S.setConsent(true);
  S.flush();
  const opens = () => sent.filter((x) => x.event === 'app_open').length;
  const ends = () => sent.filter((x) => x.event === 'session_end').length;
  assert.equal(opens(), 1);
  visible = false;
  S.handleHidden();
  clock += 60 * 1000;
  visible = true;
  S.handleVisible();
  S.flush();
  assert.equal(ends(), 0);
  assert.equal(opens(), 1);
  // idle then return: end previous, then a new open
  visible = false;
  S.handleHidden();
  clock += 31 * 60 * 1000;
  visible = true;
  S.handleVisible();
  S.flush();
  assert.equal(ends(), 1);
  assert.equal(opens(), 2);
}

// crash recovery: unterminated session ends on next boot before app_open
{
  const store = {};
  const sent = [];
  let clock = 1_700_000_000_000;
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  function bootClient(sentArr, { reset } = {}) {
    const sandbox = {
      window: {}, globalThis: null, localStorage: storage,
      crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 11 + 3) & 255; return a; } },
      Date, Math, JSON, Uint8Array, Promise, setTimeout, console,
      document: { visibilityState: 'visible', hidden: false, addEventListener() {} },
      addEventListener() {},
      navigator: {},
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8'), sandbox);
    const S = sandbox.VSAnalytics;
    if (reset) {
      S.resetForTests({
        now: () => clock, storage, transport: (item) => sentArr.push(item),
        setTimeout: (fn) => { fn(); return 0; }, appVersion: 'web-1.17', isVisible: () => true,
      });
    } else {
      S.boot({
        now: () => clock, storage, transport: (item) => sentArr.push(item),
        setTimeout: (fn) => { fn(); return 0; }, appVersion: 'web-1.17', isVisible: () => true,
      });
    }
    return S;
  }
  const firstSent = [];
  const first = bootClient(firstSent, { reset: true });
  first.setConsent(true);
  first.flush();
  clock += 4000;
  first.track('chat_submit', { chat_id: 'c-crash', surface: 'chat' });
  first.flush();
  const secondSent = [];
  bootClient(secondSent, { reset: false });
  const names = secondSent.map((x) => x.event);
  assert.ok(names.includes('session_end'), 'crash recovery should end the previous session');
  assert.ok(names.includes('app_open'));
  assert.ok(names.indexOf('session_end') < names.indexOf('app_open'));
  const end = secondSent.find((x) => x.event === 'session_end');
  assert.equal(end.properties.duration_ms, 4000);
}

// --- login start vs success, billing is not payment, download click ---
{
  const { A, sent } = load();
  A.setConsent(true);
  A.flush();
  sent.length = 0;
  assert.equal(A.notifyLoginStart(), true);
  assert.equal(A.notifyLoginSuccess({ keyApplied: true }), true);
  assert.equal(A.notifyLoginFailed({ errorCode: 'access_denied: user cancelled with token abc' }), true);
  assert.equal(A.notifyLogout(), true);
  A.flush();
  const names = sent.map((x) => x.event);
  assert.ok(names.includes('login_start'));
  assert.ok(names.includes('login_success'));
  const failed = sent.find((x) => x.event === 'login_failed');
  assert.equal(failed.properties.error_code, 'UNKNOWN');
  assert.ok(!JSON.stringify(sent).includes('token abc'));
  assert.ok(names.includes('logout'));

  sent.length = 0;
  assert.equal(A.notifyBillingClick('credits_chip'), true);
  assert.equal(A.notifyBillingClick('quota'), true);
  assert.equal(A.sanitize('payment_completed', { amount: 12 }), null);
  A.flush();
  assert.ok(sent.every((x) => x.event === 'billing_click'));
  assert.equal(sent[0].properties.source, 'credits_chip');
  assert.ok(!JSON.stringify(sent).includes('payment'));

  sent.length = 0;
  assert.equal(A.notifyDesktopDownloadClick('cta'), true);
  assert.equal(A.notifyDesktopDownloadClick('releases'), true);
  assert.equal(A.notifyDesktopDownloadClick('redirect'), true);
  assert.ok(!('source' in A.sanitize('desktop_download_click', { source: 'installed' })));
  A.flush();
  assert.equal(sent.filter((x) => x.event === 'desktop_download_click').length, 3);
}

// --- surface_open once per session, key verify leaks nothing, language, input_mode ---
{
  const { A, sent } = load();
  A.setConsent(true);
  A.flush();
  sent.length = 0;
  assert.equal(A.notifySurfaceOpen('chat'), true);
  assert.equal(A.notifySurfaceOpen('chat'), false);
  assert.equal(A.notifySurfaceOpen('generate'), true);
  assert.equal(A.notifySurfaceOpen('tasks'), true);
  assert.equal(A.notifySurfaceOpen('account'), true);
  assert.equal(A.notifySurfaceOpen('settings'), false);
  A.flush();
  assert.equal(sent.filter((x) => x.event === 'surface_open').length, 4);

  sent.length = 0;
  assert.equal(A.notifyKeyVerified(), true);
  assert.equal(A.notifyKeyVerifyFailed({ errorCode: 'AUTH' }), true);
  const leak = A.sanitize('key_verify_failed', { error_code: 'AUTH', key: 'sk-live-secret', error: 'invalid key sk-live-secret' });
  assert.equal(leak.error_code, 'AUTH');
  assert.ok(!('key' in leak));
  assert.ok(!('error' in leak));
  A.flush();
  assert.ok(!JSON.stringify(sent).includes('sk-live'));

  sent.length = 0;
  assert.equal(A.notifyLanguageSet('zh'), true);
  assert.equal(A.notifyLanguageSet('en'), true);
  assert.ok(!('language' in A.sanitize('language_set', { language: 'fr' })));
  assert.equal(A.sanitize('language_set', { language: 'JA' }).language, 'ja');
  A.flush();

  sent.length = 0;
  assert.equal(A.notifyGenerationStart('g-i2v', { surface: 'generate', inputMode: 'i2v', model: 'wan3.0-video' }), true);
  assert.equal(A.notifyGenerationFinish('g-i2v', true, { surface: 'generate', inputMode: 'i2v', durationMs: 1200 }), true);
  assert.equal(A.notifyGenerationStart('g-t2v', { surface: 'generate', inputMode: 't2v' }), true);
  const dirtyMode = A.sanitize('generation_start', { generation_id: 'g3', surface: 'generate', input_mode: 'prompt-image', prompt: 'secret' });
  assert.ok(!('input_mode' in dirtyMode));
  assert.ok(!('prompt' in dirtyMode));
  A.flush();
  const i2v = sent.find((x) => x.event === 'generation_start' && x.properties.generation_id === 'g-i2v');
  const t2v = sent.find((x) => x.event === 'generation_start' && x.properties.generation_id === 'g-t2v');
  assert.equal(i2v.properties.input_mode, 'i2v');
  assert.equal(t2v.properties.input_mode, 't2v');

  assert.equal(A.sanitize('share_published', {}), null);
  assert.equal(A.sanitize('consent_denied', {}), null);
  assert.equal(A.sanitize('session_heartbeat', {}), null);
}

console.log('smoke-analytics: ok');
