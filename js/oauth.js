/*
 * PowerTokens OAuth 2.0 Authorization Code + PKCE (S256) for Video Studio Web.
 * Authorize: browser navigation to www.powertokens.ai
 * Token / userinfo / revoke: powertokens.ai/api
 * Never logs the API key from userinfo.
 */
(function (root) {
  'use strict';

  var CLIENT_ID = 'powerbaze_desktop_v1';
  var AUTHORIZE_URL = 'https://www.powertokens.ai/oauth/authorize';
  var OAUTH_API_BASE = 'https://powertokens.ai/api';
  var SCOPE = 'read';
  var SS_VERIFIER = 'vsw.oauth.code_verifier';
  var SS_STATE = 'vsw.oauth.state';
  var SS_RETURN = 'vsw.oauth.return_hash';
  var PROFILE_KEY = 'oauth_profile';
  var TOKEN_KEY = 'oauth_token';

  function store() {
    return (root.VSApi && root.VSApi.store) || null;
  }

  function b64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomBytes(n) {
    var a = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (var i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0;
    return a;
  }

  function randomHex(nBytes) {
    var a = randomBytes(nBytes);
    var out = '';
    for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
    return out;
  }

  function makeVerifier() {
    // 43–128 chars; 32 raw bytes → 43 base64url chars.
    return b64url(randomBytes(32));
  }

  function sha256Base64Url(str) {
    var subtle = root.crypto && root.crypto.subtle;
    if (!subtle) return Promise.reject(new Error('pkce_unsupported'));
    var data = new TextEncoder().encode(str);
    return subtle.digest('SHA-256', data).then(function (buf) {
      return b64url(new Uint8Array(buf));
    });
  }

  /**
   * App root URL ending with /. Strips /oauth/callback.html and /index.html.
   * Live Pages: https://powertokens.github.io/video-studio-web/
   */
  function appBaseUrl() {
    var u = new URL(root.location.href);
    var path = u.pathname || '/';
    path = path.replace(/\/oauth\/callback\.html$/i, '/');
    path = path.replace(/\/index\.html$/i, '/');
    if (!/\/$/.test(path)) {
      path = path.replace(/\/[^/]*$/, '/');
      if (path === '') path = '/';
    }
    return u.origin + path;
  }

  /**
   * Exact redirect_uri used in authorize + token exchange.
   * Production (whitelist this):
   *   https://powertokens.github.io/video-studio-web/oauth/callback.html
   * Local / preview derives from the current origin + path so PKCE still matches.
   */
  function redirectUri() {
    var host = root.location.hostname || '';
    if (/^powertokens\.github\.io$/i.test(host)) {
      return 'https://powertokens.github.io/video-studio-web/oauth/callback.html';
    }
    return appBaseUrl() + 'oauth/callback.html';
  }

  function homeUrl(hash) {
    var h = hash ? String(hash).replace(/^#/, '') : 'chat';
    // Chat is the hashless landing tab; Generate and the others keep a hash.
    return appBaseUrl() + (h && h !== 'chat' ? '#' + h : '');
  }

  function ssGet(k) {
    try { return root.localStorage.getItem(k); } catch (e) { return null; }
  }
  function ssSet(k, v) {
    try { root.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function ssRemove(k) {
    try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ }
  }

  function clearPendingLogin() {
    ssRemove('vsw.oauth.started');
    ssRemove(SS_STATE);
    ssRemove(SS_VERIFIER);
  }

  function notifyPendingReturn(reason) {
    try {
      if (ssGet(SS_STATE) && ssGet(SS_VERIFIER) && !getAccessToken() && root.VSAnalytics) root.VSAnalytics.notifyLoginReturnUnsigned(reason);
    } catch (e) { /* analytics fails open */ }
  }
  if (root.addEventListener) {
    root.addEventListener('pageshow', function (event) { if (event.persisted) notifyPendingReturn('back'); });
    root.addEventListener('load', function () {
      if (!/oauth\/callback/.test(root.location.pathname || '')) notifyPendingReturn('reopen');
    });
  }

  function getProfile() {
    var s = store();
    if (!s) return null;
    var p = s.get(PROFILE_KEY, null);
    return p && typeof p === 'object' ? p : null;
  }

  function getAccessToken() {
    var s = store();
    if (!s) return '';
    var t = s.get(TOKEN_KEY, null);
    if (!t || typeof t !== 'object' || !t.access_token) return '';
    if (t.expires_at && Date.now() > t.expires_at) return '';
    return t.access_token;
  }

  function saveSession(tokenBody, userinfo) {
    var s = store();
    if (!s) return;
    var expiresIn = typeof tokenBody.expires_in === 'number' ? tokenBody.expires_in : 1800;
    s.set(TOKEN_KEY, {
      access_token: tokenBody.access_token,
      token_type: tokenBody.token_type || 'Bearer',
      expires_at: Date.now() + Math.max(60, expiresIn - 30) * 1000,
      scope: tokenBody.scope || ''
    });
    // Persist display fields only — never store raw key in oauth_profile.
    s.set(PROFILE_KEY, {
      sub: userinfo.sub || '',
      user_id: userinfo.user_id || '',
      email: userinfo.email || '',
      name: userinfo.name || '',
      avatar: userinfo.avatar || '',
      source: userinfo.source || '',
      credits: typeof userinfo.credits === 'number' ? userinfo.credits : null,
      updated_at: Date.now()
    });
  }

  function clearSession() {
    var s = store();
    if (!s) return;
    s.remove(TOKEN_KEY);
    s.remove(PROFILE_KEY);
  }

  function mapLoginError(code) {
    var t = String(code || '').trim().toLowerCase().replace(/[\s-]/g, '_');
    if (t === 'network' || t === 'http_error') return 'NETWORK';
    if (t === 'timeout') return 'TIMEOUT';
    if (t === 'access_denied') return 'CANCELLED';
    if (t === 'pkce_unsupported' || t === 'unavailable') return 'NOT_ALLOWED';
    if (
      t === 'state_mismatch' || t === 'missing_code' || t === 'missing_verifier' ||
      t === 'token_exchange_failed' || t === 'userinfo_failed' || t === 'invalid_grant' ||
      t === 'invalid_request' || t === 'unauthorized_client' || t.indexOf('auth') >= 0
    ) return 'AUTH';
    return 'UNKNOWN';
  }

  function notifyLoginStart(source) {
    try {
      if (root.VSAnalytics && root.VSAnalytics.notifyLoginStart) root.VSAnalytics.notifyLoginStart(source);
    } catch (e) { /* never break login */ }
  }

  function notifyLoginFailed(code) {
    try {
      if (root.VSAnalytics && root.VSAnalytics.notifyLoginFailed) {
        root.VSAnalytics.notifyLoginFailed({ errorCode: mapLoginError(code), authReason: code });
      }
    } catch (e) { /* never break login */ }
  }

  function startLogin(opts) {
    opts = opts || {};
    var started = Number(ssGet('vsw.oauth.started'));
    if (started && Date.now() - started < 15 * 60 * 1000 && ssGet(SS_STATE)) return Promise.resolve({ pending: true });
    clearPendingLogin();
    notifyLoginStart(opts.source);
    if (!root.crypto || !root.crypto.subtle) {
      notifyLoginFailed('pkce_unsupported');
      return Promise.reject(new Error('pkce_unsupported'));
    }
    var verifier = makeVerifier();
    var state = randomHex(16);
    ssSet('vsw.oauth.started', String(Date.now()));
    ssSet('vsw.oauth.standalone', String(!!((root.navigator && root.navigator.standalone) || (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches))));
    ssSet(SS_VERIFIER, verifier);
    if (!ssSet(SS_STATE, state) || ssGet(SS_VERIFIER) !== verifier) {
      clearPendingLogin();
      notifyLoginFailed('unavailable');
      return Promise.reject(new Error('unavailable'));
    }
    ssSet(SS_RETURN, opts.returnHash || 'generate');
    return sha256Base64Url(verifier).then(function (challenge) {
      var uri = redirectUri();
      var q = new URLSearchParams();
      q.set('client_id', CLIENT_ID);
      q.set('redirect_uri', uri);
      q.set('response_type', 'code');
      q.set('scope', SCOPE);
      q.set('state', state);
      q.set('code_challenge', challenge);
      q.set('code_challenge_method', 'S256');
      // Force Video Studio product UTM on authorize (same as billing).
      // Click ids from last-touch still forward; ad source/medium/campaign do not.
      var utm = root.VSUtm;
      if (utm && typeof utm.applyToSearchParams === 'function') {
        utm.applyToSearchParams(q, {
          content: (utm.CONTENT && utm.CONTENT.oauth) || 'web.oauth_authorize',
          forceProduct: true
        });
      } else {
        // Hard fallback — authorize must never ship without UTM.
        q.set('utm_source', 'videostudio');
        q.set('utm_medium', 'web');
        q.set('utm_campaign', 'video-studio');
        q.set('utm_content', 'web.oauth_authorize');
      }
      root.location.assign(AUTHORIZE_URL + '?' + q.toString());
    });
  }

  function formBody(obj) {
    var parts = [];
    Object.keys(obj).forEach(function (k) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    });
    return parts.join('&');
  }

  function exchangeToken(code, verifier, uri) {
    return root.fetch(OAUTH_API_BASE + '/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      body: formBody({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: uri,
        code_verifier: verifier,
        client_id: CLIENT_ID
      })
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = {};
        try {
          var parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') body = parsed;
        } catch (e) { body = {}; }
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  function fetchUserinfo(accessToken) {
    return root.fetch(OAUTH_API_BASE + '/oauth/userinfo', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json'
      },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer'
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = {};
        try {
          var parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') body = parsed;
        } catch (e) { body = {}; }
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  function revoke(accessToken) {
    if (!accessToken) return Promise.resolve({ ok: true });
    return root.fetch(OAUTH_API_BASE + '/oauth/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      body: formBody({ token: accessToken })
    }).then(function (res) {
      return { ok: res.ok || res.status === 200, status: res.status };
    }, function () {
      return { ok: false, status: null };
    });
  }

  /**
   * Handle ?code=&state= on the callback page (or main page if params land there).
   * Applies userinfo.key via VSApi.saveKey when available.
   * Resolves { ok, error?, profile?, keyApplied? } — never includes the raw key.
   */
  function handleCallback(search) {
    var params = new URLSearchParams(search || root.location.search || '');
    try {
      var clean = new URL(root.location.href);
      ['code', 'state', 'error', 'error_description'].forEach(function (k) { clean.searchParams.delete(k); });
      if (root.history) root.history.replaceState(null, '', clean.href);
    } catch (e) {}
    var consumed = {};
    try { consumed = JSON.parse(ssGet('vsw.oauth.consumed') || '{}'); } catch (e) {}
    Object.keys(consumed).forEach(function (k) { if (Date.now() - consumed[k] > 15 * 60 * 1000) delete consumed[k]; });
    ssSet('vsw.oauth.consumed', JSON.stringify(consumed));
    if (isLoggedIn() || consumed[params.get('state')]) return Promise.resolve({ ok: true, alreadySignedIn: true });
    var err = params.get('error');
    if (err) {
      notifyLoginFailed(err);
      clearPendingLogin();
      return Promise.resolve({
        ok: false,
        error: err,
        error_description: params.get('error_description') || ''
      });
    }
    var code = params.get('code');
    var state = params.get('state');
    if (!code || !state) {
      try { if (root.VSAnalytics) root.VSAnalytics.notifyLoginReturnUnsigned('missing_code'); } catch (e) {}
      notifyLoginFailed('missing_code');
      clearPendingLogin();
      return Promise.resolve({ ok: false, error: 'missing_code' });
    }
    var pendingSince = Number(ssGet('vsw.oauth.started'));
    if (pendingSince && Date.now() - pendingSince >= 15 * 60 * 1000) clearPendingLogin();
    var expected = ssGet(SS_STATE);
    var verifier = ssGet(SS_VERIFIER);
    if (!expected || state !== expected) {
      notifyLoginFailed('state_mismatch');
      clearPendingLogin();
      return Promise.resolve({ ok: false, error: 'state_mismatch' });
    }
    if (!verifier) {
      notifyLoginFailed('missing_verifier');
      clearPendingLogin();
      return Promise.resolve({ ok: false, error: 'missing_verifier' });
    }
    var uri = redirectUri();
    return exchangeToken(code, verifier, uri).then(function (tok) {
      ssRemove(SS_VERIFIER);
      ssRemove(SS_STATE);
      if (!tok.ok || !tok.body || !tok.body.access_token) {
        var tokErr = (tok.body && tok.body.error) || 'token_exchange_failed';
        notifyLoginFailed(tokErr);
        return {
          ok: false,
          error: tokErr,
          error_description: (tok.body && tok.body.error_description) || ''
        };
      }
      return fetchUserinfo(tok.body.access_token).then(function (ui) {
        if (!ui.ok || !ui.body) {
          var uiErr = (ui.body && ui.body.error) || 'userinfo_failed';
          notifyLoginFailed(uiErr);
          return {
            ok: false,
            error: uiErr,
            error_description: (ui.body && ui.body.error_description) || ''
          };
        }
        var info = ui.body;
        saveSession(tok.body, info);
        consumed[state] = Date.now();
        ssSet('vsw.oauth.consumed', JSON.stringify(consumed));
        var keyApplied = false;
        var apiKey = typeof info.key === 'string' ? info.key : '';
        // Strip accidental Bearer prefix without logging the value.
        if (apiKey) {
          try {
            if (root.VSApi && root.VSApi.parseKey && root.VSApi.saveKey) {
              var cleaned = root.VSApi.parseKey(apiKey);
              root.VSApi.saveKey(cleaned, 'oauth');
              root.VSApi.store.remove('key_block');
              root.VSApi.store.set('key_saved_at', Date.now());
              keyApplied = true;
            } else {
              // Callback page may load before full VSApi; write pool directly.
              var PREFIX = /[?&]mock=1(?:&|$)/.test(root.location.search) ? 'vsw.mock.' : 'vsw.';
              try {
                var rawKeys = root.localStorage.getItem(PREFIX + 'keys');
                var keys = rawKeys ? JSON.parse(rawKeys) : [];
                if (!Array.isArray(keys)) keys = [];
                var k = String(apiKey).replace(/^(?:Bearer\s+)/i, '').trim();
                var active = JSON.parse(root.localStorage.getItem(PREFIX + 'key') || 'null');
                if (active && keys.indexOf(active) < 0) keys.push(active);
                var issued = JSON.parse(root.localStorage.getItem(PREFIX + 'login_only_keys') || '[]');
                if (k && keys.indexOf(k) < 0 && issued.indexOf(k) < 0) issued.push(k);
                root.localStorage.setItem(PREFIX + 'login_only_keys', JSON.stringify(issued));
                if (keys.indexOf(k) < 0) keys.push(k);
                root.localStorage.setItem(PREFIX + 'keys', JSON.stringify(keys));
                root.localStorage.setItem(PREFIX + 'key', JSON.stringify(k));
                root.localStorage.removeItem(PREFIX + 'key_block');
                root.localStorage.setItem(PREFIX + 'key_saved_at', JSON.stringify(Date.now()));
                keyApplied = !!k;
              } catch (e) { keyApplied = false; }
            }
          } catch (e) {
            keyApplied = false;
          }
        }
        var profile = getProfile();
        try {
          if (root.VSAnalytics && root.VSAnalytics.notifyLoginSuccess) {
            root.VSAnalytics.notifyLoginSuccess({
              keyApplied: keyApplied
            });
          }
        } catch (ignoreAnalytics) { /* never break login */ }
        return { ok: true, profile: profile, keyApplied: keyApplied, credits: profile && profile.credits, returnToStandalone: ssGet('vsw.oauth.standalone') === 'true' };
      });
    }, function () {
      notifyLoginFailed('network');
      return { ok: false, error: 'network' };
    }).catch(function () {
      notifyLoginFailed('network');
      return { ok: false, error: 'network' };
    }).then(function (result) {
      clearPendingLogin();
      return result;
    });
  }

  function logout() {
    var token = '';
    var s = store();
    if (s) {
      var t = s.get(TOKEN_KEY, null);
      if (t && t.access_token) token = t.access_token;
    }
    // Deactivate locally before the network revoke completes. Untagged legacy
    // keys are preserved because they cannot safely be distinguished from pastes.
    if (s) {
      var issued = s.get('login_only_keys', []);
      var keys = s.get('keys', []).filter(function (k) { return issued.indexOf(k) < 0; });
      var active = s.get('key', '');
      s.set('keys', keys);
      if (issued.indexOf(active) >= 0) {
        if (keys.length) s.set('key', keys[0]);
        else s.remove('key');
      }
      s.remove('login_only_keys');
    }
    clearSession();
    return revoke(token).then(function () {
      clearSession();
      return { ok: true };
    }, function () {
      clearSession();
      return { ok: true };
    });
  }

  function isLoggedIn() {
    return !!(getProfile() && getAccessToken());
  }

  function consumeReturnHash() {
    var h = ssGet(SS_RETURN) || 'generate';
    ssRemove(SS_RETURN);
    return h;
  }

  root.VSOauth = {
    CLIENT_ID: CLIENT_ID,
    AUTHORIZE_URL: AUTHORIZE_URL,
    OAUTH_API_BASE: OAUTH_API_BASE,
    redirectUri: redirectUri,
    appBaseUrl: appBaseUrl,
    homeUrl: homeUrl,
    startLogin: startLogin,
    handleCallback: handleCallback,
    logout: logout,
    revoke: revoke,
    getProfile: getProfile,
    getAccessToken: getAccessToken,
    clearSession: clearSession,
    isLoggedIn: isLoggedIn,
    consumeReturnHash: consumeReturnHash,
    PRODUCTION_REDIRECT_URI: 'https://powertokens.github.io/video-studio-web/oauth/callback.html'
  };
})(window);
