'use strict';
// Executes route handlers extracted from the actual private Test 13 sources.
// Product code remains in local private files; this public harness uses synthetic boards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const [originalPath, patchedPath, integrated18Path] = process.argv.slice(2);
if (!originalPath || !patchedPath || !integrated18Path) throw Error('Pass PRIVATE original Test13, route-patched Test13, and CHAT18-integrated base29.html');
const original = fs.readFileSync(originalPath,'utf8');
const patched = fs.readFileSync(patchedPath,'utf8');
const integrated = fs.readFileSync(integrated18Path,'utf8');
function section(source, start, end) {
  const i=source.indexOf(start), j=source.indexOf(end,i+start.length);
  assert(i>=0 && j>i, 'Test13 anchors changed: '+start);
  return source.slice(i,j);
}
const saveAndGuard = section(integrated,'async function saveNow() {','const saveSettings =');
function make(source, {failure=false,removed=false,waitSave=false,selection=['A','B'],confirm=true}={}) {
  const boardA={id:'A',name:'A synthetic board',items:[{id:'i'}],updatedAt:1};
  const boardB={id:'B',name:'B synthetic board',items:[{id:'j'}],updatedAt:2};
  let finish; const gate = waitSave ? new Promise(resolve=>{finish=resolve;}) : null;
  const stats={deletions:[],forgot:[],statuses:[],messages:[],pop:null,click:null,closeCount:0,guardCalls:0,saveCalls:0};
  const BSEL=new Set(selection);
  const S={board:boardA,index:[{id:'A',name:'A synthetic board',updatedAt:1},{id:'B',name:'B synthetic board',updatedAt:2}],sel:new Set(),hist:[],fut:[]};
  const Backend={
    saveBoard:async()=>{stats.saveCalls++;if(gate)await gate;if(failure)throw Error('synthetic storage refusal');return removed?{removed:true}:{removed:false}},
    setLast:async()=>{},loadBoard:async id=>id==='B'?boardB:id==='A'?boardA:null,
  };
  const Pres={list:new Map([['peer1',{p:{presence:{b:'B',u:'peer1'},guest:false}}]]),follow:null};
  const context=vm.createContext({
    S,Backend,Pres,BSEL,console:{error:()=>{}},setTimeout,clearTimeout,Date,
    setStatus:s=>stats.statuses.push(s),renderDrawer:()=>{},toast:s=>stats.messages.push(s),
    loadBoard:b=>{S.board=b;},byId:()=>null,revealItem:()=>{},render:()=>{},
    bounds:()=>({x:0,y:0,w:1,h:1}),V:()=>({z:1,x:0,y:0}),clamp:(x)=>x,zMin:()=>0.1,applyView:()=>{},els:new Map(),innerWidth:800,innerHeight:600,
    esc:s=>s,presName:()=> 'peer',openPop:(anchor,html,cb)=>{stats.pop=cb},
    xdlg:()=>({addEventListener:(event,cb)=>{if(event==='click')stats.click=cb}}),teamDraw:()=>{},closeXdlg:()=>{stats.closeCount++},
    uiConfirm:async()=>confirm,plural:()=> 'доски',
    deleteBoardWithTrash300:async id=>stats.deletions.push(id),
    Drive:{forget:id=>stats.forgot.push(id)},bsRender:()=>{},bselDraw:()=>{},
    newBoard:()=>({id:'new',name:'New synthetic board',items:[]}),
    finishEdit:()=>{},
  });
  const code=[
    'let saveTimer=0,dirty=false,saving=false,saveAgain=false;',
    saveAndGuard,
    section(source,'async function goToItem(bid, iid) {','function openSearch() {'),
    section(source,'function whoPop(anchor) {','/* ---------- access: roles and per-member sections ---------- */'),
    section(source,'function teamOpen() {','async function teamDraw() {'),
    section(source,'async function bselAct(e) {',"document.addEventListener('click', e => {")
  ].join('\n');
  vm.runInContext(code,context,{filename:'Test13-extracted-routes.js',timeout:3000});
  const cmd=(x)=>vm.runInContext(x,context);
  return {cmd,S,stats,BSEL,boardA,boardB,finish,context,
    search:()=>cmd("goToItem('B','missing')"),
    who:()=>{cmd('whoPop({})');return stats.pop('go:B')},
    team:()=>{cmd('teamOpen()');return stats.click({target:{closest:()=>({dataset:{tm:'open:B'}})}})},
    bulk:()=>cmd("bselAct({target:{closest:()=>({dataset:{bsa:'del'}})},stopPropagation(){}})")
  };
}
let done=0;
async function test(label,fn){await fn();done++;console.log('PASS '+label)}
(async()=>{
 for(const [name,trigger] of [['search','search'],['presence','who'],['team','team']]){
   await test('negative control: original '+name+' loses current board after save rejection',async()=>{
     const m=make(original,{failure:true});m.cmd('dirty=true');await m[trigger]();
     assert.equal(m.S.board.id,'B');assert.equal(m.stats.statuses.includes('error'),true);
   });
   await test('patched '+name+' aborts on failed save',async()=>{
     const m=make(patched,{failure:true});m.cmd('dirty=true');await m[trigger]();
     assert.equal(m.S.board.id,'A');assert.equal(m.cmd('dirty'),true);
   });
   await test('patched '+name+' navigates after confirmed save',async()=>{
     const m=make(patched);m.cmd('dirty=true');await m[trigger]();
     assert.equal(m.S.board.id,'B');assert.equal(m.stats.saveCalls,1);
   });
 }
 await test('negative control: original bulk-delete discards selected dirty active board',async()=>{
   const m=make(original,{failure:true});m.cmd('dirty=true');await m.bulk();
   assert.deepEqual(m.stats.deletions,['A','B']);assert.equal(m.S.board.id,'new');
 });
 await test('patched bulk-delete with dirty active board aborts atomically on save failure',async()=>{
   const m=make(patched,{failure:true});m.cmd('dirty=true');await m.bulk();
   assert.deepEqual(m.stats.deletions,[]);assert.equal(m.S.board.id,'A');assert.deepEqual([...m.BSEL],['A','B']);
 });
 await test('patched bulk-delete includes current board after successful save',async()=>{
   const m=make(patched);m.cmd('dirty=true');await m.bulk();
   assert.deepEqual(m.stats.deletions,['A','B']);assert.equal(m.S.board.id,'new');assert.equal(m.stats.saveCalls,2);
 });
 await test('patched bulk-delete unrelated selected boards does not require current save',async()=>{
   const m=make(patched,{selection:['B']});m.cmd('dirty=true');await m.bulk();
   assert.deepEqual(m.stats.deletions,['B']);assert.equal(m.S.board.id,'A');assert.equal(m.stats.saveCalls,0);
 });
 await test('patched bulk-delete respects cancellation before saving',async()=>{
   const m=make(patched,{confirm:false});m.cmd('dirty=true');await m.bulk();
   assert.deepEqual(m.stats.deletions,[]);assert.equal(m.stats.saveCalls,0);
 });
 await test('patched search blocks remote-deleted board response',async()=>{
   const m=make(patched,{removed:true});m.cmd('dirty=true');await m.search();
   assert.equal(m.S.board.id,'A');assert.equal(m.cmd('dirty'),true);assert.equal(m.stats.statuses.includes('error'),true);
 });
 await test('patched team modal remains open when guard fails',async()=>{
   const m=make(patched,{failure:true});m.cmd('dirty=true');await m.team();
   assert.equal(m.stats.closeCount,0);assert.equal(m.S.board.id,'A');
 });
 await test('patched team modal closes on successful switch',async()=>{
   const m=make(patched);await m.team();
   assert.equal(m.stats.closeCount,1);assert.equal(m.S.board.id,'B');
 });
 await test('patched search waits for in-flight persistence before navigating',async()=>{
   const m=make(patched,{waitSave:true});m.cmd('dirty=true');const write=m.cmd('saveNow()');
   await Promise.resolve();assert.equal(m.cmd('saving'),true);
   const next=m.search();await new Promise(r=>setTimeout(r,15));assert.equal(m.S.board.id,'A');
   m.finish();await write;await next;assert.equal(m.S.board.id,'B');
 });
 console.log('TOTAL '+done+'/'+done+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
