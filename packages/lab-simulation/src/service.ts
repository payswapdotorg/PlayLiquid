/**
 * THE LAB SIMULATION SERVICE (PL-028) — the single mutable-state owner
 * (E1) of the Lab loop's simulation/evaluation stage.
 *
 * The service instance owns the tenant-scoped evaluation table (admitted
 * requests + sealed intake records + run records + canonical
 * lab-contracts evaluation records) and the captured replay id set.
 * EVERYTHING else is a host-injected port (ports.ts): time, suites,
 * evidence, observations, replay CAS, persistence.
 *
 * Discipline (spec/worker-contract.md), owned and tested here:
 * - command admission: `admitEvaluation` runs the pure intake oracle
 *   (intake.ts) over caller-supplied time + owned state; `runEvaluation`
 *   runs the pure runner (runner.ts) ONCE per evaluation — the recorded
 *   run is immutable and re-runs return the recorded receipt (E10);
 * - idempotency: the content-addressed evaluation identity is the
 *   idempotency key; duplicate admissions return the first intake
 *   record (E10 receipt), never a second record;
 * - tenant isolation (R20): every operation that names an evaluation
 *   checks `checkTenantIsolation` (platform-contracts authority —
 *   consumed, never re-implemented); cross-tenant access is a typed
 *   refusal, never a silent fallback (E8);
 * - tamper re-check at run time (E8): the evidence bundle digest is
 *   RECOMPUTED from the resolved ledger records before every run —
 *   evidence mutated after admission refuses the run;
 * - persistence: every mutation snapshots the whole document
 *   content-addressed through {@link LabEvaluationStore} (E6 — the
 *   durable store is the host's to wire);
 * - calibration: `calibrate` derives a conclusion from immutable
 *   observations (calibration.ts) and RETURNS it — the host appends it
 *   to the observation ledger (append-only, E10); this service never
 *   writes an observation.
 *
 * Pure domain: no IO, no timers, no globals; synchronous refusals
 * mutate nothing.
 */

import type { CandidateEvaluationId, ProjectEvidenceRecord } from "@playliquid/lab-contracts";
import { recordCandidateEvaluation } from "@playliquid/lab-contracts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import { checkTenantIsolation } from "@playliquid/platform-contracts";
import { admitLabEvaluation } from "./intake.ts";
import { calibrateLabEvaluation } from "./calibration.ts";
import type { LabCalibrationRefusalCode, LabCalibrationResult } from "./calibration.ts";
import { runLabEvaluation } from "./runner.ts";
import type { LabSimulationPorts } from "./ports.ts";
import type { LabServiceDocument } from "./ports.ts";
import type {
  LabEvaluationRequest,
  LabIntakeResult,
  LabRunRefusalCode,
  LabRunResult,
  StoredLabEvaluation,
} from "./records.ts";
import { evidenceBundleDigestOf } from "./digest.ts";
import { labServiceStateDigestOf } from "./digest.ts";

/** Who is calling (tenant + subject claim; identity authority is elsewhere). */
export interface LabCaller {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}

/** Result of tenant-scoped reads. */
export type LabReadResult =
  | { readonly ok: true; readonly stored: StoredLabEvaluation }
  | { readonly ok: false; readonly code: "intake-unknown" | "cross-tenant"; readonly detail: string };

/** Construction options. */
export interface LabSimulationServiceOptions {
  readonly ports: LabSimulationPorts;
}

/** The service. Construct with injected ports; drive through the doors. */
export class LabSimulationService {
  private readonly ports: LabSimulationPorts;
  private readonly evaluations = new Map<string, StoredLabEvaluation>();
  private readonly replayIds: string[] = [];

  constructor(options: LabSimulationServiceOptions) {
    this.ports = options.ports;
  }

  /** E1 admission: one request → one sealed intake record (E10 receipt on duplicates). */
  admitEvaluation(request: LabEvaluationRequest): LabIntakeResult {
    const known = [...this.evaluations.values()].map((stored) => stored.intake);
    const result = admitLabEvaluation({
      request,
      ports: { suites: this.ports.suites, evidence: this.ports.evidence },
      admittedAt: this.ports.clock.now(),
      known,
    });
    if (result.ok) {
      this.evaluations.set(String(result.record.evaluationId), {
        request,
        intake: result.record,
      });
      this.persist();
    }
    return result;
  }

  /**
   * Runs an admitted evaluation ONCE (E10): the recorded run is immutable;
   * a second run request returns the recorded receipt. Tenant-scoped
   * (R20); evidence tamper is re-checked before the run starts (E8).
   */
  runEvaluation(input: {
    readonly evaluationId: CandidateEvaluationId;
    readonly as: LabCaller;
  }): LabRunResult {
    const stored = this.evaluations.get(String(input.evaluationId));
    if (stored === undefined) {
      return refuse("intake-unknown", `evaluation ${String(input.evaluationId)} was never admitted`);
    }
    const isolation = checkTenantIsolation(input.as, stored.intake);
    if (!isolation.ok) {
      return refuse(
        "cross-tenant",
        `subject ${String(input.as.subject)} of tenant ${String(isolation.requestTenant)} cannot access evaluation ${String(input.evaluationId)} of tenant ${String(isolation.resourceTenant)} (R20)`,
      );
    }
    if (stored.run !== undefined) {
      return {
        ok: false,
        code: "evaluation-already-run",
        detail: `evaluation ${String(input.evaluationId)} already ran (E10: recorded runs are immutable)`,
        recorded: stored.run,
      };
    }

    const suite = this.ports.suites(stored.request.suite);
    if (suite === undefined) {
      return refuse("simulation-rejected", "suite reference no longer resolves — the pinned suite is unavailable");
    }
    const resolved: ProjectEvidenceRecord[] = [];
    for (const recordId of stored.intake.evidenceRecordIds) {
      const record = this.ports.evidence(recordId);
      if (record === undefined) {
        return refuse("evidence-digest-mismatch", `evidence record ${recordId} is no longer in the ledger`);
      }
      resolved.push(record);
    }
    const recomputed = evidenceBundleDigestOf(resolved);
    if (recomputed !== stored.intake.evidenceBundleDigest) {
      return refuse(
        "evidence-digest-mismatch",
        `resolved evidence records no longer match the admitted bundle digest (tampered evidence is refused, E8)`,
      );
    }

    const run = runLabEvaluation({
      intake: stored.intake,
      organization: stored.request.organization,
      context: stored.request.context,
      evidence: resolved,
      suite,
      runAt: this.ports.clock.now(),
      replaySink: this.ports.replays,
    });
    if (!run.ok) {
      return run;
    }

    const evaluation = recordCandidateEvaluation({
      evaluationId: stored.intake.evaluationId,
      cycleId: stored.intake.cycleId,
      organization: stored.intake.organization,
      suite: stored.intake.suite,
      seed: stored.intake.seed,
      result: run.run.result,
      evaluatedAt: run.run.runAt,
    });
    if (!evaluation.ok) {
      return refuse("record-refused", `canonical evaluation record refused: ${evaluation.code}: ${evaluation.detail}`);
    }

    this.evaluations.set(String(stored.intake.evaluationId), {
      request: stored.request,
      intake: stored.intake,
      run: run.run,
      evaluation: evaluation.record,
    });
    this.replayIds.push(run.run.replay.replayId);
    this.persist();
    return run;
  }

  /** Tenant-scoped read of one stored evaluation (R20). */
  getEvaluation(evaluationId: CandidateEvaluationId, as: LabCaller): LabReadResult {
    const stored = this.evaluations.get(String(evaluationId));
    if (stored === undefined) {
      return { ok: false, code: "intake-unknown", detail: `evaluation ${String(evaluationId)} was never admitted` };
    }
    const isolation = checkTenantIsolation(as, stored.intake);
    if (!isolation.ok) {
      return {
        ok: false,
        code: "cross-tenant",
        detail: `subject ${String(as.subject)} of tenant ${String(isolation.requestTenant)} cannot read evaluation ${String(evaluationId)} of tenant ${String(isolation.resourceTenant)} (R20)`,
      };
    }
    return { ok: true, stored };
  }

  /** Tenant-scoped listing (summaries only — R20). */
  listEvaluations(as: LabCaller): readonly {
    readonly evaluationId: CandidateEvaluationId;
    readonly cycleId: StoredLabEvaluation["intake"]["cycleId"];
    readonly organization: StoredLabEvaluation["intake"]["organization"];
    readonly hasRun: boolean;
  }[] {
    return [...this.evaluations.values()]
      .filter((stored) => checkTenantIsolation(as, stored.intake).ok)
      .map((stored) => ({
        evaluationId: stored.intake.evaluationId,
        cycleId: stored.intake.cycleId,
        organization: stored.intake.organization,
        hasRun: stored.run !== undefined,
      }));
  }

  /**
   * Derives (and returns, never appends) the calibration conclusion of a
   * RUN evaluation against immutable observed outcomes (E10). The host
   * appends the conclusion to its observation ledger.
   */
  calibrate(input: {
    readonly evaluationId: CandidateEvaluationId;
    readonly as: LabCaller;
    readonly observedOutcomeIds: readonly string[];
  }): LabCalibrationResult {
    const stored = this.evaluations.get(String(input.evaluationId));
    if (stored === undefined) {
      return calibrationRefuse("intake-unknown", `evaluation ${String(input.evaluationId)} was never admitted`);
    }
    const isolation = checkTenantIsolation(input.as, stored.intake);
    if (!isolation.ok) {
      return calibrationRefuse(
        "cross-tenant",
        `subject ${String(input.as.subject)} of tenant ${String(isolation.requestTenant)} cannot calibrate evaluation ${String(input.evaluationId)} of tenant ${String(isolation.resourceTenant)} (R20)`,
      );
    }
    if (stored.run === undefined) {
      return calibrationRefuse("run-missing", `evaluation ${String(input.evaluationId)} has not been run — nothing to calibrate yet`);
    }
    return calibrateLabEvaluation({
      run: stored.run,
      observedOutcomeIds: input.observedOutcomeIds,
      observations: this.ports.observations,
      calibratedAt: this.ports.clock.now(),
    });
  }

  /** The current content-addressed service document (persistence view). */
  document(): LabServiceDocument {
    const evaluations = [...this.evaluations.values()];
    const replayIds = [...this.replayIds];
    return {
      stateDigest: String(labServiceStateDigestOf({ evaluations, replayIds })),
      evaluations,
      replayIds,
    };
  }

  /** Restores the whole document from the store (E6 snapshot restore). */
  restore(): { readonly ok: true; readonly count: number } | { readonly ok: false; readonly detail: string } {
    const loaded = this.ports.store.load();
    if (loaded === undefined) {
      return { ok: false, detail: "no persisted document to restore" };
    }
    this.evaluations.clear();
    for (const stored of loaded.evaluations) {
      this.evaluations.set(String(stored.intake.evaluationId), stored);
    }
    this.replayIds.length = 0;
    for (const replayId of loaded.replayIds) {
      this.replayIds.push(replayId);
    }
    return { ok: true, count: this.evaluations.size };
  }

  /** Snapshot into the store (content-addressed, idempotent by bytes). */
  private persist(): void {
    this.ports.store.save(this.document());
  }
}

function refuse(code: LabRunRefusalCode, detail: string): LabRunResult {
  return { ok: false, code, detail };
}

function calibrationRefuse(code: LabCalibrationRefusalCode, detail: string): LabCalibrationResult {
  return { ok: false, code, detail };
}
