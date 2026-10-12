/**
 * RIG DETERMINISM TESTS (PL-041, E9) — constructing the same rig twice
 * yields IDENTICAL lattice state, IDENTICAL decision trajectories over a
 * fixed request battery (grants AND refusals) and IDENTICAL
 * content-addressed snapshot ids. No clock, no randomness, no IO beyond
 * the injected fakes — every identifier is content-derived.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecurityRig, rigStateDigest, rigTimestamp } from "./index.ts";
import type { RightsRequest, SecurityRig } from "./index.ts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import {
  RIG_AUDITOR,
  RIG_AVATAR_SUBJECT,
  RIG_FOREIGN_TENANT,
  RIG_HOST,
  RIG_OUTSIDER,
  RIG_PLAYER,
  RIG_REVIEWER,
  RIG_SESSION,
  RIG_SUSPENDED_SUBJECT,
  RIG_TENANT,
} from "./rig.ts";

/** The fixed decision battery every trajectory runs (happy AND negative). */
function battery(): readonly RightsRequest[] {
  return [
    { tenant: RIG_TENANT, subject: RIG_PLAYER, capability: { kind: "platform", capability: "rewards", permission: "submit" } },
    { tenant: RIG_TENANT, subject: RIG_OUTSIDER, capability: { kind: "platform", capability: "rewards", permission: "submit" } },
    { tenant: RIG_FOREIGN_TENANT, subject: RIG_PLAYER, capability: { kind: "platform", capability: "rewards", permission: "submit" } },
    { tenant: RIG_TENANT, subject: RIG_AVATAR_SUBJECT, capability: { kind: "avatar", capability: "movement", host: RIG_HOST } },
    { tenant: RIG_TENANT, subject: RIG_AVATAR_SUBJECT, capability: { kind: "avatar", capability: "speech", host: RIG_HOST } },
    { tenant: RIG_TENANT, subject: RIG_AVATAR_SUBJECT, capability: { kind: "avatar", capability: "gaze", host: RIG_HOST } },
    {
      tenant: RIG_TENANT,
      subject: RIG_AVATAR_SUBJECT,
      capability: { kind: "runtime", capability: "avatar.movement", actorClass: "avatar-agent", session: { tenant: RIG_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 } },
    },
    {
      tenant: RIG_TENANT,
      subject: RIG_AVATAR_SUBJECT,
      capability: { kind: "runtime", capability: "avatar.movement", actorClass: "avatar-agent", session: { tenant: RIG_TENANT, sessionId: "sess-rig-unbound", epoch: 1, tick: 5 } },
    },
    { tenant: RIG_TENANT, subject: RIG_SUSPENDED_SUBJECT, capability: { kind: "avatar", capability: "movement", host: RIG_HOST } },
    { tenant: RIG_TENANT, subject: RIG_REVIEWER, capability: { kind: "elevated-review", caseId: "case-placeholder" } },
  ];
}

function trajectory(rig: SecurityRig): string[] {
  // the platform grant fixture the battery expects (deterministic input).
  rig.platformGrants.grant({
    tenant: asTenantId(RIG_TENANT)!,
    subject: asSubjectId(RIG_PLAYER)!,
    capability: "rewards",
    permissions: ["read", "submit"],
  } satisfies ScopedCapabilityGrant);
  return battery().map((request) => {
    const result = rig.authority.decide(request);
    return result.granted ? `granted:${result.right.capability}` : `refused:${result.code}`;
  });
}

test("rig E9: constructing the rig twice yields the identical lattice-state digest", async () => {
  const left = await createSecurityRig();
  const right = await createSecurityRig();
  assert.equal(String(rigStateDigest(left)), String(rigStateDigest(right)));
});

test("rig E9: the same battery over two rigs yields the identical trajectory", async () => {
  const left = await createSecurityRig();
  const right = await createSecurityRig();
  const leftTrajectory = trajectory(left);
  const rightTrajectory = trajectory(right);
  assert.deepEqual(leftTrajectory, rightTrajectory);
  // spot-check the trajectory's expected shape (grants AND typed refusals).
  assert.equal(leftTrajectory[0], "granted:platform:rewards");
  assert.equal(leftTrajectory[1], "refused:capability-not-granted");
  assert.equal(leftTrajectory[2], "refused:tenant-mismatch");
  assert.equal(leftTrajectory[4], "refused:restricted-by-host");
  assert.equal(leftTrajectory[5], "refused:body-lacks-capability");
  assert.equal(leftTrajectory[6], "granted:runtime:avatar.movement");
  assert.equal(leftTrajectory[7], "refused:session-unbound");
  assert.equal(leftTrajectory[8], "refused:suspended-by-integrity");
  assert.equal(leftTrajectory[9], "refused:no-elevated-right");
});

test("rig E9: the elevated-review right of the REAL case is reproducible across rigs", async () => {
  const left = await createSecurityRig();
  const right = await createSecurityRig();
  const request = (rig: SecurityRig): RightsRequest => ({
    tenant: RIG_TENANT,
    subject: RIG_REVIEWER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  const first = left.authority.decide(request(left));
  const second = right.authority.decide(request(right));
  assert.ok(first.granted && second.granted);
  assert.deepEqual(first.right, second.right);
  // the ingested case's evidence pin is the arena's own content digest.
  assert.equal(String(left.arenaCaseId), String(right.arenaCaseId));
});

test("rig E9: snapshotting the same state twice yields the identical content-addressed id", async () => {
  const rig = await createSecurityRig();
  const first = rig.authority.snapshot(rig.admin, RIG_TENANT);
  const second = rig.authority.snapshot(rig.admin, RIG_TENANT);
  assert.ok(first.ok && second.ok);
  assert.equal(first.snapshotId, second.snapshotId);
  assert.equal(first.revision, second.revision);
});

test("rig: rigTimestamp passes fixed timestamps through (the only time source)", () => {
  assert.equal(rigTimestamp(1_234), 1_234);
  assert.notEqual(rigTimestamp(1_234), rigTimestamp(1_235));
});

test("rig: the battery's refusal receipts are all recorded with typed codes (E8/E10)", async () => {
  const rig = await createSecurityRig();
  trajectory(rig);
  const ledger = rig.authority.ledger(rig.auditor, RIG_TENANT);
  assert.ok(ledger.ok);
  const codes = new Set(ledger.records.map((record) => record.code));
  for (const code of [
    "capability-not-granted",
    "restricted-by-host",
    "body-lacks-capability",
    "session-unbound",
    "suspended-by-integrity",
    "no-elevated-right",
  ]) {
    assert.ok(codes.has(code), `missing typed refusal receipt ${code}`);
  }
  // R20: the cross-tenant probe's receipt lives under the FOREIGN tenant —
  // reachable only through a grant there, never through the domestic view.
  rig.admins.grant({ tenant: RIG_FOREIGN_TENANT, subject: RIG_AUDITOR, role: "rights-auditor" });
  const foreign = rig.authority.ledger(RIG_AUDITOR, RIG_FOREIGN_TENANT);
  assert.ok(foreign.ok);
  assert.ok(foreign.records.some((record) => record.code === "tenant-mismatch"));
  assert.ok(!codes.has("tenant-mismatch"));
});
