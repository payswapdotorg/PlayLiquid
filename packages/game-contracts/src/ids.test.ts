import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asAgentId,
  asAvatarId,
  asChunkId,
  asEntityId,
  asGameId,
  asRegionId,
  asSceneId,
  asWorldId,
  asZoneId,
  isValidIdText,
} from "./ids.ts";
import type { WorldId } from "./ids.ts";

test("ids: canonical slugs parse", () => {
  assert.notEqual(asGameId("game-alpha"), undefined);
  assert.notEqual(asGameId("a"), undefined);
  assert.notEqual(asWorldId("world-primus"), undefined);
  assert.notEqual(asSceneId("scene-overworld"), undefined);
  assert.notEqual(asRegionId("region-north"), undefined);
  assert.notEqual(asZoneId("zone-frost"), undefined);
  assert.notEqual(asChunkId("chunk-0-0"), undefined);
  assert.notEqual(asEntityId("entity-hero"), undefined);
  assert.notEqual(asAvatarId("avatar-nova"), undefined);
  assert.notEqual(asAgentId("agent-atlas"), undefined);
});

test("ids: boundary lengths are enforced", () => {
  assert.ok(isValidIdText("a".repeat(63)));
  assert.equal(isValidIdText("a".repeat(64)), false);
  assert.equal(isValidIdText(""), false);
});

test("ids: non-canonical text is rejected", () => {
  assert.equal(isValidIdText("UpperCase"), false);
  assert.equal(isValidIdText("-leading"), false);
  assert.equal(isValidIdText("trailing-"), false);
  assert.equal(isValidIdText("double--ok"), true);
  assert.equal(isValidIdText("with space"), false);
  assert.equal(isValidIdText("with.dot"), false);
  assert.equal(asGameId("UpperCase"), undefined);
});

test("ids: branded ids are not interchangeable (compile-time misuse)", () => {
  // @ts-expect-error — a plain string is not a branded WorldId
  const plain: WorldId = "world-primus";
  // @ts-expect-error — a GameId is not a WorldId
  const mixed: WorldId = asGameId("game-alpha");
  assert.equal(typeof plain, "string");
  assert.equal(typeof mixed, "string");
});
