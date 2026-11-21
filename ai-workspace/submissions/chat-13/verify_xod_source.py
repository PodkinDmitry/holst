#!/usr/bin/env python3
"""Read-only validation for a cleaned XOD source ZIP before local extraction.

Does not publish any files. Checks archive SHA-256, CRC, safe paths,
manifest hashes, Unicode names and provenance. An archive PASS is not a
security audit or proof the product tests passed.
"""
import argparse
import hashlib
import json
from pathlib import PurePosixPath
import stat
import sys
from zipfile import BadZipFile, ZipFile


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify(path, *, expected_sha=None, expected_commit=None):
    data = path.read_bytes()
    archive_sha = sha256(data)
    if expected_sha and archive_sha.lower() != expected_sha.lower():
        raise ValueError('ZIP SHA-256 does not match the expected digest')
    with ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP CRC failure')
        entries = [info for info in archive.infolist() if not info.is_dir()]
        paths = [info.filename for info in entries]
        if len(set(paths)) != len(paths):
            raise ValueError('duplicate ZIP path')
        for info in archive.infolist():
            name = info.filename
            parts = PurePosixPath(name).parts
            if (not name or name.startswith('/') or '\\' in name or
                    any(part in ('', '.', '..') for part in parts) or
                    ':' in parts[0]):
                raise ValueError('unsafe ZIP path: '+repr(name))
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError('ZIP symlink not allowed: '+name)
        roots = {PurePosixPath(p).parts[0] for p in paths}
        if len(roots) != 1:
            raise ValueError('ZIP files must have exactly one root')
        root = roots.pop()
        manifest_name = root+'/SOURCE_SHA256SUMS.txt'
        provenance_name = root+'/SOURCE_PROVENANCE.json'
        if manifest_name not in paths or provenance_name not in paths:
            raise ValueError('source manifest/provenance missing')
        file_data = {p:archive.read(p) for p in paths}
        lines = file_data[manifest_name].decode('utf-8').splitlines()
        covered = set()
        for line in lines:
            digest, sep, name = line.partition('  ')
            if len(digest) != 64 or not sep or not name:
                raise ValueError('malformed manifest record')
            member = root+'/'+name
            if member in covered:
                raise ValueError('duplicate manifest path')
            covered.add(member)
            if member not in file_data or sha256(file_data[member]) != digest.lower():
                raise ValueError('manifest mismatch: '+name)
        expected = set(file_data) - {manifest_name}
        if covered != expected:
            raise ValueError('manifest coverage mismatch: '+str(sorted(expected-covered)[:2]))
        provenance = json.loads(file_data[provenance_name])
        commit = archive.comment.decode('ascii', errors='strict')
        if not (len(commit)==40 and all(c in '0123456789abcdef' for c in commit)):
            raise ValueError('ZIP commit marker must be a 40-character hex SHA')
        if expected_commit and not commit.startswith(expected_commit):
            raise ValueError('source commit mismatch')
        return {'status':'PASS','zip_sha256':archive_sha,'root':root,
                'files':len(paths),'manifest_entries':len(lines),
                'manifest_sha256':sha256(file_data[manifest_name]),
                'provenance_commit':commit}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('zip_path', type=__import__('pathlib').Path)
    ap.add_argument('--sha256', dest='expected_sha')
    ap.add_argument('--commit', dest='expected_commit')
    args = ap.parse_args()
    try:
        result = verify(args.zip_path, expected_sha=args.expected_sha,
                        expected_commit=args.expected_commit)
    except (OSError, ValueError, BadZipFile, UnicodeError) as error:
        print('FAIL: '+str(error), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
