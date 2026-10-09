/**
 * Identity service tests: registration, alias lifecycle, profile
 * versioning (E10 immutability), snapshot/restore round-trip, and the
 * append-only history discipline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { IdentityService } from "./service.ts";
import { createFixedClock, createMemoryIdentityStore } from "./fakes.ts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;

function makeService() {
  const store = createMemoryIdentityStore();
  const clock = createFixedClock();
  const service = new IdentityService({ store: store.store, clock: clock.clock });
  return { store, clock, service };
}

test("service: register creates identity, first profile version and history entry", () => {
  const { service } = makeService();
  const admission = service.admit({
    kind: "register",
    tenant,
    subject,
    displayName: "Player One",
    alias: "one",
  });
  assert.deepEqual(admission, { accepted: true });
  const lookup = service.identityOf(tenant, subject);
  assert.ok(lookup.found);
  assert.equal(lookup.identity.status, "active");
  assert.equal(lookup.identity.decidedBy, "platform-authority");
  assert.equal(lookup.profile.version, 1);
  assert.deepEqual(lookup.profile.aliases, ["one"]);
  const history = service.historyOf(tenant, subject);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.kind, "registered");
});

test("service: registration retry is a typed duplicate refusal; the first record stands (E10)", () => {
  const { service } = makeService();
  service.admit({ kind: "register", tenant, subject, displayName: "Player One" });
  const retry = service.admit({ kind: "register", tenant, subject, displayName: "Player One Again" });
  assert.ok(!retry.accepted && retry.code === "duplicate-subject");
  const lookup = service.identityOf(tenant, subject);
  assert.ok(lookup.found);
  assert.equal(lookup.profile.displayName, "Player One");
  assert.equal(service.historyOf(tenant, subject).length, 1);
});

test("service: alias assignment and retirement update the index and append versions", () => {
  const { service } = makeService();
  service.admit({ kind: "register", tenant, subject, displayName: "Player One" });
  assert.deepEqual(service.admit({ kind: "assign-alias", tenant, subject, alias: "uno" }), { accepted: true });
  const resolved = service.resolveAlias(tenant, "uno");
  assert.ok(resolved.found);
  assert.equal(String(resolved.subject), String(subject));
  const versions = service.profileHistory(tenant, subject);
  assert.equal(versions.length, 2);
  assert.deepEqual(versions[0]!.aliases, []);
  assert.deepEqual(versions[1]!.aliases, ["uno"]);
  assert.deepEqual(service.admit({ kind: "retire-alias", tenant, subject, alias: "uno" }), { accepted: true });
  assert.equal(service.resolveAlias(tenant, "uno").found, false);
  assert.equal(service.profileHistory(tenant, subject).length, 3);
});

test("service: profile versions are append-only and immutable (E10)", () => {
  const { clock, service } = makeService();
  service.admit({ kind: "register", tenant, subject, displayName: "V1" });
  clock.advance(10);
  service.admit({ kind: "update-profile", tenant, subject, displayName: "V2", baseVersion: 1 });
  clock.advance(10);
  service.admit({ kind: "update-profile", tenant, subject, displayName: "V3", baseVersion: 2 });
  const versions = service.profileHistory(tenant, subject);
  assert.deepEqual(
    versions.map((version) => version.displayName),
    ["V1", "V2", "V3"],
  );
  assert.deepEqual(
    versions.map((version) => version.version),
    [1, 2, 3],
  );
  // Old versions never change when new ones append.
  assert.equal(versions[0]!.updatedAt < versions[2]!.updatedAt, true);
});

test("service: update-profile fences concurrent writers with stale-version refusals", () => {
  const { service } = makeService();
  service.admit({ kind: "register", tenant, subject, displayName: "V1" });
  const first = service.admit({ kind: "update-profile", tenant, subject, displayName: "V2", baseVersion: 1 });
  assert.deepEqual(first, { accepted: true });
  const stale = service.admit({ kind: "update-profile", tenant, subject, displayName: "Racing", baseVersion: 1 });
  assert.ok(!stale.accepted && stale.code === "stale-version");
  const current = service.admit({ kind: "update-profile", tenant, subject, displayName: "V3", baseVersion: 2 });
  assert.deepEqual(current, { accepted: true });
  const lookup = service.identityOf(tenant, subject);
  assert.ok(lookup.found && lookup.profile.displayName === "V3");
});

test("service: history records every admitted mutation in order", () => {
  const { clock, service } = makeService();
  service.admit({ kind: "register", tenant, subject, displayName: "P" });
  clock.advance(5);
  service.admit({ kind: "assign-alias", tenant, subject, alias: "p" });
  clock.advance(5);
  service.admit({ kind: "update-profile", tenant, subject, displayName: "Q", baseVersion: 2 });
  clock.advance(5);
  service.admit({ kind: "retire", tenant, subject });
  const history = service.historyOf(tenant, subject);
  assert.deepEqual(
    history.map((entry) => entry.kind),
    ["registered", "alias-assigned", "profile-updated", "retired"],
  );
  assert.ok(history.every((entry) => entry.decidedBy === "platform-authority"));
});

test("service: retired identities refuse further mutations", () => {
  const { service } = makeService();
  service.admit({ kind: "register", tenant, subject, displayName: "P" });
  assert.deepEqual(service.admit({ kind: "retire", tenant, subject }), { accepted: true });
  const refused = service.admit({ kind: "assign-alias", tenant, subject, alias: "late" });
  assert.ok(!refused.accepted && refused.code === "identity-retired");
  const lookup = service.identityOf(tenant, subject);
  assert.ok(lookup.found && lookup.identity.status === "retired");
});

test("service: snapshot and restore round-trip the whole read model", () => {
  const { store, service } = makeService();
  service.admit({ kind: "register", tenant, subject, displayName: "P", alias: "one" });
  service.admit({ kind: "update-profile", tenant, subject, displayName: "P2", baseVersion: 1 });
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  const resumed = new IdentityService({ store: store.store, clock: createFixedClock(9_999).clock });
  const restored = resumed.restore();
  assert.ok(restored.ok);
  const lookup = resumed.identityOf(tenant, subject);
  assert.ok(lookup.found);
  assert.equal(lookup.profile.displayName, "P2");
  assert.deepEqual(lookup.profile.aliases, ["one"]);
  assert.equal(resumed.profileHistory(tenant, subject).length, 2);
  assert.equal(resumed.historyOf(tenant, subject).length, 2);
});

test("service: restore refuses malformed and unknown snapshots", () => {
  const { service } = makeService();
  const nothing = service.restore();
  assert.ok(!nothing.ok && nothing.code === "unknown-snapshot");
  const empty = service.snapshot();
  assert.ok(!empty.ok && empty.code === "empty-state");
});

test("service: read models return copies, never live references", () => {
  const { service } = makeService();
  service.admit({ kind: "register", tenant, subject, displayName: "P", alias: "one" });
  const versions = service.profileHistory(tenant, subject);
  (versions[0]!.aliases as string[]).push("injected");
  assert.deepEqual(service.profileHistory(tenant, subject)[0]!.aliases, ["one"]);
  const history = service.historyOf(tenant, subject);
  (history[0]! as { detail: string }).detail = "tampered";
  assert.notEqual(service.historyOf(tenant, subject)[0]!.detail, "tampered");
});
