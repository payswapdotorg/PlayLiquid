/**
 * Admission binding tests: the kernel-derived facts and the pure
 * adjudication wrapper around platform-contracts' `decideAdmission`
 * (R20 tenant isolation, capacity, invite lists, kernel-level guards).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjudicateParticipantAdmission,
  bridgeMatchSessionId,
  deriveAdmissionFacts,
} from "./admission.ts";
import { asSessionId } from "@playliquid/runtime-contracts";
import { asMatchSessionId, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { SessionAdmissionRequest } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const otherTenant = asTenantId("tenant-beta")!;
const subject = asSubjectId("player-one")!;
const session = asSessionId("session-royale-1");
const matchSession = asMatchSessionId("session-royale-1")!;

function facts(over: Record<string, unknown> = {}) {
  return deriveAdmissionFacts({
    session,
    tenant,
    capacity: 2,
    enrolled: 0,
    admission: "open",
    invitedSubjects: [],
    ...over,
  })!;
}

function request(over: Record<string, unknown> = {}): SessionAdmissionRequest {
  return { tenant, session: matchSession, subject, ...over } as SessionAdmissionRequest;
}

test("bridge: runtime SessionId bridges into the platform MatchSessionId space", () => {
  assert.equal(String(bridgeMatchSessionId(session)), "session-royale-1");
  assert.equal(bridgeMatchSessionId(asSessionId("session royale")), undefined, "invalid id text does not bridge");
});

test("facts: derived from kernel-owned state, never from client input", () => {
  const derived = facts({ enrolled: 1, admission: "invite", invitedSubjects: [subject] });
  assert.deepEqual(derived, {
    session: matchSession,
    tenant,
    capacity: 2,
    enrolled: 1,
    admission: "invite",
    invitedSubjects: [subject],
  });
});

test("adjudication: open admission lets a same-tenant subject in", () => {
  const result = adjudicateParticipantAdmission(request(), facts(), true, () => false);
  assert.deepEqual(result, { admitted: true, subject });
});

test("adjudication: cross-tenant requests are refused, never redirected (R20)", () => {
  const result = adjudicateParticipantAdmission(
    request({ tenant: otherTenant }),
    facts(),
    true,
    () => false,
  );
  assert.ok(!result.admitted);
  assert.equal(result.code, "tenant-mismatch");
});

test("adjudication: full sessions refuse the next subject", () => {
  const result = adjudicateParticipantAdmission(request(), facts({ enrolled: 2 }), true, () => false);
  assert.ok(!result.admitted);
  assert.equal(result.code, "session-full");
});

test("adjudication: invite-only sessions refuse uninvited subjects", () => {
  const invited = asSubjectId("player-two")!;
  const result = adjudicateParticipantAdmission(
    request(),
    facts({ admission: "invite", invitedSubjects: [invited] }),
    true,
    () => false,
  );
  assert.ok(!result.admitted);
  assert.equal(result.code, "not-invited");
});

test("adjudication: inactive sessions refuse everyone", () => {
  const result = adjudicateParticipantAdmission(request(), facts(), false, () => false);
  assert.ok(!result.admitted);
  assert.equal(result.code, "session-inactive");
});

test("adjudication: a request naming another session is refused", () => {
  const elsewhere = asMatchSessionId("session-elsewhere-9")!;
  const result = adjudicateParticipantAdmission(
    request({ session: elsewhere }),
    facts(),
    true,
    () => false,
  );
  assert.ok(!result.admitted);
  assert.equal(result.code, "session-mismatch");
});

test("adjudication: duplicate enrollment is a protocol misuse, not a no-op", () => {
  const result = adjudicateParticipantAdmission(request(), facts(), true, (s) => s === subject);
  assert.ok(!result.admitted);
  assert.equal(result.code, "already-enrolled");
});

test("adjudication: malformed facts (unbridgeable session id) fail closed", () => {
  const result = adjudicateParticipantAdmission(request(), undefined, true, () => false);
  assert.ok(!result.admitted);
  assert.equal(result.code, "malformed-facts");
});
