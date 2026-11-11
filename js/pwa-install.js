/*
 * Add-to-home-screen offer for Video Studio Web.
 * Online-first: this only helps the user pin the existing page. It does not
 * cache API, OAuth, keys, chat, or videos, and does not claim offline use.
 */
(function (root) {
  'use strict';

  var STORAGE_DISMISS = 'vsw.pwa.dismissedAt';
  var STORAGE_INSTALLED = 'vsw.pwa.installedAt';
  var COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
  var MIN_DELAY_MS = 8000;
  var DELAY_MS = 20000;
  var KEYBOARD_INSET_PX = 80;
  var SCROLL_INTERACT_PX = 80;

  var IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|OPT\/|SamsungBrowser/i;
  var MOBILE_UA = /Android|iPhone|iPod|iPad|Mobile/i;

  function nowMs(env) {
    if (env && typeof env.now === 'function') return env.now();
    return Date.now();
  }

  function safeStorageGet(storage, key) {
    if (!storage) return { ok: false, value: null };
    try {
      return { ok: true, value: storage.getItem(key) };
    } catch (err) {
      return { ok: false, value: null, error: err };
    }
  }

  function safeStorageSet(storage, key, value) {
    if (!storage) return { ok: false };
    try {
      storage.setItem(key, value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  function isStandalone(win, nav) {
    try {
      if (nav && nav.standalone === true) return true;
    } catch (e1) { /* ignore */ }
    try {
      if (win && typeof win.matchMedia === 'function') {
        if (win.matchMedia('(display-mode: standalone)').matches) return true;
        if (win.matchMedia('(display-mode: fullscreen)').matches) return true;
        if (win.matchMedia('(display-mode: minimal-ui)').matches) return true;
      }
    } catch (e2) { /* ignore */ }
    return false;
  }

  function isIosDevice(nav) {
    var ua = String((nav && (nav.userAgent || nav.ua)) || '');
    if (/iPhone|iPod|iPad/i.test(ua)) return true;
    // iPadOS may report as Macintosh with touch.
    if (/Macintosh/i.test(ua) && nav && Number(nav.maxTouchPoints || 0) > 1) return true;
    return false;
  }

  function isIosSafari(nav) {
    if (!isIosDevice(nav)) return false;
    var ua = String((nav && (nav.userAgent || nav.ua)) || '');
    if (IOS_OTHER.test(ua)) return false;
    // Safari includes Version/ and Safari/; Chromium-on-iOS is caught above.
    return /Safari/i.test(ua);
  }

  function isAndroid(nav) {
    var ua = String((nav && (nav.userAgent || nav.ua)) || '');
    return /Android/i.test(ua) && !isIosDevice(nav);
  }

  function isDesktop(nav, win) {
    if (isIosDevice(nav) || isAndroid(nav)) return false;
    var ua = String((nav && (nav.userAgent || nav.ua)) || '');
    if (MOBILE_UA.test(ua)) return false;
    try {
      if (win && typeof win.matchMedia === 'function') {
        if (win.matchMedia('(pointer: coarse)').matches) return false;
      }
    } catch (e) { /* ignore */ }
    return true;
  }

  function detectPlatform(nav, win) {
    if (isIosDevice(nav)) {
      return isIosSafari(nav) ? 'ios-safari' : 'ios-other';
    }
    if (isAndroid(nav)) return 'android';
    if (isDesktop(nav, win)) return 'desktop';
    return 'unknown-mobile';
  }

  function parsePreviewFlag(search) {
    try {
      var q = new URLSearchParams(search || '');
      var raw = q.get('pwa_preview');
      if (raw === null || raw === '') return null;
      if (raw === '1' || raw === 'true') return 'banner';
      return String(raw);
    } catch (err) {
      return null;
    }
  }

  function readTimestamp(storage, key) {
    var got = safeStorageGet(storage, key);
    if (!got.ok) return { storageOk: false, at: 0 };
    var n = parseInt(got.value || '0', 10);
    if (!isFinite(n) || n < 0) n = 0;
    return { storageOk: true, at: n };
  }

  function isInCooldown(dismissedAt, now, cooldownMs) {
    if (!dismissedAt) return false;
    return (now - dismissedAt) < (cooldownMs || COOLDOWN_MS);
  }

  /**
   * Whether we may offer install UI at all (ignoring timing).
   * previewForce skips desktop/cooldown, but never overrides real standalone
   * or a recorded appinstalled flag unless preview is an explicit force-show.
   */
  function shouldOffer(opts) {
    opts = opts || {};
    if (opts.standalone) return false;
    if (opts.installed) return false;
    if (opts.previewForce) return true;
    if (opts.desktop) return false;
    if (opts.inCooldown) return false;
    return true;
  }

  function timingReady(opts) {
    opts = opts || {};
    if (opts.previewForce) return true;
    var elapsed = opts.elapsedMs || 0;
    if (elapsed >= (opts.delayMs || DELAY_MS)) return true;
    if (opts.interacted && elapsed >= (opts.minDelayMs || MIN_DELAY_MS)) return true;
    return false;
  }

  /**
   * What the banner CTA should do on this platform.
   * 'native-prompt' — call captured beforeinstallprompt (no extra sheet).
   * 'ios-safari-sheet' / 'ios-other-sheet' / 'android-menu-sheet' — our UI.
   * 'none' — do not offer a CTA action.
   */
  function classifyCta(platform, hasNativePrompt) {
    if (platform === 'android' && hasNativePrompt) return 'native-prompt';
    if (platform === 'ios-safari') return 'ios-safari-sheet';
    if (platform === 'ios-other') return 'ios-other-sheet';
    if (platform === 'android' || platform === 'unknown-mobile') return 'android-menu-sheet';
    return 'none';
  }

  var SAFE_CTA_KIND = {
    'native-prompt': true,
    'ios-safari-sheet': true,
    'ios-other-sheet': true,
    'android-menu-sheet': true,
    'none': true
  };

  function resolveAnalytics(env, win) {
    try {
      if (env && env.analytics) return env.analytics;
    } catch (e1) { /* ignore */ }
    try {
      if (win && win.VSAnalytics) return win.VSAnalytics;
    } catch (e2) { /* ignore */ }
    try {
      return root.VSAnalytics || null;
    } catch (e3) {
      return null;
    }
  }

  function trackPwa(analytics, event, props) {
    try {
      if (!analytics || typeof analytics.track !== 'function') return false;
      return analytics.track(event, props || {});
    } catch (err) {
      return false;
    }
  }

  function keyboardOpen(env, inputFocused) {
    if (inputFocused) return true;
    try {
      var win = env && env.window;
      var vv = win && win.visualViewport;
      if (!vv) return false;
      var inner = Number((win.innerHeight != null ? win.innerHeight : 0));
      var inset = inner - Number(vv.height || 0) - Number(vv.offsetTop || 0);
      return inset > (env.keyboardInsetPx || KEYBOARD_INSET_PX);
    } catch (err) {
      return false;
    }
  }

  function createController(env) {
    env = env || {};
    var win = env.window || (typeof window !== 'undefined' ? window : {});
    var nav = env.navigator || win.navigator || {};
    var storage = env.storage;
    if (storage === undefined) {
      try { storage = win.localStorage; } catch (e) { storage = null; }
    }
    var doc = env.document || win.document;
    var memory = { dismissedAt: 0, installedAt: 0 };
    var capturedPrompt = env.capturedPrompt || null;
    var interacted = !!env.interacted;
    var startedAt = nowMs(env);
    var bannerVisible = false;
    var sheetName = null;
    var lastFocus = null;
    var inputFocused = false;
    var destroyed = false;
    var timers = [];
    var listeners = [];
    var offerShownThisSession = false;
    var installAcceptedTracked = false;

    function trackPwaEvent(event, props) {
      return trackPwa(resolveAnalytics(env, win), event, props);
    }

    function notifyOfferShown() {
      if (offerShownThisSession) return false;
      offerShownThisSession = true;
      return trackPwaEvent('pwa_offer_shown', {});
    }

    function notifyInstallAccepted() {
      if (installAcceptedTracked) return false;
      installAcceptedTracked = true;
      return trackPwaEvent('pwa_install_accepted', {});
    }

    function platform() {
      var preview = parsePreviewFlag(env.search != null ? env.search : (win.location && win.location.search));
      if (preview === 'ios' || preview === 'ios-safari') return 'ios-safari';
      if (preview === 'ios-other') return 'ios-other';
      if (preview === 'android' || preview === 'android-bip' || preview === 'android-menu') return 'android';
      return detectPlatform(nav, win);
    }

    function previewFlag() {
      return parsePreviewFlag(env.search != null ? env.search : (win.location && win.location.search));
    }

    function previewForce() {
      return !!previewFlag();
    }

    function installed() {
      if (env.installed === true) return true;
      var rec = readTimestamp(storage, STORAGE_INSTALLED);
      if (rec.storageOk && rec.at) return true;
      return memory.installedAt > 0;
    }

    function dismissedAt() {
      var rec = readTimestamp(storage, STORAGE_DISMISS);
      if (rec.storageOk && rec.at) return rec.at;
      return memory.dismissedAt || 0;
    }

    function offerable() {
      return shouldOffer({
        standalone: isStandalone(win, nav),
        installed: installed(),
        desktop: isDesktop(nav, win),
        inCooldown: isInCooldown(dismissedAt(), nowMs(env), env.cooldownMs || COOLDOWN_MS),
        previewForce: previewForce()
      });
    }

    function ready() {
      return offerable() && timingReady({
        previewForce: previewForce(),
        elapsedMs: nowMs(env) - startedAt,
        interacted: interacted,
        delayMs: env.delayMs || DELAY_MS,
        minDelayMs: env.minDelayMs || MIN_DELAY_MS
      });
    }

    function blockedByInput() {
      return keyboardOpen(env, inputFocused);
    }

    function recordDismiss() {
      var ts = String(nowMs(env));
      memory.dismissedAt = Number(ts);
      return safeStorageSet(storage, STORAGE_DISMISS, ts);
    }

    function recordInstalled() {
      var ts = String(nowMs(env));
      memory.installedAt = Number(ts);
      return safeStorageSet(storage, STORAGE_INSTALLED, ts);
    }

    function ctaKind() {
      var flag = previewFlag();
      var hasNative = !!capturedPrompt;
      if (flag === 'android-bip') hasNative = true;
      if (flag === 'android-menu') hasNative = false;
      return classifyCta(platform(), hasNative);
    }

    function $(id) {
      return doc && doc.getElementById ? doc.getElementById(id) : null;
    }

    function setHidden(node, hidden) {
      if (!node) return;
      if (hidden) node.setAttribute('hidden', '');
      else node.removeAttribute('hidden');
    }

    function bannerEl() { return $('pwa-install-banner'); }
    function overlayEl() { return $('pwa-install-overlay'); }
    function sheetEl() { return $('pwa-install-sheet'); }

    function applyBodyClass(name, on) {
      if (!doc || !doc.body || !doc.body.classList) return;
      if (on) doc.body.classList.add(name);
      else doc.body.classList.remove(name);
    }

    function syncVisibility() {
      if (destroyed) return;
      var wantBanner = ready() && !blockedByInput() && !sheetName;
      var wantSheet = !!sheetName && !blockedByInput();
      bannerVisible = wantBanner;
      setHidden(bannerEl(), !wantBanner);
      if (wantBanner) notifyOfferShown();
      setHidden(overlayEl(), !wantSheet);
      applyBodyClass('pwa-banner-on', wantBanner);
      applyBodyClass('pwa-sheet-on', wantSheet);
      applyBodyClass('pwa-preview-force', previewForce());
      if (doc && doc.querySelectorAll) {
        var panels = doc.querySelectorAll('[data-pwa-sheet]');
        for (var i = 0; i < panels.length; i++) {
          var name = panels[i].getAttribute('data-pwa-sheet');
          setHidden(panels[i], name !== sheetName);
        }
      }
      var labelled = {
        'ios-safari': 'pwa-install-sheet-title',
        'ios-other': 'pwa-install-sheet-title-other',
        'android-menu': 'pwa-install-sheet-title-android'
      };
      var sheetBox = sheetEl();
      if (sheetBox && sheetName && labelled[sheetName]) {
        sheetBox.setAttribute('aria-labelledby', labelled[sheetName]);
      }
      var sheet = sheetEl();
      if (wantSheet && sheet && typeof sheet.focus === 'function') {
        try { sheet.focus(); } catch (eF) { /* ignore */ }
      }
      if (env.onChange) env.onChange({ banner: wantBanner, sheet: sheetName, kind: ctaKind() });
    }

    function markInteracted() {
      if (interacted) return;
      interacted = true;
      schedule();
    }

    function openSheet(name) {
      if (!name) return;
      try {
        lastFocus = doc && doc.activeElement ? doc.activeElement : null;
      } catch (e) { lastFocus = null; }
      sheetName = name;
      syncVisibility();
    }

    function closeSheet() {
      sheetName = null;
      syncVisibility();
      if (lastFocus && typeof lastFocus.focus === 'function') {
        try { lastFocus.focus(); } catch (e) { /* ignore */ }
      }
      lastFocus = null;
    }

    function hideBannerSession() {
      // Session hide: bump startedAt / treat as not offerable by setting memory dismiss
      // without writing cooldown? For "知道了" we only hide for this visit.
      memory._sessionHide = true;
      startedAt = nowMs(env) + (env.delayMs || DELAY_MS) * 100; // effectively pause auto-show
      closeSheet();
      bannerVisible = false;
      setHidden(bannerEl(), true);
      applyBodyClass('pwa-banner-on', false);
    }

    function dismissPersistent() {
      var alreadyInstalled = installed() || installAcceptedTracked;
      recordDismiss();
      closeSheet();
      bannerVisible = false;
      setHidden(bannerEl(), true);
      setHidden(overlayEl(), true);
      applyBodyClass('pwa-banner-on', false);
      applyBodyClass('pwa-sheet-on', false);
      if (!alreadyInstalled) trackPwaEvent('pwa_offer_dismissed', {});
      if (env.onChange) env.onChange({ banner: false, sheet: null, dismissed: true });
    }

    function onCta() {
      var kind = ctaKind();
      var clickProps = {};
      if (SAFE_CTA_KIND[kind]) clickProps.cta_kind = kind;
      trackPwaEvent('pwa_install_click', clickProps);
      if (kind === 'native-prompt') {
        return invokeNativePrompt();
      }
      if (kind === 'ios-safari-sheet') {
        openSheet('ios-safari');
        return Promise.resolve({ action: 'sheet', sheet: 'ios-safari' });
      }
      if (kind === 'ios-other-sheet') {
        openSheet('ios-other');
        return Promise.resolve({ action: 'sheet', sheet: 'ios-other' });
      }
      if (kind === 'android-menu-sheet') {
        openSheet('android-menu');
        return Promise.resolve({ action: 'sheet', sheet: 'android-menu' });
      }
      return Promise.resolve({ action: 'none' });
    }

    function invokeNativePrompt() {
      var promptObj = capturedPrompt;
      if (!promptObj || typeof promptObj.prompt !== 'function') {
        openSheet('android-menu');
        return Promise.resolve({ action: 'sheet', sheet: 'android-menu', reason: 'no-prompt' });
      }
      capturedPrompt = null;
      var outcome = Promise.resolve();
      try {
        promptObj.prompt();
        if (promptObj.userChoice && typeof promptObj.userChoice.then === 'function') {
          outcome = promptObj.userChoice;
        }
      } catch (err) {
        openSheet('android-menu');
        return Promise.resolve({ action: 'sheet', sheet: 'android-menu', reason: 'prompt-error' });
      }
      return Promise.resolve(outcome).then(function (choice) {
        var result = (choice && (choice.outcome || choice)) || '';
        if (result === 'accepted') {
          var already = installed() || installAcceptedTracked;
          recordInstalled();
          if (!already) notifyInstallAccepted();
          dismissPersistent();
          return { action: 'native', outcome: 'accepted' };
        }
        // Native dialog dismissed: hide for this session only, no 30-day cooldown.
        hideBannerSession();
        trackPwaEvent('pwa_install_prompt_dismissed', {});
        return { action: 'native', outcome: 'dismissed' };
      }, function () {
        openSheet('android-menu');
        return { action: 'sheet', sheet: 'android-menu', reason: 'prompt-rejected' };
      });
    }

    function onBeforeInstallPrompt(event) {
      if (!event) return;
      try {
        if (typeof event.preventDefault === 'function') event.preventDefault();
      } catch (e) { /* ignore */ }
      capturedPrompt = event;
      if (env.onPromptCaptured) env.onPromptCaptured(event);
      schedule();
    }

    function onAppInstalled() {
      var already = installed() || installAcceptedTracked;
      recordInstalled();
      closeSheet();
      setHidden(bannerEl(), true);
      setHidden(overlayEl(), true);
      applyBodyClass('pwa-banner-on', false);
      applyBodyClass('pwa-sheet-on', false);
      bannerVisible = false;
      if (!already) notifyInstallAccepted();
      if (env.onChange) env.onChange({ banner: false, sheet: null, installed: true });
    }

    function schedule() {
      if (destroyed) return;
      if (memory._sessionHide && !previewForce()) {
        setHidden(bannerEl(), true);
        applyBodyClass('pwa-banner-on', false);
        return;
      }
      syncVisibility();
    }

    function onKeydown(e) {
      if (!e) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (sheetName) {
          if (e.preventDefault) e.preventDefault();
          closeSheet();
        }
      }
    }

    function onFocusIn(e) {
      var t = e && e.target;
      var tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) {
        inputFocused = true;
        schedule();
      }
    }

    function onFocusOut() {
      inputFocused = false;
      // Delay a tick so focus moving to another field stays parked.
      var id = setTimeout(function () {
        if (doc && doc.activeElement) {
          var t = doc.activeElement;
          var tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
          inputFocused = (tag === 'input' || tag === 'textarea' || tag === 'select' || !!(t && t.isContentEditable));
        }
        schedule();
      }, 50);
      timers.push(id);
    }

    function onScroll() {
      try {
        var y = 0;
        if (win.pageYOffset != null) y = win.pageYOffset;
        else if (doc && doc.documentElement) y = doc.documentElement.scrollTop || 0;
        if (y >= SCROLL_INTERACT_PX) markInteracted();
      } catch (err) { /* ignore */ }
    }

    function onMeaningfulClick(e) {
      var t = e && e.target;
      if (!t || !t.closest) return;
      if (t.closest('#pwa-install-root')) return;
      if (
        t.closest('.tabs') ||
        t.closest('#chat-send') ||
        t.closest('#chat-example-chips') ||
        t.closest('#gen-submit') ||
        t.closest('#chat-input') ||
        t.closest('[data-tab]')
      ) {
        markInteracted();
      }
    }

    function bind(target, ev, fn, opts) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(ev, fn, opts);
      listeners.push({ target: target, ev: ev, fn: fn, opts: opts });
    }

    function mount() {
      if (!doc) return;
      bind(win, 'beforeinstallprompt', onBeforeInstallPrompt);
      bind(win, 'appinstalled', onAppInstalled);
      bind(doc, 'keydown', onKeydown);
      bind(doc, 'focusin', onFocusIn);
      bind(doc, 'focusout', onFocusOut);
      bind(win, 'scroll', onScroll, { passive: true });
      bind(doc, 'click', onMeaningfulClick);
      bind(win, 'hashchange', markInteracted);
      if (win.visualViewport && typeof win.visualViewport.addEventListener === 'function') {
        bind(win.visualViewport, 'resize', schedule);
        bind(win.visualViewport, 'scroll', schedule);
      }
      var cta = $('pwa-install-cta');
      var close = $('pwa-install-close');
      var gotit = doc.querySelectorAll('[data-pwa-gotit]');
      var overlay = overlayEl();
      if (cta) bind(cta, 'click', function (e) { if (e && e.preventDefault) e.preventDefault(); onCta(); });
      if (close) bind(close, 'click', function (e) { if (e && e.preventDefault) e.preventDefault(); dismissPersistent(); });
      for (var i = 0; i < gotit.length; i++) {
        bind(gotit[i], 'click', function (e) { if (e && e.preventDefault) e.preventDefault(); hideBannerSession(); });
      }
      if (overlay) {
        bind(overlay, 'click', function (e) {
          if (e && e.target === overlay) closeSheet();
        });
      }
      // Observe language so aria-labels stay in sync (setLang writes html lang).
      try {
        if (typeof MutationObserver === 'function' && doc.documentElement) {
          var mo = new MutationObserver(function () { /* data-i18n is applied by app.js */ });
          mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
        }
      } catch (eObs) { /* ignore */ }

      if (previewForce()) {
        interacted = true;
        startedAt = nowMs(env) - (env.delayMs || DELAY_MS);
      }
      schedule();
      var delayId = setTimeout(schedule, (env.minDelayMs || MIN_DELAY_MS) + 50);
      var delayId2 = setTimeout(schedule, (env.delayMs || DELAY_MS) + 50);
      timers.push(delayId, delayId2);
    }

    function destroy() {
      destroyed = true;
      for (var i = 0; i < listeners.length; i++) {
        var L = listeners[i];
        try { L.target.removeEventListener(L.ev, L.fn, L.opts); } catch (e) { /* ignore */ }
      }
      listeners = [];
      for (var j = 0; j < timers.length; j++) {
        try { clearTimeout(timers[j]); } catch (e2) { /* ignore */ }
      }
      timers = [];
    }

    return {
      platform: platform,
      offerable: offerable,
      ready: ready,
      ctaKind: ctaKind,
      markInteracted: markInteracted,
      onBeforeInstallPrompt: onBeforeInstallPrompt,
      onAppInstalled: onAppInstalled,
      onCta: onCta,
      openSheet: openSheet,
      closeSheet: closeSheet,
      dismissPersistent: dismissPersistent,
      hideBannerSession: hideBannerSession,
      recordDismiss: recordDismiss,
      recordInstalled: recordInstalled,
      schedule: schedule,
      mount: mount,
      destroy: destroy,
      syncVisibility: syncVisibility,
      isInputBlocked: blockedByInput,
      setInputFocused: function (v) { inputFocused = !!v; schedule(); },
      getState: function () {
        return {
          bannerVisible: bannerVisible,
          sheet: sheetName,
          platform: platform(),
          kind: ctaKind(),
          offerable: offerable(),
          ready: ready(),
          interacted: interacted,
          captured: !!capturedPrompt,
          dismissedAt: dismissedAt(),
          installed: installed(),
          standalone: isStandalone(win, nav),
          desktop: isDesktop(nav, win),
          preview: previewFlag()
        };
      }
    };
  }

  function autoMount() {
    if (typeof document === 'undefined') return;
    var run = function () {
      try {
        var c = createController({ window: window, navigator: navigator, document: document });
        root.__vswPwaController = c;
        c.mount();
      } catch (err) {
        try { if (console && console.warn) console.warn('PWA install UI failed to start', err); } catch (e) { /* ignore */ }
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  root.VSWPwaInstall = {
    STORAGE_DISMISS: STORAGE_DISMISS,
    STORAGE_INSTALLED: STORAGE_INSTALLED,
    COOLDOWN_MS: COOLDOWN_MS,
    MIN_DELAY_MS: MIN_DELAY_MS,
    DELAY_MS: DELAY_MS,
    isStandalone: isStandalone,
    isIosDevice: isIosDevice,
    isIosSafari: isIosSafari,
    isAndroid: isAndroid,
    isDesktop: isDesktop,
    detectPlatform: detectPlatform,
    parsePreviewFlag: parsePreviewFlag,
    readTimestamp: readTimestamp,
    isInCooldown: isInCooldown,
    shouldOffer: shouldOffer,
    timingReady: timingReady,
    classifyCta: classifyCta,
    keyboardOpen: keyboardOpen,
    safeStorageGet: safeStorageGet,
    safeStorageSet: safeStorageSet,
    createController: createController,
    autoMount: autoMount
  };

  if (typeof document !== 'undefined' && !root.__vswPwaSkipAuto) {
    autoMount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
