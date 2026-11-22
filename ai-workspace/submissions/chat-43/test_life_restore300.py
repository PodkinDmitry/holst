#!/usr/bin/env python3
"""Source-only fail-before/pass-after regression for XOD Life OS trash vs restore.

Usage: python test_life_restore300.py /path/to/XOD-3.0-checked-source-delta.zip
Requires Python >=3.10, git and Node.js; checks exact known private input locally.
Never writes the private source into GitHub or alters the user's checkout.
A green result is NOT XOD 3.0 integrated or browser acceptance.
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
TARGET = 'v224/m_data300.js'

NODE_TEST = r'''"use strict";
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(process.argv[1],'utf8');
const ctx={stableStr:x=>JSON.stringify(x),structuredClone,crypto:{randomUUID:()=>'source-only-test'},uid:()=>'test-id'};
vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'m_data300.js'});
const merge=ctx.mergeLife300, entry=(title,u=1)=>({id:'A',k:'note',title,u});
const life=(recs={},del={},trash={})=>({recs,del,trash});
const old=life({}, {A:10}, {A:entry('Original')}), restored=life({A:entry('Restored',3)}, {}, {});
let passed=0, failed=[];
function check(name,fn){try{fn();passed++;}catch(e){failed.push(`${name}: ${e.message}`);}}
check('edited trash survives remote restore as conflict note',()=>{
 const local=life({}, {A:10}, {A:entry('Local draft',2)});
 const got=merge(old,local,restored);
 assert.equal(got.data.recs.A.title,'Restored');
 const notes=Object.values(got.data.recs).filter(x=>x.id.startsWith('L-conflict-'));
 assert.equal(notes.length,1,'changed trashed record silently lost');
 assert.equal(JSON.parse(notes[0].notes).title,'Local draft');
 assert.equal(got.conflicts,1);
});
check('unchanged trash produces no spurious conflict copy',()=>{
 const got=merge(old,structuredClone(old),restored);
 assert.equal(got.data.recs.A.title,'Restored');assert.equal(got.conflicts,0);
});
check('trash clearing does not undo restored record',()=>{
 const got=merge(old,life({}, {A:10}, {}),restored);
 assert.equal(got.data.recs.A.title,'Restored');
 assert.equal(got.data.trash.A,undefined);assert.equal(got.conflicts,0);
});
check('independent field edits still merge',()=>{
 const base=life({A:entry('Base')});
 const local=life({A:{...entry('Base'),notes:'local note'}});
 const remote=life({A:entry('Remote')});
 const got=merge(base,local,remote);
 assert.equal(got.data.recs.A.title,'Remote');
 assert.equal(got.data.recs.A.notes,'local note');assert.equal(got.conflicts,0);
});
console.log(JSON.stringify({passed,total:4,failed}));
if(failed.length)process.exitCode=1;
'''


def git_blob(content: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()


def extract_verified_module(archive: Path) -> bytes:
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA:
        raise ValueError('Private source ZIP has wrong SHA256; refuse to test unknown patch')
    with zipfile.ZipFile(archive) as z:
        if set(z.namelist()) != {'BASE.txt', 'XOD-3.0-changes.patch'}:
            raise ValueError('Unexpected archive members')
        patch=z.read('XOD-3.0-changes.patch').decode('utf8')
    start=patch.find(f'diff --git a/{TARGET} b/{TARGET}\n')
    if start<0: raise ValueError('No m_data300.js entry')
    end=patch.find('\ndiff --git ',start+1)
    fragment=patch[start:end+1 if end>=0 else len(patch)]
    if not re.search(r'^new file mode 100644$',fragment,re.M):
        raise ValueError('Expected a new-file patch')
    lines=[line[1:] for line in fragment.splitlines(keepends=True)
           if line.startswith('+') and not line.startswith('+++')]
    content=''.join(lines).encode('utf8')
    if '\\ No newline at end of file' in fragment and content.endswith(b'\n'):
        content=content[:-1]
    if git_blob(content)!=NEW_FILE_BLOB:
        raise ValueError('New m_data300.js Git blob mismatch')
    return content


def run_node(path: Path) -> dict:
    result=subprocess.run(['node','-e',NODE_TEST,str(path)],capture_output=True,text=True,timeout=20)
    if not result.stdout.strip():
        raise RuntimeError(f'Node failed: {result.stderr[-300:]}')
    data=json.loads(result.stdout.strip().splitlines()[-1])
    data['exit_code']=result.returncode
    return data


def main() -> int:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive',type=Path,help='Private checked delta zip; read locally only')
    p.add_argument('--patch',type=Path,default=Path(__file__).with_name('m_data300-trash-restore.patch'))
    args=p.parse_args()
    result={'status':'FAIL','source_only':True,'release_accepted':False,
            'browser':'NOT_RUN','drive_live_e2e':'NOT_RUN','patch_applied_to_preview1':'NOT_RUN'}
    try:
        content=extract_verified_module(args.archive)
        with tempfile.TemporaryDirectory(prefix='xod-life-restore-') as tmp:
            root=Path(tmp); source=root/TARGET;source.parent.mkdir(parents=True)
            source.write_bytes(content)
            before=run_node(source)
            if before['passed']!=3 or before['exit_code']!=1 or len(before['failed'])!=1 or 'edited trash' not in before['failed'][0]:
                raise AssertionError(f'Unexpected original test result: {before}')
            for check in (['git','apply','--check',str(args.patch.resolve())],
                          ['git','apply',str(args.patch.resolve())]):
                run=subprocess.run(check,cwd=root,capture_output=True,text=True,timeout=20)
                if run.returncode: raise RuntimeError(f'Patch check/apply failed: {run.stderr[-300:]}')
            post=subprocess.run(['node','--check',str(source)],capture_output=True,text=True,timeout=20)
            if post.returncode:raise AssertionError(f'Patched JS syntax failed: {post.stderr[-300:]}')
            after=run_node(source)
            if after['passed']!=4 or after['exit_code']!=0 or after['failed']:
                raise AssertionError(f'Fix did not pass all tests: {after}')
            result.update({'status':'SOURCE_ONLY_FIX_PASS','original_git_blob':NEW_FILE_BLOB,
                           'before':{'passed':3,'total':4,'expected_failure':'edited trash lost'},
                           'after':{'passed':4,'total':4},'git_apply_check':'PASS',
                           'js_syntax':'PASS'})
    except Exception as exc:
        result['error']=f'{type(exc).__name__}: {str(exc)[:300]}'
    print(json.dumps(result,ensure_ascii=False,sort_keys=True))
    return 0 if result['status']=='SOURCE_ONLY_FIX_PASS' else 1


if __name__=='__main__':
    raise SystemExit(main())