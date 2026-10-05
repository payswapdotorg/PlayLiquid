import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  asMatchSessionId,
  asMatchmakingTicketId,
  isMultiplayerServicePolicy,
  isMultiplayerEventBinding,
  isMatchmakingRequest,
  decideAdmission,
  validatePlatformOutcome,
} from "./multiplayer.ts";
import type {
  MultiplayerServicePolicy,
  SessionAdmissionRequest,
  SessionAdmissionFacts,
  PlatformOutcomeRecord,
  ClientPlayResultClaim,
} from "./multiplayer.ts";

const tenant = asTenantId("tenant-alpha")!;
const otherTenant = asTenantId("tenant-beta")!;
const subject = asSubjectId("player-one")!;
const session = asMatchSessionId("session-royale-1")!;
const evidence = asContentDigest("cd".repeat(32))!;
const kind = asGameEventKind("match.completed")!;

test("multiplayer: ids and requests validate", () => {
  assert.ok(asMatchSessionId("session-royale-1"));
  assert.equal(asMatchSessionId("session royale"), undefined);
  assert.ok(asMatchmakingTicketId("ticket-9"));
  assert.ok(isMatchmakingRequest({ tenant, subject, pool: "ranked-2v2", maxWaitMs: 30_000 }));
  assert.equal(isMatchmakingRequest({ tenant, subject, pool: "", maxWaitMs: 30_000 }), false);
  assert.equal(isMatchmakingRequest({ tenant, subject, pool: "ranked", maxWaitMs: -1 }), false);
});

test("multiplayer: competitive peer-to-peer service policy is structurally refused (lock 19)", () => {
  const fine: MultiplayerServicePolicy = {
    topology: "authoritative-server",
    competitiveUse: true,
    admission: "matchmade",
  };
  assert.ok(isMultiplayerServicePolicy(fine));
  assert.ok(isMultiplayerServicePolicy({ topology: "peer-to-peer", competitiveUse: false, admission: "open" }));
  assert.equal(
    isMultiplayerServicePolicy({ topology: "peer-to-peer", competitiveUse: true, admission: "open" }),
    false,
  );
});

test("multiplayer: games classify their events, protected outcomes stay platform-decided (lock 18/19)", () => {
  assert.ok(
    isMultiplayerEventBinding({
      capability: "multiplayer",
      eventKind: kind,
      outcomeClassification: "protected",
    }),
  );
  assert.ok(
    isMultiplayerEventBinding({
      capability: "multiplayer",
      eventKind: asGameEventKind("chat.message")!,
      outcomeClassification: "informational",
    }),
  );
  assert.equal(
    isMultiplayerEventBinding({ capability: "multiplayer", eventKind: kind, outcomeClassification: "cosmetic" }),
    false,
  );
});

test("multiplayer: admission oracle refuses cross-tenant, full and uninvited requests (R20/E8)", () => {
  const request: SessionAdmissionRequest = { tenant, session, subject };
  const facts: SessionAdmissionFacts = {
    session,
    tenant,
    capacity: 2,
    enrolled: 0,
    admission: "open",
    invitedSubjects: [],
  };
  assert.deepEqual(decideAdmission(request, facts), { admitted: true });

  assert.deepEqual(decideAdmission(request, { ...facts, tenant: otherTenant }), {
    admitted: false,
    code: "tenant-mismatch",
  });
  assert.deepEqual(decideAdmission(request, { ...facts, enrolled: 2 }), {
    admitted: false,
    code: "session-full",
  });
  assert.deepEqual(
    decideAdmission(request, { ...facts, admission: "invite", invitedSubjects: [asSubjectId("player-two")!] }),
    { admitted: false, code: "not-invited" },
  );
  assert.deepEqual(decideAdmission(request, { ...facts, capacity: 0 }), {
    admitted: false,
    code: "malformed-facts",
  });
});

test("multiplayer: outcome records need authority, evidence and dense ranks (lock 19/E8)", () => {
  const outcome: PlatformOutcomeRecord = {
    tenant,
    session,
    decidedBy: "platform-authority",
    evidence: [evidence],
    standings: [
      { subject, rank: 1, score: 100, grants: ["score"] },
      { subject: asSubjectId("player-two")!, rank: 2, score: 90, grants: [] },
    ],
  };
  assert.deepEqual(validatePlatformOutcome(outcome), { ok: true, session });

  assert.deepEqual(validatePlatformOutcome({ ...outcome, decidedBy: "client" }), {
    ok: false,
    code: "not-authoritative",
  });
  assert.deepEqual(validatePlatformOutcome({ ...outcome, evidence: [] }), {
    ok: false,
    code: "empty-evidence-chain",
  });
  const gappy = { ...outcome, standings: [{ subject, rank: 2, score: 100, grants: [] }] };
  assert.deepEqual(validatePlatformOutcome(gappy), { ok: false, code: "bad-standing-rank" });
  const zeroRank = { ...outcome, standings: [{ subject, rank: 0, score: 100, grants: [] }] };
  assert.deepEqual(validatePlatformOutcome(zeroRank), { ok: false, code: "bad-standing-rank" });
  assert.deepEqual(validatePlatformOutcome(42), { ok: false, code: "malformed-record" });
});

test("multiplayer: client play-result claims never masquerade as outcomes (E8, compile-time)", () => {
  const claim: ClientPlayResultClaim = {
    session,
    clientClaimedRank: 1,
    clientClaimedRewards: ["gold x9999"],
    untrusted: "untrusted-client-input",
  };
  assert.deepEqual(validatePlatformOutcome(claim), { ok: false, code: "not-authoritative" });
  // @ts-expect-error — the untrusted marker makes a claim non-assignable to PlatformOutcomeRecord
  const laundered: PlatformOutcomeRecord = claim;
  assert.equal(laundered.session, session);
});

test("multiplayer: the platform outcome record is not constructible without the marker (compile-time)", () => {
  // @ts-expect-error — decidedBy must be the platform authority marker literal
  const outcome: PlatformOutcomeRecord = { tenant, session, decidedBy: "the-client", evidence: [], standings: [] };
  assert.equal(outcome.decidedBy, "the-client");
});
