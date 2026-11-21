'use strict';
// Execute the unchanged real handler and proposed minimal patch in a sandbox.
// The browser's user-activation requirements cannot be simulated here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = process.argv[2], patchedPath = process.argv[3];
if (!root || !patchedPath) throw Error('Pass PRIVATE original and locally patched Test13 v224/base29.html paths');
const original = fs.readFileSync(root, 'utf8');
const changed = fs.readFileSync(patchedPath, 'utf8');
const anchor = "window.addEventListener('beforeunload', e => {";
function handler(source) {
  const start = source.indexOf(anchor);
  const end = source.indexOf('\n  });',start);
  assert.ok(start >= 0 && end > start,'handler anchors must exist');
  return source.slice(start, end + 6);
}
function trigger(source, {dirty=false,saving=false,mode='idb',backend='Local',virtual=false,items=1} = {}) {
  let listener, calls=0;
  const state={dirty,saving};
  const Local = {};
  const Backend = backend==='Local'?Local:{};
  const Store={mode};
  const S={board:{items:new Array(items).fill({}),virtual}};
  const sandbox={Local,Backend,Store,S,window:{addEventListener:(event,fn)=>{
    assert.equal(event,'beforeunload');listener=fn;
  }}, saveNow:()=>{calls++;state.dirty=false;if(!virtual)state.saving=true;}};
  Object.defineProperties(sandbox,{dirty:{get(){return state.dirty},set(v){state.dirty=v}},saving:{get(){return state.saving},set(v){state.saving=v}}});
  vm.runInNewContext(handler(source),sandbox,{timeout:1000});
  let prevented=false,returnValue=undefined;
  const evt={preventDefault(){prevented=true;},set returnValue(v){returnValue=v;},get returnValue(){return returnValue;}};
  listener(evt);
  return {prevented,calls,returnValue};
}
let n=0;
function test(name,fn){fn();n++;console.log('PASS',name)}
test('negative control: original misses unsaved IDB edit on unload',()=>{
  const x=trigger(original,{dirty:true});assert.equal(x.prevented,false);assert.equal(x.calls,1);
});
test('negative control: original misses in-flight IDB save on unload',()=>{
  const x=trigger(original,{saving:true});assert.equal(x.prevented,false);assert.equal(x.calls,0);
});
test('new code warns on unsaved IDB edit, still attempts save',()=>{
  const x=trigger(changed,{dirty:true});assert.equal(x.prevented,true);assert.equal(x.calls,1);
});
test('new code warns while save is in progress',()=>{
  const x=trigger(changed,{saving:true});assert.equal(x.prevented,true);assert.equal(x.calls,0);
});
test('new code keeps warning for async virtual-board write',()=>{
  const x=trigger(changed,{dirty:true,virtual:true});assert.equal(x.prevented,true);assert.equal(x.calls,1);
});
test('new code allows clean persisted board to close',()=>{
  const x=trigger(changed,{dirty:false,saving:false,items:1});assert.equal(x.prevented,false);assert.equal(x.calls,0);
});
test('new code preserves legacy in-memory warning',()=>{
  const x=trigger(changed,{mode:'mem',items:1});assert.equal(x.prevented,true);assert.equal(x.calls,0);
});
test('new code allows empty in-memory board to close',()=>{
  const x=trigger(changed,{mode:'mem',items:0});assert.equal(x.prevented,false);assert.equal(x.calls,0);
});
test('new code warns for unsaved non-local backend',()=>{
  const x=trigger(changed,{backend:'Cloud',dirty:true});assert.equal(x.prevented,true);assert.equal(x.calls,1);
});
test('new code warns for in-flight non-local backend',()=>{
  const x=trigger(changed,{backend:'Cloud',saving:true});assert.equal(x.prevented,true);assert.equal(x.calls,0);
});
console.log('TOTAL '+n+'/'+n+' PASS');
