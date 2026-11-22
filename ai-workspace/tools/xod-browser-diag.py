#!/usr/bin/env python3
"""One-shot, private, synthetic-fixture XOD Test13 browser diagnostic (EXEC-002).

On the user's computer: verify an existing PRIVATE Test13 ZIP, unpack in a
throwaway temporary folder, apply a strict, byte-exact equivalent of CHAT14 test diagnostics,
preflight real localhost in the chosen Playwright browser, build and run the
strict app_regression suite with only test diagnostics inserted. Produce ONLY a bounded safe summary;
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
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOURCE_NAME = "XOD-Test13-source-6429ad6.zip"
SOURCE_SHA256 = "a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4"
SOURCE_BYTES = 6036778
SOURCE_MANIFEST_SHA256 = "3e22adde6bf966bf1fe5d3c5cb784053dddea77253db875a697c800389fdbb7c"
SOURCE_APP_SHA256 = "3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c"
SOURCE_ZIP_ENTRIES = 449
SOURCE_MANIFEST_ENTRIES = 431
# Offline, audited diagnostics shipped next to this launcher. No Git or network needed.
LOCAL_HELPER = "cache_state_diagnostics.py"
LOCAL_HELPER_SHA256 = "85acc541fb0d83f1b70fc105320bd622afc536beb7728fab50578a30cb017206"


def status_message(message: str) -> None:
    print("[XOD] " + message, flush=True)


def safe_failure_hint(exc: BaseException, stage: str) -> str:
    """Never disclose private filenames, user paths, board contents or raw output."""
    if stage == "CHECK_ZIP":
        return "Проверьте локальный архив Test 13: размер и контрольные суммы."
    if stage == "PREPARE_DIAGNOSTIC":
        if isinstance(exc, SyntaxError):
            return "Проверка синтаксиса временного теста не прошла; не повторяйте запуск. Отправьте safe_summary.json в CHAT-PLAN."
        if isinstance(exc, PermissionError):
            return "Нет доступа к временным файлам. Проверьте уведомления Comodo; не отключайте защиту. Отправьте safe_summary.json."
        return "Подготовка диагностического теста не удалась. Не запускайте повторно; отправьте safe_summary.json."
    if stage == "BROWSER_PREFLIGHT":
        return "Проверьте Microsoft Edge и Python Playwright; Comodo может блокировать запуск. Не отключайте защиту."
    if stage == "BUILD":
        return "Не удалось собрать временную копию: исходники пользователя не изменены."
    if stage == "BROWSER_TEST":
        return "Тест прервался; нужен безопасный JSON-отчёт с текущим этапом, а не повторный запуск старого набора."
    return "Проверка прервана. Не отключайте Comodo; сообщите статус из safe_summary.json."


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
        for index, (relative, expected) in enumerate(checks, 1):
            absolute = relative if relative in names else prefix + relative
            if absolute in seen or absolute not in names:
                raise ValueError("Manifest entry absent/duplicate")
            seen.add(absolute)
            if sha256(z.read(absolute)) != expected:
                raise ValueError("Manifest file SHA256 mismatch")
            if index % 50 == 0:
                status_message(f"Проверка контрольных сумм: {index}/{SOURCE_MANIFEST_ENTRIES} файлов.")
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




def apply_diagnostics(source: Path, offline: Path | None) -> dict:
    """Apply a byte-exact equivalent of CHAT14's strictly failing assertion.

    On pinned source only; does not require Git, internet, or user browser profile.
    Refuses any unexpected source line and preserves CRLF encoding.
    """
    script = source / "tests" / "app_regression.py"
    helper_target = source / "tests" / "cache_state_diagnostics.py"
    if helper_target.exists():
        raise ValueError("Diagnostic helper destination already exists")
    bundled = Path(__file__).resolve().with_name(LOCAL_HELPER)
    if offline is not None:
        bundled = offline / LOCAL_HELPER
    if not bundled.is_file():
        raise FileNotFoundError("Offline diagnostic helper missing")
    helper_data = bundled.read_bytes()
    if sha256(helper_data) != LOCAL_HELPER_SHA256:
        raise ValueError("Offline diagnostic helper SHA256 mismatch")
    before = script.read_bytes()
    if b'\r\n' not in before or before.count(b'\n') != before.count(b'\r\n'):
        raise ValueError("Test13 app_regression.py is not the expected CRLF original")
    replacements = [
       (b'from board_benchmark import QuietHandler\r\n',
        b'from board_benchmark import QuietHandler\r\n'
        b'from cache_state_diagnostics import assert_cache_state_unchanged\r\n'),
       (b'            before_cleanup = ev("JSON.stringify([S.board, S.org, LS.get(\'pal28\')])")\r\n',
        b'            before_cleanup = ev("JSON.stringify([S.board, S.org, LS.get(\'pal28\')])")\r\n'
        b'            before_save_state = ev("({updatedAt:S.board?.updatedAt,dirty,saving,saveAgain,timerPending:!!saveTimer})")\r\n'),
       (b'            assert before_cleanup == ev("JSON.stringify([S.board, S.org, LS.get(\'pal28\')])")\r\n',
        b'            after_cleanup = ev("JSON.stringify([S.board, S.org, LS.get(\'pal28\')])")\r\n'
        b'            after_save_state = ev("({updatedAt:S.board?.updatedAt,dirty,saving,saveAgain,timerPending:!!saveTimer})")\r\n'
        b'            assert_cache_state_unchanged(before_cleanup, after_cleanup, before_save_state, after_save_state)\r\n')
    ]
    patched=before
    for original, modified in replacements:
        if patched.count(original) != 1:
            raise ValueError("Unexpected app_regression.py diagnostic anchor; no source change")
        patched=patched.replace(original, modified)
    if patched == before or b'            assert before_cleanup == ev(' in patched:
        raise ValueError("Strict diagnostic not activated")
    # Python child process + .pyc output caused Windows v2 PREPARE_DIAGNOSTIC
    # to return RuntimeError (the private report did not capture child stderr).
    # Compile in this already-running Python process: syntax-check exactly the
    # same bytes but do not spawn a second Python or write __pycache__ files.
    # This is validation only: compiled objects are NEVER executed here.
    compile(patched, "<XOD-Test13 diagnostic regression test>", "exec", dont_inherit=True)
    compile(helper_data, "<XOD CHAT14 diagnostic helper>", "exec", dont_inherit=True)
    helper_target.write_bytes(helper_data)
    script.write_bytes(patched)
    return {"method":"CHAT14_EQUIVALENT_STRICT_CRLF_REPLACEMENT",
            "syntax_validation":"IN_PROCESS_COMPILE_NO_PYC_NO_CHILD",
            "helper_sha256":LOCAL_HELPER_SHA256,"original_test_sha256":sha256(before),
            "patched_test_sha256":sha256(patched),"strict_original_assert":"PRESERVED_WITH_STRICT_DIAGNOSTICS",
            "syntax":"PASS","git_required":False,"network_required":False}


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


def run_command(args: list[str], cwd: Path, timeout: int) -> tuple[int, str]:
    """Run without printing confidential stdout; show heartbeat every 15 seconds."""
    try:
        proc=subprocess.Popen(args,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    except FileNotFoundError:
        raise FileNotFoundError("A required executable is not installed or is blocked") from None
    started=time.monotonic()
    while True:
        try:
            stdout,_=proc.communicate(timeout=15)
            return proc.returncode, stdout.decode("utf-8",errors="replace")
        except subprocess.TimeoutExpired:
            elapsed=int(time.monotonic()-started)
            status_message(f"Операция продолжается ({elapsed} сек). Окно можно оставить открытым, закрывать не нужно.")
            if elapsed >= timeout:
                proc.kill()
                proc.communicate()
                return 124, "Timed out; private subprocess output discarded"


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
    bundled = Path(__file__).resolve().with_name(LOCAL_HELPER)
    assert bundled.is_file() and sha256(bundled.read_bytes()) == LOCAL_HELPER_SHA256
    compile(bundled.read_bytes(), "<CHAT14 bundled helper>", "exec", dont_inherit=True)
    print("SELF_TEST PASS (hashes, ZIP paths, manifest, redaction, diagnostics, bundled helper, in-process syntax)")


def main() -> int:
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--zip",help="Private Test13 ZIP saved locally; otherwise use file picker")
    cli.add_argument("--support-dir",help="Optional offline helper directory; default is this kit")
    cli.add_argument("--channel",choices=("msedge","chrome","chromium"),
                     default="msedge" if sys.platform.startswith("win") else "chromium")
    cli.add_argument("--report-dir",help="SAFE output folder, default Downloads/XOD-browser-diag-result")
    cli.add_argument("--self-test",action="store_true")
    args=cli.parse_args()
    if args.self_test:
        self_test();return 0
    out=Path(args.report_dir).expanduser() if args.report_dir else Path.home()/"Downloads"/"XOD-browser-diag-result"
    summary={"schema":3,"runner_version":"3.0","task":"EXEC-002/CHAT14-browser-1265","created_utc":datetime.now(timezone.utc).isoformat(),
             "environment":{"os":platform.system(),"python":platform.python_version(),"channel":args.channel},
             "status":"NOT_STARTED","step":"INITIALIZE","work_used":"NOT_OBSERVED",
             "sol_checkout_modified":False,"main_modified":False,"private_source_published":False,"test_fixture":"synthetic-only"}
    result=7
    status_message("ДИАГНОСТИКА XOD: начало. Это не установка и не изменение рабочего XOD.")
    status_message("Понадобится локальный архив Test13 ZIP; он остаётся на вашем ПК.")
    status_message("Результат появится в Загрузки/XOD-browser-diag-result/safe_summary.json.")
    status_message("При долгом ожидании будут появляться сообщения. Comodo может блокировать Python/Edge: не отключайте защиту.")
    try:
        summary["step"]="SELECT_SOURCE"
        status_message("Шаг 1/5. Поиск архива. Если открылось окно выбора, укажите скачанный из Drive ZIP.")
        zpath=find_source_zip(args.zip)
        if not zpath or not zpath.is_file():
            summary.update(status="MISSING_PRIVATE_ZIP",next_action="Скачайте приватный ZIP Test13 из Google Drive и выберите его локально; не загружайте в публичный GitHub")
            return 2
        summary["step"]="CHECK_ZIP"
        status_message("Шаг 2/5. Проверка Test13: контрольные суммы, CRC, все 431 исходных файла. Не закрывайте окно.")
        summary["source_integrity"]=verify_source_zip(zpath)
        status_message("Шаг 2/5: PASS. Архив подлинный, 431/431 контрольных сумм совпали.")
        with tempfile.TemporaryDirectory(prefix="xod-browser-diagnostic-") as tmp:
            summary["step"]="PREPARE_DIAGNOSTIC"
            status_message("Шаг 3/5. Распаковка во временную папку и добавление строгой диагностики. Git и интернет не нужны.")
            src=unpack_verified_zip(zpath,Path(tmp))
            summary["diagnostic_patch"]=apply_diagnostics(src,Path(args.support_dir) if args.support_dir else None)
            status_message("Шаг 3/5: PASS. Исходный XOD на ПК не изменён; диагностика добавлена во временную копию.")
            summary["step"]="BROWSER_PREFLIGHT"
            status_message("Шаг 4/5. Проверка Edge и localhost. При блокировке Comodo тест остановится безопасно.")
            preflight=localhost_browser_probe(args.channel)
            summary["localhost_browser_preflight"]=preflight
            if preflight["status"] != "PASS":
                summary.update(status="BLOCKED_BROWSER" if preflight["status"]=="BLOCKED_BROWSER" else "ENVIRONMENT_BLOCKED",
                               next_action="Проверьте Edge, Playwright и сообщения Comodo; не отключайте защиту. Прикрепите safe_summary.json")
                status_message("Шаг 4/5: не пройден — браузерный тест не запускался.")
                return 3
            status_message("Шаг 4/5: PASS. Edge может открыть localhost.")
            summary["step"]="BUILD"
            status_message("Шаг 5/5 (1/2). Сборка временной копии XOD. Сообщения о ходе — каждые 15 секунд.")
            code,log=run_command([sys.executable,"build.py","dist"],src,600)
            summary["build"]={"exit_code":code,"log_sha256":sha256(log.encode("utf-8",errors="replace"))}
            if code!=0:
                summary.update(status="BUILD_FAILED",next_action="Сборка временной копии не удалась. Не повторяйте старый запуск: прикрепите safe_summary.json")
                return 4
            status_message("Сборка PASS.")
            summary["step"]="BROWSER_TEST"
            status_message("Шаг 5/5 (2/2). Запуск настоящего app_regression.py в Edge; он может выполняться несколько минут.")
            test=src/"tests/app_regression.py"
            app=src/"dist/app"
            previous=src/"tests/fixtures/legacy224"
            board=src/"tests/fixtures/synthetic-board.json"
            for input_path in (test,app,previous,board):
                if not input_path.exists():
                    raise ValueError("Missing synthetic regression fixture or build output")
            cmd=[sys.executable,str(test),str(app),str(previous),str(board),"--channel",args.channel]
            code,log=run_command(cmd,src,1800)
            safe=extract_safe_diagnostic(log)
            summary["browser_test"]={"exit_code":code,**safe}
            if code==0:
                summary.update(status="BROWSER_REGRESSION_PASS_ONE_RUN",
                               next_action="Отправьте safe_summary.json в чат XOD; один прогон не означает приёмку релиза")
                result=0
            elif safe["saw_strict_cache_comparison_failure"]:
                summary.update(status="BROWSER_CACHE_STATE_DIFF_OBSERVED",
                               next_action="Отправьте safe_summary.json: по JSON-путям нужно определить реальную причину; строгая проверка не ослаблена")
                result=5
            elif safe["saw_browser_admin_block"]:
                summary.update(status="BLOCKED_BROWSER",next_action="Comodo/браузер запретил localhost; не обходите политику; передайте safe_summary.json")
                result=3
            else:
                summary.update(status="BROWSER_TEST_FAILED_ELSEWHERE",
                               next_action="Тест остановился на другой проверке. Отправьте safe_summary.json, не передавайте полный лог с данными")
                result=6
            return result
    except (OSError,ValueError,SyntaxError,RuntimeError,zipfile.BadZipFile,subprocess.SubprocessError) as e:
        stage=summary["step"]
        summary.update(status="PRECONDITION_FAILED",error_type=type(e).__name__,
                       failed_step=stage,next_action=safe_failure_hint(e,stage))
        # Only bounded safe codes: do not serialize raw tracebacks, paths or data.
        if isinstance(e,SyntaxError):
            summary["error_code"]="IN_PROCESS_PYTHON_SYNTAX_ERROR"
            summary["syntax_line"] = e.lineno if isinstance(e.lineno,int) else None
        elif isinstance(e,PermissionError):
            summary["error_code"]="OS_PERMISSION_DENIED"
        elif isinstance(e,FileNotFoundError):
            summary["error_code"]="REQUIRED_LOCAL_FILE_NOT_FOUND"
        elif isinstance(e,RuntimeError):
            summary["error_code"]="RUNTIME_OPERATION_FAILURE"
        elif isinstance(e,ValueError):
            summary["error_code"]="VALIDATION_FAILURE"
        else:
            summary["error_code"]="ENVIRONMENT_FAILURE"
        if isinstance(e,FileNotFoundError):
            summary["suspected_missing_component"]=("python_dependency_or_blocked_file" if stage not in ("PREPARE_DIAGNOSTIC","BROWSER_PREFLIGHT") else "bundled_helper_or_browser")
        return 7
    finally:
        target=write_summary(out,summary)
        status_message("ГОТОВО: "+summary["status"]+" (этап: "+summary["step"]+").")
        status_message("ОТЧЁТ: "+str(target))
        status_message("ЧТО ДЕЛАТЬ: "+summary.get("next_action","Прикрепите safe_summary.json в чат планирования XOD."))
        status_message("Окно можно закрывать; после нажатия клавиши командное окно закроется — это нормально.")
        status_message("Не отправляйте другие файлы, полный лог или приватные исходники.")
        if sys.platform.startswith("win"):
            try:
                os.startfile(str(out))  # type: ignore[attr-defined]
            except OSError:
                status_message("Не удалось открыть папку автоматически; она указана в строке ОТЧЁТ.")


if __name__=="__main__":
    sys.exit(main())
