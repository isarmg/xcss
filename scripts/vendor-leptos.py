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
    source = project / "web/leptos"
    paths = [source / "Cargo.toml", *sorted((source / "src").rglob("*.rs"))]
    # Runtime and host macros are one reviewed xcss browser distribution. Keep
    # their own names, MIT notices and upstream/patch manifests intact.
    for name in ("leptos-csr", "leptos-macro-csr"):
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
        ["git", "log", "-1", "--format=%H", "--", "web/leptos/Cargo.toml",
         ":(glob)web/leptos/src/**/*.rs", "web/leptos/vendor/leptos-csr",
         "web/leptos/vendor/leptos-macro-csr", "LICENSE"],
        cwd=project, text=True,
    ).strip()
    if len(revision) != 40:
        raise SystemExit("Browser source must have a committed base revision")
    metadata = {"format": 1, "package": "xcss-web", "version": "1.0.0",
                "origin": "https://github.com/isarmg/xcss", "base_revision": revision,
                "source_directory": "web/leptos", "files": {
                    name: hashlib.sha256(data).hexdigest() for name, data in sorted(payload.items())}}
    payload["SOURCE.json"] = (json.dumps(metadata, indent=2, sort_keys=True) + "\n").encode()
    for product in args.product or PRODUCTS:
        root = project.parent / product
        if root.is_symlink() or not (root / "web/leptos/Cargo.toml").is_file():
            raise SystemExit(f"Expected an independent product checkout: {product}")
        destination = root / "web/leptos/vendor/xcss-web"
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
                raise SystemExit(f"Unexpected vendored files in {product}: {sorted(unknown)}")
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
            "web/leptos-assets.mjs": project / "web/leptos-assets.mjs",
            ("crates/server/src/leptos_assets.rs" if product in ("xscs", "xsos", "xszs") else "src/leptos_assets.rs"): project / "scripts/leptos-assets.rs",
        }
        for relative, template in adapters.items():
            target = root / relative
            if target.is_symlink():
                raise SystemExit(f"Leptos adapter must not be a symlink: {target}")
            expected = template.read_bytes()
            if args.check:
                if not target.is_file() or target.read_bytes() != expected:
                    raise SystemExit(f"Leptos asset adapter is stale: {product}/{relative}")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists() or target.read_bytes() != expected:
                    target.write_bytes(expected)
        print(f"{product}: xcss-web source {'verified' if args.check else 'copied'}")


if __name__ == "__main__":
    main()
