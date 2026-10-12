/**
 * COMMUNITY JOURNEY RIG — the HOST side of the Community contribution
 * workbench journey (PL-043): the REAL community service over its own
 * deterministic in-memory ports, plus the REAL workbench ports.
 *
 * - `service`: a REAL `CommunityService` (PL-032's public entrypoint) over
 *   the community package's own deterministic in-memory fakes (subject
 *   directory with one registered contributor + one maintainer, a declared
 *   R18 gap, a package registry with one PUBLISHED lineage base and one
 *   deliberately unpublished one).
 * - `dataPort`: a REAL `CommunityDataPort` whose `load()` re-reads the
 *   service's read doors (contributionsOf / history) — refreshes see the
 *   live contribution state.
 * - `commandPort`: a REAL `CommunityCommandPort` forwarding the
 *   workbench's TYPED user intents to the authoritative doors —
 *   `submit-contribution` (the host expands the small intent into a full
 *   submission: payload, provenance chain, gap link) and
 *   `advance-contribution` (the workflow commands). Refusal codes come
 *   back VERBATIM (E8); a replayed (content-identical) submission or
 *   transition surfaces as the E10 `duplicate: true` receipt.
 *
 * TEST-SUPPORT RIG (lock rule 44): the same honesty class as
 * gameos-community's own demo fixture, deliberately composed with
 * DIFFERENT data (ids, labels, clock start, model entries) so the journey
 * proves the host seam independently. Like that fixture, the host
 * deliberately includes ONE foreign-tenant row in the read model so the
 * R20 tenancy guard is visible and testable (a production host returns
 * viewer-scoped read models).
 *
 * Determinism (E9): a fixed clock advanced by fixed steps per recorded
 * mutation (the chronology lesson: same-timestamp transitions would order
 * by digest); creating the rig twice yields identical trajectories.
 */

import {
  CommunityService,
  asContributionId,
  createFixedClock,
  createMemoryCommunityStore,
  createMemoryGapDirectory,
  createMemoryPackageRegistry,
  createMemorySubjectDirectory,
  fakeGapLink,
  fakeLineageNode,
  fakePayload,
  ids,
} from "../../../packages/community/src/index.ts";
import type {
  ContributionTransitionRecord,
  SubmitContributionCommand,
  TransitionCommandKind,
} from "../../../packages/community/src/index.ts";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
// gameos-community is reached through the Node-surface adapter (see
// community-ui.ts: the package entrypoint re-exports .tsx components the
// Node runner cannot load — E11 browser honesty, no bundler here).
import type {
  CommunityCommandIntent,
  CommunityCommandPort,
  CommunityCommandReceipt,
  CommunityDataPort,
} from "./community-ui.ts";
import type { CommunityDataSnapshot } from "./community-ui.ts";

/** The journey's read-model viewer — the tenant's maintainer of record. */
export const JOURNEY_COMMUNITY_TENANT = asTenantId("tenant-community-journey")!;
export const JOURNEY_COMMUNITY_VIEWER = asSubjectId("subject-community-journey-lead")!;
/** The contributor-of-record of the journey's viewer-tenant contributions. */
export const JOURNEY_COMMUNITY_CONTRIBUTOR = asSubjectId("subject-journey-contributor")!;
/** The confused-host foreign tenant (the R20 guard row). */
export const JOURNEY_COMMUNITY_FOREIGN_TENANT = asTenantId("tenant-community-foreign")!;
export const JOURNEY_COMMUNITY_FOREIGN_CONTRIBUTOR = asSubjectId("subject-journey-foreign")!;
/**
 * A subject whose registration MOVED to the foreign tenant but who is
 * still a registered member of the viewer tenant (the R20 cross-tenant
 * contributor guard's honest trigger: known here, owned there).
 */
export const JOURNEY_COMMUNITY_MOVED_CONTRIBUTOR = asSubjectId("subject-journey-moved")!;

/** The R18 gap two journey contributions link to. */
export const JOURNEY_COMMUNITY_GAP = "gap-community-journey";
export const JOURNEY_COMMUNITY_CYCLE = "cycle-community-journey";

/** The lineage base node the port derives for one submit intent label. */
function baseNodeFor(label: string): ReturnType<typeof fakeLineageNode> {
  return fakeLineageNode(`journey-base-${label}`);
}

/** The complete journey rig: the real service + the real UI ports. */
export interface CommunityJourneyRig {
  readonly service: CommunityService;
  readonly dataPort: CommunityDataPort;
  readonly commandPort: CommunityCommandPort;
  /** Publish (qualify) the lineage base the port derives for one label. */
  publishBaseFor(label: string): void;
  /** The ids of the seeded fixture rows (the journey's selection keys). */
  readonly seeded: {
    readonly acceptedAssetId: string;
    readonly unqualifiedCodeId: string;
    readonly foreignSkillId: string;
  };
  /** The current read-model snapshot, read through the service's doors. */
  snapshot(): CommunityDataSnapshot;
}

/**
 * Create the complete Community journey rig: the real service over the
 * real deterministic ports, seeded with the journey's fixture rows, plus
 * the real workbench ports. Deterministic (E9).
 */
export function createCommunityJourneyRig(): CommunityJourneyRig {
  const clock = createFixedClock(5_000);
  const directory = createMemorySubjectDirectory();
  const gaps = createMemoryGapDirectory();
  const packages = createMemoryPackageRegistry();
  const store = createMemoryCommunityStore();

  directory.register(JOURNEY_COMMUNITY_TENANT, JOURNEY_COMMUNITY_CONTRIBUTOR);
  directory.registerMaintainer(JOURNEY_COMMUNITY_TENANT, JOURNEY_COMMUNITY_VIEWER);
  directory.register(JOURNEY_COMMUNITY_FOREIGN_TENANT, JOURNEY_COMMUNITY_FOREIGN_CONTRIBUTOR);
  // The moved contributor: a member of BOTH tenants, owned by the foreign
  // one — submitting into the viewer tenant must refuse cross-tenant (R20).
  directory.register(JOURNEY_COMMUNITY_TENANT, JOURNEY_COMMUNITY_MOVED_CONTRIBUTOR);
  directory.register(JOURNEY_COMMUNITY_FOREIGN_TENANT, JOURNEY_COMMUNITY_MOVED_CONTRIBUTOR);
  gaps.declare(JOURNEY_COMMUNITY_GAP, JOURNEY_COMMUNITY_CYCLE, { communityRungReached: true });

  // The lineage base of the ACCEPTED seed: PUBLISHED and provenance-passing,
  // so the accept-time qualification gate passes (the journey's unqualified
  // seed below deliberately fails it — the E8 trust model).
  const qualifiedBase = fakeLineageNode("journey-qualified-base");
  packages.publish(qualifiedBase.coordinate, true);

  const service = new CommunityService({
    store: store.store,
    clock: clock.clock,
    directory: directory.directory,
    gaps: gaps.gaps,
    packages: packages.registry,
    policy: { maxOpenContributionsPerContributor: 10 },
  });

  function mustSubmit(command: SubmitContributionCommand): string {
    const result = service.submit(command);
    if (!result.accepted) {
      throw new Error(`community journey rig: submission refused: ${result.code} — ${result.detail}`);
    }
    clock.advance(10);
    return String(result.contribution.contributionId);
  }

  function mustAdvance(contributionId: string, kind: TransitionCommandKind, actor: string, reason?: string): void {
    const parsed = asContributionId(contributionId);
    if (parsed === undefined) throw new Error(`community journey rig: id not a digest: ${contributionId}`);
    const result = service.transition({
      tenant: JOURNEY_COMMUNITY_TENANT,
      contributionId: parsed,
      kind,
      actor: ids.subject(actor),
      reason,
    });
    if (!result.accepted) {
      throw new Error(`community journey rig: transition ${kind} refused: ${result.code} — ${result.detail}`);
    }
    clock.advance(10);
  }

  // --- Seed 1: asset, lineage-derived over the QUALIFIED base, R18 gap
  // linked; walked the FULL lifecycle to `accepted` (qualified at accept).
  const acceptedAssetId = mustSubmit({
    tenant: JOURNEY_COMMUNITY_TENANT,
    contributor: JOURNEY_COMMUNITY_CONTRIBUTOR,
    kind: "asset",
    payload: fakePayload({ title: "journey-skybox-pack", quality: 7n }),
    provenance: { origin: { kind: "lineage-derived", base: qualifiedBase }, aiGenerated: false },
    gap: fakeGapLink(JOURNEY_COMMUNITY_GAP, JOURNEY_COMMUNITY_CYCLE),
  });
  mustAdvance(acceptedAssetId, "triage", String(JOURNEY_COMMUNITY_VIEWER), "triaged: addresses the recorded gap");
  mustAdvance(acceptedAssetId, "review", String(JOURNEY_COMMUNITY_VIEWER), "reviewing the skybox");
  mustAdvance(acceptedAssetId, "accept", String(JOURNEY_COMMUNITY_VIEWER), "base qualified; provenance passes");

  // --- Seed 2: replay-backed report, first-party original, honest AI
  // disclosure (model-provenance entries recorded); gap-linked; open.
  mustSubmit({
    tenant: JOURNEY_COMMUNITY_TENANT,
    contributor: JOURNEY_COMMUNITY_CONTRIBUTOR,
    kind: "replay-backed-report",
    payload: fakePayload({ replayOf: "journey-replay-7", verdict: "confirmed" }),
    provenance: {
      origin: { kind: "original" },
      aiGenerated: true,
      modelProvenance: [
        { model: "glm-4.7", provider: "zcode", usage: "assistance", disclosed: true },
      ],
    },
    gap: fakeGapLink(JOURNEY_COMMUNITY_GAP, JOURNEY_COMMUNITY_CYCLE),
  });

  // --- Seed 3: code, lineage-derived over an UNQUALIFIED (unpublished)
  // base — the E8 trust model renders: untrusted until qualified; walked
  // to `under-review` (accept would refuse the unqualified base).
  const unqualifiedCodeId = mustSubmit({
    tenant: JOURNEY_COMMUNITY_TENANT,
    contributor: JOURNEY_COMMUNITY_CONTRIBUTOR,
    kind: "code",
    payload: fakePayload({ module: "journey-fx-module", loc: 284n }),
    provenance: {
      origin: { kind: "lineage-derived", base: fakeLineageNode("journey-unqualified-base") },
      aiGenerated: false,
    },
  });
  mustAdvance(unqualifiedCodeId, "triage", String(JOURNEY_COMMUNITY_VIEWER));
  mustAdvance(unqualifiedCodeId, "review", String(JOURNEY_COMMUNITY_VIEWER));

  // --- Seed 4: the confused-host foreign-tenant row (the R20 guard). ------
  const foreignSkillId = mustSubmit({
    tenant: JOURNEY_COMMUNITY_FOREIGN_TENANT,
    contributor: JOURNEY_COMMUNITY_FOREIGN_CONTRIBUTOR,
    kind: "skill",
    payload: fakePayload({ skill: "journey-foreign-skill", level: 2n }),
    provenance: { origin: { kind: "original" }, aiGenerated: false },
  });

  // The command port: typed intents → the authoritative doors (E8 verbatim,
  // E10 duplicates surfaced).
  const commandPort: CommunityCommandPort = {
    dispatch(intent: CommunityCommandIntent): CommunityCommandReceipt {
      if (intent.kind === "submit-contribution") {
        if (intent.label.length === 0) {
          return {
            ok: false,
            code: "invalid-intent",
            detail: "submit-contribution requires a non-empty artifact label",
          };
        }
        const result = service.submit({
          tenant: intent.tenant,
          contributor: intent.subject,
          kind: intent.contributionKind,
          payload: fakePayload({ title: intent.label, revision: 1n }),
          provenance: {
            origin: intent.lineageDerived
              ? { kind: "lineage-derived", base: baseNodeFor(intent.label) }
              : { kind: "original" },
            aiGenerated: intent.aiGenerated,
            modelProvenance: intent.aiGenerated
              ? [{ model: "glm-4.7", provider: "zcode", usage: "assistance", disclosed: true }]
              : [],
          },
          gap: intent.gapId === undefined ? undefined : fakeGapLink(intent.gapId, JOURNEY_COMMUNITY_CYCLE),
        });
        if (result.accepted) {
          clock.advance(10);
          return {
            ok: true,
            kind: "contribution-submitted",
            contributionId: result.contribution.contributionId,
            duplicate: false,
          };
        }
        if (result.code === "duplicate-contribution" && result.recorded !== undefined) {
          // E10: the content-addressed identity was already recorded — the
          // first receipt stands and surfaces as a duplicate.
          return {
            ok: true,
            kind: "contribution-submitted",
            contributionId: result.recorded.contributionId,
            duplicate: true,
          };
        }
        return { ok: false, code: result.code, detail: result.detail };
      }
      if (intent.kind === "advance-contribution") {
        const contributionId = asContributionId(intent.contributionId);
        if (contributionId === undefined) {
          return {
            ok: false,
            code: "invalid-intent",
            detail: `contributionId is not a content address: ${intent.contributionId}`,
          };
        }
        const result = service.transition({
          tenant: intent.tenant,
          contributionId,
          kind: intent.command,
          actor: intent.actor,
          reason: intent.reason,
        });
        if (result.accepted) {
          clock.advance(10);
          return {
            ok: true,
            kind: "contribution-advanced",
            contributionId,
            to: result.status,
            duplicate: false,
          };
        }
        if (result.code === "duplicate-transition" && result.recorded !== undefined) {
          return {
            ok: true,
            kind: "contribution-advanced",
            contributionId,
            to: result.recorded.to,
            duplicate: true,
          };
        }
        return { ok: false, code: result.code, detail: result.detail };
      }
      return {
        ok: false,
        code: "invalid-intent",
        detail: `unknown intent kind ${String((intent as { kind?: string }).kind)}`,
      };
    },
  };

  // The data port: every load() re-reads the live read doors.
  const dataPort: CommunityDataPort = {
    load(): ReturnType<CommunityDataPort["load"]> {
      return { ok: true, data: rig.snapshot() };
    },
  };

  const rig: CommunityJourneyRig = {
    service,
    dataPort,
    commandPort,
    publishBaseFor(label: string): void {
      packages.publish(baseNodeFor(label).coordinate, true);
    },
    seeded: {
      acceptedAssetId,
      unqualifiedCodeId,
      foreignSkillId,
    },
    snapshot(): CommunityDataSnapshot {
      const transitions: readonly ContributionTransitionRecord[] = [
        ...service.history(JOURNEY_COMMUNITY_TENANT),
        ...service.history(JOURNEY_COMMUNITY_FOREIGN_TENANT),
      ];
      return {
        viewer: { tenant: JOURNEY_COMMUNITY_TENANT, subject: JOURNEY_COMMUNITY_VIEWER },
        contributions: [
          ...service.contributionsOf(JOURNEY_COMMUNITY_TENANT),
          ...service.contributionsOf(JOURNEY_COMMUNITY_FOREIGN_TENANT),
        ],
        transitions,
      } satisfies CommunityDataSnapshot;
    },
  };
  return rig;
}
