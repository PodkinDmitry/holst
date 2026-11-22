#!/usr/bin/env python3
"""One-shot, private, synthetic-fixture XOD Test13 browser diagnostic (EXEC-002).

On the user's computer: verify an existing PRIVATE Test13 ZIP, unpack in a
throwaway temporary folder, apply exact public CHAT14 diagnostic patch,
preflight real localhost in the chosen Playwright browser, build and run the
unchanged strict app_regression suite. Produce ONLY a bounded safe summary;
never upload private sources, full console logs or board/organizer values.

This script does NOT remove or work around browser administrator policy.
"""
from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOURCE_NAME = "XOD-Test13-source-6429ad6.zip"
SOURCE_SHA256 = "a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4"
SOURCE_BYTES = 6036778
SOURCE_MANIFEST_SHA256 = "3e22adde6bf966bf1fe5d3c5cb784053dddea77253db875a697c800389fdbb7c"
SOURCE_APP_SHA256 = "3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c"
SOURCE_ZIP_ENTRIES = 449
SOURCE_MANIFEST_ENTRIES = 431
PUBLIC_BASE = "https://raw.githubusercontent.com/PodkinDmitry/holst/ai-workspace/ai-workspace/submissions/chat-14/"
SUPPORT = {
    "app_regression.patch": "58333077ed9ad6425d80e9dc463520d2a5e11732",
    "cache_state_diagnostics.py": "f797264cddfac36617423660555769e24fac49f3",
}
DIFF_PATTERN = re.compile(r"^(/[^\s:]{1,180}):\s+(missing|null|boolean|number|string|array|object):([0-9a-f]{12}|missing)\s+->\s+(missing|null|boolean|number|string|array|object):([0-9a-f]{12}|missing)$")
EXCEPTIONS = re.compile(r"^(?P<error>[A-Za-z][A-Za-z_]*(?:Error|Exception))(?::|$)")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\x00" + data).hexdigest()


def is_safe_zip_name(name: str) -> bool:
    n = PurePosixPath(name)
    return bool(name and name != "." and "\\" not in name and not name.startswith("/") and
                ":" not in n.parts[0] and ".." not in n.parts and n.parts[0] not in ("", "."))


def parse_manifest(data: bytes) -> list[tuple[str, str]]:
    text = data.decode("utf-8-sig")
    items = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?(.+)", line)
        if not match:
            raise ValueError(f"Unexpected SHA256 manifest syntax on line {lineno}")
        checksum, filename = match.group(1).lower(), match.group(2).strip()
        if not is_safe_zip_name(filename):
            raise ValueError("Manifest contains an unsafe path")
        items.append((filename, checksum))
    return items


def verify_source_zip(zip_path: Path) -> dict:
    """Read and verify fully before allowing any content to execute or extract."""
    size = zip_path.stat().st_size
    if size != SOURCE_BYTES:
        raise ValueError(f"Source ZIP length mismatch (observed {size} bytes)")
    if sha256(zip_path.read_bytes()) != SOURCE_SHA256:
        raise ValueError("Source ZIP SHA256 does not match the private Test13 checkpoint")
    with zipfile.ZipFile(zip_path, "r") as z:
        members = z.infolist()
        if len(members) != SOURCE_ZIP_ENTRIES:
            raise ValueError("Unexpected ZIP entry count")
        names = {x.filename for x in members}
        if len(names) != len(members):
            raise ValueError("Duplicate ZIP member names")
        for x in members:
            if not is_safe_zip_name(x.filename):
                raise ValueError("Unsafe ZIP entry path")
            # Unix symlink, even if the host is Windows.
            if (x.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Symlink in ZIP")
        bad = z.testzip()
        if bad is not None:
            raise ValueError("ZIP CRC mismatch")
        manifests = [n for n in names if n == "SOURCE_SHA256SUMS.txt" or n.endswith("/SOURCE_SHA256SUMS.txt")]
        if len(manifests) != 1:
            raise ValueError("Missing or ambiguous SHA256 manifest")
        manifest_name = manifests[0]
        manifest_data = z.read(manifest_name)
        if sha256(manifest_data) != SOURCE_MANIFEST_SHA256:
            raise ValueError("Source manifest SHA256 mismatch")
        prefix = manifest_name[: -len("SOURCE_SHA256SUMS.txt")]
        checks = parse_manifest(manifest_data)
        if len(checks) != SOURCE_MANIFEST_ENTRIES:
            raise ValueError("Unexpected number of manifest hashes")
        seen = set()
        for relative, expected in checks:
            absolute = relative if relative in names else prefix + relative
            if absolute in seen or absolute not in names:
                raise ValueError("Manifest entry absent/duplicate")
            seen.add(absolute)
            if sha256(z.read(absolute)) != expected:
                raise ValueError("Manifest file SHA256 mismatch")
        app = prefix + "v224/base29.html"
        if app not in names or sha256(z.read(app)) != SOURCE_APP_SHA256:
            raise ValueError("Original v224/base29.html SHA256 mismatch")
    return {"zip_sha256":SOURCE_SHA256,"archive_entries":SOURCE_ZIP_ENTRIES,
            "crc":"PASS","manifest_verified":len(checks),"app_sha256":SOURCE_APP_SHA256,
            "archive_prefix":prefix}


def unpack_verified_zip(zpath: Path, dest: Path) -> Path:
    # Called only AFTER verify_source_zip(). Independently guard extraction.
    with zipfile.ZipFile(zpath,"r") as z:
        for entry in z.infolist():
            if not is_safe_zip_name(entry.filename):
                raise ValueError("Unsafe entry during extraction")
            target = dest.joinpath(*PurePosixPath(entry.filename).parts)
            if entry.is_dir():
                target.mkdir(parents=True,exist_ok=True)
                continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with z.open(entry) as src, target.open("wb") as dst:
                shutil.copyfileobj(src,dst)
        manifests = list(dest.rglob("SOURCE_SHA256SUMS.txt"))
        if len(manifests) != 1:
            raise ValueError("No unique extracted source root")
        root = manifests[0].parent
        if not (root/"build.py").is_file() or not (root/"tests/app_regression.py").is_file():
            raise ValueError("Expected Test13 source build/tests missing")
        return root


def get_support(name: str, offline_dir: Path | None) -> bytes:
    if name not in SUPPORT:
        raise ValueError("Unknown public support artifact")
    if offline_dir:
        data = (offline_dir/name).read_bytes()
    else:
        req=urllib.request.Request(PUBLIC_BASE+name,headers={"User-Agent":"XOD-Test13-Diag/1.0"})
        with urllib.request.urlopen(req,timeout=25) as f:
            data = f.read(150000)
    if git_blob_sha(data) != SUPPORT[name]:
        raise ValueError("CHAT14 support Git blob SHA mismatch: "+name)
    return data


def apply_diagnostics(source: Path, offline: Path | None) -> dict:
    patch = get_support("app_regression.patch",offline)
    helper = get_support("cache_state_diagnostics.py",offline)
    helper_target = source/"tests/cache_state_diagnostics.py"
    if helper_target.exists():
        raise ValueError("Diagnostic destination already exists: refuse overwrite")
    helper_target.write_bytes(helper)
    patch_path = source/"CHAT14-app_regression.patch"
    patch_path.write_bytes(patch)
    try:
        for args in (["git","apply","--check",str(patch_path)],
                     ["git","apply",str(patch_path)]):
            p=subprocess.run(args,cwd=source,capture_output=True,timeout=30)
            if p.returncode:
                raise RuntimeError("CHAT14 diagnostic git apply check/application FAILED; Test13 copy abandoned")
        p=subprocess.run([sys.executable,"-m","py_compile",str(source/"tests/app_regression.py"),
                          str(helper_target)],cwd=source,capture_output=True,timeout=30)
        if p.returncode:
            raise RuntimeError("CHAT14 Python syntax check failed")
    finally:
        patch_path.unlink(missing_ok=True)
    return {"patch_sha":SUPPORT["app_regression.patch"],"helper_sha":SUPPORT["cache_state_diagnostics.py"],
            "strict_original_assert":"PRESERVED_WITH_STRICT_DIAGNOSTICS","syntax":"PASS"}


class ProbeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body=b"XOD browser localhost preflight: OK"
        self.send_response(200)
        self.send_header("Content-Type","text/plain; charset=utf-8")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers();self.wfile.write(body)
    def log_message(self,*args):
        return


def localhost_browser_probe(channel: str) -> dict:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"status":"MISSING_PLAYWRIGHT","next":"Install Python playwright in the chosen Windows Python environment; browser test not started"}
    server=ThreadingHTTPServer(("127.0.0.1",0),ProbeHandler)
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    try:
        with sync_playwright() as p:
            try:
                launch_options={"channel":channel} if channel!="chromium" else {}
                if channel=="chromium" and shutil.which("chromium"):
                    launch_options={"executable_path":shutil.which("chromium")}
                browser = p.chromium.launch(headless=True,**launch_options)
            except Exception as e:
                return {"status":"BROWSER_LAUNCH_FAILED","kind":type(e).__name__,
                        "next":"Install/repair selected Chrome/Edge or Playwright browser; original test not run"}
            try:
                page=browser.new_page()
                response=page.goto("http://127.0.0.1:"+str(server.server_port)+"/",wait_until="domcontentloaded",timeout=15000)
                if response and response.status==200 and "XOD browser localhost preflight: OK" in page.content():
                    return {"status":"PASS","http":200,"channel":channel}
                return {"status":"PREFLIGHT_FAILED","http":response.status if response else None}
            except Exception as e:
                msg=str(e)
                return {"status":"BLOCKED_BROWSER" if "ERR_BLOCKED_BY_ADMINISTRATOR" in msg else "PREFLIGHT_FAILED",
                        "kind":type(e).__name__,
                        "browser_error":"ERR_BLOCKED_BY_ADMINISTRATOR" if "ERR_BLOCKED_BY_ADMINISTRATOR" in msg else "OTHER_NAVIGATION_ERROR"}
            finally:
                browser.close()
    finally:
        server.shutdown();server.server_close()


def extract_safe_diagnostic(output: str) -> dict:
    """Only strict allowlisted markers; never copy raw test logs/paths/value text."""
    changes=[];save_probes=[];exception_types=[]
    for line in output.splitlines():
        stripped=line.strip()
        m=DIFF_PATTERN.fullmatch(stripped)
        if m and len(changes)<40:
            changes.append({"json_pointer":m.group(1),"before_type":m.group(2),"before_sha12":m.group(3),
                            "after_type":m.group(4),"after_sha12":m.group(5)})
        if stripped.startswith("save-state before="):
            # Never surface arbitrary strings; parse recognized values only.
            prefix="save-state before="
            sep=" after="
            first,_,second=stripped[len(prefix):].partition(sep)
            if second and len(save_probes)<1:
                try:
                    pair=[ast.literal_eval(first),ast.literal_eval(second)]
                    if all(isinstance(d,dict) for d in pair):
                        def allowed(d):
                            keys=("updatedAt","dirty","saving","saveAgain","timerPending")
                            return {k:v for k,v in d.items() if k in keys and (v is None or type(v) in (int,float,bool))}
                        save_probes=[allowed(x) for x in pair]
                except (ValueError,SyntaxError,TypeError):
                    pass
        ex=EXCEPTIONS.match(stripped)
        if ex and len(exception_types)<4:
            exception_types.append(ex.group("error"))
    return {"changed_paths":changes,"save_state_before_after":save_probes,
            "exception_types":exception_types,"saw_strict_cache_comparison_failure":
                "Cache cleanup changed the exact serialized board/org/palette state." in output,
            "saw_cache_comparison_pass":
                "PASS cache preview and cleanup preserve active cache, board, groups and palette" in output,
            "saw_browser_admin_block":"ERR_BLOCKED_BY_ADMINISTRATOR" in output,
            "test_output_sha256":sha256(output.encode("utf-8",errors="replace")),
            "test_output_bytes":len(output.encode("utf-8",errors="replace"))}


def run_command(args: list[str],cwd: Path,timeout: int) -> tuple[int,str]:
    try:
        cp=subprocess.run(args,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                          timeout=timeout,text=True,encoding="utf-8",errors="replace")
        return cp.returncode, cp.stdout
    except subprocess.TimeoutExpired:
        return 124,"Timed out (raw process output not retained)"


def find_source_zip(explicit: str | None) -> Path | None:
    if explicit:
        return Path(explicit).expanduser()
    home=Path.home()
    choices=[home/"Downloads"/SOURCE_NAME,home/"Загрузки"/SOURCE_NAME,
             Path.cwd()/SOURCE_NAME]
    for choice in choices:
        if choice.is_file():
            return choice
    if os.environ.get("DISPLAY") or sys.platform.startswith("win"):
        try:
            import tkinter as tk
            from tkinter import filedialog
            root=tk.Tk();root.withdraw()
            val=filedialog.askopenfilename(title="Выберите приватный архив XOD Test13 (остаётся на вашем ПК)",
                 filetypes=[("XOD Test13 ZIP","*.zip"),("All files","*.*")])
            root.destroy()
            if val:return Path(val)
        except Exception:
            pass
    return None


def write_summary(out: Path,summary: dict) -> Path:
    out.mkdir(parents=True,exist_ok=True)
    target=out/"safe_summary.json"
    target.write_text(json.dumps(summary,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    return target


def self_test() -> None:
    assert git_blob_sha(b"hello") == "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0"
    assert parse_manifest(b"".join([b"a"*64+b"  a/file.txt\n"])) == [("a/file.txt","a"*64)]
    for bad in ("../foo","/absolute","a/../../bad","C:/private","a\\b"):
        assert not is_safe_zip_name(bad)
    assert is_safe_zip_name("v224/base29.html")
    data=("Traceback: SECRET_UNSAFE_USER_BOARD\n" +
          "Cache cleanup changed the exact serialized board/org/palette state.\n" +
          "/0/updatedAt: number:012345abcdef -> number:fedcba987654\n" +
          "save-state before={'updatedAt': 123, 'dirty': True, 'items':'PRIVATE'} after={'updatedAt': 124, 'saving': False, 'items':'PRIVATE'}")
    safe=extract_safe_diagnostic(data)
    assert len(safe["changed_paths"])==1
    assert safe["save_state_before_after"]==[{'updatedAt':123,'dirty':True},{'updatedAt':124,'saving':False}]
    assert "SECRET" not in json.dumps(safe) and "PRIVATE" not in json.dumps(safe)
    assert sha256(b"test") == "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    print("SELF_TEST PASS (hashes, ZIP paths, manifest, redaction, diagnostics)")


def main() -> int:
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--zip",help="Private verified Test13 ZIP on this host. If absent, a file picker opens.")
    cli.add_argument("--support-dir",help="Offline CHAT14 support directory (public patch and helper)")
    cli.add_argument("--channel",choices=("msedge","chrome","chromium"),
                     default="msedge" if sys.platform.startswith("win") else "chromium")
    cli.add_argument("--report-dir",help="Output folder for SAFE JSON only (no raw stdout)")
    cli.add_argument("--self-test",action="store_true",help="Test script helpers without private data or browser")
    args=cli.parse_args()
    if args.self_test:
        self_test();return 0
    local_time=time.strftime("%Y%m%d-%H%M%S")
    out=Path(args.report_dir).expanduser() if args.report_dir else Path.home()/"Downloads"/("XOD-browser-diag-"+local_time)
    summary={"schema":1,"task":"EXEC-002/CHAT14-browser-1265","created_utc":datetime.now(timezone.utc).isoformat(),
             "environment":{"os":platform.system(),"python":platform.python_version(),"channel":args.channel},
             "status":"NOT_STARTED","work_used":"NOT_OBSERVED","sol_checkout_modified":False,
             "main_modified":False,"private_source_published":False,"test_fixture":"synthetic-only"}
    status=2
    try:
        zpath=find_source_zip(args.zip)
        if not zpath or not zpath.is_file():
            summary.update(status="MISSING_PRIVATE_ZIP",next_action="Download owner-only Test13 ZIP from connected Drive; select it locally; no public upload")
            return 2
        summary["source_integrity"]=verify_source_zip(zpath)
        with tempfile.TemporaryDirectory(prefix="xod-browser-diagnostic-") as tmp:
            src=unpack_verified_zip(zpath,Path(tmp))
            summary["diagnostic_patch"]=apply_diagnostics(src,Path(args.support_dir) if args.support_dir else None)
            preflight=localhost_browser_probe(args.channel)
            summary["localhost_browser_preflight"]=preflight
            if preflight["status"] != "PASS":
                summary.update(status="BLOCKED_BROWSER" if preflight["status"]=="BLOCKED_BROWSER" else "ENVIRONMENT_BLOCKED",
                               next_action="Use an authorized local Chrome/Edge with localhost + Python Playwright; do not bypass administrator policies")
                return 3
            code,log=run_command([sys.executable,"build.py","dist"],src,600)
            summary["build"]={"exit_code":code,"log_sha256":sha256(log.encode("utf-8",errors="replace"))}
            if code!=0:
                summary.update(status="BUILD_FAILED",next_action="Inspect private build output locally; source not changed")
                return 4
            test=src/"tests/app_regression.py"
            app=src/"dist/app"
            previous=src/"tests/fixtures/legacy224"
            board=src/"tests/fixtures/synthetic-board.json"
            for file in (test,previous,board):
                if not file.exists():
                    raise ValueError("Missing required synthetic app regression input")
            cmd=[sys.executable,str(test),str(app),str(previous),str(board),"--channel",args.channel]
            code,log=run_command(cmd,src,1800)
            safe=extract_safe_diagnostic(log)
            summary["browser_test"]={"exit_code":code,**safe}
            if code==0:
                summary.update(status="BROWSER_REGRESSION_PASS_ONE_RUN",
                               next_action="Report exact test run as PASS; do not claim SOL integration or full release E2E")
                status=0
            elif safe["saw_strict_cache_comparison_failure"]:
                summary.update(status="BROWSER_CACHE_STATE_DIFF_OBSERVED",
                               next_action="Correlate safe changed paths with save-state/timing; no content patch without confirmed cause")
                status=5
            elif safe["saw_browser_admin_block"]:
                summary.update(status="BLOCKED_BROWSER",next_action="Use authorized browser host; do not bypass policy")
                status=3
            else:
                summary.update(status="BROWSER_TEST_FAILED_ELSEWHERE",
                               next_action="Review raw logs locally only; do not expose private values or claim 1265 reproduced")
                status=6
            return status
    except (OSError,ValueError,RuntimeError,zipfile.BadZipFile,subprocess.SubprocessError) as e:
        summary.update(status="PRECONDITION_FAILED",error_type=type(e).__name__,
                       next_action="Check source ZIP integrity, permitted browser and public pinned support files")
        return 7
    finally:
        target=write_summary(out,summary)
        print("STATUS:",summary["status"])
        print("SAFE JSON REPORT:",target)
        print("No raw stdout, private ZIP or board content was exported by this launcher.")
        print("Only share safe_summary.json after checking that it contains no unexpected private paths.")


if __name__=="__main__":
    sys.exit(main())
