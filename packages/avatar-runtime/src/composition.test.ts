/**
 * Definition + composition tests: separately versioned sub-records, the
 * fail-closed validation rules, the R5 restriction projection and the
 * deterministic definition digest (game-ir canonicalization).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeAvatar,
  definitionDigest,
  effectiveCapabilities,
  effectiveSensorChannels,
  servedIntentKinds,
} from "./composition.ts";
import { demoAvatarDefinition, demoAvatarInput } from "./fakes.ts";

test("definition: the demo avatar composes with all five sub-record stamps", () => {
  const definition = demoAvatarDefinition();
  const stamps = [
    definition.body.subRecordVersion,
    definition.sensors.subRecordVersion,
    definition.actuators.subRecordVersion,
    definition.memory.subRecordVersion,
    definition.intelligence.subRecordVersion,
  ];
  assert.deepEqual(
    stamps.map((stamp) => stamp.subRecord),
    ["body", "sensors", "actuators", "memory", "intelligence"],
  );
  assert.deepEqual(stamps.map((stamp) => stamp.version), [3, 2, 4, 1, 5], "each sub-record versions independently");
});

test("definition: skills are package references, never inline (no skill engine)", () => {
  const definition = demoAvatarDefinition();
  for (const skill of definition.intelligence.skills) {
    assert.equal(typeof skill.packageId, "string");
    assert.ok(skill.packageId.length > 0);
    assert.equal(typeof skill.version, "string");
  }
  assert.equal(definition.intelligence.skills.length, 2);
});

test("composition: the definition digest is 64-hex and deterministic", () => {
  const first = demoAvatarDefinition();
  const second = composeAvatar(demoAvatarInput());
  assert.match(String(first.definitionDigest), /^[0-9a-f]{64}$/);
  assert.ok(second.ok);
  if (second.ok) {
    assert.equal(String(second.definition.definitionDigest), String(first.definitionDigest));
  }
  assert.equal(String(definitionDigest(demoAvatarInput())), String(first.definitionDigest));
});

test("composition: bumping one sub-record version changes the digest", () => {
  const input = demoAvatarInput();
  const bumped = { ...input, sensors: { ...input.sensors, subRecordVersion: { ...input.sensors.subRecordVersion, version: 3 } } };
  assert.notEqual(String(definitionDigest(bumped)), String(definitionDigest(input)));
});

test("composition: validation refuses invalid avatar ids", () => {
  const result = composeAvatar({ ...demoAvatarInput(), avatarId: "Not A Slug" as never });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid-avatar-id");
});

test("composition: validation refuses bad sub-record stamps", () => {
  const base = demoAvatarInput();
  const zeroVersion = { ...base, body: { ...base.body, subRecordVersion: { ...base.body.subRecordVersion, version: 0 } } };
  const fractional = { ...base, body: { ...base.body, subRecordVersion: { ...base.body.subRecordVersion, version: 1.5 } } };
  for (const [name, input] of [["zero version", zeroVersion], ["fractional version", fractional]] as const) {
    const result = composeAvatar(input);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.code, "invalid-sub-record-version", name);
  }
});

test("composition: validation refuses non-sha256 revision digests", () => {
  const base = demoAvatarInput();
  const input = { ...base, memory: { ...base.memory, subRecordVersion: { ...base.memory.subRecordVersion, revisionDigest: "zz" as never } } };
  const result = composeAvatar(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid-sub-record-version");
});

test("composition: validation refuses bad package refs (empty ids/versions)", () => {
  const base = demoAvatarInput();
  const input = { ...base, intelligence: { ...base.intelligence, skills: [{ packageId: "", version: "1.0.0" }] } };
  const result = composeAvatar(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid-package-ref");
});

test("composition: validation refuses non-frozen sensor capabilities", () => {
  const base = demoAvatarInput();
  const input = { ...base, sensors: { ...base.sensors, channels: [{ capability: "echolocation" as never, channel: "echo.main" }] } };
  const result = composeAvatar(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid-sensor-capability");
});

test("composition: validation refuses duplicate sensor channels", () => {
  const base = demoAvatarInput();
  const input = {
    ...base,
    sensors: {
      ...base.sensors,
      channels: [
        { capability: "vision", channel: "vision.main" },
        { capability: "audio", channel: "vision.main" },
      ] as never,
    },
  };
  const result = composeAvatar(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "duplicate-sensor-channel");
});

test("composition: validation refuses duplicate actuator capabilities", () => {
  const base = demoAvatarInput();
  const input = {
    ...base,
    actuators: {
      ...base.actuators,
      actuators: [
        { capability: "movement", serves: ["move.to" as never] },
        { capability: "movement", serves: ["move.turn" as never] },
      ] as never,
    },
  };
  const result = composeAvatar(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "duplicate-actuator-capability");
});

test("composition: validation refuses invalid memory classes", () => {
  const base = demoAvatarInput();
  const input = { ...base, memory: { ...base.memory, topology: "galactic" as never } };
  const result = composeAvatar(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid-memory-record");
});

test("restriction: effective capabilities are the R5 projection", () => {
  const definition = demoAvatarDefinition();
  const unrestricted = effectiveCapabilities(definition, { denied: [], approvalRequired: [], sandboxed: false });
  assert.deepEqual(
    unrestricted.granted.map(String).sort(),
    ["audio", "movement", "speech", "vision"],
  );
  assert.deepEqual(unrestricted.denied, []);
  const restricted = effectiveCapabilities(definition, { denied: ["vision", "speech"], approvalRequired: [], sandboxed: true });
  assert.deepEqual(restricted.granted.map(String).sort(), ["audio", "movement"]);
  assert.deepEqual(restricted.denied.map(String).sort(), ["speech", "vision"]);
});

test("restriction: sensor channels and served intents follow the projection", () => {
  const definition = demoAvatarDefinition();
  const restriction = { denied: ["vision", "speech"] as never[], approvalRequired: [] as never[], sandboxed: false };
  assert.deepEqual([...effectiveSensorChannels(definition, restriction)], ["audio.main"]);
  assert.deepEqual([...servedIntentKinds(definition, restriction)], ["move.to"]);
});
