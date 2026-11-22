// Source-backed deterministic VM tests: legacy extension YouTube progress persistence.
// Usage: node test_yt_watch_race.js /path/to/ext224/background.js
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
const lo = source.indexOf('/* watched zones of videos: kept here, given to Холст */');
const hi = source.indexOf('/* ===================== v2.21 ===================== */', lo);
if (lo < 0 || hi < lo) throw Error('Unrecognized exact watched-zone source shape');
const implementation = source.slice(lo, hi);
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setImmediate(r));
const later = () => {let release; return {promise:new Promise(r => release=r), release:()=>release()};};
const sample = (id, d, start, end, sess) => ({id,d,z:[[start,end]],sess,ws:end-start,rws:0});
function harness(initial={}, options={}) {
 const state={store:clone(initial),relayCalls:[],sets:[]};
 const chrome={storage:{local:{
  get:async key=>{await tick(); if (key===null) return clone(state.store);return {[key]:clone(state.store[key])}},
  set:async v=>{await tick();Object.assign(state.store,clone(v));state.sets.push(clone(v));}
 }}};
 const relay=async(op,d,noOpen)=>{state.relayCalls.push(clone({op,d,noOpen}));return options.relay?options.relay(op,d,noOpen):{ok:true}};
 const context={chrome,Promise,Date,Map,relay,holstTab:options.holstTab|| (async()=>17)};
 vm.createContext(context);
 vm.runInContext(implementation+'\nglobalThis.watchAPI={ytWatch,ywFlush};',context,{filename:'ext224/background.js/watch'});
 return {api:context.watchAPI,state};
}
const cases=[
 ['parallel-local-watch-updates-preserve-both-zones',async()=>{
  const x=harness({}, {relay:async()=>({ok:false})});
  await Promise.all([x.api.ytWatch(sample('id',100,0,20)),x.api.ytWatch(sample('id',100,40,60))]);
  assert.deepEqual(x.state.store['yw:id'].z,[[0,20],[40,60]]);
 }],
 ['late-direct-ack-cannot-erase-newer-progress',async()=>{
  const gate=later(); const arrived=later(); let count=0;
  const x=harness({}, {relay:async()=>{count++; if(count===1){arrived.release();await gate.promise;return {ok:true}}return {ok:false}}});
  const first=x.api.ytWatch(sample('id',100,0,20)); await arrived.promise;
  const second=await x.api.ytWatch(sample('id',100,40,60));
  assert.equal(second.ok,true);gate.release(); await first;
  assert.deepEqual(x.state.store['yw:id'].z,[[0,20],[40,60]]);
  assert.equal(x.state.store['yw:id'].dirty,1);
 }],
 ['late-flush-ack-cannot-erase-newer-progress',async()=>{
  const gate=later(), arrived=later();let count=0;
  const original={'yw:id':{d:100,z:[[0,20]],at:1,dirty:1}};
  const x=harness(original,{relay:async()=>{count++;if(count===1){arrived.release();await gate.promise;return {ok:true}}return {ok:false}}});
  const flushing=x.api.ywFlush();await arrived.promise;
  await x.api.ytWatch(sample('id',100,40,60)); gate.release(); await flushing;
  assert.deepEqual(x.state.store['yw:id'].z,[[0,20],[40,60]]);
  assert.equal(x.state.store['yw:id'].dirty,1);
 }],
 ['newer-write-offline-remains-dirty',async()=>{
  const x=harness({}, {relay:async()=>{throw Error('closed')}});
  await x.api.ytWatch(sample('id',100,5,25));
  assert.equal(x.state.store['yw:id'].dirty,1);
  assert.deepEqual(x.state.store['yw:id'].z,[[5,25]]);
 }],
 ['unmodified-success-clears-dirty',async()=>{
  const x=harness();await x.api.ytWatch(sample('id',100,5,25));
  assert.equal(x.state.store['yw:id'].dirty,0);
 }],
 ['flush-success-clears-dirty',async()=>{
  const x=harness({'yw:id':{d:100,z:[[0,20]],at:1,dirty:1}});
  await x.api.ywFlush();assert.equal(x.state.store['yw:id'].dirty,0);
 }],
 ['failed-flush-retains-dirty',async()=>{
  const x=harness({'yw:id':{d:100,z:[[0,20]],at:1,dirty:1}},{relay:async()=>({ok:false})});
  await x.api.ywFlush();assert.equal(x.state.store['yw:id'].dirty,1);
 }],
 ['different-ids-are-isolated',async()=>{
  const x=harness();await Promise.all([x.api.ytWatch(sample('id1',100,0,25)),x.api.ytWatch(sample('id2',90,30,55))]);
  assert.deepEqual(x.state.store['yw:id1'].z,[[0,25]]);
  assert.deepEqual(x.state.store['yw:id2'].z,[[30,55]]);
 }],
 ['session-rewatch-counters-monotonic',async()=>{
  const x=harness({}, {relay:async()=>({ok:false})});
  await x.api.ytWatch({...sample('id',120,0,35,'s1'),rws:0});
  await x.api.ytWatch({...sample('id',120,50,90,'s1'),rws:35});
  const r=x.state.store['yw:id'];assert.equal(r.n,1);assert.equal(r.rw,1);assert.equal(r.rws,35);assert.deepEqual(r.z,[[0,35],[50,90]]);
 }],
 ['invalid-video-does-not-write',async()=>{
  const x=harness();const result=await x.api.ytWatch({id:''});assert.equal(result.ok,false);assert.equal(x.state.sets.length,0);
 }],
 ['legacy-record-without-revision-flushes',async()=>{
  const x=harness({'yw:id':{d:100,z:[[0,20]],at:1,dirty:1}});
  await x.api.ywFlush();assert.equal(x.state.store['yw:id'].dirty,0);
 }],
 ['concurrent-flush-and-direct-update-not-lossy',async()=>{
  const x=harness({'yw:id':{d:100,z:[[0,20]],at:1,dirty:1}}, {relay:async()=>{await tick();return {ok:true}}});
  await Promise.all([x.api.ywFlush(),x.api.ytWatch(sample('id',100,40,60))]);
  assert.deepEqual(x.state.store['yw:id'].z,[[0,20],[40,60]]);
 }],
];
(async()=>{
 const results=[];
 for(const [name,fn] of cases){try{await fn();results.push({name,status:'PASS'})}catch(e){results.push({name,status:'FAIL',error:String(e&&e.message||e).slice(0,220)})}}
 const passed=results.filter(x=>x.status==='PASS').length;
 console.log(JSON.stringify({passed,total:cases.length,results},null,2));process.exitCode=passed===cases.length?0:1;
})().catch(e=>{console.error(e);process.exitCode=2});
