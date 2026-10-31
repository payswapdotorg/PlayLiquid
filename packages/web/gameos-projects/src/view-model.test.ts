/**
 * Read-model projection tests (pure): the World Projects workbench
 * surfaces over the REAL demo snapshot (real community-service pull
 * requests, real sealed package-system records with real release-gate
 * verdicts, real validated git-lineage semantic diffs) — deterministic
 * outputs (E9), the ACR-001 world-kind read model (including the
 * pre-ACR default), R20 tenancy flags, the community-frozen
 * review-action legality matched verbatim for EVERY status, the R19
 * gate counts, the frozen-vocabulary change-kind summary lines and the
 * shared status vocabulary (E1).
 *
 * Honesty scope (E11): no DOM, no rendering, no network — pure
 * projections over deterministic in-memory read models.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWorldKind } from "../../../game-contracts/src/index.ts";
import {
  COMMAND_FROM_STATES,
  CONTRIBUTION_STATUSES,
  CONTRIBUTION_TRANSITIONS,
  TRANSITION_COMMANDS,
} from "../../../community/src/index.ts";
import { SEMANTIC_CHANGE_KINDS } from "../../../git-lineage/src/index.ts";
import {
  DEMO_PROJECTS_FOREIGN_TENANT,
  demoProjectsSnapshot,
} from "./fixtures/demo.ts";
import { INITIAL_PROJECTS_SELECTION } from "./view/projects-selection.ts";
import {
  projectProjects,
  projectWorkbench,
  projectsSummary,
} from "./view/projects-view.ts";
import type { ProjectsDataSnapshot, WorldProjectSummary } from "./view/projects-view.ts";
import { overviewSummary, projectOverview } from "./view/project-overview-view.ts";
import { compositionSummary, projectComposition } from "./view/composition-view.ts";
import {
  changeKindSummaryLine,
  legalTransitionsFor,
  projectPullRequests,
  pullRequestsSummary,
} from "./view/semantic-pr-view.ts";
import {
  gateStatusStatus,
  pullRequestStatusStatus,
  taskStatusStatus,
  worldKindStatus,
} from "./view/status.ts";
import {
  PROJECTS_EMPTY_STATE_COPY,
  commandLogNextHint,
  refreshFailureNextStep,
} from "./view/onboarding.ts";
import type { ProjectsEmptySurfaceId } from "./view/onboarding.ts";
import type { ProjectsCommandLogEntry } from "./ports.ts";

const snapshot = demoProjectsSnapshot();

test("demo snapshot is assembled from real anchor machinery", () => {
  assert.equal(snapshot.projects.length, 3, "three world projects");
  const harbor = snapshot.details.get("harbor-cycle")!;
  // Real community-service contributions: submitted / under-review / accepted.
  const statuses = harbor.pullRequests.map((pr) => pr.status).sort();
  assert.deepEqual(statuses, ["accepted", "submitted", "under-review"]);
  // Real sealed records with real gate runs: 4 pins, exactly one blocked.
  assert.equal(harbor.composition.length, 4);
  assert.equal(harbor.composition.filter((pin) => pin.releaseGate === "blocked").length, 1);
  // The change kinds span the frozen vocabulary (≥ 4 distinct kinds).
  const kinds = new Set(
    [...snapshot.details.values()].flatMap((detail) =>
      detail.pullRequests.flatMap((pr) => pr.changeKindCounts.map((entry) => entry.kind)),
    ),
  );
  assert.ok(kinds.size >= 4, `spanning ${kinds.size} semantic change kinds`);
});

test("world-kind projection resolves through resolveWorldKind (ACR-001 read model)", () => {
  const view = projectProjects(snapshot);
  const harbor = view.rows.find((row) => row.projectId === "harbor-cycle")!;
  // The demo harbor project carries NO world declaration: pre-ACR ⇒ `game`.
  assert.equal(harbor.worldKindDefaulted, true);
  assert.equal(harbor.worldKind, resolveWorldKind(undefined));
  assert.equal(harbor.worldKind, "game");
  const spark = view.rows.find((row) => row.projectId === "spark-garden")!;
  assert.equal(spark.worldKind, "spark");
  assert.equal(spark.worldKindDefaulted, false);
  const twin = view.rows.find((row) => row.projectId === "twin-factory")!;
  assert.equal(twin.worldKind, "digital_twin");
  // Vocabulary-order presence list (ACR-001 frozen order).
  assert.deepEqual(view.worldKindsPresent, ["spark", "game", "digital_twin"]);
  // A hand-built declaration projects through the same resolver.
  const sparkProject = snapshot.projects.find((project) => project.projectId === "spark-garden")!;
  const experience: WorldProjectSummary = {
    ...sparkProject,
    projectId: "experience-probe",
    name: "experience-probe",
    worldDeclaration: { kind: "experience" },
  };
  const probe = projectProjects({
    ...snapshot,
    projects: [...snapshot.projects, experience],
  });
  assert.equal(probe.rows.find((row) => row.projectId === "experience-probe")!.worldKind, "experience");
});

test("projectWorkbench assembles all four surfaces from one snapshot", () => {
  const view = projectWorkbench(snapshot, INITIAL_PROJECTS_SELECTION);
  assert.equal(view.selection, INITIAL_PROJECTS_SELECTION);
  assert.equal(view.projects.totalProjects, 3);
  assert.equal(view.overview.projectId, null, "no project open");
  assert.equal(view.composition.totalPins, 0);
  assert.equal(view.pullRequests.totalPullRequests, 0);
  const opened = projectWorkbench(snapshot, {
    tab: "overview",
    projectId: "harbor-cycle",
    prId: null,
  });
  assert.equal(opened.overview.projectId, "harbor-cycle");
  assert.equal(opened.composition.totalPins, 4);
  assert.equal(opened.pullRequests.totalPullRequests, 3);
});

test("projectWorkbench is deterministic: same inputs → identical views (E9)", () => {
  const selection = { tab: "pull-requests" as const, projectId: "harbor-cycle", prId: null };
  const a = projectWorkbench(snapshot, selection);
  const b = projectWorkbench(snapshot, selection);
  assert.deepEqual(a.projects.rows, b.projects.rows);
  assert.deepEqual(a.overview, b.overview);
  assert.deepEqual(a.composition, b.composition);
  assert.deepEqual(a.pullRequests, b.pullRequests);
  assert.equal(projectsSummary(a.projects), projectsSummary(b.projects));
});

test("re-assembling the demo snapshot renders the same summaries (E9 snapshot test)", () => {
  const again = demoProjectsSnapshot();
  const a = projectWorkbench(snapshot, INITIAL_PROJECTS_SELECTION);
  const b = projectWorkbench(again, INITIAL_PROJECTS_SELECTION);
  assert.equal(projectsSummary(a.projects), projectsSummary(b.projects));
  assert.equal(overviewSummary(a.overview), overviewSummary(b.overview));
  assert.equal(compositionSummary(a.composition), compositionSummary(b.composition));
  assert.equal(pullRequestsSummary(a.pullRequests), pullRequestsSummary(b.pullRequests));
});

test("tenancy: foreign projects render as visible foreign-tenant rows (R20)", () => {
  const view = projectProjects(snapshot);
  const foreign = view.rows.filter((row) => row.ownerTenant === String(DEMO_PROJECTS_FOREIGN_TENANT));
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0]!.projectId, "twin-factory");
  assert.equal(foreign[0]!.foreignTenant, true);
  assert.equal(view.foreignCount, 1);
  for (const row of view.rows) {
    if (row.ownerTenant === String(DEMO_PROJECTS_FOREIGN_TENANT)) continue;
    assert.equal(row.foreignTenant, false);
  }
  // The foreign project's detail payload is CARRIED (visible read model),
  // never hidden — the store's typed refusal guards acting on it.
  assert.ok(snapshot.details.get("twin-factory")!.pullRequests.length > 0);
  assert.match(projectsSummary(view), /1 foreign-tenant row/);
});

test("pull-request status vocabulary is the ONE owner and mirrors the frozen machine (E1)", () => {
  assert.equal(pullRequestStatusStatus("submitted").tone, "info");
  assert.equal(pullRequestStatusStatus("triaged").tone, "info");
  assert.equal(pullRequestStatusStatus("under-review").tone, "warn");
  assert.equal(pullRequestStatusStatus("accepted").tone, "ok");
  assert.equal(pullRequestStatusStatus("rejected").tone, "error");
  assert.equal(pullRequestStatusStatus("withdrawn").tone, "neutral");
  // Every status has a distinct, human label; unknowns fall back honestly.
  const labels = new Set(CONTRIBUTION_STATUSES.map((status) => pullRequestStatusStatus(status).label));
  assert.equal(labels.size, CONTRIBUTION_STATUSES.length);
  assert.equal(pullRequestStatusStatus("reopened").tone, "neutral");
  // Terminal notes state the E10 rule outright.
  assert.match(pullRequestStatusStatus("accepted").note!, /terminal/);
  assert.match(pullRequestStatusStatus("rejected").note!, /terminal/);
  // The world-kind + task + gate vocabularies map through the same owner.
  assert.equal(worldKindStatus("digital_twin").label, "digital twin");
  assert.equal(worldKindStatus("spark").tone, "info");
  assert.equal(taskStatusStatus("in-review").tone, "warn");
  assert.equal(taskStatusStatus("done").tone, "ok");
  assert.equal(gateStatusStatus("pass").tone, "ok");
  assert.equal(gateStatusStatus("blocked").tone, "error");
});

test("legalTransitionsFor matches the community tables verbatim for EVERY status", () => {
  for (const status of CONTRIBUTION_STATUSES) {
    const legal = legalTransitionsFor(status);
    // (1) Exactly the commands whose frozen COMMAND_FROM_STATES row
    //     includes this status — computed from the imported table.
    assert.deepEqual(
      [...legal],
      TRANSITION_COMMANDS.filter((command) => COMMAND_FROM_STATES[command].includes(status)),
      `status ${status}`,
    );
    // (2) Same availability count as the frozen transition table.
    assert.equal(legal.length, CONTRIBUTION_TRANSITIONS[status].length, `status ${status}`);
    // (3) Bijection with the frozen targets: each legal command matches
    //     exactly one target state, and every target is matched.
    const targets = [...CONTRIBUTION_TRANSITIONS[status]];
    for (const command of legal) {
      const matches = targets.filter((target) => target.startsWith(command) || target.includes(command));
      assert.equal(matches.length, 1, `${command} from ${status} matches exactly one frozen target`);
    }
    for (const target of targets) {
      const matches = [...legal].filter(
        (command) => target.startsWith(command) || target.includes(command),
      );
      assert.equal(matches.length, 1, `target ${target} of ${status} is matched by exactly one command`);
    }
    // (4) Terminal statuses admit no commands (E10).
    if (CONTRIBUTION_TRANSITIONS[status].length === 0) {
      assert.equal(legal.length, 0, `${status} is terminal`);
    }
  }
  // The concrete frozen chain.
  assert.deepEqual([...legalTransitionsFor("submitted")], ["triage"]);
  assert.deepEqual([...legalTransitionsFor("triaged")], ["review"]);
  assert.deepEqual([...legalTransitionsFor("under-review")], ["accept", "reject", "withdraw"]);
});

test("the review detail exposes exactly the legal commands for its status", () => {
  const harbor = snapshot.details.get("harbor-cycle")!;
  const underReview = harbor.pullRequests.find((pr) => pr.status === "under-review")!;
  const view = projectWorkbench(snapshot, {
    tab: "pull-requests",
    projectId: "harbor-cycle",
    prId: String(underReview.prId),
  });
  const detail = view.pullRequests.selected!;
  assert.equal(detail.status, "under-review");
  assert.deepEqual([...detail.legalTransitions], ["accept", "reject", "withdraw"]);
  // The accepted PR is terminal: no review action is legal.
  const accepted = harbor.pullRequests.find((pr) => pr.status === "accepted")!;
  const acceptedView = projectPullRequests(harbor, { prId: String(accepted.prId) });
  assert.deepEqual([...acceptedView.selected!.legalTransitions], []);
});

test("composition: gate verdicts and counts render from the real gate runs (R19)", () => {
  const view = projectComposition(snapshot.details.get("harbor-cycle"));
  assert.equal(view.totalPins, 4);
  assert.equal(view.blockedPins, 1);
  assert.equal(view.passedPins, 3);
  const blocked = view.rows.find((row) => row.releaseGate === "blocked")!;
  assert.equal(blocked.packageId, "harbor-dialogue-rules");
  assert.match(blocked.failureSummary!, /license-unverified/);
  assert.match(blocked.failureSummary!, /fail-closed/);
  for (const row of view.rows) {
    if (row.releaseGate === "pass") assert.equal(row.failureSummary, null);
  }
  assert.match(compositionSummary(view), /4 pins · 1 gate-blocked · 3 passing/);
  // The empty project (no detail) projects the typed empty view (E11).
  assert.equal(projectComposition(undefined).totalPins, 0);
});

test("change-kind summary lines render in frozen vocabulary order", () => {
  const harbor = snapshot.details.get("harbor-cycle")!;
  const review = harbor.pullRequests.find((pr) => pr.status === "under-review")!;
  assert.equal(
    changeKindSummaryLine(review.changeKindCounts),
    "3 package · 1 world · 2 asset",
    "the summary line uses the frozen SEMANTIC_CHANGE_KINDS order",
  );
  // Out-of-order counts still render in vocabulary order (single owner).
  assert.equal(
    changeKindSummaryLine([
      { kind: "asset", count: 2 },
      { kind: "package", count: 3 },
      { kind: "world", count: 1 },
    ]),
    "3 package · 1 world · 2 asset",
  );
  assert.equal(changeKindSummaryLine([]), "no classified changes");
  // The picked PR's detail counts are sorted by the frozen order too.
  const view = projectPullRequests(harbor, { prId: String(review.prId) });
  const kinds = view.selected!.changeKindCounts.map((entry) => entry.kind);
  const order = kinds.map((kind) => SEMANTIC_CHANGE_KINDS.indexOf(kind));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(view.selected!.subjectCount > 0);
  assert.match(view.selected!.semanticDiffId, /^sha256:[0-9a-f]{64}$/);
});

test("overview: branches, newest-first commits and task counts project deterministically", () => {
  const harborSummaryRow = snapshot.projects.find((p) => p.projectId === "harbor-cycle")!;
  const view = projectOverview(harborSummaryRow, snapshot.details.get("harbor-cycle"));
  assert.equal(view.projectName, "harbor-cycle");
  assert.equal(view.defaultBranch, "main");
  assert.equal(view.branches.length, 2);
  assert.equal(view.commits.length, 4);
  const times = view.commits.map((row) => row.at);
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest commits render first");
  assert.equal(view.openTaskCount, 1);
  assert.equal(view.inReviewTaskCount, 1);
  assert.equal(view.doneTaskCount, 1);
  assert.match(overviewSummary(view), /harbor-cycle · 2 branches · 4 recent commits/);
  assert.equal(projectOverview(undefined, undefined).projectId, null);
});

test("every empty surface has first-run copy naming a REAL next step (UX-002)", () => {
  const surfaces: readonly ProjectsEmptySurfaceId[] = [
    "projects",
    "overview",
    "composition",
    "pull-requests",
  ];
  for (const surface of surfaces) {
    const copy = PROJECTS_EMPTY_STATE_COPY[surface];
    assert.ok(copy !== undefined, `surface ${surface} has copy`);
    assert.ok(copy.title.length > 0);
    assert.ok(copy.explanation.length > 0);
    assert.ok(copy.nextStepLabel.length > 0);
    assert.ok(copy.guidance.length > 0);
    // The only REAL operation of a no-data surface: one data-port pull.
    assert.equal(copy.nextStepLabel, "Refresh read models");
  }
  assert.ok(Object.isFrozen(PROJECTS_EMPTY_STATE_COPY));
  for (const surface of surfaces) {
    assert.ok(Object.isFrozen(PROJECTS_EMPTY_STATE_COPY[surface]));
  }
  const all = surfaces.flatMap((surface) => PROJECTS_EMPTY_STATE_COPY[surface].guidance).join(" ");
  assert.match(all, /Studio workspace/, "project creation is named as prose with its real home");
});

test("contextual hints: null when nothing happened, honest lines otherwise", () => {
  assert.equal(refreshFailureNextStep(null), null);
  const failureLine = refreshFailureNextStep("projects service down");
  assert.ok(failureLine !== null);
  assert.match(failureLine, /still render/);
  assert.equal(commandLogNextHint([]), null);
  const okEntry: ProjectsCommandLogEntry = {
    intent: { kind: "transition-pull-request", prId: ("sha256:" + "a".repeat(64)) as never, command: "triage" },
    receipt: { ok: true, prId: ("sha256:" + "a".repeat(64)) as never, command: "triage", at: 42 },
  };
  const okLine = commandLogNextHint([okEntry]);
  assert.ok(okLine !== null);
  assert.match(okLine, /transition-pull-request → triage accepted at 42/);
  const refusedEntry: ProjectsCommandLogEntry = {
    intent: okEntry.intent,
    receipt: { ok: false, code: "cross-tenant", detail: "another tenant owns this pull request" },
  };
  const hint = commandLogNextHint([refusedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /refused \(cross-tenant\)/);
  assert.match(hint, /E8/);
  assert.match(hint, /no hidden retries/);
  // The LAST entry's outcome is the one narrated (append-only log).
  const lastLine = commandLogNextHint([okEntry, refusedEntry]);
  assert.ok(lastLine !== null);
  assert.match(lastLine, /refused/);
});

test("the projects summary line states the read model honestly", () => {
  const view = projectProjects(snapshot);
  assert.equal(view.totalProjects, 3);
  assert.equal(view.totalOpenPullRequests, 3, "2 harbor + 1 foreign open pull request");
  assert.equal(view.totalOpenTasks, 3);
  assert.match(projectsSummary(view), /3 projects · 3 open pull requests · 3 open tasks/);
  const empty: ProjectsDataSnapshot = {
    viewer: snapshot.viewer,
    projects: [],
    details: new Map(),
  };
  assert.equal(projectProjects(empty).totalProjects, 0);
  assert.match(projectsSummary(projectProjects(empty)), /0 projects/);
});
