#!/usr/bin/env python3
"""XOD CHAT45: source-only local-board async save race, fail-before/pass-after.

Usage: python test_board_pending_write300.py XOD-3.0-checked-source-delta.zip
       python test_board_pending_write300.py XOD-3.0-checked-source-delta.zip --with-prior

Reads a verified private ZIP locally and modifies only a temporary checkout.
The patches and this test are safe to publish; do NOT publish extracted source.
Passing is not real Test13, browser, Drive, IndexedDB or release acceptance.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

ARCHIVE_SHA = '694d28136c5c676d8e046507b70d9db15de07f3e5e83b4c1d99b176a4145acba'
ORIGINAL_BLOB = '12d61b13c9c7f05b35a3ae2b1b4d9fa9b2b9450f'
PATCHED_BLOB = 'eeec888691cfb4de8096bad06140b717c6848eca'
TARGET = 'v224/m_data300.js'
NODE_TEST = r"""
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
const clone = value => structuredClone(value);
const defer = () => {let resolve;let promise=new Promise(r => resolve=r);return {resolve,promise};};
const boardBase = () => ({id:'b1',name:'Board',items:[{id:'one',type:'text',x:0,y:0}],view:{x:0,y:0,z:1},updatedAt:1,revision300:'base',assets:{},assetFiles:{},assetNames:{},ytReceipts300:{}});
let successes = 0;
let failures = [];
async function check(name, callback){try{await callback();successes++}catch(e){failures.push(name+': '+e.message)}}
function harness({stored=boardBase(), pause=false, board = boardBase()}={}) {
  const files = {'board:b1':clone(stored),index:[{id:'b1',name:'Board',count:1,revision300:stored.revision300}]};
  const arrived=defer();const release=defer();let saves=0,times=[], broadcasts=[];
  const Store={mode:'ls',get:async key=>clone(files[key]),set:async(key,value)=>{files[key]=clone(value);if(key==='board:b1'){arrived.resolve();if(pause)await release.promise;}},del:async key=>{delete files[key];}};
  const S={board,index:[],sel:new Set()};
  const ctx={stableStr:JSON.stringify,structuredClone,crypto:{randomUUID:()=> 'uuid-'+(++saves)},uid:()=> 'uid',navigator:{locks:null},Store,S,
    boardIndexEntry:b=>({id:b.id,name:b.name,count:b.items.length,revision300:b.revision300}),
    upsertIndex:()=>{},bcPost:e=>broadcasts.push(e),scheduleSave:()=>times.push('schedule'),
    toast:()=>{},fontBoard213:()=>{}, $:()=>({value:''}), document:{title:''}, requestRender:()=>{}, byId:()=>null,
    assetIdsOf:x=>new Set(x.map(item=>item.asset).filter(Boolean)),
  };
  vm.createContext(ctx);
  vm.runInContext(source+'\nthis.api={writeLocalBoard,setBase:(b,v)=>localBoardBases300.set(b,v),getBase:b=>localBoardBases300.get(b)};',ctx,{filename:'m_data300.js'});
  ctx.api.setBase(board,clone(boardBase()));
  return {board,ctx,arrived,release:()=>release.resolve(),stored:()=>clone(files['board:b1']),count:()=>times.length,
    run:()=>ctx.api.writeLocalBoard('b1',board,{keepConflict:true})};
}
(async()=>{
await check('late content mutation after write starts requires another save and persists',async()=>{
  const h=harness({pause:true});const inFlight=h.run();await h.arrived.promise;
  h.board.items[0].x=17;
  h.release();await inFlight;
  assert.equal(h.stored().items[0].x,0,'only first snapshot committed');
  assert.equal(h.board.items[0].x,17,'late edit remains in live board');
  assert.equal(h.count(),1,'must schedule followup');
  await h.run();assert.equal(h.stored().items[0].x,17,'next write persists late edit');
});
await check('unchanged board does not schedule redundant save',async()=>{
  const h=harness();await h.run();assert.equal(h.count(),0);assert.equal(h.stored().items[0].x,0);
});
await check('camera-only changes remain tab local and do not resave board',async()=>{
  const h=harness({pause:true});const inFlight=h.run();await h.arrived.promise;h.board.view.x=918;
  h.release();await inFlight;assert.equal(h.count(),0);assert.equal(h.board.view.x,918);
});
await check('independent remote edit + late local edit both survive',async()=>{
  const b=boardBase();const remote=clone(b);remote.items[0].y=12;remote.revision300='remote';
  const h=harness({pause:true,stored:remote});h.board.items[0].x=5;
  const inFlight=h.run();await h.arrived.promise;h.board.items[0].x=7;
  h.release();await inFlight;
  assert.equal(h.board.items[0].x,7);assert.equal(h.board.items[0].y,12);
  assert.equal(h.count(),1,'late edit during merged save requires followup');
  await h.run();assert.equal(h.stored().items[0].x,7);assert.equal(h.stored().items[0].y,12);
});
console.log(JSON.stringify({passed:successes,total:4,failures:failures}));
process.exitCode=failures.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=2});

"""


def git_blob(data: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def extract_verified_source(path: Path) -> bytes:
    if hashlib.sha256(path.read_bytes()).hexdigest() != ARCHIVE_SHA:
        raise ValueError('Refusing unknown or modified private delta ZIP')
    with zipfile.ZipFile(path) as archive:
        if len(archive.infolist()) != 2 or set(archive.namelist()) != {'BASE.txt', 'XOD-3.0-changes.patch'}:
            raise ValueError('Unexpected private delta archive members')
        delta = archive.read('XOD-3.0-changes.patch').decode('utf-8')
    start = delta.find(f'diff --git a/{TARGET} b/{TARGET}\n')
    if start < 0:
        raise ValueError('No matching m_data300.js diff')
    end = delta.find('\ndiff --git ', start + 1)
    fragment = delta[start:end + 1 if end >= 0 else len(delta)]
    if not re.search(r'^new file mode 100644$', fragment, re.M):
        raise ValueError('Expected new-file module diff')
    data = ''.join(line[1:] for line in fragment.splitlines(keepends=True)
                   if line.startswith('+') and not line.startswith('+++')).encode('utf8')
    if '\\ No newline at end of file' in fragment and data.endswith(b'\n'):
        data = data[:-1]
    if git_blob(data) != ORIGINAL_BLOB:
        raise ValueError('m_data300.js source Git blob mismatch')
    return data


def run_js(test_path: Path, source_path: Path) -> dict:
    result = subprocess.run(['node', str(test_path), str(source_path)], capture_output=True, text=True, timeout=25)
    lines = result.stdout.strip().splitlines()
    if not lines:
        raise RuntimeError(f'Node test did not produce JSON: {result.stderr[-400:]}')
    data = json.loads(lines[-1])
    data['exit_code'] = result.returncode
    return data


def apply(root: Path, patch: Path) -> None:
    for cmd in (['git', 'apply', '--check', str(patch)], ['git', 'apply', str(patch)]):
        result = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise RuntimeError(f'git apply failed for {patch.name}: {result.stderr[-300:]}')


def saved_node_test(src: Path) -> str:
    # Read earlier published Python regression runner as data. Never execute it or run any private source.
    tree = ast.parse(src.read_text('utf8'))
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'NODE_TEST' for t in stmt.targets):
            value = ast.literal_eval(stmt.value)
            if not isinstance(value, str):
                break
            return value
    raise RuntimeError(f'Missing NODE_TEST constant: {src}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--patch', type=Path, default=Path(__file__).with_name('m_data300-board-pending-write.patch'))
    parser.add_argument('--with-prior', action='store_true', help='Check combination with published CHAT43/44 patches and tests')
    args = parser.parse_args()
    report = {'source_only': True, 'release_accepted': False, 'browser': 'NOT_RUN',
              'indexeddb_real': 'NOT_RUN', 'drive_live_e2e': 'NOT_RUN',
              'patch_applied_to_private_test13': 'NOT_RUN', 'status': 'FAIL'}
    try:
        data = extract_verified_source(args.archive.expanduser().resolve())
        patch = args.patch.expanduser().resolve()
        with tempfile.TemporaryDirectory(prefix='xod-chat45-') as temp:
            root = Path(temp)
            path = root / TARGET
            path.parent.mkdir(parents=True)
            path.write_bytes(data)
            test = root / 'regression.cjs'
            test.write_text(NODE_TEST, encoding='utf8')
            before = run_js(test, path)
            report['before'] = before
            if not (before['passed'] == 2 and before['total'] == 4 and before['exit_code'] == 1
                    and len(before['failures']) == 2):
                raise AssertionError('Expected two original source regressions; no known fail-before evidence')
            apply(root, patch)
            if git_blob(path.read_bytes()) != PATCHED_BLOB:
                raise AssertionError('Final source Git blob differs from expected minimal fix')
            syntax = subprocess.run(['node', '--check', str(path)], capture_output=True, text=True, timeout=15)
            if syntax.returncode:
                raise RuntimeError('Patched JS syntax failed')
            after = run_js(test, path)
            report['after'] = after
            if after['passed'] != 4 or after['total'] != 4 or after['exit_code']:
                raise AssertionError('Regression not fixed or introduced new failures')
            if args.with_prior:
                folder = Path(__file__).resolve().parent.parent
                old = [(folder/'chat-43/m_data300-trash-restore.patch',folder/'chat-43/test_life_restore300.py'),
                       (folder/'chat-44/m_data300-pending-write.patch',folder/'chat-44/test_pending_write300.py')]
                results=[]
                for order in (['chat43','chat44','chat45'], ['chat45','chat44','chat43']):
                    path.write_bytes(data)
                    names = {'chat43':old[0][0], 'chat44':old[1][0], 'chat45':patch}
                    for name in order: apply(root,names[name].resolve())
                    for ix, (_,legacy_script) in enumerate(old):
                        legacy_js = root / f'previous{ix}.cjs'
                        legacy_js.write_text(saved_node_test(legacy_script), encoding='utf8')
                        if ix == 0:
                            # CHAT43 was originally authored for `node -e` and reads argv[1].
                            cp = subprocess.run(['node', '-e', legacy_js.read_text('utf8'), str(path)],
                                                capture_output=True, text=True, timeout=25)
                            lines = cp.stdout.strip().splitlines()
                            if not lines:
                                raise RuntimeError(f'CHAT43 VM did not output JSON: {cp.stderr[-300:]}')
                            result = json.loads(lines[-1]); result['exit_code'] = cp.returncode
                        else:
                            result = run_js(legacy_js,path)
                        if result.get('passed') != 4 or result.get('total') != 4 or result['exit_code']:
                            raise AssertionError(f'Prior CHAT{43+ix} regression FAIL after combined patch')
                    current = run_js(test,path)
                    if current['passed'] != 4 or current['total'] != 4 or current['exit_code']:
                        raise AssertionError('CHAT45 regression failed on combined patches')
                    results.append({'order':order,'chat43':4,'chat44':4,'chat45':4})
                report['combined'] = results
            report['status'] = 'SOURCE_ONLY_FIX_PASS'
    except Exception as exc:
        report['error'] = f'{type(exc).__name__}: {str(exc)[:450]}'
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['status'] == 'SOURCE_ONLY_FIX_PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())