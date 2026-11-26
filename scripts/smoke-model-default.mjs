import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx = vm.createContext({window:{}});
vm.runInContext(readFileSync('js/models.js','utf8'),ctx);
const M=ctx.VSModels;
const mini='dreamina-seedance-2-0-mini-260615';
assert.equal(M.DEFAULT_MODEL_ID,mini);
assert.equal(M.MODEL_ORDER[0],mini);
assert.equal(M.listModels()[0].id,mini);
const src=readFileSync('js/app.js','utf8');
const init=src.slice(src.indexOf('  var savedGenForm ='),src.indexOf("  var genNotice ="));
for(const saved of [null,{}, {model:''},{model:'wan3.0-video'},{model:'kling-v3'}]) {
 const c=vm.createContext({M,A:{store:{get:(key,d)=>key==='gen_form'?saved:d,remove(){}}}});
 vm.runInContext(init,c);
 assert.equal(c.gen.model,saved?.model||mini);
}
for(const file of ['js/models.js','js/lang/en.js','js/lang/zh.js']) assert.doesNotMatch(readFileSync(file,'utf8'),/solid default|作为默认选项/);
console.log('Model default, Mini-first picker and saved forms passed');
