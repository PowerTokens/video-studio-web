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
    try { return root.sessionStorage.getItem(k); } catch (e) { return null; }
  }
  function ssSet(k, v) {
    try { root.sessionStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function ssRemove(k) {
    try { root.sessionStorage.removeItem(k); } catch (e) { /* ignore */ }
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

  function startLogin(opts) {
    opts = opts || {};
    if (!root.crypto || !root.crypto.subtle) {
      return Promise.reject(new Error('pkce_unsupported'));
    }
    var verifier = makeVerifier();
    var state = randomHex(16);
    ssSet(SS_VERIFIER, verifier);
    ssSet(SS_STATE, state);
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
    var err = params.get('error');
    if (err) {
      return Promise.resolve({
        ok: false,
        error: err,
        error_description: params.get('error_description') || ''
      });
    }
    var code = params.get('code');
    var state = params.get('state');
    if (!code || !state) {
      return Promise.resolve({ ok: false, error: 'missing_code' });
    }
    var expected = ssGet(SS_STATE);
    var verifier = ssGet(SS_VERIFIER);
    if (!expected || state !== expected) {
      return Promise.resolve({ ok: false, error: 'state_mismatch' });
    }
    if (!verifier) {
      return Promise.resolve({ ok: false, error: 'missing_verifier' });
    }
    var uri = redirectUri();
    return exchangeToken(code, verifier, uri).then(function (tok) {
      ssRemove(SS_VERIFIER);
      ssRemove(SS_STATE);
      if (!tok.ok || !tok.body || !tok.body.access_token) {
        return {
          ok: false,
          error: (tok.body && tok.body.error) || 'token_exchange_failed',
          error_description: (tok.body && tok.body.error_description) || ''
        };
      }
      return fetchUserinfo(tok.body.access_token).then(function (ui) {
        if (!ui.ok || !ui.body) {
          return {
            ok: false,
            error: (ui.body && ui.body.error) || 'userinfo_failed',
            error_description: (ui.body && ui.body.error_description) || ''
          };
        }
        var info = ui.body;
        saveSession(tok.body, info);
        var keyApplied = false;
        var apiKey = typeof info.key === 'string' ? info.key : '';
        // Strip accidental Bearer prefix without logging the value.
        if (apiKey) {
          try {
            if (root.VSApi && root.VSApi.parseKey && root.VSApi.saveKey) {
              var cleaned = root.VSApi.parseKey(apiKey);
              root.VSApi.saveKey(cleaned);
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
        return { ok: true, profile: profile, keyApplied: keyApplied, credits: profile && profile.credits };
      });
    }, function () {
      return { ok: false, error: 'network' };
    });
  }

  function logout() {
    var token = '';
    var s = store();
    if (s) {
      var t = s.get(TOKEN_KEY, null);
      if (t && t.access_token) token = t.access_token;
    }
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
