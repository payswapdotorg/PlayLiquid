/**
 * INJECTED PORTS of the Lab organization compiler/search service (PL-029).
 *
 * The service owns mutable domain state (E1); everything it must NOT own as
 * ambient authority arrives through these seams, each with a deterministic
 * in-memory fake (fakes.ts) for tests and the harness:
 *
 * - {@link LabOrganizationClockPort} caller-programmed time (never Date.now);
 * - {@link BodyCatalogPort} (compile.ts) — Agent Body resolution against
 *   avatar-runtime definitions;
 * - {@link ToolCatalogPort} (compile.ts) — optional Tool Fabric resolution;
 * - {@link LabEvaluationPort} — the lab-simulation evaluation doors
 *   (structural: `LabSimulationService` satisfies it, so the search
 *   evaluates candidates through the REAL PL-028 engine);
 * - {@link LabOrganizationStore} — whole-document persistence (E6
 *   discipline: the durable store is the host's to wire).
 *
 * Async/stateful discipline (spec/worker-contract.md), binding for this
 * package: mutable state owner = the LabOrganizationService instance
 * (service.ts) — persisted through {@link LabOrganizationStore} snapshots;
 * command admission = the pure oracles (compile.ts / space.ts / search.ts /
 * evaluation.ts / gaps.ts) over caller-supplied time + owned state; event
 * order = append-only, admission order; idempotency keys = the
 * content-addressed search id, compilation digest, evaluation content key
 * and gap finding digest; stale-result rule = recorded evidence is
 * immutable and re-evaluations replay the recorded outcome (E10);
 * replay/resume = the content-addressed service document (search sessions
 * carry their stream position); retry/cancellation = refused commands
 * mutate nothing — synchronous domain, nothing to cancel.
 *
 * Pure types only.
 */

import type {
  CandidateEvaluationId,
  CapabilityGapRecord,
  ContentDigest,
  EvaluationSeed,
  LabCycleId,
  LabEvaluationSuiteRef,
  OrganizationSearchContext,
  TimestampMs,
} from "@playliquid/lab-contracts";
import type {
  LabEvaluationRequest,
  LabEvaluationRunRecord,
  LabIntakeResult,
  LabRunResult,
} from "@playliquid/lab-simulation";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import type { HostRestriction } from "@playliquid/game-contracts";
import type { BodyCatalogPort, ToolCatalogPort } from "./compile.ts";
import type { CandidateSpace, CompiledOrganization } from "./records.ts";

/** Service-level time authority (mirrors the house ClockPort shape). */
export interface LabOrganizationClockPort {
  now(): number;
}

/**
 * The lab-simulation evaluation doors (structural — satisfied by
 * `LabSimulationService`, consumed by tests/harness with that real engine).
 */
export interface LabEvaluationPort {
  admitEvaluation(request: LabEvaluationRequest): LabIntakeResult;
  runEvaluation(input: {
    readonly evaluationId: CandidateEvaluationId;
    readonly as: { readonly tenant: TenantId; readonly subject: SubjectId };
  }): LabRunResult;
}

/** Who is calling (tenant + subject claim; identity authority is elsewhere). */
export interface LabOrganizationCaller {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}

/** One stored search session (the stream position is the resume state). */
export interface StoredSearch {
  readonly searchId: string;
  readonly tenant: TenantId;
  readonly owner: SubjectId;
  readonly request: {
    readonly cycleId: LabCycleId;
    readonly context: OrganizationSearchContext;
    readonly seed: EvaluationSeed;
    readonly currentOrganization?: unknown;
    /** Host restriction applied to candidate body projections (R5). */
    readonly restriction?: HostRestriction;
  };
  /** The canonical, computed candidate space (pure, serializable). */
  readonly space: CandidateSpace;
  /** The number of candidates already emitted (cursor session position). */
  position: number;
  readonly openedAt: TimestampMs;
}

/** One stored compilation (content-addressed by the compiled digest). */
export interface StoredCompilation {
  readonly tenant: TenantId;
  readonly compiled: CompiledOrganization;
  readonly compiledAt: TimestampMs;
}

/**
 * One stored candidate evaluation (E10): the immutable evidence record —
 * the content key, the candidate it belongs to, and the recorded run (an
 * explicitly-labeled estimate, E11). Re-evaluation of the same content key
 * replays this record; it is never rewritten.
 */
export interface StoredCandidateEvidence {
  readonly contentKey: ContentDigest;
  readonly tenant: TenantId;
  readonly owner: SubjectId;
  readonly cycleId: LabCycleId;
  readonly searchId?: string;
  readonly position?: number;
  readonly candidateDigest: ContentDigest;
  readonly suite: LabEvaluationSuiteRef;
  readonly seed: EvaluationSeed;
  readonly tickBudget: number;
  readonly evaluationId: CandidateEvaluationId;
  readonly run: LabEvaluationRunRecord;
  readonly recordedAt: TimestampMs;
}

/** One recorded, typed capability-gap finding with its ladder trail. */
export interface StoredCapabilityGap {
  readonly tenant: TenantId;
  readonly gap: CapabilityGapRecord;
}

/** One persisted, content-addressed snapshot of the whole service state. */
export interface LabOrganizationDocument {
  /** Content address of this document (digest.ts discipline). */
  readonly stateDigest: string;
  readonly searches: readonly StoredSearch[];
  readonly compilations: readonly StoredCompilation[];
  readonly evidence: readonly StoredCandidateEvidence[];
  readonly gaps: readonly StoredCapabilityGap[];
}

/** Write/read port for service-document persistence (E6). */
export interface LabOrganizationStore {
  save(document: LabOrganizationDocument): void;
  load(): LabOrganizationDocument | undefined;
}

/** The port bundle the Lab organization service needs (host-injected). */
export interface LabOrganizationPorts {
  readonly clock: LabOrganizationClockPort;
  readonly bodies: BodyCatalogPort;
  readonly tools?: ToolCatalogPort;
  /** The PL-028 evaluation engine (structural: LabSimulationService satisfies it). */
  readonly evaluation: LabEvaluationPort;
  readonly store: LabOrganizationStore;
}
