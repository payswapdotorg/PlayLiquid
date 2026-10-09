/**
 * Grant registry tests: admission gates, revocation, expiry sweep and read
 * models — the broker-owned state machine (E1).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_GRANT_REGISTRY,
  admitGrant,
  findGrant,
  grantedCapabilities,
  grantsForActor,
  revokeGrant,
  sweepExpiredGrants,
} from "./registry.ts";
import { asSessionEpoch, asSessionId, asTick } from "@playliquid/runtime-contracts";
import type { CapabilityGrant } from "@playliquid/runtime-contracts";
import { deriveBrokerPolicy } from "./policy.ts";
import { avatarActor, capId, grantId, makeGrant } from "./fakes.ts";
import { demoCoverage, demoGameDocument } from "./demo.ts";

const policy = (() => {
  const result = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!result.ok) throw new Error(result.detail);
  return result.policy;
})();

const sessionId = asSessionId("s-1");

test("registry: admission appends the grant and is pure (input state untouched)", () => {
  const state = EMPTY_GRANT_REGISTRY;
  const result = admitGrant(state, policy, { grant: makeGrant({ scope: { sessionId } }) });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.registry.grants.length, 1);
    assert.equal(state.grants.length, 0, "the input state object is never mutated");
  }
});

test("registry: duplicate grant ids are refused", () => {
  const grant = makeGrant({ scope: { sessionId } });
  const first = admitGrant(EMPTY_GRANT_REGISTRY, policy, { grant });
  assert.equal(first.ok, true);
  const second = admitGrant(first.ok ? first.registry : EMPTY_GRANT_REGISTRY, policy, { grant });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, "duplicate-grant-id");
});

test("registry: malformed grants are refused with invalid-grant", () => {
  const cases: readonly { name: string; grant: CapabilityGrant }[] = [
    { name: "zero epoch", grant: makeGrant({ epoch: asSessionEpoch(0) }) },
    { name: "negative expiry", grant: makeGrant({ expiresAfterTick: asTick(-1) }) },
    { name: "zero max constraint", grant: makeGrant({ constraints: [{ kind: "total-count", max: 0 }] }) },
    {
      name: "zero rate window",
      grant: makeGrant({ constraints: [{ kind: "rate-per-ticks", max: 1, windowTicks: 0 }] }),
    },
  ];
  for (const testCase of cases) {
    const result = admitGrant(EMPTY_GRANT_REGISTRY, policy, { grant: testCase.grant });
    assert.equal(result.ok, false, testCase.name);
    if (!result.ok) assert.equal(result.code, "invalid-grant", testCase.name);
  }
});

test("registry: unknown capabilities are refused (fail closed)", () => {
  const result = admitGrant(EMPTY_GRANT_REGISTRY, policy, {
    grant: makeGrant({ capability: capId("avatar.telepathy"), scope: { sessionId } }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "unknown-capability");
});

test("registry: host-denied capabilities are refused (R5/R20 least privilege)", () => {
  const result = admitGrant(EMPTY_GRANT_REGISTRY, policy, {
    grant: makeGrant({ capability: capId("avatar.sensory-output"), scope: { sessionId } }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "capability-denied");
});

test("registry: approval-required capabilities need the host approval marker", () => {
  const grant = makeGrant({ capability: capId("avatar.manipulation"), scope: { sessionId } });
  const refused = admitGrant(EMPTY_GRANT_REGISTRY, policy, { grant });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "approval-required");
  const approved = admitGrant(EMPTY_GRANT_REGISTRY, policy, { grant, approvedByHost: true });
  assert.equal(approved.ok, true, "explicit host approval admits the grant");
});

test("registry: approval never overrides a denial", () => {
  const result = admitGrant(EMPTY_GRANT_REGISTRY, policy, {
    grant: makeGrant({ capability: capId("avatar.sensory-output"), scope: { sessionId } }),
    approvedByHost: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "capability-denied");
});

test("registry: revocation removes the grant and is idempotent", () => {
  const admitted = admitGrant(EMPTY_GRANT_REGISTRY, policy, { grant: makeGrant({ scope: { sessionId } }) });
  assert.equal(admitted.ok, true);
  const state = admitted.ok ? admitted.registry : EMPTY_GRANT_REGISTRY;
  const first = revokeGrant(state, grantId("grant-1"));
  assert.equal(first.existed, true);
  assert.equal(first.registry.grants.length, 0);
  const second = revokeGrant(first.registry, grantId("grant-1"));
  assert.equal(second.existed, false, "revoking an absent grant reports false");
});

test("registry: sweep removes exactly the grants void at the sweep tick", () => {
  const grantA = makeGrant({ grantId: grantId("g-a"), expiresAfterTick: asTick(10), scope: { sessionId } });
  const grantB = makeGrant({ grantId: grantId("g-b"), expiresAfterTick: asTick(11), scope: { sessionId } });
  const grantC = makeGrant({ grantId: grantId("g-c"), scope: { sessionId } });
  let state = EMPTY_GRANT_REGISTRY;
  for (const grant of [grantA, grantB, grantC]) {
    const step = admitGrant(state, policy, { grant });
    assert.equal(step.ok, true);
    if (step.ok) state = step.registry;
  }
  // Void rule: grant is void at ticks strictly greater than expiresAfterTick.
  const atTen = sweepExpiredGrants(state, asTick(10));
  assert.deepEqual(atTen.swept.map(String), [], "tick 10 keeps both (not strictly beyond)");
  const atEleven = sweepExpiredGrants(state, asTick(11));
  assert.deepEqual(atEleven.swept.map(String), ["g-a"], "tick 11 voids the grant expiring at 10");
  const atTwelve = sweepExpiredGrants(atEleven.registry, asTick(12));
  assert.deepEqual(atTwelve.swept.map(String), ["g-b"], "tick 12 voids the grant expiring at 11");
  assert.equal(atTwelve.registry.grants.length, 1, "unbounded grants survive every sweep");
});

test("registry: findGrant and per-actor read models", () => {
  const holder = avatarActor("avatar-1");
  const other = avatarActor("avatar-2");
  const grants = [
    makeGrant({ grantId: grantId("g-1"), holder, scope: { sessionId } }),
    makeGrant({ grantId: grantId("g-2"), holder, capability: capId("avatar.speech"), scope: { sessionId } }),
    makeGrant({ grantId: grantId("g-3"), holder: other, scope: { sessionId } }),
    makeGrant({ grantId: grantId("g-4"), holder, scope: { sessionId: asSessionId("s-other") } }),
  ];
  let state = EMPTY_GRANT_REGISTRY;
  for (const grant of grants) {
    const step = admitGrant(state, policy, { grant });
    assert.equal(step.ok, true);
    if (step.ok) state = step.registry;
  }
  assert.equal(findGrant(state, grantId("g-2"))?.capability, capId("avatar.speech"));
  assert.equal(findGrant(state, grantId("g-404")), undefined);
  assert.equal(grantsForActor(state, holder, sessionId).length, 2, "session- and actor-scoped");
  assert.deepEqual(
    grantedCapabilities(state, holder, sessionId).map(String).sort(),
    ["avatar.movement", "avatar.speech"],
  );
});
