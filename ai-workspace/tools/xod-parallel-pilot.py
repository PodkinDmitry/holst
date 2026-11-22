#!/usr/bin/env python3
"""Local-only two-lane XOD pilot guard. Never pushes, merges or touches user data.

    python xod-parallel-pilot.py prepare --repo /path/to/checkout \
      --base-ref release/xod-3.0 --expected-sha VERIFIED_COMMIT \
      --root /path/outside/checkout/pilot --apply
    python xod-parallel-pilot.py audit --repo /path/to/checkout \
      --base VERIFIED_COMMIT --app-ref pilot/xod3-foundation \
      --youtube-ref pilot/youtube-beta

Without --apply, prepare only reports a read-only plan. A PASS is *not* product,
release, browser, storage, Drive or user beta acceptance.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

REQUIRED = ("v224/m_data300.js", "v224/xod-youtube-table300.js", "v224/m_mark224.js")
BRANCHES = {"app": "pilot/xod3-foundation", "youtube": "pilot/youtube-beta"}
SHARED = {"v224/m_mark224.js", "ext224/bridge.js"}


def git(repo, *args, check=True):
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if check and p.returncode:
        raise RuntimeError(f"git {args[0]} failed: {p.stderr.strip()[:300]}")
    return p.stdout.strip() if check else p


def sha_of(repo, ref):
    if not ref or ref.startswith("-"):
        raise ValueError("Invalid ref")
    return git(repo, "rev-parse", "--verify", ref + "^{commit}")


def source_guard(repo, commit):
    for path in REQUIRED:
        if git(repo, "cat-file", "-e", f"{commit}:{path}", check=False).returncode:
            raise ValueError(f"Not a verified XOD 3.0 source shape: missing {path}")


def allowed(path, lane):
    if path in SHARED or path.startswith("ai-workspace/") or path.startswith(".github/"):
        return False
    if lane == "app":
        return path in {"v224/m_data300.js", "v224/m_viewport300.js", "tests/app_regression.py", "tests/zoom_regression.py"} or path.startswith("tests/app_") or path.startswith("tests/zoom_")
    return path in {"v224/xod-youtube-table300.js", "v224/xod-youtube-table300.css"} or (path.startswith("ext224/") and path != "ext224/bridge.js") or path.startswith("tests/youtube_") or path.startswith("tests/extension_")


def changed_paths(repo, base, ref):
    # NUL output keeps whitespace in filenames safe. Rename destinations and
    # sources are audited via two separate commits' tree differences.
    raw = subprocess.run(["git", "-C", str(repo), "diff", "--name-only", "-z", "--no-renames", f"{base}..{ref}"], capture_output=True)
    if raw.returncode:
        raise RuntimeError("Cannot compare lane to recorded base")
    return [x.decode("utf-8", "surrogateescape") for x in raw.stdout.split(b"\x00") if x]


def ensure_ancestor(repo, base, tip):
    # A two-dot diff alone can show an unrelated branch as an empty change.
    # Requiring a common, retained baseline prevents false boundary PASS.
    if git(repo, "merge-base", "--is-ancestor", base, tip, check=False).returncode:
        raise ValueError("Pilot base commit must be ancestor of both lane tips")


def registered_worktrees(repo):
    raw = subprocess.run(["git", "-C", str(repo), "worktree", "list", "--porcelain", "-z"], capture_output=True)
    if raw.returncode:
        raise RuntimeError("Cannot enumerate local Git worktrees")
    result = {}
    for entry in raw.stdout.split(b"\x00\x00"):
        fields = entry.split(b"\x00")
        path, branch = None, None
        for field in fields:
            if field.startswith(b"worktree "):
                path = Path(field[len(b"worktree "):].decode("utf-8", "surrogateescape"))
            elif field.startswith(b"branch refs/heads/"):
                branch = field[len(b"branch refs/heads/"):].decode("utf-8", "surrogateescape")
        if path and branch:
            result[branch] = path
    return result


def require_clean_lane(repo, ref, tip, worktrees):
    path = worktrees.get(ref)
    if path is None or not path.is_dir():
        raise ValueError(f"Missing active local worktree for pilot lane {ref}")
    if sha_of(path, "HEAD") != tip:
        raise ValueError(f"Local worktree HEAD differs from lane branch tip: {ref}")
    raw = subprocess.run(["git", "-C", str(path), "status", "--porcelain", "-z"], capture_output=True)
    if raw.returncode or raw.stdout:
        raise ValueError(f"Dirty worktree: {ref}; commit or safely preserve all tracked/untracked changes first")


def repo_guard(repo):
    if not repo.is_dir() or not (repo / ".git").exists():
        raise ValueError("--repo must point to an existing checkout/worktree")
    root = Path(git(repo, "rev-parse", "--show-toplevel")).resolve()
    if root != repo.resolve():
        raise ValueError("--repo must be Git checkout root")


def prepare(ns):
    repo, root = Path(ns.repo).resolve(), Path(ns.root).resolve()
    repo_guard(repo)
    if ns.base_ref in ("main", "origin/main", "refs/heads/main"):
        raise ValueError("main is not an allowed pilot source")
    commit = sha_of(repo, ns.base_ref)
    source_guard(repo, commit)
    if ns.expected_sha and commit != ns.expected_sha:
        raise ValueError("Base HEAD differs from independently verified --expected-sha")
    if ns.apply and not ns.expected_sha:
        raise ValueError("--apply requires an exact independently verified --expected-sha")
    if root == repo or repo in root.parents:
        raise ValueError("Worktrees must stay outside the source checkout")
    if git(repo, "status", "--porcelain"):
        raise ValueError("Source checkout is not clean; preserve existing local changes")
    entries = {k: {"branch": b, "path": str(root / k)} for k, b in BRANCHES.items()}
    for x in entries.values():
        if Path(x["path"]).exists():
            raise ValueError(f"Pilot path already exists: {x['path']}")
        if git(repo, "show-ref", "--verify", "--quiet", "refs/heads/" + x["branch"], check=False).returncode == 0:
            raise ValueError(f"Pilot branch already exists: {x['branch']}")
    if not ns.apply:
        return {"status": "READ_ONLY_PLAN", "base_commit": commit, "source": "SHAPE_ONLY", "worktrees": entries, "main_changed": False}
    root.mkdir(parents=True, exist_ok=True)
    created = []
    try:
        for x in entries.values():
            git(repo, "worktree", "add", "-b", x["branch"], x["path"], commit)
            created.append(x["branch"])
    except Exception as e:
        raise RuntimeError(f"PARTIAL_PREPARE: {created}; do NOT delete automatically; {e}") from e
    return {"status": "LOCAL_WORKTREES_CREATED", "base_commit": commit, "source": "SHAPE_ONLY", "worktrees": entries, "main_changed": False, "remote_push": False}


def audit(ns):
    repo = Path(ns.repo).resolve()
    repo_guard(repo)
    base = sha_of(repo, ns.base)
    source_guard(repo, base)
    if ns.app_ref == ns.youtube_ref or ns.app_ref == ns.base or ns.youtube_ref == ns.base:
        raise ValueError("Lanes must have independent refs")
    app_tip, yt_tip = sha_of(repo, ns.app_ref), sha_of(repo, ns.youtube_ref)
    ensure_ancestor(repo, base, app_tip)
    ensure_ancestor(repo, base, yt_tip)
    worktrees = registered_worktrees(repo)
    require_clean_lane(repo, ns.app_ref, app_tip, worktrees)
    require_clean_lane(repo, ns.youtube_ref, yt_tip, worktrees)
    app = changed_paths(repo, base, app_tip)
    yt = changed_paths(repo, base, yt_tip)
    overlap = sorted(set(app) & set(yt))
    bad_app, bad_yt = [p for p in app if not allowed(p, "app")], [p for p in yt if not allowed(p, "youtube")]
    # Shared files are always an integration task, never a lane's unilateral change.
    status = "BOUNDARY_PASS" if not (overlap or bad_app or bad_yt) else "BLOCKED_SCOPE"
    if not (app or yt):
        status = "NO_PRODUCT_CHANGES"
    return {"status": status, "base_commit": base, "app_changed": app,
            "youtube_changed": yt, "overlap": overlap,
            "app_out_of_scope": bad_app, "youtube_out_of_scope": bad_yt,
            "integration": "NOT_RUN", "release": "OPEN", "browser": "NOT_RUN",
            "drive": "NOT_RUN", "user_beta": "NOT_RUN"}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare", help="Verify base and optionally create isolated local worktrees")
    p.add_argument("--repo", required=True)
    p.add_argument("--root", required=True)
    p.add_argument("--base-ref", default="release/xod-3.0")
    p.add_argument("--expected-sha")
    p.add_argument("--apply", action="store_true")
    a = sub.add_parser("audit", help="Read-only cross-lane changed-path guard")
    a.add_argument("--repo", required=True)
    a.add_argument("--base", required=True)
    a.add_argument("--app-ref", required=True)
    a.add_argument("--youtube-ref", required=True)
    ns = ap.parse_args(argv)
    try:
        result = prepare(ns) if ns.command == "prepare" else audit(ns)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["status"] in ("READ_ONLY_PLAN", "LOCAL_WORKTREES_CREATED", "BOUNDARY_PASS") else 2
    except (ValueError, RuntimeError, OSError) as exc:
        print(json.dumps({"status": "BLOCKED", "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
