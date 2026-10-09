/**
 * DETERMINISTIC IN-MEMORY FAKES for the identity ports.
 *
 * Everything here is deterministic and pure-in-memory: no IO, no timers,
 * no randomness. TEST/HARNESS doubles — real persistence and clock
 * adapters are app concerns (the platform-multiplayer precedent).
 */

import type { ContentDigest, TimestampMs } from "@playliquid/platform-contracts";
import { asTimestampMs } from "@playliquid/platform-contracts";
import type { IdentityStore, StoredIdentitySnapshot } from "./ports.ts";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * A Map-backed {@link IdentityStore}. Saves are content-addressed and
 * idempotent: the same snapshotId with the same bytes is a no-op; a
 * DIFFERENT document under the same snapshotId throws (E10: an identity
 * can only ever address the same bytes).
 */
export function createMemoryIdentityStore(): {
  readonly store: IdentityStore;
  readonly records: () => readonly StoredIdentitySnapshot[];
} {
  const byId = new Map<string, StoredIdentitySnapshot>();
  const order: StoredIdentitySnapshot[] = [];
  return {
    store: {
      save: (snapshot) => {
        const id = String(snapshot.snapshotId);
        const existing = byId.get(id);
        if (existing !== undefined) {
          if (existing.document !== snapshot.document) {
            throw new RangeError(`identity-store: refusing rewrite of immutable snapshot ${id}`);
          }
          return;
        }
        byId.set(id, snapshot);
        order.push(snapshot);
      },
      list: () => [...order],
      load: (snapshotId: ContentDigest) => byId.get(String(snapshotId)),
    },
    records: () => [...order],
  };
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** A caller-advanced clock — the service never advances time itself. */
export function createFixedClock(startMs = 1_000): {
  readonly clock: { now: () => TimestampMs };
  readonly advance: (ms: number) => void;
  readonly now: () => number;
} {
  let current = startMs;
  return {
    clock: { now: () => asTimestampMs(current)! },
    advance: (ms) => {
      current += ms;
    },
    now: () => current,
  };
}
