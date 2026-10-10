/**
 * Module role: the BlenderBridgePort — the pure interface that turns a
 * validated neutral dispatch into a bridge-specific invocation and returns
 * an authoritative outcome. NO process spawning, no IO, no timers, no
 * globals in this package (E3): the REAL bridge (headless tool invocation)
 * is a HOST concern, deliberately deferred (E11, recorded in the work
 * order report); the in-memory fake bridge is the test host.
 *
 * The invocation envelope is bridge-shaped (headless command / scene
 * script envelope) but neutral in vocabulary: ids and codes are
 * provider-neutral strings, never tool-SDK types.
 *
 * Implements: PL-025 BlenderBridgePort seam (E3; R13/E4 behind the seam).
 */

import type { BlenderCommandPayload } from "./payload-model.ts";

/** Clock seam — the adapter never reads wall-clock time directly (E9). */
export type BlenderClockPort = () => number;

/** Bridge outcome: ok with a value, or failed with a typed error. */
export interface BlenderBridgeOutcome {
  readonly outcome: "ok" | "failed";
  readonly value?: unknown;
  /** Present iff outcome is "failed". Bridge-defined, provider-neutral. */
  readonly error?: { readonly code: string; readonly message: string };
  /** Bridge-reported execution duration in ms (deterministic in fakes). */
  readonly durationMs: number;
}

/** Command id derived from content (see command-id.ts). */
export type BlenderCommandKey = string;

/**
 * One bridge invocation: the validated typed payload plus the
 * content-derived command key (idempotency) and the deadline (if any).
 */
export interface BlenderBridgeInvocation {
  readonly kind: "blender-bridge-invocation";
  readonly commandKey: BlenderCommandKey;
  readonly capability: string;
  readonly payload: BlenderCommandPayload;
  readonly deadlineAtEpochMs?: number;
}

/** The pure seam. Implementations live in the HOST (real) or tests (fake). */
export interface BlenderBridgePort {
  /** Executes one validated invocation; returns an authoritative outcome. */
  invoke(invocation: BlenderBridgeInvocation): Promise<BlenderBridgeOutcome>;
}

/** Typed refusal codes the bridge outcome can surface to the adapter. */
export const BLENDER_BRIDGE_ERROR_CODES: readonly string[] = Object.freeze([
  "bridge/unsupported-capability",
  "bridge/target-not-found",
  "bridge/artifact-not-found",
  "bridge/object-not-found",
  "bridge/script-digest-mismatch",
  "bridge/command-failed",
]);
