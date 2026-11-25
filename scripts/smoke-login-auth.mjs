import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const source=fs.readFileSync('js/oauth.js','utf8');
const values=new Map();
const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
const account={}; const failures=[]; let exchanges=0, starts=0, navigations=0; const unsigned=[];
function context() {
 const listeners={};
 const c={addEventListener:(name,fn)=>listeners[name]=fn, listeners, URL,URLSearchParams,TextEncoder,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),crypto:webcrypto,
 localStorage:storage,navigator:{standalone:true},history:{replaceState(a,b,url){c.cleaned=url;}},
 location:{href:'https://example.test/studio/oauth/callback.html?code=fake&state=fake',search:'',hostname:'example.test',assign(){ navigations++; }},
 VSApi:{store:{get:(k,d)=>account[k]??d,set:(k,v)=>account[k]=v,remove:k=>delete account[k]}},
 VSAnalytics:{notifyLoginReturnUnsigned:r=>unsigned.push(r),notifyLoginStart(){starts++;},notifyLoginFailed(p){failures.push(p);},notifyLoginSuccess(){}},
 fetch:async url=>{exchanges++;return {ok:true,text:async()=>JSON.stringify(url.endsWith('/token')?{access_token:'fake-token'}:{name:'Fake'})};}};
 c.window=c;vm.runInNewContext(source,c);return c;
}
const first=context(); await first.VSOauth.startLogin({returnHash:'chat'});
const state=storage.getItem('vsw.oauth.state'), verifier=storage.getItem('vsw.oauth.code_verifier');
await first.VSOauth.startLogin({returnHash:'generate'});
assert.equal(starts,1);assert.equal(storage.getItem('vsw.oauth.code_verifier'),verifier);assert.equal(storage.getItem('vsw.oauth.state'),state);
// A different window cannot overwrite the live shared PKCE.
const blocked=context();assert.equal((await blocked.VSOauth.startLogin()).pending,true);
assert.equal(storage.getItem('vsw.oauth.state'),state);
// Returning to the initiating window permits an explicit retry immediately.
first.listeners.pageshow({persisted:true});
await first.VSOauth.startLogin({returnHash:'chat'});
assert.equal(navigations,2);assert.equal(starts,2);
assert.notEqual(storage.getItem('vsw.oauth.state'),state);
assert.notEqual(storage.getItem('vsw.oauth.code_verifier'),verifier);
const retryState=storage.getItem('vsw.oauth.state');
await first.VSOauth.startLogin();assert.equal(navigations,2);
assert.equal(storage.getItem('vsw.oauth.state'),retryState);
const other=context();const query='?code=fake-code&state='+retryState;
const result=await other.VSOauth.handleCallback(query);
assert.equal(result.ok,true);assert.equal(result.returnToStandalone,true);assert.equal(exchanges,2);
assert.ok(!new URL(other.cleaned).searchParams.has('code'));
await first.VSOauth.handleCallback(query);assert.equal(exchanges,2);assert.equal(failures.length,0);
first.VSOauth.clearSession();await first.VSOauth.handleCallback(query);assert.equal(exchanges,2);assert.equal(failures.length,0);
await first.VSOauth.handleCallback('?code=fake&state=unknown');assert.equal(failures.at(-1).authReason,'state_mismatch');
await first.VSOauth.handleCallback('');
assert.equal(unsigned.at(-1),'missing_code');
assert.equal(failures.length,1); // Only the real state_mismatch above.
// Exercise the actual Generate gate; only the rendered confirm invokes OAuth.
const app=fs.readFileSync('js/app.js','utf8');
const gate=app.match(/  function promptForKeyOrLogin\(errEl\) \{[\s\S]*?\n  \}/)[0];
let clicked, count=0;const target={textContent:'',appendChild(){}};
const c={O:{getProfile:()=>null},t:k=>k,show(){},toast(){},$:()=>target,document:{createElement:()=>({addEventListener:(k,f)=>clicked=f})},startOauthLogin:s=>{assert.equal(s,'generate');count++;},setTab(){}};
vm.runInNewContext(gate+';promptForKeyOrLogin();',c);assert.equal(count,0);clicked();assert.equal(count,1);
assert.match(app,/login: function \(\) \{ startOauthLogin\('billing'\)/);
assert.match(fs.readFileSync('js/oauth-callback.js','utf8'),/result.returnToStandalone/);
console.log('Shared PKCE, replay, URL cleanup, standalone guidance and Generate confirmation passed');

// Ignored starts must release the actual app's busy state.
const start=app.match(/  function startOauthLogin\(source\) \{[\s\S]*?\n  \}/)[0];
const busy=[];
const ui={O:{startLogin:()=>Promise.resolve({pending:true})},$:()=>null,show(){},toast(){},currentTabName:()=> 'chat',setOauthBusy:v=>busy.push(v)};
vm.runInNewContext(start+";startOauthLogin('header');",ui);
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(busy,[true,false]);
