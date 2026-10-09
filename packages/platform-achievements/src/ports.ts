/**
 * PORTS — every place an effect would otherwise live behind the
 * achievements service's back is a pure interface here, injected by
 * the app and faked in tests (platform-multiplayer precedent).
 *
 * Port list (work-order scope):
 * - {@link AchievementsStore} — snapshot persistence (content-addressed,
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

/** One serialized definition row. */
export interface DefinitionRow {
  readonly tenant: string;
  readonly achievement: string;
  readonly metric: string;
  readonly threshold: number;
  readonly visibility: "public" | "private" | "social";
  readonly progression: "metric" | "event";
}

/** One serialized binding row. */
export interface BindingRow {
  readonly tenant: string;
  readonly eventKind: string;
  readonly achievement: string;
  readonly increment: number;
}

/** One serialized progression row. */
export interface ProgressRow {
  readonly tenant: string;
  readonly subject: string;
  readonly achievement: string;
  readonly current: number;
  readonly unlocked: boolean;
  readonly unlockedAt: number | undefined;
  readonly evidenceApplied: readonly string[];
}

/** The full serializable state of the achievements service. */
export interface AchievementsStateDocument {
  readonly revision: number;
  readonly definitions: readonly DefinitionRow[];
  readonly bindings: readonly BindingRow[];
  readonly progress: readonly ProgressRow[];
  readonly awards: readonly unknown[];
}

/** A stored snapshot: the document plus its canonical encoding. */
export interface StoredAchievementsSnapshot {
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: string;
}

/** Returns true when `value` is a structurally valid {@link AchievementsStateDocument}. */
export function isAchievementsStateDocument(value: unknown): value is AchievementsStateDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.revision === "number" &&
    Array.isArray(document.definitions) &&
    Array.isArray(document.bindings) &&
    Array.isArray(document.progress) &&
    Array.isArray(document.awards)
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
export interface AchievementsStore {
  readonly save: (snapshot: StoredAchievementsSnapshot) => void;
  readonly list: () => readonly StoredAchievementsSnapshot[];
  readonly load: (snapshotId: ContentDigest) => StoredAchievementsSnapshot | undefined;
}

/** The only time source the service will ever consult. */
export interface ServiceClock {
  readonly now: () => TimestampMs;
}

/** The least-privilege seam (R20): current scoped capability grants. */
export interface GrantDirectory {
  readonly grants: () => readonly ScopedCapabilityGrant[];
}
