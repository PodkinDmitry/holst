#!/usr/bin/env node
'use strict';
// Runs the genuine openHistory() function extracted from two Test13 source files.
// Browser, DOM, storage, timers and network are controlled, synthetic fixtures.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
if(process.argv.length!==4){console.error('Usage: node history_source_gate.js /EXACT/Test13/v224/base29.html /PATCHED/v224/base29.html');process.exit(2)}
const [original,patched]=process.argv.slice(2).map(p=>fs.readFileSync(p,'utf8'));
function extract(source){
  const start=source.indexOf('async function openHistory() {');
  assert(start>=0,'Real openHistory() is missing');
  const end=source.indexOf('/* =========================================================\n   v2.0:',start);
  assert(end>start,'openHistory() section boundary is missing');
  const fn=source.slice(start,end).trim();
  assert(fn.endsWith('}'),'Unexpected openHistory() ending');return fn;
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function fixture(source,opts={}){
 const calls={saved:[],loaded:[],toast:[],close:0,guard:0,storeGet:0,fetch:0,dialogs:0,inputs:0};
 const old={id:'working',name:'Current unsaved board',items:[{id:'unsaved',type:'text',text:'uncommitted'}],assets:{original:'asset'}};
 const S={board:old};let generated=0;let dialog;
 const originalItems=[{id:'hist-item',type:'text',text:'old revision'}];
 const snapshot=opts.emptySnapshot?null:{items:originalItems,assets:{historic:'media'}};
 const LS={get:key=>key==='snaps:working'?[{d:'2026-11-20',n:1}]:[]};
 const Store={get:async key=>{
  calls.storeGet++;
  if(opts.storeDeferred)await opts.storeDeferred.promise;
  if(opts.afterStoreGet)opts.afterStoreGet({S,old,calls});
  if(opts.storeThrows)throw new Error('store read failed');return snapshot;
 }};
 const Backend={
  async saveBoard(b){calls.saved.push(b);
   if(opts.saveDeferred)await opts.saveDeferred.promise;
   if(opts.afterSave)opts.afterSave({S,old,calls});
   if(opts.saveThrows)throw new Error('storage unavailable');
   return opts.removed?{removed:true}:undefined;
  }
 };
 const Drive={mode:opts.remote?'rest':null,token:'synthetic-token',tokenOk:()=>true,st:{meta:{working:{fileId:'f1'}}},rest:async()=>({revisions:[{id:'r1',modifiedTime:'2026-11-19T00:00:00Z',size:2048}]})};
 const $=q=>q==='#hlist'?{set innerHTML(v){calls.inputs++}}:null;
 const globals={
  S,LS,Store,Backend,Drive,$,GAPI:'https://example.invalid/',Db:{},Date,Promise,Array,Object,Math,JSON,
  fmtDate:t=>new Date(t).toISOString().slice(0,10),esc:x=>String(x),
  xdlg:()=>{calls.dialogs++;dialog={handler:null,querySelector:()=>({addEventListener:()=>{}}),addEventListener:(type,fn)=>{if(type==='click')dialog.handler=fn}};return dialog},
  canLeaveCurrentBoard:async()=>{calls.guard++;const count=calls.guard;const ans=typeof opts.allow==='function'?opts.allow(count):opts.allow??true;
   if(opts.onGuard)await opts.onGuard({S,old,calls,count});return ans},
  newBoard:name=>({id:'copy-'+(++generated),name,items:[],assets:{}}),
  clone:x=>JSON.parse(JSON.stringify(x)),
  closeXdlg:()=>{calls.close++},
  loadBoard:b=>{assert(b,'cannot load missing board');calls.loaded.push(b);S.board=b},
  fitAll:()=>{},renderDrawer:()=>{},toast:m=>calls.toast.push(String(m)),
  fetch:async()=>{calls.fetch++;if(opts.fetchThrows)throw new Error('network fail');return {ok:!opts.fetchNonOk,json:async()=>(opts.malformedCloud?{error:{message:'missing revision'}}:{board:snapshot})}},
 };
 const context=vm.createContext(globals);vm.runInContext(extract(source),context,{filename:'Test13:openHistory',timeout:3000});
 const ui={click:(idx=0)=>{
   assert(dialog&&dialog.handler,'History UI not opened');const btn={dataset:{h:String(idx)},disabled:false,textContent:'Открыть копию'};
   return {btn,promise:dialog.handler({target:{closest:()=>btn}})};
 }};
 return {S,old,calls,ui,Store,Backend,Drive,open:()=>vm.runInContext('openHistory()',context)};
}
let count=0;async function test(label,fn){await fn();count++;console.log('PASS '+String(count).padStart(2,'0')+' '+label)}
function unchanged(f){assert.strictEqual(f.S.board,f.old);assert.equal(f.calls.loaded.length,0);assert.equal(f.calls.close,0)}
function opened(f){assert.equal(f.calls.loaded.length,1);assert.equal(f.calls.saved.length,1);assert.equal(f.calls.close,1);assert.strictEqual(f.S.board,f.calls.loaded[0]);assert.equal(f.S.board.items[0].text,'old revision');assert.equal(f.S.board.assets.original,'asset');assert.equal(f.S.board.assets.historic,'media')}
(async()=>{
 await test('ORIGINAL negative: denied persistence still replaces working board',async()=>{
  const f=fixture(original,{allow:false});await f.open();await f.ui.click().promise;opened(f);assert.equal(f.calls.guard,0);
 });
 await test('ORIGINAL negative: removed=true still opens uncommitted version',async()=>{
  const f=fixture(original,{removed:true});await f.open();await f.ui.click().promise;opened(f);
 });
 await test('ORIGINAL negative: two in-flight clicks create two copies',async()=>{
  const hold=deferred(),f=fixture(original,{storeDeferred:hold});await f.open();
  const a=f.ui.click(),b=f.ui.click();hold.resolve();await Promise.all([a.promise,b.promise]);
  assert.equal(f.calls.saved.length,2);assert.equal(f.calls.loaded.length,2);
 });
 await test('ORIGINAL negative: switching boards during snapshot read is overwritten',async()=>{
  const f=fixture(original,{afterStoreGet:({S})=>{S.board={id:'another',name:'Another board',items:[]}}});
  await f.open();await f.ui.click().promise;assert.equal(f.calls.loaded.length,1);assert.equal(f.S.board.id,'copy-1');
 });
 await test('Guard denies before creating a copy, retains board',async()=>{
  const f=fixture(patched,{allow:false});await f.open();const a=f.ui.click();await a.promise;unchanged(f);
  assert.equal(f.calls.guard,1);assert.equal(f.calls.saved.length,0);assert.equal(a.btn.disabled,false);assert.equal(a.btn.textContent,'Открыть копию');
 });
 await test('Guard permits normal local history copy',async()=>{
  const f=fixture(patched);await f.open();const a=f.ui.click();await a.promise;opened(f);assert.equal(f.calls.guard,2);assert.equal(a.btn.disabled,false);
 });
 await test('Guard permits normal cloud Drive revision copy',async()=>{
  const f=fixture(patched,{remote:true});await f.open();const a=f.ui.click(1);await a.promise;opened(f);assert.equal(f.calls.fetch,1);
 });
 await test('Rejection of removed=true keeps source board open',async()=>{
  const f=fixture(patched,{removed:true});await f.open();const a=f.ui.click();await a.promise;unchanged(f);
  assert.equal(f.calls.saved.length,1);assert.equal(a.btn.textContent,'Не удалось открыть');assert.equal(a.btn.disabled,false);
 });
 await test('Backend storage exception keeps source board open',async()=>{
  const f=fixture(patched,{saveThrows:true});await f.open();const a=f.ui.click();await a.promise;unchanged(f);
  assert.equal(f.calls.saved.length,1);assert.equal(a.btn.disabled,false);
 });
 await test('Unavailable local revision leaves source board open',async()=>{
  const f=fixture(patched,{emptySnapshot:true});await f.open();const a=f.ui.click();await a.promise;unchanged(f);
  assert.equal(f.calls.saved.length,0);assert.equal(a.btn.disabled,false);
 });
 await test('Storage read exception keeps source board open',async()=>{
  const f=fixture(patched,{storeThrows:true});await f.open();const a=f.ui.click();await a.promise;unchanged(f);
  assert.equal(f.calls.saved.length,0);assert.equal(a.btn.disabled,false);
 });
 await test('Network error on Drive revision keeps source board open',async()=>{
  const f=fixture(patched,{remote:true,fetchThrows:true});await f.open();const a=f.ui.click(1);await a.promise;unchanged(f);
  assert.equal(f.calls.fetch,1);assert.equal(f.calls.saved.length,0);
 });
 await test('Concurrent edits after persistence are denied by second guard',async()=>{
  const f=fixture(patched,{allow:n=>n===1});await f.open();const a=f.ui.click();await a.promise;unchanged(f);
  assert.equal(f.calls.saved.length,1);assert.equal(f.calls.guard,2);assert(f.calls.toast.some(t=>t.includes('сохранена отдельно')));
 });
 await test('Board changed during revision fetch: no copy and no replacement',async()=>{
  const f=fixture(patched,{afterStoreGet:({S})=>{S.board={id:'another',name:'Another board',items:[]}}});await f.open();const a=f.ui.click();await a.promise;
  assert.equal(f.S.board.id,'another');assert.equal(f.calls.loaded.length,0);assert.equal(f.calls.saved.length,0);
  assert.equal(f.calls.guard,0);assert.equal(a.btn.disabled,false);
 });
 await test('Board changed after writing copy: retain new selected board',async()=>{
  const f=fixture(patched,{afterSave:({S})=>{S.board={id:'other',name:'Other board',items:[]}}});await f.open();const a=f.ui.click();await a.promise;
  assert.equal(f.S.board.id,'other');assert.equal(f.calls.loaded.length,0);assert.equal(f.calls.saved.length,1);
  assert(f.calls.toast.some(t=>t.includes('сохранена отдельно')));
 });
 await test('In-flight local click is deduplicated while snapshot is loading',async()=>{
  const hold=deferred(),f=fixture(patched,{storeDeferred:hold});await f.open();const a=f.ui.click(),b=f.ui.click();hold.resolve();await Promise.all([a.promise,b.promise]);opened(f);
  assert.equal(f.calls.storeGet,1);assert.equal(f.calls.guard,2);
 });
 await test('In-flight click is deduplicated while copy is being saved',async()=>{
  const hold=deferred(),f=fixture(patched,{saveDeferred:hold});await f.open();const a=f.ui.click();
  await new Promise(r=>setImmediate(r));const b=f.ui.click();hold.resolve();await Promise.all([a.promise,b.promise]);opened(f);assert.equal(f.calls.saved.length,1);
 });
 await test('Failed attempt unlocks dialog so retry can succeed',async()=>{
  let allow=false;const f=fixture(patched,{allow:()=>allow});await f.open();const a=f.ui.click();await a.promise;unchanged(f);
  allow=true;const b=f.ui.click();await b.promise;opened(f);assert.equal(f.calls.guard,3);
 });
 await test('No bogus row ID results in no backend write',async()=>{
  const f=fixture(patched);await f.open();const a=f.ui.click(33);await a.promise;unchanged(f);assert.equal(f.calls.saved.length,0);
 });
 await test('ORIGINAL negative: cloud error JSON opens empty board as historic copy',async()=>{
  const f=fixture(original,{remote:true,malformedCloud:true});await f.open();const a=f.ui.click(1);await a.promise;
  assert.equal(f.calls.loaded.length,1);assert.equal(f.S.board.items.length,0);
 });
 await test('Cloud revision missing body cannot trigger navigation',async()=>{
  const f=fixture(patched,{remote:true,emptySnapshot:true});await f.open();const a=f.ui.click(1);await a.promise;unchanged(f);assert.equal(f.calls.saved.length,0);
 });
 await test('Cloud error JSON is rejected, never opened as empty copy',async()=>{
  const f=fixture(patched,{remote:true,malformedCloud:true});await f.open();const a=f.ui.click(1);await a.promise;unchanged(f);assert.equal(f.calls.saved.length,0);
 });
 await test('Drive HTTP non-OK body is rejected, even if it looks like a board',async()=>{
  const f=fixture(patched,{remote:true,fetchNonOk:true});await f.open();const a=f.ui.click(1);await a.promise;unchanged(f);assert.equal(f.calls.saved.length,0);
 });
 console.log('TOTAL '+count+'/'+count+' PASS (authentic openHistory() + synthetic DOM/storage/network; NOT browser E2E)');
})().catch(e=>{console.error('FAIL '+(e&&e.stack||e));process.exitCode=1});
