/**
 * PROPERTY-STYLE FUZZ (PL-025, E8) — untrusted-payload total validation
 * over seeded pseudo-random inputs: the validator must NEVER throw, never
 * silently coerce, and must either produce a frozen normalized payload or
 * a non-empty typed rejection list. The seeded generator (deterministic
 * LCG; no Math.random — E9) mixes well-formed fields with hostile ones:
 * throwing getters, proxies, prototypes, wrong types, deep nesting.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBlenderCommandPayload } from "./payload-validate.ts";
import { BLENDER_OFFERED_CAPABILITIES, payloadFamilyFor } from "./payload-model.ts";
import { canonicalJson, sha256Hex, contentDigestOf } from "./digest.ts";
import { blenderCommandKey } from "./command-id.ts";
import { createBlenderEvidenceLedger } from "./evidence.ts";

const CAPABILITIES = [...BLENDER_OFFERED_CAPABILITIES];

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
  "game.blend",
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  true,
  false,
  [],
  ["game.blend"],
  () => "game.blend",
  Symbol("hostile"),
  10n,
  { toString: "game.blend" },
  Object.create({ target: "game.blend" }),
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
  const random = createSeededRandom(0x2525);
  let checked = 0;
  let rejected = 0;
  for (let round = 0; round < 3_000; round += 1) {
    const capability = pick(random, CAPABILITIES);
    const payload: Record<string, unknown> = {};
    // Seed a base valid shape, then corrupt a random subset of fields.
    payload["version"] = pick(random, [1, 1, 1, 2, "1", undefined]);
    payload["target"] = pick(random, ["game.blend", "assets/hero", "", 5, null, "../escape"]);
    payload["format"] = pick(random, ["glb", "gltf", "exe", "", null]);
    payload["into"] = pick(random, ["scene", "library", "garage"]);
    payload["mode"] = pick(random, ["whole-scene", "selection", "object", "half-scene"]);
    payload["action"] = pick(random, ["save-all", "NOT KEBAB", "", 7]);
    payload["scriptDigest"] = pick(random, [digest("a"), "xyz", 42]);
    payload["edits"] = pick(random, [
      [{ objectName: "Cube", property: "scale", value: 1 }],
      [],
      "not-an-array",
      [{ objectName: "", property: "scale", value: 1 }],
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
      const check = validateBlenderCommandPayload(capability, hostile);
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
      const check = validateBlenderCommandPayload(capability, throwingPayload());
      checked += 1;
      assert.equal(check.outcome, "rejected", "throwing getters degrade to typed rejections");
      rejected += 1;
      continue;
    }
    if (random() < 0.02) {
      // Deep nesting under edits values: bounded depth, hostile shapes.
      let deep: unknown = { clientClaimed: false };
      for (let depth = 0; depth < 40; depth += 1) {
        deep = { nested: deep };
      }
      payload["edits"] = [{ objectName: "Cube", property: "custom", value: deep }];
    }
    const check = validateBlenderCommandPayload(capability, payload);
    checked += 1;
    if (check.outcome === "rejected") {
      rejected += 1;
      assert.ok(check.rejections.length > 0);
      for (const item of check.rejections) {
        assert.ok(typeof item.code === "string" && item.code.startsWith("blender-payload/"), `typed kebab-case code: ${item.code}`);
        assert.ok(typeof item.path === "string", "rejections are path-tagged");
      }
    } else {
      assert.ok(Object.isFrozen(check.payload));
    }
  }
  assert.ok(checked >= 2_900, `exercised enough inputs: ${checked}`);
  assert.ok(rejected > 0, `rejections were produced: ${rejected}`);
});

test("fuzz: the dispatch-level validator stays total over non-objects and arrays", () => {
  const random = createSeededRandom(0x99);
  const inputs: unknown[] = [undefined, null, [], [1, 2, 3], "string", 42, true, Symbol("s"), () => {}];
  for (let round = 0; round < 500; round += 1) {
    const capability = pick(random, CAPABILITIES);
    const check = validateBlenderCommandPayload(capability, pick(random, inputs));
    assert.equal(check.outcome, "rejected");
    if (check.outcome === "rejected") {
      assert.equal(check.rejections[0]?.code, "blender-payload/not-an-object");
    }
  }
});

test("fuzz: valid payloads validate identically across repeated runs (E9 determinism)", () => {
  const payloads = [
    { version: 1, target: "game.blend" },
    { version: 1, target: "assets/hero", format: "glb", into: "scene", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 2048 } },
    { version: 1, target: "assets/hero", format: "gltf", mode: "object", objectName: "Cube" },
    { version: 1, target: "game.blend", edits: [{ objectName: "Cube", property: "scale", value: [2, 2, 2] }] },
    { version: 1, action: "save-all", target: "game.blend" },
    { version: 1, target: "game.blend", scriptDigest: digest("b") },
  ];
  const first = payloads.map((payload, index) => validateBlenderCommandPayload(CAPABILITIES[index % CAPABILITIES.length] as string, payload));
  for (let round = 0; round < 5; round += 1) {
    const again = payloads.map((payload, index) => validateBlenderCommandPayload(CAPABILITIES[index % CAPABILITIES.length] as string, payload));
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
  const payloadA = { kind: "blender-command-payload" as const, version: 1, subject: "scene" as const, target: "scene-main" };
  const payloadB = { ...payloadA, target: "scene-other" };
  const key1 = blenderCommandKey("scene.inspect", payloadA);
  const key2 = blenderCommandKey("scene.inspect", payloadA);
  const key3 = blenderCommandKey("scene.inspect", payloadB);
  const key4 = blenderCommandKey("scene.inspect", payloadA, 99);
  assert.equal(key1, key2);
  assert.notEqual(key1, key3);
  assert.notEqual(key1, key4);
  assert.match(key1, /^blender-cmd-[a-f0-9]{32}$/);
});

test("evidence: append-only + content-addressed duplicate discipline (E10)", () => {
  const ledger = createBlenderEvidenceLedger();
  const entry = {
    kind: "blender-exchange-record" as const,
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
