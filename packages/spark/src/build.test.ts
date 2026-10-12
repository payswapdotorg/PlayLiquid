/**
 * Build-driver tests (PL-035): driving build-orchestrator stages for a
 * spark build document — the happy path, idempotent replay, duplicate
 * payload, unresolvable (forged) inputs, truthful toolchain failure
 * (E11), R20 tenant isolation and E9 determinism. The orchestrator's
 * in-memory fakes host the ports (clearly labeled test doubles).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInputDigests } from "@playliquid/build-contracts";
import { asToolOperationId } from "@playliquid/build-contracts";
import { BuildOrchestratorService } from "@playliquid/build-orchestrator";
import { createFakeBuildSource, createFakeToolFabric, createManualClock, createMemoryBuildStore } from "@playliquid/build-orchestrator";
import { asTenantId } from "@playliquid/build-orchestrator";
import type { TenantId } from "@playliquid/build-orchestrator";
import { composeSparkBuildDocument } from "./document.ts";
import type { SparkBuildDocument } from "./document.ts";
import { runSparkBuild } from "./build.ts";
import type { SparkBuildResult } from "./build.ts";
import {
  fixtureCostModel,
  fixtureDigest,
  fixtureEngineBinding,
  fixtureLock,
  fixtureRecords,
  fixtureSparkBuildDocument,
  fixtureSparkProfileRecord,
  fixtureToolchain,
} from "./fixtures.ts";

const TENANT = asTenantId("tenant-spark-build")!;
const OTHER_TENANT = asTenantId("tenant-other-build")!;
const OPERATIONS = ["build", "test", "package"] as const;

interface Rig {
  readonly service: BuildOrchestratorService;
  readonly document: SparkBuildDocument;
}

function makeRig(options: { readonly fabricOperations?: readonly string[] } = {}): Rig {
  // The toolchain profile always cites the full default operation set; the
  // fabric option lets a test starve it (the E11 truthfulness story).
  const fabricOperations = options.fabricOperations ?? OPERATIONS;
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const composed = composeSparkBuildDocument(TENANT, {
    document: fixtureSparkBuildDocument(),
    profileRecord: fixtureSparkProfileRecord(),
    engineBinding: fixtureEngineBinding(),
    toolchain: fixtureToolchain(),
    lock,
    costModel: fixtureCostModel(),
  });
  if (!composed.ok) throw new Error(composed.message);
  const service = new BuildOrchestratorService({
    sources: createFakeBuildSource({
      records,
      locks: new Map([[composed.inputs.packageLock.lockFingerprint, lock]]),
      resolvableContent: new Set(buildInputDigests(composed.inputs).map((entry) => entry.digest)),
    }),
    fabric: createFakeToolFabric({ operations: fabricOperations.map((operation) => asToolOperationId(operation)) }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
  return { service, document: composed };
}

function identity(nonce: string) {
  return { requester: "builder-agent", nonce, requestedAt: 1_700_000_000_000 };
}

test("a spark build drives the orchestrator to succeeded with typed digests", async () => {
  const { service, document } = makeRig();
  const outcome = await runSparkBuild(TENANT, service, document, identity("spark-nonce-1"));
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.kind, "spark-build-result");
  assert.equal(outcome.classification, "first");
  assert.equal(outcome.phase, "succeeded");
  assert.equal(outcome.target, "spark");
  assert.match(outcome.buildManifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(outcome.spark, document.spark);
  assert.match(outcome.resultDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(outcome.artifactCount, 2);
  assert.ok(outcome.eventCount >= 10);
  // E10 evidence discipline: the build's event sequences are exactly
  // 1..n, strictly increasing.
  const log = service.events(TENANT, outcome.buildId);
  if (!log.ok) throw new Error(log.message);
  const sequences = log.events.map((event) => event.sequence);
  assert.ok(sequences.every((sequence, index) => sequence === index + 1), JSON.stringify(sequences));
  assert.ok(log.events.some((event) => event.type === "build-succeeded"));
});

test("replaying the same request serves the recorded build (E6)", async () => {
  const { service, document } = makeRig();
  const first = await runSparkBuild(TENANT, service, document, identity("spark-nonce-replay"));
  assert.equal(first.ok, true);
  const replay = await runSparkBuild(TENANT, service, document, identity("spark-nonce-replay"));
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.classification, "duplicate");
  assert.equal(replay.buildId, first.buildId);
  assert.equal(replay.buildManifestDigest, first.buildManifestDigest);
  assert.equal(replay.resultDigest, first.resultDigest);
});

test("the same payload under a fresh nonce is refused duplicate-payload (E8/E9)", async () => {
  const { service, document } = makeRig();
  const first = await runSparkBuild(TENANT, service, document, identity("spark-nonce-dup"));
  assert.equal(first.ok, true);
  const reissue = await runSparkBuild(TENANT, service, document, identity("spark-nonce-dup-2"));
  assert.equal(reissue.ok, false);
  if (!reissue.ok) {
    assert.equal(reissue.code, "intake-refused");
    assert.equal(reissue.source, "duplicate-payload");
  }
});

test("a forged (unresolvable) input digest is refused at intake, naming the input (E8)", async () => {
  const { service, document } = makeRig();
  const forged: SparkBuildDocument = {
    ...document,
    inputs: { ...document.inputs, gameIr: { digest: fixtureDigest("forged-game-ir") } },
  };
  const outcome = await runSparkBuild(TENANT, service, forged, identity("spark-nonce-forged"));
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) {
    assert.equal(outcome.code, "intake-refused");
    assert.equal(outcome.source, "unresolvable-input");
    assert.match(outcome.message, /gameIr/);
  }
});

test("a missing toolchain operation fails the build truthfully (E11)", async () => {
  const { service, document } = makeRig({ fabricOperations: ["build", "package"] });
  const outcome = await runSparkBuild(TENANT, service, document, identity("spark-nonce-toolchain"));
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) {
    assert.equal(outcome.code, "build-failed");
    assert.equal(outcome.source, "toolchain-unavailable");
  }
  const limitation = service.limitations(TENANT).find((entry) => entry.code === "toolchain-unavailable");
  assert.ok(limitation !== undefined, "the E11 limitation must be recorded, never simulated away");
});

test("cross-tenant access is a typed refusal on every door (R20)", async () => {
  const { service, document } = makeRig();
  // Composed for TENANT, run as another tenant: refused before intake.
  const cross = await runSparkBuild(OTHER_TENANT, service, document, identity("spark-nonce-cross"));
  assert.equal(cross.ok, false);
  if (!cross.ok) {
    assert.equal(cross.code, "cross-tenant");
  }
  // The orchestrator's own doors enforce the same isolation.
  const own = await runSparkBuild(TENANT, service, document, identity("spark-nonce-cross-own"));
  assert.equal(own.ok, true);
  const foreignStatus = service.status(OTHER_TENANT, own.buildId);
  assert.equal(foreignStatus.ok, false);
  if (!foreignStatus.ok) {
    assert.equal(foreignStatus.code, "wrong-tenant");
  }
  const foreignDrive = await service.drive(OTHER_TENANT, own.buildId);
  assert.equal(foreignDrive.ok, false);
  if (!foreignDrive.ok) {
    assert.equal(foreignDrive.code, "wrong-tenant");
  }
  // An invalid tenant id is refused too.
  const invalid = await runSparkBuild("Not A Tenant" as never as TenantId, service, document, identity("spark-nonce-invalid"));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.code, "invalid-tenant");
  }
});

test("identical wirings produce identical results (E9)", async () => {
  const firstRig = makeRig();
  const secondRig = makeRig();
  const first = await runSparkBuild(TENANT, firstRig.service, firstRig.document, identity("spark-nonce-twin"));
  const second = await runSparkBuild(TENANT, secondRig.service, secondRig.document, identity("spark-nonce-twin"));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) throw new Error("unreachable");
  const a = first as SparkBuildResult;
  const b = second as SparkBuildResult;
  assert.equal(a.buildId, b.buildId);
  assert.equal(a.buildManifestDigest, b.buildManifestDigest);
  assert.equal(a.resultDigest, b.resultDigest);
  assert.deepEqual(a.spark, b.spark);
  assert.equal(a.eventCount, b.eventCount);
});
