/**
 * PORTS — every place an effect would otherwise live behind the
 * leaderboard service's back is a pure interface here, injected by the
 * app and faked in tests (platform-multiplayer precedent).
 *
 * Port list (work-order scope):
 * - {@link LeaderboardStore} — snapshot persistence (content-addressed,
 *   idempotent saves; immutable snapshots, E10).
 * - {@link ServiceClock} — the ONLY time source.
 * - {@link GrantDirectory} — the least-privilege seam (R20): current
 *   scoped capability grants. Grant ADMINISTRATION is a platform
 *   tenancy composition concern; this package only ENFORCES grants via
 *   platform-contracts' `checkLeastPrivilege`.
 *
 * Purity: interfaces + structural data only. No IO anywhere.
 */

import type {
  ContentDigest,
  ScopedCapabilityGrant,
  TimestampMs,
} from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Snapshot documents
// ---------------------------------------------------------------------------

/** One serialized board row. */
export interface BoardRow {
  readonly tenant: string;
  readonly leaderboard: string;
  readonly metric: string;
  readonly aggregation: "latest" | "sum" | "max";
  readonly ordering: "ascending" | "descending";
  readonly policy: unknown;
}

/** One serialized subject entry row. */
export interface EntryRow {
  readonly seasonId: string;
  readonly subject: string;
  readonly score: number;
  readonly achievedAt: TimestampMs;
  readonly submissions: number;
  readonly lastEvidence: string;
  readonly lastRecordedAt: TimestampMs;
  readonly lastIntegrityConfidence: number;
}

/** The full serializable state of the leaderboard service. */
export interface LeaderboardStateDocument {
  readonly revision: number;
  readonly boards: readonly BoardRow[];
  readonly currentSeasons: readonly { readonly tenant: string; readonly leaderboard: string; readonly season: unknown }[];
  readonly frozenSeasons: readonly { readonly tenant: string; readonly leaderboard: string; readonly seasons: readonly unknown[] }[];
  readonly entries: readonly EntryRow[];
  readonly receipts: readonly unknown[];
  readonly evidenceRegistry: readonly { readonly key: string; readonly receiptId: string; readonly score: number }[];
}

/** A stored snapshot: the document plus its canonical encoding. */
export interface StoredLeaderboardSnapshot {
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: string;
}

/** Returns true when `value` is a structurally valid {@link LeaderboardStateDocument}. */
export function isLeaderboardStateDocument(value: unknown): value is LeaderboardStateDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.revision === "number" &&
    Array.isArray(document.boards) &&
    Array.isArray(document.currentSeasons) &&
    Array.isArray(document.frozenSeasons) &&
    Array.isArray(document.entries) &&
    Array.isArray(document.receipts) &&
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
export interface LeaderboardStore {
  readonly save: (snapshot: StoredLeaderboardSnapshot) => void;
  readonly list: () => readonly StoredLeaderboardSnapshot[];
  readonly load: (snapshotId: ContentDigest) => StoredLeaderboardSnapshot | undefined;
}

/** The only time source the service will ever consult. */
export interface ServiceClock {
  readonly now: () => TimestampMs;
}

/** The least-privilege seam (R20): current scoped capability grants. */
export interface GrantDirectory {
  readonly grants: () => readonly ScopedCapabilityGrant[];
}
