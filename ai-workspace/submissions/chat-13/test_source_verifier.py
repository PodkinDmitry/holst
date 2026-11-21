from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import hashlib
import io
import json
import unittest
from verify_xod_source import verify


def d(b): return hashlib.sha256(b).hexdigest()


def create_zip(filename, *, unsafe=False, corrupt=False, duplicate=False):
    root='source'
    payload={'source/app.js':b'console.log(1)',
             'source/Как установить.txt':'всё верно'.encode(),
             'source/SOURCE_PROVENANCE.json':json.dumps({'source_commit':'6429ad6'}).encode()}
    manifest='\n'.join(d(x)+ '  '+p[len(root)+1:] for p,x in payload.items()).encode()+b'\n'
    payload['source/SOURCE_SHA256SUMS.txt']=manifest
    if corrupt: payload['source/app.js']=b'bad'
    if unsafe: payload['../escape.txt']=b'bad'
    with ZipFile(filename, 'w') as z:
        for name,data in payload.items(): z.writestr(name,data)
        if duplicate:z.writestr('source/app.js',b'bad')
        z.comment=b'6429ad61490301e4b942f2190b0be593d449309c'


class VerifyTests(unittest.TestCase):
    def test_pass_unicode_and_count(self):
        with TemporaryDirectory() as td:
            p=Path(td)/'a.zip';create_zip(p)
            result=verify(p,expected_sha=d(p.read_bytes()),expected_commit='6429ad6')
            self.assertEqual(result['files'],4)
            self.assertEqual(result['manifest_entries'],3)
    def test_wrong_zip_digest(self):
        with TemporaryDirectory() as td:
            p=Path(td)/'a.zip';create_zip(p)
            with self.assertRaisesRegex(ValueError,'ZIP SHA'):verify(p,expected_sha='0'*64)
    def test_bad_manifest(self):
        with TemporaryDirectory() as td:
            p=Path(td)/'a.zip';create_zip(p,corrupt=True)
            with self.assertRaisesRegex(ValueError,'manifest mismatch'):verify(p)
    def test_unsafe_path(self):
        with TemporaryDirectory() as td:
            p=Path(td)/'a.zip';create_zip(p,unsafe=True)
            with self.assertRaisesRegex(ValueError,'unsafe ZIP path'):verify(p)
    def test_duplicate_path(self):
        with TemporaryDirectory() as td:
            p=Path(td)/'a.zip';create_zip(p,duplicate=True)
            with self.assertRaisesRegex(ValueError,'duplicate ZIP path'):verify(p)

if __name__=='__main__':unittest.main()
