/**
 * AVATAR COMPOSITION: validate the sub-records, derive the effective
 * (host-restricted) capability projection, and stamp the composed
 * definition with a deterministic whole-definition digest.
 *
 * Two independent gates exist by design and NEVER overlap authorities:
 *
 * 1. COMPOSITION gate (here, pure structure): is the avatar well-formed,
 *    and which sensors/actuators survive the host restriction (R5)? This
 *    answers "what does the body physically have". Import-time
 *    compatibility verdicts with requirement levels are game-contracts'
 *    `assessAvatarCompatibility` — a different question, not duplicated.
 * 2. RUNTIME gate (the Capability Broker, lock rule 4): which actions are
 *    authorized per tick, epoch and budget. This answers "what may the
 *    avatar DO now" (R20 least privilege).
 *
 * The whole-definition digest is computed through game-ir's canonical
 * value forms and `hashGameIRValue` (the semantic kernel's frozen
 * canonicalization — same bytes, same digest, every machine; E9). The
 * hashed value records the avatar id and each sub-record's
 * (kind, version, revisionDigest) stamp; asset package refs are pinned by
 * their own digests and are not re-hashed here.
 *
 * Pure module: no IO, no clock, no randomness.
 */

import { hashGameIRValue } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import {
  ACTUATOR_CAPABILITY_IDS,
  SENSOR_CAPABILITY_IDS,
  isHostRestriction,
  isValidIdText,
} from "@playliquid/game-contracts";
import type { AvatarCapabilityId, HostRestriction } from "@playliquid/game-contracts";
import { asDigest, isValidDigest } from "@playliquid/runtime-contracts";
import type { Digest } from "@playliquid/runtime-contracts";
import type {
  AvatarDefinition,
  AvatarPackageRef,
  AvatarSubRecordVersion,
  ComposeAvatarInput,
} from "./definition.ts";

/** Typed composition failure. Failures are total: no definition is produced. */
export type ComposeAvatarResult =
  | { readonly ok: true; readonly definition: AvatarDefinition }
  | { readonly ok: false; readonly code: ComposeErrorCode; readonly detail: string };

export type ComposeErrorCode =
  | "invalid-avatar-id"
  | "invalid-sub-record-version"
  | "invalid-package-ref"
  | "invalid-sensor-capability"
  | "invalid-actuator-capability"
  | "duplicate-sensor-channel"
  | "duplicate-actuator-capability"
  | "invalid-memory-record"
  | "invalid-restriction";

/** Effective capability projection after the host restriction (R5). */
export interface EffectiveCapabilities {
  /** Sensor/actuator capabilities the body keeps. */
  readonly granted: readonly AvatarCapabilityId[];
  /** Declared capabilities the host denied outright (R5/R20). */
  readonly denied: readonly AvatarCapabilityId[];
}

/**
 * Compose an avatar definition: structural validation of every sub-record
 * plus the deterministic definition digest. See module docs for the gate
 * split (composition here, authority in the broker).
 */
export function composeAvatar(input: ComposeAvatarInput): ComposeAvatarResult {
  if (!isValidIdText(String(input.avatarId))) {
    return fail("invalid-avatar-id", `avatarId ${JSON.stringify(String(input.avatarId))} is not a valid id slug`);
  }
  const subRecords: readonly AvatarSubRecordVersion[] = [
    input.body.subRecordVersion,
    input.sensors.subRecordVersion,
    input.actuators.subRecordVersion,
    input.memory.subRecordVersion,
    input.intelligence.subRecordVersion,
  ];
  for (const stamp of subRecords) {
    const reason = checkSubRecordVersion(stamp);
    if (reason !== undefined) {
      return fail("invalid-sub-record-version", reason);
    }
  }
  for (const ref of packageRefs(input)) {
    const reason = checkPackageRef(ref);
    if (reason !== undefined) {
      return fail("invalid-package-ref", reason);
    }
  }
  const channels = new Set<string>();
  for (const channel of input.sensors.channels) {
    if (!(SENSOR_CAPABILITY_IDS as readonly string[]).includes(channel.capability)) {
      return fail("invalid-sensor-capability", `${JSON.stringify(channel.capability)} is not a frozen sensor capability`);
    }
    if (channels.has(channel.channel)) {
      return fail("duplicate-sensor-channel", `sensor channel ${channel.channel} declared twice`);
    }
    channels.add(channel.channel);
  }
  const actuatorCapabilities = new Set<string>();
  for (const actuator of input.actuators.actuators) {
    if (!(ACTUATOR_CAPABILITY_IDS as readonly string[]).includes(actuator.capability)) {
      return fail("invalid-actuator-capability", `${JSON.stringify(actuator.capability)} is not a frozen actuator capability`);
    }
    if (actuatorCapabilities.has(actuator.capability)) {
      return fail("duplicate-actuator-capability", `actuator capability ${actuator.capability} declared twice`);
    }
    actuatorCapabilities.add(actuator.capability);
  }
  if (
    (input.memory.topology !== "local" && input.memory.topology !== "session-shared") ||
    (input.memory.persistence !== "none" && input.memory.persistence !== "session" && input.memory.persistence !== "persistent")
  ) {
    return fail("invalid-memory-record", "memory topology/persistence class is invalid");
  }

  return {
    ok: true,
    definition: { ...input, definitionDigest: definitionDigest(input) },
  };
}

/**
 * Effective capability projection of a composed definition under a host
 * restriction (R5: host games restrict avatar capabilities). Pure set
 * math over the frozen vocabulary; the broker remains the runtime
 * authority (R20) — this projection gates structure, not action.
 */
export function effectiveCapabilities(
  definition: AvatarDefinition,
  restriction: HostRestriction,
): EffectiveCapabilities {
  const declared = new Set<string>([
    ...definition.sensors.channels.map((channel) => channel.capability),
    ...definition.actuators.actuators.map((actuator) => actuator.capability),
  ]);
  const granted: string[] = [];
  const denied: string[] = [];
  for (const capability of declared) {
    if (restriction.denied.includes(capability as AvatarCapabilityId)) {
      denied.push(capability);
    } else {
      granted.push(capability);
    }
  }
  return {
    granted: granted.map((capability) => capability as AvatarCapabilityId),
    denied: denied.map((capability) => capability as AvatarCapabilityId),
  };
}

/** Structural guard for host restrictions handed to the runtime. */
export function checkRestriction(restriction: HostRestriction): string | undefined {
  if (!isHostRestriction(restriction)) {
    return "restriction is not a structurally valid HostRestriction";
  }
  return undefined;
}

/** Validate a restriction (typed wrapper over the structural guard). */
export function validatedRestriction(restriction: HostRestriction): ComposeAvatarResult | undefined {
  const reason = checkRestriction(restriction);
  return reason === undefined ? undefined : fail("invalid-restriction", reason);
}

/**
 * Deterministic whole-definition digest through game-ir canonicalization:
 * a record of the avatar id and the five sub-record stamps, hashed with
 * the kernel's own `hashGameIRValue` (E9: same bytes -> same digest).
 */
export function definitionDigest(input: ComposeAvatarInput): Digest {
  const stamp = (stamp: AvatarSubRecordVersion): GameIRValue => ({
    kind: "record",
    fields: {
      sub: { kind: "string", value: stamp.subRecord },
      version: { kind: "int", value: BigInt(stamp.version) },
      digest: { kind: "string", value: String(stamp.revisionDigest) },
    },
  });
  const value: GameIRValue = {
    kind: "record",
    fields: {
      avatar: { kind: "string", value: String(input.avatarId) },
      body: stamp(input.body.subRecordVersion),
      sensors: stamp(input.sensors.subRecordVersion),
      actuators: stamp(input.actuators.subRecordVersion),
      memory: stamp(input.memory.subRecordVersion),
      intelligence: stamp(input.intelligence.subRecordVersion),
    },
  };
  return asDigest(hashGameIRValue(value));
}

/** Intent kinds the (restriction-surviving) actuators can serve. */
export function servedIntentKinds(
  definition: AvatarDefinition,
  restriction: HostRestriction,
): ReadonlySet<string> {
  const effective = effectiveCapabilities(definition, restriction);
  const served = new Set<string>();
  for (const actuator of definition.actuators.actuators) {
    if (!effective.granted.includes(actuator.capability)) {
      continue;
    }
    for (const intentKind of actuator.serves) {
      served.add(String(intentKind));
    }
  }
  return served;
}

/** Sensor channels that survive the restriction (perception gating). */
export function effectiveSensorChannels(
  definition: AvatarDefinition,
  restriction: HostRestriction,
): ReadonlySet<string> {
  const effective = effectiveCapabilities(definition, restriction);
  const channels = new Set<string>();
  for (const channel of definition.sensors.channels) {
    if (effective.granted.includes(channel.capability)) {
      channels.add(channel.channel);
    }
  }
  return channels;
}

function checkSubRecordVersion(stamp: AvatarSubRecordVersion): string | undefined {
  if (
    stamp.subRecord !== "body" &&
    stamp.subRecord !== "sensors" &&
    stamp.subRecord !== "actuators" &&
    stamp.subRecord !== "memory" &&
    stamp.subRecord !== "intelligence"
  ) {
    return `unknown sub-record kind ${JSON.stringify(stamp.subRecord)}`;
  }
  if (!Number.isSafeInteger(stamp.version) || stamp.version < 1) {
    return `sub-record ${stamp.subRecord} version must be a safe integer >= 1`;
  }
  if (!isValidDigest(String(stamp.revisionDigest))) {
    return `sub-record ${stamp.subRecord} revisionDigest is not a lowercase-hex sha-256 digest`;
  }
  return undefined;
}

function checkPackageRef(ref: AvatarPackageRef): string | undefined {
  if (typeof ref.packageId !== "string" || ref.packageId.length === 0) {
    return "package ref has an empty packageId";
  }
  if (typeof ref.version !== "string" || ref.version.length === 0) {
    return `package ref ${ref.packageId} has an empty version`;
  }
  if (ref.digest !== undefined && !isValidDigest(String(ref.digest))) {
    return `package ref ${ref.packageId} digest is not a lowercase-hex sha-256 digest`;
  }
  return undefined;
}

function packageRefs(input: ComposeAvatarInput): readonly AvatarPackageRef[] {
  return [
    input.body.geometry,
    input.body.skeleton,
    input.body.animation,
    input.body.physics,
    input.body.appearance,
    input.intelligence.cognitiveSubstrate,
    ...(input.intelligence.planning === undefined ? [] : [input.intelligence.planning]),
    ...(input.intelligence.policy === undefined ? [] : [input.intelligence.policy]),
    ...input.intelligence.skills,
  ];
}

function fail(code: ComposeErrorCode, detail: string): ComposeAvatarResult {
  return { ok: false, code, detail };
}
