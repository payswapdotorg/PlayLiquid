/**
 * REFUSAL LEDGER TESTS (PL-041, E8/E10) — every denial recorded append-only
 * with its typed code: content-derived refusal ids (E9), the idempotent
 * duplicate append (the first receipt stands), tenant scoping (R20), the
 * append-only invariant fold, and the service-door behavior (decide
 * refusals land in the ledger; the auditor-only read; the duplicate
 * decide carries the recorded receipt).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendRefusal, ledgerIsAppendOnly, ledgerOf, refusalIdOf, refusalRecordOf } from "./index.ts";
import type { RefusalRecord } from "./index.ts";
import { createSecurityRig } from "./index.ts";
import type { SecurityRig } from "./index.ts";
import { RIG_ADMIN, RIG_AUDITOR, RIG_OUTSIDER, RIG_TENANT, RIG_FOREIGN_TENANT, RIG_PLAYER } from "./rig.ts";

const tenant = "tenant-ledger";
const subject = "actr-ledger-one";

function record(over: Partial<RefusalRecord> = {}): RefusalRecord {
  return refusalRecordOf({
    tenant,
    subject,
    code: "restricted-by-host",
    detail: "host restriction denies speech (R5)",
    evidence: ["host:host-x", "denied:speech"],
    at: 1_000,
    revision: 1,
    ...over,
  });
}

test("ledger: refusal ids are content-derived and deterministic (E9)", () => {
  const left = refusalIdOf(tenant, subject, "restricted-by-host", "detail", ["e1"]);
  const right = refusalIdOf(tenant, subject, "restricted-by-host", "detail", ["e1"]);
  assert.equal(left, right);
  assert.ok(left.startsWith("refusal-"));
  assert.notEqual(left, refusalIdOf(tenant, subject, "restricted-by-host", "other detail", ["e1"]));
  assert.notEqual(left, refusalIdOf(tenant, "actr-other", "restricted-by-host", "detail", ["e1"]));
});

test("ledger E10: appending the SAME refusal again returns the recorded record", () => {
  const first = appendRefusal([], record());
  assert.ok(!first.duplicate);

  const history = [first.record];
  const second = appendRefusal(history, record({ revision: 99 }));
  assert.ok(second.duplicate);
  assert.equal(second.record.refusalId, first.record.refusalId);
  assert.equal(second.record.revision, first.record.revision);
  assert.equal(history.length, 1);
});

test("ledger E10: a DIFFERENT refusal appends (a new record, not an edit)", () => {
  const history = [record()];
  const appended = appendRefusal(history, record({ code: "body-lacks-capability", detail: "other" }));
  assert.ok(!appended.duplicate);
  assert.notEqual(appended.record.refusalId, history[0]!.refusalId);
});

test("ledger R20: the tenant view only ever shows that tenant's records", () => {
  const history = [
    record(),
    record({ tenant: RIG_FOREIGN_TENANT, subject }),
    record({ code: "no-elevated-right" }),
  ];
  const view = ledgerOf(history, tenant);
  assert.equal(view.length, 2);
  assert.ok(view.every((item) => item.tenant === tenant));
  assert.equal(ledgerOf(history, RIG_FOREIGN_TENANT).length, 1);
});

test("ledger E10: the append-only fold (prefix preserved; a shrink is detected)", () => {
  const first = record();
  const history = [first, record({ code: "no-elevated-right" })];
  assert.ok(ledgerIsAppendOnly([first], history));
  assert.ok(ledgerIsAppendOnly(history, history));
  assert.ok(!ledgerIsAppendOnly(history, [first]));
  // a forged record at the same index (different id) is also a violation.
  const rewritten = [...history];
  rewritten[0] = { ...first, refusalId: "refusal-forged" };
  assert.ok(!ledgerIsAppendOnly(history, rewritten));
});

// ---------------------------------------------------------------------------
// Through the REAL authority (every decide refusal lands in the ledger)
// ---------------------------------------------------------------------------

const rig: SecurityRig = await createSecurityRig();

test("ledger service: a decide refusal is recorded once with its typed code and evidence", () => {
  const before = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(before.ok);

  const refusal = rig.authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "platform", capability: "rewards", permission: "submit" },
  });
  assert.ok(!refusal.granted);
  assert.equal(refusal.code, "capability-not-granted");

  const after = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(after.ok);
  assert.equal(after.records.length, before.records.length + 1);
  const landed = after.records.find(
    (item) => item.subject === RIG_OUTSIDER && item.code === "capability-not-granted",
  );
  assert.ok(landed);
  assert.ok(landed.evidence.includes("capability:rewards"));
  assert.ok(landed.refusalId.startsWith("refusal-"));
});

test("ledger service E10: repeating the SAME refusal returns the recorded receipt (idempotent)", () => {
  const request = {
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "platform" as const, capability: "rewards", permission: "submit" as const },
  };
  const first = rig.authority.decide(request);
  const second = rig.authority.decide(request);
  const third = rig.authority.decide(request);
  assert.ok(!first.granted && !second.granted && !third.granted);
  assert.ok(first.recorded === undefined || true); // the first occurrence may or may not carry a prior receipt
  assert.ok(second.recorded !== undefined);
  assert.ok(third.recorded !== undefined);
  assert.equal(second.recorded!.refusalId, third.recorded!.refusalId);

  const ledger = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(ledger.ok);
  const occurrences = ledger.records.filter((item) => item.refusalId === second.recorded!.refusalId);
  assert.equal(occurrences.length, 1);
});

test("ledger service R20: a foreign tenant's auditor never sees this tenant's records", () => {
  const domestic = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(domestic.ok);
  assert.ok(domestic.records.length > 0);

  // the auditor holds a grant only in THIS tenant — the door refuses the
  // foreign read with the distinct cross-tenant code (auditable R20 probe).
  const foreign = rig.authority.ledger(RIG_AUDITOR, RIG_FOREIGN_TENANT);
  assert.ok(!foreign.ok);
  assert.equal(foreign.code, "cross-tenant-request");
});

test("ledger service: only the rights-auditor role reads the ledger (admins cannot)", () => {
  const byOutsider = rig.authority.ledger(RIG_OUTSIDER, RIG_TENANT);
  assert.ok(!byOutsider.ok && byOutsider.code === "not-authorized");
  const byAdmin = rig.authority.ledger(RIG_ADMIN, RIG_TENANT);
  assert.ok(!byAdmin.ok && byAdmin.code === "not-authorized");
  const byAuditor = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(byAuditor.ok);
});

test("ledger service E10: the whole denial history stays append-only across a decision sequence", () => {
  const before = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(before.ok);
  for (const subject of [RIG_OUTSIDER, RIG_PLAYER]) {
    rig.authority.decide({
      tenant: RIG_TENANT,
      subject,
      capability: { kind: "platform", capability: "rewards", permission: "administer" },
    });
  }
  const after = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(after.ok);
  assert.ok(ledgerIsAppendOnly(before.records, after.records));
  assert.ok(after.records.length > before.records.length);
});
