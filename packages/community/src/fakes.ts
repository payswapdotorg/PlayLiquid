/**
 * DETERMINISTIC IN-MEMORY FAKES for the community ports.
 *
 * Everything here is deterministic and pure-in-memory: no IO, no timers,
 * no randomness. TEST/HARNESS doubles — real persistence, clock,
 * identity/tenancy composition, Lab gap facts and package-registry
 * qualification adapters are app concerns.
 *
 * The fake subject/gap/registry directories model the SEAMS, never the
 * authoritative services themselves (the identity service is PL-015's,
 * the Lab is lab-contracts', the registry is PL-011's).
 */

import { computeDigest } from "@playliquid/package-system";
import type { PackageCoordinate } from "@playliquid/package-system";
import { makeLineageNode } from "@playliquid/git-lineage";
import type { LineageNode } from "@playliquid/git-lineage";
import { asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";
import type { SubjectId, TenantId, TimestampMs } from "@playliquid/platform-contracts";
import type { GameIRValue } from "@playliquid/game-ir";
import type { GapSeamFacts } from "./admission.ts";
import type { CommunityStore, GapDirectory, PackageQualification, PackageRegistrySeam, ServiceClock, StoredCommunitySnapshot, SubjectDirectory } from "./ports.ts";
import type { CapabilityGapLink } from "./records.ts";
import { asGapId, asCycleId } from "./records.ts";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * A Map-backed {@link CommunityStore}. Saves are content-addressed and
 * idempotent; a DIFFERENT document under the same snapshotId throws
 * (E10: an id can only ever address the same bytes).
 */
export function createMemoryCommunityStore(): {
  readonly store: CommunityStore;
  readonly records: () => readonly StoredCommunitySnapshot[];
} {
  const byId = new Map<string, StoredCommunitySnapshot>();
  const order: StoredCommunitySnapshot[] = [];
  return {
    store: {
      save: (snapshot) => {
        const id = String(snapshot.snapshotId);
        const existing = byId.get(id);
        if (existing !== undefined) {
          if (existing.document !== snapshot.document) {
            throw new RangeError(`community-store: refusing rewrite of immutable snapshot ${id}`);
          }
          return;
        }
        byId.set(id, snapshot);
        order.push(snapshot);
      },
      list: () => [...order],
      load: (snapshotId) => byId.get(String(snapshotId)),
    },
    records: () => [...order],
  };
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** A caller-advanced clock — the service never advances time itself. */
export function createFixedClock(startMs = 1_000): {
  readonly clock: ServiceClock;
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
// Subject directory (identity read-model seam + maintainer facts)
// ---------------------------------------------------------------------------

/** An in-memory subject directory: membership, ownership, maintainer role. */
export function createMemorySubjectDirectory(): {
  readonly directory: SubjectDirectory;
  readonly register: (tenant: TenantId, subject: SubjectId) => void;
  readonly registerMaintainer: (tenant: TenantId, subject: SubjectId) => void;
} {
  const members = new Set<string>();
  const owners = new Map<string, TenantId>();
  const maintainers = new Set<string>();
  return {
    directory: {
      exists: (tenant, subject) => members.has(`${String(tenant)}|${String(subject)}`),
      tenantOf: (subject) => owners.get(String(subject)),
      isMaintainer: (tenant, subject) => maintainers.has(`${String(tenant)}|${String(subject)}`),
    },
    register: (tenant, subject) => {
      members.add(`${String(tenant)}|${String(subject)}`);
      owners.set(String(subject), tenant);
    },
    registerMaintainer: (tenant, subject) => {
      // A maintainer is a registered subject of the tenant that also
      // carries the moderation role.
      members.add(`${String(tenant)}|${String(subject)}`);
      owners.set(String(subject), tenant);
      maintainers.add(`${String(tenant)}|${String(subject)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Gap directory (Lab seam; read-only facts)
// ---------------------------------------------------------------------------

/** A mutable in-memory gap facts table (the Lab adapter in tests). */
export function createMemoryGapDirectory(): {
  readonly gaps: GapDirectory;
  readonly declare: (gapId: string, cycleId: string, facts: Partial<GapSeamFacts>) => void;
  readonly reads: () => number;
} {
  const table = new Map<string, GapSeamFacts>();
  let readCount = 0;
  return {
    gaps: {
      factsOf: (link: CapabilityGapLink) => {
        readCount += 1;
        return (
          table.get(String(link.gapId)) ?? {
            exists: false,
            resolved: false,
            blocked: false,
            communityRungReached: false,
          }
        );
      },
    },
    declare: (gapId, cycleId, facts) => {
      void cycleId;
      table.set(gapId, {
        exists: true,
        resolved: facts.resolved ?? false,
        blocked: facts.blocked ?? false,
        communityRungReached: facts.communityRungReached ?? true,
      });
    },
    reads: () => readCount,
  };
}

// ---------------------------------------------------------------------------
// Package registry seam (E8 qualification facts)
// ---------------------------------------------------------------------------

/** An in-memory registry seam: which base coordinates qualify. */
export function createMemoryPackageRegistry(): {
  readonly registry: PackageRegistrySeam;
  readonly publish: (coordinate: PackageCoordinate, provenancePasses: boolean) => void;
} {
  const table = new Map<string, PackageQualification>();
  return {
    registry: {
      qualificationOf: (coordinate: unknown) =>
        table.get(String((coordinate as { contentDigest?: unknown } | undefined)?.contentDigest)) ?? {
          published: false,
          provenancePasses: false,
        },
    },
    publish: (coordinate, provenancePasses) => {
      table.set(String(coordinate.contentDigest), { published: true, provenancePasses });
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** A valid package coordinate for a fake base package. */
export function fakePackageCoordinate(name: string): PackageCoordinate {
  const contentDigest = computeDigest({ fixture: "community-fake-package", name });
  return {
    kind: "system",
    id: `fake-${name}`,
    version: { major: 1, minor: 0, patch: 0, prerelease: [], build: [] },
    contentDigest,
  };
}

/** A content-addressed lineage node over a fake coordinate. */
export function fakeLineageNode(name: string): LineageNode {
  return makeLineageNode(fakePackageCoordinate(name));
}

/** A typed gap link fixture. */
export function fakeGapLink(gapId: string, cycleId: string): CapabilityGapLink {
  return { gapId: asGapId(gapId)!, cycleId: asCycleId(cycleId)! };
}

/** Convenience id casts for fixture-heavy tests. */
export const ids = {
  tenant: (text: string) => asTenantId(text)!,
  subject: (text: string) => asSubjectId(text)!,
};

/** A deterministic game-ir record payload fixture. */
export function fakePayload(fields: Record<string, string | bigint | boolean>): GameIRValue {
  const encoded: Record<string, GameIRValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") encoded[key] = { kind: "string", value };
    else if (typeof value === "bigint") encoded[key] = { kind: "int", value };
    else encoded[key] = { kind: "bool", value };
  }
  return { kind: "record", fields: encoded };
}

/** A fixed timestamp helper for fixtures. */
export function at(ms: number): TimestampMs {
  return asTimestampMs(ms)!;
}
