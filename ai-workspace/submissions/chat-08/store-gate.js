'use strict';
const assert=require('node:assert/strict');
const create=require('./xod-view-store-coordinator.js');
function clone(o){return JSON.parse(JSON.stringify(o));}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
async function tick(){for(let i=0;i<12;i++)await Promise.resolve()}
const results=[];
async function test(name,fn){try{await fn();results.push([name,'PASS']);console.log('PASS',name)}catch(e){results.push([name,'FAIL']);console.log('FAIL',name,e.stack||e)}}
(async()=>{
 await test('01: baseline WITHOUT coordinator loses a surface',async()=>{
  const reads=[deferred(),deferred()];let idx=0;
  let stored={presets:['keep'],views:{}};
  async function naive(scope,view){const snap=await reads[idx++].promise; snap.views[scope]=view;stored=clone(snap);}
  const a=naive('main',{sort:['a']});const b=naive('side',{sort:['b']});
  reads[0].resolve(clone(stored));reads[1].resolve(clone(stored));
  await a;await b;
  assert.equal(Object.keys(stored.views).length,1,'baseline must demonstrate lost update');
 });
 await test('02: coordinator retains both surfaces under delayed I/O',async()=>{
  const pending=deferred();let reads=0;let data={presets:['keep'],views:{}};
  const c=create({async read(){reads++;return clone(data)},async write(next){if(reads===1)await pending.promise;data=clone(next)}});
  const a=c.saveView('main',{sort:['a']});const b=c.saveView('side',{sort:['b']});
  await tick();assert.equal(reads,1,'read was not serialized');pending.resolve();await Promise.all([a,b]);
  assert.deepEqual(Object.keys(data.views).sort(),['main','side']);assert.deepEqual(data.presets,['keep']);
 });
 await test('03: last invoked operation wins for same scope',async()=>{
  let db={views:{}};const c=create({read:async()=>clone(db),write:async d=>{db=clone(d)}});
  await Promise.all([c.saveView('main',{group:{dir:'asc'}}),c.saveView('main',{group:{dir:'desc'}})]);
  assert.equal(db.views.main.group.dir,'desc');
 });
 await test('04: arguments copied at invocation time',async()=>{
  let db={views:{}};const c=create({read:async()=>clone(db),write:async d=>{db=clone(d)}});
  const v={filter:{op:'and',children:[]}};const p=c.saveView('main',v);v.filter.children.push({key:'x',op:'unset'});await p;
  assert.equal(db.views.main.filter.children.length,0);
 });
 await test('05: rejected first write does not poison queue',async()=>{
  let n=0,db={views:{}};const c=create({read:async()=>clone(db),write:async d=>{if(++n===1)throw Error('disk full');db=clone(d)}});
  const p1=c.saveView('main',{sort:['failed']});const p2=c.saveView('side',{sort:['ok']});
  await assert.rejects(p1,/disk full/);await p2;
  assert.deepEqual(db.views.side.sort,['ok']);assert.equal(db.views.main,undefined);
 });
 await test('06: transaction preserves other JSON sections',async()=>{
  let db={views:{main:{sort:['old']}},presets:[{id:'p',name:'old'}],settings:{theme:'dark'}};
  const c=create({read:async()=>clone(db),write:async d=>{db=clone(d)}});
  await Promise.all([
    c.saveView('main',{sort:['new']}),
    c.transaction(s=>{s.presets.push({id:'q',name:'new'})})
  ]);
  assert.equal(db.settings.theme,'dark');assert.equal(db.presets.length,2);assert.deepEqual(db.views.main.sort,['new']);
 });
 await test('07: dangerous object key saved safely',async()=>{
  let db={views:{}};const c=create({read:async()=>clone(db),write:async d=>{db=clone(d)}});
  await c.saveView('__proto__',{sort:[]});assert.equal(Object.hasOwn(db.views,'__proto__'),true);assert.equal({}.polluted,undefined);
 });
 await test('08: one failing read recovers',async()=>{
  let n=0,db={views:{}};const c=create({read:async()=>{if(++n===1)throw Error('read fail');return clone(db)},write:async d=>{db=clone(d)}});
  await assert.rejects(c.saveView('main',{filter:null}),/read fail/);
  await c.saveView('main',{filter:{op:'and',children:[]}});
  assert.equal(db.views.main.filter.op,'and');
 });
 await test('09: invalid input rejected without wedging queue',async()=>{
  let db={views:{}};const c=create({read:async()=>clone(db),write:async d=>{db=clone(d)}});
  await assert.rejects(c.saveView('',{}),/ключ/);await c.saveView('ok',{sort:[]});assert.ok(db.views.ok);
 });
 const pass=results.filter(x=>x[1]==='PASS').length;
 console.log('SUMMARY',`${pass}/${results.length}`);if(pass!==results.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
