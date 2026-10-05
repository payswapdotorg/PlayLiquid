import { test } from "node:test";
import assert from "node:assert/strict";
import { asCommitSha } from "./git.ts";
import { asGameId } from "./ids.ts";
import {
  GAME_KINDS,
  GAME_LIFECYCLE_STATES,
  GAME_LIFECYCLE_TRANSITIONS,
  canTransitionGameState,
  gameIdentityKey,
  isGameIdentity,
  isGameKind,
  isGameLifecycleState,
} from "./game-identity.ts";
import type { GameIdentity, GameLifecycleState } from "./game-identity.ts";

const HEAD = "b88e814755e9bd1efed6cb6f8e26f316bada1247";

function fixtureIdentity(): GameIdentity {
  return {
    id: asGameId("game-alpha")!,
    displayName: "Game Alpha",
    kind: "game",
    repository: { host: "github.com", owner: "payswapdotorg", repository: "game-alpha" },
    revision: { kind: "commit", commit: asCommitSha(HEAD)! },
    lineage: { head: asCommitSha(HEAD)!, ancestors: [] },
  };
}

test("game-identity: kind vocabulary is closed", () => {
  assert.deepEqual([...GAME_KINDS], ["game", "prototype", "demo", "toolkit"]);
  assert.ok(isGameKind("game"));
  assert.equal(isGameKind("mmorpg"), false);
  assert.equal(isGameKind(42), false);
});

test("game-identity: lifecycle state vocabulary is closed", () => {
  assert.deepEqual([...GAME_LIFECYCLE_STATES], ["draft", "active", "released", "deprecated", "archived"]);
  assert.ok(isGameLifecycleState("draft"));
  assert.equal(isGameLifecycleState("live"), false);
});

test("game-identity: legal transitions pass", () => {
  assert.ok(canTransitionGameState("draft", "active"));
  assert.ok(canTransitionGameState("active", "released"));
  assert.ok(canTransitionGameState("released", "deprecated"));
  assert.ok(canTransitionGameState("deprecated", "archived"));
  assert.ok(canTransitionGameState("draft", "archived"));
});

test("game-identity: illegal transitions fail; archived is terminal", () => {
  assert.equal(canTransitionGameState("draft", "released"), false);
  assert.equal(canTransitionGameState("archived", "draft"), false);
  assert.equal(canTransitionGameState("released", "active"), false);
  for (const from of GAME_LIFECYCLE_STATES) {
    assert.equal(canTransitionGameState("archived", from), false);
    assert.equal(GAME_LIFECYCLE_TRANSITIONS.archived.length, 0);
  }
});

test("game-identity: transition table is frozen (E1 single owner, immutable)", () => {
  assert.ok(Object.isFrozen(GAME_LIFECYCLE_TRANSITIONS));
  assert.ok(Object.isFrozen(GAME_LIFECYCLE_TRANSITIONS.draft));
  assert.ok(Object.isFrozen(GAME_KINDS));
  assert.ok(Object.isFrozen(GAME_LIFECYCLE_STATES));
});

test("game-identity: structural guard accepts a valid identity", () => {
  const identity = fixtureIdentity();
  assert.ok(isGameIdentity(identity));
  assert.equal(gameIdentityKey(identity), "payswapdotorg/game-alpha@b88e814755e9bd1efed6cb6f8e26f316bada1247");
});

test("game-identity: structural guard rejects broken identities", () => {
  const identity = fixtureIdentity();
  assert.equal(isGameIdentity({ ...identity, id: "NOT-A-SLUG" }), false);
  assert.equal(isGameIdentity({ ...identity, displayName: "" }), false);
  assert.equal(isGameIdentity({ ...identity, kind: "mmorpg" }), false);
  assert.equal(isGameIdentity({ ...identity, revision: { kind: "nope" } }), false);
  assert.equal(isGameIdentity({ ...identity, lineage: { head: "short" } }), false);
  assert.equal(isGameIdentity(undefined), false);
});

test("game-identity: lifecycle misuse is a compile-time error", () => {
  // @ts-expect-error — "live" is not a GameLifecycleState
  const state: GameLifecycleState = "live";
  assert.equal(typeof state, "string");
});
