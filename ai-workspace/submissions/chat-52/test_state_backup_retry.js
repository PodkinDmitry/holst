// Exact-source MV3 state backup regression: executes the real background.js event handlers.
// node test_state_backup_retry.js /path/to/ext224/background.js
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync(process.argv[2], 'utf8');
const extract = (start, end) => {const a=src.indexOf(start), b=src.indexOf(end,a+start.length); if(a<0||b<=a)throw Error('Unexpected product source boundary '+start);return src.slice(a,b)};
const handlers = extract('let readyWaiters = [];','async function holstTab(open) {');
const alarm = src.split('\n').find(x=>x.includes("chrome.alarms && chrome.alarms.onAlarm.addListener"));
if(!alarm)throw Error('Expected alarm registration missing');
const keep = extract('const KEEP = [','async function restoreState() {');
const backup = extract(src.includes('/* Settings are backed up only after') ? '/* Settings are backed up only after' : 'let saveT = 0;', '/* v2.13: a request for the Холст page');
const copy = x => x===undefined ? undefined : JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r=>setImmediate(r));
const deferred = () => {let release;return {promise:new Promise(r=>release=r),release};};
function harness(initial={}, relayFn) {
  const state={values:copy(initial),calls:[],timers:new Map(),nextTimer:0,storageListener:null,runtimeListeners:[],alarmListeners:[]};
  const chrome={
    storage:{local:{
      get:async keys=>{await tick();if(keys===null)return copy(state.values);const obj={};for(const k of Array.isArray(keys)?keys:[keys])if(k in state.values)obj[k]=copy(state.values[k]);return obj;},
      set:async obj=>{await tick();const changed={};for(const [k,v] of Object.entries(obj)){changed[k]={newValue:copy(v),oldValue:copy(state.values[k])};state.values[k]=copy(v)}if(state.storageListener)state.storageListener(changed,'local')},
      remove:async key=>{await tick();const ks=Array.isArray(key)?key:[key];const changed={};for(const k of ks){changed[k]={oldValue:copy(state.values[k])};delete state.values[k]}if(state.storageListener)state.storageListener(changed,'local')}
    },onChanged:{addListener(fn){state.storageListener=fn;}}},
    runtime:{getManifest:()=>({version:'2.27.0'}),onMessage:{addListener(fn){state.runtimeListeners.push(fn);}}},
    alarms:{onAlarm:{addListener(fn){state.alarmListeners.push(fn);}}},
  };
  const relay=async (op, data, noOpen)=>{state.calls.push({op,data:copy(data),noOpen});return relayFn?relayFn(op,data):{ok:true};};
  const ctx={chrome,relay,Promise,Date,Object,console,setTimeout(fn,ms){const id=++state.nextTimer;state.timers.set(id,{fn,ms});return id;},clearTimeout(id){state.timers.delete(id);},
    flushQueue(){},restoreState(){},sysPull(){},ywFlush(){}};
  vm.createContext(ctx);
  vm.runInContext(keep+'\n'+handlers+'\n'+alarm+'\n'+backup,ctx,{filename:'ext224/background.js:state-backup'});
  async function settle(){for(let i=0;i<9;i++)await tick()}
  async function change(key,value){await chrome.storage.local.set({[key]:value});await settle()}
  async function fire(ms=Infinity){const timers=[...state.timers.entries()].filter(([,x])=>x.ms<=ms);for(const [id] of timers)state.timers.delete(id);for(const [,x] of timers)await x.fn();await settle()}
  async function reconnect(){assert(state.runtimeListeners.length,'extension listener missing');for(const fn of state.runtimeListeners)fn({op:'bridge-ready'}, {tab:{id:12}},()=>{});await fire(3600)}
  async function alarmTick(){for(const fn of state.alarmListeners)fn({name:'queue'});await settle()}
  return {state,change,fire,settle,reconnect,alarmTick,ctx};
}
const cases=[
  ['offline-edits-have-durable-pending-token',async()=>{
    const h=harness({},async()=>{throw Error('Holst closed')});await h.change('pres221',{local:1});await h.fire(1500);
    assert(h.state.values.stateBackupPending224,'offline state backup needs persistent retry marker');
  }],
  ['restore-after-worker-restart-delivers-pending-settings',async()=>{
    const h=harness({},async()=>{throw Error('offline')});await h.change('widgets',{task:{on:1}});await h.fire(1500);
    const next=harness(h.state.values,async()=>({ok:true}));await next.reconnect();
    assert.equal(next.state.calls.filter(x=>x.op==='state-set').length,1);
    assert.deepEqual(next.state.calls[0].data.widgets,{task:{on:1}});
    assert.equal(next.state.values.stateBackupPending224,undefined);
  }],
  ['negative-ack-cannot-discard-pending-backup',async()=>{
    const h=harness({},async()=>({ok:false}));await h.change('sites',{a:1});await h.fire(1500);
    assert(h.state.values.stateBackupPending224,'a non-ok acknowledgement must not clear pending sync');
    await h.alarmTick();assert(h.state.values.stateBackupPending224);
  }],
  ['successful-ack-clears-persisted-marker',async()=>{
    const h=harness();await h.change('pres221',{a:1});await h.fire(1500);
    assert.equal(h.state.values.stateBackupPending224,undefined);
    assert.equal(h.state.calls.filter(x=>x.op==='state-set').length,1);
  }],
  ['stale-ack-does-not-clear-newer-pending-change',async()=>{
    const gate=deferred(),arrived=deferred();let calls=0;
    const h=harness({},async()=>{calls++;if(calls===1){arrived.release();await gate.promise;}return {ok:true}});
    await h.change('pres221',{a:1});const old=h.fire(1500);await arrived.promise;
    await h.change('pres221',{a:2});gate.release();await old;await h.settle();await h.fire(1500);
    assert(calls>=2,'a newer change should be retried after old ACK');
    assert.deepEqual(h.state.calls.at(-1).data.pres221,{a:2});
    assert.equal(h.state.values.stateBackupPending224,undefined);
  }],
  ['alarm-retries-previously-failed-backup',async()=>{
    let online=false;const h=harness({},async()=>online?{ok:true}:{ok:false});await h.change('last',{x:1});await h.fire(1500);online=true;
    await h.alarmTick();assert.equal(h.state.calls.filter(x=>x.op==='state-set').length,2);
    assert.equal(h.state.values.stateBackupPending224,undefined);
  }],
  ['bridge-ready-retries-without-new-user-edits',async()=>{
    let online=false;const h=harness({},async()=>online?{ok:true}:{ok:false});await h.change('sites',{old:1});await h.fire(1500);online=true;
    await h.reconnect();assert.equal(h.state.calls.filter(x=>x.op==='state-set').length,2);
    assert.equal(h.state.values.stateBackupPending224,undefined);
  }],
  ['queue-only-change-not-a-state-backup',async()=>{
    const h=harness();await h.change('queue',[{id:'q'}]);await h.fire(1500);
    assert.equal(h.state.calls.length,0);assert.equal(h.state.values.stateBackupPending224,undefined);
  }],
  ['payload-preserves-KEEP-and-highlight-but-excludes-queue',async()=>{
    const h=harness({queue:[{id:1}],'hl:https://site':['text'],holstUrl:'https://my-holst/' });await h.change('pres221',{p:1});await h.fire(1500);
    const out=h.state.calls.at(-1).data;
    assert.deepEqual(out.hl['hl:https://site'],['text']);assert.deepEqual(out.pres221,{p:1});
    assert.equal(out.queue,undefined);assert.equal(out.stateBackupPending224,undefined);
    assert.equal(out.v,'2.27.0');
  }],
  ['clean-start-has-no-spurious-upload',async()=>{
    const h=harness({widgets:{w:1}});await h.alarmTick();await h.reconnect();await h.fire(1500);
    assert.equal(h.state.calls.length,0);
  }],
  ['two-offline-changes-eventually-sync-latest-value',async()=>{
    let online=false;const h=harness({},async()=>online?{ok:true}:{ok:false});await h.change('pres221',{version:1});await h.fire(1500);
    await h.change('pres221',{version:2});await h.fire(1500);online=true;await h.alarmTick();
    assert.deepEqual(h.state.calls.at(-1).data.pres221,{version:2});
    assert.equal(h.state.values.stateBackupPending224,undefined);
  }],
];
(async()=>{const results=[];for(const [name,fn] of cases){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',reason:String(e&&e.message||e).slice(0,230)});}}
 const passed=results.filter(r=>r.status==='PASS').length;console.log(JSON.stringify({passed,total:cases.length,results},null,2));process.exitCode=passed===results.length?0:1;})().catch(e=>{console.error(e);process.exitCode=2;});
