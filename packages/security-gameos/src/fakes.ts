/**
 * DETERMINISTIC IN-MEMORY FAKES (PL-041) — TEST/HARNESS doubles for the
 * authority's own ports, plus thin READ-ONLY adapters over the REAL
 * sibling services (the economy, integrity and arena seams).
 *
 * Everything is deterministic (E9): the store is content-addressed and
 * REFUSES conflicting rewrites of the same snapshot id (E10), the clock
 * is fixed and manually advanced, the admin directory is additive and
 * revocable, and every adapter forwards to the real service doors
 * without ever mutating sibling state beyond what those doors own.
 *
 * Real persistence, time, role directories, brokers, registries, CAS
 * stores, economies, integrity services and arena runtimes are host
 * concerns; the composed rig lives in rig.ts.
 */

import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import type { SettlementEligibilityDeclaration } from "@playliquid/platform-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { EntitlementGrantId } from "@playliquid/platform-contracts";
import type { EntitlementView, EconomyService } from "@playliquid/platform-economy";
import type { IntegrityService } from "@playliquid/platform-integrity";
import type { ArenaRuntimeService } from "@playliquid/arena-integration-runtime";
import type { CapabilityBroker } from "@playliquid/capability-broker";
import type {
  BrokerSnapshotPort,
  EconomyReadPort,
  EscalationCasesPort,
  IntegrityStandingPort,
  PlatformGrantDirectory,
  RightsAdminDirectory,
  RightsStorePort,
  StoredRightsSnapshot,
} from "./ports.ts";
import { documentDigestOf } from "./document.ts";
import type { RightsAuthorityGrant } from "./vocabulary.ts";

// ---------------------------------------------------------------------------
// Core ports: store, clock, admin directory
// ---------------------------------------------------------------------------

/** In-memory content-addressed snapshot store (E10: immutable saves). */
export function createMemoryRightsStore(): {
  readonly store: RightsStorePort;
  readonly records: () => readonly StoredRightsSnapshot[];
} {
  const saved = new Map<string, StoredRightsSnapshot>();
  return {
    store: {
      save(snapshot: StoredRightsSnapshot): void {
        const existing = saved.get(snapshot.snapshotId);
        if (
          existing !== undefined &&
          documentDigestOf(existing.document) !== documentDigestOf(snapshot.document)
        ) {
          throw new RangeError(`rights-store: refusing rewrite of immutable snapshot ${snapshot.snapshotId}`);
        }
        saved.set(snapshot.snapshotId, snapshot);
      },
      list(): readonly StoredRightsSnapshot[] {
        return [...saved.values()].sort((a, b) => a.revision - b.revision);
      },
      load(snapshotId: string): StoredRightsSnapshot | undefined {
        return saved.get(snapshotId);
      },
    },
    records: () => [...saved.values()].sort((a, b) => a.revision - b.revision),
  };
}

/** Fixed manually-advanced clock (the only time the authority ever sees). */
export function createFixedRightsClock(startMs = 1_000): {
  readonly clock: { readonly now: () => number };
  readonly advance: (ms: number) => void;
  readonly now: () => number;
} {
  let current = startMs;
  return {
    clock: { now: () => current },
    advance: (ms: number): void => {
      current += ms;
    },
    now: () => current,
  };
}

/** In-memory additive/revocable role directory (the authority's own seam). */
export function createMemoryAdminDirectory(): {
  readonly admins: RightsAdminDirectory;
  readonly grant: (grant: RightsAuthorityGrant) => void;
  readonly revokeAll: () => void;
} {
  let grants: RightsAuthorityGrant[] = [];
  return {
    admins: { grants: () => [...grants] },
    grant: (grant: RightsAuthorityGrant): void => {
      grants = [...grants, grant];
    },
    revokeAll: (): void => {
      grants = [];
    },
  };
}

/** Grants a subject the rights-admin role within one tenant. */
export function rightsAdminGrant(tenant: string, subject: string): RightsAuthorityGrant {
  return { tenant, subject, role: "rights-admin" };
}

/** Grants a subject the rights-auditor role within one tenant. */
export function rightsAuditorGrant(tenant: string, subject: string): RightsAuthorityGrant {
  return { tenant, subject, role: "rights-auditor" };
}

/** A mutable in-memory platform grant directory (R20 enforcement input). */
export function createMemoryPlatformGrants(): {
  readonly directory: PlatformGrantDirectory;
  readonly grant: (grant: ScopedCapabilityGrant) => void;
  readonly revokeAll: () => void;
} {
  let grants: ScopedCapabilityGrant[] = [];
  return {
    directory: { grants: () => [...grants] },
    grant: (grant: ScopedCapabilityGrant): void => {
      grants = [...grants, grant];
    },
    revokeAll: (): void => {
      grants = [];
    },
  };
}

// ---------------------------------------------------------------------------
// Read-only adapters over the REAL sibling services
// ---------------------------------------------------------------------------

/** Adapts a live {@link CapabilityBroker} into the read-only snapshot port. */
export function brokerSnapshotOf(broker: CapabilityBroker): BrokerSnapshotPort {
  return {
    snapshot: () => ({
      grants: broker.grants,
      policy: broker.policy,
      ledger: broker.ledger,
    }),
  };
}

/**
 * Adapts a REAL {@link EconomyService} into the read-only economy seam.
 * The declarations accessor is host-side knowledge: the host composed the
 * game's policy registrations, and the port surfaces them (the economy
 * service exposes no policy-listing door — its settlement oracle reads
 * them at settle time).
 */
export function createEconomyReadPort(deps: {
  readonly service: EconomyService;
  /** The reader subject (needs platform `rewards` read grants per tenant). */
  readonly reader: string;
  /** The game's admitted declarations per tenant (the host's mirror). */
  readonly declarations: (tenant: string) => readonly SettlementEligibilityDeclaration[];
}): EconomyReadPort {
  return {
    declarationsOf: (tenant: string) => deps.declarations(tenant),
    entitlementIn: (tenant: string, entitlement: EntitlementGrantId): EntitlementView | undefined => {
      const view = deps.service.entitlementView(
        asSubjectId(deps.reader)!,
        asTenantId(tenant)!,
        entitlement,
      );
      // the economy door refuses as `EconomyRefusal` (`ok: false`); only a
      // recorded entitlement surfaces as a view (cross-tenant reads are
      // invisible, R20).
      return "ok" in view ? undefined : view;
    },
  };
}

/** Adapts a REAL {@link IntegrityService} into the read-only standing seam. */
export function createIntegrityStandingPort(deps: {
  readonly service: IntegrityService;
  /** The reader subject (needs platform `integrity` read grants per tenant). */
  readonly reader: string;
}): IntegrityStandingPort {
  return {
    standingFor: (tenant: string, subject: string) => {
      const standing = deps.service.standingFor(asSubjectId(deps.reader)!, asTenantId(tenant)!, asSubjectId(subject)!);
      return standing.ok
        ? { ok: true, verdict: standing.verdict }
        : { ok: false, code: "no-recorded-verdict" };
    },
  };
}

/** Adapts a REAL {@link ArenaRuntimeService} into the ingestion-only case seam. */
export function createEscalationCasesPort(deps: {
  readonly service: ArenaRuntimeService;
  /** The reader subject (any subject of the reading tenant). */
  readonly reader: string;
}): EscalationCasesPort {
  return {
    caseOf: (tenant: string, caseId: string) => {
      const read = deps.service.getCase(
        { tenant: asTenantId(tenant)!, subject: asSubjectId(deps.reader)! },
        caseId,
      );
      if (!read.ok) {
        return { ok: false, code: read.code === "tampered-case" ? "unknown-case" : read.code };
      }
      return {
        ok: true,
        record: {
          caseId: String(read.case.caseId),
          tenant: String(read.case.tenant),
          decidedBy: String(read.case.decidedBy),
          state: read.case.lifecycle.state,
          caseDigest: String(read.case.caseDigest),
        },
      };
    },
  };
}
