/**
 * PowerTokens API fetches ask for User-Agent: videostudio.
 * Asserts the header passed into fetch(). Browsers override User-Agent on the
 * wire (forbidden request header) and still send the browser UA; Node and the
 * desktop urllib client can send a custom User-Agent for sure.
 * Video CDN downloads and non-API powertokens.ai pages are left unchanged.
 * UTM outbound links are navigations and are not touched.
 *
 * Run: node scripts/smoke-client-ua.mjs
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utmSrc = fs.readFileSync(path.join(root, 'js/utm.js'), 'utf8');
assert.equal(utmSrc.includes('User-Agent'), false);
assert.match(utmSrc, /utm_source:\s*'videostudio'/);
assert.match(utmSrc, /utm_medium:\s*'web'/);

const calls = [];
function jsonResponse(obj, status) {
  const body = JSON.stringify(obj);
  return {
    ok: (status || 200) >= 200 && (status || 200) < 300,
    status: status || 200,
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(body),
    blob: () => Promise.resolve({ size: 4 })
  };
}

const store = {};
const session = {};
const sandbox = {
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  sessionStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(session, k) ? session[k] : null),
    setItem: (k, v) => { session[k] = String(v); },
    removeItem: (k) => { delete session[k]; }
  },
  location: {
    search: '',
    href: 'https://powertokens.github.io/video-studio-web/',
    hostname: 'powertokens.github.io',
    origin: 'https://powertokens.github.io',
    pathname: '/video-studio-web/'
  },
  URL,
  URLSearchParams,
  Headers,
  AbortController,
  TextDecoder,
  TextEncoder,
  Promise,
  setTimeout,
  clearTimeout,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  crypto: {
    getRandomValues: (a) => {
      for (let i = 0; i < a.length; i++) a[i] = (i * 17 + 3) & 255;
      return a;
    },
    subtle: { digest: () => Promise.resolve(new Uint8Array(32).buffer) }
  },
  fetch: (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const u = String(url);
    if (u.includes('/oauth/token')) {
      return Promise.resolve(jsonResponse({ access_token: 'at-test', token_type: 'Bearer', expires_in: 1800 }));
    }
    if (u.includes('/oauth/userinfo')) {
      return Promise.resolve(jsonResponse({ sub: 'user', email: 'a@example.com', credits: 3 }));
    }
    if (u.includes('/oauth/revoke')) return Promise.resolve(jsonResponse({}));
    if (u.includes('cdn.example')) return Promise.resolve(jsonResponse({}, 404));
    if (u.includes('/chat/completions')) {
      return Promise.resolve(jsonResponse({
        choices: [{ message: { content: 'hello' } }]
      }));
    }
    return Promise.resolve(jsonResponse({ object: 'list', data: [] }));
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/models.js'), 'utf8'), sandbox, { filename: 'js/models.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'js/api.js'), 'utf8'), sandbox, { filename: 'js/api.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'js/utm.js'), 'utf8'), sandbox, { filename: 'js/utm.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'js/oauth.js'), 'utf8'), sandbox, { filename: 'js/oauth.js' });

const A = sandbox.VSApi;
assert.equal(A.CLIENT_USER_AGENT, 'videostudio');

function uaOf(call) {
  const h = call.init.headers || {};
  return h['User-Agent'] || h['user-agent'] || '';
}

function assertApiCall(label, call) {
  assert.equal(uaOf(call), 'videostudio', label + ' User-Agent: ' + JSON.stringify(call));
  const auth = call.init.headers.Authorization || call.init.headers.authorization || '';
  assert.match(auth, /^Bearer /, label + ' must keep Authorization');
}

calls.length = 0;
const verified = await A.verifyKey('sk-test-key');
assert.equal(verified.ok, true);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'https://api.powertokens.ai/v1/models');
assertApiCall('verifyKey', calls[0]);

calls.length = 0;
const chat = await A.apiChatStream('/v1/chat/completions', 'sk-test-key', { model: 'glm-4.7-flash', messages: [] }, 1000, function () {});
assert.equal(chat.content, 'hello');
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'https://api.powertokens.ai/v1/chat/completions');
assertApiCall('chat', calls[0]);
assert.equal(calls[0].init.headers['Content-Type'], 'application/json');

calls.length = 0;
A.store.set('tasks', [{
  local_id: 'loc1',
  task_id: 'task_1',
  family: 'wan',
  state: 'running'
}]);
await A.fetchContent('loc1', 'sk-test-key');
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'https://api.powertokens.ai/v1/videos/task_1/content');
assertApiCall('content', calls[0]);

calls.length = 0;
await A.ptFetch('https://api.powertokens.ai/v1/models', {
  headers: { 'User-Agent': 'spoofed', Accept: 'application/json' }
});
assert.equal(uaOf(calls[0]), 'videostudio');
assert.equal(calls[0].init.headers.Accept, 'application/json');

calls.length = 0;
await A.download('https://cdn.example/clip.mp4', 'clip.mp4');
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'https://cdn.example/clip.mp4');
assert.equal(uaOf(calls[0]), '', 'CDN download must not set User-Agent');
assert.equal(calls[0].init.headers, undefined);

calls.length = 0;
await A.ptFetch('https://powertokens.ai/billing?utm_source=videostudio&utm_medium=web');
assert.equal(uaOf(calls[0]), '');
assert.equal(A.isPowerTokensApiUrl('https://powertokens.ai/zh-Hans/api-keys'), false);
assert.equal(A.isPowerTokensApiUrl('https://www.powertokens.ai/oauth/authorize'), false);
assert.equal(A.isPowerTokensApiUrl('https://docs.powertokens.ai/en/zmodelVideo/wan'), false);
assert.equal(A.isPowerTokensApiUrl('https://api.powertokens.ai.evil.example/v1/models'), false);
assert.equal(A.isPowerTokensApiUrl('https://api.powertokens.ai/v1/videos'), true);
assert.equal(A.isPowerTokensApiUrl('https://powertokens.ai/api/oauth/token'), true);

calls.length = 0;
sandbox.sessionStorage.setItem('vsw.oauth.state', 'state1');
sandbox.sessionStorage.setItem('vsw.oauth.code_verifier', 'verifier1');
const cb = await sandbox.VSOauth.handleCallback('?code=authcode&state=state1');
assert.equal(cb.ok, true);
const oauthCalls = calls.filter((c) => c.url.startsWith('https://powertokens.ai/api/'));
assert.equal(oauthCalls.length, 2);
assert.equal(oauthCalls[0].url, 'https://powertokens.ai/api/oauth/token');
assert.equal(oauthCalls[1].url, 'https://powertokens.ai/api/oauth/userinfo');
oauthCalls.forEach((c, i) => assert.equal(uaOf(c), 'videostudio', 'oauth ' + i));
assert.match(oauthCalls[1].init.headers.Authorization, /^Bearer /);

calls.length = 0;
await sandbox.VSOauth.logout();
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'https://powertokens.ai/api/oauth/revoke');
assert.equal(uaOf(calls[0]), 'videostudio');

console.log('smoke-client-ua: ok');
