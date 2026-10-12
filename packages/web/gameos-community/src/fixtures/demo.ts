/**
 * DEMO COMMUNITY WORKBENCH FIXTURE (tests + web preview mount): ONE
 * authoritative `CommunityDataSnapshot` assembled from the REAL
 * community service (PL-032) over its own deterministic in-memory port
 * doubles — real submissions through the full intake oracle, real
 * lifecycle transitions through the workflow oracle (maintainer triage /
 * review, the contributor's own withdraw right, the accept-time
 * qualification gate), content-addressed ids and append-only transition
 * history everywhere.
 *
 * TEST-SUPPORT / DEMO FIXTURE ONLY (lock rule 44): nothing here is a
 * production integration. Every contribution object is REAL
 * community-package data: five viewer-tenant contributions spanning
 * statuses (submitted, triaged, under-review, accepted, withdrawn),
 * provenance classes (first-party original, lineage-derived over a
 * qualified base, lineage-derived over an UNQUALIFIED base, honest AI
 * disclosure with model-provenance entries) and one R18 gap-linked
 * contribution; plus one deliberately confused foreign-tenant row so the
 * R20 tenancy guard (the store's typed cross-tenant selection refusal)
 * is visible and testable — the demo HOST assembled a mixed-tenant
 * snapshot on purpose; a production host returns viewer-scoped read
 * models.
 *
 * Synchronous and deterministic (E9): the fixed clock advances by fixed
 * steps, every fake is seeded from stable content — no IO, no wall
 * clock, no randomness.
 */

import {
  CommunityService,
  asContributionId,
} from "../../../../community/src/index.ts";
import type { SubmitContributionCommand } from "../../../../community/src/index.ts";
import {
  createFixedClock,
  createMemoryCommunityStore,
  createMemoryGapDirectory,
  createMemoryPackageRegistry,
  createMemorySubjectDirectory,
  fakeGapLink,
  fakeLineageNode,
  fakePayload,
  ids,
} from "../../../../community/src/index.ts";
import type { TransitionCommandKind } from "../../../../community/src/index.ts";
import { asSubjectId, asTenantId } from "../../../../platform-contracts/src/index.ts";
import type { CommunityDataSnapshot } from "../view/community-view.ts";

/** The demo read model's viewer (tenant scope, R20). */
export const DEMO_COMMUNITY_TENANT = asTenantId("tenant-community-demo")!;
export const DEMO_COMMUNITY_VIEWER = asSubjectId("subject-community-lead")!;
/** The contributor-of-record of the demo contributions. */
export const DEMO_COMMUNITY_CONTRIBUTOR = asSubjectId("subject-contributor-one")!;
/** The confused-host foreign tenant (see module docs). */
export const DEMO_COMMUNITY_FOREIGN_TENANT = asTenantId("tenant-c-demo")!;
export const DEMO_COMMUNITY_FOREIGN_CONTRIBUTOR = asSubjectId("subject-foreign")!;

/** The R18 gap the demo links two contributions to. */
export const DEMO_COMMUNITY_GAP = "gap-community-demo";
export const DEMO_COMMUNITY_CYCLE = "cycle-community-demo";

const clock = createFixedClock(1_000);
const directory = createMemorySubjectDirectory();
const gaps = createMemoryGapDirectory();
const packages = createMemoryPackageRegistry();
const store = createMemoryCommunityStore();

directory.register(DEMO_COMMUNITY_TENANT, DEMO_COMMUNITY_CONTRIBUTOR);
directory.registerMaintainer(DEMO_COMMUNITY_TENANT, DEMO_COMMUNITY_VIEWER);
directory.register(DEMO_COMMUNITY_FOREIGN_TENANT, DEMO_COMMUNITY_FOREIGN_CONTRIBUTOR);
gaps.declare(DEMO_COMMUNITY_GAP, DEMO_COMMUNITY_CYCLE, { communityRungReached: true });

// The lineage base of the accepted contribution: PUBLISHED and
// provenance-passing, so the accept-time qualification gate passes.
const qualifiedBase = fakeLineageNode("qualified-base-pack");
packages.publish(qualifiedBase.coordinate, true);

const service = new CommunityService({
  store: store.store,
  clock: clock.clock,
  directory: directory.directory,
  gaps: gaps.gaps,
  packages: packages.registry,
  policy: { maxOpenContributionsPerContributor: 10 },
});

function mustSubmit(command: SubmitContributionCommand): string {
  const result = service.submit(command);
  if (!result.accepted) {
    throw new Error(`demo: submission refused: ${result.code} — ${result.detail}`);
  }
  clock.advance(10);
  return String(result.contribution.contributionId);
}

function mustAdvance(
  contributionId: string,
  kind: TransitionCommandKind,
  actor: string,
  reason?: string,
): void {
  const parsed = asContributionId(contributionId);
  if (parsed === undefined) throw new Error(`demo: contribution id not a digest: ${contributionId}`);
  const result = service.transition({
    tenant: DEMO_COMMUNITY_TENANT,
    contributionId: parsed,
    kind,
    actor: ids.subject(actor),
    reason,
  });
  if (!result.accepted) {
    throw new Error(`demo: transition ${kind} refused: ${result.code} — ${result.detail}`);
  }
  clock.advance(10);
}

// --- Contribution 1: asset, lineage-derived over a QUALIFIED base, R18 gap
// linked; walked the FULL lifecycle to `accepted` (qualification passed).
const assetId = mustSubmit({
  tenant: DEMO_COMMUNITY_TENANT,
  contributor: DEMO_COMMUNITY_CONTRIBUTOR,
  kind: "asset",
  payload: fakePayload({ title: "demo-skybox-pack", quality: 7n }),
  provenance: { origin: { kind: "lineage-derived", base: qualifiedBase }, aiGenerated: false },
  gap: fakeGapLink(DEMO_COMMUNITY_GAP, DEMO_COMMUNITY_CYCLE),
});
mustAdvance(assetId, "triage", String(DEMO_COMMUNITY_VIEWER), "triaged: matches the gap");
mustAdvance(assetId, "review", String(DEMO_COMMUNITY_VIEWER), "reviewing");
mustAdvance(assetId, "accept", String(DEMO_COMMUNITY_VIEWER), "base qualified; provenance passes");

// --- Contribution 2: replay-backed report, first-party original, honest
// AI disclosure (model provenance entries recorded); gap-linked; left at
// `submitted` (open).
mustSubmit({
  tenant: DEMO_COMMUNITY_TENANT,
  contributor: DEMO_COMMUNITY_CONTRIBUTOR,
  kind: "replay-backed-report",
  payload: fakePayload({ replayOf: "demo-replay-42", verdict: "confirmed" }),
  provenance: {
    origin: { kind: "original" },
    aiGenerated: true,
    modelProvenance: [
      { model: "glm-4.7", provider: "zcode", usage: "assistance", disclosed: true },
    ],
  },
  gap: fakeGapLink(DEMO_COMMUNITY_GAP, DEMO_COMMUNITY_CYCLE),
});

// --- Contribution 3: test, first-party original; walked to `under-review`
// then WITHDRAWN by its own contributor (the withdraw authority path).
const testId = mustSubmit({
  tenant: DEMO_COMMUNITY_TENANT,
  contributor: DEMO_COMMUNITY_CONTRIBUTOR,
  kind: "test",
  payload: fakePayload({ suite: "demo-suite", cases: 12n }),
  provenance: { origin: { kind: "original" }, aiGenerated: false },
});
mustAdvance(testId, "triage", String(DEMO_COMMUNITY_VIEWER));
mustAdvance(testId, "review", String(DEMO_COMMUNITY_VIEWER), "flaky on target");
mustAdvance(testId, "withdraw", String(DEMO_COMMUNITY_CONTRIBUTOR), "superseded by a fresh suite");

// --- Contribution 4: code, lineage-derived over an UNQUALIFIED base —
// the E8 trust model renders: untrusted until qualified (accept would
// refuse); sits at `under-review`.
const codeId = mustSubmit({
  tenant: DEMO_COMMUNITY_TENANT,
  contributor: DEMO_COMMUNITY_CONTRIBUTOR,
  kind: "code",
  payload: fakePayload({ module: "demo-fx-module", loc: 340n }),
  provenance: {
    origin: { kind: "lineage-derived", base: fakeLineageNode("unpublished-base-pack") },
    aiGenerated: false,
  },
});
mustAdvance(codeId, "triage", String(DEMO_COMMUNITY_VIEWER));
mustAdvance(codeId, "review", String(DEMO_COMMUNITY_VIEWER));

// --- Contribution 5: dialogue, first-party original, AI-generated with
// disclosure; walked to `triaged`.
const dialogueId = mustSubmit({
  tenant: DEMO_COMMUNITY_TENANT,
  contributor: DEMO_COMMUNITY_CONTRIBUTOR,
  kind: "dialogue",
  payload: fakePayload({ scene: "demo-harbor", lines: 24n }),
  provenance: {
    origin: { kind: "original" },
    aiGenerated: true,
    modelProvenance: [
      { model: "glm-4.7", provider: "zcode", usage: "generation", disclosed: true },
      { model: "embedding-v3", provider: "zcode", usage: "transformation", disclosed: true },
    ],
  },
});
mustAdvance(dialogueId, "triage", String(DEMO_COMMUNITY_VIEWER));

// --- The confused-host foreign contribution (R20 guard demo) -------------
mustSubmit({
  tenant: DEMO_COMMUNITY_FOREIGN_TENANT,
  contributor: DEMO_COMMUNITY_FOREIGN_CONTRIBUTOR,
  kind: "skill",
  payload: fakePayload({ skill: "demo-foreign-skill", level: 3n }),
  provenance: { origin: { kind: "original" }, aiGenerated: false },
});

/**
 * Assemble the demo Community read-model snapshot from the REAL
 * service's read doors. Deterministic (E9): the journey ran once at
 * module load over fixed fakes; repeated calls return the same state.
 */
export function demoCommunitySnapshot(): CommunityDataSnapshot {
  return {
    viewer: { tenant: DEMO_COMMUNITY_TENANT, subject: DEMO_COMMUNITY_VIEWER },
    contributions: [
      ...service.contributionsOf(DEMO_COMMUNITY_TENANT),
      ...service.contributionsOf(DEMO_COMMUNITY_FOREIGN_TENANT),
    ],
    transitions: [
      ...service.history(DEMO_COMMUNITY_TENANT),
      ...service.history(DEMO_COMMUNITY_FOREIGN_TENANT),
    ],
  } satisfies CommunityDataSnapshot;
}
