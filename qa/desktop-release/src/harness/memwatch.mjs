/**
 * RW-003 harness — station memory discipline and child-process hygiene.
 *
 * The reference station is a small RAM box with a resident production stack
 * that must never be disturbed. Before every Electron launch the harness
 * verifies enough available memory (MemAvailable) and waits if necessary;
 * after every run it kills ONLY the processes it started (tracked pids and
 * a per-run unique token in the command line / temp paths).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import { DEFAULTS } from "./config.mjs";

const execFileAsync = promisify(execFile);

/** MemAvailable in MB (buff/cache-aware, same number `free -m` reports). */
export async function availableMemoryMb() {
  const text = await fs.promises.readFile("/proc/meminfo", "utf8");
  const match = text.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  if (!match) throw new Error("cannot read MemAvailable from /proc/meminfo");
  return Math.floor(Number(match[1]) / 1024);
}

/** Wait until at least `requiredMb` is available (bounded patience). */
export async function waitForMemory(requiredMb, log) {
  const deadline = Date.now() + DEFAULTS.memWaitMaxMs;
  for (;;) {
    const available = await availableMemoryMb();
    if (available >= requiredMb) {
      log(`memory gate: ${available} MB available (>= ${requiredMb} MB required) — proceeding`);
      return available;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `memory gate: only ${available} MB available after waiting ${DEFAULTS.memWaitMaxMs / 60000} min (required ${requiredMb} MB); refusing to launch Electron`,
      );
    }
    log(
      `memory gate: ${available} MB available (< ${requiredMb} MB) — waiting ${DEFAULTS.memWaitMs / 1000}s for the box to free memory`,
    );
    await sleep(DEFAULTS.memWaitMs);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kill exactly the process groups this run created. Never uses broad pkill.
 * - `procs`: array of { pid, pgid?, name } tracked by the launcher/xvfb.
 * - `token`: unique per-run path fragment; the fallback pattern match can
 *   only ever hit this run's own AppImage command line or temp dirs.
 */
export async function killRunProcesses(procs, token, log) {
  const survivors = [];
  for (const proc of procs) {
    if (proc.pid == null) continue;
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      if (!(await pidAlive(proc.pid))) break;
      try {
        if (proc.pgid != null) process.kill(-proc.pgid, signal);
        else process.kill(proc.pid, signal);
      } catch {
        /* already gone */
      }
      await sleep(signal === "SIGTERM" ? 4000 : 1500);
    }
    if (await pidAlive(proc.pid)) survivors.push(proc);
  }
  if (token) {
    // Fallback safety net scoped to this run's unique temp token only.
    try {
      await execFileAsync("pkill", ["-f", token]);
    } catch {
      /* no match — fine */
    }
  }
  const still = [];
  for (const proc of procs) if (proc.pid != null && (await pidAlive(proc.pid))) still.push(proc);
  if (still.length > 0 || survivors.length > 0) {
    log(`WARNING: processes still alive after cleanup: ${JSON.stringify([...new Set([...survivors, ...still])])}`);
  } else {
    log("cleanup: all processes started by this run have exited");
  }
  return still.length === 0 && survivors.length === 0;
}

export async function pidAlive(pid) {
  if (pid == null || Number.isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Free TCP port check (so we never collide with the resident CDP :9222). */
export async function portIsFree(port) {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

export async function httpGetJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 3000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function runId() {
  return `rw003-${new Date().toISOString().replace(/[:.]/g, "").replace(/[-TZ]/g, "")}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function tempRoot() {
  return fs.mkdtempSync(`${os.tmpdir()}/rw003-smoke-`);
}
