'use strict';
// Runs the true Test13 virtual-board persistence functions. No source is embedded.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const [raw,patched]=process.argv.slice(2);
if(!raw||!patched)throw Error('Provide PRIVATE original and locally patched base29.html');
function extract(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<0)throw Error('source anchor changed: '+a);return s.slice(i,j)}
function harness(path){
 const s=fs.readFileSync(path,'utf8'),data=new Map([['A',{id:'A',items:[{id:'i',type:'sticky',title:'Old'}]}]]);
 const cache=new Map([['A',structuredClone(data.get('A'))]]),bases=new WeakMap(),statuses=[],writes=[];
 bases.set(cache.get('A'),{revision300:'base-A'});
 let failure=false,removed=false;
 const S={board:null,vfCache:cache,index:[{id:'A',updatedAt:0}]};
 const Backend={loadBoard:async id=>{let b=data.get(id);if(!b)return null;b=structuredClone(b);bases.set(b,{revision300:'base-'+id});return b},
  saveBoard:async b=>{writes.push(b.id);if(failure)throw Error('simulated failure');assert(bases.has(b),'missing revision baseline');if(removed)return {removed:true};data.set(b.id,structuredClone(b));return {}},
  setLast:async()=>{}};
 const c=vm.createContext({S,Backend,localBoardBases300:bases,clearTimeout:()=>{},renderDrawer:()=>{},toast:()=>{},
  setStatus:k=>statuses.push(k),console:{error:()=>{}},clone:o=>JSON.parse(JSON.stringify(o)),upsertIndex:()=>{},
  uiConfirm:async()=>true,plural:()=>'',vfList:()=>[],vfBuild:async()=>({id:'next',virtual:true,items:[]}),
  loadBoard:b=>S.board=b,fitAll:()=>{},vfBar:()=>{},bsRender:()=>{}});
 vm.runInContext(['let saveTimer=0,dirty=false,saving=false,saveAgain=false;',
  extract(s,'const VF_SKIP =','async function vfShow('),
  extract(s,'async function vfWriteBack(vb) {','/* =========================================================\n   v2.3: time tracking'),
  extract(s,'async function saveNow() {','const saveSettings ='),
  extract(s,'async function vfShow(f, log)','function vfBar()'),
  extract(s,'async function vfBarClick(e)','function vfMenu(')].join('\n'),c);
 const board={id:'vf',virtual:true,items:[{id:'v',type:'sticky',title:'New'}],vmap:{v:{b:'A',id:'i'}},
  vorig:{v:JSON.stringify({title:'Old',type:'sticky'})},vq:{}};S.board=board;
 vm.runInContext('dirty=true',c);
 const save=async()=>{await vm.runInContext('saveNow()',c);await new Promise(r=>setImmediate(r));};
 return {c,S,data,cache,bases,statuses,writes,board,save,
  fail:b=>{failure=b},removed:b=>{removed=b},read:x=>vm.runInContext(x,c),
  close:()=>vm.runInContext("vfBarClick({target:{closest:()=>({dataset:{vfa:'close'}})}})",c),
  switch:()=>vm.runInContext("vfShow({id:'other',q:{}})",c)};
}
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS '+name)}
(async()=>{
 const old=harness(raw);old.fail(true);await old.save();
 await check('negative: original shows saved although backend failed',()=>{
  assert.equal(old.statuses.at(-1),'saved');assert.equal(old.read('dirty'),false);
 });
 const fixed=harness(patched);fixed.fail(true);await fixed.save();
 await check('failure keeps unsaved state, unchanged cache and retry signature',()=>{
  assert.equal(fixed.statuses.at(-1),'error');assert.equal(fixed.read('dirty'),true);
  assert.equal(fixed.cache.get('A').items[0].title,'Old');
  assert.equal(fixed.board.vorig.v,JSON.stringify({title:'Old',type:'sticky'}));
 });
 await check('failure prevents navigation away from virtual board',async()=>{
  await fixed.close();assert.equal(fixed.S.board,fixed.board);
  await fixed.switch();assert.equal(fixed.S.board,fixed.board);
 });
 fixed.fail(false);await fixed.save();
 await check('retry saves original, caches committed clone, clears dirty',()=>{
  assert.equal(fixed.read('dirty'),false);assert.equal(fixed.data.get('A').items[0].title,'New');
  assert.equal(fixed.cache.get('A').items[0].title,'New');
 });
 const stale=harness(patched);stale.removed(true);await stale.save();
 await check('removed/no-write backend result is not success',()=>{
  assert.equal(stale.read('dirty'),true);assert.equal(stale.data.get('A').items[0].title,'Old');
 });
 const missing=harness(patched);missing.board.vmap.v.b='404';await missing.save();
 await check('missing source board is not silently acknowledged',()=>{
  assert.equal(missing.read('dirty'),true);assert.equal(missing.statuses.at(-1),'error');
 });
 const deletion=harness(patched);deletion.board.items=[];deletion.fail(true);await deletion.save();
 await check('failed deletion keeps retry mapping',()=>{assert(deletion.board.vmap.v);assert.equal(deletion.data.get('A').items.length,1)});
 deletion.fail(false);await deletion.save();
 await check('retried deletion removes only after persistence',()=>{assert.equal(deletion.data.get('A').items.length,0);assert(!deletion.board.vmap.v)});
 console.log('TOTAL '+count+'/'+count+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
