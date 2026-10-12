/**
 * THE HOSTILE COMMUNITY PHASE (PL-040 qa/e2e-lab) — the REAL
 * `CommunityService` (PL-032's public entrypoint) driven by an adversary:
 *
 * - the service runs over the community package's own deterministic
 *   in-memory ports (subject directory, package-registry seam, memory store,
 *   fixed clock advanced by fixed steps per accepted mutation — E9);
 * - the subject directory carries the MOVED-CONTRIBUTOR hostile row: a
 *   member of the hostile tenant whose ownership moved to the foreign
 *   tenant, so a submission attempt into the hostile tenant is a typed
 *   cross-tenant-contributor refusal (membership exists, ownership
 *   differs — both facts the intake oracle needs);
 * - the R18 capability-gap link is served by a REAL adapter over the Lab's
 *   own read door (`getCapabilityGap`): the `GapDirectory` seam the service
 *   consumes reads the LIVE ladder state — exists / resolved / blocked /
 *   community-rung-reached derive from the authoritative record, never
 *   from fixture constants;
 * - the hostile walk's contribution is AI-DISCLOSED (aiGenerated: true
 *   with a model-provenance entry — a DIFFERENT contribution class than
 *   the canonical example's AI-free one), citing a PUBLISHED,
 *   provenance-passing lineage base so the accept-time E8 qualification
 *   gate passes honestly.
 */

import {
  CommunityService,
  asContributionId,
  asCycleId,
  asGapId,
  createFixedClock,
  createMemoryCommunityStore,
  createMemoryPackageRegistry,
  createMemorySubjectDirectory,
  fakeLineageNode,
  fakePayload,
} from "../../../packages/community/src/index.ts";
import type {
  CapabilityGapLink,
  CommunityServiceOptions,
  GapDirectory,
  GapSeamFacts,
  SubmitResult,
  TransitionCommandKind,
  TransitionResult,
} from "../../../packages/community/src/index.ts";
import type { CapabilityGapRecord } from "../../../packages/lab-contracts/src/index.ts";
import type { LabJourneyStack } from "../../../packages/lab-learning/src/index.ts";
import type { LabOrganizationCaller } from "../../../packages/lab-organization/src/index.ts";
import type { SubjectId, TenantId } from "../../../packages/platform-contracts/src/index.ts";
import { COMMUNITY_CLOCK_START, HOSTILE_FOREIGN_TENANT, HOSTILE_MAINTAINER, HOSTILE_MOVED_SUBJECT, HOSTILE_SUBJECT, HOSTILE_TENANT } from "./ids.ts";

/** The Arena outcome facts a hostile contribution surfaces. */
export interface HostileOutcomeFacts {
  readonly caseId: string;
  readonly escalationId: string;
  readonly requestDigest: string;
  readonly lifecycleState: string;
  readonly evidenceVerdict: string;
}

/** The hostile Community phase rig. */
export interface HostileCommunityRig {
  readonly service: CommunityService;
  readonly clock: ReturnType<typeof createFixedClock>;
  readonly gaps: GapDirectory;
  /** The qualified lineage base the hostile walk cites (published + passing). */
  readonly qualifiedBase: ReturnType<typeof fakeLineageNode>;
  /** Submits the Arena outcome as an AI-DISCLOSED contribution (≠ the example's). */
  submitArenaOutcome(input: {
    readonly outcome: HostileOutcomeFacts;
    readonly gapRecord: CapabilityGapRecord;
    readonly contributor?: SubjectId;
  }): SubmitResult;
  /** One workflow command (typed receipt; E8 verbatim, E10 duplicates). */
  advance(input: {
    readonly contributionId: string;
    readonly command: TransitionCommandKind;
    readonly actor: SubjectId;
    readonly tenant?: TenantId;
    readonly reason?: string;
  }): TransitionResult;
}

/**
 * The REAL R18 gap seam: community's `GapDirectory` port served from the
 * Lab's own `getCapabilityGap` read door — the ladder facts derive from the
 * authoritative record, never from duplicated state.
 */
export function createHostileGapDirectory(stack: LabJourneyStack, labCaller: LabOrganizationCaller): GapDirectory {
  return {
    factsOf(link: CapabilityGapLink): GapSeamFacts {
      const read = stack.organization.getCapabilityGap(String(link.gapId), labCaller);
      if (!read.ok) {
        return { exists: false, resolved: false, blocked: false, communityRungReached: false };
      }
      const attempts = read.gap.attempts;
      const last = attempts[attempts.length - 1];
      return {
        exists: true,
        resolved: attempts.some((attempt) => attempt.rung !== "blocked" && attempt.outcome === "resolved"),
        blocked: last?.rung === "blocked",
        communityRungReached: attempts.some((attempt) => attempt.rung === "user-community-contribution"),
      };
    },
  };
}

/** The typed R18 gap link of one gap record (the contribution's link). */
export function hostileGapLinkOf(gapRecord: CapabilityGapRecord): CapabilityGapLink {
  return { gapId: asGapId(String(gapRecord.gapId))!, cycleId: asCycleId(String(gapRecord.cycleId))! };
}

/** Creates the hostile Community phase over the real service + ports. */
export function createHostileCommunity(stack: LabJourneyStack, labCaller: LabOrganizationCaller): HostileCommunityRig {
  const clock = createFixedClock(COMMUNITY_CLOCK_START);
  const directory = createMemorySubjectDirectory();
  const packages = createMemoryPackageRegistry();
  const store = createMemoryCommunityStore();
  const gaps = createHostileGapDirectory(stack, labCaller);

  directory.register(HOSTILE_TENANT, HOSTILE_SUBJECT);
  directory.registerMaintainer(HOSTILE_TENANT, HOSTILE_MAINTAINER);
  // The MOVED contributor: a member of the hostile tenant whose OWNERSHIP
  // moved to the foreign tenant. The intake oracle checks MEMBERSHIP before
  // OWNERSHIP (admission.ts: `unknown-contributor` fires when the subject is
  // not a member of the COMMAND's tenant; `cross-tenant-contributor` when
  // the directory's global subject→tenant map resolves elsewhere — the
  // package's own admission.test.ts drives both facts directly), so the
  // hostile row needs BOTH: registration under the hostile tenant (the
  // pre-move membership), then registration under the foreign tenant (the
  // move — the directory's last write wins, fakes.ts `register`).
  directory.register(HOSTILE_TENANT, HOSTILE_MOVED_SUBJECT);
  directory.register(HOSTILE_FOREIGN_TENANT, HOSTILE_MOVED_SUBJECT);

  const qualifiedBase = fakeLineageNode("qa-e2e-hostile-lineage-base");
  packages.publish(qualifiedBase.coordinate, true);

  const options: CommunityServiceOptions = {
    store: store.store,
    clock: clock.clock,
    directory: directory.directory,
    gaps,
    packages: packages.registry,
    policy: { maxOpenContributionsPerContributor: 3 },
  };
  const service = new CommunityService(options);

  return {
    service,
    clock,
    gaps,
    qualifiedBase,
    submitArenaOutcome(input: {
      readonly outcome: HostileOutcomeFacts;
      readonly gapRecord: CapabilityGapRecord;
      readonly contributor?: SubjectId;
    }): SubmitResult {
      const result = service.submit({
        tenant: HOSTILE_TENANT,
        contributor: input.contributor ?? HOSTILE_SUBJECT,
        kind: "replay-backed-report",
        payload: fakePayload({
          arenaCase: input.outcome.caseId,
          escalation: input.outcome.escalationId,
          lifecycle: input.outcome.lifecycleState,
          verdict: input.outcome.evidenceVerdict,
          requestDigest: input.outcome.requestDigest,
          adversary: "qa-e2e-lab",
        }),
        provenance: {
          origin: { kind: "lineage-derived", base: qualifiedBase },
          aiGenerated: true,
          modelProvenance: [{ model: "glm-hostile-sim", provider: "z-ai-qa", usage: "assistance", disclosed: true }],
        },
        gap: hostileGapLinkOf(input.gapRecord),
      });
      if (result.accepted) clock.advance(10);
      return result;
    },
    advance(input: {
      readonly contributionId: string;
      readonly command: TransitionCommandKind;
      readonly actor: SubjectId;
      readonly tenant?: TenantId;
      readonly reason?: string;
    }): TransitionResult {
      const parsed = asContributionId(input.contributionId);
      if (parsed === undefined) {
        return { accepted: false, code: "invalid-command", detail: `contributionId is not a content address: ${input.contributionId}` };
      }
      const result = service.transition({
        tenant: input.tenant ?? HOSTILE_TENANT,
        contributionId: parsed,
        kind: input.command,
        actor: input.actor,
        reason: input.reason,
      });
      if (result.accepted) clock.advance(10);
      return result;
    },
  };
}
