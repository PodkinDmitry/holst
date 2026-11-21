#!/usr/bin/env node
'use strict';
// Execute actual Test13 mxSpan / mxDropFrame bodies under synthetic Store/board/drag state.
// Does NOT simulate actual Chrome, IndexedDB, Google Drive, SOL checkout or browser E2E.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const [originalPath,patchedPath]=process.argv.slice(2);
if(!originalPath||!patchedPath)throw Error('usage: node matrix_span_drop_source_gate.js ORIGINAL/v224/base29.html PATCHED/v224/base29.html');
const original=fs.readFileSync(originalPath,'utf8'),patched=fs.readFileSync(patchedPath,'utf8');
assert.equal(crypto.createHash('sha256').update(original).digest('hex'),'3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c','must run exact private original Test13');
function section(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<0||i>=j)throw Error('missing original source markers '+a+' / '+b);return s.slice(i,j);}
function sourceCode(s){
 const spanStart=s.includes('function mxAutoBlankCell(cell, ignore = null) {')?'function mxAutoBlankCell(cell, ignore = null) {':'function mxSpan(cell, dc, dr) {';
 return section(s,spanStart,'function mxSlotAt(G, w) {')+'\n'+
   section(s,'function mxSlotAt(G, w) {','/* a cell dropped after dragging by its grip:')+'\n'+
   section(s,'function mxDropFrame(fr, d, w) {','/* ---------- pointer: headers, resize lines, grips, add buttons ---------- */')+'\n'+
   section(s,'function mxNewCell(F, c, r) {','function mxCreate(F, cols, rows) {')+'\n'+
   section(s,'function mxShift(list, dx, dy) {','function layoutMatrices() {')+'\n'+
   section(s,'function withFrameContents(list) {','function prepare(list) {')+'\n'+
   section(s,'async function trashPut(e, data) {',s.includes('async function trashItems(')?'async function trashItems(':'function trashItems(');
}
function setup(src,opt={}){
 const mkCell=(c,r)=>({id:'cell-'+c+r,type:'frame',x:c==='c1'?10:c==='c2'?122:234,y:r==='r1'?10:122,w:100,h:100,title:'',fill:'#ffffff',cell:{m:'matrix',c,r}});
 const F={id:'matrix',type:'frame',x:0,y:0,w:430,h:310,title:'Matrix',mx:{cols:[{id:'c1',w:100},{id:'c2',w:100},{id:'c3',w:100}],rows:[{id:'r1',h:100},{id:'r2',h:100}],gap:12}};
 const cells=['r1','r2'].flatMap(r=>['c1','c2','c3'].map(c=>mkCell(c,r)));
 const cell=cells.find(x=>x.id==='cell-c1r1'), neighbor=cells.find(x=>x.id==='cell-c2r1');
 const fr={id:'moving',type:'frame',x:350,y:350,w:85,h:85,title:'User frame'};
 const other={id:'unrelated',type:'text',text:'User data',x:500,y:500};
 const board={id:'board-S',name:'Synthetic',items:[F,...cells,fr,other],assets:{image:'data:image/png;base64,AAAA'},updatedAt:1};
 const S={board,sel:new Set(['moving']),mxSel:null};
 const data=new Map();let index=[],uidCount=0,hist=0,changes=0,raise=0,reads=0,writes=0,toasts=[];let writeRelease=null;
 const Store={mode:opt.mem?'mem':'idb',async set(k,v){writes++;if(opt.failWrite)throw Error('fake quota');if(opt.deferWrite)await new Promise(resolve=>writeRelease=resolve);data.set(k,structuredClone(v));},async get(k){reads++;if(opt.failRead)throw Error('fake read');return opt.missingRead?null:data.get(k);}};
 const LS={get(k){return k==='trashidx'?structuredClone(index):null;},set(k,v){if(k==='trashidx'&&!opt.dropIndex)index=structuredClone(v);}};
 const items=()=>S.board.items;
 const mxCells=f=>items().filter(x=>x.cell?.m===f.id);
 const mxGeom=f=>{const cols=f.mx.cols,rows=f.mx.rows,gap=12,cx={},ry={};let x=10,y=10;for(const c of cols){cx[c.id]=x;x+=c.w+gap;}for(const r of rows){ry[r.id]=y;y+=r.h+gap;}const ci=new Map(cols.map((c,i)=>[c.id,i])),ri=new Map(rows.map((r,i)=>[r.id,i]));const rect=o=>{const a=ci.get(o.cell.c),b=ri.get(o.cell.r);if(a==null||b==null)return null;return{x:cx[cols[a].id],y:ry[rows[b].id],w:cols[a].w,h:rows[b].h};};return{cols,rows,cx,ry,ci,ri,gap,rect};};
 const bounds=x=>({x:x.x||0,y:x.y||0,w:x.w||0,h:x.h||0});
 const inside=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.w<=b.x+b.w&&a.y+a.h<=b.y+b.h;
 const env={S,Store,LS,Map,Set,JSON,Object,Number,Math,Date,console:{error(){}},
  uid:()=>`fake-id-${++uidCount}`,mxTid:()=>`t-${++uidCount}`,MX_FRESH:new Set(),
  mxOf:x=>x.cell?items().find(f=>f.id===x.cell.m&&f.mx):null,
  mxCells,mxGeom,bounds,inside,items,clamp:(x,min,max)=>Math.min(max,Math.max(min,x)),r1:x=>Math.round(x*10)/10,
  toast:x=>toasts.push(String(x)),pushHist:()=>{hist++},changed:()=>{changes++},
  clone:x=>structuredClone(x),bmOf:()=>[{sample:'synthetic'}],
  trashIdx:()=>LS.get('trashidx')||[],trashSaveIdx:l=>LS.set('trashidx',l),
  assetSize:x=>String(x).length,assetKind:()=> 'img'};
 const ctx=vm.createContext(env);
 vm.runInContext(sourceCode(src),ctx,{timeout:2000});
 function callSpan(a=cell,dc=1,dr=0){ctx.__cell=a;ctx.__dc=dc;ctx.__dr=dr;return vm.runInContext('mxSpan(__cell,__dc,__dr)',ctx,{timeout:2000});}
 function callDrop(target=fr,where={x:150,y:45}){ctx.__fr=target;ctx.__drag={list:[{it:target}]};ctx.__where=where;return vm.runInContext('mxDropFrame(__fr,__drag,__where)',ctx,{timeout:2000});}
 function getCell(c,r='r1'){return cells.find(y=>y.cell.c===c&&y.cell.r===r)}
 return {S,F,cell,neighbor,fr,other,board,cells,data,LS,Store,ctx,env,callSpan,callDrop,getCell,
  hist:()=>hist,changes:()=>changes,raise:()=>raise,reads:()=>reads,writes:()=>writes,idx:()=>index,toasts:()=>toasts,
  releaseWrite(){if(!writeRelease)throw Error('no pending write');const f=writeRelease;writeRelease=null;f();},
  tick:()=>new Promise(r=>setImmediate(r))};
}
let total=0,failed=0;async function test(name,fn){total++;try{await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+(e.stack||e));}}
const O=o=>setup(original,o),P=o=>setup(patched,o);
(async()=>{
 // Controls: original functions really execute, including the unsafe branches.
 await test('ORIGINAL span removes a cell with user properties',()=>{const x=O();x.neighbor.props={tag:'essential'};x.callSpan();assert(!x.board.items.includes(x.neighbor));assert.equal(x.idx().length,0);});
 await test('ORIGINAL span destroys empty cell without recoverable backup',()=>{const x=O();x.callSpan();assert(!x.board.items.includes(x.neighbor));assert.equal(x.writes(),0);});
 await test('ORIGINAL span invalid column corrupts span metadata',()=>{const x=O();x.cell.cell.c='stale';x.callSpan();assert(Number.isNaN(x.cell.cell.cs));});
 await test('ORIGINAL span enters the area of another merged cell anchor',()=>{const x=O();const another=x.getCell('c1');another.cell.cs=3;const target=x.getCell('c2');x.callSpan(target,1,0);assert.equal(target.cell.cs,2);});
 await test('ORIGINAL drop overwrites cell carrying custom metadata',()=>{const x=O();x.neighbor.props={st:'busy'};assert.equal(x.callDrop(),true);assert(!x.board.items.includes(x.neighbor));});
 await test('ORIGINAL drop removes cell referenced by connector',()=>{const x=O();x.board.items.push({id:'wire',type:'connector',from:{id:x.neighbor.id},to:{id:'other'}});assert.equal(x.callDrop(),true);assert(!x.board.items.includes(x.neighbor));});
 await test('ORIGINAL drop deletes merged target even at interior slot',()=>{const x=O();x.neighbor.cell.cs=2;assert.equal(x.callDrop(x.fr,{x:245,y:45}),true);assert(!x.board.items.includes(x.neighbor));});
 await test('ORIGINAL drop loses cell title',()=>{const x=O();x.neighbor.title='Keep this';assert.equal(x.callDrop(),true);assert(!x.board.items.includes(x.neighbor));});
 // Tested patched functions: safe original flows, fail-closed and race controls.
 await test('PATCH span writes full-board backup before removing pristine neighbor',async()=>{const x=P();assert.equal(await x.callSpan(),true);assert(!x.board.items.includes(x.neighbor));assert.equal(x.idx().length,1);assert.equal(x.hist(),1);assert.equal(x.changes(),1);});
 await test('PATCH snapshot retains matrix, cell IDs and board assets',async()=>{const x=P();await x.callSpan();const rec=x.data.get('trash:'+x.idx()[0].id);assert(rec.board.items.some(y=>y.id===x.neighbor.id));assert.equal(rec.board.items.find(y=>y.id==='matrix').mx.cols.length,3);assert.equal(rec.board.assets.image,x.board.assets.image);});
 await test('PATCH refuses Store.set rejection without mutating board',async()=>{const x=P({failWrite:true});assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));assert.equal(x.hist(),0);});
 await test('PATCH refuses silent index failure without mutating board',async()=>{const x=P({dropIndex:true});assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));assert.equal(x.changes(),0);});
 await test('PATCH refuses absent payload readback',async()=>{const x=P({missingRead:true});assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));assert.equal(x.hist(),0);});
 await test('PATCH refuses thrown payload readback',async()=>{const x=P({failRead:true});assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH refuses memory-only storage',async()=>{const x=P({mem:true});assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));assert.equal(x.writes(),0);});
 await test('PATCH pending backup does not mutate matrix',async()=>{const x=P({deferWrite:true});const p=x.callSpan();await x.tick();assert(x.board.items.includes(x.neighbor));assert.equal(x.hist(),0);x.releaseWrite();assert.equal(await p,true);});
 await test('PATCH late edit during backup cancels mutation',async()=>{const x=P({deferWrite:true});const p=x.callSpan();await x.tick();x.other.text='late edit';x.releaseWrite();assert.equal(await p,false);assert(x.board.items.includes(x.neighbor));assert.equal(x.idx().length,1);});
 await test('PATCH switching boards during backup never deletes other board objects',async()=>{const x=P({deferWrite:true});const p=x.callSpan();await x.tick();x.S.board={id:'fresh',items:[{id:'cell-c2r1',type:'text',text:'survive'}]};x.releaseWrite();assert.equal(await p,false);assert.equal(x.S.board.items.length,1);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH changing selected items during backup cancels merge',async()=>{const x=P({deferWrite:true});const p=x.callSpan();await x.tick();x.S.sel=new Set(['unrelated']);x.releaseWrite();assert.equal(await p,false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH a render exception after mutation never falsely reports cancellation',async()=>{const x=P();x.env.changed=()=>{throw Error('synthetic render failure')};assert.equal(await x.callSpan(),false);assert(!x.board.items.includes(x.neighbor));assert(x.toasts().some(t=>t.includes('Ячейки изменены')));});
 await test('PATCH two concurrent span calls generate just one backup',async()=>{const x=P({deferWrite:true});const a=x.callSpan(),b=x.callSpan();assert.equal(await b,false);assert.equal(x.writes(),1);x.releaseWrite();assert.equal(await a,true);assert.equal(x.idx().length,1);});
 await test('PATCH retry after failure succeeds',async()=>{const x=P({failWrite:true});assert.equal(await x.callSpan(),false);x.Store.set=async(k,v)=>x.data.set(k,structuredClone(v));assert.equal(await x.callSpan(),true);});
 await test('PATCH rejects tagged neighbor rather than losing its properties',async()=>{const x=P();x.neighbor.props={tag:'critical'};assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));assert.equal(x.writes(),0);});
 await test('PATCH rejects styled neighbor',async()=>{const x=P();x.neighbor.fill='#ff0000';assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH rejects neighbor with child object',async()=>{const x=P();const kid={id:'kid',type:'text',x:132,y:20,w:20,h:20,parent:x.neighbor.id,text:'content'};x.board.items.push(kid);assert.equal(await x.callSpan(),false);assert(x.board.items.includes(kid));});
 await test('PATCH rejects neighbor with inbound connector',async()=>{const x=P();x.board.items.push({id:'wire',type:'connector',from:{id:x.neighbor.id},to:{id:x.other.id}});assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH rejects neighbor with inbound pin',async()=>{const x=P();x.other.pin={to:x.neighbor.id};assert.equal(await x.callSpan(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH rejects merging across another merged cell boundary',async()=>{const x=P();x.getCell('c1').cell.cs=3;const target=x.getCell('c2');assert.equal(await x.callSpan(target,1,0),false);assert.equal(target.cell.cs,undefined);});
 await test('PATCH rejects a merged neighbor even if it is otherwise empty',async()=>{const x=P();x.neighbor.cell.cs=2;assert.equal(await x.callSpan(),false);assert.equal(x.writes(),0);});
 await test('PATCH rejects stale anchor instead of corrupting spans',async()=>{const x=P();x.cell.cell.c='missing';assert.equal(await x.callSpan(),false);assert.equal(x.cell.cell.cs,undefined);assert.equal(x.hist(),0);});
 await test('PATCH rejects a cell detached from the active board',async()=>{const x=P();x.board.items=x.board.items.filter(y=>y!==x.cell);assert.equal(await x.callSpan(),false);assert.equal(x.writes(),0);});
 await test('PATCH shrinking span regenerates empty cells without destructive backup',async()=>{const x=P();x.cell.cell.cs=2;x.board.items=x.board.items.filter(y=>y!==x.neighbor);assert.equal(await x.callSpan(x.cell,-1,0),true);assert.equal(x.cell.cell.cs,undefined);assert(x.board.items.some(y=>y.cell?.c==='c2'&&y.cell?.r==='r1'));assert.equal(x.writes(),0);});
 await test('PATCH no-op when already at geometry boundary',async()=>{const x=P();x.cell.cell.cs=3;assert.equal(await x.callSpan(x.cell,1,0),false);assert.equal(x.writes(),0);assert.equal(x.hist(),0);});
 await test('PATCH rejects malformed increment',async()=>{const x=P();assert.equal(await x.callSpan(x.cell,Infinity,0),false);assert.equal(x.hist(),0);});
 await test('PATCH drop pristine placeholder still inserts dragged frame',()=>{const x=P();assert.equal(x.callDrop(),true);assert.equal(x.fr.cell.m,'matrix');assert.equal(x.fr.cell.c,'c2');assert(!x.board.items.includes(x.neighbor));assert.equal(x.changes(),1);});
 await test('PATCH drop refuses custom props without deleting cell',()=>{const x=P();x.neighbor.props={st:'done'};assert.equal(x.callDrop(),false);assert(x.board.items.includes(x.neighbor));assert.equal(x.fr.cell,undefined);});
 await test('PATCH drop refuses titled cell',()=>{const x=P();x.neighbor.title='Important';assert.equal(x.callDrop(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH drop refuses colored cell',()=>{const x=P();x.neighbor.fill='#ff0000';assert.equal(x.callDrop(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH drop refuses cell containing nested object',()=>{const x=P();x.board.items.push({id:'child',type:'text',x:132,y:20,w:20,h:20,parent:x.neighbor.id});assert.equal(x.callDrop(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH drop refuses linked cell',()=>{const x=P();x.board.items.push({id:'wire',type:'connector',from:{id:x.neighbor.id},to:{id:x.other.id}});assert.equal(x.callDrop(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH drop refuses pinned cell',()=>{const x=P();x.other.pin={to:x.neighbor.id};assert.equal(x.callDrop(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH drop refuses merged cell anchor',()=>{const x=P();x.neighbor.cell.cs=2;assert.equal(x.callDrop(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH drop refuses merged-cell interior slot',()=>{const x=P();x.neighbor.cell.cs=2;assert.equal(x.callDrop(x.fr,{x:245,y:45}),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH drop refuses detached moving frame',()=>{const x=P();x.board.items=x.board.items.filter(i=>i!==x.fr);assert.equal(x.callDrop(),false);assert(x.board.items.includes(x.neighbor));});
 await test('PATCH drop recognizes dragged frame already inside empty placeholder',()=>{const x=P();x.fr.x=132;x.fr.y=20;assert.equal(x.callDrop(),true);assert.equal(x.fr.cell.c,'c2');});
 await test('PATCH drop outside matrix is no-op',()=>{const x=P();assert.equal(x.callDrop(x.fr,{x:900,y:900}),false);assert(x.board.items.includes(x.neighbor));});
 console.log(`TOTAL ${total-failed}/${total} PASS`);
 if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
