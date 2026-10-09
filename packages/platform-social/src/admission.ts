/**
 * SOCIAL GRAPH ADMISSION — the pure command oracle (PL-015).
 *
 * Admission is EVENT-SOURCED over platform-contracts: the first stage
 * binds the platform oracle `adjudicateSocialAction` (self-relation,
 * graph-not-declared, mutual-consent, capacity discipline — its typed
 * codes surface verbatim); the second stage adds the follow/block
 * specific rules, including the safety ordering BLOCK BEATS FOLLOW
 * (E8 negative paths: self-follow refused, blocked targets unreachable,
 * duplicates refused).
 *
 * Mapping (documented decision): follows ride the contracts' "friends"
 * graph vocabulary as its unconsented precursor — `follow` maps to
 * `befriend` (refused with `mutual-consent-required` when the game's
 * policy demands consent) and `unfollow` to `unbefriend`. Blocks are the
 * platform-side safety relation: they bypass the game-declared graph
 * gate (a game must not be able to switch blocking off) but still refuse
 * self-relations.
 *
 * Purity: one pure function over caller-supplied facts (derived by the
 * state owner, never by the command). No IO.
 */

import { asSubjectId, asTenantId, adjudicateSocialAction } from "@playliquid/platform-contracts";
import type {
  ContentDigest,
  SocialActionRequest,
  SocialServicePolicy,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import type { SocialEventEvidence } from "./history.ts";

/** The relation commands the social service admits. */
export type SocialGraphCommandKind = "follow" | "unfollow" | "block" | "unblock";

/** One relation command with its event evidence. */
export interface SocialGraphCommand {
  readonly tenant: TenantId;
  readonly kind: SocialGraphCommandKind;
  readonly actor: SubjectId;
  readonly target: SubjectId;
  readonly evidence: SocialEventEvidence;
}

/** The facts the state owner derives for the oracle (never from the command). */
export interface SocialGraphFactsInput {
  /** Graph kinds the game declared (lock 18). */
  readonly declaredGraphs: readonly string[];
  /** Target subject exists within the COMMAND's tenant. */
  readonly targetExists: boolean;
  /** Tenant the target belongs to, when known globally (R20). */
  readonly targetTenant: TenantId | undefined;
  /** Precomputed evidence digest; `undefined` means malformed evidence. */
  readonly evidenceDigest: ContentDigest | undefined;
  /** The evidence digest was already recorded (idempotency encounter, E10). */
  readonly evidenceSeen: boolean;
  readonly actorFollowsTarget: boolean;
  readonly actorBlocksTarget: boolean;
  readonly targetBlocksActor: boolean;
  readonly actorFollowingCount: number;
}

/** Typed refusal codes (E8 negative coverage; contracts codes surface verbatim). */
export type SocialRefusalCode =
  | "invalid-tenant"
  | "invalid-actor"
  | "invalid-target"
  | "cross-tenant-access"
  | "unknown-target"
  | "invalid-evidence"
  | "duplicate-evidence"
  | "self-relation"
  | "graph-not-declared"
  | "mutual-consent-required"
  | "graph-full"
  | "not-a-member"
  | "blocked-by-target"
  | "blocking-target"
  | "duplicate-relation"
  | "not-following"
  | "not-blocking";

/** Result of social command admission (service adds the recorded receipt). */
export type SocialGraphAdmission =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly code: SocialRefusalCode; readonly detail: string };

/** Maps a follow-family command onto the platform-contracts action space. */
function contractsRequestFor(command: SocialGraphCommand): SocialActionRequest {
  return {
    tenant: command.tenant,
    action: command.kind === "follow" ? "befriend" : "unbefriend",
    graph: "friends",
    actor: command.actor,
    target: command.target,
  };
}

/**
 * THE pure social admission oracle. Rule order is normative:
 * id validity -> evidence validity -> evidence idempotency encounter ->
 * cross-tenant guard -> target existence -> (follow family) the bound
 * platform-contracts oracle -> follow/block-specific rules.
 */
export function adjudicateSocialGraphCommand(
  command: SocialGraphCommand,
  policy: SocialServicePolicy,
  facts: SocialGraphFactsInput,
): SocialGraphAdmission {
  if (asTenantId(String(command.tenant)) === undefined) {
    return { accepted: false, code: "invalid-tenant", detail: "tenant is not valid platform id text" };
  }
  if (asSubjectId(String(command.actor)) === undefined) {
    return { accepted: false, code: "invalid-actor", detail: "actor is not valid platform id text" };
  }
  if (asSubjectId(String(command.target)) === undefined) {
    return { accepted: false, code: "invalid-target", detail: "target is not valid platform id text" };
  }
  if (facts.evidenceDigest === undefined) {
    return { accepted: false, code: "invalid-evidence", detail: "evidence is malformed or not bound to the declared event kind" };
  }
  if (facts.evidenceSeen) {
    return { accepted: false, code: "duplicate-evidence", detail: "evidence digest was already recorded (E10)" };
  }
  if (facts.targetTenant !== undefined && facts.targetTenant !== command.tenant) {
    return {
      accepted: false,
      code: "cross-tenant-access",
      detail: `target subject belongs to tenant ${String(facts.targetTenant)}`,
    };
  }
  if (!facts.targetExists) {
    return { accepted: false, code: "unknown-target", detail: "target subject is not known in this tenant" };
  }
  if (command.kind === "follow" || command.kind === "unfollow") {
    const decision = adjudicateSocialAction(contractsRequestFor(command), policy, {
      graph: "friends",
      declared: facts.declaredGraphs.includes("friends"),
      members: [],
    });
    if (!decision.accepted) {
      return { accepted: false, code: decision.code, detail: `platform social oracle refused: ${decision.code}` };
    }
  } else if (command.actor === command.target) {
    return { accepted: false, code: "self-relation", detail: "a subject cannot relate to itself" };
  }
  switch (command.kind) {
    case "follow":
      if (facts.actorBlocksTarget) {
        return { accepted: false, code: "blocking-target", detail: "actor has blocked the target; follow is refused" };
      }
      if (facts.targetBlocksActor) {
        return { accepted: false, code: "blocked-by-target", detail: "target has blocked the actor; follow is refused" };
      }
      if (facts.actorFollowsTarget) {
        return { accepted: false, code: "duplicate-relation", detail: "actor already follows the target" };
      }
      if (facts.actorFollowingCount >= policy.maxGraphSize) {
        return { accepted: false, code: "graph-full", detail: `actor already follows ${policy.maxGraphSize} subjects` };
      }
      return { accepted: true };
    case "unfollow":
      if (!facts.actorFollowsTarget) {
        return { accepted: false, code: "not-following", detail: "actor does not follow the target" };
      }
      return { accepted: true };
    case "block":
      if (facts.actorBlocksTarget) {
        return { accepted: false, code: "duplicate-relation", detail: "actor already blocks the target" };
      }
      return { accepted: true };
    case "unblock":
      if (!facts.actorBlocksTarget) {
        return { accepted: false, code: "not-blocking", detail: "actor does not block the target" };
      }
      return { accepted: true };
  }
}
