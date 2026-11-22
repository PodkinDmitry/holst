// Source-backed queue regression tests for ext224/background.js. No Chrome profile.
// Usage: node test_queue_concurrency.js /path/to/ext224/background.js
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
function between(a, b) {
  const i = source.indexOf(a), j = source.indexOf(b, i + a.length);
  if (i < 0 || j <= i) throw new Error('Source shape changed (' + a + ' / ' + b + ')');
  return source.slice(i, j);
}
const queueSource = between('/* ---------- the queue: nothing is lost', '/* ---------- open something in Холст');
const queuedSource = between('async function queued(op, d) {', '/* watched zones of videos: kept here');
function tick() { return new Promise(r => setImmediate(r)); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function harness(initial = [], relayOverride, holstOverride, storageOverride) {
  const state = { queue: clone(initial), badge: '' };
  const chrome = { storage: { local: {
    get: async () => { await tick(); return { queue: clone(state.queue) }; },
    set: async x => { await tick(); if (storageOverride) await storageOverride(x); state.queue = clone(x.queue); }
  } }, action: {
    setBadgeBackgroundColor() {},
    setBadgeText(o) { state.badge = o.text; }
  }, alarms: null };
  const context = { chrome, Date, Promise, holstTab: holstOverride || (async () => 17),
    relay: relayOverride || (async () => ({ ok: false })) };
  vm.createContext(context);
  vm.runInContext(queueSource + '\n' + queuedSource + '\nglobalThis.__api = { clip, queued, flushQueue };', context, { filename: 'ext224/background.js/queue' });
  return { api: context.__api, state, chrome };
}
const cases = [
  ['parallel-queued-additions', async () => {
    const { api, state } = harness();
    const a = await Promise.all([api.queued('yt-add', { id: 'a' }), api.queued('yt-add', { id: 'b' })]);
    assert(a.every(x => x.queued));
    assert.deepEqual(state.queue.map(x => x.d.id).sort(), ['a', 'b']);
  }],
  ['flush-must-preserve-new-arrival', async () => {
    let entered;
    const inside = new Promise(r => entered = r);
    let unblock;
    const held = new Promise(r => unblock = r);
    const { api, state } = harness([{ op: 'yt-add', d: { id: 'old' }, at: 1 }], async (_op, d) => {
      if (d.id === 'old') { entered(); await held; return { ok: true }; }
      return { ok: false };
    });
    const flushing = api.flushQueue();
    await inside;
    const arriving = api.queued('yt-add', { id: 'new' });
    for (let i = 0; i < 6; i++) await tick();
    unblock();
    await Promise.all([flushing, arriving]);
    assert.deepEqual(state.queue.map(x => x.d.id), ['new']);
  }],
  ['concurrent-flushes-send-once', async () => {
    let sends = 0;
    const { api, state } = harness([{ op: 'yt-add', d: { id: 'one' }, at: 1 }], async () => { sends++; await tick(); return { ok: true }; });
    await Promise.all([api.flushQueue(), api.flushQueue()]);
    assert.equal(sends, 1, 'only one delivery when two flush triggers overlap');
    assert.equal(state.queue.length, 0);
  }],
  ['overflow-rejected-with-old-queue-preserved', async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({ op: 'yt-add', d: { id: String(i) }, at: i }));
    const { api, state } = harness(entries);
    await assert.rejects(api.queued('yt-add', { id: 'new' }), /очередь|не сохранено/i);
    assert.equal(state.queue.length, 200);
    assert.equal(state.queue[0].d.id, '0');
    assert.equal(state.queue[199].d.id, '199');
  }],
  ['parallel-clips-preserved', async () => {
    const { api, state } = harness();
    await Promise.all([api.clip({ id: 'c1' }), api.clip({ id: 'c2' })]);
    assert.deepEqual(state.queue.map(x => x.d.id).sort(), ['c1', 'c2']);
  }],
  ['failed-forward-remains-queued', async () => {
    const { api, state } = harness([{ op: 'yt-add', d: { id: 'fail' }, at: 1 }]);
    await api.flushQueue();
    assert.deepEqual(state.queue.map(x => x.d.id), ['fail']);
  }],
  ['offline-retains-queue', async () => {
    const { api, state } = harness([{ op: 'yt-add', d: { id: 'offline' }, at: 1 }], null, async () => null);
    await api.flushQueue();
    assert.deepEqual(state.queue.map(x => x.d.id), ['offline']);
  }],
  ['durable-write-error-is-not-success', async () => {
    const { api, state } = harness([], null, null, () => { throw new Error('disk failure'); });
    await assert.rejects(api.queued('yt-add', { id: 'a' }), /disk failure/);
    assert.equal(state.queue.length, 0);
  }],
  ['successful-send-never-enqueued', async () => {
    const { api, state } = harness([], async () => ({ ok: true }));
    const r = await api.queued('yt-add', { id: 'immediate' });
    assert.equal(r.ok, true); assert.equal(r.queued, undefined); assert.equal(state.queue.length, 0);
  }],
  ['service-worker-restart-recovers-persisted-queue', async () => {
    const first = harness();
    await first.api.queued('yt-add', { id: 'persisted' });
    const rest = harness(first.state.queue, async () => ({ ok: true }));
    await rest.api.flushQueue();
    assert.equal(rest.state.queue.length, 0);
  }]
];
(async () => {
  const results = [];
  for (const [name, fn] of cases) {
    try { await fn(); results.push({ name, status: 'PASS' }); }
    catch (e) { results.push({ name, status: 'FAIL', message: String(e && e.message || e).slice(0, 220) }); }
  }
  const passed = results.filter(x => x.status === 'PASS').length;
  console.log(JSON.stringify({ passed, total: results.length, results }, null, 2));
  process.exitCode = passed === results.length ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 2; });
