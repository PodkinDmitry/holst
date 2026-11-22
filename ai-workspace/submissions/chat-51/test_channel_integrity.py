#!/usr/bin/env python3
"""Exact-source YouTube channel-block persistence regression; does not use a browser.

python test_channel_integrity.py --source-zip /path/to/holst-devkit-2.24.zip
Runs fail-before/pass-after and all 24 orders of four previously independent patches.
Only disposable worktrees are changed. Node.js and Git required.
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

ZIP_SHA256 = 'c27d458f9a99dab8e1a2dc5847cd7417f4d978fe202a6e4f2fc0b62829727ed1'
SOURCE_BLOB = 'e2396d242c04ef98fafeac921c48d8f16f301812'
FIXED_BLOB = '919d5f931606a0927523f79738a7d13f73d60ec0'
EXPECTED_FAIL_BEFORE = {
    'parallel-channel-blocks-are-all-kept',
    'remote-refusal-must-create-durable-outbox-item',
    'offline-block-acknowledgement-must-be-queued',
    'remote-block-then-unblock-preserves-order',
    'concurrent-unblock-does-not-erase-unrelated-channel',
    'failed-queue-persistence-not-reported-as-success',
    'offline-block-and-unblock-preserve-send-order',
}
PRIOR_PATCH_BLOBS = (
    '20f0fce0e31cba35ac0531052b666b7bbc1161f4',
    'b8d2a080ccaec4b74d71362bb94c67f7710da74a',
    '048a3840782063490fdc696f46703c04194c7321',
)
PRIOR_TEST_BLOBS = (
    'd43495588cb5b4ca6194d184521b1af28f69537a',
    'b6d182c2a8d1dc537e12ec834c5f5b96fdcc9313',
    '3ccff632adc417293f9d38334070e8cd904e2e7e',
)

def blob(data):
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()

def run(*args, cwd=None, expected=0):
    p = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if p.returncode != expected:
        raise RuntimeError(f'{args[0]} return {p.returncode}, expected {expected}: {p.stderr[:300]} {p.stdout[:100]}')
    return p.stdout

def bootstrap(temp, source):
    root = Path(temp)
    target = root / 'ext224' / 'background.js'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source)
    run('git', 'init', '-q', cwd=root)
    run('git', 'add', 'ext224/background.js', cwd=root)
    return target

def test_js(test_path, target, passing, total, failed=None):
    result = json.loads(run('node', str(test_path), str(target), expected=0 if passing == total else 1))
    if (result['passed'], result['total']) != (passing, total):
        raise AssertionError(f'{test_path.name}: expected {passing}/{total}, got {result["passed"]}/{result["total"]}')
    if failed is not None and {x['name'] for x in result['results'] if x['status'] == 'FAIL'} != failed:
        raise AssertionError('Unexpected fail-before regression set')

def verify(zip_path, here):
    raw = zip_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ZIP_SHA256:
        raise ValueError('Unknown archive SHA256; patch and tests not applied')
    with zipfile.ZipFile(zip_path) as archive:
        source = archive.read('ext224/background.js')
    if blob(source) != SOURCE_BLOB:
        raise ValueError('Unknown source Git blob; refusing to run')
    names = [
      ('48', 'background-queue-integrity.patch', 'test_queue_concurrency.js'),
      ('49', 'youtube-watch-progress-race.patch', 'test_yt_watch_race.js'),
      ('50', 'restore-state-local-wins.patch', 'test_restore_state_race.js'),
      ('51', 'youtube-channel-block-integrity.patch', 'test_yt_channel_block.js'),
    ]
    patches = [here.parent / f'chat-{n}' / pn for n, pn, _ in names]
    tests = [here.parent / f'chat-{n}' / tn for n, _, tn in names]
    for i, (p, t) in enumerate(zip(patches, tests)):
        if not p.is_file() or not t.is_file():
            raise ValueError(f'Missing source-test dependency: {p} or {t}')
        if i < 3 and (blob(p.read_bytes()) != PRIOR_PATCH_BLOBS[i] or blob(t.read_bytes()) != PRIOR_TEST_BLOBS[i]):
            raise ValueError(f'Prior published artifact mismatch: {p.name}')
    with tempfile.TemporaryDirectory(prefix='xod-channel-alone-') as tmp:
        file = bootstrap(tmp, source)
        run('node', '--check', str(file))
        test_js(tests[3], file, 4, 11, EXPECTED_FAIL_BEFORE)
        run('git', 'apply', '--check', str(patches[3]), cwd=tmp)
        run('git', 'apply', str(patches[3]), cwd=tmp)
        if blob(file.read_bytes()) != FIXED_BLOB:
            raise AssertionError('Patched source Git blob differs')
        run('node', '--check', str(file))
        test_js(tests[3], file, 11, 11)
        run('git', 'apply', '--reverse', '--check', str(patches[3]), cwd=tmp)
    perms = []
    for order in itertools.permutations(range(4)):
        with tempfile.TemporaryDirectory(prefix='xod-channel-compat-') as tmp:
            file = bootstrap(tmp, source)
            for i in order:
                run('git', 'apply', '--check', str(patches[i]), cwd=tmp)
                run('git', 'apply', str(patches[i]), cwd=tmp)
            run('node', '--check', str(file))
            for i, total in enumerate([10, 12, 11, 11]):
                test_js(tests[i], file, total, total)
            perms.append('>'.join(names[i][0] for i in order))
    return {'status': 'SOURCE_ONLY_FIX_PASS', 'archive_sha256': ZIP_SHA256,
            'source_git_blob': SOURCE_BLOB, 'patched_git_blob': FIXED_BLOB,
            'before': '4/11 PASS (7 expected FAIL)', 'after': '11/11 PASS',
            'combined': '24 orders, 44/44 PASS per order', 'orders': perms,
            'current_private_test13': 'NOT_AVAILABLE', 'browser_e2e': 'NOT_RUN',
            'release_integrated': False, 'real_beta': 'NOT_BUILT'}

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-zip', required=True, type=Path)
    args = ap.parse_args()
    try:
        print(json.dumps(verify(args.source_zip, Path(__file__).resolve().parent), ensure_ascii=False, indent=2))
        return 0
    except (RuntimeError, ValueError, OSError, AssertionError, zipfile.BadZipFile, KeyError, json.JSONDecodeError) as e:
        print(json.dumps({'status': 'SOURCE_ONLY_FIX_FAIL', 'reason': str(e)}, ensure_ascii=False))
        return 1

if __name__ == '__main__':
    sys.exit(main())
