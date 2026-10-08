/**
 * Lab-local primitive vocabulary for `@playliquid/lab-contracts`.
 *
 * The Game Engineering Lab (spec/architecture.md, "Game Engineering Lab")
 * learns development organizations and capability allocation. This package
 * is its typed CONTRACT layer: what the Lab's later components (lab-
 * simulation PL-028, lab-organization PL-029, lab-learning PL-030,
 * arena-integration PL-007) program against. Per the module dependency
 * matrix, its only dependencies are the workspace siblings
 * `@playliquid/game-contracts` and `@playliquid/game-ir`.
 *
 * Identifiers follow the house pattern of `@playliquid/game-contracts`:
 * human-readable slugs, branded for nominal typing, JSON-serializable,
 * diffable in Git (R1). `AgentId` itself is imported from game-contracts —
 * the Lab never mints a second agent-identifier authority.
 *
 * Purity: no IO, no clocks, no randomness. Time is ALWAYS an explicit
 * caller-supplied {@link TimestampMs}; digests are caller-supplied
 * content-addressed references (lock rule 9), never computed here.
 */

import type { Brand } from "@playliquid/game-contracts";
import { isValidIdText } from "@playliquid/game-contracts";

/** Identity of a candidate/observed development organization. */
export type OrganizationId = Brand<string, "OrganizationId">;
/** Identity of one iteration of the Lab loop for a project. */
export type LabCycleId = Brand<string, "LabCycleId">;
/** Identity of an immutable project-evidence record (E10). */
export type EvidenceRecordId = Brand<string, "EvidenceRecordId">;
/** Identity of a diagnosis stage record. */
export type DiagnosisId = Brand<string, "DiagnosisId">;
/** Identity of a hypothesis stage record. */
export type HypothesisId = Brand<string, "HypothesisId">;
/** Identity of a candidate-evaluation record. */
export type CandidateEvaluationId = Brand<string, "CandidateEvaluationId">;
/** Identity of an implementation-candidate stage record. */
export type ImplementationCandidateId = Brand<string, "ImplementationCandidateId">;
/** Identity of a release stage record. */
export type ReleaseId = Brand<string, "ReleaseId">;
/** Identity of an immutable observed-outcome record (E10, lock 27). */
export type ObservationId = Brand<string, "ObservationId">;
/** Identity of an appended calibration conclusion. */
export type CalibrationId = Brand<string, "CalibrationId">;
/** Identity of a capability-gap record (lock 30). */
export type GapRecordId = Brand<string, "GapRecordId">;
/** Identity of a provider-neutral Arena escalation request (lock 32). */
export type ArenaEscalationId = Brand<string, "ArenaEscalationId">;

/** A role an organization agent may hold (e.g. `generalist`). */
export type AgentRoleId = Brand<string, "AgentRoleId">;
/** A capability an organization allocates (e.g. `render-pipeline`). */
export type CapabilityId = Brand<string, "CapabilityId">;
/** Identity of a memory store in an organization's memory topology. */
export type MemoryStoreId = Brand<string, "MemoryStoreId">;
/** Identity of a review gate in an organization's review structure. */
export type ReviewGateId = Brand<string, "ReviewGateId">;

/** Identity of a GameIR evaluation suite (see evaluation-suites.ts). */
export type LabEvaluationSuiteId = Brand<string, "LabEvaluationSuiteId">;
/** Identity of a metric inside an evaluation suite. */
export type LabEvaluationMetricId = Brand<string, "LabEvaluationMetricId">;

/**
 * Reproducibility seed for Lab evaluations (E9). Opaque text supplied by
 * the caller; two evaluations of the same request with the same seed are
 * expected to produce the same estimate.
 */
export type EvaluationSeed = Brand<string, "EvaluationSeed">;

/**
 * Lowercase hex SHA-256 digest (64 chars) of a content-addressed artifact
 * (evidence, escalation request, suite, candidate content). Lock rule 9:
 * large artifacts live in CAS and are referenced from contracts by digest.
 */
export type ContentDigest = Brand<string, "ContentDigest">;

/**
 * Milliseconds since Unix epoch, ALWAYS supplied by the caller. The Lab
 * never reads a wall clock; every timestamp in these contracts is data,
 * not an environment read.
 */
export type TimestampMs = Brand<number, "TimestampMs">;

/** Parses and validates `text` as an {@link OrganizationId}, or returns `undefined`. */
export function asOrganizationId(text: string): OrganizationId | undefined {
  return isValidIdText(text) ? (text as OrganizationId) : undefined;
}

/** Parses and validates `text` as a {@link LabCycleId}, or returns `undefined`. */
export function asLabCycleId(text: string): LabCycleId | undefined {
  return isValidIdText(text) ? (text as LabCycleId) : undefined;
}

/** Parses and validates `text` as an {@link EvidenceRecordId}, or returns `undefined`. */
export function asEvidenceRecordId(text: string): EvidenceRecordId | undefined {
  return isValidIdText(text) ? (text as EvidenceRecordId) : undefined;
}

/** Parses and validates `text` as a {@link DiagnosisId}, or returns `undefined`. */
export function asDiagnosisId(text: string): DiagnosisId | undefined {
  return isValidIdText(text) ? (text as DiagnosisId) : undefined;
}

/** Parses and validates `text` as a {@link HypothesisId}, or returns `undefined`. */
export function asHypothesisId(text: string): HypothesisId | undefined {
  return isValidIdText(text) ? (text as HypothesisId) : undefined;
}

/** Parses and validates `text` as a {@link CandidateEvaluationId}, or returns `undefined`. */
export function asCandidateEvaluationId(text: string): CandidateEvaluationId | undefined {
  return isValidIdText(text) ? (text as CandidateEvaluationId) : undefined;
}

/** Parses and validates `text` as an {@link ImplementationCandidateId}, or returns `undefined`. */
export function asImplementationCandidateId(text: string): ImplementationCandidateId | undefined {
  return isValidIdText(text) ? (text as ImplementationCandidateId) : undefined;
}

/** Parses and validates `text` as a {@link ReleaseId}, or returns `undefined`. */
export function asReleaseId(text: string): ReleaseId | undefined {
  return isValidIdText(text) ? (text as ReleaseId) : undefined;
}

/** Parses and validates `text` as an {@link ObservationId}, or returns `undefined`. */
export function asObservationId(text: string): ObservationId | undefined {
  return isValidIdText(text) ? (text as ObservationId) : undefined;
}

/** Parses and validates `text` as a {@link CalibrationId}, or returns `undefined`. */
export function asCalibrationId(text: string): CalibrationId | undefined {
  return isValidIdText(text) ? (text as CalibrationId) : undefined;
}

/** Parses and validates `text` as a {@link GapRecordId}, or returns `undefined`. */
export function asGapRecordId(text: string): GapRecordId | undefined {
  return isValidIdText(text) ? (text as GapRecordId) : undefined;
}

/** Parses and validates `text` as an {@link ArenaEscalationId}, or returns `undefined`. */
export function asArenaEscalationId(text: string): ArenaEscalationId | undefined {
  return isValidIdText(text) ? (text as ArenaEscalationId) : undefined;
}

/** Parses and validates `text` as an {@link AgentRoleId}, or returns `undefined`. */
export function asAgentRoleId(text: string): AgentRoleId | undefined {
  return isValidIdText(text) ? (text as AgentRoleId) : undefined;
}

/** Parses and validates `text` as a {@link CapabilityId}, or returns `undefined`. */
export function asCapabilityId(text: string): CapabilityId | undefined {
  return isValidIdText(text) ? (text as CapabilityId) : undefined;
}

/** Parses and validates `text` as a {@link MemoryStoreId}, or returns `undefined`. */
export function asMemoryStoreId(text: string): MemoryStoreId | undefined {
  return isValidIdText(text) ? (text as MemoryStoreId) : undefined;
}

/** Parses and validates `text` as a {@link ReviewGateId}, or returns `undefined`. */
export function asReviewGateId(text: string): ReviewGateId | undefined {
  return isValidIdText(text) ? (text as ReviewGateId) : undefined;
}

/** Parses and validates `text` as a {@link LabEvaluationSuiteId}, or returns `undefined`. */
export function asLabEvaluationSuiteId(text: string): LabEvaluationSuiteId | undefined {
  return isValidIdText(text) ? (text as LabEvaluationSuiteId) : undefined;
}

/** Parses and validates `text` as a {@link LabEvaluationMetricId}, or returns `undefined`. */
export function asLabEvaluationMetricId(text: string): LabEvaluationMetricId | undefined {
  return isValidIdText(text) ? (text as LabEvaluationMetricId) : undefined;
}

/** Parses and validates `text` as an {@link EvaluationSeed}, or returns `undefined`. */
export function asEvaluationSeed(text: string): EvaluationSeed | undefined {
  return typeof text === "string" && text.length > 0 && text.length <= 128
    ? (text as EvaluationSeed)
    : undefined;
}

/** True iff `value` is a syntactically valid lowercase-hex SHA-256 digest. */
export function isValidContentDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** Parses and validates `value` as a {@link ContentDigest}, or returns `undefined`. */
export function asContentDigest(value: string): ContentDigest | undefined {
  return isValidContentDigest(value) ? (value as ContentDigest) : undefined;
}

/**
 * Nominal cast: finite non-negative integer milliseconds -> {@link TimestampMs}.
 * Fractions are refused: Lab bookkeeping is whole-millisecond.
 */
export function asTimestampMs(ms: number): TimestampMs | undefined {
  return Number.isSafeInteger(ms) && ms >= 0 ? (ms as TimestampMs) : undefined;
}

/**
 * Runtime immutability helper (E1/E10): recursively freezes a record tree
 * so that sealed evidence, observations and calibration conclusions cannot
 * be mutated after the fact. Freezing is idempotent and shape-preserving;
 * it exists to ENFORCE immutability, never to mutate data values. Pure
 * with respect to every observable field of the value.
 */
export function sealRecord<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) {
      for (const item of value) sealRecord(item);
    } else {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        sealRecord(nested);
      }
    }
    Object.freeze(value);
  }
  return value;
}
