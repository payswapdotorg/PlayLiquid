/**
 * Build intake tests (E1) — the admission machinery through the service
 * door: build-contracts' oracle (structural validity, idempotency
 * encounter, resolvability, engine compatibility), the frozen target
 * taxonomy layer (R12) and the duplicate-payload layer, plus E9 build-id
 * determinism.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asBuildNonce, asBuildTargetId, asRequesterId, asToolOperationId } from "@playliquid/build-contracts";
import type { BuildRequestCommand } from "@playliquid/build-contracts";
import { computeLockFingerprint } from "@playliquid/package-system";
import type { ContentDigest, PackageLock } from "@playliquid/package-system";
import { BuildOrchestratorService } from "./service.ts";
import { createFakeBuildSource, createFakeToolFabric, createManualClock, createMemoryBuildStore } from "./fakes.ts";
import { asTenantId } from "./tenancy.ts";
import type { TenantId } from "./tenancy.ts";
import {
  contentDigestsOf,
  fixtureBuildRequest,
  fixtureDigest,
  fixtureLock,
  fixturePackageRecord,
  fixtureRecords,
  fixtureWebBuildInputs,
} from "./fixtures.ts";

const TENANT = asTenantId("tenant-a");
const REQUESTER = asRequesterId("builder-agent");
const OPERATIONS = ["build", "test", "package"].map((operation) => asToolOperationId(operation));

function locksOf(...locks: readonly PackageLock[]): Map<ContentDigest, PackageLock> {
  const map = new Map<ContentDigest, PackageLock>();
  for (const lock of locks) {
    map.set(computeLockFingerprint(lock), lock);
  }
  return map;
}

/** A service whose source resolves every digest of `inputs` and the lock. */
function service(): BuildOrchestratorService {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  return new BuildOrchestratorService({
    sources: createFakeBuildSource({ records, locks: locksOf(lock), resolvableContent: new Set(contentDigestsOf(inputs)) }),
    fabric: createFakeToolFabric({ operations: OPERATIONS }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
}

const nonceOf = (nonce: string) => ({ scope: "build-request" as const, requester: REQUESTER, nonce: asBuildNonce(nonce) });

test("a first well-formed request is admitted as first with a minted build id", () => {
  const orchestrator = service();
  const intake = orchestrator.requestBuild(TENANT, fixtureBuildRequest(fixtureWebBuildInputs(fixtureLock(fixtureRecords()))));
  assert.equal(intake.ok, true);
  if (intake.ok) {
    assert.equal(intake.classification, "first");
    assert.match(intake.buildId, /^bld-[0-9a-f]{24}$/);
  }
});

test("a malformed command is a typed invalid-command refusal", () => {
  const orchestrator = service();
  const refused = orchestrator.requestBuild(TENANT, null as never);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "invalid-command");
  }
});

test("an invalid tenant is refused before any admission work (R20)", () => {
  const orchestrator = service();
  const refused = orchestrator.requestBuild("Not-A-Tenant" as TenantId, fixtureBuildRequest(fixtureWebBuildInputs(fixtureLock(fixtureRecords()))));
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "invalid-tenant");
  }
});

test("replaying the identical command returns the recorded build (duplicate, E6)", () => {
  const orchestrator = service();
  const command = fixtureBuildRequest(fixtureWebBuildInputs(fixtureLock(fixtureRecords())));
  const first = orchestrator.requestBuild(TENANT, command);
  const replay = orchestrator.requestBuild(TENANT, command);
  assert.equal(replay.ok, true);
  if (first.ok && replay.ok) {
    assert.equal(replay.classification, "duplicate");
    assert.equal(replay.buildId, first.buildId);
  }
});

test("the same nonce with a DIFFERENT payload is a collision refusal (E8)", () => {
  const orchestrator = service();
  const lock = fixtureLock(fixtureRecords());
  const first = orchestrator.requestBuild(TENANT, fixtureBuildRequest(fixtureWebBuildInputs(lock)));
  const colliding = orchestrator.requestBuild(
    TENANT,
    fixtureBuildRequest(fixtureWebBuildInputs(lock, { over: { gameIrDigest: fixtureDigest("other-composition") } })),
  );
  assert.equal(first.ok, true);
  assert.equal(colliding.ok, false);
  if (!colliding.ok) {
    assert.equal(colliding.code, "idempotency-collision");
    assert.match(colliding.message, /never silently executed twice/);
  }
});

test("an unresolvable input is named, never guessed (E1)", () => {
  const orchestrator = service();
  const refused = orchestrator.requestBuild(
    TENANT,
    fixtureBuildRequest(
      fixtureWebBuildInputs(fixtureLock(fixtureRecords()), { over: { gameIrDigest: fixtureDigest("never-published") } }),
      { idempotency: nonceOf("nonce-unresolvable") },
    ),
  );
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "unresolvable-input");
    assert.equal(refused.input, "gameIr");
  }
});

test("a target outside the frozen taxonomy is refused unknown-target (R12)", () => {
  const orchestrator = service();
  const base = fixtureWebBuildInputs(fixtureLock(fixtureRecords()));
  const offTaxonomy: BuildRequestCommand = fixtureBuildRequest(
    { ...base, targetProfile: { ...base.targetProfile, target: asBuildTargetId("not-a-target") } },
    { idempotency: nonceOf("nonce-off-taxonomy") },
  );
  const refused = orchestrator.requestBuild(TENANT, offTaxonomy);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "unknown-target");
    assert.match(refused.message, /frozen target taxonomy/);
  }
});

test("an engine binding that does not support the target is refused (compatibility)", () => {
  const orchestrator = service();
  const base = fixtureWebBuildInputs(fixtureLock(fixtureRecords()));
  const incompatible = {
    ...base,
    targetProfile: { ...base.targetProfile, target: asBuildTargetId("console"), profileDigest: fixtureDigest("profile-console") },
  };
  const refused = orchestrator.requestBuild(TENANT, fixtureBuildRequest(incompatible, { idempotency: nonceOf("nonce-incompatible") }));
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "target-engine-incompatible");
  }
});

test("an identical payload already in flight is refused duplicate-payload naming the build", () => {
  const orchestrator = service();
  const lock = fixtureLock(fixtureRecords());
  const command = fixtureBuildRequest(fixtureWebBuildInputs(lock));
  const first = orchestrator.requestBuild(TENANT, command);
  const reissue = orchestrator.requestBuild(TENANT, fixtureBuildRequest(command.inputs, { idempotency: nonceOf("nonce-fresh") }));
  assert.equal(first.ok, true);
  assert.equal(reissue.ok, false);
  if (!reissue.ok && first.ok) {
    assert.equal(reissue.code, "duplicate-payload");
    assert.match(reissue.message, new RegExp(`build ${first.buildId}`));
  }
});

test("build ids are deterministic: same tenant+payload+nonce ⇒ same id (E9)", () => {
  const a = service();
  const b = service();
  const command = fixtureBuildRequest(fixtureWebBuildInputs(fixtureLock(fixtureRecords())));
  const first = a.requestBuild(TENANT, command);
  const twin = b.requestBuild(TENANT, command);
  assert.equal(first.ok, true);
  assert.equal(twin.ok, true);
  if (first.ok && twin.ok) {
    assert.equal(twin.buildId, first.buildId);
  }
});

test("a failed build frees its fingerprint: a clean retry payload is admitted", async () => {
  const records = [...fixtureRecords(), fixturePackageRecordRefusingGate()];
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const orchestrator = new BuildOrchestratorService({
    sources: createFakeBuildSource({ records, locks: locksOf(lock), resolvableContent: new Set(contentDigestsOf(inputs)) }),
    fabric: createFakeToolFabric({ operations: OPERATIONS }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
  const failing = orchestrator.requestBuild(TENANT, fixtureBuildRequest(inputs));
  assert.equal(failing.ok, true);
  if (failing.ok) {
    // Drive to terminal failure (the closure gate refuses the declared license).
    let terminal = false;
    for (let index = 0; index < 10; index += 1) {
      const step = await orchestrator.drive(TENANT, failing.buildId);
      if (!step.ok || step.terminal) {
        terminal = step.ok;
        break;
      }
    }
    assert.equal(terminal, true);
    // The SAME payload with a FRESH nonce is now retryable (not duplicate-payload).
    const retry = orchestrator.requestBuild(TENANT, fixtureBuildRequest(inputs, { idempotency: nonceOf("nonce-retry") }));
    assert.equal(retry.ok, true);
  }
});

/** A fixture record that fails the R19 gate (declared license). */
function fixturePackageRecordRefusingGate() {
  return fixturePackageRecord("fixture-intake-unlicensed", { licenseStatus: "declared" });
}
