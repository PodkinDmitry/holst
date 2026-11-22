#!/usr/bin/env python3
"""XOD: one-command, isolated local build / gate / package with truthful status.

No AI/API calls, network uploads, credentials, repository writes or background jobs.
Requires Python 3.10+; Node.js for JS syntax check; Playwright for --browser-test.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

MAX_ZIP_BYTES = 1024 * 1024 * 1024


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def unpack_safe(source: Path, dest: Path) -> int:
    total = 0
    with zipfile.ZipFile(source) as z:
        for info in z.infolist():
            p = PurePosixPath(info.filename)
            if not info.filename or p.is_absolute() or '..' in p.parts or '\\' in info.filename:
                raise ValueError('Unsafe zip entry')
            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise ValueError('Zip symlink forbidden')
            total += info.file_size
            if total > MAX_ZIP_BYTES:
                raise ValueError('Uncompressed input exceeds 1 GiB')
            target = dest.joinpath(*p.parts)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as src, target.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
    return total


def archive_tree(src: Path, destination: Path) -> None:
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(src.rglob('*')):
            if p.is_file() and not p.is_symlink():
                z.write(p, p.relative_to(src).as_posix())


def run_command(args: list[str], cwd: Path, timeout: int, logs: Path, label: str) -> dict:
    entry = {'gate': label, 'command': args, 'started': time.time(), 'status': 'FAIL'}
    try:
        with logs.open('ab') as f:
            f.write(('\n=== ' + label + ': ' + ' '.join(args) + ' ===\n').encode('utf8'))
            r = subprocess.run(args, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, timeout=timeout, check=False)
        entry.update({'exit_code': r.returncode, 'status': 'PASS' if r.returncode == 0 else 'FAIL'})
        if r.returncode and label in ('browser-smoke','xod3-browser-regression'):
            tail=logs.read_bytes()[-6000:].decode('utf8','replace')
            if 'Executable doesn\'t exist' in tail or 'playwright install' in tail:
                entry.update({'status':'BLOCKED_ENVIRONMENT', 'reason':'Playwright browser executable missing'})
    except subprocess.TimeoutExpired:
        entry.update({'status': 'TIMEOUT'})
    except OSError as e:
        entry.update({'status': 'BLOCKED', 'reason': type(e).__name__})
    entry['seconds'] = round(time.time()-entry.pop('started'), 2)
    return entry


def inline_js(source: Path, target: Path) -> None:
    text = source.read_text(encoding='utf8')
    scripts = re.findall(r'<script(?![^>]*src=)[^>]*>([\s\S]*?)</script>', text, flags=re.I)
    if not scripts:
        raise RuntimeError('No inline JavaScript found; cannot verify script syntax')
    target.write_text(max(scripts, key=len), encoding='utf8')


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True, help='Trusted local devkit .zip or source directory')
    p.add_argument('--out', type=Path, required=True, help='New output directory; never a source directory')
    p.add_argument('--profile', choices=['detect', 'legacy224', 'xod3'], default='detect')
    p.add_argument('--browser-test', action='store_true', help='Opt-in real browser smoke/regression; may need installed Playwright')
    p.add_argument('--timeout', type=int, default=600, help='Per-command timeout (seconds)')
    args=p.parse_args()
    source=args.source.expanduser().resolve()
    out=args.out.expanduser().resolve()
    if not source.exists(): p.error('Source does not exist')
    if args.timeout < 1 or args.timeout > 3600: p.error('Timeout must be 1..3600 s')
    if out == source or source in out.parents or (source.is_dir() and out in source.parents):
        p.error('Output must not overlap source')
    if out.exists() and any(out.iterdir()): p.error('Output must be new or empty')
    out.mkdir(parents=True, exist_ok=True)
    log = out/'cycle.log'
    report={'schema':1,'source_kind':'zip' if source.is_file() else 'directory',
            'input_sha256':sha256(source) if source.is_file() else None,
            'profile':None,'gates':[],'artifacts':[],
            'product_release_accepted':False,'drive_live_e2e':'NOT_RUN',
            'user_acceptance':'NOT_RUN', 'main_modified':False,
            'premium_model_used':False}
    exitcode=2
    started=time.time()
    try:
        with tempfile.TemporaryDirectory(prefix='xod-cycle-') as td:
            root=Path(td)/'source';root.mkdir()
            if source.is_file():
                unpack_safe(source,root)
            else:
                # Private inputs remain only on the local machine; never uploaded.
                shutil.copytree(source,root,dirs_exist_ok=True,symlinks=False)
            profile=args.profile
            if profile=='detect':
                profile='xod3' if (root/'build.py').exists() else 'legacy224' if (root/'v224/patch224.py').exists() else ''
            if not profile: raise RuntimeError('No known build recipe detected')
            report['profile']=profile
            def gate(name, command, cwd):
                nonlocal exitcode
                entry=run_command(command,cwd,args.timeout,log,name)
                report['gates'].append(entry)
                if entry['status']!='PASS':
                    raise RuntimeError(f'{name}: {entry["status"]}')
            if profile=='legacy224':
                v=root/'v224';app=root/'app224';ext=root/'ext224'
                if not (v/'patch224.py').exists() or not app.is_dir() or not ext.is_dir():
                    raise RuntimeError('Missing legacy224 source layout')
                gate('legacy224-build',['python3','patch224.py'],v)
                html=v/'holst.html'
                if not html.exists() or html.stat().st_size<1024:raise RuntimeError('No generated page')
                (app/'index.html').write_bytes(html.read_bytes())
                inline_js(html,Path(td)/'inline.js')
                gate('inline-js-syntax',['node','--check',str(Path(td)/'inline.js')],v)
                # Produce packages before optional browser gate: a missing browser must
                # not destroy a valid build artifact.
                archive_tree(app,out/'holst-app.zip');archive_tree(ext,out/'holst-extension.zip')
                shutil.copy2(html,out/'holst.html')
                if args.browser_test:
                    smoke=root/'t224/x/smoke.py'
                    if not smoke.exists(): raise RuntimeError('Browser smoke script missing')
                    gate('browser-smoke',['python3',str(smoke),str(app)],root)
                else:
                    report['gates'].append({'gate':'browser-smoke','status':'NOT_RUN','reason':'Use --browser-test'})
            else:
                build=root/'build.py';tests=root/'tests/app_regression.py'
                if not build.exists(): raise RuntimeError('Missing XOD3 build.py')
                gate('xod3-build',[sys.executable,str(build),'dist'],root)
                dist=root/'dist'
                if not dist.is_dir(): raise RuntimeError('Build succeeded but no dist/ found; inspect recipe manually')
                archive_tree(dist,out/'xod-dist.zip')
                if args.browser_test:
                    if not tests.exists(): raise RuntimeError('No tests/app_regression.py')
                    gate('xod3-browser-regression',[sys.executable,str(tests)],root)
                else:
                    report['gates'].append({'gate':'xod3-browser-regression','status':'NOT_RUN','reason':'Use --browser-test'})
            report['status']='BUILD_AND_SELECTED_GATES_PASS'
            exitcode=0
    except Exception as ex:
        report['status']='BLOCKED_OR_FAILED'
        report['error']=f'{type(ex).__name__}: {str(ex)[:500]}'
        exitcode=2
    finally:
        for artifact in sorted(out.iterdir()):
            if artifact.is_file() and artifact.suffix in ('.zip','.html'):
                report['artifacts'].append({'name':artifact.name,'sha256':sha256(artifact),'bytes':artifact.stat().st_size})
        report['elapsed_seconds']=round(time.time()-started,2)
        (out/'cycle.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        print(json.dumps({'status':report['status'],'profile':report['profile'],'gates':[(x['gate'],x['status']) for x in report['gates']], 'artifacts':[x['name'] for x in report['artifacts']], 'report':str(out/'cycle.json')},ensure_ascii=False))
    return exitcode

if __name__=='__main__':
    raise SystemExit(main())