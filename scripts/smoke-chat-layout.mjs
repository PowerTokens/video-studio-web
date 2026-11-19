import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('js/chat-layout.js', 'utf8');
function measure({phone=false, height=800, keyboard=0, work=900, banner=0}={}) {
  const props = {};
  const box = h => ({getBoundingClientRect:()=>({height:h,top:160})});
  const nodes = {'.page':{style:{setProperty:(k,v)=>props[k]=parseFloat(v)}},'.chat-dock':box(150),'.chat-shell':box(640),'.pwa-install-banner':{...box(banner),hidden:!banner}};
  const win = {innerHeight:height,outerHeight:height+80,screenY:0,screen:{availTop:0,availHeight:work},visualViewport:{height:height-keyboard,offsetTop:0,addEventListener(){}},matchMedia:q=>({matches:q.includes('max-width')?phone:!phone}),getComputedStyle:()=>({bottom:'0'}),addEventListener(){}};
  vm.runInNewContext(source,{window:win,document:{querySelector:k=>nodes[k],getElementById:()=>null}});
  return props;
}
assert.equal(measure()['--chat-room-height'],624);
assert.equal(measure({height:650})['--chat-room-height'],474);
assert.equal(measure({work:820})['--chat-room-height'],564);
assert.equal(measure({phone:true,keyboard:300})['--chat-room-height'],340);
assert.equal(measure({banner:80})['--chat-room-height'],544);
assert.equal(measure()['--chat-dock-height'],150);
console.log('Chat viewport/work-area/keyboard/banner smoke passed');
