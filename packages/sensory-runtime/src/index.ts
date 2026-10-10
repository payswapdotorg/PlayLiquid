/**
 * @playliquid/sensory-runtime — public surface (PL-027).
 *
 * The simulation/lab RUNTIME HOST of sensor EXECUTION for composed
 * avatars (spec/architecture.md §Avatar "Sensors: vision, audio, touch,
 * smell, taste, proprioception, vestibular"; matrix design-intent row
 * `sensory-runtime | Runtime | avatar-runtime`). avatar-runtime
 * (PL-026, MERGED) deliberately left sensor execution to "the
 * interactive and simulation runtimes" — this package is that runtime
 * for simulation/lab purposes. It REFINES, never re-declares, the
 * avatar vocabulary: channels and capabilities come from the composed
 * `AvatarDefinition` and the frozen game-contracts
 * `SensorCapabilityId` set.
 *
 * Imports per spec/module-dependency-matrix.md: avatar-runtime (the
 * managed foundation — contracts-only through the package entry), plus
 * the frozen vocabulary seams each recorded in module.ts:
 * game-contracts (SensorCapabilityId), game-ir (canonical value forms
 * + hashGameIRValue), runtime-contracts (Digest/Tick/SessionEpoch),
 * platform-contracts (TenantId/checkTenantIsolation), package-system
 * (canonical JSON + computeDigest at this package's own seam).
 *
 * Module map:
 * - samples.ts    typed per-channel payload shapes + structural guards
 * - digest.ts     canonical value forms, content digests, E10 keys
 * - codec.ts      per-capability frame admission (typed refusals)
 * - ports.ts      ServiceClock / producer / history ports (E3/E6/E9)
 * - runtime.ts    the host: bind, poll, restriction-as-policy, epochs
 * - perception.ts the SensorInputPort seam feeding avatar-runtime
 * - service.ts    the tenant-facing door (R20 isolation)
 * - fakes.ts      TEST-SUPPORT seeded in-memory fakes (E11: no real IO)
 * - harness.ts    runtime evidence harness (node src/harness.ts)
 *
 * NOT BUILT (deliberate, per work order): no rendering, no audio
 * capture, no real device IO, no physics — producer ports are
 * interfaces; the seeded in-memory fakes are the only in-repo
 * implementation.
 */

// Sample model (typed payload shapes + guards)
export type {
  VisualFieldSample,
  AudioFrameSample,
  TactileArraySample,
  OlfactoryIntensitySample,
  GustatoryIntensitySample,
  ProprioceptiveStateSample,
  VestibularFrameSample,
  SensoryPayload,
  SensoryPayloadKind,
  SensorySample,
} from "./samples.ts";
export {
  SENSORY_PAYLOAD_KINDS,
  isVisualFieldSample,
  isAudioFrameSample,
  isTactileArraySample,
  isOlfactoryIntensitySample,
  isGustatoryIntensitySample,
  isProprioceptiveStateSample,
  isVestibularFrameSample,
  isSensoryPayload,
  isFiniteNumber,
  isFiniteNumberInRange,
  isIntegerInRange,
} from "./samples.ts";

// Digest discipline
export type { SampleContentKeyInput, HistoryRecordContentInput } from "./digest.ts";
export {
  payloadValueForm,
  payloadContentDigest,
  sampleContentKey,
  historyRecordIdOf,
} from "./digest.ts";

// Codecs
export type { CodecAdmission, CodecRefusalCode, RawProducerFrame } from "./codec.ts";
export { admitFrame, expectedPayloadKind, readdressPayload } from "./codec.ts";

// Ports
export type {
  ServiceClock,
  SensoryProducerPort,
  SensoryHistoryRecord,
  RecordedReceipt,
  AppendOutcome,
  SensoryHistoryPort,
} from "./ports.ts";

// Runtime host
export type {
  SensoryPolicyEvent,
  SensoryPollReport,
  SensoryRuntimeHostOptions,
  HostBindingResult,
} from "./runtime.ts";
export { bindSensoryHost, SensoryRuntimeHost } from "./runtime.ts";

// Perception seam (avatar-runtime SensorInputPort adapter)
export type { PerceptionCursor, SensorHistoryInputOptions } from "./perception.ts";
export {
  SensorHistoryInput,
  projectToAvatarSample,
  projectSample,
  historyRecordOfSample,
} from "./perception.ts";

// Tenant-facing service
export type {
  SensoryCaller,
  SensoryServiceOptions,
  SensoryServiceRefusalCode,
  RegisterHostRequest,
  RegisterHostResult,
  ServicePollResult,
  SensoryReadResult,
  FindByKeyResult,
} from "./service.ts";
export { SensoryService } from "./service.ts";

// Test support (NOT production adapters)
export type { SeededProducerOptions } from "./fakes.ts";
export {
  SeededStream,
  ManualClock,
  SeededProducer,
  InMemorySensoryHistory,
  testContentDigest,
} from "./fakes.ts";
