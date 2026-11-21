#!/usr/bin/env python3
"""CHAT32: reproduce patch application and isolated Node VM checks on exact private Test13.

Only small public patch files and test runners are read from disk/GitHub; the full
source ZIP, staged HTML and built application stay in a temporary local directory.
This is NOT a browser, IndexedDB, Drive or SOL acceptance test.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = 'PodkinDmitry/holst'
BRANCH = 'ai-workspace'
SOURCE_ZIP_SHA256 = 'a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4'
ORIGINAL_HTML_SHA256 = '3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c'
PARTIAL_BASELINE19_SHA256 = 'f917c2202186eaf768708b7e6bc1ec1d624e5030552593f4d957e0597063f63d'
# Git blob SHA values are fetched from the actual ai-workspace GitHub branch.
PATCHES = {
 16: ('beforeunload_dirty_guard.patch','a58e56aa784a135328c1fd6c59039d97b99269b8'),
 17: ('virtual_writeback_guard.patch','7a6ff3c16f62bdf7200ad8852d05efaa8d054143'),
 18: ('board_navigation_guard.patch','7e35ec332e401afbbfe950f08ca260a543a30e44'),
 19: ('board_secondary_route_guard.patch','3e45d2b14f467bfbb3f394a2948029bd175b0d10'),
 20: ('filter_mode_persistence_guard.patch','5bb40f03b4b78e2e7f6df6d9a904a9af68744e2f'),
 21: ('split_iframe_persistence_guard.patch','9245f8db653725e8cd53acbc67565c35dd8b2172'),
 22: ('import_board_navigation_guard.patch','4a6326917c6442740afc1d8bcc7544eaa9d5a804'),
 23: ('history_navigation_guard.patch','fc3fe2556401bab045d01536b0eb4c5a9de34be8'),
 24: ('drive_sync_local_delete_guard.patch','f2d044713da83053065824b6f4575571f6902931'),
 25: ('bulk_board_delete_guard.patch','7863a89b33936373e51d5db6b0470aeaf63ad8ef'),
 26: ('demo_board_persistence_guard.patch','3f7513cdd1617c1c23852de410342c67c9350358'),
 27: ('trash_restore_persistence_guard.patch','1ae26e70c6766a644a9121c1f31551892937e93a'),
 28: ('trash_items_backup_first.patch','ba4bd38d779283d121daae1ecbf973e8bec9ce0e'),
 29: ('matrix_track_backup_before_delete.patch','1b96f902281f2b80fbf15e25628a91baa0a9566f'),
 30: ('matrix_span_drop_guard.patch','0ec021e73cf65a6888a48a61fc71e596798f5b5b'),
 31: ('matrix_cell_track_drag_guard.patch','639cef147bdcc010f20d009b9c8de9d7e89b0d22'),
}
HARNESS = {
21: ('split_iframe_source_gate.js',21),
22: ('import_board_source_gate.js',20),
23: ('history_source_gate.js',23),
24: ('drive_sync_source_gate.js',26),
25: ('bulk_board_source_gate.js',35),
26: ('demo_board_source_gate.js',25),
27: ('trash_restore_source_gate.js',30),
28: ('trash_items_source_gate.js',33),
29: ('matrix_track_source_gate.js',36),
30: ('matrix_span_drop_source_gate.js',46),
31: ('matrix_cell_track_source_gate.js',43),
}

class GateError(RuntimeError): pass

def sha(data:bytes)->str: return hashlib.sha256(data).hexdigest()
def blob(data:bytes)->str: return hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()
def find_file(roots:list[Path], no:int, name:str)->Path|None:
    for root in roots:
        for p in (root/f'chat-{no}'/name,root/f'xod-chat{no}-work'/name,root/name):
            if p.is_file(): return p
    return None

def download_public_patch(no:int, name:str)->bytes:
    # Optional only. Never add credentials to output or store them in reports.
    path=f'ai-workspace/submissions/chat-{no}/{name}'
    url=f'https://api.github.com/repos/{REPOSITORY}/contents/{urllib.parse.quote(path)}?ref={BRANCH}'
    headers={'Accept':'application/vnd.github+json','User-Agent':'XOD-CHAT32-source-gate'}
    token=os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=25) as response: obj=json.load(response)
    if obj.get('encoding')!='base64':raise GateError(f'GitHub patch {no}: not base64 content')
    return base64.b64decode(obj['content'],validate=False)

def command(argv:list[str],cwd:Path|None=None,timeout:int=60)->subprocess.CompletedProcess:
    return subprocess.run(argv,cwd=cwd,capture_output=True,text=True,timeout=timeout)

class InlineScript(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=False);self.active=False;self.parts=[];self.scripts=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and dict(attrs).get('data-app','absent') is None:self.active=True;self.parts=[]
    def handle_data(self,v):
        if self.active:self.parts.append(v)
    def handle_endtag(self,tag):
        if tag=='script' and self.active:self.scripts.append(''.join(self.parts));self.active=False

def check_script(source:Path,out:Path)->dict:
    p=InlineScript();p.feed(source.read_text(encoding='utf-8'))
    if len(p.scripts)!=1 or len(p.scripts[0])<1000000:
        raise GateError('Expected exactly one >1MB real data-app inline JavaScript block')
    out.write_text(p.scripts[0],encoding='utf-8')
    c=command(['node','--check',str(out)],timeout=45)
    if c.returncode:raise GateError('Node actual script syntax failure: '+c.stderr[:650])
    return {'result':'PASS','scripts':len(p.scripts),'script_bytes':len(p.scripts[0].encode())}

def stage_source(src:Path,target:Path)->Path:
    data=src.read_bytes()
    if sha(data)!=SOURCE_ZIP_SHA256:raise GateError('Private Test13 source ZIP hash differs: do not use this input')
    with zipfile.ZipFile(src) as z:
        bad=z.testzip()
        if bad:raise GateError('Bad source ZIP CRC '+bad)
        for item in z.infolist():
            path=Path(item.filename)
            if path.is_absolute() or '..' in path.parts:raise GateError('Unsafe ZIP path '+item.filename)
        z.extractall(target)
    matches=list(target.rglob('v224/base29.html'))
    if len(matches)!=1:raise GateError('Expected exactly one v224/base29.html in Test13 ZIP')
    original=matches[0]
    if sha(original.read_bytes())!=ORIGINAL_HTML_SHA256:raise GateError('Test13 base29.html hash mismatch')
    return original

def run_gate(args)->dict:
    mode='PARTIAL_CHAT19_21_31' if args.partial_baseline19 else 'FULL_CHAT16_31'
    report={'schema':1,'gate':'CHAT32 cumulative Test13 source-only','mode':mode,
            'source_zip_sha256':SOURCE_ZIP_SHA256,'original_base29_sha256':ORIGINAL_HTML_SHA256,
            'patches':{},'tests':{},'limits':['Node VM/synthetic dependencies, not browser E2E','not SOL checkout or integration',
             'private source and compiled bundles must not be published']}
    roots=[Path(r).resolve() for r in args.root]
    with tempfile.TemporaryDirectory(prefix='xod-chat32-source-') as temp:
        tmp=Path(temp); orig=stage_source(Path(args.source_zip),tmp/'original')
        shutil.copytree(orig.parent.parent,tmp/'stage')
        staged=tmp/'stage'/'v224'/'base29.html';root=staged.parent.parent
        if args.partial_baseline19:
            # Private local baseline already used in CHAT25. Explicit, hash-checked, not a new package.
            base=Path(args.partial_baseline19)
            if sha(base.read_bytes())!=PARTIAL_BASELINE19_SHA256:raise GateError('CHAT19 partial baseline content hash mismatch')
            staged.write_bytes(base.read_bytes())
            report['limits'].append('CHAT16–18 and CHAT20 NOT applied; CHAT19 baseline is a private prior source snapshot')
            selected=list(range(21,32))
        else:selected=list(range(16,32))
        baseline19=Path(args.partial_baseline19) if args.partial_baseline19 else None
        for no in selected:
            name,expected=PATCHES[no];p=find_file(roots,no,name)
            if p:data=p.read_bytes(); provenance='local_verified'
            elif args.fetch_missing:
                try:data=download_public_patch(no,name);provenance='github_fetched'
                except (urllib.error.URLError,KeyError,GateError) as err:raise GateError(f'CHAT{no}: no verified patch available ({type(err).__name__})') from err
            else:raise GateError(f'CHAT{no}: patch not found locally; supply --root or opt into --fetch-missing')
            if blob(data)!=expected:raise GateError(f'CHAT{no}: Git blob mismatch: {blob(data)} != {expected}')
            patch=tmp/f'chat-{no}.patch';patch.write_bytes(data)
            check=command(['git','apply','--check',str(patch)],cwd=root)
            if check.returncode:raise GateError(f'CHAT{no} patch DOES NOT APPLY after previous patches: '+check.stderr[:650])
            apply=command(['git','apply',str(patch)],cwd=root)
            if apply.returncode:raise GateError(f'CHAT{no} unexpected apply failure: '+apply.stderr[:650])
            report['patches'][str(no)]={'file':name,'git_blob':expected,'source':provenance,'apply':'PASS'}
            if no==19:
                baseline19=tmp/'baseline19.html';baseline19.write_bytes(staged.read_bytes())
        if sha(orig.read_bytes())!=ORIGINAL_HTML_SHA256:raise GateError('Original source modified while staging')
        report['script_syntax']=check_script(staged,tmp/'data-app.js')
        if args.build:
            build=command([sys.executable,'build.py',str(tmp/'build')],cwd=root,timeout=120)
            if build.returncode:raise GateError('Build failed '+build.stderr[-900:]+build.stdout[-900:])
            report['build']={'result':'PASS','stdout':build.stdout.strip()[-150:]}
        if args.test:
            cases=0
            for no,(name,count) in HARNESS.items():
                hp=find_file(roots,no,name)
                if hp is None:raise GateError(f'CHAT{no}: missing verified source test harness {name}')
                if no==29 and 'let mxDetachTrackBusy = false;' in staged.read_text():
                    # Test-only parser adjustment for CHAT31 async signature. Assertions untouched.
                    old="'function mxDetachTrack(F, kind, id, w) {'"
                    replacement="src.includes('let mxDetachTrackBusy = false;')?'let mxDetachTrackBusy = false;':"+old
                    text=hp.read_text()
                    needle="extract(src,'function mxTrackCells(F, kind, id) {',"+old+")"
                    fixed="extract(src,'function mxTrackCells(F, kind, id) {',"+replacement+")"
                    if text.count(needle)!=1:raise GateError('Cannot adapt CHAT29 harness marker deterministically')
                    adapt=tmp/'chat29_compat.js';adapt.write_text(text.replace(needle,fixed));hp=adapt
                    report['limits'].append('CHAT29 harness marker locally adapted for CHAT31 async function, assertions unchanged')
                if no==25 and baseline19 is None:raise GateError('CHAT25 requires a distinct intermediate CHAT19 baseline')
                c=command(['node',str(hp),str(orig),str(staged)]+([str(baseline19)] if no==25 else []),timeout=90)
                if c.returncode:raise GateError(f'CHAT{no} Node harness failure: '+c.stderr[-900:]+c.stdout[-900:])
                passed=sum(1 for line in c.stdout.splitlines() if line.startswith('PASS '))
                if passed!=count:raise GateError(f'CHAT{no}: test count changed {passed} expected {count}')
                report['tests'][str(no)]={'result':'PASS','count':passed};cases+=passed
            report['total_node_vm_cases']=cases
        report['status']='PASS_PARTIAL_NOT_INTEGRATED' if args.partial_baseline19 else 'PASS_SOURCE_ONLY_NOT_INTEGRATED'
        return report

def main()->None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-zip',required=True,help='Exact private Test13 ZIP, kept local')
    p.add_argument('--root',action='append',required=True,help='Patch/test roots; may be repeated')
    p.add_argument('--partial-baseline19',help='EXPLICIT partial mode: source file with CHAT19 already applied; skips CHAT16–20, never claim full')
    p.add_argument('--fetch-missing',action='store_true',help='Fetch published public patch text from GitHub when absent; optional GITHUB_TOKEN')
    p.add_argument('--test',action='store_true',help='Run CHAT21–31 isolated Node VM tests')
    p.add_argument('--build',action='store_true',help='Build staged test application locally')
    p.add_argument('--report',help='Write non-private JSON summary to given path')
    args=p.parse_args()
    try: result=run_gate(args);status=0
    except (GateError,FileNotFoundError,subprocess.TimeoutExpired,zipfile.BadZipFile) as exc:
        result={'schema':1,'gate':'CHAT32 cumulative Test13 source-only','status':'BLOCKED','reason':str(exc),
                'limits':['No browser E2E','No SOL integration','No file changes outside temporary stage']};status=2
    out=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.report:Path(args.report).write_text(out,encoding='utf-8')
    print(out)
    sys.exit(status)
if __name__=='__main__':main()
