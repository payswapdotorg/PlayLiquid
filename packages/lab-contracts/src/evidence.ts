/**
 * EVIDENCE IMMUTABILITY (E10, lock rule 27 — the historical-truth surface).
 *
 * "Historical observations are immutable." "Lab evidence never rewrites
 * historical observations." Project evidence and observed outcomes are
 * IMMUTABLE, SEALED records; calibration APPENDS derived conclusions that
 * reference observations by id and can never modify them. The ledgers here
 * are pure, copy-on-write, append-only folds:
 *
 * - {@link appendProjectEvidence} refuses duplicate ids — there is no
 *   update, revise or rewrite operation anywhere in this package;
 * - {@link appendObservation} likewise;
 * - {@link appendCalibrationConclusion} appends a conclusion DERIVED FROM
 *   immutable observations (every referenced id must already exist) and
 *   leaves the observation list untouched (the same frozen array reference
 *   is carried over).
 *
 * All records intersect the E11 marker vocabulary of estimates.ts: evidence
 * records carry `epistemic: "observed-evidence"` and are therefore
 * structurally disjoint from labeled estimates.
 *
 * Pure module: no IO; time is caller-supplied; digests are references.
 */

import type { GitRef } from "@playliquid/game-contracts";
import { isGitRef } from "@playliquid/game-contracts";
import type {
  CalibrationId,
  ContentDigest,
  EvidenceRecordId,
  LabCycleId,
  ObservationId,
  ReleaseId,
  TimestampMs,
} from "./primitives.ts";
import {
  asCalibrationId,
  asEvidenceRecordId,
  asLabCycleId,
  asObservationId,
  asReleaseId,
  asTimestampMs,
  isValidContentDigest,
  sealRecord,
} from "./primitives.ts";
import type { ObservedEvidence } from "./estimates.ts";

/** Frozen vocabulary of project-evidence kinds (R17: real project evidence). */
export const PROJECT_EVIDENCE_KINDS = Object.freeze([
  "replay-artifact",
  "release-artifact",
  "repository-metrics",
  "telemetry-summary",
  "incident-report",
  "evaluation-run",
] as const);

/** What kind of real project evidence a record captures. */
export type ProjectEvidenceKind = (typeof PROJECT_EVIDENCE_KINDS)[number];

/** Returns true when `value` is a valid {@link ProjectEvidenceKind}. */
export function isProjectEvidenceKind(value: unknown): value is ProjectEvidenceKind {
  return typeof value === "string" && (PROJECT_EVIDENCE_KINDS as readonly string[]).includes(value);
}

/**
 * An immutable record of REAL project evidence (E10/R17): what actually
 * happened in the project, pinned to the Git ref it came from and to a
 * content-addressed artifact (lock rule 9). Sealed on append.
 */
export interface ProjectEvidenceRecord extends ObservedEvidence {
  readonly epistemic: "observed-evidence";
  readonly evidenceId: EvidenceRecordId;
  readonly cycleId: LabCycleId;
  readonly kind: ProjectEvidenceKind;
  readonly source: GitRef;
  readonly contentDigest: ContentDigest;
  readonly summary: string;
  readonly observedAt: TimestampMs;
}

/**
 * An immutable record of the outcome ACTUALLY observed after a release
 * (E10, lock 27). What the Lab measures success against; sealed on append
 * and never rewritten. Calibration derives FROM these, never edits them.
 */
export interface ObservedOutcomeRecord extends ObservedEvidence {
  readonly epistemic: "observed-evidence";
  readonly observationId: ObservationId;
  readonly cycleId: LabCycleId;
  readonly release: ReleaseId;
  readonly contentDigest: ContentDigest;
  readonly summary: string;
  readonly observedAt: TimestampMs;
}

/**
 * A calibration conclusion (lock rule 27 read operationally): DERIVED
 * knowledge appended to the ledger after calibration. `derivedFrom` cites
 * the immutable observations the conclusion was derived from — the
 * audit chain that makes rewriting both impossible and unnecessary.
 */
export interface CalibrationConclusion {
  readonly calibrationId: CalibrationId;
  readonly cycleId: LabCycleId;
  readonly derivedFrom: readonly ObservationId[];
  readonly statement: string;
}

/** The append-only project-evidence ledger. */
export interface ProjectEvidenceLedger {
  readonly records: readonly ProjectEvidenceRecord[];
}

/** The observation ledger: immutable observations plus appended conclusions. */
export interface ObservationLedger {
  readonly observations: readonly ObservedOutcomeRecord[];
  readonly conclusions: readonly CalibrationConclusion[];
}

/** The empty project-evidence ledger (frozen). */
export const EMPTY_PROJECT_EVIDENCE_LEDGER: ProjectEvidenceLedger = Object.freeze({
  records: Object.freeze([]),
});

/** The empty observation ledger (frozen). */
export const EMPTY_OBSERVATION_LEDGER: ObservationLedger = Object.freeze({
  observations: Object.freeze([]),
  conclusions: Object.freeze([]),
});

/** Typed refusal of {@link appendProjectEvidence}. */
export type ProjectEvidenceAppendRefusal = "duplicate-evidence-id" | "invalid-evidence-record";

/** Result of {@link appendProjectEvidence}. */
export type ProjectEvidenceAppendResult =
  | { readonly ok: true; readonly ledger: ProjectEvidenceLedger }
  | { readonly ok: false; readonly code: ProjectEvidenceAppendRefusal; readonly ledger: ProjectEvidenceLedger; readonly detail: string };

/** Typed refusal of {@link appendObservation}. */
export type ObservationAppendRefusal = "duplicate-observation-id" | "invalid-observation-record";

/** Result of {@link appendObservation}. */
export type ObservationAppendResult =
  | { readonly ok: true; readonly ledger: ObservationLedger }
  | { readonly ok: false; readonly code: ObservationAppendRefusal; readonly ledger: ObservationLedger; readonly detail: string };

/** Typed refusal of {@link appendCalibrationConclusion}. */
export type CalibrationAppendRefusal =
  | "duplicate-calibration-id"
  | "unknown-observation-reference"
  | "invalid-calibration-record";

/** Result of {@link appendCalibrationConclusion}. */
export type CalibrationAppendResult =
  | { readonly ok: true; readonly ledger: ObservationLedger }
  | { readonly ok: false; readonly code: CalibrationAppendRefusal; readonly ledger: ObservationLedger; readonly detail: string };

function isValidProjectEvidenceRecord(record: ProjectEvidenceRecord): boolean {
  return (
    asEvidenceRecordId(record.evidenceId) !== undefined &&
    asLabCycleId(record.cycleId) !== undefined &&
    isProjectEvidenceKind(record.kind) &&
    isGitRef(record.source) &&
    isValidContentDigest(record.contentDigest) &&
    record.summary.length > 0 &&
    asTimestampMs(record.observedAt) !== undefined &&
    record.epistemic === "observed-evidence"
  );
}

function isValidObservedOutcomeRecord(record: ObservedOutcomeRecord): boolean {
  return (
    asObservationId(record.observationId) !== undefined &&
    asLabCycleId(record.cycleId) !== undefined &&
    asReleaseId(record.release) !== undefined &&
    isValidContentDigest(record.contentDigest) &&
    record.summary.length > 0 &&
    asTimestampMs(record.observedAt) !== undefined &&
    record.epistemic === "observed-evidence"
  );
}

function isValidCalibrationConclusion(conclusion: CalibrationConclusion): boolean {
  return (
    asCalibrationId(conclusion.calibrationId) !== undefined &&
    asLabCycleId(conclusion.cycleId) !== undefined &&
    conclusion.derivedFrom.length > 0 &&
    conclusion.derivedFrom.every((id) => asObservationId(id) !== undefined) &&
    conclusion.statement.length > 0
  );
}

/**
 * Appends one project-evidence record to the ledger (E10). The record is
 * validated, SEALED (deep-frozen) and stored; the ledger is copied, never
 * mutated. A duplicate evidence id is refused — appending is the only
 * write, so an id can never be repointed at different content.
 */
export function appendProjectEvidence(
  ledger: ProjectEvidenceLedger,
  record: ProjectEvidenceRecord,
): ProjectEvidenceAppendResult {
  if (!isValidProjectEvidenceRecord(record)) {
    return { ok: false, code: "invalid-evidence-record", ledger, detail: "record failed structural validation" };
  }
  if (ledger.records.some((existing) => existing.evidenceId === record.evidenceId)) {
    return {
      ok: false,
      code: "duplicate-evidence-id",
      ledger,
      detail: `evidence ${record.evidenceId} already recorded (E10: no rewrite path exists)`,
    };
  }
  const sealed = sealRecord(record);
  return { ok: true, ledger: { records: Object.freeze([...ledger.records, sealed]) } };
}

/**
 * Appends one immutable observed-outcome record (E10, lock 27). Same
 * contract as {@link appendProjectEvidence}: validate, seal, copy; a
 * duplicate observation id is refused — historical observations are never
 * rewritten, only extended.
 */
export function appendObservation(ledger: ObservationLedger, record: ObservedOutcomeRecord): ObservationAppendResult {
  if (!isValidObservedOutcomeRecord(record)) {
    return { ok: false, code: "invalid-observation-record", ledger, detail: "record failed structural validation" };
  }
  if (ledger.observations.some((existing) => existing.observationId === record.observationId)) {
    return {
      ok: false,
      code: "duplicate-observation-id",
      ledger,
      detail: `observation ${record.observationId} already recorded (lock 27: immutable)`,
    };
  }
  const sealed = sealRecord(record);
  return { ok: true, ledger: { observations: Object.freeze([...ledger.observations, sealed]), conclusions: ledger.conclusions } };
}

/**
 * Appends one derived calibration conclusion (E10's positive half). The
 * conclusion must cite at least one EXISTING immutable observation — the
 * derived-from audit chain. The observations list is carried over as the
 * SAME frozen reference: appending a conclusion is structurally incapable
 * of rewriting an observation.
 */
export function appendCalibrationConclusion(
  ledger: ObservationLedger,
  conclusion: CalibrationConclusion,
): CalibrationAppendResult {
  if (!isValidCalibrationConclusion(conclusion)) {
    return { ok: false, code: "invalid-calibration-record", ledger, detail: "conclusion failed structural validation" };
  }
  if (ledger.conclusions.some((existing) => existing.calibrationId === conclusion.calibrationId)) {
    return {
      ok: false,
      code: "duplicate-calibration-id",
      ledger,
      detail: `calibration ${conclusion.calibrationId} already appended`,
    };
  }
  const known = new Set(ledger.observations.map((observation) => observation.observationId));
  for (const id of conclusion.derivedFrom) {
    if (!known.has(id)) {
      return {
        ok: false,
        code: "unknown-observation-reference",
        ledger,
        detail: `conclusion cites observation ${id} which is not in the ledger`,
      };
    }
  }
  const sealed = sealRecord(conclusion);
  return {
    ok: true,
    ledger: { observations: ledger.observations, conclusions: Object.freeze([...ledger.conclusions, sealed]) },
  };
}

/** Finds a project-evidence record by id. Pure lookup. */
export function findProjectEvidence(ledger: ProjectEvidenceLedger, id: EvidenceRecordId): ProjectEvidenceRecord | undefined {
  return ledger.records.find((record) => record.evidenceId === id);
}

/** Finds an observed-outcome record by id. Pure lookup. */
export function findObservation(ledger: ObservationLedger, id: ObservationId): ObservedOutcomeRecord | undefined {
  return ledger.observations.find((record) => record.observationId === id);
}

/** Finds a calibration conclusion by id. Pure lookup. */
export function findCalibrationConclusion(ledger: ObservationLedger, id: CalibrationId): CalibrationConclusion | undefined {
  return ledger.conclusions.find((conclusion) => conclusion.calibrationId === id);
}
