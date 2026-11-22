#!/usr/bin/env python3
"""Verify the exact legacy Holst 2.27 source and source-backed sender authorization.

python test_fetch_sender_integrity.py --source-zip /path/to/holst-devkit-2.24.zip
Requires Node.js and git, uses temporary checkouts only. Not a real browser E2E.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ZIP_SHA = 'c27d458f9a99dab8e1a2dc5847cd7417f4d978fe202a6e4f2fc0b62829727ed1'
BASE = 'e2396d242c04ef98fafeac921c48d8f16f301812'
PATCHED = '169250aa064ffcf39df31531018ab6fb1d9d270e'
COMBINED = '0e694c9b9a466cdfd35c1b0609526449beaf7a30'
ARTIFACTS = [
    ('48', 'background-queue-integrity.patch', 'test_queue_concurrency.js', 10, '20f0fce0e31cba35ac0531052b666b7bbc1161f4', 'd43495588cb5b4ca6194d184521b1af28f69537a'),
    ('49', 'youtube-watch-progress-race.patch', 'test_yt_watch_race.js', 12, 'b8d2a080ccaec4b74d71362bb94c67f7710da74a', 'b6d182c2a8d1dc537e12ec834c5f5b96fdcc9313'),
    ('50', 'restore-state-local-wins.patch', 'test_restore_state_race.js', 11, '048a3840782063490fdc696f46703c04194c7321', '3ccff632adc417293f9d38334070e8cd904e2e7e'),
    ('51', 'youtube-channel-block-integrity.patch', 'test_yt_channel_block.js', 11, '8bb9b3bb8c656efc976ab586916a37cc1ede40fc', 'fd18bf51ea6d45ee10cc7755d76796e8550b7d57'),
    ('52', 'state-backup-offline-retry.patch', 'test_state_backup_retry.js', 11, '76db957eac8360298cf4fe60138129ad36b23d58', '681b6ff84f341e1a262eeb27949c6348eab4e62c'),
    ('53', 'area-capture-pending-integrity.patch', 'test_area_capture_pending.js', 14, 'c37c0f3cb08cc58a62905d33d9d7b27bf04cd924', '4f68ff16f54a9951315b8404c77ec7fe4550eff1'),
    ('54', 'fetch-sender-auth.patch', 'test_fetch_sender.js', 20, '3add70d60562aa31c5f6008cb49a3e2385d2f1cb', 'c47279b803b53af25e7707aa9722b1ef27807171'),
]
FAIL_BEFORE = {
    'xfetch rejects localhost-lookalike domain',
    'kbfetch rejects localhost-lookalike domain',
    'xfetch rejects localhost credentials trick',
    'kbfetch rejects localhost subdomain',
    'xfetch rejects sibling custom configured path',
    'kbfetch rejects sibling custom configured path',
    'xfetch rejects iframe sender from another origin',
    'kbfetch rejects iframe sender from another origin',
    'xfetch accepts configured root with omitted slash',
    'kbfetch allows trusted loopback IP',
    'xfetch allows trusted ipv6 loopback',
}
ORDERS = [(i,) + tuple(j for j in range(7) if j != i) for i in range(7)] + [tuple(range(6,-1,-1)), (0,2,4,6,1,3,5)]


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def run(*args, cwd=None, expected=0):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.returncode != expected:
        raise RuntimeError(f'{args[0]} exit {r.returncode}, expected {expected}: {r.stderr[:270]} {r.stdout[:160]}')
    return r.stdout


def js_test(test, src, passing, total, failing=None):
    result = json.loads(run('node', str(test), str(src), expected=0 if passing == total else 1))
    if (result['passed'], result['total']) != (passing, total):
        raise AssertionError(f'{test.name}: expected {passing}/{total}, got {result["passed"]}/{result["total"]}')
    if failing is not None:
        failed = {x['name'] for x in result['results'] if x['status'] == 'FAIL'}
        if failed != failing:
            raise AssertionError(f'Unexpected fail-before scenarios: {failed}')


def repo_copy(root, src):
    target = root / 'ext224' / 'background.js'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(src)
    run('git', 'init', '-q', cwd=root)
    run('git', 'add', 'ext224/background.js', cwd=root)
    return target


def verify(zip_path, here):
    archive = zip_path.read_bytes()
    if hashlib.sha256(archive).hexdigest() != ZIP_SHA:
        raise ValueError('Unrecognized devkit ZIP SHA256; do not apply to unknown source')
    with zipfile.ZipFile(zip_path) as z:
        src = z.read('ext224/background.js')
    if blob(src) != BASE:
        raise ValueError('Unrecognized original background.js Git blob')
    artifacts = []
    for number, pn, tn, total, psha, tsha in ARTIFACTS:
        parent = here.parent / ('chat-' + number)
        patch, test = parent / pn, parent / tn
        if not patch.is_file() or not test.is_file():
            raise ValueError(f'Missing test dependency {number}')
        if blob(patch.read_bytes()) != psha or blob(test.read_bytes()) != tsha:
            raise ValueError(f'Unexpected published Git blob in chat-{number}')
        artifacts.append((patch, test, total))
    with tempfile.TemporaryDirectory(prefix='xod54-source-') as tmp:
        wd = Path(tmp)
        target = repo_copy(wd, src)
        run('node', '--check', str(target))
        js_test(artifacts[-1][1], target, 9, 20, FAIL_BEFORE)
        run('git', 'apply', '--check', str(artifacts[-1][0]), cwd=wd)
        run('git', 'apply', str(artifacts[-1][0]), cwd=wd)
        if blob(target.read_bytes()) != PATCHED:
            raise AssertionError('Patched blob mismatch')
        run('node', '--check', str(target))
        js_test(artifacts[-1][1], target, 20, 20)
        run('git', 'apply', '--reverse', '--check', str(artifacts[-1][0]), cwd=wd)
    for order in ORDERS:
        with tempfile.TemporaryDirectory(prefix='xod54-combined-') as tmp:
            wd = Path(tmp)
            target = repo_copy(wd, src)
            for i in order:
                p = artifacts[i][0]
                run('git', 'apply', '--check', str(p), cwd=wd)
                run('git', 'apply', str(p), cwd=wd)
            if blob(target.read_bytes()) != COMBINED:
                raise AssertionError(f'Combined source blob mismatch for {order}')
            run('node', '--check', str(target))
            for _, test, total in artifacts:
                js_test(test, target, total, total)
    return {
        'status': 'SOURCE_ONLY_FIX_PASS', 'zip_sha256': ZIP_SHA,
        'source_blob': BASE, 'patched_blob': PATCHED, 'combined_blob': COMBINED,
        'before': '9/20 PASS (11 expected FAIL)', 'after': '20/20 PASS',
        'compatibility': '9/9 selected orders; same combined blob; 89/89 PASS in each',
        'private_test13': 'NOT_AVAILABLE', 'real_browser_e2e': 'NOT_RUN',
        'beta_build': 'NOT_BUILT',
        'scope': 'legacy ext224/background.js v2.27 authorization predicate',
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-zip', type=Path, required=True)
    args = p.parse_args()
    try:
        print(json.dumps(verify(args.source_zip, Path(__file__).resolve().parent), ensure_ascii=False, indent=2))
        return 0
    except (ValueError, AssertionError, RuntimeError, OSError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as e:
        print(json.dumps({'status': 'SOURCE_ONLY_FIX_FAIL', 'error': str(e)}, ensure_ascii=False))
        return 1

if __name__ == '__main__':
    sys.exit(main())
