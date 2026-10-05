import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORBIDDEN_RECORD_KEYS,
  GAME_IR_VALUE_KINDS,
  MAX_LIST_LENGTH,
  MAX_RECORD_FIELDS,
  MAX_VALUE_DEPTH,
  gameIRValueKind,
  isGameIRValue,
  isGameIRValueKind,
} from "./values.ts";
import type { GameIRValue } from "./values.ts";
import { asEntityId, asSceneId, asWorldId } from "@playliquid/game-contracts";

test("values: every kind passes the guard", () => {
  const samples: GameIRValue[] = [
    { kind: "unit" },
    { kind: "bool", value: true },
    { kind: "int", value: 9007199254740993n },
    { kind: "float", value: 1.5 },
    { kind: "string", value: "hello" },
    { kind: "list", items: [{ kind: "unit" }, { kind: "bool", value: false }] },
    { kind: "record", fields: { a: { kind: "unit" } } },
    {
      kind: "entity-ref",
      ref: { world: asWorldId("world-primus")!, scene: asSceneId("scene-overworld")!, entity: asEntityId("entity-hero")! },
    },
  ];
  for (const sample of samples) {
    assert.ok(isGameIRValue(sample), `${sample.kind} should validate`);
  }
  assert.equal(samples.length, GAME_IR_VALUE_KINDS.length);
});

test("values: kind vocabulary is closed and frozen", () => {
  assert.ok(isGameIRValueKind("entity-ref"));
  assert.equal(isGameIRValueKind("map"), false);
  assert.ok(Object.isFrozen(GAME_IR_VALUE_KINDS));
  assert.deepEqual([...FORBIDDEN_RECORD_KEYS], ["__proto__", "constructor", "prototype"]);
});

test("values: guard rejects wrong payload types", () => {
  assert.equal(isGameIRValue({ kind: "int", value: 1 }), false);
  assert.equal(isGameIRValue({ kind: "bool", value: "true" }), false);
  assert.equal(isGameIRValue({ kind: "float", value: 1n }), false);
  assert.equal(isGameIRValue({ kind: "entity-ref", ref: { world: "BAD" } }), false);
  assert.equal(isGameIRValue(null), false);
  assert.equal(isGameIRValue("unit"), false);
});

test("values: guard rejects prototype-pollution-shaped record keys", () => {
  const poisoned = JSON.parse('{"kind":"record","fields":{"__proto__":{"kind":"unit"}}}');
  assert.equal(isGameIRValue(poisoned), false);
});

test("values: structural budgets are enforced", () => {
  let deep: GameIRValue = { kind: "unit" };
  for (let index = 0; index < MAX_VALUE_DEPTH; index += 1) {
    deep = { kind: "list", items: [deep] };
  }
  assert.ok(isGameIRValue(deep));
  deep = { kind: "list", items: [deep] };
  assert.equal(isGameIRValue(deep), false);

  const longList: GameIRValue = { kind: "list", items: Array.from({ length: MAX_LIST_LENGTH }, () => ({ kind: "unit" }) as GameIRValue) };
  assert.ok(isGameIRValue(longList));
  const tooLong: GameIRValue = { kind: "list", items: [...longList.items, { kind: "unit" }] };
  assert.equal(isGameIRValue(tooLong), false);

  const fields: Record<string, GameIRValue> = {};
  for (let index = 0; index < MAX_RECORD_FIELDS; index += 1) {
    fields[`f${index}`] = { kind: "unit" };
  }
  assert.ok(isGameIRValue({ kind: "record", fields }));
  fields.overflow = { kind: "unit" };
  assert.equal(isGameIRValue({ kind: "record", fields }), false);
});

test("values: int payloads are bigint, not number (compile-time misuse)", () => {
  // @ts-expect-error — int values are bigint for exact determinism
  const bad: GameIRValue = { kind: "int", value: 1 };
  assert.equal(isGameIRValue(bad), false);
  assert.equal(gameIRValueKind({ kind: "unit" }), "unit");
});
