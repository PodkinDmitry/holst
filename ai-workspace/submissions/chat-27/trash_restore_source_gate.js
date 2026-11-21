#!/usr/bin/env node
'use strict';
/* Execute actual trashRestore() from private Test13 source, with synthetic backend/UI.
 * Supply paths to original and patched Test13 base29.html. Not browser E2E. */
const fs=require('fs'), vm=require('vm'), assert=require('assert').strict;
const [originalPath,patchedPath]=process.argv.slice(2);
if(!originalPath||!patchedPath)throw Error('Usage: node trash_restore_source_gate.js <original-base29.html> <patched-base29.html>');
function extract(p){
 const s=fs.readFileSync(p,'utf8');
 const begin=s.includes('// Pending restored objects stay in memory')?s.indexOf('// Pending restored objects stay in memory'):s.indexOf('async function trashRestore(id) {');
 const end=s.indexOf('\nasync function trashDrop(ids)',begin);
 assert(begin>=0&&end>begin,'source function exact boundaries');
 const f=s.slice(begin,end);
 assert(f.includes("Store.get('trash:' + id)")&&f.includes('Backend.saveBoard(')&&f.includes("Store.del('trash:' + id)"),'real trashRestore function body');
 return f;
}
const original=extract(originalPath),patched=extract(patchedPath);
assert(!original.includes('trashRestorePending')&&patched.includes('trashRestorePending')&&patched.includes('canLeaveCurrentBoard'),'versions are exact and distinct');
const clone=x=>JSON.parse(JSON.stringify(x));
function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};}
const board=(id='base',items=[{id:'existing',text:'live'}])=>({id,name:'Original',items:clone(items),assets:{},updatedAt:100});
const item=(id='deleted')=>({id,text:'Recovered note'});
function fixture(src,opt={}){
 let count=0, dirty=!!opt.dirty, saving=!!opt.saving, saveAgain=!!opt.saveAgain;
 let index=clone(opt.trashIndex||[{id:'trash1',kind:opt.kind||'board',bid:'base',title:'Record'}]);
 const saved=new Map((opt.boards||[]).map(b=>[b.id,clone(b)]));
 const trash=new Map([['trash:trash1',clone(opt.data||((opt.kind||'board')==='board'?{board:board('restored'),bm:null}:{items:[item()],assets:{}}))]]);
 const current=opt.current===undefined?board('base'):opt.current;
 const S={board:current,index:clone(opt.index||[...(opt.boards||[]).map(b=>({id:b.id,name:b.name}))]),sel:new Set(),org:!!opt.org};
 const calls={writes:[],loads:[],dels:[],flush:0,hist:0,changed:0,meta:[],draw:0,events:[],guard:0};
 let storeDelGate=opt.storeDelGate,saveGate=opt.saveGate,loadGate=opt.loadGate,guardGate=opt.guardGate;
 const context={S,Date,console:{error:x=>calls.events.push('error:'+String(x))},
  uid:()=> 'uid'+(++count),newBoard:name=>({id:'created-'+(++count),name,items:[],assets:{}}),clone,
  trashIdx:()=>index,trashSaveIdx:x=>{index=x;},
  Store:{get:async k=>{if(opt.getFail)throw Error('read failure');return clone(trash.get(k)||null)},del:async k=>{calls.dels.push(k);if(storeDelGate)await storeDelGate.promise;if(opt.storeDelFail)throw Error('trash delete failed');trash.delete(k)}},
  Backend:{loadBoard:async id=>{calls.loads.push(id);if(loadGate)await loadGate.promise;if(opt.loadFail)throw Error('load failed');return clone(saved.get(id)||null)},
   saveBoard:async b=>{calls.writes.push(clone(b));if(saveGate)await saveGate.promise;if(opt.saveFail)throw Error('storage refused');if(opt.removed)return {removed:true};saved.set(b.id,clone(b));if(!S.index.find(x=>x.id===b.id))S.index.push({id:b.id,name:b.name});return opt.ack||{};}},
  bmSet:(id,bm)=>calls.meta.push([id,bm]),renderDrawer:()=>calls.draw++,toast:m=>calls.events.push(String(m)),
  pushHist:()=>calls.hist++,changed:()=>{calls.changed++;dirty=true;},
  canLeaveCurrentBoard:async()=>{calls.guard++;if(guardGate)await guardGate.promise;if(opt.guardRefuse)return false;if(opt.saveFail||opt.removed)return false;if(!opt.deferSave)dirty=false;return !dirty&&!saving&&!saveAgain;}
 };
 Object.defineProperties(context,{dirty:{get:()=>dirty,set:x=>{dirty=x}},saving:{get:()=>saving,set:x=>{saving=x}},saveAgain:{get:()=>saveAgain,set:x=>{saveAgain=x}}});
 const ctx=vm.createContext(context);
 vm.runInContext(src+'\nthis.restoreEntry=trashRestore;',ctx,{timeout:2000});
 return{S,calls,saved,trash,run:()=>ctx.restoreEntry('trash1'),has:()=>index.some(x=>x.id==='trash1'),inTrash:()=>trash.has('trash:trash1'),dirty:()=>dirty,setDirty:x=>{dirty=x},setSaving:x=>{saving=x},index:()=>index};
}
let passed=0;
async function test(name,f){try{await f();passed++;console.log('PASS',String(passed).padStart(2,'0'),name)}catch(e){console.error('FAIL',name,e);process.exitCode=1}}
async function main(){
// Original source-backed negative controls, intentionally verifying unsafe outcomes.
await test('ORIGINAL NEGATIVE: backend removed:true loses the only board trash entry',async()=>{const f=fixture(original,{removed:true});await f.run();assert(!f.has()&&!f.inTrash()&&f.saved.size===0);});
await test('ORIGINAL NEGATIVE: object nonactive backend removed:true still consumes trash',async()=>{const f=fixture(original,{kind:'obj',current:board('other'),boards:[board('base')],removed:true});await f.run();assert(!f.has()&&f.saved.get('base').items.length===1);});
await test('ORIGINAL NEGATIVE: active object restore consumes backup before autosave',async()=>{const f=fixture(original,{kind:'obj',current:board('base')});await f.run();assert(!f.has()&&f.dirty()&&f.S.board.items.length===2);});
await test('ORIGINAL NEGATIVE: missing origin silently restores onto unrelated open board',async()=>{const f=fixture(original,{kind:'obj',current:board('unrelated')});await f.run();assert.equal(f.S.board.items.length,2);assert(!f.has());});
await test('ORIGINAL NEGATIVE: concurrent clicks attempt duplicate board restores',async()=>{const g=deferred(),f=fixture(original,{saveGate:g});const a=f.run(),b=f.run();for(let i=0;i<5;i++)await Promise.resolve();assert.equal(f.calls.writes.length,2);g.resolve();await Promise.all([a,b]);});
await test('ORIGINAL NEGATIVE: Store.del error still removes index',async()=>{const f=fixture(original,{storeDelFail:true});await f.run();assert(!f.has()&&f.inTrash());});
await test('PATCH: board backend removed:true retains original copy',async()=>{const f=fixture(patched,{removed:true});assert.equal(await f.run(),false);assert(f.has()&&f.inTrash()&&f.saved.size===0);});
await test('PATCH: board backend rejects retains original copy and shows error',async()=>{const f=fixture(patched,{saveFail:true});assert.equal(await f.run(),false);assert(f.has()&&f.inTrash());assert(f.calls.events.some(x=>x.includes('Не удалось восстановить')));});
await test('PATCH: successful board restore persists and consumes backup',async()=>{const f=fixture(patched);assert.equal(await f.run(),true);assert(!f.has()&&!f.inTrash());assert(f.saved.has('restored'));});
await test('PATCH: existing board id collision generates independent target id',async()=>{const f=fixture(patched,{boards:[board('restored')],index:[{id:'restored'}]});assert.equal(await f.run(),true);assert(f.saved.has('restored'));assert.equal(f.saved.get('restored').items[0].text,'live');assert.equal(f.saved.size,2);});
await test('PATCH: corrupted board data is rejected before write and trash preserved',async()=>{const f=fixture(patched,{data:{board:{id:'x',items:'bad'}}});assert.equal(await f.run(),false);assert(f.has());assert.equal(f.calls.writes.length,0);});
await test('PATCH: object with missing original board cannot be restored to unrelated board',async()=>{const f=fixture(patched,{kind:'obj',current:board('unrelated')});assert.equal(await f.run(),false);assert.equal(f.S.board.items.length,1);assert(f.has());});
await test('PATCH: nonactive object restore writes cloned board before trash consumption',async()=>{const f=fixture(patched,{kind:'obj',current:board('other'),boards:[board('base')]});assert.equal(await f.run(),true);assert.equal(f.saved.get('base').items.length,2);assert(!f.has());assert.equal(f.S.board.id,'other');});
await test('PATCH: nonactive object save removed:true preserves copy and old stored board',async()=>{const f=fixture(patched,{kind:'obj',current:board('other'),boards:[board('base')],removed:true});assert.equal(await f.run(),false);assert(f.has()&&f.inTrash());assert.equal(f.saved.get('base').items.length,1);});
await test('PATCH: nonactive object save fails preserving copy and previous board',async()=>{const f=fixture(patched,{kind:'obj',current:board('other'),boards:[board('base')],saveFail:true});assert.equal(await f.run(),false);assert(f.has());assert.equal(f.saved.get('base').items.length,1);});
await test('PATCH: active object restore only removes backup once current board flushed',async()=>{const f=fixture(patched,{kind:'obj',current:board('base')});assert.equal(await f.run(),true);assert(!f.has());assert.equal(f.S.board.items.length,2);assert.equal(f.calls.guard,1);});
await test('PATCH: active object restore with save refusal leaves backup intact',async()=>{const f=fixture(patched,{kind:'obj',current:board('base'),saveFail:true});assert.equal(await f.run(),false);assert(f.has());assert.equal(f.S.board.items.length,2);assert.equal(f.calls.guard,1);});
await test('PATCH: retry after unsaved active restore does not add duplicate objects',async()=>{const f=fixture(patched,{kind:'obj',current:board('base'),saveFail:true});await f.run();await f.run();assert.equal(f.S.board.items.length,2);assert(f.has());});
await test('PATCH: retry after transient guard refusal can complete without duplicate',async()=>{const f=fixture(patched,{kind:'obj',current:board('base'),guardRefuse:true});await f.run();assert.equal(f.S.board.items.length,2);await f.run();assert.equal(f.S.board.items.length,2);});
await test('PATCH: object restore into virtual board is refused with backup retained',async()=>{const b=board('base');b.virtual=true;const f=fixture(patched,{kind:'obj',current:b});assert.equal(await f.run(),false);assert(f.has());assert.equal(f.S.board.items.length,1);});
await test('PATCH: invalid object snapshot prevents change to board and backup',async()=>{const f=fixture(patched,{kind:'obj',current:board('base'),data:{items:'oops'}});assert.equal(await f.run(),false);assert(f.has());assert.equal(f.S.board.items.length,1);});
await test('PATCH: Store.get errors do not consume trash index',async()=>{const f=fixture(patched,{getFail:true});assert.equal(await f.run(),false);assert(f.has());});
await test('PATCH: trash deletion error retains index for later cleanup',async()=>{const f=fixture(patched,{storeDelFail:true});assert.equal(await f.run(),false);assert(f.has()&&f.inTrash());assert(f.saved.has('restored'));});
await test('PATCH: concurrent board restore attempts only one backend write',async()=>{const g=deferred(),f=fixture(patched,{saveGate:g});const a=f.run(),b=f.run();for(let i=0;i<5;i++)await Promise.resolve();assert.equal(f.calls.writes.length,1);g.resolve();await Promise.all([a,b]);assert(!f.has());});
await test('PATCH: concurrent active object restore does not add twice',async()=>{const g=deferred(),f=fixture(patched,{kind:'obj',current:board('base'),guardGate:g});const a=f.run(),b=f.run();for(let i=0;i<6;i++)await Promise.resolve();assert.equal(f.S.board.items.length,2);g.resolve();await Promise.all([a,b]);assert.equal(f.S.board.items.length,2);});
await test('PATCH: active board changed during pending flush keeps trash',async()=>{const g=deferred(),f=fixture(patched,{kind:'obj',current:board('base'),guardGate:g});const a=f.run();for(let i=0;i<6;i++)await Promise.resolve();f.S.board=board('other');g.resolve();await a;assert(f.has());});
await test('PATCH: duplicate object id is assigned a new id',async()=>{const f=fixture(patched,{kind:'obj',current:board('base',[item('deleted')])});assert.equal(await f.run(),true);assert.equal(new Set(f.S.board.items.map(x=>x.id)).size,2);});
await test('PATCH: successful board metadata restoration uses newly generated id',async()=>{const f=fixture(patched,{data:{board:board('restored'),bm:{x:1}},boards:[board('restored')],index:[{id:'restored'}],org:true});assert.equal(await f.run(),true);assert.equal(f.calls.meta.length,1);assert.notEqual(f.calls.meta[0][0],'restored');});
await test('PATCH: unknown trash entry type is not consumed',async()=>{const f=fixture(patched,{trashIndex:[{id:'trash1',kind:'weird'}]});assert.equal(await f.run(),false);assert(f.has());});
await test('PATCH: without current board, object recovery uses exact stored source',async()=>{const f=fixture(patched,{kind:'obj',current:null,boards:[board('base')]});assert.equal(await f.run(),true);assert.equal(f.saved.get('base').items.length,2);});
if(process.exitCode)throw Error('At least one test failed');console.log(`SUMMARY ${passed}/${passed} Node VM source-backed PASS; mock Store/Backend/DOM, not browser E2E`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
