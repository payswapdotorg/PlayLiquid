/**
 * THE COMMUNITY PHASE of the canonical journey (PL-040) — the Arena outcome
 * surfaced as a community contribution through the REAL `CommunityService`
 * (PL-032's public entrypoint), closing the product thesis:
 * the Lab discovers → the Arena adjudicates → the Community curates.
 *
 * - the service runs over the community package's own deterministic
 *   in-memory ports (subject directory, package-registry seam, memory store,
 *   fixed clock advanced by fixed steps per recorded mutation — E9);
 * - the R18 capability-gap link is served by a REAL adapter over the Lab's
 *   own read door (`getCapabilityGap`): the `GapDirectory` seam the service
 *   consumes reads the LIVE ladder state — exists / resolved / blocked /
 *   community-rung-reached derive from the Lab's authoritative record,
 *   never from fixture constants;
 * - the submission's provenance cites a PUBLISHED, provenance-passing
 *   lineage base (git-lineage's content-addressed node over a
 *   package-system coordinate), so the accept-time E8 qualification gate
 *   passes honestly: the third-party contribution was UNTRUSTED while open
 *   and becomes trusted exactly at accept (the trust flip);
 * - the payload is a game-ir kernel value built with the community
 *   package's own fixture builder (`fakePayload`) carrying the Arena
 *   outcome's content-addressed facts (case id, escalation handle, verdict).
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
  ContributionRecord,
  ContributionTransitionRecord,
  GapDirectory,
  GapSeamFacts,
  SubmitResult,
  TransitionCommandKind,
  TransitionResult,
} from "../../../packages/community/src/index.ts";
import type { CapabilityGapRecord } from "../../../packages/lab-contracts/src/index.ts";
import type { LabJourneyStack } from "../../../packages/lab-learning/src/index.ts";
import type { LabOrganizationCaller } from "../../../packages/lab-organization/src/index.ts";
import type { SubjectId } from "../../../packages/platform-contracts/src/index.ts";
import {
  COMMUNITY_CLOCK_START,
  JOURNEY_MAINTAINER,
  JOURNEY_SUBJECT,
  JOURNEY_TENANT,
} from "./ids.ts";

/** The Arena outcome facts the contribution surfaces (content-addressed). */
export interface ArenaOutcomeFacts {
  readonly caseId: string;
  readonly escalationId: string;
  readonly requestDigest: string;
  readonly lifecycleState: string;
  readonly evidenceVerdict: string;
}

/** The Community phase rig: the real service over the real ports. */
export interface CommunityPhaseRig {
  readonly service: CommunityService;
  readonly clock: ReturnType<typeof createFixedClock>;
  readonly options: CommunityServiceOptions;
  /** The Lab-backed R18 gap seam (the live adapter over the read door). */
  readonly gaps: GapDirectory;
  /** Submits the Arena outcome as a contribution linked to the Lab gap. */
  submitArenaOutcome(input: {
    readonly outcome: ArenaOutcomeFacts;
    readonly gapRecord: CapabilityGapRecord;
  }): SubmitResult;
  /** One workflow command (typed receipt; E8 verbatim, E10 duplicates). */
  advance(input: {
    readonly contributionId: string;
    readonly command: TransitionCommandKind;
    readonly actor: SubjectId;
    readonly reason?: string;
  }): TransitionResult;
}

/**
 * The REAL R18 gap seam: community's `GapDirectory` port served from the
 * Lab's own `getCapabilityGap` read door — the ladder facts derive from the
 * authoritative record, never from duplicated state.
 */
export function createLabGapDirectory(stack: LabJourneyStack, labCaller: LabOrganizationCaller): GapDirectory {
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

/** The typed R18 gap link of one Lab gap record (the contribution's link). */
export function gapLinkOf(gapRecord: CapabilityGapRecord): CapabilityGapLink {
  return { gapId: asGapId(String(gapRecord.gapId))!, cycleId: asCycleId(String(gapRecord.cycleId))! };
}

/** Creates the Community phase over the real service + the Lab-backed seam. */
export function createJourneyCommunity(stack: LabJourneyStack, labCaller: LabOrganizationCaller): CommunityPhaseRig {
  const clock = createFixedClock(COMMUNITY_CLOCK_START);
  const directory = createMemorySubjectDirectory();
  const packages = createMemoryPackageRegistry();
  const store = createMemoryCommunityStore();
  const gaps = createLabGapDirectory(stack, labCaller);

  directory.register(JOURNEY_TENANT, JOURNEY_SUBJECT);
  directory.registerMaintainer(JOURNEY_TENANT, JOURNEY_MAINTAINER);
  // The lineage base the Arena-outcome contribution cites: PUBLISHED and
  // provenance-passing, so the accept-time qualification gate passes (E8).
  const qualifiedBase = fakeLineageNode("lab-thesis-arena-evidence-base");
  packages.publish(qualifiedBase.coordinate, true);

  const options: CommunityServiceOptions = {
    store: store.store,
    clock: clock.clock,
    directory: directory.directory,
    gaps,
    packages: packages.registry,
    policy: { maxOpenContributionsPerContributor: 10 },
  };
  const service = new CommunityService(options);

  return {
    service,
    clock,
    options,
    gaps,
    submitArenaOutcome(input: { readonly outcome: ArenaOutcomeFacts; readonly gapRecord: CapabilityGapRecord }): SubmitResult {
      const result = service.submit({
        tenant: JOURNEY_TENANT,
        contributor: JOURNEY_SUBJECT,
        kind: "replay-backed-report",
        payload: fakePayload({
          arenaCase: input.outcome.caseId,
          escalation: input.outcome.escalationId,
          lifecycle: input.outcome.lifecycleState,
          verdict: input.outcome.evidenceVerdict,
          requestDigest: input.outcome.requestDigest,
        }),
        provenance: { origin: { kind: "lineage-derived", base: qualifiedBase }, aiGenerated: false },
        gap: gapLinkOf(input.gapRecord),
      });
      if (result.accepted) clock.advance(10);
      return result;
    },
    advance(input: {
      readonly contributionId: string;
      readonly command: TransitionCommandKind;
      readonly actor: SubjectId;
      readonly reason?: string;
    }): TransitionResult {
      const parsed = asContributionId(input.contributionId);
      if (parsed === undefined) {
        return { accepted: false, code: "invalid-command", detail: `contributionId is not a content address: ${input.contributionId}` };
      }
      const result = service.transition({
        tenant: JOURNEY_TENANT,
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

/** The workflow trail of one contribution (the E10 history read). */
export function trailOf(history: readonly ContributionTransitionRecord[]): readonly string[] {
  return history.map((entry) => `${entry.from}->${entry.to}`);
}

/** The provenance-chain facts of one contribution (the closing evidence). */
export function provenanceFactsOf(record: ContributionRecord): {
  readonly contributor: string;
  readonly originKind: string;
  readonly baseCoordinate: string;
  readonly contentDigest: string;
  readonly aiGenerated: boolean;
  readonly gapId: string;
  readonly status: string;
} {
  return {
    contributor: String(record.contributor),
    originKind: record.provenance.origin.kind,
    baseCoordinate: record.provenance.origin.kind === "lineage-derived"
      ? `${String(record.provenance.origin.base.coordinate.id)}@${String(record.provenance.origin.base.coordinate.contentDigest)}`
      : "",
    contentDigest: String(record.provenance.contentDigest),
    aiGenerated: record.provenance.aiGenerated,
    gapId: record.gap === undefined ? "" : String(record.gap.gapId),
    status: record.status,
  };
}
