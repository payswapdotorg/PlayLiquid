/**
 * The build orchestrator state document and its snapshot form (E6
 * durable/queued/resumable; E10 historical evidence immutable).
 *
 * The snapshot is a full, canonical-JSON serialization of the service
 * state — the E6 resume boundary. Restore verifies content addressing
 * (the snapshot id must equal the document digest) and the append-only
 * event discipline (per-build sequences strictly increasing from 1)
 * before any state is trusted. Historical events are NEVER rewritten;
 * restore refuses a corrupt log instead of healing it (E8/E10).
 */

import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { canonicalJson } from "@playliquid/package-system";
import type {
  BuildArtifact,
  BuildOutputs,
  BuildPhase,
  BuildRequestCommand,
  BuildStepRecord,
  VerificationEvidence,
} from "@playliquid/build-contracts";
import type { BuildEvent } from "./events.ts";
import { findEventLogCorruption } from "./events.ts";
import type { ClosureProvenanceEvidence } from "./stages.ts";

/** One environment limitation recorded truthfully (E11). */
export interface EnvironmentLimitation {
  readonly limitationId: string;
  readonly at: number;
  readonly tenant: string;
  readonly buildId?: string;
  readonly target?: string;
  readonly operation?: string;
  /** `toolchain-unavailable` | `console-verification-out-of-band`. */
  readonly code: string;
  readonly message: string;
}

/** The recorded state of one build (single owner: the service instance). */
export interface BuildRecord {
  readonly buildId: string;
  readonly tenant: string;
  readonly requester: string;
  readonly phase: BuildPhase;
  readonly admittedAt: number;
  /** Deterministic payload fingerprint of the admitted request (E9). */
  readonly fingerprint: ContentDigest;
  /** Digest of the full pinned input set (E9). */
  readonly inputsDigest: ContentDigest;
  /** The admitted request, pinned verbatim (deterministic re-drive material). */
  readonly request: BuildRequestCommand;
  /** Completed stage records, append-only per build (manifest material). */
  readonly steps: readonly BuildStepRecord[];
  /** Emitted artifacts, append-only per build (E7 CAS references). */
  readonly artifacts: readonly BuildArtifact[];
  /** Collected verification evidence, append-only per build. */
  readonly evidence: readonly VerificationEvidence[];
  /** Resolve-stage summary (present once the resolve stage completed). */
  readonly closureSummary: { readonly closureDigest: ContentDigest; readonly packageCount: number } | null;
  /** R19 provenance evidence retained from the closure (resolve stage). */
  readonly provenance: ClosureProvenanceEvidence | null;
  /** Assembled outputs once the package stage completed (finalized on success). */
  readonly outputs: BuildOutputs | null;
  /** Terminal failure reason (phase `failed`). */
  readonly failure: { readonly code: string; readonly message: string } | null;
}

/** The first-encounter record of one tenant-scoped idempotency key (E6). */
export interface RecordedEncounter {
  /** The tenant-scoped composite key: `${tenant}|${scope}|${requester}|${nonce}`. */
  readonly key: string;
  readonly tenant: string;
  readonly scope: string;
  readonly requester: string;
  readonly nonce: string;
  readonly fingerprint: ContentDigest;
  readonly buildId: string;
}

/** The full serializable state of the build orchestrator service. */
export interface BuildOrchestratorDocument {
  readonly revision: number;
  readonly tenants: readonly string[];
  readonly encounters: readonly RecordedEncounter[];
  readonly builds: readonly BuildRecord[];
  readonly events: readonly BuildEvent[];
  readonly limitations: readonly EnvironmentLimitation[];
}

/** A stored snapshot: the canonical document plus its content digest. */
export interface StoredBuildSnapshot {
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: string;
}

/** Serializes the document into its snapshot form (content-addressed). */
export function snapshotOf(document: BuildOrchestratorDocument): StoredBuildSnapshot {
  const encoded = canonicalJson(document);
  return { snapshotId: computeDigest(encoded), revision: document.revision, document: encoded };
}

/** Structural guard over an untrusted document (restore input). Total. */
export function isBuildOrchestratorDocument(value: unknown): value is BuildOrchestratorDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const document = value as Partial<BuildOrchestratorDocument>;
  return (
    typeof document.revision === "number" &&
    Number.isSafeInteger(document.revision) &&
    document.revision >= 0 &&
    Array.isArray(document.tenants) &&
    Array.isArray(document.encounters) &&
    Array.isArray(document.builds) &&
    Array.isArray(document.events) &&
    Array.isArray(document.limitations) &&
    document.builds.every(
      (build) =>
        typeof build === "object" &&
        build !== null &&
        typeof build.buildId === "string" &&
        typeof build.phase === "string" &&
        Array.isArray(build.steps) &&
        typeof build.request?.idempotency?.requester === "string",
    )
  );
}

/** Why a snapshot restore was refused. Typed; never healed silently. */
export type SnapshotRestoreRefusalCode =
  | "snapshot-malformed"
  | "snapshot-digest-mismatch"
  | "event-log-corrupt";

/** The typed refusal of {@link verifySnapshot}. */
export interface SnapshotRestoreRefusal {
  readonly ok: false;
  readonly code: SnapshotRestoreRefusalCode;
  readonly message: string;
}

/** The result of snapshot verification. */
export type SnapshotVerification =
  | { readonly ok: true; readonly document: BuildOrchestratorDocument }
  | SnapshotRestoreRefusal;

/**
 * Verifies a stored snapshot: parses and structurally checks the document,
 * verifies its content address, and verifies the append-only event
 * discipline. A corrupt log is a typed refusal (E10) — restore never
 * rewrites history.
 */
export function verifySnapshot(snapshot: StoredBuildSnapshot): SnapshotVerification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.document);
  } catch {
    return { ok: false, code: "snapshot-malformed", message: "snapshot document is not valid JSON" };
  }
  if (!isBuildOrchestratorDocument(parsed)) {
    return { ok: false, code: "snapshot-malformed", message: "snapshot document is not a build orchestrator document" };
  }
  let encoded: string;
  try {
    encoded = canonicalJson(parsed);
  } catch {
    return { ok: false, code: "snapshot-malformed", message: "snapshot document is not canonical-JSON serializable" };
  }
  if (computeDigest(encoded) !== snapshot.snapshotId) {
    return { ok: false, code: "snapshot-digest-mismatch", message: "snapshot id does not match the document digest (content-addressed integrity, E10)" };
  }
  const corruption = findEventLogCorruption(parsed.events);
  if (corruption !== null) {
    return { ok: false, code: "event-log-corrupt", message: `append-only event discipline violated: ${corruption.message}` };
  }
  return { ok: true, document: parsed };
}
