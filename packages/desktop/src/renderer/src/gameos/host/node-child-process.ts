/**
 * RENDERER CHILD-PROCESS ADAPTER (RW-001): a loud import-binding shim for
 * `node:child_process` in the sandboxed Electron renderer.
 *
 * Why this exists: `@playliquid/tool-fabric-runtime`'s public entrypoint
 * re-exports its Node process executor adapter (a legitimate Node-only
 * adapter, `adapters/node-process-executor.ts`), which imports `spawn`
 * from `node:child_process`. Importing that entrypoint in the renderer
 * drags the named binding into the graph; Vite externalizes Node builtins
 * for the browser and the import fails at module-evaluation time — before
 * any product code runs. `packages/desktop/vite.config.ts` aliases
 * `node:child_process` to THIS module for the whole renderer graph.
 *
 * Honesty rules (lock rule 44 discipline): process execution is genuinely
 * unavailable in the sandboxed renderer and is NEVER silently faked — the
 * desktop tool fabric hosts zero registered adapters today, so nothing
 * ever calls this. If anything DOES call it, it throws loudly with an
 * honest message instead of pretending to succeed.
 */

/** Node-only capability; throws if invoked in the renderer. */
export function spawn(): never {
  throw new Error(
    "PlayLiquid GameOS renderer adapter: node:child_process spawn is unavailable in the sandboxed renderer",
  );
}

/** Sentinel for the type-only `ChildProcess` binding (erased at runtime). */
export const ChildProcess = undefined;
