/**
 * EVIDENCE READ MODELS (pure): project lab-organization's immutable
 * candidate-evidence records (StoredCandidateEvidence over PL-028
 * LabEvaluationRunRecord) into typed view models for the workbench's
 * Evidence surface.
 *
 * E10 visibility: the evidence ledger renders as an append-only history
 * view — rows enumerate in recording order (recordedAt, then content key
 * for determinism), every row carries its content-addressed key, and the
 * view states the immutability rule outright. Nothing here can rewrite,
 * reorder or drop a record.
 *
 * E11 visibility: every evaluation result is a labeled estimate; the
 * row's `method` comes verbatim from the run's `result.method` and the
 * epistemic chip is fixed to the labeled-estimate class — evaluation
 * output is NEVER rendered as observed fact.
 *
 * Pure module: no IO, no React, no clock.
 */

import type { StoredCandidateEvidence } from "../../../../lab-organization/src/index.ts";

/** One immutable evidence record row (append-only ledger, E10). */
export interface EvidenceRowView {
  /** Content-addressed evidence key (the E10 idempotency identity). */
  readonly contentKey: string;
  readonly evaluationId: string;
  readonly cycleId: string;
  readonly candidateDigest: string;
  readonly suite: string;
  /** The evaluation's reproducibility seed (E9 — rendered, never hidden). */
  readonly seed: string;
  readonly tickBudget: number;
  /** Fixed: PL-028 run results are labeled estimates by type (E11). */
  readonly epistemic: "labeled-estimate";
  /** The estimate method, verbatim from the run's labeled-estimate result. */
  readonly method: string;
  readonly simulator: string;
  readonly completedWork: number;
  readonly defects: number;
  readonly commandsAdmitted: number;
  readonly capabilityCoverage: number;
  readonly replayId: string;
  readonly runAt: number;
  readonly recordedAt: number;
}

/** The Evidence surface: the append-only ledger view. */
export interface EvidenceView {
  readonly rows: readonly EvidenceRowView[];
  readonly count: number;
  /** Sorted distinct estimate methods present in the ledger (E11). */
  readonly methodSet: readonly string[];
  /** Always true — rendered so the immutability rule is visible (E10). */
  readonly appendOnly: true;
}

/** Short content digest (keeps the `sha256:` prefix, 12 hex). */
function shortDigest(digest: string): string {
  const bare = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `sha256:${bare.slice(0, 12)}`;
}

/**
 * Project the stored evidence records into the ledger view. Recording
 * order is (recordedAt, contentKey) — deterministic, append-faithful.
 */
export function projectEvidence(
  evidence: readonly StoredCandidateEvidence[],
): EvidenceView {
  const rows = [...evidence]
    .sort(
      (a, b) => a.recordedAt - b.recordedAt || String(a.contentKey).localeCompare(String(b.contentKey)),
    )
    .map((record): EvidenceRowView => {
      const run = record.run;
      return {
        contentKey: shortDigest(String(record.contentKey)),
        evaluationId: String(run.evaluationId),
        cycleId: String(record.cycleId),
        candidateDigest: shortDigest(String(record.candidateDigest)),
        suite: String(record.suite),
        seed: String(record.seed),
        tickBudget: record.tickBudget,
        epistemic: run.result.epistemic,
        method: run.result.method,
        simulator: run.simulator,
        completedWork: run.statistics.completedWork,
        defects: run.statistics.defects,
        commandsAdmitted: run.statistics.commandsAdmitted,
        capabilityCoverage: run.statistics.capabilityCoverage,
        replayId: run.replay.replayId,
        runAt: run.runAt,
        recordedAt: record.recordedAt,
      } satisfies EvidenceRowView;
    });
  const methodSet = [...new Set(rows.map((row) => row.method))].sort();
  return {
    rows,
    count: rows.length,
    methodSet,
    appendOnly: true,
  } satisfies EvidenceView;
}

/** Deterministic summary line ("N evidence records · methods: …"). */
export function evidenceSummary(view: EvidenceView): string {
  const methods = view.methodSet.length === 0 ? "none" : view.methodSet.join(", ");
  return `${view.count} record${view.count === 1 ? "" : "s"} · append-only (E10) · estimates: ${methods}`;
}
