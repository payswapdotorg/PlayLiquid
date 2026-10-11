/**
 * BROWSER SHIM: node:child_process (subset) for the GameOS Studio preview
 * mount.
 *
 * Why this exists: @playliquid/tool-fabric-runtime's public entrypoint
 * re-exports its Node process executor adapter (a legitimate Node-only
 * adapter). Importing that entrypoint in the browser drags `node:child_
 * process` into the graph; Vite externalizes node builtins and the named
 * `spawn` binding throws at import time — before any studio code runs.
 *
 * Honesty rules (lock rule 44):
 * - The studio demo NEVER spawns processes (its tools run on the in-memory
 *   structural adapter); this shim only satisfies the import binding.
 * - If anything actually CALLS `spawn` in the browser mount it throws
 *   loudly — process execution is genuinely unavailable in the browser and
 *   is never silently faked.
 *
 * TEST-SUPPORT SHIM for the browser preview mount only; not a production
 * integration.
 */

/** Node-only capability; throws if invoked in the browser mount. */
export function spawn(): never {
  throw new Error(
    "gameos preview shim: node:child_process spawn is Node-only and unavailable in the browser mount",
  );
}

/** Sentinel for the type-only `ChildProcess` binding (erased at runtime). */
export const ChildProcess = undefined;
