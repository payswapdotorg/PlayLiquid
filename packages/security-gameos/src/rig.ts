/**
 * THE SECURITY RIG (PL-041) — one deterministic composition of the REAL
 * sibling services behind the rights authority, built with DIFFERENT
 * fixture data than any dep package's own demo (ids, versions, seeds,
 * digests — the PL-043 rig doctrine), so every test and the harness
 * exercise the host seam independently.
 *
 * Composed REAL services (no parallel implementations anywhere):
 * - the package registry + artifact store (PL-011) carrying three
 *   sealed records — gate-passing, unlicensed, provenance-gap — indexed
 *   with the registry's documented permissive mode so THIS authority's
 *   admission gate is what fail-closes on them (defense in depth);
 * - the capability broker (PL-026) with a seeded movement grant and a
 *   host restriction denying `avatar.speech` at grant admission (R5);
 * - the composed avatar definition (PL-026 avatar-runtime) under the
 *   journey's host restriction;
 * - the economy service (PL-017) with a registered declaration, one
 *   settled entitlement and a read-only seam adapter;
 * - the integrity service (PL-018) with two submitted standings — a
 *   machine-like-under-human-claim pronounced deviation (suspension) and
 *   a human-like consistent verdict (clear hold);
 * - the arena runtime journey (PL-031) with one escalation case driven
 *   to `ingested`, read ingestion-only.
 *
 * Determinism (E9): fixed clocks, digest-derived ids, seeded grants —
 * constructing the rig twice yields identical lattice state and the
 * same content-addressed snapshot id (asserted by the tests/harness).
 */

import { asContentDigest, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { ContentDigest } from "@playliquid/platform-contracts";
import type { SettlementEligibilityDeclaration } from "@playliquid/platform-contracts";
import type { HostRestriction } from "@playliquid/game-contracts";
import { EconomyService } from "@playliquid/platform-economy";
import {
  createFixedClock,
  createMappingValueResolver,
  createMemoryEconomyStore,
  createMemoryGrantDirectory,
  createUnwiredRewardIntegrityPort,
  economyAdminGrant,
} from "@playliquid/platform-economy";
import type { EntitlementGrantId } from "@playliquid/platform-contracts";
import { IntegrityService } from "@playliquid/platform-integrity";
import {
  createFixedClock as createIntegrityClock,
  createMemoryGrantDirectory as createIntegrityGrants,
  createMemoryIntegrityStore,
  humanLikeTrace,
  integrityAdminGrant,
  machineLikeTrace,
} from "@playliquid/platform-integrity";
import type { TimestampMs } from "@playliquid/platform-contracts";
import { asTimestampMs } from "@playliquid/platform-contracts";
import { createArenaRuntimeJourney } from "@playliquid/arena-integration-runtime";
import { RightsAuthority } from "./service.ts";
import { digestOf } from "./digest.ts";
import {
  brokerSnapshotOf,
  createEconomyReadPort,
  createEscalationCasesPort,
  createFixedRightsClock,
  createIntegrityStandingPort,
  createMemoryAdminDirectory,
  createMemoryPlatformGrants,
  createMemoryRightsStore,
  rightsAdminGrant,
  rightsAuditorGrant,
} from "./fakes.ts";
import { buildPackageCorpus, buildRigAvatarDefinition, buildRigBroker } from "./rig-fixtures.ts";
import type { CapabilityBroker } from "@playliquid/capability-broker";
import type { AvatarDefinition } from "@playliquid/avatar-runtime";

// ---------------------------------------------------------------------------
// Frozen fixture vocabulary (distinct from every dep demo)
// ---------------------------------------------------------------------------

export const RIG_TENANT = "tenant-rig-alpha";
export const RIG_FOREIGN_TENANT = "tenant-rig-beta";
export const RIG_ADMIN = "oper-rig-security";
export const RIG_AUDITOR = "oper-rig-audit";
export const RIG_PLAYER = "player-rig-one";
export const RIG_OUTSIDER = "oper-rig-outsider";
export const RIG_SUSPENDED_SUBJECT = "actr-rig-susp";
export const RIG_CLEAN_SUBJECT = "actr-rig-clean";
export const RIG_AVATAR_SUBJECT = "actr-rig-avatar";
export const RIG_OTHER_HOLDER = "actr-rig-other";
export const RIG_REVIEWER = "oper-rig-reviewer";
export const RIG_SESSION = "sess-rig-one";
export const RIG_HOST = "host-rig-game";
export const RIG_ECONOMY_OPERATOR = "oper-rig-economy";
export const RIG_ECONOMY_READER = "oper-rig-econ-reader";
export const RIG_INTEGRITY_OPERATOR = "oper-rig-integrity";
export const RIG_EVENT_KIND = "match.rig-won";
export const RIG_ENTITLEMENT_KIND = "rig-tokens";

/** The journey's host restriction (R5): speech is removed outright. */
export const RIG_RESTRICTION: HostRestriction = {
  denied: ["speech"],
  approvalRequired: [],
  sandboxed: false,
};

const RIG_SHAPE_DIGEST = asContentDigest("e".repeat(64))!;
const RIG_VALUE = {
  carrier: "opaque-digest" as const,
  payloadDigest: asContentDigest("2".repeat(64))!,
};

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/** Everything a test/harness needs to walk the security authority. */
export interface SecurityRig {
  readonly authority: RightsAuthority;
  readonly admin: string;
  readonly auditor: string;
  readonly tenant: string;
  readonly foreignTenant: string;
  readonly broker: CapabilityBroker;
  readonly avatarDefinition: AvatarDefinition;
  readonly restriction: HostRestriction;
  readonly registry: ReturnType<typeof buildPackageCorpus>["registry"];
  readonly artifacts: ReturnType<typeof buildPackageCorpus>["artifacts"];
  /** The blob store behind the CAS (corruption seam for E10 negatives). */
  readonly blobStore: ReturnType<typeof buildPackageCorpus>["blobStore"];
  readonly packages: ReturnType<typeof buildPackageCorpus>["packages"];
  readonly economy: EconomyService;
  readonly entitlementId: EntitlementGrantId;
  readonly integrity: IntegrityService;
  readonly arenaCaseId: string;
  readonly clock: ReturnType<typeof createFixedRightsClock>;
  readonly store: ReturnType<typeof createMemoryRightsStore>;
  readonly platformGrants: ReturnType<typeof createMemoryPlatformGrants>;
  readonly admins: ReturnType<typeof createMemoryAdminDirectory>;
}

/**
 * Wires the full deterministic rig (async: the arena orchestration
 * drive is an async door of the PL-031 runtime).
 */
export async function createSecurityRig(): Promise<SecurityRig> {
  const tenant = RIG_TENANT;

  // --- Packages + broker + avatar (deterministic builders, rig-fixtures.ts).
  const corpus = buildPackageCorpus();
  const broker = buildRigBroker({
    sessionId: RIG_SESSION,
    avatarSubject: RIG_AVATAR_SUBJECT,
    otherHolder: RIG_OTHER_HOLDER,
  });
  const avatarDefinition = buildRigAvatarDefinition();

  // --- Economy (PL-017): declaration + one settled entitlement.
  const economyGrants = createMemoryGrantDirectory();
  economyGrants.grant(economyAdminGrant(asTenantId(tenant)!, asSubjectId(RIG_ECONOMY_OPERATOR)!));
  economyGrants.grant({
    tenant: asTenantId(tenant)!,
    subject: asSubjectId(RIG_ECONOMY_READER)!,
    capability: "rewards",
    permissions: ["read"],
  });
  economyGrants.grant({
    tenant: asTenantId(tenant)!,
    subject: asSubjectId(RIG_PLAYER)!,
    capability: "rewards",
    permissions: ["read", "submit"],
  });
  const declarations = new Map<string, SettlementEligibilityDeclaration[]>();
  const declaration: SettlementEligibilityDeclaration = {
    capability: "rewards",
    eventKind: RIG_EVENT_KIND as never,
    entitlementKind: RIG_ENTITLEMENT_KIND,
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: RIG_SHAPE_DIGEST as never,
  };
  const economy = new EconomyService({
    store: createMemoryEconomyStore().store,
    clock: createFixedClock().clock,
    grants: economyGrants.grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({ [String(RIG_VALUE.payloadDigest)]: 10 }),
  });
  const registered = economy.registerPolicy(asSubjectId(RIG_ECONOMY_OPERATOR)!, asTenantId(tenant)!, declaration);
  if (!registered.ok) throw new Error(`rig: policy not registered: ${registered.detail}`);
  declarations.set(tenant, [declaration]);
  const settled = economy.settleEvent(asSubjectId(RIG_ECONOMY_OPERATOR)!, {
    tenant: asTenantId(tenant)!,
    subject: asSubjectId(RIG_CLEAN_SUBJECT)!,
    eventKind: RIG_EVENT_KIND as never,
    sourceEventDigest: asContentDigest("c".repeat(64))!,
    value: RIG_VALUE,
    outcomeEvidence: asContentDigest("b".repeat(64))!,
    outcomeDecidedBy: "platform-authority",
    integrityConfidence: 0.99,
    mode: "immediate",
  });
  if (!settled.accepted) throw new Error(`rig: settlement refused: ${settled.detail}`);
  const entitlementId = settled.receipt.grantId;

  // --- Integrity (PL-018): the two standings.
  const integrityGrants = createIntegrityGrants();
  integrityGrants.grant(integrityAdminGrant(asTenantId(tenant)!, asSubjectId(RIG_INTEGRITY_OPERATOR)!));
  const integrity = new IntegrityService({
    store: createMemoryIntegrityStore().store,
    clock: createIntegrityClock().clock,
    grants: integrityGrants.grantsDirectory,
  });
  const suspending = integrity.submitEvaluation(asSubjectId(RIG_INTEGRITY_OPERATOR)!, {
    tenant: asTenantId(tenant)!,
    subject: asSubjectId(RIG_SUSPENDED_SUBJECT)!,
    source: { replayId: "replay-rig-susp", commandStream: machineLikeTrace() },
    claim: { claimKind: "unbacked", mode: "human" },
    capturedAt: asTimestampMs(1_000)!,
  });
  if (!suspending.accepted) throw new Error(`rig: suspending evaluation refused: ${suspending.detail}`);
  const clearing = integrity.submitEvaluation(asSubjectId(RIG_INTEGRITY_OPERATOR)!, {
    tenant: asTenantId(tenant)!,
    subject: asSubjectId(RIG_CLEAN_SUBJECT)!,
    source: { replayId: "replay-rig-clean", commandStream: humanLikeTrace() },
    claim: { claimKind: "unbacked", mode: "human" },
    capturedAt: asTimestampMs(1_100)!,
  });
  if (!clearing.accepted) throw new Error(`rig: clearing evaluation refused: ${clearing.detail}`);

  // --- Arena (PL-031): one escalation case driven to ingested.
  const arena = await createArenaRuntimeJourney({ tenant });
  const opened = arena.service.openEscalationCase(arena.caller, arena.decidedCommand());
  if (!opened.ok) throw new Error(`rig: case not opened: ${opened.detail}`);
  const caseId = String(opened.case.caseId);
  const driven = await arena.service.driveCase(arena.caller, caseId);
  if (!driven.ok || driven.outcome.status !== "ingested") {
    throw new Error(`rig: case not ingested: ${driven.ok ? driven.outcome.status : driven.detail}`);
  }

  // --- The authority over everything, read-only.
  const admins = createMemoryAdminDirectory();
  admins.grant(rightsAdminGrant(tenant, RIG_ADMIN));
  admins.grant(rightsAuditorGrant(tenant, RIG_AUDITOR));
  const platformGrants = createMemoryPlatformGrants();
  const clock = createFixedRightsClock(2_000);
  const store = createMemoryRightsStore();
  const authority = new RightsAuthority({
    clock: clock.clock,
    store: store.store,
    admins: admins.admins,
    platformGrants: platformGrants.directory,
    broker: brokerSnapshotOf(broker),
    registry: corpus.registry,
    artifacts: corpus.artifacts,
    economy: createEconomyReadPort({
      service: economy,
      reader: RIG_ECONOMY_READER,
      declarations: (tenantId) => declarations.get(tenantId) ?? [],
    }),
    integrity: createIntegrityStandingPort({ service: integrity, reader: RIG_INTEGRITY_OPERATOR }),
    escalations: createEscalationCasesPort({ service: arena.service, reader: String(arena.caller.subject) }),
  });

  // --- The canonical lattice state every test starts from.
  const binding = authority.registerAvatarBinding(RIG_ADMIN, {
    tenant,
    host: RIG_HOST,
    definition: avatarDefinition,
    restriction: RIG_RESTRICTION,
  });
  if (!binding.ok) throw new Error(`rig: binding refused: ${binding.detail}`);
  const session = authority.bindSession(RIG_ADMIN, tenant, RIG_SESSION);
  if (!session.ok) throw new Error(`rig: session binding refused: ${session.detail}`);
  for (const subject of [RIG_SUSPENDED_SUBJECT, RIG_CLEAN_SUBJECT]) {
    const standing = authority.ingestStanding(RIG_ADMIN, tenant, subject);
    if (!standing.ok) throw new Error(`rig: standing refused: ${standing.detail}`);
  }
  const review = authority.mintEscalationReviewRight(RIG_ADMIN, tenant, RIG_REVIEWER, caseId);
  if (!review.ok) throw new Error(`rig: escalation right refused: ${review.detail}`);

  return {
    authority,
    admin: RIG_ADMIN,
    auditor: RIG_AUDITOR,
    tenant,
    foreignTenant: RIG_FOREIGN_TENANT,
    broker,
    avatarDefinition,
    restriction: RIG_RESTRICTION,
    registry: corpus.registry,
    artifacts: corpus.artifacts,
    blobStore: corpus.blobStore,
    packages: corpus.packages,
    economy,
    entitlementId,
    integrity,
    arenaCaseId: caseId,
    clock,
    store,
    platformGrants,
    admins,
  };
}

/** The fixture digest of the rig's lattice state (determinism checks, E9). */
export function rigStateDigest(rig: SecurityRig): ContentDigest {
  const state = rig.authority.latticeState(rig.auditor, rig.tenant);
  if (!state.ok) throw new Error(`rig: lattice state refused: ${state.code}`);
  const material = {
    bindings: state.state.bindings.map((binding) => String(binding.definition.definitionDigest)),
    sessions: state.state.sessions.map((session) => session.sessionId),
    standings: state.state.standings.map((entry) => entry.entryId),
    elevated: state.state.elevated.map((right) => right.rightId),
  };
  return asContentDigest(digestOf(material))!;
}

/** A fixed timestamp helper for test/harness fixtures. */
export function rigTimestamp(ms: number): TimestampMs {
  return asTimestampMs(ms)!;
}
