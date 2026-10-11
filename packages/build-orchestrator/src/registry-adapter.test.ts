/**
 * Registry adapter tests — the production BuildSourcePort wiring over the
 * REAL @playliquid/package-registry facade (openRegistry + the in-memory
 * RegistryStore double): fail-closed resolvability (locks are host
 * content, records are registry content, nothing else is vouched for),
 * lock loading in both source forms, deterministic closure resolution
 * delegated to the registry authority (never re-implemented), and the
 * adapter composed into the full service end-to-end.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asToolOperationId } from "@playliquid/build-contracts";
import { InMemoryRegistryStore, openRegistry } from "@playliquid/package-registry";
import type { PackageRegistry } from "@playliquid/package-registry";
import { computeLockFingerprint, resolve } from "@playliquid/package-system";
import type { ContentDigest, PackageLock, PackageRecord } from "@playliquid/package-system";
import { createRegistryBuildSource } from "./registry-adapter.ts";
import { BuildOrchestratorService } from "./service.ts";
import { createFakeToolFabric, createManualClock, createMemoryBuildStore } from "./fakes.ts";
import { asTenantId } from "./tenancy.ts";
import {
  contentDigestsOf,
  expectedManifestDigest,
  fixtureBuildRequest,
  fixtureDigest,
  fixtureLock,
  fixturePackageRecord,
  fixtureRecords,
  fixtureWebBuildInputs,
  stageDigestsFromEvents,
} from "./fixtures.ts";

const TENANT = asTenantId("tenant-a");
const OPERATIONS = ["build", "test", "package"].map((operation) => asToolOperationId(operation));

/** Opens a real registry over the in-memory store double, pre-seeded with `records`. */
async function registryOf(records: readonly PackageRecord[]): Promise<PackageRegistry> {
  const store = new InMemoryRegistryStore();
  for (const record of records) {
    await store.putRecord(record);
  }
  const opened = await openRegistry({ store });
  if (!opened.ok) {
    throw new Error(`fixture registry failed to open: ${opened.message}`);
  }
  return opened.registry;
}

test("canResolve vouches for lock-table fingerprints, registry records and known content — nothing else (E1 fail-closed)", async () => {
  const records = fixtureRecords();
  const registry = await registryOf(records);
  const lock = fixtureLock(records);
  const fingerprint = computeLockFingerprint(lock);
  const blob = fixtureDigest("game-ir-blob");
  const source = createRegistryBuildSource({
    registry,
    locks: new Map<ContentDigest, PackageLock>([[fingerprint, lock]]),
    knownContent: new Set([blob]),
  });
  assert.equal(source.canResolve(fingerprint), true);
  for (const record of records) {
    assert.equal(source.canResolve(record.identity.contentDigest), true);
  }
  assert.equal(source.canResolve(blob), true);
  assert.equal(source.canResolve(fixtureDigest("nothing-vouches-for-this")), false);
});

test("loadLock answers from table and function lock sources; absent fingerprints are null", async () => {
  const records = fixtureRecords();
  const registry = await registryOf(records);
  const lock = fixtureLock(records);
  const fingerprint = computeLockFingerprint(lock);
  const byTable = createRegistryBuildSource({
    registry,
    locks: new Map<ContentDigest, PackageLock>([[fingerprint, lock]]),
  });
  assert.equal(byTable.loadLock(fingerprint), lock);
  assert.equal(byTable.loadLock(fixtureDigest("unknown-fingerprint")), null);
  const byFunction = createRegistryBuildSource({
    registry,
    locks: (candidate: ContentDigest) => (candidate === fingerprint ? lock : null),
    knownContent: (digest: ContentDigest) => digest === fingerprint,
  });
  assert.equal(byFunction.loadLock(fingerprint), lock);
  assert.equal(byFunction.loadLock(fixtureDigest("unknown-fingerprint")), null);
  assert.equal(byFunction.canResolve(fingerprint), true);
  assert.equal(byFunction.canResolve(fixtureDigest("unknown-fingerprint")), false);
});

test("resolveClosure delegates to the registry's deterministic lock resolution (PL-011 authority, never re-implemented)", async () => {
  const records = fixtureRecords();
  const registry = await registryOf(records);
  const lock = fixtureLock(records);
  const fingerprint = computeLockFingerprint(lock);
  const source = createRegistryBuildSource({
    registry,
    locks: new Map<ContentDigest, PackageLock>([[fingerprint, lock]]),
  });
  const closure = source.resolveClosure(lock);
  assert.equal(closure.ok, true);
  const direct = resolve(lock, { records });
  assert.equal(direct.ok, true);
  if (closure.ok && direct.ok) {
    assert.equal(closure.lockFingerprint, direct.lockFingerprint);
    assert.deepEqual(
      closure.packages.map((entry) => entry.record.identity.id),
      direct.packages.map((entry) => entry.record.identity.id),
    );
  }
  // A pin the registry cannot satisfy is the authority's typed failure, surfaced verbatim.
  const phantom = fixturePackageRecord("fixture-registry-phantom");
  const orphanLock = fixtureLock([...records, phantom]);
  assert.equal(source.resolveClosure(orphanLock).ok, false);
});

test("the adapter composes into the service end-to-end (production wiring)", async () => {
  const records = fixtureRecords();
  const registry = await registryOf(records);
  const lock = fixtureLock(records);
  const fingerprint = computeLockFingerprint(lock);
  const inputs = fixtureWebBuildInputs(lock);
  const service = new BuildOrchestratorService({
    sources: createRegistryBuildSource({
      registry,
      locks: new Map<ContentDigest, PackageLock>([[fingerprint, lock]]),
      knownContent: new Set(contentDigestsOf(inputs)),
    }),
    fabric: createFakeToolFabric({ operations: OPERATIONS }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
  const intake = service.requestBuild(TENANT, fixtureBuildRequest(inputs));
  assert.equal(intake.ok, true);
  if (!intake.ok) {
    return;
  }
  let terminal = false;
  let manifestDigest: string | undefined;
  for (let index = 0; index < 10; index += 1) {
    const step = await service.drive(TENANT, intake.buildId);
    if (!step.ok || step.terminal) {
      terminal = step.ok;
      manifestDigest = step.ok ? step.manifestDigest : undefined;
      break;
    }
  }
  assert.equal(terminal, true);
  const status = service.status(TENANT, intake.buildId);
  assert.equal(status.ok, true);
  if (status.ok) {
    assert.equal(status.phase, "succeeded");
    assert.notEqual(status.outputs, null);
    assert.equal(status.stepCount, 5);
    assert.equal(status.artifactCount, 2); // emit + package bundles
  }
  const log = service.events(TENANT, intake.buildId);
  assert.equal(log.ok, true);
  if (log.ok) {
    assert.equal(manifestDigest, expectedManifestDigest(intake.buildId, inputs, stageDigestsFromEvents(log.events)));
  }
});
