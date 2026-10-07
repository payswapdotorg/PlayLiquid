/**
 * INTEGRITY RISK VERDICT CONTRACTS (R11 refinement, PL-009).
 *
 * "The system never claims perfect detection." A verdict here is a FROZEN
 * risk vocabulary plus an EXPLICIT confidence band — never a certainty
 * claim. The forbidden-field discipline from integrity.ts
 * ({@link FORBIDDEN_INTEGRITY_FIELDS}) is extended for verdict records by
 * {@link FORBIDDEN_VERDICT_FIELDS}: no `isBot`, no `isHuman`, no boolean
 * of guilt or innocence may even be REPRESENTED on a verdict.
 *
 * Chain of custody (E11): a verdict cites the integrity REPORT it
 * summarizes ({@link IntegrityRiskVerdict.reportRef}) and the behavioral
 * EVIDENCE records it rests on ({@link EvidenceCitation} from
 * integrity-evidence.ts). A verdict without evidence is inadmissible.
 *
 * Verdicts do NOT enforce. Enforcement is policy-driven and lives in
 * integrity-enforcement.ts, downstream of verdicts.
 *
 * Purity: pure types + pure guards + a pure band classifier + a pure
 * validator. No IO, no detection algorithms.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { SubjectId, TenantId, PlatformAuthorityMarker } from "./primitives.ts";
import type { ConfidenceInterval, IntegrityAggregate, IntegrityReportId } from "./integrity.ts";
import { isValidConfidenceInterval } from "./integrity.ts";
import type { EvidenceCitation } from "./integrity-evidence.ts";
import { isEvidenceCitation } from "./integrity-evidence.ts";

/** Identifier of one integrity risk verdict. */
export type IntegrityVerdictId = Brand<string, "IntegrityVerdictId">;

/** Parses and validates `text` as an {@link IntegrityVerdictId}. */
export function asIntegrityVerdictId(text: string): IntegrityVerdictId | undefined {
  return isValidIdText(text) ? (text as IntegrityVerdictId) : undefined;
}

// ---------------------------------------------------------------------------
// Verdict vocabulary (frozen)
// ---------------------------------------------------------------------------

/**
 * The frozen verdict vocabulary. Ordered by escalation
 * ({@link VERDICT_SEVERITY_ORDER}). Note what is ABSENT: any "is bot"/"is
 * human" claim. `consistent-with-declared-mode` states behavioral
 * CONSISTENCY at a stated confidence — never certain humanness;
 * `inconclusive` is an honest first-class outcome.
 */
export type IntegrityVerdictKind =
  | "inconclusive"
  | "consistent-with-declared-mode"
  | "deviation-observed"
  | "pronounced-deviation-observed";

/** All valid {@link IntegrityVerdictKind} values, in escalation order. */
export const INTEGRITY_VERDICT_KINDS: readonly IntegrityVerdictKind[] = Object.freeze([
  "inconclusive",
  "consistent-with-declared-mode",
  "deviation-observed",
  "pronounced-deviation-observed",
]);

/** Returns true when `value` is a valid {@link IntegrityVerdictKind}. */
export function isIntegrityVerdictKind(value: unknown): value is IntegrityVerdictKind {
  return typeof value === "string" && (INTEGRITY_VERDICT_KINDS as readonly string[]).includes(value);
}

/** Pure escalation rank of a verdict kind (0 = `inconclusive`). */
export function verdictSeverityRank(kind: IntegrityVerdictKind): number {
  return INTEGRITY_VERDICT_KINDS.indexOf(kind);
}

// ---------------------------------------------------------------------------
// Confidence bands (explicit, frozen)
// ---------------------------------------------------------------------------

/**
 * Confidence bands a verdict's interval may fall into, by interval WIDTH
 * (`upperBound - lowerBound`). A verdict never claims more precision than
 * its evidence supports: the band is DERIVED from the interval by
 * {@link classifyVerdictConfidenceBand}, never asserted independently.
 */
export type VerdictConfidenceBand = "wide" | "moderate" | "narrow";

/**
 * The frozen band table: each band's maximum interval width, ascending.
 * `narrow` <= 0.10, `moderate` <= 0.25, `wide` above that.
 */
export const VERDICT_CONFIDENCE_BANDS: readonly {
  readonly band: VerdictConfidenceBand;
  readonly maxWidth: number;
}[] = Object.freeze([
  Object.freeze({ band: "narrow", maxWidth: 0.1 } as const),
  Object.freeze({ band: "moderate", maxWidth: 0.25 } as const),
  Object.freeze({ band: "wide", maxWidth: 1 } as const),
]);

/** Returns true when `value` is a valid {@link VerdictConfidenceBand}. */
export function isVerdictConfidenceBand(value: unknown): value is VerdictConfidenceBand {
  return value === "wide" || value === "moderate" || value === "narrow";
}

/** Pure band ordering: wide (0) < moderate (1) < narrow (2). */
export function verdictBandRank(band: VerdictConfidenceBand): number {
  return band === "wide" ? 0 : band === "moderate" ? 1 : 2;
}

/**
 * Pure classifier: the confidence band a {@link ConfidenceInterval} falls
 * into, by width. Unknown shapes degrade to `wide` — the maximally honest
 * band — because an unusable interval must never look precise.
 */
export function classifyVerdictConfidenceBand(interval: ConfidenceInterval): VerdictConfidenceBand {
  if (!isValidConfidenceInterval(interval)) return "wide";
  const width = interval.upperBound - interval.lowerBound;
  for (const entry of VERDICT_CONFIDENCE_BANDS) {
    if (width <= entry.maxWidth) return entry.band;
  }
  return "wide";
}

// ---------------------------------------------------------------------------
// Forbidden certainty fields (verdict-scoped extension)
// ---------------------------------------------------------------------------

/**
 * Fields that would smuggle certainty into a VERDICT record. Extends the
 * report-scoped {@link FORBIDDEN_INTEGRITY_FIELDS} discipline with the
 * boolean identity claims the work order forbids outright: `isBot` (and
 * its kin) can never appear on a verdict — neither to condemn nor to
 * absolve (`isHuman`).
 */
export const FORBIDDEN_VERDICT_FIELDS: readonly string[] = Object.freeze([
  "verdict",
  "certain",
  "certainly",
  "isBot",
  "isBotPlayer",
  "isAutomaton",
  "isAutomated",
  "isHuman",
  "isCheating",
  "isCheater",
  "cheater",
  "guilty",
  "convicted",
  "innocent",
  "acquitted",
]);

/** Returns true when `key` is a forbidden certainty field name on a verdict. */
export function isForbiddenVerdictField(key: string): boolean {
  return (FORBIDDEN_VERDICT_FIELDS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Verdict record
// ---------------------------------------------------------------------------

/**
 * An integrity risk verdict: a frozen-vocabulary classification of a
 * report's aggregate, carrying the aggregate (risk score + interval), the
 * DERIVED confidence band, the report it summarizes and the evidence it
 * cites. Decided only by the platform authority.
 */
export interface IntegrityRiskVerdict {
  readonly verdictId: IntegrityVerdictId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  /** The integrity report this verdict summarizes (evidence-before-verdict). */
  readonly reportRef: IntegrityReportId;
  readonly kind: IntegrityVerdictKind;
  readonly risk: IntegrityAggregate;
  /** The confidence band of `risk.confidence` — must equal the derived band. */
  readonly band: VerdictConfidenceBand;
  /** Evidence citations — at least one, or the verdict is inadmissible. */
  readonly evidence: readonly EvidenceCitation[];
  readonly decidedBy: PlatformAuthorityMarker;
}

/** Returns true when `value` is a structurally valid {@link IntegrityRiskVerdict}. */
export function isIntegrityRiskVerdict(value: unknown): value is IntegrityRiskVerdict {
  if (typeof value !== "object" || value === null) return false;
  const verdict = value as Record<string, unknown>;
  for (const key of Object.keys(verdict)) {
    if (isForbiddenVerdictField(key)) return false;
  }
  if (typeof verdict.verdictId !== "string" || verdict.verdictId.length === 0) return false;
  if (typeof verdict.subject !== "string" || verdict.subject.length === 0) return false;
  if (typeof verdict.reportRef !== "string" || verdict.reportRef.length === 0) return false;
  if (!isIntegrityVerdictKind(verdict.kind)) return false;
  if (verdict.decidedBy !== "platform-authority") return false;
  if (!isVerdictConfidenceBand(verdict.band)) return false;
  // Structural guard allows an empty evidence array; the semantic validator
  // rejects it with the distinct `verdict-without-evidence` code.
  if (!Array.isArray(verdict.evidence)) return false;
  if (!verdict.evidence.every((citation) => isEvidenceCitation(citation))) return false;
  const risk = verdict.risk as Record<string, unknown> | undefined;
  if (typeof risk !== "object" || risk === null) return false;
  if (typeof risk.riskScore !== "number" || !Number.isFinite(risk.riskScore)) return false;
  if (risk.riskScore < 0 || risk.riskScore > 1) return false;
  return isValidConfidenceInterval(risk.confidence);
}

/** Result of {@link validateIntegrityRiskVerdict}. */
export type IntegrityVerdictValidation =
  | { readonly ok: true; readonly kind: IntegrityVerdictKind; readonly band: VerdictConfidenceBand }
  | {
      readonly ok: false;
      readonly code:
        | "certainty-claimed"
        | "malformed-verdict"
        | "verdict-without-evidence"
        | "invalid-risk-interval"
        | "band-mismatch";
    };

/**
 * Pure verdict validator (R11/E11 negative coverage). Rejects with typed
 * codes: any forbidden certainty field (`certainty-claimed` — `isBot` and
 * friends are unrepresentable), structural malformation, no evidence
 * citations (`verdict-without-evidence` — an unevidenced verdict is
 * inadmissible), an invalid risk interval (`invalid-risk-interval`), and
 * a stated band that disagrees with the band derived from the interval
 * (`band-mismatch` — the band may never look narrower than the evidence
 * supports).
 */
export function validateIntegrityRiskVerdict(value: unknown): IntegrityVerdictValidation {
  if (typeof value !== "object" || value === null) return { ok: false, code: "malformed-verdict" };
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.some((key) => isForbiddenVerdictField(key))) {
    return { ok: false, code: "certainty-claimed" };
  }
  // Evidence-level checks run BEFORE the structural guard so a broken
  // citation is reported precisely.
  const evidence = (value as { evidence?: unknown }).evidence;
  if (Array.isArray(evidence)) {
    if (evidence.length === 0) return { ok: false, code: "verdict-without-evidence" };
    if (!evidence.every((citation) => isEvidenceCitation(citation))) {
      return { ok: false, code: "malformed-verdict" };
    }
  }
  const risk = (value as { risk?: unknown }).risk as Record<string, unknown> | undefined;
  if (typeof risk === "object" && risk !== null && !isValidConfidenceInterval(risk.confidence)) {
    return { ok: false, code: "invalid-risk-interval" };
  }
  if (!isIntegrityRiskVerdict(value)) return { ok: false, code: "malformed-verdict" };
  if (value.evidence.length === 0) return { ok: false, code: "verdict-without-evidence" };
  const derived = classifyVerdictConfidenceBand(value.risk.confidence);
  if (value.band !== derived) return { ok: false, code: "band-mismatch" };
  return { ok: true, kind: value.kind, band: value.band };
}
