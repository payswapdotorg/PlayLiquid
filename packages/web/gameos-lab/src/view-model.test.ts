/**
 * Read-model projection tests (pure): the six Lab workbench surfaces over
 * the REAL demo snapshot (the PL-030 learning journey + the PL-031 Arena
 * runtime journey) — deterministic outputs, selection threading, tenancy
 * flags (R20), E10 ledger discipline and the shared status vocabulary
 * (E1/E9).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { demoLabSnapshot, DEMO_LAB_FOREIGN_TENANT } from "./fixtures/demo.ts";
import { INITIAL_LAB_SELECTION } from "./view/lab-selection.ts";
import { labSummary, projectLab } from "./view/lab-view.ts";
import { searchesSummary } from "./view/search-view.ts";
import { evidenceSummary } from "./view/evidence-view.ts";
import { learningSummary } from "./view/learning-view.ts";
import { gapsSummary } from "./view/gaps-view.ts";
import { arenaSummary } from "./view/arena-view.ts";
import {
  arenaLifecycleStatus,
  estimateMethodStatus,
  gapRungStatus,
  gapSummaryStatus,
  observedEvidenceStatus,
  searchProgressStatus,
} from "./view/status.ts";

const snapshot = await demoLabSnapshot();

test("demo snapshot is assembled from real engine state", () => {
  assert.ok(snapshot.searches.length >= 3, "searches: two demo cycles + one foreign");
  assert.ok(snapshot.evidence.length >= 3, "evidence: two cycle-1 runs + one cycle-2 run");
  assert.equal(snapshot.learningRecords.length, 2);
  assert.ok(snapshot.signals !== undefined);
  assert.equal(snapshot.gapSummaries.length, 1);
  assert.equal(snapshot.arenaCases.length, 1);
});

test("projectLab assembles all six surfaces from one snapshot", () => {
  const view = projectLab(snapshot, INITIAL_LAB_SELECTION);
  assert.equal(view.selection, INITIAL_LAB_SELECTION);
  assert.ok(view.searches.rows.length >= 3);
  assert.ok(view.evidence.rows.length >= 3);
  assert.equal(view.learning.recordCount, 2);
  assert.ok(view.guidance.observed.length >= 1);
  assert.ok(view.guidance.estimates.length >= 1);
  assert.equal(view.gaps.rows.length, 1);
  assert.equal(view.arena.totalCases, 1);
});

test("projectLab is deterministic: same inputs → identical views (E9)", () => {
  const a = projectLab(snapshot, INITIAL_LAB_SELECTION);
  const b = projectLab(snapshot, INITIAL_LAB_SELECTION);
  assert.deepEqual(a.searches.rows, b.searches.rows);
  assert.deepEqual(a.evidence.rows, b.evidence.rows);
  assert.deepEqual(a.learning.rows, b.learning.rows);
  assert.deepEqual(a.guidance, b.guidance);
  assert.deepEqual(a.gaps.rows, b.gaps.rows);
  assert.deepEqual(a.arena.rows, b.arena.rows);
  assert.equal(labSummary(a), labSummary(b));
});

test("re-loading the same engine state renders the same summaries (E9 snapshot test)", async () => {
  const again = await demoLabSnapshot();
  const a = projectLab(snapshot, INITIAL_LAB_SELECTION);
  const b = projectLab(again, INITIAL_LAB_SELECTION);
  assert.equal(searchesSummary(a.searches), searchesSummary(b.searches));
  assert.equal(evidenceSummary(a.evidence), evidenceSummary(b.evidence));
  assert.equal(learningSummary(a.learning), learningSummary(b.learning));
  assert.equal(gapsSummary(a.gaps), gapsSummary(b.gaps));
  assert.equal(arenaSummary(a.arena), arenaSummary(b.arena));
});

test("selection threads through untouched (data-derived surfaces do not change)", () => {
  const first = projectLab(snapshot, INITIAL_LAB_SELECTION);
  const selectedSearch = snapshot.searches.find(
    (search) => search.tenant === snapshot.viewer.tenant,
  );
  assert.ok(selectedSearch !== undefined);
  const second = projectLab(snapshot, {
    tab: "searches",
    searchId: selectedSearch.searchId,
    gapCapability: "lab-cap-engineering",
  });
  assert.equal(second.selection.searchId, selectedSearch.searchId);
  assert.equal(second.evidence.rows.length, first.evidence.rows.length);
  assert.equal(second.gaps.rows.length, first.gaps.rows.length);
});

test("searches: seeds render (E9), foreign tenants are flagged (R20), candidates stream", () => {
  const viewerSearch = snapshot.searches.find(
    (search) => search.tenant === snapshot.viewer.tenant,
  );
  assert.ok(viewerSearch !== undefined);
  const foreignSearch = snapshot.searches.find(
    (search) => search.tenant === DEMO_LAB_FOREIGN_TENANT,
  );
  assert.ok(foreignSearch !== undefined);
  const view = projectLab(snapshot, {
    tab: "searches",
    searchId: viewerSearch.searchId,
    gapCapability: null,
  });
  const viewerRow = view.searches.rows.find((row) => row.searchId === viewerSearch.searchId);
  const foreignRow = view.searches.rows.find((row) => row.searchId === foreignSearch.searchId);
  assert.ok(viewerRow !== undefined && foreignRow !== undefined);
  assert.equal(viewerRow.foreignTenant, false);
  assert.equal(foreignRow.foreignTenant, true);
  assert.ok(viewerRow.seed.length > 0, "the reproducibility seed renders");
  assert.match(viewerRow.spaceDigest, /^sha256:[0-9a-f]{12}$/);
  assert.ok(view.searches.candidates.length > 0, "the selected stream renders its candidates");
  assert.ok(
    view.searches.candidates.some((candidate) => candidate.isBaseline),
    "the generalist baseline candidate is visible (lock 26)",
  );
});

test("evidence: append-only ledger of labeled estimates (E10/E11)", () => {
  const view = projectLab(snapshot, INITIAL_LAB_SELECTION);
  assert.equal(view.evidence.appendOnly, true);
  assert.ok(view.evidence.count >= 3);
  for (const row of view.evidence.rows) {
    assert.equal(row.epistemic, "labeled-estimate");
    assert.ok(view.evidence.methodSet.includes(row.method));
    assert.match(row.contentKey, /^sha256:[0-9a-f]{12}$/);
  }
  assert.ok(view.evidence.methodSet.includes("simulation"));
  // Recording order is monotonic in recordedAt (append-faithful, E10).
  const times = view.evidence.rows.map((row) => row.recordedAt);
  const sorted = [...times].sort((a, b) => a - b);
  assert.deepEqual(times, sorted);
});

test("learning: two sealed cycles and the signals state digest (E9)", () => {
  const view = projectLab(snapshot, INITIAL_LAB_SELECTION);
  assert.equal(view.learning.recordCount, 2);
  assert.deepEqual(
    view.learning.rows.map((row) => row.sequence),
    [1, 2],
  );
  assert.ok(view.learning.signals.length > 0);
  assert.ok(view.learning.stateDigest !== null);
  assert.match(view.learning.stateDigest!, /^[0-9a-f]{64}$/);
});

test("gaps: rung-classified recurring summary over the frozen ladder (R18)", () => {
  const view = projectLab(snapshot, INITIAL_LAB_SELECTION);
  assert.equal(view.gaps.rows.length, 1);
  const row = view.gaps.rows[0]!;
  assert.equal(row.missingCapability, "lab-cap-engineering");
  assert.equal(row.recurrenceCount, 2);
  assert.equal(row.recurring, true);
  assert.equal(row.currentRung, "alternate-organization");
  assert.equal(row.blocked, false);
  assert.equal(row.resolved, false);
  assert.deepEqual(view.gaps.ladder, [
    "existing-organization",
    "alternate-organization",
    "package-platform-capability",
    "user-community-contribution",
    "arena-escalation",
    "blocked",
  ]);
});

test("arena: the decided case is ingested with filed evidence (R18/E10/E11)", () => {
  const view = projectLab(snapshot, INITIAL_LAB_SELECTION);
  assert.equal(view.arena.totalCases, 1);
  const row = view.arena.rows[0]!;
  assert.equal(row.tenant, String(snapshot.viewer.tenant));
  assert.equal(row.foreignTenant, false);
  assert.equal(row.lifecycleState, "ingested");
  assert.ok(row.lifecycleTrail.includes("draft"));
  assert.equal(row.evidenceVerdict, "admitted");
  assert.ok(row.decidedBy.length > 0);
});

test("status vocabulary maps the domain states (one owner, E1)", () => {
  assert.equal(gapRungStatus("blocked").tone, "error");
  assert.equal(gapRungStatus("arena-escalation").tone, "warn");
  assert.equal(gapRungStatus("existing-organization").tone, "info");
  assert.equal(arenaLifecycleStatus("ingested").tone, "ok");
  assert.equal(arenaLifecycleStatus("responded").tone, "warn");
  assert.equal(estimateMethodStatus("simulation").label, "estimate · simulation");
  assert.equal(observedEvidenceStatus().label, "observed evidence");
  assert.equal(searchProgressStatus(true).label, "stream complete");
  assert.equal(gapSummaryStatus(true, false, false).label, "recurring");
});
