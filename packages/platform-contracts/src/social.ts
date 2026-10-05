/**
 * SOCIAL PLATFORM SERVICE CONTRACTS (R7 / lock rule 17).
 *
 * Social graphs (friends, guilds, teams) are a platform capability. Games
 * declare which graphs exist and bind their semantic events to them
 * (lock 18); the platform owns relationship bookkeeping, consent rules
 * and graph capacity. Relation changes are only ever recorded by the
 * platform authority (see the frozen `platform.social.relationship.changed`
 * authority event in `events.ts`).
 *
 * Purity: pure types + pure guards + a pure action oracle with typed
 * negative paths (E8). No IO.
 */

import type { SubjectId, TenantId } from "./primitives.ts";
import type { GameEventKind } from "./events.ts";

/** The social graph kinds a game may declare (mirrors game-contracts). */
export type SocialGraphKind = "friends" | "guilds" | "teams";

/** All valid {@link SocialGraphKind} values. */
export const SOCIAL_GRAPH_KINDS: readonly SocialGraphKind[] = Object.freeze([
  "friends",
  "guilds",
  "teams",
]);

/** Returns true when `value` is a valid {@link SocialGraphKind}. */
export function isSocialGraphKind(value: unknown): value is SocialGraphKind {
  return typeof value === "string" && (SOCIAL_GRAPH_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Service policy + game-side event binding
// ---------------------------------------------------------------------------

/** Platform social service behavior descriptor. */
export interface SocialServicePolicy {
  readonly maxGraphSize: number;
  readonly requireMutualConsent: boolean;
  readonly presence: boolean;
}

/** Returns true when `value` is a structurally valid {@link SocialServicePolicy}. */
export function isSocialServicePolicy(value: unknown): value is SocialServicePolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.maxGraphSize === "number" &&
    Number.isSafeInteger(policy.maxGraphSize) &&
    policy.maxGraphSize >= 2 &&
    policy.maxGraphSize <= 1000 &&
    typeof policy.requireMutualConsent === "boolean" &&
    typeof policy.presence === "boolean"
  );
}

/** How a game binds one of ITS events to a social graph (lock 18). */
export interface SocialEventBinding {
  readonly capability: "social";
  readonly eventKind: GameEventKind;
  readonly graph: SocialGraphKind;
}

/** Returns true when `value` is a structurally valid {@link SocialEventBinding}. */
export function isSocialEventBinding(value: unknown): value is SocialEventBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return binding.capability === "social" && typeof binding.eventKind === "string" && binding.eventKind.length > 0 && isSocialGraphKind(binding.graph);
}

// ---------------------------------------------------------------------------
// Actions (request/response with typed negative paths)
// ---------------------------------------------------------------------------

/** The social actions a subject may request. */
export type SocialAction = "befriend" | "unbefriend" | "invite" | "join" | "leave";

/** All valid {@link SocialAction} values. */
export const SOCIAL_ACTIONS: readonly SocialAction[] = Object.freeze([
  "befriend",
  "unbefriend",
  "invite",
  "join",
  "leave",
]);

/** Returns true when `value` is a valid {@link SocialAction}. */
export function isSocialAction(value: unknown): value is SocialAction {
  return typeof value === "string" && (SOCIAL_ACTIONS as readonly string[]).includes(value);
}

/** A subject's request to change a social relation. */
export interface SocialActionRequest {
  readonly tenant: TenantId;
  readonly action: SocialAction;
  readonly graph: SocialGraphKind;
  readonly actor: SubjectId;
  readonly target: SubjectId;
}

/** Returns true when `value` is a structurally valid {@link SocialActionRequest}. */
export function isSocialActionRequest(value: unknown): value is SocialActionRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    isSocialAction(request.action) &&
    isSocialGraphKind(request.graph) &&
    typeof request.actor === "string" &&
    request.actor.length > 0 &&
    typeof request.target === "string" &&
    request.target.length > 0
  );
}

/** The graph facts the action oracle decides over. */
export interface SocialGraphFacts {
  readonly graph: SocialGraphKind;
  /** Whether the game declared this graph kind at all (lock 18). */
  readonly declared: boolean;
  readonly members: readonly SubjectId[];
}

/** Result of a social action request. */
export type SocialActionDecision =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly code: "self-relation" | "graph-not-declared" | "mutual-consent-required" | "graph-full" | "not-a-member";
    };

/**
 * Pure social action oracle (E8 negative coverage). Refuses with typed
 * codes: relating a subject to itself, acting on a graph kind the game
 * never declared, unconsented befriending under a consent-requiring
 * policy, joining/inviting into a full graph, and leaving a graph one is
 * not a member of.
 */
export function adjudicateSocialAction(
  request: SocialActionRequest,
  policy: SocialServicePolicy,
  facts: SocialGraphFacts,
): SocialActionDecision {
  if (request.actor === request.target) return { accepted: false, code: "self-relation" };
  if (!facts.declared) return { accepted: false, code: "graph-not-declared" };
  if (request.action === "befriend" && policy.requireMutualConsent) {
    return { accepted: false, code: "mutual-consent-required" };
  }
  if (request.action === "join" || request.action === "invite") {
    if (facts.members.length >= policy.maxGraphSize) return { accepted: false, code: "graph-full" };
  }
  if (request.action === "leave" && !facts.members.includes(request.actor)) {
    return { accepted: false, code: "not-a-member" };
  }
  return { accepted: true };
}

/** One recorded social relation (platform bookkeeping). */
export interface SocialRelation {
  readonly tenant: TenantId;
  readonly graph: SocialGraphKind;
  readonly members: readonly SubjectId[];
  readonly decidedBy: "platform-authority";
}
