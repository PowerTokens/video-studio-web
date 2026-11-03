/**
 * Plan-card credit tip: free glm-4.7-flash must not surface a video estimateCost
 * shortfall. Paid text fallbacks may still show that soft note. Generate keeps
 * its own gate (syncGenerateAvailability / submitGen) — asserted from source.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    id: '',
    textContent: '',
    hidden: false,
    type: '',
    value: '',
    children: [],
    parentNode: null,
    attrs: {},
    style: {},
    _listeners: {},
    classList: {
      toggle() {},
      add() {},
      remove() {}
    },
    appendChild(child) {
      node.children.push(child);
      child.parentNode = node;
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((c) => c !== child);
      child.parentNode = null;
    },
    setAttribute(key, value) { node.attrs[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(node.attrs, key) ? node.attrs[key] : null; },
    addEventListener(type, fn) {
      (node._listeners[type] = node._listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    click() {
      (node._listeners.click || []).forEach((fn) => fn({ preventDefault() {} }));
    },
    querySelector(sel) { return query(node, sel); },
    focus() {},
    select() {},
    scrollIntoView() {},
    remove() { if (node.parentNode) node.parentNode.removeChild(node); }
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return node._html || ''; },
    set(value) {
      node._html = value;
      if (value === '') node.children = [];
    }
  });
  return node;
}

function matches(node, sel) {
  if (sel === '[data-soft-credits]') return node.attrs['data-soft-credits'] != null;
  if (sel.charAt(0) === '.') return String(node.className || '').split(/\s+/).indexOf(sel.slice(1)) >= 0;
  if (sel.charAt(0) === '#') return node.id === sel.slice(1);
  return false;
}

function query(node, sel) {
  const kids = node.children || [];
  for (let i = 0; i < kids.length; i++) {
    if (matches(kids[i], sel)) return kids[i];
    const hit = query(kids[i], sel);
    if (hit) return hit;
  }
  return null;
}

function walk(node, visit) {
  visit(node);
  (node.children || []).forEach((child) => walk(child, visit));
}

function createDocument() {
  const byId = {};
  function register(id, tag) {
    const node = makeNode(tag || 'div');
    node.id = id;
    byId[id] = node;
    return node;
  }
  ['chat-plan-mount', 'chat-thread', 'chat-input', 'chat-send', 'chat-status', 'chat-examples', 'chat-reset', 'chat-pilot-entry', 'chat-pilot-entry-wrap', 'chat-example-chips', 'panel-chat'].forEach((id) => register(id));
  const body = makeNode('body');
  const doc = {
    body,
    getElementById(id) { return byId[id] || null; },
    createElement: makeNode,
    querySelector(sel) {
      if (sel === '.chat-scroll') return null;
      return query(body, sel);
    },
    execCommand() { return false; }
  };
  return { doc, byId };
}

function loadChatPilot(doc) {
  const sandbox = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    Promise,
    URLSearchParams,
    document: doc,
    location: { search: '', hash: '' },
    navigator: { clipboard: null },
    VSModels: {
      getModel(id) { return { id: id }; },
      label() { return 'Wan 3.0'; },
      // 5s wan-shaped clip: well above a 12-credit balance.
      estimateCost() { return { total: 0.5, perSecond: 0.1 }; },
      estimateCreditsFromUsd(usd) { return Math.round(Number(usd) * 1000); }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(readFileSync(join(rootDir, 'js/chat-pilot.js'), 'utf8'), sandbox, { filename: 'js/chat-pilot.js' });
  return sandbox;
}

function textsOf(node) {
  const out = [];
  walk(node, (n) => { if (n.textContent) out.push(n.textContent); });
  return out.join('\n');
}

function findButton(mount, label) {
  let found = null;
  walk(mount, (n) => {
    if (n.tagName === 'BUTTON' && n.textContent === label) found = n;
  });
  return found;
}

const { doc, byId } = createDocument();
const sandbox = loadChatPilot(doc);
const pilot = sandbox.VSChatPilot;
const events = [];

assert.equal(pilot.textModelIsFree('glm-4.7-flash'), true);
assert.equal(pilot.planCardShowsVideoCreditSoft('glm-4.7-flash'), false);
assert.equal(pilot.textModelIsFree('glm-4.5-air'), false);
assert.equal(pilot.textModelIsFree('deepseek-flash'), false);
assert.equal(pilot.planCardShowsVideoCreditSoft('deepseek-flash'), true);
assert.equal(pilot.planCardShowsVideoCreditSoft('glm-4.5-air'), true);

pilot.init({
  t(key) {
    return [key].concat([].slice.call(arguments, 1)).join('|');
  },
  getLang() { return 'zh'; },
  getCredits() { return 12; },
  getKey() { return 'test-key'; },
  toast() {},
  copyText() { return Promise.resolve(); },
  track(name, props) { events.push({ name, props }); }
});

// init() tracks via the module's own track(), not deps.track. Spy console is enough;
// the DOM is the assertion. Re-bind by rendering directly.
const plan = {
  title: '峡谷',
  summary: '便宜档',
  prompt: 'A canyon backyard, 5 seconds, concrete camera and light.',
  model: 'wan3.0-video',
  duration: 5,
  resolution: '720p',
  ratio: '9:16'
};

const mount = byId['chat-plan-mount'];

function render(textModel) {
  events.length = 0;
  const seen = [];
  const orig = sandbox.console.info;
  sandbox.console.info = function (tag, name) {
    if (tag === '[vs-analytics]') seen.push(name);
    if (orig) orig.apply(sandbox.console, arguments);
  };
  pilot.renderPlanCard(plan, { textModel });
  sandbox.console.info = orig;
  return seen;
}

const freeEvents = render('glm-4.7-flash');
const freeText = textsOf(mount);
assert.equal(mount.querySelector('[data-soft-credits]'), null, 'free flash plan card has no soft credit node');
assert.equal(freeText.includes('chat_credits_soft'), false);
assert.equal(freeText.includes('credits_insufficient'), false);
assert.equal(freeText.includes('积分不足'), false);
assert.equal(freeText.includes('chat_plan_credits|500'), true, 'video estimate can stay as a plan figure');
assert.equal(freeEvents.includes('credits_insufficient_soft'), false);

const copy = findButton(mount, 'chat_copy_prompt');
assert.ok(copy, 'copy button rendered');
copy.click();
await Promise.resolve();
await Promise.resolve();
assert.equal(mount.querySelector('[data-soft-credits]'), null, 'copy on free flash still does not reveal a credit warning');
assert.equal(textsOf(mount).includes('chat_credits_soft'), false);

const paidEvents = render('deepseek-flash');
const soft = mount.querySelector('[data-soft-credits]');
assert.ok(soft, 'paid text fallback may keep the video soft note');
assert.equal(soft.hidden, true);
assert.equal(soft.textContent, 'chat_credits_soft|500|12');
assert.equal(paidEvents.includes('credits_insufficient_soft'), true);
findButton(mount, 'chat_copy_prompt').click();
await Promise.resolve();
await Promise.resolve();
assert.equal(mount.querySelector('[data-soft-credits]').hidden, false);

// Enough balance: nobody gets an insufficient tip, including paid text.
pilot.init({
  t(key) { return [key].concat([].slice.call(arguments, 1)).join('|'); },
  getLang() { return 'en'; },
  getCredits() { return 5000; },
  toast() {},
  copyText() { return Promise.resolve(); }
});
render('glm-4.7-flash');
assert.equal(mount.querySelector('[data-soft-credits]'), null);
render('glm-4.5-air');
assert.equal(mount.querySelector('[data-soft-credits]'), null);

// Unknown balance: do not invent a shortfall on the plan card.
pilot.init({
  t(key) { return key; },
  getLang() { return 'zh'; },
  getCredits() { return null; },
  toast() {},
  copyText() { return Promise.resolve(); }
});
render('deepseek-flash');
assert.equal(mount.querySelector('[data-soft-credits]'), null);

const appSrc = readFileSync(join(rootDir, 'js/app.js'), 'utf8');
assert.match(appSrc, /function syncGenerateAvailability\(creditsNeeded\)/);
assert.match(appSrc, /creditsNeeded > oc/);
assert.match(appSrc, /hint\.textContent = t\('credits_insufficient'\)/);
assert.match(appSrc, /errBox\.textContent = t\('credits_insufficient'\)/);
assert.equal(appSrc.includes('planCardShowsVideoCreditSoft'), false);

const html = readFileSync(join(rootDir, 'index.html'), 'utf8');
assert.match(html, /id="gen-insufficient"/);
assert.match(html, /data-i18n="credits_insufficient"/);

console.log('smoke-chat-credits ok');
