#!/usr/bin/env node
/**
 * RW-003 packaged-app smoke harness — CLI entrypoint.
 *
 *   node qa/desktop-release/scripts/run-smoke.mjs --artifact <AppImage|executable>
 *     [--deb <file.deb>] [--sums <SHA256SUMS>] [--out <dir>] [--cdp-port <n>]
 *     [--display <:89>] [--expected-title <string>] [--baseline-expectations]
 *     [--skip-offline]
 *
 * Requires: Node >= 22, Xvfb, and (for AppImages without FUSE) enough free
 * disk in TMPDIR for --appimage-extract-and-run. No npm dependencies.
 */
import { main } from "../src/harness/run.mjs";
import { usage } from "../src/harness/config.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`harness fatal: ${error?.stack ?? error}`);
  process.exit(3);
});
