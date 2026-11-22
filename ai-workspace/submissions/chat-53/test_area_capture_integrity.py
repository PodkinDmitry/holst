#!/usr/bin/env python3
"""Exact-source regression gate for legacy 2.27 screenshot area persistence.
Usage: python test_area_capture_integrity.py --source-zip holst-devkit-2.24.zip
Uses only a temporary Git checkout; does not touch user/browser/Test13 data.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ARCHIVE = 'c27d458f9a99dab8e1a2dc5847cd7417f4d978fe202a6e4f2fc0b62829727ed1'
BASE = 'e2396d242c04ef98fafeac921c48d8f16f301812'
PATCHED = 'bcbe86df0a43be6dea2b5e44091a20660f04a64f'
COMBINED = '511e25b491a8aa2db3a0858506cf61a82c0db790'
FILES = [
 ('48','background-queue-integrity.patch','test_queue_concurrency.js',10,'20f0fce0e31cba35ac0531052b666b7bbc1161f4','d43495588cb5b4ca6194d184521b1af28f69537a'),
 ('49','youtube-watch-progress-race.patch','test_yt_watch_race.js',12,'b8d2a080ccaec4b74d71362bb94c67f7710da74a','b6d182c2a8d1dc537e12ec834c5f5b96fdcc9313'),
 ('50','restore-state-local-wins.patch','test_restore_state_race.js',11,'048a3840782063490fdc696f46703c04194c7321','3ccff632adc417293f9d38334070e8cd904e2e7e'),
 ('51','youtube-channel-block-integrity.patch','test_yt_channel_block.js',11,'8bb9b3bb8c656efc976ab586916a37cc1ede40fc','fd18bf51ea6d45ee10cc7755d76796e8550b7d57'),
 ('52','state-backup-offline-retry.patch','test_state_backup_retry.js',11,'76db957eac8360298cf4fe60138129ad36b23d58','681b6ff84f341e1a262eeb27949c6348eab4e62c'),
 ('53','area-capture-pending-integrity.patch','test_area_capture_pending.js',14,'c37c0f3cb08cc58a62905d33d9d7b27bf04cd924','4f68ff16f54a9951315b8404c77ec7fe4550eff1'),
]
def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def run(*a,cwd=None,expect=0):
 p=subprocess.run(a,cwd=cwd,capture_output=True,text=True)
 if p.returncode!=expect:raise RuntimeError(f'{a[0]} exited {p.returncode}, expected {expect}: {p.stderr[:240]} {p.stdout[:120]}')
 return p.stdout
def check_test(test,code,n,total):
 out=json.loads(run('node',str(test),str(code),expect=0 if n==total else 1))
 if (out['passed'],out['total'])!=(n,total):raise AssertionError(f'{test.name}: {out["passed"]}/{out["total"]} != {n}/{total}')
def verify(zip_file):
 data=zip_file.read_bytes()
 if hashlib.sha256(data).hexdigest()!=ARCHIVE:raise ValueError('Wrong archive SHA256: no source or patch modified')
 with zipfile.ZipFile(zip_file) as z:src=z.read('ext224/background.js')
 if blob(src)!=BASE:raise ValueError('Wrong original source Git blob')
 root=Path(__file__).resolve().parent
 artifacts=[]
 for id,pn,tn,n,ps,ts in FILES:
  folder=root.parent/('chat-'+id);p=folder/pn;t=folder/tn
  if not p.is_file() or not t.is_file():raise ValueError('Missing reproducible test artifact')
  if blob(p.read_bytes())!=ps or blob(t.read_bytes())!=ts:raise ValueError('Unexpected published patch/test Git blob')
  artifacts.append((p,t,n))
 with tempfile.TemporaryDirectory(prefix='xod53-source-gate-') as td:
  wd=Path(td);js=wd/'ext224/background.js';js.parent.mkdir();js.write_bytes(src)
  run('git','init','-q',cwd=wd);run('git','add','ext224/background.js',cwd=wd)
  run('node','--check',str(js));check_test(artifacts[-1][1],js,3,14)
  run('git','apply','--check',str(artifacts[-1][0]),cwd=wd)
  run('git','apply',str(artifacts[-1][0]),cwd=wd)
  if blob(js.read_bytes())!=PATCHED:raise AssertionError('Unexpected independent patch blob')
  run('node','--check',str(js));check_test(artifacts[-1][1],js,14,14)
  run('git','apply','--reverse','--check',str(artifacts[-1][0]),cwd=wd)
  js.write_bytes(src)
  for p,_,_ in artifacts:
   run('git','apply','--check',str(p),cwd=wd)
   run('git','apply',str(p),cwd=wd)
  if blob(js.read_bytes())!=COMBINED:raise AssertionError('Unexpected combined six-patch blob')
  run('node','--check',str(js))
  for _,t,n in artifacts:check_test(t,js,n,n)
 return {'status':'SOURCE_ONLY_FIX_PASS','before':'3/14 PASS','after':'14/14 PASS','combined':'69/69 PASS, canonical patch order','combined_git_blob':COMBINED,'private_Test13':'NOT_AVAILABLE','browser_E2E':'NOT_RUN','product_integrated':False}
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source-zip',type=Path,required=True);ns=parser.parse_args()
 try:print(json.dumps(verify(ns.source_zip),ensure_ascii=False,indent=2));return 0
 except (OSError,ValueError,AssertionError,RuntimeError,zipfile.BadZipFile,KeyError,json.JSONDecodeError) as e:print(json.dumps({'status':'SOURCE_ONLY_FIX_FAIL','reason':str(e)},ensure_ascii=False));return 1
if __name__=='__main__':sys.exit(main())
