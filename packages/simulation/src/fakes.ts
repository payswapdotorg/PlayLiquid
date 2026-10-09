/**
 * IN-MEMORY FAKES for the simulation ports (the sanctioned non-pure edge —
 * all state is process-local memory, no IO, no timers, no network).
 *
 * - {@link FixedClock}: a caller-programmed timestamp cursor;
 * - {@link InMemorySnapshotStore}: a Map-backed snapshot table;
 * - {@link makePendingCommandQueue}: the deterministic logical-time
 *   scheduler implementation.
 *
 * Every fake is deterministic: same inputs, same observable behavior.
 */

import type { SessionId, Tick, Timestamp } from "@playliquid/runtime-contracts";
import { asTimestamp } from "@playliquid/runtime-contracts";
import type { PendingCommand, PendingCommandQueue, SimulationSnapshot, SnapshotStore } from "./ports.ts";

/**
 * A clock whose readings are fully caller-programmed. Readings are consumed
 * in order; when the program is exhausted the last reading repeats. This is
 * the fake that makes "no wall-clock authority" testable: the session under
 * test cannot observe real time even by accident.
 */
export class FixedClock {
  private cursor: number;

  constructor(readings: readonly number[] = []) {
    this.cursor = 0;
    this.readings = readings.map((ms) => asTimestamp(ms));
  }

  private readonly readings: readonly Timestamp[];

  now(): Timestamp {
    const reading = this.readings[this.cursor];
    if (reading === undefined) {
      const last = this.readings[this.readings.length - 1];
      return last ?? asTimestamp(0);
    }
    this.cursor += 1;
    return reading;
  }
}

/** A Map-backed {@link SnapshotStore}. */
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly table = new Map<string, SimulationSnapshot>();

  put(snapshot: SimulationSnapshot): void {
    if (this.table.has(snapshot.snapshotId)) {
      // Content-addressed: the same id must carry the same bytes.
      const existing = this.table.get(snapshot.snapshotId);
      if (existing !== undefined && existing.form !== snapshot.form) {
        throw new RangeError(`snapshot id collision for ${snapshot.snapshotId}`);
      }
    }
    this.table.set(snapshot.snapshotId, snapshot);
  }

  get(snapshotId: string): SimulationSnapshot | undefined {
    return this.table.get(snapshotId);
  }

  list(sessionId: SessionId): readonly SimulationSnapshot[] {
    return [...this.table.values()]
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((a, b) => a.afterEventSeq - b.afterEventSeq);
  }

  get size(): number {
    return this.table.size;
  }
}

/**
 * Creates the deterministic pending-command queue: a priority structure
 * ordered by (dueTick, assignedSeq). `dueThrough` REMOVES and returns
 * everything due at or before the given tick — the scheduler contract the
 * kernel step relies on.
 */
export function makePendingCommandQueue(): PendingCommandQueue {
  const pending: PendingCommand[] = [];
  return {
    schedule(command: PendingCommand): void {
      pending.push(command);
      pending.sort((a, b) => a.dueTick - b.dueTick || a.assignedSeq - b.assignedSeq);
    },
    dueThrough(tick: Tick): readonly PendingCommand[] {
      const due: PendingCommand[] = [];
      while (pending.length > 0 && pending[0] !== undefined && pending[0].dueTick <= tick) {
        const head = pending.shift();
        if (head !== undefined) due.push(head);
      }
      return due;
    },
    hasDueThrough(tick: Tick): boolean {
      const head = pending[0];
      return head !== undefined && head.dueTick <= tick;
    },
    snapshotPending(): readonly PendingCommand[] {
      return pending.slice();
    },
    get size(): number {
      return pending.length;
    },
  };
}
