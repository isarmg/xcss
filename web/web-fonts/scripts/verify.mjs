import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const provenance = JSON.parse(await readFile(new URL("../provenance.json", import.meta.url), "utf8"));
for (const [name, expected] of Object.entries(provenance.assets)) {
  const bytes = await readFile(new URL(`../${name}`, import.meta.url));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`${name} provenance mismatch`);
}
const css = await readFile(new URL("../fonts.css", import.meta.url), "utf8");
const faces = [...css.matchAll(/@font-face\{([^}]+)\}/gu)];
assert.equal(faces.length, 2, "Complete Regular and Bold fonts are the only runtime faces");
assert.ok(!css.includes("unicode-range"), "Runtime fonts must not be split into Unicode shards");
for (const [, face] of faces) {
  assert.ok(face.includes("font-display:block;"), "Every font is prepared before the UI is displayed");
}
