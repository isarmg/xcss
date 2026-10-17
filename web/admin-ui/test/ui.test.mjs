import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("shared styles preserve keyboard, forced-color and reduced-motion policies", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  for (const rule of ["focus-visible", "forced-colors", "prefers-reduced-motion"]) assert.match(css, new RegExp(rule));
});
test("table actions align with their column while keeping a touch target", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.xcss-table \.xcss-actions > \.xcss-button \{[^}]*justify-content: flex-start;[^}]*min-width: 44px;[^}]*padding-inline: 0;[^}]*text-align: left;/);
});
test("visited instance links preserve the shared appearance", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.xcss-instance-link, \.xcss-instance-link:visited \{ color: inherit; text-decoration: none; \}/);
  assert.match(css, /\.xcss-instance-link:hover, \.xcss-instance-link:focus-visible \{ text-decoration: underline; \}/);
});
