/**
 * Module role: the canonical ToolExecutorPort implementation that executes
 * through the registration's NEUTRAL adapter (the engine-adapter-contract
 * seam). Maps the adapter exchange result (ok | refused | failed, always
 * authority-stamped) onto the executor result union, passes the effective
 * deadline through the dispatch envelope, and honors cancellation by racing
 * the adapter dispatch (a cancellation that fires first produces a typed
 * cancelled result; the orphaned dispatch result is discarded — the
 * pipeline's stale-result rule covers late arrivals). No engine types, no
 * SDK imports (E3/E4). This module lives in the adapters layer; the domain
 * only ever sees the port.
 *
 * Implements: PL-019 executor seam over the PL-005 adapter exchange
 * (§3.B.3).
 */

import type { AdapterCommandDispatch, AdapterCommandResult } from "@playliquid/engine-adapter-contract";
import type { CancellationReason, Deadline } from "@playliquid/tool-fabric";
import type { ExecutorDispatch, ExecutorResult, ToolExecutorPort } from "../domain/ports.ts";
import type { ToolRegistration } from "../domain/registry.ts";

const ADAPTER_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "adapter/not-ready",
  "adapter/closed",
  "adapter/degraded",
]);

/**
 * Creates the executor that dispatches every execution through the tool's
 * registered adapter. Deterministic mapping; never throws.
 */
export function createAdapterDispatchExecutor(): ToolExecutorPort {
  async function execute(dispatch: ExecutorDispatch): Promise<ExecutorResult> {
    if (dispatch.cancellation !== undefined && dispatch.cancellation.requested) {
      return { outcome: "cancelled", reason: dispatch.cancellation.reason ?? "caller-requested" };
    }
    const command: AdapterCommandDispatch = Object.freeze({
      kind: "adapter-command-dispatch",
      commandId: dispatch.callId,
      capability: dispatch.registration.dispatchCapability,
      payload: dispatch.input,
      ...(dispatch.deadline === undefined ? {} : { deadline: toCommandDeadline(dispatch.deadline) }),
    });

    const adapterPromise = dispatchAdapter(dispatch, command);
    const cancellation = dispatch.cancellation;
    if (cancellation === undefined) {
      return adapterPromise;
    }
    return await raceCancellation(adapterPromise, cancellation);
  }
  return Object.freeze({ execute });
}

async function dispatchAdapter(dispatch: ExecutorDispatch, command: AdapterCommandDispatch): Promise<ExecutorResult> {
  const registration: ToolRegistration = dispatch.registration;
  let result: AdapterCommandResult;
  try {
    result = await registration.adapter.dispatch(command);
  } catch (error) {
    return {
      outcome: "refused",
      code: "executor/adapter-failed",
      message: `adapter ${registration.adapter.id} threw: ${describe(error)}`,
    };
  }
  if (result.outcome === "ok") {
    return { outcome: "executed", output: result.value, finishedAt: result.authority.finishedAt };
  }
  if (result.outcome === "refused") {
    return {
      outcome: "refused",
      code: "executor/adapter-refused",
      message: `adapter ${registration.adapter.id} refused: ${result.refusal.code}: ${result.refusal.message}`,
      ...(ADAPTER_UNAVAILABLE_CODES.has(result.refusal.code) ? { adapterCode: result.refusal.code } : {}),
    };
  }
  return {
    outcome: "refused",
    code: "executor/adapter-failed",
    message: `adapter ${registration.adapter.id} failed: ${result.error.code}: ${result.error.message}`,
    adapterCode: result.error.code,
  };
}

function raceCancellation(adapterPromise: Promise<ExecutorResult>, cancellation: { requested: boolean; onCancel(listener: () => void): () => void }): Promise<ExecutorResult> {
  return new Promise<ExecutorResult>((resolve) => {
    let settled = false;
    const finish = (result: ExecutorResult): void => {
      if (!settled) {
        settled = true;
        unsubscribe();
        resolve(result);
      }
    };
    const unsubscribe = cancellation.onCancel(() => {
      const reason: CancellationReason = "caller-requested";
      finish({ outcome: "cancelled", reason });
    });
    void adapterPromise.then(finish, (error: unknown) => {
      finish({
        outcome: "refused",
        code: "executor/adapter-failed",
        message: `adapter dispatch rejected: ${describe(error)}`,
      });
    });
  });
}

function toCommandDeadline(deadline: Deadline): { atEpochMs: number } {
  return { atEpochMs: deadline.atEpochMs };
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
