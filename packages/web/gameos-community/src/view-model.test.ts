/**
 * Read-model projection tests (pure): the three Community workbench
 * surfaces over the REAL demo snapshot (the PL-032 community service over
 * its deterministic in-memory ports) — deterministic outputs, provenance
 * visibility (R19 discipline at the seam), the append-only lifecycle
 * ledger (E10), the E8 trust model, R20 tenancy flags and the shared
 * status vocabulary (E1/E9).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_COMMUNITY_FOREIGN_TENANT,
  DEMO_COMMUNITY_GAP,
  demoCommunitySnapshot,
} from "./fixtures/demo.ts";
import { INITIAL_COMMUNITY_SELECTION } from "./view/community-selection.ts";
import {
  communitySummary,
  projectCommunity,
} from "./view/community-view.ts";
import { contributionsSummary } from "./view/contributions-view.ts";
import { workflowSummary } from "./view/workflow-view.ts";
import { provenanceSummary } from "./view/provenance-view.ts";
import {
  aiDisclosureStatus,
  contributionStatusStatus,
  gapLinkStatus,
  originStatus,
  trustStatus,
} from "./view/status.ts";

const snapshot = demoCommunitySnapshot();

test("demo snapshot is assembled from real service state", () => {
  assert.equal(snapshot.contributions.length, 6, "five viewer + one foreign contribution");
  assert.ok(snapshot.transitions.length >= 12, "genesis + workflow transitions recorded");
  const statuses = new Set(snapshot.contributions.map((record) => record.status));
  for (const expected of ["submitted", "triaged", "under-review", "accepted", "withdrawn"]) {
    assert.ok(statuses.has(expected as never), `status ${expected} present in the demo`);
  }
});

test("projectCommunity assembles all three surfaces from one snapshot", () => {
  const view = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  assert.equal(view.selection, INITIAL_COMMUNITY_SELECTION);
  assert.equal(view.contributions.totalContributions, 6);
  assert.equal(view.contributions.rows.length, 6, "no filter applied");
  assert.ok(view.workflow.count >= 12);
  assert.equal(view.provenance.detail, null, "nothing selected");
});

test("projectCommunity is deterministic: same inputs → identical views (E9)", () => {
  const a = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  const b = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  assert.deepEqual(a.contributions.rows, b.contributions.rows);
  assert.deepEqual(a.workflow.rows, b.workflow.rows);
  assert.deepEqual(a.provenance, b.provenance);
  assert.equal(communitySummary(a), communitySummary(b));
});

test("re-loading the same engine state renders the same summaries (E9 snapshot test)", () => {
  const again = demoCommunitySnapshot();
  const a = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  const b = projectCommunity(again, INITIAL_COMMUNITY_SELECTION);
  assert.equal(contributionsSummary(a.contributions), contributionsSummary(b.contributions));
  assert.equal(workflowSummary(a.workflow), workflowSummary(b.workflow));
  assert.equal(provenanceSummary(a.provenance), provenanceSummary(b.provenance));
  assert.equal(communitySummary(a), communitySummary(b));
});

test("the kind filter narrows the rows without touching the data-derived counts", () => {
  const all = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  const filtered = projectCommunity(snapshot, {
    tab: "contributions",
    contributionId: null,
    kindFilter: "code",
  });
  assert.ok(filtered.contributions.rows.every((row) => row.kind === "code"));
  assert.ok(filtered.contributions.rows.length >= 1);
  assert.equal(filtered.contributions.totalContributions, all.contributions.totalContributions);
  assert.equal(filtered.contributions.acceptedCount, all.contributions.acceptedCount);
  assert.ok(filtered.contributions.kindsPresent.length >= 5, "the demo spans many kinds");
});

test("provenance renders on every row (R19 discipline at the seam)", () => {
  const view = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  for (const row of view.contributions.rows) {
    assert.match(row.contributionId, /^sha256:[0-9a-f]{12}$/);
    assert.ok(row.originKind === "original" || row.originKind === "lineage-derived");
    assert.equal(typeof row.aiGenerated, "boolean");
  }
  const lineage = view.contributions.rows.filter((row) => row.originKind === "lineage-derived");
  assert.equal(lineage.length, 2, "one qualified + one unqualified lineage base");
  const ai = view.contributions.rows.filter((row) => row.aiGenerated);
  assert.equal(ai.length, 2, "two AI-disclosed contributions");
  const gapLinked = view.contributions.rows.filter((row) => row.gapId === DEMO_COMMUNITY_GAP);
  assert.equal(gapLinked.length, 2, "two contributions address the R18 gap");
});

test("the E8 trust model renders: accepted ⇒ qualified, everything else untrusted", () => {
  const view = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  const accepted = view.contributions.rows.find((row) => row.status === "accepted");
  assert.ok(accepted !== undefined);
  assert.equal(accepted.trust, "qualified-at-accept");
  assert.equal(trustStatus(accepted.trust).tone, "ok");
  for (const row of view.contributions.rows) {
    if (row.status === "accepted") continue;
    assert.equal(row.trust, "untrusted-until-qualified");
  }
  const untrusted = trustStatus("untrusted-until-qualified");
  assert.equal(untrusted.tone, "warn");
  assert.match(untrusted.label, /^untrusted/);
  // Structurally distinct chips: the two trust classes never render alike.
  assert.notEqual(untrusted.tone, trustStatus("qualified-at-accept").tone);
  assert.notEqual(untrusted.label, trustStatus("qualified-at-accept").label);
});

test("workflow: the append-only ledger is recording-ordered (E10)", () => {
  const view = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  assert.equal(view.workflow.appendOnly, true);
  const times = view.workflow.rows.map((row) => row.recordedAt);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
    "append-faithful order",
  );
  for (const row of view.workflow.rows) {
    assert.match(row.recordId, /^sha256:[0-9a-f]{12}$/);
    assert.ok(row.actor.length > 0, "the authority (actor) renders on every transition");
  }
});

test("workflow: the selected contribution's walked trail renders (normal Git lifecycle)", () => {
  const accepted = snapshot.contributions.find((record) => record.status === "accepted");
  assert.ok(accepted !== undefined);
  const view = projectCommunity(snapshot, {
    tab: "lifecycle",
    contributionId: String(accepted.contributionId),
    kindFilter: null,
  });
  assert.equal(view.workflow.selectedTrail, "submitted > triaged > under-review > accepted");
  const withdrawn = snapshot.contributions.find((record) => record.status === "withdrawn");
  assert.ok(withdrawn !== undefined);
  const view2 = projectCommunity(snapshot, {
    tab: "lifecycle",
    contributionId: String(withdrawn.contributionId),
    kindFilter: null,
  });
  assert.equal(view2.workflow.selectedTrail, "submitted > triaged > under-review > withdrawn");
});

test("provenance detail: the full chain of the selected contribution renders", () => {
  const accepted = snapshot.contributions.find(
    (record) => record.status === "accepted" && record.provenance.origin.kind === "lineage-derived",
  );
  assert.ok(accepted !== undefined);
  const view = projectCommunity(snapshot, {
    tab: "provenance",
    contributionId: String(accepted.contributionId),
    kindFilter: null,
  });
  const detail = view.provenance.detail;
  assert.ok(detail !== null);
  assert.match(detail.contributionId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(detail.originKind, "lineage-derived");
  assert.ok(detail.basePackageId !== null && detail.basePackageId.length > 0);
  assert.ok(detail.baseVersion !== null);
  assert.match(detail.baseContentDigest!, /^sha256:[0-9a-f]{12}$/);
  assert.match(detail.baseNodeId!, /^sha256:[0-9a-f]{12}$/);
  assert.equal(detail.gapId, DEMO_COMMUNITY_GAP);
  assert.ok(detail.cycleId !== null);
  assert.equal(detail.decidedBy, "platform-authority");
  assert.equal(detail.aiGenerated, false);
  assert.equal(detail.modelEntries.length, 0);
  assert.match(provenanceSummary(view.provenance), /lineage-derived from/);
});

test("provenance detail: the AI-disclosed contribution renders its model entries (lock 11)", () => {
  const disclosed = snapshot.contributions.find(
    (record) => record.provenance.aiGenerated && record.status === "submitted",
  );
  assert.ok(disclosed !== undefined);
  const view = projectCommunity(snapshot, {
    tab: "provenance",
    contributionId: String(disclosed.contributionId),
    kindFilter: null,
  });
  const detail = view.provenance.detail;
  assert.ok(detail !== null);
  assert.equal(detail.aiGenerated, true);
  assert.equal(detail.modelEntries.length, 1);
  assert.equal(detail.modelEntries[0]!.model, "glm-4.7");
  assert.equal(detail.modelEntries[0]!.usage, "assistance");
  assert.equal(detail.modelEntries[0]!.disclosed, true);
});

test("tenancy: foreign contributions render as visible foreign-tenant rows (R20)", () => {
  const view = projectCommunity(snapshot, INITIAL_COMMUNITY_SELECTION);
  const foreign = view.contributions.rows.filter((row) => row.tenant === String(DEMO_COMMUNITY_FOREIGN_TENANT));
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0]!.foreignTenant, true);
  assert.equal(view.contributions.foreignCount, 1);
  for (const row of view.contributions.rows) {
    if (row.tenant === String(DEMO_COMMUNITY_FOREIGN_TENANT)) continue;
    assert.equal(row.foreignTenant, false);
  }
});

test("status vocabulary maps the domain states (one owner, E1)", () => {
  assert.equal(contributionStatusStatus("submitted").tone, "info");
  assert.equal(contributionStatusStatus("under-review").tone, "warn");
  assert.equal(contributionStatusStatus("accepted").tone, "ok");
  assert.equal(contributionStatusStatus("rejected").tone, "error");
  assert.equal(contributionStatusStatus("withdrawn").tone, "neutral");
  assert.equal(originStatus("lineage-derived").label, "lineage-derived");
  assert.equal(originStatus("original").label, "original");
  assert.equal(aiDisclosureStatus(true).label, "AI-assisted · disclosed");
  assert.equal(aiDisclosureStatus(false).label, "no AI use declared");
  assert.equal(gapLinkStatus(true).tone, "info");
  assert.equal(gapLinkStatus(false).tone, "neutral");
});
