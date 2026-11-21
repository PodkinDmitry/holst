'use strict';
const assert=require('node:assert/strict');
const makeCas=require(process.env.XOD_CAS_MODULE||'../chat-09/xod-cas-view-coordinator.js');
const makePreset=require('./xod-preset-idempotency-adapter.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const tests=[];const test=(name,run)=>tests.push({name,run});
function storage(initial){
 let doc=clone(initial||{views:{},presets:[]}),version=0,conflicts=0,writes=0;
 return {get data(){return clone(doc)},get writes(){return writes},get conflicts(){return conflicts},
 read:async()=>{await tick();return {revision:version,data:clone(doc)}},
 compareAndSwap:async(expected,draft)=>{await tick();if(expected!==version){conflicts++;return {ok:false}}doc=clone(draft);version++;writes++;return {ok:true}}
 }
}
function system(db, prefix='p'){
 const cas=makeCas(db);let seq=0;
 return {cas, adapter:makePreset({transaction:cas.transaction,makeId:()=>prefix+(++seq)}),get idCounter(){return seq}};
}
const view=(x)=>({filter:null,sort:[],group:{key:x,dir:'asc'}});
const create=(id,name='Inbox',v=view('category'))=>({op:'create',operationId:id,name,view:v});

test('01 create writes valid single preset and receipt',async()=>{
 const db=storage(),a=system(db);const out=await a.adapter(create('op1'));
 assert.equal(out.length,1);assert.equal(out[0].name,'Inbox');assert.equal(db.data.presetReceipts.op1.id,'p1');
});

test('02 lost response after commit: same opId returns same preset',async()=>{
 const db=storage(),a=system(db);let lost=true;
 const unreliable=async cmd=>{const v=await a.adapter(cmd);if(lost){lost=false;throw Error('lost reply')}return v};
 await assert.rejects(unreliable(create('op1')),/lost reply/);
 const retry=await unreliable(create('op1'));assert.equal(retry.length,1);assert.equal(retry[0].id,'p1');
 assert.equal(db.data.presets.length,1);
});

test('03 two intentional identical presets with different operationId both exist',async()=>{
 const db=storage(),a=system(db);
 await a.adapter(create('op1'));const v=await a.adapter(create('op2'));
 assert.equal(v.length,2);assert.deepEqual(v.map(x=>x.id),['p1','p2']);
});

test('04 reused operationId with changed payload is a collision',async()=>{
 const db=storage(),a=system(db);await a.adapter(create('shared'));
 await assert.rejects(a.adapter(create('shared','Different')),{code:'XOD_OPERATION_ID_COLLISION'});
 assert.equal(db.data.presets.length,1);
});

test('05 transient read failure first then retry of same command',async()=>{
 const db=storage();let fail=true;
 const cas=makeCas({read:async()=>{if(fail){fail=false;throw Error('disk read failure')}return db.read()},compareAndSwap:db.compareAndSwap});
 let seq=0;const a=makePreset({transaction:cas.transaction,makeId:()=>`p${++seq}`});
 await assert.rejects(a(create('op1')),/disk read failure/);
 const v=await a(create('op1'));assert.equal(v.length,1);
});

test('06 two independent coordinators race with same opId, single preset',async()=>{
 const db=storage(),a=system(db,'a'),b=system(db,'b');
 const [x,y]=await Promise.all([a.adapter(create('op1')),b.adapter(create('op1'))]);
 assert.equal(db.data.presets.length,1);assert.equal(x.length,1);assert.equal(y.length,1);
 assert.ok(db.conflicts>=1);
});

test('07 rename, update and delete continue returning full lists',async()=>{
 const db=storage(),a=system(db);await a.adapter(create('op1'));
 let x=await a.adapter({op:'rename',id:'p1',name:'New'});assert.equal(x[0].name,'New');
 x=await a.adapter({op:'update',id:'p1',view:view('watched')});assert.equal(x[0].view.group.key,'watched');
 x=await a.adapter({op:'delete',id:'p1'});assert.deepEqual(x,[]);
 x=await a.adapter({op:'delete',id:'p1'});assert.deepEqual(x,[]);
});

test('08 special operationId cannot pollute Object prototype',async()=>{
 const db=storage(),a=system(db);await a.adapter(create('__proto__'));
 assert.equal(Object.prototype.hasOwnProperty.call(db.data.presetReceipts,'__proto__'),true);
 assert.equal({}.signature,undefined);
});

test('09 no operationId is rejected to prevent unsafe create',async()=>{
 const db=storage(),a=system(db);
 await assert.rejects(a.adapter({op:'create',name:'N',view:view('category')}),{code:'XOD_OPERATION_ID_REQUIRED'});
 assert.equal(db.writes,0);
});

test('10 input view is snapshotted; later caller edits do not mutate store',async()=>{
 const db=storage(),a=system(db);const cmd=create('op1');const wait=a.adapter(cmd);cmd.view.group.key='watched';
 await wait;assert.equal(db.data.presets[0].view.group.key,'category');
});

test('11 duplicate generated ID is rejected rather than overwriting preset',async()=>{
 const db=storage(),a=system(db,'z');await a.adapter(create('op1'));
 const another=makePreset({transaction:makeCas(db).transaction,makeId:()=> 'z1'});
 await assert.rejects(another(create('op2')),{code:'XOD_PRESET_ID_COLLISION'});
 assert.equal(db.data.presets.length,1);
});

test('12 old create retry after deletion does not resurrect deleted preset',async()=>{
 const db=storage(),a=system(db);await a.adapter(create('op1'));
 await a.adapter({op:'delete',id:'p1'});const v=await a.adapter(create('op1'));
 assert.deepEqual(v,[]);assert.equal(db.data.presets.length,0);
});

test('13 preset creation preserves unrelated view revisions and scopes',async()=>{
 const initial={views:{main:view('category')},viewRevisions:{main:4},presets:[]};
 const db=storage(initial),a=system(db);await a.adapter(create('op1'));
 assert.deepEqual(db.data.views,initial.views);assert.deepEqual(db.data.viewRevisions,initial.viewRevisions);
});

(async()=>{let pass=0;for(const t of tests){try{await t.run();pass++;console.log('PASS',t.name)}catch(e){console.error('FAIL',t.name,e.stack);process.exitCode=1}}
console.log(`RESULT ${pass}/${tests.length} ${pass===tests.length?'PASS':'FAIL'}`)})().catch(e=>{console.error(e);process.exitCode=1});
