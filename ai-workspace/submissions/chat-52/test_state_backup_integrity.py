#!/usr/bin/env python3
"""Exact-source safety gate for legacy v2.27 Holst state backup.

python test_state_backup_integrity.py --source-zip /path/to/holst-devkit-2.24.zip
Requires Node and Git; only temporary Git checkouts change. NOT product E2E.
"""
import argparse
import hashlib
import itertools
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ZIP_SHA='c27d458f9a99dab8e1a2dc5847cd7417f4d978fe202a6e4f2fc0b62829727ed1'
BASE_BLOB='e2396d242c04ef98fafeac921c48d8f16f301812'
PATCHED_BLOB='4858611e140c8abd99a62e52ce8ca2ee8817f9cd'
COMBINED_BLOB='76a85231f0ea7336d957217963325034a484c040'
EXPECTED_FAILURES={'offline-edits-have-durable-pending-token','restore-after-worker-restart-delivers-pending-settings','negative-ack-cannot-discard-pending-backup','alarm-retries-previously-failed-backup','bridge-ready-retries-without-new-user-edits'}
ARTIFACTS=[
 ('48','background-queue-integrity.patch','test_queue_concurrency.js',10,'20f0fce0e31cba35ac0531052b666b7bbc1161f4','d43495588cb5b4ca6194d184521b1af28f69537a'),
 ('49','youtube-watch-progress-race.patch','test_yt_watch_race.js',12,'b8d2a080ccaec4b74d71362bb94c67f7710da74a','b6d182c2a8d1dc537e12ec834c5f5b96fdcc9313'),
 ('50','restore-state-local-wins.patch','test_restore_state_race.js',11,'048a3840782063490fdc696f46703c04194c7321','3ccff632adc417293f9d38334070e8cd904e2e7e'),
 ('51','youtube-channel-block-integrity.patch','test_yt_channel_block.js',11,'8bb9b3bb8c656efc976ab586916a37cc1ede40fc','fd18bf51ea6d45ee10cc7755d76796e8550b7d57'),
 ('52','state-backup-offline-retry.patch','test_state_backup_retry.js',11,'76db957eac8360298cf4fe60138129ad36b23d58','681b6ff84f341e1a262eeb27949c6348eab4e62c'),
]
def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def run(*cmd,cwd=None,expected=0):
 p=subprocess.run(cmd,cwd=cwd,text=True,capture_output=True)
 if p.returncode!=expected: raise RuntimeError(f'{cmd[0]} expected {expected}, got {p.returncode}: {p.stderr[:350]} {p.stdout[:150]}')
 return p.stdout

def start(root,src):
 f=root/'ext224/background.js';f.parent.mkdir(exist_ok=True,parents=True);f.write_bytes(src)
 run('git','init','-q',cwd=root);run('git','add','ext224/background.js',cwd=root)
 return f

def test(testfile,source,expected,total,failures=None):
 got=json.loads(run('node',str(testfile),str(source),expected=0 if expected==total else 1))
 if (got['passed'],got['total'])!=(expected,total):raise AssertionError(f'{testfile.name}: expected {expected}/{total} got {got["passed"]}/{got["total"]}')
 if failures is not None and {x['name'] for x in got['results'] if x['status']=='FAIL'}!=failures:raise AssertionError('Baseline failing cases do not match')

def verify(zip_path,root):
 if hashlib.sha256(zip_path.read_bytes()).hexdigest()!=ZIP_SHA:raise ValueError('Unknown ZIP SHA256; refusing patch')
 with zipfile.ZipFile(zip_path) as z:src=z.read('ext224/background.js')
 if blob(src)!=BASE_BLOB:raise ValueError('Unknown original JS blob')
 artifact_paths=[]
 for id,p,t,n,ps,ts in ARTIFACTS:
  patch=root.parent/('chat-'+id)/p;testfile=root.parent/('chat-'+id)/t
  if not patch.is_file() or not testfile.is_file():raise ValueError('Missing dependency: '+str(patch))
  if blob(patch.read_bytes())!=ps or blob(testfile.read_bytes())!=ts:raise ValueError('Published artifact changed: '+str(patch))
  artifact_paths.append((patch,testfile))
 with tempfile.TemporaryDirectory(prefix='xod52-before-after-') as td:
  wd=Path(td);f=start(wd,src)
  run('node','--check',str(f));test(artifact_paths[-1][1],f,6,11,EXPECTED_FAILURES)
  run('git','apply','--check',str(artifact_paths[-1][0]),cwd=wd)
  run('git','apply',str(artifact_paths[-1][0]),cwd=wd)
  if blob(f.read_bytes())!=PATCHED_BLOB:raise AssertionError('Patched JS SHA mismatch')
  run('node','--check',str(f));test(artifact_paths[-1][1],f,11,11)
  run('git','apply','--reverse','--check',str(artifact_paths[-1][0]),cwd=wd)
 for index,order in enumerate(itertools.permutations(range(5)),1):
  with tempfile.TemporaryDirectory(prefix='xod52-allpatch-') as td:
   wd=Path(td);f=start(wd,src)
   for j in order:
    run('git','apply','--check',str(artifact_paths[j][0]),cwd=wd)
    run('git','apply',str(artifact_paths[j][0]),cwd=wd)
   if blob(f.read_bytes())!=COMBINED_BLOB:raise AssertionError(f'Combined blob differs for order {order}')
   run('node','--check',str(f))
   if index in (1,2,24,48,72,96,120):
    for (patch,testfile),row in zip(artifact_paths,ARTIFACTS):test(testfile,f,row[3],row[3])
  if index%24==0:print(f'progress {index}/120 orders · identical code blob',file=sys.stderr,flush=True)
 return {'status':'SOURCE_ONLY_FIX_PASS','archive_sha256':ZIP_SHA,'source_git_blob':BASE_BLOB,'patched_git_blob':PATCHED_BLOB,'combined_git_blob':COMBINED_BLOB,'before':'6/11 PASS (5 expected FAIL)','after':'11/11 PASS','compatibility':'120/120 application orders produce identical Git blob, 55/55 tests on 7 representative orders','current_private_test13':'NOT_AVAILABLE','real_browser_e2e':'NOT_RUN','beta_build':'NOT_BUILT','limitation':'MV3 worker changes before pending-marker persistence and external writers are not fully atomic'}

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--source-zip',type=Path,required=True);args=ap.parse_args()
 try: print(json.dumps(verify(args.source_zip,Path(__file__).resolve().parent),ensure_ascii=False,indent=2));return 0
 except (AssertionError,ValueError,RuntimeError,OSError,KeyError,zipfile.BadZipFile,json.JSONDecodeError) as e:print(json.dumps({'status':'SOURCE_ONLY_FIX_FAIL','error':str(e)},ensure_ascii=False));return 1
if __name__=='__main__':sys.exit(main())
