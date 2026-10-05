import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_IR_VERSION, isGameIRVersion } from "./document.ts";
import type { GameIRDocument } from "./document.ts";
import { fixtureDocument } from "./fixtures.ts";

test("document: version is frozen at 1", () => {
  assert.equal(GAME_IR_VERSION, "1");
  assert.ok(isGameIRVersion("1"));
  assert.equal(isGameIRVersion("2"), false);
  assert.equal(isGameIRVersion(1), false);
});

test("document: a full fixture document satisfies the type (compile consumer)", () => {
  const document: GameIRDocument = fixtureDocument();
  assert.equal(document.irVersion, "1");
  assert.equal(document.identity.repository.owner, "payswapdotorg");
  assert.equal(document.entry.scene, "scene-overworld");
  assert.equal(document.nodes.length, 8);
  assert.equal(document.lifecycle, "active");
});

test("document: wrong versions are compile-time errors", () => {
  // @ts-expect-error — GameIRVersion is the literal "1"
  const bad: GameIRDocument = { ...fixtureDocument(), irVersion: "2" };
  assert.equal(isGameIRVersion(bad.irVersion), false);
});
