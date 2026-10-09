/**
 * SOCIAL GRAPH RELATIONS + READ MODEL (PL-015).
 *
 * The follow/block relation state and its tenant-scoped read views.
 * Follows are directed, one-way relations (no consent required unless
 * the game's social policy says otherwise — platform-contracts'
 * `SocialServicePolicy`). Blocks are the platform-side safety relation:
 * a block ALWAYS beats a follow (architecture "No fake engagement /
 * anti-abuse": safety over engagement). "Friends" is the derived,
 * mutual-follow cohort exposed through the platform-contracts
 * `SocialRelation` shape.
 *
 * Purity: types + pure derivation over edge tables. No IO.
 */

import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import type { SocialRelation } from "@playliquid/platform-contracts";
import type { SocialRelationKind } from "./history.ts";

/** One directed relation edge (follow or block). */
export interface SocialEdge {
  readonly tenant: TenantId;
  readonly actor: SubjectId;
  readonly target: SubjectId;
  readonly relation: SocialRelationKind;
}

/** Edge table key: `(tenant, relation, actor, target)`. */
export function edgeKey(tenant: TenantId, relation: SocialRelationKind, actor: SubjectId, target: SubjectId): string {
  return `${String(tenant)}|${relation}|${String(actor)}|${String(target)}`;
}

/** The read-model view of one subject's graph within one tenant (R20). */
export interface SocialGraphView {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly following: readonly SubjectId[];
  readonly followers: readonly SubjectId[];
  readonly blocked: readonly SubjectId[];
  /** Derived: subjects this subject follows who also follow back. */
  readonly friends: readonly SubjectId[];
}

/**
 * Derive the graph view from edge tables. Pure: same edges in, same
 * view out, always in stable (subject id) order for determinism.
 */
export function deriveGraphView(
  tenant: TenantId,
  subject: SubjectId,
  edges: readonly SocialEdge[],
): SocialGraphView {
  const following: SubjectId[] = [];
  const followers: SubjectId[] = [];
  const blocked: SubjectId[] = [];
  const followingSet = new Set<string>();
  for (const edge of edges) {
    if (edge.tenant !== tenant) continue;
    if (edge.relation === "follow" && edge.actor === subject) {
      following.push(edge.target);
      followingSet.add(String(edge.target));
    } else if (edge.relation === "follow" && edge.target === subject) {
      followers.push(edge.actor);
    } else if (edge.relation === "block" && edge.actor === subject) {
      blocked.push(edge.target);
    }
  }
  const friends = followers.filter((candidate) => followingSet.has(String(candidate)));
  const bySubjectText = (a: SubjectId, b: SubjectId): number => String(a).localeCompare(String(b));
  following.sort(bySubjectText);
  followers.sort(bySubjectText);
  blocked.sort(bySubjectText);
  friends.sort(bySubjectText);
  return { tenant, subject, following, followers, blocked, friends };
}

/**
 * The "friends" cohort in the platform-contracts record shape: graph
 * kind `friends`, membership = the subject plus its mutual follows,
 * decided by the platform authority only. Games read this shape; they
 * never assemble it themselves (lock 18).
 */
export function friendCohortOf(view: SocialGraphView): SocialRelation {
  return {
    tenant: view.tenant,
    graph: "friends",
    members: [view.subject, ...view.friends],
    decidedBy: "platform-authority",
  };
}

/** Pure predicate: does `actor` currently follow `target`? */
export function isFollowing(edges: readonly SocialEdge[], actor: SubjectId, target: SubjectId): boolean {
  return edges.some(
    (edge) => edge.relation === "follow" && edge.actor === actor && edge.target === target,
  );
}

/** Pure predicate: has `actor` blocked `target`? */
export function isBlocking(edges: readonly SocialEdge[], actor: SubjectId, target: SubjectId): boolean {
  return edges.some(
    (edge) => edge.relation === "block" && edge.actor === actor && edge.target === target,
  );
}
