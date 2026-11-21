'use strict';
const assert = require('node:assert/strict');
const makeCoordinator = require('./xod-cas-view-coordinator.js');
const copy = x => JSON.parse(JSON.stringify(x));
const pause = () => new Promise(resolve => setImmediate(resolve));
const tests = [];
function test(name, fn) { tests.push({name, fn}); }
function memory(initial = {views:{},presets:[]}, options={}) {
 let doc=copy(initial), revision=0, casRejected=0, writes=0, reads=0;
 return {
   get doc() {return copy(doc)}, get revision() {return revision},
   get collisions() {return casRejected}, get writes() {return writes},get reads(){return reads},
   read:async () => {reads++; await pause();return {revision,data:copy(doc)}},
   compareAndSwap:async (expected, next) => {
     await pause();
     if(options.alwaysReject || expected!==revision){casRejected++;return {ok:false}}
     doc=copy(next);revision++;writes++;return {ok:true};
   }
 };
}
const options=(group='none',filter=null)=>({filter,sort:[],group:{key:group,dir:'asc'}});

test('01: две независимые вкладки, разные scope, нет lost-update', async()=>{
 const db=memory();const a=makeCoordinator(db),b=makeCoordinator(db);
 const [ea,eb]=await Promise.all([a.openView('main'),b.openView('sidebar')]);
 await Promise.all([ea.onSaveView(options('category')),eb.onSaveView(options('watched'))]);
 assert.equal(db.doc.views.main.group.key,'category');
 assert.equal(db.doc.views.sidebar.group.key,'watched');
 assert.equal(db.doc.viewRevisions.main,1);assert.equal(db.doc.viewRevisions.sidebar,1);
 assert.ok(db.collisions>=1,'must actually hit and retry CAS contention');
});

test('02: один scope: stale редактор блокируется вместо silent overwrite', async()=>{
 const db=memory();const a=await makeCoordinator(db).openView('main');
 const b=await makeCoordinator(db).openView('main');
 await a.onSaveView(options('category'));
 await assert.rejects(b.onSaveView(options('watched')),e=>e.code==='XOD_VIEW_CONFLICT'&&e.expectedRevision===0&&e.actualRevision===1);
 assert.equal(db.doc.views.main.group.key,'category');assert.equal(db.doc.viewRevisions.main,1);
});

test('03: явный reload и выбранная пользователем версия позволяют сохранить', async()=>{
 const db=memory();const a=await makeCoordinator(db).openView('main');const b=await makeCoordinator(db).openView('main');
 await a.onSaveView(options('category'));
 await assert.rejects(b.onSaveView(options('watched')),{code:'XOD_VIEW_CONFLICT'});
 const updated=await b.reload();assert.equal(updated.view.group.key,'category');assert.equal(updated.revision,1);
 await b.onSaveView(options('watched'));assert.equal(db.doc.views.main.group.key,'watched');assert.equal(db.doc.viewRevisions.main,2);
});

test('04: одна поверхность — порядок пользовательских сохранений и ревизии', async()=>{
 const db=memory();const a=await makeCoordinator(db).openView('main');
 const p=a.onSaveView(options('category'));const q=a.onSaveView(options('watched'));
 await Promise.all([p,q]);assert.equal(db.doc.views.main.group.key,'watched');assert.equal(db.doc.viewRevisions.main,2);
});

test('05: presets и view одновременно не перетирают друг друга', async()=>{
 const db=memory({views:{},presets:[{id:'old'}]});const a=makeCoordinator(db),b=makeCoordinator(db),editor=await a.openView('main');
 await Promise.all([editor.onSaveView(options('category')),b.transaction(d=>{d.presets.push({id:'next'})})]);
 assert.deepEqual(db.doc.presets,[{id:'old'},{id:'next'}]);assert.equal(db.doc.views.main.group.key,'category');
});

test('06: ограничение количества CAS retries даёт объяснимую ошибку',async()=>{
 const db=memory({}, {alwaysReject:true});const a=makeCoordinator({...db,maxAttempts:3});
 await assert.rejects(a.transaction(d=>{d.flag=true}),{code:'XOD_CAS_RETRY_LIMIT'});
 assert.equal(db.collisions,3);assert.equal(db.writes,0);
});

test('07: исключение CAS с неопределённым исходом не повторяет запись',async()=>{
 const db=memory();let attempts=0;
 const api={read:db.read,compareAndSwap:async()=>{attempts++;throw Error('connection reset')}};
 await assert.rejects(makeCoordinator(api).transaction(d=>{d.flag=true}),/connection reset/);
 assert.equal(attempts,1);assert.equal(db.writes,0);
});

test('08: неверный формат ответа CAS запрещает автоматический повтор',async()=>{
 const db=memory();let attempts=0;
 await assert.rejects(makeCoordinator({read:db.read,compareAndSwap:async()=>{attempts++;return null}}).transaction(d=>{d.flag=true}),{code:'XOD_UNKNOWN_COMMIT'});
 assert.equal(attempts,1);
});

test('09: существующая испорченная ревизия не перезаписывается',async()=>{
 const db=memory({views:{main:{sort:[]}},viewRevisions:{main:'BAD'}});
 await assert.rejects(makeCoordinator(db).openView('main'),{code:'XOD_BAD_STORE'});
 assert.equal(db.writes,0);
});

test('10: специальный scope __proto__ безопасен',async()=>{
 const db=memory();const a=await makeCoordinator(db).openView('__proto__');
 await a.onSaveView(options('category'));
 assert.equal(Object.prototype.hasOwnProperty.call(db.doc.views,'__proto__'),true);
 assert.equal(db.doc.views.__proto__.group.key,'category');
 assert.equal({}.group,undefined);
});

test('11: отправленный view не мутируется после вызова',async()=>{
 const db=memory();const a=await makeCoordinator(db).openView('main');const v=options('category');
 const task=a.onSaveView(v);v.group.key='watched';await task;
 assert.equal(db.doc.views.main.group.key,'category');
});

test('12: dispose не отправляет ещё не начатые задания',async()=>{
 const db=memory();const a=await makeCoordinator(db).openView('main');
 const task=a.onSaveView(options('category'));a.dispose();
 await assert.rejects(task,{code:'XOD_VIEW_CLOSED'});assert.equal(db.writes,0);
});

test('13: sync mutator обязателен для безопасного CAS retry',async()=>{
 const db=memory();const a=makeCoordinator(db);
 await assert.rejects(a.transaction(async d=>{d.flag=true}),/синхронным/);assert.equal(db.writes,0);
});

test('14: совместимость наследованного вида без метаданных ревизии',async()=>{
 const db=memory({views:{main:{filter:null,sort:[{key:'category',dir:'asc'}]}},presets:[]});
 const a=await makeCoordinator(db).openView('main');assert.deepEqual(a.view.sort,[{key:'category',dir:'asc'}]);assert.equal(a.revision,0);
 await a.onSaveView(options('watched'));assert.equal(db.doc.viewRevisions.main,1);
});

(async()=>{let passed=0;
 for(const t of tests){try{await t.fn();passed++;console.log('PASS',t.name)}catch(e){console.error('FAIL',t.name,e.stack);process.exitCode=1}}
 console.log(`RESULT ${passed}/${tests.length} ${passed===tests.length?'PASS':'FAIL'}`);
})().catch(e=>{console.error(e.stack);process.exitCode=1});
