#!/usr/bin/env node
import { buildWebServer, requireServerBuildPlatform, verifyWebServerBinary, type WebServerBuildOptions } from "./server.js";

const options: WebServerBuildOptions = { mode: "development", cargoArgs: [] };
let config = "xcss-web-build.json";
let verifyOnly = false;
let binaryToVerify: string | undefined;
let receipt: string | undefined;
try {
  requireServerBuildPlatform();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--web-only") options.webOnly = true;
    else if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--rust-only") options.rustOnly = true;
    else if (arg === "--no-install") options.noInstall = true;
    else if (["--config", "--mode", "--dist", "--source-revision", "--cargo-arg", "--binary", "--receipt"].includes(arg ?? "")) {
      const value = args[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--config") config = value;
      else if (arg === "--binary") binaryToVerify = value;
      else if (arg === "--receipt") receipt = value;
      else if (arg === "--mode") {
        if (value !== "development" && value !== "release") throw new Error("Mode must be development or release");
        options.mode = value;
      } else if (arg === "--dist") options.dist = value;
      else if (arg === "--source-revision") options.sourceRevision = value;
      else options.cargoArgs!.push(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (verifyOnly) {
    if (!binaryToVerify || !options.dist || !receipt || options.webOnly || options.rustOnly) throw new Error("verify-only requires binary, dist and receipt without build-step options");
    const verified = verifyWebServerBinary(binaryToVerify, options.dist, receipt);
    if (options.sourceRevision && options.sourceRevision !== verified.source_revision) throw new Error("Receipt source revision differs from requested source");
    process.stdout.write(`${JSON.stringify(verified)}\n`);
    process.exit(0);
  }
  if (binaryToVerify || receipt) throw new Error("binary and receipt require verify-only");
  const binary = buildWebServer(config, options);
  if (binary) process.stdout.write(`${binary}\n`);
} catch (error) {
  process.stderr.write(`Web/Server build failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
