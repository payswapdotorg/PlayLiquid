import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asCommandTypeId,
  asEventTypeId,
  asIntentTypeId,
  isSemanticTick,
  isValidTypeIdText,
} from "./semantics.ts";
import type { Command, GameEvent, Intent, IntentAdjudicator } from "./semantics.ts";
import { asAgentId, asAvatarId, asEntityId, asSceneId, asWorldId } from "@playliquid/game-contracts";

test("semantics: type ids are lowercase dot-namespaced", () => {
  assert.notEqual(asEventTypeId("avatar.movement.requested"), undefined);
  assert.notEqual(asIntentTypeId("a"), undefined);
  assert.notEqual(asCommandTypeId("world.entity.move"), undefined);
  assert.equal(isValidTypeIdText("Avatar.Movement"), false);
  assert.equal(isValidTypeIdText(""), false);
  assert.equal(isValidTypeIdText(".leading"), false);
  assert.equal(isValidTypeIdText("trailing."), false);
  assert.equal(isValidTypeIdText("a..b"), false);
  assert.equal(isValidTypeIdText("x".repeat(201)), false);
});

test("semantics: ticks are non-negative integers (logical time only)", () => {
  assert.ok(isSemanticTick(0));
  assert.ok(isSemanticTick(42));
  assert.equal(isSemanticTick(-1), false);
  assert.equal(isSemanticTick(1.5), false);
  assert.equal(isSemanticTick(Number.NaN), false);
  assert.equal(isSemanticTick("3"), false);
});

test("semantics: intents are typed, payload-carrying requests (lock 13)", () => {
  const intent: Intent = {
    type: asIntentTypeId("avatar.movement.requested")!,
    payload: { kind: "record", fields: { dx: { kind: "int", value: 1n } } },
    actor: { agent: asAgentId("agent-atlas")!, avatar: asAvatarId("avatar-nova")! },
    tick: 7,
  };
  assert.equal(intent.tick, 7);
  // An intent is plain data: exactly the four contract fields, nothing else.
  assert.deepEqual(Object.keys(intent).sort(), ["actor", "payload", "tick", "type"]);
});

test("semantics: commands are the authoritative primitive with cited basis", () => {
  const intent: Intent = {
    type: asIntentTypeId("avatar.movement.requested")!,
    payload: { kind: "unit" },
    actor: { agent: asAgentId("agent-atlas")! },
    tick: 7,
  };
  const command: Command = {
    type: asCommandTypeId("world.entity.move")!,
    payload: { kind: "record", fields: { dx: { kind: "int", value: 1n } } },
    target: { world: asWorldId("world-primus")!, scene: asSceneId("scene-overworld")!, entity: asEntityId("entity-hero")! },
    tick: 8,
    basis: [intent],
  };
  assert.equal(command.basis.length, 1);
  assert.equal(command.basis[0]?.tick, 7);
});

test("semantics: events are canonical observables", () => {
  const event: GameEvent = {
    type: asEventTypeId("world.entity.moved")!,
    payload: { kind: "unit" },
    tick: 9,
    source: { world: asWorldId("world-primus")!, scene: asSceneId("scene-overworld")!, entity: asEntityId("entity-hero")! },
  };
  assert.equal(event.source?.entity, "entity-hero");
});

test("semantics: the adjudication seam is a pure signature (authority lives elsewhere)", () => {
  const adjudicate: IntentAdjudicator = (intents) =>
    intents.map((intent) => ({
      type: asCommandTypeId("world.entity.move")!,
      payload: intent.payload,
      target: {
        world: asWorldId("world-primus")!,
        scene: asSceneId("scene-overworld")!,
        entity: asEntityId("entity-hero")!,
      },
      tick: intent.tick + 1,
      basis: [intent],
    }));
  const intents: readonly Intent[] = [
    { type: asIntentTypeId("avatar.movement.requested")!, payload: { kind: "unit" }, actor: { agent: asAgentId("agent-atlas")! }, tick: 1 },
  ];
  const commands = adjudicate(intents, { kind: "unit" });
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.tick, 2);
});

test("semantics: misuse is a compile-time error", () => {
  const intent: Intent = {
    type: asIntentTypeId("avatar.movement.requested")!,
    payload: { kind: "unit" },
    actor: { agent: asAgentId("agent-atlas")! },
    tick: 7,
  };
  // @ts-expect-error — intents are readonly data (compile-time contract)
  intent.tick = 8;
  // readonly is enforced by the compiler; runtime objects stay plain data
  assert.equal(typeof intent.tick, "number");
  // @ts-expect-error — payloads are GameIRValue, not raw strings
  const bad: Intent = { ...intent, payload: "left" };
  assert.equal(typeof bad.payload, "string");
});
