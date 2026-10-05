import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalCommandForm,
  canonicalEventForm,
  canonicalFloatForm,
  canonicalIntentForm,
  canonicalValueForm,
  gameIRValuesEqual,
  hashCommand,
  hashGameIRValue,
  hashIntent,
  verifySimulationStepDeterminism,
} from "./evaluate.ts";
import type { SimulationStep } from "./evaluate.ts";
import type { Command, Intent } from "./semantics.ts";
import { asCommandTypeId, asEventTypeId, asIntentTypeId } from "./semantics.ts";
import { asAgentId, asAvatarId, asEntityId, asSceneId, asWorldId } from "@playliquid/game-contracts";
import type { GameIRValue } from "./values.ts";

const TARGET = {
  world: asWorldId("world-primus")!,
  scene: asSceneId("scene-overworld")!,
  entity: asEntityId("entity-hero")!,
};

function sampleIntent(tick: number): Intent {
  return {
    type: asIntentTypeId("avatar.movement.requested")!,
    payload: { kind: "record", fields: { dx: { kind: "int", value: 1n } } },
    actor: { agent: asAgentId("agent-atlas")!, avatar: asAvatarId("avatar-nova")! },
    tick,
  };
}

test("evaluate: canonical forms are frozen and exact", () => {
  assert.equal(canonicalValueForm({ kind: "unit" }), "u()");
  assert.equal(canonicalValueForm({ kind: "bool", value: true }), "b(1)");
  assert.equal(canonicalValueForm({ kind: "bool", value: false }), "b(0)");
  assert.equal(canonicalValueForm({ kind: "int", value: 1n }), "i(1)");
  assert.equal(canonicalValueForm({ kind: "int", value: -42n }), "i(-42)");
  assert.equal(canonicalValueForm({ kind: "float", value: 1.5 }), "f(1.5)");
  assert.equal(canonicalValueForm({ kind: "string", value: "x" }), 's("x")');
  assert.equal(
    canonicalValueForm({ kind: "list", items: [{ kind: "int", value: 1n }, { kind: "string", value: "x" }] }),
    'l[i(1),s("x")]',
  );
  assert.equal(
    canonicalValueForm({
      kind: "record",
      fields: { b: { kind: "string", value: "x" }, a: { kind: "int", value: 1n } },
    }),
    'r{"a":i(1),"b":s("x")}',
  );
  assert.equal(canonicalValueForm({ kind: "entity-ref", ref: TARGET }), 'e("world-primus","scene-overworld","entity-hero")');
});

test("evaluate: float canonicalization pins the edge cases", () => {
  assert.equal(canonicalFloatForm(Number.NaN), "nan");
  assert.equal(canonicalFloatForm(Number.POSITIVE_INFINITY), "inf");
  assert.equal(canonicalFloatForm(Number.NEGATIVE_INFINITY), "-inf");
  assert.equal(canonicalFloatForm(-0), "-0");
  assert.equal(canonicalFloatForm(0), "0");
  assert.equal(canonicalFloatForm(1e21), "1e+21");
});

test("evaluate: record field order never matters", () => {
  const left: GameIRValue = {
    kind: "record",
    fields: { a: { kind: "int", value: 1n }, b: { kind: "int", value: 2n } },
  };
  const right: GameIRValue = {
    kind: "record",
    fields: { b: { kind: "int", value: 2n }, a: { kind: "int", value: 1n } },
  };
  assert.ok(gameIRValuesEqual(left, right));
  assert.equal(canonicalValueForm(left), canonicalValueForm(right));
  assert.equal(hashGameIRValue(left), hashGameIRValue(right));
});

test("evaluate: equality rules (NaN=NaN, -0!=+0, int!=float)", () => {
  assert.ok(gameIRValuesEqual({ kind: "float", value: Number.NaN }, { kind: "float", value: Number.NaN }));
  assert.equal(gameIRValuesEqual({ kind: "float", value: -0 }, { kind: "float", value: 0 }), false);
  assert.equal(gameIRValuesEqual({ kind: "int", value: 1n }, { kind: "float", value: 1 }), false);
  assert.ok(gameIRValuesEqual({ kind: "unit" }, { kind: "unit" }));
  assert.equal(gameIRValuesEqual({ kind: "list", items: [{ kind: "unit" }] }, { kind: "list", items: [] }), false);
});

test("evaluate: hashes are sha256 of the canonical form (R14 determinism)", () => {
  const value: GameIRValue = { kind: "record", fields: { health: { kind: "int", value: 100n } } };
  const expected = createHash("sha256").update(canonicalValueForm(value)).digest("hex");
  assert.equal(hashGameIRValue(value), expected);
  assert.match(hashGameIRValue(value), /^[0-9a-f]{64}$/);
  assert.equal(hashGameIRValue(value), hashGameIRValue(value));
});

test("evaluate: intent and command canonical forms are stable and order-sensitive", () => {
  const intent = sampleIntent(7);
  assert.equal(
    canonicalIntentForm(intent),
    'it("avatar.movement.requested",r{"dx":i(1)},"agent-atlas","avatar-nova",7)',
  );
  const command: Command = {
    type: asCommandTypeId("world.entity.move")!,
    payload: { kind: "unit" },
    target: TARGET,
    tick: 8,
    basis: [intent],
  };
  assert.equal(
    canonicalCommandForm(command),
    'cmd("world.entity.move",u(),e("world-primus","scene-overworld","entity-hero"),8,basis=[it("avatar.movement.requested",r{"dx":i(1)},"agent-atlas","avatar-nova",7)])',
  );
  assert.equal(hashIntent(intent), hashIntent(sampleIntent(7)));
  assert.notEqual(hashIntent(intent), hashIntent(sampleIntent(8)));
  const reordered: Command = { ...command, basis: [sampleIntent(7), sampleIntent(7)] };
  assert.notEqual(hashCommand(command), hashCommand(reordered));
});

test("evaluate: event canonical form includes optional source", () => {
  const withSource = canonicalEventForm({
    type: asEventTypeId("world.entity.moved")!,
    payload: { kind: "unit" },
    tick: 9,
    source: TARGET,
  });
  const withoutSource = canonicalEventForm({
    type: asEventTypeId("world.entity.moved")!,
    payload: { kind: "unit" },
    tick: 9,
  });
  assert.match(withSource, /,e\("world-primus"/);
  assert.match(withoutSource, /,null,9\)$/);
  assert.notEqual(withSource, withoutSource);
});

test("evaluate: a pure simulation step verifies as deterministic", () => {
  const step: SimulationStep = (input) => ({
    state: {
      kind: "record",
      fields: { moves: { kind: "int", value: BigInt(input.commands.length) } },
    },
    events: input.commands.map((command) => ({
      type: asEventTypeId("world.entity.moved")!,
      payload: command.payload,
      tick: command.tick,
    })),
  });
  assert.ok(
    verifySimulationStepDeterminism(step, {
      state: { kind: "record", fields: { moves: { kind: "int", value: 0n } } },
      commands: [],
    }),
  );
});

test("evaluate: a stateful step fails the determinism check", () => {
  let counter = 0;
  const impure: SimulationStep = () => ({
    state: { kind: "record", fields: { moves: { kind: "int", value: BigInt((counter += 1)) } } },
    events: [],
  });
  assert.equal(
    verifySimulationStepDeterminism(impure, {
      state: { kind: "record", fields: { moves: { kind: "int", value: 0n } } },
      commands: [],
    }),
    false,
  );
});
