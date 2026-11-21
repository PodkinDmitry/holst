'use strict';
// Exercise the *actual* (unmodified) save scheduling source from private Test13.
// Only this gate is public: the product source is loaded from the local path.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = process.argv[2];
if (!path) throw new Error('Pass the PRIVATE v224/base29.html path');
const html = fs.readFileSync(path, 'utf8');
function snippet(start, end) {
  const a=html.indexOf(start), b=html.indexOf(end,a);
  if (a<0||b<0) throw Error('Test13 source anchors changed: '+start);
  return html.slice(a,b);
}
const code = [
  'let saveTimer = 0, dirty = false, saving = false, saveAgain = false;',
  snippet('function scheduleSave(quiet) {', 'function upsertIndex(b) {'),
  snippet('async function saveNow() {', 'const saveSettings =')
].join('\n');
let now=10000, nextId=1;
const jobs = new Map();
const timers={
  setTimeout:(fn,ms)=>{const id=nextId++;jobs.set(id,{at:now+ms,fn});return id;},
  clearTimeout:(id)=>{jobs.delete(id);},
};
let writes=0, status=[];
const board = {id:'synthetic',items:[],updatedAt:1};
const backend={saveBoard:async (b)=>{writes++;return {removed:false};},setLast:async ()=>{}};
const context=vm.createContext({S:{board}, Backend:backend, Db:{},Store:{mode:'idb'},
  ...timers,Date:class extends Date{static now(){return now;}},
  renderDrawer:()=>{},setStatus:s=>status.push(s), console });
vm.runInContext(code,context,{filename:'Test13-saveNow-source.js'});
async function tick(ms) {
  const end=now+ms;
  while (true){
    const order=[...jobs.entries()].sort((a,b)=>a[1].at-b[1].at);
    if(!order.length || order[0][1].at>end)break;
    const [id,job]=order[0];jobs.delete(id);now=job.at;
    job.fn();await Promise.resolve();await Promise.resolve();
  }
  now=end;
  await Promise.resolve();await Promise.resolve();
}
const results=[];
async function run(name,fn){await fn();results.push(name);console.log('PASS',name)}
(async()=>{
 await run('normal autosave delay is 450ms and updates timestamp',async()=>{
   const before=JSON.stringify(board);
   vm.runInContext('scheduleSave()',context);
   assert.equal(jobs.size,1);
   assert.equal([...jobs.values()][0].at-now,450);
   await tick(451);
   assert.notEqual(JSON.stringify(board),before);
   assert.equal(board.updatedAt,10450);
   assert.equal(writes,1);
 });
 await run('quiet autosave delay 900ms may race cache assertion',async()=>{
   const before=JSON.stringify(board);
   vm.runInContext('scheduleSave(true)',context);
   assert.equal([...jobs.values()][0].at-now,900);
   await tick(901);
   assert.notEqual(JSON.stringify(board),before);
   assert.equal(writes,2);
 });
 await run('idle period exceeding 900ms leaves state unchanged',async()=>{
   const before=JSON.stringify(board);
   await tick(1100);
   assert.equal(JSON.stringify(board),before);
 });
 await run('no product code or board contents changed by gate',async()=>{
   assert.equal(board.items.length,0);
   assert.equal(typeof board.updatedAt,'number');
   assert.equal(status.filter(s=>s==='saved').length,2);
 });
 console.log(`TOTAL ${results.length}/${results.length} PASS`);
})().catch(e=>{console.error(e);process.exitCode=1});
