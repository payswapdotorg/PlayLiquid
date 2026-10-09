/**
 * PORTS — every place an effect would otherwise live behind the identity
 * service's back is a pure interface here, injected by the app and faked
 * in tests (platform-multiplayer precedent).
 *
 * Port list (work-order scope):
 * - {@link IdentityStore} — snapshot persistence. The service instance
 *   owns ALL live state (E1); the store persists byte-stable, immutable
 *   checkpoint documents for resumability. Save is idempotent
 *   (content-addressed snapshot ids).
 * - {@link ServiceClock} — the ONLY time source. The service never reads
 *   a wall clock; timestamps are inputs.
 *
 * Purity: interfaces + structural data only. No IO anywhere.
 */

import type { ContentDigest, TimestampMs } from "@playliquid/platform-contracts";
import type {
  IdentityHistoryEntry,
  IdentityRecord,
  ProfileVersion,
} from "./records.ts";

// ---------------------------------------------------------------------------
// Snapshot documents
// ---------------------------------------------------------------------------

/** The full serializable state of the identity service at one revision. */
export interface IdentityStateDocument {
  /** Monotonic; advanced by every admitted mutation. */
  readonly revision: number;
  readonly identities: readonly IdentityRecord[];
  /** ALL profile versions, in append order (E10: append-only). */
  readonly profiles: readonly ProfileVersion[];
  readonly history: readonly IdentityHistoryEntry[];
  /** Alias index rows: one per live alias. */
  readonly aliases: readonly { readonly tenant: string; readonly alias: string; readonly subject: string }[];
  /** Global subject → tenant index (cross-tenant detection, R20). */
  readonly subjectTenants: readonly { readonly subject: string; readonly tenant: string }[];
}

/** A stored snapshot: the document plus its canonical encoding. */
export interface StoredIdentitySnapshot {
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: string;
}

// ---------------------------------------------------------------------------
// Persistence port
// ---------------------------------------------------------------------------

/**
 * Snapshot persistence port. Save is idempotent: re-saving the same
 * snapshotId with the same bytes is a no-op; a DIFFERENT document under
 * the same id must throw (content-addressed integrity, E10).
 */
export interface IdentityStore {
  readonly save: (snapshot: StoredIdentitySnapshot) => void;
  readonly list: () => readonly StoredIdentitySnapshot[];
  readonly load: (snapshotId: ContentDigest) => StoredIdentitySnapshot | undefined;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The only time source the service will ever consult. */
export interface ServiceClock {
  readonly now: () => TimestampMs;
}

// ---------------------------------------------------------------------------
// Structural guard
// ---------------------------------------------------------------------------

/** Returns true when `value` is a structurally valid {@link IdentityStateDocument}. */
export function isIdentityStateDocument(value: unknown): value is IdentityStateDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.revision === "number" &&
    Array.isArray(document.identities) &&
    Array.isArray(document.profiles) &&
    Array.isArray(document.history) &&
    Array.isArray(document.aliases) &&
    Array.isArray(document.subjectTenants)
  );
}
