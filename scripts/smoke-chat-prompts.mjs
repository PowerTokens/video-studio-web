/**
 * Offline checks for chat-pilot shot guidance and example plan prompts.
 * No network. Loads the real i18n tables and the chat-pilot functions.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function elMock() {
  const node = {
    hidden: false,
    textContent: '',
    className: '',
    innerHTML: '',
    value: '',
    id: '',
    type: '',
    style: {},
    children: [],
    parentNode: null,
    classList: {
      toggle() {},
      add() {},
      remove() {},
      contains() { return false; }
    },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    appendChild(child) {
      this.children.push(child);
      if (child && typeof child === 'object') child.parentNode = this;
      return child;
    },
    remove() {},
    focus() {},
    scrollIntoView() {},
    querySelector() { return null; },
    get scrollHeight() { return 0; },
    set scrollTop(_v) {}
  };
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
  'resetConversation: resetConversation,\n    _test: {\n      expandDraftPrompt: expandDraftPrompt,\n      isWeakOrEchoPrompt: isWeakOrEchoPrompt,\n      systemPrompt: systemPrompt,\n      ensureShootablePlan: ensureShootablePlan,\n      planPromptForExample: planPromptForExample,\n      buildExamplePlan: buildExamplePlan\n    }\n  };'
);
assert.notEqual(harness, pilotSrc, 'test hook should patch the export');
vm.runInContext(harness, context, { filename: 'js/chat-pilot.js' });

let lang = 'zh';
const I = context.VSI18n;
const pilot = context.VSChatPilot;
pilot.init({
  t: function () {
    const args = Array.prototype.slice.call(arguments);
    return I.t.apply(null, [lang].concat(args));
  },
  getLang: function () { return lang; },
  getKey: function () { return ''; },
  getCredits: function () { return null; }
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
  const long = I.t(code, 'example_locker_prompt');
  assert.match(long, /approximately 16 seconds/);
  assert.match(long, /Who's in the bet/);
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
assert.match(sys, /立刻 ready=true/);
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
assert.match(sys, /Do not ask a question first/);
assert.match(sys, /Do not mention credits/);
assert.match(sys, /Do not return the user line/);
assert.doesNotMatch(sys, /sunk cost|top-up now|credits insufficient/i);

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

lang = 'zh';
const examplePlan = api.buildExamplePlan('shopping');
assert.ok(examplePlan);
assert.equal(examplePlan.prompt, api.planPromptForExample('shopping'));
assert.match(examplePlan.prompt, /芝士/);
assert.doesNotMatch(examplePlan.prompt, /沿用这句话/);
assert.equal(examplePlan.duration, 5);
assert.equal(examplePlan.resolution, '720p');
const blurb = I.t('zh', 'chat_example_shopping_blurb');
assert.notEqual(examplePlan.prompt, blurb);
assert.ok(examplePlan.prompt.length > blurb.length * 2);

console.log('smoke-chat-prompts ok');
