#!/usr/bin/env node
'use strict';
// Executes actual Test13 importer functions, with synthetic board data and mock storage/DOM.
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
if (process.argv.length !== 4) { console.error('Usage: node import_board_source_gate.js /exact/Test13/v224/base29.html /patched/v224/base29.html'); process.exit(2); }
const [src, dest] = process.argv.slice(2).map(x => fs.readFileSync(x, 'utf8'));
const names = {
  importBoardFile: 'async function downloadOffline()',
  whimImport: 'function openWhimImportOne()',
  whimImport2: '/* =========================================================\n   v1.9:',
  ntImport: 'function openNotionZip(file)'
};
function extract(s, name) {
  const start = s.indexOf('async function ' + name + '(');
  assert(start >= 0, 'missing real Test13 function ' + name);
  const tail = s.indexOf(names[name], start);
  assert(tail > start, 'missing function terminator ' + name);
  const frag = s.slice(start,tail).trim();
  assert(frag.endsWith('}'), 'unexpected function boundary for ' + name);
  return frag;
}
function fixture(s, name, opt={}) {
  const calls = {saved: [], loaded: [], toast: [], saveNow: 0, guard: 0, logs: [], ls: []};
  let generated = 0;
  const original = {id:'working', name:'My unsaved board', items:[{id:'draft',type:'text',text:'UNSAVED'}], assets:{}};
  const S = {board:original, index:[], sel:new Set(), fsmFrom:null};
  const getRows = text => text === 'main' ? [{id:'r1',type:'text',x:0,y:0,w:120,h:40,text:'Synthetic item',color:'White'}] : [];
  const LS = {
    get:k => opt.previous && k==='whimsrc' ? {'whim-id':'previous'} : {},
    set:(k,v)=>calls.ls.push([k,v])
  };
  const Backend = {
    async saveBoard(b) { calls.saved.push(b); if(opt.saveThrows)throw new Error('storage failed'); return opt.removed ? {removed:true} : undefined; },
    async loadBoard() { return null; }
  };
  const globals = {
    S,LS,Backend,Promise,Date,console:{error:()=>{}},Map,Set,Object,Math,Array,Number,String,RegExp,
    dirty:true,saving:false,saveAgain:false,
    canLeaveCurrentBoard:async()=>{calls.guard++;return (typeof opt.canLeave==='function' ? opt.canLeave(calls.guard) : (opt.canLeave ?? true));},
    saveNow:async()=>{calls.saveNow++; /* simulated failed save: dirty is deliberately left true */},
    finishEdit:()=>{},
    newBoard:name=>({id:'import-'+(++generated), name, items:[],assets:{}}),
    normalizeBoard:()=>{}, clone:x=>JSON.parse(JSON.stringify(x)),
    uid:()=>String(++generated),
    loadBoard:b=>{assert(b,'cannot load empty board');calls.loaded.push(b);S.board=b;},
    fitAll:()=>{},renderDrawer:()=>{},toast:m=>calls.toast.push(m),
    plural:()=>'',r1:x=>x,
    Drive:{mcp:{},},
    whimFetch:async q=>({text:q.select_kinds&&q.select_kinds.includes('text')?'main':q.detail==='detailed'&&!q.select_kinds?'main':'empty',title:'Source board',fileId:'whim-id',url:'https://example.invalid/board'}),
    whimFetchR:async()=>({text:'empty',fileId:'whim-id'}),
    parseWhim:text=>({rows:getRows(text), pal:{},conns:[]}),
    whimPlain:s=>String(s||''),WCOL:{},INK:'#222',tint:c=>c,whimTextItem:(r,X,Y)=>({id:'item-'+r.id,type:'text',x:X(r.x),y:Y(r.y),text:r.text}),
    WHIM_STOP:[],wfCatOf:()=>'',fidState:()=>({pct:100}),
    loLoad:async()=>{},loAll:()=>[],loImportRun:()=>{},LO_SYN:{},
    zipText:async()=> '# Synthetic page\n\nTest body',ntPage:()=>({title:'Synthetic page',props:{},body:'Test body'}),ntBase:s=>s,
    ntCell:s=>String(s),mkDoc:(x,y)=>({type:'doc',x,y}),
    docClean:s=>s,mdToDoc:s=>s,htmlToText:s=>s,
    stopZoom:()=>{},
    fileForTests:true
  };
  const context=vm.createContext(globals);
  vm.runInContext(extract(s,name),context,{filename:'Test13:'+name,timeout:3000});
  return {S,original,calls,Backend,run:args=>vm.runInContext(name,context)(...args)};
}
const tasks = {
  importBoardFile:{args:()=>[{name:'board.json',text:async()=>JSON.stringify({board:{name:'Imported',items:[]}})}]},
  whimImport:{args:f=>['https://example.invalid/board',m=>f.calls.logs.push(m)]},
  whimImport2:{args:f=>['whim-id',m=>f.calls.logs.push(m),{ov:{text:'main',title:'Imported board',fileId:'whim-id',url:'https://example.invalid/board'}}]},
  ntImport:{args:f=>[{dbs:[],pages:['a.md'],imgs:[],z:new Map([['a.md','']])},{pages:true},m=>f.calls.logs.push(m)]}
};
let passed=0;const results=[];
async function test(label, fn) {await fn();passed++;results.push(label);console.log('PASS '+label);}
async function callSafe(f,name) {try{return await f.run(tasks[name].args(f));}catch(e){return {error:e};}}
(async()=>{
  // Negative controls: these are the actual untouched source functions; failed save is swallowed.
  for(const name of Object.keys(tasks)) await test('original unsafe transition '+name,async()=>{
    const f=fixture(src,name,{canLeave:false});await callSafe(f,name);
    assert(f.calls.loaded.length>0,`Original ${name} unexpectedly blocked transition`);
    assert(f.S.board!==f.original);
  });
  for(const name of Object.keys(tasks)) await test('guard denial preserves board '+name,async()=>{
    const f=fixture(dest,name,{canLeave:false});await callSafe(f,name);
    assert.equal(f.calls.loaded.length,0);
    assert.equal(f.calls.saved.length,0);
    assert.strictEqual(f.S.board,f.original);
    assert.equal(f.calls.guard,1);
  });
  for(const name of Object.keys(tasks)) await test('normal successful import '+name,async()=>{
    const f=fixture(dest,name,{canLeave:true});const r=await callSafe(f,name);
    assert(!r?.error,r?.error?.stack||'error');
    assert.equal(f.calls.loaded.length,1);
    assert.equal(f.calls.saved.length,1);
    assert.notStrictEqual(f.S.board,f.original);
  });
  for(const name of Object.keys(tasks)) await test('removed response must not navigate '+name,async()=>{
    const f=fixture(dest,name,{canLeave:true,removed:true});await callSafe(f,name);
    assert.equal(f.calls.saved.length,1);
    assert.equal(f.calls.loaded.length,0);
    assert.strictEqual(f.S.board,f.original);
    if(name==='whimImport2')assert.equal(f.calls.ls.length,0,'must not update provenance after removed');
  });
  await test('file import post-write guard prevents concurrent edit loss',async()=>{
    const f=fixture(dest,'importBoardFile',{canLeave:n=>n===1});await callSafe(f,'importBoardFile');
    assert.equal(f.calls.saved.length,1);
    assert.equal(f.calls.loaded.length,0);
    assert.strictEqual(f.S.board,f.original);
    assert(f.calls.toast.some(t=>String(t).includes('осталась открытой')));
  });
  await test('Notion post-conversion denial keeps existing board',async()=>{
    const f=fixture(dest,'ntImport',{canLeave:n=>n===1});await callSafe(f,'ntImport');
    assert.equal(f.calls.saved.length,0);
    assert.equal(f.calls.loaded.length,0);
    assert.strictEqual(f.S.board,f.original);
  });
  await test('file import backend exception keeps original board',async()=>{
    const f=fixture(dest,'importBoardFile',{saveThrows:true});await callSafe(f,'importBoardFile');
    assert.equal(f.calls.loaded.length,0);
    assert.strictEqual(f.S.board,f.original);
  });
  await test('Whimsical reimport aborts without changing source map',async()=>{
    const f=fixture(dest,'whimImport2',{canLeave:false,previous:true});await callSafe(f,'whimImport2');
    assert.equal(f.calls.saved.length,0);
    assert.equal(f.calls.loaded.length,0);
    assert.equal(f.calls.ls.length,0);
  });
  console.log('TOTAL '+passed+'/'+passed+' PASS (real imported functions / synthetic state, not browser E2E)');
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1)});
