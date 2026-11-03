/**
 * Chat-to-video pilot (MVP): cheap chat models plan a clip; sunk-cost UX = chat until happy, then Copy.
 * Prefer glm-4.7-flash; on repeated upstream 429/1305 fall back to glm-4.5-air / deepseek-flash.
 * Chat completions stream (SSE) into the assistant bubble, then parse the full text into the plan card.
 * Credits never gate the plan card. Toggle ?pilot=chat / ?pilot=off. Classic Generate stays secondary.
 */
(function (root) {
  'use strict';

  // Prefer flash first; keep short allowlist of cheap chat models that support /v1/chat/completions.
  var FLASH_MODELS = ['glm-4.7-flash', 'glm-4.5-air', 'deepseek-flash'];
  var FLASH_MODEL = FLASH_MODELS[0];
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
    var flag = store().get(STORE_FLAG, null);
    if (flag === '0') return false;
    if (flag === '1') return true;
    try {
      var p = (new URLSearchParams(location.search || '').get('pilot') || '').toLowerCase();
      if (p === 'off' || p === '0' || p === 'classic' || p === 'false') return false;
      if (p === 'chat' || p === '1' || p === 'on' || p === 'true') return true;
    } catch (e) { /* ignore */ }
    // Default on: chat is a first-class tab; opt out with ?pilot=off.
    return true;
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
        '你是 PowerTokens Video Studio 的出片助手。用简洁中文和用户多轮打磨想拍的内容。',
        '目标：先让用户投入对话、把方案聊满意；满意后再给出可复制的提示词。不要催充值或催立刻生成。',
        '底层视频模型目录（只能从中选 model）：' + catalog + '。',
        '默认便宜档：model=' + cheap.model + '，duration=' + cheap.duration + '，resolution=' + cheap.resolution + '，ratio=' + cheap.ratio + '。',
        '严禁默认 16 秒或 1080p/4k；除非用户明确要求更长/更高清，否则保持 5 秒、720p 或更低。',
        '每轮只回复一个 JSON 对象（不要 markdown 围栏外的闲聊），字段：',
        '{"assistant_message":"给用户看的白话","ready":false,"plan":null}',
        '前几轮优先提问与改写（ready=false, plan=null），帮用户细化主体/动作/场景/镜头。',
        '仅当用户明确说可以了/要提示词/要方案，或信息已足够且用户未再追问时，才设 ready=true 并填 plan：',
        '{"title":"短标题","prompt":"完整视频提示词","model":"模型id","duration":5,"resolution":"720p","ratio":"9:16","summary":"一句话方案摘要"}',
        'ready=true 时，assistant_message 应邀请用户继续改，或复制提示词；不要提积分不足或去充值。',
        'prompt 要具体（主体、动作、场景、镜头、光影、声音），适合图生/文生视频。',
        '严禁把用户原话/请求句原样塞进 plan.prompt；必须写成可直接出片的完整提示词。',
        '若消息含 [example_id=…] 与参考预设，请改写成便宜档（约5秒、720p）可拍版本，保留具体画面细节，不要只复述“我想拍某某”。'
      ].join('\n');
    }
    return [
      'You are the PowerTokens Video Studio chat planner. Invest sunk cost: refine in short turns until the user is happy, then offer a copyable prompt.',
      'Do not push top-up or immediate Generate. Keep chatting and rewriting.',
      'Video model catalog (pick model only from this list): ' + catalog + '.',
      'Default cheap tier: model=' + cheap.model + ', duration=' + cheap.duration + ', resolution=' + cheap.resolution + ', ratio=' + cheap.ratio + '.',
      'Never default to 16s or 1080p/4k; keep 5s and 720p or lower unless the user explicitly asks for longer/higher.',
      'Reply with ONE JSON object only each turn (no prose outside JSON):',
      '{"assistant_message":"user-facing text","ready":false,"plan":null}',
      'Early turns: ask and refine (ready=false, plan=null). Cover subject, action, scene, camera.',
      'Only when the user says they are ready / wants the prompt / wants the plan — or details are enough and they stop asking — set ready=true and fill plan:',
      '{"title":"short title","prompt":"full video prompt","model":"model id","duration":5,"resolution":"720p","ratio":"9:16","summary":"one-line summary"}',
      'When ready=true, invite them to keep refining or copy the prompt. Never mention low credits or top-up.',
      'plan.prompt MUST be a shootable video prompt (subject, action, scene, camera, lighting, audio) — NEVER the user\'s request sentence verbatim.',
      'If the user message includes [example_id=…] and a reference preset, rewrite it for the cheap tier (~5s, 720p) with concrete visuals; do not only restate “I want an X style clip”.',
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

  function wantsThinkingDisabled(modelId) {
    var id = String(modelId || '').toLowerCase();
    // Zhipu GLM flash/air: default thinking can empty content or worsen load; disable when allowed.
    return id.indexOf('glm-') === 0;
  }

  function buildChatBody(apiMessages, modelId) {
    var model = modelId || FLASH_MODEL;
    var body = {
      model: model,
      temperature: 0.4,
      max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt() }].concat(apiMessages)
    };
    // glm-4.7-flash defaults thinking=on upstream; that often returns empty content
    // or 429/1305 under load. Pilot only needs plain JSON text.
    if (wantsThinkingDisabled(model)) body.thinking = { type: 'disabled' };
    return body;
  }

  function mapChatHttpFailure(r, model) {
    var A = root.VSApi;
    if (r.networkError) {
      return { ok: false, kind: 'NETWORK', detail: r.error || t('chat_flash_network'), model: model };
    }
    if (r.code === 401 || r.code === 403) {
      return {
        ok: false,
        kind: 'AUTH',
        detail: formatHttpDetail(r.code, r.body) || (A && A.serverMessage ? A.serverMessage(r.body) : t('chat_flash_auth')),
        http: r.code,
        model: model
      };
    }
    if (r.code !== 200) {
      return { ok: false, kind: 'HTTP', detail: formatHttpDetail(r.code, r.body), http: r.code, model: model };
    }
    return null;
  }

  /** Non-stream fallback (also used once if a stream dies mid-reply). */
  function chatCompletionsOnceNonStream(apiMessages, modelId) {
    var A = root.VSApi;
    var key = deps.getKey && deps.getKey();
    var model = modelId || FLASH_MODEL;
    if (!A || !key) {
      return Promise.resolve({ ok: false, kind: 'NO_KEY', detail: t('chat_need_login'), model: model });
    }
    var body = buildChatBody(apiMessages, model);
    return A.api('POST', '/v1/chat/completions', key, body, 60000).then(function (r) {
      var fail = mapChatHttpFailure(r, model);
      if (fail) return fail;
      var choice = r.body && r.body.choices && r.body.choices[0];
      var content = extractChoiceContent(choice);
      if (!content) return { ok: false, kind: 'EMPTY', detail: t('chat_flash_empty'), http: 200, model: model };
      return { ok: true, content: content, model: model, streamed: false };
    });
  }

  /**
   * Prefer SSE stream so the bubble paints as tokens arrive.
   * opts.onDelta(piece) optional. opts.allowNonStreamFallback (default true) retries once
   * without stream if the stream errors after partial content, or if stream is unavailable.
   */
  function chatCompletionsOnce(apiMessages, modelId, opts) {
    opts = opts || {};
    var A = root.VSApi;
    var key = deps.getKey && deps.getKey();
    var model = modelId || FLASH_MODEL;
    var onDelta = typeof opts.onDelta === 'function' ? opts.onDelta : null;
    if (!A || !key) {
      return Promise.resolve({ ok: false, kind: 'NO_KEY', detail: t('chat_need_login'), model: model });
    }
    if (typeof A.apiChatStream !== 'function') {
      return chatCompletionsOnceNonStream(apiMessages, modelId);
    }
    var body = buildChatBody(apiMessages, model);
    return A.apiChatStream('/v1/chat/completions', key, body, 60000, onDelta).then(function (r) {
      var fail = mapChatHttpFailure(r, model);
      if (fail) {
        // Stream never started (JSON 429 etc.) — retryable via outer allowlist loop.
        return fail;
      }
      var content = String(r.content || '');
      if (r.networkError && content) {
        // Mid-stream drop after some tokens: optional one non-stream retry.
        if (opts.allowNonStreamFallback !== false) {
          track('chat_flash_stream_mid_retry', { model: model, partial_len: content.length });
          return chatCompletionsOnceNonStream(apiMessages, modelId).then(function (res) {
            if (res.ok) res.recovered_from_stream = true;
            else {
              res.kind = res.kind || 'STREAM';
              res.partial = content;
              res.detail = res.detail || t('chat_flash_stream_cut');
            }
            return res;
          });
        }
        return {
          ok: false,
          kind: 'STREAM',
          detail: r.error || t('chat_flash_stream_cut'),
          http: r.code || 200,
          model: model,
          partial: content
        };
      }
      if (r.networkError) {
        return { ok: false, kind: 'NETWORK', detail: r.error || t('chat_flash_network'), model: model };
      }
      if (!content) return { ok: false, kind: 'EMPTY', detail: t('chat_flash_empty'), http: 200, model: model };
      return { ok: true, content: content, model: model, streamed: !!r.streamed };
    });
  }

  /**
   * Retry transient 429/1305 / empty / network with short backoff, then fall through the
   * cheap-model allowlist (glm-4.7-flash first). Keep silent waits short so streaming feels snappy.
   */
  function chatCompletions(apiMessages, opts) {
    var models = FLASH_MODELS.slice();
    var modelIndex = 0;
    var attemptOnModel = 0;
    var maxAttemptsPerModel = 2;
    // Short backoff: capacity errors should flip models quickly; stream already paints progress.
    var delays = [0, 700];

    function next() {
      var model = models[modelIndex] || FLASH_MODEL;
      var wait = delays[attemptOnModel] || delays[delays.length - 1];
      attemptOnModel += 1;
      var onceOpts = {
        onDelta: opts && opts.onDelta,
        allowNonStreamFallback: opts && opts.allowNonStreamFallback
      };
      var run = wait ? sleep(wait).then(function () { return chatCompletionsOnce(apiMessages, model, onceOpts); })
        : chatCompletionsOnce(apiMessages, model, onceOpts);
      return run.then(function (res) {
        if (res.ok) {
          if (modelIndex > 0) {
            track('chat_flash_fallback_ok', { model: model, from: models[0], attempt: attemptOnModel });
          }
          return res;
        }
        var retryable = isRetryableFlash(res);
        // Do not burn retries on mid-stream cuts — surface to the user (optional non-stream already tried).
        if (res.kind === 'STREAM') return res;
        if (retryable && attemptOnModel < maxAttemptsPerModel) {
          track('chat_flash_retry', {
            attempt: attemptOnModel,
            kind: res.kind || 'unknown',
            http: res.http || 0,
            model: model
          });
          return next();
        }
        // Exhausted this model on capacity / transient errors → try next allowlisted id.
        if (retryable && modelIndex < models.length - 1) {
          track('chat_flash_fallback', {
            from: model,
            to: models[modelIndex + 1],
            kind: res.kind || 'unknown',
            http: res.http || 0
          });
          modelIndex += 1;
          attemptOnModel = 0;
          return next();
        }
        return res;
      });
    }
    return next();
  }

  function scrollThread() {
    var scroller = document.querySelector('.chat-scroll') || $('chat-thread');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function appendBubble(role, text) {
    var thread = $('chat-thread');
    if (!thread || !text) return null;
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
    return { row: row, bubble: bubble };
  }

  /** Unescape a JSON string body (no surrounding quotes). */
  function unescapeJsonString(s) {
    return String(s || '').replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    }).replace(/\\(["\\/bfnrt])/g, function (_, c) {
      return ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[c] || c;
    });
  }

  /**
   * While the model streams plan JSON, prefer painting assistant_message text
   * instead of raw braces — falls back to raw if the field is not open yet.
   */
  function streamPreviewText(raw) {
    var s = String(raw || '');
    if (!s) return '';
    var key = '"assistant_message"';
    var idx = s.indexOf(key);
    if (idx < 0) {
      // Still preamble / other fields — avoid flashing "{" at the user.
      if (s.charAt(0) === '{' || s.charAt(0) === '[') return '';
      return s;
    }
    var after = s.slice(idx + key.length);
    var colon = after.search(/:\s*"/);
    if (colon < 0) return '';
    var body = after.slice(colon);
    body = body.replace(/^:\s*"/, '');
    // Scan until unescaped closing quote (or end of stream so far).
    var out = '';
    var i = 0;
    var closed = false;
    while (i < body.length) {
      var ch = body.charAt(i);
      if (ch === '\\') {
        if (i + 1 < body.length) {
          out += body.charAt(i) + body.charAt(i + 1);
          i += 2;
          continue;
        }
        out += ch;
        break;
      }
      if (ch === '"') { closed = true; break; }
      out += ch;
      i += 1;
    }
    var text = unescapeJsonString(out);
    // If the string has not closed yet, keep a caret feel via CSS class on bubble.
    return text;
  }

  function beginAssistantStream() {
    var thread = $('chat-thread');
    if (!thread) return null;
    var row = el('div', 'chat-row chat-row--assistant');
    var av = el('div', 'chat-avatar', 'P');
    av.setAttribute('aria-hidden', 'true');
    row.appendChild(av);
    var bubble = el('div', 'chat-bubble chat-bubble--assistant chat-bubble--streaming', '');
    bubble.setAttribute('aria-live', 'polite');
    row.appendChild(bubble);
    thread.appendChild(row);
    scrollThread();
    var raw = '';
    var lastPaint = 0;
    function paint(force) {
      var now = Date.now();
      if (!force && now - lastPaint < 32) return; // ~30fps coalescing
      lastPaint = now;
      var preview = streamPreviewText(raw);
      bubble.textContent = preview || (raw ? '' : '');
      // Keep a thin placeholder so the streaming caret CSS still shows.
      if (!preview) bubble.setAttribute('data-streaming-empty', '1');
      else bubble.removeAttribute('data-streaming-empty');
      scrollThread();
    }
    return {
      row: row,
      bubble: bubble,
      appendDelta: function (piece) {
        raw += String(piece || '');
        paint(false);
      },
      finalize: function (displayText) {
        bubble.classList.remove('chat-bubble--streaming');
        bubble.removeAttribute('data-streaming-empty');
        bubble.textContent = displayText || '';
        scrollThread();
      },
      discard: function () {
        try { row.remove(); } catch (e) {
          if (row.parentNode) row.parentNode.removeChild(row);
        }
      },
      getRaw: function () { return raw; }
    };
  }

  function clearPlanMount() {
    var mount = $('chat-plan-mount');
    if (mount) mount.innerHTML = '';
    lastPlan = null;
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch (e) { return false; }
  }

  function copyPlanPrompt(prompt) {
    var text = String(prompt || '');
    if (!text) return Promise.resolve(false);
    if (deps && typeof deps.copyText === 'function') {
      return Promise.resolve(deps.copyText(text)).then(function () { return true; }, function () {
        return fallbackCopy(text);
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function focusComposer() {
    var input = $('chat-input');
    if (!input) return;
    try { input.focus(); } catch (e) { /* ignore */ }
    try { input.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e2) { /* ignore */ }
  }

  function isBusyCapacityDetail(detail, http) {
    var s = String(detail || '').toLowerCase();
    if (http === 429 || http === 502 || http === 503 || http === 504) return true;
    return s.indexOf('429') >= 0 || s.indexOf('1305') >= 0 || s.indexOf('1302') >= 0 ||
      s.indexOf('rate limit') >= 0 || s.indexOf('overloaded') >= 0 || s.indexOf('busy') >= 0 ||
      s.indexOf('retry later') >= 0 || s.indexOf('temporarily') >= 0;
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

    // Sunk-cost UX: never gate on credits. Primary = Copy; keep refining; Fill Generate secondary.
    var actions = el('div', 'chat-plan-actions');
    var copyBtn = el('button', 'btn btn-accent', t('chat_copy_prompt'));
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function () {
      track('chat_copy_prompt', {
        model: plan.model,
        duration: plan.duration,
        resolution: plan.resolution,
        credits: credits,
        insuff: !!insuff
      });
      copyPlanPrompt(plan.prompt).then(function (ok) {
        if (deps.toast) deps.toast(ok ? t('chat_copied_toast') : t('chat_copy_failed'));
        if (ok) {
          details.open = true;
          if (insuff) revealSoftCredits(card, credits, have);
        }
      });
    });
    actions.appendChild(copyBtn);

    var refine = el('button', 'btn', t('chat_keep_refining'));
    refine.type = 'button';
    refine.addEventListener('click', function () {
      track('chat_keep_refining', { model: plan.model });
      focusComposer();
      if (deps.toast) deps.toast(t('chat_keep_refining_toast'));
    });
    actions.appendChild(refine);

    var fill = el('button', 'btn', t('chat_fill_form'));
    fill.type = 'button';
    fill.addEventListener('click', function () {
      track('chat_fill_form', {
        model: plan.model,
        duration: plan.duration,
        resolution: plan.resolution,
        credits: credits,
        insuff: !!insuff
      });
      if (deps.fillGenerate) deps.fillGenerate(plan);
      if (deps.gotoGenerate) deps.gotoGenerate();
      if (deps.toast) deps.toast(t('chat_filled_toast'));
    });
    actions.appendChild(fill);
    card.appendChild(actions);

    // Soft credits hint only (muted). No blocking Top up CTA on the plan card.
    if (insuff) {
      track('credits_insufficient_soft', {
        need: credits,
        have: have,
        model: plan.model,
        duration: plan.duration,
        resolution: plan.resolution
      });
      var soft = el('p', 'chat-plan-soft muted small');
      soft.setAttribute('data-soft-credits', '1');
      soft.hidden = true; // reveal after copy, or leave a one-line tip below
      soft.textContent = t('chat_credits_soft', String(credits), String(have));
      card.appendChild(soft);
      var tip = el('p', 'chat-plan-tip muted small', t('chat_plan_copy_tip'));
      card.appendChild(tip);
    } else {
      card.appendChild(el('p', 'chat-plan-tip muted small', t('chat_plan_copy_tip')));
    }

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

  function revealSoftCredits(card, credits, have) {
    if (!card) return;
    var soft = card.querySelector('[data-soft-credits]');
    if (!soft) return;
    soft.hidden = false;
    soft.textContent = t('chat_credits_soft', String(credits), String(have));
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

  function extractExampleId(raw) {
    var m = String(raw || '').match(/\[example_id=([a-z0-9_-]+)\]/i);
    return m ? m[1].toLowerCase() : '';
  }

  function visibleUserRequest(raw) {
    var s = String(raw || '');
    var cut = s.split('\n\n[example_id=')[0].trim();
    cut = cut.replace(/^\[[^\]]*\]\s*/m, '').trim();
    return cut || s.trim();
  }

  function normalizePromptCompare(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\u201c\u201d\u2018\u2019"']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** True when plan.prompt is too short or mostly echoes the user request sentence. */
  function isWeakOrEchoPrompt(prompt, userRaw) {
    var p = String(prompt || '').trim();
    if (p.length < 80) return true;
    var u = visibleUserRequest(userRaw);
    if (!u || u.length < 8) return false;
    var pn = normalizePromptCompare(p);
    var un = normalizePromptCompare(u);
    if (!pn || !un) return false;
    if (pn === un) return true;
    if (un.length >= 16 && (pn.indexOf(un) >= 0 || un.indexOf(pn) >= 0)) return true;
    // Shared token overlap for short request lines that got lightly rephrased.
    if (un.length <= 120 && pn.length <= 220) {
      var uWords = un.split(' ').filter(function (w) { return w.length > 2; });
      if (uWords.length >= 4) {
        var hits = 0;
        for (var i = 0; i < uWords.length; i++) {
          if (pn.indexOf(uWords[i]) >= 0) hits++;
        }
        if (hits / uWords.length >= 0.85) return true;
      }
    }
    return false;
  }

  function cheapTierLeadIn() {
    var lang = (deps && deps.getLang && deps.getLang()) || 'zh';
    if (lang === 'zh') {
      return '约 5 秒、720p、9:16 竖屏可拍短片。保留具体画面，压缩到便宜档时长。\n\n';
    }
    return 'Shootable ~5s · 720p · 9:16 vertical clip. Keep concrete visuals; fit the cheap tier.\n\n';
  }

  function expandFreeformPrompt(request) {
    var lang = (deps && deps.getLang && deps.getLang()) || 'zh';
    var intent = String(request || '').trim().slice(0, 500);
    if (lang === 'zh') {
      return [
        '根据用户意图展开的可拍提示词（便宜档约 5 秒 / 720p / 9:16）：',
        '意图：' + intent,
        '主体与动作：按意图写出清晰主体，以及 5 秒内可完成的连续动作（起势→发展→收束）。',
        '场景：具体环境、道具与空间层次，避免空泛形容词。',
        '镜头：平视或略低机位，稳定跟拍或轻微手持，景别从中景过渡到近景。',
        '光影与质感：自然光或柔和影视光，真实材质与浅景深。',
        '声音：匹配场景的环境声；若有对白需口型同步；无字幕、无水印、无 Logo。',
        '风格：写实电影感短视频，动作符合物理规律。'
      ].join('\n');
    }
    return [
      'Shootable video prompt expanded from the user request (cheap tier ~5s / 720p / 9:16):',
      'Intent: ' + intent,
      'Subject & action: name a concrete subject and a continuous action that completes within ~5 seconds (setup → beat → resolve).',
      'Environment: specific setting, props, and depth; avoid vague adjectives alone.',
      'Camera: eye-level or slightly low, smooth follow or subtle handheld; medium into close-up.',
      'Lighting & texture: natural or soft cinematic light, real materials, shallow depth of field.',
      'Audio: matching ambience; lip-sync if dialogue; no on-screen text, watermark, or logos.',
      'Style: photoreal short-form cinematic; physically plausible motion.'
    ].join('\n');
  }

  /**
   * Offline / repair path: always expand to a real shootable prompt.
   * Preset chips → full example_*_prompt (cheap-tier lead-in). Free text → structured expansion.
   * Never return the user request sentence alone.
   */
  function expandDraftPrompt(raw) {
    raw = String(raw || '').trim();
    if (!raw) return '';
    var exId = extractExampleId(raw);
    if (exId && EXAMPLE_IDS.indexOf(exId) >= 0) {
      var preset = t('example_' + exId + '_prompt');
      if (preset && preset.indexOf('example_') !== 0 && preset.trim().length >= 40) {
        return (cheapTierLeadIn() + preset.trim()).slice(0, 2200);
      }
    }
    var request = visibleUserRequest(raw);
    if (request.length < 8) return '';
    // If the "request" is already a long shootable prompt the user pasted, keep it.
    if (request.length >= 160 && /(?:\n|subject:|camera:|action:|环境|镜头|主体)/i.test(request)) {
      return request.slice(0, 2200);
    }
    return expandFreeformPrompt(request).slice(0, 2200);
  }

  function draftPlanFromUser() {
    var raw = lastUserText();
    if (!raw) return null;
    var prompt = expandDraftPrompt(raw);
    if (!prompt || prompt.length < 40) return null;
    var exId = extractExampleId(raw);
    var title = t('chat_draft_title');
    if (exId) {
      var label = t('example_' + exId + '_label');
      if (label && label.indexOf('example_') !== 0) title = label;
    }
    return clampPlan({
      title: title,
      summary: t('chat_draft_summary'),
      prompt: prompt,
      model: CHEAP_DEFAULT.model,
      duration: CHEAP_DEFAULT.duration,
      resolution: CHEAP_DEFAULT.resolution,
      ratio: CHEAP_DEFAULT.ratio
    });
  }

  /** If the model echoed the user request, replace with an expanded local prompt. */
  function ensureShootablePlan(plan, userRaw) {
    if (!plan || !plan.prompt) return plan;
    if (!isWeakOrEchoPrompt(plan.prompt, userRaw)) return plan;
    var expanded = expandDraftPrompt(userRaw || lastUserText());
    if (!expanded || expanded.length < 40) return plan;
    plan.prompt = expanded;
    if (!plan.summary) plan.summary = t('chat_draft_summary');
    return plan;
  }

  function showError(detail, opts) {
    opts = opts || {};
    var busyCap = isBusyCapacityDetail(detail, opts.http);
    var msg = busyCap
      ? t('chat_flash_busy')
      : t('chat_flash_error', detail || t('chat_flash_unknown'));
    appendBubble('assistant', msg);
    var mount = $('chat-plan-mount');
    if (!mount) return;
    var actions = el('div', 'chat-fallback-actions');

    var retry = el('button', 'btn btn-accent', t('chat_retry'));
    retry.type = 'button';
    retry.addEventListener('click', function () {
      track('chat_flash_retry_click', { busy: !!busyCap });
      if (busy) return;
      runFlash();
    });
    actions.appendChild(retry);

    var draft = draftPlanFromUser();
    if (draft) {
      var draftBtn = el('button', 'btn', t('chat_use_draft'));
      draftBtn.type = 'button';
      draftBtn.addEventListener('click', function () {
        track('chat_fallback_draft', { busy: !!busyCap });
        appendBubble('assistant', t('chat_draft_ready'));
        renderPlanCard(draft);
      });
      actions.appendChild(draftBtn);
      // Soft path: for capacity blips, also keep refining without jumping to Generate.
      if (busyCap) {
        var keep = el('button', 'btn', t('chat_keep_refining'));
        keep.type = 'button';
        keep.addEventListener('click', function () {
          track('chat_keep_refining', { from: 'flash_busy' });
          focusComposer();
        });
        actions.appendChild(keep);
      }
    }

    // Classic Generate stays available but secondary — never the forced next step.
    var btn = el('button', 'btn', t('chat_goto_classic'));
    btn.type = 'button';
    btn.addEventListener('click', function () {
      track('chat_fallback_classic', { reason: busyCap ? 'flash_busy' : 'flash_error' });
      if (deps.gotoGenerate) deps.gotoGenerate();
    });
    actions.appendChild(btn);
    mount.appendChild(actions);
  }

  function runFlash() {
    setBusy(true);
    clearPlanMount();
    var streamUi = beginAssistantStream();
    var firstToken = false;
    function onDelta(piece) {
      if (!streamUi) return;
      if (!firstToken && piece) {
        firstToken = true;
        // Drop the "thinking…" status as soon as tokens paint — feels faster.
        var status = $('chat-status');
        if (status) { status.hidden = true; status.textContent = ''; }
      }
      streamUi.appendDelta(piece);
    }
    chatCompletions(messages, { onDelta: onDelta }).then(function (res) {
      setBusy(false);
      if (!res.ok) {
        if (streamUi) streamUi.discard();
        track('chat_flash_fail', {
          kind: res.kind || 'unknown',
          http: res.http || 0,
          model: res.model || '',
          streamed: !!res.streamed
        });
        showError(res.detail || res.kind, { http: res.http, kind: res.kind, model: res.model });
        return;
      }
      var parsed = parseAssistantPayload(res.content);
      // Keep multi-turn: store assistant JSON/text for context
      messages.push({ role: 'assistant', content: res.content });
      if (streamUi) {
        streamUi.finalize(parsed.assistant_message);
      } else {
        appendBubble('assistant', parsed.assistant_message);
      }
      if (parsed.ready && parsed.plan) {
        parsed.plan = ensureShootablePlan(parsed.plan, lastUserText());
        renderPlanCard(parsed.plan);
      }
      track('chat_flash_ok', {
        model: res.model || '',
        streamed: res.streamed !== false,
        recovered: !!res.recovered_from_stream,
        ready: !!parsed.ready
      });
    }, function (err) {
      setBusy(false);
      if (streamUi) streamUi.discard();
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
    // Chat is a first-class tab when on — hide the redundant Generate-tab entry CTA.
    var entry = $('chat-pilot-entry');
    if (entry) entry.hidden = true;
    var entryWrap = $('chat-pilot-entry-wrap');
    if (entryWrap) entryWrap.hidden = true;
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
