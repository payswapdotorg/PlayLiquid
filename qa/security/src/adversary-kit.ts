/**
 * THE ADVERSARY KIT (PL-041 qa) — shared assertion helpers for the
 * negative suite: every refusal must carry its TYPED code VERBATIM (E8)
 * and, wherever the door is an adjudication door, its refusal-ledger
 * record with that exact code (E10).
 */

import assert from "node:assert/strict";
import type { RefusalRecord, RightsRequest, SecurityRig } from "../../../packages/security-gameos/src/index.ts";

/**
 * Asserts the tenant's refusal ledger holds a record with EXACTLY
 * `code` for `subject`, and returns it (for further evidence checks).
 */
export function assertRefusalLedgered(
  rig: SecurityRig,
  tenant: string,
  subject: string,
  code: string,
): RefusalRecord {
  const ledger = rig.authority.ledger(rig.auditor, tenant);
  assert.ok(ledger.ok, `ledger read refused: ${ledger.ok ? "" : ledger.code}`);
  const record = ledger.records.find(
    (item) => item.tenant === tenant && item.subject === subject && item.code === code,
  );
  assert.ok(
    record !== undefined,
    `no ledgered refusal ${code} for ${subject} in ${tenant} (codes: ${ledger.records.map((item) => item.code).join(", ")})`,
  );
  assert.equal(record.code, code);
  assert.ok(record.refusalId.startsWith("refusal-"));
  return record;
}

/** One decide request against the rig's authority (the hostile move). */
export function decideOf(rig: SecurityRig, request: RightsRequest) {
  return rig.authority.decide(request);
}
