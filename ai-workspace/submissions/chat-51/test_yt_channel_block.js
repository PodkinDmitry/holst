// Deterministic Node VM tests executing the actual ext224/background.js ytBlock221() code.
// Usage: node test_yt_channel_block.js /path/to/ext224/background.js
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
function section(a, b) {
  const x = source.indexOf(a), y = source.indexOf(b, x + a.length);
  if (x < 0 || y <= x) throw Error('Unexpected ext224/background.js source: ' + a);
  return source.slice(x, y);
}
const queueCode = section('/* ---------- the queue: nothing is lost', '/* ---------- open something in Холст');
const queuedCode = section('async function queued(op, d) {', '/* watched zones of videos: kept here');
const blockCode = section('/* hiding a channel in the feed: here at once, in Холст for keeps */', '/* v2.23: the formatting of a Whimsical board');
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => {let release; return {promise: new Promise(r => release=r), release: () => release()};};
function harness(initial={}, relayFn, storeFn) {
  const state = {data:clone(initial), calls:[], writeCount:0};
  const chrome={storage:{local:{
    get: async key => { await tick();const out={};for(const k of Array.isArray(key)?key:[key])if(k in state.data)out[k]=clone(state.data[k]);return out;},
    set: async value => {await tick();if(storeFn)await storeFn(value);Object.assign(state.data,clone(value));state.writeCount++;}
  }},action:{setBadgeBackgroundColor(){},setBadgeText(){}}};
  const relay=async(op,data,noOpen)=>{state.calls.push({op,data:clone(data),noOpen});if(relayFn)return relayFn(op,data,noOpen);return {ok:true};};
  const context={chrome,relay,Promise,Date,Map,holstTab:async()=>3};vm.createContext(context);
  vm.runInContext(queueCode+'\n'+queuedCode+'\n'+blockCode+'\nglobalThis.api={ytBlock221};',context,{filename:'ext224/background.js:ytBlock221'});
  return {api:context.api,state};
}
const cases=[
 ['parallel-channel-blocks-are-all-kept',async()=>{
  const x=harness();await Promise.all([x.api.ytBlock221({ch:'channel-A',n:'A'}),x.api.ytBlock221({ch:'channel-B',n:'B'})]);
  assert.deepEqual(Object.keys(x.state.data.yb221).sort(),['channel-A','channel-B']);
 }],
 ['remote-refusal-must-create-durable-outbox-item',async()=>{
  const x=harness({},async()=>({ok:false}));const result=await x.api.ytBlock221({ch:'channel-A',n:'A'});
  assert.equal(result.ok,true);assert.equal(result.queued,true);
  assert.deepEqual(x.state.data.queue.map(a=>a.op),['yt-block']);
 }],
 ['offline-block-acknowledgement-must-be-queued',async()=>{
  const x=harness({},async()=>{throw Error('Holst offline')});const result=await x.api.ytBlock221({ch:'channel-A',n:'A'});
  assert.equal(result.queued,true);assert.deepEqual(x.state.data.queue.map(a=>a.op),['yt-block']);
 }],
 ['remote-block-then-unblock-preserves-order',async()=>{
  const hold=deferred(),entered=deferred(), calls=[];
  const x=harness({},async op=>{calls.push(op);if(op==='yt-block'){entered.release();await hold.promise;}return {ok:true};});
  const first=x.api.ytBlock221({ch:'same',n:'Same'});await entered.promise;
  const second=x.api.ytBlock221({ch:'same',off:1});
  for(let i=0;i<5;i++)await tick();
  assert.deepEqual(calls,['yt-block'],'unblock must not be delivered before prior block');
  hold.release();await Promise.all([first,second]);
  assert.deepEqual(calls,['yt-block','yt-unblock']);assert.equal(Object.hasOwn(x.state.data.yb221,'same'),false);
 }],
 ['concurrent-unblock-does-not-erase-unrelated-channel',async()=>{
  const x=harness({yb221:{'channel-A':{n:'old'},'channel-B':{n:'old'}}});
  await Promise.all([x.api.ytBlock221({ch:'channel-A',off:1}),x.api.ytBlock221({ch:'channel-C',n:'C'})]);
  assert.deepEqual(Object.keys(x.state.data.yb221).sort(),['channel-B','channel-C']);
 }],
 ['failed-queue-persistence-not-reported-as-success',async()=>{
  const x=harness({},async()=>({ok:false}),value=>{if('queue' in value)throw Error('outbox full/disk error');});
  await assert.rejects(x.api.ytBlock221({ch:'channel-A'}),/outbox full/);
  assert.equal(x.state.data.yb221['channel-A'].n,'channel-A');
 }],
 ['new-block-stores-timing-and-channel-name',async()=>{
  const x=harness();const r=await x.api.ytBlock221({ch:'abc',n:'Channel',until:456,url:'https://www.youtube.com/@abc'});
  assert.equal(r.ok,true);assert.equal(x.state.data.yb221.abc.until,456);
  assert.equal(x.state.data.yb221.abc.n,'Channel');assert.equal(x.state.data.yb221.abc.url,'https://www.youtube.com/@abc');
 }],
 ['invalid-channel-not-stored-or-sent',async()=>{
  const x=harness();const r=await x.api.ytBlock221({ch:''});assert.equal(r.ok,false);assert.equal(x.state.calls.length,0);assert.equal(x.state.writeCount,0);
 }],
 ['immediate-success-does-not-queue',async()=>{
  const x=harness();const r=await x.api.ytBlock221({ch:'channel-A'});assert.equal(r.ok,true);assert.equal(x.state.data.queue,undefined);
 }],
 ['local-write-failure-must-not-send-remote',async()=>{
  const x=harness({},null,value=>{if('yb221' in value)throw Error('storage write failed')});
  await assert.rejects(x.api.ytBlock221({ch:'channel-A'}),/storage write failed/);assert.equal(x.state.calls.length,0);
 }],
 ['offline-block-and-unblock-preserve-send-order',async()=>{
  const x=harness({},async()=>({ok:false}));await Promise.all([x.api.ytBlock221({ch:'channel-A'}),x.api.ytBlock221({ch:'channel-A',off:1})]);
  assert.deepEqual(x.state.data.queue.map(a=>a.op),['yt-block','yt-unblock']);
  assert.equal(Object.hasOwn(x.state.data.yb221,'channel-A'),false);
 }],
];
(async()=>{const results=[];for(const [name,fn] of cases){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',message:String(e&&e.message||e).slice(0,240)});}}
const passed=results.filter(r=>r.status==='PASS').length;console.log(JSON.stringify({passed,total:results.length,results},null,2));process.exitCode=passed===results.length?0:1;})().catch(e=>{console.error(e);process.exitCode=2;});
