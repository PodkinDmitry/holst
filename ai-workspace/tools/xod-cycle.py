#!/usr/bin/env python3
"""XOD offline one-command build and selected test gates.

Runs only against an explicitly supplied, trusted local source ZIP/folder.
No model/API calls, network uploads, repo writes, or background work.
The underlying trusted build/tests may have their own external dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

MAX_ZIP_BYTES = 1024 * 1024 * 1024
WINDOWS_RESERVED = frozenset(
    {'CON', 'PRN', 'AUX', 'NUL'}
    | {f'COM{i}' for i in range(1, 10)}
    | {f'LPT{i}' for i in range(1, 10)}
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def safe_member_name(name: str) -> tuple[str, ...]:
    """Validate archive path on POSIX and Windows, regardless of host OS."""
    if not name or '\x00' in name or '\\' in name or name.startswith('/'):
        raise ValueError(f'Unsafe archive member: {name[:120]!r}')
    path = PurePosixPath(name)
    parts = path.parts
    if path.is_absolute() or any(part in ('.', '..', '') for part in name.rstrip('/').split('/')):
        raise ValueError(f'Unsafe archive traversal: {name[:120]!r}')
    for part in parts:
        if ':' in part or part.rstrip(' .') != part or part.split('.')[0].upper() in WINDOWS_RESERVED:
            raise ValueError(f'Archive member is not portable to Windows: {name[:120]!r}')
    return parts


def unpack_safe(source: Path, dest: Path) -> int:
    """ZIP extraction with traversal, symlink, collision and bomb protections."""
    total = 0
    seen: dict[str, str] = {}
    with zipfile.ZipFile(source) as archive:
        # Validate the entire central directory before writing a single entry.
        manifest: list[tuple[zipfile.ZipInfo, tuple[str, ...], bool]] = []
        for info in archive.infolist():
            parts = safe_member_name(info.filename)
            mode = (info.external_attr >> 16) & 0o170000
            if mode not in (0, 0o100000, 0o040000):
                raise ValueError(f'Archive special file/symlink forbidden: {info.filename[:120]!r}')
            is_dir = info.is_dir()
            key = '/'.join(parts).casefold()
            previous = seen.get(key)
            if previous is not None:
                raise ValueError(f'Archive duplicate/case-collision: {previous!r} / {info.filename!r}')
            seen[key] = info.filename
            total += info.file_size
            if total > MAX_ZIP_BYTES:
                raise ValueError('Archive uncompressed size exceeds 1 GiB')
            manifest.append((info, parts, is_dir))
        file_keys = {'/'.join(parts).casefold() for _, parts, is_dir in manifest if not is_dir}
        for key in file_keys:
            segments = key.split('/')
            for i in range(1, len(segments)):
                if '/'.join(segments[:i]) in file_keys:
                    raise ValueError('Archive file conflicts with a nested path')
        for info, parts, is_dir in manifest:
            target = dest.joinpath(*parts)
            if is_dir:
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as reader, target.open('xb') as writer:
                    shutil.copyfileobj(reader, writer)
    return total


def copy_source_directory(source: Path, destination: Path) -> None:
    """Never follow file symlinks outside the chosen source tree."""
    for item in source.rglob('*'):
        if item.is_symlink():
            raise ValueError(f'Symlink forbidden in source: {item.relative_to(source)}')
    shutil.copytree(source, destination, dirs_exist_ok=True, symlinks=False)


def archive_tree(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for item in sorted(source.rglob('*')):
            if item.is_symlink():
                raise ValueError(f'Symlink forbidden in output tree: {item.relative_to(source)}')
            if item.is_file():
                archive.write(item, item.relative_to(source).as_posix())


def run_command(args: list[str], cwd: Path, timeout: int, logs: Path, label: str) -> dict:
    entry = {'gate': label, 'command': args, 'status': 'FAIL'}
    started = time.monotonic()
    try:
        with logs.open('ab') as output:
            output.write(('\n=== ' + label + ': ' + ' '.join(args) + ' ===\n').encode('utf-8'))
            result = subprocess.run(args, cwd=cwd, stdout=output,
                                    stderr=subprocess.STDOUT, timeout=timeout, check=False)
        entry['exit_code'] = result.returncode
        entry['status'] = 'PASS' if result.returncode == 0 else 'FAIL'
        if result.returncode and label in ('browser-smoke', 'xod3-browser-regression'):
            tail = logs.read_bytes()[-6000:].decode('utf-8', 'replace')
            if "Executable doesn't exist" in tail or 'playwright install' in tail:
                entry.update(status='BLOCKED_ENVIRONMENT', reason='Playwright browser executable missing')
    except subprocess.TimeoutExpired:
        entry.update(status='TIMEOUT', reason=f'Exceeded {timeout}s')
    except OSError as exc:
        entry.update(status='BLOCKED_ENVIRONMENT', reason=type(exc).__name__)
    entry['seconds'] = round(time.monotonic() - started, 3)
    return entry


def inline_js(source: Path, destination: Path) -> None:
    page = source.read_text(encoding='utf-8')
    scripts = re.findall(r'<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)</script>', page, flags=re.I)
    if not scripts:
        raise RuntimeError('No inline JavaScript found to check')
    destination.write_text(max(scripts, key=len), encoding='utf-8')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Trusted local devkit .zip or source directory')
    parser.add_argument('--out', type=Path, required=True, help='New/empty output directory; must not overlap source')
    parser.add_argument('--profile', choices=['detect', 'legacy224', 'xod3'], default='detect')
    parser.add_argument('--browser-test', action='store_true', help='Opt-in browser regression, requires browser executable')
    parser.add_argument('--timeout', type=int, default=600, help='Per-command timeout in seconds (1..3600)')
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    output = args.out.expanduser().resolve()
    if not source.exists():
        parser.error('Source does not exist')
    if args.timeout < 1 or args.timeout > 3600:
        parser.error('Timeout must be 1..3600 seconds')
    if output == source or source in output.parents or (source.is_dir() and output in source.parents):
        parser.error('Output directory must not overlap source')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        parser.error('Output must be a new or empty directory')
    output.mkdir(parents=True, exist_ok=True)
    log = output / 'cycle.log'
    report = {
        'schema': 2,
        'source_kind': 'zip' if source.is_file() else 'directory',
        'input_sha256': sha256(source) if source.is_file() else None,
        'profile': None, 'gates': [], 'artifacts': [],
        'product_release_accepted': False, 'drive_live_e2e': 'NOT_RUN',
        'user_acceptance': 'NOT_RUN', 'main_modified': False,
        'premium_model_used': False,
    }
    began = time.monotonic()
    exit_code = 2
    try:
        with tempfile.TemporaryDirectory(prefix='xod-cycle-') as work:
            workdir = Path(work)
            root = workdir / 'source'
            root.mkdir()
            if source.is_file():
                unpack_safe(source, root)
            else:
                copy_source_directory(source, root)
            profile = args.profile
            if profile == 'detect':
                profile = ('xod3' if (root / 'build.py').exists() else
                           'legacy224' if (root / 'v224/patch224.py').exists() else '')
            if not profile:
                raise RuntimeError('Unknown source layout; no safe build recipe')
            report['profile'] = profile

            def gate(name: str, command: list[str], cwd: Path) -> None:
                entry = run_command(command, cwd, args.timeout, log, name)
                report['gates'].append(entry)
                if entry['status'] != 'PASS':
                    raise RuntimeError(f'{name}: {entry["status"]}')

            if profile == 'legacy224':
                v = root / 'v224'
                app = root / 'app224'
                ext = root / 'ext224'
                if not (v / 'patch224.py').is_file() or not app.is_dir() or not ext.is_dir():
                    raise RuntimeError('Source does not contain complete legacy224 layout')
                # sys.executable works for python.exe, py-launched Python and Unix Python.
                gate('legacy224-build', [sys.executable, 'patch224.py'], v)
                html = v / 'holst.html'
                if not html.is_file() or html.stat().st_size < 1024:
                    raise RuntimeError('Legacy build did not produce HTML')
                (app / 'index.html').write_bytes(html.read_bytes())
                inline_js(html, workdir / 'inline.js')
                gate('inline-js-syntax', ['node', '--check', str(workdir / 'inline.js')], v)
                archive_tree(app, output / 'holst-app.zip')
                archive_tree(ext, output / 'holst-extension.zip')
                shutil.copy2(html, output / 'holst.html')
                if args.browser_test:
                    smoke = root / 't224/x/smoke.py'
                    if not smoke.is_file():
                        raise RuntimeError('Browser smoke test script missing')
                    gate('browser-smoke', [sys.executable, str(smoke), str(app)], root)
                else:
                    report['gates'].append({'gate': 'browser-smoke', 'status': 'NOT_RUN',
                                            'reason': 'Use --browser-test'})
            elif profile == 'xod3':
                build = root / 'build.py'
                tests = root / 'tests/app_regression.py'
                if not build.is_file():
                    raise RuntimeError('Source missing XOD3 build.py')
                gate('xod3-build', [sys.executable, str(build), 'dist'], root)
                dist = root / 'dist'
                if not dist.is_dir():
                    raise RuntimeError('Build succeeded but did not create dist/')
                archive_tree(dist, output / 'xod-dist.zip')
                if args.browser_test:
                    if not tests.is_file():
                        raise RuntimeError('Source missing tests/app_regression.py')
                    gate('xod3-browser-regression', [sys.executable, str(tests)], root)
                else:
                    report['gates'].append({'gate': 'xod3-browser-regression', 'status': 'NOT_RUN',
                                            'reason': 'Use --browser-test'})
            else:
                raise RuntimeError('Unsupported build recipe')
            report['status'] = 'BUILD_AND_SELECTED_GATES_PASS'
            exit_code = 0
    except Exception as exc:
        report['status'] = 'BLOCKED_OR_FAILED'
        report['error'] = f'{type(exc).__name__}: {str(exc)[:500]}'
    finally:
        for item in sorted(output.iterdir()):
            if item.is_file() and item.suffix in ('.zip', '.html'):
                report['artifacts'].append({'name': item.name,
                                            'sha256': sha256(item), 'bytes': item.stat().st_size})
        report['elapsed_seconds'] = round(time.monotonic() - began, 3)
        (output / 'cycle.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'status': report['status'], 'profile': report['profile'],
                          'gates': [(g['gate'], g['status']) for g in report['gates']],
                          'artifacts': [a['name'] for a in report['artifacts']],
                          'report': str(output / 'cycle.json')}, ensure_ascii=False))
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())