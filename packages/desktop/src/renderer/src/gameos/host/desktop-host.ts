/**
 * THE DESKTOP PRODUCT HOST (RW-001): the composition root of the
 * PlayLiquid GameOS product shell — the HOST side of the frozen
 * PL-033/034 mount recipe, executed for the desktop.
 *
 * It composes the REAL authoritative domain implementations behind the
 * product modules' typed port seams and NOTHING else:
 * - Game Studio (game-ui): the package registry (package-registry over the
 *   host's store port) + a real capability broker over a real host policy
 *   + the real tool-fabric runtime over host adapters;
 * - Lab (gameos-lab): the real PL-029 organization service over the real
 *   PL-028 simulation service, plus the real PL-030 learning service, each
 *   over the host's own port adapters (clock, suite directory, evidence
 *   ledger, observation view, replay sink, persistence);
 * - Community (gameos-community): the real PL-032 community service over
 *   the host's own store/clock/identity adapters, with its R18 gap seam
 *   wired to the REAL Lab gap records and its E8 package-qualification
 *   seam wired to the REAL Studio registry.
 *
 * Cross-module wiring is the host's job and happens ONLY here: state and
 * command ownership stay with the authoritative services (E5/E13
 * verbatim). No demo fixtures, no StaticStudioDataPort, no fakes (lock
 * rule 44): the first-run state of every surface is the REAL empty state
 * of the composed services, and every snapshot is read through the
 * services' own public read doors.
 *
 * Honest scope: persistence is session-scoped in-memory (durable host
 * storage is outside RW-001's write surface — recorded as an environment
 * limitation, never faked); the Lab's suite directory, evidence ledger
 * and observation ledger start empty (no desktop pipelines feed them
 * yet); the Arena surface reads zero cases (no external Arena connection
 * is configured in the desktop host).
 */

import type { GameIdentity } from "../../../../../../game-contracts/src/index.ts";
import type {
  EvaluationSuiteResolver,
  LabEvaluationSuite,
  ObservedOutcomeRecord,
  ProjectEvidenceRecord,
} from "../../../../../../lab-contracts/src/index.ts";
import type { CapabilityGapRecord } from "../../../../../../lab-contracts/src/index.ts";
import { LabSimulationService } from "../../../../../../lab-simulation/src/index.ts";
import { LabOrganizationService } from "../../../../../../lab-organization/src/index.ts";
import { LabLearningService } from "../../../../../../lab-learning/src/index.ts";
import { CommunityService } from "../../../../../../community/src/index.ts";
import type {
  CommunityStore,
  GapDirectory,
  PackageRegistrySeam,
  ServiceClock,
  SubjectDirectory,
} from "../../../../../../community/src/index.ts";
import type { CapabilityGapLink, GapSeamFacts } from "../../../../../../community/src/index.ts";
import { openRegistry } from "../../../../../../package-registry/src/index.ts";
import type { PackageRegistry } from "../../../../../../package-registry/src/index.ts";
import { checkReleaseGate } from "../../../../../../package-system/src/index.ts";
import type { PackageRecord } from "../../../../../../package-system/src/index.ts";
import { CapabilityBroker, brokerPolicy } from "../../../../../../capability-broker/src/index.ts";
import type { BrokerPolicy } from "../../../../../../capability-broker/src/index.ts";
import { asTimestamp } from "../../../../../../runtime-contracts/src/index.ts";
import {
  createInMemoryArtifactExchange,
  createInMemoryShapeCatalog,
  createToolFabricRuntime,
} from "../../../../../../tool-fabric-runtime/src/index.ts";
import type { ToolFabricRuntime } from "../../../../../../tool-fabric-runtime/src/index.ts";
import type { SubjectId, TenantId } from "../../../../../../platform-contracts/src/index.ts";
import { LOCAL_SUBJECT, LOCAL_TENANT, localProjectIdentity as defaultLocalProjectIdentity } from "../identity.ts";
import {
  asLabClock,
  createDesktopCommunityClock,
  createDesktopCommunityStore,
  createDesktopHostClock,
  createDesktopRegistryStore,
  createDesktopSubjectDirectory,
  createLabEvaluationStore,
  createLabLearningStore,
  createLabOrganizationStore,
  createUnavailableToolExecutor,
  type DesktopHostClock,
} from "./adapters.ts";
import { DesktopStudioDataPort } from "./studio-adapter.ts";
import { DesktopLabCommandPort, DesktopLabDataPort } from "./lab-adapter.ts";
import { DesktopCommunityCommandPort, DesktopCommunityDataPort } from "./community-adapter.ts";

/** The local operator tenancy the shell composes (R20 viewer scope). */
export interface DesktopViewer {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}

/** Host options (tests pin deterministic facts through them). */
export interface DesktopProductHostOptions {
  /**
   * Overrides the local project identity the Lab organizes. Present-but-
   * undefined forces the honest no-context refusal path (tests); when the
   * key is absent the host pins the build revision (gameos/identity.ts).
   */
  readonly localProjectIdentity?: GameIdentity;
}

/** The composed product host: real services + the module port adapters. */
export interface DesktopProductHost {
  readonly viewer: DesktopViewer;
  readonly clock: DesktopHostClock;
  /** The Studio backing systems. */
  readonly studio: {
    readonly registry: PackageRegistry;
    readonly broker: CapabilityBroker;
    readonly tools: ToolFabricRuntime;
    readonly port: DesktopStudioDataPort;
  };
  /** The Lab backing services + the two seams. */
  readonly lab: {
    readonly organization: LabOrganizationService;
    readonly simulation: LabSimulationService;
    readonly learning: LabLearningService;
    readonly data: DesktopLabDataPort;
    readonly command: DesktopLabCommandPort;
  };
  /** The Community backing service + the two seams. */
  readonly community: {
    readonly service: CommunityService;
    readonly store: CommunityStore;
    readonly directory: SubjectDirectory;
    readonly clock: ServiceClock;
    readonly data: DesktopCommunityDataPort;
    readonly command: DesktopCommunityCommandPort;
  };
  /** The game identity the Lab organizes, when pinned (host fact). */
  readonly localProjectIdentity: () => GameIdentity | undefined;
  /** The collected replay records (session-scoped R8 evidence; opaque). */
  readonly replayRecords: () => readonly unknown[];
  /** The recorded capability gaps of the local tenant (real Lab doors). */
  readonly capabilityGaps: () => readonly CapabilityGapRecord[];
}

/**
 * Creates the desktop product host with its package registry OPENED (the
 * registry open is the one async composition step; the frozen mount recipe
 * awaits it before the first authoritative snapshot is loaded).
 */
export async function createDesktopProductHost(
  options: DesktopProductHostOptions = {},
): Promise<DesktopProductHost> {
  const clock = createDesktopHostClock();
  const labClock = asLabClock(clock);

  // --- Lab seams: suite directory, evidence ledger, observation view,
  // replay sink — host-owned and EMPTY by honest composition (no desktop
  // pipeline feeds them yet; the host refuses to fabricate them, E11).
  const suites = new Map<string, LabEvaluationSuite>();
  const suiteResolver: EvaluationSuiteResolver = (ref) => {
    const suite = suites.get(String(ref.suiteId));
    return suite !== undefined && suite.ref.contentDigest === ref.contentDigest ? suite : undefined;
  };
  const evidenceLedger = new Map<string, ProjectEvidenceRecord>();
  const observationLedger = new Map<string, ObservedOutcomeRecord>();
  const replays: unknown[] = [];

  const simulation = new LabSimulationService({
    ports: {
      clock: labClock,
      suites: suiteResolver,
      evidence: (recordId) => evidenceLedger.get(String(recordId)),
      observations: (observationId) => observationLedger.get(String(observationId)),
      replays: (record) => {
        replays.push(record);
      },
      store: createLabEvaluationStore(),
    },
  });

  const organization = new LabOrganizationService({
    ports: {
      clock: labClock,
      // No agent bodies are composed in the desktop host yet — the body
      // axis collapses (the lab-learning journey-stack precedent).
      bodies: () => undefined,
      evaluation: simulation,
      store: createLabOrganizationStore(),
    },
  });

  const learning = new LabLearningService({
    ports: { clock: labClock, store: createLabLearningStore() },
  });

  // --- Studio seams: registry (real open over the host store), a real
  // broker over a real host policy, the real tool-fabric runtime.
  const registryStore = createDesktopRegistryStore();
  const policyResult = brokerPolicy([], { denied: [], approvalRequired: [] });
  if (!policyResult.ok) {
    // Unreachable: an empty coverage declaration is always valid.
    throw new Error(`desktop host: broker policy refused: ${policyResult.detail}`);
  }
  const policy: BrokerPolicy = policyResult.policy;
  const broker = new CapabilityBroker({
    policy,
    clock: { now: () => asTimestamp(clock.now()) },
    commandIdPrefix: "gameos-desktop",
  });
  const tools = createToolFabricRuntime({
    clock: { now: () => clock.now() },
    executor: createUnavailableToolExecutor(),
    shapeCatalog: createInMemoryShapeCatalog(),
    artifactExchange: createInMemoryArtifactExchange(),
  });

  // --- Community seams: the real service over host adapters; the R18 gap
  // seam reads the REAL Lab gap records; the E8 registry seam reads the
  // REAL Studio registry (one registry for the whole host).
  const communityStore = createDesktopCommunityStore();
  const directory = createDesktopSubjectDirectory();
  directory.register(LOCAL_TENANT, LOCAL_SUBJECT);
  directory.registerMaintainer(LOCAL_TENANT, LOCAL_SUBJECT);

  const capabilityGaps = (): readonly CapabilityGapRecord[] =>
    organization.listCapabilityGaps({ tenant: LOCAL_TENANT, subject: LOCAL_SUBJECT });

  const gaps: GapDirectory = {
    factsOf: (link: CapabilityGapLink): GapSeamFacts => {
      const record = capabilityGaps().find((gap) => String(gap.gapId) === String(link.gapId));
      if (record === undefined) {
        return { exists: false, resolved: false, blocked: false, communityRungReached: false };
      }
      const last = record.attempts[record.attempts.length - 1];
      return {
        exists: true,
        resolved: last?.outcome === "resolved",
        blocked: last?.rung === "blocked",
        communityRungReached: record.attempts.some(
          (attempt) =>
            attempt.rung === "user-community-contribution" || attempt.rung === "arena-escalation",
        ),
      };
    },
  };

  let registryRef: PackageRegistry | null = null;
  const packages: PackageRegistrySeam = {
    qualificationOf: (coordinate: unknown): { published: boolean; provenancePasses: boolean } => {
      const current = registryRef;
      if (current === null) return { published: false, provenancePasses: false };
      const candidate = coordinate as
        | {
            readonly kind?: unknown;
            readonly id?: unknown;
            readonly version?: unknown;
            readonly contentDigest?: unknown;
          }
        | undefined;
      if (
        candidate?.kind === undefined ||
        candidate.id === undefined ||
        candidate.version === undefined
      ) {
        return { published: false, provenancePasses: false };
      }
      const found = current.get({
        kind: candidate.kind,
        id: candidate.id,
        version: candidate.version,
      } as Parameters<PackageRegistry["get"]>[0]);
      if (
        found === null ||
        String(found.identity.contentDigest) !== String(candidate.contentDigest)
      ) {
        return { published: false, provenancePasses: false };
      }
      const record: PackageRecord = found;
      return { published: true, provenancePasses: checkReleaseGate(record).pass };
    },
  };

  const community = new CommunityService({
    store: communityStore,
    clock: createDesktopCommunityClock(clock),
    directory,
    gaps,
    packages,
    policy: { maxOpenContributionsPerContributor: 100 },
  });

  const pinnedIdentity: GameIdentity | undefined =
    "localProjectIdentity" in options
      ? options.localProjectIdentity
      : defaultLocalProjectIdentity();

  const host: DesktopProductHost = {
    viewer: { tenant: LOCAL_TENANT, subject: LOCAL_SUBJECT },
    clock,
    studio: {
      get registry(): PackageRegistry {
        if (registryRef === null) {
          throw new Error(
            "desktop host: package registry not open yet — createDesktopProductHost awaits the open before returning",
          );
        }
        return registryRef;
      },
      broker,
      tools,
      port: new DesktopStudioDataPort(() => host),
    },
    lab: {
      organization,
      simulation,
      learning,
      data: new DesktopLabDataPort(() => host),
      command: new DesktopLabCommandPort(() => host),
    },
    community: {
      service: community,
      store: communityStore,
      directory,
      clock: createDesktopCommunityClock(clock),
      data: new DesktopCommunityDataPort(() => host),
      command: new DesktopCommunityCommandPort(() => host),
    },
    localProjectIdentity: () => pinnedIdentity,
    replayRecords: () => [...replays],
    capabilityGaps,
  };

  const opened = await openRegistry({ store: registryStore });
  if (!opened.ok) {
    throw new Error(`desktop host: the package registry refused to open: ${opened.message}`);
  }
  registryRef = opened.registry;
  return host;
}
