/**
 * AVATAR READ MODELS (pure): project avatar-runtime authoritative data
 * (PL-026) — a composed AvatarDefinition, its definition digest and the
 * effective-capability projection after the host restriction (R5) — into
 * the studio Avatars surface: sub-record version table, sensor channels,
 * served intent kinds, referenced packages and capability chips.
 *
 * The avatar-runtime owns composition; this module only READS composed
 * definitions (E5). Pure module: no IO, no React.
 */

import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import {
  effectiveCapabilities,
  effectiveSensorChannels,
  servedIntentKinds,
} from "@playliquid/avatar-runtime";
import type { HostRestriction } from "@playliquid/game-contracts";
import type { IntentKind } from "@playliquid/runtime-contracts";
import type { UiStatus } from "./status.ts";

/** The unrestricted host restriction (R5 default when a host passes none). */
export const UNRESTRICTED: HostRestriction = {
  denied: [],
  approvalRequired: [],
  sandboxed: false,
};

/** One sub-record version stamp row. */
export interface SubRecordRow {
  readonly subRecord: string;
  readonly version: number;
  readonly revisionDigest: string;
}

/** One referenced package row (body assets / substrate / skills). */
export interface PackageRefRow {
  readonly role: string;
  readonly packageId: string;
  readonly version: string;
  readonly digest: string | null;
}

/** One capability chip of the avatar body (sensor or actuator). */
export interface CapabilityChip {
  readonly capability: string;
  readonly surface: "sensor" | "actuator";
  readonly status: UiStatus;
}

/** One served intent-kind chip (body gate before any broker evaluation). */
export interface IntentChip {
  readonly intentKind: string;
  readonly status: UiStatus;
}

/** The Avatars surface view model for one avatar. */
export interface AvatarCardView {
  readonly avatarId: string;
  readonly agent: string | null;
  readonly definitionDigest: string;
  readonly subRecords: readonly SubRecordRow[];
  readonly packageRefs: readonly PackageRefRow[];
  readonly sensors: readonly { readonly capability: string; readonly channel: string }[];
  readonly capabilities: readonly CapabilityChip[];
  readonly servedIntents: readonly IntentChip[];
  readonly skillCount: number;
}

/** All avatars the studio inspects. */
export interface AvatarsView {
  readonly cards: readonly AvatarCardView[];
  readonly deniedCapabilities: readonly string[];
}

function short(digest: string): string {
  return digest.slice(0, 12);
}

function restrictionStatus(
  capability: string,
  approvalRequired: readonly string[],
): UiStatus {
  if (approvalRequired.includes(capability)) {
    return { label: "approval required", tone: "warn", note: "host approval marker needed" };
  }
  return { label: "allowed", tone: "ok" };
}

/**
 * Project one composed avatar definition (+ optional host restriction;
 * absent restriction means unrestricted) into an AvatarCardView.
 * Restriction names use the game-contracts R5 vocabulary.
 */
export function projectAvatar(
  definition: AvatarDefinition,
  restriction?: HostRestriction,
): AvatarCardView {
  const applied = restriction ?? UNRESTRICTED;
  const approvalRequired = [...applied.approvalRequired].map(String);

  const subRecords: SubRecordRow[] = [
    definition.body.subRecordVersion,
    definition.sensors.subRecordVersion,
    definition.actuators.subRecordVersion,
    definition.memory.subRecordVersion,
    definition.intelligence.subRecordVersion,
  ].map((stamp) => ({
    subRecord: stamp.subRecord,
    version: stamp.version,
    revisionDigest: short(stamp.revisionDigest),
  }));

  const packageRefs: PackageRefRow[] = [
    { role: "body.geometry", ref: definition.body.geometry },
    { role: "body.skeleton", ref: definition.body.skeleton },
    { role: "body.animation", ref: definition.body.animation },
    { role: "body.physics", ref: definition.body.physics },
    { role: "body.appearance", ref: definition.body.appearance },
    { role: "intelligence.substrate", ref: definition.intelligence.cognitiveSubstrate },
    ...(definition.intelligence.planning === undefined
      ? []
      : [{ role: "intelligence.planning", ref: definition.intelligence.planning }]),
    ...(definition.intelligence.policy === undefined
      ? []
      : [{ role: "intelligence.policy", ref: definition.intelligence.policy }]),
    ...definition.intelligence.skills.map((skill) => ({ role: "skill", ref: skill })),
  ].map(({ role, ref }) => ({
    role,
    packageId: ref.packageId,
    version: ref.version,
    digest: ref.digest === undefined ? null : short(ref.digest),
  }));

  const effective = effectiveCapabilities(definition, applied);
  const effectiveChannels = effectiveSensorChannels(definition, applied);
  const sensors = definition.sensors.channels
    .filter((channel) => effectiveChannels.has(channel.channel))
    .map((channel) => ({ capability: String(channel.capability), channel: channel.channel }));

  const deniedSet = new Set(effective.denied.map(String));
  const grantedSet = new Set(effective.granted.map(String));
  const capabilities: CapabilityChip[] = [
    ...definition.sensors.channels.map((channel) => String(channel.capability)),
    ...definition.actuators.actuators.map((actuator) => String(actuator.capability)),
  ]
    .filter((capability, index, all) => all.indexOf(capability) === index)
    .sort()
    .map((capability) => ({
      capability,
      surface: definition.sensors.channels.some(
        (channel) => String(channel.capability) === capability,
      )
        ? ("sensor" as const)
        : ("actuator" as const),
      status: deniedSet.has(capability)
        ? { label: "host-denied", tone: "error" } satisfies UiStatus
        : grantedSet.has(capability)
          ? { label: "effective", tone: "ok" } satisfies UiStatus
          : restrictionStatus(capability, approvalRequired),
    }));

  const served = servedIntentKinds(definition, applied);
  const allIntentKinds = new Set<string>();
  for (const actuator of definition.actuators.actuators) {
    for (const kind of actuator.serves) allIntentKinds.add(String(kind));
  }
  const servedIntents: IntentChip[] = [...allIntentKinds].sort().map((kind) => ({
    intentKind: kind,
    status: served.has(kind)
      ? { label: "served", tone: "ok" } satisfies UiStatus
      : { label: "restricted", tone: "error" } satisfies UiStatus,
  }));

  return {
    avatarId: String(definition.avatarId),
    agent: definition.agent === undefined ? null : String(definition.agent),
    definitionDigest: short(definition.definitionDigest),
    subRecords,
    packageRefs,
    sensors,
    capabilities,
    servedIntents,
    skillCount: definition.intelligence.skills.length,
  };
}

/** Project all avatars; denied capabilities are surfaced once at the top. */
export function projectAvatars(
  definitions: readonly AvatarDefinition[],
  restriction?: HostRestriction,
): AvatarsView {
  const applied = restriction ?? UNRESTRICTED;
  const cards = definitions
    .map((definition) => projectAvatar(definition, applied))
    .sort((a, b) => a.avatarId.localeCompare(b.avatarId));
  const deniedCapabilities = [
    ...new Set(
      cards.flatMap((card) =>
        card.capabilities
          .filter((chip) => chip.status.label === "host-denied")
          .map((chip) => chip.capability),
      ),
    ),
  ].sort();
  return { cards, deniedCapabilities };
}

/** Deterministic summary line for headers. */
export function avatarsSummary(view: AvatarsView): string {
  const total = view.cards.length;
  const denied = view.deniedCapabilities.length;
  const skills = view.cards.reduce((sum, card) => sum + card.skillCount, 0);
  return `${total} avatar${total === 1 ? "" : "s"} · ${denied} host-denied capabilit${denied === 1 ? "y" : "ies"} · ${skills} referenced skill package${skills === 1 ? "" : "s"}`;
}

/** Re-export for component typing. */
export type { IntentKind };
