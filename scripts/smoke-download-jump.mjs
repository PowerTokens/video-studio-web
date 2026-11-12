/**
 * Smoke: download jump defaults + preserves inbound last-touch,
 * plus download-page i18n (saved lang, browser detect, switcher).
 * Run: node scripts/smoke-download-jump.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import assert from 'assert';
import { setTimeout as sleep } from 'timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utmSrc = fs.readFileSync(path.join(root, 'js/utm.js'), 'utf8');
const jumpSrc = fs.readFileSync(path.join(root, 'js/download-jump.js'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(root, 'js/i18n.js'), 'utf8');
const downloadI18nSrc = fs.readFileSync(path.join(root, 'js/download-i18n.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'download.html'), 'utf8');

const LANG_CODES = ['en', 'zh', 'ja', 'ko', 'pt', 'es'];
const LANG_SRCS = Object.fromEntries(
  LANG_CODES.map((code) => [
    code,
    fs.readFileSync(path.join(root, `js/lang/${code}.js`), 'utf8'),
  ])
);

const DL_KEYS = [
  'dl_page_title',
  'dl_heading',
  'dl_lead',
  'dl_win_heading',
  'dl_win_note',
  'dl_win_desc',
  'dl_win_link',
  'dl_mac_heading',
  'dl_badge_beta',
  'dl_mac_intro',
  'dl_mac_dmg',
  'dl_mac_zip',
  'dl_mac_dmg_hint',
  'dl_mac_gatekeeper',
  'dl_mac_step_finder',
  'dl_mac_step_settings',
  'dl_footer_releases',
  'dl_footer_web',
  'dl_lang_label',
];

assert.ok(!/http-equiv="refresh"/i.test(html), 'download page must not meta-refresh (it would send Mac users the EXE)');
assert.ok(html.includes('PowerTokensVideoStudio.exe'));
assert.ok(html.includes('PowerTokensVideoStudio-macOS-arm64.dmg'));
assert.ok(html.includes('PowerTokensVideoStudio-macOS-arm64.app.zip'));
assert.ok(html.includes('>PowerTokensVideoStudio.dmg</a>'), 'Mac DMG link text should be the shortened filename');
assert.ok(html.includes('>PowerTokensVideoStudio.app.zip</a>'), 'Mac zip link text should be the shortened filename');
assert.ok(!/Download \.dmg|下载 \.dmg/.test(html), 'Mac links must not use “Download .dmg” wording');
assert.ok(html.includes('Beta'));
assert.ok(/<html lang="en">/.test(html), 'HTML default language must be English');
assert.ok(!/<html lang="zh-Hans">/.test(html), 'HTML must not be hardcoded Chinese');
assert.ok(!/English: this is an unsigned Beta/.test(html), 'always-on English Gatekeeper footnote should be gone');
assert.ok(
  html.includes('Open Anyway') || LANG_SRCS.en.includes('Open Anyway'),
  'English Gatekeeper wording must be in the HTML default or en.js'
);
assert.ok(
  LANG_SRCS.zh.includes('仍要打开') || LANG_SRCS.zh.includes('无法验证开发者'),
  'Chinese Gatekeeper wording must be in zh.js'
);
assert.ok(html.includes('js/download-i18n.js'), 'download page must load download-i18n.js');
assert.ok(html.includes("script-src 'self'"), 'CSP must keep script-src self (no inline scripts)');

const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function run(search, userAgent) {
  const store = {};
  let replaced = null;
  const body = { className: '' };
  const sandbox = {
    window: {},
    document: { body },
    navigator: { userAgent: userAgent || WIN_UA, platform: /Macintosh/.test(userAgent || '') ? 'MacIntel' : (/iPhone/.test(userAgent || '') ? 'iPhone' : 'Win32') },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    location: {
      search: search || '',
      href: 'https://powertokens.github.io/video-studio-web/download.html' + (search || ''),
      replace: (u) => { replaced = u; },
    },
    URL,
    URLSearchParams,
  };
  sandbox.window = sandbox;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.location = sandbox.location;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(utmSrc.replace('(window);', '(this);'), sandbox);
  vm.runInContext(jumpSrc, sandbox);
  return { U: sandbox.VSUtm, replaced, store, last: sandbox.VSUtm.lastTouch(), className: body.className };
}

const organic = run('');
if (!organic.replaced || !organic.replaced.includes('PowerTokensVideoStudio.exe')) {
  throw new Error('Windows must redirect to EXE: ' + organic.replaced);
}
if (organic.replaced.includes('utm_')) throw new Error('EXE URL must not carry UTM');
if (organic.last.utm_source !== 'videostudio') throw new Error(JSON.stringify(organic.last));
if (organic.last.utm_content !== 'web.download_jump') throw new Error(JSON.stringify(organic.last));
if (!organic.className.includes('is-windows')) throw new Error('Windows class: ' + organic.className);

const ad = run('?utm_source=google&utm_medium=cpc&utm_campaign=sale&gclid=Cj0');
if (ad.last.utm_source !== 'google' || ad.last.gclid !== 'Cj0') throw new Error(JSON.stringify(ad.last));
if (ad.last.utm_content !== 'web.download_jump') throw new Error('missing content: ' + JSON.stringify(ad.last));
if (ad.replaced.includes('utm_')) throw new Error('ad path EXE must not carry UTM');

const mac = run('', MAC_UA);
if (mac.replaced) throw new Error('Mac must stay on the page, got ' + mac.replaced);
if (!mac.className.includes('is-mac')) throw new Error('Mac class: ' + mac.className);
if (mac.last.utm_source !== 'videostudio') throw new Error(JSON.stringify(mac.last));

const ios = run('', IOS_UA);
if (ios.replaced) throw new Error('iOS must stay on the page, got ' + ios.replaced);
if (ios.className.includes('is-mac') || ios.className.includes('is-windows')) {
  throw new Error('iOS should not be treated as desktop: ' + ios.className);
}

function classListFor(el) {
  return {
    add: function () {
      const cur = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
      for (let i = 0; i < arguments.length; i++) cur.add(arguments[i]);
      el.className = Array.from(cur).join(' ');
    },
    contains: function (c) {
      return String(el.className || '').split(/\s+/).includes(c);
    },
  };
}

function collectAttr(source, attr) {
  const out = [];
  const re = new RegExp(attr + '="([^"]+)"', 'g');
  let m;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

function makeDocument() {
  const i18nNodes = collectAttr(html, 'data-i18n').map((key) => ({
    getAttribute: () => key,
    textContent: '',
  }));
  const htmlNodes = collectAttr(html, 'data-i18n-html').map((key) => ({
    getAttribute: () => key,
    innerHTML: '',
    textContent: '',
  }));

  const options = [];
  const listeners = {};
  const select = {
    tagName: 'SELECT',
    id: 'lang-select',
    options,
    value: '',
    attributes: { 'aria-label': 'Language' },
    getAttribute(k) { return this.attributes[k]; },
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    dispatchEvent(evt) {
      (listeners[evt.type] || []).forEach((fn) => fn(evt));
      return true;
    },
    appendChild(child) {
      options.push(child);
      return child;
    },
    set innerHTML(v) {
      if (v === '') options.length = 0;
    },
    get innerHTML() { return ''; },
  };

  const body = { className: '' };
  body.classList = classListFor(body);
  const documentElement = { lang: 'en' };

  const document = {
    body,
    documentElement,
    title: '',
    getElementById(id) { return id === 'lang-select' ? select : null; },
    querySelectorAll(sel) {
      if (sel === '[data-i18n]') return i18nNodes;
      if (sel === '[data-i18n-html]') return htmlNodes;
      return [];
    },
    createElement(tag) {
      return { tagName: String(tag).toUpperCase(), value: '', textContent: '' };
    },
  };
  return { document, body, documentElement, select, i18nNodes, htmlNodes };
}

function runI18n(opts) {
  const search = opts.search || '';
  const languages = opts.languages || ['en-US'];
  const language = opts.language || languages[0];
  const store = Object.assign({}, opts.store || {});
  const languageSet = [];
  const dom = makeDocument();
  const sandbox = {
    window: {},
    document: dom.document,
    navigator: { languages, language, userAgent: MAC_UA, platform: 'MacIntel' },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    location: {
      search,
      href: 'https://powertokens.github.io/video-studio-web/download.html' + search,
    },
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.location = sandbox.location;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.document = sandbox.document;
  sandbox.window.VSAnalytics = {
    notifyLanguageSet: (code) => { languageSet.push(code); },
  };
  sandbox.window.setTimeout = setTimeout;
  sandbox.window.clearTimeout = clearTimeout;
  vm.createContext(sandbox);
  vm.runInContext(i18nSrc, sandbox);
  for (const code of LANG_CODES) vm.runInContext(LANG_SRCS[code], sandbox);
  vm.runInContext(downloadI18nSrc, sandbox);
  return {
    I: sandbox.VSI18n,
    store,
    languageSet,
    documentElement: dom.documentElement,
    title: sandbox.document.title,
    body: dom.body,
    select: dom.select,
    i18nNodes: dom.i18nNodes,
    htmlNodes: dom.htmlNodes,
  };
}

function textFor(result, key) {
  const node = result.i18nNodes.find((n) => n.getAttribute() === key);
  return node ? node.textContent : undefined;
}

// All six language files register the new download keys.
{
  const probe = runI18n({ languages: ['en'] });
  for (const code of LANG_CODES) {
    assert.ok(probe.I.has(code), 'missing language: ' + code);
    for (const key of DL_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(probe.I.STRINGS[code], key),
        code + ' is missing ' + key
      );
    }
    assert.equal(probe.I.STRINGS[code].dl_mac_dmg, 'PowerTokensVideoStudio.dmg', code + ' dmg label');
    assert.equal(probe.I.STRINGS[code].dl_mac_zip, 'PowerTokensVideoStudio.app.zip', code + ' zip label');
    assert.equal(probe.I.STRINGS[code].dl_win_link, 'PowerTokensVideoStudio.exe', code + ' exe label');
  }
}

// Saved vsw.lang wins over the browser language; first detect does not notify.
{
  const saved = runI18n({
    languages: ['zh-CN', 'en'],
    store: { 'vsw.lang': JSON.stringify('ja') },
  });
  assert.equal(saved.documentElement.lang, 'ja');
  assert.equal(saved.title, saved.I.t('ja', 'dl_page_title'));
  assert.equal(textFor(saved, 'dl_heading'), saved.I.t('ja', 'dl_heading'));
  assert.equal(saved.select.value, 'ja');
  assert.ok(saved.body.className.includes('is-ready'));
  assert.deepEqual(saved.languageSet, [], 'detect must not call notifyLanguageSet');
  assert.equal(saved.store['vsw.lang'], JSON.stringify('ja'), 'saved preference must stay intact on detect');
}

// Browser zh-CN picks zh when nothing is saved.
{
  const zh = runI18n({ languages: ['zh-CN', 'en'] });
  assert.equal(zh.documentElement.lang, 'zh-CN');
  assert.equal(textFor(zh, 'dl_heading'), zh.I.t('zh', 'dl_heading'));
  assert.ok(textFor(zh, 'dl_mac_step_settings').includes('仍要打开'));
  assert.ok(
    zh.htmlNodes[0].innerHTML.includes('无法验证开发者') ||
      zh.htmlNodes[0].innerHTML.includes('应用程序')
  );
  assert.deepEqual(zh.languageSet, []);
  assert.ok(!Object.prototype.hasOwnProperty.call(zh.store, 'vsw.lang'), 'detect must not write vsw.lang');
}

// Unknown browser language falls back to English.
{
  const unk = runI18n({ languages: ['xx-YY', 'qq'] });
  assert.equal(unk.documentElement.lang, 'en');
  assert.equal(textFor(unk, 'dl_heading'), unk.I.t('en', 'dl_heading'));
  assert.ok(textFor(unk, 'dl_mac_step_settings').includes('Open Anyway'));
}

// Invalid saved value is ignored; browser language is used instead.
{
  const invalid = runI18n({
    languages: ['ko-KR'],
    store: { 'vsw.lang': JSON.stringify('xx') },
  });
  assert.equal(invalid.documentElement.lang, 'ko');
  assert.equal(textFor(invalid, 'dl_heading'), invalid.I.t('ko', 'dl_heading'));
}

// ?mock=1 reads and writes vsw.mock.lang, not vsw.lang.
{
  const mock = runI18n({
    search: '?mock=1',
    languages: ['en-US'],
    store: { 'vsw.mock.lang': JSON.stringify('es') },
  });
  assert.equal(mock.documentElement.lang, 'es');
  assert.ok(!Object.prototype.hasOwnProperty.call(mock.store, 'vsw.lang'));
}

// Language switcher persists vsw.lang (JSON) and notifies only on a user change.
const sw = runI18n({ languages: ['en-US'] });
assert.equal(sw.documentElement.lang, 'en');
assert.deepEqual(
  sw.select.options.map((o) => o.value).sort(),
  LANG_CODES.slice().sort()
);
sw.select.value = 'zh';
sw.select.dispatchEvent({ type: 'change' });
await sleep(10);
assert.equal(sw.store['vsw.lang'], JSON.stringify('zh'));
assert.equal(sw.documentElement.lang, 'zh-CN');
assert.equal(textFor(sw, 'dl_heading'), sw.I.t('zh', 'dl_heading'));
assert.deepEqual(sw.languageSet, ['zh']);

// A same-language event must not notify again or rewrite storage with a different encoding.
sw.select.value = 'zh';
sw.select.dispatchEvent({ type: 'change' });
await sleep(10);
assert.deepEqual(sw.languageSet, ['zh']);
assert.equal(sw.store['vsw.lang'], JSON.stringify('zh'));

console.log('ok', organic.replaced);
