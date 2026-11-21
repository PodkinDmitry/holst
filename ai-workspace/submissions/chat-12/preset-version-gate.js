'use strict';
const assert=require('node:assert/strict');
const create=require('./xod-versioned-preset-sessions.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(r=>setImmediate(r));
const test=[];const check=(name,fn)=>test.push({name,fn});
const view=x=>({filter:null,sort:[],group:{key:x,dir:'asc'}});
const initial=()=>({views:{main:view('title')},presets:[{id:'a',name:'Alpha',view:view('category')},{id:'b',name:'Beta',view:view('watched')}],presetRevisions:{a:0,b:0}});
function store(data=initial()) {
 let doc=copy(data),rev=0,writes=0,conflicts=0;
 const read=async()=>{await tick();return {revision:rev,data:copy(doc)}};
 async function transaction(fn) {
  for(let i=0;i<20;i++){
   const snap=await read();const draft=copy(snap.data);const result=fn(draft);
   if(result&&typeof result.then==='function')throw Error('async mutator');
   await tick();if(snap.revision!==rev){conflicts++;continue}
   doc=draft;rev++;writes++;return result;
  }
  const e=Error('too much contention');e.code='XOD_CAS_RETRY_LIMIT';throw e;
 }
 return {read,transaction,get data(){return copy(doc)},get writes(){return writes},get conflicts(){return conflicts},get revision(){return rev}};
}
const make=(db,prefix='p',extra={})=>{let n=0;return create({read:db.read,transaction:db.transaction,makeId:()=>prefix+(++n),...extra})};
const renamed=(id,name)=>({op:'rename',id,name});
const updated=(id,key)=>({op:'update',id,view:view(key)});
const deleted=id=>({op:'delete',id});
const created=(id,name='Gamma')=>({op:'create',operationId:id,name,view:view('category')});
const conflict=e=>e&&e.code==='XOD_PRESET_CONFLICT'&&e.remotePreset!==undefined;

check('01 negative control: stale rename silently overwrites newer name with legacy mutator',async()=>{
 const db=store();const old=async op=>db.transaction(d=>{const p=d.presets.find(x=>x.id===op.id);p.name=op.name;return copy(d.presets)});
 await old(renamed('a','New from A'));await old(renamed('a','Stale from B'));
 assert.equal(db.data.presets[0].name,'Stale from B');
});
check('02 two sessions: stale rename raises conflict; original name preserved',async()=>{
 const db=store();const a=await make(db).openSession(),b=await make(db).openSession();
 await a.onChangePreset(renamed('a','New from A'));
 await assert.rejects(b.onChangePreset(renamed('a','Stale B')),conflict);
 assert.equal(db.data.presets[0].name,'New from A');assert.equal(db.data.presetRevisions.a,1);
});
check('03 stale update cannot revert a newer rename',async()=>{
 const db=store();const a=await make(db).openSession(),b=await make(db).openSession();
 await a.onChangePreset(renamed('a','Renamed'));
 await assert.rejects(b.onChangePreset(updated('a','stale')),conflict);
 assert.equal(db.data.presets[0].view.group.key,'category');
});
check('04 stale delete cannot erase newer update',async()=>{
 const db=store();const a=await make(db).openSession(),b=await make(db).openSession();
 await a.onChangePreset(updated('a','fresh'));
 await assert.rejects(b.onChangePreset(deleted('a')),conflict);
 assert.equal(db.data.presets.length,2);assert.equal(db.data.presets[0].view.group.key,'fresh');
});
check('05 stale rename after deletion gives conflict with null remote',async()=>{
 const db=store();const a=await make(db).openSession(),b=await make(db).openSession();
 await a.onChangePreset(deleted('a'));
 await assert.rejects(b.onChangePreset(renamed('a','Phantom')),e=>e.code==='XOD_PRESET_CONFLICT'&&e.remotePreset===null);
 assert.equal(db.data.presets.length,1);assert.equal(db.data.presetRevisions.a,1);
});
check('06 two tabs edit distinct presets: CAS collision merges both edits',async()=>{
 const db=store();const a=await make(db).openSession(),b=await make(db).openSession();
 const [left,right]=await Promise.all([a.onChangePreset(renamed('a','A2')),b.onChangePreset(updated('b','newkey'))]);
 assert.equal(left.length,2);assert.equal(right.length,2);
 assert.equal(db.data.presets[0].name,'A2');assert.equal(db.data.presets[1].view.group.key,'newkey');
 assert.ok(db.conflicts>=1);
});
check('07 two tabs edit same preset concurrently: one wins; other conflicts',async()=>{
 const db=store();const a=await make(db).openSession(),b=await make(db).openSession();
 const out=await Promise.allSettled([a.onChangePreset(renamed('a','A2')),b.onChangePreset(updated('a','other'))]);
 assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(out.filter(x=>x.status==='rejected'&&x.reason.code==='XOD_PRESET_CONFLICT').length,1);
 assert.equal(db.data.presetRevisions.a,1);
});
check('08 same session successive edits advance baseline without false conflicts',async()=>{
 const db=store();const a=await make(db).openSession();
 const p=a.onChangePreset(renamed('a','V1'));const q=a.onChangePreset(updated('a','v2'));
 await Promise.all([p,q]);assert.equal(db.data.presetRevisions.a,2);
 assert.equal(db.data.presets[0].name,'V1');assert.equal(db.data.presets[0].view.group.key,'v2');
});
check('09 create with token: existing receipt makes same retry idempotent',async()=>{
 const db=store();const a=await make(db).openSession();
 await a.onChangePreset(created('op1'));await a.onChangePreset(created('op1'));
 assert.equal(db.data.presets.filter(x=>x.name==='Gamma').length,1);
 assert.equal(db.data.presetReceipts.op1.id,'p1');
});
check('10 two intentional same-content creates with different opIds both persist',async()=>{
 const db=store();const a=await make(db).openSession();
 await a.onChangePreset(created('op1'));await a.onChangePreset(created('op2'));
 assert.equal(db.data.presets.filter(x=>x.name==='Gamma').length,2);
});
check('11 token reused with different payload rejects',async()=>{
 const db=store();const a=await make(db).openSession();await a.onChangePreset(created('op1'));
 await assert.rejects(a.onChangePreset(created('op1','Different')),{code:'XOD_OPERATION_ID_COLLISION'});
 assert.equal(db.data.presets.length,3);
});
check('12 update committed but reply lost: block until explicit reload',async()=>{
 const db=store();let drop=true;const transient=async fn=>{const v=await db.transaction(fn);if(drop){drop=false;throw Error('ACK lost')}return v};
 const a=await make(db,'p',{transaction:transient}).openSession();
 await assert.rejects(a.onChangePreset(renamed('a','Saved')),/ACK lost/);
 assert.equal(db.data.presets[0].name,'Saved');
 await assert.rejects(a.onChangePreset(updated('a','unsafe')),{code:'XOD_PRESET_RECONCILIATION_REQUIRED'});
 assert.equal(db.data.presets[0].view.group.key,'category');
 assert.equal((await a.reload())[0].name,'Saved');
 await a.onChangePreset(updated('a','safe'));assert.equal(db.data.presetRevisions.a,2);
});
check('13 create committed but ACK lost: same opId retry remains safe',async()=>{
 const db=store();let drop=true;const transient=async fn=>{const v=await db.transaction(fn);if(drop){drop=false;throw Error('ACK lost')}return v};
 const a=await make(db,'p',{transaction:transient}).openSession();
 await assert.rejects(a.onChangePreset(created('op1')),/ACK lost/);
 await assert.rejects(a.onChangePreset(created('op2')),{code:'XOD_PRESET_RECONCILIATION_REQUIRED'});
 const out=await a.onChangePreset(created('op1'));
 assert.equal(out.filter(x=>x.name==='Gamma').length,1);assert.equal(db.data.presets.length,3);
});
check('14 wrong collision: generated ID equals deleted tombstone',async()=>{
 const db=store();const a=await make(db,'a').openSession();await a.onChangePreset(deleted('a'));
 const b=await make(db,'a',{makeId:()=> 'a'}).openSession();
 await assert.rejects(b.onChangePreset(created('another')),{code:'XOD_PRESET_ID_COLLISION'});
 assert.equal(db.data.presets.length,1);
});
check('15 prototype-safe operationId and IDs',async()=>{
 const db=store();const a=await make(db).openSession();await a.onChangePreset(created('__proto__'));
 assert.equal(Object.prototype.hasOwnProperty.call(db.data.presetReceipts,'__proto__'),true);
 assert.equal({}.signature,undefined);
});
check('16 snapshot command is taken before queued asynchronous work',async()=>{
 const db=store();const a=await make(db).openSession();
 const cmd=updated('a','before');const p=a.onChangePreset(cmd);cmd.view.group.key='after';await p;
 assert.equal(db.data.presets[0].view.group.key,'before');
});
check('17 dispose stops not-yet-started work',async()=>{
 const db=store();const a=await make(db).openSession();const p=a.onChangePreset(renamed('a','No'));
 a.dispose();await assert.rejects(p,{code:'XOD_PRESET_SESSION_CLOSED'});assert.equal(db.writes,0);
});
check('18 corrupt revision fails without writing',async()=>{
 const bad=initial();bad.presetRevisions.a='bad';const db=store(bad);
 await assert.rejects(make(db).openSession(),{code:'XOD_BAD_STORE'});assert.equal(db.writes,0);
});
check('19 legacy document with no revision map migrates on first update',async()=>{
 const doc=initial();delete doc.presetRevisions;const db=store(doc),a=await make(db).openSession();
 await a.onChangePreset(renamed('a','Migrated'));assert.equal(db.data.presetRevisions.a,1);
});
check('20 stale update rejected after remote delete and new intentional duplicate name',async()=>{
 const db=store();const a=await make(db).openSession(),b=await make(db,'z').openSession();
 await a.onChangePreset(deleted('a'));await a.onChangePreset(created('create1','Alpha'));
 await assert.rejects(b.onChangePreset(updated('a','old')),{code:'XOD_PRESET_CONFLICT'});
 assert.equal(db.data.presets.filter(x=>x.name==='Alpha').length,1);
});

(async()=>{let pass=0;for(const t of test){try{await t.fn();pass++;console.log('PASS',t.name)}catch(e){console.error('FAIL',t.name,e.stack);process.exitCode=1}}console.log('RESULT',pass+'/'+test.length,pass===test.length?'PASS':'FAIL')})();
