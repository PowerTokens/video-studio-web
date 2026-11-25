import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read = name => fs.readFileSync(new URL('../js/'+name+'.js', import.meta.url),'utf8');
const data = new Map(), nodes=[]; let valid=false, profile={name:'Fake'}, login=0, opens=0, calls=[], auth=false, failed=[];
const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
function element(tag) { const n={tag,children:[],listeners:{},appendChild(c){this.children.push(c);},setAttribute(k,v){this[k]=v;},addEventListener(k,f){this.listeners[k]=f;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},remove(){}};nodes.push(n);return n; }
const c=vm.createContext({URL,Date,localStorage:storage,sessionStorage:storage,console:{info(){}},setTimeout:()=>0,clearTimeout(){},AbortSignal:{timeout:()=>null},document:{createElement:element,createElementNS:(_,t)=>element(t),body:{appendChild(){}}},window:{open(){opens++;return {close(){opens--;},location:{replace(){}}};}},VSOauth:{isLoggedIn:()=>valid,getAccessToken:()=>valid?'fake-token':'',getProfile:()=>profile},VSAnalytics:{notify_payment_failed:p=>failed.push(p)},fetch:async(url,opts)=>{calls.push({url,opts});return {ok:!auth,status:auth?401:200,json:async()=>auth?{code:401}:{code:200,data:{}}};}});
for(const name of ['payment-packages','payment-copy','payment']) vm.runInContext(read(name),c);
c.VSPaymentCopy=c.window.VSPaymentCopy;
const opts={lang:'en',login(){login++;},refresh(){}};
const last=cls=>nodes.filter(n=>n.className===cls).at(-1);
const pick=k=>nodes.filter(n=>n['data-selection']===k).at(-1);
for (const prior of [null,{name:'Fake'}]) {
 profile=prior;c.VSPayment.show(opts);assert.ok(last('payment-picker').open);assert.equal(login,0);
 pick('22').onclick();nodes.filter(n=>n['data-channel']==='paypal').at(-1).onclick();
 await last('payment-buy').onclick();assert.equal(calls.length,0);assert.equal(opens,0);assert.equal(last('payment-auth-notice').hidden,false);
 assert.equal(last('payment-confirm').textContent,prior?'Confirm sign-in':'Continue to sign in');
 last('payment-confirm').onclick();assert.equal(login,1);const intent=JSON.parse(data.get('vsw.topup_intent'));assert.deepEqual(Object.keys(intent).sort(),['at','channel','selection']);assert.equal(intent.selection,'22');assert.equal(intent.channel,'paypal');
 assert.ok(!data.get('vsw.topup_intent').includes('token'));last('payment-picker').close();login=0;
}
// App passes the billing source only through the explicit login callback.
assert.match(read('app'),/login: function \(\) \{ startOauthLogin\('billing'\); \}/);
for(const selection of ['22','custom']) {
 valid=true;profile={name:'Fake'};data.set('vsw.topup_intent',JSON.stringify({selection,channel:'paypal',custom_amount:17,at:Date.now()}));
 const count=nodes.length;c.VSPayment.resumeIntent(opts);assert.ok(nodes.length>count);assert.equal(pick(selection)['aria-pressed'],'true');assert.equal(nodes.filter(n=>n['data-channel']==='paypal').at(-1).checked,true);
 if(selection==='custom') assert.equal(Number(last('payment-custom').children[1].value),17);
 assert.equal(data.has('vsw.topup_intent'),false);assert.equal(calls.length,0);const once=nodes.length;c.VSPayment.resumeIntent(opts);assert.equal(nodes.length,once);last('payment-picker').close();
}
for(const value of [{selection:'22',channel:'paypal',at:Date.now()-900001},{at:Date.now()},'bad']) {data.set('vsw.topup_intent',JSON.stringify(value));const count=nodes.length;c.VSPayment.resumeIntent(opts);assert.equal(nodes.length,count);assert.equal(data.has('vsw.topup_intent'),false);}
c.VSPayment.show(opts);auth=true;await last('payment-buy').onclick();assert.equal(last('payment-auth-notice').hidden,false);assert.equal(failed.at(-1).error_code,'AUTH');assert.equal(opens,0);
assert.deepEqual(Object.keys(JSON.parse(calls[0].opts.body)).sort(),['amount','package_id','payment_channel']);assert.deepEqual(Object.keys(calls[0].opts.headers).sort(),['Authorization','Content-Type']);
const app=read('app'), extract=name=>app.slice(app.indexOf('  function '+name+'('),app.indexOf('\n  function ',app.indexOf('  function '+name+'(')+1));
const header={};c.$=id=>header[id]??=(element('div'));c.O=c.VSOauth;c.show=(n,on)=>n.hidden=!on;c.t=k=>k;c.localeNum=String;c.renderNokeyBanner=()=>{};c.renderGenCost=()=>{};
vm.runInContext(extract('renderOauthAccount')+'\n'+extract('oauthCredits'),c);
profile={name:'Fake',credits:99};
for(const signed of [false,true]) {valid=signed;c.renderOauthAccount();assert.equal(header['header-oauth-login'].hidden,signed);assert.equal(header['oauth-account'].hidden,!signed);assert.equal(header['oauth-logout-btn'].hidden,!signed);assert.equal(c.oauthCredits(),signed?99:null);}
assert.match(app,/syncAuthValidity\(\);/);assert.match(app,/visibilitychange', syncAuthValidity/);
console.log('smoke-topup-reconfirm: ok (offline DOM, intent, AUTH and header)');
