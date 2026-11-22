#!/usr/bin/env node
'use strict';
// EXEC-001, source-backed Test13 race characterization. Synthetic timer and storage,
// NOT app_regression.py or real browser execution. No user data is read or logged.
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sourcePath = process.argv[2];
if (!sourcePath) throw Error('Pass the PRIVATE exact Test13 v224/base29.html');
const html = fs.readFileSync(sourcePath, 'utf8');
const hash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
const expected = '3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c';
assert.equal(hash, expected, 'refuse substituted Test13 source');
const start = html.indexOf('function scheduleSave(quiet) {');
const end = html.indexOf('const saveSettings =', start);
assert(start >= 0 && end > start && end - start < 8000, 'source boundaries must match');
const actualSaveCode = html.slice(start,end);
assert(actualSaveCode.includes('b.updatedAt = Date.now();'));

let checks = 0;
async function check(label, fn) { await fn(); checks++; console.log('PASS '+checks+' '+label); }
function prepare({time=2000, initial=1000, fail=false, deferred=false}={}) {
  let nextId=10, finish=null, saveCount=0, status='', when=time;
  const timers = new Map();
  const board={id:'synthetic-board',updatedAt:initial,name:'Synthetic',items:[{id:'synthetic-item',type:'text',text:'fixture'}],assets:{}};
  const S={board,org:{groups:[{id:'synthetic-group'}]}};
  const palette=[{name:'Synthetic',cols:['#112233']}];
  const Backend={saveBoard:async b=>{
    saveCount++;
    assert.equal(b,board);
    if(fail) throw Error('synthetic-storage-failure');
    if(deferred) return new Promise(resolve=>finish=resolve);
    return {removed:false};
  },setLast:async()=>{}};
  const context=vm.createContext({
    S,Backend,Db:{},console:{error:()=>{}},Date:{now:()=>when},
    setTimeout(fn,ms){const id=++nextId;timers.set(id,{fn,ms});return id;},
    clearTimeout(id){timers.delete(id);},
    setStatus(v){status=v;},renderDrawer:()=>{},
  });
  vm.runInContext('let saveTimer = 0, dirty = false, saving = false, saveAgain = false;\n'+actualSaveCode,context);
  function snapshot(){return JSON.stringify([S.board,S.org,palette]);}
  function state(){return vm.runInContext('({dirty,saving,saveAgain,timerHandleNonZero:!!saveTimer})',context);}
  function fire(){const first=timers.entries().next();assert(!first.done, 'expected a real queued fake timer');const [id,val]=first.value;timers.delete(id);return val.fn();}
  return {S,Backend,palette,snapshot,state,fire,timers,
    schedule:()=>vm.runInContext('scheduleSave()',context),save:()=>vm.runInContext('saveNow()',context),
    tick(v){when=v},resolve(v={removed:false}){assert(finish,'deferred write not pending');finish(v);},
    get saveCount(){return saveCount},get status(){return status}};
}
function changedKeys(a,b){const x=JSON.parse(a),y=JSON.parse(b); const changed=[];
  for(let i=0;i<3;i++)for(const k of new Set([...Object.keys(x[i]||{}),...Object.keys(y[i]||{})]))if(JSON.stringify(x[i][k])!==JSON.stringify(y[i][k]))changed.push('/'+i+'/'+k);
  return changed.sort();
}
(async()=>{
 await check('no write: strict snapshot remains identical',()=>{
   const m=prepare(); const a=m.snapshot();assert.equal(a,m.snapshot());assert.equal(m.timers.size,0);
 });
 await check('real scheduleSave queues delayed save without immediately changing board',()=>{
   const m=prepare();const before=m.snapshot();m.schedule();assert.equal(m.timers.size,1);assert.equal(m.state().dirty,true);assert.equal(before,m.snapshot());
 });
 await check('actual saveNow after snapshot changes only board updatedAt, no cache action',async()=>{
   const m=prepare();m.schedule();const before=m.snapshot();await m.fire();const after=m.snapshot();assert.notEqual(before,after);
   assert.deepEqual(changedKeys(before,after),['/0/updatedAt']);assert.equal(m.saveCount,1);
 });
 await check('normal save completed before snapshot does not cause late mismatch',async()=>{
   const m=prepare();m.schedule();await m.fire();const a=m.snapshot();assert.equal(a,m.snapshot());assert.equal(m.timers.size,0);
 });
 await check('genuine pending timer != nonzero timer handle after fire',async()=>{
   const m=prepare();m.schedule();assert.equal(m.timers.size,1);assert.equal(m.state().timerHandleNonZero,true);
   await m.fire();assert.equal(m.timers.size,0);assert.equal(m.state().timerHandleNonZero,true);
 });
 await check('failed Backend.saveBoard still advances in-memory updatedAt',async()=>{
   const m=prepare({fail:true});m.schedule();const before=m.snapshot();await m.fire();assert.deepEqual(changedKeys(before,m.snapshot()),['/0/updatedAt']);
   assert.equal(m.state().dirty,true);assert.equal(m.status,'error');
 });
 await check('write in flight has already changed updatedAt before durable success',async()=>{
   const m=prepare({deferred:true});m.schedule();const before=m.snapshot();const request=m.fire();
   assert.equal(m.state().saving,true);assert.deepEqual(changedKeys(before,m.snapshot()),['/0/updatedAt']);
   m.resolve();await request;assert.equal(m.state().saving,false);
 });
 await check('direct saveNow without dirty flag also advances updatedAt in original Test13',async()=>{
   const m=prepare();const before=m.snapshot();await m.save();assert.equal(m.state().dirty,false);
   assert.deepEqual(changedKeys(before,m.snapshot()),['/0/updatedAt']);
 });
 console.log('TOTAL '+checks+'/'+checks+' PASS; TEST13_SHA256 '+hash+'; ENV Node VM synthetic Store/timers; BROWSER_E2E false');
})().catch(error=>{console.error('FAIL '+error.stack);process.exitCode=1});
