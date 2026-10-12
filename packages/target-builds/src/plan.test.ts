/**
 * Fan-out plan tests: the durable content-addressed plan document (E6/E9),
 * the per-target build request commands it derives, and the frozen
 * content-key discipline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBuildRequestFingerprint } from "@playliquid/build-contracts";
import { asTenantId } from "@playliquid/build-orchestrator";
import { createDefaultEngineCatalog } from "./catalog.ts";
import { createMemoryProfileSource } from "./fakes.ts";
import { resolveTargetSet } from "./resolution.ts";
import { buildTargetRequestCommand, computeFanoutPlan, planTargetKey } from "./plan.ts";
import { computeMultiTargetRequestFingerprint } from "./request.ts";
import {
  fixtureMultiTargetRequest,
  fixtureProfileBundle,
  fixtureLock,
  fixtureRecords,
} from "./fixtures.ts";
import type { TargetId } from "@playliquid/target-profiles";

const ALL_TARGETS = ["web", "spark", "windows", "macos", "linux", "android", "ios", "steamdeck", "xr", "dedicated-server", "console"] as TargetId[];
const tenant = asTenantId("tenant-alpha");

function rigFor(targets: readonly string[]) {
  const catalog = createDefaultEngineCatalog();
  const profiles = createMemoryProfileSource(ALL_TARGETS.map((target) => [target, fixtureProfileBundle(target)] as const));
  const lock = fixtureLock(fixtureRecords());
  const request = fixtureMultiTargetRequest(lock, { targets });
  const fingerprint = computeMultiTargetRequestFingerprint(request);
  const resolution = resolveTargetSet(request, catalog, profiles);
  const plan = computeFanoutPlan(tenant, request, fingerprint, resolution);
  return { request, resolution, plan, catalog, fingerprint };
}

test("the plan carries one entry per binding in canonical target order (E9)", () => {
  const { plan } = rigFor(["windows", "android", "web"]);
  assert.deepEqual(
    plan.entries.map((entry) => entry.target),
    ["android", "web", "windows"],
  );
  assert.equal(plan.tenant, tenant);
  assert.equal(plan.kind, "multi-target-fanout-plan");
});

test("each entry's request fingerprint is the per-target command's own fingerprint (deterministic)", () => {
  const { request, plan, resolution } = rigFor(["web", "windows"]);
  for (const entry of plan.entries) {
    const binding = resolution.bindings.find((candidate) => candidate.target === entry.target);
    assert.ok(binding !== undefined);
    const command = buildTargetRequestCommand(request, binding);
    assert.equal(entry.requestFingerprint, computeBuildRequestFingerprint(command));
    assert.equal(entry.engineId, binding.engineId);
    assert.equal(entry.bindingDigest, binding.binding.bindingDigest);
    assert.equal(entry.profileDigest, binding.profile.profileDigest);
  }
});

test("the per-target command carries the per-target nonce and the bound inputs", () => {
  const { request, resolution } = rigFor(["web", "windows"]);
  const binding = resolution.bindings.find((candidate) => candidate.target === "windows");
  assert.ok(binding !== undefined);
  const command = buildTargetRequestCommand(request, binding);
  assert.equal(command.kind, "request-build");
  assert.equal(command.idempotency.scope, "build-request");
  assert.equal(command.idempotency.requester, request.requester);
  assert.equal(command.idempotency.nonce, `${request.nonce}#windows`);
  assert.deepEqual(command.inputs.targetProfile, {
    profileId: binding.profile.profileId,
    profileDigest: binding.profile.profileDigest,
    target: binding.target,
    vendorGate: binding.vendorGate,
  });
  assert.deepEqual(command.inputs.engineBinding, binding.binding);
  assert.deepEqual(command.inputs.toolchain, request.pins.toolchain);
});

test("the planId is a content key: identity and evidence never participate (E6/E9)", () => {
  const base = rigFor(["web", "windows"]);
  const replay = rigFor(["web", "windows"]);
  assert.equal(base.plan.planId, replay.plan.planId);
  assert.deepEqual(base.plan.entries, replay.plan.entries);
  assert.deepEqual(base.plan.refusals, replay.plan.refusals);

  const reordered = rigFor(["windows", "web"]);
  assert.equal(reordered.plan.planId, base.plan.planId);

  const otherTargets = rigFor(["web", "macos"]);
  assert.notEqual(otherTargets.plan.planId, base.plan.planId);
});

test("typed refusals ride the plan unchanged (never hidden, E8)", () => {
  const { plan } = rigFor(["web", "console", "television"]);
  assert.deepEqual(
    plan.refusals.map((refusal) => [refusal.target, refusal.code]),
    [
      ["console", "sdk-gated"],
      ["television", "unknown-target"],
    ],
  );
});

test("planTargetKey scopes the per-target resume key by plan and target", () => {
  const { plan } = rigFor(["web"]);
  assert.equal(planTargetKey(plan.planId, "web"), `${plan.planId}|web`);
  assert.notEqual(planTargetKey(plan.planId, "web"), planTargetKey(plan.planId, "windows"));
});
