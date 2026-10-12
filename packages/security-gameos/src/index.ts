/**
 * @playliquid/security-gameos — public surface (PL-041).
 *
 * THE least-privilege rights authority (R20): the rights lattice
 * composing capability-broker grants × avatar-runtime host restrictions
 * (R5: restrictions only ever REMOVE) × PL-011 registry/CAS admission
 * gates × platform-economy entitlements (R10) × platform-integrity
 * verdicts as typed probabilistic evidence (R11) × arena-integration-
 * runtime escalation rights — with the append-only refusal ledger (E10)
 * and typed refusals everywhere (E8).
 *
 * Delegated vocabularies surface VERBATIM (platform-contracts
 * least-privilege codes, runtime-contracts ActionDenialReason codes,
 * package-registry/package-system admission codes, platform-economy
 * settlement codes, PL-031 case-read codes); local codes are this
 * package's own frozen vocabulary in vocabulary.ts.
 *
 * Module map:
 * - digest.ts            pure SHA-256 + canonical JSON + slugs
 * - vocabulary.ts        THE frozen vocabulary (codes + role seam)
 * - ports.ts             injected ports + state document shapes
 * - lattice-folds.ts     adjudication result shapes + shared arm folds
 * - lattice.ts           the pure effective-right computation
 * - lattice-runtime.ts   the runtime arm (broker-mediated actions)
 * - admission.ts         package/artifact admission gates (PL-011)
 * - entitlement.ts       settlement-action authorization (R10)
 * - integrity-rights.ts  standing → lattice entry fold (R11)
 * - escalation.ts        ingested case → elevated review right (PL-031)
 * - ledger.ts            the append-only refusal ledger (E10)
 * - document.ts          snapshot serialization + tamper-evident adoption
 * - service-types.ts     service door result shapes
 * - service.ts           RightsAuthority: THE mutable-state owner
 * - fakes.ts             deterministic in-memory ports + read adapters
 * - rig.ts               the same-rig deterministic fixtures over the
 *                        REAL dep services
 * - harness.ts           runtime evidence harness (node src/harness.ts)
 *
 * Purity: the whole package is domain-pure — no IO, no timers, no
 * globals, no randomness. Only `process.exitCode` is touched (by the
 * harness, on failure).
 */

// Values — digest
export { canonicalJson, sha256Hex, digestOf, digestSlug } from "./digest.ts";

// Values — vocabulary (the frozen contract)
export {
  RIGHTS_AUTHORITY_ROLES,
  isRightsAuthorityRole,
  checkRightsRole,
  LATTICE_LOCAL_REFUSAL_CODES,
} from "./vocabulary.ts";

// Values — lattice
export { adjudicate, currentSuspension, denialReasonOf } from "./lattice.ts";

// Values — admission
export { admitPackageRecord } from "./admission.ts";

// Values — entitlement
export { authorizeSettlementAction } from "./entitlement.ts";

// Values — integrity rights
export { foldStanding, standingEntryId, dispositionOf, suspendsFor } from "./integrity-rights.ts";

// Values — escalation
export { mintEscalationRight, escalationRightId } from "./escalation.ts";

// Values — ledger
export {
  refusalIdOf,
  refusalRecordOf,
  appendRefusal,
  ledgerOf,
  ledgerIsAppendOnly,
} from "./ledger.ts";

// Values — document
export { documentOf, documentDigestOf, snapshotOf, adoptDocument } from "./document.ts";

// Values — the service
export { RightsAuthority } from "./service.ts";

// Values — fakes + rig (test support; NOT production adapters)
export {
  createMemoryRightsStore,
  createFixedRightsClock,
  createMemoryAdminDirectory,
  rightsAdminGrant,
  rightsAuditorGrant,
  createMemoryPlatformGrants,
  brokerSnapshotOf,
  createEconomyReadPort,
  createIntegrityStandingPort,
  createEscalationCasesPort,
} from "./fakes.ts";
export {
  createSecurityRig,
  rigStateDigest,
  rigTimestamp,
  RIG_TENANT,
  RIG_FOREIGN_TENANT,
  RIG_ADMIN,
  RIG_AUDITOR,
  RIG_PLAYER,
  RIG_OUTSIDER,
  RIG_SUSPENDED_SUBJECT,
  RIG_CLEAN_SUBJECT,
  RIG_AVATAR_SUBJECT,
  RIG_OTHER_HOLDER,
  RIG_REVIEWER,
  RIG_SESSION,
  RIG_HOST,
  RIG_ECONOMY_OPERATOR,
  RIG_ECONOMY_READER,
  RIG_INTEGRITY_OPERATOR,
  RIG_EVENT_KIND,
  RIG_ENTITLEMENT_KIND,
  RIG_RESTRICTION,
} from "./rig.ts";
export type { SecurityRig } from "./rig.ts";

// Types — vocabulary
export type {
  PrivilegeRefusalCode,
  RuntimeSessionView,
  RightsCapability,
  RightsRequest,
  LatticeRefusalCode,
  AdmissionRefusalCode,
  SettlementAuthorizationCode,
  RightsDoorRefusalCode,
  RightsAuthorityRole,
  RightsAuthorityGrant,
  RoleCheck,
} from "./vocabulary.ts";

// Types — ports + document
export type {
  RightsClockPort,
  RightsStorePort,
  StoredRightsSnapshot,
  RightsAdminDirectory,
  PlatformGrantDirectory,
  BrokerSnapshot,
  BrokerSnapshotPort,
  RegistryReadPort,
  ArtifactsPort,
  EntitlementRead,
  EconomyReadPort,
  StandingRead,
  IntegrityStandingPort,
  EscalationCaseReadRecord,
  EscalationCaseRead,
  EscalationCasesPort,
  HostBindingRecord,
  SessionBindingRecord,
  StandingDisposition,
  IntegrityRightsEntry,
  ElevatedReviewRight,
  RefusalRecord,
  RightsStateDocument,
  RightsServiceOptions,
} from "./ports.ts";

// Types — lattice
export type { IntegrityEvidenceNote, EffectiveRight, AdjudicationResult, LatticeInputs } from "./lattice.ts";

// Types — admission
export type { PackageAdmissionRequest, PackageAdmissionResult } from "./admission.ts";

// Types — entitlement
export type { SettlementActionRequest, SettlementAuthorization, SettlementGateInputs } from "./entitlement.ts";

// Types — integrity rights
export type { StandingIngestionResult } from "./integrity-rights.ts";

// Types — escalation
export type { EscalationRightResult } from "./escalation.ts";

// Types — ledger
export type { LedgerAppendResult } from "./ledger.ts";

// Types — document
export type { AdoptionResult } from "./document.ts";

// Types — service doors
export type {
  RightsDoorRefusal,
  BindingResult,
  SessionBindingResult,
  StandingDoorResult,
  EscalationDoorResult,
  SnapshotResult,
  RestoreResult,
  LedgerReadResult,
  LatticeStateView,
  LatticeStateResult,
  AvatarBindingInput,
} from "./service-types.ts";
