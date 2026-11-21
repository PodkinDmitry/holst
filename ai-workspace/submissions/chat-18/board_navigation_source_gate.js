'use strict';
// Uses functions extracted from the actual private Test 13 source, not copied into this public harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const [originalPath, patchedPath] = process.argv.slice(2);
if (!originalPath || !patchedPath) throw Error('Expected PRIVATE Test13 original and patched v224/base29.html paths');
function extract(html, begin, end) {
 const i=html.indexOf(begin), j=html.indexOf(end,i+begin.length);
 assert(i>=0 && j>i,'Test13 source anchors changed: '+begin);
 return html.slice(i,j);
}
function make(source, opts={}) {
 const html=fs.readFileSync(source,'utf8');
 const code=`let saveTimer=0,dirty=false,saving=false,saveAgain=false;\n`+
   extract(html,'async function saveNow() {','const saveSettings =')+'\n'+
   extract(html,'async function openBoard(id) {','function renderDrawer() {');
 const events=[],old={id:'A',name:'Original',items:[{id:'obj'}],updatedAt:1}, other={id:'B',name:'Other',items:[],updatedAt:2};
 const data={saved:0,deleted:0,copies:0,toast:[],status:[],selected:old};
 let saveBehavior=opts.save||(()=>Promise.resolve({removed:false}));
 const backend={
  saveBoard:async (b)=>{data.saved++;return saveBehavior(b)},
  setLast:async ()=>{},
  loadBoard:async (id)=>id==='B'?other:old,
  subscribe:()=>{},
 };
 const context=vm.createContext({
  S:{board:old,index:[{id:'A',name:'Original',updatedAt:1}],fut:[],hist:[]}, Backend:backend,
  console:{error:e=>events.push('caught-error')},Date:opts.Date||Date,setTimeout,clearTimeout,
  drawer:{hidden:false},
  finishEdit:()=>{},setStatus:k=>data.status.push(k),renderDrawer:()=>{},
  toast:s=>data.toast.push(s),
  loadBoard:b=>{data.selected=b;context.S.board=b;},
  newBoard:name=>({id:'new',name,items:[]}),
  $:()=>({focus:()=>{},select:()=>{}}),clone:b=>structuredClone(b),uid:()=>String(Math.random()),
  deleteBoardWithTrash300:async()=>{data.deleted++;},
  storeCfg:()=>({trash:{days:30}}), uiConfirm:async()=>true,
  Drive:{forget:()=>{}}, plural:()=>'',
 });
 vm.runInContext(code,context,{filename:'Test13 navigation functions',timeout:2000});
 return {context,data,old,other,backend,events,setSave:fn=>{saveBehavior=fn},
   cmd:js=>vm.runInContext(js,context)};
}
let count=0;
async function test(label,fn){await fn();count++;console.log('PASS',label)}
(async()=>{
 await test('negative: original opens another board despite rejected save',async()=>{
  const m=make(originalPath,{save:()=>Promise.reject(Error('quota'))});m.cmd('dirty=true');await m.cmd("openBoard('B')");
  assert.equal(m.context.S.board.id,'B');assert.equal(m.data.status.includes('error'),true);
 });
 await test('patched: rejected save keeps current board and dirty flag',async()=>{
  const m=make(patchedPath,{save:()=>Promise.reject(Error('quota'))});m.cmd('dirty=true');await m.cmd("openBoard('B')");
  assert.equal(m.context.S.board.id,'A');assert.equal(m.cmd('dirty'),true);assert.equal(m.data.toast.length,1);
 });
 await test('negative: original silently treats removed save as success',async()=>{
  const m=make(originalPath,{save:()=>Promise.resolve({removed:true})});m.cmd('dirty=true');await m.cmd("openBoard('B')");
  assert.equal(m.context.S.board.id,'B');assert.equal(m.data.status.slice(-1)[0],'saved');
 });
 await test('patched: removed save prevents navigation and reports error',async()=>{
  const m=make(patchedPath,{save:()=>Promise.resolve({removed:true})});m.cmd('dirty=true');await m.cmd("openBoard('B')");
  assert.equal(m.context.S.board.id,'A');assert.equal(m.cmd('dirty'),true);assert.equal(m.data.status.includes('error'),true);
 });
 await test('patched: rejected save prevents creation and preserves source',async()=>{
  const m=make(patchedPath,{save:()=>Promise.reject(Error('unavailable'))});m.cmd('dirty=true');await m.cmd('createBoard()');
  assert.equal(m.context.S.board.id,'A');assert.equal(m.data.saved,1);
 });
 await test('negative: original creates new board after save failure',async()=>{
  const m=make(originalPath,{save:()=>Promise.reject(Error('unavailable'))});m.cmd('dirty=true');await m.cmd('createBoard()');
  assert.equal(m.context.S.board.id,'new');
 });
 await test('patched: duplicate current board aborts if current save failed',async()=>{
  const m=make(patchedPath,{save:()=>Promise.reject(Error('unavailable'))});m.cmd('dirty=true');await m.cmd("duplicateBoard('A')");
  assert.equal(m.data.saved,1);assert.equal(m.context.S.board.id,'A');
 });
 await test('patched: delete current board aborts if pending changes cannot save',async()=>{
  const m=make(patchedPath,{save:()=>Promise.reject(Error('unavailable'))});m.cmd('dirty=true');await m.cmd("deleteBoard('A')");
  assert.equal(m.data.deleted,0);assert.equal(m.context.S.board.id,'A');
 });
 await test('patched: clean successful navigation still works',async()=>{
  const m=make(patchedPath);await m.cmd("openBoard('B')");assert.equal(m.context.S.board.id,'B');
  assert.equal(m.data.saved,0);
 });
 await test('patched: dirty successfully saved board can be switched',async()=>{
  const m=make(patchedPath);m.cmd('dirty=true');await m.cmd("openBoard('B')");assert.equal(m.context.S.board.id,'B');assert.equal(m.data.saved,1);
 });
 await test('patched: in-flight save prevents navigation until completion',async()=>{
  const m=make(patchedPath);m.cmd('saving=true');let settled=false;
  const task=m.cmd("openBoard('B')").then(()=>settled=true);
  await new Promise(r=>setTimeout(r,10));assert.equal(m.context.S.board.id,'A');assert.equal(settled,false);
  m.cmd('saving=false');await task;assert.equal(m.context.S.board.id,'B');
 });
 await test('negative: original opens another board while a save is in-flight',async()=>{
  const m=make(originalPath);m.cmd('saving=true');await m.cmd("openBoard('B')");assert.equal(m.context.S.board.id,'B');
 });
 await test('patched: virtual board with dirty changes cannot navigate silently',async()=>{
  const m=make(patchedPath);m.cmd('S.board.virtual=true;dirty=true');await m.cmd("openBoard('B')");
  assert.equal(m.context.S.board.id,'A');assert.equal(m.data.saved,0);
 });
 await test('patched: indefinite saving times out closed',async()=>{
  let now=0;const FastDate={now:()=>{now+=1200;return now}};
  const m=make(patchedPath,{Date:FastDate});m.cmd('saving=true');await m.cmd("openBoard('B')");
  assert.equal(m.context.S.board.id,'A');assert.equal(m.data.toast.length,1);
 });
 await test('patched: duplicate clean board still persists a clone',async()=>{
  const m=make(patchedPath);await m.cmd("duplicateBoard('A')");assert.equal(m.data.saved,1);assert.equal(m.context.S.board.id,'A');
 });
 console.log('TOTAL '+count+'/'+count+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
