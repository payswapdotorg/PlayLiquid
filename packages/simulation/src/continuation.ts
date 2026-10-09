/**
 * SNAPSHOT CONTINUATION MECHANICS (the boundary adoption engine).
 *
 * Sealing and adopting a snapshot boundary are pure (re)constructions over
 * the session's continuation state (snapshot.ts payload + seal) plus its
 * reference-type tables:
 *
 * - {@link sealSessionBoundary} builds the byte-stable, content-addressed
 *   artifact from the live session state;
 * - {@link adoptSessionBoundary} validates + decodes an artifact and
 *   rebuilds the event log boundary, the admitted-command table, the
 *   idempotency table and the pending queue, returning the primitive
 *   continuation fields (epoch/tick/rng/world/seed) for the session to
 *   adopt.
 *
 * The session remains the mutable state owner (E1); these functions are the
 * deterministic mechanics it calls. Restore-then-continue == never-interrupted
 * is the property the caller's tests assert (E9).
 */

import { asCommandId, asTick } from "@playliquid/runtime-contracts";
import type { CommandId, DeterminismSeed, SessionEpoch, SessionId, Tick } from "@playliquid/runtime-contracts";
import { restoreRng } from "./rng.ts";
import type { RngPort, PendingCommand, PendingCommandQueue, SimulationSnapshot } from "./ports.ts";
import { buildSnapshotPayload, decodeContinuation, sealSnapshot, validateSnapshotPayload } from "./snapshot.ts";
import type { IdempotencyRecord, PendingCommandRecord } from "./snapshot.ts";
import type { WorldState } from "./world.ts";
import { SessionEventLog } from "./log.ts";
import { decodePendingCommand, idempotencyKeyString } from "./admission.ts";

/** The reference-type session tables a boundary adoption rebuilds. */
export interface ContinuationTables {
  readonly log: SessionEventLog;
  readonly queue: PendingCommandQueue;
  readonly admittedCommandIds: Set<CommandId>;
  readonly idempotency: Map<string, IdempotencyRecord>;
}

/** Primitive continuation fields adopted from a snapshot boundary. */
export interface AdoptedFields {
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  readonly rng: RngPort;
  readonly world: WorldState;
  /** The caller-supplied seed (replay provenance), if any. */
  readonly seed: DeterminismSeed | undefined;
}

/** Live continuation state to seal into an artifact. */
export interface SealBoundaryInput {
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  readonly rng: RngPort;
  readonly world: WorldState;
  readonly committedSeq: number;
  readonly admittedCommandIds: readonly CommandId[];
  readonly idempotency: readonly IdempotencyRecord[];
  readonly pending: readonly PendingCommand[];
}

/** Builds and seals the byte-stable snapshot artifact from live state. */
export function sealSessionBoundary(input: SealBoundaryInput): SimulationSnapshot {
  return sealSnapshot(
    buildSnapshotPayload({
      sessionId: input.sessionId,
      epoch: input.epoch,
      tick: input.tick,
      afterEventSeq: input.committedSeq,
      admittedCommandSeq: input.admittedCommandIds.length,
      rngState: input.rng.state,
      world: input.world,
      pending: input.pending.map((entry) => ({
        envelope: entry.envelope,
        assignedSeq: entry.assignedSeq,
        dueTick: entry.dueTick,
      })),
      admittedCommandIds: input.admittedCommandIds,
      idempotency: input.idempotency,
    }),
  );
}

/**
 * Adopts a (pre-verified) snapshot boundary: rewinds the live event log to
 * the boundary, rebuilds the admitted-command and idempotency tables and
 * the pending queue, and returns the primitive continuation fields. Throws
 * on a malformed payload (fail closed).
 */
export function adoptSessionBoundary(
  artifact: SimulationSnapshot,
  seed: DeterminismSeed | undefined,
  tables: ContinuationTables,
): AdoptedFields {
  const validated = validateSnapshotPayload(artifact.payload);
  if (!validated.ok) {
    throw new Error(`snapshot payload malformed: ${validated.detail}`);
  }
  const payload = validated.payload;
  const { world } = decodeContinuation(payload);
  tables.log.rewindTo(payload.afterEventSeq);
  tables.admittedCommandIds.clear();
  for (const id of payload.admittedCommandIds) {
    tables.admittedCommandIds.add(asCommandId(id));
  }
  tables.idempotency.clear();
  for (const record of payload.idempotency) {
    tables.idempotency.set(idempotencyKeyString(record), record);
  }
  drainQueueForAdoption(tables.queue, payload.pending);
  return {
    epoch: payload.epoch as unknown as SessionEpoch,
    tick: asTick(payload.tick),
    rng: restoreRng(payload.rngState),
    world,
    seed,
  };
}

/**
 * Rebuilds the pending queue from snapshot records. On a live restore the
 * queue is first fully drained (it may hold commands admitted after the
 * snapshot boundary that the rewind discards).
 */
function drainQueueForAdoption(queue: PendingCommandQueue, records: readonly PendingCommandRecord[]): void {
  while (queue.size > 0) {
    queue.dueThrough(asTick(Number.MAX_SAFE_INTEGER));
  }
  for (const record of records) {
    const envelope = decodePendingCommand(record);
    queue.schedule({ envelope, assignedSeq: record.assignedSeq, dueTick: asTick(record.dueTick) });
  }
}
