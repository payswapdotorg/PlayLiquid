/**
 * CAPABILITY-GAP TESTS (PL-029) — detection of missing capabilities,
 * opening findings as lab-contracts gap records (rung 1: the existing
 * organization, honestly unavailable), stepwise ladder advance with typed
 * rung refusals at every door: arena-first-resort, rung-skip,
 * blocked-is-terminal, gap-already-resolved (R18; lock 30/31/32).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CapabilityGapRecord, GapRungAttempt, OrganizationDescriptor } from "@playliquid/lab-contracts";
import { asArenaEscalationId, asContentDigest, asGapRecordId, asLabCycleId, asTimestampMs, validateGapRecord } from "@playliquid/lab-contracts";
import { asAgentId, asAgentId as gameId } from "@playliquid/game-contracts";
import { advanceGapResolution, asGapRecordId as parseGapId, detectCapabilityGaps, openGapFromFinding } from "./gaps.ts";
import { candidateDigestOf, gapFindingDigestOf, gapSlugId } from "./digest.ts";
import { fixtureDigest, fixtureModelAssignment } from "./fakes.ts";

function organization(over: { readonly id?: string; readonly capabilities?: readonly string[] } = {}): OrganizationDescriptor {
  const agent = gameId("agent-gap")!;
  const capabilities = (over.capabilities ?? []).map((capability) => ({ capability: capability as never, assignedTo: [agent] }));
  return {
    id: (over.id ?? "org-gap-default") as never,
    agents: [{ agent, roles: ["generalist"] as never, model: fixtureModelAssignment() }],
    capabilities,
    tools: [],
    topology: [],
    memory: { stores: [], access: [] },
    humanParticipation: { mode: "none", participants: [] },
    budget: [],
    scheduling: { mode: "event-driven" },
    review: { gates: [{ gateId: "gate-gap" as never, reviewers: [agent] }] },
  };
}

test("gaps: detection reports exactly the capabilities the candidate needs and the current organization lacks", () => {
  const current = organization({ capabilities: ["cap-held"] });
  const candidate = organization({ id: "org-gap-candidate", capabilities: ["cap-held", "cap-missing-a", "cap-missing-b"] });
  const findings = detectCapabilityGaps({ current, candidate });
  assert.deepEqual(
    findings.map((finding) => finding.missingCapability).sort(),
    ["cap-missing-a", "cap-missing-b"],
  );
  for (const finding of findings) {
    assert.equal(String(finding.currentOrganization), String(current.id));
    assert.equal(String(finding.candidateOrganization), String(candidate.id));
    assert.equal(String(finding.candidateDigest), String(candidateDigestOf(candidate)));
  }
});

test("gaps: no findings when the current organization holds everything", () => {
  const current = organization({ capabilities: ["cap-held", "cap-extra"] });
  const candidate = organization({ id: "org-gap-covered", capabilities: ["cap-held"] });
  assert.deepEqual(detectCapabilityGaps({ current, candidate }), []);
});

test("gaps: opening a finding starts the trail at the existing-organization rung (lock 30)", () => {
  const current = organization({ capabilities: [] });
  const candidate = organization({ id: "org-gap-needed", capabilities: ["cap-needed"] });
  const [finding] = [...detectCapabilityGaps({ current, candidate })];
  assert.ok(finding !== undefined);
  const opened = openGapFromFinding({ finding, tenant: "tenant-gaps", cycleId: asLabCycleId("cycle-gaps")!, openedAt: asTimestampMs(1_000)! }, []);
  assert.ok(opened.ok);
  assert.equal(opened.duplicate, false);
  assert.equal(opened.gap.attempts.length, 1);
  assert.equal(opened.gap.attempts[0]!.rung, "existing-organization");
  assert.equal(opened.gap.attempts[0]!.disposition, "unavailable");
  assert.equal(opened.gap.attempts[0]!.outcome, "unresolved");
  assert.ok(validateGapRecord(opened.gap).ok);
  assert.equal(String(opened.gap.gapId), String(gapSlugId(gapFindingDigestOf({ tenant: "tenant-gaps", missingCapability: "cap-needed", candidateDigest: finding.candidateDigest }))));
});

test("gaps: re-opening the same finding returns the recorded record (idempotent)", () => {
  const current = organization({ capabilities: [] });
  const candidate = organization({ id: "org-gap-idem", capabilities: ["cap-needed"] });
  const [finding] = [...detectCapabilityGaps({ current, candidate })];
  const open = { finding: finding!, tenant: "tenant-gaps", cycleId: asLabCycleId("cycle-gaps")!, openedAt: asTimestampMs(1_000)! };
  const first = openGapFromFinding(open, []);
  assert.ok(first.ok);
  const second = openGapFromFinding(open, [first.gap]);
  assert.ok(second.ok && second.duplicate);
  assert.equal(String(second.gap.gapId), String(first.gap.gapId));
});

test("gaps: the ladder advances one rung at a time and refuses skips (R18)", () => {
  const current = organization({ capabilities: [] });
  const candidate = organization({ capabilities: ["cap-needed"] });
  const [finding] = [...detectCapabilityGaps({ current, candidate })];
  const opened = openGapFromFinding({ finding: finding!, tenant: "tenant-gaps", cycleId: asLabCycleId("cycle-gaps")!, openedAt: asTimestampMs(1_000)! }, []);
  assert.ok(opened.ok);
  let gap = opened.gap;
  const skip = advanceGapResolution(gap, { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" });
  assert.ok(!skip.ok && skip.code === "rung-skip");
  const alternate = advanceGapResolution(gap, { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" });
  assert.ok(alternate.ok);
  gap = alternate.gap;
  assert.ok(validateGapRecord(gap).ok);
  assert.equal(gap.attempts.length, 2);
});

test("gaps: arena as the first resort is a typed arena-first-resort refusal", () => {
  const emptyTrail = { gapId: asGapRecordId("gap-empty-trail")!, cycleId: asLabCycleId("cycle-gaps")!, missingCapability: "cap-needed", summary: "synthetic empty-trail gap", openedAt: asTimestampMs(1)!, attempts: [] };
  const arenaFirst = advanceGapResolution(emptyTrail, { rung: "arena-escalation", disposition: "declined" });
  assert.ok(!arenaFirst.ok && arenaFirst.code === "arena-first-resort");
});

test("gaps: the full ladder walk ends at the typed blocked terminal", () => {
  const current = organization({ capabilities: [] });
  const candidate = organization({ capabilities: ["cap-needed"] });
  const [finding] = [...detectCapabilityGaps({ current, candidate })];
  const opened = openGapFromFinding({ finding: finding!, tenant: "tenant-gaps", cycleId: asLabCycleId("cycle-gaps")!, openedAt: asTimestampMs(1_000)! }, []);
  assert.ok(opened.ok);
  const attempts: readonly GapRungAttempt[] = [
    { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved", capability: "cap-needed" },
    { rung: "user-community-contribution", disposition: "declined" },
    { rung: "arena-escalation", disposition: "attempted", outcome: "unresolved", external: { external: "arena-external", escalationId: asArenaEscalationId("arena-gap-test")!, requestDigest: asContentDigest(fixtureDigest("arena-gap-request"))! } },
    { rung: "blocked", reason: "no provider resolved the capability" },
  ];
  let gap: CapabilityGapRecord = opened.gap;
  for (const attempt of attempts) {
    const advanced = advanceGapResolution(gap, attempt);
    assert.ok(advanced.ok, `rung ${attempt.rung} should advance`);
    gap = advanced.gap;
  }
  assert.equal(gap.attempts.length, 6);
  assert.equal(gap.attempts[5]!.rung, "blocked");
  assert.ok(validateGapRecord(gap).ok);
  const afterBlocked = advanceGapResolution(gap, { rung: "blocked", reason: "again" });
  assert.ok(!afterBlocked.ok && afterBlocked.code === "blocked-is-terminal");
});

test("gaps: a resolved gap takes no further rungs (gap-already-resolved)", () => {
  const current = organization({ capabilities: [] });
  const candidate = organization({ capabilities: ["cap-needed"] });
  const [finding] = [...detectCapabilityGaps({ current, candidate })];
  const opened = openGapFromFinding({ finding: finding!, tenant: "tenant-gaps", cycleId: asLabCycleId("cycle-gaps")!, openedAt: asTimestampMs(1_000)! }, []);
  assert.ok(opened.ok);
  const resolved = advanceGapResolution(opened.gap, { rung: "alternate-organization", disposition: "attempted", outcome: "resolved" });
  assert.ok(resolved.ok);
  assert.ok(validateGapRecord(resolved.gap).ok);
  const continued = advanceGapResolution(resolved.gap, { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" });
  assert.ok(!continued.ok && continued.code === "gap-already-resolved");
});

test("gaps: the rung-refusal codes surface through the wrapper with details", () => {
  const current = organization({ capabilities: [] });
  const candidate = organization({ capabilities: ["cap-needed"] });
  const [finding] = [...detectCapabilityGaps({ current, candidate })];
  const opened = openGapFromFinding({ finding: finding!, tenant: "tenant-gaps", cycleId: asLabCycleId("cycle-gaps")!, openedAt: asTimestampMs(1_000)! }, []);
  assert.ok(opened.ok);
  const refusal = advanceGapResolution(opened.gap, { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" });
  assert.ok(!refusal.ok);
  assert.ok(refusal.detail.length > 0);
});

test("gaps: gap record id parsing accepts slug ids and refuses garbage", () => {
  assert.ok(parseGapId("gap-abc123") !== undefined);
  assert.equal(parseGapId(""), undefined);
  assert.equal(parseGapId("NOT A SLUG"), undefined);
  assert.equal(parseGapId("x".repeat(64)), undefined);
});

test("gaps: agent ids parse through the game-contracts authority (no fork)", () => {
  assert.ok(asAgentId("agent-gap") !== undefined);
  assert.equal(asAgentId("bad id!"), undefined);
});
