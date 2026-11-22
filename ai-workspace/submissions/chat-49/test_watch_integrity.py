#!/usr/bin/env python3
"""Verify a legacy YouTube watched-progress race patch against an exact source ZIP.

Requires node + git; runs only in disposable temporary directories. No browser,
no profile, no network, no active XOD checkout. A pass does not imply integration.

python test_watch_integrity.py --source-zip /path/to/holst-devkit-2.24.zip
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ZIP_SHA = "c27d458f9a99dab8e1a2dc5847cd7417f4d978fe202a6e4f2fc0b62829727ed1"
SOURCE_BLOB = "e2396d242c04ef98fafeac921c48d8f16f301812"
WATCHED_BLOB = "f755afb781edf867f525df6e19d7029777aa97f0"
FAIL_BEFORE = {
    "parallel-local-watch-updates-preserve-both-zones",
    "late-direct-ack-cannot-erase-newer-progress",
    "late-flush-ack-cannot-erase-newer-progress",
}


def git_blob(content):
    return hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest()


def call(*args, cwd=None, returncode=0):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if result.returncode != returncode:
        raise RuntimeError(f"{' '.join(map(str,args[:3]))}: expected exit {returncode}, got {result.returncode}: {result.stderr[:280]} {result.stdout[:200]}")
    return result.stdout


def source_checkout(src, folder):
    path = folder / "ext224" / "background.js"
    path.parent.mkdir(parents=True)
    path.write_bytes(src)
    call("git", "init", "-q", cwd=folder)
    call("git", "add", "ext224/background.js", cwd=folder)
    return path


def testjs(js, source, expected, failed=None):
    result = json.loads(call("node", str(js), str(source), returncode=0 if expected == 12 or expected == 10 else 1))
    if result["passed"] != expected:
        raise AssertionError(f"Unexpected Node regression PASS count: {result['passed']} != {expected}")
    if failed is not None:
        actual = {x["name"] for x in result["results"] if x["status"] == "FAIL"}
        if actual != failed:
            raise AssertionError(f"Different fail-before scenarios: {actual} != {failed}")
    return result


def verify(zip_path, watch_patch, watch_test, prior_patch, prior_test):
    raw = zip_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ZIP_SHA:
        raise ValueError("Unknown source archive SHA256; refusing source-only patch")
    with zipfile.ZipFile(zip_path) as z:
        source = z.read("ext224/background.js")
    if git_blob(source) != SOURCE_BLOB:
        raise ValueError("Unknown ext224/background.js Git blob")
    for f in (watch_patch, watch_test, prior_patch, prior_test):
        if not f.is_file():
            raise ValueError(f"Missing verification artifact: {f.name}")
    with tempfile.TemporaryDirectory(prefix="xod-watch-gate-") as name:
        folder = Path(name)
        target = source_checkout(source, folder)
        call("node", "--check", str(target))
        testjs(watch_test, target, 9, FAIL_BEFORE)
        call("git", "apply", "--check", str(watch_patch), cwd=folder)
        call("git", "apply", str(watch_patch), cwd=folder)
        actual = git_blob(target.read_bytes())
        if actual != WATCHED_BLOB:
            raise AssertionError(f"Patched blob unexpectedly changed: {actual}")
        call("node", "--check", str(target))
        testjs(watch_test, target, 12)
        call("git", "apply", "--reverse", "--check", str(watch_patch), cwd=folder)
    results=[]
    for order in ((prior_patch, watch_patch), (watch_patch, prior_patch)):
        with tempfile.TemporaryDirectory(prefix="xod-watch-combined-") as name:
            folder=Path(name)
            target=source_checkout(source, folder)
            for p in order:
                call("git", "apply", "--check", str(p), cwd=folder)
                call("git", "apply", str(p), cwd=folder)
            call("node", "--check", str(target))
            testjs(prior_test, target, 10)
            testjs(watch_test, target, 12)
            results.append({"order": [p.name for p in order], "tests": "22/22 PASS"})
    return {"status": "SOURCE_ONLY_FIX_PASS", "archive_sha256": ZIP_SHA,
            "old_blob": SOURCE_BLOB, "watched_fix_blob": WATCHED_BLOB,
            "before": "9/12 PASS; 3 expected FAIL", "after": "12/12 PASS",
            "compatibility": results, "applied_to_private_test13": False,
            "real_browser_e2e": "NOT_RUN", "real_beta": "NOT_BUILT",
            "limitations": "single MV3 service-worker lifetime; no cross-process exactly-once; legacy 2.27 source only"}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-zip", required=True, type=Path)
    args=parser.parse_args()
    base=Path(__file__).resolve().parent
    prior=base.parent / "chat-48"
    try:
        out=verify(args.source_zip, base/"youtube-watch-progress-race.patch",
                   base/"test_yt_watch_race.js", prior/"background-queue-integrity.patch",
                   prior/"test_queue_concurrency.js")
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, AssertionError, RuntimeError, OSError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        print(json.dumps({"status":"SOURCE_ONLY_FIX_FAIL","error":str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
