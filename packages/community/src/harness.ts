/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full community journey over the in-memory fakes:
 * register contributor + maintainer -> submit a gap-linked
 * lineage-derived contribution -> duplicate submission returns the
 * recorded receipt (E10) -> maintainer triages -> reviews -> accept
 * refused while the lineage base is unqualified (E8) -> base published
 * -> accept succeeds -> contributor withdraws a second contribution ->
 * snapshot/restore round-trip (bigint payload included) -> cross-tenant
 * submission refused (R20). Prints deterministic machine-readable JSON
 * and exits non-zero on any unexpected outcome. No IO beyond stdout.
 */

import { CommunityService } from "./service.ts";
import type { SubmitContributionCommand } from "./admission.ts";
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

const tenant = ids.tenant("tenant-harness");
const contributor = ids.subject("player-one");
const maintainer = ids.subject("mod-one");

const directory = createMemorySubjectDirectory();
directory.register(tenant, contributor);
directory.registerMaintainer(tenant, maintainer);
const gaps = createMemoryGapDirectory();
gaps.declare("gap-harness", "cycle-harness", { communityRungReached: true });
const packages = createMemoryPackageRegistry();
const store = createMemoryCommunityStore();

const service = new CommunityService({
  store: store.store,
  clock: createFixedClock().clock,
  directory: directory.directory,
  gaps: gaps.gaps,
  packages: packages.registry,
  policy: { maxOpenContributionsPerContributor: 10 },
});

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

const baseNode = fakeLineageNode("base-pack");

const submitCommand: SubmitContributionCommand = {
  tenant,
  contributor,
  kind: "asset",
  payload: fakePayload({ title: "harness-asset", quality: 7n }),
  provenance: { origin: { kind: "lineage-derived", base: baseNode }, aiGenerated: false },
  gap: fakeGapLink("gap-harness", "cycle-harness"),
};

// 1. Submission admitted, gap-linked, provenance chained.
const submission = service.submit(submitCommand);
record("submit", "accepted", submission.accepted ? "accepted" : `refused:${submission.code}`);
const contributionId = submission.accepted ? submission.contribution.contributionId : asContributionId("sha256:" + "0".repeat(64))!;
record("status-submitted", "submitted", submission.accepted ? submission.contribution.status : "none");
record("gap-linked", "gap-harness", submission.accepted ? String(submission.contribution.gap?.gapId) : "none");

// 2. Duplicate submission replay returns the recorded receipt (E10).
const replay = service.submit(submitCommand);
record(
  "duplicate-replay",
  "refused:duplicate-contribution+receipt",
  replay.accepted ? "accepted" : `refused:${replay.code}${replay.recorded !== undefined ? "+receipt" : ""}`,
);

// 3. Maintainer pipeline: triage -> review.
const triaged = service.transition({ tenant, contributionId, kind: "triage", actor: maintainer, reason: "triaged by harness" });
record("triage", "accepted:triaged", triaged.accepted ? `accepted:${triaged.status}` : `refused:${triaged.code}`);
const reviewed = service.transition({ tenant, contributionId, kind: "review", actor: maintainer });
record("review", "accepted:under-review", reviewed.accepted ? `accepted:${reviewed.status}` : `refused:${reviewed.code}`);

// 4. Accept refused while the lineage base is unqualified (E8).
const premature = service.transition({ tenant, contributionId, kind: "accept", actor: maintainer });
record("accept-unqualified", "refused:unknown-lineage-base", premature.accepted ? "accepted" : `refused:${premature.code}`);

// 5. Base published with passing provenance -> accept succeeds.
packages.publish(baseNode.coordinate, true);
const accepted = service.transition({ tenant, contributionId, kind: "accept", actor: maintainer });
record("accept", "accepted:accepted", accepted.accepted ? `accepted:${accepted.status}` : `refused:${accepted.code}`);

// 6. Terminal state: a NEW command (never recorded) is refused by the
// frozen state machine — accepted takes no further transitions.
const postTerminal = service.transition({ tenant, contributionId, kind: "triage", actor: maintainer });
record("terminal", "refused:invalid-transition", postTerminal.accepted ? "accepted" : `refused:${postTerminal.code}`);

// 7. A second contribution the contributor withdraws (through review).
const second = service.submit({
  tenant,
  contributor,
  kind: "issue",
  payload: fakePayload({ title: "harness-issue" }),
  provenance: { origin: { kind: "original" }, aiGenerated: true, modelProvenance: [{ model: "test-model", provider: "test-provider", usage: "assistance", disclosed: true }] },
});
const secondId = second.accepted ? second.contribution.contributionId : contributionId;
service.transition({ tenant, contributionId: secondId, kind: "triage", actor: maintainer });
service.transition({ tenant, contributionId: secondId, kind: "review", actor: maintainer });
const withdrawn = service.transition({ tenant, contributionId: secondId, kind: "withdraw", actor: contributor });
record("withdraw-by-contributor", "accepted:withdrawn", withdrawn.accepted ? `accepted:${withdrawn.status}` : `refused:${withdrawn.code}`);
const maintainerWithdraw = service.transition({
  tenant,
  contributionId: secondId,
  kind: "withdraw",
  actor: maintainer,
  reason: "maintainers cannot withdraw others' work",
});
record("withdraw-refused-for-maintainer", "refused:not-the-contributor", maintainerWithdraw.accepted ? "accepted" : `refused:${maintainerWithdraw.code}`);

// 8. Snapshot/restore round-trip (bigint payload included).
const snapshot = service.snapshot();
const restored = snapshot.ok ? service.restore() : { ok: false as const, code: "empty" as const };
record("snapshot", "ok", snapshot.ok ? "ok" : `failed:${snapshot.code}`);
record("restore", "ok", restored.ok ? "ok" : `failed:${"code" in restored ? restored.code : "unknown"}`);
const afterRestore = service.contribution(tenant, contributionId);
record("restored-status", "accepted", afterRestore === undefined ? "missing" : afterRestore.status);
record("restored-history", "4", String(service.history(tenant, contributionId).length));

// 9. Cross-tenant submission refused (R20): foreign contributor.
const foreign = service.submit({
  tenant: ids.tenant("tenant-foreign"),
  contributor,
  kind: "issue",
  payload: fakePayload({ title: "foreign" }),
  provenance: { origin: { kind: "original" }, aiGenerated: false },
});
record("cross-tenant", "refused:unknown-contributor", foreign.accepted ? "accepted" : `refused:${foreign.code}`);

const failures = steps.filter((item) => item.expected !== item.actual);
console.log(JSON.stringify({ harness: "community", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
