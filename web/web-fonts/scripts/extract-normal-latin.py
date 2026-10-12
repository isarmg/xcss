"""Extract the pinned upright Latin source faces for complete-font generation."""
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
data = Path(sys.argv[1]).read_bytes()
digest = "6fd6c8668657d4b55f108a115e59fa7a081757f29f599ebfc30a8558b85725bf"
assert hashlib.sha256(data).hexdigest() == digest
manifest = json.loads((root / "provenance.json").read_text())
sources = {}
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    for style, weight in [("Regular", 400), ("Bold", 700)]:
        encoded = archive.read(f"MapleMonoNormalNL-{style}.ttf.woff2")
        font = TTFont(io.BytesIO(encoded))
        assert font["post"].italicAngle == 0
        assert font["OS/2"].usWeightClass == weight
        name = f"MapleMonoNormalNL-{style}.woff2"
        (root / name).write_bytes(encoded)
        sources[name] = hashlib.sha256(encoded).hexdigest()
    license_bytes = archive.read("LICENSE.txt")
    (root / "NORMAL-LICENSE.txt").write_bytes(license_bytes)
manifest["source_assets"] = sources
(root / "provenance.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
