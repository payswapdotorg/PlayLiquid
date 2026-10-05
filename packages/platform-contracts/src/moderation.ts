/**
 * MODERATION PLATFORM SERVICE CONTRACTS (R7 / lock rule 17; E8).
 *
 * Moderation is a platform capability. Games declare which surfaces are
 * moderated and bind their semantic events to them (lock 18); the
 * platform owns report intake, evidence thresholds, case decisions and
 * appeals. Moderation decisions are only ever recorded with the platform
 * authority marker.
 *
 * E8 — typed negative paths are mandatory and present here:
 * - {@link ModerationReportDisposition} with refusal codes
 *   `insufficient-evidence`, `surface-not-declared`, `duplicate-report`;
 * - severity-scaled evidence requirements (critical reports need double
 *   the policy minimum — {@link requiredEvidenceCount});
 * - {@link AppealRefusal} for appeals under a non-appealable policy.
 *
 * Purity: pure types + pure guards + pure oracles. No IO.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { ContentDigest, SubjectId, TenantId, PlatformAuthorityMarker } from "./primitives.ts";
import type { GameEventKind } from "./events.ts";

/** Identifier of one moderation report. */
export type ModerationReportId = Brand<string, "ModerationReportId">;

/** Parses and validates `text` as a {@link ModerationReportId}. */
export function asModerationReportId(text: string): ModerationReportId | undefined {
  return isValidIdText(text) ? (text as ModerationReportId) : undefined;
}

/** Identifier of one moderation case. */
export type ModerationCaseId = Brand<string, "ModerationCaseId">;

/** Parses and validates `text` as a {@link ModerationCaseId}. */
export function asModerationCaseId(text: string): ModerationCaseId | undefined {
  return isValidIdText(text) ? (text as ModerationCaseId) : undefined;
}

/** The moderation surfaces a game may declare (mirrors game-contracts). */
export type ModerationSurface = "chat" | "voice" | "behavior" | "content";

/** All valid {@link ModerationSurface} values. */
export const MODERATION_SURFACES: readonly ModerationSurface[] = Object.freeze([
  "chat",
  "voice",
  "behavior",
  "content",
]);

/** Returns true when `value` is a valid {@link ModerationSurface}. */
export function isModerationSurface(value: unknown): value is ModerationSurface {
  return typeof value === "string" && (MODERATION_SURFACES as readonly string[]).includes(value);
}

/** Severity scale, ordered from least to most severe. */
export type ModerationSeverity = "info" | "minor" | "major" | "critical";

/** The frozen severity ladder (ascending). */
export const MODERATION_SEVERITY_ORDER: readonly ModerationSeverity[] = Object.freeze([
  "info",
  "minor",
  "major",
  "critical",
]);

/** Returns true when `value` is a valid {@link ModerationSeverity}. */
export function isModerationSeverity(value: unknown): value is ModerationSeverity {
  return typeof value === "string" && (MODERATION_SEVERITY_ORDER as readonly string[]).includes(value);
}

/** Pure ordinal of a severity (0 = info). Undefined for unknown values. */
export function severityRank(severity: ModerationSeverity): number {
  return MODERATION_SEVERITY_ORDER.indexOf(severity);
}

// ---------------------------------------------------------------------------
// Service policy + game-side event binding
// ---------------------------------------------------------------------------

/** Platform moderation service behavior descriptor. */
export interface ModerationServicePolicy {
  readonly surfaces: readonly ModerationSurface[];
  readonly appealable: boolean;
  /** Minimum evidence artifacts for a report to enter review. */
  readonly minEvidenceArtifacts: number;
}

/** Returns true when `value` is a structurally valid {@link ModerationServicePolicy}. */
export function isModerationServicePolicy(value: unknown): value is ModerationServicePolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (!Array.isArray(policy.surfaces) || policy.surfaces.length === 0) return false;
  if (!policy.surfaces.every((surface) => isModerationSurface(surface))) return false;
  if (typeof policy.appealable !== "boolean") return false;
  return (
    typeof policy.minEvidenceArtifacts === "number" &&
    Number.isSafeInteger(policy.minEvidenceArtifacts) &&
    policy.minEvidenceArtifacts >= 1
  );
}

/** How a game binds one of ITS events to a moderation surface (lock 18). */
export interface ModerationEventBinding {
  readonly capability: "moderation";
  readonly eventKind: GameEventKind;
  readonly surface: ModerationSurface;
}

/** Returns true when `value` is a structurally valid {@link ModerationEventBinding}. */
export function isModerationEventBinding(value: unknown): value is ModerationEventBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return (
    binding.capability === "moderation" &&
    typeof binding.eventKind === "string" &&
    binding.eventKind.length > 0 &&
    isModerationSurface(binding.surface)
  );
}

// ---------------------------------------------------------------------------
// Reports and the intake oracle
// ---------------------------------------------------------------------------

/** A moderation report as submitted to the platform. */
export interface ModerationReport {
  readonly reportId: ModerationReportId;
  readonly tenant: TenantId;
  readonly surface: ModerationSurface;
  readonly severity: ModerationSeverity;
  readonly reportedSubject: SubjectId;
  readonly reporter: SubjectId;
  readonly evidence: readonly ContentDigest[];
  readonly summary: string;
}

/** Returns true when `value` is a structurally valid {@link ModerationReport}. */
export function isModerationReport(value: unknown): value is ModerationReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Record<string, unknown>;
  if (typeof report.reportId !== "string" || report.reportId.length === 0) return false;
  if (!isModerationSurface(report.surface)) return false;
  if (!isModerationSeverity(report.severity)) return false;
  if (typeof report.reportedSubject !== "string" || report.reportedSubject.length === 0) return false;
  if (typeof report.reporter !== "string" || report.reporter.length === 0) return false;
  if (!Array.isArray(report.evidence)) return false;
  if (!report.evidence.every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest))) {
    return false;
  }
  return typeof report.summary === "string" && report.summary.length > 0;
}

/** Typed intake disposition for a report. */
export type ModerationReportDisposition =
  | { readonly disposition: "accepted-for-review" }
  | {
      readonly disposition: "rejected";
      readonly code: "insufficient-evidence" | "surface-not-declared" | "duplicate-report";
    };

/**
 * Evidence artifacts required for a severity: the policy minimum, doubled
 * for `critical` (severity-scaled thresholds keep grave accusations
 * evidence-heavy by construction).
 */
export function requiredEvidenceCount(severity: ModerationSeverity, policy: ModerationServicePolicy): number {
  return severity === "critical" ? policy.minEvidenceArtifacts * 2 : policy.minEvidenceArtifacts;
}

/**
 * Pure report intake oracle (E8). Refuses with typed codes: reports on
 * surfaces the game never declared (`surface-not-declared`), reports
 * below the severity-scaled evidence threshold (`insufficient-evidence`),
 * and re-reports of the same subject on the same surface by the same
 * reporter (`duplicate-report` — one report per reporter per subject per
 * surface; brigading is not a review path).
 */
export function assessModerationReport(
  report: ModerationReport,
  policy: ModerationServicePolicy,
  priorReports: readonly Pick<ModerationReport, "reporter" | "reportedSubject" | "surface">[],
): ModerationReportDisposition {
  if (!policy.surfaces.includes(report.surface)) {
    return { disposition: "rejected", code: "surface-not-declared" };
  }
  if (report.evidence.length < requiredEvidenceCount(report.severity, policy)) {
    return { disposition: "rejected", code: "insufficient-evidence" };
  }
  const duplicate = priorReports.some(
    (prior) =>
      prior.reporter === report.reporter &&
      prior.reportedSubject === report.reportedSubject &&
      prior.surface === report.surface,
  );
  if (duplicate) return { disposition: "rejected", code: "duplicate-report" };
  return { disposition: "accepted-for-review" };
}

// ---------------------------------------------------------------------------
// Case decisions and appeals
// ---------------------------------------------------------------------------

/** A moderation case decision — only the platform authority records these. */
export interface ModerationCaseDecision {
  readonly caseId: ModerationCaseId;
  readonly reportRef: ModerationReportId;
  readonly outcome: "upheld" | "rejected" | "escalated";
  readonly decidedBy: PlatformAuthorityMarker;
  readonly reasons: readonly string[];
}

/** Returns true when `value` is a structurally valid {@link ModerationCaseDecision}. */
export function isModerationCaseDecision(value: unknown): value is ModerationCaseDecision {
  if (typeof value !== "object" || value === null) return false;
  const decision = value as Record<string, unknown>;
  return (
    typeof decision.caseId === "string" &&
    decision.caseId.length > 0 &&
    typeof decision.reportRef === "string" &&
    decision.reportRef.length > 0 &&
    (decision.outcome === "upheld" || decision.outcome === "rejected" || decision.outcome === "escalated") &&
    decision.decidedBy === "platform-authority" &&
    Array.isArray(decision.reasons) &&
    decision.reasons.every((reason) => typeof reason === "string")
  );
}

/** An appeal against a decided case. */
export interface ModerationAppeal {
  readonly caseId: ModerationCaseId;
  readonly appellant: SubjectId;
  readonly grounds: string;
}

/** The platform's decision on an appeal. */
export type AppealDecision =
  | { readonly outcome: "upheld" | "overturned" | "pending"; readonly decidedBy: PlatformAuthorityMarker }
  | { readonly refused: true; readonly code: "policy-not-appealable" | "empty-grounds" };

/**
 * Pure appeal admission oracle (E8 negative path): appeals are refused
 * outright when the governing policy is not appealable, and appeals with
 * empty grounds never reach review.
 */
export function adjudicateAppeal(
  appeal: ModerationAppeal,
  policy: ModerationServicePolicy,
): AppealDecision {
  if (!policy.appealable) return { refused: true, code: "policy-not-appealable" };
  if (appeal.grounds.trim().length === 0) return { refused: true, code: "empty-grounds" };
  return { outcome: "pending", decidedBy: "platform-authority" };
}
