import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src = readFileSync('js/app.js','utf8');
function fn(name) { const start=src.indexOf('  function '+name+'('); assert(start>=0); let end=src.indexOf('\n  function ',start+10); return src.slice(start,end<0?undefined:end).split('\n  /**')[0]; }
const nodes = new Map();
const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,textContent:'',classList:{contains:()=>false},setAttribute(){}});return nodes.get(id);};
let have=1, events=0, saved=null;
const ctx=vm.createContext({$:node,genBusy:false,oauthCredits:()=>have,show:(n,on)=>n.hidden=!on,t:(k,...a)=>k+' '+a.join(' '),localeNum:String,suggestedPackage:5,gen:{prompt:'x'.repeat(10000)},savedGenForm:null,allowDefaultPreset:true,previewPresetId:'shopping',aiPlanSource:false,window:{VSAnalytics:{notifyPromptEdited(){},notifyExampleClick(){events++;}}},saveGen(){saved=JSON.parse(JSON.stringify(ctx.gen));},setExampleActive(){ctx.active=false;},clearAiPlanReview(){},fitGenPrompt(){}});
vm.runInContext(fn('syncGenerateAvailability'),ctx);
ctx.syncGenerateAvailability(500);assert.equal(node('gen-submit').disabled,true);assert.equal(node('gen-insufficient').hidden,false);assert.match(node('gen-insufficient-body').textContent,/500 1/);
have=1000;ctx.syncGenerateAvailability(500);assert.equal(node('gen-submit').disabled,false);assert.equal(node('gen-insufficient').hidden,true);assert.equal(events,0);
have=null;ctx.syncGenerateAvailability(500);assert.equal(node('gen-submit').disabled,false);ctx.syncGenerateAvailability(null);assert.equal(node('gen-submit').disabled,false);
vm.runInContext(fn('clearGenPrompt'),ctx);node('gen-prompt').value=ctx.gen.prompt;ctx.clearGenPrompt();assert.equal(saved.prompt,'');assert.equal(node('gen-preset-preview').hidden,true);assert.equal(ctx.allowDefaultPreset,false);
vm.runInContext(fn('applyExample'),ctx);ctx.applyExample('shopping','gen',{classList:{contains:()=>true}});assert.equal(saved.prompt,'');assert.equal(events,0);
ctx.EXAMPLE_IDS=['shopping'];ctx.document={querySelector:()=>({})};ctx.examplePrompt=()=>'';
vm.runInContext(fn('maybeDefaultGenPreset'),ctx);
let applied=0;ctx.applyExample=()=>applied++;ctx.gen={prompt:''};ctx.allowDefaultPreset=false;ctx.maybeDefaultGenPreset();assert.equal(applied,0);ctx.allowDefaultPreset=true;ctx.maybeDefaultGenPreset();assert.equal(applied,1);
for(const lang of ['zh','en','es','pt','ja','ko']) {
 const pack={};vm.runInNewContext(readFileSync('js/lang/'+lang+'.js','utf8'),{VSI18n:{register:(l,m,v)=>Object.assign(pack,v)}});
 for(const key of ['credits_insufficient','credits_insufficient_tip','credits_insufficient_suggest','prompt_clear'])assert.doesNotMatch(pack[key],/官网|official site|sitio oficial|site oficial|公式サイト|공식 사이트/i);
 assert.equal((pack.credits_insufficient_tip.match(/%s/g)||[]).length,2);
}
console.log('generate credit gate, raised/unknown credits, Clear, deselect, persisted-empty/default and copy passed');
const chatSrc=readFileSync('js/chat-pilot.js','utf8');
function chatFn(name){let a=chatSrc.indexOf('  function '+name+'('),b=chatSrc.indexOf('\n  function ',a+10);return chatSrc.slice(a,b);}
const disk={};let shown=[],plans=[];
const chat=vm.createContext({window:{VSApi:{store:{set:(k,v)=>disk['vsw.'+k]=JSON.stringify(v),get:(k,d)=>disk['vsw.'+k]?JSON.parse(disk['vsw.'+k]):d}}},planningInterview:false,planningDraft:'',planningInterviewCompleted:false,messages:[{role:'user',content:'cat'},{role:'assistant',content:JSON.stringify({assistant_message:'ready',ready:true,plan:{prompt:'cat'}})}],lastPlan:{prompt:'cat'},$:()=>({innerHTML:''}),appendBubble:(r,t)=>shown.push([r,t]),parseAssistantPayload:JSON.parse,renderPlanCard:p=>plans.push(p)});
vm.runInContext(chatFn('persistConversation')+chatFn('restoreConversation'),chat);
chat.persistConversation();chat.messages=[];chat.lastPlan=null;assert.equal(chat.restoreConversation(),true);assert.equal(shown.length,2);assert.equal(plans[0].prompt,'cat');assert.doesNotMatch(JSON.stringify(disk),/access_token|api_key/);
chat.messages=Array.from({length:200},()=>({role:'user',content:'x'.repeat(20000)}));chat.persistConversation();assert(JSON.stringify(disk).length<300000);
console.log('chat storage reload with plan cards and bounded content passed');
let signed=false;
ctx.O={isLoggedIn:()=>signed,getProfile:()=>({credits:1})};vm.runInContext(fn('oauthCredits'),ctx);
assert.equal(ctx.oauthCredits(),null);signed=true;assert.equal(ctx.oauthCredits(),1);
console.log('Signed-out cached balance stays ungated');
