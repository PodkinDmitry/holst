#!/usr/bin/env python3
"""Source-only fail-before/pass-after regression for concurrent Life OS edits during async save.

Usage: python test_pending_write300.py /path/to/XOD-3.0-checked-source-delta.zip
Requires Python 3.10+, git and Node.js. Reads checked private archive locally only.
Never modifies a real checkout, publishes private sources or claims browser/Drive acceptance.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

ARCHIVE_SHA = '694d28136c5c676d8e046507b70d9db15de07f3e5e83b4c1d99b176a4145acba'
NEW_FILE_BLOB = '12d61b13c9c7f05b35a3ae2b1b4d9fa9b2b9450f'
PATCHED_BLOB = '328555feedfb80e1a319548a96081b2579acb9a6'
TARGET = 'v224/m_data300.js'

NODE_TEST = r"""
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(process.argv[2],'utf8');
const clone=o=>structuredClone(o);
const state=(setting)=>({recs:{},del:{},trash:{},setting});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise}};
let passed=0;const failed=[];
async function check(name, callback) {
  try { await callback(); passed++; }
  catch(e) { failed.push(`${name}: ${e.stack||e.message}`); }
}
function harness({base=state('old'),stored=clone(base),pause=false}={}) {
  let value=clone(stored),barrier=deferred(),entered=deferred(),timers=[],writes=0,toasts=[];
  const Store={mode:'ls',get:async name=>clone(value),set:async(name,obj)=>{
    writes++;value=clone(obj);entered.resolve();if(pause)await barrier.promise;
  }};
  const ctx={stableStr:JSON.stringify,structuredClone,crypto:{randomUUID:()=> 'uuid'},uid:()=> 'uid',
    navigator:{locks:null},Store,S:{loT:null},loNorm:x=>x||state('old'),
    setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},
    loWrite:()=>{throw Error('Scheduled loWrite should not execute synchronously');},
    toast:t=>toasts.push(t)};
  vm.createContext(ctx);
  vm.runInContext(source+'\nthis.api={writePersonalLife300,mergeLife300,setBase300:x=>lifeBase300=x,getBase300:()=>lifeBase300};',ctx,{filename:'m_data300.js'});
  ctx.api.setBase300(clone(base));
  const live=clone(base);
  return {ctx,live,Store,entered,release:()=>barrier.resolve(),getStored:()=>clone(value),getTimers:()=>timers,
    getWrites:()=>writes};
}
(async()=>{
  await check('late edit during in-flight save schedules another flush and persists',async()=>{
    const h=harness({pause:true}); h.live.setting='first';
    const inFlight=h.ctx.api.writePersonalLife300(h.live);
    await h.entered.promise;
    h.live.setting='second';
    h.release(); await inFlight;
    assert.equal(h.getStored().setting,'first','first snapshot actually committed');
    assert.equal(h.live.setting,'second','live change preserved in memory');
    assert.equal(h.getTimers().length,1,'another save MUST be scheduled');
    assert.equal(h.getTimers()[0].ms,300);
    h.ctx.S.loT=null;
    await h.ctx.api.writePersonalLife300(h.live);
    assert.equal(h.getStored().setting,'second','second save flushes latest edit');
  });
  await check('steady save never schedules redundant retry',async()=>{
    const h=harness(); h.live.setting='first';await h.ctx.api.writePersonalLife300(h.live);
    assert.equal(h.getStored().setting,'first');
    assert.equal(h.getTimers().length,0);
  });
  await check('remote independent edit merges without losing local change',async()=>{
    const base=state('old'), remote={...clone(base), remoteFlag:'remote'};
    const h=harness({base,stored:remote}); h.live.setting='local';
    await h.ctx.api.writePersonalLife300(h.live);
    assert.equal(h.getStored().setting,'local');
    assert.equal(h.getStored().remoteFlag,'remote');
    assert.equal(h.live.remoteFlag,'remote');
    assert.equal(h.getTimers().length,0);
  });
  await check('pending late edit with concurrent remote changes is flushed',async()=>{
    const base=state('old'), remote={...clone(base),remoteFlag:'remote'};
    const h=harness({base,stored:remote,pause:true}); h.live.setting='first';
    const inFlight=h.ctx.api.writePersonalLife300(h.live);await h.entered.promise;
    h.live.lateFlag='local-late';h.release();await inFlight;
    assert.equal(h.live.remoteFlag,'remote');
    assert.equal(h.live.lateFlag,'local-late');
    assert.equal(h.getTimers().length,1);
    h.ctx.S.loT=null;
    await h.ctx.api.writePersonalLife300(h.live);
    assert.equal(h.getStored().lateFlag,'local-late');
    assert.equal(h.getStored().remoteFlag,'remote');
  });
  console.log(JSON.stringify({passed,total:4,failed:failed.map(x=>x.slice(0,450))}));
  process.exitCode=failed.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=2});

"""


def git_blob(content: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()


def extract_verified_module(archive: Path) -> bytes:
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA:
        raise ValueError('Checked source ZIP SHA256 mismatch')
    with zipfile.ZipFile(archive) as z:
        if set(z.namelist()) != {'BASE.txt', 'XOD-3.0-changes.patch'} or len(z.infolist()) != 2:
            raise ValueError('Unexpected ZIP members')
        patch = z.read('XOD-3.0-changes.patch').decode('utf8')
    start = patch.find(f'diff --git a/{TARGET} b/{TARGET}\n')
    if start < 0:
        raise ValueError('Missing m_data300.js new-file diff')
    end = patch.find('\ndiff --git ', start + 1)
    fragment = patch[start:end + 1 if end >= 0 else len(patch)]
    if not re.search(r'^new file mode 100644$', fragment, re.M):
        raise ValueError('Expected new-file mode 100644')
    lines = [line[1:] for line in fragment.splitlines(keepends=True)
             if line.startswith('+') and not line.startswith('+++')]
    content = ''.join(lines).encode('utf8')
    if '\\ No newline at end of file' in fragment and content.endswith(b'\n'):
        content = content[:-1]
    if git_blob(content) != NEW_FILE_BLOB:
        raise ValueError('Unexpected m_data300.js Git blob')
    return content


def run_test(test: Path, source: Path) -> dict:
    p = subprocess.run(['node', str(test), str(source)], capture_output=True, text=True, timeout=20)
    if not p.stdout.strip():
        raise RuntimeError(f'Node test execution failed: {p.stderr[-300:]}')
    data = json.loads(p.stdout.strip().splitlines()[-1])
    data['exit_code'] = p.returncode
    return data


def apply_patch(root: Path, patch: Path) -> None:
    for command in (['git', 'apply', '--check', str(patch)], ['git', 'apply', str(patch)]):
        p = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError(f'git apply failed: {p.stderr[-300:]}')


def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('archive', type=Path, help='Exact checked private source-only ZIP')
    ap.add_argument('--patch', type=Path,
                    default=Path(__file__).with_name('m_data300-pending-write.patch'))
    args=ap.parse_args()
    report={'source_only':True, 'release_accepted':False, 'browser':'NOT_RUN',
            'drive_live_e2e':'NOT_RUN','patch_applied_to_preview1':'NOT_RUN','status':'FAIL'}
    try:
        source_bytes=extract_verified_module(args.archive.expanduser().resolve())
        with tempfile.TemporaryDirectory(prefix='xod-pending-life-') as tmp:
            root=Path(tmp)
            source=root/TARGET;source.parent.mkdir(parents=True)
            source.write_bytes(source_bytes)
            test=root/'test.cjs';test.write_text(NODE_TEST,encoding='utf8')
            before=run_test(test, source)
            if not (before['passed']==3 and before['total']==4 and before['exit_code']==1 and
                    len(before['failed'])==1 and 'late edit during in-flight save' in before['failed'][0]):
                raise AssertionError(f'Unexpected original result: {before}')
            apply_patch(root,args.patch.expanduser().resolve())
            if git_blob(source.read_bytes())!=PATCHED_BLOB:
                raise AssertionError('Patched source blob mismatch')
            syntax=subprocess.run(['node','--check',str(source)],capture_output=True,text=True,timeout=20)
            if syntax.returncode:
                raise AssertionError(f'Patched JavaScript syntax error: {syntax.stderr[-300:]}')
            after=run_test(test, source)
            if after['passed']!=4 or after['exit_code']!=0 or after['failed']:
                raise AssertionError(f'Post-fix regression: {after}')
        report.update(status='SOURCE_ONLY_FIX_PASS',git_apply_check='PASS',js_syntax='PASS',
                      before={'passed':3,'total':4,'expected_failure':'late edit not scheduled'},
                      after={'passed':4,'total':4},original_git_blob=NEW_FILE_BLOB,
                      patched_git_blob=PATCHED_BLOB)
    except Exception as e:
        report['error']=f'{type(e).__name__}: {str(e)[:400]}'
    print(json.dumps(report,ensure_ascii=False,sort_keys=True))
    return 0 if report['status']=='SOURCE_ONLY_FIX_PASS' else 1


if __name__=='__main__':
    raise SystemExit(main())