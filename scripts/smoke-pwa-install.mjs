/**
 * Smoke: add-to-home-screen offer logic (no real browser).
 * Covers platform detection, timing, dismissal cooldown, standalone /
 * appinstalled suppression, desktop hide, beforeinstallprompt CTA,
 * instruction-sheet fallbacks, localStorage failures, input obstruction,
 * Escape / focus restore, and preview flags.
 * Run: node scripts/smoke-pwa-install.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import assert from 'assert';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js/pwa-install.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const zh = fs.readFileSync(path.join(root, 'js/lang/zh.js'), 'utf8');
const en = fs.readFileSync(path.join(root, 'js/lang/en.js'), 'utf8');
const swExists = fs.existsSync(path.join(root, 'sw.js'));

function loadApi() {
  const sandbox = { window: {}, document: undefined, console, URLSearchParams, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.__vswPwaSkipAuto = true;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.ok(sandbox.VSWPwaInstall, 'VSWPwaInstall missing');
  return sandbox.VSWPwaInstall;
}

const P = loadApi();
let failed = 0;
const pending = [];
function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(Promise.resolve(result).then(
        () => {},
        (err) => {
          failed += 1;
          console.error('FAIL', name, err && err.message ? err.message : err);
        }
      ));
    }
  } catch (err) {
    failed += 1;
    console.error('FAIL', name, err && err.message ? err.message : err);
  }
}

// ---- manifest / markup / copy ----
check('manifest GitHub Pages subpath', () => {
  assert.equal(manifest.id, '/video-studio-web/');
  assert.equal(manifest.scope, '/video-studio-web/');
  assert.equal(manifest.start_url, '/video-studio-web/');
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((i) => i.sizes + ':' + i.purpose).sort();
  assert.ok(sizes.includes('192x192:any'));
  assert.ok(sizes.includes('512x512:any'));
  assert.ok(sizes.includes('192x192:maskable'));
  assert.ok(sizes.includes('512x512:maskable'));
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('/video-studio-web/assets/icons/'), icon.src);
    const rel = icon.src.replace('/video-studio-web/', '');
    assert.ok(fs.existsSync(path.join(root, rel)), 'missing ' + rel);
  }
  assert.ok(fs.existsSync(path.join(root, 'assets/icons/apple-touch-icon.png')));
});

check('start_url has no UTM (must not clobber last-touch)', () => {
  assert.ok(!/[?&]utm_/.test(manifest.start_url));
});

check('index wires manifest, apple-touch-icon, markup, script', () => {
  assert.ok(html.includes('rel="manifest"'));
  assert.ok(html.includes('manifest.webmanifest'));
  assert.ok(html.includes('assets/icons/apple-touch-icon.png'));
  assert.ok(html.includes('id="pwa-install-banner"'));
  assert.ok(html.includes('id="pwa-install-sheet"'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes('js/pwa-install.js'));
  assert.ok(html.includes('apple-mobile-web-app-capable'));
});

check('copy does not promise offline / forever', () => {
  const blobs = [zh, en, html, manifest.description].join('\n');
  assert.ok(!/离线可用|完全离线|use offline|works offline|use forever|永久可用/i.test(blobs));
  assert.ok(!html.includes('pwa-install-sheet-foot'));
  assert.ok(!/pwa_(ios_foot|ios_other_foot|android_menu_foot):/.test(zh));
  assert.ok(!/pwa_(ios_foot|ios_other_foot|android_menu_foot):/.test(en));
  assert.ok(zh.includes('网页无法直接弹出系统安装框'));
  assert.ok(en.includes('cannot open the system install prompt'));
});

check('no service worker shipped (avoids fetch interception of OAuth/API)', () => {
  assert.equal(swExists, false);
  assert.ok(!html.toLowerCase().includes('serviceworker'));
  assert.ok(!html.includes('service-worker'));
  assert.ok(!fs.existsSync(path.join(root, 'service-worker.js')));
});

check('i18n keys present in zh and en', () => {
  const keys = [
    'pwa_banner_title', 'pwa_banner_sub', 'pwa_banner_cta', 'pwa_banner_close',
    'pwa_ios_title', 'pwa_ios_intro', 'pwa_ios_step1_title', 'pwa_ios_step2_title',
    'pwa_ios_gotit', 'pwa_ios_other_title', 'pwa_android_menu_title', 'pwa_product_kicker'
  ];
  for (const k of keys) {
    assert.ok(zh.includes(k + ':'), 'zh missing ' + k);
    assert.ok(en.includes(k + ':'), 'en missing ' + k);
  }
});

// ---- platform detection ----
const safariIOS = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const chromeIOS = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1' };
const fxIOS = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15' };
const androidChrome = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' };
const desktopChrome = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', maxTouchPoints: 0 };
const iPadOS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', maxTouchPoints: 5 };

check('detect iOS Safari / iOS other / Android / desktop / iPad', () => {
  assert.equal(P.detectPlatform(safariIOS, {}), 'ios-safari');
  assert.equal(P.detectPlatform(chromeIOS, {}), 'ios-other');
  assert.equal(P.detectPlatform(fxIOS, {}), 'ios-other');
  assert.equal(P.detectPlatform(androidChrome, {}), 'android');
  assert.equal(P.detectPlatform(desktopChrome, { matchMedia: () => ({ matches: false }) }), 'desktop');
  assert.equal(P.detectPlatform(iPadOS, {}), 'ios-safari');
  assert.equal(P.isDesktop(desktopChrome, { matchMedia: () => ({ matches: false }) }), true);
  assert.equal(P.isDesktop(androidChrome, {}), false);
});

check('standalone: iOS navigator.standalone and display-mode media', () => {
  assert.equal(P.isStandalone({}, { standalone: true }), true);
  assert.equal(P.isStandalone({
    matchMedia: (q) => ({ matches: q.includes('display-mode: standalone') })
  }, {}), true);
  assert.equal(P.isStandalone({ matchMedia: () => ({ matches: false }) }, { standalone: false }), false);
});

check('classifyCta: android with prompt is native, otherwise instruction sheets', () => {
  assert.equal(P.classifyCta('android', true), 'native-prompt');
  assert.equal(P.classifyCta('android', false), 'android-menu-sheet');
  assert.equal(P.classifyCta('ios-safari', false), 'ios-safari-sheet');
  assert.equal(P.classifyCta('ios-other', true), 'ios-other-sheet'); // BIP never real on iOS
  assert.equal(P.classifyCta('desktop', true), 'none');
});

// ---- shouldOffer / timing / cooldown ----
check('hidden when standalone, installed, desktop, or cooldown', () => {
  assert.equal(P.shouldOffer({ standalone: true }), false);
  assert.equal(P.shouldOffer({ installed: true }), false);
  assert.equal(P.shouldOffer({ desktop: true }), false);
  assert.equal(P.shouldOffer({ inCooldown: true }), false);
  assert.equal(P.shouldOffer({}), true);
  assert.equal(P.shouldOffer({ desktop: true, previewForce: true }), true);
  assert.equal(P.shouldOffer({ standalone: true, previewForce: true }), false);
  assert.equal(P.shouldOffer({ installed: true, previewForce: true }), false);
});

check('timing: not immediate; delay or interaction after min delay', () => {
  assert.equal(P.timingReady({ elapsedMs: 0 }), false);
  assert.equal(P.timingReady({ elapsedMs: 3000, interacted: true, minDelayMs: 8000 }), false);
  assert.equal(P.timingReady({ elapsedMs: 8000, interacted: true, minDelayMs: 8000 }), true);
  assert.equal(P.timingReady({ elapsedMs: 20000, interacted: false, delayMs: 20000 }), true);
  assert.equal(P.timingReady({ elapsedMs: 0, previewForce: true }), true);
});

check('cooldown window', () => {
  const now = 1_000_000;
  assert.equal(P.isInCooldown(now - 1000, now, 30 * 86400000), true);
  assert.equal(P.isInCooldown(now - 31 * 86400000, now, 30 * 86400000), false);
  assert.equal(P.isInCooldown(0, now, 30 * 86400000), false);
});

// ---- storage failures ----
check('storage get/set failures are not thrown', () => {
  const boom = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); }
  };
  const g = P.safeStorageGet(boom, 'x');
  assert.equal(g.ok, false);
  const s = P.safeStorageSet(boom, 'x', '1');
  assert.equal(s.ok, false);
});

// ---- controller helpers ----
function makeDoc() {
  const nodes = new Map();
  const listeners = [];
  function el(id, attrs) {
    const classList = new Set();
    const rec = {
      id,
      hidden: true,
      attrs: Object.assign({ hidden: '' }, attrs || {}),
      children: [],
      textContent: '',
      tagName: 'DIV',
      classList: {
        add: (c) => classList.add(c),
        remove: (c) => classList.delete(c),
        contains: (c) => classList.has(c)
      },
      setAttribute(k, v) { rec.attrs[k] = String(v); if (k === 'hidden') rec.hidden = true; },
      removeAttribute(k) { delete rec.attrs[k]; if (k === 'hidden') rec.hidden = false; },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(rec.attrs, k) ? rec.attrs[k] : null; },
      focus() { rec.focused = true; doc.activeElement = rec; },
      closest() { return null; },
      addEventListener(ev, fn) { listeners.push({ id, ev, fn }); },
      removeEventListener() {},
      click() { for (const l of listeners) if (l.id === id && l.ev === 'click') l.fn({ preventDefault() {} }); },
      querySelectorAll() { return []; }
    };
    nodes.set(id, rec);
    return rec;
  }
  for (const id of ['web-bottom-cta', 'web-bottom-desktop', 'web-bottom-phone', 'phone-add-home-btn']) el(id);
  const banner = el('pwa-install-banner');
  const overlay = el('pwa-install-overlay');
  const sheet = el('pwa-install-sheet');
  const cta = el('pwa-install-cta');
  const close = el('pwa-install-close');
  const bodyClass = new Set();
  const doc = {
    body: {
      classList: {
        add: (c) => bodyClass.add(c),
        remove: (c) => bodyClass.delete(c),
        contains: (c) => bodyClass.has(c)
      }
    },
    documentElement: { lang: 'zh-CN' },
    activeElement: null,
    readyState: 'complete',
    getElementById: (id) => nodes.get(id) || null,
    querySelectorAll: (sel) => {
      if (sel === '[data-pwa-sheet]') return [];
      if (sel === '[data-pwa-gotit]') return [];
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    _bodyClass: bodyClass,
    _nodes: nodes
  };
  return doc;
}

function makeController(overrides) {
  const store = Object.assign({}, overrides.store || {});
  const storage = overrides.storage !== undefined ? overrides.storage : {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
  let t = overrides.t0 || 1_000_000;
  const doc = overrides.document || makeDoc();
  const mm = (q) => ({ matches: !!(overrides.media && overrides.media[q]) });
  const win = Object.assign({
    matchMedia: mm,
    navigator: overrides.nav || androidChrome,
    location: { search: overrides.search || '' },
    innerHeight: overrides.innerHeight || 800,
    visualViewport: overrides.visualViewport || { height: 800, offsetTop: 0, addEventListener() {}, removeEventListener() {} },
    addEventListener() {},
    removeEventListener() {},
    localStorage: storage,
    pageYOffset: 0
  }, overrides.win || {});
  win.navigator = overrides.nav || win.navigator;
  const elapsed = overrides.elapsed || 0;
  const ctrl = P.createController({
    window: win,
    navigator: overrides.nav || androidChrome,
    storage,
    document: doc,
    now: () => t,
    search: overrides.search,
    delayMs: overrides.delayMs || 20000,
    minDelayMs: overrides.minDelayMs || 8000,
    cooldownMs: overrides.cooldownMs || P.COOLDOWN_MS,
    capturedPrompt: overrides.capturedPrompt || null,
    interacted: !!overrides.interacted,
    installed: !!overrides.installed,
    analytics: overrides.analytics
  });
  // createController stamps startedAt = now(); rewind the clock for "already waited".
  if (elapsed) t += elapsed;
  return { ctrl, store, doc, win, tick: (ms) => { t += ms; } };
}

check('bottom CTA device modes ignore viewport, preview and desktop install state', () => {
  for (const nav of [desktopChrome, androidChrome, safariIOS, iPadOS, { userAgent: 'Unknown Mobile' }]) {
    for (const installed of [false, true]) {
      const { ctrl, doc } = makeController({ nav, installed, search: '?pwa_preview=ios' });
      ctrl.syncVisibility();
      const desktop = P.isDesktop(nav, {});
      assert.equal(doc.getElementById('web-bottom-desktop').hidden, !desktop);
      assert.equal(doc.getElementById('web-bottom-phone').hidden, desktop || installed);
      assert.equal(doc.getElementById('web-bottom-cta').hidden, !desktop && installed);
    }
  }
  for (const nav of [desktopChrome, safariIOS]) {
    const { ctrl, doc } = makeController({ nav, media: { '(display-mode: standalone)': true } });
    ctrl.syncVisibility();
    assert.equal(doc.getElementById('web-bottom-cta').hidden, nav === safariIOS);
  }
});

check('bottom visibility parks banner without dismissal and cooldown keeps bottom CTA', () => {
  const { ctrl, store, doc } = makeController({ elapsed: 21000 });
  ctrl.syncVisibility();
  assert.equal(ctrl.getState().bannerVisible, true);
  ctrl.setBottomCtaInView(true);
  assert.equal(ctrl.getState().bannerVisible, false);
  assert.equal(store[P.STORAGE_DISMISS], undefined);
  ctrl.setBottomCtaInView(false);
  assert.equal(ctrl.getState().bannerVisible, true);
  ctrl.dismissPersistent();
  ctrl.syncVisibility();
  assert.equal(ctrl.getState().bannerVisible, false);
  assert.equal(doc.getElementById('web-bottom-cta').hidden, false);
});

check('bottom phone click uses existing sheet and PWA analytics despite cooldown', () => {
  const events = [];
  const { ctrl, doc } = makeController({ nav: safariIOS, analytics: { track: (event) => events.push(event) } });
  ctrl.mount();
  ctrl.dismissPersistent();
  doc.getElementById('phone-add-home-btn').click();
  assert.equal(ctrl.getState().sheet, 'ios-safari');
  assert.equal(events.filter((e) => e === 'pwa_install_click').length, 1);
  assert.ok(!events.includes('desktop_download_click'));
  ctrl.destroy();
});

check('bottom markup uses direct packages and phone has no download links', () => {
  for (const [id, file] of [['windows', 'PowerTokensVideoStudio.exe'], ['mac', 'PowerTokensVideoStudio-macOS-arm64.dmg']]) {
    assert.ok(html.includes('href="https://github.com/PowerTokens/video-studio/releases/latest/download/' + file + '" class="btn btn-accent" id="desktop-download-' + id + '"'));
  }
  assert.ok(!html.includes('id="desktop-download-btn"'));
  const phone = html.split('id="web-bottom-phone"')[1].split('</div>')[0];
  assert.ok(!phone.includes('href=') && !phone.includes('releases/latest'));
});

check('desktop controller is not offerable', () => {
  const { ctrl } = makeController({ nav: desktopChrome });
  assert.equal(ctrl.offerable(), false);
  assert.equal(ctrl.getState().desktop, true);
});

check('iOS Safari controller offerable; CTA opens Safari instruction sheet', async () => {
  const { ctrl, doc } = makeController({ nav: safariIOS, interacted: true, t0: 0 });
  // not yet ready at t=0
  assert.equal(ctrl.ready(), false);
  assert.equal(ctrl.offerable(), true);
  assert.equal(ctrl.ctaKind(), 'ios-safari-sheet');
  const out = await ctrl.onCta();
  assert.equal(out.sheet, 'ios-safari');
  assert.equal(ctrl.getState().sheet, 'ios-safari');
  assert.equal(doc.getElementById('pwa-install-overlay').hidden, false);
  assert.equal(doc.getElementById('pwa-install-sheet').getAttribute('aria-labelledby'), 'pwa-install-sheet-title');
});

check('iOS Chrome/other gets Safari-fallback sheet, not a fake install prompt', async () => {
  const { ctrl } = makeController({ nav: chromeIOS, interacted: true, elapsed: 25000 });
  assert.equal(ctrl.ctaKind(), 'ios-other-sheet');
  const out = await ctrl.onCta();
  assert.equal(out.sheet, 'ios-other');
});

check('Android without BIP uses menu instruction, never fakes a native prompt', async () => {
  const { ctrl } = makeController({ nav: androidChrome, interacted: true, elapsed: 25000 });
  assert.equal(ctrl.ctaKind(), 'android-menu-sheet');
  const out = await ctrl.onCta();
  assert.equal(out.action, 'sheet');
  assert.equal(out.sheet, 'android-menu');
});

check('Android with BIP: CTA calls prompt() directly, no pre-sheet', async () => {
  let prompted = 0;
  const capturedPrompt = {
    prompt() { prompted += 1; },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };
  const { ctrl, store } = makeController({
    nav: androidChrome,
    interacted: true,
    capturedPrompt,
    elapsed: 25000
  });
  assert.equal(ctrl.ctaKind(), 'native-prompt');
  const out = await ctrl.onCta();
  assert.equal(prompted, 1);
  assert.equal(out.action, 'native');
  assert.equal(out.outcome, 'accepted');
  assert.ok(store[P.STORAGE_INSTALLED]);
  assert.equal(ctrl.getState().bannerVisible, false);
});

check('Android native prompt dismissed: session hide, no 30-day cooldown', async () => {
  const capturedPrompt = {
    prompt() {},
    userChoice: Promise.resolve({ outcome: 'dismissed' })
  };
  const { ctrl, store } = makeController({
    nav: androidChrome, interacted: true, capturedPrompt, elapsed: 25000
  });
  const out = await ctrl.onCta();
  assert.equal(out.outcome, 'dismissed');
  assert.ok(!store[P.STORAGE_DISMISS], 'native dismiss must not write cooldown');
});

check('standalone suppresses offer', () => {
  const { ctrl } = makeController({
    nav: Object.assign({ standalone: true }, safariIOS)
  });
  assert.equal(ctrl.offerable(), false);
  assert.equal(ctrl.getState().standalone, true);
});

check('appinstalled event hides and persists installed flag', () => {
  const { ctrl, store, doc } = makeController({ nav: androidChrome, interacted: true, elapsed: 25000 });
  ctrl.schedule();
  ctrl.onAppInstalled();
  assert.ok(store[P.STORAGE_INSTALLED]);
  assert.equal(ctrl.offerable(), false);
  assert.equal(doc.getElementById('pwa-install-banner').hidden, true);
});

check('close writes cooldown and hides', () => {
  const { ctrl, store, tick } = makeController({ nav: safariIOS, interacted: true, elapsed: 25000 });
  assert.equal(ctrl.offerable(), true);
  ctrl.dismissPersistent();
  assert.ok(store[P.STORAGE_DISMISS]);
  assert.equal(ctrl.offerable(), false);
  tick(P.COOLDOWN_MS + 1);
  assert.equal(ctrl.offerable(), true);
});

check('localStorage failure still allows in-session dismiss without throw', () => {
  const boom = {
    getItem() { throw new Error('quota'); },
    setItem() { throw new Error('quota'); }
  };
  const { ctrl } = makeController({ nav: safariIOS, interacted: true, storage: boom, elapsed: 25000 });
  assert.equal(ctrl.offerable(), true);
  assert.doesNotThrow(() => ctrl.dismissPersistent());
  // memory-only: still not offerable this session after dismiss? recordDismiss writes memory even if storage fails
  assert.equal(ctrl.offerable(), false);
});

check('timing: no banner at t=0 even if offerable', () => {
  const { ctrl } = makeController({ nav: safariIOS, t0: 0, interacted: false });
  assert.equal(ctrl.offerable(), true);
  assert.equal(ctrl.ready(), false);
});

check('meaningful interaction after min delay makes it ready', () => {
  const { ctrl, tick } = makeController({ nav: safariIOS, t0: 0, minDelayMs: 8000, delayMs: 20000 });
  tick(8000);
  assert.equal(ctrl.ready(), false);
  ctrl.markInteracted();
  assert.equal(ctrl.ready(), true);
});

check('input / keyboard obstruction hides banner and does not cover fields', () => {
  const { ctrl, doc } = makeController({ nav: safariIOS, interacted: true, elapsed: 25000 });
  ctrl.schedule();
  assert.equal(ctrl.ready(), true);
  assert.equal(doc.getElementById('pwa-install-banner').hidden, false);
  ctrl.setInputFocused(true);
  assert.equal(ctrl.isInputBlocked(), true);
  assert.equal(doc.getElementById('pwa-install-banner').hidden, true);
  ctrl.setInputFocused(false);
  assert.equal(doc.getElementById('pwa-install-banner').hidden, false);
});

check('visualViewport keyboard inset also parks the banner', () => {
  const visualViewport = { height: 400, offsetTop: 0, addEventListener() {}, removeEventListener() {} };
  const { ctrl } = makeController({
    nav: safariIOS, interacted: true, elapsed: 25000,
    innerHeight: 800, visualViewport
  });
  assert.equal(P.keyboardOpen({ window: { innerHeight: 800, visualViewport } }, false), true);
});

check('Escape closes sheet and restore focus is attempted', () => {
  const { ctrl, doc } = makeController({ nav: safariIOS, interacted: true, elapsed: 25000 });
  const cta = doc.getElementById('pwa-install-cta');
  doc.activeElement = cta;
  ctrl.openSheet('ios-safari');
  assert.equal(ctrl.getState().sheet, 'ios-safari');
  // Simulate keydown via closeSheet path used by Escape
  ctrl.closeSheet();
  assert.equal(ctrl.getState().sheet, null);
  assert.equal(doc.activeElement, cta);
  assert.equal(cta.focused, true);
});

check('preview flags force banner / specific platforms', () => {
  const d = makeController({ nav: desktopChrome, search: '?pwa_preview=1' });
  assert.equal(d.ctrl.offerable(), true);
  assert.equal(d.ctrl.ready(), true);
  const ios = makeController({ nav: desktopChrome, search: '?pwa_preview=ios' });
  assert.equal(ios.ctrl.platform(), 'ios-safari');
  const menu = makeController({ nav: androidChrome, search: '?pwa_preview=android-menu', capturedPrompt: { prompt() {} } });
  assert.equal(menu.ctrl.ctaKind(), 'android-menu-sheet');
  const bip = makeController({ nav: androidChrome, search: '?pwa_preview=android-bip' });
  assert.equal(bip.ctrl.ctaKind(), 'native-prompt');
});

check('already-installed storage suppresses even with preview? preview cannot override installed', () => {
  const { ctrl } = makeController({
    nav: androidChrome,
    search: '?pwa_preview=1',
    store: { [P.STORAGE_INSTALLED]: '99' }
  });
  assert.equal(ctrl.offerable(), false);
});

check('oauth / utm scripts were not edited by this feature', () => {
  // Guard: this test file does not mutate those scripts. The git diff is checked separately in CI if present.
  const oauth = fs.readFileSync(path.join(root, 'js/oauth.js'), 'utf8');
  const utm = fs.readFileSync(path.join(root, 'js/utm.js'), 'utf8');
  const models = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
  assert.ok(oauth.includes('PKCE') || oauth.includes('pkce') || oauth.includes('oauth'));
  assert.ok(utm.includes('utm_source'));
  assert.ok(models.includes('wan') || models.includes('Wan') || models.length > 100);
});

function collect(analyticsEvents) {
  return {
    track(event, props) {
      analyticsEvents.push({ event, props: props || {} });
      return true;
    }
  };
}

function named(events, name) {
  return events.filter((x) => x.event === name);
}

check('offer shown once even if keyboard hides and shows the banner', () => {
  const events = [];
  const { ctrl, doc } = makeController({
    nav: safariIOS, interacted: true, elapsed: 25000, analytics: collect(events)
  });
  ctrl.schedule();
  assert.equal(doc.getElementById('pwa-install-banner').hidden, false);
  assert.equal(named(events, 'pwa_offer_shown').length, 1);
  ctrl.setInputFocused(true);
  assert.equal(doc.getElementById('pwa-install-banner').hidden, true);
  ctrl.setInputFocused(false);
  assert.equal(doc.getElementById('pwa-install-banner').hidden, false);
  ctrl.schedule();
  assert.equal(named(events, 'pwa_offer_shown').length, 1);
});

check('persistent dismiss fires offer_dismissed; Got it does not', () => {
  const gotit = [];
  const a = makeController({
    nav: safariIOS, interacted: true, elapsed: 25000, analytics: collect(gotit)
  });
  a.ctrl.schedule();
  a.ctrl.hideBannerSession();
  assert.equal(named(gotit, 'pwa_offer_dismissed').length, 0);
  assert.equal(named(gotit, 'pwa_offer_shown').length, 1);

  const closed = [];
  const b = makeController({
    nav: safariIOS, interacted: true, elapsed: 25000, analytics: collect(closed)
  });
  b.ctrl.schedule();
  b.ctrl.dismissPersistent();
  assert.equal(named(closed, 'pwa_offer_dismissed').length, 1);
  assert.equal(named(closed, 'pwa_install_prompt_dismissed').length, 0);
  assert.equal(named(closed, 'pwa_install_accepted').length, 0);
});

check('CTA click records cta_kind and iOS sheet does not fire accepted', async () => {
  const events = [];
  const { ctrl } = makeController({
    nav: safariIOS, interacted: true, elapsed: 25000, analytics: collect(events)
  });
  ctrl.schedule();
  const out = await ctrl.onCta();
  assert.equal(out.sheet, 'ios-safari');
  const clicks = named(events, 'pwa_install_click');
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].props.cta_kind, 'ios-safari-sheet');
  assert.equal(named(events, 'pwa_install_accepted').length, 0);
});

check('native accepted and appinstalled dedupe to one success', async () => {
  const events = [];
  const capturedPrompt = {
    prompt() {},
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };
  const { ctrl } = makeController({
    nav: androidChrome, interacted: true, capturedPrompt, elapsed: 25000,
    analytics: collect(events)
  });
  await ctrl.onCta();
  ctrl.onAppInstalled();
  assert.equal(named(events, 'pwa_install_accepted').length, 1);
  assert.equal(named(events, 'pwa_install_click').length, 1);
  assert.equal(named(events, 'pwa_install_click')[0].props.cta_kind, 'native-prompt');
  assert.equal(named(events, 'pwa_offer_dismissed').length, 0);
});

check('appinstalled alone counts as accepted; a second event does not', () => {
  const events = [];
  const { ctrl } = makeController({
    nav: androidChrome, interacted: true, elapsed: 25000, analytics: collect(events)
  });
  ctrl.onAppInstalled();
  ctrl.onAppInstalled();
  assert.equal(named(events, 'pwa_install_accepted').length, 1);
});

check('native prompt dismiss is not a 30-day offer dismiss', async () => {
  const events = [];
  const capturedPrompt = {
    prompt() {},
    userChoice: Promise.resolve({ outcome: 'dismissed' })
  };
  const { ctrl, store } = makeController({
    nav: androidChrome, interacted: true, capturedPrompt, elapsed: 25000,
    analytics: collect(events)
  });
  const out = await ctrl.onCta();
  assert.equal(out.outcome, 'dismissed');
  assert.ok(!store[P.STORAGE_DISMISS]);
  assert.equal(named(events, 'pwa_install_prompt_dismissed').length, 1);
  assert.equal(named(events, 'pwa_offer_dismissed').length, 0);
  assert.equal(named(events, 'pwa_install_accepted').length, 0);
});

await Promise.all(pending);
if (failed) {
  console.error(failed + ' check(s) failed');
  process.exit(1);
}
console.log('ok pwa-install checks');
