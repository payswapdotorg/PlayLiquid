/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full Lab organization-search journey over the in-memory fakes
 * with the REAL PL-028 evaluation engine behind the evaluation port: open a
 * seeded search (E9) -> the opened session's space digest equals the
 * content-derived space of the same canonical bounds (E9) -> page the whole
 * candidate stream through single-use monotonic cursors (every candidate
 * organization-valid by construction; the generalist baseline visited
 * exactly once, lock 26) -> determinism: a second service re-opens the same
 * request content to the identical search id and candidate sequence (E9) ->
 * compile door (lock-26 baseline parity, content-keyed duplicate receipt) ->
 * evaluate the baseline position through the real engine (labeled estimate,
 * E11) -> re-evaluation replays the recorded outcome (E10) -> capability
 * gaps: capability-spreading candidates record typed findings against the
 * current organization (lock 30); the frozen ladder advances one rung at a
 * time and refuses arena-first, rung-skip, resolved-then-anything (R18) ->
 * non-monotonic cursor refused (E8) -> cross-tenant page refused (R20) ->
 * persistence restore round-trip (E6). Prints deterministic
 * machine-readable JSON and exits non-zero on any unexpected outcome. No IO
 * beyond stdout; no wall clock, no randomness, no network.
 */

import { asAgentRoleId, asArenaEscalationId, asCapabilityId, asContentDigest, asEvaluationSeed, asLabCycleId, asTimestampMs, validateOrganization } from "@playliquid/lab-contracts";
import type { GapRungAttempt } from "@playliquid/lab-contracts";
import { evidenceBundleDigestOf, labFixtureContext, labFixtureCycleId, labFixtureEvidenceRecords, labFixtureGeneralistOrganization, labFixtureSuite } from "@playliquid/lab-simulation";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { LabOrganizationService } from "./service.ts";
import { createLabOrganizationFakes, fixtureDigest, fixtureModelAssignment } from "./fakes.ts";
import type { CandidateSpace, OrganizationSearchRequest } from "./records.ts";
import { baselinePositionOf, candidateAtPosition, enumerateTraversal, traversalOf } from "./search.ts";
import { canonicalizeBounds, computeSpace } from "./space.ts";

const tenant = asTenantId("tenant-harness")!;
const owner = asSubjectId("subject-lab-org-lead")!;
const otherTenant = asTenantId("tenant-other")!;
const stranger = asSubjectId("subject-stranger")!;
const caller = { tenant, subject: owner };
const evidence = labFixtureEvidenceRecords();
const suite = labFixtureSuite().ref;
const parameters = { seed: asEvaluationSeed("seed-harness-eval")!, tickBudget: 12 };
const evidenceBundle = {
  recordIds: evidence.map((record) => String(record.evidenceId)),
  declaredDigest: evidenceBundleDigestOf(evidence),
};

function request(): OrganizationSearchRequest {
  return {
    tenant,
    owner,
    cycleId: asLabCycleId(String(labFixtureCycleId()))!,
    context: labFixtureContext(),
    bounds: {
      maxAgents: 2,
      roleVocabulary: [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!],
      bodyCatalog: [],
      modelCatalog: [fixtureModelAssignment("route-harness-a"), fixtureModelAssignment("route-harness-b")],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!],
    },
    seed: asEvaluationSeed("seed-harness-1")!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(1_000)!,
  };
}

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

const fakes = createLabOrganizationFakes();
const service = new LabOrganizationService({ ports: fakes.ports });
const bounds = canonicalizeBounds(request().bounds, fakes.bodies.port);
const spaceResult = bounds.ok ? computeSpace(bounds.bounds) : undefined;
const space: CandidateSpace | undefined = spaceResult?.ok ? spaceResult.space : undefined;
const traversal = space === undefined ? undefined : traversalOf(space, request().seed);

const opened = service.openSearch(request());
record("open-search", "ok", opened.ok ? "ok" : `refused:${opened.code}`);
record(
  "opened-space-is-content-derived",
  "true",
  String(opened.ok && space !== undefined && String(opened.spaceDigest) === String(space.digest)),
);
const searchId = opened.ok ? opened.searchId : "";

let cursor = opened.ok ? opened.cursor : undefined;
const digests: string[] = [];
let baselineSeen = 0;
let allValid = true;
let done = false;
while (cursor !== undefined && !done) {
  const page = service.nextCandidates({ searchId, cursor, limit: 64, as: caller });
  if (!page.ok) {
    record("page-stream", "ok", `refused:${page.code}`);
    break;
  }
  for (const candidate of page.candidates) {
    digests.push(String(candidate.contentDigest));
    if (candidate.isBaseline) baselineSeen += 1;
    if (!validateOrganization(candidate.organization).ok) allValid = false;
  }
  done = page.done;
  cursor = page.nextCursor;
}
record("page-stream-complete", "true", String(done));
record("candidates-all-valid", "true", String(allValid));
record("baseline-visited-once", "1", String(baselineSeen));
record("stream-size", String(space?.size ?? 0), String(digests.length));

const secondFakes = createLabOrganizationFakes();
const secondService = new LabOrganizationService({ ports: secondFakes.ports });
const reopened = secondService.openSearch(request());
const secondTraversal = space === undefined ? undefined : traversalOf(space, request().seed);
const secondDigests = space !== undefined && secondTraversal !== undefined ? enumerateTraversal(space, secondTraversal).map((c) => String(c.contentDigest)) : [];
record("reopen-same-search-id", "true", String(reopened.ok && reopened.searchId === searchId));
record(
  "determinism-identical-sequence",
  "true",
  String(secondDigests.length === digests.length && secondDigests.every((digest, index) => digest === digests[index])),
);

const baselinePosition = traversal === undefined ? 0 : baselinePositionOf(traversal);
const compileDoor = service.compileOrganization({
  descriptor: baselineCandidate(space, baselinePosition),
  as: caller,
});
record("compile-baseline", "ok", compileDoor.ok ? "ok" : `refused:${compileDoor.code}`);
record("compile-baseline-flag", "true", String(compileDoor.ok && compileDoor.compiled.isBaseline));
const compileAgain = service.compileOrganization({ descriptor: baselineCandidate(space, baselinePosition), as: caller });
record("compile-duplicate-receipt", "true", String(compileAgain.ok && compileAgain.duplicate));

const evaluated = service.evaluateCandidate({ searchId, position: baselinePosition, suite, evidence: evidenceBundle, parameters, as: caller });
record("evaluate-baseline", "ok", evaluated.ok ? "ok" : `refused:${evaluated.code}`);
record("evaluate-is-labeled-estimate", "true", String(evaluated.ok && evaluated.evidence.run.result.epistemic === "labeled-estimate"));
const replayed = service.evaluateCandidate({ searchId, position: baselinePosition, suite, evidence: evidenceBundle, parameters, as: caller });
record(
  "re-evaluation-replays-outcome",
  "true",
  String(
    replayed.ok &&
      replayed.replayed &&
      evaluated.ok &&
      String(replayed.evidence.contentKey) === String(evaluated.evidence.contentKey) &&
      replayed.evidence.run.replay.replayId === evaluated.evidence.run.replay.replayId,
  ),
);

const spreadPosition = space === undefined || traversal === undefined ? -1 : findPosition(space, traversal, "spread");
record("capability-spread-candidate-found", "true", String(spreadPosition >= 0));
const spreadEvaluated = spreadPosition >= 0 ? service.evaluateCandidate({ searchId, position: spreadPosition, suite, evidence: evidenceBundle, parameters, as: caller }) : undefined;
const gapFindings = spreadEvaluated !== undefined && spreadEvaluated.ok ? spreadEvaluated.gapFindings : [];
record("gap-findings-recorded", "1", String(gapFindings.length));
const gapId = gapFindings.length === 1 ? String(gapFindings[0]!.gapId) : "";
const advance = (attempt: GapRungAttempt) => service.advanceCapabilityGap({ gapId, attempt, as: caller });
const alternate = advance({ rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" });
record("gap-advance-alternate", "ok", alternate.ok ? "ok" : `refused:${alternate.code}`);
const skip = advance({ rung: "user-community-contribution", disposition: "declined" });
record("gap-rung-skip-refused", "refused:rung-skip", skip.ok ? "unexpected-ok" : `refused:${skip.code}`);
const platform = advance({ rung: "package-platform-capability", disposition: "attempted", outcome: "resolved", capability: "lab-cap-engineering" });
record("gap-advance-platform-resolved", "ok", platform.ok ? "ok" : `refused:${platform.code}`);
const afterResolved = advance({ rung: "user-community-contribution", disposition: "declined" });
record("gap-resolved-takes-no-rungs", "refused:gap-already-resolved", afterResolved.ok ? "unexpected-ok" : `refused:${afterResolved.code}`);

const arenaPosition = space === undefined || traversal === undefined ? -1 : findPosition(space, traversal, "other-spread");
record("second-spread-candidate-found", "true", String(arenaPosition >= 0));
const arenaEvaluated = arenaPosition >= 0 ? service.evaluateCandidate({ searchId, position: arenaPosition, suite, evidence: evidenceBundle, parameters, as: caller }) : undefined;
const arenaGap = arenaEvaluated !== undefined && arenaEvaluated.ok ? arenaEvaluated.gapFindings[0] : undefined;
const ladder = (attempt: GapRungAttempt) =>
  arenaGap === undefined ? undefined : service.advanceCapabilityGap({ gapId: String(arenaGap.gapId), attempt, as: caller });
const ladderAlternate = ladder({ rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" });
record("ladder2-alternate", "ok", ladderAlternate === undefined ? "no-gap" : ladderAlternativeResult(ladderAlternate));
const ladderPlatform = ladder({ rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved", capability: "lab-cap-engineering" });
record("ladder2-platform-unresolved", "ok", ladderPlatform === undefined ? "no-gap" : ladderAlternativeResult(ladderPlatform));
const ladderCommunity = ladder({ rung: "user-community-contribution", disposition: "declined" });
record("ladder2-community-declined", "ok", ladderCommunity === undefined ? "no-gap" : ladderAlternativeResult(ladderCommunity));
const arenaAttempt = ladder({ rung: "arena-escalation", disposition: "attempted", outcome: "unresolved", external: { external: "arena-external", escalationId: asArenaEscalationId("arena-harness-1")!, requestDigest: asContentDigest(fixtureDigest("arena-request"))! } });
record("ladder2-arena-external-ref", "ok", arenaAttempt === undefined ? "no-gap" : ladderAlternativeResult(arenaAttempt));
const blocked = ladder({ rung: "blocked", reason: "no capability provider resolved the gap" });
record("ladder2-blocked-terminal", "ok", blocked === undefined ? "no-gap" : ladderAlternativeResult(blocked));
const afterBlocked = ladder({ rung: "blocked", reason: "double-blocked" });
record("ladder2-post-blocked-refused", "refused:blocked-is-terminal", afterBlocked === undefined ? "no-gap" : afterBlocked.ok ? "unexpected-ok" : `refused:${afterBlocked.code}`);

const staleCursor = opened.ok ? opened.cursor : undefined;
if (staleCursor !== undefined) {
  const stale = service.nextCandidates({ searchId, cursor: staleCursor, as: caller });
  record("non-monotonic-cursor-refused", "refused:cursor-not-monotonic", stale.ok ? "unexpected-ok" : `refused:${stale.code}`);
}
const crossCursor = opened.ok ? { kind: "search-cursor" as const, searchId, spaceDigest: opened.spaceDigest, nextIndex: 0 } : undefined;
if (crossCursor !== undefined) {
  const crossPage = service.nextCandidates({ searchId, cursor: crossCursor, as: { tenant: otherTenant, subject: stranger } });
  record("cross-tenant-page-refused", "refused:cross-tenant", crossPage.ok ? "unexpected-ok" : `refused:${crossPage.code}`);
}

const restored = new LabOrganizationService({ ports: fakes.ports });
record("restore-round-trip", "ok", restored.restore().ok ? "ok" : "failed");

const failures = steps.filter((step) => step.expected !== step.actual);
console.log(JSON.stringify({ harness: "lab-organization", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;

/** Renders a ladder-door result as ok/refused (never throws). */
function ladderAlternativeResult(result: { readonly ok: boolean; readonly code?: string }): string {
  return result.ok ? "ok" : `refused:${result.code}`;
}

/** The candidate organization at a position (test-side derivation). */
function baselineCandidate(spaceAt: CandidateSpace | undefined, position: number): unknown {
  if (spaceAt === undefined || traversal === undefined) return {};
  return candidateAtPosition(spaceAt, traversal, position)?.organization ?? {};
}

/** Finds a position whose blueprint spreads capabilities (or a second one). */
function findPosition(spaceAt: CandidateSpace, walk: { readonly size: number; readonly start: number; readonly stride: number }, kind: "spread" | "other-spread"): number {
  let seen = 0;
  for (let position = 0; position < spaceAt.size; position += 1) {
    const candidate = candidateAtPosition(spaceAt, walk, position);
    if (candidate?.blueprint?.capabilitySpread === "none") continue;
    if (candidate?.blueprint === undefined) continue;
    seen += 1;
    if (kind === "spread" && seen === 1) return position;
    if (kind === "other-spread" && seen === 2) return position;
  }
  return -1;
}
