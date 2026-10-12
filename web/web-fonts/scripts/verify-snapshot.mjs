import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("./", import.meta.url);
const provenance = JSON.parse(await readFile(new URL("provenance.json", root), "utf8"));
assert.equal(provenance.cjk.sha256, "80bf6db8920b2999d900e08f9e5031f7686baeb72dbdb80891f2c1ae9cec606f");
for (const [name, expected] of Object.entries(provenance.assets)) {
  const bytes = await readFile(new URL(name, root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  if (name.endsWith(".woff2")) {
    assert.equal(bytes.subarray(0, 4).toString(), "wOF2", name);
    assert.ok(bytes.length <= 16 * 1024 * 1024, name);
  }
}
assert.equal(provenance.distribution.mode, "complete-fonts");
assert.equal(provenance.distribution.unicode_shards, false);
assert.deepEqual(Object.keys(provenance.assets).filter(name => name.endsWith(".woff2")).sort(), ["MapleMonoFull-Bold.woff2", "MapleMonoFull-Regular.woff2"]);
const css = await readFile(new URL("fonts.css", root), "utf8");
assert.ok(css.includes('font-variant-ligatures:none'));
const faces = [...css.matchAll(/@font-face\{([^}]+)\}/gu)];
assert.equal(faces.length, 2);
assert.ok(!css.includes("unicode-range"));
for (const [, face] of faces) {
  assert.ok(face.includes("font-display:block;"), "Every font is prepared before the UI is displayed");
}
assert.ok(css.includes('"calt" 0,"liga" 0,"clig" 0,"dlig" 0'));
assert.ok(css.includes('font-style:normal;font-weight:400'));
assert.ok(css.includes('font-style:normal;font-weight:700'));
assert.ok(!css.includes('font-weight:100 900'));
assert.ok(css.includes('MapleMonoFull-Regular.woff2'));
assert.ok(css.includes('MapleMonoFull-Bold.woff2'));
assert.ok(!css.includes('Bootstrap'));
assert.ok(css.includes('--xcss-font-ui:"Sarmg Maple"'));
assert.ok(!css.includes('Italic.woff2'));
assert.equal(provenance.latin.handwriting, false);
assert.ok(!css.includes('url("./MapleMono.woff2")'));
console.log("Default fonts: complete upright Regular/Bold, no ligatures or Unicode shards");

const startup = JSON.parse(await readFile(new URL("startup.json", root), "utf8"));
assert.equal(startup.policy, "all-fonts-before-ui");
for (const [name, expected] of Object.entries(startup.assets)) {
  assert.equal(createHash("sha256").update(await readFile(new URL(name, root))).digest("hex"), expected, name);
}
