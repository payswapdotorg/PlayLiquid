import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_ARTIFACT_CLASSES,
  ARENA_NO_ARTIFACTS_SCOPE,
  ARENA_POLICY_DENY_REASONS,
  EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG,
  appendArenaAuthorizationDecision,
  arenaAuthorizationScope,
  arenaAuthorizationScopeKey,
  asArenaPolicyId,
  isArenaArtifactClass,
  isArenaAuthorizationScope,
  scopeAllowsArtifact,
  validateArenaAuthorizationAuditLog,
} from "./authorization.ts";
import type {
  ArenaAuthorizationAuditLog,
  ArenaAuthorizationDecisionContent,
} from "./authorization.ts";
import type { ArenaContentDigest, ArenaEndpointRef } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureDecision(overrides: Partial<ArenaAuthorizationDecisionContent> = {}): ArenaAuthorizationDecisionContent {
  return {
    decision: "allow",
    policyId: asArenaPolicyId("lab-usage-rules")!,
    requestPayload: fixtureDigest("10"),
    endpoint: fixtureEndpoint("e0"),
    recordDigest: fixtureDigest("d0"),
    ...overrides,
  };
}

test("authorization: artifact class vocabulary is frozen and closed", () => {
  assert.deepEqual([...ARENA_ARTIFACT_CLASSES.values], ["capability", "tool", "skill", "knowledge"]);
  for (const value of ["capability", "tool", "skill", "knowledge"]) {
    assert.equal(isArenaArtifactClass(value), true);
  }
  assert.equal(isArenaArtifactClass("plugin"), false);
  assert.equal(isArenaArtifactClass("Capability"), false);
  assert.equal(isArenaArtifactClass(undefined), false);
});

test("authorization: scopes are allow-lists over artifact classes only", () => {
  assert.ok(isArenaAuthorizationScope(ARENA_NO_ARTIFACTS_SCOPE));
  assert.equal(scopeAllowsArtifact(ARENA_NO_ARTIFACTS_SCOPE, "capability"), false);

  const scope = arenaAuthorizationScope(["capability", "knowledge"]);
  assert.ok(isArenaAuthorizationScope(scope));
  assert.equal(scopeAllowsArtifact(scope, "capability"), true);
  assert.equal(scopeAllowsArtifact(scope, "knowledge"), true);
  assert.equal(scopeAllowsArtifact(scope, "tool"), false);
  assert.equal(scopeAllowsArtifact(scope, "skill"), false);

  // Duplicates are deduplicated on build and rejected by the guard.
  const deduped = arenaAuthorizationScope(["tool", "tool"]);
  assert.deepEqual([...deduped.artifactClasses], ["tool"]);
  assert.equal(
    isArenaAuthorizationScope({ scopeKind: "arena-authorization-scope", artifactClasses: ["tool", "tool"] }),
    false,
  );
  assert.equal(
    isArenaAuthorizationScope({ scopeKind: "arena-authorization-scope", artifactClasses: ["not-a-class"] }),
    false,
  );
  assert.equal(isArenaAuthorizationScope({ scopeKind: "other-scope", artifactClasses: [] }), false);
  assert.equal(isArenaAuthorizationScope({ artifactClasses: [] }), false);
  assert.equal(isArenaAuthorizationScope(null), false);

  // Canonical key is order-insensitive.
  assert.equal(arenaAuthorizationScopeKey(arenaAuthorizationScope(["knowledge", "capability"])), arenaAuthorizationScopeKey(scope));
});

test("authorization: policy deny reasons are a frozen closed vocabulary", () => {
  assert.deepEqual([...ARENA_POLICY_DENY_REASONS.values], [
    "request-kind-not-permitted",
    "artifact-class-not-permitted",
    "endpoint-not-permitted",
  ]);
});

test("authorization: policy ids follow house id-text rules", () => {
  assert.ok(asArenaPolicyId("lab-usage-rules"));
  assert.ok(asArenaPolicyId("p"));
  assert.equal(asArenaPolicyId("Not_A_Slug"), undefined);
  assert.equal(asArenaPolicyId("-leading"), undefined);
  assert.equal(asArenaPolicyId(""), undefined);
});

test("authorization: audit append derives seq and chain links, never mutates", () => {
  const first = appendArenaAuthorizationDecision(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, fixtureDecision());
  assert.ok(first.ok);
  assert.equal(first.record.seq, 0);
  assert.equal(first.record.previousRecordDigest, null);
  assert.equal(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG.entries.length, 0); // input log untouched

  const second = appendArenaAuthorizationDecision(first.log, fixtureDecision({ recordDigest: fixtureDigest("d1"), decision: "deny", reason: "artifact-class-not-permitted" }));
  assert.ok(second.ok);
  assert.equal(second.record.seq, 1);
  assert.equal(second.record.previousRecordDigest, first.record.recordDigest);
  assert.ok(validateArenaAuthorizationAuditLog(second.log).valid);
});

test("authorization: audit append refuses malformed and duplicate records", () => {
  const malformedPolicy = appendArenaAuthorizationDecision(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, fixtureDecision({ policyId: "not a slug" as never }));
  assert.ok(!malformedPolicy.ok);
  assert.equal(malformedPolicy.reason, "malformed-record");

  const malformedDigest = appendArenaAuthorizationDecision(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, fixtureDecision({ recordDigest: "sha256:zz" as never }));
  assert.ok(!malformedDigest.ok);
  assert.equal(malformedDigest.reason, "malformed-record");

  const first = appendArenaAuthorizationDecision(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, fixtureDecision());
  assert.ok(first.ok);
  const duplicate = appendArenaAuthorizationDecision(first.log, fixtureDecision({ decision: "deny", reason: "endpoint-not-permitted" }));
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.reason, "duplicate-record-digest");
});

test("authorization: audit chain integrity detects tampering, reordering, gaps", () => {
  const first = appendArenaAuthorizationDecision(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, fixtureDecision());
  assert.ok(first.ok);
  const second = appendArenaAuthorizationDecision(first.log, fixtureDecision({ recordDigest: fixtureDigest("d1") }));
  assert.ok(second.ok);
  const third = appendArenaAuthorizationDecision(second.log, fixtureDecision({ recordDigest: fixtureDigest("d2") }));
  assert.ok(third.ok);
  const log: ArenaAuthorizationAuditLog = third.log;
  assert.ok(validateArenaAuthorizationAuditLog(log).valid);

  // Drop the middle entry: chain link breaks and sequence numbers mismatch.
  const dropped: ArenaAuthorizationAuditLog = { entries: [log.entries[0]!, log.entries[2]!] };
  const droppedResult = validateArenaAuthorizationAuditLog(dropped);
  assert.ok(!droppedResult.valid);
  assert.ok(droppedResult.valid === false && droppedResult.reasons.includes("chain-link-broken"));

  // Reorder entries: sequence numbers mismatch.
  const reordered: ArenaAuthorizationAuditLog = { entries: [log.entries[1]!, log.entries[0]!, log.entries[2]!] };
  const reorderedResult = validateArenaAuthorizationAuditLog(reordered);
  assert.ok(!reorderedResult.valid);
  assert.ok(reorderedResult.valid === false && reorderedResult.reasons.includes("seq-mismatch"));

  // Tamper with the FIRST record's digest: the second entry's previous-link
  // no longer matches the tampered chain head. (Seed "ee" keeps the fixture
  // digest hex-distinct from every legitimate digest in the chain.)
  const tampered: ArenaAuthorizationAuditLog = {
    entries: [{ ...log.entries[0]!, recordDigest: fixtureDigest("ee") }, log.entries[1]!, log.entries[2]!],
  };
  const tamperedResult = validateArenaAuthorizationAuditLog(tampered);
  assert.ok(!tamperedResult.valid);
  assert.ok(tamperedResult.valid === false && tamperedResult.reasons.includes("chain-link-broken"));
});
