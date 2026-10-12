"""Build two complete upright fonts from the pinned Latin and CJK sources."""
import hashlib
import io
import json
import tempfile
import zipfile
from pathlib import Path
import sys

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_SHA256 = "80bf6db8920b2999d900e08f9e5031f7686baeb72dbdb80891f2c1ae9cec606f"


def main():
    archive_bytes = Path(sys.argv[1]).read_bytes()
    assert hashlib.sha256(archive_bytes).hexdigest() == ARCHIVE_SHA256
    manifest = json.loads((ROOT / "provenance.json").read_text())
    source_assets = manifest["source_assets"]
    generated = {}
    coverage = {}
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        (ROOT / "CJK-LICENSE.txt").write_bytes(archive.read("LICENSE.txt"))
        for style, weight in [("Regular", 400), ("Bold", 700)]:
            latin_path = ROOT / f"MapleMonoNormalNL-{style}.woff2"
            latin_bytes = latin_path.read_bytes()
            assert hashlib.sha256(latin_bytes).hexdigest() == source_assets[latin_path.name]
            latin = TTFont(io.BytesIO(latin_bytes), recalcTimestamp=False)
            cjk = TTFont(io.BytesIO(archive.read(f"MapleMonoNL-CN-{style}.ttf")), recalcTimestamp=False)
            expected = set(latin.getBestCmap()) | set(cjk.getBestCmap())
            # Preserve the verified Normal NL Western glyphs, and merge every
            # other CJK mapping into the same face. No Unicode shard is emitted.
            options = subset.Options()
            options.layout_features = []
            options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
            worker = subset.Subsetter(options=options)
            worker.populate(unicodes=set(cjk.getBestCmap()) - set(latin.getBestCmap()))
            worker.subset(cjk)
            with tempfile.TemporaryDirectory() as directory:
                paths = [Path(directory) / "latin.ttf", Path(directory) / "cjk.ttf"]
                latin.flavor = None
                latin.save(paths[0])
                cjk.save(paths[1])
                merged = Merger().merge([str(path) for path in paths])
                merged.recalcTimestamp = False
                merged["head"].created = latin["head"].created
                merged["head"].modified = latin["head"].modified
                merged.flavor = "woff2"
                name = f"MapleMonoFull-{style}.woff2"
                destination = ROOT / name
                merged.save(destination)
            encoded = destination.read_bytes()
            result = TTFont(io.BytesIO(encoded))
            assert set(result.getBestCmap()) == expected, "complete glyph coverage must survive encoding"
            assert result["post"].italicAngle == 0
            assert result["OS/2"].usWeightClass == weight
            assert all(ord(character) in expected for character in "English中文日本語かなカナ鹤龘鬱")
            generated[name] = hashlib.sha256(encoded).hexdigest()
            coverage[style] = {"codepoints": len(expected), "bytes": len(encoded)}
            print(f"{name}: {len(encoded)} bytes, {len(expected)} codepoints", flush=True)

    faces = ['@import "./boot.css";']
    for style, weight in [("Regular", 400), ("Bold", 700)]:
        faces.append(f'@font-face{{font-family:"Sarmg Maple";src:url("./MapleMonoFull-{style}.woff2") format("woff2");font-style:normal;font-weight:{weight};font-display:block;}}')
    features = 'font-variant-ligatures:none;font-feature-settings:"calt" 0,"liga" 0,"clig" 0,"dlig" 0;font-synthesis:none'
    faces += [f':root{{--xcss-font-ui:"Sarmg Maple",ui-monospace,monospace;--xcss-font-mono:"Sarmg Maple",ui-monospace,monospace;{features}}}',
              f'body,button,input,select,textarea,code,pre,kbd,samp{{font-family:var(--xcss-font-ui);font-style:normal;{features}}}']
    (ROOT / "fonts.css").write_text("\n".join(faces) + "\n")
    manifest["assets"] = {
        **generated,
        **{name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
           for name in ["fonts.css", "boot.css", "OFL.txt", "CJK-LICENSE.txt", "NORMAL-LICENSE.txt"]},
    }
    manifest.pop("bootstrap", None)
    manifest["cjk"].pop("maximum_asset_bytes", None)
    manifest["distribution"] = {"mode": "complete-fonts", "weights": [400, 700],
                                "unicode_shards": False, "faces": coverage,
                                "fonttools": "4.60.1", "brotli": "1.1.0"}
    (ROOT / "provenance.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
