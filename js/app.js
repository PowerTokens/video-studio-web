/* PowerTokens Video Studio · Web — UI */
(function () {
  'use strict';
  var M = window.VSModels;
  var A = window.VSApi;
  var I = window.VSI18n;

  var lang = 'en';
  var MIN_CMP = 2, MAX_CMP = 3;
  var ALL_RES = ['480p', '720p', '1080p', '4k'];
  var ALL_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'];
  var EXAMPLE_IDS = ['product', 'drama', 'cafe', 'cinematic'];

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
  function applyStatic() {
    var meta = I.meta(lang) || {};
    document.documentElement.lang = meta.htmlLang || lang;
    document.title = t('page_title');
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (n) { n.placeholder = t(n.getAttribute('data-i18n-ph')); });
    document.querySelectorAll('[data-href]').forEach(function (n) { n.href = t(n.getAttribute('data-href')); });
    // Desktop-style language buttons (中文 | English); falls back to a select once there are many languages.
    var box = $('lang-switch');
    if (!box) return;
    box.innerHTML = '';
    var codes = I.languages();
    if (codes.length > 3) {
      var sel = el('select');
      sel.setAttribute('aria-label', 'Language');
      codes.forEach(function (code) {
        var o = el('option', '', I.meta(code).name);
        o.value = code; o.selected = code === lang; sel.appendChild(o);
      });
      sel.addEventListener('change', function () { setLang(sel.value, true); });
      box.appendChild(sel);
    } else {
      codes.forEach(function (code) {
        var b = el('button', code === lang ? 'active' : '', I.meta(code).name);
        b.type = 'button';
        b.setAttribute('data-lang', code);
        b.setAttribute('aria-pressed', code === lang ? 'true' : 'false');
        b.addEventListener('click', function () { setLang(code, true); });
        box.appendChild(b);
      });
    }
    renderAdvToggle();
    renderModelDetailsBtn();
  }

  function setLang(code, persist) {
    lang = I.has(code) ? code : 'en';
    if (persist) A.store.set('lang', lang);
    applyStatic();
    renderKeyState();
    renderCredits();
    renderGenModels();
    renderGenParams(false);
    renderCmpModels();
    renderCmpParams();
    renderResults();
    renderTasks();
    renderManualKinds();
    renderStatus();
    renderExamples();
  }

  // ---------------- tabs ----------------
  var TABS = ['generate', 'compare', 'batch', 'tasks', 'key'];
  function setTab(name, push) {
    if (TABS.indexOf(name) < 0) name = 'generate';
    TABS.forEach(function (n) { show($('panel-' + n), n === name); });
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (push && history.replaceState) history.replaceState(null, '', location.pathname + location.search + (name === 'generate' ? '' : '#' + name));
    window.scrollTo(0, 0);
  }

  // ---------------- key ----------------
  function renderNokeyBanner() {
    var banner = $('nokey-banner');
    if (!banner) return;
    var key = A.getKey();
    var onboarded = A.store.get('onboarded', false);
    // Show under the tabs only when there is no key and the first-run tip was dismissed,
    // so we do not stack two signup CTAs on first visit.
    show(banner, !key && onboarded);
  }

  function renderKeyState() {
    var key = A.getKey();
    $('key-chip').textContent = key ? t('key_chip_set', A.keyHint(key)) : t('key_chip_none');
    $('key-chip').classList.toggle('badge-warn', !key);
    $('key-status').textContent = key ? t('key_saved', A.keyHint(key)) : t('key_none');
    $('key-forget').disabled = !key;
    renderNokeyBanner();
    renderStatus();
  }

  // Desktop-style status line at the bottom: 就绪 · 请先在「API Key」页添加 Key / 就绪 · N 个任务进行中
  function renderStatus() {
    var bar = $('statusbar');
    if (!bar) return;
    var running = A.loadTasks().filter(function (r) { return r.state === 'submitting' || r.state === 'queued' || r.state === 'running'; }).length;
    bar.textContent = !A.getKey() ? t('status_ready') : running ? t('status_running', running) : t('status_idle');
  }

  // Header "积分 / 充值" chip. Shows a real balance only if VSApi's balance stub is enabled.
  var balance = null;
  function renderCredits() {
    var txt = typeof balance === 'number'
      ? t('credits_balance', balance.toLocaleString(I.meta(lang) ? I.meta(lang).htmlLang : undefined))
      : t('credits_btn');
    $('billing-chip-text').textContent = txt;
    $('billing-chip').title = t('credits_btn');
  }
  function refreshBalance() {
    if (!A.balanceEnabled()) return;
    var key = A.getKey();
    if (!key) { balance = null; renderCredits(); return; }
    A.fetchBalance(key).then(function (v) { balance = v; renderCredits(); });
  }

  function bindKey() {
    $('key-chip').addEventListener('click', function () { setTab('key', true); });
    $('key-show').addEventListener('change', function () {
      $('key-input').type = $('key-show').checked ? 'text' : 'password';
    });
    $('key-save').addEventListener('click', function () {
      var err = $('key-error');
      try {
        var k = A.parseKey($('key-input').value);
        A.saveKey(k);
        $('key-input').value = '';
        show(err, false);
        renderKeyState();
        toast(t('key_saved', A.keyHint(k)));
        refreshBalance();
        A.resumeOnLoad(k);
      } catch (e) {
        err.textContent = t('key_invalid_chars');
        show(err, true);
      }
    });
    $('key-forget').addEventListener('click', function () {
      A.forgetKey();
      balance = null;
      renderCredits();
      $('key-input').value = '';
      renderKeyState();
      toast(t('key_forgotten'));
    });
  }

  // ---------------- onboarding ----------------
  function bindOnboard() {
    var done = A.store.get('onboarded', false);
    function syncHowto(onboardVisible) {
      // Avoid two competing "3 steps" blocks; keep the compact howto when onboard is dismissed.
      var howto = $('gen-howto');
      if (howto) show(howto, !onboardVisible);
    }
    show($('onboard'), !done);
    syncHowto(!done);
    function dismiss() {
      A.store.set('onboarded', true);
      show($('onboard'), false);
      syncHowto(false);
      renderNokeyBanner();
    }
    $('onboard-dismiss').addEventListener('click', dismiss);
    var nokeyGoto = $('nokey-goto-keys');
    if (nokeyGoto) {
      nokeyGoto.addEventListener('click', function () { setTab('key', true); $('key-input').focus(); });
    }
    // Header "使用提示 / Tips" brings the 3-step tip back (desktop: 使用提示 button in the header).
    document.querySelectorAll('.tips-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        setTab('generate', true);
        show($('onboard'), true);
        syncHowto(true);
        // Hide the under-tabs strip while the tip card is showing.
        var banner = $('nokey-banner');
        if (banner) show(banner, false);
        $('onboard').scrollIntoView({ block: 'start' });
      });
    });
    $('onboard-goto-keys').addEventListener('click', function () { setTab('key', true); $('key-input').focus(); });
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
      o.selected = m.id === gen.model;
      sel.appendChild(o);
    });
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

  var advOpen = false;
  function renderAdvToggle() {
    var b = $('adv-toggle');
    if (!b) return;
    b.textContent = t(advOpen ? 'advanced_hide' : 'advanced_show');
    b.setAttribute('aria-expanded', advOpen ? 'true' : 'false');
    show($('adv-body'), advOpen);
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
  }

  function fillSelect(sel, values, current) {
    sel.innerHTML = '';
    values.forEach(function (v) {
      var o = el('option', '', ratioLabel(v));
      o.value = v;
      o.selected = v === current;
      sel.appendChild(o);
    });
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
    // first frame note for Wan when a local image is used
    show($('gen-ff-note'), !!genImage && m.family === 'wan');
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
    try {
      var c = M.estimateCost(gen.duration, gen.resolution, gen.model);
      $('gen-cost').textContent = t('cost_estimate', M.PRICE_CHECKED_DATE, money(c.total), money(c.perSecond));
    } catch (e) {
      $('gen-cost').textContent = t('cost_invalid');
    }
  }


  // ---------------- examples ----------------
  function renderExamples() {
    [['gen-example-chips', 'gen'], ['cmp-example-chips', 'cmp']].forEach(function (pair) {
      var box = $(pair[0]);
      if (!box) return;
      box.innerHTML = '';
      EXAMPLE_IDS.forEach(function (id) {
        var label = t('example_' + id + '_label');
        var b = el('button', 'example-chip');
        b.type = 'button';
        var parts = String(label).split(' · ');
        if (parts.length >= 2) {
          b.appendChild(el('span', 'chip-title', parts[0]));
          b.appendChild(el('span', 'chip-model', parts.slice(1).join(' · ')));
        } else {
          b.appendChild(el('span', 'chip-title', label));
        }
        b.setAttribute('data-example', id);
        b.setAttribute('data-target', pair[1]);
        b.title = t('example_' + id + '_prompt');
        b.addEventListener('click', function () { applyExample(id, pair[1], b); });
        box.appendChild(b);
      });
    });
    var drama = $('batch-sample-drama');
    var product = $('batch-sample-product');
    if (drama) drama.href = t('batch_sample_drama_url');
    if (product) product.href = t('batch_sample_product_url');
  }

  function applyExample(id, target, btn) {
    var prompt = t('example_' + id + '_prompt');
    if (target === 'cmp') {
      $('cmp-prompt').value = prompt;
      cmp.prompt = prompt;
      saveCmp();
      document.querySelectorAll('#cmp-example-chips .example-chip').forEach(function (n) {
        n.classList.toggle('active', n === btn);
      });
    } else {
      $('gen-prompt').value = prompt;
      gen.prompt = prompt;
      saveGen();
      document.querySelectorAll('#gen-example-chips .example-chip').forEach(function (n) {
        n.classList.toggle('active', n === btn);
      });
      $('gen-prompt').focus();
    }
    toast(t('examples_filled'));
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
    $('adv-toggle').addEventListener('click', function () { advOpen = !advOpen; renderAdvToggle(); });
    $('gen-stop').addEventListener('click', function () {
      var id = A.store.get('last_single', null);
      if (id && A.isPolling(id)) A.stopPolling(id);
    });

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
      duration_not_allowed: 'cost_invalid', resolution_not_allowed: 'cost_invalid', ratio_not_allowed: 'cost_invalid', duration_int: 'cost_invalid'
    };
    return t(map[code] || 'cost_invalid');
  }

  var genBusy = false;
  function submitGen() {
    if (genBusy) return;
    var errBox = $('gen-error');
    show(errBox, false);
    var key = A.getKey();
    if (!key) { errBox.textContent = t('need_key'); show(errBox, true); return; }
    var media = [];
    var ffUrl = $('gen-ff-url').value.trim();
    if (genImage) media.push({ type: 'first_frame', url: genImage.dataUrl });
    else if (ffUrl) media.push({ type: 'first_frame', url: ffUrl });
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
      btn.disabled = false;
      btn.textContent = t('generate_btn');
      btn.setAttribute('data-i18n', 'generate_btn');
    });
    // Show the "submitting" card right away.
    var pending = A.loadTasks()[0];
    if (pending) { A.store.set('last_single', pending.local_id); renderResults(); }
    var pc = $('progress-card');
    if (pc.scrollIntoView) pc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------------- compare ----------------
  var cmp = A.store.get('cmp_form', null) || {};
  cmp = {
    models: Array.isArray(cmp.models) && cmp.models.length ? cmp.models.filter(function (x) { return M.MODELS[x]; }) : ['wan3.0-video', 'dreamina-seedance-2-0-fast-260128'],
    duration: cmp.duration || 5,
    resolution: cmp.resolution || '720p',
    ratio: cmp.ratio || '16:9',
    prompt: cmp.prompt || ''
  };
  function saveCmp() { A.store.set('cmp_form', cmp); }

  function renderCmpModels() {
    var box = $('cmp-models');
    box.innerHTML = '';
    M.listModels().forEach(function (m) {
      var on = cmp.models.indexOf(m.id) >= 0;
      var item = el('label', 'check-item' + (on ? ' selected' : ''));
      var cb = el('input');
      cb.type = 'checkbox';
      cb.value = m.id;
      cb.checked = on;
      cb.disabled = !on && cmp.models.length >= MAX_CMP;
      cb.addEventListener('change', function () {
        if (cb.checked && cmp.models.indexOf(m.id) < 0) cmp.models.push(m.id);
        if (!cb.checked) cmp.models = cmp.models.filter(function (x) { return x !== m.id; });
        cmp.models = M.MODEL_ORDER.filter(function (x) { return cmp.models.indexOf(x) >= 0; });
        saveCmp();
        renderCmpModels();
        renderCmpParams();
      });
      item.appendChild(cb);
      var txt = el('span', 'check-text');
      txt.appendChild(el('span', 'model-name', M.label(m, modelLang())));
      var rt = M.rangeText(m);
      txt.appendChild(el('span', 'model-limits', t('model_limits', rt.seconds, rt.resolutions)));
      item.appendChild(txt);
      box.appendChild(item);
    });
  }

  function cmpPlan() {
    return cmp.models.map(function (id) {
      var m = M.getModel(id);
      var s = M.snapParams(m, cmp.duration, cmp.resolution, cmp.ratio);
      return {
        model: id, spec: m, duration: s.duration, resolution: s.resolution, ratio: s.ratio, changes: s.changes,
        notice: M.formatAdjustNotice(m, s.changes, modelLang()),
        cost: M.estimateCost(s.duration, s.resolution, id).total
      };
    });
  }

  function renderCmpParams() {
    $('cmp-duration').value = cmp.duration;
    fillResSelect($('cmp-res'), ALL_RES, cmp.resolution);
    fillSelect($('cmp-ratio'), ALL_RATIOS, cmp.ratio);
    var list = $('cmp-plan');
    list.innerHTML = '';
    var plan = cmpPlan();
    var total = 0;
    plan.forEach(function (p) {
      total += p.cost;
      var li = el('li', 'plan-item');
      var head = el('div', 'plan-head');
      head.appendChild(el('strong', '', M.label(p.spec, modelLang())));
      head.appendChild(el('span', 'plan-params', t('param_seconds', p.duration) + ' · ' + resLabel(p.resolution) + ' · ' + ratioLabel(p.ratio) + ' · ' + t('compare_plan_cost', money(p.cost))));
      li.appendChild(head);
      if (p.notice) li.appendChild(el('div', 'badge', p.notice));
      list.appendChild(li);
    });
    var ok = plan.length >= MIN_CMP && plan.length <= MAX_CMP;
    $('cmp-cost').textContent = ok ? t('compare_cost', money(total), plan.length) : t('compare_cost_invalid');
    $('cmp-submit').disabled = !ok || cmpBusy;
  }

  var cmpBusy = false;
  function bindCmp() {
    var prompt = $('cmp-prompt');
    prompt.value = cmp.prompt;
    prompt.addEventListener('input', function () { cmp.prompt = prompt.value; saveCmp(); });
    // Shared duration: any whole number 2–30; each model then snaps to its own limits (shown in the plan).
    $('cmp-duration').addEventListener('change', function (e) {
      var v = Math.round(parseFloat(e.target.value));
      cmp.duration = isFinite(v) ? Math.min(30, Math.max(2, v)) : cmp.duration;
      saveCmp(); renderCmpParams();
    });
    $('cmp-res').addEventListener('change', function (e) { cmp.resolution = e.target.value; saveCmp(); renderCmpParams(); });
    $('cmp-ratio').addEventListener('change', function (e) { cmp.ratio = e.target.value; saveCmp(); renderCmpParams(); });
    $('cmp-submit').addEventListener('click', submitCmp);
  }

  function submitCmp() {
    if (cmpBusy) return;
    var errBox = $('cmp-error');
    show(errBox, false);
    var key = A.getKey();
    if (!key) { errBox.textContent = t('need_key'); show(errBox, true); return; }
    if (cmp.models.length < MIN_CMP) { errBox.textContent = t('compare_need_models', MIN_CMP); show(errBox, true); return; }
    if (cmp.models.length > MAX_CMP) { errBox.textContent = t('compare_max_models', MAX_CMP); show(errBox, true); return; }
    var prompt = $('cmp-prompt').value;
    if (!prompt.trim()) { errBox.textContent = t('need_prompt'); show(errBox, true); return; }
    var plan = cmpPlan();
    var builds;
    try {
      builds = plan.map(function (p) { return M.buildRequest(p.model, prompt, p.duration, p.resolution, p.ratio, []); });
    } catch (e) { errBox.textContent = errorText(e.code); show(errBox, true); return; }
    var compareId = 'c' + Date.now().toString(36);
    A.store.set('last_compare', compareId);
    cmpBusy = true;
    $('cmp-submit').disabled = true;
    $('cmp-submit').textContent = t('generating_btn');
    // Sequential submissions, like the desktop app; each item is its own saved task.
    var chain = Promise.resolve();
    plan.forEach(function (p, i) {
      chain = chain.then(function () {
        var pr = A.submit({ model: p.model, prompt: prompt, duration: p.duration, resolution: p.resolution, ratio: p.ratio, cost: p.cost, compare_id: compareId },
          builds[i], key, function (info) { if (info.rateLimited) toast(t('rate_limited_retry', info.seconds, info.attempt, info.max)); });
        renderResults();
        return pr.then(renderResults);
      });
    });
    chain.finally(function () {
      cmpBusy = false;
      $('cmp-submit').textContent = t('compare_start');
      renderCmpParams();
    });
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
    if (rec.cost !== null && rec.cost !== undefined && rec.cost !== '') parts.push(t('compare_plan_cost', money(rec.cost)));
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
      top.href = t('billing_url');
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
        if (!key) { toast(t('need_key')); setTab('key', true); return; }
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
    syncCards(box, rec ? [rec] : [], {}, 'result_empty');
    $('gen-stop').disabled = !(rec && (rec.state === 'queued' || rec.state === 'running') && A.isPolling(rec.local_id));

    var cbox = $('cmp-results');
    var cid = A.store.get('last_compare', null);
    var recs = cid ? A.loadTasks().filter(function (r) { return r.compare_id === cid; }).reverse() : [];
    syncCards(cbox, recs, {}, 'compare_results_empty');
    cbox.classList.toggle('cols-3', recs.length >= 3);
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
        opts.push([m.id + '|kling_t2v', t('manual_kling_t2v')]);
        opts.push([m.id + '|kling_i2v', t('manual_kling_i2v')]);
      } else opts.push([m.id + '|unified', M.label(m, modelLang())]);
    });
    opts.forEach(function (o) {
      var op = el('option', '', o[1]);
      op.value = o[0];
      op.selected = o[0] === cur;
      sel.appendChild(op);
    });
  }

  function bindTasks() {
    $('spend-reset').addEventListener('click', function () { A.resetSpend(); renderTasks(); });
    // 刷新: query every unfinished task again (never resubmits).
    $('tasks-refresh').addEventListener('click', function () {
      var key = A.getKey();
      if (!key) { toast(t('need_key')); setTab('key', true); return; }
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
      if (!key) { err.textContent = t('need_key'); show(err, true); return; }
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

  var renderQueued = false;
  function scheduleRender(rec) {
    if (rec && (rec.state === 'done' || rec.state === 'rejected')) refreshBalanceSoon();
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; renderResults(); renderTasks(); });
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
      bindKey();
      bindOnboard();
      bindGen();
      bindCmp();
      bindTasks();
      setLang(lang, false);
      setTab((location.hash || '').replace('#', '') || 'generate', false);
      A.onChange(scheduleRender);
      A.resumeOnLoad(A.getKey());
      refreshBalance();
      renderResults();
      renderTasks();
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
    s.src = 'mock/mock.js?v=20261009-cta1';
    s.onload = boot;
    s.onerror = boot;
    document.head.appendChild(s);
  } else {
    boot();
  }
})();
