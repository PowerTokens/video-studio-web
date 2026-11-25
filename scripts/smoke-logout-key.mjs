// Offline source ownership regression; only obvious fake credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = f => fs.readFileSync(new URL('../js/' + f, import.meta.url), 'utf8');
for (const fallback of [false, true]) for (const manual of ['none', 'before', 'after', 'other']) {
  const data = new Map([
    ['vsw.oauth.state', 'fake-state'], ['vsw.oauth.code_verifier', 'fake-verifier']]);
  const session = new Map([
    ['vsw.oauth.state', 'fake-state']]);
  const storage = map => ({getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k)});
  let submits = 0;
  const c = vm.createContext({URL, URLSearchParams, setTimeout, clearTimeout, AbortController,
    localStorage: storage(data), sessionStorage: storage(session),
    location: {search: '', href: 'https://example.com/oauth/callback.html'},
    fetch: async url => {
      if (url.includes('/v1/videos')) submits++;
      const body = url.includes('/token') ? {access_token:'fake-token', expires_in:3600} : url.includes('/userinfo') ? {key:'fake-login-key', name:'Fake'} : {};
      return {ok:true, status:200, text:async()=>JSON.stringify(body), json:async()=>body};
    }});
  c.window = c;
  for (const f of ['models.js','api.js','oauth.js']) vm.runInContext(read(f),c);
  const api = c.VSApi;
  if (manual === 'before') api.saveKey('fake-login-key');
  if (manual === 'other') api.saveKey('fake-pasted-key');
  if (fallback) c.VSApi = undefined;
  assert.ok((await c.VSOauth.handleCallback('?code=fake-code&state=fake-state')).keyApplied);
  c.VSApi = api;
  assert.ok(api.getKey() === 'fake-login-key');
  await api.api('POST','/v1/videos',api.getKey(),{});
  assert.equal(submits,1);
  if (manual === 'after') api.saveKey('fake-login-key');
  await c.VSOauth.logout();
  assert.ok(!c.VSOauth.getProfile());
  assert.ok(!c.VSOauth.getAccessToken());
  const expected = manual === 'none' ? '' : manual === 'other' ? 'fake-pasted-key' : 'fake-login-key';
  assert.ok(api.getKey() === expected);
  if (manual === 'none') {
    // Execute the real Generate handler through its missing-key early return.
    const app = read('app.js');
    const start = app.indexOf('  async function submitGen() {');
    const end = app.indexOf('\n  function ', start + 1);
    let prompted = false;
    c.A = api; c.genBusy = false; c.clearAiPlanReview = () => {};
    c.$ = () => ({}); c.show = () => {};
    c.promptForKeyOrLogin = () => { prompted = true; };
    vm.runInContext(app.slice(start, end) + '\nsubmitGen();', c);
    assert.ok(prompted);
  }
  if (api.getKey()) await api.api('POST','/v1/videos',api.getKey(),{});
  assert.equal(submits, manual === 'none' ? 1 : 2);
}
console.log('smoke-logout-key: ok');
