/**
 * Desktop download jump: persist inbound UTM (same TRACK_KEYS as utm.js),
 * fill product defaults, then (Windows only) navigate to the latest EXE.
 * Mac and other systems stay on this page so the Beta / Gatekeeper notes remain visible.
 * Do not put UTM on the GitHub binary URL.
 */
(function () {
  'use strict';

  var EXE =
    'https://github.com/PowerTokens/video-studio/releases/latest/download/PowerTokensVideoStudio.exe';
  var CONTENT = (window.VSUtm && window.VSUtm.CONTENT && window.VSUtm.CONTENT.download) || 'web.download_jump';

  function navInfo() {
    var nav = window.navigator || {};
    return { ua: nav.userAgent || '', platform: nav.platform || '' };
  }

  function isIos(info) {
    return /iPhone|iPad|iPod/.test(info.ua);
  }

  function isMac(info) {
    if (isIos(info)) return false;
    return /Mac/.test(info.platform) || /Macintosh/.test(info.ua);
  }

  function isWindows(info) {
    return /Win/.test(info.platform) || /Windows/.test(info.ua);
  }

  function applyDefaults() {
    var U = window.VSUtm;
    if (!U) return;
    // captureFromSearch already ran in utm.js boot; ensure product identity + touchpoint.
    var last = U.lastTouch() || {};
    var patch = {};
    if (!last.utm_source) patch.utm_source = U.DEFAULTS.utm_source;
    if (!last.utm_medium) patch.utm_medium = 'web';
    if (!last.utm_campaign) patch.utm_campaign = U.DEFAULTS.utm_campaign;
    if (!last.utm_content) patch.utm_content = CONTENT;
    if (Object.keys(patch).length) {
      var merged = {};
      Object.keys(last).forEach(function (k) { merged[k] = last[k]; });
      Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
      try {
        window.localStorage.setItem(U.LAST_KEY, JSON.stringify(merged));
        if (!window.localStorage.getItem(U.FIRST_KEY)) {
          window.localStorage.setItem(U.FIRST_KEY, JSON.stringify(merged));
        }
      } catch (e) { /* ignore */ }
    }
  }

  try { applyDefaults(); } catch (e) { /* ignore */ }

  var info = navInfo();
  var body = document && document.body;
  if (body) {
    if (isMac(info)) body.className += (body.className ? ' ' : '') + 'is-mac';
    else if (isWindows(info)) body.className += (body.className ? ' ' : '') + 'is-windows';
  }

  if (!isWindows(info)) return;

  function trackDownloadThenJump() {
    try {
      var A = window.VSAnalytics;
      if (A && typeof A.boot === 'function') {
        A.boot({ appVersion: 'web-1.17', page: 'download' });
        if (A.consentState && A.consentState() === A.CONSENT_GRANTED) {
          if (A.notifyDesktopDownloadClick) A.notifyDesktopDownloadClick('redirect');
          if (A.flush) A.flush({ unload: true });
        }
      }
    } catch (eTrack) { /* never block the download */ }
    try {
      window.location.replace(EXE);
    } catch (e2) {
      window.location.href = EXE;
    }
  }

  // Prefer replace so Back does not bounce through the interstitial.
  trackDownloadThenJump();
})();
