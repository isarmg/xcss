#!/usr/bin/env python3
"""Export a committed xcss-web snapshot to explicitly selected directories."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tomllib


def browser_payload(project: Path) -> dict[str, bytes]:
    source = project / "web/xcss-web"
    paths = [source / name for name in (
        "Cargo.toml", "README.md", "startup.js", "startup.css", "tests/startup-failures.mjs",
    )]
    paths.extend(sorted((source / "src").rglob("*.rs")))
    for name in ("xcss-web-core", "xcss-web-macro"):
        directory = source / "vendor" / name
        if directory.is_symlink() or not (directory / "SOURCE.json").is_file():
            raise ValueError(f"Missing integrated CSR source: {directory}")
        paths.extend(path for path in sorted(directory.rglob("*")) if not path.is_dir() or path.is_symlink())
    paths.append(project / "LICENSE")
    for path in paths:
        if (not path.is_file() or path.stat().st_nlink != 1
                or any(parent.is_symlink() for parent in (path, *path.parents))):
            raise ValueError(f"Source must be a regular file without linked parents: {path}")
    relative = [path.relative_to(project).as_posix() for path in paths]
    subprocess.run(["git", "ls-files", "--error-unmatch", "--", *relative],
                   cwd=project, check=True, stdout=subprocess.DEVNULL)
    distribution_paths = ["LICENSE", *[f"web/xcss-web/{name}" for name in (
        "Cargo.toml", "README.md", "startup.js", "startup.css", "tests/startup-failures.mjs",
        "src", "vendor/xcss-web-core", "vendor/xcss-web-macro",
    )]]
    revision = subprocess.check_output(
        ["git", "log", "-1", "--format=%H", "--", *distribution_paths], cwd=project, text=True,
    ).strip()
    if re.fullmatch(r"[0-9a-f]{40}", revision) is None:
        raise ValueError("Browser source must have a committed base revision")
    # A digest of dirty files cannot prove that the named Git commit contains them.
    if subprocess.run(["git", "diff", "--quiet", revision, "--", *distribution_paths], cwd=project).returncode:
        raise ValueError("Commit the browser distribution inputs before exporting")
    payload = {("LICENSE" if path == project / "LICENSE" else path.relative_to(source).as_posix()): path.read_bytes()
               for path in paths}
    tree = subprocess.check_output(["git", "ls-tree", "-r", "-z", revision, "--", *relative], cwd=project)
    committed = {}
    for entry in tree.split(b"\0"):
        if entry:
            identity, name = entry.split(b"\t", 1)
            committed[name.decode()] = identity.split()[2].decode()
    for path in relative:
        data = payload["LICENSE" if path == "LICENSE" else path.removeprefix("web/xcss-web/")]
        # Compare the exact bytes with Git's blob identity, even if a concurrent
        # editor changes a file between the clean-tree check and the read.
        object_id = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if committed.get(path) != object_id:
            raise ValueError(f"Source bytes differ from the committed snapshot: {path}")
    version = tomllib.loads(payload["Cargo.toml"].decode())["package"]["version"]
    metadata = {
        "format": 1, "package": "xcss-web", "version": version,
        "origin": "https://github.com/isarmg/xcss", "base_revision": revision,
        "source_directory": "web/xcss-web",
        "files": {name: hashlib.sha256(data).hexdigest() for name, data in sorted(payload.items())},
    }
    payload["SOURCE.json"] = (json.dumps(metadata, indent=2, sort_keys=True) + "\n").encode()
    return payload


def synchronize(destination: Path, payload: dict[str, bytes], *, check: bool) -> None:
    destination = destination.absolute()
    if any(parent.is_symlink() for parent in (destination, *destination.parents)):
        raise ValueError(f"Destination must not have linked parents: {destination}")
    if destination.exists() and not destination.is_dir():
        raise ValueError(f"Destination must be a directory: {destination}")
    actual = {}
    for path in destination.rglob("*"):
        if (path.is_symlink() or (not path.is_file() and not path.is_dir())
                or (path.is_file() and path.stat().st_nlink != 1)):
            raise ValueError(f"Destination contains a linked or special file: {path}")
        if path.is_file():
            actual[path.relative_to(destination).as_posix()] = path.read_bytes()
    if check:
        if actual != payload:
            raise ValueError(f"Vendored xcss-web source is stale: {destination}")
        return
    if actual:
        try:
            previous = json.loads(actual.get("SOURCE.json", b"{}"))
            recorded = previous["files"]
            valid = (previous.get("format") == 1 and previous.get("package") == "xcss-web"
                     and isinstance(recorded, dict) and set(actual) == set(recorded) | {"SOURCE.json"}
                     and all(hashlib.sha256(actual[name]).hexdigest() == digest
                             for name, digest in recorded.items()))
        except (KeyError, TypeError, ValueError):
            valid = False
        if not valid:
            raise ValueError(f"Refusing to overwrite edited or unrecorded source: {destination}")
    for name in actual.keys() - payload.keys():
        (destination / name).unlink()
    for directory in sorted(destination.rglob("*"), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()
    for name, data in payload.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        # Identical bytes keep their mtime and do not force Cargo to rebuild.
        if not path.exists() or path.read_bytes() != data:
            path.write_bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--destination", required=True, type=Path, action="append")
    args = parser.parse_args()
    try:
        payload = browser_payload(Path(__file__).resolve().parents[1])
        for destination in args.destination:
            synchronize(destination, payload, check=args.check)
            print(f"{destination}: xcss-web source {'verified' if args.check else 'copied'}")
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"xcss-web export failed: {error}\n")


if __name__ == "__main__":
    main()
