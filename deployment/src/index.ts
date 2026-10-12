/**
 * deployment PUBLIC ENTRYPOINT (PL-044) — the deployment TRUTH tree.
 *
 * Three surfaces, one tree (E11 honesty throughout):
 *
 * 1. THE TYPED DEPLOYMENT MODEL: DeploymentPlan = service units pinned to
 *    PL-011 content digests (no floating tags), frozen-taxonomy targets,
 *    services/ops health-door readiness gates, R20 least-privilege
 *    rights scopes and the all-false environment truth.
 * 2. THE DEPLOYMENT VERIFIER: plan → verify → typed refusals (E8) with a
 *    content-addressed seal for verified plans (E9 deterministic). The
 *    verifier re-runs the R19 release gate itself, resolves every pin
 *    through BOTH the registry and the CAS, verifies target profiles
 *    through target-builds' own door, and adjudicates every rights
 *    scope through security-gameos' pure lattice fold.
 * 3. THE APPEND-ONLY DEPLOYMENT JOURNAL (E10): deployments are records,
 *    never edits — chained digests, idempotent duplicate receipts, a
 *    typed-refusal edit door and tamper-refusing restore.
 *
 * Plus the committed manifest evidence (manifests/deployment-plan.json,
 * generated deterministically from the corpus and re-verified by tests)
 * and the TEST-SUPPORT hostile doubles (fixtures.ts — clearly labeled,
 * never production, E11).
 *
 * There is NO real infrastructure here (E11): no processes, no network,
 * no containers, no k8s, no secrets management — in-process typed models
 * over injected ports, deterministic under injected clocks. A real
 * deployment binds the same contracts to real infrastructure.
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// Module manifest (PL-010 governance format)
export { deploymentModule } from "./module.ts";

// The content-addressed identity seam (E9).
export {
  deployDigestOf,
  deployJournalEntryDigestOf,
  deployManifestDigestOf,
  deployPlanDigestOf,
  deploySealDigestOf,
  isContentDigest,
  isJsonSafe,
  isSealDigestHex,
  jsonSafeOf,
  taggedDigestOf,
} from "./digest.ts";

// THE TYPED DEPLOYMENT MODEL.
export { DEPLOYMENT_TRUTH, DEPLOYMENT_UNIT_KINDS, deploymentPlanContent, deploymentPlanDigest, isDeploymentEnvironmentTruth, isDeploymentPlan, isDeploymentSubmitter, isDeploymentUnit, isDeploymentUnitKind } from "./model.ts";
export type {
  DeploymentEnvironmentTruth,
  DeploymentPlan,
  DeploymentSubmitter,
  DeploymentUnit,
  DeploymentUnitKind,
} from "./model.ts";

// The verifier's doors + result vocabulary.
export { DEPLOYMENT_VERIFIER_ID } from "./ports.ts";
export type {
  DeploymentCasDoor,
  DeploymentClockPort,
  DeploymentDoors,
  DeploymentProfileDoor,
  DeploymentRefusalCode,
  DeploymentRegistryDoor,
  DeploymentSeal,
  DeploymentVerification,
  DeploymentVerifierOptions,
} from "./ports.ts";

// THE DEPLOYMENT VERIFIER (E8/E9/R19/R20).
export { mintDeploymentSeal, verifyDeploymentPlan, verifyDeploymentSeal } from "./verifier.ts";

// THE APPEND-ONLY DEPLOYMENT JOURNAL (E10).
export {
  DEPLOYMENT_JOURNAL_ENTRY_KINDS,
  DEPLOYMENT_JOURNAL_GENESIS,
  DeploymentJournalService,
  appendDeploymentJournalEntry,
  deploymentJournalEntryOf,
  isDeploymentJournalEntryKind,
  verifyDeploymentJournal,
} from "./journal.ts";
export type {
  DeploymentJournalEntry,
  DeploymentJournalEntryKind,
  DeploymentJournalRefusalCode,
  DeploymentJournalRestoreResult,
  DeploymentJournalVerification,
  DeploymentRecordResult,
} from "./journal.ts";

// THE DETERMINISTIC TOPOLOGY CORPUS + MANIFEST EVIDENCE (E9/E11).
export {
  DEPLOYMENT_CORPUS_COMMIT,
  DEPLOYMENT_PLAN_ID,
  DEPLOYMENT_SUBMITTER_SUBJECT,
  DEPLOYMENT_TENANT,
  ECONOMY_SERVICE_SUBJECT,
  INTEGRITY_SERVICE_SUBJECT,
  OPS_RUNTIME_SUBJECT,
  WEB_HOST_SUBJECT,
  createCorpusDoors,
  honestTopologyPlan,
  honestTopologyUnits,
  sealCorpusRecord,
} from "./corpus.ts";
export {
  DEPLOYMENT_MANIFEST_GENERATOR,
  DEPLOYMENT_MANIFEST_INSTANT,
  DEPLOYMENT_MANIFEST_VERSION,
  generateDeploymentManifest,
  generateDeploymentManifestJson,
  parseDeploymentManifest,
  verifyDeploymentManifest,
} from "./manifest.ts";
export type { DeploymentManifest, DeploymentManifestParse, DeploymentManifestVerification } from "./manifest.ts";

// TEST-SUPPORT hostile doubles + tamper helpers (lock rule 44: clearly
// labeled, never production integrations — E11).
export {
  createHostileDoors,
  flipDigestChar,
  lyingRegistryDoor,
  planWithCrossTenantScope,
  planWithTamperedArtifactDigest,
  planWithUnknownHealthDoor,
  recordWithEmptyHistory,
  recordWithUndisclosedModel,
  recordWithUnverifiedLicense,
  tamperedRecord,
  withUnitPatched,
} from "./fixtures.ts";
