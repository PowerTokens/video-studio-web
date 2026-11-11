/**
 * Smoke: download jump defaults + preserves inbound last-touch.
 * Run: node scripts/smoke-download-jump.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import assert from 'assert';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utmSrc = fs.readFileSync(path.join(root, 'js/utm.js'), 'utf8');
const jumpSrc = fs.readFileSync(path.join(root, 'js/download-jump.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'download.html'), 'utf8');

assert.ok(!/http-equiv="refresh"/i.test(html), 'download page must not meta-refresh (it would send Mac users the EXE)');
assert.ok(html.includes('PowerTokensVideoStudio.exe'));
assert.ok(html.includes('PowerTokensVideoStudio-macOS-arm64.dmg'));
assert.ok(html.includes('PowerTokensVideoStudio-macOS-arm64.app.zip'));
assert.ok(html.includes('Beta'));
assert.ok(html.includes('仍要打开') || html.includes('无法验证开发者'));
assert.ok(html.includes('Open Anyway'));

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

console.log('ok', organic.replaced);
