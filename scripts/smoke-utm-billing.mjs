/**
 * Smoke: product exits force Video Studio UTM after an ad last-touch.
 * Signup, OAuth authorize, footer site, and billing/chat_billing force
 * utm_source/medium/campaign. Download content and other touchpoints keep
 * last-touch. Click ids and utm_term still forward.
 * Run: node scripts/smoke-utm-billing.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js/utm.js'), 'utf8');
const oauthSrc = fs.readFileSync(path.join(root, 'js/oauth.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

const store = {};
const session = {};
let assigned = null;
const sandbox = {
  window: {},
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  sessionStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(session, k) ? session[k] : null),
    setItem: (k, v) => { session[k] = String(v); },
    removeItem: (k) => { delete session[k]; },
  },
  location: {
    search: '',
    href: 'https://studio.example/video-studio-web/',
    hostname: 'studio.example',
    origin: 'https://studio.example',
    pathname: '/video-studio-web/',
    assign: (u) => { assigned = String(u); },
  },
  crypto: {
    getRandomValues: (a) => {
      for (let i = 0; i < a.length; i++) a[i] = (i * 17 + 3) & 255;
      return a;
    },
    subtle: {
      digest: () => Promise.resolve(new Uint8Array(32).buffer),
    },
  },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  TextEncoder,
  URL,
  URLSearchParams,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src.replace('(window);', '(this);'), sandbox);

const U = sandbox.VSUtm;
if (!U) throw new Error('VSUtm missing');

const AD = '?utm_source=google&utm_medium=cpc&utm_campaign=sale&utm_term=shoes&utm_content=ad&gclid=Cj0';
U.captureFromSearch(AD);
const last = U.lastTouch();
if (last.utm_source !== 'google') throw new Error('last-touch not google: ' + JSON.stringify(last));
if (last.gclid !== 'Cj0') throw new Error('gclid missing from last-touch');

function assertForced(label, p, content) {
  if (p.utm_source !== 'videostudio' || p.utm_medium !== 'web' || p.utm_campaign !== 'video-studio') {
    throw new Error(label + ' must force product: ' + JSON.stringify(p));
  }
  if (content && p.utm_content !== content) throw new Error(label + ' content: ' + JSON.stringify(p));
  if (p.gclid !== 'Cj0') throw new Error(label + ' should forward gclid: ' + JSON.stringify(p));
  if (p.utm_term !== 'shoes') throw new Error(label + ' should forward utm_term: ' + JSON.stringify(p));
  if (p.utm_source === 'google' || p.utm_medium === 'cpc' || p.utm_campaign === 'sale') {
    throw new Error(label + ' kept ad last-touch: ' + JSON.stringify(p));
  }
}

// Known product exits force even when the caller forgets the flag.
assertForced('oauth', U.paramsFor(U.CONTENT.oauth), 'web.oauth_authorize');
assertForced('signup', U.paramsFor(U.CONTENT.signup), 'web.signup');
assertForced('site', U.paramsFor(U.CONTENT.site), 'web.footer_site');
assertForced('billing', U.paramsFor(U.CONTENT.billing), 'web.billing');
assertForced('chat_billing', U.paramsFor(U.CONTENT.chat_billing), 'web.chat_billing');
assertForced('billing flag', U.paramsFor(U.CONTENT.billing, { forceProduct: true }), 'web.billing');

// Download touchpoint and unknown content keep last-touch (EXE URL is not tagged).
const dl = U.paramsFor(U.CONTENT.download);
if (dl.utm_source !== 'google' || dl.utm_medium !== 'cpc' || dl.gclid !== 'Cj0') {
  throw new Error('download content must keep last-touch: ' + JSON.stringify(dl));
}
const other = U.paramsFor('web.other');
if (other.utm_source !== 'google') throw new Error('unknown content should keep last-touch');
const forcedOther = U.paramsFor('web.other', { forceProduct: true });
assertForced('explicit flag', forcedOther, 'web.other');

function assertUrl(label, url, content) {
  const u = new URL(url);
  const p = {};
  u.searchParams.forEach((v, k) => { p[k] = v; });
  assertForced(label, p, content);
  if (u.searchParams.get('utm_source') === 'google') throw new Error(label + ' url kept google: ' + url);
  return u;
}

const signup = assertUrl(
  'signup url',
  U.buildOutbound('https://powertokens.ai/api-keys?utm_source=google&utm_medium=cpc', U.CONTENT.signup),
  'web.signup'
);
if (signup.origin + signup.pathname !== 'https://powertokens.ai/api-keys') throw new Error(signup.toString());

const signupZh = assertUrl(
  'signup zh',
  U.buildOutbound('https://powertokens.ai/zh-Hans/api-keys', U.CONTENT.signup, { forceProduct: true }),
  'web.signup'
);
if (!signupZh.pathname.endsWith('/zh-Hans/api-keys')) throw new Error(signupZh.toString());

const site = assertUrl(
  'footer',
  U.buildOutbound('https://powertokens.ai/zh-Hans', U.CONTENT.site, { forceProduct: true }),
  'web.footer_site'
);
if (site.pathname !== '/zh-Hans') throw new Error(site.toString());

const bill = assertUrl(
  'billing url',
  U.buildOutbound('https://powertokens.ai/billing', U.CONTENT.billing, { forceProduct: true }),
  'web.billing'
);
if (bill.pathname !== '/billing') throw new Error(bill.toString());

// Authorize navigation (oauth.js) must force, including when last-touch is an ad.
vm.runInContext(oauthSrc.replace('(window);', '(this);'), sandbox);
if (!sandbox.VSOauth || typeof sandbox.VSOauth.startLogin !== 'function') throw new Error('VSOauth missing');
await sandbox.VSOauth.startLogin();
if (!assigned) throw new Error('startLogin did not navigate');
const auth = assertUrl('authorize', assigned, 'web.oauth_authorize');
if (auth.origin + auth.pathname !== 'https://www.powertokens.ai/oauth/authorize') throw new Error(assigned);
if (!auth.searchParams.get('client_id') || !auth.searchParams.get('code_challenge')) {
  throw new Error('authorize missing oauth params: ' + assigned);
}
if (assigned.includes('utm_source=google') || assigned.includes('utm_campaign=sale')) {
  throw new Error('authorize kept ad utm: ' + assigned);
}

// app.js must force every PowerTokens outbound key, not only billing.
if (/key === ['"]billing_url['"]/.test(appSrc)) {
  throw new Error('app.js still forces product UTM for billing only');
}
if (!/Object\.assign\(\{\s*forceProduct:\s*true\s*\}/.test(appSrc)) {
  throw new Error('buildPtOutbound must default forceProduct');
}
if (!/signup_url: 'web\.signup'/.test(appSrc) || !/site_url: 'web\.footer_site'/.test(appSrc)) {
  throw new Error('signup/site content tags missing');
}
const oauthCall = oauthSrc.slice(oauthSrc.indexOf('applyToSearchParams'));
if (!/forceProduct:\s*true/.test(oauthCall)) throw new Error('oauth authorize must pass forceProduct');

console.log('ok signup', signup.toString());
console.log('ok authorize', auth.origin + auth.pathname + '?' + auth.searchParams.toString());
console.log('ok footer', site.toString());
console.log('ok billing', bill.toString());
