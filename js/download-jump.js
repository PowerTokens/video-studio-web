/**
 * Desktop download jump: persist inbound UTM (same TRACK_KEYS as utm.js),
 * fill product defaults, then navigate to the latest EXE (no UTM on GitHub URL).
 */
(function () {
  'use strict';

  var EXE =
    'https://github.com/PowerTokens/video-studio/releases/latest/download/PowerTokensVideoStudio.exe';
  var CONTENT = (window.VSUtm && window.VSUtm.CONTENT && window.VSUtm.CONTENT.download) || 'web.download_jump';

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

  // Prefer replace so Back does not bounce through the interstitial.
  try {
    window.location.replace(EXE);
  } catch (e2) {
    window.location.href = EXE;
  }
})();
