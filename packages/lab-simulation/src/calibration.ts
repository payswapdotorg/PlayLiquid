/**
 * THE CALIBRATION SEAM (E10, lock rule 27) — the typed port where the Lab
 * loop's `calibration` stage consumes the simulation/evaluation stage's
 * output.
 *
 * Discipline (all enforced here, all negatively tested):
 *
 * - observations are IMMUTABLE: the port ({@link LabObservationView}) is
 *   read-only; this module has NO operation that can rewrite, revise or
 *   remove an observed outcome — the only write anywhere is the
 *   APPEND of a derived conclusion, delegated to lab-contracts'
 *   `appendCalibrationConclusion` (which carries the observations array
 *   over by reference — the append-only proof);
 * - calibration DERIVES from observations: every referenced observation
 *   id must resolve through the port BEFORE any conclusion exists, and
 *   must belong to the same Lab cycle as the evaluation;
 * - E11 travels with the estimate: the run record being calibrated must
 *   still carry its labeled-estimate marker — a stripped or forged
 *   result is refused (`estimate-label-missing`); the derived conclusion
 *   describes the estimate AS an estimate and the observations AS
 *   observations, in one canonical statement;
 * - idempotency (E10 receipt): the conclusion id is content-addressed —
 *   the same evaluation + observation set + time derives the same
 *   conclusion, and appending it twice is the lab-contracts duplicate
 *   refusal, surfaced as {@link LabCalibrationAppendResult}.
 *
 * Pure module: no IO, no clocks (calibratedAt is caller-supplied), no
 * state — the ledger fold is delegated to the contracts authority.
 */

import type {
  CalibrationConclusion,
  LabCycleId,
  ObservedOutcomeRecord,
  ObservationLedger,
} from "@playliquid/lab-contracts";
import { appendCalibrationConclusion, asCalibrationId, isLabeledEstimate } from "@playliquid/lab-contracts";
import { canonicalJson } from "@playliquid/package-system";
import type { LabEvaluationRunRecord } from "./records.ts";
import { jsonSafeOf, labDigestOf } from "./digest.ts";

/** Read-only observed-outcome lookup (the immutable E10 view). */
export type LabObservationView = (observationId: string) => ObservedOutcomeRecord | undefined;

/** The typed refusal codes of calibration derivation (service-aware). */
export type LabCalibrationRefusalCode =
  | "invalid-run"
  | "estimate-label-missing"
  | "unknown-observation"
  | "cycle-mismatch"
  | "invalid-request-time"
  | "intake-unknown"
  | "cross-tenant"
  | "run-missing";

/** Result of deriving a calibration conclusion. */
export type LabCalibrationResult =
  | { readonly ok: true; readonly conclusion: CalibrationConclusion }
  | { readonly ok: false; readonly code: LabCalibrationRefusalCode; readonly detail: string };

/** Result of appending a derived conclusion to a host ledger (E10 fold). */
export type LabCalibrationAppendResult = ReturnType<typeof appendCalibrationConclusion>;

/** The reviewable statement a conclusion carries (canonical JSON form). */
export interface LabCalibrationStatement {
  readonly estimate: {
    readonly evaluationId: string;
    readonly simulator: string;
    readonly method: string;
    readonly metrics: readonly { readonly metricId: string; readonly kind: string }[];
  };
  readonly observations: readonly { readonly observationId: string; readonly release: string; readonly observedAt: number }[];
  readonly cycleId: string;
  readonly calibratedAt: number;
}

/**
 * Derives the calibration conclusion of one evaluation run against a set
 * of immutable observed outcomes. The conclusion is RETURNED, never
 * appended here — the host appends it via
 * {@link appendLabCalibrationConclusion} (or lab-contracts directly).
 */
export function calibrateLabEvaluation(input: {
  readonly run: LabEvaluationRunRecord;
  readonly observedOutcomeIds: readonly string[];
  readonly observations: LabObservationView;
  /** Caller-supplied derivation time, in ms (no clock authority). */
  readonly calibratedAt: number;
}): LabCalibrationResult {
  const { run, observedOutcomeIds, observations } = input;
  if (typeof run.evaluationId !== "string" || run.evaluationId.length === 0) {
    return refuse("invalid-run", "run record has no evaluation id");
  }
  if (!isLabeledEstimate(run.result)) {
    return refuse(
      "estimate-label-missing",
      "run result no longer carries the labeled-estimate marker (E11) — a stripped or forged estimate cannot be calibrated",
    );
  }
  const calibratedAt = Number(input.calibratedAt);
  if (!Number.isSafeInteger(calibratedAt) || calibratedAt < 0) {
    return refuse("invalid-request-time", "calibratedAt must be a safe integer millisecond value");
  }

  const ids = [...new Set(observedOutcomeIds)].sort();
  if (ids.length === 0) {
    return refuse("unknown-observation", "calibration must cite at least one observed outcome");
  }
  const resolved: ObservedOutcomeRecord[] = [];
  for (const id of ids) {
    const observation = observations(id);
    if (observation === undefined) {
      return refuse("unknown-observation", `observed outcome ${id} is not in the ledger (immutable observations only)`);
    }
    resolved.push(observation);
  }
  for (const observation of resolved) {
    if (observation.cycleId !== (run.cycleId as LabCycleId)) {
      return refuse(
        "cycle-mismatch",
        `observed outcome ${String(observation.observationId)} belongs to cycle ${String(observation.cycleId)}, the evaluation ran in ${String(run.cycleId)} — calibration stays within one Lab cycle`,
      );
    }
  }
  const statement: LabCalibrationStatement = {
    estimate: {
      evaluationId: String(run.evaluationId),
      simulator: run.simulator,
      method: run.result.method,
      metrics: run.result.payload.map((reading) => ({ metricId: String(reading.metricId), kind: reading.value.kind })),
    },
    observations: resolved.map((observation) => ({
      observationId: String(observation.observationId),
      release: String(observation.release),
      observedAt: Number(observation.observedAt),
    })),
    cycleId: String(run.cycleId),
    calibratedAt,
  };
  const statementText = canonicalJson(jsonSafeOf(statement));
  const conclusion: CalibrationConclusion = {
    calibrationId: deriveCalibrationId(run.evaluationId, ids, calibratedAt),
    cycleId: run.cycleId,
    derivedFrom: Object.freeze(resolved.map((observation) => observation.observationId)),
    statement: statementText,
  };
  return { ok: true, conclusion };
}

/**
 * Appends a derived conclusion to a host observation ledger — the ONLY
 * write this package participates in, and it is the lab-contracts
 * append-only fold (observations carried over by reference). Duplicate
 * ids and conclusions citing unknown observations are typed refusals.
 */
export function appendLabCalibrationConclusion(
  ledger: ObservationLedger,
  conclusion: CalibrationConclusion,
): LabCalibrationAppendResult {
  return appendCalibrationConclusion(ledger, conclusion);
}

/** Content-addressed conclusion id: `lab-cal-<54 hex of the derivation>` (E9; 62 chars — id-text caps at 63). */
function deriveCalibrationId(evaluationId: string, observationIds: readonly string[], calibratedAt: number): CalibrationConclusion["calibrationId"] {
  const digest = labDigestOf({
    evaluationId,
    derivedFrom: observationIds,
    calibratedAt,
  });
  const slug = `lab-cal-${String(digest).slice(0, 54)}`;
  const parsed = asCalibrationId(slug);
  if (parsed === undefined) {
    // Canonical prefix + hex slice — unreachable by construction.
    throw new Error(`lab-simulation: derived calibration id failed to parse: ${slug}`);
  }
  return parsed;
}

function refuse(code: LabCalibrationRefusalCode, detail: string): LabCalibrationResult {
  return { ok: false, code, detail };
}
