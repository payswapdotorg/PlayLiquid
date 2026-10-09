/**
 * Service pipeline tests: the full workflow over fakes — submission
 * recording, maintainer pipeline, E10 receipts, append-only history,
 * revision discipline, snapshot/restore round-trips (including bigint
 * payloads), and maintainer/withdraw authority.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { CommunityService } from "./service.ts";
import type { SubmitContributionCommand, TransitionCommand } from "./admission.ts";
import {
  createFixedClock,
  createMemoryCommunityStore,
  createMemoryGapDirectory,
  createMemoryPackageRegistry,
  createMemorySubjectDirectory,
  fakeGapLink,
  fakeLineageNode,
  fakePayload,
  ids,
} from "./fakes.ts";
import { asContributionId } from "./records.ts";
import { transitionCommandKeyOf } from "./history.ts";

const tenant = ids.tenant("tenant-alpha");
const contributor = ids.subject("player-one");
const maintainer = ids.subject("mod-one");

function makeService(over: { readonly maxOpen?: number } = {}) {
  const store = createMemoryCommunityStore();
  const clock = createFixedClock();
  const directory = createMemorySubjectDirectory();
  directory.register(tenant, contributor);
  directory.registerMaintainer(tenant, maintainer);
  const gaps = createMemoryGapDirectory();
  gaps.declare("gap-1", "cycle-1", { communityRungReached: true });
  const packages = createMemoryPackageRegistry();
  const service = new CommunityService({
    store: store.store,
    clock: clock.clock,
    directory: directory.directory,
    gaps: gaps.gaps,
    packages: packages.registry,
    policy: { maxOpenContributionsPerContributor: over.maxOpen ?? 5 },
  });
  return { store, clock, directory, gaps, packages, service };
}

function submitCommand(over: Partial<SubmitContributionCommand> = {}): SubmitContributionCommand {
  return {
    tenant,
    contributor,
    kind: "code",
    payload: fakePayload({ title: "fix" }),
    provenance: { origin: { kind: "original" }, aiGenerated: false },
    ...over,
  };
}

test("service: an admitted submission records the contribution and its genesis history entry", () => {
  const { service } = makeService();
  const result = service.submit(submitCommand());
  assert.ok(result.accepted);
  assert.equal(result.contribution.status, "submitted");
  assert.equal(result.contribution.decidedBy, "platform-authority");
  assert.match(String(result.contribution.contributionId), /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.contribution.provenance.contentDigest, result.contribution.contributionId);
  const history = service.history(tenant, result.contribution.contributionId);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.from, null);
  assert.equal(history[0]!.to, "submitted");
  assert.equal(history[0]!.decidedBy, "platform-authority");
});

test("service: the maintainer pipeline walks submitted -> triaged -> under-review -> accepted", () => {
  const { service } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  const triaged = service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer, reason: "looks good" });
  assert.ok(triaged.accepted);
  assert.equal(triaged.status, "triaged");
  const reviewed = service.transition({ tenant, contributionId: id, kind: "review", actor: maintainer });
  assert.ok(reviewed.accepted);
  assert.equal(reviewed.status, "under-review");
  const accepted = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(accepted.accepted);
  assert.equal(accepted.status, "accepted");
  assert.equal(service.contribution(tenant, id)?.status, "accepted");
  // History is append-only and ordered: genesis, triage, review, accept.
  const history = service.history(tenant, id);
  assert.deepEqual(history.map((entry) => entry.to), ["submitted", "triaged", "under-review", "accepted"]);
  assert.deepEqual(history.map((entry) => entry.from), [null, "submitted", "triaged", "under-review"]);
});

test("service: reject lands from under-review (the verdict exit)", () => {
  const { service } = makeService();
  const one = service.submit(submitCommand({ payload: fakePayload({ title: "one" }) }));
  assert.ok(one.accepted);
  const id = one.contribution.contributionId;
  // Rejecting before review is refused: verdicts are under-review exits.
  const early = service.transition({ tenant, contributionId: id, kind: "reject", actor: maintainer, reason: "too soon" });
  assert.ok(!early.accepted);
  assert.equal(early.code, "invalid-transition");
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  service.transition({ tenant, contributionId: id, kind: "review", actor: maintainer });
  const rejected = service.transition({ tenant, contributionId: id, kind: "reject", actor: maintainer, reason: "not a fit" });
  assert.ok(rejected.accepted);
  assert.equal(rejected.status, "rejected");
});

test("service: the contributor withdraws their own contribution from under-review", () => {
  const { service } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  service.transition({ tenant, contributionId: id, kind: "review", actor: maintainer });
  const withdrawn = service.transition({
    tenant,
    contributionId: id,
    kind: "withdraw",
    actor: contributor,
    reason: "pulling back",
  });
  assert.ok(withdrawn.accepted);
  assert.equal(withdrawn.status, "withdrawn");
});

test("service: a rejected command records nothing (retry is a fresh encounter)", () => {
  const { service } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  // accept from submitted is illegal
  const refused = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(!refused.accepted);
  assert.equal(refused.code, "invalid-transition");
  assert.equal(service.history(tenant, id).length, 1);
  // the corrected retry walks the pipeline normally
  assert.ok(service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer }).accepted);
  assert.equal(service.history(tenant, id).length, 2);
});

test("service: revision advances 1:1 with admitted mutations only", () => {
  const { service } = makeService();
  const before = service.snapshot; // ensure snapshot exists on prototype
  assert.ok(before);
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  service.transition({ tenant, contributionId: id, kind: "review", actor: maintainer });
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  assert.equal(snapshot.revision, 3); // submission + triage + review
});

test("service: snapshots round-trip with bigint payloads intact", () => {
  const { service } = makeService();
  const submitted = service.submit(
    submitCommand({ payload: fakePayload({ count: 42n, title: "bigint-payload" }) }),
  );
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  const restored = service.restore();
  assert.ok(restored.ok);
  const after = service.contribution(tenant, id);
  assert.ok(after);
  assert.equal(after.status, "triaged");
  // The bigint payload survived the codec round-trip byte-exact.
  const field = (after.payload as { fields: { count?: { value: bigint } } }).fields.count;
  assert.equal(field?.value, 42n);
  assert.equal(typeof field?.value, "bigint");
  // History survives too.
  assert.deepEqual(service.history(tenant, id).map((entry) => entry.to), ["submitted", "triaged"]);
});

test("service: restore of an unknown snapshot is refused, not faked", () => {
  const { service } = makeService();
  const outcome = service.restore(asContributionId("sha256:" + "a".repeat(64))!);
  assert.ok(!outcome.ok);
  assert.equal(outcome.code, "unknown-snapshot");
});

test("service: an empty service refuses to snapshot", () => {
  const { service } = makeService();
  const outcome = service.snapshot();
  assert.ok(!outcome.ok);
  assert.equal(outcome.code, "empty-state");
});

test("service: gap-linked contributions are queryable by gap id", () => {
  const { service } = makeService();
  const linked = service.submit(submitCommand({ gap: fakeGapLink("gap-1", "cycle-1") }));
  const unlinked = service.submit(submitCommand({ payload: fakePayload({ title: "plain" }) }));
  assert.ok(linked.accepted && unlinked.accepted);
  const forGap = service.gapContributions(tenant, "gap-1");
  assert.equal(forGap.length, 1);
  assert.equal(String(forGap[0]!.gap?.gapId), "gap-1");
  assert.equal(service.gapContributions(tenant, "gap-404").length, 0);
});

test("service: contributionsOf filters by tenant and optional contributor", () => {
  const { service, directory } = makeService();
  const other = ids.subject("player-two");
  directory.register(tenant, other);
  service.submit(submitCommand());
  service.submit(submitCommand({ contributor: other, payload: fakePayload({ title: "other" }) }));
  assert.equal(service.contributionsOf(tenant).length, 2);
  assert.equal(service.contributionsOf(tenant, other).length, 1);
  assert.equal(service.contributionsOf(tenant, other)[0]!.contributor, other);
});

test("service: the open-contribution quota is enforced per tenant+contributor", () => {
  const { service } = makeService({ maxOpen: 1 });
  const first = service.submit(submitCommand());
  assert.ok(first.accepted);
  const second = service.submit(submitCommand({ payload: fakePayload({ title: "second" }) }));
  assert.ok(!second.accepted);
  assert.equal(second.code, "contributor-quota-full");
  // Withdraw the first (through under-review): capacity frees again.
  service.transition({ tenant, contributionId: first.contribution.contributionId, kind: "triage", actor: maintainer });
  service.transition({ tenant, contributionId: first.contribution.contributionId, kind: "review", actor: maintainer });
  assert.ok(
    service.transition({ tenant, contributionId: first.contribution.contributionId, kind: "withdraw", actor: contributor }).accepted,
  );
  const retry = service.submit(submitCommand({ payload: fakePayload({ title: "second" }) }));
  assert.ok(retry.accepted);
});

test("service: transition command replays return the recorded receipt (E10)", () => {
  const { service } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  const command: TransitionCommand = { tenant, contributionId: id, kind: "triage", actor: maintainer, reason: "triaged once" };
  const first = service.transition(command);
  assert.ok(first.accepted);
  const replay = service.transition(command);
  assert.ok(!replay.accepted);
  assert.equal(replay.code, "duplicate-transition");
  assert.ok(replay.recorded !== undefined);
  assert.equal(replay.recorded!.recordId, first.record.recordId);
  // A DIFFERENT reason is a different command: state machine refuses.
  const variant = service.transition({ ...command, reason: "triaged again" });
  assert.ok(!variant.accepted);
  assert.equal(variant.code, "invalid-transition");
  // The command key derivation is stable (digest over command content).
  assert.equal(transitionCommandKeyOf(command), transitionCommandKeyOf({ ...command }));
});

test("service: qualification evidence is consulted at accept time only (E8 seam)", () => {
  const { service, packages } = makeService();
  const baseNode = fakeLineageNode("base-pack");
  const submitted = service.submit(
    submitCommand({ provenance: { origin: { kind: "lineage-derived", base: baseNode }, aiGenerated: false } }),
  );
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  service.transition({ tenant, contributionId: id, kind: "review", actor: maintainer });
  // Unpublished base: accept refuses.
  const premature = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(!premature.accepted);
  assert.equal(premature.code, "unknown-lineage-base");
  // Publish with failing provenance: still refused.
  packages.publish(baseNode.coordinate, false);
  const unqualified = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(!unqualified.accepted);
  assert.equal(unqualified.code, "lineage-base-unqualified");
  // Qualify: accept succeeds; status is accepted and nothing further.
  packages.publish(baseNode.coordinate, true);
  const accepted = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(accepted.accepted);
  assert.equal(accepted.status, "accepted");
  assert.ok(!service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer }).accepted);
});

test("service: AI-generated submissions carry their disclosure into the record", () => {
  const { service } = makeService();
  const submitted = service.submit(
    submitCommand({
      provenance: {
        origin: { kind: "original" },
        aiGenerated: true,
        modelProvenance: [{ model: "glm", provider: "zai", usage: "generation", disclosed: true }],
      },
    }),
  );
  assert.ok(submitted.accepted);
  assert.equal(submitted.contribution.provenance.aiGenerated, true);
  assert.equal(submitted.contribution.provenance.modelProvenance.length, 1);
  assert.equal(submitted.contribution.provenance.modelProvenance[0]!.model, "glm");
});
