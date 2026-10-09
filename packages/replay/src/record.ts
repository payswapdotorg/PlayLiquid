/**
 * THE REPLAY RECORD (immutable, content-addressed — E10, lock 15).
 *
 * A replay record is the durable metadata that ties a captured play
 * session together: identity (content-addressed), the pinned game
 * composition, the original determinism seed (provenance for re-execution,
 * E9), the capture range (which event span, from the origin or from a
 * snapshot boundary — the same boundary rule the runtime enforces), the
 * content-addressed command stream and event witness references, and the
 * capture provenance (who, when, with what, for whom — the frozen R8
 * consumer vocabulary from game-contracts).
 *
 * Immutability (E10): records are sealed once; the identity is derived from
 * the canonical body bytes (`replay-<sha256>`), so the SAME id can only
 * ever address the SAME bytes. Stores refuse conflicting rewrites; derived
 * artifacts (derivation.ts) APPEND references and never touch the source.
 *
 * Pure module: no IO.
 */

import { createHash } from "node:crypto";
import { canonicalJson, isContentDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { REPLAY_CONSUMERS } from "@playliquid/game-contracts";
import type { ReplayConsumer } from "@playliquid/game-contracts";
import type {
  DeterminismSeed,
  GameRefSummary,
  RuntimeRoleKind,
  SessionId,
  Timestamp,
} from "@playliquid/runtime-contracts";

/** Capture provenance: who captured what, when, and for whom (R8). */
export interface ReplayProvenance {
  /** Capturing actor description (e.g. "platform-replay-service"). */
  readonly capturedBy: string;
  /** Caller-supplied timestamp (injected clock; no wall-clock authority). */
  readonly capturedAt: Timestamp;
  /** Which runtime path produced the captured stream (lock 12). */
  readonly runtimeRole: RuntimeRoleKind;
  /** Capturing tool identity (e.g. "runtime-core/1.0"). */
  readonly tool: string;
  /** Declared consumer audience — the frozen R8 vocabulary. */
  readonly consumers: readonly ReplayConsumer[];
}

/** The snapshot boundary a replay continues from (lock 15 boundary rule). */
export interface ReplayBoundaryRef {
  readonly snapshotId: string;
  /** Digest of the boundary snapshot's canonical form (integrity pin). */
  readonly formDigest: string;
  /** Event log is committed through this seq at the boundary. */
  readonly afterEventSeq: number;
  readonly tick: number;
  /**
   * The opaque snapshot artifact (the capturing runtime's own shape —
   * structural compatibility, the platform never interprets it).
   */
  readonly artifact: unknown;
}

/** The captured event span. */
export interface ReplayCapture {
  /** First captured event seq: 1 (origin) or boundary.afterEventSeq + 1. */
  readonly fromEventSeq: number;
  /** Inclusive last captured event seq. */
  readonly toEventSeq: number;
  /** Session tick when the capture ended. */
  readonly toTick: number;
  /** Present iff the replay continues from a snapshot boundary. */
  readonly boundary?: ReplayBoundaryRef;
}

/** The record body (everything the identity is derived from). */
export interface ReplayRecordBody {
  readonly sessionId: SessionId;
  /** The pinned game composition the session ran. */
  readonly game: GameRefSummary;
  /** The session's original determinism seed (E9 re-execution input). */
  readonly determinism: DeterminismSeed;
  readonly capture: ReplayCapture;
  readonly commandStream: ContentDigest;
  readonly eventWitness: ContentDigest;
  readonly provenance: ReplayProvenance;
}

/** A sealed replay record: the body plus its content-addressed identity. */
export interface ReplayRecord {
  /** `replay-<sha256 of the canonical body form>`. */
  readonly replayId: string;
  readonly sessionId: SessionId;
  readonly game: GameRefSummary;
  readonly determinism: DeterminismSeed;
  readonly capture: ReplayCapture;
  readonly commandStream: ContentDigest;
  readonly eventWitness: ContentDigest;
  readonly provenance: ReplayProvenance;
}

/** Typed validation result for a record body. */
export type ReplayRecordValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/** Pure structural validation of a record body (fail closed). */
export function validateReplayRecordBody(body: ReplayRecordBody): ReplayRecordValidation {
  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return { ok: false, code: "session-id-missing", detail: "record must name its session" };
  }
  if (typeof body.determinism !== "string" || body.determinism.length === 0) {
    return { ok: false, code: "determinism-seed-missing", detail: "re-execution requires the original seed (E9)" };
  }
  if (!isContentDigest(body.commandStream)) {
    return { ok: false, code: "command-stream-ref-malformed", detail: "command stream reference must be a content digest" };
  }
  if (!isContentDigest(body.eventWitness)) {
    return { ok: false, code: "event-witness-ref-malformed", detail: "event witness reference must be a content digest" };
  }
  const capture = body.capture;
  if (!Number.isInteger(capture.fromEventSeq) || capture.fromEventSeq < 1) {
    return { ok: false, code: "capture-from-malformed", detail: "fromEventSeq must be a positive integer" };
  }
  if (!Number.isInteger(capture.toEventSeq) || capture.toEventSeq < capture.fromEventSeq) {
    return { ok: false, code: "capture-to-malformed", detail: "toEventSeq must be >= fromEventSeq" };
  }
  if (!Number.isInteger(capture.toTick) || capture.toTick < 0) {
    return { ok: false, code: "capture-tick-malformed", detail: "toTick must be a non-negative integer" };
  }
  const boundary = capture.boundary;
  if (boundary === undefined) {
    if (capture.fromEventSeq !== 1) {
      return { ok: false, code: "mid-stream-start", detail: "capture must start at seq 1 or immediately after a snapshot boundary" };
    }
  } else {
    if (typeof boundary.snapshotId !== "string" || boundary.snapshotId.length === 0) {
      return { ok: false, code: "boundary-malformed", detail: "boundary snapshot id missing" };
    }
    if (typeof boundary.formDigest !== "string" || !/^[0-9a-f]{64}$/.test(boundary.formDigest)) {
      return { ok: false, code: "boundary-malformed", detail: "boundary form digest must be 64 lowercase hex" };
    }
    if (capture.fromEventSeq !== boundary.afterEventSeq + 1) {
      return { ok: false, code: "mid-stream-start", detail: "capture must start at boundary.afterEventSeq + 1" };
    }
    if (capture.toTick < boundary.tick) {
      return { ok: false, code: "capture-tick-malformed", detail: "toTick cannot precede the boundary tick" };
    }
  }
  const provenance = body.provenance;
  if (typeof provenance.capturedBy !== "string" || provenance.capturedBy.length === 0) {
    return { ok: false, code: "provenance-malformed", detail: "capturedBy missing" };
  }
  if (typeof provenance.tool !== "string" || provenance.tool.length === 0) {
    return { ok: false, code: "provenance-malformed", detail: "tool missing" };
  }
  if (provenance.runtimeRole !== "interactive" && provenance.runtimeRole !== "simulation") {
    return { ok: false, code: "provenance-malformed", detail: "runtimeRole must be a known role" };
  }
  if (!Array.isArray(provenance.consumers) || provenance.consumers.length === 0) {
    return { ok: false, code: "provenance-malformed", detail: "consumers must be a non-empty list" };
  }
  if (!provenance.consumers.every((consumer) => (REPLAY_CONSUMERS as readonly string[]).includes(consumer))) {
    return { ok: false, code: "provenance-malformed", detail: "consumers must come from the frozen R8 vocabulary" };
  }
  return { ok: true };
}

/** The canonical byte form of a record body (identity input). */
export function canonicalReplayBodyForm(body: ReplayRecordBody): string {
  return canonicalJson(body as unknown as Record<string, unknown>);
}

/**
 * Seals a record body into an immutable record: validates, derives the
 * content-addressed identity from the canonical body bytes and freezes the
 * result. Same body → same identity, forever (E10).
 */
export function sealReplayRecord(body: ReplayRecordBody): ReplayRecord {
  const validation = validateReplayRecordBody(body);
  if (!validation.ok) {
    throw new RangeError(`replay-record: ${validation.code}: ${validation.detail}`);
  }
  const form = canonicalReplayBodyForm(body);
  const hex = createHash("sha256").update(form, "utf8").digest("hex");
  const record: ReplayRecord = Object.freeze({
    replayId: `replay-${hex}`,
    sessionId: body.sessionId,
    game: body.game,
    determinism: body.determinism,
    capture: body.capture,
    commandStream: body.commandStream,
    eventWitness: body.eventWitness,
    provenance: body.provenance,
  });
  return record;
}

/** Re-derives the identity of a record from its fields (integrity oracle). */
export function replayRecordIdentity(record: Omit<ReplayRecord, "replayId">): string {
  // Strip any identity field present at runtime (Omit is type-only): the
  // identity is always derived from the BODY alone.
  const body: Record<string, unknown> = { ...(record as unknown as Record<string, unknown>) };
  delete body.replayId;
  const form = canonicalJson(body);
  return `replay-${createHash("sha256").update(form, "utf8").digest("hex")}`;
}
