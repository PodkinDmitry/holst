#!/usr/bin/env node
'use strict';
// Execute ORIGINAL/PATCHED Test13 bselAct and deleteBoardWithTrash300 in Node VM;
// backend, DOM, trash persistence and navigation are synthetic. NOT a browser E2E.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const [original, patched, chat19Baseline] = process.argv.slice(2);
if (!original || !patched || !chat19Baseline) { console.error('Usage: node bulk_board_source_gate.js ORIGINAL_BASE29 PATCHED_BASE29 CHAT19_BASE29'); process.exit(2); }
function sourceHandlers(path) {
  const s=fs.readFileSync(path,'utf8');
  const at=s.indexOf('async function deleteBoardWithTrash300('), end=s.indexOf('\nasync function trashRestore(',at);
  let b=s.indexOf('async function bselAct(e) {'), e=s.indexOf("\ndocument.addEventListener('click', e => {",b);
  assert.ok(at>0&&end>at&&b>0&&e>b,'actual handler signatures missing');
  if(s.lastIndexOf('let bselDeleteBusy = false;',b)>b-40) b=s.lastIndexOf('let bselDeleteBusy = false;',b);
  return {delete:s.slice(at,end), bulk:s.slice(b,e)};
}
const raw=sourceHandlers(original), fix=sourceHandlers(patched), prior=sourceHandlers(chat19Baseline);
assert.notEqual(prior.bulk,fix.bulk);
assert.notEqual(raw.delete,fix.delete);assert.notEqual(raw.bulk,fix.bulk);
const deep = v=>JSON.parse(JSON.stringify(v));
function world(handlers,options={}) {
  const ids=options.ids||['A','B','C'], selected=options.selected||['A','B'];
  const persisted = new Map(ids.map((id,k)=>[id,{id,name:id,updatedAt:100-k,items:[{text:'stored:'+id}]}]));
  const current=options.current===undefined?'A':options.current;
  const active=current?deep(persisted.get(current)||{id:current,name:current,items:[{text:'unindexed'}]}):null;
  if(active && options.dirty)active.items.push({text:'LATEST UNSAVED EDIT'});
  const calls={trash:[],deleted:[],loaded:[],forgot:[],saved:[],toast:[],statuses:[],confirm:[],render:0,finish:0,guard:0,button:null};
  const ctx={S:{board:active,index:ids.map((id,k)=>({id,updatedAt:100-k}))},BSEL:new Set(selected),
    dirty:!!options.dirty,saving:!!options.saving,saveAgain:!!options.saveAgain,
    console:{error(){},warn(){}},Promise,Map,Set,Date,
    Drive:{forget(id){calls.forgot.push(id)}},
    async uiConfirm(prompt){calls.confirm.push(prompt);if(options.onConfirm)await options.onConfirm(ctx);return options.confirm!==false;},
    finishEdit(){calls.finish++;if(options.onFinish)options.onFinish(ctx);},
    async canLeaveCurrentBoard(){calls.guard++;if(options.onGuard)return options.onGuard(ctx,calls,persisted);
       if(options.refuseGuard||ctx.saving||ctx.saveAgain)return false;
       if(ctx.dirty){if(options.failSave)return false;
         calls.saved.push(ctx.S.board.id);persisted.set(ctx.S.board.id,deep(ctx.S.board));ctx.dirty=false;}
       return true;
    },
    async trashBoard(id){calls.trash.push({id,snapshot:deep(persisted.get(id)||null)});
       if(options.onTrash)await options.onTrash(ctx,id,calls,persisted);
       if(options.failTrashId===id)throw Error('synthetic trash write failure');
       return 'expected:'+id;
    },
    Backend:{async deleteBoard(id,{expected}={}){calls.deleted.push({id,expected});
        if(options.onDelete)await options.onDelete(ctx,id,calls,persisted);
        if(options.failDeleteId===id)throw Error('synthetic backend delete failure');
        persisted.delete(id);
      },async loadBoard(id){calls.loaded.push(id);if(options.onLoad)await options.onLoad(ctx,id,calls,persisted);return deep(persisted.get(id)||null);}},
    loadBoard(board){ctx.S.board=board;calls.loaded.push('UI:'+(board&&board.id));ctx.dirty=false;},
    newBoard(name){return {id:'new-board',name,items:[]}},
    async saveNow(){calls.saved.push('new-board');},bsRender(){calls.render++;},renderDrawer(){calls.render++;},bselDraw(){calls.render++;},
    toast(msg){calls.toast.push(String(msg));},setStatus(st){calls.statuses.push(st)},
    plural(n,a,b,c){return n===1?a:n<5?b:c},
    // Other branches of bselAct are not exercised; provided for completeness.
    orgGroups(){return[]},openPop(){},bmSet(){},colorPop(){},CARD_COLORS:[],syBoardOff(){return false},
    syOff(){return false},syResume:async()=>{},syPolOf(){return'merge'},SY:{off:{}},sySave(){},syRefresh(){},
  };
  ctx.__button={dataset:{bsa:'del'},disabled:false};calls.button=ctx.__button;
  const context=vm.createContext(ctx);
  vm.runInContext(handlers.delete+'\n'+handlers.bulk+'\nglobalThis.__bulk=bselAct;globalThis.__deleteWithTrash=deleteBoardWithTrash300;',context,{timeout:1000});
  return {ctx:context,calls,persisted,async run(){return context.__bulk({target:{closest(){return ctx.__button}},stopPropagation(){}})}};
}
const has=(w,id)=>w.ctx.S.index.some(x=>x.id===id);
let pass=0,fail=0;
async function test(label,fn){try{await fn();pass++;console.log('PASS',label)}catch(e){fail++;console.error('FAIL',label,e.stack||e)}}
function deferred(){let release;const p=new Promise(r=>{release=r});return {p,release};}
(async()=>{
// Negative controls deliberately demonstrate unsafe ORIGINAL behavior.
await test('ORIGINAL NEGATIVE: dirty active board is discarded without saving',async()=>{
 const w=world(raw,{dirty:true});await w.run();assert.ok(w.calls.deleted.some(x=>x.id==='A'));assert.equal(w.calls.saved.length,0);assert.notEqual(w.ctx.S.board.id,'A');
});
await test('ORIGINAL NEGATIVE: trash snapshot lacks unsaved active edits',async()=>{
 const w=world(raw,{dirty:true,selected:['A']});await w.run();assert.equal(w.calls.trash[0].snapshot.items.length,1);assert.equal(w.calls.saved.length,0);
});
await test('ORIGINAL NEGATIVE: an edit made during async delete is overwritten',async()=>{
 const w=world(raw,{selected:['A'],onDelete:async (c,id)=>{if(id==='A'){c.S.board.items.push({text:'LATE EDIT'});c.dirty=true;}}});await w.run();assert.notEqual(w.ctx.S.board.id,'A');assert.equal(w.ctx.dirty,false);
});
await test('ORIGINAL NEGATIVE: double click can execute deletion twice',async()=>{
 const gate=deferred(),entered=deferred();let n=0;
 const w=world(raw,{selected:['B'],current:'A',onDelete:async()=>{n++;if(n===1){entered.release();await gate.p;}}});
 const a=w.run();await entered.p;const b=w.run();gate.release();await Promise.all([a,b]);assert.equal(w.calls.deleted.filter(x=>x.id==='B').length,2);
});
await test('ORIGINAL NEGATIVE: asynchronous fallback overwrites later navigation',async()=>{
 const w=world(raw,{selected:['A'],onLoad:async c=>{c.S.board={id:'C',name:'C',items:[{text:'new navigation'}]};c.dirty=true;}});await w.run();assert.notEqual(w.ctx.S.board.id,'C');
});
await test('ORIGINAL NEGATIVE: partial failure clears retry selection',async()=>{
 const w=world(raw,{selected:['A','B'],current:'C',failDeleteId:'B'});await w.run();assert.equal(w.ctx.BSEL.size,0);assert.ok(has(w,'B'));
});
// Check precisely what CHAT19 already fixed versus the remaining independent risk.
await test('CHAT19 EXISTING GUARD: rejected save keeps current board',async()=>{
 const w=world(prior,{dirty:true,failSave:true});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.S.board.id,'A');
});
await test('CHAT19 RESIDUAL: edit during async delete is still discarded',async()=>{
 const w=world(prior,{selected:['A'],onDelete:async(c,id)=>{if(id==='A'){c.S.board.items.push({text:'LATE'});c.dirty=true;}}});await w.run();assert.notEqual(w.ctx.S.board.id,'A');
});
await test('CHAT19 RESIDUAL: double click still deletes twice',async()=>{
 const gate=deferred(),entered=deferred();let n=0;
 const w=world(prior,{selected:['B'],onDelete:async()=>{n++;if(n===1){entered.release();await gate.p;}}});
 const a=w.run();await entered.p;const b=w.run();gate.release();await Promise.all([a,b]);assert.equal(w.calls.deleted.length,2);
});
await test('CHAT19 RESIDUAL: fallback loading overrides a newer navigation',async()=>{
 const w=world(prior,{selected:['A'],onLoad:async c=>{c.S.board={id:'C',items:[{text:'later'}]};c.dirty=true}});await w.run();assert.notEqual(w.ctx.S.board.id,'C');
});
await test('CHAT19 RESIDUAL: late edit during trash snapshot still committed',async()=>{
 const w=world(prior,{selected:['A'],onTrash:async c=>{c.S.board.items.push({text:'late after guard'});c.dirty=true}});await w.run();assert.equal(w.calls.deleted.length,1);assert.notEqual(w.ctx.S.board.id,'A');
});
// Patched behavior and targeted race simulations.
await test('PATCH: dirty current board is saved before its trash snapshot',async()=>{
 const w=world(fix,{dirty:true,selected:['A']});await w.run();assert.deepEqual(w.calls.saved,['A']);assert.equal(w.calls.trash[0].snapshot.items.length,2);assert.equal(w.persisted.has('A'),false);
});
await test('PATCH: failed active autosave aborts the entire destructive batch',async()=>{
 const w=world(fix,{dirty:true,failSave:true});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.calls.trash.length,0);assert.equal(w.ctx.S.board.id,'A');assert.ok(w.ctx.dirty);assert.equal(w.ctx.BSEL.size,2);
});
await test('PATCH: virtual-board refusal aborts deletion',async()=>{
 const w=world(fix,{dirty:true,refuseGuard:true});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.S.board.id,'A');
});
await test('PATCH: in-flight save aborts before trash writes',async()=>{
 const w=world(fix,{saving:true});await w.run();assert.equal(w.calls.trash.length,0);assert.equal(w.ctx.S.board.id,'A');
});
await test('PATCH: refused confirmation performs no writes and unlocks button',async()=>{
 const w=world(fix,{confirm:false});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.calls.button.disabled,false);assert.equal(w.ctx.BSEL.size,2);
});
await test('PATCH: delete current last after other selected board',async()=>{
 const w=world(fix,{selected:['A','B']});await w.run();assert.deepEqual(w.calls.deleted.map(x=>x.id),['B','A']);assert.equal(w.ctx.S.board.id,'C');assert.equal(w.ctx.BSEL.size,0);
});
await test('PATCH: successful deletion of inactive boards leaves current intact',async()=>{
 const w=world(fix,{current:'A',selected:['B','C']});const initial=w.ctx.S.board;await w.run();assert.equal(w.ctx.S.board,initial);assert.equal(w.persisted.size,1);assert.deepEqual(w.calls.forgot,['B','C']);
});
await test('PATCH: backend failure retains failing board and selection',async()=>{
 const w=world(fix,{current:'C',selected:['A','B'],failDeleteId:'B'});await w.run();assert.equal(w.persisted.has('A'),false);assert.ok(w.persisted.has('B'));assert.equal(has(w,'B'),true);assert.equal(w.ctx.BSEL.has('B'),true);assert.ok(w.calls.toast.some(s=>s.includes('не удалось: 1')));
});
await test('PATCH: trash failure never reaches backend deletion',async()=>{
 const w=world(fix,{selected:['B'],failTrashId:'B'});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.BSEL.has('B'),true);
});
await test('PATCH: late current edit after trash snapshot aborts backend commit',async()=>{
 const w=world(fix,{selected:['A'],onTrash:async(c,id)=>{if(id==='A'){c.S.board.items.push({text:'EDIT DURING TRASH'});c.dirty=true}}});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.S.board.id,'A');assert.equal(w.ctx.dirty,true);assert.ok(w.persisted.has('A'));assert.equal(w.ctx.BSEL.has('A'),true);
});
await test('PATCH: late current edit after backend commit preserves on-screen data for export',async()=>{
 const w=world(fix,{selected:['A'],onDelete:async(c,id)=>{if(id==='A'){c.S.board.items.push({text:'EDIT AFTER BACKEND START'});c.dirty=true;}}});await w.run();assert.equal(w.ctx.S.board.id,'A');assert.equal(w.ctx.dirty,true);assert.equal(w.ctx.S.board.items.at(-1).text,'EDIT AFTER BACKEND START');assert.ok(w.calls.statuses.includes('error'));assert.equal(has(w,'A'),true);assert.equal(w.calls.forgot.length,0);
});
await test('PATCH: late navigation to inactive deletion target aborts commit',async()=>{
 const w=world(fix,{selected:['B'],onTrash:async(c,id)=>{if(id==='B'){c.S.board={id:'B',items:[{text:'I just opened B'}]};c.dirty=true;}}});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.S.board.id,'B');assert.ok(has(w,'B'));
});
await test('PATCH: mid-delete navigation to victim is retained as recovery warning',async()=>{
 const w=world(fix,{selected:['B'],onDelete:async(c,id)=>{if(id==='B'){c.S.board={id:'B',items:[{text:'late navigator'}]};c.dirty=true;}}});await w.run();assert.equal(w.ctx.S.board.id,'B');assert.equal(w.ctx.dirty,true);assert.ok(has(w,'B'));assert.equal(w.calls.forgot.length,0);assert.ok(w.calls.toast.some(s=>s.includes('сохраните содержимое')));
});
await test('PATCH: simultaneous double click initiates only one delete',async()=>{
 const gate=deferred(),entered=deferred(),w=world(fix,{selected:['B'],onDelete:async()=>{entered.release();await gate.p;}});
 const a=w.run();await entered.p;const b=w.run();gate.release();await Promise.all([a,b]);assert.equal(w.calls.deleted.filter(x=>x.id==='B').length,1);assert.equal(w.calls.button.disabled,false);
});
await test('PATCH: edit during preflight prevents any deletion',async()=>{
 const w=world(fix,{selected:['A','B'],onGuard:async(c)=>{c.dirty=true;return true;}});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.S.board.id,'A');
});
await test('PATCH: queue re-save prevents deletion after preflight',async()=>{
 const w=world(fix,{selected:['A'],onGuard:async(c)=>{c.saveAgain=true;return true;}});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.S.board.id,'A');
});
await test('PATCH: alternate navigation during fallback load is not overwritten',async()=>{
 const w=world(fix,{selected:['A'],onLoad:async c=>{c.S.board={id:'C',name:'C',items:[{text:'new navigation'}]};c.dirty=true;}});await w.run();assert.equal(w.ctx.S.board.id,'C');assert.equal(w.ctx.dirty,true);
});
await test('PATCH: failed delete can be retried with original selection',async()=>{
 const w=world(fix,{current:'C',selected:['B'],failDeleteId:'B'});await w.run();assert.ok(w.ctx.BSEL.has('B'));w.ctx.Backend.deleteBoard=async id=>{w.persisted.delete(id);w.calls.deleted.push({id})};await w.run();assert.equal(w.persisted.has('B'),false);assert.equal(w.ctx.BSEL.has('B'),false);
});
await test('PATCH: canceled deletion can be invoked successfully afterward',async()=>{
 const w=world(fix,{confirm:false,selected:['B']});await w.run();assert.equal(w.calls.button.disabled,false);w.ctx.uiConfirm=async()=>true;await w.run();assert.equal(w.persisted.has('B'),false);
});
await test('PATCH: original single-board deletion contract unchanged without preflight callback',async()=>{
 const w=world(fix,{selected:['B']});await w.ctx.__deleteWithTrash('C');assert.deepEqual(w.calls.deleted.map(x=>x.id),['C']);assert.equal(w.persisted.has('C'),false);
});
await test('PATCH: malformed/stale selection is excluded from backend deletes',async()=>{
 const w=world(fix,{selected:['missing']});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.calls.button.disabled,false);
});
await test('PATCH: when active board changed during confirmation it cannot be silently removed',async()=>{
 const w=world(fix,{selected:['B'],current:'A',onConfirm:async c=>{c.S.board={id:'B',items:[{text:'dirty late B'}]};c.dirty=true}});await w.run();assert.equal(w.calls.deleted.length,0);assert.equal(w.ctx.S.board.id,'B');assert.equal(w.ctx.dirty,true);
});
await test('PATCH: created fallback board after deleting sole active board',async()=>{
 const w=world(fix,{ids:['A'],selected:['A']});await w.run();assert.equal(w.ctx.S.board.id,'new-board');assert.ok(w.calls.saved.includes('new-board'));assert.equal(w.ctx.S.index.length,0);
});
await test('PATCH: failed victim remains in BSEL after other success',async()=>{
 const w=world(fix,{selected:['A','B'],failDeleteId:'A'});await w.run();assert.equal(w.ctx.BSEL.has('A'),true);assert.equal(w.ctx.BSEL.has('B'),false);assert.equal(w.ctx.S.board.id,'A');assert.ok(w.persisted.has('A'));
});
console.log(`RESULT: ${pass} PASS / ${fail} FAIL`);if(fail)process.exit(1);
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
