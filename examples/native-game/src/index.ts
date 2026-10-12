/**
 * LUMEN RUN — the public entrypoint of the Native GameOS reference game
 * (PL-037; examples/native-game).
 *
 * The demonstration that GameOS-native projects use GameIR directly
 * (§Engine strategy): everything below composes the platform's OWN
 * authorities — the GameIR document and validators, the package
 * registry/artifact store, the Interactive Runtime kernel, the platform
 * services, the build pipeline and the replay primitive — through their
 * public contracts only. This barrel is the example's module surface
 * (src/module.ts declares it; src/contract.ts is the PL-010 governance
 * re-export).
 */

// Module manifest (PL-010 governance format)
export { nativeGameModule } from "./module.ts";

// Identity + semantic vocabulary (frozen data)
export * from "./ids.ts";
export * from "./events.ts";

// The game content (GameIR-direct: no engine envelope)
export * from "./document.ts";

// The versioned composition (§Game model) + its package set
export { composeGame } from "./composition.ts";
export type { GameComposition, CompositionRefusal, CompositionInput } from "./composition.ts";
export {
  PACKAGE_IDS,
  documentArtifactBytes,
  lockFingerprintOf,
  publishGamePackages,
  verifyGameLock,
} from "./packages.ts";
export type { PackagePublicationRefusal, PublishedPackages } from "./packages.ts";

// Targets and builds (R6 spark profile; R12 web binding; §Build)
export {
  LUMEN_COST_MODEL,
  composeLumenSparkBuild,
  composeLumenWebInputs,
  lumenEngineBinding,
  lumenEngineBindingRef,
  lumenSparkProfileRecord,
  lumenToolchain,
  planLumenSpark,
  runLumenSparkBuild,
} from "./build.ts";
export type { SparkPlanning, SparkPlanningRefusal, SparkPlanningResult, WebBuildInputsResult } from "./build.ts";

// The world driver (the kernel's game seam)
export { LumenRunDriver, initialLumenRunWorld, moteColumn } from "./driver.ts";
export type { LumenRunWorld } from "./driver.ts";

// Platform policy declarations (R7: declared, never re-implemented)
export * from "./platform-policy.ts";

// The platform service rig (R7 composition root)
export { createPlatformRig, sharedFixedClock } from "./platform-services.ts";
export type { PlatformRig } from "./platform-services.ts";

// Authoritative-outcome derivations (R9/R10/R11)
export {
  CANONICAL_FOLLOW,
  achievementEvidencesOf,
  completedEventOf,
  eventDigestOf,
  gameEventOf,
  intFieldOf,
  scoreRecordOf,
  settlementRequestOf,
  socialCommandOf,
} from "./outcomes.ts";

// Session wiring + client-intent builders (R9: intents, never outcomes)
export {
  COMPANION_GRANT_ID,
  actInput,
  companionGrant,
  createLumenSession,
  gameRefOf,
  playerIntent,
} from "./session.ts";
export type { LumenSession } from "./session.ts";

// The headless view model (the honest non-engine surface)
export * from "./view.ts";

// Replay capture + deterministic re-execution (R8/R11)
export { compareSealedReplay, createLumenReplayLauncher, sealCanonicalReplay, verifySealedReplay } from "./replay.ts";
export type { SealedReplay } from "./replay.ts";

// The canonical scripted playthrough (E9; the full Experience Protocol)
export { runCanonicalPlaythrough } from "./playthrough.ts";
export type { CanonicalPlaythrough } from "./playthrough.ts";
