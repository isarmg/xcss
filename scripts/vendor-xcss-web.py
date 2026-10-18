#!/usr/bin/env python3
"""Export committed browser or Web builder sources to explicit directories."""
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
    return committed_payload(project, source, paths, "xcss-web")


def builder_payload(project: Path) -> dict[str, bytes]:
    source = project / "tools/web-build"
    paths = [source / name for name in (
        "Cargo.toml", "Cargo.lock", "README.md", ".gitignore", "test-preview.mjs",
    )]
    for name in ("src", "tests"):
        paths.extend(path for path in sorted((source / name).rglob("*"))
                     if not path.is_dir() or path.is_symlink())
    paths.append(project / "LICENSE")
    return committed_payload(project, source, paths, "xcss-web-build")


def committed_payload(project: Path, source: Path, paths: list[Path], package: str) -> dict[str, bytes]:
    for path in paths:
        if (not path.is_file() or path.stat().st_nlink != 1
                or any(parent.is_symlink() for parent in (path, *path.parents))):
            raise ValueError(f"Source must be a regular file without linked parents: {path}")
    relative = [path.relative_to(project).as_posix() for path in paths]
    subprocess.run(["git", "ls-files", "--error-unmatch", "--", *relative],
                   cwd=project, check=True, stdout=subprocess.DEVNULL)
    entries = (("Cargo.toml", "Cargo.lock", "README.md", ".gitignore", "test-preview.mjs", "src", "tests")
               if package == "xcss-web-build" else
               ("Cargo.toml", "README.md", "startup.js", "startup.css", "tests/startup-failures.mjs",
                "src", "vendor/xcss-web-core", "vendor/xcss-web-macro"))
    distribution_paths = ["LICENSE", *[(source.relative_to(project) / name).as_posix() for name in entries]]
    revision = subprocess.check_output(
        ["git", "log", "-1", "--format=%H", "--", *distribution_paths], cwd=project, text=True,
    ).strip()
    if re.fullmatch(r"[0-9a-f]{40}", revision) is None:
        raise ValueError("Exported source must have a committed base revision")
    # A digest of dirty files cannot prove that the named Git commit contains them.
    if subprocess.run(["git", "diff", "--quiet", revision, "--", *distribution_paths], cwd=project).returncode:
        raise ValueError("Commit the distribution inputs before exporting")
    payload = {("LICENSE" if path == project / "LICENSE" else path.relative_to(source).as_posix()): path.read_bytes()
               for path in paths}
    tree = subprocess.check_output(["git", "ls-tree", "-r", "-z", revision, "--", *relative], cwd=project)
    committed = {}
    for entry in tree.split(b"\0"):
        if entry:
            identity, name = entry.split(b"\t", 1)
            committed[name.decode()] = identity.split()[2].decode()
    for path in relative:
        data = payload["LICENSE" if path == "LICENSE" else Path(path).relative_to(source.relative_to(project)).as_posix()]
        # Compare the exact bytes with Git's blob identity, even if a concurrent
        # editor changes a file between the clean-tree check and the read.
        object_id = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if committed.get(path) != object_id:
            raise ValueError(f"Source bytes differ from the committed snapshot: {path}")
    version = tomllib.loads(payload["Cargo.toml"].decode())["package"]["version"]
    metadata = {
        "format": 1, "package": package, "version": version,
        "origin": "https://github.com/isarmg/xcss", "base_revision": revision,
        "source_directory": source.relative_to(project).as_posix(),
        "files": {name: hashlib.sha256(data).hexdigest() for name, data in sorted(payload.items())},
    }
    payload["SOURCE.json"] = (json.dumps(metadata, indent=2, sort_keys=True) + "\n").encode()
    return payload


def managed_entries(root: Path, *, builder: bool):
    if not root.exists():
        return
    for path in sorted(root.iterdir()):
        if builder and path.name == "target":
            if path.is_symlink() or not path.is_dir():
                raise ValueError(f"Builder cache must be a physical directory: {path}")
            continue
        yield path
        if path.is_dir() and not path.is_symlink():
            yield from managed_entries(path, builder=False)


def synchronize(destination: Path, payload: dict[str, bytes], *, check: bool) -> None:
    metadata = json.loads(payload["SOURCE.json"])
    package = metadata["package"]
    destination = destination.absolute()
    if any(parent.is_symlink() for parent in (destination, *destination.parents)):
        raise ValueError(f"Destination must not have linked parents: {destination}")
    if destination.exists() and not destination.is_dir():
        raise ValueError(f"Destination must be a directory: {destination}")
    actual = {}
    entries = list(managed_entries(destination, builder=package == "xcss-web-build"))
    for path in entries:
        if (path.is_symlink() or (not path.is_file() and not path.is_dir())
                or (path.is_file() and path.stat().st_nlink != 1)):
            raise ValueError(f"Destination contains a linked or special file: {path}")
        if path.is_file():
            actual[path.relative_to(destination).as_posix()] = path.read_bytes()
    if check:
        if actual != payload:
            raise ValueError(f"Vendored {package} source is stale: {destination}")
        return
    if actual:
        try:
            previous = json.loads(actual.get("SOURCE.json", b"{}"))
            recorded = previous["files"]
            valid = (previous.get("format") == 1 and previous.get("package") == package
                     and isinstance(recorded, dict) and set(actual) == set(recorded) | {"SOURCE.json"}
                     and all(hashlib.sha256(actual[name]).hexdigest() == digest
                             for name, digest in recorded.items()))
        except (KeyError, TypeError, ValueError):
            valid = False
        # Adopt an existing builder only when every authored byte already equals
        # the committed payload. Differing or unknown files remain untouched.
        if package == "xcss-web-build" and "SOURCE.json" not in actual:
            valid = all(name in payload and data == payload[name] for name, data in actual.items())
        if not valid:
            raise ValueError(f"Refusing to overwrite edited or unrecorded source: {destination}")
    for name in actual.keys() - payload.keys():
        (destination / name).unlink()
    for directory in sorted(entries, reverse=True):
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
    parser.add_argument("--component", choices=("browser", "builder"), default="browser")
    parser.add_argument("--destination", required=True, type=Path, action="append")
    args = parser.parse_args()
    try:
        project = Path(__file__).resolve().parents[1]
        payload = (browser_payload if args.component == "browser" else builder_payload)(project)
        for destination in args.destination:
            synchronize(destination, payload, check=args.check)
            print(f"{destination}: {json.loads(payload['SOURCE.json'])['package']} source {'verified' if args.check else 'copied'}")
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"xcss-web export failed: {error}\n")


if __name__ == "__main__":
    main()
