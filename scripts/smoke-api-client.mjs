// Offline request attribution regression checks. No live keys or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL('../js/' + file, import.meta.url), 'utf8');
const requests = [];
const context = vm.createContext({
  setTimeout, clearTimeout, AbortController,
  fetch: async (url, init) => {
    requests.push({ url, init });
    return { status: 200, ok: true, text: async () => '{}' };
  }
});
context.window = context;
for (const file of ['models.js', 'api.js']) vm.runInContext(read(file), context);
const api = context.VSApi;
await api.api('GET', '/v1/models', 'test-key');
await api.api('POST', '/v1/videos', 'test-key', { model: 'test-model' });
await api.api('GET', '/v1/videos/test-task', 'test-key');
await api.apiChatStream('/v1/chat/completions', 'test-key', { messages: [] });
assert.equal(requests.length, 4);
for (const { url, init } of requests) {
  assert.equal(new URL(url).origin, 'https://api.powertokens.ai');
  const headers = new Headers(init.headers);
  assert.equal(headers.get('X-Client'), 'videostudio');
  assert.equal(headers.get('Authorization'), 'Bearer test-key');
  assert.equal(headers.has('User-Agent'), false);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(headers.get('Accept'), url.endsWith('/chat/completions')
    ? 'text/event-stream, application/json' : 'application/json');
  assert.equal(headers.get('Content-Type'), init.method === 'POST' ? 'application/json' : null);
}
assert.equal(JSON.parse(requests[1].init.body).model, 'test-model');
assert.equal(JSON.parse(requests[3].init.body).stream, true);

// These modules own payment and OAuth fetches on powertokens.ai/api.
// Reject any attribution header there, including differently cased spellings.
for (const file of ['payment.js', 'oauth.js']) {
  assert.doesNotMatch(read(file), /x-client/i, file + ' must stay untagged for CORS');
}
// Binary and generic downloads must also stay untagged.
const source = read('api.js');
for (const name of ['fetchContent', 'download']) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0);
  const end = source.indexOf('\n  function ', start + 1);
  assert.doesNotMatch(source.slice(start, end < 0 ? undefined : end), /x-client/i);
}
console.log('smoke-api-client: ok');
