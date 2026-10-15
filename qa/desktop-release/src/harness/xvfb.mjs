/**
 * RW-003 harness — private Xvfb display reservation.
 *
 * The harness never reuses a display that already has an X server (the
 * reference station keeps :98/:99 occupied by its resident stack). It starts
 * its own Xvfb, records the pid, and always stops it again.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { sleep } from "./memwatch.mjs";

export function displayNumber(display) {
  const match = /^:([0-9]+)$/.exec(display ?? "");
  if (!match) throw new Error(`invalid display "${display}" (expected :N)`);
  return Number(match[1]);
}

function socketPath(display) {
  return `/tmp/.X11-unix/X${displayNumber(display)}`;
}

export async function displayInUse(display) {
  if (fs.existsSync(socketPath(display))) return true;
  try {
    fs.accessSync(socketPath(display));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reserve a display and start Xvfb. Tries the requested display first, then
 * the candidate list; fails when none is free.
 */
export async function startXvfb(requested, candidates, screen, log) {
  const tried = [requested, ...candidates.filter((candidate) => candidate !== requested)];
  for (const display of tried) {
    if (await displayInUse(display)) {
      log(`xvfb: display ${display} already in use — skipping`);
      continue;
    }
    const proc = spawn(
      "Xvfb",
      [display, "-screen", "0", screen, "-nolisten", "tcp"],
      { stdio: ["ignore", "pipe", "pipe"], detached: false },
    );
    const pid = proc.pid;
    proc.stdout.resume();
    proc.stderr.resume();
    const xvfbLog = [];
    proc.stdout.on("data", (chunk) => xvfbLog.push(String(chunk)));
    proc.stderr.on("data", (chunk) => xvfbLog.push(String(chunk)));
    // Wait for the X socket to appear (max 10s).
    const deadline = Date.now() + 10_000;
    let up = false;
    while (Date.now() < deadline) {
      if (fs.existsSync(socketPath(display))) {
        up = true;
        break;
      }
      // Xvfb may have died immediately (e.g. lock contention).
      const exited = proc.exitCode !== null;
      if (exited) break;
      await sleep(250);
    }
    if (up) {
      log(`xvfb: started on ${display} (pid ${pid}, screen ${screen})`);
      return { display, pid, logText: () => xvfbLog.join("") };
    }
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    log(`xvfb: display ${display} did not come up — ${xvfbLog.join("").trim() || "no output"}`);
  }
  throw new Error(`no free display for Xvfb (tried ${tried.join(", ")})`);
}
