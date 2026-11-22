"""XOD offline cycle contract tests; no paid models, network or private test boards."""
from __future__ import annotations
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name('xod-cycle.py')
spec = importlib.util.spec_from_file_location('xod_cycle', SCRIPT)
cycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cycle)


class SafeZipTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='xod-test-')
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write_zip(self, entries):
        zippath = self.root / 'input.zip'
        with zipfile.ZipFile(zippath, 'w') as z:
            for path, value in entries:
                z.writestr(path, value)
        return zippath

    def test_safe_archive(self):
        f = self.write_zip([('folder/a.txt', 'safe'), ('b.txt', 'ok')])
        self.assertEqual(cycle.unpack_safe(f, self.root / 'dest'), 6)
        self.assertEqual((self.root/'dest/folder/a.txt').read_text(), 'safe')

    def test_reject_cross_platform_unsafe_paths(self):
        for bad in ('../escape.txt','/root.txt','C:/absolute.txt','a\\b.txt','NUL.txt',
                    'con/unsafe','foo./bar.txt','x//y.txt','x/../y.txt','a:b.txt',
                    'trailing /a.txt'):
            with self.subTest(bad=bad):
                dest = self.root / 'destination'
                shutil.rmtree(dest,ignore_errors=True)
                dest.mkdir()
                path=self.write_zip([(bad, 'x')])
                if bad=='trailing /a.txt':
                    # Internal spaces are legal; only trailing space in a path segment is illegal.
                    self.assertRaises(ValueError, cycle.unpack_safe, path, dest)
                else:
                    self.assertRaises(ValueError, cycle.unpack_safe, path, dest)
                self.assertEqual(list(dest.rglob('*')),[])

    def test_reject_collisions(self):
        for entries in [ [('A.txt','one'),('a.txt','two')],
                         [('x/y','one'),('x','file')],
                         [('x','file'),('x/y','one')] ]:
            with self.subTest(entries=entries):
                zippath=self.write_zip(entries)
                with self.assertRaises(ValueError):
                    cycle.unpack_safe(zippath,self.root/'safe')

    def test_reject_symlink_zip(self):
        name=zipfile.ZipInfo('symlink')
        name.create_system=3
        name.external_attr=(0o120777 << 16)
        zippath=self.write_zip([(name,'/outside')])
        with self.assertRaises(ValueError):
            cycle.unpack_safe(zippath,self.root/'safe')

    def test_directory_symlink_protection(self):
        if not hasattr(Path,'symlink_to'): self.skipTest('Symlinks unsupported')
        source=self.root/'source'; source.mkdir()
        secret=self.root/'secret';secret.write_text('secret')
        try: (source/'escape').symlink_to(secret)
        except (OSError,NotImplementedError): self.skipTest('Symlinks unavailable')
        with self.assertRaises(ValueError):
            cycle.copy_source_directory(source,self.root/'copied')


class IntegrationTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='xod-it-')
        self.root=Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_cycle(self,source:Path,out:Path,extra=()):
        proc=subprocess.run([sys.executable,str(SCRIPT),'--source',str(source),'--out',str(out),*extra],
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
        return proc,json.loads((out/'cycle.json').read_text()) if (out/'cycle.json').exists() else None

    def test_synthetic_xod3_build_without_browser(self):
        source=self.root/'code';source.mkdir()
        (source/'build.py').write_text("from pathlib import Path\nPath('dist').mkdir(exist_ok=True)\nPath('dist/xod.html').write_text('ok')\n")
        proc,report=self.run_cycle(source,self.root/'out')
        self.assertEqual(proc.returncode,0,proc.stderr)
        self.assertEqual(report['profile'],'xod3')
        self.assertEqual(report['gates'][0]['status'],'PASS')
        self.assertEqual(report['gates'][0]['command'][0],sys.executable)
        self.assertEqual(report['gates'][-1]['status'],'NOT_RUN')
        self.assertFalse(report['product_release_accepted'])
        with zipfile.ZipFile(self.root/'out/xod-dist.zip') as z:
            self.assertEqual(z.namelist(),['xod.html'])

    def test_failed_browser_does_not_lose_package(self):
        source=self.root/'code'; (source/'tests').mkdir(parents=True)
        (source/'build.py').write_text("from pathlib import Path\nPath('dist').mkdir(exist_ok=True)\nPath('dist/xod.html').write_text('ok')\n")
        (source/'tests/app_regression.py').write_text('import sys\nsys.exit(9)\n')
        proc,report=self.run_cycle(source,self.root/'out',('--browser-test',))
        self.assertNotEqual(proc.returncode,0)
        self.assertEqual(report['gates'][0]['status'],'PASS')
        self.assertEqual(report['gates'][1]['status'],'FAIL')
        self.assertTrue((self.root/'out/xod-dist.zip').is_file())
        self.assertFalse(report['product_release_accepted'])

    def test_no_output_inside_source(self):
        source=self.root/'code';source.mkdir();(source/'build.py').write_text('')
        p,r=self.run_cycle(source,source/'builds')
        self.assertNotEqual(p.returncode,0)
        self.assertIsNone(r)
        self.assertFalse((source/'builds').exists())

    def test_out_file_is_rejected(self):
        source=self.root/'code';source.mkdir();(source/'build.py').write_text('')
        out=self.root/'out';out.write_text('existing')
        p,r=self.run_cycle(source,out)
        self.assertNotEqual(p.returncode,0)
        self.assertIsNone(r)
        self.assertEqual(out.read_text(),'existing')

if __name__=='__main__':
    unittest.main(verbosity=2)