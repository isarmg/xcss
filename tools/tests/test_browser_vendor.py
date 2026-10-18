from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/vendor-xcss-web.py"
SPEC = importlib.util.spec_from_file_location("browser_vendor", SCRIPT)
assert SPEC and SPEC.loader
vendor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vendor)


class VendorFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / "upstream"
        self.source = self.project / "web/xcss-web"
        for name, content in {
            "Cargo.toml": '[package]\nname="xcss-web"\nversion="1.0.0"\n',
            "README.md": "Fixture package\n", "src/lib.rs": "pub fn fixture() {}\n",
            "startup.js": "export const fixture = true;\n", "startup.css": "body {}\n",
            "tests/startup-failures.mjs": "export const fixture = true;\n",
            "vendor/xcss-web-core/SOURCE.json": "{}\n",
            "vendor/xcss-web-core/LICENSE": "Fixture original notice\n",
            "vendor/xcss-web-macro/SOURCE.json": "{}\n",
        }.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        (self.project / "LICENSE").write_text("Fixture notice\n")
        self.git("init", "--quiet")
        self.commit()

    def git(self, *arguments: str) -> bytes:
        env = os.environ | {
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
            "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
        }
        return subprocess.check_output(["git", *arguments], cwd=self.project, env=env)

    def commit(self) -> None:
        self.git("add", ".")
        self.git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Fixture")


class BrowserVendorTests(VendorFixture):
    def test_explicit_independent_destinations_preserve_identical_input_mtimes(self) -> None:
        payload = vendor.browser_payload(self.project)
        for name in ("arbitrary-consumer-one", "another-layout/portable-library"):
            destination = self.root / name
            vendor.synchronize(destination, payload, check=False)
            original_time = (destination / "src/lib.rs").stat().st_mtime_ns
            vendor.synchronize(destination, payload, check=False)
            vendor.synchronize(destination, payload, check=True)
            self.assertEqual((destination / "src/lib.rs").stat().st_mtime_ns, original_time)
            source = json.loads((destination / "SOURCE.json").read_text())
            self.assertEqual(source["base_revision"], self.git("rev-parse", "HEAD").decode().strip())

    def test_dirty_sources_cannot_claim_a_committed_revision(self) -> None:
        (self.source / "src/lib.rs").write_text("pub fn edited() {}\n")
        with self.assertRaisesRegex(ValueError, "Commit.*inputs"):
            vendor.browser_payload(self.project)

    def test_edited_managed_file_is_not_overwritten_even_without_unknown_paths(self) -> None:
        payload = vendor.browser_payload(self.project)
        destination = self.root / "consumer"
        vendor.synchronize(destination, payload, check=False)
        (destination / "README.md").write_text("Uncommitted consumer work\n")
        with self.assertRaisesRegex(ValueError, "edited or unrecorded"):
            vendor.synchronize(destination, payload, check=False)
        self.assertEqual((destination / "README.md").read_text(), "Uncommitted consumer work\n")

    def test_unknown_files_and_linked_parents_are_preserved_and_rejected(self) -> None:
        payload = vendor.browser_payload(self.project)
        destination = self.root / "consumer"
        vendor.synchronize(destination, payload, check=False)
        (destination / "authored.txt").write_text("Keep me\n")
        with self.assertRaisesRegex(ValueError, "edited or unrecorded"):
            vendor.synchronize(destination, payload, check=False)
        self.assertEqual((destination / "authored.txt").read_text(), "Keep me\n")
        link = self.root / "linked-parent"
        link.symlink_to(destination, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "linked parents"):
            vendor.synchronize(link / "nested", payload, check=False)
        self.assertFalse((destination / "nested").exists())

    def test_a_verified_snapshot_can_remove_a_retired_managed_file(self) -> None:
        retired = self.source / "src/retired.rs"
        retired.write_text("pub fn retired() {}\n")
        self.commit()
        destination = self.root / "consumer"
        vendor.synchronize(destination, vendor.browser_payload(self.project), check=False)
        retired.unlink()
        self.commit()
        payload = vendor.browser_payload(self.project)
        vendor.synchronize(destination, payload, check=False)
        self.assertFalse((destination / "src/retired.rs").exists())
        self.assertEqual(json.loads(payload["SOURCE.json"])["base_revision"],
                         self.git("rev-parse", "HEAD").decode().strip())
        vendor.synchronize(destination, payload, check=True)


class BuilderVendorTests(VendorFixture):
    def setUp(self) -> None:
        super().setUp()
        self.builder = self.project / "tools/web-build"
        for name, content in {
            "Cargo.toml": '[package]\nname="xcss-web-build"\nversion="1.0.0"\n',
            "Cargo.lock": "# Fixture lock\n", "README.md": "Fixture builder\n",
            ".gitignore": "/target/\n", "test-preview.mjs": "export {};\n",
            "src/main.rs": "fn main() {}\n", "tests/preview.rs": "// Fixture test\n",
        }.items():
            path = self.builder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.commit()

    def test_matching_builder_adoption_keeps_cache_and_binds_license_and_revision(self) -> None:
        payload = vendor.builder_payload(self.project)
        destination = self.root / "consumer/tools/web-build"
        destination.mkdir(parents=True)
        (destination / "Cargo.toml").write_bytes(payload["Cargo.toml"])
        cache = destination / "target/debug/cached-binary"
        cache.parent.mkdir(parents=True)
        cache.write_bytes(b"Cached build")
        vendor.synchronize(destination, payload, check=False)
        vendor.synchronize(destination, payload, check=True)
        metadata = json.loads(payload["SOURCE.json"])
        self.assertEqual(metadata["package"], "xcss-web-build")
        self.assertEqual(metadata["source_directory"], "tools/web-build")
        self.assertEqual(metadata["base_revision"], self.git("rev-parse", "HEAD").decode().strip())
        self.assertEqual((destination / "LICENSE").read_text(), "Fixture notice\n")
        self.assertEqual(cache.read_bytes(), b"Cached build")
        self.assertNotIn("target", metadata["files"])

    def test_builder_adoption_preserves_differing_or_unknown_authored_files(self) -> None:
        payload = vendor.builder_payload(self.project)
        for name in ("src/main.rs", "authored.txt"):
            destination = self.root / name.replace("/", "-")
            path = destination / name
            path.parent.mkdir(parents=True)
            path.write_bytes(b"Consumer work")
            with self.assertRaisesRegex(ValueError, "edited or unrecorded"):
                vendor.synchronize(destination, payload, check=False)
            self.assertEqual(path.read_bytes(), b"Consumer work")

    def test_builder_update_removes_only_verified_retired_inputs(self) -> None:
        retired = self.builder / "src/retired.rs"
        retired.write_text("// Retired fixture\n")
        self.commit()
        destination = self.root / "consumer"
        vendor.synchronize(destination, vendor.builder_payload(self.project), check=False)
        retired.unlink()
        self.commit()
        payload = vendor.builder_payload(self.project)
        vendor.synchronize(destination, payload, check=False)
        self.assertFalse((destination / "src/retired.rs").exists())
        self.assertEqual(json.loads(payload["SOURCE.json"])["base_revision"],
                         self.git("rev-parse", "HEAD").decode().strip())


if __name__ == "__main__":
    unittest.main()
