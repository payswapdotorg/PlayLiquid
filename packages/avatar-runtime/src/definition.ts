/**
 * AVATAR DEFINITION RECORDS (spec/architecture.md "Avatar"): an Avatar is
 * Body + Intelligence, and its body / sensors / actuators / memory /
 * intelligence are SEPARATELY VERSIONED SUB-RECORDS.
 *
 * Structural vocabulary rules:
 * - capability names come from the frozen game-contracts R5 vocabulary
 *   (`SensorCapabilityId` / `ActuatorCapabilityId`) — this package never
 *   invents a second capability vocabulary;
 * - external content (body assets, cognitive substrate, skills) is
 *   REFERENCED as versioned packages ({@link AvatarPackageRef}) — lock
 *   rule 7 (everything reusable is a package). Skills are references
 *   only: there is NO skill engine in this package;
 * - sub-record revision digests are lowercase-hex SHA-256 strings
 *   (runtime-contracts `Digest`), supplied by the caller — composition
 *   validates them and derives the whole-definition digest (see
 *   composition.ts).
 *
 * Pure module: data types + structural guards only.
 */

import type { Digest, IntentKind } from "@playliquid/runtime-contracts";
import type { ActuatorCapabilityId, AgentId, AvatarId, SensorCapabilityId } from "@playliquid/game-contracts";

/** Which avatar sub-record a version stamp belongs to. */
export type AvatarSubRecordKind = "body" | "sensors" | "actuators" | "memory" | "intelligence";

/** The separately versioned stamp every sub-record carries. */
export interface AvatarSubRecordVersion {
  readonly subRecord: AvatarSubRecordKind;
  readonly version: number;
  readonly revisionDigest: Digest;
}

/**
 * A reference to a versioned package (lock rule 7). Used for body assets,
 * the cognitive substrate and SKILLS — never an inline implementation.
 */
export interface AvatarPackageRef {
  /** Package coordinate (resolved/pinned by the host game's lockfile). */
  readonly packageId: string;
  readonly version: string;
  /** Content digest when the reference is content-pinned. */
  readonly digest?: Digest;
}

/** Body: geometry, skeleton, animation, physics, appearance (all packaged). */
export interface AvatarBodyRecord {
  readonly subRecordVersion: AvatarSubRecordVersion;
  readonly geometry: AvatarPackageRef;
  readonly skeleton: AvatarPackageRef;
  readonly animation: AvatarPackageRef;
  readonly physics: AvatarPackageRef;
  readonly appearance: AvatarPackageRef;
}

/** One sensor channel of the body (perception, per the R5 vocabulary). */
export interface AvatarSensorChannel {
  /** Frozen game-contracts sensor capability this channel provides. */
  readonly capability: SensorCapabilityId;
  /** Channel id within the avatar (e.g. `vision.main`). */
  readonly channel: string;
}

/** Sensors sub-record: the body's perception surface. */
export interface AvatarSensorsRecord {
  readonly subRecordVersion: AvatarSubRecordVersion;
  readonly channels: readonly AvatarSensorChannel[];
}

/**
 * One actuator of the body (action). `serves` lists the intent kinds this
 * actuator can physically serve — the composition-level gate an intent
 * must pass BEFORE any broker evaluation (a body without a `speech`
 * actuator cannot speak, no matter what a grant says).
 */
export interface AvatarActuator {
  /** Frozen game-contracts actuator capability this actuator provides. */
  readonly capability: ActuatorCapabilityId;
  readonly serves: readonly IntentKind[];
}

/** Actuators sub-record: the body's action surface. */
export interface AvatarActuatorsRecord {
  readonly subRecordVersion: AvatarSubRecordVersion;
  readonly actuators: readonly AvatarActuator[];
}

/** Memory sub-record: topology and persistence class of avatar memory. */
export interface AvatarMemoryRecord {
  readonly subRecordVersion: AvatarSubRecordVersion;
  readonly topology: "local" | "session-shared";
  readonly persistence: "none" | "session" | "persistent";
}

/**
 * Intelligence sub-record: cognitive substrate, planning and policy refs,
 * plus SKILLS REFERENCED AS PACKAGES. There is no skill engine here —
 * model selection stays under the ZCode AI runtime (lock rule 5) and
 * skill execution belongs to host runtimes, never to this package.
 */
export interface AvatarIntelligenceRecord {
  readonly subRecordVersion: AvatarSubRecordVersion;
  readonly cognitiveSubstrate: AvatarPackageRef;
  readonly planning?: AvatarPackageRef;
  readonly policy?: AvatarPackageRef;
  readonly skills: readonly AvatarPackageRef[];
}

/** A fully composed avatar definition (produced by composition.ts). */
export interface AvatarDefinition {
  readonly avatarId: AvatarId;
  /** The agent whose intelligence embodies this avatar, when bound. */
  readonly agent?: AgentId;
  readonly body: AvatarBodyRecord;
  readonly sensors: AvatarSensorsRecord;
  readonly actuators: AvatarActuatorsRecord;
  readonly memory: AvatarMemoryRecord;
  readonly intelligence: AvatarIntelligenceRecord;
  /** Deterministic digest over all sub-record stamps (composition.ts). */
  readonly definitionDigest: Digest;
}

/** The definition minus the derived digest (what callers hand to compose). */
export type ComposeAvatarInput = Omit<AvatarDefinition, "definitionDigest">;
