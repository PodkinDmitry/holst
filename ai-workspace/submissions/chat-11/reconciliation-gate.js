'use strict';
const assert = require('node:assert/strict');
const makeCoordinator = require(process.env.XOD_CAS_MODULE || './xod-cas-view-coordinator.js');
const clone = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tests = [];
const test = (name, fn) => tests.push({name, fn});
const view = value => ({filter:null,sort:[],group:{key:value,dir:'asc'}});
function storage(initial={views:{},viewRevisions:{},presets:[]}) {
 let rev=0,doc=clone(initial),writes=0,cas=0;
 const db={
  get data(){return clone(doc)},get writes(){return writes},get calls(){return cas},get revision(){return rev},
  read:async()=>({revision:rev,data:clone(doc)}),
  compareAndSwap:async(expected,next)=>{cas++; await tick();if(expected!==rev)return {ok:false}; doc=clone(next);rev++;writes++;return {ok:true}}
 };
 return db;
}
function ackLostAfterCommit(db,kind='throw'){
 let lost=true;
 return {read:db.read,compareAndSwap:async(expected,next)=>{
  const outcome=await db.compareAndSwap(expected,next);
  if(lost&&outcome.ok){lost=false;if(kind==='throw')throw Error('ACK_LOST');return null;}
  return outcome;
 }};
}

// The original CHAT 09 behavior must fail this suite: it has no reconcile() method.
test('01 committed but ACK lost: observe authoritative view; next save works',async()=>{
 const db=storage(),session=await makeCoordinator(ackLostAfterCommit(db)).openView('main');
 await assert.rejects(session.onSaveView(view('first')),/ACK_LOST/);
 await assert.rejects(session.onSaveView(view('next')),{code:'XOD_RECONCILIATION_REQUIRED'});
 const state=await session.reconcile();
 assert.equal(state.status,'observed');assert.equal(state.revision,1);
 assert.equal(state.view.group.key,'first');
 await session.onSaveView(view('next'));
 assert.equal(db.data.views.main.group.key,'next');assert.equal(db.data.viewRevisions.main,2);
});

test('02 malformed acknowledgement after commit is reconcilable',async()=>{
 const db=storage(),session=await makeCoordinator(ackLostAfterCommit(db,'malformed')).openView('main');
 await assert.rejects(session.onSaveView(view('inbox')),{code:'XOD_UNKNOWN_COMMIT'});
 assert.equal((await session.reconcile()).status,'observed');
 assert.equal(db.writes,1);
});

test('03 conflicting remote update is not overwritten during reconciliation',async()=>{
 const db=storage(),session=await makeCoordinator(ackLostAfterCommit(db)).openView('main');
 await assert.rejects(session.onSaveView(view('inbox')),/ACK_LOST/);
 const external=await makeCoordinator(db).openView('main');
 await external.onSaveView(view('remote'));
 const status=await session.reconcile();
 assert.equal(status.status,'conflict');assert.equal(status.pendingView.group.key,'inbox');
 assert.equal(status.remoteView.group.key,'remote');
 await assert.rejects(session.onSaveView(view('local')),{code:'XOD_RECONCILIATION_REQUIRED'});
 assert.equal(db.data.views.main.group.key,'remote');
 const restored=await session.reload();
 assert.equal(restored.view.group.key,'remote');
 await session.onSaveView(view('local'));
 assert.equal(db.data.views.main.group.key,'local');
});

test('04 rejected CAS before commit => unconfirmed, no blind retry',async()=>{
 const db=storage();let first=true;
 const api={read:db.read,compareAndSwap:async(r,d)=>{if(first){first=false;throw Error('before commit')}return db.compareAndSwap(r,d)}};
 const editor=await makeCoordinator(api).openView('main');
 await assert.rejects(editor.onSaveView(view('local')),/before commit/);
 assert.deepEqual(await editor.reconcile(),{status:'unconfirmed',revision:0,pendingView:view('local')});
 await assert.rejects(editor.onSaveView(view('local')),{code:'XOD_RECONCILIATION_REQUIRED'});
 assert.equal(db.writes,0);
 await editor.reload();await editor.onSaveView(view('local'));assert.equal(db.writes,1);
});

test('05 late in-flight commit: immediate recheck stays uncertain; later can observe',async()=>{
 const db=storage();let first=true;
 const api={read:db.read,compareAndSwap:async(r,d)=>{
   if(first){first=false;setTimeout(()=>{db.compareAndSwap(r,d).catch(()=>{})},40);throw Error('connection dropped')}
   return db.compareAndSwap(r,d);
 }};
 const editor=await makeCoordinator(api).openView('main');
 await assert.rejects(editor.onSaveView(view('later')),/connection dropped/);
 assert.equal((await editor.reconcile()).status,'unconfirmed');
 assert.equal(db.writes,0);
 await sleep(95);
 assert.equal((await editor.reconcile()).status,'observed');
 assert.equal(db.writes,1);
});

test('06 read error before CAS does not require reconciliation',async()=>{
 const db=storage();let failNextRead=false;
 const adapter={read:async()=>{
   if(failNextRead){failNextRead=false;throw Error('read failed')}
   return db.read();
 },compareAndSwap:db.compareAndSwap};
 const editor=await makeCoordinator(adapter).openView('main');
 failNextRead=true;
 await assert.rejects(editor.onSaveView(view('first')),/read failed/);
 await editor.onSaveView(view('second'));
 assert.equal(db.writes,1);
 assert.equal((await editor.reconcile()).status,'clear');
});

test('07 definite CAS rejection exhausts attempts but is not an unknown commit',async()=>{
 const db=storage();let reject=true;
 const api={read:db.read,maxAttempts:2,compareAndSwap:async(r,d)=>reject?{ok:false}:db.compareAndSwap(r,d)};
 const editor=await makeCoordinator(api).openView('main');
 await assert.rejects(editor.onSaveView(view('first')),{code:'XOD_CAS_RETRY_LIMIT'});
 reject=false;await editor.onSaveView(view('next'));
 assert.equal(db.data.views.main.group.key,'next');
});

test('08 queued follow-on is rejected after uncertain first write',async()=>{
 const db=storage(),editor=await makeCoordinator(ackLostAfterCommit(db)).openView('main');
 const first=editor.onSaveView(view('first'));
 const second=editor.onSaveView(view('second'));
 const outcomes=await Promise.allSettled([first,second]);
 assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'rejected');
 assert.equal(outcomes[1].reason.code,'XOD_RECONCILIATION_REQUIRED');
 assert.equal(db.writes,1);assert.equal(db.data.views.main.group.key,'first');
 assert.equal((await editor.reconcile()).status,'observed');
});

test('09 dispose prevents reconciliation reads and writes',async()=>{
 const db=storage(),editor=await makeCoordinator(ackLostAfterCommit(db)).openView('main');
 await assert.rejects(editor.onSaveView(view('first')),/ACK_LOST/);
 editor.dispose();
 await assert.rejects(editor.reconcile(),{code:'XOD_VIEW_CLOSED'});
 await assert.rejects(editor.onSaveView(view('next')),{code:'XOD_VIEW_CLOSED'});
 assert.equal(db.writes,1);
});

test('10 reordered JSON object keys still compare equal after lost ACK',async()=>{
 const db=storage();let first=true;
 const api={read:async()=>{
    const response=await db.read();
    if(response.data.views.main){const x=response.data.views.main;response.data.views.main={group:{dir:x.group.dir,key:x.group.key},sort:[],filter:null}}
    return response;
  },compareAndSwap:async(r,d)=>{const result=await db.compareAndSwap(r,d);if(first){first=false;throw Error('ACK_LOST')}return result}};
 const editor=await makeCoordinator(api).openView('main');
 await assert.rejects(editor.onSaveView(view('local')),/ACK_LOST/);
 assert.equal((await editor.reconcile()).status,'observed');
});

test('11 reconcile read exception retains unresolved state',async()=>{
 const db=storage();let readFail=false;
 const wrapped=ackLostAfterCommit(db);const api={...wrapped,read:async()=>{if(readFail)throw Error('read during recovery failed');return db.read()}};
 const editor=await makeCoordinator(api).openView('main');
 await assert.rejects(editor.onSaveView(view('first')),/ACK_LOST/);
 readFail=true;
 await assert.rejects(editor.reconcile(),/read during recovery failed/);
 await assert.rejects(editor.onSaveView(view('next')),{code:'XOD_RECONCILIATION_REQUIRED'});
 readFail=false;assert.equal((await editor.reconcile()).status,'observed');
});

test('12 no auto-replay of ambiguous transaction that has no idempotency receipt',async()=>{
 const db=storage();let attempts=0;
 const adapter={read:db.read,compareAndSwap:async(r,d)=>{attempts++;const outcome=await db.compareAndSwap(r,d);if(attempts===1)throw Error('ACK_LOST');return outcome}};
 const coordinator=makeCoordinator(adapter);
 await assert.rejects(coordinator.transaction(d=>{d.presets.push({id:'a'})}),/ACK_LOST/);
 assert.equal(attempts,1);assert.equal(db.data.presets.length,1);
});

(async()=>{let passed=0;for(const testCase of tests){try{await testCase.fn();console.log('PASS',testCase.name);passed++}catch(e){console.error('FAIL',testCase.name,e.stack);process.exitCode=1}}console.log(`RESULT ${passed}/${tests.length} ${passed===tests.length?'PASS':'FAIL'}`)})().catch(e=>{console.error(e);process.exitCode=1});
