import { test } from "node:test";
import assert from "node:assert/strict";
import { asAvatarId } from "./ids.ts";
import {
  ACTUATOR_CAPABILITY_IDS,
  AVATAR_CAPABILITY_IDS,
  SENSOR_CAPABILITY_IDS,
  assessAvatarCompatibility,
  isAvatarCapabilityId,
  isAvatarManifest,
  isHostRestriction,
} from "./avatar.ts";
import type { AvatarCapabilityId, AvatarManifest, HostRestriction } from "./avatar.ts";

function fixtureManifest(): AvatarManifest {
  return {
    avatar: asAvatarId("avatar-nova")!,
    agent: undefined,
    capabilities: [
      { capability: "vision", requirement: "required" },
      { capability: "speech", requirement: "preferred" },
      { capability: "gaze", requirement: "optional" },
    ],
    portability: "portable",
    dataPolicy: { persistence: "persistent", crossGameMemory: true },
  };
}

test("avatar: capability vocabulary matches the architecture sensors/actuators (R5)", () => {
  assert.deepEqual([...SENSOR_CAPABILITY_IDS], [
    "vision",
    "audio",
    "touch",
    "smell",
    "taste",
    "proprioception",
    "vestibular",
  ]);
  assert.deepEqual([...ACTUATOR_CAPABILITY_IDS], ["movement", "manipulation", "speech", "gaze", "sensory-output"]);
  assert.equal(AVATAR_CAPABILITY_IDS.length, 12);
  assert.ok(isAvatarCapabilityId("vision"));
  assert.equal(isAvatarCapabilityId("flight"), false);
});

test("avatar: manifest and host restriction guards", () => {
  assert.ok(isAvatarManifest(fixtureManifest()));
  assert.equal(isAvatarManifest({ ...fixtureManifest(), avatar: "NOT-A-SLUG" }), false);
  assert.equal(isAvatarManifest({ ...fixtureManifest(), capabilities: [{ capability: "flight", requirement: "required" }] }), false);
  assert.equal(isAvatarManifest({ ...fixtureManifest(), portability: "omnipresent" }), false);
  assert.equal(isHostRestriction({ denied: [], approvalRequired: [], sandboxed: false }), true);
  assert.equal(isHostRestriction({ denied: ["flight"], approvalRequired: [], sandboxed: false }), false);
  assert.equal(isHostRestriction(null), false);
});

test("avatar: required capability denied makes pairing incompatible", () => {
  const restriction: HostRestriction = { denied: ["vision"], approvalRequired: [], sandboxed: false };
  const result = assessAvatarCompatibility(fixtureManifest(), restriction);
  assert.equal(result.compatible, false);
  assert.deepEqual([...result.denied], ["vision"]);
  assert.equal(result.granted.includes("vision"), false);
});

test("avatar: preferred/optional denials degrade but stay compatible", () => {
  const restriction: HostRestriction = { denied: ["gaze", "speech"], approvalRequired: [], sandboxed: true };
  const result = assessAvatarCompatibility(fixtureManifest(), restriction);
  assert.equal(result.compatible, true);
  assert.deepEqual([...result.degraded], ["speech", "gaze"]);
  assert.deepEqual([...result.granted], ["vision"]);
});

test("avatar: approval requirements are surfaced without flipping compatibility", () => {
  const restriction: HostRestriction = { denied: [], approvalRequired: ["speech"], sandboxed: false };
  const result = assessAvatarCompatibility(fixtureManifest(), restriction);
  assert.equal(result.compatible, true);
  assert.deepEqual([...result.approvalRequired], ["speech"]);
  assert.deepEqual([...result.granted], ["vision", "speech", "gaze"]);
  assert.deepEqual([...result.degraded], []);
});

test("avatar: duplicate declarations resolve to the strictest requirement", () => {
  const manifest: AvatarManifest = {
    ...fixtureManifest(),
    capabilities: [
      { capability: "vision", requirement: "optional" },
      { capability: "vision", requirement: "required" },
    ],
  };
  const result = assessAvatarCompatibility(manifest, { denied: ["vision"], approvalRequired: [], sandboxed: false });
  assert.equal(result.compatible, false);
});

test("avatar: unknown capability is a compile-time error", () => {
  // @ts-expect-error — "flight" is not an AvatarCapabilityId
  const capability: AvatarCapabilityId = "flight";
  assert.equal(typeof capability, "string");
});
