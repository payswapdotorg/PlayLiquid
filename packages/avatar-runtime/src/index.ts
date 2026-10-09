/**
 * @playliquid/avatar-runtime — public surface (PL-026).
 *
 * Avatar = Body + Intelligence (spec/architecture.md §Avatar). This package
 * composes avatar definitions whose body/sensors/actuators/memory/
 * intelligence are SEPARATELY VERSIONED SUB-RECORDS (skills referenced as
 * packages — no skill engine), defines the sensor input / actuator output /
 * memory / intelligence PORTS (pure interfaces; the interactive and
 * simulation runtimes host execution — no second kernel is built here),
 * and drives every avatar-agent action through the Capability Broker
 * (sibling package @playliquid/capability-broker) so intents become
 * broker-mediated canonical commands per @playliquid/runtime-contracts
 * (lock rules 13/14).
 *
 * Imports per spec/module-dependency-matrix.md: game-ir, capability-broker,
 * runtime-contracts (declared), plus game-contracts for the frozen R5
 * avatar capability vocabulary (deliberate direct declaration; recorded in
 * the work order report).
 *
 * Module map:
 * - definition.ts    sub-record types + package refs (no skill engine)
 * - composition.ts   validation, R5 restriction projection, digest (game-ir)
 * - ports.ts         sensor/memory/intelligence/actuator/broker seams
 * - runtime.ts       AvatarRuntime: the perception→decision→action driver
 * - fakes.ts         TEST-SUPPORT in-memory fakes + demo avatar
 * - harness.ts       runtime evidence harness (node src/harness.ts)
 */

// Definition records
export type {
  AvatarSubRecordKind,
  AvatarSubRecordVersion,
  AvatarPackageRef,
  AvatarBodyRecord,
  AvatarSensorChannel,
  AvatarSensorsRecord,
  AvatarActuator,
  AvatarActuatorsRecord,
  AvatarMemoryRecord,
  AvatarIntelligenceRecord,
  AvatarDefinition,
  ComposeAvatarInput,
} from "./definition.ts";

// Composition
export {
  composeAvatar,
  effectiveCapabilities,
  checkRestriction,
  validatedRestriction,
  definitionDigest,
  servedIntentKinds,
  effectiveSensorChannels,
} from "./composition.ts";
export type { ComposeAvatarResult, ComposeErrorCode, EffectiveCapabilities } from "./composition.ts";

// Ports (pure seams)
export type {
  SensorSample,
  SensorInputPort,
  PerceptionRecord,
  AvatarMemoryPort,
  AvatarIntentClaim,
  AvatarDenialFeedback,
  AvatarIntelligencePort,
  ActuatorOutputPort,
  AvatarBrokerPort,
  AvatarBrokerContext,
  EmittedCommandIds,
} from "./ports.ts";

// The driver
export { AvatarRuntime } from "./runtime.ts";
export type { AvatarRuntimeOptions, AvatarCycleContext, AvatarCycleReport } from "./runtime.ts";

// Test support (NOT production adapters)
export {
  InMemorySensorInput,
  InMemoryAvatarMemory,
  InMemoryActuatorOutput,
  ScriptedIntelligence,
  DEMO_AVATAR_ID,
  DEMO_AGENT_ID,
  DEMO_SERVED_INTENT_KINDS,
  demoAvatarInput,
  demoAvatarDefinition,
} from "./fakes.ts";
export type { ScriptedClaimSpec } from "./fakes.ts";
