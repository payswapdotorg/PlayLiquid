/**
 * DETERMINISTIC IN-MEMORY FAKES for the leaderboard ports.
 *
 * Everything here is deterministic and pure-in-memory: no IO, no timers,
 * no randomness. TEST/HARNESS doubles — real persistence, clock and
 * grant directory adapters are app concerns.
 */

import type { ContentDigest, TimestampMs } from "@playliquid/platform-contracts";
import { asTimestampMs } from "@playliquid/platform-contracts";
import type { ScopedCapabilityGrant, SubjectId, TenantId } from "@playliquid/platform-contracts";
import type {
  GrantDirectory,
  LeaderboardStore,
  StoredLeaderboardSnapshot,
} from "./ports.ts";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * A Map-backed {@link LeaderboardStore}. Saves are content-addressed
 * and idempotent; a DIFFERENT document under the same snapshotId throws
 * (E10: an identity can only ever address the same bytes).
 */
export function createMemoryLeaderboardStore(): {
  readonly store: LeaderboardStore;
  readonly records: () => readonly StoredLeaderboardSnapshot[];
} {
  const byId = new Map<string, StoredLeaderboardSnapshot>();
  const order: StoredLeaderboardSnapshot[] = [];
  return {
    store: {
      save: (snapshot) => {
        const id = String(snapshot.snapshotId);
        const existing = byId.get(id);
        if (existing !== undefined) {
          if (existing.document !== snapshot.document) {
            throw new RangeError(`leaderboard-store: refusing rewrite of immutable snapshot ${id}`);
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

// ---------------------------------------------------------------------------
// Grant directory (least-privilege seam)
// ---------------------------------------------------------------------------

/** A mutable in-memory grant directory (R20 enforcement input). */
export function createMemoryGrantDirectory(): {
  readonly grantsDirectory: GrantDirectory;
  readonly grant: (grant: ScopedCapabilityGrant) => void;
  readonly revokeAll: () => void;
} {
  let grants: readonly ScopedCapabilityGrant[] = [];
  return {
    grantsDirectory: { grants: () => [...grants] },
    grant: (grant) => {
      grants = [...grants, grant];
    },
    revokeAll: () => {
      grants = [];
    },
  };
}

/** Grants a subject full leaderboard permissions within one tenant. */
export function leaderboardAdminGrant(tenant: TenantId, subject: SubjectId): ScopedCapabilityGrant {
  return { tenant, subject, capability: "leaderboard", permissions: ["read", "submit", "administer"] };
}

/** Grants a subject read+submit leaderboard permissions within one tenant. */
export function leaderboardSubmitGrant(tenant: TenantId, subject: SubjectId): ScopedCapabilityGrant {
  return { tenant, subject, capability: "leaderboard", permissions: ["read", "submit"] };
}
