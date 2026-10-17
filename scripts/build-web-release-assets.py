#!/usr/bin/env python3
"""Publishable Web archive with an independently versioned, exact Git identity."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from xcss_package_artifacts import PackagePolicyError, discover_packages, package_release, _install_smoke  # noqa: E402
from xcss_policy import (  # noqa: E402
    CURRENT_WEB_VERSION, NODE_VERSION, PNPM_VERSION, RUST_VERSION,
    XcssPolicyError, check_repository,
)


class WebReleaseError(RuntimeError):
    """An archive cannot be attributed to the current Web release."""


def git(*arguments: str) -> str:
    return subprocess.run(["git", *arguments], cwd=ROOT, check=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip()


def verify_source(revision: str, tag: str) -> None:
    if re.fullmatch(r"[0-9a-f]{40}", revision) is None:
        raise WebReleaseError("source revision must be a full lowercase Git commit")
    if tag != f"web-v{CURRENT_WEB_VERSION}":
        raise WebReleaseError(f"tag must be exactly web-v{CURRENT_WEB_VERSION}")
    if git("rev-parse", "HEAD") != revision or git("rev-parse", f"refs/tags/{tag}^{{commit}}") != revision:
        raise WebReleaseError("the Web tag and checked-out source must identify the exact revision")
    if git("status", "--porcelain=v1", "--untracked-files=all"):
        raise WebReleaseError("tracked or untracked source changes are forbidden during release")


def describe_archive(path: Path, revision: str, tag: str) -> dict[str, object]:
    expected = f"xcss-web-{CURRENT_WEB_VERSION}.tgz"
    if path.name != expected or path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
        raise WebReleaseError(f"the sole archive must be a regular, unlinked {expected}")
    data = path.read_bytes()
    return {
        "format": "xcss.web-release.v1",
        "package": "@xcss/web",
        "version": CURRENT_WEB_VERSION,
        "source_revision": revision,
        "tag": tag,
        "artifact": {
            "file": expected,
            "url": f"https://github.com/isarmg/xcss/releases/download/{tag}/{expected}",
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii"),
        },
        "toolchains": {"node": NODE_VERSION, "pnpm": PNPM_VERSION, "rust": RUST_VERSION, "wasm_bindgen": "0.2.129"},
        "lockfiles": [{"path": name, "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest()}
                      for name in ("pnpm-lock.yaml", "web/xcss-web/Cargo.lock")],
    }


def build(output: Path, revision: str, tag: str) -> Path:
    verify_source(revision, tag)
    check_repository(ROOT)
    if output.is_symlink():
        raise WebReleaseError("release output must not be a symlink")
    output = output.resolve()
    if output == ROOT or ROOT in output.parents or output == Path(output.anchor):
        raise WebReleaseError("Web release output must be a narrow directory outside the source checkout")
    packages = discover_packages(ROOT)
    archives = package_release(ROOT, packages, output)
    if len(archives) != 1:
        raise WebReleaseError("the Web release must contain exactly one archive")
    tested_sha256 = hashlib.sha256(archives[0].read_bytes()).hexdigest()
    # Validate the very bytes that will be uploaded, including a CSR browser
    # consuming the archive installation, after the final pack operation.
    with tempfile.TemporaryDirectory(prefix="xcss-web-release-smoke-") as directory:
        _install_smoke(packages, archives, Path(directory))
    if hashlib.sha256(archives[0].read_bytes()).hexdigest() != tested_sha256:
        raise WebReleaseError("the release archive changed during its install and browser smoke")
    verify_source(revision, tag)
    descriptor = describe_archive(archives[0], revision, tag)
    (output / "xcss-web-release.json").write_text(json.dumps(descriptor, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    paths = sorted(output.iterdir())
    (output / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in paths), encoding="ascii")
    print(f"Web release assets: passed {output}")
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    try:
        build(args.output, args.source_revision, args.tag)
    except (WebReleaseError, PackagePolicyError, XcssPolicyError, OSError, subprocess.SubprocessError) as error:
        print(f"Web release: FAILED: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
