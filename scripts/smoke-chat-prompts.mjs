/**
 * Offline checks for chat-pilot shot guidance and example plan prompts.
 * No network. Loads the real i18n tables and the chat-pilot functions.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function elMock() {
  const listeners = {};
  const node = {
    hidden: false,
    textContent: '',
    className: '',
    value: '',
    id: '',
    type: '',
    style: {},
    children: [],
    parentNode: null,
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v == null ? '' : v);
      if (this._html === '') this.children = [];
    },
    classList: {
      toggle() {},
      add() {},
      remove() {},
      contains() { return false; }
    },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    click() {
      for (const fn of listeners.click || []) fn({ type: 'click' });
    },
    appendChild(child) {
      this.children.push(child);
      if (child && typeof child === 'object') child.parentNode = this;
      return child;
    },
    remove() {},
    focus() {},
    scrollIntoView() {},
    querySelector(sel) {
      const want = String(sel || '').replace(/^\./, '');
      let hit = null;
      eachNodeLocal(this, function (n) {
        if (!hit && n !== node && n.className === want) hit = n;
      });
      return hit;
    },
    get scrollHeight() { return 0; },
    set scrollTop(_v) {}
  };
  function eachNodeLocal(n, fn) {
    if (!n) return;
    fn(n);
    for (const c of n.children || []) eachNodeLocal(c, fn);
  }
  return node;
}

const els = {};
const document = {
  getElementById(id) {
    if (!els[id]) els[id] = elMock();
    return els[id];
  },
  querySelector(sel) {
    const s = String(sel || '');
    if (s.indexOf('chat-scroll') >= 0 || s.indexOf('data-tab') >= 0) return elMock();
    return null;
  },
  createElement() { return elMock(); },
  body: elMock(),
  addEventListener() {}
};

const context = {
  console,
  URLSearchParams,
  location: { search: '' },
  document,
  navigator: { language: 'zh-CN', languages: ['zh-CN'] }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);

function load(path) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
}

load('js/i18n.js');
for (const code of ['zh', 'en', 'es', 'pt', 'ja', 'ko']) load('js/lang/' + code + '.js');

const pilotSrc = fs.readFileSync('js/chat-pilot.js', 'utf8');
const harness = pilotSrc.replace(
  'resetConversation: resetConversation\n  };',
  'resetConversation: resetConversation,\n    _test: {\n      expandDraftPrompt: expandDraftPrompt,\n      isWeakOrEchoPrompt: isWeakOrEchoPrompt,\n      systemPrompt: systemPrompt,\n      ensureShootablePlan: ensureShootablePlan,\n      planPromptForExample: planPromptForExample,\n      isNonsensicalUserText: isNonsensicalUserText,\n      isUserConfirmText: isUserConfirmText,\n      userAllowsReady: userAllowsReady,\n      demoteReadyIfNeeded: demoteReadyIfNeeded,\n      parseAssistantPayload: parseAssistantPayload\n    }\n  };'
);
assert.notEqual(harness, pilotSrc, 'test hook should patch the export');
vm.runInContext(harness, context, { filename: 'js/chat-pilot.js' });

let lang = 'zh';
let loggedIn = true;
let apiKey = '';
const loginCalls = [];
const I = context.VSI18n;
const pilot = context.VSChatPilot;
pilot.init({
  t: function () {
    const args = Array.prototype.slice.call(arguments);
    return I.t.apply(null, [lang].concat(args));
  },
  getLang: function () { return lang; },
  getKey: function () { return apiKey; },
  getCredits: function () { return null; },
  isLoggedIn: function () { return loggedIn; },
  onNeedLogin: function (source) { loginCalls.push(source || ''); }
});

const api = pilot._test;
assert.ok(api && api.expandDraftPrompt && api.systemPrompt);

assert.equal(pilot.FLASH_MODEL, 'glm-4.7-flash');
assert.match(pilotSrc, /FLASH_MODELS = \['glm-4\.7-flash'/);
assert.match(pilotSrc, /thinking = \{ type: 'disabled' \}/);
assert.match(pilotSrc, /revealSoftCredits/);
assert.doesNotMatch(pilotSrc, /cheapTierLeadIn/);

const SECTION = {
  zh: ['主体', '场景', '动作与运动', '镜头', '风格与限制'],
  en: ['Subject', 'Scene', 'Action and motion', 'Camera', 'Style and constraints'],
  es: ['Sujeto', 'Escena', 'Acción y movimiento', 'Cámara', 'Estilo y límites'],
  pt: ['Sujeito', 'Cena', 'Ação e movimento', 'Câmera', 'Estilo e limites'],
  ja: ['主体', '場面', '動作', 'カメラ', 'スタイルと制約'],
  ko: ['주체', '장면', '동작', '카메라', '스타일과 제한']
};
const NO_HIRES = /1080|4k|10-second|10秒|16\s*秒|approximately 16|Final text|生成一段/i;

function assertShot(prompt, code, label) {
  const name = label || code;
  assert.ok(prompt.length >= 280, name + ' prompt too short: ' + prompt.length);
  for (const part of SECTION[code]) assert.ok(prompt.includes(part), name + ' missing ' + part);
  assert.doesNotMatch(prompt, NO_HIRES);
}

for (const code of ['zh', 'en', 'es', 'pt', 'ja', 'ko']) {
  for (const id of ['shopping', 'canyon', 'seal']) {
    assertShot(I.t(code, 'example_' + id + '_prompt'), code, code + '/' + id);
  }
  assertShot(I.t(code, 'chat_example_locker_prompt'), code, code + '/locker-chat');
  const locker = I.t(code, 'example_locker_prompt');
  assert.match(locker, /Who's in the bet/);
  assert.doesNotMatch(locker, /approximately 16|1080/);
  for (const id of ['shopping', 'canyon', 'seal', 'locker']) {
    const blurb = I.t(code, 'chat_example_' + id + '_blurb');
    assert.ok(blurb.length >= 40 && blurb.length < 280, code + ' ' + id + ' blurb length ' + blurb.length);
    assert.ok(!blurb.includes('便宜档') && !/cheap-tier|style clip/i.test(blurb));
  }
}

assert.ok(I.t('zh', 'example_shopping_prompt').includes('芝士'));
assert.ok(!I.t('zh', 'example_shopping_prompt').includes('Subject:'));
assert.ok(I.t('en', 'example_seal_prompt').includes('flippers'));
assert.ok(!I.t('en', 'example_seal_prompt').includes('生成一段'));
assert.ok(I.t('es', 'example_seal_prompt').includes('foca'));
assert.ok(I.t('pt', 'example_canyon_prompt').includes('fogueira'));

lang = 'zh';
let sys = api.systemPrompt();
assert.match(sys, /主体/);
assert.match(sys, /场景/);
assert.match(sys, /镜头/);
assert.match(sys, /风格与限制/);
assert.match(sys, /对话节奏/);
assert.match(sys, /这样对吗/);
assert.match(sys, /限量自补/);
assert.match(sys, /\[example_id=/);
assert.match(sys, /不要提积分/);
assert.doesNotMatch(sys, /积分不足|sunk cost|催充值/);
assert.match(sys, /wan3\.0-video/);

lang = 'en';
sys = api.systemPrompt();
assert.match(sys, /Subject:/);
assert.match(sys, /Scene:/);
assert.match(sys, /Camera:/);
assert.match(sys, /Style and constraints:/);
assert.match(sys, /Does that sound right/);
assert.match(sys, /Limit invention/);
assert.match(sys, /Do not mention credits/);
assert.match(sys, /Do not return the user line/);
assert.doesNotMatch(sys, /sunk cost|top-up now|credits insufficient/i);

assert.equal(api.isNonsensicalUserText('ia m'), true);
assert.equal(api.isNonsensicalUserText('ok'), false);
assert.equal(api.isNonsensicalUserText('对'), false);
assert.equal(api.isNonsensicalUserText('fillet'), false);
assert.equal(api.isNonsensicalUserText('iam a cooker, iwant make some video about fillet'), false);
assert.equal(api.isUserConfirmText('对的'), true);
assert.equal(api.isUserConfirmText('yes'), true);
assert.equal(api.isUserConfirmText('iam a cooker'), false);
assert.equal(api.userAllowsReady('对的'), true);
assert.equal(api.userAllowsReady('iam a cooker, iwant make some video about fillet'), false);

const earlyReady = {
  assistant_message: "I'll generate a short video plan for you.",
  ready: true,
  plan: {
    title: 'Perfect Fillet Technique',
    summary: 'Chef expertly trimming silver skin from a salmon fillet.',
    prompt: 'Subject: chef\nScene: kitchen\nAction and motion: trim\nCamera: close-up\nStyle and constraints: clean',
    model: 'wan3.0-video',
    duration: 5,
    resolution: '720p',
    ratio: '9:16'
  },
  parse_ok: true
};
const demoted = api.demoteReadyIfNeeded(earlyReady, 'iam a cooker, iwant make some video about fillet');
assert.equal(demoted.ready, false);
assert.equal(demoted.plan, null);
assert.match(demoted.assistant_message, /Does that sound right|Got it:/i);
assert.equal(demoted.demoted, 'need_confirm');

const nonsenseDemote = api.demoteReadyIfNeeded(earlyReady, 'ia m');
assert.equal(nonsenseDemote.ready, false);
assert.match(nonsenseDemote.assistant_message, /couldn'?t tell|who or what/i);

const afterConfirm = api.demoteReadyIfNeeded(earlyReady, 'yes');
assert.equal(afterConfirm.ready, true);
assert.ok(afterConfirm.plan);

const nouns = {
  zh: { shopping: '芝士', canyon: '火塘', seal: '鼓掌', locker: 'Who\'s in the bet' },
  en: { shopping: 'cheese blocks', canyon: 'fire pit', seal: 'flippers', locker: 'Who\'s in the bet' },
  es: { shopping: 'queso', canyon: 'fogón', seal: 'aletas', locker: 'Who\'s in the bet' },
  pt: { shopping: 'queijo', canyon: 'fogueira', seal: 'nadadeiras', locker: 'Who\'s in the bet' },
  ja: { shopping: 'チーズ', canyon: '火床', seal: 'アザラシ', locker: 'Who\'s in the bet' },
  ko: { shopping: '치즈', canyon: '화로', seal: '물개', locker: 'Who\'s in the bet' }
};

for (const code of ['zh', 'en', 'es', 'pt', 'ja', 'ko']) {
  lang = code;
  for (const id of ['shopping', 'canyon', 'seal', 'locker']) {
    const blurb = I.t(code, 'chat_example_' + id + '_blurb');
    const raw = blurb + '\n\n[example_id=' + id + ']\n' + I.t(code, 'chat_example_ref_prefix') + '\nplaceholder';
    const out = api.expandDraftPrompt(raw);
    assertShot(out, code, code + ' draft ' + id);
    assert.ok(out.includes(nouns[code][id]), code + ' ' + id + ' missing picture detail');
    assert.doesNotMatch(out, /^约 5 秒|^Shootable ~5s/);
    assert.equal(api.isWeakOrEchoPrompt(blurb, raw), true, code + ' ' + id + ' seed should count as an echo');
    assert.equal(api.isWeakOrEchoPrompt(out, raw), false, code + ' ' + id + ' shot prompt should stand');
    const echoed = { prompt: blurb, title: 'x', summary: '' };
    const fixed = api.ensureShootablePlan(echoed, raw);
    assert.equal(fixed.prompt, out);
  }
}

lang = 'zh';
const cat = api.expandDraftPrompt('一只猫在窗台上打哈欠');
assert.match(cat, /^主体：一只猫在窗台上打哈欠/);
assert.match(cat, /镜头：/);
assert.doesNotMatch(cat, /按意图写出|根据用户意图展开/);

lang = 'en';
const catEn = api.expandDraftPrompt('a cat yawning on a windowsill');
assert.match(catEn, /^Subject: a cat yawning on a windowsill/);
assert.match(catEn, /Style and constraints:/);
assert.doesNotMatch(catEn, /name a concrete subject/);

lang = 'es';
assert.match(api.expandDraftPrompt('un gato bostezando en la ventana'), /^Sujeto: un gato/);
lang = 'pt';
assert.match(api.expandDraftPrompt('um gato bocejando na janela'), /^Sujeito: um gato/);
lang = 'ja';
assert.match(api.expandDraftPrompt('窓辺で欠伸する猫'), /^主体：窓辺で欠伸する猫/);
assert.match(api.expandDraftPrompt('窓辺で欠伸する猫'), /スタイルと制約/);
lang = 'ko';
assert.match(api.expandDraftPrompt('창가에서 하품하는 고양이'), /^주체: 창가에서 하품하는 고양이/);

const quoted = [
  'Subject: a cat yawning on a windowsill, orange fur, sitting upright.',
  'Scene: daytime wooden windowsill, sheer curtain, soft green blur outside, one empty glass.',
  'Action and motion: the cat opens its mouth in one yawn, eyes narrow, then closes its mouth and looks out.',
  'Camera: eye level, vertical, medium into a close-up, slight handheld.',
  'Style and constraints: natural window light, real fur, no on-screen text, no watermark, no logo.'
].join('\n');
const userLine = 'a cat yawning on a windowsill';
assert.equal(api.isWeakOrEchoPrompt(quoted, userLine), false);
assert.equal(api.isWeakOrEchoPrompt(userLine, userLine), true);

const clamped = pilot.clampPlan({
  title: 'Too long',
  prompt: quoted,
  duration: 16,
  resolution: '1080p',
  ratio: '16:9',
  model: 'not-a-model'
});
assert.equal(clamped.duration, 5);
assert.equal(clamped.resolution, '720p');
assert.equal(clamped.model, 'wan3.0-video');

function walkText(node) {
  let s = node && node.textContent ? String(node.textContent) : '';
  for (const child of (node && node.children) || []) s += '\n' + walkText(child);
  return s;
}
function findClass(node, cls) {
  if (node && node.className === cls) return node;
  for (const child of (node && node.children) || []) {
    const hit = findClass(child, cls);
    if (hit) return hit;
  }
  return null;
}

lang = 'en';
pilot.presentExample('shopping');
const threadText = walkText(document.getElementById('chat-thread'));
const blurb = I.t('en', 'chat_example_shopping_blurb');
assert.ok(threadText.includes(blurb), 'example click speaks the short scene');
assert.ok(threadText.includes(I.t('en', 'chat_example_ready')));
assert.ok(!threadText.includes('I still need a bit more detail'));
assert.ok(!threadText.includes('insufficient_user_quota'));
const promptBody = findClass(document.getElementById('chat-plan-mount'), 'chat-plan-prompt-body');
assert.ok(promptBody && promptBody.textContent.includes('Subject:'));
assert.ok(promptBody.textContent.includes('cheese blocks'));
assert.equal(findClass(document.getElementById('chat-plan-mount'), 'chat-plan-prompt').open, true);
assert.equal(api.isWeakOrEchoPrompt(promptBody.textContent, blurb), false);
assert.ok(!blurb.includes('Subject:'));
pilot.refreshUi();
function eachNode(node, fn) {
  if (!node) return;
  fn(node);
  for (const child of node.children || []) eachNode(child, fn);
}
eachNode(document.getElementById('chat-example-chips'), function (node) {
  if (node.className === 'chat-example-chip') {
    assert.equal(node.title || '', '', 'example chips should not use a hover title');
    assert.equal(node.getAttribute('aria-label'), null, 'example chips should not dump a label into aria-label');
  }
});

lang = 'zh';
pilot.resetConversation();
pilot.presentExample('shopping');
const zhTitle = findClass(document.getElementById('chat-plan-mount'), 'chat-plan-title');
const zhPrompt = findClass(document.getElementById('chat-plan-mount'), 'chat-plan-prompt-body');
assert.equal(zhTitle.textContent, I.t('zh', 'example_shopping_label'));
assert.ok(zhPrompt.textContent.includes('芝士'));
lang = 'en';
pilot.refreshUi();
const enTitle = findClass(document.getElementById('chat-plan-mount'), 'chat-plan-title');
const enPrompt = findClass(document.getElementById('chat-plan-mount'), 'chat-plan-prompt-body');
assert.equal(enTitle.textContent, I.t('en', 'example_shopping_label'));
assert.ok(enPrompt.textContent.includes('Subject:'));
assert.ok(!enPrompt.textContent.includes('芝士'));
const bubbles = [];
eachNode(document.getElementById('chat-thread'), function (node) {
  if (node.className && String(node.className).indexOf('chat-bubble') >= 0) bubbles.push(node.textContent);
});
assert.ok(bubbles.indexOf(I.t('en', 'chat_example_shopping_blurb')) >= 0, 'example line follows the new language');
assert.ok(bubbles.indexOf(I.t('en', 'chat_example_ready')) >= 0);
assert.ok(bubbles.indexOf(I.t('zh', 'chat_example_shopping_blurb')) < 0);
eachNode(document.getElementById('chat-example-chips'), function (node) {
  if (node.className === 'chat-example-chip') {
    assert.equal(node.title || '', '', 'language switch must not restore a chip hover title');
    assert.equal(node.getAttribute('aria-label'), null);
  }
});

const keepBtns = [];
eachNode(document.getElementById('chat-plan-mount'), function (node) {
  if (node.className === 'btn' && String(node.textContent || '') === I.t('en', 'chat_keep_refining')) {
    keepBtns.push(node);
  }
});
assert.equal(keepBtns.length, 1, 'Keep chatting on the example plan card');
keepBtns[0].click();
assert.equal(document.getElementById('chat-plan-mount').children.length, 0, 'Keep chatting hides the plan card');
assert.equal(findClass(document.getElementById('chat-plan-mount'), 'chat-plan-card'), null);

pilot.presentExample('canyon');
assert.ok(findClass(document.getElementById('chat-plan-mount'), 'chat-plan-card'), 'another example shows a card again');
document.getElementById('chat-input').value = 'i m';
document.getElementById('chat-send').click();
assert.equal(findClass(document.getElementById('chat-plan-mount'), 'chat-plan-card'), null, 'typed follow-up hides the prior card');
assert.ok(walkText(document.getElementById('chat-thread')).includes(I.t('en', 'chat_clarify_nonsensical')));

// Logged-out chips must take the same gate as Send, including when a local plan exists.
let flashCalls = 0;
context.VSApi = {
  api() {
    flashCalls += 1;
    return Promise.resolve({ code: 500, body: {} });
  },
  apiChatStream() {
    flashCalls += 1;
    return Promise.resolve({ code: 500, body: {}, content: '' });
  }
};
loggedIn = false;
apiKey = 'should-not-be-sent';
loginCalls.length = 0;
lang = 'en';
pilot.resetConversation();
const chips = [];
eachNode(document.getElementById('chat-example-chips'), function (node) {
  if (node.className === 'chat-example-chip') chips.push(node);
});
assert.equal(chips.length, 4, 'four example chips');
chips.forEach(function (chip) { chip.click(); });
const loggedOutThread = walkText(document.getElementById('chat-thread'));
assert.ok(loggedOutThread.includes(I.t('en', 'chat_need_login')), 'logged-out example shows the login tip');
assert.ok(!loggedOutThread.includes(I.t('en', 'chat_example_ready')), 'logged-out example does not append the ready reply');
for (const id of ['shopping', 'canyon', 'seal', 'locker']) {
  assert.ok(!loggedOutThread.includes(I.t('en', 'chat_example_' + id + '_blurb')), 'logged-out example does not post ' + id);
}
assert.equal(findClass(document.getElementById('chat-plan-mount'), 'chat-plan-card'), null, 'logged-out example does not mount a plan card');
assert.equal(document.getElementById('chat-examples').hidden, false, 'example chips stay available until login');
assert.deepEqual(loginCalls, ['example', 'example', 'example', 'example']);
assert.equal(flashCalls, 0, 'logged-out example does not call Flash');
document.getElementById('chat-input').value = 'a cat on a windowsill';
document.getElementById('chat-send').click();
assert.deepEqual(loginCalls.slice(-1), ['send'], 'Send stays behind the same login gate');
assert.equal(document.getElementById('chat-input').value, 'a cat on a windowsill', 'Send keeps the draft when login is required');
assert.ok(!walkText(document.getElementById('chat-thread')).includes('a cat on a windowsill'));
assert.equal(flashCalls, 0, 'logged-out Send does not call Flash');

loggedIn = true;
apiKey = 'should-not-be-sent';
loginCalls.length = 0;
flashCalls = 0;
pilot.resetConversation();
pilot.presentExample('shopping');
assert.ok(walkText(document.getElementById('chat-thread')).includes(I.t('en', 'chat_example_ready')), 'logged-in example still replies immediately');
assert.ok(findClass(document.getElementById('chat-plan-mount'), 'chat-plan-card'), 'logged-in example still mounts a local plan');
assert.equal(loginCalls.length, 0, 'logged-in example does not ask for login');
assert.equal(flashCalls, 0, 'logged-in example plan stays local');
document.getElementById('chat-input').value = 'i m';
document.getElementById('chat-send').click();
assert.equal(loginCalls.length, 0, 'logged-in Send is not blocked');
assert.equal(document.getElementById('chat-input').value, '', 'logged-in Send clears the composer');
assert.ok(walkText(document.getElementById('chat-thread')).includes(I.t('en', 'chat_clarify_nonsensical')));
assert.equal(flashCalls, 0, 'logged-in local clarify does not call Flash');

console.log('smoke-chat-prompts ok');
