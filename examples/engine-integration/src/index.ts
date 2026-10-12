/**
 * FORGE — the public entrypoint of the engine-native reference workflow
 * (PL-038; examples/engine-integration).
 *
 * The end-to-end demonstration of the ENGINE-NATIVE product thesis:
 * assets authored through the Blender tool adapter over the Tool Fabric
 * runtime, targets adjudicated by the three engine adapters' typed
 * bindings, staged builds through the real build-orchestrator, and every
 * sealed artifact resolved through the registry/CAS with R19 provenance —
 * all in-process, deterministic (E9) and E11-honest about exactly what
 * runs (see README.md). This barrel is the example's module surface
 * (src/module.ts declares it; src/contract.ts is the PL-010 governance
 * re-export).
 */

// Module manifest (PL-010 governance format)
export { engineIntegrationModule } from "./module.ts";

// Identity + workflow vocabulary
export * from "./ids.ts";
export * from "./document.ts";
export type { AdjudicatedCandidate } from "./adjudication.ts";

// The GameIR game composition (engine-independent content)
export { forgeGameDocument, gameDocumentBytes } from "./game.ts";
export { ANVIL_ENTITY, PRESS_ENTITY, SCENE_FOUNDRY, WORLD_FORGE } from "./game.ts";

// The append-only workflow journal (E10)
export * from "./journal.ts";

// The tool fabric rig + the authoring stage
export { capabilityTool, createForgeAdapters, createWorkflowClock } from "./rig.ts";
export type { ForgeAdapters, WorkflowClock } from "./rig.ts";
export { runAuthoringStage } from "./authoring.ts";
export type { AuthoringOutcome, AuthoringRefusal, SealedAsset, ToolCallReceipt } from "./authoring.ts";

// Engine target adjudication (the typed bindings)
export { forgeEngineBindings, forgeProfiles, runAdjudicationStage } from "./adjudication.ts";
export type { AdjudicationVerdict, EngineBindings, ForgeProfiles } from "./adjudication.ts";

// The registry/CAS stage (R19 provenance, lock rule 10)
export { journalPublication, openForgeStores, PACKAGE_IDS, publishBuildOutputs, publishContentPackages, verifyForgeLock } from "./packages.ts";
export type { BuildOutputsPublication, ForgeStores, PublicationRefusal } from "./packages.ts";

// The staged build stage (the real build-orchestrator pipeline)
export {
  composeForgeBuildInputs,
  createForgeBuildFabric,
  forgeKnownContent,
  forgeToolchainDigest,
  runForgeBuild,
  validationScriptDigest,
} from "./builds.ts";
export type { BuildOutcome, BuildRefusal, ForgeBuildPins } from "./builds.ts";

// The canonical driver (E9: two runs, identical journals + digests)
export { runCanonicalEngineWorkflow } from "./workflow.ts";
export type { CanonicalWorkflowRun, WorkflowRefusal } from "./workflow.ts";
