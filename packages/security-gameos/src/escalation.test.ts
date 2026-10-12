/**
 * ESCALATION TESTS (PL-041 composing PL-031) — the ingested-case →
 * elevated-review-right mint over the REAL arena runtime: the granted
 * review right (with the case's content-addressed evidence), the
 * unminted/foreign-subject refusals, the duplicate mint (E10), the
 * unknown-case and case-not-ingested gates, and the idempotent
 * duplicate-driven refusals through the ledger (E10).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mintEscalationRight, createSecurityRig } from "./index.ts";
import type { EscalationCaseRead, SecurityRig } from "./index.ts";
import { RIG_ADMIN, RIG_AUDITOR, RIG_OUTSIDER, RIG_REVIEWER, RIG_TENANT, RIG_FOREIGN_TENANT } from "./rig.ts";

const rig: SecurityRig = await createSecurityRig();

test("escalation: the ingested case's minted review right is granted with its evidence pin", () => {
  const result = rig.authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_REVIEWER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(result.granted);
  assert.equal(result.right.capability, "arena-escalated-review");
  assert.ok(result.right.basis.includes(`case:${rig.arenaCaseId}`));
  assert.ok(result.right.basis.some((item) => item.startsWith("evidence:")));
});

test("escalation: a subject the right was never minted for is refused no-elevated-right", () => {
  const result = rig.authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "no-elevated-right");
});

test("escalation: a foreign-tenant subject probing the case is refused cross-tenant-request (R20)", () => {
  const result = rig.authority.decide({
    tenant: RIG_FOREIGN_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "cross-tenant-request");
});

test("escalation E10: minting the same case for the same subject again returns the recorded right", () => {
  const state = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(state.ok);
  const minted = state.state.elevated.find((right) => right.caseId === rig.arenaCaseId);
  assert.ok(minted);

  const again = rig.authority.mintEscalationReviewRight(RIG_ADMIN, RIG_TENANT, RIG_REVIEWER, rig.arenaCaseId);
  assert.ok(again.ok);
  assert.ok(again.duplicate);
  assert.equal(again.right.rightId, minted.rightId);

  const after = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(after.ok);
  assert.equal(after.state.elevated.length, state.state.elevated.length);
});

test("escalation: minting for a SECOND reviewer mints a new right (both hold it)", () => {
  const second = rig.authority.mintEscalationReviewRight(RIG_ADMIN, RIG_TENANT, RIG_OUTSIDER, rig.arenaCaseId);
  assert.ok(second.ok && !second.duplicate);

  const state = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(state.ok);
  const holders = state.state.elevated
    .filter((right) => right.caseId === rig.arenaCaseId)
    .map((right) => right.subject)
    .sort();
  assert.deepEqual(holders, [RIG_OUTSIDER, RIG_REVIEWER].sort());

  const granted = rig.authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(granted.granted);
});

test("escalation: an unknown case mints nothing (unknown-case, verbatim)", () => {
  const result = rig.authority.mintEscalationReviewRight(RIG_ADMIN, RIG_TENANT, RIG_REVIEWER, "case-rig-never");
  assert.ok(!result.ok);
  assert.equal(result.code, "unknown-case");
});

test("escalation: a non-admin cannot mint (not-authorized)", () => {
  const result = rig.authority.mintEscalationReviewRight(RIG_OUTSIDER, RIG_TENANT, RIG_REVIEWER, rig.arenaCaseId);
  assert.ok(!result.ok);
  assert.equal(result.code, "not-authorized");
});

test("escalation pure: a case still in flight mints nothing (case-not-ingested)", () => {
  const read: EscalationCaseRead = {
    ok: true,
    record: {
      caseId: "case-in-flight",
      tenant: RIG_TENANT,
      decidedBy: "arena",
      state: "decided",
      caseDigest: "f".repeat(64),
    },
  };
  const result = mintEscalationRight(RIG_TENANT, RIG_REVIEWER, "case-in-flight", read, [], 1);
  assert.ok(!result.ok);
  assert.equal(result.code, "case-not-ingested");
});

test("escalation pure: a foreign-tenant case read mints nothing (cross-tenant, verbatim)", () => {
  const refused: EscalationCaseRead = { ok: false, code: "cross-tenant" };
  const result = mintEscalationRight(RIG_TENANT, RIG_REVIEWER, "case-x", refused, [], 1);
  assert.ok(!result.ok);
  assert.equal(result.code, "cross-tenant");
});

test("escalation pure: a defensive foreign record mints nothing (cross-tenant)", () => {
  const read: EscalationCaseRead = {
    ok: true,
    record: {
      caseId: "case-foreign",
      tenant: RIG_FOREIGN_TENANT,
      decidedBy: "arena",
      state: "ingested",
      caseDigest: "e".repeat(64),
    },
  };
  const result = mintEscalationRight(RIG_TENANT, RIG_REVIEWER, "case-foreign", read, [], 1);
  assert.ok(!result.ok);
  assert.equal(result.code, "cross-tenant");
});

test("escalation pure: the ingested case mints a content-derived right (E9)", () => {
  const read: EscalationCaseRead = {
    ok: true,
    record: {
      caseId: "case-pure",
      tenant: RIG_TENANT,
      decidedBy: "arena",
      state: "ingested",
      caseDigest: "e".repeat(64),
    },
  };
  const first = mintEscalationRight(RIG_TENANT, RIG_REVIEWER, "case-pure", read, [], 1);
  const second = mintEscalationRight(RIG_TENANT, RIG_REVIEWER, "case-pure", read, [], 9);
  assert.ok(first.ok && second.ok);
  assert.equal(first.right.rightId, second.right.rightId);
  assert.equal(first.right.evidenceDigest, "e".repeat(64));
  assert.notEqual(first.right.mintedAt, second.right.mintedAt);
});

test("escalation E10: the unminted-subject refusals are recorded in the ledger with typed codes", () => {
  const ledger = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(ledger.ok);
  const codes = new Set(ledger.records.map((record) => record.code));
  assert.ok(codes.has("no-elevated-right"));
  // R20: the foreign-tenant probe's record lives under the FOREIGN tenant —
  // it is structurally invisible in this tenant's ledger view.
  const foreignRecorded = ledger.records.some(
    (record) => record.code === "cross-tenant-request" && record.tenant === RIG_FOREIGN_TENANT,
  );
  assert.ok(!foreignRecorded);
});
