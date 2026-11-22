#!/usr/bin/env python3
"""Source-only XOD 3.0 delta preflight. Never modifies checkout or publishes private patch.

Usage: python checked_delta_gates.py XOD-3.0-checked-source-delta.zip
Requires Python 3.10+ and Node.js. Tests extracted *new-file* blobs only;
passing these gates does NOT mean the patch applies to a real Preview 1 checkout,
or that XOD 3.0 browser/Drive/performance/release gates passed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

EXPECTED_MEMBERS = {'BASE.txt', 'XOD-3.0-changes.patch'}
EXPECTED_ARCHIVE_SHA = '694d28136c5c676d8e046507b70d9db15de07f3e5e83b4c1d99b176a4145acba'

NODE_TEST = r'''"use strict";
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const dir = process.argv[1];
const read = (name) => fs.readFileSync(`${dir}/${name}`, 'utf8');
const m = read('v224/m_data300.js');
const cut = m.slice(0, m.indexOf('function sameLocalRevision300'));
assert(cut.includes('function mergeLocalBoards300'));
const ctx = {stableStr: (a) => JSON.stringify(a), assetIdsOf: (items) =>
  new Set(items.map((it) => it.asset).filter(Boolean)), crypto: {randomUUID: () => 'fixed'}, uid: () => 'uid'};
vm.createContext(ctx);
vm.runInContext(cut + '\nthis.api={mergeBoardItems300,mergeLocalBoards300};', ctx);
const {mergeBoardItems300, mergeLocalBoards300} = ctx.api;
const item = (id, x=0, y=0) => ({id, type:'frame', x, y, w:20, h:20});
function check(name, condition) { assert(condition, name); count++; }
let count=0;
let r = mergeBoardItems300([item('a')], [item('a'),item('b')], [item('a'),item('c')]);
check('two independent inserted objects survived',r.length===3 && new Set(r.map(i=>i.id)).size===3);
r = mergeBoardItems300([item('a')], [item('a',10,0)], [item('a',0,20)]);
check('independent x/y edits survived',r[0].x===10&&r[0].y===20);
let conflict=false;
try {mergeBoardItems300([item('a')],[item('a',10,0)],[item('a',20,0)]);} catch(e){conflict=true;}
check('conflicting edit fails closed',conflict);
let b={id:'b1',items:[{id:'i1',type:'image',asset:'src1'}],assets:{src1:'payload'},assetFiles:{},assetNames:{},ytReceipts300:{},view:{x:0},updatedAt:1,revision300:'v1'};
let draft={...b,items:[],assets:{}};
let current={...b,items:[...b.items,{id:'i2',type:'image',asset:'src1'}]};
const merged=mergeLocalBoards300(b,draft,current);
check('concurrent new image reference survives',merged.items.length===1&&merged.items[0].id==='i2');
check('source of still-referenced image survives',merged.assets.src1==='payload');
const y=read('v224/m_youtube_table_data300.js');
const yctx={};vm.createContext(yctx);
const e=y.indexOf('async function readYoutubeTableView300');
vm.runInContext(y.slice(0,e) + '\nthis.validate=validateYoutubeTableView300;',yctx);
const validate=yctx.validate;
const val=validate({filter:null,sort:[{key:'category',dir:'asc'}]});
check('valid filter/sort accepted',val.sort.length===1);
let reject=false;
try {validate({filter:null,sort:[{key:'category',dir:'asc'},{key:'category',dir:'desc'}]});}catch{reject=true;}
check('duplicate sort keys rejected',reject);
let nested={key:'category',op:'eq',value:'favorite'};
for(let i=0;i<17;i++) nested={op:'and',children:[nested]};
reject=false;try {validate({filter:nested,sort:[]});}catch{reject=true;}
check('filter deeper than MAX_FILTER_DEPTH rejected',reject);
console.log(JSON.stringify({merge_and_validation_cases:count,status:'PASS'}));
'''


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('archive',type=Path)
    ap.add_argument('--output',type=Path,default=None,help='Optional JSON report path (local only)')
    args=ap.parse_args()
    result={'source_only':True,'release_accepted':False,'drive_live_e2e':'NOT_RUN','browser':'NOT_RUN','patch_applied_to_preview1':'NOT_RUN','checkpoints':[]}
    def check(label, ok, detail=None):
        result['checkpoints'].append({'gate':label,'status':'PASS' if ok else 'FAIL',**({'detail':detail} if detail else {})})
        if not ok: raise AssertionError(f'{label}: {detail or "failed"}')
    try:
        archive=args.archive.expanduser().resolve()
        with zipfile.ZipFile(archive) as z:
            check('exact two source-delta members',set(z.namelist())==EXPECTED_MEMBERS)
            check('patch zip entry regular',all(not i.is_dir() and i.file_size<2_000_000 for i in z.infolist()))
            patch=z.read('XOD-3.0-changes.patch')
            check('known checked delta hash',hashlib.sha256(archive.read_bytes()).hexdigest()==EXPECTED_ARCHIVE_SHA)
            base=z.read('BASE.txt').decode('utf8')
            check('base has Preview1 identity and SHA',bool(re.search(r'Preview 1.*SHA-256:\s*[0-9a-f]{64}',base)))
            text=patch.decode('utf8')
        chunks=re.split(r'(?=^diff --git a/)',text,flags=re.M)
        chunks=[c for c in chunks if c.startswith('diff --git')]
        check('all 41 touched file entries intact',len(chunks)==41,detail=f'entries={len(chunks)}')
        with tempfile.NamedTemporaryFile(prefix='xod-delta-',suffix='.patch') as temp_patch:
            temp_patch.write(patch)
            temp_patch.flush()
            gp=subprocess.run(['git','apply','--numstat',temp_patch.name],capture_output=True,text=True,timeout=20)
            check('git patch structure --numstat',gp.returncode==0 and len(gp.stdout.splitlines())==len(chunks),
                detail=(gp.stderr[:240] if gp.returncode else f'{len(gp.stdout.splitlines())} parsed file changes'))
        with tempfile.TemporaryDirectory(prefix='xod-delta-gates-') as td:
            root=Path(td)
            newfiles=[]
            for c in chunks:
                first=c.split('\n',1)[0]
                m=re.fullmatch(r'diff --git a/(\S+) b/(\S+)',first)
                check('consistent safe patch paths',bool(m and m.group(1)==m.group(2) and '..' not in Path(m.group(1)).parts and '\\' not in m.group(1) and ':' not in m.group(1)))
                if not re.search(r'^new file mode 100644$',c,re.M):continue
                info=re.search(r'^index 0{40}\.\.([0-9a-f]{40})$',c,re.M)
                assert info, first
                plus=[line[1:] for line in c.splitlines(keepends=True) if line.startswith('+') and not line.startswith('+++')]
                data=''.join(plus).encode('utf8')
                if '\\ No newline at end of file' in c and data.endswith(b'\n'):
                    data=data[:-1]
                name=m.group(1)
                check('new file matches Git blob: '+name,git_blob_sha(data)==info.group(1))
                dest=root/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
                newfiles.append(name)
            check('all 12 added files verified',len(newfiles)==12,detail=f'count={len(newfiles)}')
            js=[root/x for x in newfiles if x.endswith('.js')]
            for f in js:
                cp=subprocess.run(['node','--check',str(f)],capture_output=True,text=True,timeout=20)
                check('JS syntax: '+f.name,cp.returncode==0,detail=cp.stderr[:250] if cp.returncode else None)
            for f in [root/x for x in newfiles if x.endswith('.py')]:
                compile(f.read_text('utf8'),str(f),'exec')
                check('Python syntax: '+f.name,True)
            cp=subprocess.run(['node','-e',NODE_TEST,str(root)],capture_output=True,text=True,timeout=20)
            check('real source merge/filter invariants',cp.returncode==0,detail=cp.stderr[-450:] if cp.returncode else cp.stdout.strip())
        result['status']='SOURCE_ONLY_PASS'
    except (Exception,AssertionError) as e:
        result['status']='BLOCKED_ENVIRONMENT' if isinstance(e,FileNotFoundError) else 'FAIL'
        result['error']=f'{type(e).__name__}: {e}'
    output=json.dumps(result,ensure_ascii=False,indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(output+'\n',encoding='utf8')
    print(output)
    return 0 if result['status']=='SOURCE_ONLY_PASS' else 1

if __name__=='__main__':
    raise SystemExit(main())