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

main(process.argv.slice(2))
  .then((exitCode) => {
    // main() RETURNS the report's exit code (0 = all checks passed / only
    // expected baseline failures; 1 = unexpected failures). It MUST reach the
    // process exit — a resolved promise discards it silently, which let the
    // release workflow's smoke gate pass a failing report (live-caught:
    // run 38675144166's Ubuntu smoke printed exit code 1 yet the step went
    // green; the station pipes had also been masking it behind `| tail`).
    process.exit(exitCode ?? 0);
  })
  .catch((error) => {
    console.error(`harness fatal: ${error?.stack ?? error}`);
    process.exit(3);
  });
