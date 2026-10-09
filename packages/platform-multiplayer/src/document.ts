/**
 * SNAPSHOT DOCUMENT BUILD/ADOPT — the pure translation layer between the
 * kernel's live session state (kernel-types.ts) and the byte-stable
 * {@link AuthoritySnapshotDocument} (snapshot.ts).
 *
 * Split out of kernel.ts for the repository's 400-line ceiling. The
 * kernel remains the state owner: these functions take the state as an
 * explicit parameter and either read it (build) or repopulate it
 * (adopt). The snapshot-boundary registry is store-owned state and is
 * rebuilt from the store after adoption.
 */

import type {
  DeterminismSeed,
  SessionId,
  SnapshotId,
} from "@playliquid/runtime-contracts";
import { asActorId, asSessionEpoch, asSnapshotId, asTick } from "@playliquid/runtime-contracts";
import type { SubjectId, ProtectedOutcomeKind, TenantId } from "@playliquid/platform-contracts";
import type { AuthoritySnapshotDocument } from "./snapshot.ts";
import { documentStateDigest } from "./snapshot.ts";
import type {
  AuthoritySessionState,
  PendingCommand,
} from "./kernel-types.ts";
import type { StoredSnapshotRecord } from "./ports.ts";
import type { MultiplayerTopology } from "./topology.ts";

/** Session identity metadata embedded in every document. */
export interface DocumentMeta {
  readonly sessionId: SessionId;
  readonly tenant: TenantId;
  readonly topology: MultiplayerTopology;
  readonly determinism: DeterminismSeed;
}

/** Build the byte-stable document from live state. Pure read. */
export function buildSessionDocument<S>(
  state: AuthoritySessionState<S>,
  meta: DocumentMeta,
): AuthoritySnapshotDocument<S> {
  const idempotency: Record<string, { fingerprint: string; commandId: string }> = {};
  for (const [key, value] of [...state.idempotency.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    idempotency[key] = value;
  }
  const protectedGrants: Record<string, readonly string[]> = {};
  for (const [actorId, kinds] of [...state.protectedGrants.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    protectedGrants[actorId] = [...kinds].sort();
  }
  return {
    version: 1,
    kind: "platform-multiplayer-authority-session",
    sessionId: String(meta.sessionId),
    tenant: String(meta.tenant),
    topology: meta.topology,
    determinism: String(meta.determinism),
    phase: state.phase,
    epoch: state.epoch,
    tick: state.tick,
    committedEventSeq: state.events.length,
    admittedCommandSeq: state.admittedCommandSeq,
    simulatorState: state.simulatorState as S,
    eventLog: [...state.events],
    participants: state.participants.map((participant) => ({
      subject: String(participant.subject),
      actorClass: participant.actor.actorClass,
      actorId: String(participant.actor.actorId),
      joinedAtTick: participant.joinedAtTick,
    })),
    pending: state.pending.map(pendingView),
    idempotency,
    protectedGrants,
    refusals: [...state.refusals],
    decidedOutcomeId: state.decidedOutcomeId === null ? null : String(state.decidedOutcomeId),
  };
}

function pendingView(entry: PendingCommand) {
  return {
    commandId: String(entry.envelope.commandId),
    kind: String(entry.envelope.kind),
    epoch: entry.envelope.epoch,
    actorClass: entry.envelope.actor.actorClass,
    actorId: String(entry.envelope.actor.actorId),
    origin: entry.envelope.origin.kind,
    idempotencyKey: {
      scope: entry.envelope.idempotencyKey.scope,
      actor: String(entry.envelope.idempotencyKey.actor),
      nonce: String(entry.envelope.idempotencyKey.nonce),
    },
    issuedAt: entry.envelope.issuedAt,
    payload: entry.envelope.payload,
    intentId: String(entry.intent.intentId),
    intentKind: String(entry.intent.kind),
    assignedSeq: entry.assignedSeq,
  };
}

/**
 * Adopt a decoded document into live state (restore path). Repopulates
 * every state field; the caller afterwards advances the epoch and
 * rebuilds the snapshot registry from the store.
 */
export function adoptSessionDocument<S>(
  state: AuthoritySessionState<S>,
  document: AuthoritySnapshotDocument<S>,
): void {
  state.phase = document.phase;
  state.epoch = asSessionEpoch(document.epoch);
  state.tick = asTick(document.tick);
  state.simulatorState = document.simulatorState;
  state.events.length = 0;
  for (const event of document.eventLog) state.events.push(event);
  state.participants.length = 0;
  for (const participant of document.participants) {
    state.participants.push({
      subject: participant.subject as SubjectId,
      actor: {
        actorClass: participant.actorClass as "player" | "avatar-agent" | "platform-system" | "host-authority",
        actorId: asActorId(participant.actorId),
      },
      joinedAtTick: asTick(participant.joinedAtTick),
    });
  }
  state.pending.length = 0;
  state.idempotency.clear();
  for (const [key, value] of Object.entries(document.idempotency)) {
    state.idempotency.set(key, value);
  }
  state.protectedGrants.clear();
  for (const [actorId, kinds] of Object.entries(document.protectedGrants)) {
    state.protectedGrants.set(actorId, new Set(kinds as readonly ProtectedOutcomeKind[]));
  }
  state.refusals.length = 0;
  for (const refusal of document.refusals) state.refusals.push(refusal);
  state.decidedOutcomeId =
    document.decidedOutcomeId === null ? null : (document.decidedOutcomeId as never);
  state.admittedCommandSeq = document.admittedCommandSeq;
  state.perTickIntentCounts.clear();
}

/**
 * Rebuild the snapshot-boundary registry from stored records (the
 * registry is store-owned, not document-owned — see snapshot.ts).
 */
export function rebuildSnapshotRegistry(
  state: AuthoritySessionState,
  records: readonly StoredSnapshotRecord[],
): void {
  state.snapshots.length = 0;
  for (const record of records) {
    state.snapshots.push(record.snapshot);
  }
}

/** Content-addressed snapshot id of a document's canonical bytes. */
export function snapshotIdOfDocument(documentBytes: string): SnapshotId {
  return asSnapshotId(String(documentStateDigest(documentBytes)));
}
