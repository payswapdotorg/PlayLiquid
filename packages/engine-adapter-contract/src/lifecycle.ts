/**
 * Module role: adapter lifecycle contract — the typed lifecycle states
 * (registered → ready → degraded → closed), the allowed-transition table,
 * and a total transition validator in the style of the runtime-contracts
 * session validators: typed rejections, never thrown exceptions.
 *
 * Transition rules (binding):
 *   registered → ready | degraded | closed
 *   ready      → degraded | closed
 *   degraded   → ready | closed
 *   closed     → (terminal; re-closing is an idempotent no-op)
 *
 * Implements: PL-005 §3.B.2 (adapter lifecycle).
 */

export type AdapterLifecycleState = "registered" | "ready" | "degraded" | "closed";

export type LifecycleRejectionCode =
  | "adapter-lifecycle/unknown-state"
  | "adapter-lifecycle/invalid-transition"
  | "adapter-lifecycle/closed-is-terminal";

export type LifecycleTransitionCheck =
  | { readonly outcome: "ok"; readonly next: AdapterLifecycleState }
  | { readonly outcome: "rejected"; readonly code: LifecycleRejectionCode; readonly message: string };

export const ADAPTER_LIFECYCLE_STATES: readonly AdapterLifecycleState[] = Object.freeze([
  "registered",
  "ready",
  "degraded",
  "closed",
] as AdapterLifecycleState[]);

export const ADAPTER_LIFECYCLE_TRANSITIONS: Readonly<
  Record<AdapterLifecycleState, readonly AdapterLifecycleState[]>
> = Object.freeze({
  registered: Object.freeze(["ready", "degraded", "closed"] as AdapterLifecycleState[]),
  ready: Object.freeze(["degraded", "closed"] as AdapterLifecycleState[]),
  degraded: Object.freeze(["ready", "closed"] as AdapterLifecycleState[]),
  closed: Object.freeze([] as AdapterLifecycleState[]),
});

/** Type guard for untrusted lifecycle state strings. Total; never throws. */
export function isAdapterLifecycleState(value: unknown): value is AdapterLifecycleState {
  return (
    typeof value === "string" &&
    ADAPTER_LIFECYCLE_STATES.includes(value as AdapterLifecycleState)
  );
}

/**
 * Validates a lifecycle transition. Total; never throws. Re-closing a
 * closed adapter is an idempotent no-op (ok, next "closed"); every other
 * move out of "closed" is rejected as terminal.
 */
export function advanceLifecycle(
  current: AdapterLifecycleState,
  requested: AdapterLifecycleState,
): LifecycleTransitionCheck {
  if (!isAdapterLifecycleState(current)) {
    return {
      outcome: "rejected",
      code: "adapter-lifecycle/unknown-state",
      message: `unknown adapter lifecycle state: ${String(current)}`,
    };
  }
  if (!isAdapterLifecycleState(requested)) {
    return {
      outcome: "rejected",
      code: "adapter-lifecycle/unknown-state",
      message: `unknown adapter lifecycle state: ${String(requested)}`,
    };
  }
  if (current === "closed") {
    if (requested === "closed") {
      return { outcome: "ok", next: "closed" };
    }
    return {
      outcome: "rejected",
      code: "adapter-lifecycle/closed-is-terminal",
      message: `"closed" is terminal; cannot transition to "${requested}"`,
    };
  }
  const allowed = ADAPTER_LIFECYCLE_TRANSITIONS[current];
  if (!allowed.includes(requested)) {
    return {
      outcome: "rejected",
      code: "adapter-lifecycle/invalid-transition",
      message: `cannot transition from "${current}" to "${requested}"; allowed: ${allowed.join(", ")}`,
    };
  }
  return { outcome: "ok", next: requested };
}
