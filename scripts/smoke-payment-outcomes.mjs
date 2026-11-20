// Offline lifecycle tests: no live requests or charges.
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = name => fs.readFileSync(new URL('../js/'+name+'.js',import.meta.url),'utf8');
function app(saved = {}) {
  const nodes=[], timers=new Map(), handlers={}, events=[]; let id=0, now=1000;
  const storage={...saved};
  function el(tag) { const n={tag,children:[],listeners:{},appendChild(c){this.children.push(c);},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close();},remove(){}};nodes.push(n);return n; }
  const c=vm.createContext({URL, Date:class extends Date {static now(){return now;}}, AbortSignal:{timeout(){}},
    setTimeout:f=>{timers.set(++id,f);return id;},clearTimeout:i=>timers.delete(i),
    addEventListener:(k,f)=>handlers[k]=f,
    document:{hidden:false,addEventListener:(k,f)=>handlers[k]=f,createElement:el,createElementNS:(_,tag)=>el(tag),body:{appendChild(){}}},
    sessionStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]},
    window:{open:()=>({location:{replace(){}},close(){}})},
    VSOauth:{isLoggedIn:()=>true,getAccessToken:()=> 'synthetic-token',getProfile:()=>({sub:'synthetic-owner',credits:10}),refreshProfile:async()=>{throw Error('offline');}},
    VSPaymentCopy:{en:Array.from({length:17},(_,i)=>String(i))},
    VSAnalytics:Object.fromEntries(['success','cancelled','start','checkout_opened','dialog_closed'].map(e=>['notify_payment_'+e,p=>events.push({event:e,props:p})]))
  });
  let status=0;
  c.fetch=async url=>({ok:true,status:200,json:async()=>url.endsWith('/create')?{code:200,data:{orderNo:'synthetic-reference',redirectUrl:'https://powertokens.ai/test'}}:{code:200,data:{status}}});
  for(const name of ['payment-packages','payment']) vm.runInContext(source(name),c);
  const settle=()=>new Promise(r=>setImmediate(r));
  return {c,events,storage,handlers,timers,nodes,settle,set status(v){status=v;},expire(){now+=300001;},
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
const a=app();await a.start();const b=app(a.storage);b.status=1;b.handlers.pageshow();await b.settle();
assert.equal(b.events.filter(e=>e.event==='success').length,1);
const expired=app(a.storage);expired.expire();expired.handlers.pageshow();await expired.settle();assert.equal(expired.events.length,0);assert.equal(expired.timers.size,0);
const pending=app();await pending.start();pending.c.VSOauth.refreshProfile=async()=>({credits:100});await pending.tick();assert.equal(pending.events.filter(e=>e.event==='success').length,0);
pending.c.fetch=async()=>{throw Error('offline');};await pending.tick();assert.equal(pending.events.filter(e=>e.event==='success').length,1);
console.log('Payment outcomes: closed-dialog paid/cancelled, failed refresh, dedupe, reload, deadline, official status precedence and private payloads passed.');
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
