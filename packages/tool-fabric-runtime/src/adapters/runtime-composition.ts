/**
 * Module role: production-default composition for the Tool Fabric runtime
 * (adapters layer — the outermost layer owns IO wiring). Wires the
 * invocation facade with: a wall-clock ClockPort (real time is an adapter
 * concern; the domain only ever sees the port), the canonical
 * adapter-dispatch executor, and empty in-memory shape/artifact stores the
 * host replaces with real implementations. Every default is explicit and
 * honest (E11): in-memory stores are process-local and NOT durable.
 *
 * Implements: PL-019 host composition; E3 (IO and provider detail behind
 * the outermost layer).
 */

import type { ToolFabricRuntime } from "../app/fabric-runtime.ts";
import { createToolFabricRuntime } from "../app/fabric-runtime.ts";
import type { ArtifactExchangePort, ClockPort, ShapeCatalogPort, ToolExecutorPort } from "../domain/ports.ts";
import { createInMemoryShapeCatalog } from "../in-memory-shape-catalog.ts";
import { createInMemoryArtifactExchange } from "../in-memory-artifact-exchange.ts";
import { createAdapterDispatchExecutor } from "./adapter-dispatch-executor.ts";

export interface RuntimeCompositionOptions {
  /** Wall-clock time source override (tests inject a deterministic clock). */
  readonly clock?: ClockPort;
  /** Executor override; default: the canonical adapter-dispatch executor. */
  readonly executor?: ToolExecutorPort;
  /** Shape catalog override; default: empty in-memory catalog. */
  readonly shapeCatalog?: ShapeCatalogPort;
  /** Artifact exchange override; default: empty in-memory exchange. */
  readonly artifactExchange?: ArtifactExchangePort;
}

const SYSTEM_CLOCK: ClockPort = Object.freeze({ now: () => Date.now() });

/**
 * Creates a Tool Fabric runtime wired with production defaults: system
 * clock, adapter-dispatch executor, empty in-memory shape catalog and
 * artifact exchange. Hosts inject real stores/executors for real work.
 */
export function createToolFabricRuntimeWithDefaults(options: RuntimeCompositionOptions = {}): ToolFabricRuntime {
  return createToolFabricRuntime({
    clock: options.clock ?? SYSTEM_CLOCK,
    executor: options.executor ?? createAdapterDispatchExecutor(),
    shapeCatalog: options.shapeCatalog ?? createInMemoryShapeCatalog(),
    artifactExchange: options.artifactExchange ?? createInMemoryArtifactExchange(),
  });
}
