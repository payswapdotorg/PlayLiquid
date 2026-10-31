/**
 * DEMO WORLD PROJECTS WORKBENCH FIXTURE (tests + web preview mount): ONE
 * authoritative `ProjectsDataSnapshot` assembled from REAL anchor-package
 * machinery. The fixture is split into focused parts — the tenant
 * identity (demo-tenants.ts), the sealed composition pins with real gate
 * verdicts (demo-pins.ts) and the walked semantic pull requests
 * (demo-pull-requests.ts) — composed here into the three demo projects.
 *
 * TEST-SUPPORT / DEMO FIXTURE ONLY (lock rule 44): nothing here is a
 * production integration. Three projects span the world-kind read model
 * (a pre-ACR project with NO world declaration — it defaults to `game`
 * — an explicit `spark`, and a foreign-tenant `digital_twin`); the
 * deliberately confused foreign-tenant project (with its detail payload
 * and one pull request) makes the R20 tenancy guards (the store's typed
 * cross-tenant selection + transition refusals) visible and testable —
 * a production host returns viewer-scoped read models.
 *
 * Synchronous and deterministic (E9): the fixed clock advances by fixed
 * steps, every digest is content-derived — no IO, no wall clock, no
 * randomness.
 */

import { asBranchName, asCommitSha } from "../../../../game-contracts/src/index.ts";
import type { CommitSha } from "../../../../game-contracts/src/index.ts";
import type { SubjectId } from "../../../../platform-contracts/src/index.ts";
import type {
  CommitSummary,
  ProjectsDataSnapshot,
  WorldProjectDetail,
  WorldProjectSummary,
} from "../view/projects-snapshot.ts";
import {
  AUTHOR,
  DEMO_PROJECTS_FOREIGN_TENANT,
  DEMO_PROJECTS_TENANT,
  DEMO_PROJECTS_VIEWER,
  FOREIGN_AUTHOR,
} from "./demo-tenants.ts";
import {
  harborAssets,
  harborDialogue,
  harborEvaluation,
  harborWorld,
  pinOf,
  sparkPalette,
  sparkWorld,
  twinLayout,
} from "./demo-pins.ts";
import { harborPullRequests, twinPullRequests } from "./demo-pull-requests.ts";

export {
  DEMO_PROJECTS_FOREIGN_TENANT,
  DEMO_PROJECTS_TENANT,
  DEMO_PROJECTS_VIEWER,
} from "./demo-tenants.ts";

// ---------------------------------------------------------------------------
// The three projects (summaries + details)
// ---------------------------------------------------------------------------

const BASE_AT = 1_767_225_600_000;

function commitSha(n: number): CommitSha {
  const sha = asCommitSha(n.toString(16).padStart(40, "0"));
  if (sha === undefined) throw new Error(`demo: bad commit sha seed ${n}`);
  return sha;
}

function commit(n: number, headline: string, atOffset: number, author: SubjectId): CommitSummary {
  return { sha: commitSha(n), headline, author, at: BASE_AT + atOffset };
}

const harborDetail: WorldProjectDetail = {
  branches: [
    { name: asBranchName("main")!, lastCommitSha: commitSha(11), lastCommitHeadline: "Bump harbor world to 1.4.2" },
    { name: asBranchName("feature/harbor-quests")!, lastCommitSha: commitSha(14), lastCommitHeadline: "Quest rule: escort the ferry" },
  ],
  commits: [
    commit(11, "Bump harbor world to 1.4.2", 0, AUTHOR),
    commit(12, "Pin harbor-assets 0.9.0", 3_600_000, AUTHOR),
    commit(13, "Wire dialogue rule pack", 7_200_000, DEMO_PROJECTS_VIEWER),
    commit(14, "Quest rule: escort the ferry", 10_800_000, AUTHOR),
  ],
  tasks: [
    { id: "harbor-task-1", title: "Wire harbor fog particles", status: "open" },
    { id: "harbor-task-2", title: "Quest rule: escort the ferry", status: "in-review" },
    { id: "harbor-task-3", title: "Skybox palette pass", status: "done" },
  ],
  composition: [pinOf(harborWorld), pinOf(harborAssets), pinOf(harborDialogue), pinOf(harborEvaluation)],
  pullRequests: harborPullRequests,
};

const sparkDetail: WorldProjectDetail = {
  branches: [
    { name: asBranchName("main")!, lastCommitSha: commitSha(21), lastCommitHeadline: "Spark garden vertical slice" },
  ],
  commits: [
    commit(21, "Spark garden vertical slice", 0, AUTHOR),
    commit(22, "9:16 fast-start profile pass", 3_600_000, AUTHOR),
  ],
  tasks: [
    { id: "spark-task-1", title: "First-run guidance copy", status: "open" },
    { id: "spark-task-2", title: "Palette pins sealed", status: "done" },
  ],
  composition: [pinOf(sparkWorld), pinOf(sparkPalette)],
  pullRequests: [],
};

const twinDetail: WorldProjectDetail = {
  branches: [
    { name: asBranchName("main")!, lastCommitSha: commitSha(31), lastCommitHeadline: "Import factory floor scan" },
  ],
  commits: [commit(31, "Import factory floor scan", 0, FOREIGN_AUTHOR)],
  tasks: [{ id: "twin-task-1", title: "Align twin telemetry policy", status: "open" }],
  composition: [pinOf(twinLayout)],
  pullRequests: twinPullRequests,
};

/** One project summary derived from its own detail payload (single owner). */
function projectSummary(
  projectId: string,
  worldDeclaration: WorldProjectSummary["worldDeclaration"],
  detail: WorldProjectDetail,
  ownerTenant: WorldProjectSummary["ownerTenant"],
  lastActivityAt: number,
): WorldProjectSummary {
  return {
    projectId,
    name: projectId,
    worldDeclaration,
    defaultBranch: asBranchName("main")!,
    branchCount: detail.branches.length,
    openPullRequestCount: detail.pullRequests.filter(
      (pr) => pr.status === "submitted" || pr.status === "triaged" || pr.status === "under-review",
    ).length,
    packageCount: detail.composition.length,
    openTaskCount: detail.tasks.filter((task) => task.status === "open").length,
    lastActivityAt,
    ownerTenant,
  };
}

const harborSummary = projectSummary(
  "harbor-cycle",
  undefined,
  harborDetail,
  DEMO_PROJECTS_TENANT,
  BASE_AT + 10_800_000,
);

const sparkSummary = projectSummary(
  "spark-garden",
  { kind: "spark" },
  sparkDetail,
  DEMO_PROJECTS_TENANT,
  BASE_AT + 3_600_000,
);

const twinSummary = projectSummary(
  "twin-factory",
  { kind: "digital_twin" },
  twinDetail,
  DEMO_PROJECTS_FOREIGN_TENANT,
  BASE_AT,
);

/**
 * Assemble the demo World Projects read-model snapshot. Deterministic
 * (E9): the journey ran once at module load over fixed fakes and real
 * anchor machinery; repeated calls return the same state.
 */
export function demoProjectsSnapshot(): ProjectsDataSnapshot {
  return {
    viewer: {
      tenantId: DEMO_PROJECTS_TENANT,
      subjectId: DEMO_PROJECTS_VIEWER,
      displayName: "Demo Projects Lead",
    },
    projects: [harborSummary, sparkSummary, twinSummary],
    details: new Map<string, WorldProjectDetail>([
      ["harbor-cycle", harborDetail],
      ["spark-garden", sparkDetail],
      ["twin-factory", twinDetail],
    ]),
  } satisfies ProjectsDataSnapshot;
}
