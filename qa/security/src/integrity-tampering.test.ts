/**
 * INTEGRITY TAMPERING (PL-041 qa negative class, R11/E10) — forged
 * integrity markers and verdict-edit attempts against the REAL
 * integrity-derived rights fold:
 * - a forged avatar definition digest (`tampered-definition`);
 * - corrupted CAS bytes behind a published record (`integrity`,
 *   the PL-011 store code verbatim — fail-closed);
 * - a verdict "edit" via re-ingestion is idempotent (E10: the recorded
 *   standing never re-mutates; a NEW verdict APPENDS, the old entry
 *   stays byte-identical);
 * - certainty is structurally unrepresentable on every standing
 *   (no FORBIDDEN_VERDICT_FIELDS key anywhere on the entries);
 * - a standing for an unknown subject cannot be pulled from nowhere
 *   (`no-recorded-verdict`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId, asTimestampMs, FORBIDDEN_VERDICT_FIELDS } from "../../../packages/platform-contracts/src/index.ts";
import { machineLikeTrace } from "../../../packages/platform-integrity/src/index.ts";
import {
  RIG_ADMIN,
  RIG_AUDITOR,
  RIG_CLEAN_SUBJECT,
  RIG_HOST,
  RIG_INTEGRITY_OPERATOR,
  RIG_OUTSIDER,
  RIG_SUSPENDED_SUBJECT,
  RIG_TENANT,
  assertRefusalLedgered,
  createSecurityRig,
  decideOf,
} from "./index.ts";
import type { SecurityRig } from "./index.ts";

const rig: SecurityRig = await createSecurityRig();

test("tampering: a forged avatar definition digest is refused tampered-definition", () => {
  const forged = { ...rig.avatarDefinition, definitionDigest: "9".repeat(64) } as typeof rig.avatarDefinition;
  const result = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: "host-rig-forged-marker",
    definition: forged,
    restriction: rig.restriction,
  });
  assert.ok(!result.ok);
  assert.equal(result.code, "tampered-definition");
  assert.ok(result.detail.includes("does not match its content"));
});

test("tampering: a single-byte mutation of the definition digest is still detected", () => {
  const real = String(rig.avatarDefinition.definitionDigest);
  const flipped = `${real.slice(0, -1)}${real.endsWith("0") ? "1" : "0"}`;
  const forged = { ...rig.avatarDefinition, definitionDigest: flipped } as typeof rig.avatarDefinition;
  const result = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: "host-rig-forged-marker-2",
    definition: forged,
    restriction: rig.restriction,
  });
  assert.ok(!result.ok);
  assert.equal(result.code, "tampered-definition");
});

test("tampering: corrupted CAS bytes behind the published record fail closed (integrity, verbatim)", () => {
  // corrupt the good record's stored bytes, then attempt admission with
  // the CORRECT pin — the CAS verification must still refuse.
  rig.blobStore.corruptChunkForTests(rig.packages.good.identity.contentDigest, 0);
  const result = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, {
    tenant: RIG_TENANT,
    kind: rig.packages.good.identity.kind,
    id: rig.packages.good.identity.id,
    version: "1.0.0",
    contentDigest: rig.packages.good.identity.contentDigest,
  });
  assert.ok(!result.admitted);
  assert.equal(result.code, "integrity");
  assertRefusalLedgered(rig, RIG_TENANT, RIG_ADMIN, "integrity");
});

test("tampering: a verdict EDIT attempt (re-ingesting the standing) is idempotent (E10)", () => {
  const before = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(before.ok);
  const standingsBefore = before.state.standings.map((entry) => ({ ...entry }));

  // the "edit": re-ingest the SAME subject's standing through the door.
  const reingested = rig.authority.ingestStanding(RIG_ADMIN, RIG_TENANT, RIG_SUSPENDED_SUBJECT);
  assert.ok(reingested.ok);
  assert.ok(reingested.duplicate);

  const after = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(after.ok);
  assert.deepEqual(after.state.standings, standingsBefore);
});

test("tampering: a NEW verdict APPENDS — the old entry stays byte-identical (E10)", () => {
  const before = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(before.ok);
  const cleanBefore = before.state.standings.find((entry) => entry.subject === RIG_CLEAN_SUBJECT);
  assert.ok(cleanBefore);
  const suspendedBefore = before.state.standings.find((entry) => entry.subject === RIG_SUSPENDED_SUBJECT);
  assert.ok(suspendedBefore);

  // the REAL integrity service re-evaluates the clean subject with a
  // machine-like stream under a human claim → a NEW (suspending) verdict.
  const reevaluated = rig.integrity.submitEvaluation(asSubjectId(RIG_INTEGRITY_OPERATOR)!, {
    tenant: asTenantId(RIG_TENANT)!,
    subject: asSubjectId(RIG_CLEAN_SUBJECT)!,
    source: { replayId: "replay-rig-reevaluate", commandStream: machineLikeTrace() },
    claim: { claimKind: "unbacked", mode: "human" },
    capturedAt: asTimestampMs(2_000)!,
  });
  assert.ok(reevaluated.accepted);
  assert.equal(reevaluated.verdict.kind, "pronounced-deviation-observed");

  const ingested = rig.authority.ingestStanding(RIG_ADMIN, RIG_TENANT, RIG_CLEAN_SUBJECT);
  assert.ok(ingested.ok && !ingested.duplicate);

  const after = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(after.ok);
  // the OLD entries are still there, byte-identical…
  const oldSuspended = after.state.standings.find((entry) => entry.entryId === suspendedBefore.entryId);
  assert.deepEqual(oldSuspended, suspendedBefore);
  // …and the clean subject now carries TWO standings (the new one last).
  const cleanStandings = after.state.standings.filter((entry) => entry.subject === RIG_CLEAN_SUBJECT);
  assert.equal(cleanStandings.length, 2);
  // the LATEST ingestion wins → the clean subject is NOW suspended.
  const refusal = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_CLEAN_SUBJECT,
    capability: { kind: "avatar", capability: "movement", host: RIG_HOST },
  });
  assert.ok(!refusal.granted);
  assert.equal(refusal.code, "suspended-by-integrity");
});

test("tampering R11: certainty is structurally unrepresentable on EVERY standing", () => {
  const state = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(state.ok);
  assert.ok(state.state.standings.length >= 2);
  for (const entry of state.state.standings) {
    for (const key of Object.keys(entry)) {
      assert.ok(
        !FORBIDDEN_VERDICT_FIELDS.includes(key),
        `standing carries forbidden certainty field ${key}`,
      );
    }
    assert.equal(typeof entry.band, "string");
    assert.ok(entry.confidence.lower <= entry.confidence.upper);
  }
});

test("tampering: a standing cannot be pulled for an unknown subject (no-recorded-verdict)", () => {
  const result = rig.authority.ingestStanding(RIG_ADMIN, RIG_TENANT, RIG_OUTSIDER);
  assert.ok(!result.ok);
  assert.equal(result.code, "no-recorded-verdict");
});
