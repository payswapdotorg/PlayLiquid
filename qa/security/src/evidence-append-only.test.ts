/**
 * EVIDENCE APPEND-ONLY (PL-041 qa negative class, E10) — attempts to
 * rewrite, shrink or forge the denial history and the state document:
 * - a snapshot rewrite under the same content-addressed id is REFUSED
 *   by the store (the immutable-snapshot contract);
 * - a tampered document (forged binding digest) never re-enters
 *   (`malformed-document`);
 * - an unknown snapshot id (`snapshot-not-found`);
 * - the refusal ledger stays append-only across a hostile decision
 *   sequence (prefix preserved, monotonic revisions);
 * - a duplicate hostile probe yields the SAME recorded receipt (the
 *   first receipt stands — replay grows nothing);
 * - a restore never resurrects refusals that were not in the snapshot.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSecurityRig,
  ledgerIsAppendOnly,
  RIG_ADMIN,
  RIG_AUDITOR,
  RIG_OUTSIDER,
  RIG_REVIEWER,
  RIG_TENANT,
  RightsAuthority,
  brokerSnapshotOf,
  documentOf,
  snapshotOf,
} from "./index.ts";
import type { SecurityRig } from "./index.ts";

const rig: SecurityRig = await createSecurityRig();

function hostileSequence(target: SecurityRig): void {
  for (const subject of [RIG_OUTSIDER, RIG_REVIEWER]) {
    target.authority.decide({
      tenant: RIG_TENANT,
      subject,
      capability: { kind: "platform", capability: "rewards", permission: "administer" },
    });
  }
}

test("append-only: the refusal ledger stays append-only across a hostile decision sequence", () => {
  const before = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(before.ok);
  hostileSequence(rig);
  const after = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(after.ok);
  assert.ok(after.records.length > before.records.length);
  assert.ok(ledgerIsAppendOnly(before.records, after.records));
  // revisions are monotonic across the whole history.
  for (let index = 1; index < after.records.length; index += 1) {
    assert.ok(after.records[index]!.revision >= after.records[index - 1]!.revision);
  }
});

test("append-only: a replayed hostile probe yields the SAME recorded receipt (E10)", () => {
  const request = {
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "platform" as const, capability: "rewards", permission: "administer" as const },
  };
  const first = rig.authority.decide(request);
  const second = rig.authority.decide(request);
  assert.ok(!first.granted && !second.granted);
  assert.ok(second.recorded !== undefined);
  assert.equal(second.recorded!.code, "capability-not-granted");

  const before = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(before.ok);
  const replay = rig.authority.decide(request);
  assert.ok(!replay.granted);
  assert.ok(replay.recorded !== undefined);
  assert.equal(replay.recorded!.refusalId, second.recorded!.refusalId);
  const after = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(after.ok);
  assert.equal(after.records.length, before.records.length);
});

test("append-only: a snapshot REWRITE under the same id is refused by the store (E10)", () => {
  const snapshot = rig.authority.snapshot(RIG_ADMIN, RIG_TENANT);
  assert.ok(snapshot.ok);
  const stored = rig.store.store.load(snapshot.snapshotId);
  assert.ok(stored !== undefined);

  // the forgery: same snapshot id, different ledger content.
  const forgedLedger = stored.document.ledger.map((record) => ({ ...record, detail: `forged: ${record.detail}` }));
  const forged = { ...stored, document: { ...stored.document, ledger: forgedLedger } };
  assert.throws(() => rig.store.store.save(forged), /refusing rewrite of immutable snapshot/);
});

test("append-only: a tampered document (forged binding digest) never re-enters (malformed-document)", () => {
  const state = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(state.ok);
  const ledger = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(ledger.ok);

  const tampered = snapshotOf(
    documentOf({
      revision: 4242,
      bindings: [
        ...state.state.bindings,
        {
          tenant: RIG_TENANT,
          host: "host-rig-forged-evidence",
          definition: { ...rig.avatarDefinition, definitionDigest: "5".repeat(64) } as never,
          restriction: rig.restriction,
          registeredAt: 1,
          revision: 1,
        },
      ],
      sessions: [...state.state.sessions],
      standings: [...state.state.standings],
      elevated: [...state.state.elevated],
      ledger: [...ledger.records],
    }),
  );
  rig.store.store.save(tampered);
  const result = rig.authority.restore(RIG_ADMIN, RIG_TENANT, tampered.snapshotId);
  assert.ok(!result.ok);
  assert.equal(result.code, "malformed-document");
});

test("append-only: a document with a torn ledger shape never re-enters (malformed-document)", () => {
  const torn = snapshotOf({
    documentKind: "rights-state",
    revision: 1,
    bindings: [],
    sessions: [],
    standings: [],
    elevated: [],
    ledger: [{ notARefusal: true } as never],
  });
  rig.store.store.save(torn);
  const result = rig.authority.restore(RIG_ADMIN, RIG_TENANT, torn.snapshotId);
  assert.ok(!result.ok);
  assert.equal(result.code, "malformed-document");
});

test("append-only: restoring an unknown snapshot id is refused snapshot-not-found", () => {
  const result = rig.authority.restore(RIG_ADMIN, RIG_TENANT, "snap-rig-nonexistent");
  assert.ok(!result.ok);
  assert.equal(result.code, "snapshot-not-found");
});

test("append-only: a restore never resurrects refusals that were not in the snapshot", () => {
  const snapshot = rig.authority.snapshot(RIG_ADMIN, RIG_TENANT);
  assert.ok(snapshot.ok);
  const preSnapshotLedger = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(preSnapshotLedger.ok);

  // post-snapshot hostile decisions grow the live ledger… (NOVEL probes:
  // identical replays return the CACHED receipt and grow nothing — E10 —
  // so these requests must be ones no earlier test has decided)
  for (const subject of [RIG_OUTSIDER, RIG_REVIEWER]) {
    const decided = rig.authority.decide({
      tenant: RIG_TENANT,
      subject,
      capability: { kind: "platform", capability: "analytics", permission: "administer" },
    });
    assert.ok(!decided.granted);
  }
  const grown = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(grown.ok);
  assert.ok(grown.records.length > preSnapshotLedger.records.length);

  // …a fresh authority over the SHARED store restores the SNAPSHOT state…
  const second = new RightsAuthority({
    clock: rig.clock.clock,
    store: rig.store.store,
    admins: rig.admins.admins,
    platformGrants: rig.platformGrants.directory,
    broker: brokerSnapshotOf(rig.broker),
    registry: rig.registry,
    artifacts: rig.artifacts,
    economy: { declarationsOf: () => [], entitlementIn: () => undefined },
    integrity: { standingFor: () => ({ ok: false, code: "no-recorded-verdict" }) },
    escalations: { caseOf: () => ({ ok: false, code: "unknown-case" }) },
  });
  const restored = second.restore(RIG_ADMIN, RIG_TENANT, snapshot.snapshotId);
  assert.ok(restored.ok);

  // …and its ledger holds EXACTLY the snapshot's records (no resurrections,
  // no orphans — E10: the restore adopts the WHOLE document, never more).
  const restoredLedger = second.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(restoredLedger.ok);
  assert.deepEqual(restoredLedger.records, preSnapshotLedger.records);
});

test("append-only: the whole history is stable under re-reading (E9 determinism of the evidence)", () => {
  const first = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(first.ok);
  const second = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(second.ok);
  assert.deepEqual(first.records, second.records);
});
