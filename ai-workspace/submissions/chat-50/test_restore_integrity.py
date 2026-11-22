#!/usr/bin/env python3
"""Exact-source local-only recovery safety gate for legacy Holst extension v2.27.

Usage: python test_restore_integrity.py --source-zip path/to/holst-devkit-2.24.zip
Requires Node.js and git. Never modifies the source ZIP, real browser or any XOD checkout.
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

ZIP_SHA256 = "c27d458f9a99dab8e1a2dc5847cd7417f4d978fe202a6e4f2fc0b62829727ed1"
SOURCE_BLOB = "e2396d242c04ef98fafeac921c48d8f16f301812"
PATCHED_BLOB = "a807460a871e487aa4cfc44c644c533958f16891"
EXPECTED_FAILURES = {
    "existing-highlights-win-over-remote",
    "highlight-created-while-fetch-in-flight-survives",
    "keep-setting-changed-while-fetch-in-flight-survives",
    "remote-non-highlight-key-is-ignored",
    "restored-during-inflight-does-not-reinstall-settings",
    "existing-empty-highlight-is-still-owned-locally",
}


def git_blob(data):
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def run(*argv, cwd=None, expected=0):
    x = subprocess.run(argv, cwd=cwd, capture_output=True, text=True)
    if x.returncode != expected:
        raise RuntimeError(f"{' '.join(map(str, argv[:3]))}: exit {x.returncode}, expected {expected}, stderr={x.stderr[:300]} stdout={x.stdout[:180]}")
    return x.stdout


def js_result(test_path, source_path, count, total, failures=None):
    js = json.loads(run("node", str(test_path), str(source_path), expected=0 if count == total else 1))
    if js["passed"] != count or js["total"] != total:
        raise AssertionError(f"Unexpected regression result {js['passed']}/{js['total']}; expected {count}/{total}")
    if failures is not None:
        actual = {x["name"] for x in js["results"] if x["status"] == "FAIL"}
        if actual != failures:
            raise AssertionError(f"Unexpected fail-before scenarios {actual}")


def checkout(temp, source):
    folder = Path(temp)
    file = folder / "ext224" / "background.js"
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(source)
    run("git", "init", "-q", cwd=folder)
    run("git", "add", "ext224/background.js", cwd=folder)
    return file


def verify(source_zip, folder):
    if hashlib.sha256(source_zip.read_bytes()).hexdigest() != ZIP_SHA256:
        raise ValueError("Unknown ZIP SHA256: refusing to patch or test an unverified source")
    with zipfile.ZipFile(source_zip) as z:
        source = z.read("ext224/background.js")
    if git_blob(source) != SOURCE_BLOB:
        raise ValueError("Unexpected ext224/background.js Git blob")
    prior48, prior49 = folder.parent / "chat-48", folder.parent / "chat-49"
    patches = [prior48 / "background-queue-integrity.patch", prior49 / "youtube-watch-progress-race.patch", folder / "restore-state-local-wins.patch"]
    tests = [prior48 / "test_queue_concurrency.js", prior49 / "test_yt_watch_race.js", folder / "test_restore_state_race.js"]
    for f in patches + tests:
        if not f.is_file():
            raise ValueError(f"Missing source-backed regression dependency: {f}")
    # Verify the reused original, already published GitHub patch/test artifacts exactly.
    older_blobs = ["20f0fce0e31cba35ac0531052b666b7bbc1161f4", "b8d2a080ccaec4b74d71362bb94c67f7710da74a"]
    for file, expected in zip(patches[:2], older_blobs):
        if git_blob(file.read_bytes()) != expected:
            raise ValueError(f"Published prior patch Git blob mismatch: {file.name}")
    with tempfile.TemporaryDirectory(prefix="xod-restore-base-") as name:
        target = checkout(name, source)
        run("node", "--check", str(target))
        js_result(tests[2], target, 5, 11, EXPECTED_FAILURES)
        run("git", "apply", "--check", str(patches[2]), cwd=name)
        run("git", "apply", str(patches[2]), cwd=name)
        if git_blob(target.read_bytes()) != PATCHED_BLOB:
            raise AssertionError("Unexpected modified source Git blob")
        run("node", "--check", str(target))
        js_result(tests[2], target, 11, 11)
        run("git", "apply", "--reverse", "--check", str(patches[2]), cwd=name)
    orders=[]
    for order in itertools.permutations(range(3)):
        with tempfile.TemporaryDirectory(prefix="xod-restore-combined-") as name:
            target = checkout(name, source)
            for i in order:
                run("git", "apply", "--check", str(patches[i]), cwd=name)
                run("git", "apply", str(patches[i]), cwd=name)
            run("node", "--check", str(target))
            for test, count in zip(tests, [10, 12, 11]):
                js_result(test, target, count, count)
            orders.append("-".join(str(i + 48) for i in order))
    return {"status": "SOURCE_ONLY_FIX_PASS", "archive_sha256": ZIP_SHA256,
            "source_blob": SOURCE_BLOB, "patched_blob": PATCHED_BLOB,
            "before": "5/11 PASS (6 expected FAIL)", "after": "11/11 PASS",
            "prior_patch_compatibility": f"6 orders; 33/33 PASS per order", "orders": orders,
            "private_test13": "NOT_AVAILABLE", "product_integration": "NOT_RUN",
            "real_browser_e2e": "NOT_RUN", "beta_build": "NOT_BUILT",
            "risk": "Fresh local read narrows restore race; storage.local has no transaction/CAS across external writers"}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-zip", type=Path, required=True)
    ns = p.parse_args()
    try:
        result = verify(ns.source_zip, Path(__file__).resolve().parent)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except (OSError, RuntimeError, AssertionError, ValueError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as e:
        print(json.dumps({"status": "SOURCE_ONLY_FIX_FAIL", "reason": str(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
