(function (root) {
  'use strict';
  var active = null, busy = false, dialog, timer, update = function () {};
  function notify(event, context, details) {
    try {
      var analytics = root.VSAnalytics;
      if (analytics && typeof analytics['notify_payment_' + event] === 'function') {
        var props = {package_id: context.package_id, channel: context.channel};
        if (event === 'start') props.source = 'dialog';
        Object.assign(props, details || {});
        analytics['notify_payment_' + event](props);
      }
    } catch (_) { /* Analytics must never interrupt payment. */ }
  }
  var redirectHosts = ['gateway.powerwinpay.com', 'powertokens.ai', 'www.powertokens.ai', 'www.paypal.com', 'paypal.com'];
  function validRedirect(url) {
    try { var u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && redirectHosts.includes(u.hostname); } catch (_) { return false; }
  }
  function payload(id, amount, channel) {
    var p = root.VSPaymentPackages.find(function (p) { return p.id === Number(id); });
    amount = p && p.amount_type === 1 ? p.sales_price : Number(amount);
    if (!p || !Number.isInteger(amount) || amount < 5 || amount > 2000 || !['limeng', 'paypal'].includes(channel)) throw Error('amount');
    return {amount: amount, package_id: p.id, payment_channel: channel};
  }
  // Emit shape/category information only; never pass server text or credentials to logs.
  function diagnostic(details) {
    if (root.console && root.console.info) root.console.info('[payment]', details);
  }
  function failure(details) {
    var error = Error('payment');
    details.error_code = details.fail_stage === 'transport' ? 'NETWORK' :
      details.http_status === 401 || details.http_status === 403 || details.api_status === 401 || details.api_status === 403 || details.message_category === 'authentication' ? 'AUTH' :
      details.fail_stage === 'checkout' ? 'VALIDATION' : 'UNKNOWN';
    error.paymentDiagnostics = details;
    return error;
  }
  function rawToken(token) { return typeof token === 'string' ? token.trim().replace(/^(?:Bearer\s+)+/i, '') : ''; }
  async function post(path, body, token) {
    var raw = rawToken(token), operation = path.split('/').pop();
    diagnostic({stage:'request', operation:operation,
      tokenLengthBucket: !raw ? 'empty' : raw.length < 64 ? 'short' : raw.length < 256 ? 'medium' : 'long',
      startsWithBearer: /^Bearer\s/i.test(token), headerUsesRawToken:false, headerUsesBearer:true});
    var r;
    try {
      r = await fetch('https://powertokens.ai/api' + path, {method: 'POST', credentials: 'omit', headers: {Authorization: 'Bearer ' + raw, 'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
    } catch (_) { diagnostic({stage:'transport', operation:operation, outcome:'network-cors-or-timeout'}); throw failure({fail_stage:'transport'}); }
    var details = {fail_stage:'response'};
    if (Number.isInteger(r.status) && r.status >= 100 && r.status <= 599) details.http_status = r.status;
    var data;
    try { data = await r.json(); } catch (_) { diagnostic({stage:'response', operation:operation, httpStatus:r.status, outcome:'invalid-json'}); throw failure(details); }
    if (!data || typeof data !== 'object') { diagnostic({stage:'response', operation:operation, httpStatus:r.status, outcome:'invalid-body'}); throw failure(details); }
    var msg = data.msg || data.message;
    details.message_category = typeof msg !== 'string' ? 'absent' : /token|unauthori|credential|登录|令牌/i.test(msg) ? 'authentication' : 'other-redacted';
    if (Number.isInteger(data.code) && data.code >= 0 && data.code <= 99999) details.api_status = data.code;
    diagnostic({stage:'response', operation:operation, httpStatus:r.status, code:typeof data.code === 'number' ? data.code : 'missing-or-nonnumeric',
      messageCategory: typeof msg !== 'string' ? 'absent' : /token|unauthori|credential|登录|令牌/i.test(msg) ? 'authentication' : 'other-redacted'});
    if (!r.ok || (path === '/v1/payment/create' ? data.code !== 200 : data.code !== undefined && data.code !== 200)) throw failure(details);
    return {body:data, diagnostics:details};
  }
  // Only the minimal pending reference is stored; never the raw API response or token.
  function remember() {
    try {
      if (active) sessionStorage.setItem('vs-payment', JSON.stringify({owner:active.owner, order:active.order,
        baseline:active.baseline, package_id:active.package_id, channel:active.channel, deadline:active.deadline}));
      else sessionStorage.removeItem('vs-payment');
    } catch (_) {}
  }
  function restore() {
    var O = root.VSOauth;
    if (!O || !O.isLoggedIn()) return;
    var token = O.getAccessToken(), profile = O.getProfile() || {}, owner = profile.sub || profile.email;
    if (active && active.token !== token) active = null;
    if (!active && owner) {
      try {
        var saved = JSON.parse(sessionStorage.getItem('vs-payment'));
        if (saved && saved.owner === owner && saved.order && Number.isFinite(saved.deadline) && saved.deadline > Date.now()) {
          active = Object.assign({}, saved, {token:token});
        } else if (saved) sessionStorage.removeItem('vs-payment');
      } catch (_) {}
    }
  }
  async function check() {
    restore();
    var pending = active, O = root.VSOauth;
    if (!pending || busy || !O || !O.isLoggedIn() || O.getAccessToken() !== pending.token) return;
    clearTimeout(timer);
    if (Date.now() >= pending.deadline) { active = null; remember(); update(); return; }
    busy = true;
    try {
      var status;
      try {
        var response = await post('/finance/get-order-info', {order_no:pending.order}, pending.token);
        var value = (response.body.data || response.body).status;
        if ([0, 1, 2, '0', '1', '2'].includes(value)) status = Number(value);
      } catch (_) { /* Profile fallback only when official status cannot be read. */ }
      if (active !== pending || !O.isLoggedIn() || O.getAccessToken() !== pending.token) return;
      var outcome = status === 1 ? 'success' : status === 2 ? 'cancelled' : null;
      if (!outcome && status === undefined) {
        try {
          var info = await O.refreshProfile();
          if (Number.isFinite(pending.baseline) && info && Number.isFinite(info.credits) && info.credits > pending.baseline) outcome = 'success';
        } catch (_) {}
      }
      if (active !== pending || !O.isLoggedIn() || O.getAccessToken() !== pending.token) return;
      if (outcome) {
        active = null; remember();
        notify(outcome, pending);
        if (outcome === 'success') { try { await O.refreshProfile(); } catch (_) {} }
        update(outcome);
      }
    } catch (_) { /* Network and UI failures must not stop bounded polling. */ }
    finally {
      busy = false;
      if (active === pending && Date.now() < pending.deadline) timer = setTimeout(check, 4000);
    }
  }
  function resume() { check(); }
  if (root.addEventListener) {
    root.addEventListener('pageshow', resume);
    if (root.document && root.document.addEventListener) root.document.addEventListener('visibilitychange', function () {
      if (!root.document.hidden) resume();
    });
    root.addEventListener('load', resume);
  }
  // UI keys are distinct from official package ids.
  var uiCards = [
    {key:'preset-5', packageId:35, amount:5, credits:5000, recommended:true},
    {key:'22', packageId:22},
    {key:'23', packageId:23},
    {key:'custom', packageId:33, custom:true}
  ];
  var intentKey = 'vsw.topup_intent', intentTTL = 15 * 60 * 1000;
  function clearIntent() { try { localStorage.removeItem(intentKey); } catch (_) {} }
  function readIntent() {
    try {
      var value = JSON.parse(localStorage.getItem(intentKey));
      if (!value) { clearIntent(); return null; }
      if (!Number.isFinite(value.at) || value.at > Date.now() || Date.now() - value.at > intentTTL ||
          !['limeng', 'paypal'].includes(value.channel) || !uiCards.some(function (card) { return card.key === value.selection; }) ||
          (value.selection === 'custom' && (!Number.isInteger(value.custom_amount) || value.custom_amount < 5 || value.custom_amount > 2000))) { clearIntent(); return null; }
      return {selection:value.selection, channel:value.channel, customAmount:value.custom_amount};
    } catch (_) { clearIntent(); return null; }
  }
  function resumeIntent(options) {
    var intent = readIntent();
    if (!intent || !root.VSOauth || !root.VSOauth.isLoggedIn()) return;
    clearIntent();
    show(Object.assign({}, options, {preselect:intent}));
  }
  function show(options) {
    var O = root.VSOauth;
    if (dialog && dialog.open) return;
    var token = O.getAccessToken(), c = root.VSPaymentCopy[options.lang] || root.VSPaymentCopy.en;
    restore();
    dialog = document.createElement('dialog'); dialog.className = 'payment-picker';
    function el(tag, text, parent) { var n = document.createElement(tag); if (text) n.textContent = text; (parent || dialog).appendChild(n); return n; }
    el('h2', 'Video Studio · ' + c[0]);
    var close = el('button', '×'); close.className = 'payment-close'; close.setAttribute('aria-label', c[8]); close.onclick = function () { dialog.close(); };
    var select = {value: 'preset-5'}, channel = {value: 'limeng'};
    var cards = el('div'); cards.className = 'payment-packages';
    var packageButtons = [];
    uiCards.forEach(function (card) {
      var p = root.VSPaymentPackages.find(function (p) { return p.id === card.packageId; });
      var b = el('button', '', cards); b.type = 'button'; b.className = 'payment-card'; b.setAttribute('data-package', p.id); b.setAttribute('data-selection', card.key);
      if (card.recommended) { var badge = el('span', c[1], b); badge.className = 'payment-badge'; }
      var price = el('strong', card.custom ? c[16] : '$' + (card.amount || p.sales_price), b);
      price.className = 'payment-price';
      el('span', card.custom ? c[2] : (card.credits || p.credits_amount).toLocaleString(), b).className = 'payment-credits';
      if (!card.custom) el('span', c[15], b);
      packageButtons.push({button:b, id:card.key});
      b.onclick = function () { select.value = card.key; updateSelection(); notify('package_select', {package_id:card.packageId}, {selection:({'22':'preset-20','23':'preset-50'}[card.key] || card.key)}); };
    });
    var custom = el('label'); custom.className = 'payment-custom';
    el('span', c[2], custom);
    var amount = el('input', '', custom); amount.type = 'number'; amount.min = 5; amount.max = 2000; amount.step = 1; amount.value = 5; amount.setAttribute('aria-label', c[2]);
    var estimate = el('span', '', custom);
    amount.oninput = function () { estimate.textContent = '$' + amount.value + ' · ' + (Number(amount.value) * 1000).toLocaleString() + ' ' + c[15]; }; amount.oninput();
    var methods = el('div'); methods.className = 'payment-methods';
    var methodButtons = [];
    ['limeng','paypal'].forEach(function (v, i) {
      var b = el('label', '', methods); b.className = 'payment-method';
      var radio = el('input', '', b); radio.type = 'radio'; radio.name = 'payment-channel'; radio.value = v; radio.setAttribute('data-channel', v);
      var ns = 'http://www.w3.org/2000/svg';
      var icon = document.createElementNS(ns, 'svg');
      icon.setAttribute('class', 'payment-icon');
      icon.setAttribute('viewBox', '0 0 32 24');
      icon.setAttribute('width', '32'); icon.setAttribute('height', '24');
      icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
      function shape(tag, attrs) {
        var node = document.createElementNS(ns, tag);
        Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        icon.appendChild(node);
      }
      if (i) {
        // Filled, slanted P silhouettes; the rear mark sits down and right.
        shape('path', {fill:'#009CDE', d:'M16 6H24C31 6 29 18 21 18H18L17 23H11Z'});
        shape('path', {fill:'#003087', d:'M10 1H19C29 1 27 14 18 14H14L12 21H6Z'});
      } else {
        shape('rect', {x:1, y:2, width:30, height:20, rx:3, fill:'none', stroke:'#267d70', 'stroke-width':2});
        shape('path', {d:'M2 7H30V11H2Z', fill:'#267d70'});
        shape('rect', {x:6, y:14, width:6, height:5, rx:1, fill:'#267d70'});
        shape('path', {d:'M17 18H25', stroke:'#267d70', 'stroke-width':2, 'stroke-linecap':'round'});
      }
      b.appendChild(icon);
      el('span', c[3+i], b); methodButtons.push({button:radio, id:v});
      radio.onclick = function () { channel.value = v; updateSelection(); notify('channel_select', {channel:v}); };
    });
    function updateSelection() {
      packageButtons.forEach(function (x) { x.button.setAttribute('aria-pressed', String(x.id === select.value)); });
      methodButtons.forEach(function (x) { x.button.checked = x.id === channel.value; });
      custom.hidden = select.value !== 'custom';
    }
    var preselect = options.preselect;
    if (preselect && uiCards.some(function (card) { return card.key === preselect.selection; }) &&
        ['limeng', 'paypal'].includes(preselect.channel) &&
        (preselect.selection !== 'custom' || (Number.isInteger(preselect.customAmount) && preselect.customAmount >= 5 && preselect.customAmount <= 2000))) {
      select.value = preselect.selection; channel.value = preselect.channel;
      if (select.value === 'custom') { amount.value = preselect.customAmount; amount.oninput(); }
    }
    clearIntent();
    updateSelection();
    var message = el('p', active ? c[6] : ''); message.className = 'payment-status'; message.setAttribute('role','status');
    var buy = el('button', c[5]); buy.className = 'payment-buy'; buy.hidden = false; buy.disabled = !!active;
    var notice = el('div'); notice.className = 'payment-auth-notice'; notice.hidden = true;
    notice.setAttribute('role', 'status');
    var noticeText = el('p', '', notice);
    var confirm = el('button', '', notice); confirm.type = 'button'; confirm.className = 'payment-confirm';
    function reconfirm() {
      var returning = !!O.getProfile();
      noticeText.textContent = c[returning ? 17 : 19];
      confirm.textContent = c[returning ? 18 : 20]; buy.hidden = true; notice.hidden = false;
    }
    confirm.onclick = function () {
      var intent = {selection:select.value, channel:channel.value, at:Date.now()};
      if (select.value === 'custom') {
        var value = Number(amount.value);
        if (!Number.isInteger(value) || value < 5 || value > 2000) { message.textContent = c[12]; return; }
        intent.custom_amount = value;
      }
      try { localStorage.setItem(intentKey, JSON.stringify(intent)); } catch (_) {}
      options.login();
    };
    var manual = el('button', c[7]); manual.className = 'payment-check';
    var links = el('div'); links.className = 'payment-links';
    var history = el('a', c[13], links); history.href = 'https://powertokens.ai/billing'; history.target = '_blank'; history.rel = 'noopener';
    var feedback = el('a', c[14] + ': service@powertokens.ai', links); feedback.href = 'mailto:service@powertokens.ai';
    update = function (outcome) {
      if (outcome) message.textContent = outcome === 'success' ? c[9] : c[10];
      buy.disabled = !!active;
      if (outcome === 'success') options.refresh();
    };
    manual.onclick = function () { clearTimeout(timer); check(); };
    buy.onclick = async function () {
      if (busy || active) return;
      if (!O.isLoggedIn() || !O.getAccessToken()) { reconfirm(); return; }
      token = O.getAccessToken();
      var body;
      try { var card = uiCards.find(function (card) { return card.key === select.value; }); body = payload(card.packageId, card.custom ? amount.value : card.amount, channel.value); } catch (_) { message.textContent = c[12]; return; }
      // Reserve a tab synchronously so mobile popup blockers allow checkout.
      var checkout = window.open('about:blank', '_blank'); if (checkout) checkout.opener = null;
      busy = true; buy.disabled = true;
      var funnel = {package_id: body.package_id, channel: body.payment_channel};
      notify('start', funnel);
      try {
        var response = await post('/v1/payment/create', body, token), result = response.body, data = result.data || {};
        var passed = validRedirect(data.redirectUrl), redirectShape = {stage:'redirect', protocol:'invalid', hostname:'invalid', passed:passed};
        // Only known hosts are logged: an untrusted hostname could itself contain secrets.
        try { var redirect = new URL(data.redirectUrl); redirectShape.protocol = ['https:', 'http:'].includes(redirect.protocol) ? redirect.protocol : 'other'; redirectShape.hostname = redirectHosts.includes(redirect.hostname) ? redirect.hostname : 'unlisted'; } catch (_) {}
        diagnostic(redirectShape);
        diagnostic({stage:'checkout', hasOrderNumber:!!data.orderNo, acceptedCode:result.code === 200});
        if (!data.orderNo || !passed) throw failure(Object.assign({}, response.diagnostics, {fail_stage:'checkout', has_payment_ref:!!data.orderNo, redirect_ok:passed, redirect_protocol:redirectShape.protocol.replace(':',''), redirect_host:redirectShape.hostname}));
        active = {owner:(O.getProfile() || {}).sub || (O.getProfile() || {}).email, token: token, order: data.orderNo, baseline: (O.getProfile() || {}).credits, package_id:body.package_id, channel:body.payment_channel, deadline:Date.now() + 300000};
        remember();
        message.textContent = c[6];
        var link = el('a', c[5]); link.href = data.redirectUrl; link.target = '_blank'; link.rel = 'noopener';
        if (checkout) checkout.location.replace(data.redirectUrl);
        notify('checkout_opened', funnel);
        timer = setTimeout(check, 2500);
      } catch (error) { notify('failed', funnel, error.paymentDiagnostics || {error_code:'UNKNOWN'}); if (checkout) checkout.close(); if (error.paymentDiagnostics && error.paymentDiagnostics.error_code === 'AUTH') reconfirm(); else message.textContent = c[11]; buy.disabled = false; }
      finally { busy = false; }
    };
    dialog.addEventListener('close', function () { clearIntent(); notify('dialog_closed', {}, {pending_checkout:!!active}); dialog.remove(); });
    document.body.appendChild(dialog); dialog.showModal();
    if (active) check();
  }
  root.VSPayment = {show:show, resumeIntent:resumeIntent, payload:payload, validRedirect:validRedirect};
})(globalThis);
