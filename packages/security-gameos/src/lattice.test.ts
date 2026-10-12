/**
 * LATTICE TESTS (PL-041) — the pure effective-right computation (R5/R20/E8/E9).
 *
 * The platform arm over platform-contracts' own oracle; the avatar arm's
 * R5 negatives (a host restriction only ever REMOVES — never adds); the
 * elevated-review arm; the integrity suspension fold; and the E9
 * determinism of the pure adjudication (same inputs → deep-equal result).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicate, currentSuspension } from "./index.ts";
import type {
  AdjudicationResult,
  HostBindingRecord,
  IntegrityRightsEntry,
  LatticeInputs,
} from "./index.ts";
import type { RightsRequest } from "./index.ts";
import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import { buildRigAvatarDefinition } from "./rig-fixtures.ts";

const tenant = "tenant-lattice";
const foreign = "tenant-lattice-foreign";
const subject = "actr-lattice-one";
const other = "actr-lattice-two";
const avatarDefinition = buildRigAvatarDefinition();

function platformGrant(over: Partial<ScopedCapabilityGrant> = {}): ScopedCapabilityGrant {
  return {
    tenant,
    subject,
    capability: "rewards",
    permissions: ["read", "submit"],
    ...over,
  } as ScopedCapabilityGrant;
}

function standing(over: Partial<IntegrityRightsEntry> = {}): IntegrityRightsEntry {
  return {
    entryId: "integrity-right-x",
    tenant,
    subject,
    verdictId: "verdict-x",
    disposition: "suspended",
    verdictKind: "pronounced-deviation-observed",
    band: "moderate",
    confidence: { lower: 0.72, upper: 0.94 },
    ingestedAt: 1_000,
    revision: 1,
    ...over,
  } as IntegrityRightsEntry;
}

function binding(over: Partial<HostBindingRecord> = {}): HostBindingRecord {
  return {
    tenant,
    host: "host-lattice",
    definition: avatarDefinition,
    restriction: { denied: ["speech"], approvalRequired: [], sandboxed: false },
    registeredAt: 1_000,
    revision: 1,
    ...over,
  } as HostBindingRecord;
}

function inputs(over: Partial<LatticeInputs> = {}): LatticeInputs {
  return {
    platformGrants: [platformGrant()],
    broker: {} as LatticeInputs["broker"],
    bindings: [binding()],
    sessions: [{ tenant, sessionId: "sess-lattice", boundAt: 1, revision: 1 }],
    standings: [],
    elevated: [],
    ...over,
  };
}

test("lattice: a granted platform right is granted with its basis", () => {
  const result = adjudicate(
    { tenant, subject, capability: { kind: "platform", capability: "rewards", permission: "submit" } },
    inputs(),
  );
  assert.ok(result.granted);
  assert.equal(result.right.capability, "platform:rewards");
  assert.ok(result.right.basis.includes("grant:rewards/submit"));
  assert.ok(result.right.basis.includes(`tenant:${tenant}`));
});

test("lattice: an ungranted platform subject is refused capability-not-granted", () => {
  const result = adjudicate(
    { tenant, subject: other, capability: { kind: "platform", capability: "rewards", permission: "read" } },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "capability-not-granted");
});

test("lattice: a grant without the asked permission is refused permission-not-granted", () => {
  const result = adjudicate(
    { tenant, subject, capability: { kind: "platform", capability: "rewards", permission: "administer" } },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "permission-not-granted");
});

test("lattice: a cross-tenant platform probe is refused tenant-mismatch (R20)", () => {
  const result = adjudicate(
    { tenant: foreign, subject, capability: { kind: "platform", capability: "rewards", permission: "read" } },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "tenant-mismatch");
});

test("lattice: an avatar capability survives the host restriction (R5)", () => {
  const result = adjudicate(
    { tenant, subject, capability: { kind: "avatar", capability: "movement", host: "host-lattice" } },
    inputs(),
  );
  assert.ok(result.granted);
  assert.equal(result.right.capability, "avatar:movement");
  assert.ok(result.right.basis.includes("survived-restriction:movement"));
});

test("lattice: a host-restricted capability is refused restricted-by-host (R5)", () => {
  const result = adjudicate(
    { tenant, subject, capability: { kind: "avatar", capability: "speech", host: "host-lattice" } },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "restricted-by-host");
  assert.ok(result.evidence.includes("denied:speech"));
});

test("lattice R5 NEGATIVE: an undeclared capability is refused under the MOST PERMISSIVE restriction", () => {
  // The most permissive restriction a host can declare: deny nothing,
  // require no approvals, no sandbox. The body still never declared
  // `gaze` — a restriction structurally cannot ADD it.
  const permissive: HostBindingRecord = binding({
    restriction: { denied: [], approvalRequired: [], sandboxed: false },
  });
  const result = adjudicate(
    { tenant, subject, capability: { kind: "avatar", capability: "gaze", host: "host-lattice" } },
    inputs({ bindings: [permissive] }),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "body-lacks-capability");
  assert.ok(result.detail.includes("cannot add it (R5)"));
  assert.ok(result.evidence.includes("undeclared:gaze"));
});

test("lattice: a host with no binding in this tenant is refused unknown-host", () => {
  const result = adjudicate(
    { tenant, subject, capability: { kind: "avatar", capability: "movement", host: "host-unknown" } },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "unknown-host");
});

test("lattice: a host bound in ANOTHER tenant is refused cross-tenant-request before any capability check", () => {
  const result = adjudicate(
    { tenant: foreign, subject, capability: { kind: "avatar", capability: "movement", host: "host-lattice" } },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "cross-tenant-request");
  assert.ok(result.detail.includes("bound to another tenant"));
});

test("lattice: a suspended subject is refused suspended-by-integrity with the verdict evidence (R11)", () => {
  const entry = standing();
  const result = adjudicate(
    { tenant, subject, capability: { kind: "avatar", capability: "movement", host: "host-lattice" } },
    inputs({ standings: [entry] }),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "suspended-by-integrity");
  assert.ok(result.evidence.includes("verdict:verdict-x"));
  assert.ok(result.evidence.includes("band:moderate"));
  // R11: the refusal carries the PROBABILISTIC evidence (band), never a
  // certainty claim — no boolean guilt field exists on the entry.
  assert.equal(entry.disposition, "suspended");
  assert.equal(entry.band, "moderate");
  assert.deepEqual(entry.confidence, { lower: 0.72, upper: 0.94 });
});

test("lattice: a suspension in ANOTHER tenant does not suspend here (R20)", () => {
  const result = adjudicate(
    { tenant, subject, capability: { kind: "avatar", capability: "movement", host: "host-lattice" } },
    inputs({ standings: [standing({ tenant: foreign, subject })] }),
  );
  assert.ok(result.granted);
});

test("lattice: currentSuspension follows the LATEST ingested standing (E10)", () => {
  const older = standing({ verdictId: "verdict-old" });
  const newer = standing({ verdictId: "verdict-new", band: "narrow", confidence: { lower: 0.9, upper: 0.98 } });
  const current = currentSuspension(tenant, subject, [older, newer]);
  assert.equal(current?.verdictId, "verdict-new");
  assert.equal(current?.band, "narrow");
});

test("lattice: an unbound runtime session is refused session-unbound (R20)", () => {
  const result = adjudicate(
    {
      tenant,
      subject,
      capability: {
        kind: "runtime",
        capability: "avatar.movement",
        actorClass: "avatar-agent",
        session: { tenant, sessionId: "sess-unbound", epoch: 1, tick: 1 },
      },
    },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "session-unbound");
});

test("lattice: a session bound in ANOTHER tenant is refused cross-tenant-request (R20)", () => {
  const result = adjudicate(
    {
      tenant: foreign,
      subject,
      capability: {
        kind: "runtime",
        capability: "avatar.movement",
        actorClass: "avatar-agent",
        session: { tenant: foreign, sessionId: "sess-lattice", epoch: 1, tick: 1 },
      },
    },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "cross-tenant-request");
});

test("lattice: an elevated-review right is granted only to its minted subject", () => {
  const elevated = [
    { rightId: "arena-review-right-x", tenant, subject, caseId: "case-1", evidenceDigest: "e".repeat(64), mintedAt: 1, revision: 1 },
  ];
  const granted = adjudicate(
    { tenant, subject, capability: { kind: "elevated-review", caseId: "case-1" } },
    inputs({ elevated }),
  );
  assert.ok(granted.granted);
  assert.equal(granted.right.capability, "arena-escalated-review");
  assert.ok(granted.right.basis.includes(`evidence:${"e".repeat(64)}`));

  const unminted = adjudicate(
    { tenant, subject: other, capability: { kind: "elevated-review", caseId: "case-1" } },
    inputs({ elevated }),
  );
  assert.ok(!unminted.granted);
  assert.equal(unminted.code, "no-elevated-right");

  const foreignProbe = adjudicate(
    { tenant: foreign, subject, capability: { kind: "elevated-review", caseId: "case-1" } },
    inputs({ elevated }),
  );
  assert.ok(!foreignProbe.granted);
  assert.equal(foreignProbe.code, "cross-tenant-request");
});

test("lattice: an unknown capability kind is refused invalid-request (E8)", () => {
  const result = adjudicate(
    { tenant, subject, capability: { kind: "mystery" } as unknown as RightsRequest["capability"] },
    inputs(),
  );
  assert.ok(!result.granted);
  assert.equal(result.code, "invalid-request");
});

test("lattice E9: the same inputs always yield the identical adjudication", () => {
  const request: RightsRequest = {
    tenant,
    subject,
    capability: { kind: "avatar", capability: "speech", host: "host-lattice" },
  };
  const first = adjudicate(request, inputs());
  const second = adjudicate(request, inputs());
  assert.deepEqual(first, second);
  const trace = (result: AdjudicationResult): string =>
    result.granted ? `granted:${result.right.capability}` : `refused:${result.code}`;
  assert.equal(trace(first), "refused:restricted-by-host");
});
