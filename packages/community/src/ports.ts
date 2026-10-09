/**
 * PORTS — every place an effect would otherwise live behind the community
 * service's back is a pure interface here, injected by the app and faked
 * in tests (platform-social precedent).
 *
 * Port list (work-order scope):
 * - {@link CommunityStore} — snapshot persistence (content-addressed,
 *   idempotent saves; immutable snapshots, E10).
 * - {@link ServiceClock} — the ONLY time source.
 * - {@link SubjectDirectory} — the identity read-model seam: contributor
 *   existence, subject tenant ownership (cross-tenant detection, R20) and
 *   maintainer facts. The app wires the PL-015 identity service / tenancy
 *   composition here; the domain never queries identity directly.
 * - {@link GapDirectory} — the Lab seam (R18): ladder facts for one typed
 *   gap link. READ-ONLY by construction: the Lab owns capability-gap
 *   state (E1); this service records links, never ladder mutations.
 * - {@link PackageRegistrySeam} — the package-registry read seam (E8):
 *   publication + provenance-pass facts for a cited lineage base. The
 *   app wires package-registry (PL-011) here; qualification evidence is
 *   referenced, never re-implemented.
 *
 * Purity: interfaces + structural data only. No IO anywhere.
 */

import type { ContentDigest } from "@playliquid/package-system";
import type { SubjectId, TenantId, TimestampMs } from "@playliquid/platform-contracts";
import type { ContributionRow, TransitionRow } from "./history.ts";
import type { CapabilityGapLink } from "./records.ts";
import type { GapSeamFacts } from "./admission.ts";

// ---------------------------------------------------------------------------
// Snapshot documents
// ---------------------------------------------------------------------------

/** The full serializable state of the community service at one revision. */
export interface CommunityStateDocument {
  readonly revision: number;
  readonly contributions: readonly ContributionRow[];
  readonly transitions: readonly TransitionRow[];
  readonly evidenceRegistry: readonly { readonly digest: string; readonly recordId: string }[];
}

/**
 * Returns true when `value` is a structurally valid
 * {@link CommunityStateDocument}. Shallow (row-level deep validation —
 * content-address coherence — happens in the service on restore).
 */
export function isCommunityStateDocument(value: unknown): value is CommunityStateDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.revision === "number" &&
    Array.isArray(document.contributions) &&
    Array.isArray(document.transitions) &&
    Array.isArray(document.evidenceRegistry)
  );
}

/** A stored snapshot: the document plus its canonical encoding. */
export interface StoredCommunitySnapshot {
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: string;
}

// ---------------------------------------------------------------------------
// Snapshot codec (bigint-safe JSON at the resumability seam)
// ---------------------------------------------------------------------------

/**
 * Marker key for JSON-escaped `bigint` payloads. Collision-safe by
 * construction: every object the codec walks is either a plain data row
 * (`{ contributionId, ... }`-shaped) or a game-ir value node
 * (`{ kind: ... }`-shaped) — a bare `{ "$int": <digits> }` object appears
 * nowhere else in a community state document.
 */
const INT_MARKER_KEY = "$int";

const INT_MARKER_PATTERN = /^-?\d+$/;

function isIntMarker(value: unknown): value is { readonly $int: string } {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== INT_MARKER_KEY) return false;
  const digits = (value as Record<string, unknown>)[INT_MARKER_KEY];
  return typeof digits === "string" && INT_MARKER_PATTERN.test(digits);
}

/**
 * Encodes one state document to its snapshot bytes. JSON with ONE
 * extension: game-ir `int` values (bigint) are escaped as
 * `{ "$int": "<decimal>" }` — the kernel's value space includes bigint,
 * which plain JSON cannot carry. Deterministic: same document, same
 * bytes (E9/E10).
 */
export function encodeSnapshotDocument(document: unknown): string {
  return JSON.stringify(document, (_key, value: unknown) =>
    typeof value === "bigint" ? { [INT_MARKER_KEY]: value.toString(10) } : value,
  );
}

/**
 * Decodes snapshot bytes back to a state document, reviving `$int`
 * markers to bigint. Pure: same bytes, same document.
 */
export function decodeSnapshotDocument(bytes: string): unknown {
  return JSON.parse(bytes, (_key, value: unknown) => (isIntMarker(value) ? BigInt(value.$int) : value));
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * Snapshot persistence port. Save is idempotent: same snapshotId with the
 * same bytes is a no-op; a DIFFERENT document under the same id must
 * throw (content-addressed integrity, E10).
 */
export interface CommunityStore {
  readonly save: (snapshot: StoredCommunitySnapshot) => void;
  readonly list: () => readonly StoredCommunitySnapshot[];
  readonly load: (snapshotId: ContentDigest) => StoredCommunitySnapshot | undefined;
}

/** The only time source the service will ever consult. */
export interface ServiceClock {
  readonly now: () => TimestampMs;
}

/**
 * The identity read-model seam (R20): tenant-scoped subject facts plus
 * the maintainer role the tenancy composition assigns. The domain only
 * ENFORCES these facts; their administration is app-side.
 */
export interface SubjectDirectory {
  readonly exists: (tenant: TenantId, subject: SubjectId) => boolean;
  /** Owning tenant of a subject, when known (cross-tenant detection). */
  readonly tenantOf: (subject: SubjectId) => TenantId | undefined;
  /** Maintainer facts within one tenant (community moderation role). */
  readonly isMaintainer: (tenant: TenantId, subject: SubjectId) => boolean;
}

/**
 * The Lab seam (R18): ladder facts for one typed gap link. Read-only —
 * the Lab (lab-contracts owners) holds capability-gap state; the
 * community service links contributions to gaps and never mutates them.
 */
export interface GapDirectory {
  readonly factsOf: (link: CapabilityGapLink) => GapSeamFacts;
}

/** Publication + provenance facts the registry seam reports for a base. */
export interface PackageQualification {
  readonly published: boolean;
  readonly provenancePasses: boolean;
}

/**
 * The package-registry read seam (E8): qualification facts for a cited
 * lineage base coordinate. The registry (PL-011) is the packaging
 * authority; this seam carries its verdicts, nothing more.
 */
export interface PackageRegistrySeam {
  readonly qualificationOf: (coordinate: unknown) => PackageQualification;
}
