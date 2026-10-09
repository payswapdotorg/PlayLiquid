/**
 * Module role: public surface of @playliquid/tool-fabric-runtime — the
 * runtime side of the Tool Fabric (PL-019): the adapter registry, the
 * invocation pipeline over the tool-fabric call protocol, the
 * content-addressed exchange guard, the queued/resumable job model, the
 * executor/clock/store ports, the node process adapter and the canonical
 * adapter-dispatch executor, plus the in-memory test doubles (clearly
 * labeled). Engine/tool providers integrate through registrations; the
 * domain stays pure (E3/E4).
 *
 * Implements: PL-019 (whole package).
 */

// domain (pure)
export * from "./domain/exchange.ts";
export * from "./domain/registry.ts";
export * from "./domain/job.ts";
export * from "./domain/ports.ts";

// app (orchestration through ports)
export * from "./app/pipeline.ts";
export * from "./app/queue.ts";
export * from "./app/fabric-runtime.ts";

// adapters (IO behind the ports)
export * from "./adapters/adapter-dispatch-executor.ts";
export * from "./adapters/node-process-executor.ts";
export * from "./adapters/runtime-composition.ts";

// fakes & in-memory doubles (test doubles / host conveniences; E11-labeled)
export * from "./fake-executor.ts";
export * from "./in-memory-clock.ts";
export * from "./in-memory-shape-catalog.ts";
export * from "./in-memory-artifact-exchange.ts";
export * from "./in-memory-jobs.ts";
