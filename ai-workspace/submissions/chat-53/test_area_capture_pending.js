// Execute actual ext224/background.js area-start, area-done, and page-area handler.
// node test_area_capture_pending.js /path/to/ext224/background.js
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2],'utf8');
const begin=source.indexOf('/* ---------- a snapshot of an area: the page lets you draw a rectangle ---------- */');
const end=source.indexOf('/* ---------- right click ---------- */',begin);
const entry=source.split('\n').find(x=>x.includes("if (id === 'page-area')"));
if(begin<0||end<=begin||!entry)throw new Error('Unexpected source shape: area functions/page-area handler');
const implementation=source.slice(begin,end)+'\nasync function openArea(tab,base){const id="page-area";'+entry+'}\nglobalThis.api={openArea,areaDone};';
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let release;return{promise:new Promise(r=>release=r),release};};
const rect={scroll:1,el:false,x:2,w:120,y0:0,h:120};
const tab=id=>({id,windowId:100+id,url:'https://site'+id+'.example/',title:'Tab '+id});
function harness(options={}) {
 const state={values:clone(options.initial||{}),clips:[],marks:[],scripts:[],captures:[],removeKeys:[]};
 const chrome={storage:{local:{
   get:async keys=>{await tick();const out={};for(const k of Array.isArray(keys)?keys:[keys])if(k in state.values)out[k]=clone(state.values[k]);return out;},
   set:async obj=>{await tick();Object.assign(state.values,clone(obj));},
   remove:async k=>{await tick();for(const key of Array.isArray(k)?k:[k]){state.removeKeys.push(key);delete state.values[key];}}
 }},scripting:{executeScript:async x=>{await tick();state.scripts.push(clone(x));}},tabs:{captureVisibleTab:async id=>{if(options.captureFail)throw Error('capture failed');state.captures.push(id);return 'data:image/png;base64,AAAA';}}};
 const mark=(id,r)=>state.marks.push({id,r:clone(r)});
 const clip=async d=>{state.clips.push(clone(d));return options.clip?options.clip(d):{ok:true}};
 const stitch221=async(...x)=>{if(options.stitchFail)throw Error('stitch failed');return 'data:image/jpeg;base64,AAAA';};
 const ctx={chrome,mark,clip,stitch221,Date,Math,Promise,JSON,Object,fetch:async()=>({blob:async()=>new Uint8Array(8)}),createImageBitmap:async()=>({width:300,height:300}),OffscreenCanvas:class{constructor(){this.canvas={}}getContext(){return{drawImage(){}}}async convertToBlob(){return{arrayBuffer:async()=>new Uint8Array(8).buffer}}},Uint8Array,String,btoa:()=>''};
 vm.createContext(ctx);vm.runInContext(implementation,ctx,{filename:'ext224/background.js/area'});
 const open=async(id,extra={})=>ctx.api.openArea(tab(id),{title:extra.title||'Tab '+id,url:extra.url||'https://site'+id+'.example/',other:extra.other||null});
 const finish=(id,r=rect)=>ctx.api.areaDone(r,tab(id));
 return{state,open,finish,ctx};
}
const cases=[
 ['two-tabs-store-distinct-pending-intents',async()=>{
  const h=harness();await Promise.all([h.open(1),h.open(2)]);
  assert.equal(h.state.values['pendingArea:1'].url,tab(1).url);assert.equal(h.state.values['pendingArea:2'].url,tab(2).url);
 }],
 ['capture-uses-its-own-tab-not-last-active-tab',async()=>{
  const h=harness();await h.open(1);await h.open(2);await h.finish(1);
  assert.equal(h.state.clips[0].url,tab(1).url);assert(h.state.values['pendingArea:2']);
 }],
 ['stitch-error-preserves-pending-intent',async()=>{
  const h=harness({stitchFail:true});await h.open(1);await assert.rejects(h.finish(1),/stitch failed/);
  assert.equal(h.state.values['pendingArea:1'].url,tab(1).url);
 }],
 ['clip-rejection-preserves-pending-intent',async()=>{
  const h=harness({clip:async()=>{throw Error('storage full')}});await h.open(1);await assert.rejects(h.finish(1),/storage full/);
  assert(h.state.values['pendingArea:1']);
 }],
 ['non-ok-clip-keeps-intent-for-retry',async()=>{
  const h=harness({clip:async()=>({ok:false})});await h.open(1);const x=await h.finish(1);
  assert.equal(x.ok,false);assert(h.state.values['pendingArea:1']);
 }],
 ['durably-queued-success-clears-only-own-tab',async()=>{
  const h=harness({clip:async()=>({ok:true,queued:true})});await h.open(1);await h.open(2);
  const r=await h.finish(1);assert.equal(r.queued,true);assert.equal(h.state.values['pendingArea:1'],undefined);assert(h.state.values['pendingArea:2']);
 }],
 ['late-first-result-does-not-clear-newer-same-tab-intent',async()=>{
  const gate=deferred(),entered=deferred();let count=0;
  const h=harness({clip:async()=>{count++;if(count===1){entered.release();await gate.promise;}return{ok:true}}});
  await h.open(1,{title:'original'});const first=h.finish(1);await entered.promise;
  await h.open(1,{title:'new'});gate.release();await first;
  assert.equal(h.state.values['pendingArea:1'].title,'new');
 }],
 ['escape-cancels-only-originating-tab',async()=>{
  const h=harness();await h.open(1);await h.open(2);const r=await h.finish(1,null);
  assert.equal(r.ok,false);assert.equal(h.state.values['pendingArea:1'],undefined);assert(h.state.values['pendingArea:2']);
 }],
 ['success-never-exports-private-intent-id',async()=>{
  const h=harness();await h.open(1);await h.finish(1);
  assert.equal(h.state.clips[0].__areaRequestId,undefined);
 }],
 ['legacy-single-pending-remains-supported',async()=>{
  const h=harness({initial:{pending:{url:'https://legacy.example',title:'old'}}});await h.finish(2);
  assert.equal(h.state.clips[0].url,'https://legacy.example');assert.equal(h.state.values.pending,undefined);
 }],
 ['missing-pending-returns-failure-without-clipping',async()=>{
  const h=harness();const x=await h.finish(1);assert.equal(x.ok,false);assert.equal(h.state.clips.length,0);
 }],
 ['normal-screenshot-marks-saved-and-clears-own-intent',async()=>{
  const h=harness();await h.open(1);await h.open(2);
  const r=await h.finish(1,{x:4,y:5,w:100,h:110,dpr:1});
  assert.equal(r.ok,true);assert.equal(h.state.captures[0],tab(1).windowId);
  assert(h.state.clips[0].image.startsWith('data:image/jpeg;base64,'));
  assert.equal(h.state.values['pendingArea:1'],undefined);assert(h.state.values['pendingArea:2']);
 }],
 ['failed-regular-screenshot-preserves-pending',async()=>{
  const h=harness({captureFail:true});await h.open(1);
  await assert.rejects(h.finish(1,{x:0,y:0,w:100,h:100}),/capture failed/);
  assert(h.state.values['pendingArea:1']);
 }],
 ['new-request-has-distinct-id-even-with-same-metadata',async()=>{
  const h=harness();await h.open(1);const old=h.state.values['pendingArea:1'].__areaRequestId;
  await h.open(1);assert.notEqual(h.state.values['pendingArea:1'].__areaRequestId,old);
 }],
];
(async()=>{const results=[];for(const [name,fn] of cases){try{await fn();results.push({name,status:'PASS'})}catch(e){results.push({name,status:'FAIL',error:String(e&&e.message||e).slice(0,200)})}}
 const passed=results.filter(x=>x.status==='PASS').length;
 console.log(JSON.stringify({passed,total:results.length,results},null,2));process.exitCode=passed===results.length?0:1;
})().catch(e=>{console.error(e);process.exitCode=2});
