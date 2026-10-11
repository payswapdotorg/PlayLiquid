/**
 * Module role: the PlayCanvasBridgePort — the pure interface that turns a
 * validated neutral dispatch into a bridge-specific invocation and returns
 * an authoritative outcome. NO process spawning, no IO, no timers, no
 * globals in this package (E3): the REAL bridge (PlayCanvas editor /
 * web publish pipeline invocation) is a HOST concern, deliberately
 * deferred (E11, recorded in the work order report); the in-memory fake
 * bridge is the test host.
 *
 * The invocation envelope is bridge-shaped (editor session / web publish
 * pipeline envelope) but neutral in vocabulary: ids and codes are
 * provider-neutral strings, never engine-SDK types.
 *
 * Implements: PL-021 PlayCanvasBridgePort seam (E3; R13/E4 behind the seam).
 */

import type { PlayCanvasCommandPayload } from "./payload-model.ts";

/** Clock seam — the adapter never reads wall-clock time directly (E9). */
export type PlayCanvasClockPort = () => number;

/** Bridge outcome: ok with a value, or failed with a typed error. */
export interface PlayCanvasBridgeOutcome {
  readonly outcome: "ok" | "failed";
  readonly value?: unknown;
  /** Present iff outcome is "failed". Bridge-defined, provider-neutral. */
  readonly error?: { readonly code: string; readonly message: string };
  /** Bridge-reported execution duration in ms (deterministic in fakes). */
  readonly durationMs: number;
}

/** Command id derived from content (see command-id.ts). */
export type PlayCanvasCommandKey = string;

/**
 * One bridge invocation: the validated typed payload plus the
 * content-derived command key (idempotency) and the deadline (if any).
 */
export interface PlayCanvasBridgeInvocation {
  readonly kind: "playcanvas-bridge-invocation";
  readonly commandKey: PlayCanvasCommandKey;
  readonly capability: string;
  readonly payload: PlayCanvasCommandPayload;
  readonly deadlineAtEpochMs?: number;
}

/** The pure seam. Implementations live in the HOST (real) or tests (fake). */
export interface PlayCanvasBridgePort {
  /** Executes one validated invocation; returns an authoritative outcome. */
  invoke(invocation: PlayCanvasBridgeInvocation): Promise<PlayCanvasBridgeOutcome>;
}

/** Typed refusal codes the bridge outcome can surface to the adapter. */
export const PLAYCANVAS_BRIDGE_ERROR_CODES: readonly string[] = Object.freeze([
  "bridge/unsupported-capability",
  "bridge/target-not-found",
  "bridge/artifact-not-found",
  "bridge/entity-not-found",
  "bridge/component-not-found",
  "bridge/script-digest-mismatch",
  "bridge/build-not-published",
  "bridge/channel-unsupported",
  "bridge/command-failed",
]);
