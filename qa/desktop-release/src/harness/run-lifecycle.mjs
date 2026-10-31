/**
 * RW-003 harness — packaged-launch lifecycle (extracted from run.mjs
 * unchanged; max-file-lines gate): one app run up to "render settled",
 * bounded shutdown, and the CDP port-release wait between runs.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULTS } from "./config.mjs";
import { pidAlive, portIsFree, waitForMemory } from "./memwatch.mjs";
import {
  childEnv,
  launchApp,
  makeCleanProfile,
  waitForCdp,
  waitForPageTarget,
  waitForRender,
} from "./launcher.mjs";
import { attachConsoleCollector, connectBrowser, connectTarget, preparePageSession } from "./cdp.mjs";
import { waitForExit } from "./run-helpers.mjs";

/** One packaged launch up to "render settled" (or its honest error). */
export async function runAppRun(context, label, cdpPort, extraArgs = []) {
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

function labelFor(run) {
  return run.profileDirs ? path.basename(path.dirname(run.profileDirs.home)) : "run";
}

/** Close via CDP Browser.close (the "user closes the window" path), then
 * bounded SIGTERM (the POSIX "user asks the app to quit" signal). Honest:
 * pass requires a bounded exit without the SIGKILL last resort; the method
 * actually needed is always recorded. */
export async function shutdownApp(context, run, checkId = "clean-shutdown") {
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
