/**
 * FORGED GRANTS (PL-041 qa negative class) — digest mismatches and
 * grant-identity forgery against the REAL admission gate and the REAL
 * broker-mediated runtime arm:
 * - a pin whose digest does not match the registry record
 *   (`digest-mismatch`, the PL-011 code verbatim);
 * - a subject claiming ANOTHER holder's grant id
 *   (`grant-holder-mismatch`, the frozen evaluator's code verbatim);
 * - a subject citing a grant id that does not exist
 *   (`grant-not-found`, verbatim).
 * Every adjudication-door refusal is asserted with its ledger record.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RIG_ADMIN,
  RIG_AVATAR_SUBJECT,
  RIG_OTHER_HOLDER,
  RIG_SESSION,
  RIG_TENANT,
  assertRefusalLedgered,
  createSecurityRig,
  decideOf,
} from "./index.ts";
import type { SecurityRig } from "./index.ts";

const rig: SecurityRig = await createSecurityRig();

function admit(id: string, contentDigest: string) {
  return rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, {
    tenant: RIG_TENANT,
    kind: "assets",
    id,
    version: "1.0.0",
    contentDigest,
  });
}

test("forged grants: a pin with a mismatched digest is refused digest-mismatch (verbatim)", () => {
  const real = rig.packages.good.identity.contentDigest;
  const forged = `sha256:${"b".repeat(63)}a`;
  assert.notEqual(forged, real);
  const result = admit("asset.rig-kit", forged);
  assert.ok(!result.admitted);
  assert.equal(result.code, "digest-mismatch");
  assert.ok(result.detail.includes("expects digest"));
  // E10: the typed refusal is ledgered.
  const record = assertRefusalLedgered(rig, RIG_TENANT, RIG_ADMIN, "digest-mismatch");
  assert.ok(record.evidence.some((item) => item.includes("asset.rig-kit")));
});

test("forged grants: a single flipped hex character in the pin still fails closed", () => {
  const real = rig.packages.good.identity.contentDigest;
  const flipped = real.slice(0, -1) + (real.endsWith("0") ? "1" : "0");
  const result = admit("asset.rig-kit", flipped);
  assert.ok(!result.admitted);
  assert.equal(result.code, "digest-mismatch");
});

test("forged grants: a completely fabricated sha-shaped digest is refused digest-mismatch", () => {
  const result = admit("asset.rig-kit", `sha256:${"0".repeat(64)}`);
  assert.ok(!result.admitted);
  assert.equal(result.code, "digest-mismatch");
});

test("forged grants: claiming ANOTHER holder's grant is refused grant-holder-mismatch (verbatim)", () => {
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 },
      claimedGrantId: "grant-rig-other-holder",
    },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "grant-holder-mismatch");
  // E10: ledgered with the typed code.
  assertRefusalLedgered(rig, RIG_TENANT, RIG_AVATAR_SUBJECT, "grant-holder-mismatch");
  // and the rightful holder's own adjudication is untouched.
  const rightful = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_OTHER_HOLDER,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 },
    },
  });
  assert.ok(rightful.granted);
});

test("forged grants: citing a NONEXISTENT grant id is refused grant-not-found (verbatim)", () => {
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 },
      claimedGrantId: "grant-rig-fabricated",
    },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "grant-not-found");
  assertRefusalLedgered(rig, RIG_TENANT, RIG_AVATAR_SUBJECT, "grant-not-found");
});

test("forged grants: an actor class outside the runtime vocabulary is refused invalid-request", () => {
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "superuser",
      session: { tenant: RIG_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 },
    },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "invalid-request");
});
