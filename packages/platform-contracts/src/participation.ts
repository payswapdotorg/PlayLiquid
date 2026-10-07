/**
 * PARTICIPATION-MODE DECLARATION CONTRACTS (PL-009; architecture
 * "Competitive Integrity": "Explicit AI-player modes must be supported").
 *
 * A participation-mode declaration is a SUBJECT-SIDE statement of how the
 * subject participates: unassisted human play, human play with declared
 * AI assistance, or a declared autonomous AI player. Enforcement policy
 * branches on the DECLARATION (typed, disjoint per mode) — never on
 * sniffing inferred identity, and never on a certainty claim.
 *
 * Disjoint markers: the three declaration shapes carry distinct
 * `declarationKind` literals (`participation.human`,
 * `participation.assist`, `participation.declared-ai`), so a declaration
 * of one mode is never structurally confusable with another's, and the
 * union is discriminated without guessing.
 *
 * Relation to the PL-004 baseline: `AiPlayMode` in integrity.ts stays the
 * coarse report-time vocabulary; {@link participationModeOf} maps a
 * declaration onto it losslessly (the mapping is total and pure).
 *
 * Purity: pure types + pure guards + a pure mapper. No IO.
 */

import type { ContentDigest, SubjectId, TenantId, TimestampMs } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";
import type { AiPlayMode } from "./integrity.ts";

/**
 * The disjoint declaration markers. Frozen vocabulary: one literal per
 * participation mode; adding a mode is a contract change.
 */
export type ParticipationDeclarationKind =
  | "participation.human"
  | "participation.assist"
  | "participation.declared-ai";

/** All valid {@link ParticipationDeclarationKind} values. */
export const PARTICIPATION_DECLARATION_KINDS: readonly ParticipationDeclarationKind[] = Object.freeze([
  "participation.human",
  "participation.assist",
  "participation.declared-ai",
]);

/** Returns true when `value` is a valid {@link ParticipationDeclarationKind}. */
export function isParticipationDeclarationKind(value: unknown): value is ParticipationDeclarationKind {
  return (
    typeof value === "string" &&
    (PARTICIPATION_DECLARATION_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The three disjoint declaration shapes
// ---------------------------------------------------------------------------

/**
 * Declaration of unassisted human play. Carries NO assurance field: the
 * declaration is a statement of intent, not proof of humanness — the
 * platform's evidence machinery (integrity-verdicts.ts) remains
 * probabilistic regardless of declarations.
 */
export interface HumanParticipationDeclaration {
  readonly declarationKind: "participation.human";
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly declaredAt: TimestampMs;
}

/**
 * Declaration of human play WITH declared AI assistance (assist mode).
 * The scope of assistance is digest-pinned and opaque: which facets of
 * play are assisted is referenceable content, not inline policy.
 */
export interface AssistParticipationDeclaration {
  readonly declarationKind: "participation.assist";
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly declaredAt: TimestampMs;
  /** Digest of the opaque assistance-scope description (content-addressed). */
  readonly assistScopeDigest: ContentDigest;
}

/**
 * Declaration of a declared autonomous AI player. The accountable
 * OPERATOR is a first-class field: an autonomous participant always has a
 * responsible subject behind it (no anonymous bots).
 */
export interface DeclaredAiParticipationDeclaration {
  readonly declarationKind: "participation.declared-ai";
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly declaredAt: TimestampMs;
  /** The accountable subject operating the autonomous AI player. */
  readonly operator: SubjectId;
  /** Digest of the declared operating-policy document (optional). */
  readonly operatingPolicyDigest?: ContentDigest;
}

/** The union of participation-mode declarations, discriminated by `declarationKind`. */
export type ParticipationModeDeclaration =
  | HumanParticipationDeclaration
  | AssistParticipationDeclaration
  | DeclaredAiParticipationDeclaration;

function hasDeclarationBase(value: Record<string, unknown>): boolean {
  if (typeof value.subject !== "string" || value.subject.length === 0) return false;
  return (
    typeof value.declaredAt === "number" &&
    Number.isSafeInteger(value.declaredAt) &&
    value.declaredAt >= 0
  );
}

/** Returns true when `value` is a structurally valid {@link ParticipationModeDeclaration}. */
export function isParticipationModeDeclaration(value: unknown): value is ParticipationModeDeclaration {
  if (typeof value !== "object" || value === null) return false;
  const declaration = value as Record<string, unknown>;
  if (!hasDeclarationBase(declaration)) return false;
  switch (declaration.declarationKind) {
    case "participation.human":
      return true;
    case "participation.assist":
      return (
        typeof declaration.assistScopeDigest === "string" &&
        isValidContentDigest(declaration.assistScopeDigest)
      );
    case "participation.declared-ai":
      if (typeof declaration.operator !== "string" || declaration.operator.length === 0) {
        return false;
      }
      if (declaration.operatingPolicyDigest === undefined) return true;
      return (
        typeof declaration.operatingPolicyDigest === "string" &&
        isValidContentDigest(declaration.operatingPolicyDigest)
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Typed branching (enforcement policy branches on DECLARATION, not sniffing)
// ---------------------------------------------------------------------------

/** Type guard: the declaration is a declared-AI participation. */
export function isDeclaredAiParticipation(
  declaration: ParticipationModeDeclaration,
): declaration is DeclaredAiParticipationDeclaration {
  return declaration.declarationKind === "participation.declared-ai";
}

/** Type guard: the declaration is an assist-mode participation. */
export function isAssistParticipation(
  declaration: ParticipationModeDeclaration,
): declaration is AssistParticipationDeclaration {
  return declaration.declarationKind === "participation.assist";
}

/** Type guard: the declaration is an unassisted-human participation. */
export function isHumanParticipation(
  declaration: ParticipationModeDeclaration,
): declaration is HumanParticipationDeclaration {
  return declaration.declarationKind === "participation.human";
}

/**
 * Pure, total mapper onto the PL-004 report-time vocabulary: human ->
 * `"human"`, assist -> `"ai-assisted"`, declared-ai -> `"ai-autonomous"`.
 * The inverse does not exist: a report play mode cannot recover the
 * declaration (declarations carry more structure than modes).
 */
export function participationModeOf(declaration: ParticipationModeDeclaration): AiPlayMode {
  switch (declaration.declarationKind) {
    case "participation.human":
      return "human";
    case "participation.assist":
      return "ai-assisted";
    case "participation.declared-ai":
      return "ai-autonomous";
  }
}

/**
 * Pure coherence check for two declarations of the SAME subject: a
 * subject may not simultaneously hold two different-mode declarations.
 * Identical kinds are coherent (re-declaration/refresh is allowed).
 */
export function declarationsAreCoherent(
  a: ParticipationModeDeclaration,
  b: ParticipationModeDeclaration,
): boolean {
  return a.declarationKind === b.declarationKind;
}
