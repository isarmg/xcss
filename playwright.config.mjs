import { defineConfig } from "@playwright/test";
const baseURL = process.env.XCSS_WEB_TEST_URL;
if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) throw new Error("Run browser tests through node tests/web/run.mjs");
export default defineConfig({
  testDir: "./tests/web", testMatch: ["csr.spec.mjs", "continuous-corners.spec.mjs"], fullyParallel: true, workers: 2,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "firefox", use: { browserName: "firefox" } }],
});
