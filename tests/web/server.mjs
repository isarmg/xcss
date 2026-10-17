import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "../..");
const framework = join(root, "web/xcss-web");
const assets = ["design-tokens/tokens.css", "design-tokens/tokens.dark.css", "design-tokens/reset.css", "design-tokens/accessibility.css", "admin-ui/styles.css", "admin-ui/content-blocks.css", "admin-ui/server-corners.js", "web-fonts/fonts.css", "web-fonts/boot.css", "web-fonts/MapleMonoFull-Regular.woff2", "web-fonts/MapleMonoFull-Bold.woff2"];
const mime = { ".css": "text/css", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".html": "text/html" };

/** Compile the real Rust CSR facade; use only the requested package's built assets. */
export async function createWebFixtureServer() {
  const packageRoot = await realpath(process.env.XCSS_WEB_PACKAGE_ROOT ?? root);
  const dist = await realpath(join(packageRoot, "dist"));
  for (const asset of assets) assert.ok((await stat(join(dist, asset))).isFile(), `Missing package asset: ${asset}`);
  const temporary = await mkdtemp(join(tmpdir(), "xcss-csr-fixture-"));
  const target = resolve(process.env.CARGO_TARGET_DIR ?? join(root, "target/xcss-web"));
  const environment = { ...process.env, CARGO_TARGET_DIR: target, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_BUILD_JOBS: "2" };
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, env: environment, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
  };
  let server;
  try {
    const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen";
    const version = spawnSync(bindgen, ["--version"], { encoding: "utf8" });
    assert.equal(version.status, 0, "wasm-bindgen CLI is required");
    assert.equal(version.stdout.trim(), "wasm-bindgen 0.2.129");
    run("cargo", ["+1.99.0", "build", "--locked", "--manifest-path", join(framework, "Cargo.toml"), "--target", "wasm32-unknown-unknown", "--example", "csr"]);
    run(bindgen, ["--target", "web", "--no-typescript", "--out-dir", temporary, "--out-name", "csr_fixture", join(target, "wasm32-unknown-unknown/debug/examples/csr.wasm")]);
    const boot = await readFile(join(dist, "web-fonts/boot.css"), "utf8");
    const styles = assets.filter(path => path.endsWith(".css") && !path.endsWith("boot.css")).map(path => `<link rel="stylesheet" href="/dist/${path}">`).join("");
    const html = `<!doctype html><html lang="en" data-xcss-fonts="pending" data-xcss-appearance="content-blocks"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XCSS Rust CSR acceptance</title><style>${boot}</style>${styles}<link rel="stylesheet" href="/framework/startup.css"></head><body data-xcss-scope><div id="root"></div><script type="module" src="/csr-app.js"></script></body></html>`;
    const fixed = {
      "/framework/startup.js": join(framework, "startup.js"),
      "/framework/startup.css": join(framework, "startup.css"),
      "/pkg/csr_fixture.js": join(temporary, "csr_fixture.js"),
      "/pkg/csr_fixture_bg.wasm": join(temporary, "csr_fixture_bg.wasm"),
      "/continuous-corners.html": join(root, "tests/web/fixture/continuous-corners.html"),
      "/green.svg": join(root, "tests/web/fixture/green.svg"),
    };
    server = createServer(async (request, response) => {
      try {
        const path = new URL(request.url, "http://localhost").pathname;
        response.setHeader("cache-control", "no-store");
        if (path === "/") { response.setHeader("content-type", "text/html"); response.end(html); return; }
        if (path === "/csr-app.js") {
          response.setHeader("content-type", "text/javascript");
          response.end("import { startApplication } from '/framework/startup.js'; import { startServerCorners } from '/dist/admin-ui/server-corners.js'; startServerCorners(document); await startApplication(async () => { const { default: init } = await import('/pkg/csr_fixture.js'); await init(); });");
          return;
        }
        if (path.startsWith("/api/")) {
          if (path === "/api/v1/probe" && new URL(request.url, "http://localhost").searchParams.has("stream")) {
            response.writeHead(200, { "content-type": "application/json" });
            response.write('"' + "a".repeat(100));
            response.end("a".repeat(100) + '"'); return;
          }
          response.writeHead(401, { "content-type": "application/json" });
          response.end(JSON.stringify({ code: "auth.session_required", message: "Sign in required.", retryable: false })); return;
        }
        let file = fixed[path];
        if (path.startsWith("/dist/")) {
          file = resolve(dist, decodeURIComponent(path.slice(6)));
          if (!file.startsWith(dist + sep)) { response.writeHead(404); response.end(); return; }
          file = await realpath(file);
          if (!file.startsWith(dist + sep)) { response.writeHead(404); response.end(); return; }
        }
        if (!file) { response.writeHead(404); response.end(); return; }
        response.setHeader("content-type", mime[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream");
        response.end(await readFile(file));
      } catch (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500); response.end(); }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return {
      url: `http://127.0.0.1:${server.address().port}`,
      packageRoot,
      async close() { await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); },
    };
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
