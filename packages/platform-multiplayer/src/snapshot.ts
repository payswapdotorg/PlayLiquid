/**
 * BYTE-STABLE AUTHORITY SESSION SNAPSHOTS (E9 determinism; R8 replay seam).
 *
 * A snapshot is ONE canonical JSON document containing the ENTIRE authority
 * session state: phase machine position, epoch, tick, simulator state, the
 * full committed event log, the pending command queue, the idempotency
 * table, protected-grant accounting, the refusal log and the snapshot
 * registry. Encoding goes through `canonicalJson` (digest.ts): object keys
 * sorted recursively, array order preserved. Consequences:
 *
 * - BYTE-STABILITY: two kernels driven from identical configuration, seed,
 *   clock inputs and operation sequences produce byte-identical documents
 *   (proven by tests). The only wall-clock-derived bytes in a document are
 *   the `issuedAt` timestamps of pending command envelopes — supplied by
 *   the injected {@link AuthorityClock} port, so identical runs (same
 *   injected clock) still produce identical bytes.
 * - REPLAYABILITY: the document's event log is the session's committed
 *   stream; replay boundaries are the snapshot's `afterEventSeq` positions
 *   (runtime-contracts `validateReplayPlan`).
 * - CONTENT-ADDRESSED IDs: the snapshot id IS the SHA-256 of the document,
 *   so identical states collapse to identical ids (idempotent saves).
 *
 * Restore discipline: adopting a document NEVER replays it as truth about
 * the present — it resumes the recorded state and advances the session
 * epoch (see kernel.ts), so results produced before the restore are stale
 * by the runtime-contracts stale-result rule.
 *
 * Purity: encode/decode are pure; persistence is the SessionStore port's
 * business (fakes.ts provides the in-memory one).
 */

import type {
  Digest,
  RuntimeEventEnvelope,
  RuntimeSessionPhase,
  SessionSnapshot,
  Tick,
} from "@playliquid/runtime-contracts";
import type { SessionId, SnapshotId } from "@playliquid/runtime-contracts";
import { asDigest, asSnapshotId } from "@playliquid/runtime-contracts";
import type { SubjectId } from "@playliquid/platform-contracts";
import { canonicalJson, sha256Hex } from "./digest.ts";
import type { MultiplayerTopology } from "./topology.ts";

/** Refusal record shape (kernel-wide, JSON-safe, tick/epoch-stamped). */
export interface RefusalRecord {
  readonly kind:
    | "session"
    | "admission"
    | "intent"
    | "idempotency"
    | "effect"
    | "claim"
    | "outcome"
    | "snapshot";
  readonly code: string;
  readonly detail: string;
  readonly atTick: number;
  readonly atEpoch: number;
}

/** A pending admitted command, exactly as it waits for its tick. */
export interface PendingCommandView {
  readonly commandId: string;
  readonly kind: string;
  readonly epoch: number;
  readonly actorClass: string;
  readonly actorId: string;
  readonly origin: string;
  readonly idempotencyKey: { readonly scope: string; readonly actor: string; readonly nonce: string };
  readonly issuedAt: number;
  readonly payload: unknown;
  readonly intentId: string;
  readonly intentKind: string;
  readonly assignedSeq: number;
}

/** A committed participant in the snapshot. */
export interface ParticipantSnapshotView {
  readonly subject: string;
  readonly actorClass: string;
  readonly actorId: string;
  readonly joinedAtTick: number;
}

/** One snapshot registry entry (runtime-contracts boundary shape). */
export interface SnapshotBoundaryView {
  readonly snapshotId: string;
  readonly epoch: number;
  readonly tick: number;
  readonly afterEventSeq: number;
  readonly stateDigest: string;
}

/** THE byte-stable authority session document. The snapshot-boundary
 * registry is deliberately NOT part of the document: the document is the
 * LIVE session state only, so two snapshots of an unchanged session are
 * byte-identical (idempotent, content-addressed saves). The registry of
 * past boundaries is store-owned state, rebuilt from the store on
 * restore. */
export interface AuthoritySnapshotDocument<S = unknown> {
  readonly version: 1;
  readonly kind: "platform-multiplayer-authority-session";
  readonly sessionId: string;
  readonly tenant: string;
  readonly topology: MultiplayerTopology;
  readonly determinism: string;
  readonly phase: RuntimeSessionPhase;
  readonly epoch: number;
  readonly tick: number;
  readonly committedEventSeq: number;
  readonly admittedCommandSeq: number;
  readonly simulatorState: S;
  readonly eventLog: readonly RuntimeEventEnvelope[];
  readonly participants: readonly ParticipantSnapshotView[];
  readonly pending: readonly PendingCommandView[];
  readonly idempotency: Readonly<Record<string, { readonly fingerprint: string; readonly commandId: string }>>;
  readonly protectedGrants: Readonly<Record<string, readonly string[]>>;
  readonly refusals: readonly RefusalRecord[];
  readonly decidedOutcomeId: string | null;
}

/** Encode a document to its canonical bytes. */
export function encodeSnapshotDocument<S>(document: AuthoritySnapshotDocument<S>): string {
  return canonicalJson(document);
}

/** Decode result for stored document bytes. */
export type SnapshotDecodeResult<S = unknown> =
  | { readonly ok: true; readonly document: AuthoritySnapshotDocument<S> }
  | { readonly ok: false; readonly code: "corrupt-snapshot"; readonly detail: string };

/** Decode + structurally validate stored document bytes. */
export function decodeSnapshotDocument<S>(text: string): SnapshotDecodeResult<S> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, code: "corrupt-snapshot", detail: `document is not JSON: ${String(error)}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, code: "corrupt-snapshot", detail: "document is not an object" };
  }
  const document = parsed as Record<string, unknown>;
  if (document.version !== 1 || document.kind !== "platform-multiplayer-authority-session") {
    return { ok: false, code: "corrupt-snapshot", detail: "document version/kind mismatch" };
  }
  if (typeof document.sessionId !== "string" || typeof document.eventLog !== "object" || !Array.isArray(document.eventLog)) {
    return { ok: false, code: "corrupt-snapshot", detail: "document is missing required fields" };
  }
  return { ok: true, document: parsed as AuthoritySnapshotDocument<S> };
}

/** Content digest of a document's canonical bytes. */
export function documentStateDigest(documentText: string): Digest {
  return asDigest(sha256Hex(documentText));
}

/** Content-addressed snapshot id for a document (id === its digest). */
export function documentSnapshotId(documentText: string): SnapshotId {
  return asSnapshotId(sha256Hex(documentText));
}

/** Build the runtime-contracts snapshot boundary record for a document. */
export function boundaryRecord(
  sessionId: SessionId,
  document: AuthoritySnapshotDocument,
  stateDigest: string,
): SessionSnapshot {
  return {
    snapshotId: asSnapshotId(stateDigest),
    sessionId,
    epoch: document.epoch as SessionSnapshot["epoch"],
    tick: document.tick as Tick,
    afterEventSeq: document.committedEventSeq as SessionSnapshot["afterEventSeq"],
    stateDigest: asDigest(stateDigest),
  };
}

/** Roster view helper: subjects of a document's participants. */
export function documentSubjects(document: AuthoritySnapshotDocument): readonly SubjectId[] {
  return document.participants.map((participant) => participant.subject as SubjectId);
}
