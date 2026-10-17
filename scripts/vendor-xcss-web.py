#!/usr/bin/env python3
"""Refresh or verify the portable xcss browser source in independent products."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

PRODUCTS = ("xcos", "xczs", "xocs", "xscs", "xsos", "xszs")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--product", choices=PRODUCTS, action="append")
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    source = project / "web/xcss-web"
    paths = [source / "Cargo.toml", source / "README.md", source / "startup.js", source / "startup.css",
             *sorted((source / "src").rglob("*.rs")), source / "tests/startup-failures.mjs"]
    # Runtime and host macros are one reviewed xcss browser distribution. Keep
    # their MIT notices and README source/patch history intact.
    for name in ("xcss-web-core", "xcss-web-macro"):
        directory = source / "vendor" / name
        if directory.is_symlink() or not (directory / "SOURCE.json").is_file():
            raise SystemExit(f"Missing integrated CSR source: {directory}")
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                raise SystemExit(f"Integrated CSR source contains a symlink: {path}")
            if path.is_file():
                paths.append(path)
    payload = {str(path.relative_to(source)): path.read_bytes() for path in paths}
    payload["LICENSE"] = (project / "LICENSE").read_bytes()
    # Documentation/native-only commits do not change this browser snapshot.
    # Keep its source revision stable while the exact file hashes remain equal.
    revision = subprocess.check_output(
        ["git", "log", "-1", "--format=%H", "--", "web/xcss-web/Cargo.toml", "web/xcss-web/README.md",
         ":(glob)web/xcss-web/src/**/*.rs", "web/xcss-web/startup.js", "web/xcss-web/startup.css",
         ":(glob)web/xcss-web/tests/*.mjs", "web/xcss-web/vendor/xcss-web-core",
         "web/xcss-web/vendor/xcss-web-macro", "LICENSE"],
        cwd=project, text=True,
    ).strip()
    if len(revision) != 40:
        raise SystemExit("Browser source must have a committed base revision")
    metadata = {"format": 1, "package": "xcss-web", "version": "1.0.0",
                "origin": "https://github.com/isarmg/xcss", "base_revision": revision,
                "source_directory": "web/xcss-web", "files": {
                    name: hashlib.sha256(data).hexdigest() for name, data in sorted(payload.items())}}
    payload["SOURCE.json"] = (json.dumps(metadata, indent=2, sort_keys=True) + "\n").encode()
    for product in args.product or PRODUCTS:
        root = project.parent / product
        if root.is_symlink() or not (root / "web/xcss-web/Cargo.toml").is_file():
            raise SystemExit(f"Expected an independent product checkout: {product}")
        destination = root / "web/xcss-web/vendor/xcss-web"
        if destination.is_symlink():
            raise SystemExit(f"Vendored source must not be a symlink: {destination}")
        actual = {str(path.relative_to(destination)): path.read_bytes()
                  for path in destination.rglob("*") if path.is_file()}
        if any(path.is_symlink() for path in destination.rglob("*")):
            raise SystemExit(f"Vendored source contains a symlink: {destination}")
        if args.check:
            if actual != payload:
                raise SystemExit(f"Vendored xcss browser source is stale: {product}")
        else:
            # Never erase unknown authored files when synchronizing a snapshot.
            unknown = actual.keys() - payload.keys()
            if unknown:
                # Rename a complete, hash-verified managed snapshot. An edited
                # or unrecorded file is never eligible for automatic removal.
                previous = json.loads(actual.get("SOURCE.json", b"{}"))
                recorded = previous.get("files", {})
                if (set(actual) != set(recorded) | {"SOURCE.json"}
                        or any(hashlib.sha256(actual[name]).hexdigest() != digest
                               for name, digest in recorded.items())):
                    raise SystemExit(f"Unexpected or edited vendored files in {product}: {sorted(unknown)}")
                for name in sorted(unknown):
                    (destination / name).unlink()
                for directory in sorted(destination.rglob("*"), reverse=True):
                    if directory.is_dir() and not any(directory.iterdir()):
                        directory.rmdir()
            for name, data in payload.items():
                path = destination / name
                path.parent.mkdir(parents=True, exist_ok=True)
                # Preserve Cargo's input mtimes when only source provenance or
                # another package changed; an identical sync must not force a
                # full browser rebuild in every independent product.
                if not path.exists() or path.read_bytes() != data:
                    path.write_bytes(data)
        # These independent build/server adapters accompany the browser snapshot.
        adapters = {
            "web/xcss-web-assets.mjs": project / "web/xcss-web-assets.mjs",
            ("crates/server/src/xcss_web_assets.rs" if product in ("xscs", "xsos", "xszs") else "src/xcss_web_assets.rs"): project / "scripts/xcss-web-assets.rs",
        }
        for relative, template in adapters.items():
            target = root / relative
            if target.is_symlink():
                raise SystemExit(f"xcss-web adapter must not be a symlink: {target}")
            expected = template.read_bytes()
            if args.check:
                if not target.is_file() or target.read_bytes() != expected:
                    raise SystemExit(f"xcss-web asset adapter is stale: {product}/{relative}")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists() or target.read_bytes() != expected:
                    target.write_bytes(expected)
        print(f"{product}: xcss-web source {'verified' if args.check else 'copied'}")


if __name__ == "__main__":
    main()
