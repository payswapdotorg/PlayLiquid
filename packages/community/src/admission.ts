/**
 * CONTRIBUTION ADMISSION — the pure command oracles (PL-032).
 *
 * Two oracles, both pure functions over CALLER-SUPPLIED FACTS (facts are
 * derived by the state owner from owned state and ports, never trusted
 * from the command — the platform-social precedent):
 *
 * 1. {@link adjudicateSubmission} — the intake oracle: id/tenant
 *    validity, kind vocabulary, payload validity (game-ir kernel value),
 *    provenance validity (origin shape, forged-lineage refusal, honest
 *    AI disclosure), contributor existence + cross-tenant guard (R20),
 *    R18 gap-link facts, and the E10 duplicate-submission encounter.
 * 2. {@link adjudicateTransition} — the workflow oracle: the frozen
 *    state machine (COMMAND_FROM_STATES), actor authority (withdraw is
 *    the contributor's own right; verdicts are maintainer rights),
 *    cross-tenant actor guard (R20), and the E8 QUALIFICATION gate at
 *    accept (third-party lineage bases must be published and
 *    provenance-passing — untrusted until qualified).
 *
 * The trust model (E8, architecture "Security"): a third-party
 * contribution is UNTRUSTED until qualified. Intake admits only
 * structurally honest provenance; qualification (the accept command)
 * additionally demands lineage-base evidence through the
 * package-registry seam. R19 release gating stays with
 * package-system/package-registry — this oracle produces typed refusal
 * records only, never a second release gate.
 *
 * Purity: no IO, no clock, no globals.
 */

import { isGameIRValue } from "@playliquid/game-ir";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import type { PackageCoordinate } from "@playliquid/package-system";
import type {
  CapabilityGapLink,
  ContributionId,
  ContributionKind,
  ContributionProvenanceInput,
  ContributionRecord,
  ContributionStatus,
  TransitionCommandKind,
} from "./records.ts";
import {
  COMMAND_FROM_STATES,
  isContributionKind,
  isContributionOrigin,
  isContributionProvenanceInput,
  isCapabilityGapLink,
  isTransitionCommandKind,
  MAX_REASON_LENGTH,
} from "./records.ts";

// ---------------------------------------------------------------------------
// Submission admission
// ---------------------------------------------------------------------------

/** The facts the state owner derives for the intake oracle. */
export interface SubmissionFacts {
  /** Contributor exists within the COMMAND's tenant. */
  readonly contributorExists: boolean;
  /** Tenant the contributor belongs to, when known globally (R20). */
  readonly contributorTenant: TenantId | undefined;
  /** The submission digest was already recorded (E10 encounter). */
  readonly submissionSeen: boolean;
  /** Open (non-terminal) contributions the contributor already holds. */
  readonly openContributionsOfContributor: number;
  /** Gap facts, when the command carries a link (Lab-owned ladder). */
  readonly gap: GapSeamFacts | undefined;
}

/** The gap facts the Lab seam supplies for one link. */
export interface GapSeamFacts {
  readonly exists: boolean;
  readonly resolved: boolean;
  readonly blocked: boolean;
  /** The ladder has walked to the user/community rung (R18 order). */
  readonly communityRungReached: boolean;
}

/** One submission command (typed intake). */
export interface SubmitContributionCommand {
  readonly tenant: TenantId;
  readonly contributor: SubjectId;
  readonly kind: ContributionKind;
  readonly payload: unknown;
  readonly provenance: ContributionProvenanceInput;
  readonly gap?: CapabilityGapLink;
}

/** Service policy knobs (capacity discipline). */
export interface CommunityServicePolicy {
  /** Max open (non-terminal) contributions per contributor. */
  readonly maxOpenContributionsPerContributor: number;
}

/** Typed refusal codes (E8 negative coverage; one per negative path). */
export type ContributionRefusalCode =
  | "invalid-tenant"
  | "invalid-contributor"
  | "invalid-kind"
  | "invalid-payload"
  | "invalid-provenance"
  | "invalid-lineage-node"
  | "ai-disclosure-missing"
  | "invalid-gap-link"
  | "unknown-contributor"
  | "cross-tenant-contributor"
  | "unknown-gap"
  | "gap-not-open"
  | "gap-not-at-community-rung"
  | "contributor-quota-full"
  | "duplicate-contribution";

/** Result of submission admission. */
export type SubmissionAdmission =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly code: ContributionRefusalCode; readonly detail: string };

/**
 * THE pure intake oracle. Rule order is normative: id validity -> kind
 * vocabulary -> payload validity -> provenance validity (origin shape,
 * honest AI disclosure) -> contributor existence -> cross-tenant guard
 * (R20) -> gap-link facts (R18) -> capacity -> the E10 duplicate
 * encounter (the service attaches the recorded receipt).
 */
export function adjudicateSubmission(
  command: SubmitContributionCommand,
  policy: CommunityServicePolicy,
  facts: SubmissionFacts,
): SubmissionAdmission {
  if (asTenantId(String(command.tenant)) === undefined) {
    return { accepted: false, code: "invalid-tenant", detail: "tenant is not valid platform id text" };
  }
  if (asSubjectId(String(command.contributor)) === undefined) {
    return { accepted: false, code: "invalid-contributor", detail: "contributor is not valid platform id text" };
  }
  if (!isContributionKind(command.kind)) {
    return { accepted: false, code: "invalid-kind", detail: `unknown contribution kind: ${String(command.kind)}` };
  }
  if (!isGameIRValue(command.payload)) {
    return { accepted: false, code: "invalid-payload", detail: "payload is not a game-ir kernel value" };
  }
  // Totality against untyped callers: a forged lineage node (id not the
  // content address of its own coordinate) is distinguished from generic
  // provenance malformation (E8 forged-provenance negative path).
  const originKind = (command.provenance as { readonly origin?: { readonly kind?: unknown } } | undefined)?.origin
    ?.kind;
  if (originKind === "lineage-derived" && !isContributionOrigin(command.provenance?.origin)) {
    return {
      accepted: false,
      code: "invalid-lineage-node",
      detail: "origin is malformed: a lineage-derived base must be a content-addressed git-lineage node",
    };
  }
  if (!isContributionProvenanceInput(command.provenance)) {
    return {
      accepted: false,
      code: "invalid-provenance",
      detail: "provenance is malformed: origin shape, AI flag or model-provenance entries are invalid",
    };
  }
  if (command.provenance.aiGenerated && (command.provenance.modelProvenance ?? []).length === 0) {
    return {
      accepted: false,
      code: "ai-disclosure-missing",
      detail: "AI-generated content must disclose at least one model-provenance entry (lock 11)",
    };
  }
  if (command.gap !== undefined && !isCapabilityGapLink(command.gap)) {
    return { accepted: false, code: "invalid-gap-link", detail: "gap link is not well-formed Lab reference text" };
  }
  if (!facts.contributorExists) {
    return { accepted: false, code: "unknown-contributor", detail: "contributor is not known in this tenant" };
  }
  if (facts.contributorTenant !== undefined && facts.contributorTenant !== command.tenant) {
    return {
      accepted: false,
      code: "cross-tenant-contributor",
      detail: `contributor subject belongs to tenant ${String(facts.contributorTenant)}`,
    };
  }
  if (command.gap !== undefined && facts.gap !== undefined) {
    if (!facts.gap.exists) {
      return { accepted: false, code: "unknown-gap", detail: "the linked capability gap is not known to the Lab seam" };
    }
    if (facts.gap.resolved || facts.gap.blocked) {
      return {
        accepted: false,
        code: "gap-not-open",
        detail: `the linked capability gap is ${facts.gap.resolved ? "resolved" : "blocked"}`,
      };
    }
    if (!facts.gap.communityRungReached) {
      return {
        accepted: false,
        code: "gap-not-at-community-rung",
        detail: "the ladder has not walked to the user/community rung (R18 resolution order)",
      };
    }
  }
  if (facts.openContributionsOfContributor >= policy.maxOpenContributionsPerContributor) {
    return {
      accepted: false,
      code: "contributor-quota-full",
      detail: `contributor already holds ${policy.maxOpenContributionsPerContributor} open contributions`,
    };
  }
  if (facts.submissionSeen) {
    return {
      accepted: false,
      code: "duplicate-contribution",
      detail: "submission digest was already recorded (E10: the first receipt stands)",
    };
  }
  return { accepted: true };
}

// ---------------------------------------------------------------------------
// Transition admission (workflow + authority + qualification)
// ---------------------------------------------------------------------------

/** One workflow command. */
export interface TransitionCommand {
  readonly tenant: TenantId;
  readonly contributionId: ContributionId;
  readonly kind: TransitionCommandKind;
  readonly actor: SubjectId;
  readonly reason?: string;
}

/** The qualification facts the package-registry seam supplies (E8). */
export interface LineageBaseQualification {
  readonly published: boolean;
  readonly provenancePasses: boolean;
}

/** The facts the state owner derives for the workflow oracle. */
export interface TransitionFacts {
  /** The current record, when the contribution is known (tenant-scoped). */
  readonly record: ContributionRecord | undefined;
  /** Actor's owning tenant, when known globally (R20 cross-tenant guard). */
  readonly actorTenant: TenantId | undefined;
  /** Actor holds the maintainer role within the RECORD's tenant. */
  readonly actorIsMaintainer: boolean;
  /** Registry qualification of a lineage base (accept-time only). */
  readonly lineageBase: LineageBaseQualification | undefined;
}

/** Result of transition admission: the target state, or a typed refusal. */
export type TransitionAdmission =
  | { readonly accepted: true; readonly to: ContributionStatus }
  | { readonly accepted: false; readonly code: TransitionRefusalCode; readonly detail: string };

/** Typed refusal codes for workflow commands (E8 negative coverage). */
export type TransitionRefusalCode =
  | "unknown-contribution"
  | "invalid-tenant"
  | "invalid-actor"
  | "invalid-command"
  | "reason-too-long"
  | "cross-tenant-actor"
  | "not-a-maintainer"
  | "not-the-contributor"
  | "invalid-transition"
  | "unknown-lineage-base"
  | "lineage-base-unqualified"
  | "duplicate-transition";

/** The target state each command drives the workflow to. */
const COMMAND_TARGET: Readonly<Record<TransitionCommandKind, ContributionStatus>> = Object.freeze({
  triage: "triaged",
  review: "under-review",
  accept: "accepted",
  reject: "rejected",
  withdraw: "withdrawn",
});

/**
 * THE pure workflow oracle. Rule order is normative: ids -> reason bound
 * -> record known (tenant-scoped) -> cross-tenant actor guard (R20) ->
 * command authority (withdraw: contributor-of-record only; the pipeline
 * and verdict commands: maintainers only) -> the frozen state machine ->
 * (accept only) the E8 qualification gate over the lineage base.
 */
export function adjudicateTransition(command: TransitionCommand, facts: TransitionFacts): TransitionAdmission {
  if (asTenantId(String(command.tenant)) === undefined) {
    return { accepted: false, code: "invalid-tenant", detail: "tenant is not valid platform id text" };
  }
  if (asSubjectId(String(command.actor)) === undefined) {
    return { accepted: false, code: "invalid-actor", detail: "actor is not valid platform id text" };
  }
  if (!isTransitionCommandKind(command.kind)) {
    return { accepted: false, code: "invalid-command", detail: `unknown transition command: ${String(command.kind)}` };
  }
  if (command.reason !== undefined && command.reason.length > MAX_REASON_LENGTH) {
    return { accepted: false, code: "reason-too-long", detail: `reason exceeds ${MAX_REASON_LENGTH} characters` };
  }
  const record = facts.record;
  if (record === undefined) {
    return { accepted: false, code: "unknown-contribution", detail: "contribution is not known in this tenant" };
  }
  if (record.tenant !== command.tenant) {
    return {
      accepted: false,
      code: "cross-tenant-actor",
      detail: `contribution belongs to tenant ${String(record.tenant)}`,
    };
  }
  if (facts.actorTenant !== undefined && facts.actorTenant !== record.tenant) {
    return {
      accepted: false,
      code: "cross-tenant-actor",
      detail: `actor subject belongs to tenant ${String(facts.actorTenant)}`,
    };
  }
  // Command authority (E1 owner-of-record + maintainer discipline).
  if (command.kind === "withdraw") {
    if (command.actor !== record.contributor) {
      return {
        accepted: false,
        code: "not-the-contributor",
        detail: "only the contributor-of-record may withdraw a contribution",
      };
    }
  } else if (!facts.actorIsMaintainer) {
    return {
      accepted: false,
      code: "not-a-maintainer",
      detail: `the ${command.kind} command is a community maintainer right`,
    };
  }
  // The frozen state machine.
  const allowedFrom = COMMAND_FROM_STATES[command.kind];
  if (!allowedFrom.includes(record.status)) {
    return {
      accepted: false,
      code: "invalid-transition",
      detail: `cannot ${command.kind} a contribution in state ${record.status}`,
    };
  }
  // E8 qualification gate: third-party lineage bases are untrusted until
  // qualified — the accept command demands published + provenance-passing
  // evidence through the package-registry seam.
  if (command.kind === "accept" && record.provenance.origin.kind === "lineage-derived") {
    const qualification = facts.lineageBase;
    if (qualification === undefined || !qualification.published) {
      return {
        accepted: false,
        code: "unknown-lineage-base",
        detail: "the cited lineage base is not a published package (untrusted until qualified)",
      };
    }
    if (!qualification.provenancePasses) {
      return {
        accepted: false,
        code: "lineage-base-unqualified",
        detail: "the cited lineage base fails the package provenance gate (E8: untrusted until qualified)",
      };
    }
  }
  return { accepted: true, to: COMMAND_TARGET[command.kind] };
}

/** The lineage base coordinate of a record, when it cites one. */
export function lineageBaseOf(record: ContributionRecord): PackageCoordinate | undefined {
  return record.provenance.origin.kind === "lineage-derived"
    ? record.provenance.origin.base.coordinate
    : undefined;
}
