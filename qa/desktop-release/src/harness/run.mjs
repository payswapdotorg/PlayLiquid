/**
 * RW-003 harness — orchestrator: launches the packaged Linux application,
 * runs every check, captures window-level evidence and writes the report.
 *
 * Usage (see README.md):
 *   node qa/desktop-release/scripts/run-smoke.mjs --artifact <AppImage|executable> \
 *     [--deb <file.deb>] [--baseline-expectations]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULTS, parseArgs } from "./config.mjs";
import {
  availableMemoryMb,
  killRunProcesses,
  pidAlive,
  portIsFree,
  runId,
  sleep,
} from "./memwatch.mjs";
import { startXvfb } from "./xvfb.mjs";
import { childEnv } from "./launcher.mjs";
import { Report } from "./report.mjs";
import { checksumCheck, packagingIdentityCheck } from "./checks-artifact.mjs";
import {
  cleanProfileCheck,
  identityChecks,
  markerProbe,
  navigationCheck,
  realOperationCheck,
  shellChecks,
  shellMarkersPresent,
  viewportChecks,
} from "./checks.mjs";
import { emptyStateContractCheck, workbenchEscapeCheck } from "./checks-contract.mjs";
import { geometryChecks } from "./checks-geometry.mjs";
import { accessibleNamesCheck, headingHierarchyCheck, keyboardNavigationCheck, visibleFocusCheck } from "./checks-a11y.mjs";
import { journeyChecks } from "./checks-journey.mjs";
import { offlineScenario } from "./checks-offline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
import { distroName, tail } from "./run-helpers.mjs";
import { runAppRun, shutdownApp } from "./run-lifecycle.mjs";

/** Wait (bounded, generous) for the product shell after DOM settle. The
 * packaged app's first-run preparation ("Finishing startup" — agent-runtime
 * and search-tool staging) can outlast the DOM settle: the loading screen's
 * DOM is stable, waitForRender returns early, and a fixed-moment probe races
 * the preparation (observed 60–120 s on cold CI runners — PLX-REL-001
 * dispatch 41216691320 lesson — and longer when the offline scenario's dead
 * proxy makes staging fetches hang until their timeouts: run 41226144216's
 * offline render verdict caught the loading screen). The checks then verify
 * what the user actually gets, not where the loading screen happened to be. */
async function waitForProductShell(page, log) {
  let probe = await markerProbe(page);
  if (shellMarkersPresent(probe)) return probe;
  const deadline = Date.now() + DEFAULTS.shellReadyTimeoutMs;
  while (!shellMarkersPresent(probe) && Date.now() < deadline) {
    await sleep(DEFAULTS.shellReadyPollMs);
    probe = await markerProbe(page);
  }
  if (shellMarkersPresent(probe)) {
    log(`product shell present — first-run preparation finished within the ${DEFAULTS.shellReadyTimeoutMs / 1000}s window`);
  } else {
    log(`product shell markers not present after ${DEFAULTS.shellReadyTimeoutMs / 1000}s — probing what is rendered; the checks will record it honestly`);
  }
  return probe;
}

export async function main(argv) {
  const options = parseArgs(argv);
  const outDir = options.out
    ? path.resolve(options.out)
    : path.resolve(here, "..", "..", "..", "..", "evidence", `run-${runId()}`);
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });
  const tmpRoot = fs.mkdtempSync(`${os.tmpdir()}/rw003-smoke-`);
  const report = new Report({ ...options, argv: ["run-smoke.mjs", ...argv] });
  const logLines = [];
  const log = (line) => {
    logLines.push(`[${new Date().toISOString()}] ${line}`);
    console.log(line);
  };

  report.environment = {
    distro: distroName(),
    kernel: os.release(),
    arch: os.arch(),
    node: process.version,
    memoryTotalMb: Math.floor(os.totalmem() / 1024 / 1024),
    memoryAtStartMb: await availableMemoryMb(),
    fuseAvailable: fs.existsSync("/dev/fuse"),
    xvfb: await xvfbVersion(),
    displayServer: "Xvfb (virtual framebuffer, no GPU)",
    cdpPort: options.cdpPort,
    stationNote:
      "honest scope: reference station is Debian 13, not Ubuntu; Ubuntu-latest execution of this same harness is the TL integration step (README section 'Run on any Ubuntu machine')",
  };
  log(`environment: ${report.environment.distro} (kernel ${report.environment.kernel}), node ${process.version}, fuse=${report.environment.fuseAvailable}`);
  const offlinePort = options.cdpPort + DEFAULTS.offlineCdpPortOffset;
  if (!(await portIsFree(options.cdpPort))) {
    throw new Error(`CDP port ${options.cdpPort} is already in use — pass --cdp-port (never 9222: resident stack)`);
  }
  if (!options.skipOffline && !(await portIsFree(offlinePort))) {
    throw new Error(`offline-scenario CDP port ${offlinePort} (cdp-port + 1) is already in use — pass --cdp-port`);
  }
  report.environment.cdpPorts = { main: options.cdpPort, offline: options.skipOffline ? null : offlinePort };
  report.note(
    "launch discipline: the packaged app is always launched with a clean profile (fresh HOME/XDG/TMPDIR) and a NEUTRAL cwd (the clean profile HOME, like a real desktop user), never from inside a repository checkout — the current artifact's agent resolver is cwd-sensitive (findUpward from process.cwd() can bind a repo dev agent when launched from inside a checkout, which breaks its first-run storage preparation); observed and recorded honestly, harness avoids it by construction",
  );

  await checksumCheck(report, options.artifact, options.sums, options.deb);

  const xvfb = await startXvfb(options.display, DEFAULTS.displayCandidates, DEFAULTS.xvfbScreen, log);
  const context = { report, options, outDir, tmpRoot, xvfb, log };
  const tracked = [{ pid: xvfb.pid, name: "Xvfb" }];
  try {
    const run = await runAppRun(context, "main", options.cdpPort);
    tracked.push({ pid: run.proc.pid, pgid: run.proc.pid, name: "app-main" });
    if (run.error) {
      report.check("startup", "packaged application starts under Xvfb", "fail", run.error, [
        `app process at failure: exitCode=${run.procExitCode} signal=${run.procSignalCode} stillRunning=${run.procStillRunning}`,
        `launch mode: ${run.mode}`,
        `app log tail: ${tail(run.appLog, 30)}`,
      ]);
      report.check("clean-shutdown", "application closes cleanly", "skip", "app never started");
    } else {
      const startupSec = Math.round((Date.now() - run.startedAt) / 1000);
      report.check(
        "startup",
        "packaged application starts under Xvfb (CDP endpoint + main window page target + settled DOM)",
        run.render ? "pass" : "fail",
        run.render
          ? `CDP up and main window rendered in ${startupSec}s (launch mode: ${run.mode}); DOM settled at ${run.render.nodes} nodes`
          : `CDP endpoint answered and the window target appeared, but the renderer DOM never settled within ${DEFAULTS.renderSettleTimeoutMs / 1000}s`,
        [
          `page target url: ${run.target.url}`,
          `all targets: ${run.targets.map((entry) => `${entry.type}:${entry.url.slice(0, 80)}`).join(" | ")}`,
        ],
      );
      const url = run.target.url;
      report.check(
        "packaged-independence",
        "no dev-server / repo-relative / dev-env dependence (packaged file:// load)",
        /^(file|app):/i.test(url) ? "pass" : "fail",
        `main window loads ${url.startsWith("file://") ? "the packaged file:// renderer" : url}; the child environment contained no ELECTRON_RENDERER_URL / VITE_* / ZCODE_* variables`,
        [
          `page url: ${url}`,
          `child env keys: ${Object.keys(childEnv(run.profileDirs, xvfb.display)).sort().join(", ")}`,
        ],
      );
      // PLX-REL-001: identity/shell checks run on the settled product shell,
      // not the transient loading screen (see waitForProductShell).
      const probe = await waitForProductShell(run.page, log);
      identityChecks(report, probe, options);
      shellChecks(report, probe);
      // UX-003: the frozen shell + first-run contracts, asserted on the
      // DEFAULT surface before any navigation moves it.
      await workbenchEscapeCheck(report, run.page);
      await emptyStateContractCheck(report, run.page);
      await realOperationCheck(report, run.page);
      await navigationCheck(report, run.page);
      // UX-003: journey smoke through the production-wired ports (Lab +
      // Community real read-model operations, typed-outcome and honest-
      // limitation states).
      await journeyChecks(report, run.page);
      cleanProfileCheck(report, run.profileDirs, run.before, fs.readdirSync(run.profileDirs.xdgConfig));
      try {
        await viewportChecks(report, run.page, outDir);
      } catch (error) {
        report.check(
          "viewports-evidence",
          "window-level evidence captured at both mandated viewports (390x844, 1280x800)",
          "fail",
          `viewport capture failed: ${String(error?.message ?? error)}`,
        );
      }
      // UX-003: geometry enforcement at the three mandated widths (the real
      // 1280x800 window, the actual 480px minimum OS window, the 390x844
      // emulated viewport) — leaves the window restored at 1280x800.
      await geometryChecks(report, {
        browser: run.browser,
        page: run.page,
        targetId: run.target?.id,
        outDir,
      });
      // UX-003: accessibility battery (keyboard navigation + activation,
      // visible focus, accessible names, heading hierarchy).
      await keyboardNavigationCheck(report, run.page);
      await visibleFocusCheck(report, run.page);
      await accessibleNamesCheck(report, run.page);
      await headingHierarchyCheck(report, run.page);
      await packagingIdentityCheck(report, options, run.proc.pid);
      report.check(
        "console-evidence-recorded",
        "renderer console evidence captured from the packaged run (informational)",
        "pass",
        `${run.consoleEntries.length} console entries captured (${run.consoleEntries.filter((entry) => /error|exception/i.test(entry.source)).length} error-level)`,
        run.consoleEntries.slice(0, 8).map((entry) => `${entry.source}: ${entry.text}`),
      );
      await shutdownApp(context, run);
      fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });
      fs.copyFileSync(run.appLog, path.join(outDir, "logs", "app-main-stdout.log"));
      fs.writeFileSync(path.join(outDir, "logs", "console-main.json"), JSON.stringify(run.consoleEntries, null, 2));
      fs.writeFileSync(path.join(outDir, "logs", "cdp-targets-main.json"), JSON.stringify(run.targets, null, 2));
      fs.writeFileSync(path.join(outDir, "logs", "xvfb.log"), xvfb.logText());
    }

    if (!options.skipOffline) {
      const off = await runAppRun(context, "offline", offlinePort, [
        "--proxy-server=http://127.0.0.1:9",
        "--proxy-bypass-list=<-loopback>",
      ]);
      tracked.push({ pid: off.proc.pid, pgid: off.proc.pid, name: "app-offline" });
      report.note(
        "offline scenario: renderer network egress forced through a dead proxy (127.0.0.1:9) via the standard Chromium --proxy-server switch — an unavailable external service simulated without app cooperation",
      );
      if (off.error) {
        report.check("error-handling-offline-render", "packaged app renders with a dead proxy", "fail", off.error, [
          `app log tail: ${tail(off.appLog, 30)}`,
        ]);
        report.check("error-handling-offline-stability", "app stays alive with a dead proxy", "fail", "app never started");
        fs.copyFileSync(off.appLog, path.join(outDir, "logs", "app-offline-stdout.log"));
      } else {
        // PLX-REL-001 (run 41226144216 lesson): the same first-run prep race
        // as the main run applies under the dead proxy — staging fetches hang
        // until their timeouts, so the render verdict must wait for the
        // product shell (generously, bounded) instead of racing the loading
        // screen. offlineScenario probes fresh for its verdict.
        await waitForProductShell(off.page, log);
        await offlineScenario({
          report,
          cdp: off.page,
          outDir,
          observeMs: DEFAULTS.offlineObserveMs,
          pidAlive: () => pidAlive(off.proc.pid),
          log,
        });
        await shutdownApp(context, off, "clean-shutdown-offline");
        fs.copyFileSync(off.appLog, path.join(outDir, "logs", "app-offline-stdout.log"));
        fs.writeFileSync(path.join(outDir, "logs", "console-offline.json"), JSON.stringify(off.consoleEntries, null, 2));
      }
    }
  } finally {
    await killRunProcesses(tracked, tmpRoot, log);
    fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "logs", "harness.log"), logLines.join("\n"));
    try {
      report.artifacts = evidenceIndex(outDir);
    } catch {
      report.artifacts = { error: "evidence index unavailable" };
    }
  }

  const final = await report.write(outDir);
  console.log(`\nreport: ${path.join(outDir, "report.json")}`);
  console.log(report.transcript(final));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  return final.exitCode;
}

function xvfbVersion() {
  try {
    const result = spawnSync("Xvfb", ["-version"], { encoding: "utf8" });
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (/Unrecognized option|unknown option/i.test(text)) {
      return "present (this host's Xvfb does not support -version)";
    }
    const line = text
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0);
    return line ?? "unknown";
  } catch (error) {
    return String(error?.message ?? error).slice(0, 120);
  }
}

/** Machine-readable evidence index: every file the run produced. */
function evidenceIndex(outDir) {
  const listFiles = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full) : [full];
      });
  return {
    dir: outDir,
    files: listFiles(outDir)
      .map((file) => ({ file: path.relative(outDir, file), bytes: fs.statSync(file).size }))
      .sort((a, b) => a.file.localeCompare(b.file)),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`harness fatal: ${error?.stack ?? error}`);
    process.exit(3);
  });
}
