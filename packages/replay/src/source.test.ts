/**
 * Replay store tests (the ReplaySource fake): write verification, E10
 * immutability enforcement (same identity must mean same bytes), missing
 * artifact lookups, and derivation ledger integration.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import { InMemoryReplayStore } from "./fakes.ts";
import { sealCommandStream } from "./command-stream.ts";
import { sealEventWitness } from "./event-witness.ts";
import type { ReplayRecordBody } from "./record.ts";
import { InMemoryDerivationLedger, sealReplayDerivation } from "./derivation.ts";
import { computeDigest } from "@playliquid/package-system";
import { captureBoundaryScenario, captureOriginScenario, makeSimulationLauncher, moveEnvelope } from "./test-fixtures.ts";
import { createReferenceIntegrityVerifier } from "./verifier.ts";
import { reExecuteReplay } from "./reexecute.ts";

test("store: records round-trip through the source port (R8)", () => {
  const scenario = captureOriginScenario("s-store-roundtrip");
  const loaded = scenario.store.loadReplay(scenario.record.replayId);
  assert.notEqual(loaded, undefined);
  assert.equal(loaded?.replayId, scenario.record.replayId);
  assert.equal(loaded?.commandStream, scenario.record.commandStream);
  const stream = scenario.store.loadCommandStream(scenario.record.commandStream);
  assert.notEqual(stream, undefined);
  assert.equal(stream?.entries.length, scenario.recordedCommands.length);
  const witness = scenario.store.loadEventWitness(scenario.record.eventWitness);
  assert.notEqual(witness, undefined);
  assert.equal(witness?.events.length, scenario.recordedEvents.length);
  assert.equal(scenario.store.replayCount, 1);
});

test("store: missing artifacts resolve to undefined (never guessed)", () => {
  const scenario = captureOriginScenario("s-store-missing");
  assert.equal(scenario.store.loadReplay("replay-ghost"), undefined);
  assert.equal(scenario.store.loadCommandStream("sha256:" + "0".repeat(64)), undefined);
  assert.equal(scenario.store.loadEventWitness("sha256:" + "1".repeat(64)), undefined);
});

test("store: rewriting an immutable record is refused (E10)", () => {
  const scenario = captureBoundaryScenario("s-store-rewrite");
  const original = scenario.record;
  // Same identity, different command stream reference → refused.
  const forgedBody: ReplayRecordBody = {
    sessionId: original.sessionId,
    game: original.game,
    determinism: original.determinism,
    capture: original.capture,
    commandStream: "sha256:" + "9".repeat(64),
    eventWitness: original.eventWitness,
    provenance: original.provenance,
  };
  assert.throws(() => scenario.store.putReplay({ ...original, commandStream: forgedBody.commandStream }));
  // Idempotent re-put of the SAME record stays accepted.
  scenario.store.putReplay(original);
  assert.equal(scenario.store.replayCount, 1);
});

test("store: an identity-forged record is refused (content addressing)", () => {
  const scenario = captureOriginScenario("s-store-forged");
  const original = scenario.record;
  const forged = {
    ...original,
    replayId: "replay-" + "0".repeat(64),
  };
  assert.throws(() => scenario.store.putReplay(forged), /identity mismatch/);
});

test("store: unverifiable artifacts are refused at write time (fail closed)", () => {
  const scenario = captureOriginScenario("s-store-unverifiable");
  const store = new InMemoryReplayStore();
  const honest = sealCommandStream(scenario.recordedCommands);
  assert.throws(() =>
    store.putCommandStream({
      streamDigest: honest.streamDigest,
      form: honest.form,
      entries: [...honest.entries].reverse(),
    }),
  );
  const honestWitness = sealEventWitness(scenario.recordedEvents as readonly RuntimeEventEnvelope<never>[]);
  assert.throws(() =>
    store.putEventWitness({ ...honestWitness, form: '["forged"]' }),
  );
});

test("store: digest collisions between different contents are refused", () => {
  const scenario = captureOriginScenario("s-store-collision");
  const store = new InMemoryReplayStore();
  const first = sealCommandStream(scenario.recordedCommands);
  store.putCommandStream(first);
  const different = sealCommandStream([
    scenario.recordedCommands[0]!,
    { admissionSeq: 2, dueTick: 9, envelope: moveEnvelope(String(scenario.record.sessionId), "zz", [3, 3, 3]) },
  ]);
  // Different content legitimately has a different digest — but we attack
  // by reusing the FIRST digest with the second's bytes.
  assert.throws(() =>
    store.putCommandStream({ ...different, streamDigest: first.streamDigest }),
  );
});

test("store: an end-to-end QA journey through the public surface", () => {
  // Capture → store → re-execute → verify → derive (the R8 story).
  const scenario = captureBoundaryScenario("s-store-journey");
  const { launcher } = makeSimulationLauncher();
  const run = reExecuteReplay({ replayId: scenario.record.replayId, source: scenario.store, launcher });
  assert.equal(run.status, "re-executed");
  const verdict = createReferenceIntegrityVerifier().verify({
    replayId: scenario.record.replayId,
    source: scenario.store,
    launcher,
  });
  assert.equal(verdict.kind, "match");
  if (verdict.kind === "match") assert.equal(verdict.confidence, 1);
  // The QA report is APPENDED as a derivation — the record is untouched.
  const ledger = new InMemoryDerivationLedger((id) => scenario.store.loadReplay(id) !== undefined);
  const report = sealReplayDerivation({
    sourceReplayId: scenario.record.replayId,
    kind: "qa-report",
    artifactDigest: computeDigest({ verdict: verdict.kind }),
    derivedAt: 999 as never,
    derivedBy: "qa-harness",
  });
  assert.equal(ledger.append(report).ok, true);
  assert.equal(ledger.listBySource(scenario.record.replayId).length, 1);
});
