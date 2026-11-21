#!/usr/bin/env node
'use strict';
// Executes the real Split handlers extracted from private Test 13; only synthetic board state is used.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
if(process.argv.length!==4){console.error('Usage: node split_source_gate.js ORIGINAL/base29.html PATCHED/base29.html');process.exit(2)}
const [original,patched]=process.argv.slice(2).map(p=>fs.readFileSync(p,'utf8'));
function extractFunction(s,name){
 const m=new RegExp('\\b(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(s);assert(m,'Missing '+name);
 const start=m.index;let i=s.indexOf('{',m.index+m[0].length),depth=0,quote=null,escape=false,lineComment=false,blockComment=false;
 // All extracted functions deliberately avoid template interpolation; use lexical brace counting.
 for(;i<s.length;i++){
  let ch=s[i],next=s[i+1];
  if(lineComment){if(ch==='\n')lineComment=false;continue}
  if(blockComment){if(ch==='*'&&next==='/'){i++;blockComment=false;}continue}
  if(quote){if(escape){escape=false;continue}if(ch==='\\'){escape=true;continue}if(ch===quote){quote=null;}continue}
  if(ch==='/'&&next==='/'){i++;lineComment=true;continue}
  if(ch==='/'&&next==='*'){i++;blockComment=true;continue}
  if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue}
  if(ch==='{')depth++;if(ch==='}'&&!--depth)return s.slice(start,i+1);
 }
 throw new Error('Unclosed '+name);
}
// Function-extraction guard includes a source anchor, so tests cannot silently run surrogate algorithms.
for(const source of [original,patched])for(const fn of ['enterSplit','exitSplit','closePane'])extractFunction(source,fn);
const DECL=patched.slice(patched.indexOf('let splitChangeBusy = false;'),patched.indexOf('function splitReleasePrepared(prepared) {'));
assert(DECL.includes("m.holst !== 'split-save'"),'Pane protocol missing');
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS',name)}
function makeParent(source, options={}){
 const old=source===original;
 const boards=options.boards||['A','B'];
 const split={layout:options.layout||'2v',boards:[...boards],cols:[1,1],rows:[1]};
 let seq=0, saveStatus=options.saveStatus||(()=>true);
 const events=new Map(), ls=[], messages=[], toasted=[], loaded=[], commands=[];
 const win={addEventListener(type,cb){const a=events.get(type)||[];a.push(cb);events.set(type,a);},removeEventListener(type,cb){events.set(type,(events.get(type)||[]).filter(x=>x!==cb));},emit(type,event){for(const cb of [...(events.get(type)||[])])cb(event)},focus(){}};
 const frames=split.boards.map((bid,i)=>{
  const child={postMessage(m){messages.push({i, ...m});if(m.action==='prepare'){
    const decision=typeof saveStatus==='function'?saveStatus(i,bid,m):saveStatus[i];
    if(decision==='silent')return;
    const ok=decision===true;
    const respond=()=>win.emit('message',{source:child,data:{holst:'split-save-ack',id:m.id,i,bid,ok}});
    if(options.delay) setTimeout(respond,options.delay);else queueMicrotask(respond);
  }}};
  return {querySelector(sel){assert.equal(sel,'iframe');return {contentWindow:child}},firstChild:{contentWindow:child}};
 });
 const grid={_cells:frames,set innerHTML(x){commands.push('clear-grid');this._cells=[];},get innerHTML(){return ''}};
 const splitElement={hidden:false},drawer={hidden:false};
 const S={split,board:{id:'A',items:[]},index:[{id:'A',updatedAt:2},{id:'B',updatedAt:1}]};
 const el={splitGrid:grid,split:splitElement};
 const $=id=>el[id.replace(/^#/,'')]||{};
 const ctx={S,$,window:win,document:{body:{classList:{remove(c){commands.push('remove-'+c)},add(){}}}},
   LS:{set(k,v){ls.push([k,v])}},dirty:!!options.dirty,saving:false,saveAgain:false,
   Local:{async loadBoard(id){commands.push('load-'+id);return options.missing?null:{id,name:id,items:[]}}},
   Backend:{},SPLITS:{'2v':{cells:[1,2],cols:2,rows:1},'3v':{cells:[1,2,3],cols:3,rows:1},'2h':{cells:[1,2],cols:1,rows:2}},
   splitOk:()=>true,saveNow:async()=>{commands.push('save-failed')},canLeaveCurrentBoard:async()=>options.parentOk!==false,
   finishEdit(){commands.push('finish-edit')},closePop(){},toast:m=>toasted.push(m),
   drawer,showSplit(){commands.push('show-split')},renderSplit(){commands.push('render-split')},
   loadBoard(b){loaded.push(b.id);commands.push('opened-'+b.id)},uid:()=> 'req-'+ ++seq,
   innerWidth:1024,innerHeight:768,location:{pathname:'/index.html'},setTimeout:(fn,ms)=>setTimeout(fn,ms===10000? (options.shortTimeout||15):ms),clearTimeout,
   Promise,Set,Map,Array,Object,Number,console};
 vm.createContext(ctx);
 let code=old?'':`let splitChangeBusy=false;\n${extractFunction(source,'splitReleasePrepared')}\n${extractFunction(source,'splitPreparePanes')}\n`;
 for(const name of ['enterSplit','exitSplit','closePane'])code+=extractFunction(source,name)+'\n';
 vm.runInContext(code,ctx,{timeout:1000});
 return {...ctx,grid,frames,ls,messages,toasted,loaded,commands,split,events,call:name=>ctx[name]};
}
function makePane(opts={}){
 const winEvents=new Map(), replies=[], blocked=[];
 const parent={postMessage(m){replies.push(m)}};
 const win={parent,addEventListener(type,cb){const a=winEvents.get(type)||[];a.push(cb);winEvents.set(type,a)},emit(type,data,source=parent){const ev={data,source,preventDefault(){blocked.push('prevent')},stopImmediatePropagation(){blocked.push('stop')}};return Promise.all((winEvents.get(type)||[]).map(fn=>fn(ev)))}};
 const state={id:opts.board||'A'};
 const ctx={PANE:true,window:win,QS:{get:()=>String(opts.i??0)},S:{board:state},dirty:!!opts.dirty,saving:false,saveAgain:false,
  finishEdit(){},async canLeaveCurrentBoard(){if(opts.delay)await new Promise(r=>setTimeout(r,opts.delay));if(opts.ok!==false){ctx.dirty=false;return true}return false},
  setTimeout:(fn,ms)=>setTimeout(fn,ms===15000?50:ms)};
 vm.createContext(ctx);vm.runInContext(DECL,ctx,{timeout:1000});
 return {...ctx,replies,blocked,send:(action,id='r',bid=state.id)=>win.emit('message',{holst:'split-save',action,id,bid}),events:winEvents};
}
(async()=>{
 await test('original negative: exit destroys dirty pane before confirmation',async()=>{const h=makeParent(original,{dirty:true,saveStatus:()=>false});await h.exitSplit('B');await new Promise(r=>setTimeout(r,3));assert.equal(h.S.split,null);assert(h.commands.includes('clear-grid'),JSON.stringify(h.commands));});
 await test('original negative: close recreates all dirty panes',async()=>{const h=makeParent(original,{boards:['A','B','C'],layout:'3v',saveStatus:()=>false});await h.closePane(0);assert(h.commands.includes('clear-grid'));assert.equal(h.S.split.boards.length,2)});
 await test('original negative: enter allows failed save',async()=>{const h=makeParent(original,{dirty:true});h.saveNow=async()=>{h.commands.push('save-failed')};h.S.split=null;await h.enterSplit('2v');assert(h.commands.includes('show-split'));});
 await test('patched exit refuses any pane rejection',async()=>{const h=makeParent(patched,{saveStatus:i=>i!==1});await h.exitSplit('B');assert.equal(h.S.split,h.split);assert(!h.commands.includes('clear-grid'));assert.equal(h.ls.length,0);assert(h.messages.some(m=>m.action==='cancel'));});
 await test('patched close refuses any pane rejection',async()=>{const h=makeParent(patched,{boards:['A','B','C'],layout:'3v',saveStatus:i=>i!==2});await h.closePane(0);assert.equal(h.S.split,h.split);assert(!h.commands.includes('clear-grid'));});
 await test('patched relayout refuses any pane rejection',async()=>{const h=makeParent(patched,{saveStatus:()=>false});await h.enterSplit('2h');assert.equal(h.S.split,h.split);assert(!h.commands.includes('show-split'));});
 await test('patched exit refuses absent pane ack',async()=>{const h=makeParent(patched,{saveStatus:i=>i===0||'silent'});await h.exitSplit('A');assert.equal(h.S.split,h.split);assert(!h.commands.includes('clear-grid'));});
 await test('patched exit refuses vanished destination board',async()=>{const h=makeParent(patched,{missing:true});await h.exitSplit('B');assert.equal(h.S.split,h.split);assert(!h.commands.includes('clear-grid'));});
 await test('patched exit refuses parent pending write',async()=>{const h=makeParent(patched,{parentOk:false});await h.exitSplit('B');assert.equal(h.messages.filter(m=>m.action==='prepare').length,0);});
 await test('patched enter refuses parent failed save',async()=>{const h=makeParent(patched,{parentOk:false});h.S.split=null;await h.enterSplit('2v');assert(!h.commands.includes('show-split'));});
 await test('patched exit saves all panes before removal and loads target',async()=>{const h=makeParent(patched,{});await h.exitSplit('B');assert(h.messages.filter(m=>m.action==='prepare').length===2);assert(h.commands.includes('clear-grid'));assert(h.commands.indexOf('load-B')<h.commands.indexOf('clear-grid'));assert.equal(h.loaded[0],'B');assert.equal(h.S.split,null);});
 await test('patched relayout saves all panes before state update',async()=>{const h=makeParent(patched,{});await h.enterSplit('2h');assert.equal(h.S.split.layout,'2h');assert(h.messages.filter(m=>m.action==='prepare').length===2);});
 await test('patched close saves all panes before recreate',async()=>{const h=makeParent(patched,{boards:['A','B','C'],layout:'3v'});await h.closePane(0);assert.deepEqual([...h.S.split.boards],['B','C']);assert(h.commands.includes('render-split'));});
 await test('patched second concurrent exit is ignored',async()=>{const h=makeParent(patched,{delay:5});const first=h.exitSplit('A');await h.exitSplit('B');await first;assert.equal(h.loaded.length,1);assert.equal(h.loaded[0],'A');});
 await test('patched paneframe ack checks source and board identity',async()=>{const h=makeParent(patched,{delay:5});const task=h.exitSplit('B');h.window.emit('message',{source:{},data:{holst:'split-save-ack',id:'req-1',i:0,bid:'A',ok:true}});await task;assert.equal(h.loaded[0],'B');});
 await test('pane denies failed or pending save',async()=>{const p=makePane({ok:false,dirty:true});await p.send('prepare','r1');assert.equal(p.replies.length,1);assert.equal(p.replies[0].ok,false);});
 await test('pane confirms clean save and suspends edit until cancel',async()=>{const p=makePane({dirty:true});await p.send('prepare','r1');assert.equal(p.replies[0].ok,true);await p.window.emit('keydown',{key:'A'});assert(p.blocked.length>0);await p.send('cancel','r1');const c=p.blocked.length;await p.window.emit('keydown',{key:'A'});assert.equal(p.blocked.length,c);});
 await test('pane rejects mismatched requested board',async()=>{const p=makePane({board:'B'});await p.send('prepare','r1','A');assert.equal(p.replies[0].ok,false);});
 await test('pane refuses teardown while dragging',async()=>{const p=makePane({});p.S.drag={id:'drag'};await p.send('prepare','r1');assert.equal(p.replies[0].ok,false);});
 await test('pane ignores forged message from non-parent',async()=>{const p=makePane({});await p.window.emit('message',{holst:'split-save',action:'prepare',id:'x',bid:'A'},{});assert.equal(p.replies.length,0);});
 await test('pane aborts late ack after cancel',async()=>{const p=makePane({delay:10});const pending=p.send('prepare','r1');await p.send('cancel','r1');await pending;assert.equal(p.replies.length,0);});
 console.log(`TOTAL ${passed}/${passed} PASS (Node VM; synthetic state, not browser E2E)`);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1)});
