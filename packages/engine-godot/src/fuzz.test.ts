/**
 * PROPERTY-STYLE FUZZ (PL-024, E8) — untrusted-payload total validation
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
import { validateGodotCommandPayload } from "./payload-validate.ts";
import { GODOT_OFFERED_CAPABILITIES, payloadFamilyFor } from "./payload-model.ts";
import { canonicalJson, sha256Hex, contentDigestOf } from "./digest.ts";
import { godotCommandKey } from "./command-id.ts";
import { createGodotEvidenceLedger } from "./evidence.ts";
import { createGodotEngineBinding } from "./engine-binding.ts";

const CAPABILITIES = [...GODOT_OFFERED_CAPABILITIES];

/** Deterministic LCG (seeded; no Math.random — E9). */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

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
  Object.create({ target: "MyGame" }),
];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

/** A payload object with a THROWING getter mixed into a random field. */
function throwingPayload(): Record<string, unknown> {
  const hostile: Record<string, unknown> = {};
  Object.defineProperty(hostile, "target", {
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
  const random = createSeededRandom(0x2222);
  let checked = 0;
  let rejected = 0;
  for (let round = 0; round < 3_000; round += 1) {
    const capability = pick(random, CAPABILITIES);
    const payload: Record<string, unknown> = {};
    // Seed a base valid shape, then corrupt a random subset of fields.
    payload["version"] = pick(random, [1, 1, 1, 2, "1", undefined]);
    payload["target"] = pick(random, ["MyGame", "res://scenes/main.tscn", "res://assets/hero.png", "", 5, null, "../escape", "res://scenes/", "res://../x"]);
    payload["subject"] = pick(random, ["project", "scene", "node", "asset", "resource", "editor", "build", "level"]);
    payload["nodePath"] = pick(random, ["Player/Body/Sprite2D", "/root/Main", "../Player", "9bad/Path", "", 7]);
    payload["format"] = pick(random, ["png", "gltf", "glb", "fbx", "exe", "", null]);
    payload["mode"] = pick(random, ["scene", "resource", "half-scene"]);
    payload["action"] = pick(random, ["save-all", "run-script", "run", "export", "NOT KEBAB", "", 7]);
    payload["scriptDigest"] = pick(random, [digest("a"), "xyz", 42]);
    payload["headless"] = pick(random, [true, false, "yes", 1, null]);
    payload["preset"] = pick(random, ["Web (HTML5)", "Linux/X11", "Windows Desktop", " bad", "", 9]);
    payload["targetPlatform"] = pick(random, ["web", "windows", "macos", "linux", "android", ""]);
    payload["configuration"] = pick(random, ["debug", "release", "shipping", ""]);
    payload["edits"] = pick(random, [
      [{ property: "position", value: [100, 20] }],
      [],
      "not-an-array",
      [{ property: "NOT-SNAKE", value: 1 }],
      [{ property: "modulate", value: "#ff0000" }],
      null,
    ]);
    payload["artifact"] = pick(random, [
      { kind: "artifact-ref", digest: digest("b"), bytes: 100 },
      { kind: "artifact-ref", digest: "nothex", bytes: -1 },
      "not-an-object",
    ]);
    payload["tenant"] = pick(random, ["tenant-alpha", "tenant-beta", 42, undefined]);
    if (random() < 0.05) {
      // Occasionally replace the whole payload with a hostile scalar/object.
      const hostile = pick(random, HOSTILE_VALUES);
      const check = validateGodotCommandPayload(capability, hostile);
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
      const check = validateGodotCommandPayload(capability, throwingPayload());
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
      payload["edits"] = [{ property: "custom", value: deep }];
    }
    const check = validateGodotCommandPayload(capability, payload);
    checked += 1;
    if (check.outcome === "rejected") {
      rejected += 1;
      assert.ok(check.rejections.length > 0);
      for (const item of check.rejections) {
        assert.ok(typeof item.code === "string" && item.code.startsWith("godot-payload/"), `typed kebab-case code: ${item.code}`);
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
  const random = createSeededRandom(0x99);
  const inputs: unknown[] = [undefined, null, [], [1, 2, 3], "string", 42, true, Symbol("s"), () => {}];
  for (let round = 0; round < 500; round += 1) {
    const capability = pick(random, CAPABILITIES);
    const check = validateGodotCommandPayload(capability, pick(random, inputs));
    assert.equal(check.outcome, "rejected");
    if (check.outcome === "rejected") {
      assert.equal(check.rejections[0]?.code, "godot-payload/not-an-object");
    }
  }
});

test("fuzz: valid payloads validate identically across repeated runs (E9 determinism)", () => {
  const payloads = [
    { version: 1, target: "MyGame" },
    { version: 1, target: "res://scenes/main.tscn" },
    { version: 1, target: "res://scenes/main.tscn", nodePath: "Player/Body/Sprite2D" },
    { version: 1, target: "res://resources/materials/hero_suit.tres" },
    { version: 1, target: "res://assets/textures/hero.png", format: "png", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 2048 } },
    { version: 1, target: "res://scenes/main.tscn", format: "gltf", mode: "scene" },
    { version: 1, action: "save-all" },
    { version: 1, scriptDigest: digest("b") },
    { version: 1, target: "res://scenes/main.tscn", headless: true },
    { version: 1, target: "MyGame", preset: "Web (HTML5)", targetPlatform: "web", configuration: "release" },
    { version: 1, target: "MyGame", preset: "Linux/X11", targetPlatform: "linux", configuration: "debug" },
    { version: 1, target: "res://scenes/main.tscn", nodePath: "Player", edits: [{ property: "position", value: [100, 20] }] },
  ];
  const first = payloads.map((payload, index) => validateGodotCommandPayload(CAPABILITIES[index % CAPABILITIES.length] as string, payload));
  for (let round = 0; round < 5; round += 1) {
    const again = payloads.map((payload, index) => validateGodotCommandPayload(CAPABILITIES[index % CAPABILITIES.length] as string, payload));
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
  const payloadA = { kind: "godot-command-payload" as const, version: 1, subject: "scene" as const, target: "res://scenes/main.tscn" };
  const payloadB = { ...payloadA, target: "res://scenes/other.tscn" };
  const key1 = godotCommandKey("scene.inspect", payloadA);
  const key2 = godotCommandKey("scene.inspect", payloadA);
  const key3 = godotCommandKey("scene.inspect", payloadB);
  const key4 = godotCommandKey("scene.inspect", payloadA, 99);
  assert.equal(key1, key2);
  assert.notEqual(key1, key3);
  assert.notEqual(key1, key4);
  assert.match(key1, /^godot-cmd-[a-f0-9]{32}$/);
});

test("evidence: append-only + content-addressed duplicate discipline (E10)", () => {
  const ledger = createGodotEvidenceLedger();
  const entry = {
    kind: "godot-exchange-record" as const,
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
  assert.deepEqual(createGodotEngineBinding(), createGodotEngineBinding());
  assert.match(createGodotEngineBinding().bindingDigest, /^sha256:[a-f0-9]{64}$/);
});
