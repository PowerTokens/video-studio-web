/**
 * Smoke: download jump defaults + preserves inbound last-touch.
 * Run: node scripts/smoke-download-jump.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utmSrc = fs.readFileSync(path.join(root, 'js/utm.js'), 'utf8');
const jumpSrc = fs.readFileSync(path.join(root, 'js/download-jump.js'), 'utf8');

function run(search) {
  const store = {};
  let replaced = null;
  const sandbox = {
    window: {},
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
  vm.createContext(sandbox);
  vm.runInContext(utmSrc.replace('(window);', '(this);'), sandbox);
  // download-jump uses window.VSUtm / window.location / window.localStorage
  vm.runInContext(jumpSrc, sandbox);
  return { U: sandbox.VSUtm, replaced, store, last: sandbox.VSUtm.lastTouch() };
}

const organic = run('');
if (!organic.replaced || !organic.replaced.includes('PowerTokensVideoStudio.exe')) {
  throw new Error('organic must redirect to EXE: ' + organic.replaced);
}
if (organic.replaced.includes('utm_')) throw new Error('EXE URL must not carry UTM');
if (organic.last.utm_source !== 'videostudio') throw new Error(JSON.stringify(organic.last));
if (organic.last.utm_content !== 'web.download_jump') throw new Error(JSON.stringify(organic.last));

const ad = run('?utm_source=google&utm_medium=cpc&utm_campaign=sale&gclid=Cj0');
if (ad.last.utm_source !== 'google' || ad.last.gclid !== 'Cj0') throw new Error(JSON.stringify(ad.last));
if (ad.last.utm_content !== 'web.download_jump') throw new Error('missing content: ' + JSON.stringify(ad.last));
if (ad.replaced.includes('utm_')) throw new Error('ad path EXE must not carry UTM');

console.log('ok', organic.replaced);
