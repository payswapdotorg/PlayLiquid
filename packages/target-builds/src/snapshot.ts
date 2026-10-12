/**
 * THE SERVICE STATE DOCUMENT + SNAPSHOT (PL-036, E6) — the serializable
 * state of the multi-target build service and its content-addressed
 * snapshot form, mirroring the build-orchestrator's document discipline:
 * the snapshot is the canonical-JSON serialization of the full state;
 * restore verifies the content address before any state is trusted and
 * refuses torn snapshots (never heals them, E8).
 */

import { canonicalJson, computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { MultiTargetFanoutPlan } from "./plan.ts";
import type { DurableTargetOutcome } from "./outcomes.ts";
import type { MultiTargetBuildRecord } from "./record.ts";

/** The recorded first encounter of one idempotency key (E6). */
export interface RecordedRequestEncounter {
  readonly key: string;
  readonly tenant: string;
  readonly requester: string;
  readonly nonce: string;
  readonly requestFingerprint: ContentDigest;
  readonly recordId: string;
}

/** The full serializable state of the multi-target build service. */
export interface MultiTargetBuildsDocument {
  readonly revision: number;
  readonly tenants: readonly string[];
  readonly encounters: readonly RecordedRequestEncounter[];
  readonly plans: readonly MultiTargetFanoutPlan[];
  readonly outcomes: readonly DurableTargetOutcome[];
  readonly records: readonly MultiTargetBuildRecord[];
}

/** A stored snapshot of the service state (content-addressed, E6). */
export interface MultiTargetBuildsSnapshot {
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: string;
}

/** Why a snapshot restore was refused. Typed; never healed silently. */
export type MultiTargetSnapshotRefusalCode = "snapshot-malformed" | "snapshot-digest-mismatch";

/** Serializes the document into its snapshot form (content-addressed). */
export function snapshotOfDocument(document: MultiTargetBuildsDocument): MultiTargetBuildsSnapshot {
  const encoded = canonicalJson(document);
  return { snapshotId: computeDigest(encoded), revision: document.revision, document: encoded };
}

/**
 * Verifies a stored snapshot: parses the document, checks its structure
 * and verifies its content address. A tampered document fails the digest
 * check (E8) — restore never rewrites state.
 */
export function verifyMultiTargetSnapshot(
  snapshot: MultiTargetBuildsSnapshot,
): { readonly ok: true; readonly document: MultiTargetBuildsDocument } | { readonly ok: false; readonly code: MultiTargetSnapshotRefusalCode; readonly message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.document);
  } catch {
    return { ok: false, code: "snapshot-malformed", message: "snapshot document is not valid JSON" };
  }
  if (!isMultiTargetDocument(parsed)) {
    return { ok: false, code: "snapshot-malformed", message: "snapshot document is not a multi-target builds document" };
  }
  let encoded: string;
  try {
    encoded = canonicalJson(parsed);
  } catch {
    return { ok: false, code: "snapshot-malformed", message: "snapshot document is not canonical-JSON serializable" };
  }
  if (computeDigest(encoded) !== snapshot.snapshotId) {
    return { ok: false, code: "snapshot-digest-mismatch", message: "snapshot id does not match the document digest (content-addressed integrity, E8)" };
  }
  return { ok: true, document: parsed };
}

/** Structural guard over an untrusted state document (restore input). Total. */
export function isMultiTargetDocument(value: unknown): value is MultiTargetBuildsDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const document = value as Partial<MultiTargetBuildsDocument>;
  return (
    typeof document.revision === "number" &&
    Number.isSafeInteger(document.revision) &&
    document.revision >= 0 &&
    Array.isArray(document.tenants) &&
    Array.isArray(document.encounters) &&
    Array.isArray(document.plans) &&
    Array.isArray(document.outcomes) &&
    Array.isArray(document.records) &&
    document.encounters.every((encounter) => typeof encounter === "object" && encounter !== null && typeof encounter.key === "string" && typeof encounter.recordId === "string") &&
    document.plans.every((plan) => typeof plan === "object" && plan !== null && typeof plan.planId === "string" && Array.isArray(plan.entries) && Array.isArray(plan.refusals)) &&
    document.outcomes.every((outcome) => typeof outcome === "object" && outcome !== null && typeof outcome.planKey === "string" && typeof outcome.target === "string") &&
    document.records.every((record) => typeof record === "object" && record !== null && typeof record.recordId === "string" && typeof record.planId === "string")
  );
}
