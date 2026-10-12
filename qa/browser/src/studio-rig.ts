/**
 * STUDIO JOURNEY RIG — the HOST side of the Game Studio journey (PL-043).
 *
 * The task order for this journey: "a host composes the Studio view models
 * over real package-system/runtime/tool-fabric/avatar/capability read
 * models". This rig IS that host: it assembles ONE authoritative
 * `StudioDataSnapshot` from the REAL sibling systems through their public
 * entrypoints only — sealed package records + release-gate verdicts + a
 * lockfile (`@playliquid/package-system`, built HERE), a live interactive
 * kernel session driven through its public operations
 * (`@playliquid/runtime-core` over `@playliquid/runtime-contracts`), a
 * real broker with a seeded grant and tracked evaluations
 * (`@playliquid/capability-broker`), the demo avatar under a host
 * restriction (`@playliquid/avatar-runtime` + the R5 vocabulary of
 * `@playliquid/game-contracts`) and a tool-fabric runtime with two jobs
 * (`@playliquid/tool-fabric-runtime` over game-ui's labeled TEST-SUPPORT
 * structural adapter) — the latter four composed in studio-fixtures.ts.
 *
 * TEST-SUPPORT RIG (lock rule 44): nothing here is a production
 * integration — it is the same honesty class as game-ui's own demo
 * fixture, deliberately composed with DIFFERENT data (ids, versions,
 * seeds, scripts) so the journey proves the host seam independently of
 * the package's own tests.
 *
 * Determinism (E9): manual clocks everywhere, fixed seeds, a scripted
 * executor; calling {@link composeStudioJourneySnapshot} twice yields
 * deep-equal snapshots (asserted by the journey).
 */

import {
  LOCK_SCHEMA_VERSION,
  checkReleaseGate,
  parseSemver,
  sealPackageRecord,
} from "../../../packages/package-system/src/index.ts";
import type {
  PackageLock,
  PackageRecord,
  ReleaseGateResult,
  UnsealedPackageRecord,
} from "../../../packages/package-system/src/index.ts";
import type { StudioDataSnapshot } from "./studio-ui.ts";
import {
  JOURNEY_RESTRICTION,
  journeyAvatar,
  journeyBroker,
  journeySession,
  journeyTools,
} from "./studio-fixtures.ts";

// The fixture half of the rig is re-exported for the journey tests.
export { JOURNEY_RESTRICTION, JOURNEY_STUDIO_SESSION_ID } from "./studio-fixtures.ts";

// ---------------------------------------------------------------------------
// Packages surface (real seal + release-gate verdicts + a lockfile)
// ---------------------------------------------------------------------------

function journeyMetadata(licenseStatus: "verified" | "declared"): UnsealedPackageRecord["metadata"] {
  return {
    dependencies: [],
    providedCapabilities: [{ id: "game.journey/rules", version: parseSemver("2.1.0")! }],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: licenseStatus },
    provenance: {
      origin: { type: "original" },
      sourceCommit: null,
      transformationHistory: [{ kind: "author", description: "authored by the browser-journey host rig" }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["interactive", "simulation"], engines: [], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
  };
}

/** Two sealed records — one gate-passing, one DECLARED-license (gate-blocked). */
function journeyPackages(): {
  readonly records: readonly PackageRecord[];
  readonly gateResults: Readonly<Record<string, ReleaseGateResult>>;
  readonly lock: PackageLock;
} {
  const gameRecord = sealPackageRecord({
    identity: { kind: "game", id: "game.journey-run", version: parseSemver("2.3.0")! },
    metadata: journeyMetadata("verified"),
  } satisfies UnsealedPackageRecord);
  // Deliberately DECLARED-only licensing: the release gate must block this
  // row (R19 — provenance/licensing is a release gate, E8 surfaces it).
  const assetRecord = sealPackageRecord({
    identity: { kind: "assets", id: "asset.journey-kit", version: parseSemver("1.1.0")! },
    metadata: journeyMetadata("declared"),
  } satisfies UnsealedPackageRecord);
  const records = [gameRecord, assetRecord];
  const gateResults: Record<string, ReleaseGateResult> = {};
  for (const record of records) {
    gateResults[record.identity.id] = checkReleaseGate(record);
  }
  const lock: PackageLock = {
    lockVersion: LOCK_SCHEMA_VERSION,
    packages: records.map((record) => ({
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
      contentDigest: record.identity.contentDigest,
    })),
    hostCapabilities: [],
  };
  return { records, gateResults, lock };
}

/**
 * Compose ONE authoritative studio snapshot from the real sibling
 * systems. Deterministic (E9): same call → deep-equal snapshot.
 */
export async function composeStudioJourneySnapshot(): Promise<StudioDataSnapshot> {
  const packages = journeyPackages();
  const session = journeySession();
  const broker = journeyBroker();
  const tools = await journeyTools();
  return Object.freeze({
    packages: packages.records,
    gateResults: packages.gateResults,
    lock: packages.lock,
    session: session.session,
    operations: session.operations,
    observation: session.observation,
    avatars: [journeyAvatar()],
    restriction: JOURNEY_RESTRICTION,
    policy: broker.policy,
    broker: broker.broker,
    evaluations: broker.evaluations,
    registrations: tools.registrations,
    jobs: tools.jobs,
    events: tools.events,
  } satisfies StudioDataSnapshot);
}
