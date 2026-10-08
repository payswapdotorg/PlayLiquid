import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAP_LADDER_RUNGS,
  GAP_LADDER_TRANSITIONS,
  appendGapRungAttempt,
  canAdvanceGapResolution,
  gapLadderPosition,
  isArenaEscalationRef,
  isCapabilityGapRecord,
  isGapLadderRung,
  isTerminalGapRung,
  nextGapLadderRung,
  validateGapRecord,
} from "./gap-ladder.ts";
import type {
  ArenaEscalationRef,
  ArenaRungAttempt,
  AutonomousRungAttempt,
  BlockedRungAttempt,
  CapabilityGapRecord,
  CommunityRungAttempt,
} from "./gap-ladder.ts";
import { asArenaEscalationId, asGapRecordId, asLabCycleId, asOrganizationId } from "./primitives.ts";
import type { OrganizationId } from "./primitives.ts";
import { fixtureDigest, fixtureTimestamp } from "./fixtures.ts";

function gapRecord(attempts: CapabilityGapRecord["attempts"]): CapabilityGapRecord {
  return {
    gapId: asGapRecordId("gap-1")!,
    cycleId: asLabCycleId("cycle-1")!,
    missingCapability: "capability-shader-pipeline",
    summary: "The project needs a shader pipeline capability nobody currently holds.",
    openedAt: fixtureTimestamp(),
    attempts,
  };
}

function arenaRef(): ArenaEscalationRef {
  return {
    external: "arena-external",
    escalationId: asArenaEscalationId("escalation-1")!,
    requestDigest: fixtureDigest("escalation-1"),
  };
}

test("gap-ladder: the frozen resolution order matches spec/architecture.md (R18)", () => {
  assert.ok(Object.isFrozen(GAP_LADDER_RUNGS));
  assert.deepEqual([...GAP_LADDER_RUNGS], [
    "existing-organization",
    "alternate-organization",
    "package-platform-capability",
    "user-community-contribution",
    "arena-escalation",
    "blocked",
  ]);
  assert.ok(Object.isFrozen(GAP_LADDER_TRANSITIONS));
  for (const rung of GAP_LADDER_RUNGS) {
    assert.ok(isGapLadderRung(rung));
  }
  assert.equal(isGapLadderRung("immediate-arena"), false);
});

test("gap-ladder: Arena sits only after the community rung; blocked is terminal", () => {
  // Resort order (lower index = earlier resort).
  assert.ok(gapLadderPosition("existing-organization") < gapLadderPosition("user-community-contribution"));
  assert.ok(gapLadderPosition("user-community-contribution") < gapLadderPosition("arena-escalation"));
  assert.ok(gapLadderPosition("arena-escalation") < gapLadderPosition("blocked"));
  // Stepwise transitions only.
  assert.equal(canAdvanceGapResolution("existing-organization", "alternate-organization"), true);
  assert.equal(canAdvanceGapResolution("user-community-contribution", "arena-escalation"), true);
  assert.equal(nextGapLadderRung("arena-escalation"), "blocked");
  // blocked is terminal.
  assert.equal(isTerminalGapRung("blocked"), true);
  assert.equal(nextGapLadderRung("blocked"), undefined);
  assert.equal(canAdvanceGapResolution("blocked", "existing-organization"), false);
  assert.equal(isTerminalGapRung("existing-organization"), false);
});

test("gap-ladder: skipping rungs is rejected (append-time)", () => {
  const organization: OrganizationId = asOrganizationId("org-generalist")!;
  const first: AutonomousRungAttempt = {
    rung: "existing-organization",
    disposition: "attempted",
    outcome: "unresolved",
    organization,
  };
  const stepOne = appendGapRungAttempt(gapRecord([]), first);
  assert.equal(stepOne.ok, true);
  if (!stepOne.ok) return;
  // Skipping from existing-organization straight to arena-escalation.
  const skip: ArenaRungAttempt = {
    rung: "arena-escalation",
    disposition: "attempted",
    outcome: "unresolved",
    external: arenaRef(),
  };
  const stepTwo = appendGapRungAttempt(stepOne.gap, skip);
  assert.equal(stepTwo.ok, false);
  if (stepTwo.ok) return;
  assert.equal(stepTwo.code, "rung-skip");
  // ...and straight to blocked.
  const skipBlocked: BlockedRungAttempt = { rung: "blocked", reason: "gave up early" };
  const stepThree = appendGapRungAttempt(stepOne.gap, skipBlocked);
  assert.equal(stepThree.ok, false);
  if (stepThree.ok) return;
  assert.equal(stepThree.code, "rung-skip");
});

test("gap-ladder: Arena as a first resort is rejected with its own code (R18)", () => {
  const arenaFirst: ArenaRungAttempt = {
    rung: "arena-escalation",
    disposition: "attempted",
    outcome: "unresolved",
    external: arenaRef(),
  };
  const result = appendGapRungAttempt(gapRecord([]), arenaFirst);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "arena-first-resort");
  // Hand-built record starting at Arena: same refusal from the validator.
  const validation = validateGapRecord(gapRecord([arenaFirst]));
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.ok(validation.violations.some((violation) => violation.code === "arena-first-resort"));
  // The static table agrees: existing -> arena is not a legal advance.
  assert.equal(canAdvanceGapResolution("existing-organization", "arena-escalation"), false);
});

test("gap-ladder: the full canonical walk is valid, including declined optional rungs", () => {
  const organization: OrganizationId = asOrganizationId("org-generalist")!;
  const walk: CapabilityGapRecord["attempts"] = [
    { rung: "existing-organization", disposition: "attempted", outcome: "unresolved", organization },
    { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved", organization: asOrganizationId("org-specialists")! },
    { rung: "package-platform-capability", disposition: "unavailable" },
    // Lock 31: human contribution is optional — explicitly declined, never skipped.
    { rung: "user-community-contribution", disposition: "declined" },
    // Arena is optional for normal autonomy — explicitly declined, never skipped.
    { rung: "arena-escalation", disposition: "declined" },
    { rung: "blocked", reason: "no resolution path available without the shader pipeline capability" },
  ];
  const validation = validateGapRecord(gapRecord(walk));
  assert.equal(validation.ok, true);
  // Stepwise append produces the same trail.
  let gap = gapRecord([]);
  for (const attempt of walk) {
    const step = appendGapRungAttempt(gap, attempt);
    assert.equal(step.ok, true, `append of ${attempt.rung} failed`);
    if (!step.ok) return;
    gap = step.gap;
  }
  assert.deepEqual(gap.attempts, walk);
  assert.ok(isCapabilityGapRecord(gap));
});

test("gap-ladder: nothing may follow blocked (terminal at append-time too)", () => {
  const organization: OrganizationId = asOrganizationId("org-generalist")!;
  const blocked = appendGapRungAttempt(
    gapRecord([{ rung: "existing-organization", disposition: "attempted", outcome: "resolved", organization }]),
    { rung: "blocked", reason: "x" },
  );
  // A resolved gap takes no further rungs — blocked cannot even be reached.
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, "gap-already-resolved");

  const walk: CapabilityGapRecord["attempts"] = [
    { rung: "existing-organization", disposition: "attempted", outcome: "unresolved", organization },
    { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved", organization },
    { rung: "package-platform-capability", disposition: "unavailable" },
    { rung: "user-community-contribution", disposition: "declined" },
    { rung: "arena-escalation", disposition: "declined" },
    { rung: "blocked", reason: "terminal" },
  ];
  const postBlocked = appendGapRungAttempt(gapRecord(walk), {
    rung: "existing-organization",
    disposition: "attempted",
    outcome: "unresolved",
  } as AutonomousRungAttempt);
  assert.equal(postBlocked.ok, false);
  if (postBlocked.ok) return;
  assert.equal(postBlocked.code, "blocked-is-terminal");
  // Validator: attempts after blocked.
  const withExtra = validateGapRecord(gapRecord([...walk, { rung: "blocked", reason: "again" }]));
  assert.equal(withExtra.ok, false);
  if (withExtra.ok) return;
  assert.ok(withExtra.violations.some((violation) => violation.code === "post-blocked-attempt"));
});

test("gap-ladder: an actual Arena attempt requires the provider-neutral external reference (lock 32)", () => {
  const arenaAttempt: ArenaRungAttempt = {
    rung: "arena-escalation",
    disposition: "attempted",
    outcome: "unresolved",
    // external reference missing
  };
  const walk: CapabilityGapRecord["attempts"] = [
    { rung: "existing-organization", disposition: "attempted", outcome: "unresolved" },
    { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "unavailable" },
    { rung: "user-community-contribution", disposition: "declined" },
    arenaAttempt,
  ];
  const validation = validateGapRecord(gapRecord(walk));
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.ok(validation.violations.some((violation) => violation.code === "arena-escalation-requires-external-ref"));
  // With the reference, the same walk validates.
  const fixed = validateGapRecord(gapRecord([...walk.slice(0, 4), { ...arenaAttempt, external: arenaRef() }]));
  assert.equal(fixed.ok, true);
});

test("gap-ladder: attempted rungs require outcomes; declined is only for optional rungs", () => {
  const noOutcome = validateGapRecord(
    gapRecord([{ rung: "existing-organization", disposition: "attempted" } as AutonomousRungAttempt]),
  );
  assert.equal(noOutcome.ok, false);
  if (noOutcome.ok) return;
  assert.ok(noOutcome.violations.some((violation) => violation.code === "attempt-requires-outcome"));

  // A required rung cannot be declined (untyped caller smuggling).
  const declinedRequired = validateGapRecord(
    gapRecord([
      { rung: "existing-organization", disposition: "declined" } as unknown as AutonomousRungAttempt,
    ]),
  );
  assert.equal(declinedRequired.ok, false);
  if (declinedRequired.ok) return;
  assert.ok(declinedRequired.violations.some((violation) => violation.code === "declined-non-optional-rung"));
});

test("gap-ladder: rung-order violations and resolved-then-continued are reported", () => {
  const organization: OrganizationId = asOrganizationId("org-generalist")!;
  // Non-consecutive: existing -> package-platform (skipping alternate).
  const skipping = validateGapRecord(
    gapRecord([
      { rung: "existing-organization", disposition: "attempted", outcome: "unresolved", organization },
      { rung: "package-platform-capability", disposition: "unavailable" },
    ]),
  );
  assert.equal(skipping.ok, false);
  if (skipping.ok) return;
  assert.ok(skipping.violations.some((violation) => violation.code === "rung-order-violation"));

  // Resolved, then continued.
  const continued = validateGapRecord(
    gapRecord([
      { rung: "existing-organization", disposition: "attempted", outcome: "resolved", organization },
      { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved", organization },
    ]),
  );
  assert.equal(continued.ok, false);
  if (continued.ok) return;
  assert.ok(continued.violations.some((violation) => violation.code === "gap-resolved-then-continued"));
});

test("gap-ladder: blocked without a reason is invalid; the gap record shape is guarded", () => {
  const noReason = validateGapRecord(gapRecord([{ rung: "blocked", reason: "" }]));
  assert.equal(noReason.ok, false);
  if (noReason.ok) return;
  assert.ok(noReason.violations.some((violation) => violation.code === "missing-blocked-reason"));
  assert.ok(isCapabilityGapRecord(gapRecord([])));
  assert.equal(isCapabilityGapRecord({ gapId: "gap-1", cycleId: "cycle-1", missingCapability: "", attempts: [] }), false);
  assert.equal(isCapabilityGapRecord(null), false);
});

test("gap-ladder: the Arena reference is provider-neutral and guarded (lock 32)", () => {
  const ref = arenaRef();
  assert.ok(isArenaEscalationRef(ref));
  // Missing the external marker literal.
  assert.equal(isArenaEscalationRef({ escalationId: ref.escalationId, requestDigest: ref.requestDigest }), false);
  // Malformed digest.
  assert.equal(isArenaEscalationRef({ external: "arena-external", escalationId: ref.escalationId, requestDigest: "0" }), false);
  // Masquerading provider vocabulary is not part of the shape.
  assert.equal(
    isArenaEscalationRef({ external: "arena-external", escalationId: ref.escalationId, requestDigest: ref.requestDigest, provider: "some-vendor", endpoint: "https://example.invalid" }),
    true,
  );
  // ^ structurally the ref plus EXTRA untyped fields — the CONTRACT simply
  // has no field for provider/endpoint data, so nothing typed can carry it.
  const keys = Object.keys(ref).sort();
  assert.deepEqual(keys, ["escalationId", "external", "requestDigest"]);
});

test("gap-ladder: a community rung may be attempted rather than declined", () => {
  const organization: OrganizationId = asOrganizationId("org-generalist")!;
  const walk: CapabilityGapRecord["attempts"] = [
    { rung: "existing-organization", disposition: "attempted", outcome: "unresolved", organization },
    { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved", organization },
    { rung: "package-platform-capability", disposition: "attempted", outcome: "resolved", capability: "platform-replay" },
  ];
  const validation = validateGapRecord(gapRecord(walk));
  assert.equal(validation.ok, true);
  const community: CommunityRungAttempt = {
    rung: "user-community-contribution",
    disposition: "attempted",
    outcome: "unresolved",
    contribution: "issue-42",
  };
  const extended = validateGapRecord(gapRecord([...walk.slice(0, 2), { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" }, community]));
  assert.equal(extended.ok, true);
});
