/**
 * @playliquid/capability-broker — public surface (PL-026).
 *
 * THE runtime permission authority for avatar/agent actions (lock rule 4):
 * one owner of grant admission, budget consumption and denial reasons.
 * Pure core over `@playliquid/runtime-contracts` capability semantics; the
 * only GameIR binding is policy derivation (avatar-binding restrictions +
 * rule-node intent coverage). No IO, no timers, no globals; fakes are test
 * support only.
 *
 * Imports `@playliquid/runtime-contracts` and `@playliquid/game-ir` only,
 * per spec/module-dependency-matrix.md (capability-broker | game-ir main
 * dependency; runtime-contracts is the frozen protocol the broker
 * operates — the work order pins both).
 *
 * Module map:
 * - policy.ts    broker policy + GameIR derivation + capability bridge
 * - registry.ts  the authoritative grant table (admit/revoke/expiry sweep)
 * - broker.ts    CapabilityBroker: the authority + evaluation + docs
 * - fakes.ts     TEST-SUPPORT clock, GrantTable-compatible double, fixtures
 * - harness.ts   runtime evidence harness (node src/harness.ts)
 */

// Policy
export {
  avatarCapabilityId,
  deriveBrokerPolicy,
  brokerPolicy,
  commandKindForIntent,
} from "./policy.ts";
export type {
  AvatarRestrictionCapability,
  BrokerRestrictions,
  BrokerPolicy,
  CapabilityCoverageDeclaration,
  PolicyDerivationResult,
  PolicyErrorCode,
} from "./policy.ts";

// Grant registry (pure state machine)
export {
  EMPTY_GRANT_REGISTRY,
  admitGrant,
  revokeGrant,
  sweepExpiredGrants,
  findGrant,
  grantsForActor,
  grantedCapabilities,
} from "./registry.ts";
export type {
  GrantRegistryState,
  GrantAdmissionCode,
  GrantAdmissionResult,
  GrantAdmissionRequest,
} from "./registry.ts";

// The authority
export { CapabilityBroker } from "./broker.ts";
export type {
  BrokerClockPort,
  BrokerEvaluationContext,
  CapabilityBrokerOptions,
} from "./broker.ts";

// Test support (NOT production adapters)
export {
  ManualBrokerClock,
  createGrantTableBroker,
  avatarActor,
  hostAuthority,
  capId,
  grantId,
  moveIntent,
  actionRequest,
  idempotencyKey,
  makeGrant,
  seedGrants,
  evaluationContext,
} from "./fakes.ts";
export type { GrantTableCompatibleOptions } from "./fakes.ts";

// Demo game fixture (tests/harness; mirrors simulation's demo.ts convention)
export {
  DEMO_SESSION,
  DEMO_ACTOR,
  DEMO_MOVEMENT_CAPABILITY,
  DEMO_SPEECH_CAPABILITY,
  DEMO_MANIPULATION_CAPABILITY,
  DEMO_SENSORY_OUTPUT_CAPABILITY,
  demoGameDocument,
  demoCoverage,
  assertDemoDocumentValid,
} from "./demo.ts";
