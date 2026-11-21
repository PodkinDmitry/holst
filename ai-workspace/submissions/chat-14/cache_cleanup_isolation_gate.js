'use strict';
// Runs the unmodified healthPanel300 function from a private local XOD source tree
// in a synthetic DOM / CacheStorage harness. Source never leaves this process.
// This is a unit isolation test, not a browser or full application test.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const file = process.argv[2];
if (!file) { console.error('usage: node cache_cleanup_isolation_gate.js /path/to/v224/m_health300.js'); process.exit(2); }
const all = fs.readFileSync(file, 'utf8');
const a = all.indexOf('async function healthPanel300() {');
const b = all.indexOf('\n{ const previous = menuItems;',a);
if (a < 0 || b < a) throw Error('healthPanel300 contract not located');
const original = all.slice(a,b);

const board = {id:'synthetic-board',name:'Synthetic',updatedAt:100,items:[{id:'x',text:'KEEP',x:12}]};
const org = {groups:[{id:'synthetic',name:'Keep'}]};
const palette = [{name:'Keep',cols:['#123456']}];
const cacheData = new Map([
  ['holst-v34', new Map([['/old-shell','old']])],
  ['holst-v36', new Map([['/current','current']])],
  ['other-app', new Map([['/other','foreign']])],
]);
const cacheState={
  async keys(){return [...cacheData.keys()]},
  async has(k){return cacheData.has(k)},
  async open(k){
    if(!cacheData.has(k)) cacheData.set(k,new Map());
    const data=cacheData.get(k);
    return {keys:async()=>[...data.keys()],match:async req=>data.has(req)?{
      type:'basic',blob:async()=>({size:data.get(req).length})
    }:undefined};
  },
  async delete(k){return cacheData.delete(k)}
};
const body = {innerHTML:''};
const cachePanel = {hidden:true,textContent:'',innerHTML:''};
let handler;
const panel = {querySelector(sel){return sel === '.health300' ? body : cachePanel},addEventListener(type, cb){assert.equal(type,'click');handler=cb;}};
const app = {
  caches:cacheState,
  navigator:{onLine:true,storage:{estimate:async()=>({quota:100000,usage:100})}},
  xdlg:()=>panel,
  S:{board,index:[{id:'synthetic-board',updatedAt:100}],org},
  els:new Map([['x',{}]]),items:()=>board.items,
  Backend: {name:'Local'},Local:{name:'Local'},Db:{name:'Db'},
  Store:{mode:'idb'},Drive:{state:'off',lastSync:null},Backup:{state:'off',last:null,dir:null},
  esc:x=>String(x).replaceAll('<','&lt;'),toast:()=>{},
  Date,Promise,console,Set,Map
};
app.Backend=app.Local;
const context=vm.createContext(app);
vm.runInContext(original,context,{filename:'m_health300.js'});
async function click(action){
  await handler({target:{closest(){return {dataset:{health:action}}}}});
}
const tests=[];
function test(label,fn){tests.push([label,fn]);}
const baseline=JSON.stringify([board,org,palette]);

// A click must not mutate board/org/palette; reads may legitimately touch UI only.
test('open storage diagnostics preserves data',async()=>{
  await vm.runInContext('healthPanel300()',context);
  assert.match(body.innerHTML,/IndexedDB/);
  assert.equal(JSON.stringify([board,org,palette]),baseline);
});
test('scan old caches only and preserve board state',async()=>{
  await click('cache');
  assert.match(cachePanel.innerHTML,/holst-v34/);
  assert.doesNotMatch(cachePanel.innerHTML,/holst-v36/);
  assert.equal(await cacheState.has('holst-v34'),true);
  assert.equal(JSON.stringify([board,org,palette]),baseline);
});
test('delete old cache leaves active and foreign caches intact',async()=>{
  await click('delete-cache');
  assert.equal(await cacheState.has('holst-v34'),false);
  assert.equal(await cacheState.has('holst-v36'),true);
  assert.equal(await cacheState.has('other-app'),true);
  assert.equal(JSON.stringify([board,org,palette]),baseline);
});
test('repeat scan and delete is idempotent, state unchanged',async()=>{
  await click('cache');
  await click('delete-cache');
  assert.equal(JSON.stringify([board,org,palette]),baseline);
});
// Independent pending save can mutate updatedAt during the asynchronous cache scan.
test('simulated concurrent save produces the same strict-snapshot mismatch',async()=>{
  const before=JSON.stringify([board,org,palette]);
  await click('cache');
  // Simulated saveNow() from the real app: it writes board.updatedAt independently.
  board.updatedAt=Date.now();
  await click('delete-cache');
  const after=JSON.stringify([board,org,palette]);
  assert.notEqual(before,after);
  assert.deepEqual(JSON.parse(after)[0].items,JSON.parse(before)[0].items);
});

(async()=>{
  for(const [name,fn] of tests){
    await fn();
    console.log('PASS '+name);
  }
  console.log(`PASS ${tests.length}/${tests.length} isolated cache-state checks`);
})().catch(e=>{console.error(e);process.exitCode=1;});
