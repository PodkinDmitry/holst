#!/usr/bin/env node
'use strict';
/* CHAT26: execute the real demoBoard() bodies extracted from private Test13 sources.
 * The source is a local CLI argument, NOT bundled into this public harness.
 * Storage/DOM/async effects are synthetic; NOT an integrated/browser E2E test. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert').strict;
const [originalPath, patchedPath] = process.argv.slice(2);
if (!originalPath || !patchedPath) throw new Error('Usage: node demo_board_source_gate.js <private-original-base29> <private-patched-base29>');
function actualFunction(file) {
  const src = fs.readFileSync(file, 'utf8');
  const begin = src.indexOf('async function demoBoard() {');
  const end = src.indexOf('\n/* =========================================================', begin);
  assert(begin >= 0 && end > begin, 'exact original demoBoard() function boundaries');
  const code = src.slice(begin, end);
  assert(code.includes("frame('Объекты'") && code.includes("frame('Life OS") && code.includes('Backend.saveBoard(b)'), 'actual complete demoBoard function body');
  return code;
}
const original = actualFunction(originalPath), patched = actualFunction(patchedPath);
assert(original.includes("const id = 'demo24'"), 'expected original Test13 baseline');
assert(patched.includes('const preferredId') && patched.includes('canLeaveCurrentBoard()'), 'expected patched Test13 body');
let count = 0;
async function test(name, f) { try { await f(); count++; console.log('PASS', count, name); } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } }
function deferred() { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return {promise, resolve, reject}; }
const clone = x => JSON.parse(JSON.stringify(x));
function fixture(code, opt={}) {
  let idx=0, dirty=!!opt.dirty, saving=!!opt.saving, saveAgain=!!opt.saveAgain;
  const current = opt.current===null ? null : (opt.current || {id:'work',name:'Work',items:[{id:'custom',text:'UNSAVED'}],updatedAt:100});
  const stored = new Map((opt.stored || []).map(b=>[b.id,clone(b)]));
  const settings = new Map(Object.entries(opt.settings || {}));
  const S={board:current,index:(opt.index || [...stored.values()].map(b=>({id:b.id,name:b.name,updatedAt:b.updatedAt}))).map(clone),demoMx:null};
  const events=[],calls={saves:[],loads:[],switches:0,canLeave:0,finishEdit:0};
  const c={S, APP_VERSION: opt.version || '2.25', INK:'#000', METRONOME_HTML:'SAFE METRONOME STUB', console:{error:e=>events.push(['error',String(e)])}, Date,
    LS:{get:k=>settings.get(k),set:(k,v)=>settings.set(k,v)},
    uid:()=> 'u'+(++idx),
    newBoard:name=>({id:'generated-'+(++idx),name,items:[],assets:{},updatedAt:1}),
    mkTool:()=>({id:'tool',rows:[]}),rowId:()=> 'row'+(++idx),mkDoc:()=>({id:'doc'}),
    sanitizeHTML:x=>x,mdToHtml:x=>x,mdToDoc:x=>x,docClean:x=>x,htmlToText:x=>x,
    Backend:{
      loadBoard:async id=>{calls.loads.push(id); if(opt.loadGate)await opt.loadGate.promise; if(opt.loadError)throw Error('load failed'); return clone(stored.get(id)||null);},
      saveBoard:async b=>{calls.saves.push(b.id); if(opt.saveGate)await opt.saveGate.promise; if(opt.saveError)throw Error('storage refused'); if(opt.removed)return {removed:true}; stored.set(b.id,clone(b));if(!S.index.find(x=>x.id===b.id))S.index.push({id:b.id,name:b.name,updatedAt:b.updatedAt});return {};}
    },
    saveNow:async()=>{events.push(['saveNow']);if(!opt.saveFail)dirty=false;},
    canLeaveCurrentBoard:async()=>{calls.canLeave++; if(opt.refuse) return false; if(S.board && dirty)await c.saveNow();return !dirty&&!saving&&!saveAgain;},
    finishEdit:()=>calls.finishEdit++,
    loadBoard:b=>{calls.switches++; S.board=b;dirty=false;events.push(['loadBoard',b.id]);},
    mxCreate:()=>{},mxCells:()=>[],changed:()=>{dirty=true;events.push(['changed']);},
    fitAll:()=>{},renderDrawer:()=>{},toast:x=>events.push(['toast',x]),
  };
  Object.defineProperties(c, {dirty:{get:()=>dirty,set:v=>{dirty=v},configurable:true},saving:{get:()=>saving,set:v=>{saving=v},configurable:true},saveAgain:{get:()=>saveAgain,set:v=>{saveAgain=v},configurable:true}});
  const context = vm.createContext(c);
  vm.runInContext('let demoBoardBusy = false;\n'+code+'\nthis.__launch = demoBoard;',context,{timeout:1500});
  return {S,stored,settings,events,calls,run:()=>context.__launch(),markDirty:()=>{dirty=true;},clearDirty:()=>{dirty=false;},setSaving:x=>{saving=x;},setSaveAgain:x=>{saveAgain=x;},dirty:()=>dirty};
}
function demo(id='demo24') {return {id,name:'DEMO CUSTOM',items:[{id:'user-note',text:'DO NOT OVERWRITE'}],assets:{},updatedAt:1};}
async function main() {
  await test('ORIGINAL NEGATIVE: version refresh replaces user-edited demo24 board in storage', async()=>{
    const f=fixture(original,{stored:[demo()],settings:{demov:'2.24'}});await f.run();assert(!f.stored.get('demo24').items.some(x=>x.id==='user-note'));});
  await test('ORIGINAL NEGATIVE: failed saveNow still switches away from dirty current board',async()=>{
    const f=fixture(original,{dirty:true,saveFail:true});await f.run();assert.equal(f.S.board.id,'demo24');});
  await test('ORIGINAL NEGATIVE: backend removed=true still switches to unpersisted demo',async()=>{
    const f=fixture(original,{removed:true});await f.run();assert.equal(f.S.board.id,'demo24');assert.equal(f.stored.size,0);});
  await test('ORIGINAL NEGATIVE: deferred demo load can overwrite concurrent user navigation',async()=>{
    const gate=deferred(),f=fixture(original,{stored:[demo()],settings:{demov:'2.25'},loadGate:gate});const p=f.run();await Promise.resolve();f.S.board={id:'other',updatedAt:23};gate.resolve();await p;assert.equal(f.S.board.id,'demo24');});
  await test('ORIGINAL NEGATIVE: concurrent clicks perform duplicate demo writes',async()=>{
    const gate=deferred(),f=fixture(original,{saveGate:gate});const a=f.run(),b=f.run();await Promise.resolve();gate.resolve();await Promise.all([a,b]);assert.equal(f.calls.saves.length,2);});
  await test('ORIGINAL NEGATIVE: edits during pending save lost by subsequent board swap',async()=>{
    const gate=deferred(),f=fixture(original,{saveGate:gate});const p=f.run();await Promise.resolve();f.markDirty();gate.resolve();await p;assert.equal(f.S.board.id,'demo24');});
  await test('PATCH: refused guard keeps dirty active board and does not create demo',async()=>{
    const f=fixture(patched,{dirty:true,saveFail:true});await f.run();assert.equal(f.S.board.id,'work');assert.equal(f.calls.saves.length,0);assert.equal(f.dirty(),true);});
  await test('PATCH: explicit guard refusal prevents new save',async()=>{
    const f=fixture(patched,{refuse:true});await f.run();assert.equal(f.S.board.id,'work');assert.equal(f.calls.saves.length,0);});
  await test('PATCH: regenerating version creates separate board and preserves user demo',async()=>{
    const f=fixture(patched,{stored:[demo()],settings:{demov:'2.24'}});await f.run();assert.equal(f.stored.get('demo24').items[0].text,'DO NOT OVERWRITE');assert.notEqual(f.S.board.id,'demo24');assert.equal(f.settings.get('demobid'),f.S.board.id);});
  await test('PATCH: new version pointer reopens newly-generated demo on subsequent invocation',async()=>{
    const f=fixture(patched,{stored:[demo()],settings:{demov:'2.24'}});await f.run();const newId=f.S.board.id;const before=f.calls.saves.length;await f.run();assert.equal(f.S.board.id,newId);assert.equal(f.calls.saves.length,before);});
  await test('PATCH: legacy same-version demo is reused, not rewritten',async()=>{
    const f=fixture(patched,{stored:[demo()],settings:{demov:'2.25'}});await f.run();assert.equal(f.S.board.id,'demo24');assert.equal(f.calls.saves.length,0);});
  await test('PATCH: empty index starts with stable legacy demo id',async()=>{
    const f=fixture(patched);await f.run();assert.notEqual(f.S.board.id,'demo24');assert.equal(f.settings.get('demobid'),f.S.board.id);assert.equal(f.settings.get('demov'),'2.25');});
  await test('PATCH: backend failure leaves prior board and metadata unchanged',async()=>{
    const f=fixture(patched,{saveError:true});await f.run();assert.equal(f.S.board.id,'work');assert.equal(f.settings.has('demobid'),false);});
  await test('PATCH: removed:true save result prevents transition and marker advance',async()=>{
    const f=fixture(patched,{removed:true});await f.run();assert.equal(f.S.board.id,'work');assert.equal(f.settings.has('demov'),false);});
  await test('PATCH: load failure makes a separate demo and leaves old unchanged',async()=>{
    const f=fixture(patched,{stored:[demo()],settings:{demov:'2.25'},loadError:true});await f.run();assert.notEqual(f.S.board.id,'demo24');assert.equal(f.stored.get('demo24').items[0].text,'DO NOT OVERWRITE');});
  await test('PATCH: altered active board during asynchronous load is retained',async()=>{
    const gate=deferred(),f=fixture(patched,{stored:[demo()],settings:{demov:'2.25'},loadGate:gate});const p=f.run();await Promise.resolve();f.S.board={id:'other',updatedAt:99};gate.resolve();await p;assert.equal(f.S.board.id,'other');});
  await test('PATCH: dirty edits during demo save keep original visible',async()=>{
    const gate=deferred(),f=fixture(patched,{saveGate:gate});const p=f.run();for(let t=0;t<10&&!f.calls.saves.length;t++)await Promise.resolve();assert.equal(f.calls.saves.length,1);f.markDirty();gate.resolve();await p;assert.equal(f.S.board.id,'work');assert.equal(f.dirty(),true);});
  await test('PATCH: version stamp change during save keeps current board visible',async()=>{
    const gate=deferred(),f=fixture(patched,{saveGate:gate});const p=f.run();for(let t=0;t<10&&!f.calls.saves.length;t++)await Promise.resolve();assert.equal(f.calls.saves.length,1);f.S.board.updatedAt++;gate.resolve();await p;assert.equal(f.S.board.id,'work');});
  await test('PATCH: concurrent clicks have one writer and switch',async()=>{
    const gate=deferred(),f=fixture(patched,{saveGate:gate});const a=f.run(),b=f.run();await Promise.resolve();gate.resolve();await Promise.all([a,b]);assert.equal(f.calls.saves.length,1);assert.equal(f.calls.switches,1);});
  await test('PATCH: busy flag resets after rejection and retry succeeds',async()=>{
    const f=fixture(patched,{refuse:true});await f.run();assert.equal(f.calls.canLeave,1);await f.run();assert.equal(f.calls.canLeave,2);});
  await test('PATCH: if no current board, safe creation still works',async()=>{
    const f=fixture(patched,{current:null});await f.run();assert.ok(f.S.board.id.startsWith('generated-'));});
  await test('PATCH: existing custom demo24 preserved when pointer references stale id',async()=>{
    const f=fixture(patched,{stored:[demo()],settings:{demobid:'deleted-old-demo',demov:'2.24'}});await f.run();assert.equal(f.stored.get('demo24').items[0].text,'DO NOT OVERWRITE');assert.notEqual(f.S.board.id,'demo24');});
  await test('PATCH: editing-saved after loading legacy board occurs only on success',async()=>{
    const f=fixture(patched,{stored:[demo()],settings:{demov:'2.25'},dirty:true,saveFail:true});await f.run();assert.equal(f.S.board.id,'work');assert.equal(f.calls.loads.length,0);});
  await test('PATCH: save again pending blocks transition',async()=>{
    const f=fixture(patched,{saveAgain:true});await f.run();assert.equal(f.S.board.id,'work');assert.equal(f.calls.saves.length,0);});
  await test('PATCH: nonempty old demo with latest pointer remains intact across upgrade twice',async()=>{
    const f=fixture(patched,{stored:[demo('demo24'),demo('demo24-u888')],settings:{demobid:'demo24-u888',demov:'2.24'},version:'2.26'});await f.run();const a=f.S.board.id;assert.notEqual(a,'demo24-u888');assert.equal(f.stored.get('demo24').items[0].text,'DO NOT OVERWRITE');assert.equal(f.stored.get('demo24-u888').items[0].text,'DO NOT OVERWRITE');await f.run();assert.equal(f.S.board.id,a);});
  if(process.exitCode) throw Error('at least one source gate failed');
  console.log(`SUMMARY ${count}/${count} source-backed Node VM PASS (includes six deliberately unsafe original controls; synthetic dependencies, NOT E2E)`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
