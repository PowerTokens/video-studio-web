/**
 * Smoke: billing outbound forces product UTM even after ad last-touch.
 * Run: node scripts/smoke-utm-billing.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js/utm.js'), 'utf8');

const store = {};
const sandbox = {
  window: {},
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  location: { search: '', href: 'https://studio.example/' },
  URL,
  URLSearchParams,
};
sandbox.window = sandbox;
sandbox.root = sandbox; // unused
vm.createContext(sandbox);
// utm.js expects (window) via IIFE root
vm.runInContext(src.replace('(window);', '(this);'), sandbox);

const U = sandbox.VSUtm;
if (!U) throw new Error('VSUtm missing');

U.captureFromSearch('?utm_source=google&utm_medium=cpc&utm_campaign=sale&gclid=Cj0');
const last = U.lastTouch();
if (last.utm_source !== 'google') throw new Error('last-touch not google: ' + JSON.stringify(last));

const oauth = U.paramsFor(U.CONTENT.oauth);
if (oauth.utm_source !== 'google') throw new Error('oauth should keep last-touch');

const bill = U.paramsFor(U.CONTENT.billing, { forceProduct: true });
if (bill.utm_source !== 'videostudio' || bill.utm_medium !== 'web' || bill.utm_campaign !== 'video-studio') {
  throw new Error('billing must force product: ' + JSON.stringify(bill));
}
if (bill.utm_content !== 'web.billing') throw new Error('billing content');
if (bill.gclid !== 'Cj0') throw new Error('gclid should forward');

const url = U.buildOutbound('https://powertokens.ai/billing', U.CONTENT.billing, { forceProduct: true });
const u = new URL(url);
if (u.searchParams.get('utm_source') !== 'videostudio') throw new Error(url);
if (u.searchParams.get('utm_content') !== 'web.billing') throw new Error(url);
if (u.searchParams.get('gclid') !== 'Cj0') throw new Error(url);

console.log('ok', url);
