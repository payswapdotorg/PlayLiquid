/**
 * PROPERTY-STYLE FUZZ (PL-023, E8) — untrusted-payload total validation
 * over seeded pseudo-random inputs: the validator must NEVER throw, never
 * silently coerce, and must either produce a frozen normalized payload or
 * a non-empty typed rejection list. The seeded generator (deterministic
 * LCG; no Math.random — E9) mixes well-formed fields with hostile ones:
 * throwing getters, prototypes, wrong types, deep nesting. Plus the
 * deterministic-seam checks: canonical JSON + FIPS sha256 vectors,
 * content-derived command ids, the append-only evidence ledger, family
 * coverage and binding determinism.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateUnityCommandPayload } from "./payload-validate.ts";
import { UNITY_OFFERED_CAPABILITIES, payloadFamilyFor } from "./payload-model.ts";
import { canonicalJson, sha256Hex, contentDigestOf } from "./digest.ts";
import { unityCommandKey } from "./command-id.ts";
import { createUnityEvidenceLedger } from "./evidence.ts";
import { createUnityEngineBinding } from "./engine-binding.ts";

const CAPABILITIES = [...UNITY_OFFERED_CAPABILITIES];

/** Deterministic LCG (seeded; no Math.random — E9). */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const guid = (char: string): string => char.repeat(32);
const digest = (char: string): string => char.repeat(64);

const HOSTILE_VALUES: unknown[] = [
  undefined,
  null,
  "",
  "MyGame",
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  true,
  false,
  [],
  ["MyGame"],
  () => "MyGame",
  Symbol("hostile"),
  10n,
  { toString: "MyGame" },
  Object.create({ projectName: "MyGame" }),
];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

/** A payload object with a THROWING getter mixed into a random field. */
function throwingPayload(): Record<string, unknown> {
  const hostile: Record<string, unknown> = {};
  Object.defineProperty(hostile, "scenePath", {
    get(): string {
      throw new Error("hostile getter");
    },
    enumerable: true,
    configurable: true,
  });
  hostile["version"] = 1;
  return hostile;
}

test("fuzz: total validation never throws over seeded hostile payloads", () => {
  const random = createSeededRandom(0x3333);
  let checked = 0;
  let rejected = 0;
  for (let round = 0; round < 3_000; round += 1) {
    const capability = pick(random, CAPABILITIES);
    const payload: Record<string, unknown> = {};
    // Seed a base valid shape, then corrupt a random subset of fields.
    payload["version"] = pick(random, [1, 1, 1, 2, "1", undefined]);
    payload["projectName"] = pick(random, ["MyGame", "My Game 2", "", "../escape", 5, null]);
    payload["scenePath"] = pick(random, ["Assets/Scenes/Sandbox.unity", "Assets/Scenes/Deep/Nested.unity", "/Scenes/Sandbox.unity", "Assets/Scenes/Sandbox", "", 5, null]);
    payload["objectPath"] = pick(random, ["Player/Main Camera", "Player", "Bad/Slash/", "Leading Space", "", 7]);
    payload["componentType"] = pick(random, ["Rigidbody", "BoxCollider", "bad-type", "", 7]);
    payload["assetGuid"] = pick(random, [guid("a"), "not-a-guid", "ABC-UPPER", "", 42]);
    payload["destinationPath"] = pick(random, ["Assets/Imported/Hero.fbx", "Imported/Hero.fbx", "Assets/Imported/Hero", "", null]);
    payload["format"] = pick(random, ["fbx", "gltf", "unitypackage", "exe", "", null]);
    payload["mode"] = pick(random, ["asset", "scene", "prefab", "half-scene"]);
    payload["action"] = pick(random, ["save-all", "run-script", "play", "build-player", "NOT KEBAB", "", 7]);
    payload["scriptDigest"] = pick(random, [digest("b"), "xyz", 42]);
    payload["scenePaths"] = pick(random, [
      ["Assets/Scenes/Sandbox.unity"],
      ["Assets/Scenes/Sandbox.unity", "Assets/Scenes/Menu.unity"],
      [],
      "not-an-array",
      ["Scenes/Sandbox.unity"],
      null,
    ]);
    payload["targetPlatform"] = pick(random, ["web", "windows", "macos", "linux", "android", "ios", "steamdeck", ""]);
    payload["configuration"] = pick(random, ["release", "development", "shipping", ""]);
    payload["edits"] = pick(random, [
      [{ property: "position", value: [1, 2, 3] }],
      [],
      "not-an-array",
      [{ property: "NOT-KEBAB", value: 1 }],
      [{ property: "active", value: true }],
      null,
    ]);
    payload["artifact"] = pick(random, [
      { kind: "artifact-ref", digest: digest("c"), bytes: 100 },
      { kind: "artifact-ref", digest: "nothex", bytes: -1 },
      "not-an-object",
    ]);
    payload["tenant"] = pick(random, ["tenant-alpha", "tenant-beta", 42, undefined]);
    if (random() < 0.05) {
      // Occasionally replace the whole payload with a hostile scalar/object.
      const hostile = pick(random, HOSTILE_VALUES);
      const check = validateUnityCommandPayload(capability, hostile);
      checked += 1;
      if (check.outcome === "rejected") {
        rejected += 1;
        assert.ok(check.rejections.length > 0, "rejections are never empty when rejected");
      } else {
        assert.ok(Object.isFrozen(check.payload), "normalized payloads are frozen");
      }
      continue;
    }
    if (random() < 0.03) {
      const check = validateUnityCommandPayload(capability, throwingPayload());
      checked += 1;
      assert.equal(check.outcome, "rejected", "throwing getters degrade to typed rejections");
      rejected += 1;
      continue;
    }
    if (random() < 0.02) {
      // Deep nesting under edit values: bounded depth, hostile shapes.
      let deep: unknown = { clientClaimed: false };
      for (let depth = 0; depth < 40; depth += 1) {
        deep = { nested: deep };
      }
      payload["edits"] = [{ property: "position", value: deep }];
    }
    const check = validateUnityCommandPayload(capability, payload);
    checked += 1;
    if (check.outcome === "rejected") {
      rejected += 1;
      assert.ok(check.rejections.length > 0);
      for (const item of check.rejections) {
        assert.ok(typeof item.code === "string" && item.code.startsWith("unity-payload/"), `typed kebab-case code: ${item.code}`);
        assert.ok(typeof item.path === "string", "rejections are path-tagged");
      }
    } else {
      assert.ok(Object.isFrozen(check.payload));
    }
  }
  assert.ok(checked >= 2_900, `exercised enough inputs: ${checked}`);
  assert.ok(rejected > 0, `rejections were produced: ${rejected}`);
});

test("fuzz: the payload validator stays total over non-objects and arrays", () => {
  const random = createSeededRandom(0x77);
  const inputs: unknown[] = [undefined, null, [], [1, 2, 3], "string", 42, true, Symbol("s"), () => {}];
  for (let round = 0; round < 500; round += 1) {
    const capability = pick(random, CAPABILITIES);
    const check = validateUnityCommandPayload(capability, pick(random, inputs));
    assert.equal(check.outcome, "rejected");
    if (check.outcome === "rejected") {
      assert.equal(check.rejections[0]?.code, "unity-payload/not-an-object");
    }
  }
});

test("fuzz: valid payloads validate identically across repeated runs (E9 determinism)", () => {
  // One well-formed payload per declared capability, in declaration order.
  const payloads = [
    { version: 1, projectName: "MyGame" },
    { version: 1, scenePath: "Assets/Scenes/Sandbox.unity" },
    { version: 1, scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera" },
    { version: 1, scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera", componentType: "Rigidbody" },
    { version: 1, assetGuid: guid("a") },
    { version: 1, assetGuid: guid("b") },
    { version: 1, scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera", edits: [{ property: "position", value: [100, 20, 300] }] },
    { version: 1, destinationPath: "Assets/Imported/Hero.fbx", format: "fbx", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 2048 } },
    { version: 1, assetGuid: guid("b"), format: "gltf", mode: "asset" },
    { version: 1, action: "save-all" },
    { version: 1, scriptDigest: digest("b") },
    { version: 1, scenePath: "Assets/Scenes/Sandbox.unity" },
    { version: 1, scenePaths: ["Assets/Scenes/Sandbox.unity", "Assets/Scenes/Menu.unity"], targetPlatform: "android", configuration: "development" },
  ];
  assert.equal(payloads.length, CAPABILITIES.length);
  const first = payloads.map((payload, index) => validateUnityCommandPayload(CAPABILITIES[index] as string, payload));
  for (const check of first) {
    assert.equal(check.outcome, "ok", "every aligned fixture validates");
  }
  for (let round = 0; round < 5; round += 1) {
    const again = payloads.map((payload, index) => validateUnityCommandPayload(CAPABILITIES[index] as string, payload));
    assert.deepEqual(again, first);
  }
});

test("digest: canonical JSON is key-sorted and stable; sha256 matches FIPS vectors", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  assert.equal(canonicalJson({ u: undefined, k: 1 }), '{"k":1}');
  assert.equal(canonicalJson({ f: () => 1 }), '{"f":null}');
  // FIPS 180-4 test vectors.
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  assert.match(contentDigestOf({ a: 1 }), /^[a-f0-9]{64}$/);
});

test("command ids: content-derived, stable, and content-sensitive (E9)", () => {
  const payloadA = { kind: "unity-command-payload" as const, version: 1, subject: "scene" as const, scenePath: "Assets/Scenes/Sandbox.unity" };
  const payloadB = { ...payloadA, scenePath: "Assets/Scenes/OTHER.unity" };
  const key1 = unityCommandKey("scene.inspect", payloadA);
  const key2 = unityCommandKey("scene.inspect", payloadA);
  const key3 = unityCommandKey("scene.inspect", payloadB);
  const key4 = unityCommandKey("scene.inspect", payloadA, 99);
  assert.equal(key1, key2);
  assert.notEqual(key1, key3);
  assert.notEqual(key1, key4);
  assert.match(key1, /^unity-cmd-[a-f0-9]{32}$/);
});

test("evidence: append-only + content-addressed duplicate discipline (E10)", () => {
  const ledger = createUnityEvidenceLedger();
  const entry = {
    kind: "unity-exchange-record" as const,
    commandId: "cmd-1",
    capability: "project.inspect",
    payloadDigest: digest("d"),
    outcome: "ok" as const,
    authorityDigest: digest("e"),
  };
  const first = ledger.append(entry);
  const duplicate = ledger.append(entry);
  assert.equal(duplicate.recordDigest, first.recordDigest);
  assert.equal(ledger.records.length, 1);
  const second = ledger.append({ ...entry, commandId: "cmd-2" });
  assert.notEqual(second.recordDigest, first.recordDigest);
  assert.equal(ledger.records.length, 2);
  assert.equal(second.sequence, 1);
  // Content identity is sequence-free at append time: re-appending the
  // ORIGINAL entry still resolves to the ORIGINAL record (E10).
  const again = ledger.append(entry);
  assert.equal(again.recordDigest, first.recordDigest);
  assert.equal(ledger.records.length, 2);
  assert.match(ledger.ledgerDigest, /^[a-f0-9]{64}$/);
});

test("payloadFamilyFor covers the whole declared surface exactly once", () => {
  const families = new Set<string>();
  for (const capability of CAPABILITIES) {
    const family = payloadFamilyFor(capability);
    assert.ok(family !== null, `${capability} must map to a family`);
    families.add(family);
  }
  assert.equal(families.size, CAPABILITIES.length);
});

test("binding: the typed engine binding is deterministic and content-addressed (E9)", () => {
  assert.deepEqual(createUnityEngineBinding(), createUnityEngineBinding());
  assert.match(createUnityEngineBinding().bindingDigest, /^sha256:[a-f0-9]{64}$/);
});
