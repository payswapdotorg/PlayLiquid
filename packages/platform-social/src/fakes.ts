/**
 * DETERMINISTIC IN-MEMORY FAKES for the social ports.
 *
 * Everything here is deterministic and pure-in-memory: no IO, no timers,
 * no randomness. TEST/HARNESS doubles — real persistence, clock, subject
 * directory (identity read model) and grant directory adapters are app
 * concerns. The fake game vocabulary is one coherent example of a
 * game-declared social event binding (lock 18).
 */

import type { ContentDigest, SubjectId, TenantId, TimestampMs } from "@playliquid/platform-contracts";
import { asTimestampMs } from "@playliquid/platform-contracts";
import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import type { GrantDirectory, SocialStore, StoredSocialSnapshot, SubjectDirectory } from "./ports.ts";

// ---------------------------------------------------------------------------
// Fake game vocabulary (event kinds + binding)
// ---------------------------------------------------------------------------

/** The fake game's declared social event kinds. */
export const FAKE_SOCIAL_EVENT_KINDS = {
  follow: "social.follow.requested",
  unfollow: "social.follow.dropped",
  block: "social.member.blocked",
  unblock: "social.member.unblocked",
} as const;

/** A binding for one fake event kind (platform-contracts shape). */
export function fakeBinding(kind: string): { capability: "social"; eventKind: never; graph: "friends" } {
  return { capability: "social", eventKind: kind as never, graph: "friends" };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * A Map-backed {@link SocialStore}. Saves are content-addressed and
 * idempotent; a DIFFERENT document under the same snapshotId throws
 * (E10: an identity can only ever address the same bytes).
 */
export function createMemorySocialStore(): {
  readonly store: SocialStore;
  readonly records: () => readonly StoredSocialSnapshot[];
} {
  const byId = new Map<string, StoredSocialSnapshot>();
  const order: StoredSocialSnapshot[] = [];
  return {
    store: {
      save: (snapshot) => {
        const id = String(snapshot.snapshotId);
        const existing = byId.get(id);
        if (existing !== undefined) {
          if (existing.document !== snapshot.document) {
            throw new RangeError(`social-store: refusing rewrite of immutable snapshot ${id}`);
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
// Subject directory (identity read-model seam)
// ---------------------------------------------------------------------------

/** An in-memory subject directory: (tenant, subject) membership + ownership. */
export function createMemorySubjectDirectory(): {
  readonly directory: SubjectDirectory;
  readonly register: (tenant: TenantId, subject: SubjectId) => void;
} {
  const members = new Set<string>();
  const owners = new Map<string, TenantId>();
  return {
    directory: {
      exists: (tenant, subject) => members.has(`${String(tenant)}|${String(subject)}`),
      tenantOf: (subject) => owners.get(String(subject)),
    },
    register: (tenant, subject) => {
      members.add(`${String(tenant)}|${String(subject)}`);
      owners.set(String(subject), tenant);
    },
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

/** Grants a subject read+submit on the social capability within one tenant. */
export function socialGrant(tenant: TenantId, subject: SubjectId): ScopedCapabilityGrant {
  return { tenant, subject, capability: "social", permissions: ["read", "submit"] };
}
