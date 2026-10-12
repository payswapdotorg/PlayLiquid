/**
 * PORTS (PL-036) — the effect seams of the multi-target build service.
 *
 * Every underlying authority is reached through an existing seam, never
 * re-implemented: the registry/CAS reads, the Tool Fabric runtime and time
 * ride @playliquid/build-orchestrator's ports (PL-020 — whose own adapters
 * wire @playliquid/package-registry and @playliquid/tool-fabric-runtime);
 * the engine adapters ride the typed catalog; the target profiles ride
 * the profile source port. The ONE new seam is {@link FanoutStorePort}:
 * each per-target staged build owns its OWN durable build-orchestrator
 * event store, keyed by the service; the host owns the stores so a
 * restore can find them again across process boundaries (E6).
 */

import type { BuildSourcePort, BuildStore, ServiceClock, ToolFabricPort } from "@playliquid/build-orchestrator";
import type { EngineCatalog } from "./catalog.ts";
import { createDefaultEngineCatalog } from "./catalog.ts";
import type { TargetProfilePort } from "./profiles.ts";

/**
 * The host-owned, keyed factory of per-target build-orchestrator event
 * stores (E6): `open(key)` must return THE SAME store for the same key
 * for as long as that staged build may be resumed — the build
 * orchestrator's restore verifies store agreement before trusting a
 * snapshot (E10; divergence is a typed refusal, never healed).
 */
export interface FanoutStorePort {
  open(storeKey: string): BuildStore;
}

/** The options of the multi-target build service constructor. */
export interface MultiTargetBuildServiceOptions {
  /** The engine binding catalog (default: the four merged adapters, frozen order). */
  readonly catalog?: EngineCatalog;
  /** The target profile source (sealed records + vendor gate declarations). */
  readonly profiles: TargetProfilePort;
  /** The registry/CAS read seam every per-target staged build resolves against (PL-020). */
  readonly sources: BuildSourcePort;
  /** The Tool Fabric runtime seam every per-target staged build executes through (PL-019). */
  readonly fabric: ToolFabricPort;
  /** The only time source (E3). */
  readonly clock: ServiceClock;
  /** The host-owned keyed store factory for per-target staged builds (E6). */
  readonly stores: FanoutStorePort;
}

/** Resolves the effective catalog (default = the four merged adapters). */
export function effectiveCatalog(catalog: EngineCatalog | undefined): EngineCatalog {
  return catalog ?? createDefaultEngineCatalog();
}
