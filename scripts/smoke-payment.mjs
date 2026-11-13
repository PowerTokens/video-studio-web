import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const diagnostics = [];
const context = vm.createContext({URL, console:{info:(tag, details)=>diagnostics.push({tag, details})}});
for (const file of ['payment-packages','payment']) vm.runInContext(fs.readFileSync(new URL('../js/'+file+'.js',import.meta.url),'utf8'),context);
const store = {};
Object.assign(context, {localStorage:{getItem:k=>store[k] || null,setItem:(k,v)=>{store[k]=v;},removeItem:k=>{delete store[k];}}});
vm.runInContext(fs.readFileSync(new URL('../js/analytics.js',import.meta.url),'utf8'),context);
const events = [];
context.VSAnalytics.boot({transport:item=>events.push(item),setTimeout:()=>0});
const P = context.VSPayment;
assert.equal(JSON.stringify(P.payload(22,1,'limeng')),JSON.stringify({amount:20,package_id:22,payment_channel:'limeng'}));
for (const [id, amount] of [[22,20],[23,50]]) assert.equal(P.payload(id,1,'paypal').amount,amount);
assert.throws(()=>P.payload(24,200,'limeng'));
assert.equal(P.payload(33,5,'limeng').amount,5);
assert.equal(P.payload(33,2000,'paypal').amount,2000);
for (const amount of [4,2001,5.5,'bad']) assert.throws(()=>P.payload(33,amount,'paypal'));
assert.throws(()=>P.payload(40,20,'limeng'));
for (const url of ['http://powertokens.ai','https://powertokens.ai.evil.test','https://x@powertokens.ai','https://powertokens.ai:444']) assert.equal(P.validRedirect(url),false);
assert.equal(P.validRedirect('https://gateway.powerwinpay.com/payment/mock'),true);
console.log('Payment validation passed (no network).');
const nodes = [];
function element(tag) {
  const n = {tag, children:[], value:'', open:false, appendChild(c){this.children.push(c); if(tag==='select' && !this.value)this.value=c.value;}, setAttribute(k,v){this[k]=String(v);}, addEventListener(){}, showModal(){this.open=true;}, close(){this.open=false;}, remove(){}};
  nodes.push(n); return n;
}
const requests=[]; let accessToken='mock-token'; let loggedIn=false, logged=0, profile={sub:'test',credits:100};
Object.assign(context, {
  VSPaymentCopy:{en:Array.from({length:17},(_,i)=>'copy'+i)},
  document:{createElement:element,createElementNS:(_ns,tag)=>element(tag),body:{appendChild(){}}},
  VSOauth:{isLoggedIn:()=>loggedIn,getAccessToken:()=> accessToken,getProfile:()=>profile,refreshProfile:async()=>{profile.credits=20100;return profile;}},
  window:{open:()=>({location:{replace(){}},close(){}})},
  AbortSignal:{timeout:()=>null},setTimeout:()=>1,clearTimeout(){},
  sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  fetch:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>url.endsWith('/v1/payment/create')?{code:200,data:{orderNo:'mock-order',redirectUrl:'https://powertokens.ai/test'}}:{code:200,data:{status:1}}};}
});
P.show({lang:'en',login:()=>logged++,refresh(){}});assert.equal(logged,1);assert.equal(nodes.length,0);
loggedIn=true;
P.show({lang:'en',login(){},refresh(){}});
assert.equal(nodes.filter(n=>n.tag==='select').length,0);
for (const method of nodes.filter(n=>n.className==='payment-method')) {
  assert.equal(method.children[0].tag,'input');
  assert.equal(method.children[0].type,'radio');
}
const pick = id => nodes.find(n=>n['data-selection']===id);
assert.equal(pick('preset-5')['aria-pressed'],'true');
assert.equal(pick('custom')['aria-pressed'],'false');
assert.deepEqual(nodes.filter(n=>n.className==='payment-card').map(n=>n['data-selection']),['preset-5','22','23','custom']);
assert.equal(nodes.filter(n=>n.className==='payment-card' && n['aria-pressed']==='true').length,1);
assert.equal(pick('preset-5').children.find(n=>n.className==='payment-price').textContent,'$5');
assert.equal(pick('preset-5').children.find(n=>n.className==='payment-credits').textContent,(5000).toLocaleString());
for (const key of ['preset-5','22','23','custom']) assert.equal(pick(key).children.filter(n=>n.className==='payment-badge').length,key==='preset-5'?1:0);
assert.deepEqual(Array.from(context.VSPaymentPackages,p=>p.id).sort(),[22,23,33]);
assert.equal(context.VSPaymentPackages.find(p=>p.id===33).amount_type,2);
assert.equal(context.VSPaymentPackages.find(p=>p.id===22).is_recommended,0);
assert.equal(nodes.find(n=>n.className==='payment-custom').hidden,true);
assert.equal(Number(nodes.find(n=>n.className==='payment-custom').children[1].value),5);
assert.ok(pick('22'));
assert.ok(pick('23'));
assert.equal(pick('24'),undefined);
await nodes.find(n=>n.textContent==='copy5').onclick();
assert.equal(requests.length,1);
assert.equal(requests[0].url,'https://powertokens.ai/api/v1/payment/create');
assert.equal(requests[0].opts.credentials,'omit');
assert.deepEqual(Object.keys(requests[0].opts.headers).sort(),['Authorization','Content-Type']);
assert.equal(requests[0].opts.headers.Authorization,'Bearer mock-token');
assert.deepEqual(JSON.parse(requests[0].opts.body),{amount:5,package_id:33,payment_channel:'limeng'});
await nodes.find(n=>n.textContent==='copy7').onclick();
// Manual handler starts an async check; flush its mocked network promises.
await new Promise(resolve=>setImmediate(resolve));
assert.equal(requests.length,2);
assert.equal(requests[1].url,'https://powertokens.ai/api/finance/get-order-info');
assert.equal(requests[1].opts.headers.Authorization,'Bearer mock-token');
assert.equal(JSON.parse(requests[1].opts.body).order_no,'mock-order');
assert.equal(nodes.find(n=>n.tag==='p').textContent,'copy9');
console.log('OAuth gate, create, CORS headers, status and refresh passed (mock network).');

// Official cards remain selectable and create their fixed-price payloads.
for (const [id, amount] of [['22',20],['23',50]]) {
  pick(id).onclick();
  assert.equal(pick(id)['aria-pressed'],'true');
  assert.equal(nodes.find(n=>n.className==='payment-custom').hidden,true);
  nodes.find(n=>n['data-channel']==='paypal').onchange();
  assert.equal(nodes.find(n=>n['data-channel']==='paypal').checked,true);
  nodes.find(n=>n['data-channel']==='limeng').onchange();
  await nodes.find(n=>n.className==='payment-buy').onclick();
  assert.deepEqual(JSON.parse(requests.at(-1).opts.body),{amount,package_id:Number(id),payment_channel:'limeng'});
  await nodes.find(n=>n.className==='payment-check').onclick();
  await new Promise(resolve=>setImmediate(resolve));
}

// Custom is a separate editable selection; returning to $5 ignores its value.
const custom = nodes.find(n=>n.className==='payment-custom');
const input = custom.children[1];
assert.equal(input.min,5); assert.equal(input.max,2000); assert.equal(input.step,1);
for (const amount of [5,15,2000]) {
  pick('custom').onclick();
  assert.equal(custom.hidden,false);
  assert.equal(pick('preset-5')['aria-pressed'],'false');
  assert.equal(pick('custom')['aria-pressed'],'true');
  input.value=amount; input.oninput();
  await nodes.find(n=>n.className==='payment-buy').onclick();
  assert.deepEqual(JSON.parse(requests.at(-1).opts.body),{amount,package_id:33,payment_channel:'limeng'});
  await nodes.find(n=>n.className==='payment-check').onclick();
  await new Promise(resolve=>setImmediate(resolve));
}
pick('preset-5').onclick();
assert.equal(custom.hidden,true);
assert.equal(pick('custom')['aria-pressed'],'false');
assert.equal(pick('preset-5')['aria-pressed'],'true');
await nodes.find(n=>n.className==='payment-buy').onclick();
assert.deepEqual(JSON.parse(requests.at(-1).opts.body),{amount:5,package_id:33,payment_channel:'limeng'});
await nodes.find(n=>n.className==='payment-check').onclick();
await new Promise(resolve=>setImmediate(resolve));

// Normalize prefixes stored in OAuth to a single Bearer prefix.
accessToken = ' Bearer bearer mock-token ';
nodes.find(n=>n.tag==='dialog').open = false;
P.show({lang:'en',login(){},refresh(){}});
assert.equal(nodes.filter(n=>n['data-selection']==='preset-5').at(-1)['aria-pressed'],'true');
await nodes.filter(n=>n.className==='payment-buy').at(-1).onclick();
assert.equal(requests.at(-1).url,'https://powertokens.ai/api/v1/payment/create');
assert.deepEqual(JSON.parse(requests.at(-1).opts.body),{amount:5,package_id:33,payment_channel:'limeng'});
assert.equal(requests.at(-1).opts.headers.Authorization,'Bearer mock-token');
console.log('Embedded OAuth Bearer prefix normalization passed (mock network).');

await nodes.filter(n=>n.className==='payment-check').at(-1).onclick();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(requests.at(-1).url,'https://powertokens.ai/api/finance/get-order-info');
assert.equal(requests.at(-1).opts.headers.Authorization,'Bearer mock-token');

for (const {details} of diagnostics.filter(x=>x.details.stage === 'request')) {
  assert.equal(details.headerUsesRawToken,false);
  assert.equal(details.headerUsesBearer,true);
}
assert.equal(JSON.stringify(diagnostics).includes('mock-token'),false);

// Walk create failures through the actual dialog handler, entirely in the VM.
for (const mode of ['rejected','redirect','network']) {
  nodes.filter(n=>n.tag==='dialog').at(-1).open=false;
  P.show({lang:'en',login(){},refresh(){}});
  context.fetch = async()=>{
    if (mode==='network') throw Error('private exception');
    return {ok:mode!=='rejected',json:async()=>({code:200,data:{orderNo:'mock-order',redirectUrl:'https://untrusted.invalid'}})};
  };
  await nodes.filter(n=>n.className==='payment-buy').at(-1).onclick();
}
const queued = context.VSAnalytics.pending();
const paymentEvents = queued.filter(item=>item.event.startsWith('payment_'));
assert.equal(paymentEvents.filter(x=>x.event==='payment_start').length,11);
assert.equal(paymentEvents.filter(x=>x.event==='payment_checkout_opened').length,8);
assert.equal(paymentEvents.filter(x=>x.event==='payment_success').length,8);
assert.equal(paymentEvents.filter(x=>x.event==='payment_failed').length,3);
for (const item of queued) {
  assert.equal(item.properties.utm_source,'videostudio');
  assert.equal(item.properties.initial_utm_source,'videostudio');
  for (const key of ['amount','credits','balance','orderNo','order_no','redirectUrl','token','url']) assert.ok(!(key in item.properties));
}
// Even a throwing analytics integration must leave checkout functional.
context.VSAnalytics.notify_payment_start = ()=>{throw Error('analytics unavailable');};
context.fetch = async()=>({ok:false,json:async()=>({code:400})});
await nodes.filter(n=>n.className==='payment-buy').at(-1).onclick();
assert.equal(nodes.filter(n=>n.className==='payment-buy').at(-1).disabled,false);
console.log('Mock payment success, rejection, invalid redirect, network failure and fail-open analytics passed; queued attribution verified.');
