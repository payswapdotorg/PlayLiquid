/**
 * Deterministic in-memory fakes for the multi-target build service's own
 * ports (the build-orchestrator / tool-fabric-runtime test-double pattern).
 * Every fake is clearly a FAKE and never presented as a production
 * integration (AGENTS: "no mock presented as real production integration").
 *
 * - {@link MemoryFanoutStores} — {@link FanoutStorePort} double: a keyed
 *   map of in-memory BuildStores. Process memory is NOT durable across
 *   restarts — a truthful E11 limitation of the double, never of the
 *   design: the port accepts host-owned durable stores;
 * - {@link MemoryProfileSource} — {@link TargetProfilePort} double over a
 *   static bundle table (sealed records; no seal is ever forged here).
 */

import type { BuildStore } from "@playliquid/build-orchestrator";
import { createMemoryBuildStore } from "@playliquid/build-orchestrator";
import type { TargetId } from "@playliquid/target-profiles";
import type { FanoutStorePort } from "./ports.ts";
import type { TargetProfileBundle, TargetProfilePort } from "./profiles.ts";

/** The keyed in-memory store map (TEST DOUBLE; process memory is not durable — E11). */
export interface MemoryFanoutStores extends FanoutStorePort {
  /** The store keys opened so far (audit). */
  readonly openedKeys: readonly string[];
}

/** Creates a keyed map of in-memory BuildStores (TEST DOUBLE; not durable). */
export function createMemoryFanoutStores(): MemoryFanoutStores {
  const stores = new Map<string, BuildStore>();
  const opened: string[] = [];
  return {
    open: (storeKey: string): BuildStore => {
      const existing = stores.get(storeKey);
      if (existing !== undefined) {
        return existing;
      }
      const store = createMemoryBuildStore();
      stores.set(storeKey, store);
      opened.push(storeKey);
      return store;
    },
    get openedKeys(): readonly string[] {
      return opened.slice();
    },
  };
}

/** The in-memory target profile source (TEST DOUBLE over a static bundle table). */
export interface MemoryProfileSource extends TargetProfilePort {
  /** Replaces the bundle published for one target (test hook). */
  publish(target: TargetId, bundle: TargetProfileBundle | null): void;
}

/** Creates an in-memory profile source over the given bundles (defaults: none). */
export function createMemoryProfileSource(
  bundles: ReadonlyArray<readonly [TargetId, TargetProfileBundle | null]> = [],
): MemoryProfileSource {
  const table = new Map<string, TargetProfileBundle | null>(bundles.map(([target, bundle]) => [target, bundle]));
  return {
    bundleFor: (target: TargetId): TargetProfileBundle | null => table.get(target) ?? null,
    publish: (target: TargetId, bundle: TargetProfileBundle | null): void => {
      table.set(target, bundle);
    },
  };
}
