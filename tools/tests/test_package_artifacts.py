from __future__ import annotations

import json
import io
import os
import sys
import tempfile
import tarfile
import unittest
from pathlib import Path


TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from xcss_package_artifacts import (  # noqa: E402
    PackagePolicyError,
    clean_dist,
    discover_packages,
    _inspect_tarball,
)


class PackageArtifactTests(unittest.TestCase):
    def test_tarball_binds_actual_artifact_bytes_and_public_exports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            self.fixture(repository)
            (repository / "LICENSE").write_text("Original license text\n")
            package = discover_packages(repository)[0]
            for mutation in (None, "bytes", "export", "extra", "license"):
                archive_path = repository / "fixture.tgz"
                manifest = dict(package.manifest)
                if mutation == "export":
                    manifest["exports"] = {".": "./dist/index.js"}
                with tarfile.open(archive_path, "w:gz") as archive:
                    contents = {"package/package.json": json.dumps(manifest).encode(), "package/LICENSE": (repository / "LICENSE").read_bytes(), **{
                        "package/" + path.relative_to(repository).as_posix(): path.read_bytes()
                        for path in package.check_build()
                    }}
                    if mutation == "bytes":
                        contents["package/dist/index.js"] = b"export const tampered = true;"
                    if mutation == "extra":
                        contents["package/dist/old-react.js"] = b"export {};"
                    if mutation == "license":
                        contents["package/LICENSE"] = b"Replaced license"
                    for name, data in contents.items():
                        info = tarfile.TarInfo(name)
                        info.size = len(data)
                        archive.addfile(info, io.BytesIO(data))
                if mutation is None:
                    _inspect_tarball(package, archive_path, package.check_build())
                else:
                    with self.subTest(mutation=mutation), self.assertRaisesRegex(PackagePolicyError, "packed .*differ"):
                        _inspect_tarball(package, archive_path, package.check_build())

    def fixture(self, repository: Path) -> Path:
        package = repository
        (package / "dist").mkdir(parents=True)
        (package / "dist" / "index.js").write_text("export {};\n", encoding="utf-8")
        (package / "dist" / "index.d.ts").write_text("export {};\n", encoding="utf-8")
        (package / "package.json").write_text(
            json.dumps(
                {
                    "name": "@xcss/web",
                    "version": "1.0.0",
                    "type": "module",
                    "main": "./dist/index.js",
                    "types": "./dist/index.d.ts",
                    "exports": {
                        ".": {
                            "types": "./dist/index.d.ts",
                            "import": "./dist/index.js",
                        }
                    },
                    "files": ["dist"],
                    "os": ["linux"],
                    "cpu": ["x64"],
                    "libc": ["glibc"],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        return package

    def test_manifest_build_and_clean(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            package = self.fixture(repository)
            packages = discover_packages(repository)
            self.assertEqual(len(packages[0].check_build()), 2)
            clean_dist(packages)
            self.assertFalse((package / "dist").exists())

    def test_export_outside_dist_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            package = self.fixture(repository)
            manifest = json.loads((package / "package.json").read_text(encoding="utf-8"))
            manifest["main"] = "./src/index.js"
            (package / "package.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(PackagePolicyError, "start with ./dist"):
                discover_packages(repository)

    def test_development_workspace_ranges_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            package = self.fixture(repository)
            manifest = json.loads((package / "package.json").read_text(encoding="utf-8"))
            manifest["devDependencies"] = {"@xcss/fixture": "workspace:*"}
            (package / "package.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(PackagePolicyError, "workspace:1.0.0"):
                discover_packages(repository)

    def test_linked_build_artifacts_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            package = self.fixture(repository)
            os.symlink("index.js", package / "dist" / "linked.js")
            with self.assertRaisesRegex(PackagePolicyError, "regular, unlinked"):
                discover_packages(repository)[0].check_build()
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            package = self.fixture(repository)
            os.link(package / "dist" / "index.js", package / "dist" / "hard.js")
            with self.assertRaisesRegex(PackagePolicyError, "regular, unlinked"):
                discover_packages(repository)[0].check_build()

    def test_clean_refuses_a_linked_dist_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            package = self.fixture(repository)
            real = repository / "real-dist"
            (package / "dist").rename(real)
            os.symlink(real, package / "dist")
            packages = discover_packages(repository)
            with self.assertRaisesRegex(PackagePolicyError, "refusing to remove"):
                clean_dist(packages)
            self.assertTrue((real / "index.js").exists())

    def test_linked_package_root_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            external = repository / "external"
            self.fixture(external)
            linked = repository / "linked"
            os.symlink(external, linked)
            with self.assertRaisesRegex(PackagePolicyError, "linked package roots"):
                discover_packages(linked)

    def test_independent_npm_subpackages_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            self.fixture(repository)
            nested = repository / "web/admin-ui"
            nested.mkdir(parents=True)
            (nested / "package.json").write_text("{}")
            with self.assertRaisesRegex(PackagePolicyError, "independent npm subpackages"):
                discover_packages(repository)

    def test_cli_root_cannot_select_a_removed_package_or_other_platform(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            self.fixture(repository)
            path = repository / "package.json"
            valid = json.loads(path.read_text())
            for key, value, message in (
                ("name", "@xcss/admin-ui", "sole publishable package"),
                ("os", ["win32"], "os must enforce"),
                ("cpu", ["arm64"], "cpu must enforce"),
                ("libc", ["musl"], "libc must enforce"),
            ):
                path.write_text(json.dumps({**valid, key: value}))
                with self.subTest(key=key), self.assertRaisesRegex(PackagePolicyError, message):
                    discover_packages(repository)


if __name__ == "__main__":
    unittest.main()
