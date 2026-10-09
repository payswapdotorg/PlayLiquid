/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full social graph journey over the in-memory fakes:
 * register subjects -> mutual follows (friends cohort) -> duplicate
 * follow refused -> block severs the follow (block beats follow) ->
 * blocked target cannot re-follow -> evidence replay returns the
 * recorded receipt (E10) -> snapshot/restore round-trip -> cross-tenant
 * submission refused (R20). Prints deterministic machine-readable JSON
 * and exits non-zero on any unexpected outcome. No IO beyond stdout;
 * no clock, no randomness, no network.
 */

import { SocialService } from "./service.ts";
import {
  FAKE_SOCIAL_EVENT_KINDS,
  createFixedClock,
  createMemoryGrantDirectory,
  createMemorySocialStore,
  createMemorySubjectDirectory,
  fakeBinding,
  socialGrant,
} from "./fakes.ts";
import { friendCohortOf } from "./relations.ts";
import { asEventTypeId } from "@playliquid/game-ir";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-harness")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;

const directory = createMemorySubjectDirectory();
directory.register(tenant, subjectOne);
directory.register(tenant, subjectTwo);
const grants = createMemoryGrantDirectory();
grants.grant(socialGrant(tenant, subjectOne));
grants.grant(socialGrant(tenant, subjectTwo));
const store = createMemorySocialStore();
const policy = { maxGraphSize: 100, requireMutualConsent: false, presence: false };

const service = new SocialService({
  store: store.store,
  clock: createFixedClock().clock,
  directory: directory.directory,
  grants: grants.grantsDirectory,
  policy,
  declaredGraphs: ["friends"],
});

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

function evidence(kind: string, actor: string, target: string, tick: number) {
  return {
    event: {
      type: asEventTypeId(kind)!,
      payload: {
        kind: "record" as const,
        fields: {
          actor: { kind: "string" as const, value: actor },
          target: { kind: "string" as const, value: target },
        },
      },
      tick,
    },
    binding: fakeBinding(kind),
  };
}

function followingCount(subject: import("@playliquid/platform-contracts").SubjectId): number {
  const view = service.graphView(tenant, subject, subjectOne);
  return "code" in view ? -1 : view.following.length;
}

// 1. Mutual follows -> friends.
const followOne = service.submit({ tenant, kind: "follow", actor: subjectOne, target: subjectTwo, evidence: evidence(FAKE_SOCIAL_EVENT_KINDS.follow, String(subjectOne), String(subjectTwo), 1) });
record("follow-1", "accepted", followOne.accepted ? "accepted" : `refused:${followOne.code}`);
const followTwo = service.submit({ tenant, kind: "follow", actor: subjectTwo, target: subjectOne, evidence: evidence(FAKE_SOCIAL_EVENT_KINDS.follow, String(subjectTwo), String(subjectOne), 2) });
record("follow-2", "accepted", followTwo.accepted ? "accepted" : `refused:${followTwo.code}`);
const view = service.graphView(tenant, subjectOne, subjectOne);
if (!("code" in view)) {
  record("friends-cohort", "1", String(view.friends.length));
  record("friend-cohort-shape", "friends", friendCohortOf(view).graph);
}

// 2. Duplicate follow refused.
const duplicate = service.submit({ tenant, kind: "follow", actor: subjectOne, target: subjectTwo, evidence: evidence(FAKE_SOCIAL_EVENT_KINDS.follow, String(subjectOne), String(subjectTwo), 3) });
record("duplicate-follow", "refused:duplicate-relation", duplicate.accepted ? "accepted" : `refused:${duplicate.code}`);

// 3. Block severs the follow (block beats follow).
const block = service.submit({ tenant, kind: "block", actor: subjectOne, target: subjectTwo, evidence: evidence(FAKE_SOCIAL_EVENT_KINDS.block, String(subjectOne), String(subjectTwo), 4) });
record("block", "accepted", block.accepted ? "accepted" : `refused:${block.code}`);
record("follow-severed", "0", String(followingCount(subjectOne)));

// 4. Blocked target cannot re-follow.
const retry = service.submit({ tenant, kind: "follow", actor: subjectTwo, target: subjectOne, evidence: evidence(FAKE_SOCIAL_EVENT_KINDS.follow, String(subjectTwo), String(subjectOne), 5) });
record("blocked-refollow", "refused:blocked-by-target", retry.accepted ? "accepted" : `refused:${retry.code}`);

// 5. Evidence replay returns the recorded receipt (E10).
const replay = service.submit({ tenant, kind: "block", actor: subjectOne, target: subjectTwo, evidence: evidence(FAKE_SOCIAL_EVENT_KINDS.block, String(subjectOne), String(subjectTwo), 4) });
record(
  "evidence-replay",
  "refused:duplicate-evidence+receipt",
  replay.accepted ? "accepted" : `refused:${replay.code}${replay.recorded !== undefined ? "+receipt" : ""}`,
);

// 6. Snapshot/restore round-trip (resumability).
const snapshot = service.snapshot();
const restored = snapshot.ok ? service.restore() : { ok: false as const, code: "empty" };
record("snapshot", "ok", snapshot.ok ? "ok" : `failed:${snapshot.code}`);
record("restore", "ok", restored.ok ? "ok" : `failed:${"code" in restored ? restored.code : "unknown"}`);
record("restored-edges", "0", String(followingCount(subjectOne)));

// 7. Cross-tenant submission refused (R20): foreign tenant, no grants.
const foreign = asSubjectId("player-foreign")!;
const crossTenant = service.submit({ tenant: asTenantId("tenant-foreign")!, kind: "follow", actor: subjectOne, target: foreign, evidence: evidence(FAKE_SOCIAL_EVENT_KINDS.follow, String(subjectOne), String(foreign), 6) });
record("cross-tenant", "refused:tenant-mismatch", crossTenant.accepted ? "accepted" : `refused:${crossTenant.code}`);

const failures = steps.filter((item) => item.expected !== item.actual);
console.log(JSON.stringify({ harness: "platform-social", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
