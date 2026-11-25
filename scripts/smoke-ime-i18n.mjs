// Offline loader and actual Enter-handler regressions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
for (const page of ['index.html', 'download.html', 'oauth/callback.html']) {
  assert.doesNotMatch(read(page), /<(?:script|link)[^>]*(?:src|href)="(?:\.\.\/)?js\/lang\//);
}
for (const page of ['index.html', 'oauth/callback.html']) {
  const requests = [];
  const ctx = vm.createContext({ URL, document: {
    currentScript: { src: new URL(page === 'index.html' ? 'js/i18n.js' : '../js/i18n.js', 'https://example.com/site/' + page).href },
    createElement: () => ({}),
    head: { appendChild(script) { requests.push(script); } },
  } });
  vm.runInContext(read('js/i18n.js'), ctx);
  const I = ctx.VSI18n;
  assert.equal(I.languages().length, 6);
  assert.equal(I.detectLanguage({ languages: ['ja-JP'] }), 'ja');
  assert.equal(I.detectLanguage({ languages: ['unknown'] }), 'en');
  assert.equal(I.t('ja', 'absent'), 'absent');
  const first = I.load('ja');
  const duplicate = I.load('ja');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].src, 'https://example.com/site/js/lang/ja.js?v=20261125-credit');
  vm.runInContext(read('js/lang/ja.js'), ctx);
  requests[0].onload();
  await Promise.all([first, duplicate]);
  assert.equal(requests.length, 1);
  assert.equal(I.t('ja', 'oauth_callback_return'), 'Video Studio に戻る');
  await I.load('ja');
  assert.equal(requests.length, 1);
  const next = I.load('ko');
  assert.equal(requests.length, 2);
  vm.runInContext(read('js/lang/ko.js'), ctx);
  requests[1].onload();
  await next;
}
for (const [file, id, event] of [['js/app.js', 'key-input', 'ev'], ['js/chat-pilot.js', 'chat-input', 'e']]) {
  const source = read(file);
  const start = source.indexOf("addEventListener('keydown', function (" + event + ")", source.indexOf("$('" + id + "')"));
  assert.ok(start >= 0);
  const body = source.slice(start);
  const match = body.match(/function \((\w+)\) \{([\s\S]*?)\n\s*\}\);/);
  assert.ok(match, file);
  let submits = 0;
  const handler = vm.runInNewContext('(function (' + match[1] + ') {' + match[2] + '})', {
    $: () => ({ click: () => submits++ }), onSend: () => submits++,
  });
  for (const flags of [{ isComposing: true }, { keyCode: 229 }, { isComposing: true, keyCode: 229 }]) {
    handler({ key: 'Enter', ...flags, preventDefault() { assert.fail('composing must retain default'); } });
    assert.equal(submits, 0);
  }
  if (id === 'chat-input') {
    handler({ key: 'Enter', shiftKey: true, preventDefault() { assert.fail('Shift+Enter must retain newline'); } });
    assert.equal(submits, 0);
  }
  let prevented = false;
  handler({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(submits, 1);
  assert.equal(prevented, true);
}
console.log('IME and on-demand i18n smoke checks passed');
