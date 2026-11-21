'use strict';
// Exercises genuine Test13 fsmEnter/fsmBuild/fsmRebuild/fsmExit bodies in Node VM.
// All stores/boards are synthetic; product source is read from private local paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const [originalPath, patchedPath] = process.argv.slice(2);
if (!originalPath || !patchedPath) throw Error('Pass original and patched PRIVATE Test13 v224/base29.html');
function fragment(path) {
  const text=fs.readFileSync(path,'utf8');
  const a=text.indexOf('async function fsmEnter() {');
  const b=text.indexOf('function fsmBar() {',a);
  assert(a>=0 && b>a,'fsm source anchors changed');
  return text.slice(a,b);
}
function create(path,{initial='normal',dirty=false,saving=false,save='ok',missing=false,callback=null,loadFail=false}={}) {
  const events=[];
  const basic={id:'A',items:[{id:'i',type:'text'}],bf:{on:true}};
  const virtual={id:'V',virtual:true,fsm:true,items:[{id:'i',type:'text'}],vcount:1};
  const current=initial==='virtual'?virtual:basic;
  const S={board:current,dim:new Set(),hid:new Set(),fsmFrom:initial==='virtual'?'A':null, fsmQ:{by:'type'},fhl:true};
  let dirtyFlag=dirty,savingFlag=saving,saveCount=0,readCount=0,remainingFailure=save;
  const LS={get:(key)=>key==='fsmq'?{}:key==='bfscope:A'?'':null,set:(k,v)=>events.push('local:'+k)};
  const Backend={loadBoard:async(id)=>{readCount++;events.push('load:'+id);return missing?null:structuredClone(basic);}};
  const c={S,LS,Backend,console,document:{body:{classList:{add:k=>events.push('add:'+k),remove:k=>events.push('remove:'+k)}}},
    items:()=>S.board.items,isHid:()=>false,toast:x=>events.push('toast'),
    vfBuild:async(q)=>{events.push('vfBuild');return structuredClone(virtual)},
    vfBar:()=>{},fsmBar:()=>{},bsRender:()=>{},bfChip:()=>{},fitAll:()=>{},bfApply:()=>{events.push('bfApply'); if(callback==='throw') throw Error('synthetic bfApply failure');},
    loadBoard:b=>{events.push('switched:'+b.id);S.board=b;dirtyFlag=false},
    saveNow:async()=>{saveCount++;events.push('save');await Promise.resolve();if(remainingFailure==='ok'){dirtyFlag=false; savingFlag=false;}else{dirtyFlag=true;events.push('save-failed')}},
    canLeaveCurrentBoard:async()=>{events.push('guard');if(dirtyFlag){if(S.board?.virtual){events.push('guard-virtual-dirty');return false;}await c.saveNow();}
      return !dirtyFlag&&!savingFlag;},
  };
  Object.defineProperties(c,{dirty:{get:()=>dirtyFlag,set:v=>{dirtyFlag=v}},saving:{get:()=>savingFlag,set:v=>{savingFlag=v}}});
  const ctx=vm.createContext(c);vm.runInContext(fragment(path),ctx,{filename:'private-fsm-source.js'});
  return {ctx,S,events,LS,run:(expr)=>vm.runInContext(expr,ctx),setSave:v=>remainingFailure=v,setDirty:v=>dirtyFlag=v,
    state:()=>({dirty:dirtyFlag,saving:savingFlag,saves:saveCount,reads:readCount})};
}
let n=0;async function check(name,fn){await fn();n++;console.log('PASS',name)}
(async()=>{
 await check('original fsmEnter drops normal board on failed write',async()=>{
   const m=create(originalPath,{dirty:true,save:'fail'});await m.run('fsmEnter()');assert.equal(m.S.board.id,'V');assert.equal(m.S.fsmFrom,'A');
 });
 await check('patched fsmEnter blocks failed write without changing mode',async()=>{
   const m=create(patchedPath,{dirty:true,save:'fail'});await m.run('fsmEnter()');assert.equal(m.S.board.id,'A');assert.equal(m.S.fsmFrom,null);assert(m.events.includes('guard'));
 });
 await check('patched fsmEnter succeeds on clean board',async()=>{
   const m=create(patchedPath);assert.equal(await m.run('fsmEnter()'),undefined);assert.equal(m.S.board.id,'V');assert.equal(m.S.fsmFrom,'A');
 });
 await check('original fsmBuild switches despite failed virtual write',async()=>{
   const m=create(originalPath,{initial:'virtual',dirty:true,save:'fail'});await m.run('fsmBuild(["i"])');assert(m.events.includes('switched:V'));
 });
 await check('patched fsmBuild blocks failed virtual write and leaves state',async()=>{
   const m=create(patchedPath,{initial:'virtual',dirty:true,save:'fail'});const x=await m.run('fsmBuild(["i"])');assert.equal(x,false);assert.equal(m.S.board.id,'V');assert.equal(m.state().dirty,true);
 });
 await check('patched fsmBuild uses guard again after asynchronous build',async()=>{
   const m=create(patchedPath);await m.run('fsmBuild(["i"])');assert.equal(m.events.filter(e=>e==='guard').length,2);
 });
 await check('original fsmExit drops dirty virtual board on save failure',async()=>{
   const m=create(originalPath,{initial:'virtual',dirty:true,save:'fail'});await m.run('fsmExit(false)');assert.equal(m.S.board.id,'A');assert.equal(m.S.fsmFrom,null);
 });
 await check('patched fsmExit preserves virtual board and filter on failure',async()=>{
   const m=create(patchedPath,{initial:'virtual',dirty:true,save:'fail'});assert.equal(await m.run('fsmExit(false)'),false);assert.equal(m.S.board.id,'V');assert.equal(m.S.fsmFrom,'A');
   assert(!m.events.includes('remove:fsm'));
 });
 await check('patched fsmExit preserves view when source board is missing',async()=>{
   const m=create(patchedPath,{initial:'virtual',missing:true});assert.equal(await m.run('fsmExit(true)'),false);assert.equal(m.S.board.id,'V');assert.equal(m.S.fsmFrom,'A');
 });
 await check('original fsmExit strands user when source is missing',async()=>{
   const m=create(originalPath,{initial:'virtual',missing:true});await m.run('fsmExit(true)');assert.equal(m.S.board,null);assert.equal(m.S.fsmFrom,null);
 });
 await check('patched fsmExit successfully returns without clearing filters',async()=>{
   const m=create(patchedPath,{initial:'virtual'});assert.equal(await m.run('fsmExit(false)'),true);assert.equal(m.S.board.id,'A');assert.equal(m.S.fsmFrom,null);assert(m.events.includes('remove:fsm'));
 });
 await check('patched fsmExit clears filter and awaits save',async()=>{
   const m=create(patchedPath,{initial:'virtual'});assert.equal(await m.run('fsmExit(true)'),true);assert.equal(m.S.board.id,'A');assert.equal(m.state().saves,1);assert.equal(m.state().dirty,false);assert.equal(m.S.board.bf.on,true);
 });
 await check('patched fsmRebuild flushes edits before reloading source',async()=>{
   const m=create(patchedPath,{initial:'virtual',dirty:true});assert.equal(await m.run('fsmRebuild()'),true);assert(m.events.indexOf('save')<m.events.indexOf('load:A'));assert.equal(m.S.board.id,'V');
 });
 await check('original fsmRebuild reads source before writing edits',async()=>{
   const m=create(originalPath,{initial:'virtual',dirty:true});await m.run('fsmRebuild()');assert(m.events.indexOf('load:A')<m.events.indexOf('save'));
 });
 await check('patched fsmRebuild aborts after failed save and does not load',async()=>{
   const m=create(patchedPath,{initial:'virtual',dirty:true,save:'fail'});assert.equal(await m.run('fsmRebuild()'),false);assert.equal(m.state().reads,0);assert.equal(m.S.board.id,'V');
 });
 await check('patched fsmRebuild restores S.board even if filter fails',async()=>{
   const m=create(patchedPath,{initial:'virtual',callback:'throw'});await assert.rejects(m.run('fsmRebuild()'),/synthetic bfApply failure/);assert.equal(m.S.board.id,'V');
 });
 await check('original fsmRebuild retains source S.board after filter exception',async()=>{
   const m=create(originalPath,{initial:'virtual',callback:'throw'});await assert.rejects(m.run('fsmRebuild()'),/synthetic bfApply failure/);assert.equal(m.S.board.id,'A');
 });
 await check('patched fsmExit blocks during in-flight save',async()=>{
   const m=create(patchedPath,{initial:'virtual',saving:true});assert.equal(await m.run('fsmExit(false)'),false);assert.equal(m.S.board.id,'V');
 });
 console.log('TOTAL '+n+'/'+n+' PASS');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
