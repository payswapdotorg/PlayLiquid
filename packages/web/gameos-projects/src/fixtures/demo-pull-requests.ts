/**
 * DEMO SEMANTIC PULL REQUESTS (part of the demo fixture): REAL community
 * service contributions (kind `pull-request`) walked through the REAL
 * frozen lifecycle (submit → triage → review → accept) so ids and
 * statuses come from the community package itself, paired with REAL
 * git-lineage `SemanticDiff` values (validated and classified).
 * TEST-SUPPORT / DEMO FIXTURE ONLY (lock rule 44).
 */

import {
  CommunityService,
  asContributionId,
  createFixedClock,
  createMemoryCommunityStore,
  createMemoryGapDirectory,
  createMemoryPackageRegistry,
  createMemorySubjectDirectory,
  fakePayload,
  ids,
} from "../../../../community/src/index.ts";
import type {
  ContributionRecord,
  SubmitContributionCommand,
  TransitionCommandKind,
} from "../../../../community/src/index.ts";
import { computeDigest } from "../../../../package-system/src/index.ts";
import { semanticDiffId, validateSemanticDiff } from "../../../../git-lineage/src/index.ts";
import type {
  SemanticChange,
  SemanticChangeKind,
  SemanticDiff,
} from "../../../../git-lineage/src/index.ts";
import { asBranchName } from "../../../../game-contracts/src/index.ts";
import type { BranchName } from "../../../../game-contracts/src/index.ts";
import type { SubjectId } from "../../../../platform-contracts/src/index.ts";
import type {
  ChangeKindCount,
  SemanticPullRequestSummary,
} from "../view/projects-snapshot.ts";
import type { PackageRecord } from "../../../../package-system/src/index.ts";
import {
  harborAssets,
  harborWorld,
  sealedRecord,
  twinLayout,
} from "./demo-pins.ts";
import {
  AUTHOR,
  DEMO_PROJECTS_FOREIGN_TENANT,
  DEMO_PROJECTS_TENANT,
  DEMO_PROJECTS_VIEWER,
  FOREIGN_AUTHOR,
} from "./demo-tenants.ts";

// ---------------------------------------------------------------------------
// The REAL community service: the demo pull requests walk its lifecycle
// ---------------------------------------------------------------------------

const clock = createFixedClock(1_000);
const directory = createMemorySubjectDirectory();
const gaps = createMemoryGapDirectory();
const packages = createMemoryPackageRegistry();
const communityStore = createMemoryCommunityStore();

directory.register(DEMO_PROJECTS_TENANT, AUTHOR);
directory.registerMaintainer(DEMO_PROJECTS_TENANT, DEMO_PROJECTS_VIEWER);
directory.register(DEMO_PROJECTS_FOREIGN_TENANT, FOREIGN_AUTHOR);

const service = new CommunityService({
  store: communityStore.store,
  clock: clock.clock,
  directory: directory.directory,
  gaps: gaps.gaps,
  packages: packages.registry,
  policy: { maxOpenContributionsPerContributor: 10 },
});

function mustSubmitPr(tenant: typeof DEMO_PROJECTS_TENANT, title: string): ContributionRecord {
  const command: SubmitContributionCommand = {
    tenant,
    contributor: tenant === DEMO_PROJECTS_TENANT ? AUTHOR : FOREIGN_AUTHOR,
    kind: "pull-request",
    payload: fakePayload({ title, files: 12n }),
    provenance: { origin: { kind: "original" }, aiGenerated: false },
  };
  const result = service.submit(command);
  if (!result.accepted) {
    throw new Error(`demo: pull request refused: ${result.code} — ${result.detail}`);
  }
  clock.advance(10);
  return result.contribution;
}

function mustAdvancePr(
  prId: string,
  kind: TransitionCommandKind,
  actor: SubjectId,
  reason?: string,
): void {
  const parsed = asContributionId(prId);
  if (parsed === undefined) throw new Error(`demo: pull request id not a digest: ${prId}`);
  const result = service.transition({
    tenant: DEMO_PROJECTS_TENANT,
    contributionId: parsed,
    kind,
    actor: ids.subject(String(actor)),
    reason,
  });
  if (!result.accepted) {
    throw new Error(`demo: transition ${kind} refused: ${result.code} — ${result.detail}`);
  }
  clock.advance(10);
}

// --- The three harbor pull requests: submitted, under-review, accepted.
// (The submit results are genesis-time snapshots; the CURRENT records are
// re-read from the service's read doors after the walk below — the
// service owns the state, the fixture never mutates it.)
const prSubmittedId = String(mustSubmitPr(DEMO_PROJECTS_TENANT, "Rework harbor quest rules").contributionId);
const prReviewId = String(mustSubmitPr(DEMO_PROJECTS_TENANT, "Harbor asset pack + world touch-ups").contributionId);
const prAcceptedId = String(mustSubmitPr(DEMO_PROJECTS_TENANT, "Skyline replay diagnostics").contributionId);
mustAdvancePr(prAcceptedId, "triage", DEMO_PROJECTS_VIEWER, "matches the board");
mustAdvancePr(prAcceptedId, "review", DEMO_PROJECTS_VIEWER);
mustAdvancePr(prAcceptedId, "accept", DEMO_PROJECTS_VIEWER, "provenance passes");
mustAdvancePr(prReviewId, "triage", DEMO_PROJECTS_VIEWER, "triaged: asset work");
mustAdvancePr(prReviewId, "review", DEMO_PROJECTS_VIEWER);
// --- The confused-host foreign pull request (R20 guard demo), left `submitted`.
const prForeignId = String(
  mustSubmitPr(DEMO_PROJECTS_FOREIGN_TENANT, "Twin factory layout policy pass").contributionId,
);

/** The CURRENT record of one walked pull request (read door, tenant-scoped). */
function currentRecord(prId: string): ContributionRecord {
  const record = [...service.contributionsOf(DEMO_PROJECTS_TENANT), ...service.contributionsOf(DEMO_PROJECTS_FOREIGN_TENANT)].find(
    (candidate) => String(candidate.contributionId) === prId,
  );
  if (record === undefined) throw new Error(`demo: walked pull request missing: ${prId}`);
  return record;
}

// ---------------------------------------------------------------------------
// REAL git-lineage semantic diffs (validated + classified)
// ---------------------------------------------------------------------------

function semanticPathChange(kind: SemanticChangeKind, path: string): SemanticChange {
  return {
    kind,
    subject: { type: "semantic-path", path },
    payloadDigest: computeDigest({ demo: "projects", kind, path }),
  };
}

/** Builds one VALID semantic diff (throws if git-lineage rejects it). */
function demoDiff(
  base: PackageRecord,
  targetVersion: string,
  changes: readonly SemanticChange[],
): SemanticDiff {
  const target = sealedRecord(base.identity.kind, base.identity.id, targetVersion, {
    license: base.metadata.license,
  });
  const diff: SemanticDiff = { base: base.identity, target: target.identity, changes };
  const violations = validateSemanticDiff(diff);
  if (violations.length > 0) {
    throw new Error(`demo: semantic diff rejected: ${violations[0]!.code} — ${violations[0]!.message}`);
  }
  return diff;
}

/** One pass over a diff's changes: per-kind counts + distinct subjects. */
function classifyChanges(diff: SemanticDiff): {
  readonly counts: readonly ChangeKindCount[];
  readonly subjectCount: number;
} {
  const counts = new Map<SemanticChangeKind, number>();
  const subjects = new Set<string>();
  for (const change of diff.changes) {
    counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
    const subject = change.subject;
    subjects.add(
      subject.type === "package"
        ? `package:${subject.coordinate.contentDigest}`
        : subject.type === "ir-node"
          ? `ir-node:${subject.nodeId}`
          : `semantic-path:${subject.path}`,
    );
  }
  return {
    counts: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
    subjectCount: subjects.size,
  };
}

const diffSubmitted = demoDiff(harborWorld, "1.5.0", [
  semanticPathChange("code", "world.rules.escortFerry"),
  semanticPathChange("code", "world.rules.tideGate"),
  semanticPathChange("world", "world.scenes.harbor"),
  semanticPathChange("asset", "assets.skyboxDawn"),
]);
const diffReview = demoDiff(harborAssets, "1.0.0", [
  semanticPathChange("package", "packages.harborAssets.manifest"),
  semanticPathChange("package", "packages.harborAssets.materials"),
  semanticPathChange("package", "packages.harborAssets.audio"),
  semanticPathChange("world", "world.scenes.docks"),
  semanticPathChange("asset", "assets.craneGltf"),
  semanticPathChange("asset", "assets.ferryGltf"),
]);
const diffAccepted = demoDiff(harborWorld, "1.4.3", [
  semanticPathChange("asset", "assets.skylineFar"),
  semanticPathChange("asset", "assets.skylineNear"),
  semanticPathChange("replay", "world.events.ferryArrival"),
  semanticPathChange("performance", "packages.harborWorld.budget"),
]);
const diffForeign = demoDiff(twinLayout, "1.1.0", [
  semanticPathChange("policy", "world.policies.visitorHours"),
  semanticPathChange("license", "packages.twinLayout.notices"),
]);
// ---------------------------------------------------------------------------
// The pull-request rows (real community records + real classified diffs)
// ---------------------------------------------------------------------------

function prRow(
  record: ContributionRecord,
  title: string,
  base: BranchName,
  head: BranchName,
  diff: SemanticDiff,
): SemanticPullRequestSummary {
  const classified = classifyChanges(diff);
  return {
    prId: record.contributionId,
    title,
    author: record.contributor,
    status: record.status,
    baseRef: base,
    headRef: head,
    changeKindCounts: classified.counts,
    subjectCount: classified.subjectCount,
    semanticDiffId: semanticDiffId(diff),
    updatedByOwnerTenant: record.tenant,
  };
}

const harborPullRequests: readonly SemanticPullRequestSummary[] = [
  prRow(currentRecord(prSubmittedId), "Rework harbor quest rules", asBranchName("main")!, asBranchName("feature/harbor-quests")!, diffSubmitted),
  prRow(currentRecord(prReviewId), "Harbor asset pack + world touch-ups", asBranchName("main")!, asBranchName("feature/harbor-assets")!, diffReview),
  prRow(currentRecord(prAcceptedId), "Skyline replay diagnostics", asBranchName("main")!, asBranchName("feature/skyline-replay")!, diffAccepted),
];
const twinPullRequests: readonly SemanticPullRequestSummary[] = [
  prRow(currentRecord(prForeignId), "Twin factory layout policy pass", asBranchName("main")!, asBranchName("feature/visitor-hours")!, diffForeign),
];

export { harborPullRequests, twinPullRequests };
