#!/usr/bin/env node
// Source-backed isolation gate: executes removeBoardLocally and Drive.sync
// extracted from the provided XOD Test13 HTML. Synthetic backend/DOM only.
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const originals = process.argv[2], patched = process.argv[3];
if (!originals || !patched) { console.error('Usage: node drive_sync_source_gate.js <exact-original-base29.html> <patched-base29.html>'); process.exit(2); }
function functions(file) {
  const source = fs.readFileSync(file, 'utf8');
  const before = source.indexOf('async function removeBoardLocally(bid) {');
  const after = source.indexOf('\nconst driveErr =', before);
  const start = source.indexOf('  async sync(gesture) {');
  const end = source.indexOf('\n  },\n};', start);
  assert.ok(before > 0 && after > before && start > 0 && end > start, 'Source signatures absent');
  return {
    remove: source.slice(before, after),
    sync: source.slice(start, end + '\n  }'.length),
    source,
  };
}
const raw = functions(originals), fix = functions(patched);
assert.notEqual(raw.remove, fix.remove, 'Must exercise a modified real handler');
assert.notEqual(raw.sync, fix.sync, 'Must exercise a modified real sync route');
function world(code, opts={}) {
  const ids = opts.ids || ['victim'];
  const persisted = new Map(ids.map(id=>[id,{id,name:id,items:[{id:'stored',text:id}],updatedAt:1,hash:'old',welcome:!!opts.welcome}]));
  const currentId = opts.current === undefined ? 'victim' : opts.current;
  const active = currentId ? {id:currentId,name:currentId,items:[{id:'unsaved',text:'NEW EDIT'}]} : null;
  const calls={deleted:[],loaded:[],statuses:[],pushed:[],renders:0,toasts:[],warns:[],lastSaves:0,statusText:[],saveNow:0, driveStates:[],metaSaved:0};
  const state={ S:{ board:active, index:ids.map(id=>({id,updatedAt:1})) }, dirty:!!opts.dirty, saving:!!opts.saving, saveAgain:!!opts.saveAgain, console:{ warn:(...a)=>calls.warns.push(a.join(' ')), error:(...a)=>calls.warns.push(a.join(' ')) },
   Backend:{ async deleteBoard(id) { calls.deleted.push(id); if(opts.onDelete) await opts.onDelete(state,id); if(opts.failDelete) throw new Error('synthetic delete failure');persisted.delete(id); }, async loadBoard(id) { calls.loaded.push(id); if(opts.failLoad) throw new Error('load failed');return persisted.get(id)||null; }},
   newBoard(name){return {id:'new',name,items:[]}}, loadBoard(b){calls.loaded.push('UI:'+b.id);state.S.board=b}, fitAll(){}, renderDrawer(){calls.renders++},
   saveNow:async()=>{calls.saveNow++; if(opts.saveNowEffect)await opts.saveNowEffect(state);}, setStatus(s){calls.statusText.push(s)},toast(s){calls.toasts.push(s)},
   LS:{get(k){ if(k.startsWith('welcome:'))return 'old';return null; }, set(k,v){calls.lastSaves++;}},
   navigator:{onLine:true},syBoardOff(id){return id==='remote-only';},syDirOf(){return 'merge';},boardHash(b){return b.hash||'old';},
   syOnConflict:async()=>{throw new Error('unexpected conflict branch')},
   Date, setTimeout, clearTimeout, Promise, Map,
  };
  const ctx=vm.createContext(state);
  vm.runInContext(code.remove+'\n globalThis.__remove=removeBoardLocally; globalThis.__sync=({'+code.sync+'}).sync;',ctx,{timeout:2000});
  const meta={};for(const id of ids)meta[id]={fileId:id+'-cloud',hash:'old',u:1,rev:'cloudrev'};
  const fakeDrive={mode:'rest',running:false,again:false,pending:false,lastSync:0,halted:'',writeBlocked:false,st:{deleted:[],meta},
    active:()=>true,ready:()=>true,ensureRoot:async()=>{},remoteBoards:async()=>opts.remoteOnly?new Map([['remote-only',{id:'cloud0',rev:'remote-v'}]]):new Map(),
    applyBoardDeletes300:async()=>{},recoverDriveBranches300:async()=>{},status:async(id)=>({st:opts.remoteStatus||'gone'}),
    push:async(b)=>{calls.pushed.push(b.id)},syncMeta:async()=>{calls.metaSaved++},persist:async()=>{},setState(s,n){calls.driveStates.push(s)},schedule:()=>{},write:async fn=>fn(),trash:async()=>{},
    pull:async()=>false,
  };
  return {ctx,calls,persisted,drive:fakeDrive,meta};
}
let pass=0,failed=0;
async function test(label,fn) {try{await fn();pass++;console.log('PASS',label)}catch(e){failed++;console.log('FAIL',label, e.stack||e)}}
const hasIndex=(w,id)=>w.ctx.S.index.some(x=>x.id===id);
const hasMeta=(w,id)=>Object.prototype.hasOwnProperty.call(w.drive.st.meta,id);
async function remove(code,opts) {const w=world(code,opts);const result=await w.ctx.__remove('victim');return {...w,result};}
async function sync(code,opts) {const w=world(code,opts);await w.ctx.__sync.call(w.drive);return w;}
(async()=>{
// Original negative controls: assertions deliberately require the unsafe original behavior.
await test('ORIGINAL NEGATIVE: background cleanup evicts dirty open board',async()=>{const w=await remove(raw,{dirty:true});assert.notEqual(w.ctx.S.board.id,'victim');assert.equal(w.ctx.dirty,false);});
await test('ORIGINAL NEGATIVE: failed local delete still clears index',async()=>{const w=await remove(raw,{current:'other',failDelete:true});assert.equal(hasIndex(w,'victim'),false);});
await test('ORIGINAL NEGATIVE: Drive remote deletion drops active dirty board',async()=>{const w=await sync(raw,{dirty:true});assert.notEqual(w.ctx.S.board.id,'victim');assert.equal(hasMeta(w,'victim'),false);});
await test('ORIGINAL NEGATIVE: Drive delete failure still loses sync metadata',async()=>{const w=await sync(raw,{current:'other',failDelete:true});assert.equal(hasMeta(w,'victim'),false);assert.equal(hasIndex(w,'victim'),false);});
await test('ORIGINAL NEGATIVE: welcome cleanup erases open welcome board',async()=>{const w=await sync(raw,{welcome:true,remoteOnly:true});assert.notEqual(w.ctx.S.board.id,'victim');});
await test('ORIGINAL NEGATIVE: async deletion clobbers board opened mid-flight',async()=>{const w=await remove(raw,{current:'other',dirty:true,onDelete:async s=>{s.S.board={id:'victim',items:[{id:'late',text:'edit'}]};s.dirty=true;}});assert.notEqual(w.ctx.S.board.id,'victim');assert.equal(w.ctx.dirty,false);});
// Patched: direct function guards.
await test('PATCH: current dirty board remains open and present',async()=>{const w=await remove(fix,{dirty:true});assert.equal(w.result,false);assert.equal(w.ctx.S.board.id,'victim');assert.equal(w.ctx.dirty,true);assert.equal(w.calls.deleted.length,0);assert.ok(hasIndex(w,'victim'));});
await test('PATCH: even clean currently open board is not silently deleted',async()=>{const w=await remove(fix,{});assert.equal(w.result,false);assert.equal(w.calls.deleted.length,0);assert.ok(hasIndex(w,'victim'));});
await test('PATCH: pending save prevents background cleanup',async()=>{const w=await remove(fix,{current:'other',saving:true});assert.equal(w.result,false);assert.equal(w.calls.deleted.length,0);assert.ok(hasIndex(w,'victim'));});
await test('PATCH: queued re-save prevents background cleanup',async()=>{const w=await remove(fix,{current:'other',saveAgain:true});assert.equal(w.result,false);assert.equal(w.calls.deleted.length,0);});
await test('PATCH: successful inactive board delete keeps other active board',async()=>{const w=await remove(fix,{current:'other',ids:['victim','other']});assert.equal(w.result,true);assert.equal(w.ctx.S.board.id,'other');assert.equal(w.persisted.has('victim'),false);assert.equal(hasIndex(w,'victim'),false);assert.ok(hasIndex(w,'other'));});
await test('PATCH: failed local deletion leaves catalog unchanged',async()=>{const w=await remove(fix,{current:'other',failDelete:true});assert.equal(w.result,false);assert.equal(hasIndex(w,'victim'),true);assert.equal(w.calls.renders,0);assert.equal(w.calls.warns.length,1);});
await test('PATCH: late navigation does not evict in-memory edits',async()=>{const w=await remove(fix,{current:'other',onDelete:async s=>{s.S.board={id:'victim',items:[{id:'late'}]};s.dirty=true;}});assert.equal(w.result,false);assert.equal(w.ctx.S.board.id,'victim');assert.equal(w.ctx.dirty,true);assert.deepEqual(w.calls.statusText,['error']);assert.equal(w.calls.toasts.length,1);});
await test('PATCH: retry after transient backend failure can remove inactive board',async()=>{const w=world(fix,{current:'other'});w.ctx.Backend.deleteBoard=async()=>{throw Error('fail')};assert.equal(await w.ctx.__remove('victim'),false);assert.ok(hasIndex(w,'victim'));w.ctx.Backend.deleteBoard=async id=>{w.persisted.delete(id)};assert.equal(await w.ctx.__remove('victim'),true);assert.equal(hasIndex(w,'victim'),false);});
// Patched: actual Drive.sync method evaluated, not reconstructed sync pseudocode.
await test('PATCH: Drive remote deletion preserves current board metadata',async()=>{const w=await sync(fix,{});assert.equal(w.ctx.S.board.id,'victim');assert.equal(w.calls.deleted.length,0);assert.ok(hasMeta(w,'victim'));assert.ok(hasIndex(w,'victim'));assert.equal(w.calls.pushed.length,0);});
await test('PATCH: Drive failed save before remote delete preserves dirty board',async()=>{const w=await sync(fix,{dirty:true});assert.equal(w.ctx.S.board.id,'victim');assert.equal(w.ctx.dirty,true);assert.equal(w.calls.saveNow,1);assert.ok(hasMeta(w,'victim'));assert.equal(w.calls.deleted.length,0);});
await test('PATCH: Drive successful inactive delete clears metadata and index',async()=>{const w=await sync(fix,{current:'other'});assert.equal(hasMeta(w,'victim'),false);assert.equal(hasIndex(w,'victim'),false);assert.equal(w.ctx.S.board.id,'other');assert.equal(w.calls.deleted.length,1);});
await test('PATCH: Drive failed inactive delete retains metadata and index',async()=>{const w=await sync(fix,{current:'other',failDelete:true});assert.equal(hasMeta(w,'victim'),true);assert.equal(hasIndex(w,'victim'),true);assert.equal(w.ctx.S.board.id,'other');assert.equal(w.calls.pushed.length,0);});
await test('PATCH: Drive in-flight save blocks inactive remote deletion',async()=>{const w=await sync(fix,{current:'other',saving:true});assert.equal(hasMeta(w,'victim'),true);assert.equal(w.calls.deleted.length,0);});
await test('PATCH: Drive welcome cleanup removes unused inactive welcome board',async()=>{const w=await sync(fix,{current:'other',welcome:true,remoteOnly:true});assert.equal(hasIndex(w,'victim'),false);assert.equal(w.calls.deleted.length,1);});
await test('PATCH: Drive welcome cleanup defers open welcome board',async()=>{const w=await sync(fix,{welcome:true,remoteOnly:true});assert.equal(hasIndex(w,'victim'),true);assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.S.board.id,'victim');});
await test('PATCH: Drive welcome cleanup does nothing without remote boards',async()=>{const w=await sync(fix,{current:'other',welcome:true});assert.equal(hasIndex(w,'victim'),true);assert.equal(w.calls.deleted.length,0);});
await test('PATCH: Drive prior local edit mismatch follows push rather than auto-delete',async()=>{const w=world(fix,{current:'other'});w.persisted.get('victim').hash='new';w.persisted.get('victim').updatedAt=2;await w.ctx.__sync.call(w.drive);assert.equal(w.calls.deleted.length,0);assert.deepEqual(w.calls.pushed,['victim']);assert.equal(hasIndex(w,'victim'),true);});
await test('PATCH: missing locally persisted board does not trigger automatic deletion',async()=>{const w=world(fix,{current:'other'});w.persisted.delete('victim');await w.ctx.__sync.call(w.drive);assert.equal(w.calls.deleted.length,0);assert.equal(hasMeta(w,'victim'),true);});
await test('PATCH: error-returning storage does not touch unrelated board',async()=>{const w=await sync(fix,{current:'another',ids:['victim','another'],failDelete:true});assert.equal(w.ctx.S.board.id,'another');assert.ok(hasIndex(w,'another'));assert.ok(hasIndex(w,'victim'));});
await test('PATCH: no deletion after sync when board switched to target during cleanup',async()=>{const w=await sync(fix,{current:'other',onDelete:async s=>{s.S.board={id:'victim',items:[{id:'new'}]};s.dirty=true;}});assert.ok(hasMeta(w,'victim'));assert.ok(hasIndex(w,'victim'));assert.equal(w.ctx.S.board.id,'victim');assert.equal(w.ctx.dirty,true);assert.equal(w.calls.toasts.length,1);});
console.log(`RESULT: ${pass} PASS / ${failed} FAIL`);if(failed)process.exit(1);
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
