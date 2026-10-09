/**
 * FROZEN MULTIPLAYER TOPOLOGY VOCABULARY + PER-TOPOLOGY ADMISSION RULES.
 *
 * This module binds the PLATFORM topology vocabulary
 * (`MultiplayerServicePolicy.topology`: authoritative-server /
 * authoritative-relay / peer-to-peer, owned by @playliquid/platform-contracts)
 * into KERNEL behavior through a frozen three-way enum:
 *
 * - `dedicated-server` — a dedicated authoritative host (platform:
 *   `authoritative-server`). Full authority: protected outcomes may be
 *   decided, platform systems administer, no client is special.
 * - `client-server` — one client hosts, but the AUTHORITY KERNEL still
 *   validates/simulates (platform: `authoritative-relay`). Protected
 *   outcomes remain kernel-decided; the host may issue `host-authority`
 *   admin commands but can never decide an outcome itself.
 * - `peer-to-peer` — no authority (platform: `peer-to-peer`). Protected
 *   outcome kinds are NEVER hostable: neither decided nor emitted as
 *   protected events. This is lock rule 19 bound into kernel behavior,
 *   mirroring `validateCapabilityPolicy`'s `competitive-p2p-topology`
 *   refusal (policy.ts in platform-contracts) at session-open time.
 *
 * {@link resolveMultiplayerConfiguration} is the single door from a game's
 * platform policy declaration + the platform service policy to the frozen
 * kernel rules. Purity: data + pure functions only.
 */

import {
  isMultiplayerServicePolicy,
  validateCapabilityPolicy,
} from "@playliquid/platform-contracts";
import type {
  GameEventKind,
  MultiplayerServicePolicy,
  PlatformPolicyDeclaration,
} from "@playliquid/platform-contracts";

/** The frozen kernel topology enum (work-order scope; mapping below). */
export type MultiplayerTopology = "dedicated-server" | "client-server" | "peer-to-peer";

/** All valid {@link MultiplayerTopology} values, frozen. */
export const MULTIPLAYER_TOPOLOGIES: readonly MultiplayerTopology[] = Object.freeze([
  "dedicated-server",
  "client-server",
  "peer-to-peer",
] as const);

/** Structural guard for {@link MultiplayerTopology}. */
export function isMultiplayerTopology(value: unknown): value is MultiplayerTopology {
  return (
    typeof value === "string" &&
    (MULTIPLAYER_TOPOLOGIES as readonly string[]).includes(value)
  );
}

/** The origin kinds a {@link RuntimeCommandEnvelope} may carry (commands.ts). */
export type CommandOriginKind =
  | "player-input"
  | "platform-system"
  | "host-authority"
  | "broker-mediated";

/** Frozen per-topology admission rules. */
export interface TopologyAdmissionRules {
  readonly topology: MultiplayerTopology;
  /**
   * R9 / lock 19 / lock 41: whether protected outcome kinds (reward,
   * inventory, damage, standing, score) may be DECIDED under this topology.
   * Always false for peer-to-peer.
   */
  readonly mayDecideProtectedOutcomes: boolean;
  /** Whether sessions under this topology may be used competitively. */
  readonly competitiveUseSupported: boolean;
  /** Command origins admitted for gameplay commands under this topology. */
  readonly admittedOrigins: readonly CommandOriginKind[];
}

/**
 * THE frozen rule table. Peer-to-peer admits no platform-system or
 * host-authority origins (there is no authority to host them) and can never
 * decide protected outcomes. Client-server additionally admits
 * `host-authority` (listen-host administration); dedicated-server does not
 * (no client is the host).
 */
export const TOPOLOGY_RULES: Readonly<Record<MultiplayerTopology, TopologyAdmissionRules>> =
  Object.freeze({
    "dedicated-server": {
      topology: "dedicated-server",
      mayDecideProtectedOutcomes: true,
      competitiveUseSupported: true,
      admittedOrigins: Object.freeze(["player-input", "platform-system", "broker-mediated"] as const),
    },
    "client-server": {
      topology: "client-server",
      mayDecideProtectedOutcomes: true,
      competitiveUseSupported: true,
      admittedOrigins: Object.freeze([
        "player-input",
        "platform-system",
        "host-authority",
        "broker-mediated",
      ] as const),
    },
    "peer-to-peer": {
      topology: "peer-to-peer",
      mayDecideProtectedOutcomes: false,
      competitiveUseSupported: false,
      admittedOrigins: Object.freeze(["player-input", "broker-mediated"] as const),
    },
  } as const);

/** The frozen rules for `topology`. */
export function topologyRules(topology: MultiplayerTopology): TopologyAdmissionRules {
  return TOPOLOGY_RULES[topology];
}

/**
 * Frozen mapping from the platform service topology vocabulary to the kernel
 * topology enum: authoritative-server -> dedicated-server,
 * authoritative-relay -> client-server, peer-to-peer -> peer-to-peer.
 */
export function kernelTopologyFromServicePolicy(
  topology: MultiplayerServicePolicy["topology"],
): MultiplayerTopology {
  switch (topology) {
    case "authoritative-server":
      return "dedicated-server";
    case "authoritative-relay":
      return "client-server";
    case "peer-to-peer":
      return "peer-to-peer";
  }
}

// ---------------------------------------------------------------------------
// Session configuration resolution (the policy binding door)
// ---------------------------------------------------------------------------

/** Successfully resolved multiplayer session configuration. */
export interface MultiplayerSessionConfiguration {
  readonly topology: MultiplayerTopology;
  readonly rules: TopologyAdmissionRules;
  readonly servicePolicy: MultiplayerServicePolicy;
  /** Game-declared event kinds bound as `protected` for multiplayer. */
  readonly protectedEventKinds: readonly GameEventKind[];
  /** Game-declared event kinds bound as `informational` for multiplayer. */
  readonly informationalEventKinds: readonly GameEventKind[];
  /** Session capacity from the game's multiplayer policy. */
  readonly capacity: number;
}

/** Typed refusal when a session configuration cannot be resolved. */
export type ConfigurationRefusalCode =
  | "invalid-service-policy"
  | "game-policy-invalid"
  | "multiplayer-capability-absent"
  | "topology-disagreement"
  | "competitive-p2p-topology";

export type ConfigurationResolution =
  | { readonly ok: true; readonly configuration: MultiplayerSessionConfiguration }
  | { readonly ok: false; readonly code: ConfigurationRefusalCode; readonly detail: string };

/**
 * Resolve the kernel configuration from the game's platform policy
 * declaration and the platform service policy. Binding order:
 *
 * 1. `isMultiplayerServicePolicy` — the service policy must be structurally
 *    valid (this structurally refuses competitive peer-to-peer).
 * 2. `validateCapabilityPolicy` (platform-contracts keystone) — the game
 *    policy must pass; a `competitive-p2p-topology` reason is surfaced with
 *    its own typed code (the work-order binding).
 * 3. The game must declare the multiplayer capability, and its topology
 *    must AGREE with the service policy (no silent topology substitution).
 * 4. Defense in depth: any protected binding under a topology that cannot
 *    decide protected outcomes is refused — even non-competitive P2P, since
 *    protected kinds are never client-decidable (locks 19/41).
 */
export function resolveMultiplayerConfiguration(
  gamePolicy: PlatformPolicyDeclaration,
  servicePolicy: MultiplayerServicePolicy,
): ConfigurationResolution {
  if (!isMultiplayerServicePolicy(servicePolicy)) {
    return {
      ok: false,
      code: "invalid-service-policy",
      detail: "service policy is not a structurally valid MultiplayerServicePolicy",
    };
  }
  const policyValidation = validateCapabilityPolicy(gamePolicy);
  if (!policyValidation.pass) {
    const p2p = policyValidation.reasons.find(
      (reason) => reason.code === "competitive-p2p-topology",
    );
    if (p2p !== undefined) {
      return { ok: false, code: "competitive-p2p-topology", detail: p2p.detail };
    }
    const first = policyValidation.reasons[0];
    return {
      ok: false,
      code: "game-policy-invalid",
      detail: first === undefined ? "game policy failed validation" : `${String(first.code)}: ${first.detail}`,
    };
  }
  const multiplayerDescriptor = gamePolicy.capabilities.find(
    (descriptor) => descriptor.capability === "multiplayer",
  );
  if (multiplayerDescriptor === undefined || multiplayerDescriptor.capability !== "multiplayer") {
    return {
      ok: false,
      code: "multiplayer-capability-absent",
      detail: "game policy does not declare the multiplayer capability",
    };
  }
  if (multiplayerDescriptor.policy.topology !== servicePolicy.topology) {
    return {
      ok: false,
      code: "topology-disagreement",
      detail: `game declares ${multiplayerDescriptor.policy.topology} but service policy runs ${servicePolicy.topology}`,
    };
  }
  const multiplayerBindings = gamePolicy.bindings.filter(
    (binding) => binding.capability === "multiplayer",
  );
  const protectedEventKinds = multiplayerBindings
    .filter((binding) => binding.outcomeClassification === "protected")
    .map((binding) => binding.eventKind);
  const informationalEventKinds = multiplayerBindings
    .filter((binding) => binding.outcomeClassification === "informational")
    .map((binding) => binding.eventKind);
  const topology = kernelTopologyFromServicePolicy(servicePolicy.topology);
  const rules = topologyRules(topology);
  if (!rules.mayDecideProtectedOutcomes && protectedEventKinds.length > 0) {
    return {
      ok: false,
      code: "competitive-p2p-topology",
      detail: `topology ${topology} cannot decide protected outcomes but ${protectedEventKinds.length} protected binding(s) exist`,
    };
  }
  return {
    ok: true,
    configuration: {
      topology,
      rules,
      servicePolicy,
      protectedEventKinds,
      informationalEventKinds,
      capacity: multiplayerDescriptor.policy.maxPlayersPerSession,
    },
  };
}
