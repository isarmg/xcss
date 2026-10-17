from __future__ import annotations

import base64
import hashlib
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("xcss_web_release_assets", ROOT / "scripts/build-web-release-assets.py")
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class WebReleaseTests(unittest.TestCase):
    def test_native_or_historical_tag_is_rejected_before_git_access(self) -> None:
        for tag in ("v1.0.0", "v2.0.0", "web-v1.0.0", "web-v2.0.0-extra"):
            with self.subTest(tag=tag), patch.object(MODULE, "git") as git:
                with self.assertRaisesRegex(MODULE.WebReleaseError, "tag must be exactly"):
                    MODULE.verify_source("a" * 40, tag)
                git.assert_not_called()

    def test_tag_head_and_dirty_source_must_all_agree(self) -> None:
        for results in (("b" * 40,), ("a" * 40, "b" * 40), ("a" * 40, "a" * 40, " M package.json")):
            with self.subTest(results=results), patch.object(MODULE, "git", side_effect=results):
                with self.assertRaises(MODULE.WebReleaseError):
                    MODULE.verify_source("a" * 40, "web-v2.0.0")
        with patch.object(MODULE, "git", side_effect=("a" * 40, "a" * 40, "")):
            MODULE.verify_source("a" * 40, "web-v2.0.0")

    def test_descriptor_binds_url_version_sha512_and_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "xcss-web-2.0.0.tgz"
            data = b"actual archive bytes"
            path.write_bytes(data)
            value = MODULE.describe_archive(path, "a" * 40, "web-v2.0.0")
            self.assertEqual(value["source_revision"], "a" * 40)
            self.assertEqual(value["artifact"]["url"], "https://github.com/isarmg/xcss/releases/download/web-v2.0.0/xcss-web-2.0.0.tgz")
            self.assertEqual(value["artifact"]["integrity"], "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode())
            self.assertEqual(value["artifact"]["bytes"], len(data))
            wrong = path.with_name("xcss-web-1.0.0.tgz")
            path.rename(wrong)
            with self.assertRaisesRegex(MODULE.WebReleaseError, "sole archive"):
                MODULE.describe_archive(wrong, "a" * 40, "web-v2.0.0")

    def test_final_archive_is_smoked_before_describing_and_cannot_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "release"
            def pack(root, packages, destination):
                destination.mkdir()
                archive = destination / "xcss-web-2.0.0.tgz"
                archive.write_bytes(b"built archive")
                return (archive,)
            for change in (False, True):
                if output.exists():
                    shutil.rmtree(output)
                def smoke(packages, archives, consumer):
                    self.assertEqual(archives, (output / "xcss-web-2.0.0.tgz",))
                    self.assertFalse((output / "xcss-web-release.json").exists())
                    if change:
                        archives[0].write_bytes(b"unverified replacement")
                with patch.object(MODULE, "verify_source"), patch.object(MODULE, "check_repository"), patch.object(MODULE, "discover_packages", return_value=(object(),)), patch.object(MODULE, "package_release", side_effect=pack), patch.object(MODULE, "_install_smoke", side_effect=smoke) as tested:
                    if change:
                        with self.assertRaisesRegex(MODULE.WebReleaseError, "archive changed"):
                            MODULE.build(output, "a" * 40, "web-v2.0.0")
                    else:
                        MODULE.build(output, "a" * 40, "web-v2.0.0")
                        self.assertTrue((output / "xcss-web-release.json").is_file())
                    tested.assert_called_once()


if __name__ == "__main__":
    unittest.main()
