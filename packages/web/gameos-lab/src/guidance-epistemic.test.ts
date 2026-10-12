/**
 * GUIDANCE EPISTEMIC TESTS (E11, lock 28/29): the two guidance epistemic
 * classes are STRUCTURALLY DISJOINT view models — an observed-evidence
 * guidance view has NO estimate fields, a labeled-estimate guidance view
 * carries method + basis + estimate support, and the two classes render
 * through distinct status chips. A stripped or forged marker is a typed
 * refusal, never silently accepted (E8).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { demoLabSnapshot } from "./fixtures/demo.ts";
import {
  guidanceSummary,
  projectGuidance,
  projectGuidanceSet,
} from "./view/guidance-view.ts";
import type {
  EstimateGuidanceView,
  GuidanceSetView,
  ObservedGuidanceView,
} from "./view/guidance-view.ts";
import { estimateMethodStatus, observedEvidenceStatus } from "./view/status.ts";
import type { LabSearchGuidance } from "../../../lab-learning/src/index.ts";

const snapshot = await demoLabSnapshot();
const guidances = snapshot.guidance ?? [];
const set: GuidanceSetView = projectGuidanceSet(guidances);

test("the demo derives BOTH epistemic guidance classes", () => {
  assert.ok(set.observed.length >= 1, "an observed-evidence guidance is derived");
  assert.ok(set.estimates.length >= 1, "a labeled-estimate guidance is derived");
  assert.equal(set.refusals.length, 0);
});

test("observed-evidence guidance views carry NO estimate fields (structural disjointness)", () => {
  const observed = set.observed[0]!;
  const keys = Object.keys(observed) as (keyof ObservedGuidanceView)[];
  assert.equal(observed.epistemic, "observed-evidence");
  assert.ok(!keys.includes("method" as keyof ObservedGuidanceView));
  assert.ok(!keys.includes("basis" as keyof ObservedGuidanceView));
  assert.ok(!("estimateSupport" in observed));
});

test("labeled-estimate guidance views carry method, basis and estimate support", () => {
  const estimate: EstimateGuidanceView = set.estimates[0]!;
  assert.equal(estimate.epistemic, "labeled-estimate");
  assert.equal(estimate.method, "simulation");
  assert.match(estimate.basis, /^[0-9a-f]{64}$/);
  assert.ok(estimate.estimateSupport.length > 0);
  for (const support of estimate.estimateSupport) {
    assert.ok(support.evaluationCount > 0);
    assert.ok(support.estimatedCompletedWork > 0);
  }
});

test("compile-time: an estimate field access on the observed view is a type error", () => {
  const observed = set.observed[0]!;
  assert.equal(observed.epistemic, "observed-evidence");
  // @ts-expect-error — ObservedGuidanceView has no `method` (E11 disjointness is structural).
  const probe: string | undefined = observed.method;
  assert.equal(probe, undefined, "at runtime the field is absent, but the type refuses it");
});

test("the two classes render through distinct status chips (never visually conflated)", () => {
  const observed = observedEvidenceStatus();
  const estimate = estimateMethodStatus("simulation");
  assert.notEqual(observed.label, estimate.label);
  assert.notEqual(observed.tone, estimate.tone);
  assert.equal(observed.tone, "ok");
  assert.equal(estimate.tone, "info");
  assert.match(estimate.label, /^estimate · /);
});

test("a stripped or forged marker is a TYPED refusal, never silently accepted (E8)", () => {
  // Forge from the RAW authoritative guidance values (not the projected
  // views): relabeling an estimate guidance as observed leaves the content
  // digest computed over the REAL marker — the authoritative verifier
  // catches the lie and the projection renders the typed refusal.
  const rawEstimate = guidances.find((value) => value.epistemic === "labeled-estimate");
  const rawObserved = guidances.find((value) => value.epistemic === "observed-evidence");
  assert.ok(rawEstimate !== undefined && rawObserved !== undefined);

  const relabeled: LabSearchGuidance = {
    ...(rawEstimate as object),
    epistemic: "observed-evidence",
  } as unknown as LabSearchGuidance;
  const relabeledView = projectGuidance(relabeled);
  assert.equal(relabeledView.epistemic, "refused");
  assert.equal(relabeledView.code, "guidance-marker-forged");

  const inverse: LabSearchGuidance = {
    ...(rawObserved as object),
    epistemic: "labeled-estimate",
  } as unknown as LabSearchGuidance;
  const inverseView = projectGuidance(inverse);
  assert.equal(inverseView.epistemic, "refused");
  assert.equal(inverseView.code, "guidance-marker-forged");

  const stripped: LabSearchGuidance = {
    ...(rawEstimate as object),
    epistemic: undefined as never,
  } as unknown as LabSearchGuidance;
  const strippedView = projectGuidance(stripped);
  assert.equal(strippedView.epistemic, "refused");
  assert.equal(strippedView.code, "guidance-marker-forged");
  assert.ok(strippedView.detail.length > 0);
});

test("a marker from neither authoritative literal refuses (E8)", () => {
  const rawObserved = guidances.find((value) => value.epistemic === "observed-evidence");
  assert.ok(rawObserved !== undefined);
  const forged: LabSearchGuidance = {
    ...(rawObserved as object),
    epistemic: "ground-truth" as never,
  } as unknown as LabSearchGuidance;
  const view = projectGuidance(forged);
  assert.equal(view.epistemic, "refused");
  assert.equal(view.code, "guidance-marker-forged");
  assert.ok(view.detail.length > 0);
});

test("projection is deterministic and the summary counts all three buckets (E9)", () => {
  const a = projectGuidanceSet(guidances);
  const b = projectGuidanceSet(guidances);
  assert.deepEqual(a, b);
  assert.equal(
    guidanceSummary(a),
    `${a.observed.length} observed-evidence · ${a.estimates.length} labeled-estimate · ${a.refusals.length} refused`,
  );
});
