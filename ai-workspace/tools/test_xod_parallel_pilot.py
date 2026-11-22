import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
SCRIPT = HERE / "xod-parallel-pilot.py"


def cmd(*args):
    return subprocess.run(args, capture_output=True, text=True)


class PilotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "source"
        self.repo.mkdir()
        for args in [("init", "-q"), ("config", "user.name", "Test"), ("config", "user.email", "test@example.invalid")]:
            self.assertEqual(cmd("git", "-C", str(self.repo), *args).returncode, 0)
        for name in ["v224/m_data300.js", "v224/xod-youtube-table300.js", "v224/m_mark224.js", "v224/m_viewport300.js", "ext224/bridge.js", "tests/app_regression.py"]:
            p=self.repo/name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("base\n")
        self.assertEqual(cmd("git", "-C", str(self.repo), "add", ".").returncode, 0)
        self.assertEqual(cmd("git", "-C", str(self.repo), "commit", "-qm", "baseline").returncode, 0)
        self.sha=cmd("git", "-C", str(self.repo), "rev-parse", "HEAD").stdout.strip()
        self.assertEqual(cmd("git", "-C", str(self.repo), "branch", "release/xod-3.0").returncode, 0)
        self.out=self.root/"pilot"

    def runscript(self,*args):
        p=cmd(sys.executable,str(SCRIPT),*args)
        return p.returncode,json.loads(p.stdout)

    def prepare(self, apply=False, sha=None):
        args=["prepare","--repo",str(self.repo),"--root",str(self.out)]
        if sha: args += ["--expected-sha",sha]
        if apply: args += ["--apply"]
        return self.runscript(*args)

    def change(self,lane,path,content):
        p=self.out/lane/path
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(content)
        self.assertEqual(cmd("git","-C",str(self.out/lane),"add",".").returncode,0)
        self.assertEqual(cmd("git","-C",str(self.out/lane),"commit","-qm","lane change").returncode,0)

    def audit(self):
        return self.runscript("audit","--repo",str(self.repo),"--base",self.sha,"--app-ref","pilot/xod3-foundation","--youtube-ref","pilot/youtube-beta")

    def test_dry_run_has_no_side_effect(self):
        rc,data=self.prepare()
        self.assertEqual((rc,data["status"]),(0,"READ_ONLY_PLAN"))
        self.assertFalse(self.out.exists())
        self.assertNotEqual(cmd("git","-C",str(self.repo),"show-ref","--verify","refs/heads/pilot/xod3-foundation").returncode,0)

    def test_apply_requires_exact_sha(self):
        self.assertEqual(self.prepare(apply=True)[1]["status"],"BLOCKED")
        self.assertEqual(self.prepare(apply=True,sha="0"*40)[1]["status"],"BLOCKED")
        self.assertFalse(self.out.exists())

    def test_two_worktrees_created_without_source_changes(self):
        rc,data=self.prepare(apply=True,sha=self.sha)
        self.assertEqual((rc,data["status"]),(0,"LOCAL_WORKTREES_CREATED"))
        self.assertTrue((self.out/"app"/".git").exists())
        self.assertTrue((self.out/"youtube"/".git").exists())
        self.assertEqual(cmd("git","-C",str(self.repo),"status","--porcelain").stdout,"")

    def test_boundary_pass_on_disjoint_sources(self):
        self.prepare(apply=True,sha=self.sha)
        self.change("app","v224/m_data300.js","app\n")
        self.change("youtube","v224/xod-youtube-table300.js","youtube\n")
        rc,data=self.audit()
        self.assertEqual((rc,data["status"]),(0,"BOUNDARY_PASS"))
        self.assertEqual(data["integration"],"NOT_RUN")

    def test_shared_bridge_is_blocked(self):
        self.prepare(apply=True,sha=self.sha)
        self.change("youtube","ext224/bridge.js","changed\n")
        rc,data=self.audit()
        self.assertEqual((rc,data["status"]),(2,"BLOCKED_SCOPE"))
        self.assertIn("ext224/bridge.js",data["youtube_out_of_scope"])

    def test_out_of_scope_app_change_blocked(self):
        self.prepare(apply=True,sha=self.sha)
        self.change("app","v224/xod-youtube-table300.js","not mine\n")
        rc,data=self.audit()
        self.assertEqual((rc,data["status"]),(2,"BLOCKED_SCOPE"))

    def test_dirty_source_blocks_prepare(self):
        (self.repo/"v224/m_data300.js").write_text("dirty\n")
        rc,data=self.prepare(apply=True,sha=self.sha)
        self.assertEqual((rc,data["status"]),(2,"BLOCKED"))
        self.assertFalse(self.out.exists())

    def test_old_devkit_without_target_files_blocked(self):
        (self.repo/"v224/xod-youtube-table300.js").unlink()
        cmd("git","-C",str(self.repo),"add","-u")
        cmd("git","-C",str(self.repo),"commit","-qm","older source")
        updated=cmd("git","-C",str(self.repo),"rev-parse","HEAD").stdout.strip()
        rc,data=self.runscript("prepare","--repo",str(self.repo),"--base-ref",updated,"--root",str(self.out))
        self.assertEqual((rc,data["status"]),(2,"BLOCKED"))
        self.assertFalse(self.out.exists())

    def test_main_ref_is_blocked(self):
        rc,data=self.runscript("prepare","--repo",str(self.repo),"--base-ref","main","--root",str(self.out))
        self.assertEqual((rc,data["status"]),(2,"BLOCKED"))

    def test_no_product_changes_not_misrepresented(self):
        self.prepare(apply=True,sha=self.sha)
        rc,data=self.audit()
        self.assertEqual((rc,data["status"]),(2,"NO_PRODUCT_CHANGES"))


    def test_audit_blocks_uncommitted_app_change(self):
        self.prepare(apply=True,sha=self.sha)
        self.change("youtube","v224/xod-youtube-table300.js","youtube\n")
        (self.out/"app"/"v224/m_data300.js").write_text("uncommitted work\n")
        rc,data=self.audit()
        self.assertEqual((rc,data["status"]),(2,"BLOCKED"))
        self.assertIn("dirty", data["error"].lower())

    def test_audit_blocks_untracked_youtube_change(self):
        self.prepare(apply=True,sha=self.sha)
        self.change("app","v224/m_data300.js","app\n")
        (self.out/"youtube"/"new-untracked.js").write_text("uncommitted work\n")
        rc,data=self.audit()
        self.assertEqual((rc,data["status"]),(2,"BLOCKED"))
        self.assertIn("dirty", data["error"].lower())

    def test_audit_blocks_diverged_baseline(self):
        self.prepare(apply=True,sha=self.sha)
        # Independent root commit (no shared ancestor), only on synthetic repo.
        t=cmd("git","-C",str(self.repo),"rev-parse","HEAD^{tree}").stdout.strip()
        new=cmd("git","-C",str(self.repo),"commit-tree",t,"-m","orphan").stdout.strip()
        self.assertEqual(cmd("git","-C",str(self.repo),"branch","orphan",new).returncode,0)
        rc,data=self.runscript("audit","--repo",str(self.repo),"--base",self.sha,"--app-ref","orphan","--youtube-ref","pilot/youtube-beta")
        self.assertEqual((rc,data["status"]),(2,"BLOCKED"))
        self.assertIn("ancestor",data["error"].lower())

    def test_audit_blocks_missing_worktree(self):
        self.prepare(apply=True,sha=self.sha)
        self.assertEqual(cmd("git","-C",str(self.repo),"worktree","remove",str(self.out/"youtube")).returncode,0)
        rc,data=self.audit()
        self.assertEqual((rc,data["status"]),(2,"BLOCKED"))
        self.assertIn("worktree",data["error"].lower())


if __name__ == "__main__":
    unittest.main()
