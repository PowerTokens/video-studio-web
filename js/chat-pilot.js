/**
 * Chat-to-video pilot (MVP): glm-4.7-flash plans a clip, then fills classic Generate.
 * Toggle with ?pilot=chat (persist) or ?pilot=off. Keep classic Generate available.
 */
(function (root) {
  'use strict';

  var FLASH_MODEL = 'glm-4.7-flash';
  var STORE_FLAG = 'vsw.pilot.chat';
  var EXAMPLE_IDS = ['shopping', 'canyon', 'seal', 'locker'];
  var CHEAP_DEFAULT = {
    model: 'wan3.0-video',
    duration: 5,
    resolution: '720p',
    ratio: '9:16'
  };

  var deps = null;
  var messages = []; // OpenAI-style {role, content} for the Flash call (no system)
  var lastPlan = null;
  var busy = false;
  var sessionStarted = false;

  function store() {
    return (root.VSApi && root.VSApi.store) || {
      get: function (_, d) { return d; },
      set: function () {},
      remove: function () {}
    };
  }

  function syncFlagFromQuery() {
    var q;
    try { q = new URLSearchParams(location.search || ''); }
    catch (e) { return; }
    var p = (q.get('pilot') || '').toLowerCase();
    if (p === 'chat' || p === '1' || p === 'on' || p === 'true') store().set(STORE_FLAG, '1');
    if (p === 'off' || p === '0' || p === 'classic' || p === 'false') store().set(STORE_FLAG, '0');
  }

  function isEnabled() {
    syncFlagFromQuery();
    if (store().get(STORE_FLAG, null) === '1') return true;
    try {
      var p = (new URLSearchParams(location.search || '').get('pilot') || '').toLowerCase();
      return p === 'chat' || p === '1' || p === 'on' || p === 'true';
    } catch (e) { return false; }
  }

  function setEnabled(on) {
    store().set(STORE_FLAG, on ? '1' : '0');
  }

  function t() {
    if (!deps || !deps.t) return arguments[0];
    return deps.t.apply(null, arguments);
  }

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /** Analytics stubs — never include prompt text or API keys. */
  function track(eventName, props) {
    var payload = {};
    var src = props || {};
    var k;
    for (k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      if (k === 'prompt' || k === 'key' || k === 'api_key' || k === 'messages') continue;
      payload[k] = src[k];
    }
    payload.source = payload.source || 'chat_pilot';
    payload.pilot_variant = payload.pilot_variant || 'mvp';
    try {
      if (typeof root.gtag === 'function') root.gtag('event', eventName, payload);
    } catch (e1) { /* ignore */ }
    try {
      if (root.console && console.info) console.info('[vs-analytics]', eventName, payload);
    } catch (e2) { /* ignore */ }
  }

  function modelCatalogHint() {
    var M = root.VSModels;
    if (!M || !M.MODELS) return 'wan3.0-video';
    return Object.keys(M.MODELS).join(', ');
  }

  function systemPrompt() {
    var lang = (deps && deps.getLang && deps.getLang()) || 'zh';
    var cheap = CHEAP_DEFAULT;
    var catalog = modelCatalogHint();
    if (lang === 'zh') {
      return [
        '你是 PowerTokens Video Studio 的出片助手。用简洁中文和用户多轮确认想拍的内容。',
        '底层视频模型目录（只能从中选 model）：' + catalog + '。',
        '默认便宜档：model=' + cheap.model + '，duration=' + cheap.duration + '，resolution=' + cheap.resolution + '，ratio=' + cheap.ratio + '。',
        '严禁默认 16 秒或 1080p/4k；除非用户明确要求更长/更高清，否则保持 5 秒、720p 或更低。',
        '每轮只回复一个 JSON 对象（不要 markdown 围栏外的闲聊），字段：',
        '{"assistant_message":"给用户看的白话","ready":false,"plan":null}',
        '当信息足够出片时设 ready=true，并填 plan：',
        '{"title":"短标题","prompt":"完整视频提示词","model":"模型id","duration":5,"resolution":"720p","ratio":"9:16","summary":"一句话方案摘要"}',
        'prompt 要具体（主体、动作、场景、镜头、光影、声音），适合图生/文生视频。',
        '若还缺关键信息，ready=false，plan=null，用 assistant_message 继续提问。'
      ].join('\n');
    }
    return [
      'You are the PowerTokens Video Studio chat planner. Confirm what to shoot in short turns.',
      'Video model catalog (pick model only from this list): ' + catalog + '.',
      'Default cheap tier: model=' + cheap.model + ', duration=' + cheap.duration + ', resolution=' + cheap.resolution + ', ratio=' + cheap.ratio + '.',
      'Never default to 16s or 1080p/4k; keep 5s and 720p or lower unless the user explicitly asks for longer/higher.',
      'Reply with ONE JSON object only each turn (no prose outside JSON):',
      '{"assistant_message":"user-facing text","ready":false,"plan":null}',
      'When ready to shoot, set ready=true and fill plan:',
      '{"title":"short title","prompt":"full video prompt","model":"model id","duration":5,"resolution":"720p","ratio":"9:16","summary":"one-line summary"}',
      'If info is missing, ready=false, plan=null, and ask in assistant_message.'
    ].join('\n');
  }

  function extractJsonObject(text) {
    if (!text) return null;
    var s = String(text).trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); }
    catch (e) { return null; }
  }

  function clampPlan(raw) {
    var M = root.VSModels;
    var plan = {
      title: String((raw && raw.title) || t('chat_plan_title_fallback')).slice(0, 80),
      prompt: String((raw && raw.prompt) || '').trim(),
      model: CHEAP_DEFAULT.model,
      duration: CHEAP_DEFAULT.duration,
      resolution: CHEAP_DEFAULT.resolution,
      ratio: CHEAP_DEFAULT.ratio,
      summary: String((raw && (raw.summary || raw.title)) || '').slice(0, 160)
    };
    if (!plan.prompt) return null;
    if (raw && raw.model && M && M.MODELS && M.MODELS[raw.model]) plan.model = raw.model;
    else if (raw && raw.model && M && M.getModel) {
      try {
        var mTry = M.getModel(raw.model);
        if (mTry && mTry.id) plan.model = mTry.id;
      } catch (e0) { /* keep cheap */ }
    }
    var duration = parseInt(raw && raw.duration, 10);
    if (isFinite(duration)) plan.duration = duration;
    if (raw && raw.resolution) plan.resolution = String(raw.resolution);
    if (raw && raw.ratio) plan.ratio = String(raw.ratio);

    // Pilot guard: never keep 16s / 1080p+ as the planned default.
    var res = String(plan.resolution || '').toLowerCase();
    if (res === '1080' || res === '1080p' || res === '2k' || res === '4k') plan.resolution = '720p';
    if (plan.duration >= 16) plan.duration = CHEAP_DEFAULT.duration;

    if (M && M.getModel && M.snapParams) {
      var m = M.getModel(plan.model);
      var snapped = M.snapParams(m, plan.duration, plan.resolution, plan.ratio);
      plan.duration = snapped.duration;
      plan.resolution = snapped.resolution;
      plan.ratio = snapped.ratio;
    }
    return plan;
  }

  function estimateCredits(plan) {
    var M = root.VSModels;
    if (!M || !plan) return null;
    try {
      var c = M.estimateCost(plan.duration, plan.resolution, plan.model);
      return M.estimateCreditsFromUsd(c.total);
    } catch (e) { return null; }
  }

  function parseAssistantPayload(content) {
    var obj = extractJsonObject(content);
    if (!obj || typeof obj !== 'object') {
      return {
        assistant_message: String(content || '').trim() || t('chat_flash_bad_json'),
        ready: false,
        plan: null,
        parse_ok: false
      };
    }
    var msg = String(obj.assistant_message || obj.message || obj.reply || '').trim();
    var ready = !!obj.ready;
    var plan = null;
    if (ready && obj.plan) plan = clampPlan(obj.plan);
    if (ready && !plan) ready = false;
    if (!msg) msg = ready ? t('chat_plan_ready_fallback') : t('chat_need_more');
    return { assistant_message: msg, ready: ready, plan: plan, parse_ok: true };
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function errorDetail(body) {
    if (!body || typeof body !== 'object') return { message: '', code: '' };
    var err = body.error;
    var message = '';
    var code = '';
    if (err && typeof err === 'object') {
      message = String(err.message || '');
      code = String(err.code || '');
      if (!code && err.metadata && err.metadata.error && err.metadata.error.code) {
        code = String(err.metadata.error.code);
      }
    } else if (typeof err === 'string') {
      message = err;
    }
    if (!message) message = String(body.message || body.msg || '');
    return { message: message, code: code };
  }

  function formatHttpDetail(http, body) {
    var info = errorDetail(body);
    var parts = [];
    if (http != null) parts.push('HTTP ' + http);
    if (info.code) parts.push(info.code);
    var head = parts.join(' · ');
    var msg = info.message || t('chat_flash_unknown');
    return String(head ? (head + ': ' + msg) : msg).slice(0, 360);
  }

  function isRetryableFlash(res) {
    if (!res || res.ok) return false;
    if (res.kind === 'NETWORK' || res.kind === 'EMPTY') return true;
    var http = res.http;
    if (http === 429 || http === 502 || http === 503 || http === 504) return true;
    var detail = String(res.detail || '').toLowerCase();
    return detail.indexOf('overloaded') >= 0 || detail.indexOf('1305') >= 0 ||
      detail.indexOf('retry later') >= 0 || detail.indexOf('temporarily') >= 0;
  }

  function extractChoiceContent(choice) {
    if (!choice) return '';
    var msg = choice.message || {};
    var content = msg.content;
    if (!content && choice.delta) content = choice.delta.content;
    // Default thinking mode can leave content empty while putting text in reasoning_content.
    if (!content && msg.reasoning_content) content = msg.reasoning_content;
    return content ? String(content) : '';
  }

  function chatCompletionsOnce(apiMessages) {
    var A = root.VSApi;
    var key = deps.getKey && deps.getKey();
    if (!A || !key) {
      return Promise.resolve({ ok: false, kind: 'NO_KEY', detail: t('chat_need_login') });
    }
    var body = {
      model: FLASH_MODEL,
      temperature: 0.4,
      max_tokens: 2048,
      // glm-4.7-flash defaults thinking=on upstream; that often returns empty content
      // or 429/1305 under load. Pilot only needs plain JSON text.
      thinking: { type: 'disabled' },
      messages: [{ role: 'system', content: systemPrompt() }].concat(apiMessages)
    };
    return A.api('POST', '/v1/chat/completions', key, body, 60000).then(function (r) {
      if (r.networkError) return { ok: false, kind: 'NETWORK', detail: r.error || t('chat_flash_network') };
      if (r.code === 401 || r.code === 403) {
        return {
          ok: false,
          kind: 'AUTH',
          detail: formatHttpDetail(r.code, r.body) || (A.serverMessage ? A.serverMessage(r.body) : t('chat_flash_auth')),
          http: r.code
        };
      }
      if (r.code !== 200) {
        return { ok: false, kind: 'HTTP', detail: formatHttpDetail(r.code, r.body), http: r.code };
      }
      var choice = r.body && r.body.choices && r.body.choices[0];
      var content = extractChoiceContent(choice);
      if (!content) return { ok: false, kind: 'EMPTY', detail: t('chat_flash_empty'), http: 200 };
      return { ok: true, content: content };
    });
  }

  /** Retry transient upstream 429/1305 / empty / network a few times. */
  function chatCompletions(apiMessages) {
    var attempts = 0;
    var maxAttempts = 3;
    var delays = [0, 1200, 2800];

    function next() {
      var wait = delays[attempts] || 0;
      attempts += 1;
      var run = wait ? sleep(wait).then(function () { return chatCompletionsOnce(apiMessages); })
        : chatCompletionsOnce(apiMessages);
      return run.then(function (res) {
        if (res.ok) return res;
        if (attempts < maxAttempts && isRetryableFlash(res)) {
          track('chat_flash_retry', { attempt: attempts, kind: res.kind || 'unknown', http: res.http || 0 });
          return next();
        }
        return res;
      });
    }
    return next();
  }

  function scrollThread() {
    var thread = $('chat-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function appendBubble(role, text) {
    var thread = $('chat-thread');
    if (!thread || !text) return;
    var row = el('div', 'chat-row chat-row--' + role);
    if (role === 'assistant') {
      var av = el('div', 'chat-avatar', 'P');
      av.setAttribute('aria-hidden', 'true');
      row.appendChild(av);
    }
    var bubble = el('div', 'chat-bubble chat-bubble--' + role, text);
    row.appendChild(bubble);
    thread.appendChild(row);
    scrollThread();
  }

  function clearPlanMount() {
    var mount = $('chat-plan-mount');
    if (mount) mount.innerHTML = '';
    lastPlan = null;
  }

  function renderPlanCard(plan) {
    var mount = $('chat-plan-mount');
    if (!mount || !plan) return;
    mount.innerHTML = '';
    lastPlan = plan;
    var credits = estimateCredits(plan);
    var have = deps.getCredits ? deps.getCredits() : null;
    var insuff = typeof credits === 'number' && typeof have === 'number' && credits > have;

    var card = el('div', 'chat-plan-card');
    card.appendChild(el('p', 'chat-plan-kicker', t('chat_plan_kicker')));
    card.appendChild(el('h3', 'chat-plan-title', plan.title || plan.summary || t('chat_plan_title_fallback')));
    if (plan.summary) card.appendChild(el('p', 'chat-plan-summary', plan.summary));

    var meta = el('p', 'chat-plan-meta muted small');
    var M = root.VSModels;
    var modelLabel = plan.model;
    try { if (M && M.getModel) modelLabel = M.label(M.getModel(plan.model), (deps.getLang && deps.getLang()) || 'zh') + ' (' + plan.model + ')'; } catch (e) {}
    meta.textContent = [
      modelLabel,
      plan.duration + 's',
      plan.resolution,
      plan.ratio,
      typeof credits === 'number' ? t('chat_plan_credits', String(credits)) : ''
    ].filter(Boolean).join(' · ');
    card.appendChild(meta);

    var details = el('details', 'chat-plan-prompt');
    var sum = el('summary', '', t('chat_plan_prompt_toggle'));
    details.appendChild(sum);
    var pre = el('pre', 'chat-plan-prompt-body', plan.prompt);
    details.appendChild(pre);
    card.appendChild(details);

    var actions = el('div', 'chat-plan-actions');
    if (insuff) {
      track('credits_insufficient_show', {
        need: credits,
        have: have,
        model: plan.model,
        duration: plan.duration,
        resolution: plan.resolution
      });
      var warn = el('p', 'chat-plan-warn', t('chat_credits_insufficient', String(credits), String(have)));
      card.appendChild(warn);
      var topup = el('a', 'btn btn-accent', t('chat_topup'));
      topup.href = (deps.billingUrl && deps.billingUrl()) || t('billing_url');
      topup.target = '_blank';
      topup.rel = 'noopener';
      topup.addEventListener('click', function () {
        track('credits_topup_click', { need: credits, have: have });
      });
      actions.appendChild(topup);
      var fallback = el('button', 'btn', t('chat_goto_classic'));
      fallback.type = 'button';
      fallback.addEventListener('click', function () {
        track('chat_fallback_classic', { reason: 'credits_insufficient' });
        if (deps.gotoGenerate) deps.gotoGenerate();
      });
      actions.appendChild(fallback);
    } else {
      var fill = el('button', 'btn btn-accent', t('chat_fill_form'));
      fill.type = 'button';
      fill.addEventListener('click', function () {
        track('chat_fill_form', {
          model: plan.model,
          duration: plan.duration,
          resolution: plan.resolution,
          credits: credits
        });
        if (deps.fillGenerate) deps.fillGenerate(plan);
        if (deps.gotoGenerate) deps.gotoGenerate();
        if (deps.toast) deps.toast(t('chat_filled_toast'));
      });
      actions.appendChild(fill);
    }
    card.appendChild(actions);
    mount.appendChild(card);
    scrollThread();
    track('chat_plan_ready', {
      model: plan.model,
      duration: plan.duration,
      resolution: plan.resolution,
      credits: credits,
      insuff: !!insuff
    });
  }

  function renderExamples() {
    var box = $('chat-example-chips');
    if (!box) return;
    box.innerHTML = '';
    EXAMPLE_IDS.forEach(function (id) {
      var b = el('button', 'chat-example-chip');
      b.type = 'button';
      b.setAttribute('data-example', id);
      b.appendChild(el('span', 'chat-example-title', t('example_' + id + '_label')));
      var blurb = t('example_' + id + '_blurb');
      if (blurb && blurb.indexOf('example_') !== 0) {
        b.appendChild(el('span', 'chat-example-blurb', blurb));
      }
      b.addEventListener('click', function () { onExample(id); });
      box.appendChild(b);
    });
  }

  function setBusy(on) {
    busy = !!on;
    var send = $('chat-send');
    var input = $('chat-input');
    if (send) send.disabled = busy;
    if (input) input.disabled = busy;
    var status = $('chat-status');
    if (status) {
      status.textContent = busy ? t('chat_thinking') : '';
      status.hidden = !busy;
    }
  }

  function ensureSession() {
    if (sessionStarted) return;
    sessionStarted = true;
    track('chat_session_start', {});
  }

  function onExample(id) {
    if (busy) return;
    ensureSession();
    track('chat_example_click', { example_id: id });
    var label = t('example_' + id + '_label');
    var prompt = t('example_' + id + '_prompt');
    var userVisible = t('chat_example_user', label);
    // Seed Flash with the preset prompt as reference, but show a short chip message in UI.
    var apiUser = userVisible + '\n\n[example_id=' + id + ']\n' + t('chat_example_ref_prefix') + '\n' + prompt;
    appendBubble('user', userVisible);
    hideExamples();
    messages.push({ role: 'user', content: apiUser });
    runFlash();
  }

  function hideExamples() {
    var wrap = $('chat-examples');
    if (wrap) wrap.hidden = true;
  }

  function lastUserText() {
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i] && messages[i].role === 'user') return String(messages[i].content || '').trim();
    }
    return '';
  }

  function draftPlanFromUser() {
    var raw = lastUserText();
    if (!raw) return null;
    // Strip example metadata seed if present
    var prompt = raw.split('\n\n[example_id=')[0].trim() || raw;
    prompt = prompt.replace(/^\[[^\]]*\]\s*/m, '').trim();
    if (prompt.length < 8) return null;
    return clampPlan({
      title: t('chat_draft_title'),
      summary: t('chat_draft_summary'),
      prompt: prompt.slice(0, 1800),
      model: CHEAP_DEFAULT.model,
      duration: CHEAP_DEFAULT.duration,
      resolution: CHEAP_DEFAULT.resolution,
      ratio: CHEAP_DEFAULT.ratio
    });
  }

  function showError(detail, opts) {
    opts = opts || {};
    appendBubble('assistant', t('chat_flash_error', detail || t('chat_flash_unknown')));
    var mount = $('chat-plan-mount');
    if (!mount) return;
    var actions = el('div', 'chat-fallback-actions');

    var retry = el('button', 'btn btn-accent', t('chat_retry'));
    retry.type = 'button';
    retry.addEventListener('click', function () {
      track('chat_flash_retry_click', {});
      if (busy) return;
      runFlash();
    });
    actions.appendChild(retry);

    var draft = draftPlanFromUser();
    if (draft) {
      var draftBtn = el('button', 'btn', t('chat_use_draft'));
      draftBtn.type = 'button';
      draftBtn.addEventListener('click', function () {
        track('chat_fallback_draft', {});
        appendBubble('assistant', t('chat_draft_ready'));
        renderPlanCard(draft);
      });
      actions.appendChild(draftBtn);
    }

    var btn = el('button', 'btn', t('chat_goto_classic'));
    btn.type = 'button';
    btn.addEventListener('click', function () {
      track('chat_fallback_classic', { reason: 'flash_error' });
      if (deps.gotoGenerate) deps.gotoGenerate();
    });
    actions.appendChild(btn);
    mount.appendChild(actions);
  }

  function runFlash() {
    setBusy(true);
    clearPlanMount();
    chatCompletions(messages).then(function (res) {
      setBusy(false);
      if (!res.ok) {
        track('chat_flash_fail', { kind: res.kind || 'unknown', http: res.http || 0 });
        showError(res.detail || res.kind);
        return;
      }
      var parsed = parseAssistantPayload(res.content);
      // Keep multi-turn: store assistant JSON/text for context (not shown raw if parse failed awkwardly)
      messages.push({ role: 'assistant', content: res.content });
      appendBubble('assistant', parsed.assistant_message);
      if (parsed.ready && parsed.plan) renderPlanCard(parsed.plan);
    }, function (err) {
      setBusy(false);
      track('chat_flash_fail', { kind: 'throw' });
      showError(String(err && err.message || err));
    });
  }

  function onSend() {
    if (busy) return;
    var input = $('chat-input');
    if (!input) return;
    var text = String(input.value || '').trim();
    if (!text) return;
    if (deps.getKey && !deps.getKey()) {
      appendBubble('assistant', t('chat_need_login'));
      track('chat_need_login_show', {});
      if (deps.promptLogin) deps.promptLogin();
      return;
    }
    ensureSession();
    var bucket = text.length < 40 ? 'short' : (text.length < 120 ? 'mid' : 'long');
    track('chat_user_message', { len_bucket: bucket });
    input.value = '';
    appendBubble('user', text);
    hideExamples();
    messages.push({ role: 'user', content: text });
    runFlash();
  }

  function resetConversation() {
    messages = [];
    lastPlan = null;
    sessionStarted = false;
    busy = false;
    var thread = $('chat-thread');
    if (thread) thread.innerHTML = '';
    clearPlanMount();
    var ex = $('chat-examples');
    if (ex) ex.hidden = false;
    appendBubble('assistant', t('chat_greeting'));
    renderExamples();
    var status = $('chat-status');
    if (status) { status.hidden = true; status.textContent = ''; }
  }

  function refreshUi() {
    applyChrome();
    if (isEnabled()) renderExamples();
  }

  function applyChrome() {
    var on = isEnabled();
    document.body.classList.toggle('pilot-chat-on', on);
    var tab = document.querySelector('.tabs [data-tab="chat"]');
    if (tab) tab.hidden = !on;
    var entry = $('chat-pilot-entry');
    if (entry) entry.hidden = !on;
    var panel = $('panel-chat');
    if (panel && !on) panel.hidden = true;
  }

  function bindUi() {
    var send = $('chat-send');
    if (send) send.addEventListener('click', onSend);
    var input = $('chat-input');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      });
    }
    var reset = $('chat-reset');
    if (reset) reset.addEventListener('click', function () {
      track('chat_session_reset', {});
      resetConversation();
    });
    var entry = $('chat-pilot-entry');
    if (entry) {
      entry.addEventListener('click', function () {
        track('chat_entry_click', { from: 'generate_banner' });
        if (deps.gotoChat) deps.gotoChat();
      });
    }
    var tab = document.querySelector('.tabs [data-tab="chat"]');
    if (tab) {
      tab.addEventListener('click', function () {
        track('chat_entry_click', { from: 'tab' });
      });
    }
  }

  function init(options) {
    deps = options || {};
    syncFlagFromQuery();
    applyChrome();
    bindUi();
    if (isEnabled()) resetConversation();
  }

  function onShow() {
    if (!isEnabled()) return;
    if (!sessionStarted) {
      // Greeting already in resetConversation; mark entry when panel opens first time
      track('chat_entry_click', { from: 'panel_show' });
    }
    scrollThread();
  }

  root.VSChatPilot = {
    FLASH_MODEL: FLASH_MODEL,
    STORE_FLAG: STORE_FLAG,
    CHEAP_DEFAULT: CHEAP_DEFAULT,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    syncFlagFromQuery: syncFlagFromQuery,
    applyChrome: applyChrome,
    refreshUi: refreshUi,
    init: init,
    onShow: onShow,
    track: track,
    parseAssistantPayload: parseAssistantPayload,
    clampPlan: clampPlan,
    resetConversation: resetConversation
  };
})(window);
