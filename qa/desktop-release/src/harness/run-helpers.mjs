/**
 * UX-003 harness — small generic run helpers (extracted from run.mjs
 * unchanged; max-file-lines gate): distro name, bounded child-exit wait,
 * log tail.
 */
import fs from "node:fs";

export function distroName() {
  try {
    const text = fs.readFileSync("/etc/os-release", "utf8");
    return /^PRETTY_NAME="?([^"\n]+)"?/m.exec(text)?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

export function tail(file, lines) {
  try {
    const content = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
    return content.slice(-lines).join("\n").slice(0, 3000);
  } catch {
    return "(no log)";
  }
}
