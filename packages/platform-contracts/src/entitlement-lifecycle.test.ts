import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asEntitlementGrantId } from "./entitlements.ts";
import {
  ENTITLEMENT_LIFECYCLE_STATES,
  ENTITLEMENT_LIFECYCLE_TRANSITIONS,
  ENTITLEMENT_REVOCATION_REASONS,
  canTransitionEntitlement,
  isEntitlementLifecycleState,
  isEntitlementRevocationReason,
  lifecycleCommandKeyEquals,
  isEntitlementLifecycleCommand,
  isEntitlementLifecycleRecord,
  openEntitlementLifecycle,
  admitLifecycleCommand,
} from "./entitlement-lifecycle.ts";
import type {
  EntitlementLifecycleCommand,
  EntitlementLifecycleRecord,
  EntitlementLifecycleState,
} from "./entitlement-lifecycle.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const entitlement = asEntitlementGrantId("grant-001")!;
const causeDigest = asContentDigest("ab".repeat(32))!;
const settlementDigest = asContentDigest("cd".repeat(32))!;

function freshRecord(): EntitlementLifecycleRecord {
  return openEntitlementLifecycle({ entitlement, tenant, subject });
}

function hold(attempt = "1", against: EntitlementLifecycleState = "granted"): EntitlementLifecycleCommand {
  return {
    command: "hold",
    key: { entitlement, operation: "hold", attempt },
    entitlement,
    against,
    holdCauseDigest: causeDigest,
  };
}

function settle(attempt = "1", against: EntitlementLifecycleState = "held"): EntitlementLifecycleCommand {
  return {
    command: "settle",
    key: { entitlement, operation: "settle", attempt },
    entitlement,
    against,
    settlementDigest,
  };
}

function revoke(attempt = "1", against: EntitlementLifecycleState = "granted"): EntitlementLifecycleCommand {
  return {
    command: "revoke",
    key: { entitlement, operation: "revoke", attempt },
    entitlement,
    against,
    reason: "integrity-enforcement",
    revocationCauseDigest: causeDigest,
  };
}

test("lifecycle: the transition table is frozen and terminal states are terminal", () => {
  assert.ok(Object.isFrozen(ENTITLEMENT_LIFECYCLE_STATES));
  assert.ok(Object.isFrozen(ENTITLEMENT_LIFECYCLE_TRANSITIONS));
  for (const state of ENTITLEMENT_LIFECYCLE_STATES) {
    assert.ok(Object.isFrozen(ENTITLEMENT_LIFECYCLE_TRANSITIONS[state]));
  }
  assert.ok(Object.isFrozen(ENTITLEMENT_REVOCATION_REASONS));
  assert.deepEqual([...ENTITLEMENT_LIFECYCLE_STATES], ["granted", "held", "settled", "revoked"]);
  // grant -> hold -> settle/revoke, exactly.
  assert.ok(canTransitionEntitlement("granted", "held"));
  assert.ok(canTransitionEntitlement("granted", "settled"));
  assert.ok(canTransitionEntitlement("granted", "revoked"));
  assert.ok(canTransitionEntitlement("held", "settled"));
  assert.ok(canTransitionEntitlement("held", "revoked"));
  // Terminal states and illegal edges (negative paths).
  assert.equal(canTransitionEntitlement("settled", "granted"), false);
  assert.equal(canTransitionEntitlement("settled", "held"), false);
  assert.equal(canTransitionEntitlement("revoked", "granted"), false);
  assert.equal(canTransitionEntitlement("held", "granted"), false);
  assert.equal(canTransitionEntitlement("settled", "settled"), false);
  assert.ok(isEntitlementLifecycleState("held"));
  assert.equal(isEntitlementLifecycleState("paused"), false);
  assert.ok(isEntitlementRevocationReason("expired"));
  assert.equal(isEntitlementRevocationReason("vibes"), false);
});

test("lifecycle: commands validate and keys cohere", () => {
  assert.ok(isEntitlementLifecycleCommand(hold()));
  assert.ok(isEntitlementLifecycleCommand(settle()));
  assert.ok(isEntitlementLifecycleCommand(revoke()));
  // Key must cohere with the command's own fields.
  const incoherent = {
    ...hold(),
    key: { entitlement: asEntitlementGrantId("grant-999")!, operation: "hold", attempt: "1" },
  };
  assert.equal(isEntitlementLifecycleCommand(incoherent), false);
  const wrongOperation = {
    ...hold(),
    key: { entitlement, operation: "settle" as const, attempt: "1" },
  };
  assert.equal(isEntitlementLifecycleCommand(wrongOperation), false);
  assert.equal(isEntitlementLifecycleCommand({ ...hold(), against: "paused" as never }), false);
  assert.equal(isEntitlementLifecycleCommand({ ...hold(), holdCauseDigest: "junk" as never }), false);
  assert.equal(isEntitlementLifecycleCommand({ ...revoke(), reason: "vibes" as never }), false);
  assert.equal(isEntitlementLifecycleCommand({ ...revoke(), revocationCauseDigest: "junk" as never }), false);
  assert.ok(
    lifecycleCommandKeyEquals(
      { entitlement, operation: "hold", attempt: "1" },
      { entitlement, operation: "hold", attempt: "1" },
    ),
  );
  assert.equal(
    lifecycleCommandKeyEquals(
      { entitlement, operation: "hold", attempt: "1" },
      { entitlement, operation: "hold", attempt: "2" },
    ),
    false,
  );
});

test("lifecycle: grant -> hold -> settle applies cleanly (happy path)", () => {
  const opened = freshRecord();
  assert.ok(isEntitlementLifecycleRecord(opened));
  assert.equal(opened.state, "granted");
  assert.deepEqual(opened.history, []);

  const held = admitLifecycleCommand(hold(), opened);
  assert.ok(held.ok);
  if (held.ok) {
    assert.equal(held.record.state, "held");
    assert.equal(held.record.history.length, 1);
    assert.ok(isEntitlementLifecycleRecord(held.record));
  }

  const settled = admitLifecycleCommand(settle(), held.ok ? held.record : opened);
  assert.ok(settled.ok);
  if (settled.ok) {
    assert.equal(settled.record.state, "settled");
    assert.equal(settled.record.history.length, 2);
    assert.equal(settled.record.history[1]?.auditRef, settlementDigest);
    assert.ok(isEntitlementLifecycleRecord(settled.record));
  }
});

test("lifecycle: idempotent replays are refused — the first receipt stands (E6/E8)", () => {
  const held = admitLifecycleCommand(hold(), freshRecord());
  assert.ok(held.ok);
  if (!held.ok) return;
  // Exact replay of the same command (same key) against the new state.
  const replay = admitLifecycleCommand(hold(), held.record);
  assert.deepEqual(replay, { ok: false, code: "duplicate-command" });
  // A retry with a NEW attempt key is not a replay — but re-holding from
  // `held` is an illegal transition, surfaced as such.
  const retry = admitLifecycleCommand(hold("2", "held"), held.record);
  assert.deepEqual(retry, { ok: false, code: "illegal-transition" });
});

test("lifecycle: stale commands are refused (stale-result rule, E6)", () => {
  const held = admitLifecycleCommand(hold(), freshRecord());
  assert.ok(held.ok);
  if (!held.ok) return;
  // A settle command issued against `granted` while the record is `held`.
  const stale = admitLifecycleCommand(settle("1", "granted"), held.record);
  assert.deepEqual(stale, { ok: false, code: "stale-command" });
});

test("lifecycle: illegal transitions and mismatches are refused (E8)", () => {
  // Settle directly from granted is legal; revoke from granted is legal.
  assert.ok(admitLifecycleCommand(settle("1", "granted"), freshRecord()).ok);
  const revoked = admitLifecycleCommand(revoke(), freshRecord());
  assert.ok(revoked.ok);
  if (revoked.ok) {
    assert.equal(revoked.record.state, "revoked");
    // Terminal: nothing applies to a revoked entitlement anymore.
    assert.deepEqual(admitLifecycleCommand(revoke("2", "revoked"), revoked.record), {
      ok: false,
      code: "illegal-transition",
    });
    assert.deepEqual(admitLifecycleCommand(settle("2", "revoked"), revoked.record), {
      ok: false,
      code: "illegal-transition",
    });
  }
  // A structurally valid command addressing ANOTHER entitlement is
  // refused (its key coheres with its own entitlement, not this record's).
  const otherEntitlement = asEntitlementGrantId("grant-999")!;
  const foreign: EntitlementLifecycleCommand = {
    command: "hold",
    key: { entitlement: otherEntitlement, operation: "hold", attempt: "1" },
    entitlement: otherEntitlement,
    against: "granted",
    holdCauseDigest: causeDigest,
  };
  assert.deepEqual(admitLifecycleCommand(foreign, freshRecord()), {
    ok: false,
    code: "entitlement-mismatch",
  });
  // Malformed commands never apply.
  assert.deepEqual(admitLifecycleCommand({ ...hold(), key: undefined as never }, freshRecord()), {
    ok: false,
    code: "malformed-command",
  });
});

test("lifecycle: records are readonly data (E1 compile check)", () => {
  const record: EntitlementLifecycleRecord = freshRecord();
  // @ts-expect-error — E1: contract fields are readonly
  record.state = "settled";
  assert.equal(record.entitlement, entitlement);
});
