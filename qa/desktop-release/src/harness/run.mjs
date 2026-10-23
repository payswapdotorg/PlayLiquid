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
  waitForMemory,
} from "./memwatch.mjs";
import { startXvfb } from "./xvfb.mjs";
import {
  childEnv,
  launchApp,
  makeCleanProfile,
  waitForCdp,
  waitForPageTarget,
  waitForRender,
} from "./launcher.mjs";
import { attachConsoleCollector, connectBrowser, connectTarget, preparePageSession } from "./cdp.mjs";
import { Report } from "./report.mjs";
import { checksumCheck, packagingIdentityCheck } from "./checks-artifact.mjs";
import {
  cleanProfileCheck,
  identityChecks,
  markerProbe,
  navigationCheck,
  realOperationCheck,
  shellChecks,
  viewportChecks,
} from "./checks.mjs";
import { emptyStateContractCheck, workbenchEscapeCheck } from "./checks-contract.mjs";
import { geometryChecks } from "./checks-geometry.mjs";
import { accessibleNamesCheck, headingHierarchyCheck, keyboardNavigationCheck, visibleFocusCheck } from "./checks-a11y.mjs";
import { journeyChecks } from "./checks-journey.mjs";
import { offlineScenario } from "./checks-offline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
import { distroName, tail, waitForExit } from "./run-helpers.mjs";

/** One packaged launch up to "render settled" (or its honest error). */
async function runAppRun(context, label, cdpPort, extraArgs = []) {
  const { options, tmpRoot, xvfb, log } = context;
  await waitForMemory(DEFAULTS.memRequiredMb, log);
  const profileDirs = makeCleanProfile(path.join(tmpRoot, `profile-${label}`));
  const before = fs.readdirSync(profileDirs.xdgConfig);
  const appLog = path.join(tmpRoot, `app-${label}.log`);
  const { proc, mode, argv } = await launchApp({
    artifact: options.artifact,
    env: childEnv(profileDirs, xvfb.display),
    cwd: profileDirs.home, // neutral cwd — packaged app must not see a repo (see launcher.mjs)
    args: [`--remote-debugging-port=${cdpPort}`, ...extraArgs],
    logFile: appLog,
  });
  log(`launch[${label}]: pid ${proc.pid} mode=${mode} cwd=${profileDirs.home} argv=${JSON.stringify(argv)}`);
  const startedAt = Date.now();
  try {
    await waitForCdp(cdpPort, DEFAULTS.cdpReadyTimeoutMs, log);
    const { target, targets } = await waitForPageTarget(cdpPort, DEFAULTS.cdpReadyTimeoutMs, log);
    const page = await connectTarget(target);
    const browser = await connectBrowser(cdpPort);
    await preparePageSession(page);
    const consoleEntries = attachConsoleCollector(page);
    const render = await waitForRender(page, DEFAULTS.renderSettleTimeoutMs, log);
    return { proc, appLog, mode, startedAt, page, browser, target, targets, consoleEntries, render, profileDirs, before, cdpPort };
  } catch (error) {
    return {
      proc,
      appLog,
      mode,
      startedAt,
      profileDirs,
      before,
      cdpPort,
      error: String(error?.message ?? error),
      // Startup forensics (live-caught: the ubuntu-latest runner killed the
      // extracted app SILENTLY — zero electron output after the AppImage
      // extraction listing). The exit code / signal / liveness at failure
      // time disambiguates sandbox kills, instant exits and port hangs.
      procExitCode: proc.exitCode,
      procSignalCode: proc.signalCode,
      procStillRunning: proc.exitCode === null && proc.signalCode === null,
    };
  }
}

/** After an app exits, wait (bounded) until its CDP port is actually free — a
 * second Chromium cannot bind a port whose previous listener/children are not
 * fully released (observed: it then silently starts without remote
 * debugging, which looks like a hang to the harness). */
async function waitForPortFree(port, timeoutMs, log) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) {
      log(`port ${port} is free again`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  log(`WARNING: port ${port} still not free after ${timeoutMs / 1000}s`);
  return false;
}

/** Close via CDP Browser.close (the "user closes the window" path), then
 * bounded SIGTERM (the POSIX "user asks the app to quit" signal). Honest:
 * pass requires a bounded exit without the SIGKILL last resort; the method
 * actually needed is always recorded. */
async function shutdownApp(context, run, checkId = "clean-shutdown") {
  const { report, log } = context;
  let method = "cdp-browser-close";
  try {
    // Fire-and-forget: the app may exit before the CDP response arrives.
    run.browser.send("Browser.close").catch(() => undefined);
  } catch {
    method = "cdp-browser-close-failed";
  }
  let code = await waitForExit(run.proc, DEFAULTS.shutdownTimeoutMs);
  if (code === null) {
    method = "sigterm";
    try {
      process.kill(-run.proc.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    code = await waitForExit(run.proc, 15_000);
  }
  let exited = !(await pidAlive(run.proc.pid));
  if (!exited) {
    method = "sigkill-last-resort";
    try {
      process.kill(-run.proc.pid, "SIGKILL");
    } catch {
      /* ignore */
    }
    exited = !(await pidAlive(run.proc.pid));
  }
  await run.page.close().catch(() => undefined);
  await run.browser.close().catch(() => undefined);
  const uptimeMs = Date.now() - run.startedAt;
  const clean = exited && method !== "sigkill-last-resort";
  report.check(
    checkId,
    checkId === "clean-shutdown"
      ? "application terminates in a bounded, controlled way when asked to close (no hang, no forced kill)"
      : "offline-scenario application instance also terminates in a bounded, controlled way",
    clean ? "pass" : "fail",
    exited
      ? `exit code ${code} via ${method} after ${Math.round(uptimeMs / 1000)}s of uptime`
      : `process did NOT exit even after ${method} (pid ${run.proc.pid})`,
    [`exit code: ${code}`, `shutdown method: ${method}`, `uptime: ${Math.round(uptimeMs / 1000)}s`],
  );
  log(`shutdown[${labelFor(run)} pid ${run.proc.pid}]: method=${method} code=${code}`);
  await waitForPortFree(run.cdpPort, DEFAULTS.portFreeTimeoutMs, log);
}

function labelFor(run) {
  return run.profileDirs ? path.basename(path.dirname(run.profileDirs.home)) : "run";
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
      const probe = await markerProbe(run.page);
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
