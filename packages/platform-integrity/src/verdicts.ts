/**
 * VERDICT CLASSIFICATION — from aggregate risk to the frozen vocabulary
 * (PL-018, R11).
 *
 * A verdict is a classification of a report's aggregate under a policy —
 * never an identity claim. The vocabulary is the FROZEN platform-contracts
 * union (`inconclusive`, `consistent-with-declared-mode`,
 * `deviation-observed`, `pronounced-deviation-observed`): what is
 * structurally ABSENT is any "is bot"/"is human" claim — behavior
 * CONSISTENCY at a stated confidence is all this module may say.
 *
 * The classification ladder is explicit and deterministic:
 * 1. an aggregate interval at least as wide as the policy's inconclusive
 *    width → `inconclusive` (the honest first-class outcome — the
 *    evidence spans too much to classify);
 * 2. otherwise risk at or above the pronounced floor WITH a lower bound
 *    at or above the pronounced lower-bound floor → pronounced deviation;
 * 3. otherwise risk at or above the deviation floor → deviation observed;
 * 4. otherwise → consistent with the declared mode.
 *
 * The band is never asserted independently: it is DERIVED from the
 * aggregate interval by the frozen contracts classifier and the minted
 * verdict is validated against the frozen contracts validator before it
 * can enter history (E10 admission gate).
 *
 * Purity: no IO, no clocks, no randomness.
 */

import type {
  IntegrityAggregate,
  IntegrityReport,
  IntegrityReportId,
  IntegrityRiskVerdict,
  IntegrityVerdictId,
  IntegrityVerdictKind,
  SubjectId,
  TenantId,
  VerdictConfidenceBand,
  EvidenceCitation,
} from "@playliquid/platform-contracts";
import {
  PLATFORM_AUTHORITY,
  classifyVerdictConfidenceBand,
  validateIntegrityRiskVerdict,
} from "@playliquid/platform-contracts";
import type { IntegrityRiskPolicy } from "./policy.ts";

/**
 * Pure classification of one aggregate risk under one policy's verdict
 * thresholds. Deterministic ladder (see module header); the same
 * aggregate + policy always classify identically (E9).
 */
export function classifyIntegrityRisk(
  aggregate: IntegrityAggregate,
  policy: IntegrityRiskPolicy,
): IntegrityVerdictKind {
  const intervalWidth = aggregate.confidence.upperBound - aggregate.confidence.lowerBound;
  if (intervalWidth >= policy.verdictThresholds.inconclusiveIntervalWidth) {
    return "inconclusive";
  }
  if (
    aggregate.riskScore >= policy.verdictThresholds.pronouncedRiskFloor &&
    aggregate.confidence.lowerBound >= policy.verdictThresholds.pronouncedLowerBoundFloor
  ) {
    return "pronounced-deviation-observed";
  }
  if (aggregate.riskScore >= policy.verdictThresholds.deviationRiskFloor) {
    return "deviation-observed";
  }
  return "consistent-with-declared-mode";
}

/** Inputs for minting one verdict record. */
export interface VerdictMint {
  readonly verdictId: IntegrityVerdictId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  /** The report this verdict summarizes (evidence-before-verdict). */
  readonly reportRef: IntegrityReportId;
  /** The aggregate carried over from the summarized report. */
  readonly risk: IntegrityAggregate;
  readonly kind: IntegrityVerdictKind;
  /** The evidence citations behind the report (at least one). */
  readonly evidence: readonly EvidenceCitation[];
}

/**
 * Pure minting of one verdict record. The band is derived from the risk
 * interval by the frozen classifier — never caller-supplied. The result
 * is validated against the frozen contracts validator; a structurally
 * broken input throws (fail closed — a verdict that cannot validate may
 * never exist).
 */
export function mintIntegrityRiskVerdict(mint: VerdictMint): IntegrityRiskVerdict {
  const band: VerdictConfidenceBand = classifyVerdictConfidenceBand(mint.risk.confidence);
  const verdict: IntegrityRiskVerdict = {
    verdictId: mint.verdictId,
    tenant: mint.tenant,
    subject: mint.subject,
    reportRef: mint.reportRef,
    kind: mint.kind,
    risk: mint.risk,
    band,
    evidence: mint.evidence,
    decidedBy: PLATFORM_AUTHORITY,
  };
  const validation = validateIntegrityRiskVerdict(verdict);
  if (!validation.ok) {
    throw new RangeError(`verdict-mint: refused to mint an invalid verdict (${validation.code})`);
  }
  return verdict;
}

/** Returns true when `report` and `verdict` form a coherent chain. */
export function verdictFollowsReport(
  report: IntegrityReport,
  verdict: IntegrityRiskVerdict,
  policy: IntegrityRiskPolicy,
): boolean {
  if (verdict.reportRef !== report.reportId) return false;
  if (verdict.tenant !== report.tenant || verdict.subject !== report.subject) return false;
  if (verdict.risk.riskScore !== report.aggregate.riskScore) return false;
  const verdictConfidence = verdict.risk.confidence;
  const reportConfidence = report.aggregate.confidence;
  if (
    verdictConfidence.level !== reportConfidence.level ||
    verdictConfidence.lowerBound !== reportConfidence.lowerBound ||
    verdictConfidence.upperBound !== reportConfidence.upperBound
  ) {
    return false;
  }
  return verdict.kind === classifyIntegrityRisk(report.aggregate, policy);
}
