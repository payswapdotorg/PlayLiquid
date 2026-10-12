/**
 * LADDER GUARDRAILS (PL-040 qa/e2e-lab negative class, R18) — the frozen
 * capability-gap ladder attacked from three sides, every refusal asserted
 * with the AUTHORITATIVE code VERBATIM (E8):
 *
 * - the GAP DOOR: a two-rung jump is refused `rung-skip`; a jump straight at
 *   the Arena rung is refused `rung-skip` too (the trail is non-empty — the
 *   FIRST-resort code belongs to the empty-trail form); an unknown gap is
 *   refused `gap-unknown`;
 * - the LADDER AUTHORITY ITSELF (lab-contracts' public `appendGapRungAttempt`):
 *   an empty-trail record whose first attempt claims Arena is refused
 *   `arena-first-resort` (R18: Arena is never a first resort) — the same
 *   forgery aimed at the RUNTIME's registration door surfaces inside the
 *   `invalid-source` detail (see forged-escalations.test.ts);
 * - the TERMINAL + RESOLVED rungs: after a `blocked` attempt nothing may
 *   follow (`blocked-is-terminal`); after a resolved attempt the gap takes no
 *   further rungs (`gap-already-resolved`);
 * - the typed command port refuses malformed intents BEFORE any domain call
 *   (`invalid-intent`) — and the refusal leaves no trace in any door.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendGapRungAttempt, asArenaEscalationId, asGapRecordId, asTimestampMs } from "../../../packages/lab-contracts/src/index.ts";
import type { ArenaEscalationRef, CapabilityGapRecord, ContentDigest, GapRungAttempt } from "../../../packages/lab-contracts/src/index.ts";
import { createHostileWorld } from "./hostile-rig.ts";
import type { HostileWorldRig } from "./hostile-rig.ts";
import { CYCLE_ONE, SEARCH_SEED_ONE } from "./ids.ts";
import { assertRefusedWith } from "./adversary-kit.ts";

/** One hostile world with a discovered gap (pre-ladder). */
function worldWithGap(): { world: HostileWorldRig; gapRecord: CapabilityGapRecord } {
  const world = createHostileWorld();
  const cycle = world.runHostileCycle({ cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 3 });
  const gapId = cycle.gapIds[0];
  if (gapId === undefined) throw new Error("ladder: no gap discovered");
  const read = world.stack.organization.getCapabilityGap(gapId, world.caller);
  if (!read.ok) throw new Error("ladder: gap read refused");
  return { world, gapRecord: read.gap };
}

/** The hostile port's advance intent over the hostile caller. */
function advanceIntent(world: HostileWorldRig, gapId: string, attempt: {
  readonly rung: GapRungAttempt["rung"];
  readonly disposition: "attempted" | "unavailable" | "declined";
  readonly outcome?: "resolved" | "unresolved";
  readonly external?: ArenaEscalationRef;
}) {
  return {
    kind: "advance-gap-rung" as const,
    tenant: String(world.caller.tenant),
    subject: String(world.caller.subject),
    gapId,
    ...attempt,
  };
}

test("ladder guardrails (E8): a two-rung jump is refused rung-skip, verbatim — the trail is untouched", () => {
  const { world, gapRecord } = worldWithGap();
  const gapId = String(gapRecord.gapId);
  const refused = world.commandPort.dispatch(
    advanceIntent(world, gapId, { rung: "user-community-contribution", disposition: "declined" }),
  );
  assertRefusedWith(refused, "rung-skip");
  const read = world.stack.organization.getCapabilityGap(gapId, world.caller);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.gap.attempts.length, gapRecord.attempts.length, "a refused jump appends nothing (E10)");
});

test("ladder guardrails (E8): jumping straight at the Arena rung from a non-empty trail is refused rung-skip (not arena-first-resort)", () => {
  const { world, gapRecord } = worldWithGap();
  const refused = world.commandPort.dispatch(
    advanceIntent(world, String(gapRecord.gapId), { rung: "arena-escalation", disposition: "declined" }),
  );
  const refusal = assertRefusedWith(refused, "rung-skip");
  // The FIRST-resort code fires only on an EMPTY trail (the authority test
  // below); here the existing-organization attempt exists, so the stepwise
  // rule is the one that refuses.
  assert.ok(refusal.detail.includes("one step at a time"), "the refusal states the stepwise rule");
});

test("ladder guardrails (E8): an empty-trail record whose first attempt claims Arena is refused arena-first-resort by the ladder authority (R18)", () => {
  const empty: CapabilityGapRecord = {
    gapId: asGapRecordId("gap-qa-empty-trail")!,
    cycleId: CYCLE_ONE,
    missingCapability: "lab-cap-qa-netcode",
    summary: "hand-crafted empty-trail record for the authority probe",
    openedAt: asTimestampMs(1_000)!,
    attempts: [],
  };
  const refused = appendGapRungAttempt(empty, {
    rung: "arena-escalation",
    disposition: "attempted",
    outcome: "unresolved",
    external: { external: "arena-external", escalationId: asArenaEscalationId("arena-esc-x")!, requestDigest: "ab".repeat(32) as ContentDigest },
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "arena-first-resort", "R18: the ladder authority's own code, verbatim");
    assert.ok(refused.detail.includes("never a first resort") || refused.detail.includes("existing organization"), "the refusal states the R18 order");
  }
});

test("ladder guardrails (E8): an unknown gap is refused gap-unknown, verbatim", () => {
  const world = createHostileWorld();
  const refused = world.commandPort.dispatch(
    advanceIntent(world, "gap-never-recorded", { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved" }),
  );
  assertRefusedWith(refused, "gap-unknown");
});

test("ladder guardrails (E8): blocked is terminal — nothing may follow a blocked attempt (verbatim)", () => {
  const { world, gapRecord } = worldWithGap();
  const gapId = String(gapRecord.gapId);
  // `blocked` follows ONLY the Arena rung (lab-contracts' frozen transition
  // table: arena-escalation -> blocked; the package's own gaps.test.ts "the
  // full ladder walk ends at the typed blocked terminal" is the authority),
  // so the honest single-step advance to the terminal rung first walks the
  // REAL ladder to the Arena rung — the hostile route, every rung ATTEMPTED
  // and unresolved.
  for (const attempt of [
    { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" },
    { rung: "user-community-contribution", disposition: "attempted", outcome: "unresolved" },
  ] as const) {
    const advanced = world.commandPort.dispatch(advanceIntent(world, gapId, attempt));
    if (!advanced.ok) throw new Error(`ladder: walking ${attempt.rung} refused: ${advanced.detail}`);
  }
  const arenaRung = world.commandPort.dispatch(
    advanceIntent(world, gapId, {
      rung: "arena-escalation", disposition: "attempted", outcome: "unresolved",
      external: { external: "arena-external", escalationId: asArenaEscalationId("arena-esc-ladder-blocked")!, requestDigest: "ab".repeat(32) as ContentDigest },
    }),
  );
  if (!arenaRung.ok) throw new Error(`ladder: the arena rung was refused: ${arenaRung.detail}`);
  // The typed port cannot carry the blocked rung (it needs a reason this
  // intent shape cannot hold); the hostile caller drives the DOOR directly
  // with the full typed terminal attempt.
  const blocked = world.stack.organization.advanceCapabilityGap({
    gapId,
    attempt: { rung: "blocked", reason: "hostile world: the Arena escalation did not resolve the capability" },
    as: world.caller,
  });
  assert.equal(blocked.ok, true, `the honest single-step blocked advance is admitted: ${blocked.ok ? "" : blocked.detail}`);
  const after = world.stack.organization.advanceCapabilityGap({
    gapId,
    attempt: { rung: "arena-escalation", disposition: "declined" },
    as: world.caller,
  });
  assertRefusedWith(after, "blocked-is-terminal");
  // And the community seam sees the gap as blocked (not open).
  const read = world.stack.organization.getCapabilityGap(gapId, world.caller);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.gap.attempts[read.gap.attempts.length - 1]?.rung, "blocked");
});

test("ladder guardrails (E8): a resolved gap takes no further rungs (gap-already-resolved, verbatim)", () => {
  const { world, gapRecord } = worldWithGap();
  const gapId = String(gapRecord.gapId);
  const resolved = world.commandPort.dispatch(
    advanceIntent(world, gapId, { rung: "alternate-organization", disposition: "attempted", outcome: "resolved" }),
  );
  assert.equal(resolved.ok, true, `the alternate organization resolved the gap: ${resolved.ok ? "" : resolved.detail}`);
  const after = world.commandPort.dispatch(
    advanceIntent(world, gapId, { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" }),
  );
  assertRefusedWith(after, "gap-already-resolved");
});

test("ladder guardrails (E8): the typed port refuses malformed intents BEFORE any domain call — and leaves no trace", () => {
  const { world, gapRecord } = worldWithGap();
  const gapId = String(gapRecord.gapId);
  const attemptsBefore = gapRecord.attempts.length;
  const searchesBefore = world.stack.organization.document().searches.length;

  const badAgents = world.commandPort.dispatch({ kind: "request-search", tenant: String(world.caller.tenant), subject: String(world.caller.subject), cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 0 });
  assertRefusedWith(badAgents, "invalid-intent");
  const negativeAgents = world.commandPort.dispatch({ kind: "request-search", tenant: String(world.caller.tenant), subject: String(world.caller.subject), cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: -2 });
  assertRefusedWith(negativeAgents, "invalid-intent");
  const fractionalAgents = world.commandPort.dispatch({ kind: "request-search", tenant: String(world.caller.tenant), subject: String(world.caller.subject), cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 1.5 });
  assertRefusedWith(fractionalAgents, "invalid-intent");

  const badCaller = world.commandPort.dispatch({ kind: "request-search", tenant: "NOT A TENANT", subject: String(world.caller.subject), cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 2 });
  assertRefusedWith(badCaller, "invalid-intent");

  const blockedRung = world.commandPort.dispatch(advanceIntent(world, gapId, { rung: "blocked", disposition: "declined" }));
  assertRefusedWith(blockedRung, "invalid-intent");
  const declinedAutonomous = world.commandPort.dispatch(advanceIntent(world, gapId, { rung: "existing-organization", disposition: "declined" }));
  assertRefusedWith(declinedAutonomous, "invalid-intent");
  const arenaWithoutRef = world.commandPort.dispatch(advanceIntent(world, gapId, { rung: "arena-escalation", disposition: "attempted", outcome: "unresolved" }));
  assertRefusedWith(arenaWithoutRef, "invalid-intent");
  const unknownKind = world.commandPort.dispatch({ kind: "not-an-intent" } as unknown as Parameters<typeof world.commandPort.dispatch>[0]);
  assertRefusedWith(unknownKind, "invalid-intent");

  // None of the refusals reached the domain: no gap mutation, no search opened.
  const read = world.stack.organization.getCapabilityGap(gapId, world.caller);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.gap.attempts.length, attemptsBefore, "invalid intents never mutate the gap trail");
  assert.equal(world.stack.organization.document().searches.length, searchesBefore, "invalid intents never open a search");
});
