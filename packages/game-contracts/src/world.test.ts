import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_KINDS,
  TARGET_PROFILES,
  DEFAULT_WORLD_KIND,
  isWorldKind,
  isTargetProfile,
  isWorldDeclaration,
  resolveWorldKind,
} from "./world.ts";

test("world: the ACR-001 §3 registries are exactly the frozen vocabulary", () => {
  assert.deepEqual(WORLD_KINDS, ["spark", "game", "experience", "digital_twin", "other"]);
  assert.deepEqual(TARGET_PROFILES, [
    "spark_vertical",
    "web",
    "desktop",
    "mobile",
    "xr",
    "dedicated_server",
    "simulation",
  ]);
  assert.ok(Object.isFrozen(WORLD_KINDS));
  assert.ok(Object.isFrozen(TARGET_PROFILES));
});

test("world: kind and profile guards accept the registered values and reject everything else", () => {
  for (const kind of WORLD_KINDS) {
    assert.ok(isWorldKind(kind), kind);
  }
  for (const profile of TARGET_PROFILES) {
    assert.ok(isTargetProfile(profile), profile);
  }
  for (const invalid of [undefined, null, 42, "", "sparkk", "game ", "vertical_spark", "WEB", []]) {
    assert.equal(isWorldKind(invalid), false, `kind ${JSON.stringify(invalid)}`);
    assert.equal(isTargetProfile(invalid), false, `profile ${JSON.stringify(invalid)}`);
  }
});

test("world: the declaration guard accepts every legal combination (kind/profile independence)", () => {
  assert.ok(isWorldDeclaration({}));
  assert.ok(isWorldDeclaration({ kind: "spark" }));
  assert.ok(isWorldDeclaration({ kind: "game" }));
  assert.ok(isWorldDeclaration({ targetProfile: "spark_vertical" }));
  assert.ok(isWorldDeclaration({ kind: "spark", targetProfile: "spark_vertical" }));
  assert.ok(isWorldDeclaration({ kind: "game", targetProfile: "spark_vertical" }));
  assert.ok(isWorldDeclaration({ kind: "digital_twin", targetProfile: "simulation" }));
  assert.equal(isWorldDeclaration({ kind: "game", targetProfile: "xr" }), true);
});

test("world: the declaration guard rejects unknown values, extra keys and non-objects", () => {
  assert.equal(isWorldDeclaration(null), false);
  assert.equal(isWorldDeclaration(undefined), false);
  assert.equal(isWorldDeclaration([42]), false);
  assert.equal(isWorldDeclaration("spark"), false);
  assert.equal(isWorldDeclaration({ kind: "sparkk" }), false);
  assert.equal(isWorldDeclaration({ targetProfile: "9:16" }), false);
  assert.equal(isWorldDeclaration({ kind: 123 }), false);
  assert.equal(isWorldDeclaration({ kind: "spark", mode: "build" }), false);
});

test("world: legacy default resolution — no declaration means the `game` content kind, never a default profile", () => {
  assert.equal(DEFAULT_WORLD_KIND, "game");
  assert.equal(resolveWorldKind(undefined), "game");
  assert.equal(resolveWorldKind({}), "game");
  assert.equal(resolveWorldKind({ targetProfile: "spark_vertical" }), "game");
  assert.equal(resolveWorldKind({ kind: "spark" }), "spark");
  assert.equal(resolveWorldKind({ kind: "spark", targetProfile: "web" }), "spark");
});
