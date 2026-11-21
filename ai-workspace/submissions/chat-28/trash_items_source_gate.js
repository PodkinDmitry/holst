#!/usr/bin/env node
'use strict';
// Execute actual XOD Test13 deleteSel, trashPut and trashItems functions from supplied
// private sources. All dependency implementations are synthetic. NOT browser E2E.
const fs=require('node:fs'),vm=require('node:vm'), assert=require('node:assert/strict');
const [originalPath,patchedPath]=process.argv.slice(2);
if(!originalPath||!patchedPath) throw Error('usage: node trash_items_source_gate.js original/base29.html patched/base29.html');
const original=fs.readFileSync(originalPath,'utf8'),patched=fs.readFileSync(patchedPath,'utf8');
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw Error(`missing exact source function ${start} / ${end}`);return source.slice(a,b);}
function extracted(source){return section(source,source.includes('let deleteSelBusy = false;')?'let deleteSelBusy = false;':'function deleteSel() {','function duplicateSel() {')+'\n'+section(source,'async function trashPut(e, data) {','async function trashBoard(bid) {');}
function setup(source, opts={}){
 let nextId=0, storeMode=opts.mem?'mem':'idb', persisted=new Map(),idx=[],pending=null,storeSetCalls=0,storeGetCalls=0,hist=0,changed=0,edit=0;
 const toasts=[];const board={id:'active',name:'Active board',items:[{id:'a',type:'text',text:'A'},{id:'b',type:'text',text:'B'},{id:'c',type:'text',text:'C'}],assets:{}};
 const S={board,sel:new Set(opts.sel||['a']),active:'a',mxSel:false};
 if(opts.pin){board.items.push({id:'p',type:'text',text:'Pinned',pin:{to:'a'}});}
 if(opts.asset){board.items[0].asset='asset-1';board.assets['asset-1']='data:image/png;base64,AAAA';}
 if(opts.connector){board.items.push({id:'edge',type:'connector',from:{id:'a'},to:{id:'b'}});}
 const env={S,console:{error(){}},Blob,Store:{mode:storeMode,
  async set(key,value){storeSetCalls++;if(opts.storeFailure)throw Error('quota_exceeded');if(opts.deferSet)await new Promise(r=>pending=r);persisted.set(key,structuredClone(value));},
  async get(key){storeGetCalls++;if(opts.readFailure)throw Error('read_failed');if(opts.missingRead)return undefined;return persisted.get(key);}
 },LS:{get(key){if(key==='trashidx')return idx.map(x=>structuredClone(x));return null;},set(key,val){if(key==='trashidx'&&!opts.idxFailure)idx=structuredClone(val);}},
 trashIdx:()=>idx.map(x=>structuredClone(x)),trashSaveIdx:l=>{if(!opts.idxFailure)idx=structuredClone(l)},
 uid:()=>`test${++nextId}`, toast:x=>toasts.push(x), htmlToText:s=>s, TYPE_NAME:{}, plural:(n,a)=>a,
 assetIdsOf:items=>items.flatMap(x=>x.asset?[x.asset]:[]),assetKind:()=> 'img',assetSize:d=>String(d).length,
 clone:x=>structuredClone(x),byId:id=>S.board.items.find(x=>x.id===id),items:()=>S.board.items,
 withFrameContents:()=>[],tabIdsOf:()=>[],mxDeleteSelTrack:()=>false,finishEdit(){edit++},pushHist(){hist++},changed(){changed++}
 };
 const context=vm.createContext(env);
 vm.runInContext(extracted(source),context,{timeout:2000});
 const doDelete=()=>vm.runInContext('deleteSel()',context,{timeout:2000});
 const doTrash=(items,board)=>{context._list=items;context._board=board;return vm.runInContext('trashItems(_list,_board)',context,{timeout:2000})};
 return {env,context,S,board,doDelete,doTrash,persisted,toasts,idx:()=>idx,hist:()=>hist,changed:()=>changed,setCalls:()=>storeSetCalls,getCalls:()=>storeGetCalls,pending:()=>pending,source};
}
let count=0;const evidence=[];
async function test(label,fn){try{await fn();count++;evidence.push('PASS '+label);console.log('PASS '+label);}catch(e){console.error('FAIL '+label+' '+(e?.stack||e));process.exitCode=1;}}
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
  await test('ORIGINAL: Store.set rejected, object removed anyway',async()=>{const a=setup(original,{storeFailure:true});await a.doDelete();await tick();assert(!a.board.items.some(x=>x.id==='a'));assert.equal(a.idx().length,0)});
  await test('ORIGINAL: Trash index write rejected, object removed',async()=>{const a=setup(original,{idxFailure:true});await a.doDelete();await tick();assert(!a.board.items.some(x=>x.id==='a'));assert.equal(a.idx().length,0)});
  await test('ORIGINAL: Store mode mem allows deleting without durable Trash',async()=>{const a=setup(original,{mem:true});await a.doDelete();await tick();assert(!a.board.items.some(x=>x.id==='a'))});
  await test('ORIGINAL: deleteSel drops objects before unresolved Trash write',async()=>{const a=setup(original,{deferSet:true});a.doDelete();await tick();assert(!a.board.items.some(x=>x.id==='a'));assert.equal(a.idx().length,0);a.pending()?.();await tick()});
  await test('ORIGINAL: trashItems itself has no success result',async()=>{const a=setup(original);const r=await a.doTrash([{id:'a',type:'text',text:'A'}],a.board);await tick();assert.equal(r,undefined);assert.equal(a.idx().length,1)});
  await test('ORIGINAL: no payload readback, delete after Store.get missing',async()=>{const a=setup(original,{missingRead:true});await a.doDelete();await tick();assert(!a.board.items.some(x=>x.id==='a'));assert.equal(a.getCalls(),0)});
  await test('PATCH: valid durable Trash persists then deletes selected only',async()=>{const a=setup(patched);await a.doDelete();assert.deepEqual(a.board.items.map(x=>x.id),['b','c']);assert.equal(a.idx().length,1);assert(a.persisted.get('trash:'+a.idx()[0].id)?.items.some(x=>x.id==='a'));assert.equal(a.hist(),1);assert.equal(a.changed(),1)});
  await test('PATCH: Store.set failure prevents any mutation, history, and selection clearing',async()=>{const a=setup(patched,{storeFailure:true});await a.doDelete();assert.deepEqual(a.board.items.map(x=>x.id),['a','b','c']);assert.equal(a.hist(),0);assert.equal(a.changed(),0);assert.deepEqual([...a.S.sel],['a'])});
  await test('PATCH: silent LS.set index failure cancels deletion',async()=>{const a=setup(patched,{idxFailure:true});await a.doDelete();assert(a.board.items.some(x=>x.id==='a'));assert.equal(a.hist(),0);assert.equal(a.idx().length,0)});
  await test('PATCH: transient in-memory Store refuses deletion',async()=>{const a=setup(patched,{mem:true});await a.doDelete();assert(a.board.items.some(x=>x.id==='a'));assert.equal(a.setCalls(),0);assert.equal(a.hist(),0)});
  await test('PATCH: missing Store.get readback cancels',async()=>{const a=setup(patched,{missingRead:true});await a.doDelete();assert(a.board.items.some(x=>x.id==='a'));assert.equal(a.hist(),0)});
  await test('PATCH: Store.get read error cancels',async()=>{const a=setup(patched,{readFailure:true});await a.doDelete();assert(a.board.items.some(x=>x.id==='a'));assert.equal(a.hist(),0)});
  await test('PATCH: await backup before deletion',async()=>{const a=setup(patched,{deferSet:true});const p=a.doDelete();await tick();assert(a.board.items.some(x=>x.id==='a'));assert.equal(a.hist(),0);a.pending()();await p;assert(!a.board.items.some(x=>x.id==='a'))});
  await test('PATCH: changed board identity while awaiting backup cancels',async()=>{const a=setup(patched,{deferSet:true});const p=a.doDelete();await tick();a.S.board={id:'other',name:'Other',items:[{id:'q',type:'text'}],assets:{}};a.pending()();await p;assert(a.board.items.some(x=>x.id==='a'));assert.deepEqual(a.S.board.items.map(x=>x.id),['q']);assert.equal(a.hist(),0)});
  await test('PATCH: in-place item edit during backup cancels',async()=>{const a=setup(patched,{deferSet:true});const p=a.doDelete();await tick();a.board.items[0].text='Edited while writing';a.pending()();await p;assert(a.board.items.some(x=>x.id==='a'));assert.equal(a.hist(),0)});
  await test('PATCH: changed selection while awaiting backup cancels',async()=>{const a=setup(patched,{deferSet:true});const p=a.doDelete();await tick();a.S.sel=new Set(['b']);a.pending()();await p;assert.equal(a.board.items.length,3);assert.equal(a.hist(),0)});
  await test('PATCH: double-click concurrency produces one persisted backup',async()=>{const a=setup(patched,{deferSet:true});const p=a.doDelete();await tick();const q=a.doDelete();assert.equal(a.setCalls(),1);a.pending()();await Promise.all([p,q]);assert.equal(a.idx().length,1);assert.equal(a.hist(),1)});
  await test('PATCH: assets are captured in backup',async()=>{const a=setup(patched,{asset:true});await a.doDelete();const data=a.persisted.get('trash:'+a.idx()[0].id);assert.equal(data.assets['asset-1'],'data:image/png;base64,AAAA')});
  await test('PATCH: linked connectors included in deleted payload',async()=>{const a=setup(patched,{connector:true});await a.doDelete();assert(!a.board.items.some(x=>x.id==='edge'));const data=a.persisted.get('trash:'+a.idx()[0].id);assert.deepEqual(data.items.map(x=>x.id).sort(),['a','edge'])});
  await test('PATCH: surviving pinned elements detach only after backup',async()=>{const a=setup(patched,{pin:true,deferSet:true});const p=a.doDelete();await tick();assert.equal(a.board.items.find(x=>x.id==='p').pin.to,'a');a.pending()();await p;assert.equal(a.board.items.find(x=>x.id==='p').pin,undefined)});
  await test('PATCH: surviving pinned elements remain unchanged after failure',async()=>{const a=setup(patched,{pin:true,storeFailure:true});await a.doDelete();assert.equal(a.board.items.find(x=>x.id==='p').pin.to,'a')});
  await test('PATCH: locked selection does not attempt Trash write',async()=>{const a=setup(patched);a.board.items[0].locked=true;await a.doDelete();assert.equal(a.setCalls(),0);assert.equal(a.hist(),0);assert(a.board.items.some(x=>x.id==='a'))});
  await test('PATCH: retry after failure can delete successfully',async()=>{const a=setup(patched,{storeFailure:true});await a.doDelete();a.env.Store.set=async(k,d)=>a.persisted.set(k,structuredClone(d));await a.doDelete();assert(!a.board.items.some(x=>x.id==='a'));assert.equal(a.hist(),1)});
  await test('PATCH: all unselected items preserved',async()=>{const a=setup(patched);await a.doDelete();assert.equal(a.board.items.find(x=>x.id==='b').text,'B');assert.equal(a.board.items.find(x=>x.id==='c').text,'C')});
  await test('PATCH: zero selections does not create Trash entry',async()=>{const a=setup(patched,{sel:[]});await a.doDelete();assert.equal(a.idx().length,0);assert.equal(a.hist(),0)});
  await test('PATCH: trashItems explicit board metadata independently of active board',async()=>{const a=setup(patched);const other={id:'other',name:'Other',items:[{id:'z',type:'text',text:'Z'}],assets:{}};const ok=await a.doTrash(other.items,other);assert.equal(ok,true);assert.equal(a.idx()[0].bid,'other');assert.deepEqual(a.board.items.map(x=>x.id),['a','b','c'])});
  await test('PATCH: no board returns false from trashItems',async()=>{const a=setup(patched);assert.equal(await a.doTrash([{id:'a',type:'text'}],null),false)});
  await test('PATCH: no objects returns false from trashItems',async()=>{const a=setup(patched);assert.equal(await a.doTrash([],a.board),false)});
  await test('PATCH: successful deletion clears active/selection',async()=>{const a=setup(patched);await a.doDelete();assert.equal(a.S.active,null);assert.equal(a.S.sel.size,0)});
  await test('PATCH: title, board-id and type retained in Trash metadata',async()=>{const a=setup(patched);await a.doDelete();assert.equal(a.idx()[0].bid,'active');assert.equal(a.idx()[0].kind,'obj');assert.equal(a.idx()[0].types.text,1)});
  await test('PATCH: targeted Store Tab non-active deletion waits for backup',async()=>{assert(patched.includes("if (!await trashItems(list, b))"));assert(!patched.includes("const prev = S.board; S.board = b; trashItems(list)"));});
  await test('PATCH: trashBoard caller receives true/false from trashPut',async()=>{const a=setup(patched);a.context._e={kind:'board'};a.context._data={board:a.board};const ok=await vm.runInContext('trashPut(_e,_data)',a.context);assert.equal(ok,true);assert.equal(a.idx().length,1)});
  await test('PATCH: unawaited legacy deleteSel call sites preserved (event dispatch semantics)',async()=>{assert(patched.includes('if (!S.sel.size) return false; deleteSel(); return true;'));assert(patched.includes('if (cut) deleteSel(); else toast('));});
  console.log(`TOTAL ${count}/${33} PASS`);
  if(count!==33)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
