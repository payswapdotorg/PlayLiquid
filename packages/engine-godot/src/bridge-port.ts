/**
 * Module role: the GodotBridgePort — the pure interface that turns a
 * validated neutral dispatch into a bridge-specific invocation and returns
 * an authoritative outcome. NO process spawning, no IO, no timers, no
 * globals in this package (E3): the REAL bridge (Godot editor
 * remote-control / `godot --headless --script` / export-template pipeline
 * invocation) is a HOST concern, deliberately deferred (E11, recorded in
 * the work order report); the in-memory fake bridge is the test host.
 *
 * The invocation envelope is bridge-shaped (editor session / export
 * pipeline envelope) but neutral in vocabulary: ids and codes are
 * provider-neutral strings, never engine-SDK types.
 *
 * Implements: PL-024 GodotBridgePort seam (E3; R13/E4 behind the seam).
 */

import type { GodotCommandPayload } from "./payload-model.ts";

/** Clock seam — the adapter never reads wall-clock time directly (E9). */
export type GodotClockPort = () => number;

/** Bridge outcome: ok with a value, or failed with a typed error. */
export interface GodotBridgeOutcome {
  readonly outcome: "ok" | "failed";
  readonly value?: unknown;
  /** Present iff outcome is "failed". Bridge-defined, provider-neutral. */
  readonly error?: { readonly code: string; readonly message: string };
  /** Bridge-reported execution duration in ms (deterministic in fakes). */
  readonly durationMs: number;
}

/** Command id derived from content (see command-id.ts). */
export type GodotCommandKey = string;

/**
 * One bridge invocation: the validated typed payload plus the
 * content-derived command key (idempotency) and the deadline (if any).
 */
export interface GodotBridgeInvocation {
  readonly kind: "godot-bridge-invocation";
  readonly commandKey: GodotCommandKey;
  readonly capability: string;
  readonly payload: GodotCommandPayload;
  readonly deadlineAtEpochMs?: number;
}

/** The pure seam. Implementations live in the HOST (real) or tests (fake). */
export interface GodotBridgePort {
  /** Executes one validated invocation; returns an authoritative outcome. */
  invoke(invocation: GodotBridgeInvocation): Promise<GodotBridgeOutcome>;
}

/** Typed refusal codes the bridge outcome can surface to the adapter. */
export const GODOT_BRIDGE_ERROR_CODES: readonly string[] = Object.freeze([
  "bridge/unsupported-capability",
  "bridge/project-not-found",
  "bridge/scene-not-found",
  "bridge/node-not-found",
  "bridge/asset-not-found",
  "bridge/resource-not-found",
  "bridge/script-digest-mismatch",
  "bridge/preset-not-found",
  "bridge/target-platform-unsupported",
  "bridge/configuration-unsupported",
  "bridge/command-failed",
]);
