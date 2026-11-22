#!/usr/bin/env python3
"""CHAT34: extend the pinned CHAT32 full source gate with exact CHAT16–20 Node VM suites.

Public test-only orchestration. Requires a PRIVATE Test13 ZIP that is never exported.
No product-code changes, no browser or SOL integration are asserted.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

GATE_BLOB = 'a5b1f002020759882df7f942ffa8c6ddc64663d1'
HARNESSES = {
 16: ('beforeunload_guard_gate.js','02cf5c9833d01272d69aac567791d1bc1ebbc434',10),
 17: ('virtual_writeback_source_gate.js','f9601700d329ac6b5f36250c475726ae42c324d3',8),
 18: ('board_navigation_source_gate.js','eedb861ba590a95baaeb0843371306da2c5e8045',15),
 19: ('secondary_routes_source_gate.js','0f88035c2793c058caf9d823ab2c20aee8cae185',18),
 20: ('filter_mode_source_gate.js','a4843ed48d56f10a0b6b3965c1a110f69e1b658d',18),
}

def blob(data:bytes)->str:
    return hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()

def gate_from(path:Path):
    if blob(path.read_bytes())!=GATE_BLOB:
        raise RuntimeError('The CHAT32 cumulative source gate is not the pinned published version')
    spec=importlib.util.spec_from_file_location('xod_chat32_cumulative_gate',path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def find_test(roots:list[Path],number:int,name:str)->Path:
    for root in roots:
        for trial in (root/f'chat-{number}'/name,root/f'xod-chat{number}-work'/name,root/name):
            if trial.is_file():return trial
    raise RuntimeError(f'CHAT{number} original harness unavailable: {name}')

def run_node(args:list[str],expected:int,label:str)->dict:
    r=subprocess.run(['node',*args],text=True,capture_output=True,timeout=90)
    n=sum(x.startswith('PASS ') for x in r.stdout.splitlines())
    if r.returncode or n!=expected or f'TOTAL {expected}/{expected} PASS' not in r.stdout:
        raise RuntimeError(f'{label} FAIL, exit {r.returncode}, cases {n}/{expected}: ' +r.stderr[-700:]+r.stdout[-700:])
    return {'status':'PASS','cases':n}

def create_chat19_adapter(raw:str)->str:
    """Only adapt a fixture variable and assert the stronger CHAT25 active-last order."""
    fixes=[
        ("'let saveTimer=0,dirty=false,saving=false,saveAgain=false;',",
         "'let saveTimer=0,dirty=false,saving=false,saveAgain=false; let bselDeleteBusy = false;',"),
        ("assert.deepEqual(m.stats.deletions,['A','B']);assert.equal(m.S.board.id,'new');assert.equal(m.stats.saveCalls,2);",
         "assert.deepEqual(m.stats.deletions,['B','A']);assert.equal(m.S.board.id,'new');assert.equal(m.stats.saveCalls,2);"),
    ]
    for old,new in fixes:
        if raw.count(old)!=1:raise RuntimeError('CHAT19 test-only compatibility anchor absent/ambiguous: '+old[:42])
        raw=raw.replace(old,new)
    return raw

def run(args):
    gate=gate_from(args.gate)
    roots=[p.resolve() for p in args.root]
    report={'schema':1,'gate':'CHAT34 extended full Test13 Node VM regression',
      'mode':'FULL_CHAT16_31','status':'STARTED','product_patches_modified':False,
      'harnesses':{},'original_chat19_historical_control':{},
      'chat19_full_stage_adapter':{'mode':'test-only temporary copy',
        'why':'CHAT25 adds bselDeleteBusy and moves active-board deletion last',
        'changes':['declare bselDeleteBusy=false inside Node VM fixture',
          'replace outdated successful bulk-delete expectation A,B with safety-specific B,A'],
        'product_source_modified':False, 'published_original_harness_modified':False},
      'source_limitations':['synthetic Node VM, not Chrome/Edge E2E',
         'not a real SOL checkout/IndexedDB/Drive integration']}
    with tempfile.TemporaryDirectory(prefix='chat34-full-test13-') as td:
        temp=Path(td)
        original=gate.stage_source(args.source_zip,temp/'original')
        shutil.copytree(original.parent.parent,temp/'stage')
        staged=temp/'stage'/'v224'/'base29.html'
        chat18=None;chat19=None;chat20=None
        for no in range(16,32):
            filename,sha=gate.PATCHES[no]
            p=find_test(roots,no,filename)
            if blob(p.read_bytes())!=sha:raise RuntimeError(f'CHAT{no} product patch SHA differs')
            for suffix in (['--check'],[]):
                cp=subprocess.run(['git','apply',*suffix,str(p)],cwd=staged.parent.parent,capture_output=True,text=True,timeout=40)
                if cp.returncode:raise RuntimeError(f'CHAT{no} git apply failed: '+cp.stderr[:600])
            if no in (18,19,20):
                snapshot=temp/f'chat{no}.html';shutil.copy2(staged,snapshot)
                if no==18:chat18=snapshot
                if no==19:chat19=snapshot
                if no==20:chat20=snapshot
        if gate.sha(original.read_bytes())!=gate.ORIGINAL_HTML_SHA256:
            raise RuntimeError('Private original changed')
        report['patches']={'count':16,'status':'PASS','all_sha_verified':True}
        report['source_sha256']=gate.sha(staged.read_bytes())
        report['actual_script']=gate.check_script(staged,temp/'app-script.js')
        # Native CHAT19 test is re-run unchanged on its historical CHAT20-era implementation.
        f19,sha19,c19=HARNESSES[19]
        raw19=find_test(roots,19,f19)
        if blob(raw19.read_bytes())!=sha19:raise RuntimeError('CHAT19 original published harness SHA differs')
        report['original_chat19_historical_control']=run_node(
            [str(raw19),str(original),str(chat20),str(chat18)],18,'CHAT19 historical raw')
        for no,(name,sha,count) in HARNESSES.items():
            harness=find_test(roots,no,name)
            if blob(harness.read_bytes())!=sha:raise RuntimeError(f'CHAT{no} harness SHA differs')
            run=harness
            if no==19:
                run=temp/'chat19_full_compat_only.js'
                run.write_text(create_chat19_adapter(harness.read_text(encoding='utf-8')),encoding='utf-8')
            params=[str(run),str(original),str(staged)]
            if no==19:params.append(str(chat18))
            report['harnesses'][str(no)]=run_node(params,count,f'CHAT{no} full stage')
        report['chat16_20_node_cases']=sum(x['cases'] for x in report['harnesses'].values())
    if args.recheck_prior:
        # Original published gate (not a replacement), with its pinned 338 cases and build.
        from types import SimpleNamespace
        cmd=SimpleNamespace(source_zip=str(args.source_zip),root=[str(p) for p in roots],
                            partial_baseline19=None,fetch_missing=False,test=True,build=True)
        prior=gate.run_gate(cmd)
        if prior['status']!='PASS_SOURCE_ONLY_NOT_INTEGRATED' or prior.get('total_node_vm_cases')!=338:
            raise RuntimeError('Existing 338 source tests did not pass on full stage')
        report['chat21_31_node_cases']=prior['total_node_vm_cases']
        report['build']=prior['build']
        report['full_inline_js_check']=prior['script_syntax']
    report['total_node_vm_cases']=report['chat16_20_node_cases']+report.get('chat21_31_node_cases',0)
    report['status']='PASS_SOURCE_ONLY_NOT_INTEGRATED'
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-zip',required=True,type=Path)
    p.add_argument('--gate',required=True,type=Path)
    p.add_argument('--root',required=True,action='append',type=Path)
    p.add_argument('--recheck-prior',action='store_true')
    p.add_argument('--report',type=Path)
    a=p.parse_args()
    try:
        result=run(a);code=0
    except Exception as e:
        result={'schema':1,'gate':'CHAT34 extended full Test13 Node VM regression',
          'status':'BLOCKED','reason':str(e),'scope':'Source-only Node VM; no browser/SOL integration'}
        code=2
    output=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if a.report:a.report.write_text(output,encoding='utf-8')
    print(output)
    sys.exit(code)
if __name__=='__main__':main()
