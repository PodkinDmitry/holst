// VM regression against the real restoreState() source in ext224/background.js.
// Usage: node test_restore_state_race.js /path/to/ext224/background.js
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
const a = source.indexOf('const KEEP = [');
const b = source.indexOf('let saveT = 0;', a);
if (a < 0 || b <= a) throw new Error('Source shape changed: restoreState boundary missing');
const realSource = source.slice(a, b);
const copy = obj => obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let release; return {promise:new Promise(resolve => release=resolve), release};};
function harness(local={}, remote={ok:true,data:{}}, options={}) {
  const state={values:copy(local), writes:[], relayCalls:0};
  const storage={
    get:async keys=>{
      await tick();
      if(keys===null)return copy(state.values);
      const out={};
      for(const k of Array.isArray(keys)?keys:[keys])if(Object.prototype.hasOwnProperty.call(state.values,k))out[k]=copy(state.values[k]);
      return out;
    },
    set:async values=>{ await tick();state.writes.push(copy(values));Object.assign(state.values,copy(values)); }
  };
  const chrome={storage:{local:storage},tabs:{query:async()=>[],sendMessage:async()=>{}}};
  const relay=async()=>{state.relayCalls++;if(options.relay)return options.relay();return copy(remote)};
  const context={chrome,relay,Promise,Object};
  vm.createContext(context);
  vm.runInContext(realSource+'\nglobalThis.restoreTest = restoreState;',context,{filename:'background.js:restoreState'});
  return {restore:context.restoreTest,state};
}
const cases=[
  ['existing-highlights-win-over-remote',async()=>{
    const x=harness({'hl:page':['new']},{ok:true,data:{hl:{'hl:page':['old']}}});
    await x.restore();assert.deepEqual(x.state.values['hl:page'],['new']);
  }],
  ['highlight-created-while-fetch-in-flight-survives',async()=>{
    const wait=deferred(),started=deferred();
    const backup={ok:true,data:{hl:{'hl:page':['old']}}};
    const x=harness({},{},{relay:async()=>{started.release();await wait.promise;return backup;}});
    const task=x.restore();await started.promise;x.state.values['hl:page']=['new'];wait.release();await task;
    assert.deepEqual(x.state.values['hl:page'],['new']);
  }],
  ['keep-setting-changed-while-fetch-in-flight-survives',async()=>{
    const wait=deferred(),started=deferred();
    const backup={ok:true,data:{pres221:{remote:1}}};
    const x=harness({},{},{relay:async()=>{started.release();await wait.promise;return backup;}});
    const task=x.restore();await started.promise;x.state.values.pres221={local:2};wait.release();await task;
    assert.deepEqual(x.state.values.pres221,{local:2});
  }],
  ['remote-non-highlight-key-is-ignored',async()=>{
    const x=harness({queue:[{d:{id:'safe'}}]}, {ok:true,data:{hl:{queue:[],restored217:0,'hl:valid':['v']}}});
    await x.restore();assert.deepEqual(x.state.values.queue,[{d:{id:'safe'}}]);assert.equal(x.state.values.restored217,1);
    assert.deepEqual(x.state.values['hl:valid'],['v']);
  }],
  ['restored-during-inflight-does-not-reinstall-settings',async()=>{
    const wait=deferred(),started=deferred();
    const backup={ok:true,data:{widgets:{remote:{on:1}},hl:{'hl:a':['old']}}};
    const x=harness({},{},{relay:async()=>{started.release();await wait.promise;return backup;}});
    const task=x.restore();await started.promise;x.state.values.widgets={local:{on:1}};x.state.values.restored217=1;wait.release();await task;
    assert.deepEqual(x.state.values.widgets,{local:{on:1}});assert.equal(x.state.values['hl:a'],undefined);
  }],
  ['existing-empty-highlight-is-still-owned-locally',async()=>{
    const x=harness({'hl:a':[]},{ok:true,data:{hl:{'hl:a':['remote']}}});await x.restore();assert.deepEqual(x.state.values['hl:a'],[]);
  }],
  ['remote-highlights-restored-when-missing',async()=>{
    const x=harness({}, {ok:true,data:{hl:{'hl:a':['remote'], 'hl:b':['remote2']}}});await x.restore();
    assert.deepEqual(x.state.values['hl:a'],['remote']);assert.deepEqual(x.state.values['hl:b'],['remote2']);
  }],
  ['existing-settings-win-while-other-settings-restored',async()=>{
    const x=harness({ytPick:{local:1}}, {ok:true,data:{ytPick:{remote:1},sites:{example:2}}});await x.restore();
    assert.deepEqual(x.state.values.ytPick,{local:1});assert.deepEqual(x.state.values.sites,{example:2});
  }],
  ['already-restored-widgets-skips-remote-call',async()=>{
    const x=harness({restored217:1,widgets:{local:{on:1}}}, {ok:true,data:{hl:{'hl:a':['old']}}});await x.restore();
    assert.equal(x.state.relayCalls,0);assert.equal(x.state.writes.length,0);
  }],
  ['offline-relay-does-not-overwrite-local',async()=>{
    const x=harness({'hl:a':['new']}, {}, {relay:async()=>{throw Error('offline')}});await x.restore();
    assert.deepEqual(x.state.values['hl:a'],['new']);assert.equal(x.state.writes.length,0);
  }],
  ['response-without-state-does-not-restore-fake-values',async()=>{
    const x=harness({widgets:{local:{on:1}}}, {ok:false,data:null});await x.restore();await tick();await tick();
    assert.deepEqual(x.state.values.widgets,{local:{on:1}});assert.equal(x.state.values.restored217,1);
  }],
];
(async()=>{const result=[];for(const [name,fn] of cases){try{await fn();result.push({name,status:'PASS'})}catch(e){result.push({name,status:'FAIL',message:String(e&&e.message||e).slice(0,190)})}}
const passed=result.filter(x=>x.status==='PASS').length;console.log(JSON.stringify({passed,total:cases.length,results:result},null,2));process.exitCode=passed===cases.length?0:1;})().catch(e=>{console.error(e);process.exitCode=2});
