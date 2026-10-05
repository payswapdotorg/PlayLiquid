/**
 * COMPETITIVE INTEGRITY CONTRACTS (R7 / lock 17; R11 / E11; lock 29).
 *
 * "GameOS exposes probabilistic competitive-integrity evidence."
 * "Simulator output is not ground truth."
 * "Competitive-integrity signals are evidence/confidence, not magical
 * certainty."
 *
 * Encoding:
 * - Every quantitative statement is a {@link ConfidenceInterval} with
 *   verified bounds (0 <= lower <= upper <= 1, level in (0,1]).
 * - Every {@link IntegritySignal} MUST carry evidence references
 *   ({@link IntegrityEvidenceRef}) — replay artifacts, QA runs or session
 *   telemetry (E11: typed integrity report surfaces replaying QA/replay
 *   evidence). A signal without evidence fails validation.
 * - {@link IntegrityReport} has NO verdict field, and its guard
 *   REJECTS any object carrying one of the forbidden certainty fields
 *   (`verdict`, `certain`, `isCheating`, `cheater`, `guilty`):
 *   {@link FORBIDDEN_INTEGRITY_FIELDS}. Certainty is unrepresentable.
 * - Enforcement is policy-driven elsewhere ({@link IntegrityEnforcement}
 *   mirrors the game's declaration); reports only surface evidence.
 * - Explicit AI-player modes are first-class ({@link AiPlayMode}) —
 *   AI-assisted play is a mode to surface, not a verdict to smuggle in.
 *
 * Purity: pure types + pure guards + a pure aggregator/validator. No IO,
 * no clocks, no randomness — no "detection" happens here at all.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { ContentDigest, SubjectId, TenantId, PlatformAuthorityMarker } from "./primitives.ts";
import type { ReplayId } from "./replay.ts";
import type { GameEventKind } from "./events.ts";

/** Identifier of one integrity report. */
export type IntegrityReportId = Brand<string, "IntegrityReportId">;

/** Parses and validates `text` as an {@link IntegrityReportId}. */
export function asIntegrityReportId(text: string): IntegrityReportId | undefined {
  return isValidIdText(text) ? (text as IntegrityReportId) : undefined;
}

// ---------------------------------------------------------------------------
// Confidence shapes (R11: probabilistic, never certain)
// ---------------------------------------------------------------------------

/** A verified confidence statement: bounds within [0,1], lower <= upper. */
export interface ConfidenceInterval {
  /** Confidence level the interval is stated at, in (0, 1]. */
  readonly level: number;
  readonly lowerBound: number;
  readonly upperBound: number;
}

/** Pure bounds check for a {@link ConfidenceInterval}-shaped value. */
export function isValidConfidenceInterval(value: unknown): value is ConfidenceInterval {
  if (typeof value !== "object" || value === null) return false;
  const interval = value as Record<string, unknown>;
  const { level, lowerBound, upperBound } = interval;
  if (typeof level !== "number" || typeof lowerBound !== "number" || typeof upperBound !== "number") {
    return false;
  }
  if (!Number.isFinite(level) || !Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) {
    return false;
  }
  return level > 0 && level <= 1 && lowerBound >= 0 && upperBound <= 1 && lowerBound <= upperBound;
}

// ---------------------------------------------------------------------------
// Evidence references (E11: replay/QA-shaped evidence)
// ---------------------------------------------------------------------------

/** Discriminated evidence sources an integrity signal may cite. */
export type IntegrityEvidenceRef =
  | { readonly source: "replay"; readonly replayId: ReplayId; readonly digest: ContentDigest }
  | { readonly source: "qa-run"; readonly runDigest: ContentDigest }
  | { readonly source: "session-telemetry"; readonly digest: ContentDigest };

/** Returns true when `value` is a structurally valid {@link IntegrityEvidenceRef}. */
export function isIntegrityEvidenceRef(value: unknown): value is IntegrityEvidenceRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  const digestLike = (candidate: unknown): boolean =>
    typeof candidate === "string" && /^[0-9a-f]{64}$/.test(candidate);
  if (ref.source === "replay") {
    return typeof ref.replayId === "string" && ref.replayId.length > 0 && digestLike(ref.digest);
  }
  if (ref.source === "qa-run") return digestLike(ref.runDigest);
  if (ref.source === "session-telemetry") return digestLike(ref.digest);
  return false;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** Behavioral signal kinds (mirrors game-contracts `IntegrityPolicy.signals`). */
export type IntegritySignalKind = "behavioral" | "timing" | "trajectory" | "outcome";

/** All valid {@link IntegritySignalKind} values. */
export const INTEGRITY_SIGNAL_KINDS: readonly IntegritySignalKind[] = Object.freeze([
  "behavioral",
  "timing",
  "trajectory",
  "outcome",
]);

/** Returns true when `value` is a valid {@link IntegritySignalKind}. */
export function isIntegritySignalKind(value: unknown): value is IntegritySignalKind {
  return typeof value === "string" && (INTEGRITY_SIGNAL_KINDS as readonly string[]).includes(value);
}

/** Explicit AI-player modes (architecture "Competitive Integrity"). */
export type AiPlayMode = "human" | "ai-assisted" | "ai-autonomous";

/** All valid {@link AiPlayMode} values. */
export const AI_PLAY_MODES: readonly AiPlayMode[] = Object.freeze([
  "human",
  "ai-assisted",
  "ai-autonomous",
]);

/** Returns true when `value` is a valid {@link AiPlayMode}. */
export function isAiPlayMode(value: unknown): value is AiPlayMode {
  return typeof value === "string" && (AI_PLAY_MODES as readonly string[]).includes(value);
}

/**
 * One probabilistic integrity signal: a kind, a weight in [0,1], the
 * signal's estimated risk contribution in [0,1], a verified confidence
 * interval and at least one evidence reference.
 */
export interface IntegritySignal {
  readonly kind: IntegritySignalKind;
  readonly weight: number;
  readonly riskContribution: number;
  readonly confidence: ConfidenceInterval;
  readonly evidence: readonly IntegrityEvidenceRef[];
}

// ---------------------------------------------------------------------------
// Report shape + forbidden certainty fields
// ---------------------------------------------------------------------------

/** Fields that would smuggle certainty into an integrity report. */
export const FORBIDDEN_INTEGRITY_FIELDS: readonly string[] = Object.freeze([
  "verdict",
  "certain",
  "certainly",
  "isCheating",
  "isCheater",
  "cheater",
  "guilty",
  "convicted",
]);

/** Returns true when `key` is a forbidden certainty field name. */
export function isForbiddenIntegrityField(key: string): boolean {
  return (FORBIDDEN_INTEGRITY_FIELDS as readonly string[]).includes(key);
}

/** Enforcement posture a report is issued under (mirrors the game declaration). */
export type IntegrityEnforcement = "report-only" | "policy-driven";

/** The aggregate of a report: a risk score in [0,1] with a confidence interval. */
export interface IntegrityAggregate {
  readonly riskScore: number;
  readonly confidence: ConfidenceInterval;
}

/** An integrity report: evidence/confidence only — never a verdict (R11). */
export interface IntegrityReport {
  readonly reportId: IntegrityReportId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly playMode: AiPlayMode;
  readonly signals: readonly IntegritySignal[];
  readonly aggregate: IntegrityAggregate;
  readonly enforcement: IntegrityEnforcement;
  readonly decidedBy: PlatformAuthorityMarker;
}

/** Returns true when `value` is structurally a valid {@link IntegrityReport}. */
export function isIntegrityReport(value: unknown): value is IntegrityReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Record<string, unknown>;
  for (const key of Object.keys(report)) {
    if (isForbiddenIntegrityField(key)) return false;
  }
  if (typeof report.reportId !== "string" || report.reportId.length === 0) return false;
  if (typeof report.subject !== "string" || report.subject.length === 0) return false;
  if (!isAiPlayMode(report.playMode)) return false;
  if (report.decidedBy !== "platform-authority") return false;
  if (report.enforcement !== "report-only" && report.enforcement !== "policy-driven") return false;
  // Structural guard allows an empty signals array; the semantic
  // validator (validateIntegrityReport) rejects it with the distinct
  // `empty-signals` code.
  if (!Array.isArray(report.signals)) return false;
  const aggregate = report.aggregate as Record<string, unknown> | undefined;
  if (typeof aggregate !== "object" || aggregate === null) return false;
  if (typeof aggregate.riskScore !== "number" || !Number.isFinite(aggregate.riskScore)) return false;
  if (aggregate.riskScore < 0 || aggregate.riskScore > 1) return false;
  return isValidConfidenceInterval(aggregate.confidence);
}

// ---------------------------------------------------------------------------
// Pure aggregation and validation
// ---------------------------------------------------------------------------

/**
 * Pure, conservative signal aggregation. riskScore is the weight-normalized
 * blend of risk contributions, clipped to [0,1]. The aggregate confidence
 * interval is the WIDEST honest range spanned by the signals' intervals
 * (never tighter than the evidence; level = weakest stated level).
 * Signals with zero total weight yield riskScore 0 with a [0,1] interval.
 */
export function aggregateIntegritySignals(
  signals: readonly IntegritySignal[],
): IntegrityAggregate {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (totalWeight <= 0 || signals.length === 0) {
    return { riskScore: 0, confidence: { level: 1, lowerBound: 0, upperBound: 1 } };
  }
  const riskScore = signals.reduce((sum, signal) => sum + signal.weight * signal.riskContribution, 0) / totalWeight;
  const lowerBound = Math.min(...signals.map((signal) => signal.confidence.lowerBound));
  const upperBound = Math.max(...signals.map((signal) => signal.confidence.upperBound));
  const level = Math.min(...signals.map((signal) => signal.confidence.level));
  return { riskScore: Math.min(1, Math.max(0, riskScore)), confidence: { level, lowerBound, upperBound } };
}

/** Result of {@link validateIntegrityReport}. */
export type IntegrityReportValidation =
  | { readonly ok: true; readonly riskScore: number }
  | {
      readonly ok: false;
      readonly code:
        | "certainty-claimed"
        | "malformed-report"
        | "invalid-confidence-interval"
        | "signal-without-evidence"
        | "empty-signals"
        | "aggregate-mismatch";
    };

/**
 * Pure report validator (R11/E11 negative coverage). Rejects with typed
 * codes: any forbidden certainty field present (`certainty-claimed` —
 * certainty is unrepresentable), structural malformation, any invalid
 * signal confidence interval (`invalid-confidence-interval`), any signal
 * citing no evidence (`signal-without-evidence` — an unevidenced signal
 * is inadmissible), no signals at all (`empty-signals`), and an aggregate
 * that disagrees with a recomputation from the signals
 * (`aggregate-mismatch` — the aggregate may never look stronger than the
 * evidence it summarizes).
 */
export function validateIntegrityReport(value: unknown): IntegrityReportValidation {
  if (typeof value !== "object" || value === null) return { ok: false, code: "malformed-report" };
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.some((key) => isForbiddenIntegrityField(key))) {
    return { ok: false, code: "certainty-claimed" };
  }
  // Signal-level checks run BEFORE the full structural guard so a broken
  // SIGNAL is reported precisely instead of surfacing as a malformed
  // aggregate (the guard re-derives its aggregate check from the signals).
  const signals = (value as { signals?: unknown }).signals;
  if (Array.isArray(signals)) {
    for (const candidate of signals) {
      const signal = candidate as { confidence?: unknown; evidence?: unknown };
      if (!isValidConfidenceInterval(signal.confidence)) {
        return { ok: false, code: "invalid-confidence-interval" };
      }
      if (!Array.isArray(signal.evidence) || signal.evidence.length === 0) {
        return { ok: false, code: "signal-without-evidence" };
      }
    }
  }
  if (!isIntegrityReport(value)) return { ok: false, code: "malformed-report" };
  if (value.signals.length === 0) return { ok: false, code: "empty-signals" };
  const recomputed = aggregateIntegritySignals(value.signals);
  const stated = value.aggregate;
  const tolerancesMatch =
    Math.abs(recomputed.riskScore - stated.riskScore) < 1e-9 &&
    Math.abs(recomputed.confidence.lowerBound - stated.confidence.lowerBound) < 1e-9 &&
    Math.abs(recomputed.confidence.upperBound - stated.confidence.upperBound) < 1e-9 &&
    Math.abs(recomputed.confidence.level - stated.confidence.level) < 1e-9;
  if (!tolerancesMatch) return { ok: false, code: "aggregate-mismatch" };
  return { ok: true, riskScore: stated.riskScore };
}

// ---------------------------------------------------------------------------
// Game-side event binding (lock 18)
// ---------------------------------------------------------------------------

/**
 * How a game declares one of ITS events as integrity-relevant (its
 * streams may be analyzed for the declared signal kinds).
 */
export interface IntegrityEventBinding {
  readonly capability: "integrity";
  readonly eventKind: GameEventKind;
}

/** Returns true when `value` is a structurally valid {@link IntegrityEventBinding}. */
export function isIntegrityEventBinding(value: unknown): value is IntegrityEventBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return binding.capability === "integrity" && typeof binding.eventKind === "string" && binding.eventKind.length > 0;
}
