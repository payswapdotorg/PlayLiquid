import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESTIMATE_METHODS,
  epistemicClassOf,
  isCounterfactual,
  isEstimateMethod,
  isLabeledEstimate,
  isObservedEvidence,
  isSimulatorOutput,
} from "./estimates.ts";
import type {
  Counterfactual,
  EstimateMethod,
  LabeledEstimate,
  ObservedEvidence,
  SimulatorOutput,
} from "./estimates.ts";
import type { ObservedOutcomeRecord } from "./evidence.ts";
import { EMPTY_OBSERVATION_LEDGER } from "./evidence.ts";
import { asObservationId, asReleaseId, asLabCycleId, asTimestampMs } from "./primitives.ts";
import { fixtureDigest } from "./fixtures.ts";

test("estimates: the method vocabulary is frozen and non-trivial", () => {
  assert.ok(Object.isFrozen(ESTIMATE_METHODS));
  assert.ok(ESTIMATE_METHODS.length >= 4);
  for (const method of ESTIMATE_METHODS) {
    assert.ok(isEstimateMethod(method));
  }
  assert.equal(isEstimateMethod("guessing"), false);
  assert.equal(isEstimateMethod(null), false);
});

test("estimates: a labeled estimate requires marker, method and payload", () => {
  const estimate: LabeledEstimate<{ score: number }> = {
    epistemic: "labeled-estimate",
    method: "analytical-model",
    payload: { score: 0.5 },
  };
  assert.ok(isLabeledEstimate(estimate));
  assert.equal(epistemicClassOf(estimate), "estimate");
  assert.equal(isSimulatorOutput(estimate), false);
  // Unlabeled quantitative payloads are NOT estimates.
  assert.equal(isLabeledEstimate({ method: "simulation", payload: { score: 0.5 } }), false);
  assert.equal(epistemicClassOf({ score: 0.5 }), "unlabeled");
});

test("estimates: simulator output is a labeled estimate and names its simulator (lock 29)", () => {
  const output: SimulatorOutput<{ runs: number }> = {
    epistemic: "labeled-estimate",
    method: "simulation",
    simulator: "lab-sim-headless-v2",
    payload: { runs: 100 },
  };
  assert.ok(isSimulatorOutput(output));
  assert.ok(isLabeledEstimate(output));
  assert.equal(epistemicClassOf(output), "estimate");
  assert.equal(isSimulatorOutput({ epistemic: "labeled-estimate", method: "simulation", simulator: "", payload: {} }), false);
  assert.equal(isSimulatorOutput(null), false);
});

test("estimates: a counterfactual must state what it is contrasted against (lock 28)", () => {
  const counterfactual: Counterfactual<{ score: number }> = {
    epistemic: "labeled-estimate",
    method: "counterfactual-replay",
    versus: "observation-1",
    payload: { score: 0.9 },
  };
  assert.ok(isCounterfactual(counterfactual));
  assert.ok(isLabeledEstimate(counterfactual));
  assert.equal(isCounterfactual({ epistemic: "labeled-estimate", method: "counterfactual-replay", versus: "", payload: {} }), false);
});

test("estimates: an observation cannot masquerade as an estimate (E11, compile-time)", () => {
  const observation: ObservedEvidence = { epistemic: "observed-evidence" };
  // @ts-expect-error — observed evidence carries the disjoint marker literal and no method/payload
  const asEstimate: LabeledEstimate = observation;
  // @ts-expect-error — and no simulator output slot exists for it either
  const asSimulator: SimulatorOutput = observation;
  assert.equal(asEstimate.epistemic, "observed-evidence");
  assert.equal(asSimulator.epistemic, "observed-evidence");
});

test("estimates: an estimate cannot masquerade as an observation (E11, compile-time)", () => {
  const estimate: LabeledEstimate = { epistemic: "labeled-estimate", method: "simulation", payload: {} };
  // @ts-expect-error — an estimate lacks the observed-evidence marker literal
  const asObservation: ObservedEvidence = estimate;
  assert.equal(asObservation.epistemic, "labeled-estimate");
});

test("estimates: guards classify the three epistemic classes", () => {
  assert.ok(isObservedEvidence({ epistemic: "observed-evidence" }));
  assert.equal(isObservedEvidence({ epistemic: "labeled-estimate" }), false);
  assert.equal(isObservedEvidence(null), false);
  assert.equal(isObservedEvidence(undefined), false);
  assert.equal(epistemicClassOf({ epistemic: "observed-evidence" }), "observation");
  assert.equal(epistemicClassOf({ epistemic: "labeled-estimate", method: "expert-judgment", payload: null }), "estimate");
  assert.equal(epistemicClassOf({ method: "expert-judgment" }), "unlabeled");
});

test("estimates: an observed-outcome record is never classified as an estimate (E10/E11 joint)", () => {
  const observation: ObservedOutcomeRecord = {
    epistemic: "observed-evidence",
    observationId: asObservationId("observation-1")!,
    cycleId: asLabCycleId("cycle-1")!,
    release: asReleaseId("release-1")!,
    contentDigest: fixtureDigest("observation-1"),
    summary: "Release outcome: stable.",
    observedAt: asTimestampMs(1_000)!,
  };
  assert.ok(isObservedEvidence(observation));
  assert.equal(isLabeledEstimate(observation), false);
  assert.equal(isSimulatorOutput(observation), false);
  assert.equal(isCounterfactual(observation), false);
  assert.equal(epistemicClassOf(observation), "observation");
  // The empty ledger exports stay frozen (E1).
  assert.ok(Object.isFrozen(EMPTY_OBSERVATION_LEDGER));
  assert.ok(Object.isFrozen(EMPTY_OBSERVATION_LEDGER.observations));
});

test("estimates: method typing keeps the frozen vocabulary closed (compile-time)", () => {
  const method: EstimateMethod = "expert-judgment";
  // @ts-expect-error — "guessing" is not in the frozen estimate-method vocabulary
  const invented: EstimateMethod = "guessing";
  assert.equal(isEstimateMethod(method), true);
  assert.equal(typeof invented, "string");
});
