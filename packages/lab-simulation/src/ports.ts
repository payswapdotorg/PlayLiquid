/**
 * INJECTED PORTS of the Lab simulation/evaluation service (PL-028).
 *
 * The service owns mutable domain state; everything it must NOT own as
 * ambient authority arrives through these seams, each with a
 * deterministic in-memory fake (fakes.ts) for tests and the harness:
 *
 * - {@link LabClockPort}        caller-programmed time (never Date.now);
 * - {@link EvaluationSuiteResolver} (lab-contracts seam) — resolved
 *                                game-ir evaluation suites;
 * - {@link LabEvidenceLedger}   read-only immutable project evidence (R17);
 * - {@link LabObservationView}  read-only immutable observed outcomes (E10);
 * - {@link LabReplaySink}       host CAS for sealed replay records (R8);
 * - {@link LabEvaluationStore}  whole-document persistence (E6 discipline:
 *                                the durable store is the host's to wire).
 *
 * Async/stateful discipline (spec/worker-contract.md), binding for this
 * package: mutable state owner = the LabSimulationService instance
 * (service.ts) — persisted through {@link LabEvaluationStore} snapshots;
 * command admission = the intake oracle (intake.ts) then the run-once
 * oracle (runner.ts/service.ts); event order = admission order,
 * append-only; idempotency = content-addressed evaluation identity
 * (E10 duplicate receipts); stale-result rule = recorded runs are
 * immutable, re-run requests return the recorded receipt; replay/resume
 * = the content-addressed service document; retry/cancellation =
 * refused commands mutate nothing, synchronous domain, nothing to
 * cancel.
 *
 * Pure types only.
 */

import type {
  EvaluationSuiteResolver,
  ObservedOutcomeRecord,
  ProjectEvidenceRecord,
} from "@playliquid/lab-contracts";
import type { LabEvidenceLedger } from "./intake.ts";
import type { LabObservationView } from "./calibration.ts";
import type { LabReplaySink } from "./runner.ts";
import type { StoredLabEvaluation } from "./records.ts";

/** Service-level time authority (mirrors the house ClockPort shape). */
export interface LabClockPort {
  now(): number;
}

/** One persisted, content-addressed snapshot of the whole service state. */
export interface LabServiceDocument {
  /** Content address of this document (digest.ts discipline). */
  readonly stateDigest: string;
  readonly evaluations: readonly StoredLabEvaluation[];
  readonly replayIds: readonly string[];
}

/** Write/read port for service-document persistence (E6). */
export interface LabEvaluationStore {
  save(document: LabServiceDocument): void;
  load(): LabServiceDocument | undefined;
}

/** The port bundle the Lab simulation service needs (all host-injected). */
export interface LabSimulationPorts {
  readonly clock: LabClockPort;
  readonly suites: EvaluationSuiteResolver;
  readonly evidence: LabEvidenceLedger;
  readonly observations: LabObservationView;
  readonly replays: LabReplaySink;
  readonly store: LabEvaluationStore;
}

/** Structural type re-exported for fakes/tests (the evidence record view). */
export type { ProjectEvidenceRecord, ObservedOutcomeRecord };
