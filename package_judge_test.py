"""Distribution checks use temporary source fixtures, never developer credentials."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from package_judge import REQUIRED_FILES, allowed_source_name, build_archive
from verify_judge_package import PREFIX, checked_contents, sanitized_environment


class JudgePackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="infinite-stadium-package-test-")
        self.root = Path(self.temporary.name).resolve()
        self.assertEqual(self.root.parent, Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.temporary.cleanup)
        for name in (*REQUIRED_FILES, "server.js", "verify_judge_package.py"):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("fixture source\n", encoding="utf-8")

    def archive(self):
        return Path(build_archive(self.root)["archive"])

    def rewrite(self, change):
        archive = self.archive()
        with zipfile.ZipFile(archive) as bundle:
            entries = {name: bundle.read(name) for name in bundle.namelist()}
        change(entries)
        with zipfile.ZipFile(archive, "w") as bundle:
            for name, data in entries.items():
                bundle.writestr(name, data)
        return archive

    def test_build_excludes_credentials_installed_packages_models_and_runtime(self):
        for name in (".env", ".env.azure", ".runtime/budget.json", "node_modules/vendor.js",
                     ".venv/secret.py", "models/model.gguf", "artifacts/private.js", ".private.js"):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("DO_NOT_PACKAGE", encoding="utf-8")
        contents = checked_contents(self.archive())
        self.assertIn(".env.example", contents)
        self.assertFalse(any(b"DO_NOT_PACKAGE" in data for data in contents.values()))

    def test_fixed_metadata_is_reproducible_despite_source_mtime(self):
        archive = self.archive()
        original = archive.read_bytes()
        os.utime(self.root / "server.js", (1700000000, 1700000000))
        self.assertEqual(self.archive().read_bytes(), original)

    def test_manifest_matches_exact_source_bytes(self):
        contents = checked_contents(self.archive())
        manifest = json.loads(contents.pop("BUILD_MANIFEST.json"))
        self.assertEqual(manifest, {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()})

    def test_changed_source_and_unmanifested_file_are_rejected(self):
        archive = self.rewrite(lambda entries: entries.__setitem__(PREFIX + "server.js", b"changed"))
        with self.assertRaisesRegex(ValueError, "hash"):
            checked_contents(archive)
        archive = self.rewrite(lambda entries: entries.__setitem__(PREFIX + "extra.js", b"extra"))
        with self.assertRaisesRegex(ValueError, "manifest"):
            checked_contents(archive)

    def test_traversal_credentials_and_windows_alternate_streams_are_rejected(self):
        for name in ("../outside.js", "/absolute.js", "folder/../../outside.js", "evil\\file.js",
                     "server.js:hidden.js", ".env.azure", ".runtime/secret.js", "node_modules/a.js"):
            with self.subTest(name=name):
                self.assertFalse(allowed_source_name(name))
                archive = self.rewrite(lambda entries: entries.__setitem__(PREFIX + name, b"bad"))
                with self.assertRaises(ValueError):
                    checked_contents(archive)

    def test_case_colliding_archive_files_are_rejected(self):
        archive = self.rewrite(lambda entries: entries.__setitem__(PREFIX + "SERVER.js", b"duplicate"))
        with self.assertRaisesRegex(ValueError, "case-colliding"):
            checked_contents(archive)

    def test_zip_symlink_is_rejected_before_extraction(self):
        archive = self.archive()
        with zipfile.ZipFile(archive, "a") as bundle:
            info = zipfile.ZipInfo(PREFIX + "linked.js")
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            bundle.writestr(info, "../outside.js")
        with self.assertRaisesRegex(ValueError, "symlink"):
            checked_contents(archive)

    def test_missing_required_asset_stops_packaging(self):
        (self.root / "fan-experience.css").unlink()
        with self.assertRaisesRegex(RuntimeError, "missing"):
            self.archive()

    def test_environment_cannot_inherit_cloud_local_or_node_configuration(self):
        with patch.dict(os.environ, {"AZURE_OPENAI_API_KEY": "test-secret", "AI_PROVIDER": "local",
                        "NODE_OPTIONS": "--require=outside.js", "MODEL_BUDGET_FILE": "outside",
                        "APP_ACCESS_TOKEN": "test-access", "HOST": "0.0.0.0"}):
            env = sanitized_environment(51234)
        self.assertEqual(env["HOST"], "127.0.0.1")
        self.assertEqual(env["PORT"], "51234")
        self.assertFalse(set(env) & {"AZURE_OPENAI_API_KEY", "AI_PROVIDER", "NODE_OPTIONS", "MODEL_BUDGET_FILE", "APP_ACCESS_TOKEN"})


if __name__ == "__main__":
    unittest.main()
