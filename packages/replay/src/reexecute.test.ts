/**
 * Re-execution engine tests: deterministic re-execution equality (origin
 * AND snapshot-boundary captures, byte-for-byte), comparison semantics,
 * and every typed rejection path (negative tests are mandatory).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import { reExecuteReplay, compareEventStreams } from "./reexecute.ts";
import type { ReplayTargetLauncher } from "./reexecute.ts";
import { sealCommandStream } from "./command-stream.ts";
import type { CommandStreamArtifact, RecordedCommand } from "./command-stream.ts";
import { sealEventWitness } from "./event-witness.ts";
import { sealReplayRecord } from "./record.ts";
import { InMemoryReplayStore } from "./fakes.ts";
import { captureBoundaryScenario, captureOriginScenario, makeSimulationLauncher, moveEnvelope } from "./test-fixtures.ts";
import type { ScenarioCapture } from "./test-fixtures.ts";

/**
 * Builds an "attack store": a record with the honest capture shape whose
 * command stream reference points at `stream` (the honest witness stays
 * put). This is the internally-inconsistent capture pair that integrity
 * checks must catch — the record itself is legitimately sealed and
 * content-addressed; only its STREAM disagrees with its witness.
 */
function attackStore(scenario: ScenarioCapture, stream: CommandStreamArtifact): { readonly store: InMemoryReplayStore; readonly record: ReturnType<typeof sealReplayRecord> } {
  const record = sealReplayRecord({
    sessionId: scenario.record.sessionId,
    game: scenario.record.game,
    determinism: scenario.record.determinism,
    capture: scenario.record.capture,
    commandStream: stream.streamDigest,
    eventWitness: scenario.record.eventWitness,
    provenance: scenario.record.provenance,
  });
  const store = new InMemoryReplayStore();
  store.putCommandStream(stream);
  store.putEventWitness(sealEventWitness(scenario.recordedEvents as readonly RuntimeEventEnvelope<never>[]));
  store.putReplay(record);
  return { store, record };
}

function reexecute(scenario: ScenarioCapture, launcher: ReplayTargetLauncher) {
  return reExecuteReplay({ replayId: scenario.record.replayId, source: scenario.store, launcher });
}

test("reexecute: an origin capture re-executes byte-identically (E9)", () => {
  const scenario = captureOriginScenario("s-reexec-origin");
  const { launcher } = makeSimulationLauncher();
  const result = reexecute(scenario, launcher);
  assert.equal(result.status, "re-executed");
  if (result.status !== "re-executed") return;
  assert.equal(result.boundaryEventSeq, 0);
  assert.equal(result.finalTick, 10);
  assert.equal(result.submittedCommands, scenario.recordedCommands.length);
  const comparison = compareEventStreams(scenario.recordedEvents, result.events as readonly RuntimeEventEnvelope<never>[]);
  assert.equal(comparison.equal, true);
  if (comparison.equal) assert.equal(comparison.comparedCount, scenario.recordedEvents.length);
});

test("reexecute: a snapshot-boundary capture re-executes byte-identically (E9)", () => {
  const scenario = captureBoundaryScenario("s-reexec-boundary");
  const { launcher } = makeSimulationLauncher();
  const result = reexecute(scenario, launcher);
  assert.equal(result.status, "re-executed");
  if (result.status !== "re-executed") return;
  assert.equal(result.boundaryEventSeq, scenario.boundarySeq);
  assert.equal(result.finalTick, 10);
  assert.equal(result.submittedCommands, scenario.recordedCommands.length);
  const comparison = compareEventStreams(scenario.recordedEvents, result.events as readonly RuntimeEventEnvelope<never>[]);
  assert.equal(comparison.equal, true);
});

test("reexecute: a mutated command stream diverges the re-executed events", () => {
  const scenario = captureBoundaryScenario("s-reexec-mutated");
  // A stream that is internally honest (valid digest) but carries a
  // mutated payload; the record referencing it diverges from its own
  // (honest) witness on re-execution.
  const mutatedCommands: readonly RecordedCommand[] = scenario.recordedCommands.map((entry, index) =>
    index === 0
      ? { ...entry, envelope: moveEnvelope(String(scenario.record.sessionId), "r-3", [5, 5, 5]) }
      : entry,
  );
  const attack = attackStore(scenario, sealCommandStream(mutatedCommands));
  const { launcher } = makeSimulationLauncher();
  const result = reExecuteReplay({ replayId: attack.record.replayId, source: attack.store, launcher });
  assert.equal(result.status, "re-executed");
  if (result.status !== "re-executed") return;
  const comparison = compareEventStreams(scenario.recordedEvents, result.events as readonly RuntimeEventEnvelope<never>[]);
  assert.equal(comparison.equal, false);
  if (!comparison.equal) {
    assert.ok(comparison.divergences.length > 0);
    assert.ok(comparison.divergences[0] !== undefined);
    assert.ok(comparison.divergences[0]!.seq > scenario.boundarySeq);
  }
});

test("reexecute: unknown replay ids are typed rejections", () => {
  const scenario = captureOriginScenario("s-reexec-unknown");
  const { launcher } = makeSimulationLauncher();
  const result = reExecuteReplay({ replayId: "replay-" + "0".repeat(64), source: scenario.store, launcher });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "unknown-replay");
});

test("reexecute: a missing command stream is a typed rejection", () => {
  const scenario = captureOriginScenario("s-reexec-nostream");
  const empty = new InMemoryReplayStore();
  empty.putEventWitness(sealEventWitness(scenario.recordedEvents as readonly RuntimeEventEnvelope<never>[]));
  empty.putReplay(scenario.record);
  const { launcher } = makeSimulationLauncher();
  const result = reExecuteReplay({ replayId: scenario.record.replayId, source: empty, launcher });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "stream-missing");
});

test("reexecute: an unverifiable command stream is refused (fail closed)", () => {
  const scenario = captureOriginScenario("s-reexec-badstream");
  // Hand-craft an artifact whose form does not match its entries, and
  // serve it through a stub source (the store itself would refuse it).
  const honest = sealCommandStream(scenario.recordedCommands);
  const tampered = {
    streamDigest: honest.streamDigest,
    form: honest.form,
    entries: [...honest.entries].reverse(),
  };
  const stubSource = {
    loadReplay: (id: string) => scenario.store.loadReplay(id),
    loadCommandStream: () => tampered,
    loadEventWitness: (digest: string) => scenario.store.loadEventWitness(digest),
  };
  const { launcher } = makeSimulationLauncher();
  const result = reExecuteReplay({ replayId: scenario.record.replayId, source: stubSource, launcher });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "stream-unverifiable");
});

test("reexecute: stream entries of another session are incoherent", () => {
  const scenario = captureOriginScenario("s-reexec-coherence");
  const alien: readonly RecordedCommand[] = scenario.recordedCommands.map((entry) => ({
    ...entry,
    envelope: moveEnvelope("s-elsewhere", String(entry.envelope.commandId).replace("cmd-", ""), [1, 0, 0]),
  }));
  const attack = attackStore(scenario, sealCommandStream(alien));
  const { launcher } = makeSimulationLauncher();
  const result = reExecuteReplay({ replayId: attack.record.replayId, source: attack.store, launcher });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "incoherent-stream");
});

test("reexecute: a command the target refuses is a typed rejection (E2 gate)", () => {
  const scenario = captureOriginScenario("s-reexec-cmdrej");
  // Replace one envelope's kind with one the demo policy never admits.
  const poisoned: readonly RecordedCommand[] = scenario.recordedCommands.map((entry, index) =>
    index === 0
      ? { ...entry, envelope: { ...entry.envelope, kind: "world.explode" as never } }
      : entry,
  );
  const attack = attackStore(scenario, sealCommandStream(poisoned));
  const { launcher } = makeSimulationLauncher();
  const result = reExecuteReplay({ replayId: attack.record.replayId, source: attack.store, launcher });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "command-rejected");
    assert.ok(result.detail.includes("unknown-command-kind"));
  }
});

test("reexecute: a refusing launcher is a typed rejection", () => {
  const scenario = captureOriginScenario("s-reexec-launchrej");
  const launcher: ReplayTargetLauncher = {
    launchAtOrigin: () => ({ status: "rejected", code: "no-capacity", detail: "cannot start sessions" }),
    launchAtBoundary: () => ({ status: "rejected", code: "no-capacity", detail: "cannot start sessions" }),
  };
  const result = reexecute(scenario, launcher);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "launch-rejected");
    assert.ok(result.detail.includes("no-capacity"));
  }
});

test("reexecute: a misbehaving target's advance failure is a typed rejection", () => {
  const scenario = captureOriginScenario("s-reexec-advrej");
  const { launcher } = makeSimulationLauncher();
  const wrapped: ReplayTargetLauncher = {
    launchAtOrigin: (input) => {
      const launch = launcher.launchAtOrigin(input);
      if (launch.status !== "launched") return launch;
      return {
        status: "launched",
        afterEventSeq: launch.afterEventSeq,
        tick: launch.tick,
        session: {
          sessionId: launch.session.sessionId,
          submitRecordedCommand: (envelope, dueTick) => launch.session.submitRecordedCommand(envelope, dueTick),
          advanceToTick: () => ({ status: "rejected", code: "target-stuck", detail: "advance refused" }),
          readEvents: (after) => launch.session.readEvents(after),
        },
      };
    },
    launchAtBoundary: (input) => launcher.launchAtBoundary(input),
  };
  const result = reexecute(scenario, wrapped);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "advance-rejected");
    assert.ok(result.detail.includes("target-stuck"));
  }
});

test("reexecute: comparison reports length mismatches and divergences", () => {
  const scenario = captureBoundaryScenario("s-reexec-compare");
  const events = scenario.recordedEvents as readonly RuntimeEventEnvelope<never>[];
  const shorter = events.slice(0, events.length - 2);
  const shortened = compareEventStreams(events, shorter);
  assert.equal(shortened.equal, false);
  if (!shortened.equal) assert.equal(shortened.lengthMismatch, true);
  const reordered = [...events.slice(0, 2).reverse(), ...events.slice(2)];
  const swapped = compareEventStreams(events, reordered);
  assert.equal(swapped.equal, false);
  if (!swapped.equal) {
    assert.equal(swapped.lengthMismatch, false);
    assert.ok(swapped.divergences.length > 0);
  }
  const identical = compareEventStreams(events, [...events]);
  assert.equal(identical.equal, true);
});
