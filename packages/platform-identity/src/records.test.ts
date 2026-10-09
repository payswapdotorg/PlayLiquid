/**
 * Identity record/oracle tests: alias rules, guards, and every refusal
 * code of the pure admission oracle (E8 negative coverage).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ALIASES_PER_SUBJECT,
  adjudicateIdentityCommand,
  isIdentityRecord,
  isProfileVersion,
  isReservedAlias,
  isValidAliasText,
  isValidDisplayName,
} from "./records.ts";
import type { IdentityCommand, IdentityFacts } from "./records.ts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const other = asSubjectId("player-two")!;

function facts(over: Partial<IdentityFacts> = {}): IdentityFacts {
  return {
    subjectExists: true,
    subjectStatus: "active",
    currentVersion: 1,
    currentDisplayName: "Player One",
    currentAliases: ["one"],
    aliasOwner: undefined,
    ...over,
  };
}

test("records: alias text rules accept and refuse correctly", () => {
  assert.ok(isValidAliasText("one"));
  assert.ok(isValidAliasText("a"));
  assert.ok(isValidAliasText("player-two-2"));
  assert.ok(!isValidAliasText("One"));
  assert.ok(!isValidAliasText("-one"));
  assert.ok(!isValidAliasText("one-"));
  assert.ok(!isValidAliasText("a".repeat(25)));
  assert.ok(!isValidAliasText(""));
});

test("records: reserved aliases are recognized", () => {
  assert.ok(isReservedAlias("admin"));
  assert.ok(isReservedAlias("system"));
  assert.ok(!isReservedAlias("administrator"));
  assert.ok(!isReservedAlias("player-one"));
});

test("records: display name rules accept and refuse correctly", () => {
  assert.ok(isValidDisplayName("A"));
  assert.ok(isValidDisplayName("Player One"));
  assert.ok(!isValidDisplayName(""));
  assert.ok(!isValidDisplayName("   "));
  assert.ok(!isValidDisplayName("x".repeat(49)));
});

test("records: isIdentityRecord enforces the authority marker (E8)", () => {
  const base = {
    tenant,
    subject,
    status: "active",
    registeredAt: 1,
    decidedBy: "platform-authority",
  };
  assert.ok(isIdentityRecord(base));
  assert.ok(!isIdentityRecord({ ...base, decidedBy: "game-declared" }));
  assert.ok(!isIdentityRecord({ ...base, decidedBy: undefined }));
  assert.ok(!isIdentityRecord({ ...base, status: "banned" }));
  assert.ok(!isIdentityRecord({ ...base, registeredAt: -1 }));
  assert.ok(!isIdentityRecord({ ...base, registeredAt: 1.5 }));
  assert.ok(!isIdentityRecord(null));
});

test("records: isProfileVersion validates shape and aliases", () => {
  const base = {
    tenant,
    subject,
    version: 1,
    displayName: "Player One",
    aliases: ["one"],
    updatedAt: 1,
  };
  assert.ok(isProfileVersion(base));
  assert.ok(!isProfileVersion({ ...base, version: 0 }));
  assert.ok(!isProfileVersion({ ...base, version: 1.5 }));
  assert.ok(!isProfileVersion({ ...base, aliases: ["One"] }));
  assert.ok(!isProfileVersion({ ...base, displayName: "" }));
  assert.ok(!isProfileVersion({ ...base, updatedAt: -1 }));
});

test("records: register admits a fresh subject and refuses duplicates", () => {
  const command: IdentityCommand = {
    kind: "register",
    tenant,
    subject,
    displayName: "Player One",
    alias: "one",
  };
  assert.deepEqual(adjudicateIdentityCommand(command, facts({ subjectExists: false })), { accepted: true });
  const duplicate = adjudicateIdentityCommand(command, facts());
  assert.ok(!duplicate.accepted);
  assert.equal(duplicate.code, "duplicate-subject");
});

test("records: register refuses invalid display names and bad aliases", () => {
  const fresh = facts({ subjectExists: false });
  const badName = adjudicateIdentityCommand(
    { kind: "register", tenant, subject, displayName: "" },
    fresh,
  );
  assert.ok(!badName.accepted && badName.code === "invalid-display-name");
  const badAlias = adjudicateIdentityCommand(
    { kind: "register", tenant, subject, displayName: "P", alias: "Bad Alias" },
    fresh,
  );
  assert.ok(!badAlias.accepted && badAlias.code === "invalid-alias");
  const reserved = adjudicateIdentityCommand(
    { kind: "register", tenant, subject, displayName: "P", alias: "admin" },
    fresh,
  );
  assert.ok(!reserved.accepted && reserved.code === "reserved-alias");
});

test("records: assign-alias refuses unknown subject, retired identity, taken and duplicate aliases", () => {
  const command = { kind: "assign-alias" as const, tenant, subject, alias: "two" };
  assert.ok(!adjudicateIdentityCommand(command, facts({ subjectExists: false })).accepted);
  const retired = adjudicateIdentityCommand(command, facts({ subjectStatus: "retired" }));
  assert.ok(!retired.accepted && retired.code === "identity-retired");
  const taken = adjudicateIdentityCommand(command, facts({ aliasOwner: other }));
  assert.ok(!taken.accepted && taken.code === "alias-taken");
  const duplicate = adjudicateIdentityCommand(command, facts({ aliasOwner: subject }));
  assert.ok(!duplicate.accepted && duplicate.code === "duplicate-alias");
  const limit = adjudicateIdentityCommand(command, facts({ currentAliases: ["a", "b", "c", "d", "e"] }));
  assert.ok(!limit.accepted && limit.code === "alias-limit-reached");
  assert.equal(MAX_ALIASES_PER_SUBJECT, 5);
});

test("records: retire-alias refuses aliases the subject does not hold", () => {
  const command = { kind: "retire-alias" as const, tenant, subject, alias: "one" };
  assert.deepEqual(adjudicateIdentityCommand(command, facts()), { accepted: true });
  const missing = adjudicateIdentityCommand(command, facts({ currentAliases: [] }));
  assert.ok(!missing.accepted && missing.code === "alias-not-held");
});

test("records: update-profile fences on stale base version and no-op content", () => {
  const command = { kind: "update-profile" as const, tenant, subject, displayName: "Uno", baseVersion: 1 };
  assert.deepEqual(adjudicateIdentityCommand(command, facts()), { accepted: true });
  const stale = adjudicateIdentityCommand(command, facts({ currentVersion: 2 }));
  assert.ok(!stale.accepted && stale.code === "stale-version");
  const future = adjudicateIdentityCommand(command, facts({ currentVersion: 0 }));
  assert.ok(!future.accepted && future.code === "stale-version");
  const noOp = adjudicateIdentityCommand(
    { ...command, displayName: "Player One" },
    facts(),
  );
  assert.ok(!noOp.accepted && noOp.code === "no-op-update");
});

test("records: retire refuses unknown and already-retired identities", () => {
  const command = { kind: "retire" as const, tenant, subject };
  assert.deepEqual(adjudicateIdentityCommand(command, facts()), { accepted: true });
  const unknown = adjudicateIdentityCommand(command, facts({ subjectExists: false }));
  assert.ok(!unknown.accepted && unknown.code === "unknown-subject");
  const retired = adjudicateIdentityCommand(command, facts({ subjectStatus: "retired" }));
  assert.ok(!retired.accepted && retired.code === "identity-retired");
});

test("records: invalid tenant/subject text is refused before anything else", () => {
  const badTenant = adjudicateIdentityCommand(
    { kind: "register", tenant: "" as never, subject, displayName: "P" },
    facts({ subjectExists: false }),
  );
  assert.ok(!badTenant.accepted && badTenant.code === "invalid-tenant");
  const badSubject = adjudicateIdentityCommand(
    { kind: "register", tenant, subject: "" as never, displayName: "P" },
    facts({ subjectExists: false }),
  );
  assert.ok(!badSubject.accepted && badSubject.code === "invalid-subject");
});
