#!/usr/bin/env python3
"""Read-only Git HEAD disclosure gate for handing XOD source to shared GitHub.

This catches common secrets, browser/user-data artifacts and oversized embedded HTML.
A pass is only a preliminary check, never a proof that every file is publishable.
"""
import argparse
import fnmatch
import hashlib
import json
import pathlib
import re
import subprocess
import sys

BAD_NAMES = (
    '.env', '.env.*', '*private*key*', '*credential*', '*secret*', '*password*',
    '*token*', '*cookies*', '*session*', '*user*data*', '*personal*',
    '*profile*', '*backup*', '*.sqlite', '*.db', '*.zip', '*.crx', '*.pem',
    '*.p12', '*.pfx', '*.log', '*.har', '*.webm', 'floating*.json',
)
TOKEN_RE = re.compile(rb'ghp_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{15,}')


def git(repo, *args):
    p = subprocess.run(['git', '-C', str(repo), *args], stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, check=False)
    if p.returncode:
        raise RuntimeError('git ' + ' '.join(args) + ': ' + p.stderr.decode(errors='replace').strip()[:300])
    return p.stdout


def inspect(repo, max_blob_mb):
    sha = git(repo, 'rev-parse', 'HEAD').decode().strip()
    dirty = git(repo, 'status', '--porcelain', '--untracked-files=normal')
    raw = git(repo, 'ls-tree', '-r', '-z', '--full-tree', 'HEAD')
    flags, files, total_bytes = [], [], 0
    for record in raw.split(b'\0'):
        if not record:
            continue
        meta, name_b = record.split(b'\t', 1)
        mode, typ, oid = meta.decode().split()
        name = name_b.decode('utf-8', 'surrogateescape')
        parts = [p.lower() for p in pathlib.PurePosixPath(name).parts]
        base = parts[-1]
        reasons = []
        if mode == '120000':
            reasons.append('symlink')
        if typ != 'blob':
            reasons.append('unexpected-git-type')
        if any(fnmatch.fnmatch(base, p) for p in BAD_NAMES):
            reasons.append('possible-secret-or-personal-file')
        if any(p in ('node_modules', '.git', '.cache', 'browser-profile', 'userdata', 'user-data') for p in parts):
            reasons.append('runtime-data-directory')
        b = git(repo, 'cat-file', 'blob', oid)
        total_bytes += len(b)
        if len(b) > max_blob_mb * 1024 * 1024:
            reasons.append('large-embedded-blob')
        if TOKEN_RE.search(b[:4*1024*1024]):
            reasons.append('possible-credential-in-content')
        files.append({'path':name,'sha256':hashlib.sha256(b).hexdigest(),'size':len(b)})
        if reasons:
            flags.append({'path':name,'reasons':reasons})
    if dirty:
        flags.insert(0, {'path':'(working tree)', 'reasons':['uncommitted-or-untracked-files; HEAD is not current state']})
    return {'source_commit':sha,'tracked_files':len(files),'tracked_bytes':total_bytes,
            'flags':flags,'safe_to_review_for_push':not bool(flags), 'files':files}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',default='.',help='Path to the actual XOD git repository')
    p.add_argument('--manifest',help='Write a SHA256 manifest locally (never uploads)')
    p.add_argument('--max-blob-mb',type=int,default=4)
    a=p.parse_args()
    if a.max_blob_mb < 1:
        p.error('--max-blob-mb must be positive')
    try:
        result=inspect(pathlib.Path(a.repo).resolve(),a.max_blob_mb)
    except (RuntimeError,OSError,ValueError) as e:
        print(json.dumps({'error':str(e)},ensure_ascii=False),file=sys.stderr)
        return 3
    if a.manifest:
        pathlib.Path(a.manifest).write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    summary={k:v for k,v in result.items() if k!='files'}
    print(json.dumps(summary,indent=2,ensure_ascii=False))
    return 0 if result['safe_to_review_for_push'] else 2


if __name__=='__main__':
    sys.exit(main())
