/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full identity journey over the in-memory fakes: register
 * two identities in one tenant and one in a second tenant -> alias
 * assignment (duplicate refused) -> profile versioning (stale base
 * version refused) -> snapshot -> restore into a fresh service ->
 * cross-tenant access refused (R20). Prints deterministic
 * machine-readable JSON and exits non-zero on any unexpected outcome.
 * No IO beyond stdout; no clock, no randomness, no network.
 */

import { IdentityService } from "./service.ts";
import { createFixedClock, createMemoryIdentityStore } from "./fakes.ts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;
const subjectBeta = asSubjectId("player-beta")!;

const store = createMemoryIdentityStore();
const clock = createFixedClock();
const service = new IdentityService({ store: store.store, clock: clock.clock });

interface Step {
  readonly name: string;
  readonly expected: string;
  readonly actual: string;
}

const steps: Step[] = [];

function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

// 1. Registration.
const registered = service.admit({
  kind: "register",
  tenant: tenantA,
  subject: subjectOne,
  displayName: "Player One",
  alias: "one",
});
record("register-one", "accepted", registered.accepted ? "accepted" : `refused:${registered.code}`);

// 2. Second identity + second tenant.
service.admit({ kind: "register", tenant: tenantA, subject: subjectTwo, displayName: "Player Two" });
service.admit({ kind: "register", tenant: tenantB, subject: subjectBeta, displayName: "Player Beta", alias: "one" });

// 3. Duplicate subject refused (idempotency: first record stands, E10).
const duplicate = service.admit({
  kind: "register",
  tenant: tenantA,
  subject: subjectOne,
  displayName: "Player One Again",
});
record("duplicate-register", "refused:duplicate-subject", duplicate.accepted ? "accepted" : `refused:${duplicate.code}`);

// 4. Alias taken within tenant A.
const taken = service.admit({ kind: "assign-alias", tenant: tenantA, subject: subjectTwo, alias: "one" });
record("alias-taken", "refused:alias-taken", taken.accepted ? "accepted" : `refused:${taken.code}`);

// 5. Profile versioning with stale base version refused.
clock.advance(100);
const updated = service.admit({
  kind: "update-profile",
  tenant: tenantA,
  subject: subjectOne,
  displayName: "Player Uno",
  baseVersion: 1,
});
record("profile-update", "accepted", updated.accepted ? "accepted" : `refused:${updated.code}`);
const stale = service.admit({
  kind: "update-profile",
  tenant: tenantA,
  subject: subjectOne,
  displayName: "Player Primero",
  baseVersion: 1,
});
record("stale-version", "refused:stale-version", stale.accepted ? "accepted" : `refused:${stale.code}`);

// 6. Snapshot + restore into a fresh service (resumability).
const snapshot = service.snapshot();
const resumed = new IdentityService({ store: store.store, clock: clock.clock });
const restored = resumed.restore();
record("snapshot", "ok", snapshot.ok ? "ok" : `failed:${snapshot.code}`);
record("restore", "ok", restored.ok ? "ok" : `failed:${restored.code}`);

// 7. Tenant isolation: tenant B cannot see tenant A's subject (R20).
const crossTenant = resumed.identityOf(tenantB, subjectOne);
record("cross-tenant-read", "not-found:cross-tenant-access", crossTenant.found ? "found" : `not-found:${crossTenant.code}`);

// 8. Same alias text resolves to DIFFERENT subjects per tenant (R20).
const inA = resumed.resolveAlias(tenantA, "one");
const inB = resumed.resolveAlias(tenantB, "one");
record(
  "alias-per-tenant",
  "one->player-one,one->player-beta",
  `one->${inA.found ? String(inA.subject) : "?"},one->${inB.found ? String(inB.subject) : "?"}`,
);

const failures = steps.filter((step) => step.expected !== step.actual);
console.log(JSON.stringify({ harness: "platform-identity", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
