/**
 * THE STUDIO PORT ADAPTER (RW-001): the desktop host's implementation of
 * game-ui's ONE data seam (`StudioDataPort`, E5) — a synchronous pull of
 * the REAL authoritative read models of the composed Studio backing
 * systems: the package registry (package-registry), the live capability
 * broker (capability-broker) and the tool-fabric runtime.
 *
 * Honesty rules (lock rule 44 discipline): everything in the returned
 * snapshot is read through the systems' own public doors — no demo
 * snapshot, no `StaticStudioDataPort`, no fabricated session/avatars.
 * The desktop host composes no runtime session and no avatar definitions
 * yet, so those surfaces load as their REAL empty states ("no session",
 * no avatars); the registry-backed packages surface starts empty and
 * grows only through the registry's own publish door.
 */

import type { StudioDataPort, StudioDataResult } from "../../../../../../game-ui/src/index.ts";
import type { StudioDataSnapshot } from "../../../../../../game-ui/src/index.ts";
import { checkReleaseGate } from "../../../../../../package-system/src/index.ts";
import type { PackageRegistry } from "../../../../../../package-registry/src/index.ts";
import type { CapabilityBroker } from "../../../../../../capability-broker/src/index.ts";
import type { ToolFabricRuntime } from "../../../../../../tool-fabric-runtime/src/index.ts";

/**
 * The Studio facts this adapter reads from the composed host — a local
 * STRUCTURAL slice, not the host type itself, so the adapter never imports
 * its composer and the module graph stays acyclic (the composed host object
 * satisfies this shape structurally; desktop-host.ts owns the real type).
 */
type StudioHostFacts = {
  readonly studio: {
    readonly registry: PackageRegistry;
    readonly broker: CapabilityBroker;
    readonly tools: ToolFabricRuntime;
  };
};

/**
 * The desktop `StudioDataPort`: reads the host's composed Studio systems
 * and assembles the game-ui snapshot. Deterministic per host state: two
 * loads over an unchanged host return the same data (E9).
 */
export class DesktopStudioDataPort implements StudioDataPort {
  readonly #host: () => StudioHostFacts;

  constructor(host: () => StudioHostFacts) {
    this.#host = host;
  }

  load(): StudioDataResult {
    const host = this.#host();
    const packages = host.studio.registry.list();
    const gateResults: StudioDataSnapshot["gateResults"] = {};
    for (const record of packages) {
      gateResults[record.identity.id] = checkReleaseGate(record);
    }
    const snapshot: StudioDataSnapshot = {
      packages,
      gateResults,
      // The desktop host composes no runtime session yet — the Session
      // surface renders its honest "no session" empty state (PL-013).
      operations: [],
      // No avatar definitions are composed in this host yet (PL-026) —
      // the Avatars surface renders its honest empty state.
      avatars: [],
      policy: host.studio.broker.policy,
      broker: host.studio.broker,
      registrations: host.studio.tools.listTools(),
      jobs: host.studio.tools.jobSnapshots(),
    };
    return { ok: true, data: snapshot };
  }
}
