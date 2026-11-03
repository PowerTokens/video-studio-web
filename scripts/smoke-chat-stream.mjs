/**
 * Offline smoke for chat stream preview + SSE line assembly (no network).
 */
import assert from 'node:assert/strict';

function unescapeJsonString(s) {
  return String(s || '').replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) {
    return String.fromCharCode(parseInt(h, 16));
  }).replace(/\\(["\\/bfnrt])/g, function (_, c) {
    return ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[c] || c;
  });
}

function streamPreviewText(raw) {
  var s = String(raw || '');
  if (!s) return '';
  var key = '"assistant_message"';
  var idx = s.indexOf(key);
  if (idx < 0) {
    if (s.charAt(0) === '{' || s.charAt(0) === '[') return '';
    return s;
  }
  var after = s.slice(idx + key.length);
  var colon = after.search(/:\s*"/);
  if (colon < 0) return '';
  var body = after.slice(colon).replace(/^:\s*"/, '');
  var out = '';
  var i = 0;
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
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return unescapeJsonString(out);
}

// Progressive JSON should not flash braces
assert.equal(streamPreviewText('{'), '');
assert.equal(streamPreviewText('{"ready":false'), '');
assert.equal(streamPreviewText('{"assistant_message":"Hi'), 'Hi');
assert.equal(streamPreviewText('{"assistant_message":"Hi\\nthere"}'), 'Hi\nthere');
assert.equal(streamPreviewText('{"assistant_message":"说\\u4e00下","ready":true}'), '说一下');

// Tiny SSE assembler mirror
function assemble(chunks) {
  let buffer = '';
  let content = '';
  const consume = (line) => {
    let s = String(line || '');
    if (!s || s.charAt(0) === ':') return;
    if (s.indexOf('data:') !== 0) return;
    let data = s.slice(5);
    if (data.charAt(0) === ' ') data = data.slice(1);
    if (!data || data === '[DONE]') return;
    const obj = JSON.parse(data);
    const piece = obj.choices?.[0]?.delta?.content || '';
    content += piece;
  };
  for (const chunk of chunks) {
    buffer += chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop();
    for (const p of parts) consume(p);
  }
  if (buffer) consume(buffer);
  return content;
}

const sse = assemble([
  'data: {"choices":[{"delta":{"content":"{\\"ass"}}]}\n',
  'data: {"choices":[{"delta":{"content":"istant_message\\":\\"Hello"}}]}\n\n',
  'data: [DONE]\n'
]);
assert.equal(sse, '{"assistant_message":"Hello');
assert.equal(streamPreviewText(sse), 'Hello');

console.log('smoke-chat-stream: ok');
