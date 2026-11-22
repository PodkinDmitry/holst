// Execute real legacy ext224/background.js kb-add runtime/menu/queue paths in Node VM.
// node test_kb_add_offline.js /path/to/ext224/background.js
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
function section(a, b) {
  const start = source.indexOf(a), end = source.indexOf(b, start + a.length);
  if (start < 0 || end <= start) throw Error('Unknown exact background.js source shape: ' + a);
  return source.slice(start, end);
}
const runtimeCode = section('let readyWaiters = [];', 'async function holstTab(open) {');
const queueCode = section('/* ---------- the queue: nothing is lost', '/* ---------- open something in Холст');
const queueOps = section('const CACHED = [', 'async function sysPull(force) {');
const queuedCode = section('async function queued(op, d) {', '/* watched zones of videos: kept here');
const menuCode = section('async function ctxMenu221(id, info, tab, host) {', '/* hiding a channel in the feed: here at once, in Холст for keeps */');
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(initial = {}, controls = {}) {
  let online = controls.online ?? true;
  const state = { storage: clone(initial), calls: [], marks: [], focused: [], msgs: [], badge: '', alarm: null };
  const chrome = {
    runtime: { onMessage: { addListener: fn => { state.onMessage = fn; } } },
    alarms: { onAlarm: { addListener: fn => { state.alarm = fn; } } },
    action: { setBadgeBackgroundColor: () => {}, setBadgeText: ({text}) => { state.badge = text; } },
    storage: { local: {
      get: async key => { await tick(); if (key === null) return clone(state.storage); const out = {}; for (const k of Array.isArray(key) ? key : [key]) if (k in state.storage) out[k] = clone(state.storage[k]); return out; },
      set: async value => { await tick(); if (controls.set) await controls.set(value); Object.assign(state.storage, clone(value)); }
    }},
    tabs: { update: async (id, attrs) => { state.focused.push({id, attrs}); return {id, windowId: 100}; } },
    windows: { update: async () => ({ok:true}) }
  };
  async function relay(op, d, noOpen) {
    state.calls.push({op, d: clone(d), noOpen});
    if (controls.relay) return controls.relay(op, d, noOpen);
    if (!online) throw new Error('Холст закрыт');
    return {ok: true};
  }
  const ctx = {chrome, relay, Promise, Date,
    holstTab: async () => online ? 42 : null,
    setTimeout() {}, clearTimeout() {},
    sysPull() {}, ywFlush() {}, restoreState() {}, ensureBridge() {}, areaDone() {},
    xfetch() {}, ai225() {}, kbfetch() {}, whimGrab223() {},
    areaStart() {}, openIn() {}, ytBlock221() {}, ytWatch() {}, cached() {},
    stitch221() {}, claude221() {}, exec221() {}, img64221() {},
    mark: (id, r) => state.marks.push({id, r: clone(r)})};
  vm.createContext(ctx);
  vm.runInContext(runtimeCode + '\n' + queueCode + '\n' + queueOps + '\n' + queuedCode + '\n' + menuCode + '\nglobalThis.__app = {flushQueue,ctxMenu221};', ctx, {filename: 'ext224/background.js/kb-add'});
  async function send(op, data) {
    let result;
    const done = new Promise(resolve => {result = resolve});
    const registered = state.onMessage({to: 'bg', op, data}, {tab:{id:7,url:'https://www.youtube.com/watch?v=x'}}, result);
    assert.equal(registered, true, 'background message remains asynchronous');
    return done;
  }
  const link = (url = 'https://example.com/article') => ctx.__app.ctxMenu221('link-kb', {linkUrl:url}, {id:7, title:'Tab',url:'https://example.com'}, 'example.com');
  return {state, send, link, flush:ctx.__app.flushQueue, setOnline: x => {online=x;}};
}
const tests = [
  ['offline-youtube-source-is-persisted', async () => {const h=harness({}, {online:false});const r=await h.send('kb-add',{url:'https://youtube.com/watch?v=1'});assert.equal(r.ok,true);assert.equal(r.queued,true);assert.deepEqual(h.state.storage.queue.map(x=>x.op),['kb-add']);}],
  ['offline-context-link-is-persisted', async () => {const h=harness({}, {online:false});await h.link('https://example.org/source');assert.equal(h.state.storage.queue[0].op,'kb-add');assert.equal(h.state.storage.queue[0].d.url,'https://example.org/source');}],
  ['youtube-non-ok-delivery-is-queued', async () => {const h=harness({}, {relay:async()=>({ok:false})});const r=await h.send('kb-add',{url:'https://youtube.com/@channel'});assert.equal(r.queued,true);assert.equal(h.state.storage.queue[0].op,'kb-add');}],
  ['context-non-ok-delivery-is-queued', async () => {const h=harness({}, {relay:async()=>({ok:false})});await h.link();assert.equal(h.state.storage.queue[0].op,'kb-add');}],
  ['offline-source-replayed-after-worker-restart', async () => {const h=harness({}, {online:false});await h.send('kb-add',{url:'https://youtube.com/watch?v=keep'});const restart=harness(h.state.storage);await restart.flush();assert.equal(restart.state.calls[0].op,'kb-add');assert.equal(restart.state.calls[0].d.url,'https://youtube.com/watch?v=keep');assert.equal(restart.state.storage.queue.length,0);}],
  ['queued-youtube-source-does-not-focus-closed-holst', async () => {const h=harness({}, {online:false});const r=await h.send('kb-add',{url:'https://youtube.com/watch?v=x'});assert.equal(r.queued,true);assert.equal(h.state.focused.length,0);}],
  ['queued-context-source-marked-amber-not-false', async () => {const h=harness({}, {online:false});await h.link();assert.equal(h.state.marks[0].r.ok,true);assert.equal(h.state.marks[0].r.queued,true);}],
  ['offline-context-failure-to-write-outbox-is-visible', async () => {const h=harness({}, {online:false,set:async obj=>{if(obj.queue)throw Error('quota exceeded')}});await h.link();assert.equal(h.state.marks[0].r.ok,false);assert.match(h.state.marks[0].r.data,/quota exceeded/);}],
  ['offline-youtube-failure-to-write-outbox-is-not-success', async () => {const h=harness({}, {online:false,set:async obj=>{if(obj.queue)throw Error('quota exceeded')}});const r=await h.send('kb-add',{url:'https://youtube.com/watch?v=x'});assert.equal(r.ok,false);assert.equal(h.state.storage.queue,undefined);}],
  ['online-youtube-source-opens-existing-holst', async () => {const h=harness();const r=await h.send('kb-add',{url:'https://youtube.com/watch?v=x'});assert.equal(r.ok,true);assert.equal(r.queued,undefined);assert.equal(h.state.focused[0].id,42);assert.equal(h.state.storage.queue,undefined);}],
  ['online-context-source-reports-success', async () => {const h=harness();await h.link('https://example.com/x');assert.equal(h.state.marks[0].r.ok,true);assert.equal(h.state.storage.queue,undefined);assert.equal(h.state.calls[0].op,'kb-add');}],
  ['queue-replay-retains-item-on-remote-refusal', async () => {const h=harness({queue:[{op:'kb-add',d:{url:'https://example.com/a'},at:1}]},{relay:async()=>({ok:false})});await h.flush();assert.equal(h.state.storage.queue.length,1);assert.equal(h.state.storage.queue[0].op,'kb-add');}],
  ['queue-replay-clears-item-after-ack', async () => {const h=harness({queue:[{op:'kb-add',d:{url:'https://example.com/a'},at:1}]});await h.flush();assert.equal(h.state.storage.queue.length,0);assert.equal(h.state.calls[0].d.url,'https://example.com/a');}],
  ['unrelated-yt-add-still-uses-outbox', async () => {const h=harness({}, {online:false});const r=await h.send('yt-add',{videos:[{id:'abc'}]});assert.equal(r.queued,true);assert.equal(h.state.storage.queue[0].op,'yt-add');}],
];
if (process.argv.includes('--with-queue-guard')) tests.push(['concurrent-youtube-sources-kept-with-CHAT48', async () => {const h=harness({}, {online:false});await Promise.all([h.send('kb-add',{url:'https://youtube.com/watch?v=1'}),h.send('kb-add',{url:'https://youtube.com/watch?v=2'})]);assert.deepEqual(h.state.storage.queue.map(x=>x.d.url).sort(),['https://youtube.com/watch?v=1','https://youtube.com/watch?v=2']);}]);
(async()=>{const results=[];for(const [name,fn] of tests){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:String(e&&e.message||e).slice(0,260)});}}const passed=results.filter(x=>x.status==='PASS').length;console.log(JSON.stringify({passed,total:tests.length,results},null,2));process.exitCode=passed===tests.length?0:1;})().catch(e=>{console.error(e);process.exitCode=2;});
