/**
 * Kernel-authority event kinds on the canonical event path. These mark
 * session lifecycle transitions; `runtime.session-reset` and
 * `runtime.session-restored` additionally START new epoch segments in the
 * event log (see logview.ts).
 */

export const RUNTIME_EVENT_KINDS = {
  loaded: "runtime.session-loaded",
  reset: "runtime.session-reset",
  restored: "runtime.session-restored",
  terminating: "runtime.session-terminating",
  terminated: "runtime.session-terminated",
  failed: "runtime.session-failed",
} as const;
