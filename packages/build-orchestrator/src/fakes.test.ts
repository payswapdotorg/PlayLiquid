/**
 * Test-double behavior tests — the fakes must behave exactly as their port
 * contracts promise (deterministic, observable, never throwing), so every
 * suite built on them stays honest: ManualClock (E3 time seam),
 * MemoryBuildStore (E6 append-only double), FakeBuildSource (closures
 * resolved through package-system's REAL resolve — the authority is never
 * faked) and FakeToolFabric (deterministic digested outputs, failure
 * injection, one-shot scripted outputs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asToolOperationId } from "@playliquid/build-contracts";
import { computeDigest, computeLockFingerprint, resolve } from "@playliquid/package-system";
import type { ContentDigest, PackageLock } from "@playliquid/package-system";
import { BUILD_ORCHESTRATOR_AUTHORITY } from "./events.ts";
import type { BuildEvent, BuildEventType } from "./events.ts";
import {
  createFakeBuildSource,
  createFakeToolFabric,
  createManualClock,
  createMemoryBuildStore,
} from "./fakes.ts";
import type { BuildToolCall } from "./ports.ts";
import { asTenantId } from "./tenancy.ts";
import { fixtureDigest, fixtureLock, fixturePackageRecord, fixtureRecords } from "./fixtures.ts";

function eventOf(sequence: number, type: BuildEventType): BuildEvent {
  return {
    kind: "build-orchestrator-event",
    authority: BUILD_ORCHESTRATOR_AUTHORITY,
    tenant: asTenantId("tenant-a"),
    buildId: "bld-fakes-fixture",
    sequence,
    at: sequence * 1_000,
    type,
    phase: "queued",
  };
}

function toolCall(stage: BuildToolCall["stage"], callId: string): BuildToolCall {
  return { stage, operation: asToolOperationId("build"), callId, idempotencyKey: callId, input: {} };
}

// ---------------------------------------------------------------------------
// ManualClock (E3)
// ---------------------------------------------------------------------------

test("the manual clock starts where told and only moves when advanced (E3)", () => {
  const clock = createManualClock();
  assert.equal(clock.now(), 1_000);
  assert.equal(clock.clock.now(), 1_000);
  assert.equal(clock.advance(250), 1_250);
  assert.equal(clock.now(), 1_250);
  assert.equal(clock.clock.now(), 1_250);
  const custom = createManualClock(5);
  assert.equal(custom.now(), 5);
  assert.equal(custom.advance(0), 5);
});

// ---------------------------------------------------------------------------
// MemoryBuildStore (E6 double: append-only, in order)
// ---------------------------------------------------------------------------

test("the memory store appends in order and hands out copies", () => {
  const store = createMemoryBuildStore();
  store.appendEvents([eventOf(1, "admitted")]);
  store.appendEvents([eventOf(2, "phase-transition"), eventOf(3, "stage-completed")]);
  assert.equal(store.loadEvents().length, 3);
  assert.deepEqual(store.appended.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(store.loadEvents().map((event) => event.type), ["admitted", "phase-transition", "stage-completed"]);
  // Copy semantics: mutating a returned snapshot must never reach the store.
  const loaded = [...store.loadEvents()];
  loaded.pop();
  const appended = [...store.appended];
  appended.pop();
  assert.equal(store.loadEvents().length, 3);
  assert.equal(store.appended.length, 3);
});

// ---------------------------------------------------------------------------
// FakeBuildSource (resolution via package-system's REAL resolve)
// ---------------------------------------------------------------------------

test("the fake build source resolves locks, records and extra content — nothing else", () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const fingerprint = computeLockFingerprint(lock);
  const extra = fixtureDigest("extra-blob");
  const source = createFakeBuildSource({
    records,
    locks: new Map<ContentDigest, PackageLock>([[fingerprint, lock]]),
    resolvableContent: new Set([extra]),
  });
  assert.equal(source.canResolve(fingerprint), true);
  for (const record of records) {
    assert.equal(source.canResolve(record.identity.contentDigest), true);
  }
  assert.equal(source.canResolve(extra), true);
  assert.equal(source.canResolve(fixtureDigest("never-published")), false);
  assert.equal(source.loadLock(fingerprint), lock);
  assert.equal(source.loadLock(fixtureDigest("unknown-fingerprint")), null);
});

test("the fake build source resolves closures through package-system's REAL resolve", () => {
  const present = fixtureRecords();
  const lock = fixtureLock(present);
  const source = createFakeBuildSource({ records: present });
  const closure = source.resolveClosure(lock);
  assert.equal(closure.ok, true);
  if (closure.ok) {
    assert.equal(closure.packages.length, present.length);
    assert.equal(closure.lockFingerprint, computeLockFingerprint(lock));
  }
  const direct = resolve(lock, { records: present });
  assert.equal(direct.ok, true);
  // A pin the record set cannot satisfy is the authority's typed failure.
  const phantom = fixturePackageRecord("fixture-fakes-phantom");
  const orphanLock = fixtureLock([...present, phantom]);
  assert.equal(source.resolveClosure(orphanLock).ok, false);
  assert.equal(resolve(orphanLock, { records: present }).ok, false);
});

// ---------------------------------------------------------------------------
// FakeToolFabric (deterministic outputs, observability, fault injection)
// ---------------------------------------------------------------------------

test("the fake tool fabric reports exactly its registered operations (E11 observation)", () => {
  const fabric = createFakeToolFabric({ operations: [asToolOperationId("build")] });
  assert.deepEqual(fabric.availableOperations(), [asToolOperationId("build")]);
  fabric.registerOperations(asToolOperationId("test"), asToolOperationId("package"));
  assert.deepEqual(fabric.availableOperations(), ["build", "test", "package"].map((operation) => asToolOperationId(operation)));
  fabric.dropOperations(asToolOperationId("build"));
  assert.equal(fabric.availableOperations().includes(asToolOperationId("build")), false);
});

test("emit and package steps emit content-addressed artifacts; verify steps emit passing evidence", async () => {
  const fabric = createFakeToolFabric({ operations: [asToolOperationId("build")] });
  const emit = await fabric.invokeBuildTool(toolCall("emit", "call-emit"));
  assert.equal(emit.outcome, "ok");
  if (emit.outcome === "ok") {
    const output = emit.output as { artifacts: Array<{ digest: ContentDigest }>; evidence: unknown[] };
    assert.equal(output.artifacts.length, 1);
    assert.equal(output.artifacts[0]?.digest, computeDigest({ call: "call-emit", artifact: 0 }));
    assert.equal(output.evidence.length, 0);
  }
  const packaged = await fabric.invokeBuildTool(toolCall("package", "call-package"));
  assert.equal(packaged.outcome, "ok");
  if (packaged.outcome === "ok") {
    const output = packaged.output as { artifacts: unknown[] };
    assert.equal(output.artifacts.length, 1);
  }
  const verify = await fabric.invokeBuildTool(toolCall("verify", "call-verify"));
  assert.equal(verify.outcome, "ok");
  if (verify.outcome === "ok") {
    const output = verify.output as {
      artifacts: unknown[];
      evidence: Array<{ kind: string; verdict: string; suite: { suiteId: string; suiteDigest: ContentDigest }; evidenceDigest: ContentDigest }>;
    };
    assert.equal(output.artifacts.length, 0);
    assert.equal(output.evidence.length, 1);
    assert.equal(output.evidence[0]?.kind, "evaluation-suite");
    assert.equal(output.evidence[0]?.verdict, "pass");
    assert.equal(output.evidence[0]?.suite.suiteDigest, computeDigest({ suite: "call-verify" }));
    assert.equal(output.evidence[0]?.evidenceDigest, computeDigest({ evidence: "call-verify" }));
  }
  const other = await fabric.invokeBuildTool(toolCall("resolve", "call-resolve"));
  assert.equal(other.outcome, "ok");
  if (other.outcome === "ok") {
    const output = other.output as { artifacts: unknown[]; evidence: unknown[] };
    assert.equal(output.artifacts.length, 0);
    assert.equal(output.evidence.length, 0);
  }
});

test("calls are recorded in order; faults persist until cleared; scripted outputs are one-shot", async () => {
  const fabric = createFakeToolFabric({ operations: [asToolOperationId("build")] });
  await fabric.invokeBuildTool(toolCall("emit", "call-1"));
  await fabric.invokeBuildTool(toolCall("emit", "call-2"));
  assert.deepEqual(fabric.calls.map((call) => call.callId), ["call-1", "call-2"]);
  assert.deepEqual(fabric.calls.map((call) => call.idempotencyKey), ["call-1", "call-2"]);
  fabric.failOperation(asToolOperationId("build"), { code: "compiler-crash", message: "scripted fault" });
  const failed = await fabric.invokeBuildTool(toolCall("emit", "call-3"));
  assert.equal(failed.outcome, "failed");
  if (failed.outcome === "failed") {
    assert.equal(failed.code, "compiler-crash");
    assert.equal(failed.message, "scripted fault");
  }
  fabric.clearOperationFailure(asToolOperationId("build"));
  const recovered = await fabric.invokeBuildTool(toolCall("emit", "call-4"));
  assert.equal(recovered.outcome, "ok");
  fabric.scriptNextOutput({ artifacts: [] });
  const scripted = await fabric.invokeBuildTool(toolCall("emit", "call-5"));
  assert.equal(scripted.outcome, "ok");
  if (scripted.outcome === "ok") {
    assert.deepEqual(scripted.output, { artifacts: [] });
  }
  const after = await fabric.invokeBuildTool(toolCall("emit", "call-6"));
  assert.equal(after.outcome, "ok");
  if (after.outcome === "ok") {
    const output = after.output as { artifacts: unknown[] };
    assert.equal(output.artifacts.length, 1); // the one-shot script is spent
  }
  assert.deepEqual(fabric.calls.map((call) => call.callId), ["call-1", "call-2", "call-3", "call-4", "call-5", "call-6"]);
});
