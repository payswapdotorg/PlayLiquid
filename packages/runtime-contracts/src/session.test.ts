/**
 * Runtime session lifecycle tests: frozen transition table, terminality,
 * epoch semantics, and descriptor construction invariants.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSessionPhaseTransition,
  isTerminalSessionPhase,
  makeSessionDescriptor,
  nextSessionEpoch,
  TERMINAL_SESSION_PHASES,
  type RuntimeSessionPhase,
} from "./session.ts";
import {
  asDigest,
  asSessionEpoch,
  asSessionId,
  asTimestamp,
} from "./primitives.ts";
import { asGameIrDigest, type GameRefSummary } from "./game-ir-seam.ts";
import { asDeterminismSeed, asTargetProfileId } from "./primitives.ts";

const game: GameRefSummary = {
  gameDigest: asGameIrDigest("gamedigest-1"),
  world: { worldId: "w-1", revisionDigest: asDigest("d".repeat(64)) },
  policy: { policyId: "p-1", revisionDigest: asDigest("e".repeat(64)) },
};

test("load path: provisioning -> loading -> ready is legal", () => {
  assert.deepEqual(checkSessionPhaseTransition("provisioning", "loading"), {
    ok: true,
    from: "provisioning",
    to: "loading",
  });
  assert.equal(checkSessionPhaseTransition("loading", "ready").ok, true);
});

test("reset/restore return live sessions to ready", () => {
  for (const from of ["ready", "running", "suspended"] as const) {
    assert.equal(checkSessionPhaseTransition(from, "ready").ok, true, `${from} -> ready`);
  }
});

test("terminal phases admit no transitions", () => {
  assert.deepEqual([...TERMINAL_SESSION_PHASES].sort(), ["failed", "terminated"]);
  const all: RuntimeSessionPhase[] = [
    "provisioning",
    "loading",
    "ready",
    "running",
    "suspended",
    "terminating",
    "terminated",
    "failed",
  ];
  for (const terminal of TERMINAL_SESSION_PHASES) {
    assert.ok(isTerminalSessionPhase(terminal));
    for (const to of all) {
      assert.equal(
        checkSessionPhaseTransition(terminal, to).ok,
        false,
        `${terminal} -> ${to} must be illegal`,
      );
    }
  }
});

test("illegal transitions return typed violations", () => {
  const result = checkSessionPhaseTransition("terminated", "running");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "illegal-phase-transition");
    assert.equal(result.from, "terminated");
    assert.equal(result.to, "running");
  }
});

test("makeSessionDescriptor defaults epoch to 1 and rejects bad epochs", () => {
  const descriptor = makeSessionDescriptor({
    sessionId: asSessionId("s-1"),
    game,
    role: "simulation",
    determinism: asDeterminismSeed("seed-1"),
    targetProfile: asTargetProfileId("spark"),
    provisionedAt: asTimestamp(0),
  });
  assert.equal(descriptor.initialEpoch, asSessionEpoch(1));
  assert.throws(() =>
    makeSessionDescriptor({
      sessionId: asSessionId("s-1"),
      game,
      role: "interactive",
      provisionedAt: asTimestamp(0),
      initialEpoch: 0,
    }),
  );
  assert.throws(() =>
    makeSessionDescriptor({
      sessionId: asSessionId("s-1"),
      game,
      role: "interactive",
      provisionedAt: asTimestamp(0),
      initialEpoch: 1.5,
    }),
  );
});

test("epoch advances deterministically (reset/restore invalidates old epoch)", () => {
  const e1 = asSessionEpoch(1);
  const e2 = nextSessionEpoch(e1);
  const e3 = nextSessionEpoch(e2);
  assert.equal(e2, asSessionEpoch(2));
  assert.equal(e3, asSessionEpoch(3));
  assert.notEqual(e1, e2);
});
