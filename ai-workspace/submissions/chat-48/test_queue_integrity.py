#!/usr/bin/env python3
"""Source-only YouTube extension queue safety gate; no real browser or profile.

Usage: python test_queue_integrity.py --source-zip /path/to/holst-devkit-2.24.zip
Requires Node.js and Git, checks exact archive and source before any patch apply.
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
BASE_BLOB = "e2396d242c04ef98fafeac921c48d8f16f301812"
PATCHED_BLOB = "ad0bd84c369ea7c8a192642b1115bd143095f37c"
EXPECTED_BASE_FAIL = {
    "parallel-queued-additions", "flush-must-preserve-new-arrival",
    "concurrent-flushes-send-once", "overflow-rejected-with-old-queue-preserved",
    "parallel-clips-preserved"
}


def run(*args, cwd=None, expect=0):
    p = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if p.returncode != expect:
        raise RuntimeError(f"{args[0]} exit {p.returncode} instead of {expect}: {p.stderr[:350]} {p.stdout[:200]}")
    return p.stdout


def blob(data):
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def verify(zip_path, patch_file, harness_file):
    raw = zip_path.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != ZIP_SHA:
        raise ValueError("Unrecognized archive SHA256; refuse to apply to unknown source")
    with zipfile.ZipFile(zip_path) as z:
        source = z.read("ext224/background.js")
    if blob(source) != BASE_BLOB:
        raise ValueError("Unrecognized ext224/background.js Git blob; refuse to apply")
    if not patch_file.is_file() or not harness_file.is_file():
        raise ValueError("Patch or test harness missing")
    with tempfile.TemporaryDirectory(prefix="xod-queue-gate-") as t:
        tmp = Path(t)
        target = tmp / "ext224" / "background.js"
        target.parent.mkdir()
        target.write_bytes(source)
        run("git", "init", "-q", cwd=tmp)
        run("git", "add", "ext224/background.js", cwd=tmp)
        run("node", "--check", str(target))
        before = json.loads(run("node", str(harness_file), str(target), expect=1))
        before_failed = {x["name"] for x in before["results"] if x["status"] == "FAIL"}
        if before["total"] != 10 or before_failed != EXPECTED_BASE_FAIL:
            raise AssertionError("Baseline regressions no longer match exact expected five failures")
        run("git", "apply", "--check", str(patch_file), cwd=tmp)
        run("git", "apply", str(patch_file), cwd=tmp)
        data = target.read_bytes()
        if blob(data) != PATCHED_BLOB:
            raise AssertionError("Unexpected patched Git blob SHA")
        run("node", "--check", str(target))
        after = json.loads(run("node", str(harness_file), str(target)))
        if after["passed"] != 10 or after["total"] != 10:
            raise AssertionError("Source-only regression test not all PASS")
        run("git", "apply", "--reverse", "--check", str(patch_file), cwd=tmp)
        return {"status": "SOURCE_ONLY_FIX_PASS", "source_archive_sha256": ZIP_SHA,
                "source_git_blob": BASE_BLOB, "patched_git_blob": PATCHED_BLOB,
                "before": "5/10 PASS (5 expected FAIL)", "after": "10/10 PASS",
                "source_scope": "ext224/background.js in legacy Holst 2.27 devkit",
                "product_integrated": False, "real_chrome_edge_mv3": "NOT_RUN",
                "current_private_test13": "NOT_AVAILABLE", "beta_installed": False,
                "risk": "Queue is at-least-once, not crash-proof exactly-once; max 200 retained; beta E2E needed"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source-zip", type=Path, required=True)
    a = ap.parse_args()
    base = Path(__file__).resolve().parent
    try:
        result = verify(a.source_zip, base / "background-queue-integrity.patch", base / "test_queue_concurrency.js")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, RuntimeError, AssertionError, zipfile.BadZipFile, KeyError) as exc:
        print(json.dumps({"status": "SOURCE_ONLY_FIX_FAIL", "reason": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
