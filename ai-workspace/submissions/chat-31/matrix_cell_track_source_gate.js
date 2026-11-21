#!/usr/bin/env node
'use strict';
// Source-backed Node VM checks; storage, browser/UI, drag state and Drive are synthetic.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [originalPath,patchedPath]=process.argv.slice(2);
if(!originalPath||!patchedPath)throw Error('usage: node matrix_cell_track_source_gate.js ORIGINAL/v224/base29.html PATCHED/v224/base29.html');
const original=fs.readFileSync(originalPath,'utf8'),patched=fs.readFileSync(patchedPath,'utf8');
assert.equal(crypto.createHash('sha256').update(original).digest('hex'),'3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c','must use exact private Test13 source');
function section(src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a);if(a<0||b<0||b<=a)throw Error('missing source markers '+start+' / '+end);return src.slice(a,b);}
function body(src){const detach=src.includes('let mxDetachTrackBusy = false;')?'let mxDetachTrackBusy = false;':'function mxDetachTrack(F, kind, id, w) {';
return section(src,'function mxTrackCells(F, kind, id) {',src.includes('let mxRemoveTrackBusy = false;')?'let mxRemoveTrackBusy = false;':'async function mxRemoveTrack(F, kind, id) {').split('\n')[0]+'\n'+
section(src,detach,'function mxRemove(F) {')+'\n'+
section(src,'function mxSlotAt(G, w) {','/* a cell dropped after dragging by its grip:')+'\n'+
section(src,'function mxDropCell(cell, d, w) {','/* any frame dropped onto an empty slot of a matrix becomes its cell */')+'\n'+
section(src,'function mxShift(list, dx, dy) {','function layoutMatrices() {')+'\n'+
section(src,'async function trashPut(e, data) {',src.includes('async function trashItems(list, board = S.board) {')?'async function trashItems(list, board = S.board) {':'function trashItems(list) {');}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(src,opt={}){
 const F={id:'matrix',type:'frame',x:0,y:0,w:320,h:250,title:'Matrix',mx:{cols:[{id:'c1',name:'A',w:90},{id:'c2',name:'B',w:90}],rows:[{id:'r1',name:'First',h:90},{id:'r2',name:'Second',h:90}],gap:12}};
 const cell=(c,r)=>({id:`cell-${c}-${r}`,type:'frame',x:c==='c1'?10:122,y:r==='r1'?10:122,w:90,h:90,title:'',fill:'#ffffff',cell:{m:F.id,c,r}});
 const c11=cell('c1','r1'),c12=cell('c1','r2'),c21=cell('c2','r1'),c22=cell('c2','r2');
 const child={id:'child',type:'text',x:20,y:20,w:20,h:20,text:'Keep user content',parent:c11.id};
 const outside={id:'outside',type:'text',x:370,y:370,w:20,h:20,text:'Other user content'};
 const board={id:'b1',name:'Synthetic board',items:[F,c11,c12,c21,c22,child,outside],assets:{logo:'synthetic bytes'},updatedAt:12};
 const S={board,sel:new Set(['matrix']),mxSel:{fid:F.id,kind:'col',id:'c1'}};
 let hist=0,changes=0,uidCounter=0,writeCount=0,reads=0,idx=[],release=null,logs=[],errorLog=[];
 const data=new Map();
 const Store={mode:opt.mem?'mem':'idb',async set(k,v){writeCount++;if(opt.failWrite)throw Error('synthetic quota error');if(opt.deferWrite)await new Promise(r=>release=r);data.set(k,structuredClone(v));},async get(k){reads++;if(opt.failRead)throw Error('synthetic read error');return opt.missingRead?null:data.get(k);}};
 const LS={get(k){return k==='trashidx'?structuredClone(idx):null;},set(k,x){if(k==='trashidx'&&!opt.dropIndex)idx=structuredClone(x);}};
 const items=()=>S.board?.items||[],bounds=i=>({x:i.x||0,y:i.y||0,w:i.w||0,h:i.h||0}),inside=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.w<=b.x+b.w&&a.y+a.h<=b.y+b.h;
 const withFrameContents=list=>{const ids=new Set(list.map(i=>i.id)),out=[...list];for(const f of list)if(f.type==='frame')for(const it of items())if(!ids.has(it.id)&&inside(bounds(it),bounds(f))){ids.add(it.id);out.push(it);}return out;};
 const mxCells=f=>items().filter(x=>x.cell?.m===f.id);
 const mxGeom=f=>{const cols=f.mx.cols,rows=f.mx.rows,cx={},ry={};let x=10,y=10;for(const c of cols){cx[c.id]=x;x+=c.w+12;}for(const r of rows){ry[r.id]=y;y+=r.h+12;}
 const ci=new Map(cols.map((t,i)=>[t.id,i])),ri=new Map(rows.map((t,i)=>[t.id,i]));const rect=i=>{const a=ci.get(i.cell.c),b=ri.get(i.cell.r);if(a==null||b==null)return null;return {x:cx[cols[a].id],y:ry[rows[b].id],w:cols[a].w,h:rows[b].h};};return {cols,rows,cx,ry,ci,ri,x0:10,y0:10,gap:12,rect};};
 const env={S,Store,LS,console:{error:e=>errorLog.push(String(e))},Date,Map,Set,JSON,Object,Number,
 uid:()=>`synthetic-${++uidCounter}`,toast:x=>logs.push(String(x)),changed:()=>{changes++;if(opt.failChanged)throw Error('synthetic render fail')},pushHist:()=>hist++,items,byId:id=>items().find(x=>x.id===id),mxCells,mxOf:it=>it?.cell?items().find(x=>x.id===it.cell.m):null,mxGeom,
 bounds,inside,withFrameContents,r1:x=>Math.round(x*10)/10,clone:x=>structuredClone(x),bmOf:()=>[{kind:'sample',name:'Synthetic'}],assetSize:x=>String(x).length,assetKind:()=> 'synthetic',
 trashIdx:()=>LS.get('trashidx')||[],trashSaveIdx:x=>LS.set('trashidx',x)};
 const ctx=vm.createContext(env);vm.runInContext(body(src),ctx,{timeout:5000});
 const detach=(kind='c',id=kind==='c'?'c1':'r1',world={x:400,y:400})=>{ctx._f=F;ctx._k=kind;ctx._id=id;ctx._w=world;return vm.runInContext('mxDetachTrack(_f,_k,_id,_w)',ctx,{timeout:5000})};
 const drag=(which=c11,world={x:155,y:45},list=[{it:which}])=>{ctx._cell=which;ctx._world=world;ctx._drag={list};return vm.runInContext('mxDropCell(_cell,_drag,_world)',ctx,{timeout:5000})};
 return {ctx,env,F,S,board,c11,c12,c21,c22,child,outside,Store,LS,data,detach,drag,tick,
 getIdx:()=>idx,getWrites:()=>writeCount,getReads:()=>reads,hist:()=>hist,changes:()=>changes,toasts:()=>logs,errors:()=>errorLog,
 release:()=>{if(!release)throw Error('no pending Store write');const f=release;release=null;f()}};
}
let total=0,failed=0;async function test(name,fn){total++;try{await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+(e.stack||e));}}
const O=(opts)=>setup(original,opts),P=(opts)=>setup(patched,opts);
(async()=>{
 // Original controls intentionally describe unsafe outcomes, not expected product behavior.
 await test('ORIGINAL: detaching column removes matrix metadata without Trash copy',async()=>{const x=O();await x.detach();assert.equal(x.F.mx.cols.length,1);assert.equal(x.getWrites(),0)});
 await test('ORIGINAL: detaching final column deletes matrix definition without backup',async()=>{const x=O();x.F.mx.cols.splice(1);x.board.items=x.board.items.filter(i=>i!==x.c21&&i!==x.c22);await x.detach();assert.equal(x.F.mx,undefined);assert.equal(x.getWrites(),0)});
 await test('ORIGINAL: stale source frame moves objects from another active board',async()=>{const x=O();const other={id:'b2',items:[{id:'other',type:'text',text:'survive'}]};x.S.board=other;await x.detach();assert.equal(x.F.mx.cols.length,1);assert.equal(x.getWrites(),0)});
 await test('ORIGINAL: Store write failure does not prevent detachment',async()=>{const x=O({failWrite:true});await x.detach();assert.equal(x.F.mx.cols.length,1);assert.equal(x.getWrites(),0)});
 await test('ORIGINAL: dragging merged cell outside destroys cs/rs',()=>{const x=O();x.c11.cell.cs=2;assert.equal(x.drag(x.c11,{x:500,y:500}),true);assert.equal(x.c11.cell,undefined)});
 await test('ORIGINAL: swapping merged source loses span metadata',()=>{const x=O();x.c11.cell.rs=2;assert.equal(x.drag(),true);assert.equal(x.c11.cell.rs,undefined)});
 await test('ORIGINAL: swapping merged target loses span metadata',()=>{const x=O();x.c21.cell.cs=2;assert.equal(x.drag(),true);assert.equal(x.c21.cell.cs,undefined)});
 await test('ORIGINAL: stale dragged frame is moved despite not being on active board',()=>{const x=O();x.board.items=x.board.items.filter(i=>i!==x.c11);assert.equal(x.drag(),true);assert.equal(x.c11.cell.c,'c2')});
 // Patched detachment: persist full board before metadata mutations.
 await test('PATCH: detach column persists whole board before changing cells',async()=>{const x=P();assert.equal(await x.detach(),true);assert.equal(x.F.mx.cols.length,1);assert.equal(x.c11.cell,undefined);assert.equal(x.c12.cell,undefined);assert.equal(x.getIdx().length,1);assert.equal(x.hist(),1);assert.equal(x.changes(),1)});
 await test('PATCH: snapshot retains matrix metadata, objects, names and assets',async()=>{const x=P();await x.detach();const item=x.data.get('trash:'+x.getIdx()[0].id);assert.equal(item.board.items.find(it=>it.id==='matrix').mx.cols.length,2);assert.equal(item.board.items.find(it=>it.id==='child').text,'Keep user content');assert.equal(item.board.assets.logo,'synthetic bytes');assert.equal(item.bm[0].kind,'sample')});
 await test('PATCH: detach row persists before shifting row cells',async()=>{const x=P();assert.equal(await x.detach('r','r1'),true);assert.equal(x.F.mx.rows.length,1);assert.equal(x.c11.cell,undefined);assert.equal(x.c21.cell,undefined);assert.equal(x.getIdx().length,1)});
 await test('PATCH: final column detach retains full snapshot to recover matrix definition',async()=>{const x=P();x.F.mx.cols.splice(1);x.board.items=x.board.items.filter(i=>i!==x.c21&&i!==x.c22);assert.equal(await x.detach(),true);assert.equal(x.F.mx,undefined);assert.equal(x.getIdx().length,1)});
 await test('PATCH: backup remains unchanged after live track detached',async()=>{const x=P();await x.detach();const item=x.data.get('trash:'+x.getIdx()[0].id);assert(item.board.items.find(i=>i.id==='cell-c1-r1').cell);});
 await test('PATCH: Store.set failure preserves matrix and Undo',async()=>{const x=P({failWrite:true});assert.equal(await x.detach(),false);assert.equal(x.F.mx.cols.length,2);assert.equal(x.c11.cell.c,'c1');assert.equal(x.hist(),0)});
 await test('PATCH: payload read error prevents detach',async()=>{const x=P({failRead:true});assert.equal(await x.detach(),false);assert.equal(x.F.mx.cols.length,2);assert.equal(x.changes(),0)});
 await test('PATCH: missing payload readback prevents detach',async()=>{const x=P({missingRead:true});assert.equal(await x.detach(),false);assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: silent index write failure prevents detach',async()=>{const x=P({dropIndex:true});assert.equal(await x.detach(),false);assert.equal(x.F.mx.cols.length,2);assert.equal(x.getIdx().length,0)});
 await test('PATCH: memory-only storage refuses destructive detach',async()=>{const x=P({mem:true});assert.equal(await x.detach(),false);assert.equal(x.getWrites(),0);assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: deferred write leaves source intact until resolved',async()=>{const x=P({deferWrite:true});const task=x.detach();await x.tick();assert.equal(x.F.mx.cols.length,2);assert.equal(x.c11.cell.c,'c1');x.release();assert.equal(await task,true)});
 await test('PATCH: switch active board during backup cancels detachment',async()=>{const x=P({deferWrite:true});const p=x.detach();await x.tick();x.S.board={id:'b2',items:[{id:'cell-c1-r1',type:'text',text:'Do not touch'}]};x.release();assert.equal(await p,false);assert.equal(x.F.mx.cols.length,2);assert.equal(x.S.board.items.length,1)});
 await test('PATCH: in-place content edit during backup cancels',async()=>{const x=P({deferWrite:true});const p=x.detach();await x.tick();x.child.text='later edit';x.release();assert.equal(await p,false);assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: matrix track state changed while writing cancels',async()=>{const x=P({deferWrite:true});const p=x.detach();await x.tick();x.F.mx.cols[0].name='Changed';x.release();assert.equal(await p,false);assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: selection change while writing cancels',async()=>{const x=P({deferWrite:true});const p=x.detach();await x.tick();x.S.sel=new Set(['another']);x.release();assert.equal(await p,false);assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: second detach while first is pending does not start backup',async()=>{const x=P({deferWrite:true});const first=x.detach();await x.tick();assert.equal(await x.detach(),false);assert.equal(x.getWrites(),1);x.release();assert.equal(await first,true);assert.equal(x.getIdx().length,1)});
 await test('PATCH: stale track ID fails before backup',async()=>{const x=P();assert.equal(await x.detach('c','absent'),false);assert.equal(x.getWrites(),0);assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: stale source frame fails before backup',async()=>{const x=P();x.S.board={id:'b2',items:[]};assert.equal(await x.detach(),false);assert.equal(x.getWrites(),0);assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: malformed drop coordinates fail closed',async()=>{const x=P();assert.equal(await x.detach('c','c1',{x:NaN,y:100}),false);assert.equal(x.getWrites(),0)});
 await test('PATCH: merged matrix cell blocks detachment until explicit unmerge',async()=>{const x=P();x.c11.cell.cs=2;assert.equal(await x.detach(),false);assert.equal(x.getWrites(),0);assert.equal(x.F.mx.cols.length,2)});
 await test('PATCH: unrelated merged cell in other column does not block safe detach',async()=>{const x=P();x.c22.cell.rs=2;assert.equal(await x.detach('c','c1'),true);assert.equal(x.F.mx.cols.length,1);assert.equal(x.c22.cell.rs,2)});
 await test('PATCH: two overlapping cell-contents groups block duplicate shift',async()=>{const x=P();x.c12.x=15;x.c12.y=15;assert.equal(await x.detach(),false);assert.equal(x.getWrites(),0)});
 await test('PATCH: rejected write can be retried after recovery',async()=>{const x=P({failWrite:true});assert.equal(await x.detach(),false);x.Store.set=async(k,v)=>x.data.set(k,structuredClone(v));assert.equal(await x.detach(),true);assert.equal(x.F.mx.cols.length,1)});
 await test('PATCH: render exception after mutation is not falsely reported as no-op',async()=>{const x=P({failChanged:true});assert.equal(await x.detach(),false);assert.equal(x.F.mx.cols.length,1);assert(x.toasts().some(t=>t.includes('Дорожка изменена')))});
 // Patched cell movement: reject anything that would erase merged-layout metadata.
 await test('PATCH: regular cell swap preserves both cell anchors',()=>{const x=P();assert.equal(x.drag(),true);assert.equal(x.c11.cell.c,'c2');assert.equal(x.c21.cell.c,'c1');assert.equal(x.getWrites(),0);assert.equal(x.changes(),1)});
 await test('PATCH: moving ordinary cell out of matrix remains possible',()=>{const x=P();assert.equal(x.drag(x.c11,{x:400,y:400}),true);assert.equal(x.c11.cell,undefined)});
 await test('PATCH: merged source cannot be dragged out and lose span',()=>{const x=P();x.c11.cell.cs=2;assert.equal(x.drag(x.c11,{x:400,y:400}),false);assert.equal(x.c11.cell.cs,2);assert.equal(x.changes(),0)});
 await test('PATCH: merged source cannot be swapped and lose span',()=>{const x=P();x.c11.cell.rs=2;assert.equal(x.drag(),false);assert.equal(x.c11.cell.rs,2);assert.equal(x.changes(),0)});
 await test('PATCH: merged destination cannot be swapped and lose span',()=>{const x=P();x.c21.cell.cs=2;assert.equal(x.drag(),false);assert.equal(x.c21.cell.cs,2);assert.equal(x.changes(),0)});
 await test('PATCH: stale source cell from a different board fails closed',()=>{const x=P();x.board.items=x.board.items.filter(i=>i!==x.c11);assert.equal(x.drag(),false);assert.equal(x.c11.cell.c,'c1')});
 await test('PATCH: stale dragged object list fails before any movement',()=>{const x=P();const outsider={id:'ghost'};assert.equal(x.drag(x.c11,{x:155,y:45},[{it:x.c11},{it:outsider}]),false);assert.equal(x.c11.cell.c,'c1')});
 await test('PATCH: invalid drag coordinates never shift content',()=>{const x=P();assert.equal(x.drag(x.c11,{x:Infinity,y:0}),false);assert.equal(x.c11.cell.c,'c1')});
 await test('PATCH: dragging cell list must include the actual source',()=>{const x=P();assert.equal(x.drag(x.c11,{x:155,y:45},[{it:x.c12}]),false);assert.equal(x.c11.cell.c,'c1')});
 await test('PATCH: a merged target interior slot is not silently overwritten',()=>{const x=P();x.c21.cell.cs=2;assert.equal(x.drag(x.c11,{x:245,y:45}),false);assert.equal(x.c21.cell.cs,2)});
 await test('PATCH: destination occupied by another dragged object cannot be overwritten',()=>{const x=P();assert.equal(x.drag(x.c11,{x:155,y:45},[{it:x.c11},{it:x.c21}]),false);assert.equal(x.c11.cell.c,'c1');assert.equal(x.c21.cell.c,'c2')});
 console.log(`TOTAL ${total-failed}/${total} PASS`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
