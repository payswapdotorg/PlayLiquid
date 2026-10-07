/**
 * INTEGRITY ENFORCEMENT CONTRACTS (PL-009; architecture "Competitive
 * Integrity": "Output is evidence/confidence/risk; enforcement is
 * policy-driven").
 *
 * Evidence-before-enforcement, ALWAYS, encoded three ways:
 * - an {@link IntegrityEnforcementDecision} cites BOTH the verdict it
 *   follows ({@link IntegrityEnforcementDecision.verdictRef}) AND the
 *   behavioral evidence behind it ({@link IntegrityEnforcementDecision.evidence});
 * - {@link decideEnforcement} refuses to decide over an unevidenced
 *   verdict (`verdict-without-evidence`) — a decision with no cited
 *   evidence is inadmissible;
 * - {@link validateEnforcementDecision} re-derives the decision from the
 *   policy + verdict and refuses any drift (`action-not-policy-driven`)
 *   and any evidence citation the verdict does not itself rest on
 *   (`evidence-not-in-verdict`) — the audit chain decision -> verdict ->
 *   evidence -> pinned digests stays closed.
 *
 * Actions are proportionate platform measures, never identity verdicts:
 * there is no "ban-as-bot" action. Declared participation modes can PIN
 * rules (branch on the DECLARATION, participation.ts) — never on sniffing.
 *
 * Purity: pure types + pure guards + two pure oracles. No IO.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { SubjectId, TenantId, PlatformAuthorityMarker } from "./primitives.ts";
import type { AiPlayMode } from "./integrity.ts";
import { isAiPlayMode } from "./integrity.ts";
import type { IntegrityVerdictId, IntegrityVerdictKind, VerdictConfidenceBand } from "./integrity-verdicts.ts";
import {
  isIntegrityVerdictKind,
  isVerdictConfidenceBand,
  verdictSeverityRank,
  verdictBandRank,
  validateIntegrityRiskVerdict,
} from "./integrity-verdicts.ts";
import type { IntegrityRiskVerdict } from "./integrity-verdicts.ts";
import type { ParticipationModeDeclaration } from "./participation.ts";
import { participationModeOf } from "./participation.ts";
import type { EvidenceCitation } from "./integrity-evidence.ts";

/** Identifier of one enforcement policy descriptor. */
export type IntegrityEnforcementPolicyId = Brand<string, "IntegrityEnforcementPolicyId">;

/** Parses and validates `text` as an {@link IntegrityEnforcementPolicyId}. */
export function asIntegrityEnforcementPolicyId(
  text: string,
): IntegrityEnforcementPolicyId | undefined {
  return isValidIdText(text) ? (text as IntegrityEnforcementPolicyId) : undefined;
}

/** Identifier of one enforcement decision. */
export type EnforcementDecisionId = Brand<string, "EnforcementDecisionId">;

/** Parses and validates `text` as an {@link EnforcementDecisionId}. */
export function asEnforcementDecisionId(text: string): EnforcementDecisionId | undefined {
  return isValidIdText(text) ? (text as EnforcementDecisionId) : undefined;
}

// ---------------------------------------------------------------------------
// Action vocabulary (frozen, proportionate — no identity verdicts)
// ---------------------------------------------------------------------------

/**
 * The proportionate platform actions an enforcement rule may select.
 * Deliberately ABSENT: any "ban-as-bot" or identity-asserting action —
 * identity is never established, only risk is surfaced and managed.
 */
export type EnforcementActionKind =
  | "no-action"
  | "flag-for-review"
  | "refer-to-moderation"
  | "restrict-matchmaking"
  | "quarantine-rewards";

/** All valid {@link EnforcementActionKind} values. */
export const ENFORCEMENT_ACTION_KINDS: readonly EnforcementActionKind[] = Object.freeze([
  "no-action",
  "flag-for-review",
  "refer-to-moderation",
  "restrict-matchmaking",
  "quarantine-rewards",
]);

/** Returns true when `value` is a valid {@link EnforcementActionKind}. */
export function isEnforcementActionKind(value: unknown): value is EnforcementActionKind {
  return typeof value === "string" && (ENFORCEMENT_ACTION_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Policy descriptor
// ---------------------------------------------------------------------------

/**
 * One enforcement rule. Fires only when the verdict's severity is AT
 * LEAST `minSeverity`, its confidence band is AT LEAST `minBand` (wide <
 * moderate < narrow), and — when `declaredMode` is pinned — the subject's
 * DECLARED participation mode matches. Rules pinned to a mode never fire
 * on other modes and never fire without a declaration.
 */
export interface EnforcementRule {
  readonly minSeverity: IntegrityVerdictKind;
  readonly minBand: VerdictConfidenceBand;
  readonly action: EnforcementActionKind;
  /** Optional: branch on the subject's DECLARED mode (not inference). */
  readonly declaredMode?: AiPlayMode;
}

/**
 * A complete enforcement policy descriptor: a stable id plus an ordered
 * rule list. The FIRST matching rule wins; a policy that matches nothing
 * produces a typed `no-matching-rule` refusal, not a silent default —
 * policy totality is the policy author's explicit choice.
 */
export interface IntegrityEnforcementPolicy {
  readonly policyId: IntegrityEnforcementPolicyId;
  readonly tenant: TenantId;
  readonly rules: readonly EnforcementRule[];
}

/** Returns true when `value` is a structurally valid {@link EnforcementRule}. */
export function isEnforcementRule(value: unknown): value is EnforcementRule {
  if (typeof value !== "object" || value === null) return false;
  const rule = value as Record<string, unknown>;
  if (!isIntegrityVerdictKind(rule.minSeverity)) return false;
  if (!isVerdictConfidenceBand(rule.minBand)) return false;
  if (!isEnforcementActionKind(rule.action)) return false;
  if (rule.declaredMode !== undefined && !isAiPlayMode(rule.declaredMode)) return false;
  return true;
}

/** Returns true when `value` is a structurally valid {@link IntegrityEnforcementPolicy}. */
export function isIntegrityEnforcementPolicy(value: unknown): value is IntegrityEnforcementPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (typeof policy.policyId !== "string" || policy.policyId.length === 0) return false;
  if (!Array.isArray(policy.rules) || policy.rules.length === 0) return false;
  return policy.rules.every((rule) => isEnforcementRule(rule));
}

// ---------------------------------------------------------------------------
// Decision record
// ---------------------------------------------------------------------------

/**
 * An enforcement decision. Carries the full audit chain: the policy it
 * applied, the verdict it followed, and the evidence citations behind
 * that verdict. Decided only by the platform authority.
 */
export interface IntegrityEnforcementDecision {
  readonly decisionId: EnforcementDecisionId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly policyRef: IntegrityEnforcementPolicyId;
  readonly verdictRef: IntegrityVerdictId;
  readonly evidence: readonly EvidenceCitation[];
  readonly action: EnforcementActionKind;
  readonly decidedBy: PlatformAuthorityMarker;
}

/** Returns true when `value` is a structurally valid {@link IntegrityEnforcementDecision}. */
export function isIntegrityEnforcementDecision(value: unknown): value is IntegrityEnforcementDecision {
  if (typeof value !== "object" || value === null) return false;
  const decision = value as Record<string, unknown>;
  if (typeof decision.decisionId !== "string" || decision.decisionId.length === 0) return false;
  if (typeof decision.subject !== "string" || decision.subject.length === 0) return false;
  if (typeof decision.policyRef !== "string" || decision.policyRef.length === 0) return false;
  if (typeof decision.verdictRef !== "string" || decision.verdictRef.length === 0) return false;
  if (decision.decidedBy !== "platform-authority") return false;
  if (!isEnforcementActionKind(decision.action)) return false;
  if (!Array.isArray(decision.evidence)) return false;
  return decision.evidence.every(
    (citation) =>
      typeof citation === "object" &&
      citation !== null &&
      typeof (citation as Record<string, unknown>).evidenceId === "string" &&
      typeof (citation as Record<string, unknown>).payloadDigest === "string" &&
      /^[0-9a-f]{64}$/.test((citation as Record<string, unknown>).payloadDigest as string),
  );
}

// ---------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------

/** Result of {@link decideEnforcement}. */
export type EnforcementDecisionOutcome =
  | { readonly decided: true; readonly decision: IntegrityEnforcementDecision }
  | {
      readonly decided: false;
      readonly code:
        | "malformed-policy"
        | "invalid-verdict"
        | "verdict-without-evidence"
        | "no-matching-rule";
    };

/**
 * THE policy-driven enforcement oracle (pure). Evaluates the policy's
 * rules in order against the verdict (and, when rules pin modes, the
 * subject's DECLARED participation mode) and produces the decision —
 * under the CALLER-SUPPLIED decision id (identifiers are never minted
 * here) — with the full audit chain. Refuses, with typed codes: a
 * malformed policy; a verdict that fails its own validation
 * (`invalid-verdict`); a verdict citing no evidence
 * (`verdict-without-evidence` — enforcement without evidence is
 * inadmissible, always); and a policy no rule of which fires
 * (`no-matching-rule` — surfaced loudly, never defaulted away).
 */
export function decideEnforcement(
  decisionId: EnforcementDecisionId,
  policy: IntegrityEnforcementPolicy,
  verdict: IntegrityRiskVerdict,
  declaration?: ParticipationModeDeclaration,
): EnforcementDecisionOutcome {
  if (!isIntegrityEnforcementPolicy(policy)) return { decided: false, code: "malformed-policy" };
  // Evidence is the FIRST gate — before any other verdict property is
  // even consulted, enforcement without evidence is inadmissible.
  if (!Array.isArray(verdict.evidence) || verdict.evidence.length === 0) {
    return { decided: false, code: "verdict-without-evidence" };
  }
  const verdictValidation = validateIntegrityRiskVerdict(verdict);
  if (!verdictValidation.ok) return { decided: false, code: "invalid-verdict" };
  for (const rule of policy.rules) {
    if (verdictSeverityRank(verdict.kind) < verdictSeverityRank(rule.minSeverity)) continue;
    if (verdictBandRank(verdict.band) < verdictBandRank(rule.minBand)) continue;
    if (rule.declaredMode !== undefined) {
      if (declaration === undefined) continue;
      if (participationModeOf(declaration) !== rule.declaredMode) continue;
    }
    return {
      decided: true,
      decision: {
        decisionId,
        tenant: verdict.tenant,
        subject: verdict.subject,
        policyRef: policy.policyId,
        verdictRef: verdict.verdictId,
        evidence: verdict.evidence,
        action: rule.action,
        decidedBy: "platform-authority",
      },
    };
  }
  return { decided: false, code: "no-matching-rule" };
}

/** Result of {@link validateEnforcementDecision}. */
export type EnforcementDecisionValidation =
  | { readonly ok: true; readonly action: EnforcementActionKind }
  | {
      readonly ok: false;
      readonly code:
        | "malformed-decision"
        | "policy-reference-mismatch"
        | "verdict-reference-mismatch"
        | "no-evidence-cited"
        | "evidence-not-in-verdict"
        | "action-not-policy-driven";
    };

/**
 * Pure audit validator: re-derives the decision from policy + verdict and
 * refuses any drift. The decision must reference THIS policy and THIS
 * verdict, cite at least one evidence citation, cite ONLY citations the
 * verdict itself rests on (`evidence-not-in-verdict` — the audit chain
 * decision -> verdict -> evidence stays closed), and carry the action the
 * policy actually produces (`action-not-policy-driven`).
 */
export function validateEnforcementDecision(
  decision: IntegrityEnforcementDecision,
  policy: IntegrityEnforcementPolicy,
  verdict: IntegrityRiskVerdict,
): EnforcementDecisionValidation {
  if (!isIntegrityEnforcementDecision(decision)) return { ok: false, code: "malformed-decision" };
  if (decision.policyRef !== policy.policyId) {
    return { ok: false, code: "policy-reference-mismatch" };
  }
  if (decision.verdictRef !== verdict.verdictId) {
    return { ok: false, code: "verdict-reference-mismatch" };
  }
  if (decision.evidence.length === 0) return { ok: false, code: "no-evidence-cited" };
  const verdictCitations = new Set(
    verdict.evidence.map((citation) => `${citation.evidenceId}:${citation.payloadDigest}`),
  );
  for (const citation of decision.evidence) {
    if (!verdictCitations.has(`${citation.evidenceId}:${citation.payloadDigest}`)) {
      return { ok: false, code: "evidence-not-in-verdict" };
    }
  }
  const rederived = decideEnforcement(decision.decisionId, policy, verdict);
  if (!rederived.decided) return { ok: false, code: "action-not-policy-driven" };
  if (rederived.decision.action !== decision.action) {
    return { ok: false, code: "action-not-policy-driven" };
  }
  return { ok: true, action: decision.action };
}
