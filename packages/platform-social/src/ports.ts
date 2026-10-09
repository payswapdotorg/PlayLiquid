/**
 * PORTS — every place an effect would otherwise live behind the social
 * service's back is a pure interface here, injected by the app and
 * faked in tests (platform-multiplayer precedent).
 *
 * Port list (work-order scope):
 * - {@link SocialStore} — snapshot persistence (content-addressed,
 *   idempotent saves; immutable snapshots, E10).
 * - {@link ServiceClock} — the ONLY time source.
 * - {@link SubjectDirectory} — the identity read-model seam: does a
 *   subject exist within a tenant, and which tenant owns a subject
 *   (cross-tenant detection, R20). The app wires the PL-015 identity
 *   service here; the domain never queries identity directly.
 * - {@link GrantDirectory} — the least-privilege seam (R20): the
 *   current scoped capability grants. Administration of grants is a
 *   platform tenancy composition concern; this package only ENFORCES
 *   them via platform-contracts' `checkLeastPrivilege`.
 *
 * Purity: interfaces + structural data only. No IO anywhere.
 */

import type {
  ContentDigest,
  ScopedCapabilityGrant,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Snapshot documents
// ---------------------------------------------------------------------------

/** One serialized relation edge row. */
export interface SocialEdgeRow {
  readonly tenant: string;
  readonly actor: string;
  readonly target: string;
  readonly relation: "follow" | "block";
  readonly since: TimestampMs;
  readonly evidence: string;
}

/** The full serializable state of the social service at one revision. */
export interface SocialStateDocument {
  readonly revision: number;
  readonly edges: readonly SocialEdgeRow[];
  readonly changes: readonly unknown[];
  readonly evidenceRegistry: readonly { readonly digest: string; readonly recordId: string }[];
}

/** A stored snapshot: the document plus its canonical encoding. */
export interface StoredSocialSnapshot {
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: string;
}

/** Returns true when `value` is a structurally valid {@link SocialStateDocument}. */
export function isSocialStateDocument(value: unknown): value is SocialStateDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.revision === "number" &&
    Array.isArray(document.edges) &&
    Array.isArray(document.changes) &&
    Array.isArray(document.evidenceRegistry)
  );
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * Snapshot persistence port. Save is idempotent: same snapshotId with
 * the same bytes is a no-op; a DIFFERENT document under the same id
 * must throw (content-addressed integrity, E10).
 */
export interface SocialStore {
  readonly save: (snapshot: StoredSocialSnapshot) => void;
  readonly list: () => readonly StoredSocialSnapshot[];
  readonly load: (snapshotId: ContentDigest) => StoredSocialSnapshot | undefined;
}

/** The only time source the service will ever consult. */
export interface ServiceClock {
  readonly now: () => TimestampMs;
}

/** The identity read-model seam (R20: tenant-scoped subject facts). */
export interface SubjectDirectory {
  readonly exists: (tenant: TenantId, subject: SubjectId) => boolean;
  /** Owning tenant of a subject, when known (cross-tenant detection). */
  readonly tenantOf: (subject: SubjectId) => TenantId | undefined;
}

/** The least-privilege seam (R20): current scoped capability grants. */
export interface GrantDirectory {
  readonly grants: () => readonly ScopedCapabilityGrant[];
}
