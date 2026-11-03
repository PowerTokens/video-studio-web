/**
 * Example chips answer locally. Typed messages still call /v1/chat/completions.
 * No network. Loads the real i18n, lang files, models, and chat-pilot.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    id: '',
    textContent: '',
    hidden: false,
    open: false,
    disabled: false,
    type: '',
    value: '',
    title: '',
    children: [],
    parentNode: null,
    style: {},
    attrs: {},
    listeners: {}
  };
  el.classList = {
    toggle(name, force) {
      const parts = String(el.className || '').split(/\s+/).filter(Boolean);
      const has = parts.indexOf(name) >= 0;
      const on = force === undefined ? !has : !!force;
      const next = parts.filter(function (c) { return c !== name; });
      if (on) next.push(name);
      el.className = next.join(' ');
      return on;
    },
    add(name) { this.toggle(name, true); },
    remove(name) { this.toggle(name, false); },
    contains(name) { return String(el.className || '').split(/\s+/).indexOf(name) >= 0; }
  };
  el.setAttribute = function (k, v) {
    el.attrs[k] = String(v);
    if (k === 'id') el.id = String(v);
    if (k === 'class') el.className = String(v);
  };
  el.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; };
  el.removeAttribute = function (k) { delete el.attrs[k]; };
  el.appendChild = function (child) {
    if (child.parentNode) {
      child.parentNode.children = child.parentNode.children.filter(function (c) { return c !== child; });
    }
    child.parentNode = el;
    el.children.push(child);
    return child;
  };
  el.remove = function () {
    if (!el.parentNode) return;
    el.parentNode.children = el.parentNode.children.filter(function (c) { return c !== el; });
    el.parentNode = null;
  };
  el.addEventListener = function (type, fn) {
    if (!el.listeners[type]) el.listeners[type] = [];
    el.listeners[type].push(fn);
  };
  el.dispatchEvent = function (ev) {
    const list = (el.listeners[ev.type] || []).slice();
    for (const fn of list) fn(ev);
    return true;
  };
  el.click = function () { el.dispatchEvent({ type: 'click', preventDefault() {} }); };
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() { return ''; },
    set(v) { if (!v) el.children = []; }
  });
  el.querySelector = function (sel) { return queryAll(el, sel)[0] || null; };
  el.querySelectorAll = function (sel) { return queryAll(el, sel); };
  return el;
}

function walk(node, fn) {
  const kids = node.children || [];
  for (let i = 0; i < kids.length; i++) {
    fn(kids[i]);
    walk(kids[i], fn);
  }
}

function matches(el, sel) {
  if (!el || !el.tagName) return false;
  const bits = String(sel).match(/([.#][A-Za-z0-9_-]+|\[[^\]]+\]|[A-Za-z][A-Za-z0-9-]*)/g);
  if (!bits || !bits.length) return false;
  for (const part of bits) {
    if (part.charAt(0) === '.') {
      if (String(el.className || '').split(/\s+/).indexOf(part.slice(1)) < 0) return false;
    } else if (part.charAt(0) === '#') {
      if (el.id !== part.slice(1)) return false;
    } else if (part.charAt(0) === '[') {
      const m = part.match(/^\[([^=\]]+)="([^"]*)"\]$/);
      if (!m || el.getAttribute(m[1]) !== m[2]) return false;
    } else if (el.tagName !== part.toUpperCase()) {
      return false;
    }
  }
  return true;
}

function textOf(el) {
  let s = el && el.textContent ? String(el.textContent) : '';
  if (!el) return s;
  walk(el, function (child) { s += child.textContent || ''; });
  return s;
}

function queryAll(rootNode, selector) {
  const steps = String(selector).trim().split(/\s+/);
  let nodes = [rootNode];
  for (const step of steps) {
    const next = [];
    for (const n of nodes) {
      walk(n, function (el) {
        if (matches(el, step)) next.push(el);
      });
    }
    nodes = next;
  }
  return nodes;
}

function h(tag, attrs) {
  const el = createEl(tag);
  attrs = attrs || {};
  if (attrs.id) el.setAttribute('id', attrs.id);
  if (attrs.className) el.className = attrs.className;
  if (attrs.attrs) {
    Object.keys(attrs.attrs).forEach(function (k) { el.setAttribute(k, attrs.attrs[k]); });
  }
  (attrs.children || []).forEach(function (child) { el.appendChild(child); });
  return el;
}

const body = h('body', {
  children: [
    h('nav', {
      className: 'tabs',
      children: [h('button', { attrs: { 'data-tab': 'chat' } })]
    }),
    h('section', {
      id: 'panel-chat',
      children: [
        h('button', { id: 'chat-reset' }),
        h('div', {
          className: 'chat-scroll',
          children: [
            h('div', { id: 'chat-thread' }),
            h('div', {
              id: 'chat-examples',
              children: [h('div', { id: 'chat-example-chips' })]
            }),
            h('div', { id: 'chat-plan-mount' }),
            h('p', { id: 'chat-status' })
          ]
        }),
        h('textarea', { id: 'chat-input' }),
        h('button', { id: 'chat-send' }),
        h('button', { id: 'chat-pilot-entry' }),
        h('div', { id: 'chat-pilot-entry-wrap' })
      ]
    })
  ]
});

const document = {
  body: body,
  documentElement: h('html', { children: [body] }),
  getElementById(id) { return queryAll(this.documentElement, '#' + id)[0] || null; },
  querySelector(sel) { return queryAll(this.documentElement, sel)[0] || null; },
  querySelectorAll(sel) { return queryAll(this.documentElement, sel); },
  createElement: createEl
};
body.parentNode = document.documentElement;

const calls = [];
const sandbox = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  URLSearchParams: URLSearchParams,
  Promise: Promise,
  JSON: JSON,
  Date: Date,
  Math: Math,
  Number: Number,
  String: String,
  parseInt: parseInt,
  isFinite: isFinite,
  isNaN: isNaN,
  Object: Object,
  Array: Array,
  RegExp: RegExp,
  Error: Error,
  document: document,
  location: { search: '', href: 'http://127.0.0.1/', hash: '#chat' },
  navigator: {
    language: 'zh-CN',
    clipboard: { writeText() { return Promise.resolve(); } }
  },
  fetch: function () {
    calls.push({ via: 'fetch' });
    return Promise.reject(new Error('fetch should not run'));
  },
  XMLHttpRequest: function () {
    calls.push({ via: 'xhr' });
    throw new Error('xhr should not run');
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

load('js/i18n.js');
for (const lang of ['zh', 'en', 'es', 'pt', 'ja', 'ko']) load('js/lang/' + lang + '.js');
load('js/models.js');
load('js/chat-pilot.js');

let nextQuota = false;
sandbox.VSApi = {
  api(method, apiPath) {
    calls.push({ via: 'api', method: method, path: apiPath });
    return Promise.resolve({ code: 402, body: { error: { message: '系统余额不足' } } });
  },
  apiChatStream(apiPath, key, body) {
    calls.push({ via: 'stream', path: apiPath, body: body });
    if (nextQuota) {
      nextQuota = false;
      return Promise.resolve({ code: 402, body: { error: { message: '系统余额不足' } }, content: '' });
    }
    return Promise.resolve({
      code: 200,
      streamed: true,
      content: JSON.stringify({
        assistant_message: 'Noted — tell me what to change.',
        ready: false,
        plan: null
      })
    });
  },
  store: {
    get(_k, d) { return d; },
    set() {},
    remove() {}
  }
};

const I = sandbox.VSI18n;
const ids = ['shopping', 'canyon', 'seal', 'locker'];
const langs = ['zh', 'en', 'es', 'pt', 'ja', 'ko'];
const shotStart = {
  zh: '主体：',
  en: 'Subject:',
  es: 'Sujeto:',
  pt: 'Sujeito:',
  ja: '主体：',
  ko: '주체:'
};

let lang = 'zh';
sandbox.VSChatPilot.init({
  t() { return I.t.apply(null, [lang].concat([].slice.call(arguments))); },
  getLang() { return lang; },
  getKey() { return 'sk-test-key'; },
  getCredits() { return 999999; },
  fillGenerate() {},
  gotoGenerate() {},
  gotoChat() {},
  promptLogin() { throw new Error('chip path must not ask for login'); },
  toast() {},
  copyText() { return Promise.resolve(); }
});

function bubbles() {
  return document.querySelectorAll('.chat-bubble').map(function (n) { return n.textContent; });
}

for (const code of langs) {
  for (const id of ids) {
    lang = code;
    sandbox.VSChatPilot.resetConversation();
    assert.equal(calls.length, 0, 'reset must not call chat');
    const chip = document.querySelector('.chat-example-chip[data-example="' + id + '"]');
    assert.ok(chip, code + ' chip ' + id);
    const blurb = I.t(code, 'chat_example_' + id + '_blurb');
    const label = I.t(code, 'example_' + id + '_label');
    const preamble = I.t(code, 'chat_example_preamble', label);
    const prompt = id === 'locker'
      ? I.t(code, 'chat_example_locker_prompt')
      : I.t(code, 'example_' + id + '_prompt');
    assert.ok(textOf(chip).indexOf(blurb) >= 0, code + ' chip copy ' + id);
    if (code !== 'en') assert.notEqual(blurb, I.t('en', 'chat_example_' + id + '_blurb'));
    if (code !== 'en') assert.notEqual(preamble, I.t('en', 'chat_example_preamble', I.t('en', 'example_' + id + '_label')));
    chip.click();
    assert.equal(calls.length, 0, code + ' ' + id + ' must not call /v1/chat/completions');
    const texts = bubbles();
    assert.equal(texts[texts.length - 2], blurb, code + ' user turn ' + id);
    assert.equal(texts[texts.length - 1], preamble, code + ' preamble ' + id);
    assert.ok(preamble.length < 220, 'preamble stays short');
    assert.ok(preamble.indexOf(label) >= 0, 'preamble names the example');
    assert.ok(prompt.indexOf(preamble) < 0, 'prompt is not the preamble');
    assert.ok(preamble.indexOf(prompt.slice(0, 24)) < 0, 'preamble is not a prompt dump');
    const body = document.querySelector('.chat-plan-prompt-body');
    const details = document.querySelector('.chat-plan-prompt');
    assert.equal(body && body.textContent, prompt);
    const summary = document.querySelector('.chat-plan-summary');
    assert.ok(summary && summary.textContent.length <= 160, summary && summary.textContent);
    if (blurb.length > 160) assert.ok(summary.textContent.endsWith('…'));
    else assert.equal(summary.textContent, blurb);
    assert.equal(details && details.open, true);
    assert.ok(prompt.startsWith(shotStart[code]), code + ' shot prompt ' + id);
    assert.ok(prompt.length > 180);
    assert.doesNotMatch(prompt, /1080|4k|4K|10-second|approximately 16|16 seconds|10秒|16\s*秒/);
    assert.equal(prompt.includes('Kade'), false);
    const meta = document.querySelector('.chat-plan-meta');
    assert.ok(meta && meta.textContent.indexOf('5s') >= 0, meta && meta.textContent);
    assert.ok(meta.textContent.indexOf('720p') >= 0);
    assert.ok(meta.textContent.indexOf('9:16') >= 0);
    assert.equal(document.getElementById('chat-examples').hidden, true);
    assert.equal(document.getElementById('chat-status').hidden, true);
  }
}

assert.match(I.t('zh', 'example_shopping_prompt'), /^主体：/);
assert.match(I.t('en', 'example_seal_prompt'), /^Subject:/);
assert.match(I.t('zh', 'example_locker_prompt'), /Who's in the bet/);
assert.doesNotMatch(I.t('zh', 'example_locker_prompt'), /approximately 16|1080/);

lang = 'en';
sandbox.VSChatPilot.resetConversation();
document.querySelector('.chat-example-chip[data-example="seal"]').click();
assert.equal(calls.length, 0);
const typed = 'Make the seal clap once more, then hold on the guest.';
const input = document.getElementById('chat-input');
const send = document.getElementById('chat-send');
input.value = typed;
send.click();
await new Promise(function (resolve) { setTimeout(resolve, 900); });
assert.equal(calls.length, 1);
assert.equal(calls[0].via, 'stream');
assert.equal(calls[0].path, '/v1/chat/completions');
const apiUsers = calls[0].body.messages.filter(function (m) { return m.role === 'user'; });
assert.equal(apiUsers[apiUsers.length - 1].content, typed);
assert.equal(apiUsers.some(function (m) { return String(m.content || '').indexOf('[example_id=') >= 0; }), false);
assert.equal(calls[0].body.messages[0].role, 'system');

input.value = 'One more change: warmer sunset.';
input.dispatchEvent({ type: 'keydown', key: 'Enter', shiftKey: false, preventDefault() {} });
await new Promise(function (resolve) { setTimeout(resolve, 900); });
assert.equal(calls.length, 2);
assert.equal(calls[1].path, '/v1/chat/completions');
const users2 = calls[1].body.messages.filter(function (m) { return m.role === 'user'; });
assert.equal(users2[users2.length - 1].content, 'One more change: warmer sunset.');

lang = 'zh';
nextQuota = true;
sandbox.VSChatPilot.resetConversation();
calls.length = 0;
input.value = '窗边一只猫打哈欠';
send.click();
await new Promise(function (resolve) { setTimeout(resolve, 900); });
assert.equal(calls.length, 1);
assert.equal(calls[0].path, '/v1/chat/completions');
const afterQuota = bubbles().join('\n');
assert.equal(afterQuota.indexOf('系统余额不足') >= 0, false);
assert.equal(afterQuota.indexOf('余额不足') >= 0, false);
const quotaPlan = document.querySelector('.chat-plan-prompt');
assert.equal(!!(quotaPlan && quotaPlan.open), true);
assert.ok(document.querySelector('.chat-plan-prompt-body').textContent.length > 80);

console.log('smoke-chat-example-local: chips local across zh/en/es/pt/ja/ko; typed messages hit /v1/chat/completions; quota opens a plan');
