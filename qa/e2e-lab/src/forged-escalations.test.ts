/**
 * FORGED ESCALATIONS (PL-040 qa/e2e-lab negative class) — the Arena intake
 * oracle + the persisted-document tamper oracle attacked with hostile moves:
 * - structurally malformed decided commands (`invalid-command`);
 * - a decision with NO coherent digest (`undecided-escalation` — the runtime
 *   never auto-escalates, R18);
 * - a decision whose declared digest does not match its content
 *   (`tampered-decision-digest`, E8);
 * - an unregistered source citation (`unknown-source`) — including the
 *   tenancy form: the FOREIGN tenant replaying the host's exact decided
 *   command (the registry is structurally tenant-scoped);
 * - forged escalation SOURCES at registration (`invalid-source`): a
 *   hand-crafted gap record claiming Arena as the FIRST rung (the
 *   lab-contracts `arena-first-resort` violation surfaces verbatim in the
 *   detail), a structurally invalid record, and a bogus rung-classified
 *   summary;
 * - the ladder-skip attempt at the Arena level: escalating a gap whose
 *   trail never reached the user/community rung (`rung-mismatch`, R18);
 * - tampered PERSISTED documents (`tampered-document`): a flipped state
 *   digest, a forged case identity inside a recomputed document, a tampered
 *   source digest, and a structurally broken send receipt — every one
 *   refused typed (E8), plus the honest restore that still works.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaAuthorizationScopeKey } from "../../../packages/arena-integration/src/index.ts";
import { arenaDecisionDigestOf, arenaDocumentDigestOf } from "../../../packages/arena-integration-runtime/src/index.ts";
import type { ArenaEscalationCommand, ArenaRuntimeDocument } from "../../../packages/arena-integration-runtime/src/index.ts";
import { asArenaEscalationId, asGapRecordId, asTimestampMs } from "../../../packages/lab-contracts/src/index.ts";
import type { CapabilityGapRecord, ContentDigest, GapRungAttempt, LabCycleId } from "../../../packages/lab-contracts/src/index.ts";
import type { GapLadderSummary } from "../../../packages/lab-learning/src/index.ts";
import { createHostileArena, hostileAskDigestOf } from "./hostile-arena.ts";
import type { HostileArenaRig } from "./hostile-arena.ts";
import { createHostileCommunity } from "./hostile-community.ts";
import { createHostileWorld } from "./hostile-rig.ts";
import type { HostileWorldRig } from "./hostile-rig.ts";
import { CYCLE_ONE, HOSTILE_FOREIGN_TENANT, SEARCH_SEED_ONE } from "./ids.ts";
import { assertRefusedWith } from "./adversary-kit.ts";

/** One hostile world with a discovered gap (trail still at the existing organization). */
function worldWithFreshGap(): { world: HostileWorldRig; gapRecord: CapabilityGapRecord } {
  const world = createHostileWorld();
  const cycle = world.runHostileCycle({ cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 3 });
  const gapId = cycle.gapIds[0];
  if (gapId === undefined) throw new Error("forged: no gap discovered");
  const read = world.stack.organization.getCapabilityGap(gapId, world.caller);
  if (!read.ok) throw new Error("forged: gap read refused");
  return { world, gapRecord: read.gap };
}

/** One hostile world with its gap walked to the user/community rung. */
function worldWithWalkedGap(): { world: HostileWorldRig; gapRecord: CapabilityGapRecord } {
  const { world, gapRecord } = worldWithFreshGap();
  for (const attempt of [
    { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" },
    { rung: "user-community-contribution", disposition: "attempted", outcome: "unresolved" },
  ] as const) {
    const advanced = world.commandPort.dispatch({
      kind: "advance-gap-rung", tenant: String(world.caller.tenant), subject: String(world.caller.subject),
      gapId: String(gapRecord.gapId), ...attempt,
    });
    if (!advanced.ok) throw new Error(`forged: walking ${attempt.rung} refused: ${advanced.detail}`);
  }
  const read = world.stack.organization.getCapabilityGap(String(gapRecord.gapId), world.caller);
  if (!read.ok) throw new Error("forged: gap re-read refused");
  return { world, gapRecord: read.gap };
}

/** One decided + ingested Arena case over a walked gap (the attack surface). */
async function ingestedCase(): Promise<{ arena: HostileArenaRig; command: ArenaEscalationCommand; caseId: string }> {
  const { gapRecord } = worldWithWalkedGap();
  const arena = createHostileArena();
  const registered = arena.registerGapSource(gapRecord);
  const command = arena.decidedCommand({ requestPayload: hostileAskDigestOf(gapRecord), sourceKey: registered.sourceKey });
  const opened = arena.service.openEscalationCase(arena.caller, command);
  if (!opened.ok) throw new Error(`forged: case refused: ${opened.detail}`);
  const driven = await arena.service.driveCase(arena.caller, String(opened.case.caseId));
  if (!driven.ok || driven.outcome.status !== "ingested") throw new Error("forged: drive did not ingest");
  return { arena, command, caseId: String(opened.case.caseId) };
}

test("forged escalations: a structurally malformed command is refused invalid-command (verbatim)", async () => {
  const { gapRecord } = worldWithWalkedGap();
  const arena = createHostileArena();
  const registered = arena.registerGapSource(gapRecord);
  const valid = arena.decidedCommand({ requestPayload: hostileAskDigestOf(gapRecord), sourceKey: registered.sourceKey });
  const bogusPayload = { ...valid, requestPayload: "deadbeef" as ContentDigest };
  assertRefusedWith(arena.service.openEscalationCase(arena.caller, bogusPayload), "invalid-command");
  const bogusDecider = { ...valid, decidedBy: "NOT A SUBJECT" as never };
  assertRefusedWith(arena.service.openEscalationCase(arena.caller, bogusDecider), "invalid-command");
});

test("forged escalations: a decision without a coherent digest is refused undecided-escalation (the runtime never auto-escalates)", async () => {
  const { gapRecord } = worldWithWalkedGap();
  const arena = createHostileArena();
  const registered = arena.registerGapSource(gapRecord);
  const valid = arena.decidedCommand({ requestPayload: hostileAskDigestOf(gapRecord), sourceKey: registered.sourceKey });
  const undecidable = { ...valid, decisionDigest: "not-a-digest" as ContentDigest };
  assertRefusedWith(arena.service.openEscalationCase(arena.caller, undecidable), "undecided-escalation");
});

test("forged escalations: a decision whose digest does not match its content is refused tampered-decision-digest (E8)", async () => {
  const { gapRecord } = worldWithWalkedGap();
  const arena = createHostileArena();
  const registered = arena.registerGapSource(gapRecord);
  const valid = arena.decidedCommand({ requestPayload: hostileAskDigestOf(gapRecord), sourceKey: registered.sourceKey });
  // The attacker re-times the decision but keeps the original digest.
  const retimed = { ...valid, decidedAt: asTimestampMs(999_999)! };
  assertRefusedWith(arena.service.openEscalationCase(arena.caller, retimed), "tampered-decision-digest");
  // ...and swaps the ask while keeping the digest pinned to the old ask.
  const reasked = { ...valid, requestPayload: "ab".repeat(32) as ContentDigest };
  assertRefusedWith(arena.service.openEscalationCase(arena.caller, reasked), "tampered-decision-digest");
  // Neither forged attempt opened anything: the honest command still opens ONE case.
  const opened = arena.service.openEscalationCase(arena.caller, valid);
  assert.equal(opened.ok, true);
  if (opened.ok) assert.equal(opened.duplicate, false, "no forged attempt leaked a case into the registry");
});

test("forged escalations: citing an unregistered source is refused unknown-source (verbatim)", async () => {
  const { gapRecord } = worldWithWalkedGap();
  const arena = createHostileArena();
  const registered = arena.registerGapSource(gapRecord);
  const valid = arena.decidedCommand({ requestPayload: hostileAskDigestOf(gapRecord), sourceKey: registered.sourceKey });
  // A mutated source key: still valid key TEXT, never registered.
  const forgedKey = `${registered.sourceKey.slice(0, -2)}xy`;
  const citing = arena.decidedCommand({ requestPayload: hostileAskDigestOf(gapRecord), sourceKey: forgedKey });
  const refused = assertRefusedWith(arena.service.openEscalationCase(arena.caller, citing), "unknown-source");
  assert.ok(refused.detail.includes(forgedKey), "the refusal echoes the forged citation");
  // The VALID command over the REAL source key still opens exactly one case.
  const opened = arena.service.openEscalationCase(arena.caller, valid);
  assert.equal(opened.ok, true);
});

test("forged escalations (R20): the foreign tenant replaying the host's decided command is refused unknown-source", async () => {
  const { gapRecord } = worldWithWalkedGap();
  const arena = createHostileArena();
  const registered = arena.registerGapSource(gapRecord);
  const hostCommand = arena.decidedCommand({ requestPayload: hostileAskDigestOf(gapRecord), sourceKey: registered.sourceKey });
  // The attacker re-derives the decision digest over the FOREIGN tenant —
  // the decision itself is coherent, but the registry is tenant-scoped: the
  // foreign caller's view holds no such source (the structural tenancy note).
  const foreignCommand: ArenaEscalationCommand = {
    ...hostCommand,
    decisionDigest: arenaDecisionDigestOf({
      tenant: String(HOSTILE_FOREIGN_TENANT),
      decidedBy: String(hostCommand.decidedBy),
      decidedAt: hostCommand.decidedAt,
      sourceKey: String(hostCommand.sourceKey),
      requestKind: hostCommand.requestKind,
      requestPayload: String(hostCommand.requestPayload),
      endpointDigest: String(hostCommand.endpoint.endpointDigest),
      authorizationKey: arenaAuthorizationScopeKey(hostCommand.authorization),
    }),
  };
  assertRefusedWith(arena.service.openEscalationCase(arena.foreignCaller, foreignCommand), "unknown-source");
});

test("forged escalations: escalating a gap that never reached the community rung is refused rung-mismatch (R18)", async () => {
  const { gapRecord } = worldWithFreshGap();
  const arena = createHostileArena();
  // The FRESH gap: its trail holds only the existing-organization attempt.
  const registered = arena.registerGapSource(gapRecord);
  const command = arena.decidedCommand({ requestPayload: hostileAskDigestOf(gapRecord), sourceKey: registered.sourceKey });
  const refused = assertRefusedWith(arena.service.openEscalationCase(arena.caller, command), "rung-mismatch");
  assert.ok(refused.detail.includes("Arena is only reachable after the user/community rung"), "the refusal states the R18 order");
});

test("forged escalation sources: a record claiming Arena as the FIRST rung is refused invalid-source with the lab-contracts violation verbatim", () => {
  const arena = createHostileArena();
  const forgedFirstRung: CapabilityGapRecord = {
    gapId: asGapRecordId("gap-qa-forged-arena-first")!,
    cycleId: CYCLE_ONE as LabCycleId,
    missingCapability: "lab-cap-qa-netcode",
    summary: "forged record: the attacker claims Arena was tried first",
    openedAt: asTimestampMs(1_000)!,
    attempts: [
      {
        rung: "arena-escalation",
        disposition: "attempted",
        outcome: "unresolved",
        external: {
          external: "arena-external",
          escalationId: asArenaEscalationId("arena-esc-forged-first")!,
          requestDigest: "ab".repeat(32) as ContentDigest,
        },
      },
    ],
  };
  const refused = assertRefusedWith(
    arena.service.registerSource(arena.caller, { kind: "gap-record", record: forgedFirstRung }),
    "invalid-source",
  );
  assert.ok(
    refused.detail.includes("arena-first-resort"),
    "the lab-contracts violation code surfaces verbatim in the refusal detail",
  );
});

test("forged escalation sources: a structurally invalid gap record is refused invalid-source", () => {
  const arena = createHostileArena();
  const broken = {
    gapId: "NOT-A-VALID-GAP-ID",
    cycleId: CYCLE_ONE as LabCycleId,
    missingCapability: "lab-cap-qa-netcode",
    summary: "forged record: structurally broken ids",
    openedAt: asTimestampMs(1_000)!,
    attempts: [],
  } as unknown as CapabilityGapRecord;
  const refused = assertRefusedWith(arena.service.registerSource(arena.caller, { kind: "gap-record", record: broken }), "invalid-source");
  // The intake oracle gates on lab-contracts' own `isCapabilityGapRecord`
  // BEFORE it runs `validateGapRecord` (intake.ts), and that structural guard
  // itself checks both id parses — so an unparsable id surfaces as the
  // guard's own verbatim message, never as the `invalid-gap-ids` violation
  // (that code is unreachable through this door: any record passing the
  // structural guard has parseable ids by construction).
  assert.ok(
    refused.detail.includes("the gap record is not structurally a CapabilityGapRecord"),
    "the lab-contracts structural guard message surfaces verbatim",
  );
});

test("forged escalation sources: a structurally bogus rung-classified summary is refused invalid-source", () => {
  const arena = createHostileArena();
  // The hostile summary claims `blocked` with NO reached rungs and zero
  // recurrence — every invariant of the rung-classified fold is violated.
  const bogusSummary = {
    missingCapability: "lab-cap-qa-netcode",
    currentRung: "blocked",
    reachedRungs: [],
    rungAttemptCounts: [],
    recurrenceCount: 0,
    gapIds: [],
    cycleIds: [],
    resolved: false,
    blocked: true,
    recurring: false,
  } as GapLadderSummary;
  const refused = assertRefusedWith(
    arena.service.registerSource(arena.caller, { kind: "gap-summary", summary: bogusSummary }),
    "invalid-source",
  );
  assert.ok(refused.detail.includes("gap summary"), "the refusal names the failed structural validation");
});

test("forged case documents: restore refuses a persisted document whose state digest no longer matches (E8)", async () => {
  const { arena } = await ingestedCase();
  const last = arena.store.snapshots().at(-1);
  if (last === undefined) throw new Error("forged: nothing was persisted");
  arena.store.save({ ...last, stateDigest: "ab".repeat(32) });
  assertRefusedWith(arena.service.restore(), "tampered-document");
});

test("forged case documents: restore refuses a forged case identity inside a recomputed document (E8)", async () => {
  const { arena } = await ingestedCase();
  const last = arena.store.snapshots().at(-1);
  if (last === undefined || last.cases.length === 0) throw new Error("forged: no persisted case");
  const forged = { ...last.cases[0]!, caseDigest: "cd".repeat(32) as never };
  const tampered = recomputedAround(last, { cases: [forged, ...last.cases.slice(1)] });
  arena.store.save(tampered);
  const refused = assertRefusedWith(arena.service.restore(), "tampered-document");
  assert.ok(refused.detail.includes("no longer matches its content-addressed identity"), "the CASE identity check caught the forgery");
});

test("forged case documents: restore refuses a tampered source digest inside a recomputed document (E8)", async () => {
  const { arena } = await ingestedCase();
  const last = arena.store.snapshots().at(-1);
  if (last === undefined || last.sources.length === 0) throw new Error("forged: no persisted source");
  const tamperedSource = { ...last.sources[0]!, sourceDigest: "ef".repeat(32) as never };
  const tampered = recomputedAround(last, { sources: [tamperedSource, ...last.sources.slice(1)] });
  arena.store.save(tampered);
  const refused = assertRefusedWith(arena.service.restore(), "tampered-document");
  assert.ok(refused.detail.includes("registered source"), "the SOURCE identity check caught the forgery");
});

test("forged case documents: restore refuses a structurally broken send receipt inside a recomputed document (E8)", async () => {
  const { arena } = await ingestedCase();
  const last = arena.store.snapshots().at(-1);
  if (last === undefined || last.sendLedger.length === 0) throw new Error("forged: no persisted send receipt");
  const brokenReceipt = { ...last.sendLedger[0]!, requestKind: "not-a-request-kind" as never };
  const tampered = recomputedAround(last, { sendLedger: [brokenReceipt, ...last.sendLedger.slice(1)] });
  arena.store.save(tampered);
  const refused = assertRefusedWith(arena.service.restore(), "tampered-document");
  assert.ok(refused.detail.includes("send receipt failed structural validation"), "the SEND-RECEIPT check caught the forgery");
});

test("forged case documents: the honest walked document still restores (the tamper refusals above never adopted anything)", async () => {
  const { arena, caseId } = await ingestedCase();
  const restored = arena.service.restore();
  assert.equal(restored.ok, true);
  if (restored.ok) {
    assert.equal(restored.cases, 1);
    assert.equal(restored.sources, 1);
  }
  const read = arena.service.getCase(arena.caller, caseId);
  assert.equal(read.ok, true, "the restored case reads back through the door");
});

/** Rebuilds one persisted document around a tampered field, recomputing the top-level state digest. */
function recomputedAround(last: ArenaRuntimeDocument, patch: Partial<ArenaRuntimeDocument>): ArenaRuntimeDocument {
  const tampered = { ...last, ...patch } as ArenaRuntimeDocument;
  return {
    ...tampered,
    stateDigest: String(
      arenaDocumentDigestOf({ sources: tampered.sources, cases: tampered.cases, sendLedger: tampered.sendLedger, auditLog: tampered.auditLog }),
    ),
  };
}

test("forged escalations (E10 replay of the source): re-registering the identical gap record is an idempotent duplicate", async () => {
  const { gapRecord } = worldWithWalkedGap();
  const arena = createHostileArena();
  const first = arena.registerGapSource(gapRecord);
  assert.equal(first.duplicate, false);
  const second = arena.registerGapSource(gapRecord);
  assert.equal(second.duplicate, true, "E10: the identical source re-registration is a duplicate receipt");
  assert.equal(second.sourceKey, first.sourceKey, "the SAME content-addressed source key resumes");
  assert.equal(arena.service.listSources(arena.caller).length, 1, "the registry did not grow (E10)");
});

test("forged escalations: a hostile walk's community phase refuses a FORGED gap record at submission (the seam reads the live ladder)", async () => {
  const { world, gapRecord } = worldWithFreshGap();
  const community = createHostileCommunity(world.stack, world.caller);
  // The attacker forges a gap record that CLAIMS the community rung was
  // reached, and links the contribution to the REAL gap id — but the R18
  // seam reads the LIVE ladder state through lab-organization's door, so
  // the claim is refused (the real trail never left the existing org).
  const forgedTrail: GapRungAttempt[] = [
    { rung: "existing-organization", disposition: "unavailable", outcome: "unresolved" },
    { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" },
    { rung: "user-community-contribution", disposition: "attempted", outcome: "unresolved" },
  ];
  const forgedRecord: CapabilityGapRecord = { ...gapRecord, attempts: forgedTrail };
  const result = community.submitArenaOutcome({
    outcome: { caseId: "arena-case-forged", escalationId: "arena-esc-forged", requestDigest: "ab".repeat(32), lifecycleState: "ingested", evidenceVerdict: "admitted" },
    gapRecord: forgedRecord,
  });
  // The seam resolves the gap id against the LIVE record: the real trail has
  // not reached the community rung, so the submission is refused typed.
  assert.equal(result.accepted, false, "the forged trail did not fool the live seam");
  if (!result.accepted) {
    assert.equal(result.code, "gap-not-at-community-rung", "E8: the community refusal code, verbatim");
    assert.ok(result.detail.length > 0);
  }
});
