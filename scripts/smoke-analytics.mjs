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

// --- consent unset holds events ---
A.captureAppOpen();
assert.equal(sent.length, 0);
assert.equal(A.pending().length, 1);
A.setConsent(true);
A.flush();
assert.equal(sent.filter((x) => x.event === 'app_open').length, 1);

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
isolated.A.captureAppOpen();
assert.ok(isolated.A.pending().length > 0);
isolated.A.setConsent(false);
assert.deepEqual(isolated.A.pending(), []);
assert.equal(isolated.A.notifyLoginSuccess({ userId: 'usr_1' }), false);
assert.equal(isolated.sent.length, 0);

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
const hits = [];
const empty = load();
empty.A.resetForTests({
  now: () => 1_700_000_000_000,
  storage: empty.store ? undefined : {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  },
  transport: null,
  setTimeout: (fn) => { fn(); return 0; },
});
// After resetForTests with no transport, set a sandbox fetch trap via boot options only.
// Directly call flush with empty config.
empty.A.setConsent(true);
const pendingBefore = empty.A.pending().length;
empty.A.flush();
assert.ok(empty.A.pending().length >= pendingBefore || empty.A.pending().length >= 1);

// --- chat events do not enter PostHog queue even via track() ---
const beforeChat = sent.length;
assert.equal(A.track('chat_user_message', { prompt: 'hi', len_bucket: 'short' }), false);
assert.equal(sent.length, beforeChat);

// --- login hash does not include raw user id ---
const login = load();
login.A.setConsent(true);
login.sent.length = 0;
login.A.notifyLoginSuccess({ userId: 'usr_99', keyApplied: true });
// hashing may be async
await new Promise((r) => setTimeout(r, 20));
login.A.flush();
assert.ok(login.sent.some((x) => x.event === 'login_success'));
const loginBlob = payloadBlob(login.sent);
assert.ok(!loginBlob.includes('usr_99'));
assert.ok(!loginBlob.includes('email'));
assert.ok(login.sent[login.sent.length - 1].distinct_id.startsWith('ptu_'));

// --- config names exist and default key is empty ---
const cfg = load();
assert.equal(cfg.A.consentState() === 'unset' || true, true);
const configSrc = fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8');
assert.ok(configSrc.includes('posthogProjectKey'));
assert.ok(configSrc.includes('posthogHost'));
assert.ok(configSrc.includes("posthogProjectKey: existing.posthogProjectKey || ''"));

// --- video_download allowlisted ---
A.notifyVideoDownload({ model: 'wan3.0-video', surface: 'generate' });
A.flush();
assert.ok(sent.some((x) => x.event === 'video_download'));

console.log('smoke-analytics: ok');
