from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


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


class AssetsVendorTests(VendorFixture):
    def setUp(self) -> None:
        super().setUp()
        self.assets = self.project / "web"
        for name, content in {
            "admin-ui/styles.css": b".xcss-panel { color: inherit; }\n",
            "admin-ui/select.css": b".xcss-select { display: block; }\n",
            "design-tokens/tokens.css": b":root { --xcss-blue-600: #2563eb; }\n",
            "design-tokens/tokens.dark.css": b":root[data-theme=dark] {}\n",
            "web-fonts/boot.css": b"html[data-xcss-fonts=pending] body { visibility: hidden; }\n",
            "web-fonts/fonts.css": b"@font-face { font-family: fixture; }\n",
            "web-fonts/provenance.json": b'{"assets": {}}\n',
            "web-fonts/MapleMonoFull-Regular.woff2": b"wOF2regular-fixture",
            "web-fonts/MapleMonoFull-Bold.woff2": b"wOF2bold-fixture",
            "web-fonts/OFL.txt": b"Fixture original font notice\n",
            "web-fonts/NORMAL-LICENSE.txt": b"Fixture normal font notice\n",
            "web-fonts/CJK-LICENSE.txt": b"Fixture CJK font notice\n",
            "admin-ui/src/server-corners.ts": b"export const retiredBehavior = true;\n",
            "design-tokens/src/index.ts": b"export const tokens = {};\n",
        }.items():
            path = self.assets / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        (self.project / "package.json").write_text(json.dumps({
            "name": "@xcss/web", "version": "2.0.0", "license": "Apache-2.0",
        }) + "\n")
        self.commit()

    def old_npm_snapshot(self, destination: Path) -> dict[str, bytes]:
        """Use the pre-Rust static snapshot receipt, without Git-only fields."""
        payload = vendor.assets_payload(self.project)
        files = {name: data for name, data in payload.items() if name != "SOURCE.json"}
        files.update({
            "admin-ui/server-corners.js": b"export function startServerCorners() {}\n",
            "admin-ui/server-corner-geometry.js": b"export const oldGeometry = true;\n",
            "web-fonts/startup.json": b'{"format": 1, "retired": true}\n',
        })
        archive = "https://github.com/isarmg/xcss/releases/download/v1.0.0/xcss-web-1.0.0.tgz"
        metadata = {
            "format": 1, "package": "@xcss/web", "version": "1.0.0",
            "origin": archive, "license": "Apache-2.0",
            "npm": {
                "name": "@xcss/web", "version": "1.0.0", "resolved": archive,
                "archive_files": {
                    name: name if name == "LICENSE" else "dist/" + name for name in files
                },
            },
            "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
        }
        files["SOURCE.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
        for name, data in files.items():
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return files

    @staticmethod
    def snapshot(directory: Path) -> dict[str, bytes]:
        return {path.relative_to(directory).as_posix(): path.read_bytes()
                for path in directory.rglob("*") if path.is_file()}

    def test_assets_receipt_binds_only_authored_static_bytes_to_the_committed_source(self) -> None:
        payload = vendor.assets_payload(self.project)
        metadata = json.loads(payload["SOURCE.json"])
        revision = self.git("rev-parse", "HEAD").decode().strip()
        self.assertEqual(metadata["package"], "@xcss/web")
        self.assertEqual(metadata["version"], "2.0.0")
        self.assertEqual(metadata["source_directory"], "web")
        self.assertEqual(metadata["base_revision"], revision)
        self.assertEqual(metadata["origin"], "https://github.com/isarmg/xcss")
        self.assertEqual(set(metadata["files"]), set(payload) - {"SOURCE.json"})
        self.assertFalse(any(name.endswith((".ts", ".js", ".mjs")) for name in payload))
        for name, digest in metadata["files"].items():
            source_name = name if name == "LICENSE" else "web/" + name
            self.assertEqual(payload[name], self.git("show", f"{revision}:{source_name}"))
            self.assertEqual(hashlib.sha256(payload[name]).hexdigest(), digest)

    def test_dirty_static_inputs_and_package_version_cannot_claim_the_commit(self) -> None:
        for name in ("web/admin-ui/styles.css", "package.json", "LICENSE"):
            with self.subTest(name=name):
                path = self.project / name
                original = path.read_bytes()
                path.write_bytes(original + b"\n")
                with self.assertRaisesRegex(ValueError, "Commit.*inputs"):
                    vendor.assets_payload(self.project)
                path.write_bytes(original)
        vendor.assets_payload(self.project)

    def test_static_byte_change_after_clean_git_check_is_rejected(self) -> None:
        target = self.assets / "admin-ui/styles.css"
        original = Path.read_bytes

        def concurrent_read(path: Path) -> bytes:
            return b".raced { color: red; }\n" if path == target else original(path)

        with patch.object(Path, "read_bytes", concurrent_read):
            with self.assertRaisesRegex(ValueError, "bytes differ from the committed snapshot"):
                vendor.assets_payload(self.project)
        self.assertEqual(target.read_bytes(), b".xcss-panel { color: inherit; }\n")

    def test_verified_old_npm_snapshot_removes_retired_javascript_and_keeps_static_assets(self) -> None:
        destination = self.root / "consumer/web/vendor/xcss"
        previous = self.old_npm_snapshot(destination)
        css = destination / "admin-ui/styles.css"
        license_path = destination / "LICENSE"
        css_time = css.stat().st_mtime_ns
        license_time = license_path.stat().st_mtime_ns
        payload = vendor.assets_payload(self.project)
        with self.assertRaisesRegex(ValueError, "source is stale"):
            vendor.synchronize(destination, payload, check=True)
        self.assertEqual(self.snapshot(destination), previous)
        vendor.synchronize(destination, payload, check=False)
        self.assertEqual(self.snapshot(destination), payload)
        self.assertFalse((destination / "admin-ui/server-corners.js").exists())
        self.assertFalse((destination / "admin-ui/server-corner-geometry.js").exists())
        self.assertFalse((destination / "web-fonts/startup.json").exists())
        self.assertEqual(css.read_bytes(), previous["admin-ui/styles.css"])
        self.assertEqual(license_path.read_bytes(), previous["LICENSE"])
        self.assertEqual(css.stat().st_mtime_ns, css_time)
        self.assertEqual(license_path.stat().st_mtime_ns, license_time)
        metadata = json.loads((destination / "SOURCE.json").read_text())
        self.assertEqual(metadata["base_revision"], self.git("rev-parse", "HEAD").decode().strip())
        self.assertNotIn("npm", metadata)
        vendor.synchronize(destination, payload, check=True)

    def test_edited_retired_javascript_blocks_cleanup_without_losing_consumer_work(self) -> None:
        destination = self.root / "consumer"
        self.old_npm_snapshot(destination)
        (destination / "admin-ui/server-corners.js").write_bytes(b"Consumer behavior changes\n")
        before = self.snapshot(destination)
        with self.assertRaisesRegex(ValueError, "edited or unrecorded"):
            vendor.synchronize(destination, vendor.assets_payload(self.project), check=False)
        self.assertEqual(self.snapshot(destination), before)

    def test_assets_check_cli_rejects_changed_extra_and_missing_files_without_writing(self) -> None:
        script = self.project / "scripts/vendor-xcss-web.py"
        script.parent.mkdir()
        script.write_bytes(SCRIPT.read_bytes())
        payload = vendor.assets_payload(self.project)
        for case in ("unchanged", "changed", "extra", "missing"):
            with self.subTest(case=case):
                destination = self.root / case
                vendor.synchronize(destination, payload, check=False)
                if case == "changed":
                    (destination / "admin-ui/styles.css").write_bytes(b"Edited CSS\n")
                elif case == "extra":
                    (destination / "admin-ui/retired.js").write_bytes(b"Unrecorded JS\n")
                elif case == "missing":
                    (destination / "web-fonts/OFL.txt").unlink()
                before = self.snapshot(destination)
                result = subprocess.run([
                    sys.executable, str(script), "--component", "assets", "--check",
                    "--destination", str(destination),
                ], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0 if case == "unchanged" else 1, result.stderr)
                if case != "unchanged":
                    self.assertIn("source is stale", result.stderr)
                self.assertEqual(self.snapshot(destination), before)


if __name__ == "__main__":
    unittest.main()
