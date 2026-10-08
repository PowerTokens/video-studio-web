/*
 * Storage, API calls and the task engine.
 * Rules carried over from the desktop app (wan_core.py):
 *  - The API key is only ever sent to api.powertokens.ai.
 *  - A task ID is saved before anything else, so a refresh resumes polling instead of resubmitting.
 *  - A submission is never retried automatically, except for an explicit 429 rate limit (no task was created).
 */
(function (root) {
  'use strict';
  var M = root.VSModels;
  var API_BASE = M.API_BASE;
  var MOCK = /[?&]mock=1(?:&|$)/.test(root.location ? root.location.search : '');
  var PREFIX = MOCK ? 'vsw.mock.' : 'vsw.';

  // ---------- storage ----------
  var memory = {};
  var store = {
    get: function (k, dflt) {
      try {
        var v = root.localStorage.getItem(PREFIX + k);
        return v === null ? dflt : JSON.parse(v);
      } catch (e) {
        return memory.hasOwnProperty(k) ? memory[k] : dflt;
      }
    },
    set: function (k, v) {
      try { root.localStorage.setItem(PREFIX + k, JSON.stringify(v)); return true; }
      catch (e) { memory[k] = v; return false; }
    },
    remove: function (k) {
      try { root.localStorage.removeItem(PREFIX + k); } catch (e) { /* ignore */ }
      delete memory[k];
    }
  };

  // ---------- API key ----------
  /** Same cleanup as the desktop parse_keys(), single key. Throws Error('key_invalid_chars'). */
  function parseKey(text) {
    text = String(text || '').replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '');
    text = text.replace(/(?:authorization\s*:\s*)?\bbearer\s+/gim, '');
    text = text.replace(/(?:api[_ -]?key|powertokens_api_key)\s*[:=]\s*/gim, '');
    var tokens = text.trim().split(/[\s,;，；]+/).map(function (t) {
      return t.replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, '');
    }).filter(Boolean);
    if (tokens.length !== 1 || !/^[A-Za-z0-9._~+/=-]+$/.test(tokens[0])) throw new Error('key_invalid_chars');
    return tokens[0];
  }
  function getKey() { return store.get('key', '') || ''; }
  function saveKey(k) { store.set('key', k); }
  function forgetKey() { store.remove('key'); }
  function keyHint(k) { return k ? k.slice(-4) : ''; }

  // ---------- HTTP ----------
  function apiUrl(path) {
    var url = API_BASE + path;
    // The key may only travel to the PowerTokens API origin.
    if (url.indexOf(API_BASE + '/') !== 0) throw new Error('bad api url');
    return url;
  }

  /** Returns {code, body, networkError, text}. Never throws for HTTP/network errors. */
  function api(method, path, key, payload, timeoutMs) {
    var url = apiUrl(path);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 30000) : null;
    var init = {
      method: method,
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer'
    };
    if (payload !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }
    if (ctrl) init.signal = ctrl.signal;
    return root.fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var body = {};
        try { var parsed = JSON.parse(text); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed; }
        catch (e) { body = {}; }
        return { code: res.status, body: body, text: text.slice(0, 500), networkError: false };
      });
    }, function (err) {
      return { code: null, body: {}, text: '', networkError: true, error: String(err && err.message || err) };
    }).then(function (r) { if (timer) clearTimeout(timer); return r; });
  }

  function serverMessage(body) {
    if (!body || typeof body !== 'object') return '';
    var e = body.error;
    var msg = (e && typeof e === 'object') ? (e.message || e.code || '') : (e || body.message || body.msg || '');
    return String(msg || '').replace(/\s*\(request id:[^)]*\)\s*/i, '').slice(0, 300);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------- task records ----------
  var ACTIVE = ['queued', 'running'];
  var listeners = [];
  var pollers = {}; // local_id -> {stop: bool}
  var inflight = {}; // local_id -> true while a POST is in progress in this page

  function loadTasks() { var t = store.get('tasks', []); return Array.isArray(t) ? t : []; }
  function saveTasks(list) { store.set('tasks', list.slice(0, 200)); }
  function getTask(localId) {
    var list = loadTasks();
    for (var i = 0; i < list.length; i++) if (list[i].local_id === localId) return list[i];
    return null;
  }
  function putTask(rec) {
    var list = loadTasks();
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].local_id === rec.local_id) { list[i] = rec; found = true; break; }
    }
    if (!found) list.unshift(rec);
    saveTasks(list);
    listeners.forEach(function (fn) { try { fn(rec); } catch (e) { console.error(e); } });
    return rec;
  }
  function update(localId, changes) {
    var rec = getTask(localId);
    if (!rec) return null;
    for (var k in changes) rec[k] = changes[k];
    rec.updated = Date.now();
    return putTask(rec);
  }
  function removeTask(localId) {
    stopPolling(localId, true);
    saveTasks(loadTasks().filter(function (r) { return r.local_id !== localId; }));
    listeners.forEach(function (fn) { fn({ local_id: localId, removed: true }); });
  }
  function onChange(fn) { listeners.push(fn); }

  function uid() {
    var a = new Uint8Array(8);
    (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /**
   * Create a record from a built request. plan = {model, prompt, duration, resolution, ratio, cost, compare_id, has_image}
   */
  function newRecord(plan, built) {
    var m = M.getModel(plan.model);
    return {
      local_id: uid(),
      task_id: '',
      model: m.id,
      family: m.family,
      poll_kind: built.pollKind,
      submit_path: built.submitPath,
      prompt: String(plan.prompt || '').slice(0, 2000),
      duration: plan.duration,
      resolution: plan.resolution,
      ratio: plan.ratio,
      cost: plan.cost,
      has_image: !!plan.has_image,
      compare_id: plan.compare_id || '',
      created: Date.now(),
      updated: Date.now(),
      state: 'submitting',
      status_raw: '',
      progress: null,
      video_url: '',
      error: '',
      error_detail: '',
      key_hint: ''
    };
  }

  var RATE_LIMIT_MAX_RETRIES = 4;

  /** Submit once (429 retries only). Resolves with the final record. */
  function submit(plan, built, key, onStatus) {
    var rec = newRecord(plan, built);
    rec.key_hint = keyHint(key);
    // Persist BEFORE the request: if the page dies mid-request we know a submission may exist.
    putTask(rec);
    inflight[rec.local_id] = true;
    var tries = 0;
    function attempt() {
      return api('POST', built.submitPath, key, built.body, 120000).then(function (r) {
        var taskId = M.extractTaskId(r.body, rec.family);
        if (taskId && /^[A-Za-z0-9_-]{1,200}$/.test(taskId)) {
          var saved = update(rec.local_id, { task_id: taskId, state: 'queued', error: '', error_detail: '' });
          ledgerAdd(saved);
          startPolling(saved.local_id, key);
          return saved;
        }
        if (r.networkError) {
          return update(rec.local_id, { state: 'uncertain', error: 'uncertain', error_detail: r.error || '' });
        }
        var kind = M.category(r.code || 400, r.body);
        if (kind === 'RATE_LIMIT') {
          tries++;
          if (tries <= RATE_LIMIT_MAX_RETRIES) {
            var delay = Math.min(20, Math.pow(2, tries)) * 1000 * (root.VS_RETRY_SCALE || 1);
            if (onStatus) onStatus({ rateLimited: true, seconds: Math.round(delay / 1000), attempt: tries, max: RATE_LIMIT_MAX_RETRIES });
            return sleep(delay).then(attempt);
          }
          return update(rec.local_id, { state: 'rejected', error: 'RATE_LIMIT', error_detail: serverMessage(r.body), http: r.code });
        }
        if (kind === 'AUTH' || kind === 'QUOTA' || kind === 'NOT_ALLOWED') {
          return update(rec.local_id, { state: 'rejected', error: kind, error_detail: serverMessage(r.body), http: r.code });
        }
        // A 400/422 with an error body is a validation refusal: no task was created.
        if ((r.code === 400 || r.code === 422) && serverMessage(r.body)) {
          return update(rec.local_id, { state: 'rejected', error: 'PARAM', error_detail: serverMessage(r.body), http: r.code });
        }
        return update(rec.local_id, {
          state: 'uncertain', error: 'uncertain', http: r.code,
          error_detail: serverMessage(r.body) || r.text.replace(/<[^>]*>/g, ' ').trim().slice(0, 200)
        });
      });
    }
    return attempt().then(function (r) { delete inflight[rec.local_id]; return r; },
      function (e) { delete inflight[rec.local_id]; throw e; });
  }

  // ---------- polling ----------
  function stopPolling(localId, silent) {
    var p = pollers[localId];
    if (p) p.stop = true;
    delete pollers[localId];
    if (!silent) {
      var rec = getTask(localId);
      if (rec && ACTIVE.indexOf(rec.state) >= 0) update(localId, { state: 'stopped' });
    }
  }

  function isPolling(localId) { return !!pollers[localId]; }

  function startPolling(localId, key) {
    if (pollers[localId]) return;
    var rec = getTask(localId);
    if (!rec || !rec.task_id) return;
    var path;
    try { path = M.pollPath(rec.task_id, rec.poll_kind); } catch (e) { return; }
    var ctl = { stop: false };
    pollers[localId] = ctl;
    var interval = root.VS_POLL_INTERVAL || 10000;
    var deadline = Date.now() + 3600 * 1000;
    var errors = 0;
    var readyNoUrl = 0;
    if (ACTIVE.indexOf(rec.state) < 0) update(localId, { state: 'queued', error: '', error_detail: '' });

    function finish(changes) {
      delete pollers[localId];
      return update(localId, changes);
    }

    function loop() {
      if (ctl.stop) return;
      api('GET', path, key, undefined, 30000).then(function (r) {
        if (ctl.stop) return;
        var family = rec.family;
        var ns = M.normalizeStatus(r.body, family);
        var klingErr = family === 'kling' && typeof r.body.code === 'number' && r.body.code !== 0 && !ns.status;
        var failed = r.networkError || r.code !== 200 || !ns.status || klingErr;
        var delay = interval;
        if (failed) {
          errors++;
          var kind = r.networkError ? 'NETWORK' : M.category(r.code, r.body);
          if (kind === 'AUTH' || kind === 'NOT_ALLOWED') {
            return finish({ state: 'query_down', error: 'query_auth', error_detail: serverMessage(r.body), http: r.code });
          }
          if (errors >= 6) {
            return finish({ state: 'query_down', error: 'query_down', error_count: errors, http: r.code === null ? 'network' : r.code });
          }
          delay = Math.min(60000, interval * Math.pow(2, Math.min(errors - 1, 3)));
        } else {
          errors = 0;
          var st = ns.status;
          var ready = st === 'succeeded' || st === 'completed' || st === 'success';
          var terminal = st === 'failed' || st === 'cancelled' || st === 'canceled';
          if (ready && ns.url) {
            return finish({ state: 'done', status_raw: st, progress: 100, video_url: ns.url, error: '', finished: Date.now() });
          }
          if (ready) {
            readyNoUrl++;
            if (family !== 'kling') {
              return fetchContent(localId, key).then(function (ok) {
                if (ok || ctl.stop) return;
                if (readyNoUrl >= 3) return finish({ state: 'ready_no_url', status_raw: st, error: 'ready_no_url' });
                setTimeout(loop, interval);
              });
            }
            if (readyNoUrl >= 3) return finish({ state: 'ready_no_url', status_raw: st, error: 'ready_no_url' });
          } else if (terminal) {
            ledgerMarkFailed(localId);
            return finish({ state: 'failed', status_raw: st, error: 'server_failed', error_detail: ns.message.slice(0, 300) });
          } else {
            var running = st === 'in_progress' || st === 'processing' || st === 'running' || (ns.progress !== null && ns.progress > 0);
            update(localId, { state: running ? 'running' : 'queued', status_raw: st, progress: ns.progress });
          }
        }
        if (Date.now() >= deadline) return finish({ state: 'timeout', error: 'timeout' });
        setTimeout(loop, delay);
      });
    }
    loop();
  }

  // Blob URLs from the /content fallback live only for this page session.
  var blobUrls = {};
  /** Fallback when the status has no URL: GET /v1/videos/{id}/content with the key. */
  function fetchContent(localId, key) {
    var rec = getTask(localId);
    if (!rec || rec.family === 'kling') return Promise.resolve(false);
    var url = apiUrl('/v1/videos/' + rec.task_id + '/content');
    return root.fetch(url, { headers: { Authorization: 'Bearer ' + key }, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (res) {
        var type = (res.headers.get('Content-Type') || '').toLowerCase();
        if (!res.ok || type.indexOf('json') >= 0 || type.indexOf('html') >= 0) return false;
        return res.blob().then(function (blob) {
          if (!blob.size) return false;
          blobUrls[localId] = URL.createObjectURL(blob);
          delete pollers[localId];
          update(localId, { state: 'done', progress: 100, video_url: '', content_fallback: true, error: '', finished: Date.now() });
          return true;
        });
      }).catch(function () { return false; });
  }

  function blobUrl(localId) { return blobUrls[localId] || ''; }

  /** On page load: never resubmit; mark interrupted submissions, resume active polls. */
  function resumeOnLoad(key) {
    loadTasks().forEach(function (rec) {
      if (inflight[rec.local_id]) return;
      if (rec.state === 'submitting' && !rec.task_id) {
        update(rec.local_id, { state: 'uncertain', error: 'uncertain_reload' });
      } else if (rec.task_id && ACTIVE.indexOf(rec.state) >= 0 && key) {
        startPolling(rec.local_id, key);
      }
    });
  }

  /** Manual: check an existing task ID (no submission). */
  function attach(modelId, pollKind, taskId, key) {
    var m = M.getModel(modelId);
    M.pollPath(taskId, pollKind); // validates format, throws task_id_invalid
    var rec = newRecord({ model: m.id, prompt: '', duration: '', resolution: '', ratio: '', cost: null },
      { pollKind: pollKind, submitPath: '' });
    rec.task_id = taskId;
    rec.state = 'queued';
    rec.key_hint = keyHint(key);
    rec.attached = true;
    putTask(rec);
    startPolling(rec.local_id, key);
    return rec;
  }

  // ---------- spend estimate (this device only) ----------
  // Kept separately from the task list so removing a task from the list doesn't change the total.
  // Counts tasks that got a task ID; tasks the server reported as failed are left out (usually not billed).
  function ledger() {
    var l = store.get('spend', null);
    return l && typeof l === 'object' && l.items ? l : { since: Date.now(), items: {} };
  }
  function ledgerAdd(rec) {
    if (!rec || !rec.task_id || typeof rec.cost !== 'number') return;
    var l = ledger();
    l.items[rec.local_id] = { cost: rec.cost, failed: false };
    store.set('spend', l);
  }
  function ledgerMarkFailed(localId) {
    var l = ledger();
    if (l.items[localId]) { l.items[localId].failed = true; store.set('spend', l); }
  }
  function spendSummary() {
    var l = ledger();
    var total = 0, count = 0;
    Object.keys(l.items).forEach(function (k) {
      var it = l.items[k];
      if (it.failed) return;
      total += it.cost; count++;
    });
    return { total: Math.round(total * 1000) / 1000, count: count, since: l.since };
  }
  function resetSpend() { store.remove('spend'); }

  // ---------- credit balance (stub, OFF by default) ----------
  /*
   * PowerTokens has no public balance endpoint reachable with an API key yet
   * (probed /v1/dashboard/billing/*, /v1/credits, /api/user/self: all 404).
   * When one exists: set enabled = true, the path, and parse() to return a number (credits).
   * The header chip then shows "积分 12,345 · 充值". The request goes through api(), so the key
   * still only ever reaches api.powertokens.ai.
   */
  var BALANCE = {
    enabled: false,
    path: '/v1/credits',            // placeholder: replace with the real endpoint
    parse: function (body) {        // return a finite number or null
      var v = body && (body.balance !== undefined ? body.balance : body.credits);
      return typeof v === 'number' && isFinite(v) ? v : null;
    }
  };
  function balanceEnabled() { return !!BALANCE.enabled; }
  /** Resolves to a number, or null when disabled / unavailable. Never throws. */
  function fetchBalance(key) {
    if (!BALANCE.enabled || !key) return Promise.resolve(null);
    return api('GET', BALANCE.path, key, undefined, 15000).then(function (r) {
      if (r.networkError || r.code !== 200) return null;
      try { return BALANCE.parse(r.body); } catch (e) { return null; }
    });
  }

  // ---------- download ----------
  /**
   * Try to save the video as a file (needs CORS on the video host); otherwise report 'blocked'
   * so the UI can offer "open in new tab". Never sends the API key to a non-API host.
   */
  function download(url, filename) {
    var init = { credentials: 'omit', referrerPolicy: 'no-referrer' };
    return root.fetch(url, init).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.blob();
    }).then(function (blob) {
      var href = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 60000);
      return 'saved';
    }).catch(function () { return 'blocked'; });
  }

  root.VSApi = {
    MOCK: MOCK,
    store: store,
    parseKey: parseKey,
    getKey: getKey,
    saveKey: saveKey,
    forgetKey: forgetKey,
    keyHint: keyHint,
    api: api,
    loadTasks: loadTasks,
    getTask: getTask,
    update: update,
    removeTask: removeTask,
    onChange: onChange,
    submit: submit,
    startPolling: startPolling,
    stopPolling: stopPolling,
    isPolling: isPolling,
    resumeOnLoad: resumeOnLoad,
    fetchContent: fetchContent,
    blobUrl: blobUrl,
    attach: attach,
    download: download,
    spendSummary: spendSummary,
    resetSpend: resetSpend,
    fetchBalance: fetchBalance,
    balanceEnabled: balanceEnabled,
    BALANCE: BALANCE,
    ACTIVE: ACTIVE
  };
})(window);
