/* PowerTokens Video Studio · Web — UI */
(function () {
  'use strict';
  var M = window.VSModels;
  var A = window.VSApi;
  var I = window.VSI18n;
  var O = window.VSOauth;

  var lang = 'en';
  var EXAMPLE_IDS = ['shopping', 'canyon', 'seal', 'locker'];
  /** Recommended model per example preset. null = any model (do not change Settings). */
  var EXAMPLE_MODELS = {
    shopping: 'wan3.0-video',
    canyon: 'wan3.0-video',
    seal: 'wan3.0-video',
    locker: 'wan3.0-video'
  };
  var EXAMPLE_FAMILIES = {
    shopping: 'wan',
    canyon: 'wan',
    seal: 'wan',
    locker: 'wan'
  };
  /** Local showcase GIFs (from PowerTokens/video-studio README) shown in Progress on preset click. */
  var EXAMPLE_PREVIEW = {
    shopping: 'assets/presets/product.gif',
    canyon: 'assets/presets/cinematic.gif',
    seal: 'assets/presets/fantasy.gif',
    locker: 'assets/presets/drama.gif'
  };
  /** Settings to apply with each Generate preset. Default first card stays beginner-cheap (~5s · 720p). */
  var EXAMPLE_SPECS = {
    shopping: { duration: 5, ratio: '9:16', resolution: '720p' },
    canyon: { duration: 5, ratio: '9:16', resolution: '720p' },
    seal: { duration: 5, ratio: '9:16', resolution: '720p' },
    locker: { duration: 16, ratio: '16:9', resolution: '1080p' }
  };
  /** Active Generate-tab preset id for Progress sample; cleared on generate / preset clear. */
  var previewPresetId = null;

  function $(id) { return document.getElementById(id); }
  function t() { return I.t.apply(null, [lang].concat(Array.prototype.slice.call(arguments))); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function money(v) { return Number(v).toFixed(2); }
  function resLabel(r) { return r === '4k' ? '4K' : r; }
  function ratioLabel(r) { return r === 'adaptive' ? t('ratio_adaptive') : r; }
  function show(node, on) { if (node) node.hidden = !on; }


  // White + teal custom selects (replace OS cement-gray dropdown chrome).
  var CSELECT_IDS = ['gen-model', 'gen-res', 'gen-ratio', 'manual-kind'];
  var openCSelect = null;

  function closeCSelect() {
    if (!openCSelect) return;
    openCSelect.classList.remove('is-open');
    var menu = openCSelect.querySelector('.cselect-menu');
    if (menu) menu.hidden = true;
    var btn = openCSelect.querySelector('.cselect-trigger');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    openCSelect = null;
  }

  function syncCSelect(sel) {
    if (!sel || !sel._cselect) return;
    var wrap = sel._cselect;
    var btn = wrap.querySelector('.cselect-trigger');
    var label = wrap.querySelector('.cselect-trigger-label');
    var menu = wrap.querySelector('.cselect-menu');
    var opt = sel.options[sel.selectedIndex];
    fillChoiceLabel(label, opt);
    btn.disabled = !!sel.disabled;
    menu.innerHTML = '';
    Array.prototype.forEach.call(sel.options, function (o, idx) {
      var li = el('li', 'cselect-opt' + (o.selected ? ' is-selected' : ''));
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', o.selected ? 'true' : 'false');
      li.dataset.value = o.value;
      fillChoiceLabel(li, o);
      li.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (sel.value !== o.value) {
          sel.value = o.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          syncCSelect(sel);
        }
        closeCSelect();
      });
      menu.appendChild(li);
    });
  }

  function fillChoiceLabel(node, opt) {
    node.textContent = '';
    if (!opt) return;
    node.appendChild(el('span', 'cselect-label-text', opt.textContent));
    var pct = opt.getAttribute('data-discount');
    if (pct) node.appendChild(el('span', 'discount-badge', t('discount_badge', pct)));
  }

  function enhanceSelect(sel) {
    if (!sel || sel._cselect) return;
    var wrap = el('div', 'cselect');
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('cselect-native');
    sel.setAttribute('tabindex', '-1');
    var btn = el('button', 'cselect-trigger');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (sel.id) btn.id = sel.id + '-trigger';
    var label = el('span', 'cselect-trigger-label', '');
    var caret = el('span', 'cselect-caret');
    caret.setAttribute('aria-hidden', 'true');
    btn.appendChild(label);
    btn.appendChild(caret);
    var menu = el('ul', 'cselect-menu');
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    sel._cselect = wrap;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (sel.disabled) return;
      if (openCSelect === wrap) { closeCSelect(); return; }
      closeCSelect();
      syncCSelect(sel);
      wrap.classList.add('is-open');
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      openCSelect = wrap;
    });
    sel.addEventListener('change', function () { syncCSelect(sel); });
    syncCSelect(sel);
  }

  function enhanceAllSelects() {
    CSELECT_IDS.forEach(function (id) { enhanceSelect($(id)); });
  }


  function modelDesc(m) {
    var key = 'model_desc_' + m.short_name.replace(/-/g, '_');
    var s = t(key);
    return s === key ? m.description_en : s;
  }
  function modelSummary(m) {
    var text = modelDesc(m);
    if (text.indexOf('。') >= 0) { var p = text.split('。')[0]; return p ? p + '。' : text; }
    var seps = ['. ', ' — ', ' - '];
    for (var i = 0; i < seps.length; i++) if (text.indexOf(seps[i]) >= 0) return text.split(seps[i])[0].replace(/\.+$/, '') + '.';
    return text;
  }
  // Model-limit notices and price links have zh / en wording (same as the desktop app); other languages use English.
  function modelLang() { return lang === 'zh' ? 'zh' : 'en'; }

  var toastTimer = null;
  function toast(msg) {
    var n = $('toast');
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.hidden = true; }, 3200);
  }

  // ---------------- language ----------------
  // Outbound PowerTokens CTAs: last-touch UTM from VSUtm (persisted first/last).
  var PT_OUTBOUND_HREF = { signup_url: 1, site_url: 1, billing_url: 1 };
  var PT_OUTBOUND_CONTENT = {
    signup_url: 'web.signup',
    site_url: 'web.footer_site',
    billing_url: 'web.billing'
  };

  function buildPtOutbound(base, content, opts) {
    opts = opts || {};
    var U = window.VSUtm;
    if (U && typeof U.buildOutbound === 'function') {
      return U.buildOutbound(base, content, opts);
    }
    // Fallback if utm.js missing: still attach product defaults.
    try {
      var url = new URL(String(base || ''), location.href);
      url.searchParams.set('utm_source', 'videostudio');
      url.searchParams.set('utm_medium', 'web');
      url.searchParams.set('utm_campaign', 'video-studio');
      if (content) url.searchParams.set('utm_content', content);
      return url.toString();
    } catch (e) { return base; }
  }

  function buildBillingOutbound(base, content) {
    return buildPtOutbound(base, content || 'web.billing', { forceProduct: true });
  }

  function applyStatic() {
    var meta = I.meta(lang) || {};
    document.documentElement.lang = meta.htmlLang || lang;
    document.title = t('page_title');
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (n) { n.placeholder = t(n.getAttribute('data-i18n-ph')); });
    document.querySelectorAll('[data-href]').forEach(function (n) {
      var key = n.getAttribute('data-href');
      var href = t(key);
      if (PT_OUTBOUND_HREF[key]) {
        var force = (key === 'billing_url');
        n.href = buildPtOutbound(href, PT_OUTBOUND_CONTENT[key], force ? { forceProduct: true } : null);
      } else {
        n.href = href;
      }
    });
    // Language dropdown (browser detect → EN default; persist after user choice).
    // Update in place — recreating <select> on every setLang leaves native teal/arrow paint over the label.
    var box = $('lang-switch');
    if (!box) return;
    var codes = I.languages();
    var sel = $('lang-select');
    if (!sel || sel.tagName !== 'SELECT') {
      box.innerHTML = '';
      sel = el('select');
      sel.id = 'lang-select';
      sel.setAttribute('aria-label', 'Language');
      box.appendChild(sel);
    }
    var needRebuild = sel.options.length !== codes.length;
    if (!needRebuild) {
      for (var i = 0; i < codes.length; i++) {
        if (sel.options[i].value !== codes[i]) { needRebuild = true; break; }
      }
    }
    if (needRebuild) {
      sel.innerHTML = '';
      codes.forEach(function (code) {
        var meta = I.meta(code) || {};
        var o = el('option', '', meta.name || code);
        o.value = code;
        sel.appendChild(o);
      });
    } else {
      codes.forEach(function (code, idx) {
        var meta = I.meta(code) || {};
        sel.options[idx].textContent = meta.name || code;
      });
    }
    if (sel.value !== lang) sel.value = lang;
    // Bind once. Do not rewrite the page or blur the control inside the change
    // event: mobile pickers roll the selection back, so the menu moves and the
    // UI stays on the previous language. Apply on the next turn, and ignore a
    // same-turn revert to the language already on screen.
    if (!sel._vswLangBound) {
      sel._vswLangBound = true;
      var queued = null;
      function queueLang() {
        var code = sel.value;
        if (!I.has(code)) return;
        if (queued && queued.code !== code && code === lang) return;
        if (!queued && code === lang) return;
        if (queued) clearTimeout(queued.timer);
        var timer = setTimeout(function () {
          queued = null;
          setLang(code, true);
          if (sel.value !== lang) sel.value = lang;
        }, 0);
        queued = { code: code, timer: timer };
      }
      sel.addEventListener('change', queueLang);
      sel.addEventListener('input', queueLang);
    }
    renderFirstFrameCard();
    renderModelDetailsBtn();
  }

  function setLang(code, persist) {
    lang = I.has(code) ? code : 'en';
    if (persist) A.store.set('lang', lang);
    applyStatic();
    if (window.VSChatPilot && window.VSChatPilot.refreshUi) {
      try { window.VSChatPilot.refreshUi(); } catch (eRefresh) { /* ignore */ }
    }
    renderKeyState();
    renderOauthAccount();
    renderCredits();
    renderGenModels();
    renderGenParams(false);
    renderResults();
    renderTasks();
    renderManualKinds();
    renderStatus();
    renderExamples();
    refreshPresetPrompt();
  }

  /** If the Generate box still holds a preset prompt, show that preset in the new language. */
  function refreshPresetPrompt() {
    var ta = $('gen-prompt');
    if (!ta || !I || !I.languages) return;
    var raw = String(ta.value || '').trim();
    if (!raw) return;
    var codes = I.languages();
    var id = null;
    for (var i = 0; i < EXAMPLE_IDS.length && !id; i++) {
      var eid = EXAMPLE_IDS[i];
      for (var c = 0; c < codes.length; c++) {
        var known = I.t(codes[c], 'example_' + eid + '_prompt');
        if (known && String(known).trim() === raw) { id = eid; break; }
      }
    }
    if (!id) return;
    var next = String(t('example_' + id + '_prompt') || '');
    if (next && next !== ta.value) {
      ta.value = next;
      gen.prompt = next;
      saveGen();
    }
    previewPresetId = id;
  }


  function rootChatPilotEnabled() {
    return !!(window.VSChatPilot && window.VSChatPilot.isEnabled && window.VSChatPilot.isEnabled());
  }

  // ---------------- tabs ----------------
  var TABS = ['chat', 'generate', 'tasks', 'account'];
  function setTab(name, push) {
    if (name === 'key' || name === 'keys') name = 'account'; // legacy Key tab → Account
    var invalid = TABS.indexOf(name) < 0;
    if (invalid) name = 'generate';
    if (name === 'chat' && !(rootChatPilotEnabled())) {
      name = 'generate';
      invalid = true;
    }
    TABS.forEach(function (n) { show($('panel-' + n), n === name); });
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // push=true updates URL; also clear dead hashes (#batch / #compare) when falling back.
    if ((push || invalid) && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search + (name === 'generate' ? '' : '#' + name));
    }
    window.scrollTo(0, 0);
    if (name === 'chat' && window.VSChatPilot && window.VSChatPilot.onShow) {
      try { window.VSChatPilot.onShow(); } catch (eChat) { /* ignore */ }
    }
  }

  // ---------------- key ----------------
  function renderNokeyBanner() {
    // Green under-tabs Key banner removed: beginners do not think in API keys;
    // header Sign-in CTA + status bar cover logged-out. Paste-key stays on Account → Advanced.
    var banner = $('nokey-banner');
    if (banner) show(banner, false);
  }

  // API Key tab pill: three dots (bad / warn / ok). Green = usable; red = auth/none; amber = quota (need top-up).
  function syncKeyBlockFromRec(rec) {
    if (!rec || rec.removed || !A.getKey()) return;
    if (rec.error === 'AUTH' || rec.error === 'query_auth') {
      A.store.set('key_block', 'auth');
      return;
    }
    if (rec.error === 'QUOTA' || isBalanceError(rec)) {
      A.store.set('key_block', 'quota');
      return;
    }
    // Server accepted this key (got a task id / active or done work).
    if (rec.task_id && ['submitting', 'queued', 'running', 'done'].indexOf(rec.state) >= 0) {
      A.store.remove('key_block');
    }
  }

  function currentKeyBlock() {
    if (!A.getKey()) return 'none';
    if (A.balanceEnabled() && typeof balance === 'number' && balance <= 0) return 'quota';
    var stored = A.store.get('key_block', null);
    if (stored === 'auth' || stored === 'quota') return stored;
    return null;
  }

  function renderKeyPoolList() {
    var list = $('key-pool-list');
    var statusEl = $('key-status');
    if (!list || !statusEl) return;
    var keys = A.listKeys();
    var active = A.getKey();
    list.innerHTML = '';
    if (!keys.length) {
      statusEl.hidden = false;
      statusEl.textContent = t('key_none');
      statusEl.classList.add('badge-bad');
      list.hidden = true;
      return;
    }
    statusEl.hidden = true;
    statusEl.textContent = '';
    list.hidden = false;
    keys.forEach(function (k, idx) {
      var isActive = k === active;
      var li = document.createElement('li');
      li.className = 'key-pool-item' + (isActive ? ' is-active' : '');
      var select = document.createElement('button');
      select.type = 'button';
      select.className = 'key-pool-select';
      select.setAttribute('data-idx', String(idx));
      select.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      select.title = isActive ? t('pool_active') : t('pool_use');
      var radio = document.createElement('span');
      radio.className = 'key-pool-radio';
      radio.setAttribute('aria-hidden', 'true');
      var code = document.createElement('code');
      code.textContent = '…' + A.keyHint(k);
      select.appendChild(radio);
      select.appendChild(code);
      if (isActive) {
        var tag = document.createElement('span');
        tag.className = 'key-pool-active-tag';
        tag.textContent = t('pool_active');
        select.appendChild(tag);
      }
      var forget = document.createElement('button');
      forget.type = 'button';
      forget.className = 'btn btn-small key-forget-one';
      forget.setAttribute('data-idx', String(idx));
      forget.textContent = t('key_forget');
      li.appendChild(select);
      li.appendChild(forget);
      list.appendChild(li);
    });
  }

  function renderKeyState() {
    var key = A.getKey();
    var block = currentKeyBlock();
    var ok = !!key && !block;
    var isQuota = block === 'quota';
    var keyBadge = $('key-badge');
    var keyBadgeText = $('key-badge-text');
    if (keyBadge) {
      var noKey = !key || block === 'none';
      // Soft "Sign in" pill duplicates #header-oauth-login — hide until there is a real key state.
      keyBadge.hidden = !!noKey;
      keyBadge.classList.toggle('is-ok', ok);
      keyBadge.classList.toggle('is-warn', isQuota);
      keyBadge.classList.toggle('is-soft', !ok && !isQuota && noKey);
      keyBadge.classList.toggle('is-bad', !ok && !isQuota && !noKey);
      keyBadge.setAttribute('aria-hidden', noKey ? 'true' : 'false');
      var title;
      if (noKey) title = t('key_chip_none');
      else if (block === 'auth') title = t('key_chip_auth');
      else if (block === 'quota') title = t('key_chip_quota');
      else title = t('key_chip_ok');
      keyBadge.title = title;
      keyBadge.setAttribute('aria-label', title);
      if (keyBadgeText) {
        if (ok) keyBadgeText.textContent = t('key_status_ok');
        else if (isQuota) keyBadgeText.textContent = t('key_status_quota');
        else if (noKey) keyBadgeText.textContent = t('key_status_signin');
        else keyBadgeText.textContent = t('key_status_check');
      }
    }
    renderKeyPoolList();
    renderNokeyBanner();
    renderStatus();
    renderOauthAccount();
  }

  // Desktop-style status line at the bottom: 就绪 · 请先在「API Key」页添加 Key / 就绪 · N 个任务进行中
  function renderStatus() {
    var bar = $('statusbar');
    if (!bar) return;
    var running = A.loadTasks().filter(function (r) { return r.state === 'submitting' || r.state === 'queued' || r.state === 'running'; }).length;
    bar.textContent = !A.getKey() ? t('status_ready') : running ? t('status_running', running) : t('status_idle');
  }

  // Header "积分 / 充值" chip. Prefers OAuth userinfo credits; else VSApi balance stub when enabled.
  var balance = null;
  function localeNum(n) {
    return n.toLocaleString(I.meta(lang) ? I.meta(lang).htmlLang : undefined);
  }
  function oauthCredits() {
    if (!O || !O.getProfile) return null;
    var p = O.getProfile();
    return p && typeof p.credits === 'number' && isFinite(p.credits) ? p.credits : null;
  }
  function renderCredits() {
    var oc = oauthCredits();
    var shown = typeof balance === 'number' ? balance : oc;
    var txt = typeof shown === 'number'
      ? t('credits_balance', localeNum(shown))
      : t('credits_btn');
    $('billing-chip-text').textContent = txt;
    $('billing-chip').title = t('credits_btn');
  }
  function refreshBalance() {
    var oc = oauthCredits();
    if (typeof oc === 'number') balance = oc;
    if (!A.balanceEnabled()) { renderCredits(); return; }
    var key = A.getKey();
    if (!key) { if (typeof oc !== 'number') balance = null; renderCredits(); return; }
    A.fetchBalance(key).then(function (v) {
      if (typeof v === 'number') balance = v;
      else if (typeof oc === 'number') balance = oc;
      renderCredits();
      renderKeyState();
    });
  }

  /** Map verifyKey failure to a user-facing string. */
  function verifyFailMessage(result) {
    if (!result) return t('err_auth');
    if (result.kind === 'NETWORK') return t('err_network');
    if (result.kind === 'AUTH') return t('err_auth');
    if (result.kind === 'QUOTA') return t('err_quota');
    if (result.kind === 'NOT_ALLOWED') return t('err_not_allowed');
    if (result.detail) return result.detail;
    return t('key_verify_fail');
  }

  /**
   * Parse → live verify (GET /v1/models) → save only on success.
   * Used by the Account tab advanced paste form. Returns a Promise.
   */
  function verifyAndSaveKey(raw, opts) {
    opts = opts || {};
    var inputEl = opts.inputEl;
    var errEl = opts.errEl;
    var btnEl = opts.btnEl;
    var busyLabel = t('key_verifying');
    var idleLabel = t('key_verify');
    function setBusy(on) {
      if (!btnEl) return;
      btnEl.disabled = !!on;
      btnEl.textContent = on ? busyLabel : idleLabel;
    }
    function fail(msg) {
      if (errEl) { errEl.textContent = msg; show(errEl, true); }
      setBusy(false);
      return false;
    }
    var k;
    try {
      k = A.parseKey(raw);
    } catch (e) {
      return Promise.resolve(fail(t('key_invalid_chars')));
    }
    if (errEl) show(errEl, false);
    setBusy(true);
    return A.verifyKey(k).then(function (result) {
      if (!result || !result.ok) {
        // Do not persist a rejected key; leave the pool / active key alone.
        if (result && result.kind === 'AUTH') {
          // If this exact key was already active, mark the badge red.
          if (A.getKey() === k) {
            A.store.set('key_block', 'auth');
            renderKeyState();
          }
        }
        return fail(verifyFailMessage(result));
      }
      A.saveKey(k);
      A.store.remove('key_block');
      A.store.set('key_saved_at', Date.now());
      if (inputEl) inputEl.value = '';
      if (errEl) show(errEl, false);
      setBusy(false);
      renderKeyState();
      toast(t('key_verify_ok', A.keyHint(k)));
      refreshBalance();
      A.resumeOnLoad(k);
      if (opts.onSuccess) opts.onSuccess(k);
      return true;
    }, function () {
      return fail(t('err_network'));
    });
  }

  function renderOauthAccount() {
    var box = $('oauth-account');
    var label = $('oauth-account-label');
    var loginBtn = $('header-oauth-login');
    var panelLogin = $('oauth-login-btn');
    var panelLogout = $('oauth-logout-btn');
    var status = $('oauth-status');
    var profile = O && O.getProfile ? O.getProfile() : null;
    var loggedIn = !!(profile && O && O.getAccessToken && O.getAccessToken());
    if (!loggedIn && profile && O && !O.getAccessToken()) {
      // Token expired: keep profile credits for display but treat as logged out for revoke UI.
      loggedIn = false;
    }
    // Soft login: profile present counts as signed-in for UI even if token near expiry.
    var signed = !!profile;
    if (box) show(box, signed);
    if (loginBtn) show(loginBtn, !signed);
    if (panelLogin) show(panelLogin, !signed);
    if (panelLogout) show(panelLogout, signed);
    if (label) {
      if (signed) {
        var name = profile.name || profile.email || profile.user_id || 'PowerTokens';
        // Name-only chip; credits live on the billing chip (official console pattern).
        label.textContent = name;
        label.title = t('oauth_signed_in', name);
      } else {
        label.textContent = '';
        label.title = '';
      }
    }
    if (status) {
      if (signed) {
        var sName = profile.name || profile.email || '';
        status.hidden = false;
        status.textContent = typeof profile.credits === 'number'
          ? (t('oauth_signed_in', sName) + ' · ' + t('oauth_credits', localeNum(profile.credits)))
          : t('oauth_signed_in', sName);
      } else {
        status.hidden = true;
        status.textContent = '';
      }
    }
    renderNokeyBanner();
    try { renderGenCost(); } catch (e) { /* form may not be ready yet */ }
  }

  function setOauthBusy(on) {
    ['header-oauth-login', 'oauth-login-btn', 'oauth-logout', 'oauth-logout-btn'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.disabled = !!on;
    });
    var status = $('oauth-status');
    if (on && status) {
      status.hidden = false;
      status.textContent = t('oauth_busy');
    }
  }

  function oauthFailMessage(err) {
    if (err === 'pkce_unsupported') return t('oauth_pkce_unsupported');
    return t('oauth_fail', err || 'error');
  }

  function currentTabName() {
    var h = (location.hash || '').replace(/^#/, '');
    if (TABS.indexOf(h) >= 0) return h;
    var active = document.querySelector('.tabs [data-tab].active');
    if (active) {
      var n = active.getAttribute('data-tab');
      if (TABS.indexOf(n) >= 0) return n;
    }
    return 'generate';
  }

  function startOauthLogin() {
    var errEl = $('oauth-error');
    if (errEl) show(errEl, false);
    if (!O || !O.startLogin) {
      toast(oauthFailMessage('unavailable'));
      return;
    }
    setOauthBusy(true);
    // Return to the tab the user left (Generate by default; Account if they started from Account).
    O.startLogin({ returnHash: currentTabName() }).catch(function (e) {
      setOauthBusy(false);
      var code = (e && e.message) || 'error';
      var msg = oauthFailMessage(code);
      if (errEl) { errEl.textContent = msg; show(errEl, true); }
      toast(msg);
    });
  }

  function doOauthLogout() {
    if (!O || !O.logout) return;
    setOauthBusy(true);
    O.logout().then(function () {
      setOauthBusy(false);
      // Keep API keys in the pool; only clear OAuth session / display credits from profile.
      if (typeof oauthCredits() !== 'number') balance = null;
      renderOauthAccount();
      renderCredits();
      renderKeyState();
      toast(t('oauth_logged_out'));
    });
  }

  function promptForKeyOrLogin(errEl) {
    var msg = t('need_key');
    if (errEl) { errEl.textContent = msg; show(errEl, true); }
    else toast(msg);
    var profile = O && O.getProfile ? O.getProfile() : null;
    if (!profile) {
      startOauthLogin();
      return;
    }
    setTab('account', true);
  }

  function bindOauth() {
    if (!O) return;
    var headerLogin = $('header-oauth-login');
    var panelLogin = $('oauth-login-btn');
    var headerLogout = $('oauth-logout');
    var panelLogout = $('oauth-logout-btn');
    if (headerLogin) headerLogin.addEventListener('click', startOauthLogin);
    if (panelLogin) panelLogin.addEventListener('click', startOauthLogin);
    if (headerLogout) headerLogout.addEventListener('click', doOauthLogout);
    if (panelLogout) panelLogout.addEventListener('click', doOauthLogout);
  }

  /** If authorize redirected to the SPA root with ?code=, finish here then clean the URL. */
  function maybeHandleOauthQuery() {
    if (!O || !O.handleCallback) return Promise.resolve(false);
    var params = new URLSearchParams(location.search || '');
    if (!params.get('code') || !params.get('state')) return Promise.resolve(false);
    setOauthBusy(true);
    return O.handleCallback(location.search).then(function (result) {
      setOauthBusy(false);
      if (history.replaceState) {
        history.replaceState(null, '', location.pathname + (location.hash || ''));
      }
      if (!result || !result.ok) {
        var msg = oauthFailMessage((result && (result.error_description || result.error)) || 'callback_failed');
        var errEl = $('oauth-error');
        if (errEl) { errEl.textContent = msg; show(errEl, true); }
        setTab('account', true);
        toast(msg);
        return false;
      }
      var oc = oauthCredits();
      if (typeof oc === 'number') balance = oc;
      renderOauthAccount();
      renderCredits();
      renderKeyState();
      A.resumeOnLoad(A.getKey());
      var ret = (O.consumeReturnHash && O.consumeReturnHash()) || 'generate';
      if (TABS.indexOf(ret) < 0) ret = 'generate';
      setTab(ret, true);
      toast(result.keyApplied ? t('oauth_ok') : t('oauth_ok_nokey'));
      return true;
    }, function () {
      setOauthBusy(false);
      toast(oauthFailMessage('network'));
      return false;
    });
  }

  function bindKey() {
    $('key-show').addEventListener('change', function () {
      $('key-input').type = $('key-show').checked ? 'text' : 'password';
    });
    $('key-save').addEventListener('click', function () {
      verifyAndSaveKey($('key-input').value, {
        inputEl: $('key-input'),
        errEl: $('key-error'),
        btnEl: $('key-save')
      });
    });
    $('key-input').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        $('key-save').click();
      }
    });
    var list = $('key-pool-list');
    if (list) {
      list.addEventListener('click', function (ev) {
        var target = ev.target;
        if (!target || !target.closest) return;
        var forgetBtn = target.closest('.key-forget-one');
        var selectBtn = target.closest('.key-pool-select');
        var keys = A.listKeys();
        if (forgetBtn) {
          var fIdx = parseInt(forgetBtn.getAttribute('data-idx'), 10);
          var fk = keys[fIdx];
          if (!fk) return;
          var wasActive = fk === A.getKey();
          A.forgetKey(fk);
          if (wasActive) {
            A.store.remove('key_block');
            A.store.remove('key_saved_at');
            balance = null;
            renderCredits();
          }
          if (!A.getKey()) $('key-input').value = '';
          renderKeyState();
          toast(t('key_forgotten'));
          if (A.getKey()) refreshBalance();
          return;
        }
        if (selectBtn) {
          var sIdx = parseInt(selectBtn.getAttribute('data-idx'), 10);
          var sk = keys[sIdx];
          if (!sk || sk === A.getKey()) return;
          A.setActiveKey(sk);
          A.store.remove('key_block');
          A.store.set('key_saved_at', Date.now());
          renderKeyState();
          toast(t('pool_switched', A.keyHint(sk)));
          refreshBalance();
          A.resumeOnLoad(sk);
        }
      });
    }
  }

  // ---------------- no-key advanced jump (Account tab) ----------------
  /** Advanced users: open Account tab, expand paste panel, focus input. */
  function openKeyTabAdvanced() {
    setTab('account', true);
    var details = $('key-advanced-details');
    if (details) details.open = true;
    var input = $('key-input');
    if (input) {
      window.setTimeout(function () {
        input.focus();
        try { input.select(); } catch (e) { /* ignore */ }
      }, 0);
    }
  }

  function bindNokeyAdvanced() {
  }

  // ---------------- generate form ----------------
  var gen = A.store.get('gen_form', null) || {};
  gen = {
    model: M.MODELS[gen.model] ? gen.model : M.DEFAULT_MODEL_ID,
    duration: gen.duration || 5,
    resolution: gen.resolution || '720p',
    ratio: gen.ratio || '16:9',
    prompt: gen.prompt || ''
  };
  var genNotice = '';
  var genImage = null; // {dataUrl, bytes}
  var openDetails = {};

  function saveGen() { A.store.set('gen_form', gen); }

  // Desktop layout: 模型 combobox, one-line summary + 详情 link, full description and links on demand.
  function renderGenModels() {
    var sel = $('gen-model');
    sel.innerHTML = '';
    M.listModels().forEach(function (m) {
      var rt = M.rangeText(m);
      var o = el('option', '', M.label(m, modelLang()) + ' · ' + t('model_limits', rt.seconds, rt.resolutions));
      o.value = m.id;
      var pct = M.discountPercent(m);
      if (pct) o.setAttribute('data-discount', String(pct));
      o.selected = m.id === gen.model;
      sel.appendChild(o);
    });
    syncCSelect(sel);
    var m = M.getModel(gen.model);
    $('gen-model-desc').textContent = modelSummary(m);
    var full = $('gen-model-full');
    full.innerHTML = '';
    full.appendChild(el('p', '', modelDesc(m)));
    var a1 = el('a', '', t('model_price_link'));
    a1.href = M.priceSource(m, modelLang()); a1.target = '_blank'; a1.rel = 'noopener';
    var a2 = el('a', '', t('model_docs_link'));
    a2.href = M.docsUrl(m, modelLang()); a2.target = '_blank'; a2.rel = 'noopener';
    full.appendChild(a1); full.appendChild(a2);
    show(full, !!openDetails.on);
    renderModelDetailsBtn();
  }

  function renderModelDetailsBtn() {
    var b = $('gen-model-details');
    if (!b) return;
    b.textContent = openDetails.on ? t('model_details_hide') : t('model_details');
    b.setAttribute('aria-expanded', openDetails.on ? 'true' : 'false');
  }

  function modelAllowsFirstFrame(m) {
    var allowed = {
      wan: 1, seedance: 1, kling: 1, vidu: 1, h3: 0, hailuo: 0
    };
    return !!allowed[m.family];
  }

  function renderFirstFrameCard() {
    var m = M.getModel(gen.model);
    var card = $('gen-ff-card');
    if (!card) return;
    var ok = modelAllowsFirstFrame(m);
    card.classList.toggle('is-unsupported', !ok);
    show($('gen-ff-unsupported'), !ok);
    // Tip lives on the summary; keep the inner copy hidden to avoid duplication.
    show($('gen-ff-tip'), false);
    show($('gen-ff-controls'), ok);
    // Wan local-embed warning only when supported + local image present
    show($('gen-ff-note'), ok && !!genImage && m.family === 'wan');
    var hasMedia = !!(genImage || ($('gen-ff-url') && $('gen-ff-url').value.trim()));
    // Beginner default: collapsed. Auto-open only when the user already attached media.
    if (ok && hasMedia) card.open = true;
    if (ok && $('gen-ff-url') && $('gen-ff-url').value.trim()) {
      var urlDetails = $('gen-ff-url-details');
      if (urlDetails) urlDetails.open = true;
    }
  }

  function renderCurrent() {
    var m = M.getModel(gen.model);
    var parts = [t('param_seconds', gen.duration), resLabel(gen.resolution), ratioLabel(gen.ratio)];
    if (genImage || $('gen-ff-url').value.trim()) parts.push(t('media_first_frame'));
    // Desktop badge: "Wan 3.0 (wan3.0-video)"; the web adds the chosen parameters underneath.
    $('gen-current').textContent = t('current_model_fmt', M.label(m, modelLang()), m.id);
    $('gen-current-params').textContent = parts.join(' · ');
  }

  function selectGenModel(id) {
    gen.model = id;
    var m = M.getModel(id);
    var s = M.snapParams(m, gen.duration, gen.resolution, gen.ratio);
    gen.duration = s.duration; gen.resolution = s.resolution; gen.ratio = s.ratio;
    genNotice = s.changes.length ? { model: id, changes: s.changes } : '';
    saveGen();
    renderGenModels();
    renderGenParams(true);
  }

  function fillResSelect(sel, values, current) {
    sel.innerHTML = '';
    values.forEach(function (v) {
      var o = el('option', '', resLabel(v));
      o.value = v;
      o.selected = v === current;
      sel.appendChild(o);
    });
    syncCSelect(sel);
  }

  function fillSelect(sel, values, current) {
    sel.innerHTML = '';
    values.forEach(function (v) {
      var o = el('option', '', ratioLabel(v));
      o.value = v;
      o.selected = v === current;
      sel.appendChild(o);
    });
    syncCSelect(sel);
  }

  function renderGenParams() {
    var m = M.getModel(gen.model);
    var dur = $('gen-duration');
    dur.min = m.durations[0];
    dur.max = m.durations[m.durations.length - 1];
    dur.value = gen.duration;
    fillResSelect($('gen-res'), m.resolutions, gen.resolution);
    fillSelect($('gen-ratio'), m.ratios, gen.ratio);
    var n = $('gen-notice');
    if (genNotice && genNotice.model === gen.model) {
      n.textContent = M.formatAdjustNotice(m, genNotice.changes, modelLang());
      show(n, true);
    } else show(n, false);
    renderFirstFrameCard();
    renderGenCost();
    renderCurrent();
  }

  /** Snap edited values to the model's limits (same rules as the desktop app) and show the 已按模型限制自动调整 notice. */
  function applyGenEdit(field, value) {
    var m = M.getModel(gen.model);
    var d = gen.duration, r = gen.resolution, a = gen.ratio;
    if (field === 'duration') d = value;
    if (field === 'resolution') r = value;
    if (field === 'ratio') a = value;
    var s = M.snapParams(m, d, r, a);
    gen.duration = s.duration; gen.resolution = s.resolution; gen.ratio = s.ratio;
    genNotice = s.changes.length ? { model: gen.model, changes: s.changes } : '';
    saveGen();
    renderGenParams();
  }

  function renderGenCost() {
    var costEl = $('gen-cost');
    var stickyCost = $('gen-sticky-cost');
    if (!costEl || typeof gen === 'undefined' || !gen) return;
    try {
      var c = M.estimateCost(gen.duration, gen.resolution, gen.model);
      var credits = M.estimateCreditsFromUsd(c.total);
      var costText = t(
        'cost_estimate',
        M.PRICE_CHECKED_DATE,
        localeNum(credits),
        money(c.total),
        money(c.perSecond)
      );
      costEl.textContent = costText;
      if (stickyCost) stickyCost.textContent = costText;
      syncGenerateAvailability(credits);
    } catch (e) {
      costEl.textContent = t('cost_invalid');
      if (stickyCost) stickyCost.textContent = t('cost_invalid');
      syncGenerateAvailability(null);
    }
  }

  /** Disable Generate when OAuth credits are known and below the estimate; point to billing chip. */
  function syncGenerateAvailability(creditsNeeded) {
    var btn = $('gen-submit');
    var hint = $('gen-insufficient');
    var oc = oauthCredits();
    var insuff = typeof creditsNeeded === 'number' && typeof oc === 'number' && creditsNeeded > oc;
    if (btn && !genBusy) {
      btn.disabled = !!insuff;
      btn.title = insuff ? t('credits_insufficient') : '';
    }
    if (hint) {
      show(hint, !!insuff);
      if (insuff) hint.textContent = t('credits_insufficient');
    }
  }

  function focusBillingChip() {
    var chip = $('billing-chip');
    if (!chip) return;
    try { chip.focus(); } catch (e) { /* ignore */ }
    try { chip.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e2) { /* ignore */ }
    // Soft pulse so beginners notice the existing top-up control.
    chip.classList.add('is-pulse');
    window.setTimeout(function () { chip.classList.remove('is-pulse'); }, 1200);
  }

  function syncStopVisibility() {
    var stop = $('gen-stop');
    if (!stop) return;
    var id = A.store.get('last_single', null);
    var rec = id ? A.getTask(id) : null;
    var active = !!(rec && (rec.state === 'queued' || rec.state === 'running') && A.isPolling(rec.local_id));
    stop.disabled = !active;
    show(stop, active);
  }


  // ---------------- examples ----------------
  function renderExamples() {
    var box = $('gen-example-chips');
    if (!box) return;
    box.innerHTML = '';
    EXAMPLE_IDS.forEach(function (id) {
      var label = t('example_' + id + '_label');
      var blurb = t('example_' + id + '_blurb');
      var b = el('button', 'example-chip example-preset');
      b.type = 'button';
      var family = EXAMPLE_FAMILIES[id];
      b.appendChild(el('span', 'chip-title', label));
      if (blurb && blurb.indexOf('example_') !== 0) {
        b.appendChild(el('span', 'preset-blurb', blurb));
      }
      // All Generate presets are Wan 3.0 — no family badge/logo on chips.
      b.setAttribute('data-example', id);
      b.setAttribute('data-target', 'gen');
      if (family) b.setAttribute('data-family', family);
      b.title = t('example_' + id + '_prompt');
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { applyExample(id, 'gen', b); });
      box.appendChild(b);
    });
    // Keep Generate chip selected across i18n re-renders.
    if (previewPresetId) {
      var activeBtn = document.querySelector('#gen-example-chips .example-chip[data-example="' + previewPresetId + '"]');
      if (activeBtn) setExampleActive('gen', activeBtn);
    }
  }

  function setExampleActive(target, btn) {
    var sel = '#gen-example-chips .example-chip';
    document.querySelectorAll(sel).forEach(function (n) {
      var on = btn && n === btn;
      n.classList.toggle('active', on);
      n.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }


  /** Infer whole-second duration from prompt text (aligned with desktop input_helpers.infer_prompt).
   *  Priority: declared total (总时长/Total length) → leading "10-second"/"约 10 秒" → shot-timeline end (0-2s…8-10s).
   *  Returns null when nothing reliable is found. */
  function inferPromptDuration(text) {
    if (!text) return null;
    var s = String(text).toLowerCase().replace(/：/g, ':');
    var qty = '(\\d+(?:\\.\\d+)?)';
    var unit = '\\s*[-－]?\\s*(秒钟?|seconds?(?![a-z])|secs?(?![a-z])|s(?![a-z]))';
    var about = '(?:(?:about|around|approximately|approx\\.?|roughly|约)\\s*)?';
    function clamp(v) {
      v = Math.round(parseFloat(v));
      if (!isFinite(v)) return null;
      return Math.min(30, Math.max(2, v));
    }
    var totalRe = new RegExp('(?:总时长|全片时长|视频时长|时长|total\\s+(?:duration|length|runtime|running\\s+time|time)|total|duration|length|runtime|running\\s+time)\\s*(?:of\\s+|is\\s+)?[:=为约是~]?\\s*' + about + qty + unit);
    var totalSuffix = new RegExp(qty + unit + '\\s+(?:in\\s+)?(?:total|overall|long)\\b');
    var hyphenSec = new RegExp('^\\s*' + about + qty + '[-－]\\s*(?:second|sec)(?![a-z])');
    var leadAbout = new RegExp('^\\s*' + about + qty + unit);
    var m = s.match(totalRe) || s.match(totalSuffix) || s.match(hyphenSec) || s.match(leadAbout);
    if (m) {
      var n = clamp(m[1]);
      if (n !== null) return n;
    }
    var rangeRe = new RegExp(qty + '\\s*(?:[-–—~～至到]|to)\\s*' + qty + unit, 'g');
    var maxEnd = null, rm;
    while ((rm = rangeRe.exec(s))) {
      var end = parseFloat(rm[2]);
      if (isFinite(end) && (maxEnd === null || end > maxEnd)) maxEnd = end;
    }
    if (maxEnd !== null) return clamp(maxEnd);
    return null;
  }

  /** Apply EXAMPLE_SPECS (duration / ratio / resolution) then snap to the active model. */
  function applyExampleSpecs(id, target) {
    var spec = EXAMPLE_SPECS[id];
    if (!spec) return;
    var m = M.getModel(gen.model);
    var s = M.snapParams(
      m,
      spec.duration != null ? spec.duration : gen.duration,
      spec.resolution != null ? spec.resolution : gen.resolution,
      spec.ratio != null ? spec.ratio : gen.ratio
    );
    gen.duration = s.duration;
    gen.resolution = s.resolution;
    gen.ratio = s.ratio;
    genNotice = s.changes.length ? { model: gen.model, changes: s.changes } : '';
    saveGen();
    renderGenParams();
  }

  /** After filling a long prompt, show the start (browsers often jump to the end). */
  function showPromptStart(ta) {
    if (!ta) return;
    try {
      ta.focus();
      if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(0, 0);
      else {
        ta.selectionStart = 0;
        ta.selectionEnd = 0;
      }
    } catch (e) { /* ignore */ }
    ta.scrollTop = 0;
  }

  /** After filling a preset, bring Settings / Generate into view on short viewports. */
  function scrollParamsIntoView(target) {
    var anchor = $('gen-submit');
    if (!anchor) return;
    var card = anchor.closest ? anchor.closest('.card') : null;
    var el = card || anchor;
    if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function applyExample(id, target, btn) {
    var wasActive = btn && btn.classList.contains('active');
    if (wasActive) {
      $('gen-prompt').value = '';
      gen.prompt = '';
      saveGen();
      showPromptStart($('gen-prompt'));
      previewPresetId = null;
      renderResults();
      setExampleActive(target, null);
      return;
    }

    var prompt = t('example_' + id + '_prompt');
    $('gen-prompt').value = prompt;
    gen.prompt = prompt;
    saveGen();
    setExampleActive(target, btn);
    var modelId = EXAMPLE_MODELS[id];
    if (modelId && M.MODELS[modelId] && gen.model !== modelId) {
      selectGenModel(modelId);
    }
    showPromptStart($('gen-prompt'));
    previewPresetId = id;
    renderResults();
    // Match Settings to showcase prompt specs (duration / ratio / resolution), then snap to model.
    applyExampleSpecs(id, target);
    scrollParamsIntoView(target);
  }

  function showPresetPreview(box, id) {
    box.innerHTML = '';
    var wrap = el('div', 'preset-sample');
    wrap.appendChild(el('p', 'preset-sample-label', t('preset_sample_label')));
    var img = el('img', 'preset-sample-gif');
    img.src = EXAMPLE_PREVIEW[id] || EXAMPLE_PREVIEW.locker;
    img.alt = t('preset_sample_label');
    img.loading = 'lazy';
    wrap.appendChild(img);
    wrap.appendChild(el('p', 'preset-sample-note muted small', t('preset_sample_note')));
    box.appendChild(wrap);
  }

  /** On empty Generate prompt, select first preset via applyExample. If stored prompt still matches a preset, only restore chip + sample. */
  function maybeDefaultGenPreset() {
    var p = (gen.prompt || '').trim();
    if (!p) {
      var id = EXAMPLE_IDS[0];
      var btn = document.querySelector('#gen-example-chips .example-chip[data-example="' + id + '"]');
      if (btn) applyExample(id, 'gen', btn);
      return;
    }
    for (var i = 0; i < EXAMPLE_IDS.length; i++) {
      var eid = EXAMPLE_IDS[i];
      var expected = t('example_' + eid + '_prompt');
      if (!expected || p !== String(expected).trim()) continue;
      var b = document.querySelector('#gen-example-chips .example-chip[data-example="' + eid + '"]');
      if (b) {
        setExampleActive('gen', b);
        previewPresetId = eid;
        renderResults();
      }
      break;
    }
  }


  /** Prefill classic Generate from a chat-pilot plan card (MVP: human still clicks Generate). */
  function fillGenerateFromPlan(plan) {
    if (!plan || !plan.prompt) return;
    var promptEl = $('gen-prompt');
    if (promptEl) promptEl.value = plan.prompt;
    gen.prompt = plan.prompt;
    if (plan.model && M.MODELS[plan.model] && gen.model !== plan.model) {
      selectGenModel(plan.model);
    }
    var m = M.getModel(gen.model);
    var s = M.snapParams(
      m,
      plan.duration != null ? plan.duration : gen.duration,
      plan.resolution != null ? plan.resolution : gen.resolution,
      plan.ratio != null ? plan.ratio : gen.ratio
    );
    gen.duration = s.duration;
    gen.resolution = s.resolution;
    gen.ratio = s.ratio;
    genNotice = s.changes.length ? { model: gen.model, changes: s.changes } : '';
    saveGen();
    previewPresetId = null;
    setExampleActive('gen', null);
    renderGenParams();
    renderResults();
    showPromptStart(promptEl);
  }

  function bindGen() {
    var prompt = $('gen-prompt');
    prompt.value = gen.prompt;
    prompt.addEventListener('input', function () { gen.prompt = prompt.value; saveGen(); });
    $('gen-model').addEventListener('change', function (e) { selectGenModel(e.target.value); });
    $('gen-model-details').addEventListener('click', function () { openDetails.on = !openDetails.on; renderGenModels(); });
    $('gen-duration').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      var m = M.getModel(gen.model);
      if (m.durations.indexOf(v) >= 0) { gen.duration = v; genNotice = ''; saveGen(); show($('gen-notice'), false); renderGenCost(); renderCurrent(); }
    });
    $('gen-duration').addEventListener('change', function (e) {
      var v = parseFloat(e.target.value);
      applyGenEdit('duration', isFinite(v) ? Math.round(v) : gen.duration);
    });
    $('gen-res').addEventListener('change', function (e) { applyGenEdit('resolution', e.target.value); });
    $('gen-ratio').addEventListener('change', function (e) { applyGenEdit('ratio', e.target.value); });
    $('gen-stop').addEventListener('click', function () {
      var id = A.store.get('last_single', null);
      if (id && A.isPolling(id)) A.stopPolling(id);
    });
    syncStopVisibility();
    var insuff = $('gen-insufficient');
    if (insuff) {
      insuff.addEventListener('click', function (e) {
        e.preventDefault();
        focusBillingChip();
        var chip = $('billing-chip');
        if (chip && chip.href) {
          // Keep existing billing fallback tab; user already asked not to build in-app checkout yet.
          try { chip.click(); } catch (err) { /* ignore */ }
        }
      });
    }

    $('gen-ff-url').addEventListener('input', function () {
      if ($('gen-ff-url').value.trim() && genImage) clearImage();
      show($('gen-ff-error'), false);
      renderCurrent();
    });
    $('gen-ff-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      prepareImage(f).then(function (img) {
        genImage = img;
        $('gen-ff-url').value = '';
        $('gen-ff-img').src = img.dataUrl;
        $('gen-ff-info').textContent = t('first_frame_local', Math.round(img.bytes / 1024));
        show($('gen-ff-preview'), true);
        show($('gen-ff-error'), false);
        renderGenParams();
      }, function (err) {
        $('gen-ff-error').textContent = t(err && err.message === 'too_large' ? 'first_frame_too_large' : 'first_frame_bad');
        show($('gen-ff-error'), true);
      });
    });
    $('gen-ff-remove').addEventListener('click', clearImage);
    $('gen-submit').addEventListener('click', submitGen);
  }

  function clearImage() {
    genImage = null;
    $('gen-ff-img').removeAttribute('src');
    show($('gen-ff-preview'), false);
    renderGenParams();
  }

  var MAX_IMAGE_BYTES = 4 * 1024 * 1024; // same cap as the desktop app's frame tool

  /** Re-encode to JPEG (strips EXIF/location data), longest side ≤ 2048, ≤ 4 MB. */
  function prepareImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type || '')) return reject(new Error('bad'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var attempts = [[2048, 0.9], [2048, 0.8], [1536, 0.8], [1280, 0.75]];
        for (var i = 0; i < attempts.length; i++) {
          var maxSide = attempts[i][0];
          var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          var w = Math.max(1, Math.round(img.naturalWidth * scale));
          var h = Math.max(1, Math.round(img.naturalHeight * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var dataUrl = canvas.toDataURL('image/jpeg', attempts[i][1]);
          var bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
          if (bytes <= MAX_IMAGE_BYTES) return resolve({ dataUrl: dataUrl, bytes: bytes, width: w, height: h });
        }
        reject(new Error('too_large'));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad')); };
      img.src = url;
    });
  }

  function errorText(code) {
    var map = {
      media_url_invalid: 'media_url_invalid', need_prompt_or_media: 'need_prompt',
      duration_not_allowed: 'cost_invalid', resolution_not_allowed: 'cost_invalid', ratio_not_allowed: 'cost_invalid', duration_int: 'cost_invalid',
      vidu_need_image: 'vidu_need_image', vidu_media_limited: 'vidu_media_limited',
      hailuo_1080_only_6s: 'hailuo_1080_only_6s', model_t2v_only: 'model_t2v_only'
    };
    return t(map[code] || 'cost_invalid');
  }

  var genBusy = false;
  function submitGen() {
    if (genBusy) return;
    var errBox = $('gen-error');
    show(errBox, false);
    var key = A.getKey();
    if (!key) { promptForKeyOrLogin(errBox); return; }
    try {
      var preCost = M.estimateCost(gen.duration, gen.resolution, gen.model);
      var need = M.estimateCreditsFromUsd(preCost.total);
      var have = oauthCredits();
      if (typeof need === 'number' && typeof have === 'number' && need > have) {
        errBox.textContent = t('credits_insufficient');
        show(errBox, true);
        focusBillingChip();
        return;
      }
    } catch (ignoreCost) { /* ignore — generate still allowed if estimate fails */ }
    var media = [];
    var mSpec = M.getModel(gen.model);
    if (modelAllowsFirstFrame(mSpec)) {
      var ffUrl = $('gen-ff-url').value.trim();
      if (genImage) media.push({ type: 'first_frame', url: genImage.dataUrl });
      else if (ffUrl) media.push({ type: 'first_frame', url: ffUrl });
    }
    var prompt = $('gen-prompt').value;
    if (!prompt.trim() && !media.length) { errBox.textContent = t('need_prompt'); show(errBox, true); return; }
    var built;
    try {
      built = M.buildRequest(gen.model, prompt, gen.duration, gen.resolution, gen.ratio, media);
    } catch (e) {
      errBox.textContent = errorText(e.code); show(errBox, true); return;
    }
    var cost = M.estimateCost(gen.duration, gen.resolution, gen.model).total;
    genBusy = true;
    var btn = $('gen-submit');
    btn.disabled = true;
    btn.textContent = t('generating_btn');
    btn.setAttribute('data-i18n', 'generating_btn');
    var plan = { model: gen.model, prompt: prompt, duration: gen.duration, resolution: gen.resolution, ratio: gen.ratio, cost: cost, has_image: !!media.length };
    previewPresetId = null;
    A.store.set('last_single', null);
    var first = true;
    A.submit(plan, built, key, function (info) {
      if (info.rateLimited) toast(t('rate_limited_retry', info.seconds, info.attempt, info.max));
    }).then(function (rec) {
      if (first) A.store.set('last_single', rec.local_id);
      first = false;
      renderResults();
    }).finally(function () {
      genBusy = false;
      btn.textContent = t('generate_btn');
      btn.setAttribute('data-i18n', 'generate_btn');
      renderGenCost();
    });
    // Show the "submitting" card right away.
    var pending = A.loadTasks()[0];
    if (pending) { A.store.set('last_single', pending.local_id); renderResults(); }
    var pc = $('progress-card');
    if (pc.scrollIntoView) pc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------------- task cards ----------------
  var STATE_KEY = {
    submitting: 'st_submitting', queued: 'st_queued', running: 'st_running', done: 'st_done', failed: 'st_failed',
    uncertain: 'st_uncertain', rejected: 'st_rejected', stopped: 'st_stopped', timeout: 'st_timeout',
    query_down: 'st_query_down', ready_no_url: 'st_ready_no_url'
  };
  var STATE_TONE = {
    submitting: 'busy', queued: 'busy', running: 'busy', done: 'ok', failed: 'bad', uncertain: 'warn',
    rejected: 'bad', stopped: 'idle', timeout: 'warn', query_down: 'warn', ready_no_url: 'warn'
  };

  function recordError(rec) {
    var e = rec.error;
    var detail = rec.error_detail ? ' — ' + rec.error_detail : '';
    if (!e) return '';
    if (e === 'AUTH') return t('err_auth') + detail;
    if (e === 'QUOTA') return t('err_quota') + detail;
    if (e === 'NOT_ALLOWED') return t('err_not_allowed') + detail;
    if (e === 'RATE_LIMIT' || e === 'PARAM') return 'HTTP ' + rec.http + detail;
    if (e === 'uncertain') return t('err_uncertain', rec.http ? 'HTTP ' + rec.http : t('err_network')) + (rec.error_detail ? ' (' + rec.error_detail + ')' : '');
    if (e === 'uncertain_reload') return t('err_uncertain_reload');
    if (e === 'server_failed') return t('err_server_failed', rec.error_detail ? (lang === 'zh' ? '：' : ': ') + rec.error_detail : '');
    if (e === 'query_down') return t('err_query_down', rec.error_count || 6, rec.http);
    if (e === 'query_auth') return t('err_query_auth') + detail;
    if (e === 'timeout') return t('err_timeout');
    if (e === 'ready_no_url') return t('err_ready_no_url');
    return e;
  }

  var BALANCE_HINT = /quota|insufficient|balance|credit|余额|额度|积分不足/i;
  function isBalanceError(rec) {
    if (rec.error === 'QUOTA') return true;
    return (rec.state === 'failed' || rec.state === 'rejected' || rec.state === 'uncertain') &&
      BALANCE_HINT.test(rec.error_detail || '');
  }

  function elapsedText(rec) {
    var end = rec.finished || Date.now();
    var s = Math.max(0, Math.round((end - rec.created) / 1000));
    var mm = Math.floor(s / 60), ss = s % 60;
    return mm + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function videoSrc(rec) {
    if (rec.video_url) return window.VSMock ? window.VSMock.mapUrl(rec.video_url) : rec.video_url;
    return A.blobUrl(rec.local_id);
  }

  function fileName(rec) {
    var m = M.MODELS[rec.model];
    return 'pt-video_' + (m ? m.short_name : 'video') + '_' + String(rec.task_id).slice(-10) + '.mp4';
  }

  var playing = {};
  /** Build (or update in place) a task card. */
  function taskCard(rec, opts) {
    opts = opts || {};
    var card = el('article', 'task');
    card.setAttribute('data-local-id', rec.local_id);
    fillCard(card, rec, opts);
    return card;
  }

  function fillCard(card, rec, opts) {
    var m = M.MODELS[rec.model];
    var oldVideo = card.querySelector('video');
    var keepVideo = oldVideo && oldVideo.getAttribute('data-src') === videoSrc(rec) && rec.state === 'done';
    if (keepVideo) oldVideo.remove();
    card.innerHTML = '';
    card.className = 'task tone-' + (STATE_TONE[rec.state] || 'idle');

    var head = el('div', 'task-head');
    var title = el('div', 'task-title');
    title.appendChild(el('strong', '', m ? M.label(m, modelLang()) : rec.model));
    if (rec.compare_id && opts.showCompareTag) title.appendChild(el('span', 'tag', t('tasks_compare_tag')));
    head.appendChild(title);
    head.appendChild(el('span', 'state state-' + (STATE_TONE[rec.state] || 'idle'), t(STATE_KEY[rec.state] || 'st_queued')));
    card.appendChild(head);

    var parts = [];
    if (rec.duration) parts.push(t('param_seconds', rec.duration));
    if (rec.resolution) parts.push(resLabel(rec.resolution));
    if (rec.ratio) parts.push(ratioLabel(rec.ratio));
    if (rec.cost !== null && rec.cost !== undefined && rec.cost !== '') parts.push(t('compare_plan_cost', localeNum(M.estimateCreditsFromUsd(rec.cost)), money(rec.cost)));
    if (parts.length) card.appendChild(el('div', 'task-params', parts.join(' · ')));
    if (opts.showPrompt && rec.prompt) card.appendChild(el('div', 'task-prompt', rec.prompt));

    var busy = rec.state === 'submitting' || rec.state === 'queued' || rec.state === 'running';
    if (busy) {
      var bar = el('div', 'progress' + (rec.progress ? '' : ' indeterminate'));
      var fill = el('div', 'progress-fill');
      if (rec.progress) fill.style.width = Math.max(4, Math.min(100, rec.progress)) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
      var meta = el('div', 'task-meta');
      var elapsed = el('span', 'elapsed', t('elapsed', elapsedText(rec)));
      elapsed.setAttribute('data-elapsed', rec.local_id);
      meta.appendChild(elapsed);
      if (rec.progress) meta.appendChild(el('span', '', t('progress_pct', rec.progress)));
      card.appendChild(meta);
    }

    var err = recordError(rec);
    if (err) card.appendChild(el('p', 'task-error', err));
    if (isBalanceError(rec)) {
      var top = el('a', 'btn btn-accent btn-small topup', t('topup_btn'));
      top.href = buildBillingOutbound(t('billing_url'), (window.VSUtm && window.VSUtm.CONTENT && window.VSUtm.CONTENT.billing) || 'web.billing');
      top.target = '_blank';
      top.rel = 'noopener';
      card.appendChild(top);
    }
    if (rec.state === 'stopped') card.appendChild(el('p', 'muted small', t('stopped_note')));

    if (rec.task_id) {
      var idRow = el('div', 'task-id');
      idRow.appendChild(el('span', 'muted', t('task_id')));
      var code = el('code', '', rec.task_id);
      idRow.appendChild(code);
      var cp = el('button', 'link link-small', t('copy'));
      cp.type = 'button';
      cp.addEventListener('click', function () {
        copyText(rec.task_id).then(function () { toast(t('copied') + ': ' + rec.task_id); });
      });
      idRow.appendChild(cp);
      card.appendChild(idRow);
    }

    var src = rec.state === 'done' ? videoSrc(rec) : '';
    // Task list: load players only on demand, so a long history doesn't pull every video.
    var showPlayer = src && (!opts.lazyVideo || playing[rec.local_id]);
    if (showPlayer) {
      var v = keepVideo ? oldVideo : el('video', 'player');
      if (!keepVideo) {
        v.controls = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.preload = 'metadata';
        v.src = src;
        v.setAttribute('data-src', src);
      }
      card.appendChild(v);
    } else if (rec.state === 'done' && rec.content_fallback) {
      // Blob from /content is gone after a reload: fetch it again (no new generation).
      var reload = el('button', 'btn btn-small', t('resume_btn'));
      reload.type = 'button';
      reload.addEventListener('click', function () {
        A.fetchContent(rec.local_id, A.getKey()).then(function () { renderResults(); renderTasks(); });
      });
      card.appendChild(reload);
    }

    var actions = el('div', 'task-actions');
    if (src && !showPlayer) {
      var play = el('button', 'btn btn-small', t('play_btn'));
      play.type = 'button';
      play.addEventListener('click', function () { playing[rec.local_id] = true; fillCard(card, rec, opts); });
      actions.appendChild(play);
    }
    if (src) {
      var dl = el('button', 'btn btn-accent btn-small', t('download_btn'));
      dl.type = 'button';
      dl.addEventListener('click', function () {
        dl.disabled = true;
        dl.textContent = t('downloading');
        var target = rec.video_url || src;
        A.download(target, fileName(rec)).then(function (r) {
          dl.disabled = false;
          dl.textContent = t('download_btn');
          if (r === 'blocked') {
            toast(t('download_opened'));
            window.open(videoSrc(rec), '_blank', 'noopener');
          }
        });
      });
      actions.appendChild(dl);
      var open = el('a', 'btn btn-small', t('open_btn'));
      open.href = src;
      open.target = '_blank';
      open.rel = 'noopener';
      actions.appendChild(open);
    }
    if ((rec.state === 'queued' || rec.state === 'running') && A.isPolling(rec.local_id)) {
      var stop = el('button', 'btn btn-small', t('stop_btn'));
      stop.type = 'button';
      stop.addEventListener('click', function () { A.stopPolling(rec.local_id); });
      actions.appendChild(stop);
    }
    var resumable = rec.task_id && (['stopped', 'timeout', 'query_down', 'ready_no_url'].indexOf(rec.state) >= 0 ||
      ((rec.state === 'queued' || rec.state === 'running') && !A.isPolling(rec.local_id)));
    if (resumable) {
      var rs = el('button', 'btn btn-small', t('resume_btn'));
      rs.type = 'button';
      rs.addEventListener('click', function () {
        var key = A.getKey();
        if (!key) { promptForKeyOrLogin(); return; }
        A.update(rec.local_id, { state: 'queued', error: '', error_detail: '' });
        A.startPolling(rec.local_id, key);
      });
      actions.appendChild(rs);
    }
    if (opts.removable && !(busy && A.isPolling(rec.local_id))) {
      var rm = el('button', 'btn btn-small', t('remove_btn'));
      rm.type = 'button';
      rm.addEventListener('click', function () { A.removeTask(rec.local_id); });
      actions.appendChild(rm);
    }
    if (actions.children.length) card.appendChild(actions);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  // ---------------- result panels ----------------
  function renderResults() {
    var box = $('gen-result');
    var id = A.store.get('last_single', null);
    var rec = id ? A.getTask(id) : null;
    var busy = !!(rec && (rec.state === 'submitting' || rec.state === 'queued' || rec.state === 'running'));
    if (busy || (rec && !previewPresetId)) {
      syncCards(box, rec ? [rec] : [], {}, 'result_empty');
    } else if (previewPresetId && EXAMPLE_PREVIEW[previewPresetId]) {
      showPresetPreview(box, previewPresetId);
    } else {
      syncCards(box, [], {}, 'result_empty');
    }
    syncStopVisibility();
  }

  function renderTasks() {
    var list = A.loadTasks();
    syncCards($('tasks-list'), list, { showPrompt: true, removable: true, showCompareTag: true, lazyVideo: true }, 'tasks_empty');
    var sp = A.spendSummary();
    show($('spend-line'), sp.count > 0);
    if (sp.count) $('spend-text').textContent = t('spend_line', money(sp.total), sp.count);
    show($('tasks-badge'), list.some(function (r) { return r.state === 'queued' || r.state === 'running' || r.state === 'submitting'; }));
    renderStatus();
  }

  /** Re-use existing card nodes (keeps <video> playback position) and update them in place. */
  function syncCards(box, recs, opts, emptyKey) {
    if (!recs.length) {
      box.innerHTML = '';
      box.appendChild(el('p', 'empty', t(emptyKey)));
      return;
    }
    var existing = {};
    box.querySelectorAll('[data-local-id]').forEach(function (n) { existing[n.getAttribute('data-local-id')] = n; });
    var empty = box.querySelector('.empty');
    if (empty) empty.remove();
    recs.forEach(function (rec, i) {
      var card = existing[rec.local_id];
      if (card) { fillCard(card, rec, opts); delete existing[rec.local_id]; }
      else card = taskCard(rec, opts);
      if (box.children[i] !== card) box.insertBefore(card, box.children[i] || null);
    });
    Object.keys(existing).forEach(function (k) { existing[k].remove(); });
  }

  // ---------------- tasks tab ----------------
  function renderManualKinds() {
    var sel = $('manual-kind');
    var cur = sel.value;
    sel.innerHTML = '';
    var opts = [];
    M.listModels().forEach(function (m) {
      if (m.family === 'kling') {
        opts.push([m.id + '|kling_t2v', t('manual_kling_t2v'), 0]);
        opts.push([m.id + '|kling_i2v', t('manual_kling_i2v'), 0]);
      } else opts.push([m.id + '|unified', M.label(m, modelLang()), M.discountPercent(m)]);
    });
    opts.forEach(function (o) {
      var op = el('option', '', o[1]);
      op.value = o[0];
      if (o[2]) op.setAttribute('data-discount', String(o[2]));
      op.selected = o[0] === cur;
      sel.appendChild(op);
    });
    syncCSelect(sel);
  }

  function bindTasks() {
    $('spend-reset').addEventListener('click', function () { A.resetSpend(); renderTasks(); });
    // 刷新: query every unfinished task again (never resubmits).
    $('tasks-refresh').addEventListener('click', function () {
      var key = A.getKey();
      if (!key) { promptForKeyOrLogin(); return; }
      A.loadTasks().forEach(function (r) {
        if (r.task_id && ['queued', 'running', 'stopped', 'timeout', 'query_down', 'ready_no_url'].indexOf(r.state) >= 0 && !A.isPolling(r.local_id)) {
          A.update(r.local_id, { state: 'queued', error: '', error_detail: '' });
          A.startPolling(r.local_id, key);
        }
      });
      renderTasks();
    });
    $('tasks-copy').addEventListener('click', function () {
      var ids = A.loadTasks().map(function (r) { return r.task_id; }).filter(Boolean);
      if (!ids.length) { toast(t('nothing_to_copy')); return; }
      copyText(ids.join('\n')).then(function () { toast(t('copied_ids', ids.length)); });
    });
    $('tasks-clear').addEventListener('click', function () {
      A.loadTasks().forEach(function (r) {
        if (['done', 'failed', 'rejected'].indexOf(r.state) >= 0) A.removeTask(r.local_id);
      });
      renderTasks();
      renderResults();
    });
    $('manual-btn').addEventListener('click', function () {
      var err = $('manual-error');
      show(err, false);
      var key = A.getKey();
      if (!key) { promptForKeyOrLogin(err); return; }
      var parts = $('manual-kind').value.split('|');
      var id = $('manual-id').value.trim();
      try {
        A.attach(parts[0], parts[1], id, key);
        $('manual-id').value = '';
        renderTasks();
      } catch (e) {
        err.textContent = t('task_id_invalid'); show(err, true);
      }
    });
  }

  // ---------------- boot ----------------
  function tick() {
    document.querySelectorAll('[data-elapsed]').forEach(function (n) {
      var rec = A.getTask(n.getAttribute('data-elapsed'));
      if (rec) n.textContent = t('elapsed', elapsedText(rec));
    });
  }


  /** Recover key_block after reload from tasks created under the current key. */
  function hydrateKeyBlockFromHistory() {
    if (!A.getKey()) { A.store.remove('key_block'); return; }
    if (A.store.get('key_block', null)) return;
    var savedAt = A.store.get('key_saved_at', 0) || 0;
    var latestBlock = null, latestBlockAt = 0, latestOkAt = 0;
    A.loadTasks().forEach(function (r) {
      var ts = r.updated || r.created || 0;
      if (savedAt && ts < savedAt) return;
      if (r.error === 'AUTH' || r.error === 'query_auth') {
        if (ts >= latestBlockAt) { latestBlockAt = ts; latestBlock = 'auth'; }
      } else if (r.error === 'QUOTA' || isBalanceError(r)) {
        if (ts >= latestBlockAt) { latestBlockAt = ts; latestBlock = 'quota'; }
      }
      if (r.task_id && ['submitting', 'queued', 'running', 'done'].indexOf(r.state) >= 0 && ts > latestOkAt) {
        latestOkAt = ts;
      }
    });
    if (latestBlock && latestBlockAt >= latestOkAt) A.store.set('key_block', latestBlock);
  }

  var renderQueued = false;
  function scheduleRender(rec) {
    if (rec) syncKeyBlockFromRec(rec);
    if (rec && (rec.state === 'done' || rec.state === 'rejected')) refreshBalanceSoon();
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderResults();
      renderTasks();
      renderKeyState();
    });
  }

  var balanceTimer = null;
  function refreshBalanceSoon() {
    if (!A.balanceEnabled()) return;
    clearTimeout(balanceTimer);
    balanceTimer = setTimeout(refreshBalance, 1500);
  }

  function boot() {
    try {
      if (!M || !A || !I) throw new Error('core modules missing');
      if (A.MOCK) show($('mock-banner'), true);
      var saved = A.store.get('lang', null);
      lang = saved && I.has(saved) ? saved : I.detectLanguage(navigator);
      document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
        b.addEventListener('click', function () { setTab(b.getAttribute('data-tab'), true); });
      });
      window.addEventListener('hashchange', function () {
        setTab((location.hash || '').replace('#', '') || 'generate', false);
      });
      bindKey();
      bindOauth();
      bindNokeyAdvanced();
      bindGen();
      bindTasks();
      enhanceAllSelects();
      document.addEventListener('click', function () { closeCSelect(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeCSelect();
      });
      setLang(lang, false);
      if (window.VSChatPilot && window.VSChatPilot.init) {
        window.VSChatPilot.init({
          t: t,
          getLang: function () { return lang; },
          getKey: function () { return A.getKey(); },
          getCredits: oauthCredits,
          fillGenerate: fillGenerateFromPlan,
          gotoGenerate: function () { setTab('generate', true); },
          gotoChat: function () { setTab('chat', true); },
          promptLogin: startOauthLogin,
          billingUrl: function () { return buildBillingOutbound(t('billing_url'), (window.VSUtm && window.VSUtm.CONTENT && window.VSUtm.CONTENT.chat_billing) || 'web.chat_billing'); },
          toast: toast,
          copyText: copyText
        });
      }
      var initialTab = (location.hash || '').replace(/^#/, '');
      if (!initialTab && rootChatPilotEnabled()) {
        try {
          var pq = (new URLSearchParams(location.search || '').get('pilot') || '').toLowerCase();
          if (pq === 'chat' || pq === '1' || pq === 'on' || pq === 'true') initialTab = 'chat';
        } catch (ePilot) { /* ignore */ }
      }
      if (!initialTab) initialTab = 'generate';
      setTab(initialTab, false);
      maybeDefaultGenPreset();
      if (!window.__vswHashBound) {
        window.__vswHashBound = true;
        window.addEventListener('hashchange', function () {
          setTab((location.hash || '').replace(/^#/, '') || 'generate', false);
        });
      }
      A.onChange(scheduleRender);
      hydrateKeyBlockFromHistory();
      A.resumeOnLoad(A.getKey());
      refreshBalance();
      renderResults();
      renderTasks();
      renderKeyState();
      renderOauthAccount();
      maybeHandleOauthQuery();
      setInterval(tick, 1000);
    } catch (err) {
      try { if (window.console && console.error) console.error('Video Studio boot failed', err); } catch (e) { /* ignore */ }
      // Keep HTML fallback strings visible; still mark ready so any CSS gated on .ready can show.
    } finally {
      document.body.classList.add('ready');
    }
  }

  if (A && A.MOCK) {
    var s = document.createElement('script');
    s.src = 'mock/mock.js?v=20261021-Seedance20';
    s.onload = boot;
    s.onerror = boot;
    document.head.appendChild(s);
  } else {
    boot();
  }
})();
