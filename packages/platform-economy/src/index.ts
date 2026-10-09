/**
 * @playliquid/platform-economy — public surface (PL-017).
 *
 * The rewards/economy AUTHORITY service: policy admission for
 * game-declared eligible events, the entitlement ledger
 * (grants/balances/holds/settlements, tenant+subject scoped), and the
 * deterministic settlement pipeline, implemented over
 * `@playliquid/platform-contracts` per spec/module-dependency-matrix.md
 * row `economy | Platform | platform-contracts, integrity` (integrity
 * is the RewardIntegrityPort seam until PL-018 merges).
 *
 * Module map:
 * - digest.ts          pure SHA-256 + byte-stable canonical JSON (E9)
 * - integrity-port.ts  the PL-018 evidence seam (port, host-wired)
 * - policies.ts        reward policy admission (typed conflicts, E8)
 * - settlement.ts      the pure settlement admission oracle (R10)
 * - records.ts         deterministic id mints + record builders
 * - lifecycle.ts       hold/complete/revoke door contracts
 * - ledger.ts          ledger keys, entries, views, door contracts
 * - ports.ts           store, clock, grants, value resolver ports (E6)
 * - document.ts        service-owned state + snapshot conversions
 * - apply.ts           the internal mutation engine (oracle-gated)
 * - service-types.ts   the service door result shapes
 * - service.ts         the economy service (the mutable-state owner)
 * - fakes.ts           deterministic in-memory fakes for tests/harness
 *
 * Purity: the domain has no IO, no timers, no globals; every effect
 * lives behind a port. The service instance is the single
 * mutable-state owner.
 */

// Values
export { canonicalJson, sha256Hex, digestOf } from "./digest.ts";
export {
  policyKey,
  declarationsOf,
  adjudicatePolicyAdmission,
} from "./policies.ts";
export {
  isEconomySettlementRequest,
  settlementKeyOf,
  adjudicateEconomySettlement,
} from "./settlement.ts";
export {
  settlementIdempotencyKey,
  occurrenceDigestOf,
  mintGrantId,
  mintSettlementId,
  mintLedgerEntryId,
  mintRevokeEntryId,
  entitlementGrantOf,
  settlementRecordOf,
} from "./records.ts";
export {
  isHoldCommand,
  isCompleteSettlementCommand,
  isRevokeCommand,
  holdLifecycleCommand,
  settleLifecycleCommand,
  revokeLifecycleCommand,
} from "./lifecycle.ts";
export {
  balanceKey,
  grantLedgerEntry,
  consumeLedgerEntry,
  revokeLedgerEntry,
  adjustLedgerEntry,
} from "./ledger.ts";
export { isEconomyStateDocument } from "./ports.ts";
export { isRewardIntegrityReading } from "./integrity-port.ts";
export { EconomyService } from "./service.ts";
export {
  FAKE_ECONOMY_EVENT_KINDS,
  createMemoryEconomyStore,
  createFixedClock,
  createMemoryGrantDirectory,
  economyAdminGrant,
  economySubmitGrant,
  createStaticRewardIntegrityPort,
  createUnwiredRewardIntegrityPort,
  createStaticValueResolver,
  createMappingValueResolver,
  createUnresolvingValueResolver,
} from "./fakes.ts";

// Types — integrity seam
export type { RewardIntegrityQuery, RewardIntegrityReading, RewardIntegrityPort } from "./integrity-port.ts";
// Types — policies
export type { RegisteredRewardPolicy, PolicyRefusalCode, PolicyAdmission } from "./policies.ts";
// Types — settlement
export type {
  SettlementMode,
  EconomySettlementRequest,
  SettlementFacts,
  SettlementRefusalCode,
  SettlementPlan,
  EconomySettlementAdmission,
} from "./settlement.ts";
// Types — records
export type { EntitlementProvenance, SettlementReceipt } from "./records.ts";
// Types — lifecycle doors
export type {
  LifecycleDoorCommand,
  HoldCommand,
  CompleteSettlementCommand,
  RevokeCommand,
  LifecycleRefusalCode,
  HoldResult,
  CompleteSettlementResult,
  CompleteSettlementRefusalCode,
  RevokeResult,
} from "./lifecycle.ts";
// Types — ledger
export type {
  SubjectLedgerView,
  EntitlementHold,
  ConsumeInput,
  AdjustInput,
  LedgerRefusalCode,
  LedgerFoldResult,
} from "./ledger.ts";
// Types — ports
export type {
  EconomyStateDocument,
  StoredEconomySnapshot,
  EconomyStore,
  ServiceClock,
  GrantDirectory,
  EconomyValueResolver,
} from "./ports.ts";
// Types — service
export type {
  EconomyServiceOptions,
  SettleEventResult,
  EconomyRefusal,
  RegisterPolicyResult,
  SnapshotResult,
  EntitlementView,
} from "./service-types.ts";
