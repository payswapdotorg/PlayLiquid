/**
 * R11 integrity verifier tests: match/divergence/inconclusive semantics,
 * confidence-as-coverage, deterministic sampling, and negative paths.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import { createReferenceIntegrityVerifier, deterministicSample } from "./verifier.ts";
import { sealCommandStream } from "./command-stream.ts";
import { sealEventWitness } from "./event-witness.ts";
import { sealReplayRecord } from "./record.ts";
import { InMemoryReplayStore } from "./fakes.ts";
import { captureBoundaryScenario, captureOriginScenario, makeSimulationLauncher, moveEnvelope } from "./test-fixtures.ts";
import type { ScenarioCapture } from "./test-fixtures.ts";
import type { RecordedCommand } from "./command-stream.ts";

const verifier = createReferenceIntegrityVerifier();

function verify(scenario: ScenarioCapture, sampleRate?: number) {
  const { launcher } = makeSimulationLauncher();
  return verifier.verify({
    replayId: scenario.record.replayId,
    source: scenario.store,
    launcher,
    ...(sampleRate === undefined ? {} : { sampleRate }),
  });
}

test("verifier: an honest capture verifies as a full-coverage match", () => {
  const scenario = captureBoundaryScenario("s-verify-match");
  const verdict = verify(scenario);
  assert.equal(verdict.kind, "match");
  if (verdict.kind === "match") {
    assert.equal(verdict.confidence, 1);
    assert.equal(verdict.verifiedCount, scenario.recordedEvents.length);
    assert.equal(verdict.totalEventCount, scenario.recordedEvents.length);
    assert.deepEqual(verdict.sampledEventSeqs, (scenario.recordedEvents as readonly RuntimeEventEnvelope<never>[]).map((_, index) => scenario.boundarySeq + index + 1));
  }
});

test("verifier: an origin capture verifies the same way", () => {
  const scenario = captureOriginScenario("s-verify-origin");
  const verdict = verify(scenario);
  assert.equal(verdict.kind, "match");
  if (verdict.kind === "match") {
    assert.equal(verdict.confidence, 1);
    assert.equal(verdict.totalEventCount, scenario.recordedEvents.length);
  }
});

test("verifier: sampling trades coverage for speed — confidence reports it (R11)", () => {
  const scenario = captureBoundaryScenario("s-verify-sampled");
  const total = scenario.recordedEvents.length;
  const verdict = verify(scenario, 0.5);
  assert.equal(verdict.kind, "match");
  if (verdict.kind === "match") {
    const expectedCount = Math.max(1, Math.ceil(0.5 * total));
    assert.equal(verdict.verifiedCount, expectedCount);
    assert.equal(verdict.confidence, expectedCount / total);
    assert.ok(verdict.confidence < 1);
    assert.ok(verdict.confidence >= 0.5);
    // Sampled positions are unique, sorted, and within the capture range.
    const seqs = verdict.sampledEventSeqs;
    assert.equal(new Set(seqs).size, seqs.length);
    for (const seq of seqs) {
      assert.ok(seq > scenario.boundarySeq);
      assert.ok(seq <= scenario.boundarySeq + total);
    }
  }
});

test("verifier: the same request always samples the same positions (E9)", () => {
  const scenario = captureBoundaryScenario("s-verify-determinism");
  const first = verify(scenario, 0.4);
  const second = verify(scenario, 0.4);
  assert.equal(first.kind, "match");
  assert.equal(second.kind, "match");
  if (first.kind === "match" && second.kind === "match") {
    assert.deepEqual(first.sampledEventSeqs, second.sampledEventSeqs);
  }
});

test("verifier: a mutated command stream is a proven divergence", () => {
  const scenario = captureBoundaryScenario("s-verify-divergence");
  const mutatedCommands: readonly RecordedCommand[] = scenario.recordedCommands.map((entry, index) =>
    index === 0
      ? { ...entry, envelope: moveEnvelope(String(scenario.record.sessionId), "r-3", [7, 7, 7]) }
      : entry,
  );
  // An internally-consistent record whose stream disagrees with its own
  // witness — the exact corruption R11 exists to catch.
  const mutatedStream = sealCommandStream(mutatedCommands);
  const attackRecord = sealReplayRecord({
    sessionId: scenario.record.sessionId,
    game: scenario.record.game,
    determinism: scenario.record.determinism,
    capture: scenario.record.capture,
    commandStream: mutatedStream.streamDigest,
    eventWitness: scenario.record.eventWitness,
    provenance: scenario.record.provenance,
  });
  const store = new InMemoryReplayStore();
  store.putCommandStream(mutatedStream);
  store.putEventWitness(sealEventWitness(scenario.recordedEvents as readonly RuntimeEventEnvelope<never>[]));
  store.putReplay(attackRecord);
  const { launcher } = makeSimulationLauncher();
  const verdict = verifier.verify({ replayId: attackRecord.replayId, source: store, launcher });
  assert.equal(verdict.kind, "divergence");
  if (verdict.kind === "divergence") {
    assert.equal(verdict.confidence, 1);
    assert.ok(verdict.divergences.length > 0);
    const first = verdict.divergences[0]!;
    assert.ok(first.seq > scenario.boundarySeq);
    assert.notEqual(first.recordedForm, first.reexecutedForm);
  }
});

test("verifier: unknown replays are inconclusive, never guessed", () => {
  const scenario = captureBoundaryScenario("s-verify-unknown");
  const { launcher } = makeSimulationLauncher();
  const verdict = verifier.verify({ replayId: "replay-" + "0".repeat(64), source: scenario.store, launcher });
  assert.equal(verdict.kind, "inconclusive");
  if (verdict.kind === "inconclusive") {
    assert.equal(verdict.confidence, 0);
    assert.equal(verdict.reason.code, "unknown-replay");
  }
});

test("verifier: a missing event witness is inconclusive", () => {
  const scenario = captureBoundaryScenario("s-verify-nowitness");
  const store = new InMemoryReplayStore();
  store.putCommandStream(sealCommandStream(scenario.recordedCommands));
  store.putReplay(scenario.record);
  const { launcher } = makeSimulationLauncher();
  const verdict = verifier.verify({ replayId: scenario.record.replayId, source: store, launcher });
  assert.equal(verdict.kind, "inconclusive");
  if (verdict.kind === "inconclusive") {
    assert.equal(verdict.confidence, 0);
    assert.equal(verdict.reason.code, "witness-missing");
  }
});

test("verifier: invalid sample rates are refused as inconclusive", () => {
  const scenario = captureBoundaryScenario("s-verify-rate");
  for (const rate of [0, -0.5, 1.5, Number.NaN]) {
    const verdict = verify(scenario, rate);
    assert.equal(verdict.kind, "inconclusive");
    if (verdict.kind === "inconclusive") assert.equal(verdict.reason.code, "invalid-sample-rate");
  }
});

test("verifier: the deterministic sampler is stable and well-formed", () => {
  const first = deterministicSample("seed-alpha", 100, 10);
  const second = deterministicSample("seed-alpha", 100, 10);
  assert.deepEqual(first, second);
  assert.equal(first.length, 10);
  assert.equal(new Set(first).size, 10);
  for (const position of first) {
    assert.ok(position >= 1 && position <= 100);
  }
  assert.notDeepEqual(deterministicSample("seed-beta", 100, 10), first);
  // Clamped requests.
  assert.deepEqual(deterministicSample("s", 5, 99).length, 5);
  assert.deepEqual(deterministicSample("s", 0, 5), []);
});
