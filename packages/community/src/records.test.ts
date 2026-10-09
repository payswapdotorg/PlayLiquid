/**
 * Records vocabulary tests: frozen tables, guards, provenance shapes,
 * and the tamper-evidence of content-addressed vocabulary (E8).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTRIBUTION_KINDS,
  CONTRIBUTION_STATUSES,
  CONTRIBUTION_TRANSITIONS,
  TRANSITION_COMMANDS,
  COMMAND_FROM_STATES,
  asContributionId,
  asCycleId,
  asGapId,
  canTransitionContribution,
  isCapabilityGapLink,
  isContributionKind,
  isContributionOrigin,
  isContributionProvenanceInput,
  isContributionRecord,
  isContributionStatus,
  isModelProvenanceEntry,
  isTerminalContributionStatus,
  isTransitionCommandKind,
} from "./records.ts";
import { isContributionTransitionRecord, submissionTransitionOf, transitionRecordIdOf } from "./history.ts";
import { fakeLineageNode, fakePayload, ids, at } from "./fakes.ts";
import { computeDigest } from "@playliquid/package-system";

test("records: the contribution kind vocabulary is the architecture's community list", () => {
  assert.equal(CONTRIBUTION_KINDS.length, 12);
  assert.ok(isContributionKind("issue"));
  assert.ok(isContributionKind("replay-backed-report"));
  assert.ok(isContributionKind("voice-performance"));
  assert.ok(isContributionKind("pull-request"));
  assert.ok(!isContributionKind("feature-request"));
  assert.ok(!isContributionKind("Issue"));
  assert.ok(isContributionStatus("under-review"));
  assert.ok(!isContributionStatus("in-review"));
});

test("records: the workflow states and their frozen transition table", () => {
  assert.deepEqual([...CONTRIBUTION_STATUSES], [
    "submitted",
    "triaged",
    "under-review",
    "accepted",
    "rejected",
    "withdrawn",
  ]);
  // The work order's literal chain: one step at a time, verdicts are
  // under-review exits, terminals accept nothing.
  assert.ok(canTransitionContribution("submitted", "triaged"));
  assert.ok(canTransitionContribution("triaged", "under-review"));
  assert.ok(canTransitionContribution("under-review", "accepted"));
  assert.ok(canTransitionContribution("under-review", "rejected"));
  assert.ok(canTransitionContribution("under-review", "withdrawn"));
  // No skipping, no early verdicts, no reopening.
  assert.ok(!canTransitionContribution("submitted", "under-review"));
  assert.ok(!canTransitionContribution("submitted", "withdrawn"));
  assert.ok(!canTransitionContribution("triaged", "accepted"));
  assert.ok(!canTransitionContribution("triaged", "rejected"));
  assert.ok(!canTransitionContribution("triaged", "withdrawn"));
  // Terminal states accept nothing.
  for (const terminal of ["accepted", "rejected", "withdrawn"] as const) {
    assert.ok(isTerminalContributionStatus(terminal));
    assert.equal(CONTRIBUTION_TRANSITIONS[terminal].length, 0);
  }
  assert.ok(!isTerminalContributionStatus("submitted"));
});

test("records: command/from-state table agrees with the transition table", () => {
  assert.deepEqual([...TRANSITION_COMMANDS], ["triage", "review", "accept", "reject", "withdraw"]);
  for (const kind of TRANSITION_COMMANDS) {
    for (const from of COMMAND_FROM_STATES[kind]) {
      const targets = CONTRIBUTION_TRANSITIONS[from];
      assert.ok(
        targets.some(() => true),
        `${kind} from ${from} must be a non-terminal state`,
      );
      assert.ok(!isTerminalContributionStatus(from), `${kind} may not issue from terminal ${from}`);
    }
  }
  // Every state reachable by some command must exist in the table.
  assert.deepEqual([...COMMAND_FROM_STATES.reject], ["under-review"]);
  assert.deepEqual([...COMMAND_FROM_STATES.withdraw], ["under-review"]);
  assert.ok(!isTransitionCommandKind("close"));
});

test("records: gap link ids follow the canonical reference grammar", () => {
  assert.ok(isCapabilityGapLink({ gapId: asGapId("gap-1")!, cycleId: asCycleId("cycle-1")! }));
  assert.equal(asGapId("Gap-1"), undefined);
  assert.equal(asGapId(""), undefined);
  assert.equal(asGapId("gap_1"), undefined);
  assert.equal(asCycleId("cycle 1"), undefined);
  assert.ok(!isCapabilityGapLink({ gapId: "gap-1" }));
  assert.ok(!isCapabilityGapLink(null));
});

test("records: contribution ids are package-system content digests", () => {
  const digest = computeDigest({ fixture: "id" });
  assert.ok(asContributionId(digest));
  assert.equal(asContributionId("deadbeef"), undefined);
  assert.equal(asContributionId(digest.slice("sha256:".length)), undefined);
});

test("records: original origins pass; forged lineage nodes fail (E8)", () => {
  assert.ok(isContributionOrigin({ kind: "original" }));
  const node = fakeLineageNode("base-pack");
  assert.ok(isContributionOrigin({ kind: "lineage-derived", base: node }));
  // Forged node id: not the content address of its own coordinate.
  const forged = { coordinate: node.coordinate, nodeId: computeDigest({ tampered: true }) };
  assert.ok(!isContributionOrigin({ kind: "lineage-derived", base: forged }));
  assert.ok(!isContributionOrigin({ kind: "derived-from-somewhere" }));
  assert.ok(!isContributionOrigin(null));
});

test("records: provenance input guards AI disclosure entries", () => {
  assert.ok(isContributionProvenanceInput({ origin: { kind: "original" }, aiGenerated: false }));
  assert.ok(
    isContributionProvenanceInput({
      origin: { kind: "original" },
      aiGenerated: true,
      modelProvenance: [{ model: "m", provider: "p", usage: "generation", disclosed: true }],
    }),
  );
  assert.ok(!isContributionProvenanceInput({ origin: { kind: "original" }, aiGenerated: "no" }));
  assert.ok(!isContributionProvenanceInput({ origin: { kind: "original" }, aiGenerated: false, modelProvenance: "none" }));
  // Malformed disclosure entries fail the guard (canonicalizable input only).
  assert.ok(
    !isContributionProvenanceInput({
      origin: { kind: "original" },
      aiGenerated: true,
      modelProvenance: [{ model: "m", provider: "p", usage: "no-such-usage", disclosed: true }],
    }),
  );
  assert.ok(!isModelProvenanceEntry({ model: "", provider: "p", usage: "generation", disclosed: true }));
  assert.ok(isModelProvenanceEntry({ model: "m", provider: "p", usage: "transformation", disclosed: false }));
});

test("records: the record guard admits well-formed records only", () => {
  const record = {
    contributionId: computeDigest({ fixture: "record" }),
    tenant: ids.tenant("tenant-a"),
    contributor: ids.subject("player-one"),
    kind: "code",
    payload: fakePayload({ title: "fix" }),
    provenance: {
      contributor: ids.subject("player-one"),
      origin: { kind: "original" },
      contentDigest: computeDigest({ fixture: "record" }),
      aiGenerated: false,
      modelProvenance: [],
    },
    status: "submitted",
    submittedAt: at(1),
    decidedBy: "platform-authority",
  };
  assert.ok(isContributionRecord(record));
  assert.ok(!isContributionRecord({ ...record, status: "closed" }));
  assert.ok(!isContributionRecord({ ...record, decidedBy: "client" }));
  assert.ok(!isContributionRecord({ ...record, payload: { kind: "nope" } }));
});

test("history: transition records are content-addressed and tamper-evident", () => {
  const tenant = ids.tenant("tenant-a");
  const contributionId = asContributionId(computeDigest({ fixture: "t" }))!;
  const genesis = submissionTransitionOf(tenant, contributionId, ids.subject("player-one"), at(5));
  assert.ok(isContributionTransitionRecord(genesis));
  assert.equal(genesis.from, null);
  assert.equal(genesis.to, "submitted");
  // Any mutation of the body breaks its own content address.
  const tampered = { ...genesis, to: "accepted" };
  assert.ok(!isContributionTransitionRecord(tampered));
  const swapped = { ...genesis, recordId: computeDigest({ swapped: true }) };
  assert.ok(!isContributionTransitionRecord(swapped));
  // The id function is deterministic.
  assert.equal(
    transitionRecordIdOf({
      tenant,
      contributionId,
      actor: ids.subject("player-one"),
      from: null,
      to: "submitted",
      recordedAt: at(5),
    }),
    genesis.recordId,
  );
});
