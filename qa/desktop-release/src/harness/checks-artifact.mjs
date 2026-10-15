/**
 * RW-003 harness — artifact-level checks (checksum verification, packaging
 * identity from the .deb metadata and the AppImage desktop entry). These run
 * without launching the app and use only dpkg-deb/tar (no root needed).
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PRODUCT_MARKERS } from "./config.mjs";

const execFileAsync = promisify(execFile);

export async function checksumCheck(report, artifact, sumsFile, debFile) {
  const basename = path.basename(artifact);
  if (!sumsFile || !fs.existsSync(sumsFile)) {
    report.check(
      "artifact-checksum",
      "artifact sha256 verified against the release SHA256SUMS",
      "skip",
      `no SHA256SUMS found at ${sumsFile ?? "(none given)"} — skipped (not fatal)`,
    );
    return null;
  }
  const lines = fs.readFileSync(sumsFile, "utf8").split(/\r?\n/).filter(Boolean);
  let entry = lines.find((line) => line.trim().endsWith(basename));
  let checksumTarget = artifact;
  let checksumTargetName = basename;
  if (!entry && debFile && fs.existsSync(debFile)) {
    // The .deb INSTALL path: the launched artifact is the installed
    // executable (/usr/bin/<name>), which has no SHA256SUMS entry under its
    // own name — verify the PACKAGE it was installed from instead (the
    // .deb IS a release asset) and state both facts honestly.
    const debBasename = path.basename(debFile);
    const debEntry = lines.find((line) => line.trim().endsWith(debBasename));
    if (debEntry) {
      entry = debEntry;
      checksumTarget = debFile;
      checksumTargetName = `${basename} (via its source package ${debBasename})`;
    }
  }
  if (!entry) {
    report.check(
      "artifact-checksum",
      "artifact sha256 verified against the release SHA256SUMS",
      "fail",
      `${sumsFile} has no entry for ${basename}`,
    );
    return null;
  }
  const expected = entry.trim().split(/\s+/)[0];
  const actual = await sha256(checksumTarget);
  report.check(
    "artifact-checksum",
    "artifact sha256 verified against the release SHA256SUMS",
    expected === actual ? "pass" : "fail",
    expected === actual
      ? `${checksumTargetName}: ${actual} matches ${sumsFile}`
      : `checksum mismatch for ${checksumTargetName}: expected ${expected}, computed ${actual}`,
  );
  return actual;
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function parseDesktopEntry(source) {
  const out = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Za-z-]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

/** Read the .desktop file inside the .deb (no root: dpkg-deb --fsys-tarfile). */
async function debDesktopEntry(deb) {
  const list = await execFileAsync("bash", [
    "-c",
    'dpkg-deb --fsys-tarfile "$1" | tar -t | grep "\\.desktop$"',
    "bash",
    deb,
  ], { maxBuffer: 8 * 1024 * 1024 });
  const entryName = list.stdout.trim().split(/\r?\n/)[0];
  if (!entryName) return null;
  const content = await execFileAsync("bash", [
    "-c",
    'dpkg-deb --fsys-tarfile "$1" | tar -xO "$2"',
    "bash",
    deb,
    entryName.startsWith("./") ? entryName : `./${entryName}`,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return { entryName, fields: parseDesktopEntry(content.stdout) };
}

/**
 * While an AppImage runs via --appimage-extract-and-run, its extracted tree
 * exists at runtime; the electron main process's /proc/<pid>/exe points into
 * it, which lets us read the bundled .desktop entry without a second copy.
 */
export function appImageDesktopEntry(pid) {
  try {
    const exe = fs.readlinkSync(`/proc/${pid}/exe`);
    const dir = path.dirname(exe);
    const candidates = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".desktop"))
      .map((name) => path.join(dir, name));
    if (candidates.length === 0) return null;
    return { dir, fields: parseDesktopEntry(fs.readFileSync(candidates[0], "utf8")) };
  } catch {
    return null;
  }
}

/** Packaging identity: the installer/desktop entry must serve the PlayLiquid
 * GameOS identity (not ZCode). Honest on the baseline: expected failure. */
export async function packagingIdentityCheck(report, options, runPid) {
  const evidence = [];
  let observed = null;
  let source = null;
  if (options.deb && fs.existsSync(options.deb)) {
    const debPackage = await execFileAsync("dpkg-deb", ["-f", options.deb, "Package", "Version"])
      .then((result) => result.stdout.trim())
      .catch((error) => `dpkg-deb failed: ${String(error.message ?? error)}`);
    evidence.push(`dpkg-deb -f ${options.deb} Package Version -> ${debPackage.replace(/\n/g, " / ")}`);
    const desktop = await debDesktopEntry(options.deb).catch(() => null);
    if (desktop) {
      evidence.push(
        `deb ${desktop.entryName}: Name=${desktop.fields.Name ?? "?"} Exec=${desktop.fields.Exec ?? "?"} Icon=${desktop.fields.Icon ?? "?"}`,
      );
      observed = desktop.fields;
      source = "deb";
    }
  }
  if (runPid && observed == null) {
    const extracted = appImageDesktopEntry(runPid);
    if (extracted) {
      evidence.push(
        `AppImage runtime-extracted desktop entry: Name=${extracted.fields.Name ?? "?"} Exec=${extracted.fields.Exec ?? "?"} Icon=${extracted.fields.Icon ?? "?"} (from ${extracted.dir})`,
      );
      observed = extracted.fields;
      source = "appimage";
    }
  }
  if (observed == null) {
    report.check(
      "packaging-identity",
      "packaging identity (desktop entry / deb package) serves PlayLiquid GameOS",
      "skip",
      "no packaging metadata available to inspect (no .deb given and no AppImage extraction dir found)",
      evidence,
    );
    return;
  }
  const nameOk = /playliquid/i.test(observed.Name ?? "");
  const execOk = !/zcode/i.test(`${observed.Exec ?? ""} ${observed.Icon ?? ""}`);
  report.check(
    "packaging-identity",
    "packaging identity (desktop entry / deb package) serves PlayLiquid GameOS",
    nameOk && execOk ? "pass" : "fail",
    `${source} desktop entry observed: Name=${JSON.stringify(observed.Name ?? null)} Exec=${JSON.stringify(observed.Exec ?? null)} Icon=${JSON.stringify(observed.Icon ?? null)}; expectation: Name matches /playliquid/i and Exec/Icon are not ZCode-branded (${PRODUCT_MARKERS.productName})`,
    evidence,
  );
}
