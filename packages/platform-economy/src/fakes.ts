/**
 * DETERMINISTIC IN-MEMORY FAKES for the economy ports.
 *
 * Everything here is deterministic and pure-in-memory: no IO, no timers,
 * no randomness. TEST/HARNESS doubles — real persistence, clock, grant
 * directory, integrity (PL-018 adapter) and value-resolution (CAS
 * reader) adapters are host concerns. The fake game vocabulary is one
 * coherent example of a game-declared reward policy set (lock 18).
 */

import type { ContentDigest, TimestampMs } from "@playliquid/platform-contracts";
import { asTimestampMs } from "@playliquid/platform-contracts";
import type {
  EconomyValueRef,
  ScopedCapabilityGrant,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import type {
  EconomyStore,
  EconomyValueResolver,
  GrantDirectory,
  StoredEconomySnapshot,
} from "./ports.ts";
import type { RewardIntegrityPort, RewardIntegrityReading } from "./integrity-port.ts";

// ---------------------------------------------------------------------------
// Fake game vocabulary
// ---------------------------------------------------------------------------

/** The fake game's declared event kinds. */
export const FAKE_ECONOMY_EVENT_KINDS = {
  matchWon: "match.won",
  questCompleted: "quest.completed",
} as const;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * A Map-backed {@link EconomyStore}. Saves are content-addressed and
 * idempotent; a DIFFERENT document under the same snapshotId throws
 * (E10: an identity can only ever address the same bytes).
 */
export function createMemoryEconomyStore(): {
  readonly store: EconomyStore;
  readonly records: () => readonly StoredEconomySnapshot[];
} {
  const byId = new Map<string, StoredEconomySnapshot>();
  const order: StoredEconomySnapshot[] = [];
  return {
    store: {
      save: (snapshot) => {
        const id = String(snapshot.snapshotId);
        const existing = byId.get(id);
        if (existing !== undefined) {
          if (existing.document !== snapshot.document) {
            throw new RangeError(`economy-store: refusing rewrite of immutable snapshot ${id}`);
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

/** Grants a subject full economy permissions within one tenant. */
export function economyAdminGrant(tenant: TenantId, subject: SubjectId): ScopedCapabilityGrant {
  return { tenant, subject, capability: "rewards", permissions: ["read", "submit", "administer"] };
}

/** Grants a subject read+submit economy permissions within one tenant. */
export function economySubmitGrant(tenant: TenantId, subject: SubjectId): ScopedCapabilityGrant {
  return { tenant, subject, capability: "rewards", permissions: ["read", "submit"] };
}

// ---------------------------------------------------------------------------
// Integrity seam (PL-018 not yet wired)
// ---------------------------------------------------------------------------

/** An integrity port that always answers with one fixed reading. */
export function createStaticRewardIntegrityPort(
  confidence: number,
  evidenceDigest?: string,
): RewardIntegrityPort {
  const reading: RewardIntegrityReading = {
    confidence,
    ...(evidenceDigest === undefined ? {} : { evidenceDigest: evidenceDigest as ContentDigest }),
  };
  return { confidenceFor: () => reading };
}

/** An unwired integrity port: no evidence ever exists (truthful default). */
export function createUnwiredRewardIntegrityPort(): RewardIntegrityPort {
  return { confidenceFor: () => undefined };
}

// ---------------------------------------------------------------------------
// Value resolution seam (magnitude from CAS, faked)
// ---------------------------------------------------------------------------

/** A value resolver that answers one fixed quantity for every value. */
export function createStaticValueResolver(quantity: number): EconomyValueResolver {
  return { quantityOf: () => quantity };
}

/** A value resolver keyed by payload digest, defaulting to `fallback`. */
export function createMappingValueResolver(
  quantitiesByPayloadDigest: Readonly<Record<string, number>>,
  fallback?: number,
): EconomyValueResolver {
  return {
    quantityOf: (value: EconomyValueRef) => quantitiesByPayloadDigest[String(value.payloadDigest)] ?? fallback,
  };
}

/** A value resolver that never resolves anything. */
export function createUnresolvingValueResolver(): EconomyValueResolver {
  return { quantityOf: () => undefined };
}
