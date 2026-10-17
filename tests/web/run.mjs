import { spawn } from "node:child_process";
import { createWebFixtureServer } from "./server.mjs";

const server = await createWebFixtureServer();
try {
  console.log(`Rust CSR fixture: ${server.url}; assets: ${server.packageRoot}`);
  const child = spawn(process.execPath, [new URL("../../node_modules/@playwright/test/cli.js", import.meta.url).pathname, "test", ...process.argv.slice(2)], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, XCSS_WEB_TEST_URL: server.url },
    stdio: "inherit",
  });
  const forward = signal => child.kill(signal);
  process.once("SIGINT", forward); process.once("SIGTERM", forward);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))); });
  process.removeListener("SIGINT", forward); process.removeListener("SIGTERM", forward);
  process.exitCode = code;
} finally { await server.close(); }
