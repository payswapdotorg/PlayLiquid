/**
 * RW-003 harness — packaged-application launcher.
 *
 * Launches the BUILT artifact exactly like an end user would (plus the
 * standard Chromium `--remote-debugging-port` switch for evidence), with a
 * CLEAN profile: fresh HOME and XDG_* directories. No dev env vars are set
 * (ELECTRON_RENDERER_URL / VITE_* / ZCODE_* are deliberately absent so the
 * run proves packaged-mode independence).
 *
 * NEUTRAL CWD (observed defect guard): the packaged app resolves its agent
 * runtime with a `findUpward(...)` chain anchored at process.cwd() — when
 * launched from inside a ZCode/PlayLiquid repo checkout it binds the repo's
 * dev agent (tsx + src/main.ts, no storagePreparationEntry) instead of the
 * bundled resources/glm/zcode.cjs runtime, and its first-run "storage
 * preparation" then fails ("Startup preparation failed" screen). A real end
 * user never launches from inside a repository; the harness therefore always
 * launches with cwd = the clean profile HOME and records this cwd-sensitivity
 * in the report as an honest observation about the current artifact.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DEFAULTS } from "./config.mjs";
import { httpGetJson, sleep } from "./memwatch.mjs";

export function isAppImage(artifact) {
  return /\.AppImage$/i.test(artifact);
}

/** Create the clean-profile tree (the whole fixture: empty directories). */
export function makeCleanProfile(root) {
  const dirs = {
    home: path.join(root, "home"),
    xdgConfig: path.join(root, "xdg", "config"),
    xdgData: path.join(root, "xdg", "data"),
    xdgCache: path.join(root, "xdg", "cache"),
    xdgRuntime: path.join(root, "xdg", "runtime"),
    tmp: path.join(root, "tmp"),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dirs.xdgRuntime, 0o700);
  fs.chmodSync(dirs.tmp, 0o700);
  return dirs;
}

/** Build the clean user environment for the packaged app. */
export function childEnv(dirs, display) {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: dirs.home,
    XDG_CONFIG_HOME: dirs.xdgConfig,
    XDG_DATA_HOME: dirs.xdgData,
    XDG_CACHE_HOME: dirs.xdgCache,
    XDG_RUNTIME_DIR: dirs.xdgRuntime,
    TMPDIR: dirs.tmp,
    DISPLAY: display,
    LANG: "C.UTF-8",
    TERM: "dumb",
    // NOTE: no ELECTRON_RENDERER_URL / VITE_* / ZCODE_* on purpose.
  };
}

/**
 * Spawn the packaged app. `extraArgs` allows the offline scenario's
 * `--proxy-server` (documented deviation; a user-reachable Chromium switch).
 *
 * AppImage handling: direct FUSE mount execution when /dev/fuse exists,
 * otherwise `--appimage-extract-and-run` (required on hosts without FUSE —
 * recorded in the report as an environment fact, not hidden).
 */
export async function launchApp(options) {
  const { artifact, env, args, logFile, cwd } = options;
  const argv = [...args];
  let mode = "direct";
  if (isAppImage(artifact)) {
    // A DOWNLOADED AppImage typically arrives without the executable bit
    // (observed live: release run 38675144166's post-publication verify —
    // `gh release download` wrote mode 644, spawn hit EACCES). The product's
    // own release notes tell users to `chmod +x` — the harness does exactly
    // that when needed, and records it.
    try {
      fs.accessSync(artifact, fs.constants.X_OK);
    } catch {
      fs.chmodSync(artifact, 0o755);
      mode = "appimage-chmod-plus-x";
    }
    if (fs.existsSync("/dev/fuse")) {
      mode = mode === "appimage-chmod-plus-x" ? "appimage-chmod-plus-x+fuse" : "appimage-fuse";
    } else {
      mode = mode === "appimage-chmod-plus-x" ? "appimage-chmod-plus-x+extract-and-run" : "appimage-extract-and-run";
      argv.unshift("--appimage-extract-and-run");
    }
  }
  const spawned = spawnOnce(artifact, argv, { env, cwd, logFile });
  let { proc, argv: finalArgv } = spawned;

  // FUSE-failure fallback (live-caught: run 38675144166 on ubuntu-latest —
  // the runner ships /dev/fuse but NOT libfuse2, so the AppImage died with
  // `dlopen(): error loading libfuse.so.2` before any UI existed). A healthy
  // launch keeps running past this window; an early exit under FUSE mode
  // with the libfuse marker in the log is retried ONCE with
  // --appimage-extract-and-run (works everywhere; needs TMPDIR disk).
  if (mode.includes("fuse") && !mode.includes("extract")) {
    const diedEarly = await earlyExitWithin(proc, 2500);
    if (diedEarly && /libfuse|dlopen\(\)/i.test(readTail(logFile, 4096))) {
      mode = "appimage-fuse-failed-retry-extract-and-run";
      const retryArgv = [`--appimage-extract-and-run`, ...args];
      const retry = spawnOnce(artifact, retryArgv, { env, cwd, logFile });
      proc = retry.proc;
      finalArgv = retry.argv;
    }
  }
  return { proc, mode, argv: finalArgv };
}

/** Spawn the app process once (shared by the initial launch and the
 *  extract-and-run retry); returns the process and the effective argv. */
function spawnOnce(artifact, argv, { env, cwd, logFile }) {
  const out = fs.openSync(logFile, "a");
  const proc = spawn(artifact, argv, {
    env,
    cwd: cwd ?? env.HOME ?? process.cwd(), // neutral cwd — see file header
    stdio: ["ignore", out, out],
    detached: true, // own process group → exact tree kill via pgid
  });
  fs.closeSync(out);
  return { proc, argv };
}

/** Resolves true when the process exits within `ms` (a startup crash);
 *  false when it keeps running (healthy launch or slow start). */
function earlyExitWithin(proc, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.removeAllListeners("exit");
      resolve(false);
    }, ms);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
    proc.once("error", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Reads the last `bytes` of a file (best-effort; "" on any failure). */
function readTail(file, bytes) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - bytes);
    const fh = fs.openSync(file, "r");
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fh, buffer, 0, buffer.length, start);
    fs.closeSync(fh);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

/** Poll the CDP HTTP endpoint until it answers (or timeout). */
export async function waitForCdp(port, timeoutMs, log) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not started";
  while (Date.now() < deadline) {
    try {
      const version = await httpGetJson(`http://127.0.0.1:${port}/json/version`, 2000);
      log(`cdp: endpoint up — browser ${version.Browser ?? "unknown"}`);
      return version;
    } catch (error) {
      lastError = String(error.message ?? error);
      await sleep(1000);
    }
  }
  throw new Error(`CDP endpoint never came up on port ${port}: ${lastError}`);
}

/** Poll /json/list until a candidate main page target appears. */
export async function waitForPageTarget(port, timeoutMs, log) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    try {
      const targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`, 2000);
      last = targets;
      const pages = targets.filter((target) => target.type === "page");
      const main = pages.find((target) => /renderer\/(index|login)\.html/.test(target.url));
      const anyVisible = pages.find((target) => !/^devtools:/.test(target.url));
      const chosen = main ?? anyVisible;
      if (chosen) {
        log(`cdp: page target ready — ${chosen.url}`);
        return { target: chosen, targets };
      }
    } catch {
      /* endpoint not ready yet */
    }
    await sleep(1000);
  }
  throw new Error(
    `no page target appeared within ${timeoutMs} ms (last target list: ${JSON.stringify(last).slice(0, 2000)})`,
  );
}

/** Wait until the renderer has a complete, non-trivial DOM that has stopped
 * growing (2 consecutive stable samples, bounded by an extra 30s grace after
 * the first threshold pass) — so branding/marker probes see the real UI, not
 * a boot splash. */
export async function waitForRender(cdp, timeoutMs, log) {
  const deadline = Date.now() + timeoutMs;
  const started = Date.now();
  let lastNodes = -1;
  let stableSamples = 0;
  let graceDeadline = Number.POSITIVE_INFINITY;
  let lastState = "unknown";
  while (Date.now() < deadline && Date.now() < graceDeadline) {
    const state = await cdp
      .evaluate(
        `(() => ({ ready: document.readyState, text: (document.body?.innerText ?? "").length, nodes: document.querySelectorAll("*").length }))()`,
      )
      .catch(() => null);
    lastState = JSON.stringify(state?.result?.value ?? null);
    const value = state?.result?.value;
    if (value && value.ready === "complete" && value.nodes > 50) {
      if (graceDeadline === Number.POSITIVE_INFINITY) {
        graceDeadline = Date.now() + 30_000;
        log(`render: first pass after ${Date.now() - started} ms (${value.nodes} nodes) — waiting for DOM to stabilize`);
      }
      if (value.nodes === lastNodes) {
        stableSamples += 1;
        if (stableSamples >= 2) {
          log(`render: settled after ${Date.now() - started} ms (${value.nodes} nodes, stable)`);
          return value;
        }
      } else {
        stableSamples = 0;
      }
      lastNodes = value.nodes;
    }
    await sleep(1500);
  }
  log(`render: settle timeout — last state ${lastState}`);
  return null;
}
