#!/usr/bin/env python3
"""Source-backed legacy v2.27 KB-add no-data-loss safety gate.

Usage: python test_kb_integrity.py --source-zip path/to/holst-devkit-2.24.zip
Requires Node.js and git; uses temporary test Git repositories only.
This is NOT integration with private current Test13 or browser E2E.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ARCHIVE_SHA = 'c27d458f9a99dab8e1a2dc5847cd7417f4d978fe202a6e4f2fc0b62829727ed1'
BASE_BLOB = 'e2396d242c04ef98fafeac921c48d8f16f301812'
PATCHED_BLOB = '1d91fcc0da512aa1646b7ebbf8bd4f657f2f440f'
COMBINED_BLOB = 'd758f794c6f43ff4aa0937c5c6379e179d9f644a'
ARTIFACTS = [
    ('48', 'background-queue-integrity.patch', 'test_queue_concurrency.js', 10, '20f0fce0e31cba35ac0531052b666b7bbc1161f4', 'd43495588cb5b4ca6194d184521b1af28f69537a'),
    ('49', 'youtube-watch-progress-race.patch', 'test_yt_watch_race.js', 12, 'b8d2a080ccaec4b74d71362bb94c67f7710da74a', 'b6d182c2a8d1dc537e12ec834c5f5b96fdcc9313'),
    ('50', 'restore-state-local-wins.patch', 'test_restore_state_race.js', 11, '048a3840782063490fdc696f46703c04194c7321', '3ccff632adc417293f9d38334070e8cd904e2e7e'),
    ('51', 'youtube-channel-block-integrity.patch', 'test_yt_channel_block.js', 11, '8bb9b3bb8c656efc976ab586916a37cc1ede40fc', 'fd18bf51ea6d45ee10cc7755d76796e8550b7d57'),
    ('52', 'state-backup-offline-retry.patch', 'test_state_backup_retry.js', 11, '76db957eac8360298cf4fe60138129ad36b23d58', '681b6ff84f341e1a262eeb27949c6348eab4e62c'),
    ('53', 'area-capture-pending-integrity.patch', 'test_area_capture_pending.js', 14, 'c37c0f3cb08cc58a62905d33d9d7b27bf04cd924', '4f68ff16f54a9951315b8404c77ec7fe4550eff1'),
    ('54', 'fetch-sender-auth.patch', 'test_fetch_sender.js', 20, '3add70d60562aa31c5f6008cb49a3e2385d2f1cb', 'c47279b803b53af25e7707aa9722b1ef27807171'),
    ('55', 'kb-add-offline-queue.patch', 'test_kb_add_offline.js', 14, '273476de8a4dcdb2d7ef58009c40436f11d2e5f6', '6c0d5df19e2a937cd34dc174709e24282f3d6aba'),
]
EXPECTED_BASE_FAILURES = {
    'offline-youtube-source-is-persisted',
    'offline-context-link-is-persisted',
    'youtube-non-ok-delivery-is-queued',
    'context-non-ok-delivery-is-queued',
    'offline-source-replayed-after-worker-restart',
    'queued-youtube-source-does-not-focus-closed-holst',
    'queued-context-source-marked-amber-not-false',
    'offline-context-failure-to-write-outbox-is-visible',
}
ORDERS = ([(i,) + tuple(j for j in range(8) if j != i) for i in range(8)]
          + [tuple(range(7, -1, -1)), (0, 2, 4, 6, 1, 3, 5, 7),
             (7, 5, 3, 1, 6, 4, 2, 0), (1, 3, 5, 7, 0, 2, 4, 6)])


def git_blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def run(*args, cwd=None, expected=0):
    p = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if p.returncode != expected:
        raise RuntimeError(f'{args[0]} exit {p.returncode} != {expected}: {p.stderr[:250]} {p.stdout[:160]}')
    return p.stdout


def js_test(test, source, expected, total, baseline_failures=None, flags=None):
    got = json.loads(run('node', str(test), str(source), *(flags or []), expected=0 if expected == total else 1))
    if (got['passed'], got['total']) != (expected, total):
        raise AssertionError(f'{test.name}: {got["passed"]}/{got["total"]} != {expected}/{total}')
    if baseline_failures is not None:
        failed = {item['name'] for item in got['results'] if item['status'] == 'FAIL'}
        if failed != baseline_failures:
            raise AssertionError(f'Changed baseline failures: {failed}')


def workspace(folder, original):
    root = Path(folder)
    target = root / 'ext224/background.js'
    target.parent.mkdir(parents=True)
    target.write_bytes(original)
    run('git', 'init', '-q', cwd=root)
    run('git', 'add', 'ext224/background.js', cwd=root)
    return target


def verify(zip_path, here):
    archive = zip_path.read_bytes()
    if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA:
        raise ValueError('Unrecognized ZIP SHA256: refuse to patch unknown source')
    with zipfile.ZipFile(zip_path) as z:
        original = z.read('ext224/background.js')
    if git_blob(original) != BASE_BLOB:
        raise ValueError('Unrecognized legacy source Git blob')
    artifacts = []
    for n, patch_name, test_name, count, patch_sha, test_sha in ARTIFACTS:
        folder = here.parent / ('chat-' + n)
        patch, test = folder / patch_name, folder / test_name
        if not patch.is_file() or not test.is_file():
            raise ValueError(f'Missing source-only regression dependency: {n}')
        if git_blob(patch.read_bytes()) != patch_sha or git_blob(test.read_bytes()) != test_sha:
            raise ValueError(f'Published Git blob mismatch in chat-{n}')
        artifacts.append((patch, test, count))
    with tempfile.TemporaryDirectory(prefix='xod55-kb-standalone-') as temp:
        target = workspace(temp, original)
        run('node', '--check', str(target))
        js_test(artifacts[-1][1], target, 6, 14, EXPECTED_BASE_FAILURES)
        run('git', 'apply', '--check', str(artifacts[-1][0]), cwd=temp)
        run('git', 'apply', str(artifacts[-1][0]), cwd=temp)
        if git_blob(target.read_bytes()) != PATCHED_BLOB:
            raise AssertionError('Unexpected standalone patched Git blob')
        run('node', '--check', str(target))
        js_test(artifacts[-1][1], target, 14, 14)
        run('git', 'apply', '--reverse', '--check', str(artifacts[-1][0]), cwd=temp)
    for index, order in enumerate(ORDERS, 1):
        with tempfile.TemporaryDirectory(prefix='xod55-kb-combined-') as temp:
            target = workspace(temp, original)
            for i in order:
                patch = artifacts[i][0]
                run('git', 'apply', '--check', str(patch), cwd=temp)
                run('git', 'apply', str(patch), cwd=temp)
            if git_blob(target.read_bytes()) != COMBINED_BLOB:
                raise AssertionError(f'Combined code differs in order {order}')
            run('node', '--check', str(target))
            for i, (_, test, total) in enumerate(artifacts):
                js_test(test, target, total + (1 if i == 7 else 0), total + (1 if i == 7 else 0), flags=['--with-queue-guard'] if i == 7 else [])
        print(f'order {index}/{len(ORDERS)} 104/104 PASS', file=sys.stderr, flush=True)
    return {'status': 'SOURCE_ONLY_FIX_PASS', 'archive_sha256': ARCHIVE_SHA,
            'source_blob': BASE_BLOB, 'patched_blob': PATCHED_BLOB, 'combined_blob': COMBINED_BLOB,
            'before': '6/14 PASS, 8 expected FAIL', 'after': '14/14 PASS',
            'combined': f'{len(ORDERS)}/{len(ORDERS)} selected orders, 104/104 PASS each; identical Git blob',
            'private_integrated_Test13': 'NOT_AVAILABLE', 'real_browser_E2E': 'NOT_RUN', 'beta': 'NOT_BUILT',
            'limit': 'MV3 single-worker queue correctness requires prior CHAT48; crash/remote dedup not proven'}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-zip', type=Path, required=True)
    ns = ap.parse_args()
    try:
        print(json.dumps(verify(ns.source_zip, Path(__file__).resolve().parent), ensure_ascii=False, indent=2))
        return 0
    except (ValueError, AssertionError, RuntimeError, OSError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as e:
        print(json.dumps({'status': 'SOURCE_ONLY_FIX_FAIL', 'error': str(e)}, ensure_ascii=False))
        return 1

if __name__ == '__main__':
    sys.exit(main())
