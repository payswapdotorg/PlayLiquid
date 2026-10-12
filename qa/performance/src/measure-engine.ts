/**
 * qa/performance — ENGINE PLAYCANVAS suite (PL-021 surface; PL-042).
 *
 * WHAT IS MEASURED (E11 honesty): the PlayCanvas engine adapter's public
 * surface over @playliquid/engine-playcanvas's entrypoint:
 *
 * 1. BINDING CONSTRUCTION: 2,000 typed engine-binding constructions
 *    (createPlayCanvasEngineBinding — content digests derived from the
 *    binding content each time) plus build-contracts projections.
 * 2. PLAN APPLICATION (R12): a deterministic plan of 2,000 command
 *    dispatches (inspect/modify over the offered capability surface,
 *    unique command ids) applied through the adapter via the
 *    deterministic in-memory fake bridge — the labeled test host; the
 *    REAL PlayCanvas bridge is a host concern, deliberately out of scope
 *    here (E11). Every outcome is counted by status.
 *
 * Determinism: applying the same plan twice on fresh adapters must
 * produce the identical evidence-ledger digest (E9/E10).
 */

import {
  PLAYCANVAS_OFFERED_CAPABILITIES,
  PLAYCANVAS_PAYLOAD_VERSION,
  createFakePlayCanvasBridge,
  createFakePlayCanvasClock,
  createPlayCanvasAdapter,
  createPlayCanvasEngineBinding,
  toBuildContractsEngineBindingRef,
} from "../../../packages/engine-playcanvas/src/index.ts";
import { PERFORMANCE_BUDGETS } from "./budgets.ts";
import type { MetricMeasurement } from "./budgets.ts";
import { logMetric, nowMs, shapeDigestOf } from "./perf-kit.ts";

const BINDINGS = 2_000;
const PLAN_COMMANDS = 2_000;

/** Binding construction throughput (content digests derived per call). */
function runBindingConstruction(): MetricMeasurement {
  const started = nowMs();
  let projections = 0;
  for (let i = 0; i < BINDINGS; i += 1) {
    const binding = createPlayCanvasEngineBinding();
    const projected = toBuildContractsEngineBindingRef(binding);
    if (projected.supportedTargets.length !== binding.supportedTargets.length) {
      throw new Error("binding projection mismatch");
    }
    projections += 1;
  }
  const elapsed = nowMs() - started;
  if (projections !== BINDINGS) throw new Error("binding count mismatch");
  logMetric("engine binding construction", "2,000 typed bindings + build-contracts projections", elapsed, BINDINGS);
  return {
    metric: "engine.bindingConstruction",
    scale: `${String(BINDINGS)} typed engine-binding constructions + projections`,
    count: BINDINGS,
    measuredMs: elapsed,
    budgetMs: PERFORMANCE_BUDGETS.engine.bindingConstructionMs,
    detail: "content-addressed binding digests derived per construction",
  };
}

/** The deterministic inspect capability rotation of the plan. */
const INSPECT_CAPABILITIES: readonly string[] = ["project.inspect", "scene.inspect", "entity.inspect", "component.inspect", "asset.inspect"];

/** One deterministic plan step (capability + payload), slot-indexed. */
function planCommandOf(slot: number): { readonly capability: string; readonly payload: Record<string, unknown> } {
  if (slot % 4 === 3) {
    return {
      capability: INSPECT_CAPABILITIES[slot % INSPECT_CAPABILITIES.length] as string,
      payload: {
        version: PLAYCANVAS_PAYLOAD_VERSION,
        tenant: "perf-engine-tenant",
        target: `projects/game-${String(slot % 8)}`,
      },
    };
  }
  return {
    capability: slot % 4 === 1 ? "entity.modify" : "project.modify",
    payload: {
      version: PLAYCANVAS_PAYLOAD_VERSION,
      tenant: "perf-engine-tenant",
      target: slot % 4 === 1 ? `Entity-${String(slot % 12)}` : `projects/game-${String(slot % 8)}`,
      edits: [
        { entityName: `Entity-${String(slot % 12)}`, property: "position", value: [slot % 64, (slot * 3) % 64, 0] },
        { entityName: `Entity-${String(slot % 12)}`, property: "enabled", value: slot % 2 === 0 },
      ],
    },
  };
}

/** Applies the deterministic plan through a fresh adapter; returns ledger digest + rate. */
async function applyPlan(): Promise<{ metric: MetricMeasurement; ledgerDigest: string; okCount: number }> {
  const adapter = createPlayCanvasAdapter({
    tenant: "perf-engine-tenant" as never,
    bridge: createFakePlayCanvasBridge({ seed: 42 }),
    clock: createFakePlayCanvasClock(10_000),
  });
  adapter.markReady();
  const started = nowMs();
  let okCount = 0;
  let other = 0;
  for (let i = 0; i < PLAN_COMMANDS; i += 1) {
    const plan = planCommandOf(i);
    const result = await adapter.dispatch({
      kind: "adapter-command-dispatch",
      commandId: `perf-engine-cmd-${i}`,
      capability: plan.capability,
      payload: plan.payload,
    });
    if (result.outcome === "ok") okCount += 1;
    else other += 1;
  }
  const elapsed = nowMs() - started;
  if (okCount + other !== PLAN_COMMANDS) throw new Error("plan outcome count mismatch");
  if (other !== 0) throw new Error(`${String(other)} plan commands did not complete ok`);
  logMetric("plan application (R12)", "2,000 adapter command dispatches via the fake bridge", elapsed, PLAN_COMMANDS);
  return {
    metric: {
      metric: "engine.planApplication",
      scale: `${String(PLAN_COMMANDS)} adapter command dispatches (inspect/modify plan)`,
      count: PLAN_COMMANDS,
      measuredMs: elapsed,
      budgetMs: PERFORMANCE_BUDGETS.engine.planApplicationMs,
      detail: `over the offered capability surface (${String(PLAYCANVAS_OFFERED_CAPABILITIES.length)} capabilities)`,
    },
    ledgerDigest: adapter.evidence.ledgerDigest,
    okCount,
  };
}

/** The full suite measurement (both workloads + the determinism repeat). */
export async function measureEngine(): Promise<{
  readonly suite: string;
  readonly metrics: readonly MetricMeasurement[];
  readonly shapeDigest: string;
  readonly determinism: { readonly repeated: boolean; readonly digest: string };
}> {
  const bindingMetric = runBindingConstruction();
  const plan = await applyPlan();
  // Determinism: the same plan on a fresh adapter reproduces the ledger digest.
  const repeat = await applyPlan();
  if (plan.ledgerDigest !== repeat.ledgerDigest) {
    throw new Error("engine determinism violated: repeated plans produced different evidence ledgers");
  }
  const shapeDigest = shapeDigestOf({
    suite: "qa/performance/engine-playcanvas",
    bindings: BINDINGS,
    planCommands: PLAN_COMMANDS,
    ledgerDigest: plan.ledgerDigest,
  });
  return {
    suite: "engine",
    metrics: [bindingMetric, plan.metric],
    shapeDigest,
    determinism: { repeated: true, digest: plan.ledgerDigest },
  };
}
