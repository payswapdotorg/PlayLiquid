/**
 * THE ARENA PHASE of the canonical journey (PL-040) — the decided
 * capability-gap escalation adjudicated over the REAL Arena runtime:
 *
 * - `ArenaRuntimeService` (arena-integration-runtime's public state owner)
 *   wired over the deterministic fakes the package itself ships: the
 *   stepping clock, the content-addressed runtime store (E6 snapshots), the
 *   Lab usage-rule policy (arena-integration's own port) and the fake Arena
 *   behind arena-integration's `ArenaTransport` port — the SAME port a
 *   host-side real provider binds (E11: no real provider exists in repo);
 * - the escalation source is the LAB'S OWN walked gap record (read through
 *   lab-organization's `getCapabilityGap` door) — the R18 rung gate sees
 *   the real trail, not a fixture;
 * - the case opens only through a DECIDED escalation command whose
 *   `decisionDigest` re-derives from its decision fields
 *   (`arenaDecisionDigestOf`) — the runtime never auto-escalates;
 * - `driveCase` advances the case through the arena-integration lifecycle
 *   (draft → authorized → sent → responded → ingested), persisting the whole
 *   content-addressed document at every step (E6 crash-anywhere resume);
 *   terminal re-drives are honest no-ops (E10: never a second send);
 * - `labeledEvidence` surfaces the E11 epistemic labels of the admitted
 *   evidence package (external validated result / estimate / artifact).
 */

import { arenaAuthorizationScope, arenaAuthorizationScopeKey, allowAllArenaPolicy } from "../../../packages/arena-integration/src/index.ts";
import { ArenaRuntimeService, arenaDecisionDigestOf, createArenaRuntimeStore, createFakeArena, createSteppingClock, fakeArenaEndpoint, runtimeDigestOf } from "../../../packages/arena-integration-runtime/src/index.ts";
import type { ArenaEscalationCase, ArenaEscalationCommand, ArenaRuntimeCaller, ArenaSourceKey } from "../../../packages/arena-integration-runtime/src/index.ts";
import type { ArenaEscalationRef, CapabilityGapRecord, ContentDigest } from "../../../packages/lab-contracts/src/index.ts";
import { asTimestampMs } from "../../../packages/lab-contracts/src/index.ts";
import { asSubjectId } from "../../../packages/platform-contracts/src/index.ts";
import type { TenantId } from "../../../packages/platform-contracts/src/index.ts";
import {
  ARENA_CLOCK_START,
  ARENA_DECIDED_AT,
  JOURNEY_FOREIGN_SUBJECT,
  JOURNEY_FOREIGN_TENANT,
  JOURNEY_SUBJECT,
  JOURNEY_TENANT,
} from "./ids.ts";

/** The Arena phase rig: the real runtime over the deterministic ports. */
export interface ArenaPhaseRig {
  readonly service: ArenaRuntimeService;
  readonly caller: ArenaRuntimeCaller;
  readonly foreignCaller: ArenaRuntimeCaller;
  readonly store: ReturnType<typeof createArenaRuntimeStore>;
  readonly arena: ReturnType<typeof createFakeArena>;
  readonly endpoint: ReturnType<typeof fakeArenaEndpoint>;
  /** The source key of the registered Lab gap record ("" until registered). */
  readonly sourceKey: string;
  /** Registers the LAB'S OWN walked gap record as the escalation source. */
  registerLabGapSource(gapRecord: CapabilityGapRecord): { readonly sourceKey: string; readonly duplicate: boolean };
  /** Builds the DECIDED escalation command (decision digest re-derived). */
  decidedCommand(input: { readonly requestPayload: ContentDigest }): ArenaEscalationCommand;
}

/** The journey's Lab usage-rule policy id (an honest allow-all fixture). */
export const JOURNEY_ARENA_POLICY_ID = "lab-thesis-usage-rules";

/** Creates the Arena phase: the runtime service over the real ports. */
export function createJourneyArena(): ArenaPhaseRig {
  const store = createArenaRuntimeStore();
  const clock = createSteppingClock(ARENA_CLOCK_START, 5);
  const endpoint = fakeArenaEndpoint();
  const arena = createFakeArena(endpoint);
  const service = new ArenaRuntimeService({
    ports: { clock, store, policy: allowAllArenaPolicy(JOURNEY_ARENA_POLICY_ID), transport: arena },
  });
  const caller: ArenaRuntimeCaller = { tenant: JOURNEY_TENANT, subject: JOURNEY_SUBJECT };
  const foreignCaller: ArenaRuntimeCaller = { tenant: JOURNEY_FOREIGN_TENANT, subject: JOURNEY_FOREIGN_SUBJECT };
  let registeredKey: ArenaSourceKey | undefined;

  const rig: ArenaPhaseRig = {
    service,
    caller,
    foreignCaller,
    store,
    arena,
    endpoint,
    get sourceKey(): string {
      return registeredKey === undefined ? "" : String(registeredKey);
    },
    registerLabGapSource(gapRecord: CapabilityGapRecord): { readonly sourceKey: string; readonly duplicate: boolean } {
      const registered = service.registerSource(caller, { kind: "gap-record", record: gapRecord });
      if (!registered.ok) throw new Error(`journey arena: source registration refused: ${registered.detail}`);
      registeredKey = registered.source.sourceKey;
      return { sourceKey: String(registeredKey), duplicate: registered.duplicate };
    },
    decidedCommand(input: { readonly requestPayload: ContentDigest }): ArenaEscalationCommand {
      if (registeredKey === undefined) throw new Error("journey arena: no Lab gap source registered — the runtime never auto-escalates");
      const base = {
        decidedBy: JOURNEY_SUBJECT,
        decidedAt: asTimestampMs(ARENA_DECIDED_AT)!,
        sourceKey: registeredKey,
        requestKind: "result" as const,
        requestPayload: input.requestPayload,
        endpoint,
        authorization: arenaAuthorizationScope([]),
      };
      return {
        ...base,
        decisionDigest: arenaDecisionDigestOf({
          tenant: String(JOURNEY_TENANT),
          decidedBy: String(base.decidedBy),
          decidedAt: base.decidedAt,
          sourceKey: String(base.sourceKey),
          requestKind: base.requestKind,
          requestPayload: String(base.requestPayload),
          endpointDigest: String(endpoint.endpointDigest),
          authorizationKey: arenaAuthorizationScopeKey(base.authorization),
        }),
      };
    },
  };
  return rig;
}

/** The content-addressed ask digest of one gap (the WHAT of the escalation). */
export function askDigestOf(gapRecord: CapabilityGapRecord): ContentDigest {
  return runtimeDigestOf({
    tag: "playliquid:lab-journey:arena-ask:1",
    gapId: String(gapRecord.gapId),
    missingCapability: gapRecord.missingCapability,
    cycleId: String(gapRecord.cycleId),
  });
}

/** The provider-neutral external ref of one Arena case (lock 32). */
export function arenaEscalationRefOf(escalationCase: ArenaEscalationCase): ArenaEscalationRef {
  return {
    external: "arena-external",
    escalationId: escalationCase.request.escalationId,
    requestDigest: escalationCase.request.requestDigest,
  };
}

/** The typed caller of one tenant (a tiny convenience for the walk + tests). */
export function arenaCallerOf(tenant: TenantId, subject: string): ArenaRuntimeCaller {
  return { tenant, subject: asSubjectId(subject)! };
}
