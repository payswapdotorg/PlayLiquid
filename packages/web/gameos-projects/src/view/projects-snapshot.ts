/**
 * WORLD PROJECTS READ-MODEL SNAPSHOT (pure types): the authoritative
 * project facts a host hands the workbench — one summary row per world
 * project (its world declaration, default branch and counts), plus each
 * project's detail payload (branches, recent commits, tasks, the package
 * composition pins and the semantic pull requests).
 *
 * LEAF MODULE (no local imports beyond projects-selection.ts): the shared
 * read-model vocabulary every view projection consumes — the projections
 * live in their own modules (projects-view, project-overview-view,
 * composition-view, semantic-pr-view) and all import from here, keeping
 * the view layer acyclic.
 *
 * Every type is the anchor packages' OWN public vocabulary, imported
 * verbatim (no forked types): world kinds and declarations from
 * game-contracts (ACR-001 — the list resolves each project's effective
 * world kind through `resolveWorldKind`, including the pre-ACR default
 * `game` for projects with no world declaration), branch/commit identity
 * from game-contracts' git vocabulary, semantic change kinds from
 * git-lineage, pull-request lifecycle status from community's frozen
 * state machine and package coordinates/semver/digests from
 * package-system. Tenancy is platform-contracts' TenantId/SubjectId
 * (R20).
 */

import type {
  BranchName,
  CommitSha,
  WorldDeclaration,
} from "../../../../game-contracts/src/index.ts";
import type { SemanticChangeKind } from "../../../../git-lineage/src/index.ts";
import type { ContributionId, ContributionStatus } from "../../../../community/src/index.ts";
import type {
  ContentDigest,
  PackageCoordinate,
} from "../../../../package-system/src/index.ts";
import type { SubjectId, TenantId } from "../../../../platform-contracts/src/index.ts";
import type { ProjectsViewer } from "./projects-selection.ts";

/** One world project summary row (the projects list read model). */
export interface WorldProjectSummary {
  readonly projectId: string;
  readonly name: string;
  /**
   * The project's own world declaration, exactly as its GameIR document
   * carries it (ACR-001 §4 — both dimensions independently optional).
   * Absent for pre-ACR projects; the list projection resolves the
   * effective kind through game-contracts' `resolveWorldKind`.
   */
  readonly worldDeclaration: WorldDeclaration | undefined;
  readonly defaultBranch: BranchName;
  readonly branchCount: number;
  readonly openPullRequestCount: number;
  readonly packageCount: number;
  readonly openTaskCount: number;
  /** Last recorded activity, epoch milliseconds. */
  readonly lastActivityAt: number;
  /** The tenant that owns the project (R20). */
  readonly ownerTenant: TenantId;
}

/** One branch of a project's Git repository (game-contracts vocabulary). */
export interface BranchSummary {
  readonly name: BranchName;
  readonly lastCommitSha: CommitSha;
  readonly lastCommitHeadline: string;
}

/** One recent commit of a project's Git repository. */
export interface CommitSummary {
  readonly sha: CommitSha;
  readonly headline: string;
  readonly author: SubjectId;
  /** Commit timestamp, epoch milliseconds. */
  readonly at: number;
}

/** One project board task. */
export interface TaskSummary {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "in-review" | "done";
}

/**
 * One package composition pin: the exact package coordinate the project
 * composes (kind, id, semantic version and content digest — the pin's
 * `version` and `digest` ARE the coordinate's, never re-declared), plus
 * the pinned package's release-gate verdict (package-system's R19
 * fail-closed provenance/licensing gate, as the host read it from the
 * registry's read doors).
 */
export interface CompositionPin {
  readonly coordinate: PackageCoordinate;
  readonly releaseGate: "pass" | "blocked";
  /** The gate failure summary, when blocked (real gate vocabulary). */
  readonly failureSummary: string | null;
}

/** The count of changes of one semantic change kind inside a pull request. */
export interface ChangeKindCount {
  readonly kind: SemanticChangeKind;
  readonly count: number;
}

/**
 * One semantic pull request: a community contribution (kind
 * `pull-request`) whose change set git-lineage classified into the frozen
 * semantic change-kind vocabulary. The lifecycle status is community's
 * frozen state machine VERBATIM — the review actions reuse it, never
 * fork it.
 */
export interface SemanticPullRequestSummary {
  /** The pull request's content-addressed community contribution id. */
  readonly prId: ContributionId;
  readonly title: string;
  readonly author: SubjectId;
  readonly status: ContributionStatus;
  readonly baseRef: BranchName;
  readonly headRef: BranchName;
  /** Changes per semantic change kind (git-lineage classification). */
  readonly changeKindCounts: readonly ChangeKindCount[];
  /** How many distinct subjects the change set touches. */
  readonly subjectCount: number;
  /** Content address of the classified semantic diff (pins the counts). */
  readonly semanticDiffId: ContentDigest;
  /** The owner tenant whose project this pull request updates (R20). */
  readonly updatedByOwnerTenant: TenantId;
}

/** One project's detail payload (branches, commits, tasks, composition, PRs). */
export interface WorldProjectDetail {
  readonly branches: readonly BranchSummary[];
  readonly commits: readonly CommitSummary[];
  readonly tasks: readonly TaskSummary[];
  readonly composition: readonly CompositionPin[];
  readonly pullRequests: readonly SemanticPullRequestSummary[];
}

/**
 * The authoritative World Projects read models a host hands the
 * workbench. A production host returns viewer-scoped read models
 * assembled from the authoritative services' read doors; the demo host
 * deliberately includes one foreign-tenant project (with its detail
 * payload) so the R20 guard is visible and testable.
 */
export interface ProjectsDataSnapshot {
  /** The tenancy scope of this read model (R20; guards selection + commands). */
  readonly viewer: ProjectsViewer;
  readonly projects: readonly WorldProjectSummary[];
  /** Per-project detail payloads, keyed by projectId. */
  readonly details: ReadonlyMap<string, WorldProjectDetail>;
}
