#!/usr/bin/env node
'use strict';
// EXEC-003: run authentic Test13 mkOf222/mkLines222/m_mark224 source in isolated Node VM.
// No application or personal boards bundled. All fixtures below are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');
const path = require('node:path');

const EXPECTED_ORIGINAL = {
  'm_mark222.js': '9ce975a194cf5adbe3d153b3842159ec104fadf32a7b195e4e4aa8064462a753',
  'm_mark224.js': '16bd12345b0477cf0fca0e601c382ca5786a92f1542cb199ed1065eea1627c3c'
};
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const read = (d, n) => fs.readFileSync(path.join(d, 'v224', n), 'utf8');
const [orig, fixed] = process.argv.slice(2);
if (!orig || !fixed) { console.error('usage: node mkopt224_source_gate.js /private/original/Test13 /private/patched/Test13'); process.exit(2); }
const base222 = read(orig, 'm_mark222.js');
const old224 = read(orig, 'm_mark224.js');
const new224 = read(fixed, 'm_mark224.js');
for (const [name, expected] of Object.entries(EXPECTED_ORIGINAL)) {
  assert.equal(hash(read(orig, name)), expected, 'exact Test13 source SHA for ' + name);
}
assert.equal(hash(read(fixed, 'm_mark222.js')), EXPECTED_ORIGINAL['m_mark222.js'], 'no unintended edits to mkOf222');
assert.notEqual(hash(new224), hash(old224), 'patched source differs');
const getMkOf = base222.match(/^const mkOf222 = .*$/m)?.[0];
const startLines = base222.indexOf('function mkLines222()');
const endLines = base222.indexOf('function mkZones222(', startLines);
assert(getMkOf && startLines > 0 && endLines > startLines, 'exact original mkOf222/mkLines222 locations');
const sourcePrefix = getMkOf + '\n' + base222.slice(startLines, endLines);

function env(code, board) {
  const counts = { hist: 0, changed: 0, render: 0, toast: 0, events: {}, ui: {}, timer: [], inserted: [] };
  const p = {
    querySelector: sel => sel === '.mk224p' ? null : null,
    querySelectorAll: sel => sel === '.vp-h' ? [label] : [],
    addEventListener: (event, fn) => { counts.ui[event] = fn; },
  };
  const label = { textContent: 'Указатели', insertAdjacentHTML: (...a) => counts.inserted.push(a) };
  const env = {
    S: { board },
    mkDraw222: () => {}, axDraw222: () => {}, mkPanel222: () => {},
    window: { addEventListener: (name, fn) => { counts.events[name] = fn; } },
    pop: { querySelector: k => k === '.mk222p' ? p : null },
    $: () => null,
    innerWidth: 1200, innerHeight: 750,
    mkMode223: () => 'rays',
    items: () => env.S.board?.items || [],
    byId: id => env.S.board?.items?.find(x => x.id === id),
    isHid: () => false,
    r1: n => Math.round(n * 10) / 10,
    toScreen: (x,y) => ({x,y}),
    toWorld: (x,y) => ({x,y}),
    pushHist: () => { counts.hist++; counts.historyBefore = JSON.stringify(env.S.board); },
    changed: () => { counts.changed++; }, render: () => { counts.render++; },
    toast: () => { counts.toast++; },
    icn: () => 'icon',
    clamp: (x,a,b) => Math.max(a, Math.min(x,b)),
    closePop: () => {},
    uid: () => '123456789',
    setTimeout: fn => { counts.timer.push(fn); return counts.timer.length; },
  };
  vm.createContext(env);
  vm.runInContext(sourcePrefix + '\n' + code, env, { filename: 'genuine-m_mark224.js', timeout: 2000 });
  return {
    ctx: env, counts,
    opt: () => vm.runInContext('mkOpt224()', env),
    panel: () => vm.runInContext('mkPanel222(null)', env),
    pointerUp: () => { counts.events.pointerup(); while (counts.timer.length) counts.timer.shift()(); },
    pointerDown: sel => counts.events.pointerdown({ target: { closest: q => q === sel ? {} : null } }),
    change: (key, checked) => {
      const cb = counts.ui.change;
      assert.equal(typeof cb, 'function', 'real mkPanel222 installs change event');
      cb({ target: { dataset: { mk224: key }, checked }, stopPropagation: () => {} });
    },
  };
}
const mark = (items = [], opt224) => {
  const b = { id: 'synthetic-board', mk222: {lines:[],zones:{},axes:{}}, items };
  if (opt224 !== undefined) b.mk222.opt224 = structuredClone(opt224);
  return b;
};
const ray = (id, o, pos) => ({ id, o, p:pos, all:1, lock:0 });
let total = 0, passed = 0;
function test(description, fn) { total++; try { fn(); passed++; console.log('PASS ' + description); } catch (err) { console.error('FAIL ' + description + ': ' + err.stack); process.exitCode = 1; } }

// ORIGINAL negative controls: assert that each real source path actually reproduces the known bug.
test('original negative: mkOpt224 read creates mk222 for absent board markup', () => {
  const b = { id: 'b', items: [] }, e = env(old224,b); e.opt();
  assert.deepEqual(JSON.parse(JSON.stringify(b.mk222.opt224)), {});
});
test('original negative: mkOpt224 read inserts opt224 on existing markup', () => {
  const b = mark(), e = env(old224,b); assert.equal('opt224' in b.mk222,false); e.opt(); assert.equal(JSON.stringify(b.mk222.opt224), "{}");
});
test('original negative: global pointerup without a drag inserts opt224', () => {
  const b = mark(), e=env(old224,b);e.pointerUp();assert.equal(JSON.stringify(b.mk222.opt224), "{}");
});
test('original negative: panel display inserts opt224 without a change', () => {
  const b = mark(), e = env(old224,b);e.panel();assert.equal(JSON.stringify(b.mk222.opt224), "{}");assert.equal(e.counts.hist, 0);
});
test('original negative: raw getter reference can mutate a saved setting', () => {
  const b=mark([],{move:1}), e=env(old224,b);e.opt().raw.move=0;assert.equal(b.mk222.opt224.move,0);
});

// PATCHED positive controls: read paths never change serialized board state.
test('patched: absent markup read returns defaults without creating mk222', () => {
  const b={id:'b',items:[]}, e=env(new224,b), before=JSON.stringify(b), o=e.opt();
  assert.equal(JSON.stringify(b),before);assert.equal(o.move,true);assert.equal(o.push,true);assert.equal(o.keep,false);
});
test('patched: existing markup with missing opt224 remains byte-for-byte unchanged', () => {
  const b=mark(), e=env(new224,b), before=JSON.stringify(b);const a=e.opt(), c=e.opt();
  assert.equal(JSON.stringify(b),before);assert.equal(a.keep,false);assert.equal(c.push,true);
});
test('patched: preexisting false/true flags read correctly with no JSON change', () => {
  const b=mark([],{move:0,push:0,keep:1,other:'unchanged'}), e=env(new224,b),before=JSON.stringify(b),o=e.opt();
  assert.equal(o.move,false);assert.equal(o.push,false);assert.equal(o.keep,true);assert.equal(JSON.stringify(b),before);
});
test('patched: returned raw snapshot cannot silently modify the live board', () => {
  const b=mark([],{move:1,extra:'x'}),e=env(new224,b),o=e.opt();o.raw.move=0;o.raw.extra='y';
  assert.equal(b.mk222.opt224.move,1);assert.equal(b.mk222.opt224.extra,'x');
});
test('patched: no active board read returns defaults and no save side effects', () => {
  const e=env(new224,null);const o=e.opt();assert.equal(o.move,true);assert.equal(e.counts.changed,0);
});
test('patched: pointerup without drag does not alter board or open options', () => {
  const b=mark(),e=env(new224,b),before=JSON.stringify(b);e.pointerUp();assert.equal(JSON.stringify(b),before);assert.equal('opt224' in b.mk222,false);
});
test('patched: pointerup without drag preserves existing options', () => {
  const b=mark([],{move:0,push:0,keep:1}),e=env(new224,b),before=JSON.stringify(b);e.pointerUp();assert.equal(JSON.stringify(b),before);
});
test('patched: pointerup without active board clears stale drag snapshots', () => {
  const b=mark([ {id:'p',type:'sticky',x:140,y:0,w:20,h:20} ]);b.mk222.lines.push(ray('v1','v',100),ray('v2','v',200));
  const e=env(new224,b);e.pointerDown('.mk222l[data-mkl]');e.ctx.S.board=null;e.pointerUp();
  assert.equal(vm.runInContext('MKS224.lines',e.ctx),null);assert.equal(vm.runInContext('MKS224.items',e.ctx),null);
});
test('patched: opening the Mark224 panel does not allocate opt224', () => {
  const b=mark(),e=env(new224,b),before=JSON.stringify(b);e.panel();assert.equal(JSON.stringify(b),before);
  assert.equal(e.counts.hist,0);assert.equal(e.counts.changed,0);assert.equal(e.counts.render,0);
});
test('patched: explicitly turning move OFF persists opt224.move=0 and history/save hooks', () => {
  const b=mark(),e=env(new224,b);e.panel();assert.equal('opt224' in b.mk222,false);e.change('move',false);
  assert.equal(b.mk222.opt224.move,0);assert.equal(e.counts.hist,1);assert.equal(e.counts.changed,1);assert.equal(e.counts.render,1);
  assert.equal(JSON.parse(e.counts.historyBefore).mk222.opt224,undefined,'undo snapshot before new opt');
});
test('patched: explicitly turning push OFF keeps previously configured move and keep', () => {
  const b=mark([],{move:0,keep:1}),e=env(new224,b);e.panel();e.change('push',false);
  assert.equal(b.mk222.opt224.push,0);assert.equal(b.mk222.opt224.move,0);assert.equal(b.mk222.opt224.keep,1);
  assert.equal(e.opt().push,false);
});
test('patched: explicitly turning keep ON persists keep=1', () => {
  const b=mark(),e=env(new224,b);e.panel();e.change('keep',true);
  assert.equal(b.mk222.opt224.keep,1);assert.equal(e.opt().keep,true);
});
test('patched: explicit ON/OFF round trip persists and updates UI flags', () => {
  const b=mark(),e=env(new224,b);e.panel();e.change('move',false);assert.equal(e.opt().move,false);
  e.change('move',true);assert.equal(e.opt().move,true);assert.equal(b.mk222.opt224.move,1);
  assert.equal(e.counts.hist,2);assert.equal(e.counts.changed,2);assert.equal(e.counts.render,2);
});
for(const axis of ['sz','sr','arr']) test(`patched: changing axis ${axis} does not allocate opt224`, () => {
  const b=mark(),e=env(new224,b);e.panel();e.change(axis,false);assert.equal('opt224' in b.mk222,false);
  assert.equal(b.mk222.axes[axis],0);assert.equal(e.counts.hist,1);assert.equal(e.counts.changed,1);
});
test('patched: a true line drag retains content-follow behaviour', () => {
  const b=mark([{id:'p',type:'sticky',x:140,y:0,w:20,h:20}]);b.mk222.lines.push(ray('v1','v',100),ray('v2','v',200));
  const e=env(new224,b);e.pointerDown('.mk222l[data-mkl]');b.mk222.lines[1].p=300;e.pointerUp();
  assert.equal(b.items[0].x,190);assert.equal(e.counts.changed,1);assert.equal(e.counts.render,1);
  assert.equal('opt224' in b.mk222,false);
});
test('patched: move=0 disables content follow while still permitting line drag', () => {
  const b=mark([{id:'p',type:'sticky',x:140,y:0,w:20,h:20}],{move:0});b.mk222.lines.push(ray('v1','v',100),ray('v2','v',200));
  const e=env(new224,b);e.pointerDown('.mk222l[data-mkl]');b.mk222.lines[1].p=300;e.pointerUp();
  assert.equal(b.items[0].x,140);assert.equal(e.counts.changed,0);
});
test('patched: real item drag across a ray still pushes the ray when enabled', () => {
  const b=mark([{id:'p',type:'sticky',x:40,y:0,w:20,h:20}]);b.mk222.lines.push(ray('v1','v',100));
  const e=env(new224,b);e.pointerDown('#board, .it, #stage, .stage');b.items[0].x=90;e.pointerUp();
  assert.equal(b.mk222.lines[0].p,134);assert.equal(e.counts.changed,1);assert.equal(e.counts.render,1);
  assert.equal('opt224' in b.mk222,false);
});
test('patched: push=0 disables automatic ray movement', () => {
  const b=mark([{id:'p',type:'sticky',x:40,y:0,w:20,h:20}],{push:0});b.mk222.lines.push(ray('v1','v',100));
  const e=env(new224,b);e.pointerDown('#board, .it, #stage, .stage');b.items[0].x=90;e.pointerUp();
  assert.equal(b.mk222.lines[0].p,100);assert.equal(e.counts.changed,0);
});
test('patched: no movement between pointerdown/up does not mark a new change', () => {
  const b=mark([{id:'p',type:'sticky',x:40,y:0,w:20,h:20}]);b.mk222.lines.push(ray('v1','v',100));
  const e=env(new224,b);e.pointerDown('#board, .it, #stage, .stage');e.pointerUp();
  assert.equal(e.counts.changed,0);assert.equal('opt224' in b.mk222,false);
});
test('patched: dragging slider uses pure keep/move read without creating opt224', () => {
  const b=mark([],undefined);b.mk222.lines.push(ray('v1','v',100),ray('v2','v',200));
  const e=env(new224,b);e.panel();e.counts.ui.pointerdown({target:{dataset:{mk224r:'v'}}});
  e.counts.ui.input({target:{dataset:{mk224r:'v'},value:'120'}});
  assert.equal('opt224' in b.mk222,false);assert.equal(b.mk222.lines[1].p,220);assert.equal(e.counts.hist,1);
});
test('patched: grid click can construct rays without implicit opt224 mutation', () => {
  const b=mark([]),e=env(new224,b);e.panel();
  const p=e.ctx.pop.querySelector('.mk222p');p.querySelector=k=> k==='[data-mk224g="c"]'?{value:3}:k==='[data-mk224g="r"]'?{value:2}:null;
  e.counts.ui.click({target:{closest:()=>({dataset:{mk224b:'grid'}})},stopPropagation:()=>{}});
  assert.equal(b.mk222.lines.length,3);assert.equal('opt224' in b.mk222,false);assert.equal(e.counts.hist,1);assert.equal(e.counts.changed,1);
});
test('patched: app-regression strict assert must remain unchanged', () => {
  const originalTest=fs.readFileSync(path.join(orig,'tests','app_regression.py'),'utf8');
  const fixedTest=fs.readFileSync(path.join(fixed,'tests','app_regression.py'),'utf8');
  assert.equal(fixedTest,originalTest);assert.match(fixedTest,/assert before_cleanup == ev\("JSON\.stringify\(\[S\.board, S\.org, LS\.get\('pal28'\)\]\)"\)/);
});
test('patched: only m_mark224.js differs from original across markup/test inputs', () => {
  for(const p of ['v224/m_mark222.js','tests/app_regression.py','v224/base29.html']) {
    assert.equal(hash(fs.readFileSync(path.join(orig,p))),hash(fs.readFileSync(path.join(fixed,p))));
  }
});
console.log(`RESULT ${passed}/${total} ${passed===total?'PASS':'FAIL'} (5 negative original, ${total-5} patched source-backed)`);
if(passed!==total)process.exitCode=1;
