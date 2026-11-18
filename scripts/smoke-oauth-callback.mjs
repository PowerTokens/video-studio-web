// Offline callback regression checks. Run with node scripts/smoke-oauth-callback.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const html = read('oauth/callback.html');
assert.doesNotMatch(html + read('js/oauth-callback.js'), /close this tab|you can leave|window\.close/i);
assert.match(html, /<button id="back-link" type="button">/);
assert.match(read('css/oauth-callback.css'), /min-height: 48px/);
assert.match(html, /script-src 'self';/);
assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);
const scripts = [...html.matchAll(/<script src="\.\.\/(.*?)"><\/script>/g)].map((m) => m[1]);
for (const script of scripts.filter((s) => /i18n|lang\/|oauth-callback/.test(s))) {
  assert.match(script, /\?v=/);
}

async function run(lang, outcome, returnHash = 'tasks', missingModule = false) {
  const elements = Object.fromEntries(['title', 'msg', 'back', 'back-link', 'progress'].map((id) => [id, {
    textContent: '', hidden: id === 'back' || id === 'msg', addEventListener(event, handler) { this[event] = handler; },
  }]));
  const navigations = [];
  const pending = { 'vsw.oauth.return_hash': returnHash };
  const context = vm.createContext({
    URL, URLSearchParams, console,
    localStorage: { getItem() { if (lang === '"blocked"') throw new Error('blocked'); return lang; } },
    sessionStorage: {
      getItem: (key) => pending[key] || null,
      removeItem: (key) => { delete pending[key]; },
    },
    document: {
      currentScript: { src: 'https://example.com/video-studio-web/js/i18n.js' },
      createElement: () => ({}),
      head: { appendChild(script) {
        assert.match(script.src, /^https:\/\/example.com\/video-studio-web\/js\/lang\/.*\?v=/);
        vm.runInContext(read('js/lang/' + /lang\/(\w+\.js)/.exec(script.src)[1]), context);
        script.onload();
      } },
      documentElement: {}, getElementById: (id) => elements[id]
    },
    location: {
      href: 'https://example.com/video-studio-web/oauth/callback.html?error=access_denied',
      search: '?error=access_denied', replace: (url) => navigations.push(url),
    },
  });
  context.window = context;
  for (const script of scripts.filter((s) => /i18n|lang\/|oauth\.js/.test(s.split('?')[0]))) {
    vm.runInContext(read(script.split('?')[0]), context);
  }
  if (missingModule) context.VSOauth = null;
  else context.VSOauth.handleCallback = () => outcome === 'reject'
    ? Promise.reject(new Error('network')) : Promise.resolve({ ok: outcome === 'success' });
  vm.runInContext(read('js/oauth-callback.js'), context);
  await new Promise(setImmediate);
  const resolved = ['zh', 'en', 'es', 'pt', 'ja', 'ko'].includes(JSON.parse(lang || 'null')) ? JSON.parse(lang) : 'en';
  const t = (key) => context.VSI18n.t(resolved, key);
  assert.equal(context.document.documentElement.lang, context.VSI18n.meta(resolved).htmlLang);
  if (!missingModule && outcome === 'success') {
    assert.equal(elements.title.textContent, t('oauth_callback_returning'));
    assert.equal(elements.msg.hidden, true);
    assert.equal(elements.progress.hidden, false);
  }
  await new Promise(setImmediate);
  if (outcome === 'success' && !missingModule) {
    assert.equal(elements.msg.textContent, t('oauth_callback_returning'));
    assert.deepEqual(navigations, ['https://example.com/video-studio-web/#' + (returnHash || 'generate')]);
  } else {
    assert.equal(elements.title.textContent, t('oauth_callback_failed'));
    assert.equal(elements.msg.textContent, t('oauth_callback_failure_message'));
    assert.equal(elements.back.hidden, false);
    assert.equal(elements.msg.hidden, false);
    assert.equal(elements.progress.hidden, true);
    assert.equal(elements['back-link'].textContent, t('oauth_callback_return'));
    assert.deepEqual(navigations, []);
    elements['back-link'].click();
    assert.deepEqual(navigations, [missingModule ? '../' : 'https://example.com/video-studio-web/' + (returnHash ? '#' + returnHash : '#generate')]);
  }
}
for (const lang of ['zh', 'en', 'es', 'pt', 'ja', 'ko']) {
  for (const outcome of ['success', 'failure', 'reject']) await run(JSON.stringify(lang), outcome);
}
for (const lang of [null, '"unknown"', '"blocked"']) await run(lang, 'failure', null);
await run('"en"', 'failure', null, true);
console.log('OAuth callback smoke checks passed');
