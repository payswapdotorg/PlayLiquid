#!/usr/bin/env node
/**
 * PLX-REL-001 Windows packaged-app smoke harness — thin driver.
 *
 * Mirrors the shape of scripts/run-ubuntu.sh (the Linux recipe wrapper): it
 * validates arguments, resolves every path ONCE to an absolute path, and
 * execs the actual Windows harness (scripts/run-windows.ps1) with standard
 * arguments. The PowerShell harness performs the Windows-native checks
 * (silent NSIS install/uninstall, Start Menu shortcut, HKCU uninstall
 * registry, installed + portable launches, data retention) and writes the
 * evidence (report.json + transcript.txt). This driver just makes the entry
 * point uniform with the Linux side (node on both runners, no shell
 * quoting surprises for paths with spaces).
 *
 *   node qa/desktop-release/scripts/run-windows.mjs \
 *     --installer <PlayLiquid GameOS-<v>-win-x64.exe> \
 *     --portable-zip <PlayLiquid GameOS-<v>-win-x64.zip> \
 *     [--sums <SHA256SUMS>] [--out <dir>]
 *
 * Environment alternatives: QA_RELEASE_INSTALLER, QA_RELEASE_PORTABLE_ZIP,
 * QA_RELEASE_SUMS (same convention as the Linux harness).
 *
 * Exit codes (same semantics as run-smoke.mjs): 0 = all checks passed /
 * only skipped; 1 = unexpected failure(s); 2 = nothing ran; 3 = harness
 * error. No npm dependencies (Node >= 22).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function usage() {
  return [
    "usage: node qa/desktop-release/scripts/run-windows.mjs --installer <path.exe>",
    "  --portable-zip <path.zip> [--sums <SHA256SUMS>] [--out <dir>] [--help]",
    "",
    "Environment alternatives: QA_RELEASE_INSTALLER, QA_RELEASE_PORTABLE_ZIP,",
    "QA_RELEASE_SUMS.",
    "Windows-only: the harness installs/uninstalls the packaged app per-user",
    "(NSIS silent flags) — run it on a disposable machine (e.g. a CI runner).",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    installer: process.env.QA_RELEASE_INSTALLER ?? null,
    portableZip: process.env.QA_RELEASE_PORTABLE_ZIP ?? null,
    sums: process.env.QA_RELEASE_SUMS ?? null,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--installer":
        out.installer = next();
        break;
      case "--portable-zip":
        out.portableZip = next();
        break;
      case "--sums":
        out.sums = next();
        break;
      case "--out":
        out.out = next();
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!out.help) {
    if (!out.installer) throw new Error("no installer given: pass --installer <path> or set QA_RELEASE_INSTALLER");
    if (!out.portableZip) {
      throw new Error("no portable zip given: pass --portable-zip <path> or set QA_RELEASE_PORTABLE_ZIP");
    }
    // Resolve every path ONCE (same discipline as run-smoke.mjs): the
    // PowerShell harness launches processes from other working directories.
    out.installer = resolve(out.installer);
    out.portableZip = resolve(out.portableZip);
    out.sums = out.sums === null ? null : resolve(out.sums);
    out.out = out.out === null ? null : resolve(out.out);
  }
  return out;
}

function utcStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

if (process.platform !== "win32") {
  console.error("run-windows.mjs: the Windows smoke harness only runs on Windows (it installs the packaged app).");
  process.exit(3);
}

const harnessPath = fileURLToPath(new URL("run-windows.ps1", import.meta.url));
if (!existsSync(harnessPath)) {
  console.error(`run-windows.mjs: harness script not found: ${harnessPath}`);
  process.exit(3);
}

const outDir = args.out ?? resolve("qa/desktop-release/evidence", `windows-${utcStamp()}`);

const psArgs = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  harnessPath,
  "-Installer",
  args.installer,
  "-PortableZip",
  args.portableZip,
  "-Out",
  outDir,
];
if (args.sums) psArgs.push("-Sums", args.sums);

console.log(`[run-windows] harness: powershell ${psArgs.join(" ")}`);
console.log(`[run-windows] evidence dir: ${outDir}`);

const child = spawn("powershell.exe", psArgs, {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (error) => {
  console.error(`run-windows.mjs fatal: ${error?.stack ?? error}`);
  process.exit(3);
});
child.on("close", (code) => {
  // Forward the harness exit code verbatim (0/1/2/3 semantics above).
  process.exit(code ?? 3);
});
