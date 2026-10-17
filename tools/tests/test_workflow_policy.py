from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "xcss_workflow_policy",
    ROOT / "scripts" / "check-workflow-supply-chain.py",
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class WorkflowPolicyTests(unittest.TestCase):
    def test_only_exact_release_path_gets_tag_scoped_write_permission(self) -> None:
        text = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        MODULE.validate_workflow(".github/workflows/release.yml", text)
        with self.assertRaisesRegex(MODULE.PolicyError, "only contents: read"):
            MODULE.validate_workflow(".github/workflows/not-release.yml", text)

    def test_release_write_permission_requires_only_v_star_tag_push(self) -> None:
        text = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        changed = text.replace('      - "v*"', '      - "*"')
        with self.assertRaisesRegex(MODULE.PolicyError, "only push tags v"):
            MODULE.validate_workflow(".github/workflows/release.yml", changed)

    def test_release_requires_the_whole_package_linux_gate_and_native_tests(self) -> None:
        text = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        for old, new, reason in [
            ("runs-on: ubuntu-24.04", "runs-on: windows-2025", "fixed runner"),
            ("cargo test --locked --all-targets --all-features", "cargo check --locked --all-targets --all-features", "locked native tests"),
            ('if cargo check --locked -p xcss --target "$target"', 'if cargo check --locked -p xcss-server-target --target "$target"', "whole-package Linux AMD64"),
        ]:
            with self.subTest(reason=reason), self.assertRaisesRegex(MODULE.PolicyError, reason):
                MODULE.validate_workflow(".github/workflows/release.yml", text.replace(old, new))

    def test_web_release_has_its_own_tag_and_real_browser_archive_gates(self) -> None:
        source = ".github/workflows/release-web.yml"
        text = (ROOT / source).read_text()
        MODULE.validate_workflow(source, text)
        with self.assertRaisesRegex(MODULE.PolicyError, "only push tags web-v"):
            MODULE.validate_workflow(source, text.replace('      - "web-v*"', '      - "v*"'))
        for command in ("cargo install --locked wasm-bindgen-cli --version 0.2.129", "pnpm test:web:built", "python3 scripts/build-web-release-assets.py"):
            with self.subTest(command=command), self.assertRaisesRegex(MODULE.PolicyError, "release gate"):
                MODULE.validate_workflow(source, text.replace(command, "echo skipped"))
        with self.assertRaisesRegex(MODULE.PolicyError, "only contents: read"):
            MODULE.validate_workflow(".github/workflows/not-release.yml", text)


if __name__ == "__main__":
    unittest.main()
