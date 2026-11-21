#!/usr/bin/env node
'use strict';
// Execute the actual Test13 mxRemoveTrack(), mxDeleteSelTrack(), and trashPut() bodies.
// UI, storage, board and scheduler are simulated; this is NOT a browser E2E test.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const [originalPath, patchedPath]=process.argv.slice(2);
if(!originalPath||!patchedPath)throw Error('usage: node matrix_track_source_gate.js ORIGINAL/base29.html PATCHED/base29.html');
const original=fs.readFileSync(originalPath,'utf8'),patched=fs.readFileSync(patchedPath,'utf8');
function extract(src,start,end){const i=src.indexOf(start),j=src.indexOf(end,i);if(i<0||j<0||i>=j)throw Error('source markers missing: '+start+' / '+end);return src.slice(i,j);}
function body(src){return extract(src,'function mxTrackCells(F, kind, id) {','function mxDetachTrack(F, kind, id, w) {')+'\n'+extract(src,'function mxDeleteSelTrack() {','/* ---------- arrows between cells')+'\n'+extract(src,'async function trashPut(e, data) {','async function trashBoard(bid) {');}
const expectedOriginalHash='3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c';
const crypto=require('node:crypto');assert.equal(crypto.createHash('sha256').update(original).digest('hex'),expectedOriginalHash,'original Test13 must match exact private source');
function setup(src,opt={}){
 const c1={id:'cell-1',type:'frame',cell:{m:'matrix',c:'col-1',r:'row-1'},x:0,y:0,w:80,h:80},
       c2={id:'cell-2',type:'frame',cell:{m:'matrix',c:'col-1',r:'row-2'},x:0,y:100,w:80,h:80},
       c3={id:'cell-3',type:'frame',cell:{m:'matrix',c:'col-2',r:'row-1'},x:100,y:0,w:80,h:80},
       c4={id:'cell-4',type:'frame',cell:{m:'matrix',c:'col-2',r:'row-2'},x:100,y:100,w:80,h:80},
       inner={id:'inner',type:'text',parent:'cell-1',text:'User data in cell',x:10,y:10,w:20,h:20},
       wire={id:'wire',type:'connector',from:{id:'inner'},to:{id:'cell-2'}},
       outside={id:'outside',type:'text',text:'Unrelated user content'};
 const F={id:'matrix',type:'frame',x:0,y:0,w:200,h:200,mx:{cols:[{id:'col-1',name:'First',w:100},{id:'col-2',name:'Second',w:100}],rows:[{id:'row-1',name:'First',h:100},{id:'row-2',name:'Second',h:100}]}};
 const board={id:'board-A',name:'Test board',items:[F,c1,c2,c3,c4,inner,wire,outside],assets:{asset:'data:image/png;base64,AAAA'},updatedAt:100};
 const S={board,sel:new Set(['matrix']),mxSel:{fid:'matrix',kind:opt.kind==='c'?'col':'row',id:opt.kind==='c'?'col-1':'row-1'}};
 const persisted=new Map(); let index=[],next=0,hist=0,changes=0,confirmCount=0,writeCount=0,readCount=0,confirmResolves=[],writeResolve,toastLog=[];
 const tick=()=>new Promise(r=>setImmediate(r));
 const Store={mode:opt.mem?'mem':'idb',async set(k,v){writeCount++;if(opt.writeFail)throw Error('quota');if(opt.deferWrite)await new Promise(r=>writeResolve=r);persisted.set(k,structuredClone(v));},async get(k){readCount++;if(opt.readFail)throw Error('read-failed');return opt.missingRead?undefined:persisted.get(k);}};
 const LS={get(k){return k==='trashidx'?structuredClone(index):null;},set(k,v){if(k==='trashidx'&&!opt.indexFail)index=structuredClone(v);}};
 const env={S,Store,LS,console:{error(){}},Date,Set,Map,JSON,Object,
   uid:()=>`synthetic-${++next}`,trashIdx:()=>LS.get('trashidx')||[],trashSaveIdx:x=>LS.set('trashidx',x),
   toast:s=>toastLog.push(String(s)),
   mxCells:f=>board.items.filter(x=>x.cell?.m===f.id),
   withFrameContents:arr=>arr.flatMap(x=>[x,...board.items.filter(y=>y.parent===x.id)]),
   uiConfirm:async()=>{confirmCount++;if(opt.deferConfirm)await new Promise(r=>confirmResolves.push(r));return opt.confirm===false?false:true;},
   pushHist(){hist++},items:()=>S.board.items,changed(){changes++},
   byId:id=>S.board?.items.find(x=>x.id===id),
   assetSize:x=>String(x).length,assetKind:()=> 'img',
   bmOf:()=>[{board:'board-A',group:'synthetic'}],clone:x=>structuredClone(x)
 };
 const ctx=vm.createContext(env); vm.runInContext(body(src),ctx,{timeout:2000});
 const call=(kind='r',id=(kind==='c'?'col-1':'row-1'))=>{ctx._F=F;ctx._kind=kind;ctx._id=id;return vm.runInContext('mxRemoveTrack(_F,_kind,_id)',ctx,{timeout:2000});};
 const viaSelection=()=>vm.runInContext('mxDeleteSelTrack()',ctx,{timeout:2000});
 return {S,F,board,c1,c2,c3,c4,inner,wire,outside,Store,LS,call,viaSelection,persisted,
  idx:()=>index,hist:()=>hist,changes:()=>changes,confirmCount:()=>confirmCount,writeCount:()=>writeCount,readCount:()=>readCount,
  resolveConfirm:()=>{if(!confirmResolves.length)throw Error('no pending confirm');confirmResolves.shift()();},
  resolveWrite:()=>{if(!writeResolve)throw Error('no pending write');writeResolve();},
  toasts:()=>toastLog,tick,ctx,env};
}
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+' '+(e.stack||e));}}
const mk=()=>setup(patched);
(async()=>{
 // Execute the real original function and prove independent destructive controls.
 await test('ORIGINAL: deleting a populated matrix row has zero Trash writes',async()=>{const x=setup(original);await x.call();assert.equal(x.board.items.includes(x.c1),false);assert.equal(x.writeCount(),0)});
 await test('ORIGINAL: stale track id removes unrelated last row',async()=>{const x=setup(original);await x.call('r','unknown');assert.deepEqual(x.F.mx.rows.map(t=>t.id),['row-1']);assert.equal(x.writeCount(),0)});
 await test('ORIGINAL: backend Trash failure cannot stop matrix deletion',async()=>{const x=setup(original,{writeFail:true});await x.call();assert.equal(x.F.mx.rows.length,1);assert.equal(x.writeCount(),0)});
 await test('ORIGINAL: asynchronous confirmation can delete other board objects',async()=>{const x=setup(original,{deferConfirm:true});const p=x.call();await x.tick();const other={id:'other',items:[{id:'survivor',type:'text'},{id:'cell-1',type:'frame'},{id:'inner',type:'text'}]};x.S.board=other;x.resolveConfirm();await p;assert.deepEqual(other.items.map(y=>y.id),['survivor']);assert.equal(x.F.mx.rows.length,1);assert.equal(x.hist(),1)});
 await test('ORIGINAL: two overlapping confirmations both splice rows',async()=>{const x=setup(original,{deferConfirm:true});const p=x.call(),q=x.call();await x.tick();x.resolveConfirm();x.resolveConfirm();await Promise.all([p,q]);assert.equal(x.F.mx.rows.length,0)});
 await test('ORIGINAL: connector and inner content lost without recovery',async()=>{const x=setup(original);await x.call();assert(!x.board.items.includes(x.inner));assert(!x.board.items.includes(x.wire));assert.equal(x.idx().length,0)});
 // Patched real function against synthetic persistent Trash from published CHAT28 code.
 await test('PATCH: row deletion commits only after full-board snapshot',async()=>{const x=mk();await x.call();assert.deepEqual(x.F.mx.rows.map(t=>t.id),['row-2']);assert.equal(x.idx().length,1);assert.equal(x.hist(),1);assert.equal(x.changes(),1)});
 await test('PATCH: Trash payload contains complete original matrix and contents',async()=>{const x=mk();await x.call();const data=x.persisted.get('trash:'+x.idx()[0].id);assert.equal(data.board.mx,undefined);assert.equal(data.board.items.find(y=>y.id==='matrix').mx.rows.length,2);assert(data.board.items.some(y=>y.id==='inner'));assert(data.board.items.some(y=>y.id==='wire'));assert(data.bm.length)});
 await test('PATCH: external non-selected objects and metadata preserved on success',async()=>{const x=mk();await x.call();assert(x.board.items.some(y=>y.id==='outside'));assert(x.board.items.some(y=>y.id==='cell-2'));assert.equal(x.board.assets.asset,'data:image/png;base64,AAAA')});
 await test('PATCH: column removal creates a distinct full-board snapshot',async()=>{const x=setup(patched,{kind:'c'});await x.call('c');assert.equal(x.F.mx.cols.length,1);assert.equal(x.idx().length,1);assert.equal(x.persisted.get('trash:'+x.idx()[0].id).board.items.find(y=>y.id==='matrix').mx.cols.length,2)});
 await test('PATCH: Store.set rejection preserves matrix and objects',async()=>{const x=setup(patched,{writeFail:true});await x.call();assert.equal(x.F.mx.rows.length,2);assert(x.board.items.includes(x.inner));assert.equal(x.hist(),0);assert.equal(x.changes(),0)});
 await test('PATCH: silent Trash index failure preserves matrix and contents',async()=>{const x=setup(patched,{indexFail:true});await x.call();assert.equal(x.F.mx.rows.length,2);assert.equal(x.hist(),0);assert.equal(x.idx().length,0)});
 await test('PATCH: no durable storage means no deletion',async()=>{const x=setup(patched,{mem:true});await x.call();assert.equal(x.F.mx.rows.length,2);assert.equal(x.writeCount(),0)});
 await test('PATCH: missing payload readback means no deletion',async()=>{const x=setup(patched,{missingRead:true});await x.call();assert.equal(x.F.mx.rows.length,2);assert.equal(x.hist(),0)});
 await test('PATCH: failed readback means no deletion',async()=>{const x=setup(patched,{readFail:true});await x.call();assert.equal(x.F.mx.rows.length,2);assert.equal(x.hist(),0)});
 await test('PATCH: pending Trash write leaves cells visible until resolved',async()=>{const x=setup(patched,{deferWrite:true});const p=x.call();await x.tick();assert.equal(x.F.mx.rows.length,2);assert(x.board.items.includes(x.inner));x.resolveWrite();await p;assert.equal(x.F.mx.rows.length,1)});
 await test('PATCH: change source board while awaiting confirmation aborts',async()=>{const x=setup(patched,{deferConfirm:true});const p=x.call();await x.tick();x.S.board={id:'other',items:[{id:'new',type:'text'}]};x.resolveConfirm();await p;assert.equal(x.F.mx.rows.length,2);assert.equal(x.writeCount(),0)});
 await test('PATCH: in-place edit while waiting for confirmation aborts',async()=>{const x=setup(patched,{deferConfirm:true});const p=x.call();await x.tick();x.inner.text='new user edit';x.resolveConfirm();await p;assert.equal(x.F.mx.rows.length,2);assert.equal(x.writeCount(),0)});
 await test('PATCH: in-place edit during pending Trash write aborts with snapshot',async()=>{const x=setup(patched,{deferWrite:true});const p=x.call();await x.tick();x.inner.text='late edit';x.resolveWrite();await p;assert.equal(x.F.mx.rows.length,2);assert.equal(x.idx().length,1);assert.equal(x.hist(),0)});
 await test('PATCH: selection change during pending backup aborts',async()=>{const x=setup(patched,{deferWrite:true});const p=x.call();await x.tick();x.S.mxSel={fid:'matrix',kind:'row',id:'row-2'};x.resolveWrite();await p;assert.equal(x.F.mx.rows.length,2)});
 await test('PATCH: selected board objects change during pending backup aborts',async()=>{const x=setup(patched,{deferWrite:true});const p=x.call();await x.tick();x.S.sel=new Set(['outside']);x.resolveWrite();await p;assert.equal(x.F.mx.rows.length,2)});
 await test('PATCH: stale track id is a no-op, not splice(-1)',async()=>{const x=mk();await x.call('r','unknown');assert.equal(x.F.mx.rows.length,2);assert.equal(x.writeCount(),0)});
 await test('PATCH: two concurrent remove calls produce only one snapshot',async()=>{const x=setup(patched,{deferConfirm:true});const p=x.call();const q=x.call();await x.tick();assert.equal(x.confirmCount(),1);x.resolveConfirm();await Promise.all([p,q]);assert.equal(x.idx().length,1);assert.equal(x.F.mx.rows.length,1)});
 await test('PATCH: second distinct track is blocked while one pending',async()=>{const x=setup(patched,{deferConfirm:true});const p=x.call();await x.call('c');await x.tick();assert.equal(x.confirmCount(),1);x.resolveConfirm();await p;assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: user cancels confirmation leaves data untouched',async()=>{const x=setup(patched,{confirm:false});await x.call();assert.equal(x.F.mx.rows.length,2);assert.equal(x.writeCount(),0);assert.equal(x.hist(),0)});
 await test('PATCH: deleting last row refused without backup',async()=>{const x=mk();x.F.mx.rows.splice(1);await x.call();assert.equal(x.F.mx.rows.length,1);assert.equal(x.writeCount(),0)});
 await test('PATCH: board detached from active items is not modified',async()=>{const x=mk();x.S.board={id:'else',items:[]};await x.call();assert.equal(x.F.mx.rows.length,2);assert.equal(x.writeCount(),0)});
 await test('PATCH: invalid matrix kind is ignored',async()=>{const x=mk();await x.call('z','row-1');assert.equal(x.writeCount(),0);assert.equal(x.hist(),0)});
 await test('PATCH: successful row deletion also removes connectors from removed items',async()=>{const x=mk();await x.call();assert(!x.board.items.some(y=>y.id==='wire'));assert(!x.board.items.some(y=>y.id==='inner'));assert(x.board.items.some(y=>y.id==='cell-2'))});
 await test('PATCH: failure preserves matrix selection and retry succeeds',async()=>{const x=setup(patched,{writeFail:true});await x.call();assert.equal(x.S.mxSel.id,'row-1');x.Store.set=async (k,v)=>x.persisted.set(k,structuredClone(v));await x.call();assert.equal(x.F.mx.rows.length,1);assert.equal(x.idx().length,1)});
 await test('PATCH: static mxDeleteSelTrack still synchronously routes selection',async()=>{const x=mk();assert.equal(x.viaSelection(),true);await x.tick();assert.equal(x.idx().length,1);assert.equal(x.F.mx.rows.length,1)});
 await test('PATCH: local backup is board kind with recovery title',async()=>{const x=mk();await x.call();assert.equal(x.idx()[0].kind,'board');assert.equal(x.idx()[0].bid,'board-A');assert(x.idx()[0].title.includes('строки'));assert.equal(x.idx()[0].types.frame,5)});
 await test('PATCH: selection cleared only on successful destructive commit',async()=>{const x=setup(patched,{writeFail:true});await x.call();assert.equal(x.S.mxSel.id,'row-1');const y=mk();await y.call();assert.equal(y.S.mxSel,null)});
 await test('PATCH: guard unlocks after rejected confirmation and permits retry',async()=>{const x=setup(patched,{confirm:false});await x.call();x.env.uiConfirm=async()=>true;await x.call();assert.equal(x.F.mx.rows.length,1)});
 await test('PATCH: changed track metadata while writing aborts without deletion',async()=>{const x=setup(patched,{deferWrite:true});const p=x.call();await x.tick();x.F.mx.rows[0].name='renamed';x.resolveWrite();await p;assert.equal(x.F.mx.rows.length,2)});
 await test('PATCH: no delete on board navigation during pending Trash write',async()=>{const x=setup(patched,{deferWrite:true});const p=x.call();await x.tick();x.S.board={id:'new',items:[{id:'user',type:'text'}]};x.resolveWrite();await p;assert.equal(x.F.mx.rows.length,2);assert.equal(x.S.board.items[0].id,'user')});
 console.log(`TOTAL ${passed}/${passed+failed} PASS`);
 if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
