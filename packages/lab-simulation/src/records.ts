/**
 * LAB SIMULATION RECORD VOCABULARY (PL-028) — the typed shapes of the
 * simulation/evaluation stage of the Lab loop.
 *
 * Three record kinds, mirroring the lab-contracts stage links:
 *
 * - {@link LabEvaluationRequest} — the INTAKE input: a candidate
 *   organization (lab-contracts §organization dimensions) + a
 *   project-evidence bundle (R17) + evaluation parameters, bound as one
 *   typed request (E1);
 * - {@link LabEvaluationIntakeRecord} — the admitted one-record: the
 *   request's content-addressed identity plus tenant/owner scoping (R20)
 *   and caller-supplied admission time;
 * - {@link LabEvaluationRunRecord} — the completed simulation/evaluation
 *   run: statistics + REPLAY references (R8) + the estimate result.
 *
 * EPISTEMIC LABELING (E11, lock rules 28/29) is baked into the shapes:
 * {@link LabEvaluationRunRecord.result} is a lab-contracts
 * {@link LabeledEstimate} — an explicitly-labeled estimate. There is NO
 * field anywhere in this package that can carry an observation for
 * simulated results; the estimate label is enforced at the type boundary
 * (structural marker literals) and re-checked at runtime
 * ({@link asLabEstimateResult}) before any record is assembled.
 *
 * Pure module: data types, guards, constants. No IO, no clocks, no
 * randomness; time is ALWAYS caller-supplied data.
 */

import type {
  CandidateEvaluationId,
  CandidateEvaluationRecord,
  ContentDigest,
  EvaluationSeed,
  LabCycleId,
  LabEvaluationSuiteRef,
  OrganizationDescriptor,
  OrganizationId,
  OrganizationSearchContext,
  TimestampMs,
} from "@playliquid/lab-contracts";
import {
  asCandidateEvaluationId,
  asEvaluationSeed,
  asLabCycleId,
  asOrganizationId,
  asTimestampMs,
  isLabeledEstimate,
  isValidContentDigest,
} from "@playliquid/lab-contracts";
import type { LabeledEstimate, EvaluationMetricReading } from "@playliquid/lab-contracts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import type { ContentDigest as ReplayDigest } from "@playliquid/package-system";

/** Identity of this simulator, stamped on every estimate it produces. */
export const LAB_SIMULATOR_ID = "lab-simulation-headless-v1";

/** The single work intent kind the lab evaluation world understands. */
export const LAB_WORK_INTENT_KIND = "lab.work.execute" as const;

/** The single work command kind the lab evaluation world admits. */
export const LAB_WORK_COMMAND_KIND = "lab.work.execute" as const;

/**
 * The scenario-level capability that authorizes generalist-role agents to
 * execute work (lock 26: the generalist baseline is always evaluable).
 * Organization-declared capabilities authorize work for their ASSIGNEES
 * only — that split IS the least-privilege model (R20).
 */
export const LAB_GENERALIST_CAPABILITY = "lab.role.generalist" as const;

/** Tick budget bounds (E6-bounded synchronous run; the port is the seam). */
export const MIN_TICK_BUDGET = 1;
export const MAX_TICK_BUDGET = 256;

/** Evidence bundle size bounds. */
export const MIN_EVIDENCE_RECORDS = 1;
export const MAX_EVIDENCE_RECORDS = 64;

/**
 * The frozen well-known metric vocabulary this simulator can ESTIMATE.
 * Dash-slug id-text (lab-contracts `isValidIdText`: `[a-z0-9-]` only —
 * dots are NOT id-text). A suite metric outside this vocabulary is
 * honestly refused (`unmeasurable-metric`) — the simulator never
 * fabricates readings for quantities it does not model (E11 spirit).
 */
export const LAB_METRIC_IDS = Object.freeze({
  completedWork: "lab-metric-completed-work",
  progressUnits: "lab-metric-progress-units",
  estimatedThroughput: "lab-metric-estimated-throughput",
  defectsIntroduced: "lab-metric-defects-introduced",
  defectDensity: "lab-metric-defect-density",
  intentDenials: "lab-metric-intent-denials",
  commandsAdmitted: "lab-metric-commands-admitted",
  capabilityCoverage: "lab-metric-capability-coverage",
} as const);

/** Reproducibility + extent parameters of one evaluation run (E9). */
export interface LabEvaluationParameters {
  /** The evaluation seed — identical request+seed+evidence ⇒ identical results. */
  readonly seed: EvaluationSeed;
  /** How many simulation ticks the organization gets (bounded). */
  readonly tickBudget: number;
}

/**
 * The project-evidence bundle reference (R17): which immutable evidence
 * records the evaluation runs against, plus the DECLARED bundle digest.
 * The service recomputes the digest from the resolved records and refuses
 * mismatches (E8: tampered evidence digest refusal).
 */
export interface EvidenceBundleRef {
  readonly recordIds: readonly string[];
  /** Caller-declared digest of the bundle (64-hex, lab-contracts form). */
  readonly declaredDigest: ContentDigest;
}

/**
 * THE EVALUATION REQUEST (E1): candidate organization + project-evidence
 * bundle + evaluation parameters, bound as ONE typed request. The search
 * context (game/phase/genre/engine/target/deadline/task-difficulty) is an
 * INPUT DIMENSION set — the evaluation model transforms it, it never
 * hardcodes a "best organization" policy (lock 25).
 */
export interface LabEvaluationRequest {
  readonly tenant: TenantId;
  /** One owner per record (R20); the subject that admitted it. */
  readonly owner: SubjectId;
  readonly cycleId: LabCycleId;
  readonly organization: OrganizationDescriptor;
  readonly evidence: EvidenceBundleRef;
  readonly suite: LabEvaluationSuiteRef;
  readonly context: OrganizationSearchContext;
  readonly parameters: LabEvaluationParameters;
  readonly requestedAt: TimestampMs;
}

/**
 * The admitted intake record: the request's CONTENT-ADDRESSED identity
 * (the E10 idempotency key — same logical content, same id, forever) plus
 * tenant/owner scoping. Sealed on admission; never rewritten.
 */
export interface LabEvaluationIntakeRecord {
  /** Slug id `lab-eval-<54 hex>` derived from the identity digest. */
  readonly evaluationId: CandidateEvaluationId;
  /** The full 64-hex identity digest the slug id truncates. */
  readonly identityDigest: ContentDigest;
  readonly tenant: TenantId;
  readonly owner: SubjectId;
  readonly cycleId: LabCycleId;
  readonly organization: OrganizationId;
  readonly suite: LabEvaluationSuiteRef;
  readonly evidenceRecordIds: readonly string[];
  readonly evidenceBundleDigest: ContentDigest;
  readonly seed: EvaluationSeed;
  readonly tickBudget: number;
  readonly requestedAt: TimestampMs;
  readonly admittedAt: TimestampMs;
}

/** Replay artifact references captured by one evaluation run (R8). */
export interface LabReplayReferences {
  /** Content-addressed replay record id (`replay-<sha256>`). */
  readonly replayId: string;
  readonly commandStream: ReplayDigest;
  readonly eventWitness: ReplayDigest;
}

/** Deterministic run statistics (read model; inputs to metric readings). */
export interface LabRunStatistics {
  readonly ticks: number;
  readonly commandsAdmitted: number;
  readonly brokerGrants: number;
  readonly brokerDenials: number;
  readonly eventsEmitted: number;
  readonly completedWork: number;
  readonly openWork: number;
  readonly defects: number;
  readonly progressUnits: number;
  /** Fraction of scenario agents holding at least one granted work capability (0–1). */
  readonly capabilityCoverage: number;
}

/**
 * The completed evaluation run. `result` is an explicitly-labeled estimate
 * (E11): the type has no slot for an observation marker, and the runtime
 * guard refuses unlabeled or observation-marked payloads.
 */
export interface LabEvaluationRunRecord {
  readonly evaluationId: CandidateEvaluationId;
  readonly tenant: TenantId;
  readonly owner: SubjectId;
  readonly cycleId: LabCycleId;
  readonly organization: OrganizationId;
  readonly suite: LabEvaluationSuiteRef;
  readonly seed: EvaluationSeed;
  readonly simulator: string;
  readonly runAt: TimestampMs;
  readonly statistics: LabRunStatistics;
  /** EXPLICITLY LABELED ESTIMATE (E11, lock 28/29) — never ground truth. */
  readonly result: LabeledEstimate<readonly EvaluationMetricReading[]>;
  readonly replay: LabReplayReferences;
}

/**
 * The tenant-scoped aggregate the service owns: the admitted request (the
 * evaluation content), its sealed intake record (always), run + canonical
 * lab-contracts evaluation record (once evaluated). One owner per record;
 * cross-tenant reads are refused (R20).
 */
export interface StoredLabEvaluation {
  readonly request: LabEvaluationRequest;
  readonly intake: LabEvaluationIntakeRecord;
  readonly run?: LabEvaluationRunRecord;
  readonly evaluation?: CandidateEvaluationRecord;
}

/** Typed refusal codes of evaluation intake admission. */
export type LabIntakeRefusalCode =
  | "invalid-tenant"
  | "invalid-owner"
  | "invalid-cycle"
  | "invalid-organization"
  | "unknown-suite"
  | "unknown-evidence"
  | "evidence-digest-mismatch"
  | "invalid-parameters"
  | "invalid-request-time"
  | "duplicate-evaluation";

/** Result of evaluation intake admission (E10 receipt on duplicates). */
export type LabIntakeResult =
  | { readonly ok: true; readonly record: LabEvaluationIntakeRecord }
  | {
      readonly ok: false;
      readonly code: LabIntakeRefusalCode;
      readonly detail: string;
      /** The first admission, when the refusal is a duplicate (E10). */
      readonly recorded?: LabEvaluationIntakeRecord;
    };

/** Typed refusal codes of the evaluation runner. */
export type LabRunRefusalCode =
  | "intake-unknown"
  | "cross-tenant"
  | "evaluation-already-run"
  | "evidence-digest-mismatch"
  | "unmeasurable-metric"
  | "simulation-rejected"
  | "replay-unverifiable"
  | "record-refused";

/** Result of one evaluation run (E10 receipt on replays). */
export type LabRunResult =
  | { readonly ok: true; readonly run: LabEvaluationRunRecord }
  | {
      readonly ok: false;
      readonly code: LabRunRefusalCode;
      readonly detail: string;
      /** The recorded run, when one exists (E10: never re-run). */
      readonly recorded?: LabEvaluationRunRecord;
    };

/**
 * Runtime guard for the E11 estimate surface: a lab estimate result must
 * carry the labeled-estimate marker, a valid estimate method and a
 * non-empty reading payload whose entries are structurally readings.
 * Observation-marked or unlabeled values are refused (undefined).
 */
export function asLabEstimateResult(
  value: unknown,
): LabeledEstimate<readonly EvaluationMetricReading[]> | undefined {
  if (!isLabeledEstimate(value)) return undefined;
  const payload = (value as { readonly payload: unknown }).payload;
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  for (const reading of payload) {
    if (
      typeof reading !== "object" ||
      reading === null ||
      typeof (reading as Record<string, unknown>).metricId !== "string"
    ) {
      return undefined;
    }
  }
  return value as LabeledEstimate<readonly EvaluationMetricReading[]>;
}

/**
 * Loose structural guard for untyped {@link LabEvaluationRequest} input
 * (callers feeding JSON). Structural only — admission runs the full typed
 * oracle (intake.ts).
 */
export function isLabEvaluationRequest(value: unknown): value is LabEvaluationRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.tenant === "string" &&
    typeof request.owner === "string" &&
    typeof request.cycleId === "string" &&
    asLabCycleId(request.cycleId) !== undefined &&
    typeof request.organization === "object" &&
    request.organization !== null &&
    typeof request.parameters === "object" &&
    request.parameters !== null &&
    typeof (request.parameters as Record<string, unknown>).seed === "string" &&
    typeof request.requestedAt === "number" &&
    asTimestampMs(request.requestedAt) !== undefined &&
    typeof (request.evidence as Record<string, unknown> | undefined)?.declaredDigest === "string" &&
    isValidContentDigest((request.evidence as Record<string, unknown>).declaredDigest as string)
  );
}

/** Parses a slug-form evaluation id (used by read paths). */
export function asLabEvaluationId(text: string): CandidateEvaluationId | undefined {
  return asCandidateEvaluationId(text);
}

/** Parses an evaluation seed (E9 guard for read paths). */
export function asLabSeed(text: string): EvaluationSeed | undefined {
  return asEvaluationSeed(text);
}

/** Parses an organization id (used by read paths). */
export function asLabOrganizationId(text: string): OrganizationId | undefined {
  return asOrganizationId(text);
}
