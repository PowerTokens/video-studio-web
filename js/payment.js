(function (root) {
  'use strict';
  var active = null, busy = false, dialog;
  function notify(event, context, errorCode) {
    try {
      var analytics = root.VSAnalytics;
      if (analytics && typeof analytics['notify_payment_' + event] === 'function') {
        var props = {package_id: context.package_id, channel: context.channel};
        if (event === 'start') props.source = 'dialog';
        if (errorCode) props.error_code = errorCode;
        analytics['notify_payment_' + event](props);
      }
    } catch (_) { /* Analytics must never interrupt payment. */ }
  }
  function validRedirect(url) {
    try { var u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['gateway.powerwinpay.com', 'powertokens.ai', 'www.powertokens.ai'].includes(u.hostname); } catch (_) { return false; }
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
  function rawToken(token) { return typeof token === 'string' ? token.trim().replace(/^(?:Bearer\s+)+/i, '') : ''; }
  async function post(path, body, token) {
    var raw = rawToken(token), operation = path.split('/').pop();
    diagnostic({stage:'request', operation:operation,
      tokenLengthBucket: !raw ? 'empty' : raw.length < 64 ? 'short' : raw.length < 256 ? 'medium' : 'long',
      startsWithBearer: /^Bearer\s/i.test(token), headerUsesRawToken:false, headerUsesBearer:true});
    var r;
    try {
      r = await fetch('https://powertokens.ai/api' + path, {method: 'POST', credentials: 'omit', headers: {Authorization: 'Bearer ' + raw, 'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
    } catch (_) { diagnostic({stage:'transport', operation:operation, outcome:'network-cors-or-timeout'}); throw Error('request'); }
    var data;
    try { data = await r.json(); } catch (_) { diagnostic({stage:'response', operation:operation, httpStatus:r.status, outcome:'invalid-json'}); throw Error('request'); }
    if (!data || typeof data !== 'object') { diagnostic({stage:'response', operation:operation, httpStatus:r.status, outcome:'invalid-body'}); throw Error('request'); }
    var msg = data.msg || data.message;
    diagnostic({stage:'response', operation:operation, httpStatus:r.status, code:typeof data.code === 'number' ? data.code : 'missing-or-nonnumeric',
      messageCategory: typeof msg !== 'string' ? 'absent' : /token|unauthori|credential|登录|令牌/i.test(msg) ? 'authentication' : 'other-redacted'});
    if (!r.ok || (data.code !== undefined && data.code !== 200)) throw Error('request');
    return data;
  }
  function show(options) {
    var O = root.VSOauth;
    if (!O.isLoggedIn()) { options.login(); return; }
    if (dialog && dialog.open) return;
    var token = O.getAccessToken(), c = root.VSPaymentCopy[options.lang] || root.VSPaymentCopy.en;
    var owner = (O.getProfile() || {}).sub || (O.getProfile() || {}).email;
    if (active && active.token !== token) active = null;
    if (!active && owner) { try { var saved = JSON.parse(sessionStorage.getItem('vs-payment')); if (saved && saved.owner === owner) active = {token:token, order:saved.order, baseline:saved.baseline, package_id:saved.package_id, channel:saved.channel}; } catch (_) {} }
    function remember() { try { if (active && owner) sessionStorage.setItem('vs-payment', JSON.stringify({owner:owner, order:active.order, baseline:active.baseline, package_id:active.package_id, channel:active.channel})); else sessionStorage.removeItem('vs-payment'); } catch (_) {} }
    dialog = document.createElement('dialog'); dialog.className = 'payment-picker';
    function el(tag, text, parent) { var n = document.createElement(tag); if (text) n.textContent = text; (parent || dialog).appendChild(n); return n; }
    el('h2', 'Video Studio · ' + c[0]);
    var close = el('button', '×'); close.className = 'payment-close'; close.setAttribute('aria-label', c[8]); close.onclick = function () { dialog.close(); };
    var select = {value: '22'}, channel = {value: 'limeng'};
    var cards = el('div'); cards.className = 'payment-packages';
    var packageButtons = [];
    root.VSPaymentPackages.forEach(function (p) {
      var b = el('button', '', cards); b.type = 'button'; b.className = 'payment-card'; b.setAttribute('data-package', p.id);
      if (p.is_recommended) { var badge = el('span', c[1], b); badge.className = 'payment-badge'; }
      var price = el('strong', p.amount_type === 2 ? c[16] : '$' + p.sales_price, b);
      price.className = 'payment-price';
      el('span', p.amount_type === 2 ? c[2] : p.credits_amount.toLocaleString(), b).className = 'payment-credits';
      if (p.amount_type !== 2) el('span', c[15], b);
      packageButtons.push({button:b, id:String(p.id)});
      b.onclick = function () { select.value = String(p.id); updateSelection(); };
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
      radio.onchange = function () { channel.value = v; updateSelection(); };
    });
    function updateSelection() {
      packageButtons.forEach(function (x) { x.button.setAttribute('aria-pressed', String(x.id === select.value)); });
      methodButtons.forEach(function (x) { x.button.checked = x.id === channel.value; });
      custom.hidden = select.value !== '33';
    }
    updateSelection();
    var message = el('p', active ? c[6] : ''); message.className = 'payment-status'; message.setAttribute('role','status');
    var buy = el('button', c[5]); buy.className = 'payment-buy'; buy.disabled = !!active;
    var manual = el('button', c[7]); manual.className = 'payment-check';
    var history = el('a', c[13]); history.href = 'https://powertokens.ai/billing'; history.target = '_blank'; history.rel = 'noopener';
    var timer, deadline = Date.now() + 300000;
    function current() { return O.isLoggedIn() && O.getAccessToken() === token; }
    async function check() {
      if (!active || busy || !current()) return;
      busy = true;
      try {
        var status;
        try { var data = await post('/finance/get-order-info', {order_no:active.order},token); status = (data.data || data).status; } catch (_) { /* userinfo fallback */ }
        if (status === 2) { active = null; remember(); message.textContent = c[10]; buy.disabled = false; return; }
        var info = await O.refreshProfile(); options.refresh();
        if (status === 1 || (typeof active.baseline === 'number' && typeof info.credits === 'number' && info.credits > active.baseline)) {
          notify('success', active);
          active = null; remember(); message.textContent = c[9]; buy.disabled = false; return;
        }
      } catch (_) { /* network blips are silent */ }
      finally { busy = false; }
      if (active && dialog.open && Date.now() < deadline) timer = setTimeout(check, 4000);
    }
    manual.onclick = function () { clearTimeout(timer); check(); };
    buy.onclick = async function () {
      if (busy || active || !current()) return;
      var body;
      try { body = payload(select.value, amount.value, channel.value); } catch (_) { message.textContent = c[12]; return; }
      // Reserve a tab synchronously so mobile popup blockers allow checkout.
      var checkout = window.open('about:blank', '_blank'); if (checkout) checkout.opener = null;
      busy = true; buy.disabled = true;
      var funnel = {package_id: body.package_id, channel: body.payment_channel};
      notify('start', funnel);
      try {
        var result = await post('/v1/payment/create', body, token), data = result.data || {};
        var passed = validRedirect(data.redirectUrl), redirectShape = {stage:'redirect', protocol:'invalid', hostname:'invalid', passed:passed};
        // Only known hosts are logged: an untrusted hostname could itself contain secrets.
        try { var redirect = new URL(data.redirectUrl); redirectShape.protocol = ['https:', 'http:'].includes(redirect.protocol) ? redirect.protocol : 'other'; redirectShape.hostname = ['gateway.powerwinpay.com','powertokens.ai','www.powertokens.ai'].includes(redirect.hostname) ? redirect.hostname : 'unlisted'; } catch (_) {}
        diagnostic(redirectShape);
        diagnostic({stage:'checkout', hasOrderNumber:!!data.orderNo, acceptedCode:result.code === 200});
        if (result.code !== 200 || !data.orderNo || !passed) throw Error('checkout');
        active = {token: token, order: data.orderNo, baseline: (O.getProfile() || {}).credits, package_id:body.package_id, channel:body.payment_channel};
        remember();
        message.textContent = c[6];
        var link = el('a', c[5]); link.href = data.redirectUrl; link.target = '_blank'; link.rel = 'noopener';
        if (checkout) checkout.location.replace(data.redirectUrl);
        notify('checkout_opened', funnel);
        timer = setTimeout(check, 2500);
      } catch (error) { notify('failed', funnel, error.message === 'checkout' ? 'VALIDATION' : 'UNKNOWN'); if (checkout) checkout.close(); message.textContent = c[11]; buy.disabled = false; }
      finally { busy = false; }
    };
    dialog.addEventListener('close', function () { clearTimeout(timer); dialog.remove(); });
    document.body.appendChild(dialog); dialog.showModal();
    if (active) check();
  }
  root.VSPayment = {show:show, payload:payload, validRedirect:validRedirect};
})(globalThis);
