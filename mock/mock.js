/*
 * Mock PowerTokens API for testing without a funded key. Loaded only with ?mock=1.
 * Intercepts fetch() to https://api.powertokens.ai and a fake video CDN; state persists in
 * localStorage so a page refresh can resume polling exactly like the real flow.
 *
 * Prompt switches:  #fail  → task fails        #429 → first 2 submits get HTTP 429
 *                   #uncertain → 502 HTML       #nourl → done without URL (served via /content)
 *                   #nocors → video host refuses CORS (download falls back to "open in new tab")
 *                   #slow → takes ~20 s
 * Key switches:     key containing "bad" → token_invalid; "quota" → HTTP 403 insufficient balance;
 *                   "nobal" → HTTP 402 with a Chinese 余额不足 message
 * URL switch:       &balance=1 enables the balance stub (header chip shows a number)
 */
(function () {
  'use strict';
  var API = 'https://api.powertokens.ai';
  var CDN = 'https://mock-cdn.invalid/';
  var SERVER_KEY = 'vsw.mock.server';
  var realFetch = window.fetch.bind(window);
  var sampleUrl = new URL('mock/sample.mp4', document.baseURI).href;
  window.VS_POLL_INTERVAL = 1000;
  window.VS_RETRY_SCALE = 0.25;

  function load() {
    try { return JSON.parse(localStorage.getItem(SERVER_KEY)) || { tasks: {}, log: [], rl: 0 }; }
    catch (e) { return { tasks: {}, log: [], rl: 0 }; }
  }
  function save(s) { localStorage.setItem(SERVER_KEY, JSON.stringify(s)); }
  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rid() { return 'mock_' + Math.random().toString(36).slice(2, 12); }

  var WAN = ['wan3.0-video', 'wan3.0-video-prime'];
  var SEEDANCE = ['dreamina-seedance-2-0-fast-260128', 'dreamina-seedance-2-5-260628'];

  function validate(path, b) {
    if (path === '/v1/videos') {
      if (WAN.indexOf(b.model) >= 0) {
        if (typeof b.prompt !== 'string' || !/^\d+$/.test(b.seconds) || !/^(480P|720P|1080P)$/.test(b.size) || !b.ratio || b.generate_audio !== true) return 'wan body shape';
        if (b.media && !b.media.every(function (m) { return m.type && /^(https?:|data:image\/)/.test(m.url); })) return 'wan media';
        return '';
      }
      if (SEEDANCE.indexOf(b.model) >= 0) {
        if (!Array.isArray(b.media) || !b.media.length || !/^\d+$/.test(b.seconds) || !/^(480p|720p|1080p)$/.test(b.size) || b.watermark !== false) return 'seedance body shape';
        if (b.prompt !== undefined) return 'seedance must not send prompt';
        return '';
      }
      return 'unknown model ' + b.model;
    }
    if (path.indexOf('/kling/v1/videos/') === 0) {
      if (b.model_name !== 'kling-v3' || !/^\d+$/.test(b.duration) || ['std', 'pro', '4k'].indexOf(b.mode) < 0 || b.sound !== 'on') return 'kling body shape';
      if (/image2video$/.test(path)) {
        if (!b.image || /^data:/.test(b.image)) return 'kling image must be raw base64 or URL';
        if (b.aspect_ratio) return 'kling i2v must not send aspect_ratio';
      } else if (!b.aspect_ratio) return 'kling t2v needs aspect_ratio';
      return '';
    }
    return 'unknown path';
  }

  function promptOf(b) {
    if (typeof b.prompt === 'string') return b.prompt;
    var t = (b.media || []).filter(function (m) { return m.type === 'text'; })[0];
    return t ? t.text : '';
  }

  function summarize(b) {
    var copy = JSON.parse(JSON.stringify(b || {}));
    (copy.media || []).forEach(function (m) { if (m.url && m.url.length > 120) m.url = m.url.slice(0, 40) + '…(' + m.url.length + ' chars)'; });
    if (copy.image && copy.image.length > 120) copy.image = copy.image.slice(0, 20) + '…(' + copy.image.length + ' chars)';
    return copy;
  }

  // ?mock=1&balance=1 turns on the (normally disabled) balance stub to test the header chip.
  if (/[?&]balance=1(?:&|$)/.test(location.search) && window.VSApi) {
    window.VSApi.BALANCE.enabled = true;
    window.VSApi.BALANCE.path = '/v1/mock-balance';
  }

  window.VSMock = {
    mapUrl: function (url) { return url && url.indexOf(CDN) === 0 ? sampleUrl : url; },
    log: function () { return load().log; },
    reset: function () { localStorage.removeItem(SERVER_KEY); }
  };

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    init = init || {};
    if (url.indexOf(CDN) === 0) {
      if (url.indexOf('nocors') >= 0) return delay(100).then(function () { throw new TypeError('Failed to fetch'); });
      return realFetch(sampleUrl);
    }
    if (url.indexOf(API) !== 0) return realFetch(input, init);

    var method = (init.method || 'GET').toUpperCase();
    var path = url.slice(API.length);
    var headers = init.headers || {};
    var auth = headers.Authorization || headers.authorization || '';
    var body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (e) { body = null; }
    var s = load();
    s.log.push({ t: Date.now(), method: method, path: path, auth: auth ? auth.slice(0, 7) + '…' + auth.slice(-4) : '', body: summarize(body) });
    save(s);

    return delay(200).then(function () {
      var s = load();
      var key = auth.replace(/^Bearer /, '');
      if (!key || key.indexOf('bad') >= 0) {
        return json(500, { error: { code: 'token_invalid', message: 'Invalid token (request id: mock)', type: 'api_error' } });
      }
      if (method === 'GET' && path === '/v1/mock-balance') return json(200, { balance: 128000 });
      if (method === 'POST') {
        if (key.indexOf('nobal') >= 0) return json(402, { error: { message: '账户余额不足，请充值后再试', type: 'insufficient_balance' } });
        if (key.indexOf('quota') >= 0) return json(403, { error: { message: 'user quota is not enough / insufficient balance', type: 'api_error' } });
        var problem = validate(path, body || {});
        if (problem) return json(400, { error: { message: 'mock validation: ' + problem } });
        var prompt = promptOf(body);
        if (prompt.indexOf('#429') >= 0 && s.rl < 2) {
          s.rl++; save(s);
          return json(429, { error: { message: 'Rate limit reached, too many requests' } });
        }
        if (prompt.indexOf('#429') >= 0) { s.rl = 0; }
        if (prompt.indexOf('#uncertain') >= 0) {
          save(s);
          return new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
        }
        var id = rid();
        var kling = path.indexOf('/kling/') === 0;
        s.tasks[id] = { created: Date.now(), kling: kling, prompt: prompt, model: body.model || body.model_name };
        save(s);
        if (kling) return json(200, { code: 0, message: 'SUCCEED', request_id: 'mock', data: { task_id: id, task_status: 'submitted' } });
        return json(200, { id: id, object: 'video', model: body.model, status: 'queued', progress: 0, created_at: Math.floor(Date.now() / 1000) });
      }
      // GET
      var content = /\/v1\/videos\/([^/]+)\/content$/.exec(path);
      var m = /\/([^/]+)$/.exec(path);
      var tid = content ? content[1] : (m ? m[1] : '');
      var task = s.tasks[tid];
      if (!task) return json(404, { error: { message: 'task not found' } });
      if (content) {
        if (task.prompt.indexOf('#nourl') < 0) return json(404, { error: { message: 'use metadata.url' } });
        return realFetch(sampleUrl);
      }
      var slow = task.prompt.indexOf('#slow') >= 0 ? 4 : 1;
      var age = (Date.now() - task.created) / 1000 / slow;
      var status, progress;
      if (age < 1.5) { status = 'queued'; progress = 0; }
      else if (age < 5) { status = 'in_progress'; progress = Math.min(95, Math.round((age - 1.5) / 3.5 * 100)); }
      else if (task.prompt.indexOf('#fail') >= 0) { status = 'failed'; progress = 100; }
      else { status = 'succeeded'; progress = 100; }
      var videoUrl = CDN + (task.prompt.indexOf('#nocors') >= 0 ? 'nocors/' : '') + tid + '.mp4?Expires=1&Signature=x';
      if (task.kling) {
        var ks = { queued: 'submitted', in_progress: 'processing', succeeded: 'succeed', failed: 'failed' }[status];
        var data = { task_id: tid, task_status: ks, task_status_msg: status === 'failed' ? 'mock: content check failed' : '' };
        if (status === 'succeeded') data.task_result = { videos: [{ id: 'v1', url: videoUrl, duration: '5' }] };
        return json(200, { code: 0, message: 'SUCCEED', data: data });
      }
      var out = { id: tid, object: 'video', model: task.model, status: status, progress: progress };
      if (status === 'failed') out.error = { code: 'mock_failed', message: 'mock: content check failed' };
      if (status === 'succeeded' && task.prompt.indexOf('#nourl') < 0) out.metadata = { url: videoUrl };
      return json(200, out);
    });
  };
})();
