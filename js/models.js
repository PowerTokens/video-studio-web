/*
 * Video model registry, limits, prices and request builders.
 * Ported from the desktop app (models.py on feat/multi-model, v1.12).
 * Prices are current PowerTokens without-video rates checked on PRICE_CHECKED_DATE (USD per second).
 * A promo also stores the struck-through per-second rate and the unrounded Price (USD) per 1M tokens.
 * discountPercent() is computed from that token pair (the ≈ per-second column is rounded).
 */
(function (root) {
  'use strict';

  var API_BASE = 'https://api.powertokens.ai';
  // In-tool links use source=videostudio + medium=web (desktop app: videostudio/app; GitHub README/docs: github/oss).
  var UTM = 'utm_source=videostudio&utm_medium=web&utm_campaign=video-studio';
  var PRICE_CHECKED_DATE = '2026-10-21';

  function range(lo, hi) {
    var out = [];
    for (var i = lo; i <= hi; i++) out.push(i);
    return out;
  }

  function links(docsPath, modelId) {
    return {
      docs_url: 'https://docs.powertokens.ai/en/zmodelVideo/' + docsPath + '?' + UTM,
      docs_url_zh: 'https://docs.powertokens.ai/zh-Hans/zmodelVideo/' + docsPath + '?' + UTM,
      model_page_url: 'https://powertokens.ai/models/' + modelId + '?' + UTM,
      model_page_url_zh: 'https://powertokens.ai/zh-Hans/models/' + modelId + '?' + UTM
    };
  }

  function spec(o) {
    var base = {
      default_duration: 5,
      default_resolution: '720p',
      default_ratio: '16:9',
      supports_seed: true,
      generate_audio_default: true,
      kling_mode_map: {},
      submit_path: '/v1/videos',
      poll_kind: 'unified'
    };
    for (var k in o) base[k] = o[k];
    var l = links(o._docs, o.id);
    for (var j in l) base[j] = l[j];
    delete base._docs;
    return Object.freeze(base);
  }

  var WAN_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', 'adaptive'];
  var SEEDANCE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'];

  var MODELS = {
    'wan3.0-video': spec({
      id: 'wan3.0-video',
      display_name: 'Wan 3.0',
      display_name_zh: 'Wan 3.0',
      short_name: 'wan',
      description_en: 'All-in-one Wan model for text-to-video, image-to-video (first / first-last frame), and reference-to-video with native audio. Up to 30 seconds at 480p–1080p — a solid default for product demos, talking-head clips, and everyday videos.',
      description_zh: '全能型 Wan 模型：文生视频、图生视频（首帧 / 首尾帧）与参考生视频，带原生音频。最长 30 秒，支持 480p–1080p，适合产品展示、口播与日常成片，作为默认选项。',
      family: 'wan',
      durations: range(2, 30),
      resolutions: ['480p', '720p', '1080p'],
      ratios: WAN_RATIOS,
      list_price_usd_per_second: { '480p': 0.05, '720p': 0.10, '1080p': 0.20 },
      _docs: 'ali/wan3.0-video-generation'
    }),
    'wan3.0-video-prime': spec({
      id: 'wan3.0-video-prime',
      display_name: 'Wan 3.0 Prime',
      display_name_zh: 'Wan 3.0 Prime',
      short_name: 'wan-prime',
      description_en: 'Same capabilities as Wan 3.0 (text / image / reference, up to 30s, 480p–1080p, native audio), tuned for significantly faster end-to-end generation when you want quicker turnaround.',
      description_zh: '能力与 Wan 3.0 相同（文生 / 图生 / 参考、最长 30 秒、480p–1080p、原生音频），端到端生成明显更快，适合更赶时间的出片。',
      family: 'wan',
      durations: range(2, 30),
      resolutions: ['480p', '720p', '1080p'],
      ratios: WAN_RATIOS,
      list_price_usd_per_second: { '480p': 0.068, '720p': 0.14, '1080p': 0.28 },
      _docs: 'ali/wan3.0-video-generation'
    }),
    'dreamina-seedance-2-0-260128': spec({
      id: 'dreamina-seedance-2-0-260128',
      display_name: 'Seedance 2.0',
      display_name_zh: 'Seedance 2.0',
      short_name: 'seedance-20',
      description_en: 'Seedance 2.0 is the full-quality model for text-to-video, image-to-video, and multimodal reference, with native audio. Clips are 4–15 seconds at 480p, 720p, 1080p, or 4K.',
      description_zh: 'Seedance 2.0 为完整画质版本：支持文生、图生与多模态参考，带原生音频。时长 4–15 秒，支持 480p、720p、1080p 与 4K。',
      family: 'seedance',
      durations: range(4, 15),
      resolutions: ['480p', '720p', '1080p', '4k'],
      ratios: SEEDANCE_RATIOS,
      list_price_usd_per_second: { '480p': 0.069, '720p': 0.152, '1080p': 0.375, '4k': 0.778 },
      _docs: 'byteplus/dreamina-seedance-2-0-text-to-video'
    }),
    'dreamina-seedance-2-0-fast-260128': spec({
      id: 'dreamina-seedance-2-0-fast-260128',
      display_name: 'Seedance 2.0 Fast',
      display_name_zh: 'Seedance 2.0 Fast',
      short_name: 'seedance-fast',
      description_en: 'Seedance 2.0 Fast prioritizes speed for drafts and previews: text-to-video, image-to-video, and multimodal reference, with native audio. Clips are 4–15 seconds and top out at 720p (no 1080p).',
      description_zh: 'Seedance 2.0 Fast 侧重速度，适合草稿与预览：支持文生、图生与多模态参考，带原生音频。时长 4–15 秒，最高 720p（不支持 1080p）。',
      family: 'seedance',
      durations: range(4, 15),
      resolutions: ['480p', '720p'],
      ratios: SEEDANCE_RATIOS,
      list_price_usd_per_second: { '480p': 0.061, '720p': 0.061 },
      list_price_before_discount_usd_per_second: { '480p': 0.121, '720p': 0.121 },
      price_usd_per_million_tokens: 2.8,
      list_price_before_discount_usd_per_million_tokens: 5.6,
      _docs: 'byteplus/dreamina-seedance-2-0-fast-text-to-video'
    }),
    'dreamina-seedance-2-0-mini-260615': spec({
      id: 'dreamina-seedance-2-0-mini-260615',
      display_name: 'Seedance 2.0 Mini',
      display_name_zh: 'Seedance 2.0 Mini',
      short_name: 'seedance-20-mini',
      description_en: 'Seedance 2.0 Mini prioritizes lower cost and faster turnaround for high-volume clips: text-to-video, image-to-video, and multimodal reference, with native audio. Clips are 4–15 seconds and top out at 720p (no 1080p).',
      description_zh: 'Seedance 2.0 Mini 侧重更低成本与更快出片，适合大批量内容：支持文生、图生与多模态参考，带原生音频。时长 4–15 秒，最高 720p（不支持 1080p）。',
      family: 'seedance',
      durations: range(4, 15),
      resolutions: ['480p', '720p'],
      ratios: SEEDANCE_RATIOS,
      list_price_usd_per_second: { '480p': 0.031, '720p': 0.031 },
      list_price_before_discount_usd_per_second: { '480p': 0.076, '720p': 0.076 },
      price_usd_per_million_tokens: 1.4,
      list_price_before_discount_usd_per_million_tokens: 3.5,
      _docs: 'byteplus/dreamina-seedance-2-0-mini-text-to-video'
    }),
    'dreamina-seedance-2-5-260628': spec({
      id: 'dreamina-seedance-2-5-260628',
      display_name: 'Seedance 2.5',
      display_name_zh: 'Seedance 2.5',
      short_name: 'seedance-25',
      description_en: 'Seedance 2.5 targets longer storytelling with native audio sync, up to 30 seconds and 480p–1080p. Supports text-to-video, image-to-video, and multimodal references for scene and character consistency.',
      description_zh: 'Seedance 2.5 面向更长叙事与原生音频同步，最长 30 秒，支持 480p–1080p。文生、图生与多模态参考可用于保持场景与角色一致性。',
      family: 'seedance',
      durations: range(4, 30),
      resolutions: ['480p', '720p', '1080p'],
      ratios: SEEDANCE_RATIOS,
      list_price_usd_per_second: { '480p': 0.105, '720p': 0.232, '1080p': 0.569 },
      _docs: 'byteplus/dreamina-seedance-2-5-text-to-video'
    }),
    'MiniMax-H3': spec({
      id: 'MiniMax-H3',
      display_name: 'MiniMax H3',
      display_name_zh: 'MiniMax H3',
      short_name: 'minimax-h3',
      description_en: 'MiniMax H3 generates 4–15 second clips at 768p or 2K with text-to-video (Studio). Multimodal reference and image conditioning are available on the API; this build focuses on text-to-video.',
      description_zh: 'MiniMax H3 支持 4–15 秒、768p 或 2K 的文生视频（Studio 当前）。API 另有图生与多模态参考；本版优先文生。',
      family: 'h3',
      durations: range(4, 15),
      resolutions: ['768p', '2k'],
      ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      list_price_usd_per_second: { '768p': 0.08, '2k': 0.13 },
      default_resolution: '768p',
      submit_path: '/minimax/v2/video_generation',
      poll_kind: 'h3',
      _docs: 'minimax/minimax-h3/text-to-video'
    }),
    'MiniMax-Hailuo-2.3': spec({
      id: 'MiniMax-Hailuo-2.3',
      display_name: 'Hailuo 2.3',
      display_name_zh: 'Hailuo 2.3',
      short_name: 'hailuo-23',
      description_en: 'Hailuo 2.3 text-to-video at 768p or 1080p with fixed 6 or 10 second clips (1080p is 6 seconds only). Priced per clip on PowerTokens.',
      description_zh: 'Hailuo 2.3 文生视频，支持 768p / 1080p，时长固定 6 或 10 秒（1080p 仅 6 秒）。PowerTokens 按条计费。',
      family: 'hailuo',
      durations: [6, 10],
      resolutions: ['768p', '1080p'],
      ratios: ['16:9'],
      list_price_usd_per_second: { '768p': 0.044, '1080p': 0.078 },
      // Flat per-clip prices (model page 2026-10-21); estimateCost uses these.
      flat_price_usd: { '768p|6': 0.266, '768p|10': 0.532, '1080p|6': 0.466 },
      default_duration: 6,
      default_resolution: '768p',
      supports_seed: false,
      _docs: 'minimax/minimax-hailuo-2.3-text-to-video'
    }),
    'viduq4-preview': spec({
      id: 'viduq4-preview',
      display_name: 'Vidu Q4 Preview',
      display_name_zh: 'Vidu Q4 Preview',
      short_name: 'viduq4',
      description_en: 'Vidu Q4 Preview (I2V / reference-to-video only — no text-only). Clips 3–16 seconds at 540p–4K with optional native audio. Attach a first frame or reference images to generate.',
      description_zh: 'Vidu Q4 Preview（仅图生 / 参考生，不支持纯文生）。时长 3–16 秒，540p–4K，可选原生音频。请上传首帧或参考图后再生成。',
      family: 'vidu',
      durations: range(3, 16),
      resolutions: ['540p', '720p', '1080p', '2k', '4k'],
      ratios: ['16:9', '9:16', '1:1', '3:4', '4:3'],
      list_price_usd_per_second: { '540p': 0.045, '720p': 0.095, '1080p': 0.120, '2k': 0.190, '4k': 0.390 },
      default_duration: 5,
      default_resolution: '720p',
      submit_path: '/vidu/ent/v2/img2video',
      poll_kind: 'vidu',
      _docs: 'vidu/viduq4-preview-image-to-video'
    }),
    'kling-v3': spec({
      id: 'kling-v3',
      display_name: 'kling v3',
      display_name_zh: 'kling v3',
      short_name: 'kling-v3',
      description_en: 'kling v3 offers text-to-video and image-to-video (first / last frame) with optional native audio. Duration 3–15 seconds; choose 720p, 1080p, or 4K mode when you need higher output resolution.',
      description_zh: 'kling v3 支持文生视频与图生视频（首帧 / 尾帧），可选原生音频。时长 3–15 秒；可选 720p、1080p 或 4K 模式，需要更高输出分辨率时选用。',
      family: 'kling',
      durations: range(3, 15),
      resolutions: ['720p', '1080p', '4k'],
      ratios: ['16:9', '9:16', '1:1'],
      list_price_usd_per_second: { '720p': 0.126, '1080p': 0.168, '4k': 0.42 },
      supports_seed: false,
      kling_mode_map: { '720p': 'std', '1080p': 'pro', '4k': '4k' },
      submit_path: '/kling/v1/videos/text2video',
      poll_kind: 'kling_t2v',
      _docs: 'kling/kling-v3-text2video'
    })
  };

  var DEFAULT_MODEL_ID = 'wan3.0-video';
  var MODEL_ORDER = [
    'wan3.0-video',
    'wan3.0-video-prime',
    'dreamina-seedance-2-0-260128',
    'dreamina-seedance-2-0-fast-260128',
    'dreamina-seedance-2-0-mini-260615',
    'dreamina-seedance-2-5-260628',
    'MiniMax-H3',
    'MiniMax-Hailuo-2.3',
    'viduq4-preview',
    'kling-v3'
  ];

  var RES_RANK = { '480p': 480, '540p': 540, '720p': 720, '768p': 768, '1080p': 1080, '2k': 1440, '4k': 2160 };
  var RATIO_ASPECT = {
    '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '21:9': 21 / 9, 'adaptive': null
  };

  function getModel(id) {
    var m = MODELS[id || DEFAULT_MODEL_ID];
    if (!m) throw new Error('unknown model: ' + id);
    return m;
  }

  function percentFromPair(now, before) {
    if (typeof now !== 'number' || typeof before !== 'number') return 0;
    if (!(before > now) || !(now > 0)) return 0;
    return Math.round((1 - now / before) * 100);
  }

  /** Integer percent off, from the unrounded token price when present, else from per-second rates. 0 means no promo. */
  function discountPercent(m) {
    if (!m) return 0;
    var fromTokens = percentFromPair(m.price_usd_per_million_tokens, m.list_price_before_discount_usd_per_million_tokens);
    if (fromTokens) return fromTokens;
    var beforeMap = m.list_price_before_discount_usd_per_second;
    if (!beforeMap) return 0;
    var best = 0;
    Object.keys(m.list_price_usd_per_second).forEach(function (k) {
      var pct = percentFromPair(m.list_price_usd_per_second[k], beforeMap[k]);
      if (pct > best) best = pct;
    });
    return best;
  }

  function listModels() {
    var all = MODEL_ORDER.map(function (id) { return MODELS[id]; });
    var promo = [];
    var rest = [];
    all.forEach(function (m) { (discountPercent(m) > 0 ? promo : rest).push(m); });
    return promo.concat(rest);
  }

  function label(m, lang) { return lang === 'zh' ? m.display_name_zh : m.display_name; }
  function description(m, lang) { return lang === 'zh' ? m.description_zh : m.description_en; }

  function summary(m, lang) {
    var text = description(m, lang);
    if (lang === 'zh') {
      var part = text.split('。')[0];
      return part ? part + '。' : text;
    }
    var seps = ['. ', ' — ', ' - '];
    for (var i = 0; i < seps.length; i++) {
      if (text.indexOf(seps[i]) >= 0) return text.split(seps[i])[0].replace(/\.+$/, '') + '.';
    }
    return text;
  }

  function priceSource(m, lang) { return lang === 'zh' ? m.model_page_url_zh : m.model_page_url; }
  function docsUrl(m, lang) { return lang === 'zh' ? m.docs_url_zh : m.docs_url; }

  // ---- parameter snapping (same rules as models.snap_params) ----
  function toInt(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
    var s = String(v == null ? '' : v).trim();
    return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
  }

  function normalizeResolution(v) {
    v = String(v == null ? '' : v).trim().toLowerCase().replace(/ /g, '');
    if (v === '720' || v === '1080' || v === '480' || v === '540' || v === '768') v += 'p';
    if (v === '2160p' || v === '2160') v = '4k';
    if (v === '1440p' || v === '1440') v = '2k';
    return v;
  }

  function normalizeRatio(v, dflt) {
    v = String(v == null ? '' : v).replace(/：/g, ':').replace(/ /g, '').trim();
    return v || (dflt === undefined ? '16:9' : dflt);
  }

  function nearestDuration(m, d) {
    var n = toInt(d);
    if (n === null) return m.default_duration;
    if (m.durations.indexOf(n) >= 0) return n;
    var best = null, bestDiff = Infinity;
    m.durations.forEach(function (item) {
      var diff = Math.abs(item - n);
      if (diff < bestDiff || (diff === bestDiff && item < best)) { best = item; bestDiff = diff; }
    });
    return best;
  }

  function minBy(list, fn) {
    var best = list[0], bestVal = fn(list[0]);
    for (var i = 1; i < list.length; i++) {
      var v = fn(list[i]);
      if (v < bestVal) { best = list[i]; bestVal = v; }
    }
    return best;
  }

  function nearestResolution(m, r) {
    r = normalizeResolution(r);
    if (m.resolutions.indexOf(r) >= 0) return r;
    var rank = RES_RANK[r];
    if (rank === undefined) {
      return m.resolutions.indexOf(m.default_resolution) >= 0 ? m.default_resolution : m.resolutions[0];
    }
    return minBy(m.resolutions, function (item) {
      return Math.abs((RES_RANK[item] === undefined ? 1e9 : RES_RANK[item]) - rank);
    });
  }

  function nearestRatio(m, ratio) {
    ratio = normalizeRatio(ratio, m.default_ratio);
    if (m.ratios.indexOf(ratio) >= 0) return ratio;
    var aspect = RATIO_ASPECT.hasOwnProperty(ratio) ? RATIO_ASPECT[ratio] : null;
    var candidates = m.ratios.filter(function (item) {
      return RATIO_ASPECT.hasOwnProperty(item) && RATIO_ASPECT[item] !== null;
    });
    if (aspect === null || !candidates.length) {
      return m.ratios.indexOf(m.default_ratio) >= 0 ? m.default_ratio : m.ratios[0];
    }
    return minBy(candidates, function (item) { return Math.abs(RATIO_ASPECT[item] - aspect); });
  }

  /** Returns {duration, resolution, ratio, changes:[[field, old, new], ...]} */
  function snapParams(m, duration, resolution, ratio) {
    var changes = [];
    var oldD = toInt(duration);
    if (oldD === null) oldD = duration;
    var newD = nearestDuration(m, duration);
    if (String(oldD) !== String(newD)) changes.push(['duration', oldD, newD]);

    var hasRes = String(resolution == null ? '' : resolution).trim() !== '';
    var oldR = hasRes ? normalizeResolution(resolution) : resolution;
    var newR = nearestResolution(m, resolution);
    if (normalizeResolution(oldR) !== newR) changes.push(['resolution', oldR || resolution, newR]);

    var hasRatio = String(ratio == null ? '' : ratio).trim() !== '';
    var oldRatio = hasRatio ? normalizeRatio(ratio, '') : ratio;
    var newRatio = nearestRatio(m, ratio);
    if (normalizeRatio(String(oldRatio == null ? '' : oldRatio), '') !== newRatio) {
      changes.push(['ratio', oldRatio || ratio, newRatio]);
    }
    return { duration: newD, resolution: newR, ratio: newRatio, changes: changes };
  }

  function durationLimitPhrase(m, old, zh) {
    var n = toInt(old);
    var lo = m.durations[0], hi = m.durations[m.durations.length - 1];
    if (n !== null && n < lo) return zh ? '最短 ' + lo + ' 秒' : 'at least ' + lo + ' s';
    return zh ? '最长 ' + hi + ' 秒' : 'up to ' + hi + ' s';
  }

  function resolutionLimitPhrase(m, old, nw, zh) {
    var ranked = m.resolutions.slice().sort(function (a, b) { return (RES_RANK[a] || 0) - (RES_RANK[b] || 0); });
    var lo = ranked[0], hi = ranked[ranked.length - 1];
    var oldN = RES_RANK[normalizeResolution(old)];
    var newN = RES_RANK[nw] !== undefined ? RES_RANK[nw] : (RES_RANK[hi] || 0);
    if (oldN !== undefined && oldN < newN) return zh ? '最低 ' + lo : 'at least ' + lo;
    return zh ? '最高 ' + hi : hi;
  }

  function ratioLimitPhrase(m, zh) {
    var joined = m.ratios.join(' / ');
    if (zh) return '比例仅支持 ' + joined;
    if (m.ratios.length === 1) return 'aspect ratio ' + m.ratios[0];
    return 'aspect ratios ' + joined;
  }

  /** Plain notice naming only the model limits that forced a change (same wording as the desktop app). */
  function formatAdjustNotice(m, changes, lang) {
    if (!changes || !changes.length) return '';
    var zh = lang === 'zh';
    var name = label(m, lang);
    var phrases = changes.map(function (c) {
      if (c[0] === 'duration') return durationLimitPhrase(m, c[1], zh);
      if (c[0] === 'resolution') return resolutionLimitPhrase(m, c[1], c[2], zh);
      return ratioLimitPhrase(m, zh);
    });
    if (zh) return name + ' ' + phrases.join('、') + '，已自动调整';
    var limits;
    if (phrases.length === 1) limits = phrases[0];
    else if (phrases.length === 2) limits = phrases[0] + ' and ' + phrases[1];
    else limits = phrases.slice(0, -1).join(', ') + ' and ' + phrases[phrases.length - 1];
    return name + ' supports ' + limits + ', so settings were adjusted automatically.';
  }

  function estimateCost(duration, resolution, modelId) {
    var m = getModel(modelId);
    var r = normalizeResolution(resolution);
    var d = toInt(duration);
    if (m.family === 'hailuo' && m.flat_price_usd) {
      var flat = m.flat_price_usd[r + '|' + d];
      if (flat === undefined) throw new Error('resolution');
      return { total: flat, perSecond: Math.round((flat / d) * 1000) / 1000 };
    }
    var price = m.list_price_usd_per_second[r];
    if (price === undefined) throw new Error('resolution');
    return { total: Math.round(d * price * 1000) / 1000, perSecond: price };
  }

  function rangeText(m) {
    var lo = m.durations[0], hi = m.durations[m.durations.length - 1];
    var res = m.resolutions.map(function (r) { return (r === '4k' || r === '2k') ? r.toUpperCase() : r; });
    return { seconds: lo + '–' + hi, resolutions: res.length > 1 ? res[0] + '–' + res[res.length - 1] : res[0] };
  }

  // ---- request builders (same shapes as models.build_*_request) ----
  function stripDataUrl(value) {
    var text = String(value);
    if (text.indexOf('data:') === 0 && text.indexOf(';base64,') >= 0) return text.split(';base64,')[1];
    return text;
  }

  function validateMedia(m, media) {
    var allowed = {
      wan: ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio', 'file', 'link'],
      seedance: ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio'],
      kling: ['first_frame', 'last_frame'],
      h3: [],
      hailuo: [],
      vidu: ['first_frame', 'reference_image', 'reference_audio']
    }[m.family];
    if (!allowed) allowed = [];
    media.forEach(function (item) {
      var url = item.url || '';
      if (/^https?:\/\//i.test(url)) {
        var host = '';
        try { host = new URL(url).hostname; } catch (e) { host = ''; }
        if (!host) throw codeError('media_url_invalid');
      } else if (/^data:/i.test(url)) {
        if (!/^data:image\//i.test(url) || url.indexOf(';base64,') < 0) throw codeError('media_url_invalid');
      } else {
        throw codeError('media_url_invalid');
      }
      if (allowed.indexOf(item.type) < 0) throw codeError('media_type_invalid');
    });
  }

  function codeError(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  /**
   * Build the provider request. Returns {body, submitPath, pollKind}.
   * Throws Error with .code for invalid input (never sends anything).
   */
  function buildRequest(modelId, prompt, duration, resolution, ratio, media) {
    var m = getModel(modelId);
    media = media || [];
    prompt = String(prompt || '');
    var d = toInt(duration);
    if (d === null) throw codeError('duration_int');
    if (m.durations.indexOf(d) < 0) throw codeError('duration_not_allowed');
    var r = normalizeResolution(resolution);
    if (m.resolutions.indexOf(r) < 0) throw codeError('resolution_not_allowed');
    var ra = normalizeRatio(ratio, m.default_ratio);
    if (m.ratios.indexOf(ra) < 0) throw codeError('ratio_not_allowed');
    if (!prompt.trim() && !media.length) throw codeError('need_prompt_or_media');
    if (m.family === 'vidu' && !media.length) throw codeError('vidu_need_image');
    if (m.family === 'hailuo' && r === '1080p' && d !== 6) throw codeError('hailuo_1080_only_6s');
    validateMedia(m, media);

    if (m.family === 'wan') {
      var wan = {
        model: m.id,
        prompt: prompt.trim(),
        seconds: String(d),
        size: r.toUpperCase(),
        ratio: ra,
        generate_audio: true
      };
      if (media.length) wan.media = media.map(function (x) { return { type: x.type, url: x.url }; });
      return { body: wan, submitPath: '/v1/videos', pollKind: 'unified' };
    }
    if (m.family === 'seedance') {
      var items = [];
      if (prompt.trim()) items.push({ type: 'text', text: prompt.trim() });
      media.forEach(function (x) { items.push({ type: x.type, url: x.url }); });
      return {
        body: {
          model: m.id,
          media: items,
          seconds: String(d),
          size: r.toLowerCase(),
          ratio: ra,
          generate_audio: true,
          watermark: false
        },
        submitPath: '/v1/videos',
        pollKind: 'unified'
      };
    }
    if (m.family === 'h3') {
      if (media.length) throw codeError('model_t2v_only');
      if (!prompt.trim()) throw codeError('need_prompt_or_media');
      var h3res = r === '2k' ? '2K' : (r === '768p' ? '768P' : r.toUpperCase());
      return {
        body: {
          model: m.id,
          content: [{ type: 'text', text: prompt.trim() }],
          resolution: h3res,
          duration: d,
          ratio: ra
        },
        submitPath: '/minimax/v2/video_generation',
        pollKind: 'h3'
      };
    }
    if (m.family === 'hailuo') {
      if (media.length) throw codeError('model_t2v_only');
      if (!prompt.trim()) throw codeError('need_prompt_or_media');
      if (r === '1080p' && d !== 6) throw codeError('hailuo_1080_only_6s');
      var hsize = r === '768p' ? '768P' : (r === '1080p' ? '1080P' : r.toUpperCase());
      return {
        body: { model: m.id, prompt: prompt.trim(), seconds: String(d), size: hsize },
        submitPath: '/v1/videos',
        pollKind: 'unified'
      };
    }
    if (m.family === 'vidu') {
      var vFirst = null, vRefs = [], vAudio = [];
      media.forEach(function (x) {
        if (x.type === 'first_frame' && vFirst === null) vFirst = x.url;
        else if (x.type === 'reference_image') vRefs.push(x.url);
        else if (x.type === 'reference_audio') vAudio.push(x.url);
        else if (x.type === 'last_frame') throw codeError('vidu_media_limited');
      });
      if (!vFirst && !vRefs.length) throw codeError('vidu_need_image');
      if (vFirst && vRefs.length) throw codeError('vidu_media_limited');
      var vres = (r === '2k' || r === '4k') ? r.toUpperCase() : r;
      var vbody = {
        model: m.id,
        duration: d,
        resolution: vres,
        audio: !!m.generate_audio_default
      };
      if (prompt.trim()) vbody.prompt = prompt.trim();
      if (vFirst) {
        vbody.images = [vFirst];
        return { body: vbody, submitPath: '/vidu/ent/v2/img2video', pollKind: 'vidu' };
      }
      if (!prompt.trim()) throw codeError('need_prompt_or_media');
      vbody.images = vRefs.slice(0, 15);
      if (vAudio.length) vbody.sounds = vAudio.slice(0, 3);
      vbody.aspect_ratio = ra;
      return { body: vbody, submitPath: '/vidu/ent/v2/reference2video', pollKind: 'vidu' };
    }
    // kling
    var mode = m.kling_mode_map[r];
    if (!mode) throw codeError('resolution_not_allowed');
    var first = null, last = null;
    media.forEach(function (x) {
      if (x.type === 'first_frame' && first === null) first = x.url;
      if (x.type === 'last_frame' && last === null) last = x.url;
    });
    var body = {
      model_name: m.id,
      prompt: prompt.trim(),
      duration: String(d),
      mode: mode,
      sound: m.generate_audio_default ? 'on' : 'off'
    };
    if (first || last) {
      if (first) body.image = stripDataUrl(first);
      if (last) body.image_tail = stripDataUrl(last);
      return { body: body, submitPath: '/kling/v1/videos/image2video', pollKind: 'kling_i2v' };
    }
    body.aspect_ratio = ra;
    return { body: body, submitPath: '/kling/v1/videos/text2video', pollKind: 'kling_t2v' };
  }

  function pollPath(taskId, pollKind) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(String(taskId || ''))) throw codeError('task_id_invalid');
    if (pollKind === 'kling_t2v') return '/kling/v1/videos/text2video/' + taskId;
    if (pollKind === 'kling_i2v') return '/kling/v1/videos/image2video/' + taskId;
    if (pollKind === 'h3') return '/minimax/v2/query/video_generation/' + taskId;
    if (pollKind === 'vidu') return '/vidu/ent/v2/tasks/' + taskId + '/creations';
    return '/v1/videos/' + taskId;
  }

  function extractTaskId(body, family) {
    body = body && typeof body === 'object' ? body : {};
    var id;
    if (family === 'kling') {
      var data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
      id = data.task_id || body.task_id || body.id;
    } else if (family === 'h3') {
      var output = body.output && typeof body.output === 'object' && !Array.isArray(body.output) ? body.output : {};
      id = body.task_id || output.task_id || body.id;
      if (id != null) id = String(id);
    } else if (family === 'vidu') {
      id = body.task_id || body.id;
    } else {
      id = body.id || body.task_id;
    }
    return typeof id === 'string' && id ? id : null;
  }

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  /** Returns {status, progress, url} like models.normalize_status. */
  function normalizeStatus(body, family) {
    body = isObj(body) ? body : {};
    if (family === 'kling') {
      var data = isObj(body.data) ? body.data : body;
      var raw = String(data.task_status || '').trim().toLowerCase();
      var map = { submitted: 'queued', processing: 'in_progress', succeed: 'succeeded', success: 'succeeded', failed: 'failed' };
      var status = map.hasOwnProperty(raw) ? map[raw] : raw;
      var url = '';
      var result = isObj(data.task_result) ? data.task_result : {};
      var videos = Array.isArray(result.videos) ? result.videos : [];
      if (videos.length && isObj(videos[0])) {
        var c = videos[0].url || videos[0].watermark_url || '';
        if (typeof c === 'string' && c.indexOf('https://') === 0) url = c;
      }
      return { status: status, progress: null, url: url, message: String(data.task_status_msg || body.message || '') };
    }
    if (family === 'h3') {
      var task = isObj(body.task) ? body.task : body;
      var hraw = String(task.status || '').trim().toLowerCase();
      var hmap = { pending: 'queued', queueing: 'queued', processing: 'in_progress', running: 'in_progress', succeed: 'succeeded', success: 'succeeded', succeeded: 'succeeded', failed: 'failed' };
      var hstatus = hmap.hasOwnProperty(hraw) ? hmap[hraw] : hraw;
      var hurl = '';
      var hcontent = isObj(task.content) ? task.content : {};
      var hc = hcontent.url || task.video_url || '';
      if (typeof hc === 'string' && hc.indexOf('https://') === 0) hurl = hc;
      return { status: hstatus, progress: null, url: hurl, message: String(task.message || body.message || '') };
    }
    if (family === 'vidu') {
      var vraw = String(body.state || body.status || '').trim().toLowerCase();
      var vmap = { created: 'queued', queueing: 'queued', processing: 'in_progress', success: 'succeeded', succeeded: 'succeeded', failed: 'failed' };
      var vstatus = vmap.hasOwnProperty(vraw) ? vmap[vraw] : vraw;
      var vurl = '';
      var creations = Array.isArray(body.creations) ? body.creations : [];
      if (creations.length && isObj(creations[0])) {
        var vc = creations[0].url || '';
        if (typeof vc === 'string' && vc.indexOf('https://') === 0) vurl = vc;
      }
      return { status: vstatus, progress: null, url: vurl, message: String(body.err_code || body.message || '') };
    }
    var st = String(body.status || '').trim().toLowerCase();
    var progress = body.progress === undefined || body.progress === null ? null : body.progress;
    var meta = isObj(body.metadata) ? body.metadata : {};
    var content = isObj(body.content) ? body.content : {};
    var u = '';
    [meta.url, body.video_url, content.video_url].some(function (cand) {
      if (typeof cand === 'string' && cand.indexOf('https://') === 0) { u = cand; return true; }
      return false;
    });
    var err = isObj(body.error) ? (body.error.message || body.error.code || '') : (body.error || body.fail_reason || '');
    return { status: st, progress: progress, url: u, message: String(err || '') };
  }

  /** Error category, same rules as wan_core.category. */
  function category(code, body) {
    var text = '';
    try { text = JSON.stringify(body || {}).toLowerCase(); } catch (e) { text = ''; }
    function has(list) { return list.some(function (x) { return text.indexOf(x) >= 0; }); }
    if (code === 429 || has(['rate limit', 'rate_limit', 'too many requests', '请求过于频繁'])) return 'RATE_LIMIT';
    // Web adds 'balance' / '余额' to the desktop list (PT's exact balance error shape is unconfirmed).
    if (code === 402 || has(['quota', 'insufficient', '余额不足', 'usage limit', 'credit', '额度', '余额不够', 'balance', '余额'])) return 'QUOTA';
    if (has(['expired', 'expire', '已过期', 'token expired', 'key expired'])) return 'AUTH';
    if (has(['无模型权限', '无权', 'not permitted', 'not authorized to model'])) return 'NOT_ALLOWED';
    if (code === 401 || text.indexOf('token_invalid') >= 0 || text.indexOf('invalid token') >= 0) return 'AUTH';
    if (code === 403) return 'NOT_ALLOWED';
    return 'UNKNOWN';
  }

  root.VSModels = {
    API_BASE: API_BASE,
    UTM: UTM,
    PRICE_CHECKED_DATE: PRICE_CHECKED_DATE,
    MODELS: MODELS,
    MODEL_ORDER: MODEL_ORDER,
    DEFAULT_MODEL_ID: DEFAULT_MODEL_ID,
    RES_RANK: RES_RANK,
    getModel: getModel,
    listModels: listModels,
    discountPercent: discountPercent,
    label: label,
    description: description,
    summary: summary,
    priceSource: priceSource,
    docsUrl: docsUrl,
    normalizeResolution: normalizeResolution,
    normalizeRatio: normalizeRatio,
    snapParams: snapParams,
    formatAdjustNotice: formatAdjustNotice,
    estimateCost: estimateCost,
    rangeText: rangeText,
    buildRequest: buildRequest,
    pollPath: pollPath,
    extractTaskId: extractTaskId,
    normalizeStatus: normalizeStatus,
    category: category
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
