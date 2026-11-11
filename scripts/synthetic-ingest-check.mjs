#!/usr/bin/env node
/**
 * Send marked synthetic events through the real web VSAnalytics client.
 * No paid generation, no real user data. HTTP 200 is not proof of ingestion.
 * Never prints the project token.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import vm from 'vm';
import { webcrypto } from 'crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function publicKey(raw) {
  const key = String(raw || '').trim();
  return /^phc_[A-Za-z0-9_-]{4,}$/.test(key) ? key : '';
}
function officialHost(raw) {
  const host = String(raw || '').trim().replace(/\/$/, '');
  return (host === 'https://us.i.posthog.com' || host === 'https://eu.i.posthog.com') ? host : '';
}
function readDotenv(file) {
  const values = {};
  if (!file || !fs.existsSync(file)) return values;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    values[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}
function redact(obj) {
  if (Array.isArray(obj)) return obj.map(redact);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'api_key' || k === 'token' || k === 'authorization') {
        const raw = String(v || '');
        out[k] = '<redacted-project-key>';
      } else out[k] = redact(v);
    }
    return out;
  }
  if (typeof obj === 'string' && obj.startsWith('phc_')) return '<redacted-project-key>';
  return obj;
}

const args = process.argv.slice(2);
const opt = { environment: 'synthetic', testRunId: '', fromEnvFile: '', out: '' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from-env-file') opt.fromEnvFile = args[++i];
  else if (args[i] === '--out') opt.out = args[++i];
  else if (args[i] === '--test-run-id') opt.testRunId = args[++i];
  else if (args[i] === '--environment') opt.environment = args[++i];
}
if (!opt.out || !opt.testRunId) {
  console.error('usage: synthetic-ingest-check.mjs --out FILE --test-run-id ID [--from-env-file FILE]');
  process.exit(2);
}

const fileVals = readDotenv(opt.fromEnvFile);
const key = publicKey(
  process.env.VS_POSTHOG_PROJECT_KEY
  || fileVals.VS_POSTHOG_PROJECT_KEY
  || fileVals.POSTHOG_PROJECT_KEY
  || fileVals.POSTHOG_PROJECT_TOKEN
);
const host = officialHost(process.env.VS_POSTHOG_HOST || fileVals.VS_POSTHOG_HOST || fileVals.POSTHOG_HOST)
  || 'https://us.i.posthog.com';
if (!key) {
  console.error('synthetic-ingest-check: no public project key; abort');
  process.exit(1);
}

const receipts = [];
const store = {};
const sandbox = {
  window: {},
  globalThis: null,
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  crypto: webcrypto,
  TextEncoder,
  Date, Math, JSON, Uint8Array, Promise, setTimeout, console,
  fetch: async (url, opts) => {
    const parsed = JSON.parse(opts.body);
    const started = Date.now();
    let status = null;
    let bodyText = '';
    let error = null;
    try {
      const res = await fetch(url, {
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
      });
      status = res.status;
      bodyText = await res.text();
      receipts.push({
        client: 'web',
        url,
        http_status: status,
        response_body: bodyText.slice(0, 1000),
        error,
        elapsed_ms: Date.now() - started,
        event: parsed.event,
        distinct_id: parsed.distinct_id,
        timestamp: parsed.timestamp,
        properties: redact(parsed.properties || {}),
        request_body_redacted: redact(parsed),
        note: 'HTTP 200 is not proof of ingestion; confirm this event in the PostHog UI.',
      });
      return {
        ok: res.ok,
        status: res.status,
        json: async () => JSON.parse(bodyText || '{}'),
        text: async () => bodyText,
      };
    } catch (err) {
      error = err && err.name ? err.name : 'Error';
      bodyText = String(err && err.message ? err.message : err);
      receipts.push({
        client: 'web',
        url,
        http_status: status,
        response_body: bodyText.slice(0, 1000),
        error,
        elapsed_ms: Date.now() - started,
        event: parsed.event,
        distinct_id: parsed.distinct_id,
        timestamp: parsed.timestamp,
        properties: redact(parsed.properties || {}),
        request_body_redacted: redact(parsed),
        note: 'HTTP 200 is not proof of ingestion; confirm this event in the PostHog UI.',
      });
      throw err;
    }
  },
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.VS_POSTHOG_PROJECT_KEY = key;
sandbox.VS_POSTHOG_HOST = host;
sandbox.VS_ANALYTICS_ENVIRONMENT = opt.environment;
sandbox.VS_ANALYTICS_TEST_RUN_ID = opt.testRunId;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics-config.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8'), sandbox);
const A = sandbox.VSAnalytics;
A.resetForTests({
  storage: sandbox.localStorage,
  setTimeout: (fn) => { fn(); return 0; },
  appVersion: 'web-1.15-synthetic',
});
A.setConsent(true);
A.notifyLoginSuccess({ keyApplied: false });
const okId = `${opt.testRunId}-ok`;
const failId = `${opt.testRunId}-fail`;
A.notifyGenerationStart(okId, { model: 'synthetic-test-model', surface: 'generate', requestedDurationS: 5 });
A.notifyGenerationFinish(okId, true, { model: 'synthetic-test-model', surface: 'generate', durationMs: 1234 });
A.notifyGenerationStart(failId, { model: 'synthetic-test-model', surface: 'compare' });
A.notifyGenerationFinish(failId, false, { model: 'synthetic-test-model', surface: 'compare', errorCode: 'PARAM' });
A.notifyVideoDownload({ model: 'synthetic-test-model', surface: 'generate' });
A.flush();

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const expected = 7;
const deadline = Date.now() + 20000;
while (Date.now() < deadline && (A.pending().length > 0 || receipts.length < expected)) {
  await waitFor(100);
}

const payload = {
  client: 'web',
  environment: opt.environment,
  test_run_id: opt.testRunId,
  host,
  project_id: process.env.POSTHOG_PROJECT_ID || '728258',
  app_version: 'web-1.15-synthetic',
  distinct_id: (receipts.find((r) => r.distinct_id) || {}).distinct_id || null,
  events: receipts.map((r) => r.event),
  http_statuses: receipts.map((r) => r.http_status),
  pending_after: A.pending().map((item) => item.event),
  note: 'HTTP 200 is not proof of ingestion. Filter PostHog by environment=synthetic and this test_run_id.',
  receipts,
};
fs.mkdirSync(path.dirname(opt.out), { recursive: true });
fs.writeFileSync(opt.out, JSON.stringify(payload, null, 2) + '\n');
console.log(`synthetic-ingest-check web: ${receipts.length} requests, statuses=${JSON.stringify(payload.http_statuses)}, wrote ${opt.out}`);
process.exit(receipts.length && payload.http_statuses.every((s) => s === 200) ? 0 : 1);
