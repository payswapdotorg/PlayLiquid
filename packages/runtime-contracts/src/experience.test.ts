/**
 * Experience Protocol tests (lock rule 12): the SAME operations and
 * admission semantics serve both runtimes, with exactly the two documented
 * role differences (simulation determinism; act-in-ready for interactive).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admitExperienceOperation,
  validateLoadRequest,
  type ExperienceOperation,
  type TypedIntent,
} from "./experience.ts";
import {
  asActorId,
  asCommandId,
  asDeterminismSeed,
  asEventSequence,
  asIntentId,
  asIntentKind,
  asSessionId,
  asSnapshotId,
  asTimestamp,
} from "./primitives.ts";
import { asGameIrDigest, type GameRefSummary } from "./game-ir-seam.ts";
import { asDigest } from "./primitives.ts";

const sessionId = asSessionId("s-exp");

const game: GameRefSummary = {
  gameDigest: asGameIrDigest("gd-1"),
  world: { worldId: "w-1", revisionDigest: asDigest("d".repeat(64)) },
  policy: { policyId: "p-1", revisionDigest: asDigest("e".repeat(64)) },
};

const op = (operation: ExperienceOperation): ExperienceOperation => operation;

test("lock 12: both roles share the same admission semantics for stepping", () => {
  for (const role of ["interactive", "simulation"] as const) {
    const step = op({ op: "step", sessionId, ticks: 2 });
    assert.equal(admitExperienceOperation(role, "running", step).status, "admitted");
  }
});

test("lock 12: interactive may act in ready; simulation may not", () => {
  const act = op({
    op: "act",
    sessionId,
    intent: {
      intentId: asIntentId("i-1"),
      kind: asIntentKind("move.to"),
      actor: { actorClass: "player", actorId: asActorId("p-1") },
      payload: { to: [1, 2] },
      issuedAt: asTimestamp(1),
    },
  });
  assert.equal(admitExperienceOperation("interactive", "ready", act).status, "admitted");
  const sim = admitExperienceOperation("simulation", "ready", act);
  assert.equal(sim.status, "rejected");
  if (sim.status === "rejected") {
    assert.equal(sim.code, "act-requires-running-in-simulation");
  }
  assert.equal(admitExperienceOperation("simulation", "running", act).status, "admitted");
});

test("load is admitted only during provisioning", () => {
  const load = op({ op: "load", sessionId, game, role: "interactive" });
  assert.equal(admitExperienceOperation("interactive", "provisioning", load).status, "admitted");
  const late = admitExperienceOperation("interactive", "ready", load);
  assert.equal(late.status, "rejected");
  if (late.status === "rejected") {
    assert.equal(late.code, "wrong-phase");
  }
});

test("every live operation is rejected in terminal phases", () => {
  const observe = op({ op: "observe", sessionId, afterEventSeq: asEventSequence(1) });
  const result = admitExperienceOperation("interactive", "terminated", observe);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "wrong-phase");
  }
});

test("terminate is admissible from any non-terminal phase", () => {
  for (const phase of ["provisioning", "loading", "ready", "running", "suspended"] as const) {
    const t = op({ op: "terminate", sessionId, reason: "test" });
    assert.equal(admitExperienceOperation("interactive", phase, t).status, "admitted", phase);
  }
});

test("snapshot/restore/replay are live-phase operations", () => {
  for (const phase of ["ready", "running", "suspended"] as const) {
    assert.equal(
      admitExperienceOperation("simulation", phase, op({ op: "snapshot", sessionId })).status,
      "admitted",
      `snapshot in ${phase}`,
    );
    assert.equal(
      admitExperienceOperation("simulation", phase, op({ op: "restore", sessionId, snapshotId: asSnapshotId("snap-1") })).status,
      "admitted",
      `restore in ${phase}`,
    );
    assert.equal(
      admitExperienceOperation("simulation", phase, op({ op: "replay", sessionId, fromEventSeq: asEventSequence(1), toEventSeq: null })).status,
      "admitted",
      `replay in ${phase}`,
    );
  }
});

test("E9: simulation loads require a determinism seed; interactive loads do not", () => {
  const simLoad = validateLoadRequest({
    op: "load",
    sessionId,
    game,
    role: "simulation",
  });
  assert.equal(simLoad.ok, false);
  if (!simLoad.ok) {
    assert.equal(simLoad.code, "determinism-required-for-simulation");
  }
  const seeded = validateLoadRequest({
    op: "load",
    sessionId,
    game,
    role: "simulation",
    determinism: asDeterminismSeed("seed-1"),
  });
  assert.equal(seeded.ok, true);
  const interactive = validateLoadRequest({ op: "load", sessionId, game, role: "interactive" });
  assert.equal(interactive.ok, true);
});

test("type-level: a TypedIntent is a proposal, never a command (lock 13)", () => {
  const intent: TypedIntent<{ to: number[] }> = {
    intentId: asIntentId("i-2"),
    kind: asIntentKind("move.to"),
    actor: { actorClass: "avatar-agent", actorId: asActorId("a-1") },
    payload: { to: [1, 1] },
    issuedAt: asTimestamp(5),
  };
  // @ts-expect-error TS2740/TS2322: intent lacks every command envelope field
  const command: { commandId: ReturnType<typeof asCommandId> } = intent;
  void command;
  assert.equal(intent.payload.to.length, 2);
});
