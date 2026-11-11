/**
 * Chat-to-video pilot (MVP): cheap chat models plan a clip; sunk-cost UX = chat until happy, then Copy.
 * Prefer glm-4.7-flash; on repeated upstream 429/1305 fall back to glm-4.5-air / deepseek-flash.
 * Chat completions stream (SSE) into the assistant bubble, then parse the full text into the plan card.
 * Credits never gate the plan card. A free text model (glm-4.7-flash, price 0) must not
 * show a video estimateCost “credits insufficient” soft tip; that warning belongs
 * on Generate, when the user actually renders. Toggle ?pilot=chat / ?pilot=off.
 * Classic Generate stays secondary.
 */
(function (root) {
  'use strict';

  // Prefer flash first; keep short allowlist of cheap chat models that support /v1/chat/completions.
  var FLASH_MODELS = ['glm-4.7-flash', 'glm-4.5-air', 'deepseek-flash'];
  var FLASH_MODEL = FLASH_MODELS[0];
  // PowerTokens list price, USD per 1M input tokens. 0 = this chat turn is free.
  // Paid fallbacks (glm-4.5-air, deepseek-flash) are omitted on purpose: only a
  // known price of 0 suppresses the video-estimate soft credit warning.
  var TEXT_MODEL_INPUT_USD_PER_MTOK = {
    'glm-4.7-flash': 0
  };
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
  var lastTextModel = FLASH_MODEL;
  var busy = false;  var currentChatId = '';

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
      // Critical PostHog events are allowlisted in VSAnalytics; chat_* names are dropped.
      if (root.VSAnalytics && typeof root.VSAnalytics.track === 'function') {
        root.VSAnalytics.track(eventName, payload);
      }
    } catch (e3) { /* ignore */ }
    try {
      if (root.console && console.info) console.info('[vs-analytics]', eventName, payload);
    } catch (e2) { /* ignore */ }
  }

  function modelCatalogHint() {
    var M = root.VSModels;
    if (!M || !M.MODELS) return 'wan3.0-video';
    return Object.keys(M.MODELS).join(', ');
  }

  function replyLanguageName(lang) {
    if (lang === 'es') return 'Spanish';
    if (lang === 'pt') return 'Portuguese';
    if (lang === 'ja') return 'Japanese';
    if (lang === 'ko') return 'Korean';
    return 'English';
  }

  function systemPrompt() {
    var lang = (deps && deps.getLang && deps.getLang()) || 'zh';
    var cheap = CHEAP_DEFAULT;
    var catalog = modelCatalogHint();
    if (lang === 'zh') {
      return [
        '你是 PowerTokens Video Studio 的出片策划。用简短白话把画面聊清楚，再给出一条视频模型可以直接用的提示词。',
        '不要提积分、充值，也不要催用户马上生成。',
        '视频模型只能从这里选：' + catalog + '。',
        '默认：model=' + cheap.model + '，duration=' + cheap.duration + '，resolution=' + cheap.resolution + '，ratio=' + cheap.ratio + '。',
        '只有用户明确要求更长或更高清时才提高。否则禁止 16 秒、1080p、4K。时长和清晰度只写在 plan 字段里，不要写进 prompt 开头。',
        '每一轮只输出一个 JSON 对象。不要用 markdown，不要在 JSON 外面写字。',
        '对话节奏（没有 [example_id= 时）：',
        '1) 乱码、过短、明显打错、看不懂想拍什么：ready=false，plan=null，用一句白话问「你想拍什么画面」。禁止说「我先出方案」「这就生成」。',
        '2) 有主题但缺主体或动作（例如只说 fillet / 想拍视频）：ready=false，只追问一个最关键的缺口。不要连问服装、厨房风格等可选项。',
        '3) 主体和动作已经够拍、但用户还没确认也没说「出方案/给提示词/可以了」：ready=false，用一两句复述画面并问「这样对吗？」。不要先弹完整方案。',
        '4) 仅在这些情况 ready=true：用户刚确认（对/对的/可以了/就这样），或明确要方案/提示词，或消息含 [example_id= 与参考提示词。确认后不要再追问可选项。',
        'ready=false 时：{"assistant_message":"白话追问或确认","ready":false,"plan":null}',
        'ready=true 时输出 plan：',
        '{"title":"短标题","prompt":"成片提示词","model":"' + cheap.model + '","duration":5,"resolution":"720p","ratio":"9:16","summary":"一句话画面"}',
        'assistant_message：ready=false 时只追问或确认；ready=true 时用白话说已按确认点写好第一版，并说明场景/光若未提则先简单写、可继续改。禁止空话「我来生成短片方案」。不要解释字段，不要提积分。',
        '限量自补：用户没提的角色、年龄、服装、具体菜品或道具不要编造。只补中性必要信息（台面、侧光、浅景深）。用户确认过的点不得悄悄改掉。',
        'prompt 用用户的语言（界面是中文就用中文，除非用户整段用了别的语言）。必须是拍得到的画面，按下面五段写，每段都是具体的人和物，不要写给编剧看的说明：',
        '主体：谁或什么，年龄或体型，服装，能看见的外貌。',
        '场景：地点、时间、光源、一件前景道具、背景里有什么。',
        '动作与运动：一个大约 5 秒能做完的连续动作，写清起势、变化和停住时的姿态。',
        '镜头：机位高度、景别、只保留一种运镜。',
        '风格与限制：光、材质、风格；环境声，或一句需要对口型的对白。无字幕，无水印，无 Logo，不要凭空加人。',
        '禁止：把用户原话或芯片上的短句原样当作 prompt；用唯美、震撼、高级感凑字而不写物件；一条里塞多场戏、整段建造或大段对白；用户没要字幕就不要字幕；在 prompt 里写积分、模型名或 JSON。',
        '若参考是 16 秒剧本，只留最有画面的一个节拍，收成大约 5 秒。有参考提示词时，plan.prompt 要达到同样具体，可以沿用那一条或只改同一画面。',
        '好（确认）：明白了：五分熟牛排煎好，用叉子切开，肉汁渗出，特写。这样对吗？',
        '好（出卡）：按你确认的四点写了第一版；场景和光先简单写，想改再说。',
        '坏：用户发 ia m 或只说想拍 fillet，就直接 ready=true 并编出厨师白围裙剔三文鱼。'
      ].join('\n');
    }
    return [
      'You are the PowerTokens Video Studio planner. Talk briefly, then write a prompt a video model can shoot as-is.',
      'Do not mention credits, top-up, or tell the user to generate now.',
      'Pick model only from: ' + catalog + '.',
      'Default: model=' + cheap.model + ', duration=' + cheap.duration + ', resolution=' + cheap.resolution + ', ratio=' + cheap.ratio + '.',
      'Raise duration or resolution only when the user explicitly asks. Otherwise never use 16s, 1080p, or 4K. Duration and resolution belong in the plan fields, not in the first line of prompt.',
      'Each turn is ONE JSON object. No markdown. No text outside the JSON.',
      'Dialogue rhythm (when there is no [example_id= ):',
      '1) Gibberish, too short, clear typos, or you cannot tell what to shoot: ready=false, plan=null, ask in one plain sentence what picture they want. Never say "I\'ll generate a plan" or "generating now".',
      '2) Theme present but subject or action missing (e.g. only "fillet" / "make a video"): ready=false, ask the single most important gap. Do not ask optional clothing or kitchen-style questions.',
      '3) Subject and action are shootable, but the user has not confirmed and did not ask for a plan/prompt: ready=false, paraphrase the picture in one or two sentences and ask "Does that sound right?". Do not open a full plan yet.',
      '4) Set ready=true only when: the user just confirmed (yes / that\'s right / ok / go ahead), or explicitly wants a plan or prompt, or the message includes [example_id= plus a reference prompt. After confirm, do not ask optional extras.',
      'When ready=false: {"assistant_message":"one clarify or confirm question","ready":false,"plan":null}',
      'When ready=true, include plan:',
      '{"title":"short title","prompt":"shot prompt","model":"' + cheap.model + '","duration":5,"resolution":"720p","ratio":"9:16","summary":"one-line picture"}',
      'assistant_message: when ready=false, only clarify or confirm; when ready=true, say you drafted from the confirmed points and that unstated scene/light are kept simple and editable. Never use empty lines like "I\'ll generate a short video plan." Do not explain fields. Do not mention credits.',
      'Write assistant_message, plan.title, plan.summary, and plan.prompt in ' + replyLanguageName(lang) + '.',
      'Limit invention: do not invent people, ages, outfits, specific dishes, or props the user did not mention. Only add neutral necessities (counter, side light, shallow depth). Never quietly change confirmed details.',
      'The prompt must be a picture someone can film. Use these five sections, each with concrete people and objects, not notes to a writer:',
      'Subject: who or what, age or build, clothes, visible features.',
      'Scene: place, time, light source, one foreground prop, what is behind.',
      'Action and motion: one continuous action that finishes in about 5 seconds. State the start, the change, and the held end pose.',
      'Camera: height, shot size, and only one camera move.',
      'Style and constraints: light, materials, look; ambience, or one lip-synced line. No on-screen text, watermark, or logo. Do not add people who were not asked for.',
      'Do not return the user line or the chip sentence as the prompt. Do not pad with vague words (beautiful, stunning, premium, cinematic vibe) instead of objects. Do not pack several scenes, a full build, or a long dialogue into one 5-second clip. Do not request on-screen text unless the user asked. Do not put credits, model names, or JSON inside prompt.',
      'If the reference is a 16-second script, keep the single most visual beat and fit it into about 5 seconds. When a reference prompt is attached, plan.prompt must be that concrete: keep it or revise the same picture only.',
      'Good (confirm): Got it: medium steak fried, you cut with a fork, juices seep, close-up. Does that sound right?',
      'Good (card): Drafted from the four points you confirmed; scene and light are kept simple for now — say what to change.',
      'Bad: User sends "ia m" or only "video about fillet", then ready=true with a invented chef in a white apron trimming salmon.'
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

  /** Known list price for a chat model, or null when this build does not price it. */
  function textModelInputUsd(modelId) {
    var id = String(modelId || '');
    if (!Object.prototype.hasOwnProperty.call(TEXT_MODEL_INPUT_USD_PER_MTOK, id)) return null;
    return TEXT_MODEL_INPUT_USD_PER_MTOK[id];
  }

  function textModelIsFree(modelId) {
    return textModelInputUsd(modelId) === 0;
  }

  /**
   * The plan card may mention a later video charge only as a soft note.
   * Free chat (price 0) must not turn wan/other video estimateCost into
   * “积分不足 / credits insufficient” — that comparison runs on Generate.
   * Paid text models are unchanged (no paid-text note is removed).
   */
  function planCardShowsVideoCreditSoft(textModelId) {
    return !textModelIsFree(textModelId);
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

  /** Letters / CJK / digits only — used to spot gibberish like "ia m". */
  function meaningfulGlyphs(text) {
    return String(text || '').replace(
      /[^0-9A-Za-z\u00C0-\u024F\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g,
      ''
    );
  }

  function isUserConfirmText(text) {
    var s = String(text || '').trim();
    if (!s || s.length > 48) return false;
    return /^(对|对的|对呀|对啊|是的|是|好|好的|可以|可以了|行|行了|就这样|没问题|确认|ok|okay|yes|yep|yeah|sure|correct|go ahead|lgtm|that'?s right|that is right)[.!?。！？]*$/i.test(s);
  }

  function isNonsensicalUserText(text) {
    var s = String(text || '').trim();
    if (!s) return true;
    if (/\[example_id=/i.test(s)) return false;
    // Short confirms ("对", "ok", "yes") must still reach the model / ready path.
    if (isUserConfirmText(s)) return false;
    if (isExplicitPlanAsk(s)) return false;
    var g = meaningfulGlyphs(s);
    if (g.length <= 3) return true;
    if (/^(.)\1{3,}$/i.test(g)) return true;
    return false;
  }

  function isExplicitPlanAsk(text) {
    var s = String(text || '');
    return /出方案|给提示词|写提示词|直接出|生成方案|给我方案|出卡|make (me )?a plan|write (me )?(a )?prompt|give me (a )?prompt|draft (a )?plan|show (me )?(the )?prompt/i.test(s);
  }

  /** User said enough for ready=true this turn (confirm / explicit ask / chip / pasted shot). */
  function userAllowsReady(raw) {
    var s = String(raw || '');
    if (extractExampleId(s)) return true;
    var visible = visibleUserRequest(s);
    if (isUserConfirmText(visible)) return true;
    if (isExplicitPlanAsk(visible)) return true;
    if (visible.length >= 160 && hasShotStructure(visible)) return true;
    return false;
  }

  /**
   * Models often jump to ready=true on typos or first drafts.
   * Demote to a clarify/confirm turn unless the user already allowed a card.
   */
  function demoteReadyIfNeeded(parsed, userRaw) {
    if (!parsed || !parsed.ready) return parsed;
    var visible = visibleUserRequest(userRaw);
    if (isNonsensicalUserText(visible)) {
      return {
        assistant_message: t('chat_clarify_nonsensical'),
        ready: false,
        plan: null,
        parse_ok: !!parsed.parse_ok,
        demoted: 'nonsense'
      };
    }
    if (userAllowsReady(userRaw)) return parsed;
    var summary = '';
    if (parsed.plan) summary = String(parsed.plan.summary || parsed.plan.title || '').trim();
    var msg = String(parsed.assistant_message || '').trim();
    var asks = /[?？]|对吗|可以吗|sound right|does that|确认一下|这样吗/i.test(msg);
    var generic = /i'?ll generate|i will generate|我来生成|先给你.*方案|短片方案|这就生成|video plan for you|generate a short/i.test(msg);
    if (!asks || generic) {
      msg = summary
        ? t('chat_confirm_picture', summary.slice(0, 120))
        : t('chat_need_more');
    }
    return {
      assistant_message: msg,
      ready: false,
      plan: null,
      parse_ok: !!parsed.parse_ok,
      demoted: 'need_confirm'
    };
  }

  function replyLocalClarify(reason) {
    var spoken = t('chat_clarify_nonsensical');
    appendBubble('assistant', spoken);
    messages.push({
      role: 'assistant',
      content: JSON.stringify({
        assistant_message: spoken,
        ready: false,
        plan: null
      })
    });
    track('chat_local_clarify', { reason: reason || 'nonsense' });
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

  function renderPlanCard(plan, opts) {
    opts = opts || {};
    var mount = $('chat-plan-mount');
    if (!mount || !plan) return;
    var keepOpen = false;
    var keepSoft = false;
    if (opts.silent) {
      var prevDetails = mount.querySelector('.chat-plan-prompt');
      keepOpen = !!(prevDetails && prevDetails.open);
      var prevSoft = mount.querySelector('[data-soft-credits]');
      keepSoft = !!(prevSoft && !prevSoft.hidden);
    }
    mount.innerHTML = '';
    lastPlan = plan;
    var textModel = opts.textModel || lastTextModel || FLASH_MODEL;
    var credits = estimateCredits(plan);
    var have = deps.getCredits ? deps.getCredits() : null;
    // Video estimate vs balance is not a free-chat warning. glm-4.7-flash is $0.
    var insuff = planCardShowsVideoCreditSoft(textModel) &&
      typeof credits === 'number' && typeof have === 'number' && credits > have;

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
    // Example chips already have a finished prompt; show it immediately.
    if (opts.openPrompt) details.open = true;
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
      // Hide the card so chat can continue without a stuck plan under the thread.
      clearPlanMount();
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
      if (!opts.silent) {
        track('credits_insufficient_soft', {
          need: credits,
          have: have,
          model: plan.model,
          duration: plan.duration,
          resolution: plan.resolution
        });
      }
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
    if (opts.silent) {
      if (keepOpen) details.open = true;
      if (keepSoft) {
        var softEl = card.querySelector('[data-soft-credits]');
        if (softEl) softEl.hidden = false;
      }
      return;
    }
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
      var blurb = lookupString('chat_example_' + id + '_blurb') || t('example_' + id + '_blurb');
      if (blurb && blurb.indexOf('example_') !== 0 && blurb.indexOf('chat_example_') !== 0) {
        b.appendChild(el('span', 'chat-example-blurb', blurb));
      }
      // No title / aria-label hover. The label is already on the chip; the prompt opens on click.
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
      if (busy) status.setAttribute('data-i18n', 'chat_thinking');
      else status.removeAttribute('data-i18n');
      status.hidden = !busy;
    }
  }

  function ensureSession() {
    if (sessionStarted) return;
    sessionStarted = true;
    track('chat_session_start', {});
  }

  function requireLoginForChat(source) {
    if (deps.isLoggedIn && deps.isLoggedIn()) return true;
    appendBubble('assistant', t('chat_need_login'));
    track('chat_need_login_show', { source: source || 'send' });
    // Tip first; open login shortly after so the reminder is visible (not an instant full-page jump).
    if (deps.onNeedLogin) deps.onNeedLogin(source || 'send');
    else if (deps.promptLogin) {
      setTimeout(function () { deps.promptLogin(); }, 700);
    }
    return false;
  }

  /**
   * Finished shot prompt for a chip. Null when this id has no local prompt.
   * Clicking a chip must not wait on the model: it was answering "need more detail".
   */
  function examplePlan(id) {
    var prompt = planPromptForExample(id);
    if (!prompt || prompt.length < 80) return null;
    var label = t('example_' + id + '_label');
    var title = (label && label.indexOf('example_') !== 0) ? label : t('chat_plan_title_fallback');
    var blurb = lookupString('chat_example_' + id + '_blurb');
    return clampPlan({
      title: title,
      summary: blurb,
      prompt: prompt,
      model: CHEAP_DEFAULT.model,
      duration: CHEAP_DEFAULT.duration,
      resolution: CHEAP_DEFAULT.resolution,
      ratio: CHEAP_DEFAULT.ratio
    });
  }

  function onExample(id) {
    if (busy) return;
    // A local plan skips Flash, but it is still a chat turn. Gate it like Send
    // before any user bubble, ready reply, plan card, or model call.
    if (!requireLoginForChat('example')) return;
    ensureSession();
    track('chat_example_click', { example_id: id });
    // The chip speaks a short scene. The reply is the finished prompt, not a question.
    var userVisible = lookupString('chat_example_' + id + '_blurb') ||
      t('chat_example_user', t('example_' + id + '_label'));
    var prompt = planPromptForExample(id) || t('example_' + id + '_prompt');
    var apiUser = userVisible + '\n\n[example_id=' + id + ']\n' + t('chat_example_ref_prefix') + '\n' + prompt;
    var userBubble = appendBubble('user', userVisible);
    if (userBubble && userBubble.bubble) {
      userBubble.bubble.setAttribute('data-i18n', 'chat_example_' + id + '_blurb');
      userBubble.bubble.setAttribute('data-example-id', id);
    }
    hideExamples();
    messages.push({ role: 'user', content: apiUser });
    var plan = examplePlan(id);
    if (!plan) {
      runFlash();
      return;
    }
    plan.exampleId = id;
    var spoken = t('chat_example_ready');
    var readyBubble = appendBubble('assistant', spoken);
    if (readyBubble && readyBubble.bubble) readyBubble.bubble.setAttribute('data-i18n', 'chat_example_ready');
    messages.push({
      role: 'assistant',
      content: JSON.stringify({
        assistant_message: spoken,
        ready: true,
        plan: {
          title: plan.title,
          prompt: plan.prompt,
          model: plan.model,
          duration: plan.duration,
          resolution: plan.resolution,
          ratio: plan.ratio,
          summary: plan.summary
        }
      })
    });
    lastTextModel = FLASH_MODEL;
    renderPlanCard(plan, { textModel: FLASH_MODEL, openPrompt: true });
    track('chat_example_ready', { example_id: id });
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

  var SHOT_LABELS = [
    '主体', '场景', '动作与运动', '镜头', '风格与限制',
    'Subject', 'Scene', 'Action and motion', 'Camera', 'Style and constraints',
    'Sujeto', 'Escena', 'Acción y movimiento', 'Cámara', 'Estilo y límites',
    'Sujeito', 'Cena', 'Ação e movimento', 'Câmera', 'Estilo e limites',
    '場面', '動作', 'カメラ', 'スタイルと制約',
    '주체', '장면', '동작', '카메라', '스타일과 제한'
  ];

  function lookupString(key) {
    var s = t(key);
    if (!s || s === key) return '';
    return String(s).trim();
  }

  /** A real shot prompt names several sections. A one-line request does not. */
  function hasShotStructure(prompt) {
    var s = String(prompt || '');
    var n = 0;
    for (var i = 0; i < SHOT_LABELS.length; i++) {
      if (s.indexOf(SHOT_LABELS[i]) >= 0) n++;
    }
    return n >= 3;
  }

  /** Generate-tab locker script is 16s / high-res. Chat plans stay on the cheap tier. */
  function presetNeedsCheapRewrite(text) {
    var s = String(text || '');
    return /\b16\s*(?:s\b|sec|seconds)|1080|4k|10-second|approximately 16/i.test(s) ||
      /16\s*秒|10秒|1080/.test(s);
  }

  /**
   * Plan-card text for a chip. Prefer a chat-specific shot prompt (5s locker beat).
   * Otherwise use the shared preset when it is already a cheap-tier shot.
   */
  function planPromptForExample(exId) {
    var dedicated = lookupString('chat_example_' + exId + '_prompt');
    if (dedicated.length >= 80) return dedicated;
    var preset = lookupString('example_' + exId + '_prompt');
    if (preset.length >= 80 && !presetNeedsCheapRewrite(preset)) return preset;
    return '';
  }

  /** True when plan.prompt is too short, instructional, or mostly the user sentence. */
  function isWeakOrEchoPrompt(prompt, userRaw) {
    var p = String(prompt || '').trim();
    if (p.length < 80) return true;
    if (/按意图写出|name a concrete subject|Shootable video prompt expanded from the user request|根据用户意图展开的可拍提示词/i.test(p)) {
      return true;
    }
    var u = visibleUserRequest(userRaw);
    if (!u || u.length < 8) return false;
    var pn = normalizePromptCompare(p);
    var un = normalizePromptCompare(u);
    if (!pn || !un) return false;
    if (pn === un) return true;
    if (un.length >= 16 && (pn.indexOf(un) >= 0 || un.indexOf(pn) >= 0)) {
      // A full shot prompt may quote the request. Near-copies may not.
      if (p.length >= Math.max(180, u.length * 2) && hasShotStructure(p)) return false;
      return true;
    }
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

  function expandFreeformPrompt(request) {
    var lang = (deps && deps.getLang && deps.getLang()) || 'zh';
    var intent = String(request || '').trim().slice(0, 500);
    if (lang === 'zh') {
      return [
        '主体：' + intent,
        '场景：沿用这句话里的地点、时间和道具。没写到的部分用真实的日间空间补上，前景清楚，背景轻虚。不要改成别的故事。',
        '动作与运动：一个大约 5 秒能做完的动作，起势清楚，中段有一次看得见的变化，结尾停在稳定姿态。',
        '镜头：平视，竖屏，中景缓推到近景，轻微手持，只有这一段运镜。',
        '风格与限制：自然光，真实材质，浅景深，写实，动作符合重力。只有环境声；若原话里有对白，只留一句并对口型。无字幕，无水印，无 Logo。'
      ].join('\n');
    }
    if (lang === 'es') {
      return [
        'Sujeto: ' + intent,
        'Escena: conserva el lugar, la hora y los objetos de esa frase. Lo que falte es un espacio real de día, frente nítido y fondo suave. No cambies la historia.',
        'Acción y movimiento: una sola acción de unos 5 segundos, con arranque claro, un cambio visible y una pose final quieta.',
        'Cámara: a la altura de los ojos, vertical, de plano medio a primer plano, leve cámara en mano, un solo movimiento.',
        'Estilo y límites: luz natural, textura real, poca profundidad de campo, imagen realista, peso creíble. Solo ambiente; si hay diálogo, una frase con sincronía labial. Sin texto en pantalla, marca de agua ni logo.'
      ].join('\n');
    }
    if (lang === 'pt') {
      return [
        'Sujeito: ' + intent,
        'Cena: mantenha o lugar, a hora e os objetos dessa frase. O que faltar fica num espaço real de dia, frente nítida e fundo suave. Não mude a história.',
        'Ação e movimento: uma só ação de cerca de 5 segundos, com começo claro, uma mudança visível e uma pose final estável.',
        'Câmera: na altura dos olhos, vertical, do plano médio ao close, leve câmera na mão, um só movimento.',
        'Estilo e limites: luz natural, textura real, pouca profundidade de campo, imagem realista, peso crível. Só ambiente; se houver fala, uma frase com sincronia labial. Sem texto na tela, marca d\'água ou logo.'
      ].join('\n');
    }
    if (lang === 'ja') {
      return [
        '主体：' + intent,
        '場面：その文にある場所、時間、小道具を使う。足りない部分は昼の実在する空間で補い、手前ははっきり、奥は少しぼかす。話を別のものに変えない。',
        '動作：約5秒で終わる一つの動作。入りが明確で、途中に見える変化が一つあり、最後は止まった姿勢。',
        'カメラ：目の高さ、縦画面、ミディアムからクローズへ、軽い手持ち、動きはこの一つだけ。',
        'スタイルと制約：自然光、実在する質感、浅い被写界深度、実写、重力に合う動き。環境音のみ。セリフがあるなら一句だけ口パク。画面内の文字、透かし、ロゴなし。'
      ].join('\n');
    }
    if (lang === 'ko') {
      return [
        '주체: ' + intent,
        '장면: 그 문장의 장소, 시간, 소품을 유지한다. 빠진 부분은 낮의 실제 공간으로 채우고, 앞은 선명하게, 뒤는 살짝 흐리게. 이야기를 바꾸지 않는다.',
        '동작: 약 5초 안에 끝나는 동작 하나. 시작이 분명하고, 중간에 보이는 변화가 한 번 있으며, 끝은 멈춘 자세.',
        '카메라: 눈높이, 세로 화면, 미디엄에서 클로즈업으로, 가벼운 핸드헬드, 움직임은 이것뿐.',
        '스타일과 제한: 자연광, 실제 재질, 얕은 심도, 실사, 중력에 맞는 움직임. 환경음만. 대사가 있으면 한 문장만 립싱크. 화면 글자, 워터마크, 로고 없음.'
      ].join('\n');
    }
    return [
      'Subject: ' + intent,
      'Scene: keep the place, time, and props in that line. Fill anything missing with a real daytime space, sharp foreground, soft background. Do not switch the story.',
      'Action and motion: one action that finishes in about 5 seconds, with a clear start, one visible change, and a held ending pose.',
      'Camera: eye level, vertical frame, medium shot easing into a close-up, slight handheld, only that move.',
      'Style and constraints: natural light, real texture, shallow depth of field, photoreal, believable weight. Ambience only; if the line includes speech, keep one lip-synced line. No on-screen text, watermark, or logo.'
    ].join('\n');
  }

  /**
   * Offline / repair path: a real shot prompt, never the user sentence alone.
   * Chips use the chat shot prompt (or a cheap-tier preset). Free text is expanded in place.
   */
  function expandDraftPrompt(raw) {
    raw = String(raw || '').trim();
    if (!raw) return '';
    var exId = extractExampleId(raw);
    if (exId && EXAMPLE_IDS.indexOf(exId) >= 0) {
      var preset = planPromptForExample(exId);
      if (preset) return preset.slice(0, 2200);
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
    retry.setAttribute('data-i18n', 'chat_retry');
    retry.addEventListener('click', function () {
      track('chat_flash_retry_click', { busy: !!busyCap });
      if (busy) return;
      notifyChatAnalyticsSubmit(FLASH_MODEL);
      runFlash();
    });
    actions.appendChild(retry);

    var draft = draftPlanFromUser();
    if (draft) {
      var draftBtn = el('button', 'btn', t('chat_use_draft'));
      draftBtn.type = 'button';
      draftBtn.setAttribute('data-i18n', 'chat_use_draft');
      draftBtn.addEventListener('click', function () {
        track('chat_fallback_draft', { busy: !!busyCap });
        appendBubble('assistant', t('chat_draft_ready'));
        // Local draft did not call a paid text model. Do not borrow a video estimate as a credit warning.
        renderPlanCard(draft, { textModel: FLASH_MODEL });
      });
      actions.appendChild(draftBtn);
      // Soft path: for capacity blips, also keep refining without jumping to Generate.
      if (busyCap) {
        var keep = el('button', 'btn', t('chat_keep_refining'));
        keep.type = 'button';
        keep.setAttribute('data-i18n', 'chat_keep_refining');
        keep.addEventListener('click', function () {
          track('chat_keep_refining', { from: 'flash_busy' });
          clearPlanMount();
          focusComposer();
        });
        actions.appendChild(keep);
      }
    }

    // Classic Generate stays available but secondary — never the forced next step.
    var btn = el('button', 'btn', t('chat_goto_classic'));
    btn.type = 'button';
    btn.setAttribute('data-i18n', 'chat_goto_classic');
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
        notifyChatAnalyticsFinish(false, res.kind || 'UNKNOWN', res.model || FLASH_MODEL);
        showError(res.detail || res.kind, { http: res.http, kind: res.kind, model: res.model });
        return;
      }
      var parsed = demoteReadyIfNeeded(parseAssistantPayload(res.content), lastUserText());
      // Keep multi-turn: store the turn the UI actually showed (may be demoted).
      var stored = parsed.demoted
        ? JSON.stringify({
            assistant_message: parsed.assistant_message,
            ready: false,
            plan: null
          })
        : res.content;
      messages.push({ role: 'assistant', content: stored });
      if (streamUi) {
        streamUi.finalize(parsed.assistant_message);
      } else {
        appendBubble('assistant', parsed.assistant_message);
      }
      if (parsed.ready && parsed.plan) {
        parsed.plan = ensureShootablePlan(parsed.plan, lastUserText());
        lastTextModel = res.model || FLASH_MODEL;
        renderPlanCard(parsed.plan, { textModel: lastTextModel });
      }
      track('chat_flash_ok', {
        model: res.model || '',
        streamed: res.streamed !== false,
        recovered: !!res.recovered_from_stream,
        ready: !!parsed.ready,
        demoted: parsed.demoted || ''
      });
      notifyChatAnalyticsFinish(true, '', res.model || FLASH_MODEL);
    }, function (err) {
      setBusy(false);
      if (streamUi) streamUi.discard();
      track('chat_flash_fail', { kind: 'throw' });
      notifyChatAnalyticsFinish(false, 'UNKNOWN', FLASH_MODEL);
      showError(String(err && err.message || err));
    });
  }


  function mintChatId() {
    try {
      if (root.crypto && crypto.getRandomValues) {
        var buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        var i, out = '';
        for (i = 0; i < buf.length; i++) out += (buf[i] + 256).toString(16).slice(1);
        return out;
      }
    } catch (e) { /* fall through */ }
    return 'c' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
  }

  function notifyChatAnalyticsSubmit(model) {
    currentChatId = mintChatId();
    try {
      if (root.VSAnalytics && typeof root.VSAnalytics.notifyChatSubmit === 'function') {
        root.VSAnalytics.notifyChatSubmit(currentChatId, { model: model || '' });
      }
    } catch (e) { /* never break chat */ }
    return currentChatId;
  }

  function notifyChatAnalyticsFinish(ok, errorCode, model) {
    var id = currentChatId;
    if (!id) return;
    try {
      if (root.VSAnalytics && typeof root.VSAnalytics.notifyChatFinish === 'function') {
        root.VSAnalytics.notifyChatFinish(id, ok, { model: model || '', errorCode: errorCode });
      }
    } catch (e) { /* never break chat */ }
  }

  function onSend() {
    if (busy) return;
    var input = $('chat-input');
    if (!input) return;
    var text = String(input.value || '').trim();
    if (!text) return;
    if (!requireLoginForChat('send')) return;
    ensureSession();
    var bucket = text.length < 40 ? 'short' : (text.length < 120 ? 'mid' : 'long');
    track('chat_user_message', { len_bucket: bucket });
    input.value = '';
    appendBubble('user', text);
    hideExamples();
    messages.push({ role: 'user', content: text });
    // Continuing the thread: drop any prior plan card (example or earlier draft).
    clearPlanMount();
    // User clicked Send with a non-empty message after the login gate.
    // Local clarify is still a submit, but it is not a server-reply success.
    notifyChatAnalyticsSubmit(FLASH_MODEL);
    if (isNonsensicalUserText(text)) {
      replyLocalClarify('nonsense');
      return;
    }
    runFlash();
  }

  function resetConversation() {
    messages = [];
    lastPlan = null;
    lastTextModel = FLASH_MODEL;
    sessionStarted = false;
    busy = false;
    var thread = $('chat-thread');
    if (thread) thread.innerHTML = '';
    clearPlanMount();
    var ex = $('chat-examples');
    if (ex) ex.hidden = false;
    var greet = appendBubble('assistant', t('chat_greeting'));
    if (greet && greet.bubble) greet.bubble.setAttribute('data-i18n', 'chat_greeting');
    renderExamples();
    var status = $('chat-status');
    if (status) { status.hidden = true; status.textContent = ''; status.removeAttribute('data-i18n'); }
  }

  function eachEl(node, fn) {
    if (!node || node.nodeType === 3) return;
    fn(node);
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) eachEl(kids[i], fn);
  }

  /** Which preset a shot prompt belongs to, in any UI language. Empty when the text was rewritten. */
  function localeForExamplePrompt(text) {
    var raw = String(text || '').trim();
    var I = root.VSI18n;
    if (!raw || !I || !I.languages || !I.t) return '';
    var codes = I.languages();
    for (var i = 0; i < EXAMPLE_IDS.length; i++) {
      var id = EXAMPLE_IDS[i];
      for (var c = 0; c < codes.length; c++) {
        var keys = ['chat_example_' + id + '_prompt', 'example_' + id + '_prompt'];
        for (var k = 0; k < keys.length; k++) {
          var s = I.t(codes[c], keys[k]);
          if (s && s !== keys[k] && String(s).trim() === raw) return id;
        }
      }
    }
    return '';
  }

  function exampleBundle(id) {
    var label = t('example_' + id + '_label');
    if (!label || label.indexOf('example_') === 0) label = t('chat_plan_title_fallback');
    var blurb = lookupString('chat_example_' + id + '_blurb') || lookupString('example_' + id + '_blurb');
    var prompt = planPromptForExample(id) || lookupString('example_' + id + '_prompt');
    return { label: label, blurb: blurb || '', prompt: prompt || '', ready: t('chat_example_ready') };
  }

  /** Example click copies title/blurb/prompt at that moment. setLang must swap them to the new language. */
  function applyLocaleToExamplePlan(plan) {
    if (!plan || !plan.prompt) return plan;
    var id = localeForExamplePrompt(plan.prompt);
    if (!id) return plan;
    var bundle = exampleBundle(id);
    if (bundle.label) plan.title = String(bundle.label).slice(0, 80);
    if (bundle.blurb) plan.summary = String(bundle.blurb).slice(0, 160);
    if (bundle.prompt) plan.prompt = bundle.prompt;
    plan.exampleId = id;
    return plan;
  }

  function relocalizeMarked(node) {
    eachEl(node, function (n) {
      if (!n.getAttribute) return;
      var key = n.getAttribute('data-i18n');
      if (!key) return;
      if (key.indexOf('chat_example_') !== 0 && key.indexOf('example_') !== 0) return;
      var val = t(key);
      if (val && val !== key) n.textContent = val;
    });
  }

  function relocalizeExampleMessages() {
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (!m) continue;
      if (m.role === 'user') {
        var ex = extractExampleId(m.content);
        if (!ex || EXAMPLE_IDS.indexOf(ex) < 0) continue;
        var bundle = exampleBundle(ex);
        if (!bundle.prompt) continue;
        m.content = bundle.blurb + '\n\n[example_id=' + ex + ']\n' + t('chat_example_ref_prefix') + '\n' + bundle.prompt;
        continue;
      }
      if (m.role !== 'assistant') continue;
      var parsed = null;
      try { parsed = JSON.parse(m.content); } catch (eMsg) { parsed = null; }
      if (!parsed || !parsed.plan || !parsed.plan.prompt) continue;
      var id = localeForExamplePrompt(parsed.plan.prompt);
      if (!id) continue;
      var next = exampleBundle(id);
      parsed.assistant_message = next.ready;
      parsed.plan.title = next.label;
      parsed.plan.summary = next.blurb;
      parsed.plan.prompt = next.prompt;
      m.content = JSON.stringify(parsed);
    }
  }

  function refreshUi() {
    applyChrome();
    if (isEnabled()) renderExamples();
    // Chip click freezes title, blurb, and shot prompt. Chrome [data-i18n] updates
    // on setLang; these copies do not, so a Chinese boot stays Chinese after a switch.
    relocalizeMarked($('chat-thread'));
    relocalizeExampleMessages();
    if (lastPlan && deps && deps.t) {
      applyLocaleToExamplePlan(lastPlan);
      renderPlanCard(lastPlan, { silent: true });
    }
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
    textModelIsFree: textModelIsFree,
    planCardShowsVideoCreditSoft: planCardShowsVideoCreditSoft,
    renderPlanCard: renderPlanCard,
    presentExample: onExample,
    resetConversation: resetConversation
  };
})(window);

