/**
 * CROSS-TENANT MOVES (PL-040 qa/e2e-lab negative class, R20) — the confused
 * foreign tenant attacking every stage of the hostile walk, each refusal
 * asserted with the AUTHORITATIVE code VERBATIM (E8):
 *
 * - the Lab doors: the foreign tenant cannot advance, read, page or evaluate
 *   in the hostile tenant's sessions, cannot calibrate its evaluations and
 *   cannot read its learning records (`cross-tenant`, verbatim) — while its
 *   OWN search opens and pages cleanly (isolation, not lockout);
 * - the typed command port: the cross-tenant attempt goes THROUGH the port
 *   (the caller identity travels with the intent — a stronger seam than the
 *   canonical example's direct-door attack);
 * - the Arena runtime: the foreign tenant cannot read, drive or label the
 *   hostile tenant's case (`cross-tenant`, verbatim);
 * - the Community service: a MOVED contributor (a member of the hostile
 *   tenant whose ownership moved to the foreign tenant) cannot submit into
 *   the hostile tenant (`cross-tenant-contributor`); a foreign actor cannot
 *   command the hostile tenant's workflow (`cross-tenant-actor`), and a
 *   hostile-tenant command aimed at the foreign tenant is refused the same
 *   way.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { labFixtureSuite } from "../../../packages/lab-simulation/src/index.ts";
import { asContributionId } from "../../../packages/community/src/index.ts";
import type { CapabilityGapRecord } from "../../../packages/lab-contracts/src/index.ts";
import { createHostileArena, hostileAskDigestOf } from "./hostile-arena.ts";
import { createHostileCommunity } from "./hostile-community.ts";
import { createHostileWorld } from "./hostile-rig.ts";
import type { HostileWorldRig } from "./hostile-rig.ts";
import { CYCLE_ONE, CYCLE_TWO, EVALUATION_SEED, EVALUATION_TICK_BUDGET, HOSTILE_FOREIGN_SUBJECT, HOSTILE_FOREIGN_TENANT, HOSTILE_MAINTAINER, HOSTILE_MOVED_SUBJECT, OBSERVATION_ONE, SEARCH_SEED_ONE, SEARCH_SEED_TWO } from "./ids.ts";
import { assertRefusedWith } from "./adversary-kit.ts";

/** One hostile world with a discovered gap. */
function worldWithGap(): { world: HostileWorldRig; gapRecord: CapabilityGapRecord } {
  const world = createHostileWorld();
  const cycle = world.runHostileCycle({ cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 3 });
  const gapId = cycle.gapIds[0];
  if (gapId === undefined) throw new Error("cross-tenant: no gap discovered");
  const read = world.stack.organization.getCapabilityGap(gapId, world.caller);
  if (!read.ok) throw new Error("cross-tenant: gap read refused");
  return { world, gapRecord: read.gap };
}

/**
 * Walks one world's gap to the user/community rung (the hostile attempted
 * route) and returns the FRESH post-walk record: the Arena intake's rung
 * gate reads the registered record's LIVE trail (intake.ts
 * `arenaRungGateOfSource`), so the source must be re-read through the real
 * `getCapabilityGap` door after the walk — a stale pre-walk snapshot is
 * refused `rung-mismatch` (R18: Arena is only reachable after the
 * user/community rung).
 */
function walkToCommunityRung(world: HostileWorldRig, gapRecord: CapabilityGapRecord): CapabilityGapRecord {
  for (const attempt of [
    { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" },
    { rung: "user-community-contribution", disposition: "attempted", outcome: "unresolved" },
  ] as const) {
    const advanced = world.commandPort.dispatch({
      kind: "advance-gap-rung", tenant: String(world.caller.tenant), subject: String(world.caller.subject),
      gapId: String(gapRecord.gapId), ...attempt,
    });
    if (!advanced.ok) throw new Error(`cross-tenant: walking ${attempt.rung} refused: ${advanced.detail}`);
  }
  const walked = world.stack.organization.getCapabilityGap(String(gapRecord.gapId), world.caller);
  if (!walked.ok) throw new Error(`cross-tenant: gap re-read refused: ${walked.detail}`);
  return walked.gap;
}

test("cross-tenant (R20): the Lab doors refuse the foreign tenant with cross-tenant, verbatim", () => {
  const { world, gapRecord } = worldWithGap();
  const foreign = world.foreignCaller;
  const attempt = { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved" } as const;

  assertRefusedWith(
    world.stack.organization.advanceCapabilityGap({ gapId: String(gapRecord.gapId), attempt, as: foreign }),
    "cross-tenant",
  );
  assertRefusedWith(world.stack.organization.getCapabilityGap(String(gapRecord.gapId), foreign), "cross-tenant");
  assert.equal(world.stack.organization.listCapabilityGaps(foreign).length, 0, "the foreign tenant sees only its own (empty) state");

  // The foreign tenant cannot page the hostile tenant's opened search (the
  // isolation check fires before any cursor validation — a REAL first
  // cursor of a freshly opened hostile search is used).
  const opened = world.stack.organization.openSearch(
    world.searchRequest({ cycleId: String(CYCLE_TWO), seed: SEARCH_SEED_TWO, maxAgents: 2, as: world.caller, now: world.stack.clock.now() }),
  );
  if (!opened.ok) throw new Error("cross-tenant: fresh search refused");
  assertRefusedWith(
    world.stack.organization.nextCandidates({ searchId: opened.searchId, cursor: opened.cursor, as: foreign }),
    "cross-tenant",
  );
  const evidenceRows = world.stack.organization.listEvidence(world.caller);
  const searchId = evidenceRows[0]?.searchId;
  if (searchId === undefined) throw new Error("cross-tenant: no opened search recorded");

  // The foreign tenant cannot evaluate in the hostile tenant's search (the
  // isolation check fires before any suite/evidence resolution).
  const position = evidenceRows[0]?.position ?? 0;
  assertRefusedWith(
    world.stack.organization.evaluateCandidate({
      searchId, position, suite: labFixtureSuite().ref, evidence: world.evidenceBundle,
      parameters: { seed: EVALUATION_SEED, tickBudget: EVALUATION_TICK_BUDGET }, as: foreign,
    }),
    "cross-tenant",
  );

  // The foreign tenant cannot calibrate the hostile tenant's evaluation.
  const evaluationId = evidenceRows[0]?.evaluationId;
  if (evaluationId === undefined) throw new Error("cross-tenant: no evaluation to calibrate");
  assertRefusedWith(
    world.stack.simulation.calibrate({ evaluationId, as: foreign, observedOutcomeIds: [OBSERVATION_ONE] }),
    "cross-tenant",
  );

  // The foreign tenant cannot read the hostile tenant's learning records.
  const recordId = world.stack.learning.listLearningCycles(world.caller)[0]?.recordId;
  if (recordId === undefined) throw new Error("cross-tenant: no learning record");
  assertRefusedWith(world.stack.learning.getLearningCycle(String(recordId), foreign), "cross-tenant");
});

test("cross-tenant (R20): the typed command port refuses the foreign caller with cross-tenant, verbatim", () => {
  const { world, gapRecord } = worldWithGap();
  const refused = world.commandPort.dispatch({
    kind: "advance-gap-rung",
    tenant: String(HOSTILE_FOREIGN_TENANT),
    subject: String(HOSTILE_FOREIGN_SUBJECT),
    gapId: String(gapRecord.gapId),
    rung: "alternate-organization",
    disposition: "attempted",
    outcome: "unresolved",
  });
  assertRefusedWith(refused, "cross-tenant");
  // The refusal was a pure no-op: the hostile tenant's gap trail is untouched.
  const read = world.stack.organization.getCapabilityGap(String(gapRecord.gapId), world.caller);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.gap.attempts.length, gapRecord.attempts.length, "no hidden mutation on the refused cross-tenant move");
});

test("cross-tenant (R20 positive control): the foreign tenant runs its OWN search cleanly (isolation, not lockout)", () => {
  const world = createHostileWorld();
  const opened = world.stack.organization.openSearch(
    world.searchRequest({ cycleId: "qa-e2e-cycle-foreign", seed: SEARCH_SEED_TWO, maxAgents: 2, as: world.foreignCaller, now: world.stack.clock.now() }),
  );
  assert.equal(opened.ok, true, "the foreign tenant's own search opens");
  const stream = world.pageStream(opened.searchId, opened.cursor, world.foreignCaller);
  assert.ok(stream.length >= 1, "the foreign tenant pages its own candidate stream");
  assert.equal(world.stack.organization.listCapabilityGaps(world.foreignCaller).length, 0, "tenancy isolation is per-tenant state, not a global lockout");
});

test("cross-tenant (R20): the Arena runtime doors refuse the foreign tenant with cross-tenant, verbatim", async () => {
  const { world, gapRecord } = worldWithGap();
  const walked = walkToCommunityRung(world, gapRecord);
  const arena = createHostileArena();
  const registered = arena.registerGapSource(walked);
  const command = arena.decidedCommand({ requestPayload: hostileAskDigestOf(walked), sourceKey: registered.sourceKey });
  const opened = arena.service.openEscalationCase(arena.caller, command);
  assert.equal(opened.ok, true, `the honest decided escalation over the WALKED gap opens: ${opened.ok ? "" : `${opened.code} — ${opened.detail}`}`);
  const caseId = opened.ok ? String(opened.case.caseId) : "";

  assertRefusedWith(arena.service.getCase(arena.foreignCaller, caseId), "cross-tenant");
  assertRefusedWith(await arena.service.driveCase(arena.foreignCaller, caseId), "cross-tenant");
  assertRefusedWith(arena.service.labeledEvidence(arena.foreignCaller, caseId), "cross-tenant");
});

test("cross-tenant (R20): a MOVED contributor submitting into the hostile tenant is refused cross-tenant-contributor (verbatim)", () => {
  const { world, gapRecord } = worldWithGap();
  const walked = walkToCommunityRung(world, gapRecord);
  const community = createHostileCommunity(world.stack, world.caller);
  const refusal = community.submitArenaOutcome({
    outcome: { caseId: "arena-case-x", escalationId: "arena-esc-x", requestDigest: "ab".repeat(32), lifecycleState: "ingested", evidenceVerdict: "admitted" },
    gapRecord: walked,
    contributor: HOSTILE_MOVED_SUBJECT,
  });
  assert.equal(refusal.accepted, false, "the moved contributor's submission was refused");
  if (!refusal.accepted) {
    assert.equal(refusal.code, "cross-tenant-contributor", "R20: the authoritative code, verbatim");
    assert.ok(refusal.detail.includes(String(HOSTILE_FOREIGN_TENANT)), "the refusal names the contributor's owning tenant");
    assert.ok(refusal.detail.length > 0);
  }
});

test("cross-tenant (R20): a foreign actor cannot command the hostile tenant's workflow (cross-tenant-actor, verbatim)", () => {
  const { world, gapRecord } = worldWithGap();
  const walked = walkToCommunityRung(world, gapRecord);
  const community = createHostileCommunity(world.stack, world.caller);
  const submitted = community.submitArenaOutcome({
    outcome: { caseId: "arena-case-y", escalationId: "arena-esc-y", requestDigest: "cd".repeat(32), lifecycleState: "ingested", evidenceVerdict: "admitted" },
    gapRecord: walked,
  });
  assert.equal(submitted.accepted, true, `the hostile tenant's own submission is admitted: ${submitted.accepted ? "" : submitted.code}`);
  const contributionId = submitted.accepted ? String(submitted.contribution.contributionId) : "";

  // A MOVED actor (hostile-tenant membership, foreign-tenant ownership)
  // commands the hostile tenant's workflow: the record is known, the
  // ACTOR's owning tenancy is not.
  const foreignActor = community.advance({ contributionId, command: "triage", actor: HOSTILE_MOVED_SUBJECT, reason: "foreign takeover" });
  assert.equal(foreignActor.accepted, false);
  if (!foreignActor.accepted) assert.equal(foreignActor.code, "cross-tenant-actor", "R20: the authoritative code, verbatim");
  // A hostile-tenant maintainer commands the workflow under the FOREIGN
  // tenant's scope: the record lookup itself is tenant-scoped.
  const misfiled = community.advance({ contributionId, command: "triage", actor: HOSTILE_MAINTAINER, tenant: HOSTILE_FOREIGN_TENANT, reason: "misfiled scope" });
  assert.equal(misfiled.accepted, false);
  if (!misfiled.accepted) assert.equal(misfiled.code, "unknown-contribution", "the tenant-scoped record lookup refuses the misfiled scope");
  // Neither refused attempt mutated the workflow: the contribution is still submitted.
  const record = community.service.contribution(world.caller.tenant, asContributionId(contributionId)!);
  assert.equal(record?.status, "submitted", "the refused cross-tenant commands left the workflow untouched");
});
