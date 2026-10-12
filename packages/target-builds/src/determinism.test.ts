/**
 * Determinism tests (E9): same request + same pinned inputs ⇒ same plan id,
 * same per-target build digests, same target resolution order — across
 * independent service instances; different content ⇒ different plans.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/build-orchestrator";
import { asBuildNonce } from "@playliquid/build-contracts";
import { createServiceRig, fixtureMultiTargetRequest } from "./fixtures.ts";
import type { TargetOutcome } from "./outcomes.ts";

const tenantA = asTenantId("tenant-alpha");

test("two independent services produce identical plans, build ids and digests for the same request (E9)", async () => {
  const left = createServiceRig();
  const right = createServiceRig();
  const request = fixtureMultiTargetRequest(left.lock, { targets: ["windows", "web", "android"] });
  const first = await left.service.execute(tenantA, request);
  const twin = await right.service.execute(tenantA, request);
  assert.equal(first.ok, true);
  assert.equal(twin.ok, true);
  if (!first.ok || !twin.ok) {
    return;
  }
  // Same plan (content key), same record identity, same verdict, same order.
  assert.equal(twin.record.planId, first.record.planId);
  assert.equal(twin.record.recordId, first.record.recordId);
  assert.equal(twin.record.verdict, first.record.verdict);
  assert.deepEqual(
    twin.record.outcomes.map((outcome) => outcome.target),
    first.record.outcomes.map((outcome) => outcome.target),
  );
  // Same per-target build ids, document digests and manifest digests.
  for (let index = 0; index < twin.record.outcomes.length; index += 1) {
    const outcome: TargetOutcome | undefined = twin.record.outcomes[index];
    const mirror: TargetOutcome | undefined = first.record.outcomes[index];
    if (outcome === undefined || mirror === undefined) {
      continue;
    }
    assert.equal(outcome.buildId, mirror.buildId);
    assert.equal(outcome.documentDigest, mirror.documentDigest);
    if (outcome.outcome !== "failed" && mirror.outcome !== "failed") {
      assert.equal(outcome.manifestDigest, mirror.manifestDigest);
    }
    assert.equal(outcome.engineId, mirror.engineId);
  }
  // Same evidence aggregation digests (R19, content-addressed).
  for (const [index, provenance] of twin.record.provenance.entries()) {
    assert.equal(provenance.provenanceDigest, first.record.provenance[index]?.provenanceDigest);
  }
  for (const [index, verification] of twin.record.verification.entries()) {
    assert.equal(verification.verificationDigest, first.record.verification[index]?.verificationDigest);
  }
  // Identical sealed records (identical clocks ⇒ identical completion stamps).
  assert.equal(twin.record.recordDigest, first.record.recordDigest);
});

test("the target resolution order is content-derived, not submission-ordered (E9)", async () => {
  const rig = createServiceRig();
  const request = fixtureMultiTargetRequest(rig.lock, { targets: ["windows", "android", "web", "android", "web"] });
  const result = await rig.service.execute(tenantA, request);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(
    result.record.outcomes.map((outcome) => outcome.target),
    ["android", "web", "windows"],
  );
});

test("different pinned content produces a different plan and different build truth", async () => {
  const rig = createServiceRig();
  const first = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"] }));
  const second = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, {
      targets: ["web", "windows"],
      nonce: asBuildNonce("mtb-nonce-0002"),
      gameIrDigest: (await import("./fixtures.ts")).fixtureDigest("other-composition"),
    }),
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) {
    return;
  }
  assert.notEqual(second.record.planId, first.record.planId);
  assert.notEqual(
    second.record.outcomes.find((outcome) => outcome.target === "web")?.buildId,
    first.record.outcomes.find((outcome) => outcome.target === "web")?.buildId,
  );
});

test("identical content under a fresh nonce reuses the same durable plan (E6 content key, E9)", async () => {
  const rig = createServiceRig();
  const first = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web"] }));
  const second = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, {
      targets: ["web"],
      nonce: asBuildNonce("mtb-nonce-0002"),
    }),
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) {
    return;
  }
  // Identical content ⇒ the SAME plan (idempotent by content key, E6/E9).
  assert.equal(second.record.planId, first.record.planId);
});
