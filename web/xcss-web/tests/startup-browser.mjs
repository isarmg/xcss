import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, firefox } from "@playwright/test";
import { verifyStartupFailures, verifyStartupTimeout } from "./startup-failures.mjs";

const framework = resolve(import.meta.dirname, "..");
const root = resolve(framework, "../..");
const temporary = await mkdtemp(join(tmpdir(), "xcss-startup-"));
const target = process.env.CARGO_TARGET_DIR ?? join(temporary, "target");
const environment = { ...process.env, CARGO_TARGET_DIR: target, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_BUILD_JOBS: "2" };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}
let server;
try {
  const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen";
  const version = spawnSync(bindgen, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, "wasm-bindgen CLI is required");
  assert.equal(version.stdout.trim(), "wasm-bindgen 0.2.129");
  run("cargo", ["+1.99.0", "build", "--locked", "--manifest-path", join(framework, "Cargo.toml"), "--target", "wasm32-unknown-unknown", "--example", "startup"]);
  run(bindgen, ["--target", "web", "--no-typescript", "--out-dir", temporary, "--out-name", "startup_app", join(target, "wasm32-unknown-unknown/debug/examples/startup.wasm")]);
  const html = `<!doctype html><html lang="en" data-xcss-fonts="pending"><head><meta charset="utf-8"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/startup.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      const files = {
        "/startup.js": [join(framework, "startup.js"), "text/javascript"],
        "/startup.css": [join(framework, "startup.css"), "text/css"],
        "/startup_app.js": [join(temporary, "startup_app.js"), "text/javascript"],
        "/startup_app_bg.wasm": [join(temporary, "startup_app_bg.wasm"), "application/wasm"],
      };
      if (path === "/") { response.setHeader("content-type", "text/html"); response.end(html); return; }
      if (path === "/app.js") {
        response.setHeader("content-type", "text/javascript");
        response.end(`import {startApplication} from '/startup.js'; await startApplication(async()=>{ const {default:init}=await import('/startup_app.js');await init(); });`);
        return;
      }
      if (path.startsWith("/fonts/") && /^\/fonts\/[A-Za-z0-9_.-]+$/.test(path)) {
        files[path] = [join(root, "web/web-fonts", path.slice(7)), path.endsWith(".css") ? "text/css" : "font/woff2"];
      }
      const file = files[path];
      if (!file) { response.writeHead(404); response.end(); return; }
      response.setHeader("content-type", file[1]);
      response.end(await readFile(file[0]));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}/?lang=en`;
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    try {
      await verifyStartupFailures(browser, url);
      await verifyStartupTimeout(browser, url);
    } finally { await browser.close(); }
  }
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
