import { copyFile, mkdir } from "node:fs/promises";
await mkdir(new URL("../../../dist/admin-ui/", import.meta.url), { recursive: true });
for (const name of ["styles.css", "content-blocks.css", "date-range.css", "account-settings.css", "select.css"]) {
  await copyFile(new URL(`../${name}`, import.meta.url), new URL(`../../../dist/admin-ui/${name}`, import.meta.url));
}
