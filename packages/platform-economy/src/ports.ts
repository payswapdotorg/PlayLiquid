/**
 * PORTS — every place an effect would otherwise live behind the economy
 * service's back is a pure interface here, injected by the app and faked
 * in tests (platform-leaderboard / platform-multiplayer precedent).
 *
 * Port list (work-order scope):
 * - {@link EconomyStore} — snapshot persistence: the E6 durability seam.
 *   A REAL durable store is deliberately deferred (host-owned); this is
 *   the port contract the host wires. Saves are content-addressed and
 *   idempotent; snapshots are immutable (E10).
 * - {@link ServiceClock} — the ONLY time source.
 * - {@link GrantDirectory} — the least-privilege seam (R20): current
 *   scoped capability grants. Grant ADMINISTRATION is a platform tenancy
 *   composition concern; this package only ENFORCES grants via
 *   platform-contracts' `checkLeastPrivilege`.
 * - {@link EconomyValueResolver} — the magnitude seam (R10 / PL-009
 *   economy-values): contracts carry NO bare numbers; the platform
 *   settles on the DIGEST and the magnitude is this service's concern,
 *   read from content-addressed storage THROUGH this port.
 * - RewardIntegrityPort — the PL-018 competitive-integrity seam
 *   (integrity-port.ts; separate module so the seam stays discoverable).
 *
 * Purity: interfaces + structural data only. No IO anywhere.
 */

import type {
  ContentDigest,
  EconomyValueRef,
  ScopedCapabilityGrant,
  TimestampMs,
} from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Snapshot documents
// ---------------------------------------------------------------------------

/** The full serializable state of the economy service (document.ts owns conversions). */
export interface EconomyStateDocument {
  readonly revision: number;
  readonly tenants: readonly string[];
  readonly policies: readonly { readonly tenant: string; readonly declaration: unknown; readonly registeredAt: TimestampMs }[];
  readonly entitlements: readonly { readonly grant: unknown; readonly lifecycle: unknown; readonly provenance: unknown }[];
  readonly balances: readonly { readonly key: string; readonly balance: number }[];
  readonly journal: readonly unknown[];
  readonly settlements: readonly unknown[];
  readonly receipts: readonly { readonly key: string; readonly receipt: unknown }[];
}

/** A stored snapshot: the document plus its canonical encoding. */
export interface StoredEconomySnapshot {
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: string;
}

/** Returns true when `value` is a structurally valid {@link EconomyStateDocument}. */
export function isEconomyStateDocument(value: unknown): value is EconomyStateDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.revision === "number" &&
    Array.isArray(document.tenants) &&
    Array.isArray(document.policies) &&
    Array.isArray(document.entitlements) &&
    Array.isArray(document.balances) &&
    Array.isArray(document.journal) &&
    Array.isArray(document.settlements) &&
    Array.isArray(document.receipts)
  );
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * Snapshot persistence port (E6 durability seam — host-owned store
 * deliberately deferred; this is the port contract). Save is
 * idempotent: same snapshotId with the same bytes is a no-op; a
 * DIFFERENT document under the same id must throw (content-addressed
 * integrity, E10).
 */
export interface EconomyStore {
  readonly save: (snapshot: StoredEconomySnapshot) => void;
  readonly list: () => readonly StoredEconomySnapshot[];
  readonly load: (snapshotId: ContentDigest) => StoredEconomySnapshot | undefined;
}

/** The only time source the service will ever consult. */
export interface ServiceClock {
  readonly now: () => TimestampMs;
}

/** The least-privilege seam (R20): current scoped capability grants. */
export interface GrantDirectory {
  readonly grants: () => readonly ScopedCapabilityGrant[];
}

/**
 * The magnitude seam (R10 / economy-values zero-numeric-authority):
 * resolve one digest-pinned economy value carrier to its positive
 * integer magnitude, or `undefined` when the value is not resolvable.
 * The real adapter reads content-addressed storage (host concern);
 * tests wire deterministic fakes.
 */
export interface EconomyValueResolver {
  readonly quantityOf: (value: EconomyValueRef) => number | undefined;
}
