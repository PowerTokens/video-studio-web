// Offline lifecycle tests: no live requests or charges.
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = name => fs.readFileSync(new URL('../js/'+name+'.js',import.meta.url),'utf8');
function app(saved = {}) {
  const nodes=[], timers=new Map(), handlers={}, events=[]; let id=0, now=1000, order=0;
  const storage={...saved};
  function el(tag) { const n={tag,children:[],listeners:{},appendChild(c){this.children.push(c);},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close();},remove(){}};nodes.push(n);return n; }
  const c=vm.createContext({URL, Date:class extends Date {static now(){return now;}}, AbortSignal:{timeout(){}},
    setTimeout:f=>{timers.set(++id,f);return id;},clearTimeout:i=>timers.delete(i),
    addEventListener:(k,f)=>handlers[k]=f,
    document:{hidden:false,addEventListener:(k,f)=>handlers[k]=f,createElement:el,createElementNS:(_,tag)=>el(tag),body:{appendChild(){}}},
    localStorage:new Proxy(storage,{get:(o,k)=>k==='getItem'?k=>o[k]||null:k==='setItem'?(k,v)=>o[k]=v:k==='removeItem'?k=>delete o[k]:o[k]}),
    sessionStorage:{removeItem(){}},
    window:{open:()=>({location:{replace(){}},close(){}})},
    VSOauth:{isLoggedIn:()=>true,getAccessToken:()=> 'synthetic-token',getProfile:()=>({sub:'synthetic-owner',credits:10}),refreshProfile:async()=>{throw Error('offline');}},
    VSPaymentCopy:{en:Array.from({length:17},(_,i)=>String(i))},
    VSAnalytics:Object.fromEntries(['success','cancelled','start','checkout_opened','dialog_closed'].map(e=>['notify_payment_'+e,p=>events.push({event:e,props:p})]))
  });
  let status=0;
  c.VSAnalytics.flush=()=>{assert.ok(Object.keys(storage).some(k=>k.startsWith('vs-payment.pending.')));events.push({event:'flush'});};
  c.fetch=async (url,options)=>{assert.ok(!Object.keys(options.headers).some(k=>k.toLowerCase()==='x-client')); const body=JSON.parse(options.body); if(url.endsWith('/create')) assert.deepEqual(Object.keys(body).sort(),['amount','package_id','payment_channel']); else assert.deepEqual(Object.keys(body),['order_no']); return({ok:true,status:200,json:async()=>url.endsWith('/create')?{code:200,data:{orderNo:'ORDER_TEST_'+(++order),redirectUrl:'https://powertokens.ai/test'}}:{code:200,data:{status}}});};
  for(const name of ['payment-packages','payment']) vm.runInContext(source(name),c);
  const settle=()=>new Promise(r=>setImmediate(r));
  return {c,events,storage,handlers,timers,nodes,settle,set status(v){status=v;},expire(ms=300001){now+=ms;},
    async start(){c.VSPayment.show({lang:'en',refresh(){},login(){}});await nodes.find(n=>n.className==='payment-buy').onclick();},
    async tick(){const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);await entry[1]();}await settle();}};
}
for(const status of [1,2,'1','2']) {
  const a=app();await a.start();assert.ok(a.events.some(e=>e.event==='checkout_opened'));
  a.nodes.find(n=>n.tag==='dialog').close();a.status=status;await a.tick();
  a.handlers.pageshow();a.handlers.visibilitychange();await a.settle();
  assert.equal(a.events.filter(e=>e.event===(Number(status)===1?'success':'cancelled')).length,1);
  assert.equal(a.storage['vs-payment'],undefined);
  for(const e of a.events.filter(e=>['success','cancelled'].includes(e.event))) assert.deepEqual(Object.keys(e.props).sort(),['channel','package_id']);
}
const a=app();await a.start();const b=app(a.storage);b.expire();b.status=1;b.handlers.pageshow();await b.settle();
assert.equal(b.events.filter(e=>e.event==='success').length,1);
const expired=app(a.storage);expired.expire(48*60*60*1000);expired.handlers.pageshow();await expired.settle();assert.equal(expired.events.length,0);assert.equal(expired.timers.size,0);
const pending=app();await pending.start();pending.c.VSOauth.refreshProfile=async()=>({credits:100});await pending.tick();assert.equal(pending.events.filter(e=>e.event==='success').length,1);
for(const status of [1,2]) {const x=app();await x.start();x.status=status;x.c.VSOauth.refreshProfile=async()=>({credits:100});await x.tick();assert.equal(x.events.filter(e=>e.event===(status===1?'success':'cancelled')).length,1);}
const relog=app();await relog.start();relog.c.VSOauth.isLoggedIn=()=>false;await relog.tick();assert.ok(Object.keys(relog.storage).some(k=>k.startsWith('vs-payment.pending.')));
relog.c.VSOauth.isLoggedIn=()=>true;relog.c.VSOauth.getAccessToken=()=> 'synthetic-replacement';relog.status=1;relog.c.VSPayment.resume();await relog.settle();assert.equal(relog.events.filter(e=>e.event==='success').length,1);
const multi=app();await multi.start();const first=Object.values(multi.storage).map(v=>JSON.parse(v)).find(v=>v.order);
const second={...first,order:'ORDER_TEST_2'};multi.storage['vs-payment.pending.ORDER_TEST_2']=JSON.stringify(second);
multi.c.fetch=async(_url,opts)=>({ok:true,status:200,json:async()=>({code:200,data:{status:JSON.parse(opts.body).order_no==='ORDER_TEST_1'?1:0}})});
await multi.tick();assert.equal(multi.events.filter(e=>e.event==='success').length,1);assert.ok(multi.storage['vs-payment.pending.ORDER_TEST_2']);
const replay=app({...multi.storage,'vs-payment.pending.ORDER_TEST_1':JSON.stringify(first)});replay.handlers.pageshow();await replay.settle();assert.equal(replay.events.length,0);
console.log('Payment recovery: terminal statuses, credit fallback, 48h TTL, reload, multiple orders, re-login, flush ordering and dedupe passed.');
for (const status of [1,2]) {
  const a=app(), delivered=[];
  vm.runInContext(source('analytics'),a.c);
  a.c.VSAnalytics.boot({transport:item=>delivered.push(item),setTimeout:()=>0});
  await a.start();a.nodes.find(n=>n.tag==='dialog').close();a.status=status;await a.tick();
  a.c.VSAnalytics.flush();
  const terminal=delivered.filter(e=>e.event===(status===1?'payment_success':'payment_cancelled'));
  assert.equal(terminal.length,1);
  for(const key of ['token','Authorization','order_no','orderNo','redirectUrl','amount','credits','balance','email']) assert.ok(!(key in terminal[0].properties));
}
console.log('Both terminal events passed analytics consent, sanitize, dedupe, queue and transport flush.');
