import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync('js/app.js', 'utf8');
const chat = fs.readFileSync('js/chat-pilot.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /id="gen-ai-plan"/);
for (const code of ['zh','en','es','pt','ja','ko']) {
  const text = fs.readFileSync(`js/lang/${code}.js`, 'utf8');
  assert.match(text, /ai_plan_button:/);
  assert.match(text, /ai_plan_notice:/);
}
const nodes = {};
function node(id) {
  const classes = new Set();
  return nodes[id] ||= { value:'', hidden:true, listeners:{}, focus(){this.focused=true;}, classList:{add(v){classes.add(v);},remove(v){classes.delete(v);},contains(v){return classes.has(v);}}, addEventListener(k,fn){(this.listeners[k] ||= []).push(fn);} };
}
let sends=0, tab='generate';
const ctx = { $:node, deps:{gotoChat(){tab='chat';}}, messages:[], busy:false, resetConversation(){ctx.messages=[];}, hideExamples(){}, appendBubble(){}, t(k){return k;}, onSend(){sends++;}, saveBridgeDraft(){}, scrollThread(){}, gen:{prompt:'old',model:'m',duration:5,resolution:'720p',ratio:'16:9'}, window:{}, sessionStorage:{getItem(){return null;}}, M:{MODELS:{m:{}},getModel(){return {};},snapParams(m,d,r,a){return {duration:d,resolution:r,ratio:a,changes:[]};}}, saveGen(){},setExampleActive(){},renderGenParams(){},renderResults(){},showPromptStart(){},selectGenModel(id){ctx.gen.model=id;} };
vm.createContext(ctx);
vm.runInContext(chat.slice(chat.indexOf('  function focusComposer('),chat.indexOf('  function isBusyCapacityDetail(')),ctx);
vm.runInContext(chat.slice(chat.indexOf('  function startFromGenerate('),chat.indexOf('  function saveBridgeDraft(')),ctx);
ctx.startFromGenerate('preset prompt');
assert.equal(tab,'chat'); assert.equal(node('chat-input').value,''); assert.equal(ctx.planningDraft,'preset prompt'); assert.equal(ctx.planningInterview,true); assert.equal(sends,0); assert.ok(node('chat-input').focused);
ctx.startFromGenerate(''); assert.equal(sends,0);
ctx.messages.push({role:'user'}); ctx.startFromGenerate('another'); assert.equal(sends,0); assert.equal(node('chat-input').value,''); assert.equal(ctx.planningDraft,'another');
vm.runInContext(app.slice(app.indexOf('  var aiPlanFields ='),app.indexOf('  function bindGen()')),ctx);
ctx.fillGenerateFromPlan({prompt:'AI filled',duration:10});
assert.ok(node('gen-prompt').classList.contains('ai-plan-filled'));
assert.ok(node('gen-duration').classList.contains('ai-plan-filled'));
for(const id of ['gen-model','gen-res','gen-ratio']) assert.ok(!node(id).classList.contains('ai-plan-filled'));
assert.equal(node('ai-plan-notice').hidden,false);
ctx.clearAiPlanReview('duration'); assert.ok(!node('gen-duration').classList.contains('ai-plan-filled')); assert.ok(node('gen-prompt').classList.contains('ai-plan-filled'));
ctx.clearAiPlanReview(); assert.equal(node('ai-plan-notice').hidden,true);
assert.match(app,/node.addEventListener\('input'[\s\S]*clearAiPlanReview\(field\)/);
console.log('AI plan bridge smoke passed');
