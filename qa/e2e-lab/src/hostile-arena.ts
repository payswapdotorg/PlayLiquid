/**
 * THE HOSTILE ARENA PHASE (PL-040 qa/e2e-lab) — the REAL Arena runtime the
 * adversarial suite forges decisions at:
 *
 * - `ArenaRuntimeService` (arena-integration-runtime's public state owner)
 *   wired over the package's own deterministic ports: the stepping clock,
 *   the content-addressed runtime store (E6 snapshots), the Lab usage-rule
 *   policy port and the fake Arena behind arena-integration's
 *   `ArenaTransport` port — the SAME port a host-side real provider binds
 *   (E11: no real Arena provider exists in this repo and none is claimed);
 * - `decidedCommand` builds a DECIDED escalation command over ANY source
 *   key with the decision digest re-derived from the FINAL fields — the
 *   forged-command negatives then mutate a field WITHOUT re-deriving, and
 *   the intake oracle's `tampered-decision-digest` catches it;
 * - the escalation source of the walk is the LAB'S OWN walked gap record
 *   (read through lab-organization's `getCapabilityGap` door) — the R18
 *   rung gate sees the real trail, never a fixture.
 */

import { arenaAuthorizationScope, arenaAuthorizationScopeKey, allowAllArenaPolicy } from "../../../packages/arena-integration/src/index.ts";
import {
  ArenaRuntimeService,
  arenaDecisionDigestOf,
  asArenaSourceKey,
  createArenaRuntimeStore,
  createFakeArena,
  createSteppingClock,
  fakeArenaEndpoint,
  runtimeDigestOf,
} from "../../../packages/arena-integration-runtime/src/index.ts";
import type {
  ArenaEscalationCase,
  ArenaEscalationCommand,
  ArenaRuntimeCaller,
  ArenaSourceKey,
} from "../../../packages/arena-integration-runtime/src/index.ts";
import type { ArenaEscalationRef, CapabilityGapRecord, ContentDigest } from "../../../packages/lab-contracts/src/index.ts";
import { asTimestampMs } from "../../../packages/lab-contracts/src/index.ts";
import {
  ARENA_CLOCK_START,
  ARENA_CLOCK_STEP,
  ARENA_DECIDED_AT,
  HOSTILE_FOREIGN_SUBJECT,
  HOSTILE_FOREIGN_TENANT,
  HOSTILE_SUBJECT,
  HOSTILE_TENANT,
} from "./ids.ts";

/** The hostile world's Arena policy id (an honest allow-all fixture). */
export const HOSTILE_ARENA_POLICY_ID = "qa-e2e-hostile-usage-rules";

/** The hostile Arena phase rig. */
export interface HostileArenaRig {
  readonly service: ArenaRuntimeService;
  readonly caller: ArenaRuntimeCaller;
  readonly foreignCaller: ArenaRuntimeCaller;
  readonly store: ReturnType<typeof createArenaRuntimeStore>;
  readonly arena: ReturnType<typeof createFakeArena>;
  readonly endpoint: ReturnType<typeof fakeArenaEndpoint>;
  /** Registers a gap record as an escalation source (the intake door). */
  registerGapSource(gapRecord: CapabilityGapRecord): { readonly sourceKey: string; readonly duplicate: boolean };
  /**
   * Builds a DECIDED escalation command over any source key, with the
   * decision digest re-derived from the FINAL fields (forged-command tests
   * then mutate a field WITHOUT re-deriving — the tamper oracle catches it).
   */
  decidedCommand(input: {
    readonly requestPayload: ContentDigest;
    readonly sourceKey: string;
    readonly overrides?: Partial<Omit<ArenaEscalationCommand, "sourceKey" | "decisionDigest">>;
  }): ArenaEscalationCommand;
}

/** Creates the hostile Arena phase: the real runtime over the real ports. */
export function createHostileArena(): HostileArenaRig {
  const store = createArenaRuntimeStore();
  const clock = createSteppingClock(ARENA_CLOCK_START, ARENA_CLOCK_STEP);
  const endpoint = fakeArenaEndpoint();
  const arena = createFakeArena(endpoint);
  const service = new ArenaRuntimeService({
    ports: { clock, store, policy: allowAllArenaPolicy(HOSTILE_ARENA_POLICY_ID), transport: arena },
  });
  const caller: ArenaRuntimeCaller = { tenant: HOSTILE_TENANT, subject: HOSTILE_SUBJECT };
  const foreignCaller: ArenaRuntimeCaller = { tenant: HOSTILE_FOREIGN_TENANT, subject: HOSTILE_FOREIGN_SUBJECT };

  return {
    service,
    caller,
    foreignCaller,
    store,
    arena,
    endpoint,
    registerGapSource(gapRecord: CapabilityGapRecord): { readonly sourceKey: string; readonly duplicate: boolean } {
      const registered = service.registerSource(caller, { kind: "gap-record", record: gapRecord });
      if (!registered.ok) throw new Error(`hostile arena: source registration refused: ${registered.detail}`);
      return { sourceKey: String(registered.source.sourceKey), duplicate: registered.duplicate };
    },
    decidedCommand(input: {
      readonly requestPayload: ContentDigest;
      readonly sourceKey: string;
      readonly overrides?: Partial<Omit<ArenaEscalationCommand, "sourceKey" | "decisionDigest">>;
    }): ArenaEscalationCommand {
      const sourceKey: ArenaSourceKey = asArenaSourceKey(input.sourceKey) ?? (input.sourceKey as ArenaSourceKey);
      const base = {
        decidedBy: HOSTILE_SUBJECT,
        decidedAt: asTimestampMs(ARENA_DECIDED_AT)!,
        sourceKey,
        requestKind: "result" as const,
        requestPayload: input.requestPayload,
        endpoint,
        authorization: arenaAuthorizationScope([]),
        ...input.overrides,
      };
      return {
        ...base,
        decisionDigest: arenaDecisionDigestOf({
          tenant: String(HOSTILE_TENANT),
          decidedBy: String(base.decidedBy),
          decidedAt: base.decidedAt,
          sourceKey: String(base.sourceKey),
          requestKind: base.requestKind,
          requestPayload: String(base.requestPayload),
          endpointDigest: String(base.endpoint.endpointDigest),
          authorizationKey: arenaAuthorizationScopeKey(base.authorization),
        }),
      };
    },
  };
}

/** The content-addressed ask digest of one gap (the WHAT of the escalation). */
export function hostileAskDigestOf(gapRecord: CapabilityGapRecord): ContentDigest {
  return runtimeDigestOf({
    tag: "playliquid:qa-e2e-lab:arena-ask:1",
    gapId: String(gapRecord.gapId),
    missingCapability: gapRecord.missingCapability,
    cycleId: String(gapRecord.cycleId),
  });
}

/** The provider-neutral external ref of one Arena case (lock 32). */
export function hostileEscalationRefOf(escalationCase: ArenaEscalationCase): ArenaEscalationRef {
  return {
    external: "arena-external",
    escalationId: escalationCase.request.escalationId,
    requestDigest: escalationCase.request.requestDigest,
  };
}
