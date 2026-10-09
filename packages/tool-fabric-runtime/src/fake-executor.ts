/**
 * Module role: an in-memory FAKE executor for the ToolExecutorPort — a
 * test double in the style of engine-adapter-contract's fake-adapter. NOT
 * a real provider integration and never presented as one. Deterministic
 * behavior: pre-requested cancellation → cancelled; expired deadline (per
 * the injected clock) → timeout; a scripted result survives refusals and
 * is consumed only by the next EXECUTED dispatch; default result echoes
 * the input. Never throws.
 *
 * Implements: PL-019 test double for the executor seam (E3 fake).
 */

import type { ExecutorDispatch, ExecutorResult, ToolExecutorPort } from "./domain/ports.ts";

export type FakeExecutorClock = () => number;

export interface FakeToolExecutor extends ToolExecutorPort {
  /** Test hook: pre-script the result of the next EXECUTED dispatch. */
  scriptNextResult(result: ExecutorResult): void;
  /** Observation log: every dispatch received, in order. */
  readonly dispatched: readonly ExecutorDispatch[];
}

/** Creates the in-memory fake executor (TEST DOUBLE; not production). */
export function createFakeExecutor(clock: FakeExecutorClock = () => 0): FakeToolExecutor {
  const dispatched: ExecutorDispatch[] = [];
  let scripted: ExecutorResult | undefined;

  async function execute(dispatch: ExecutorDispatch): Promise<ExecutorResult> {
    dispatched.push(dispatch);
    if (dispatch.cancellation !== undefined && dispatch.cancellation.requested) {
      return { outcome: "cancelled", reason: dispatch.cancellation.reason ?? "caller-requested" };
    }
    if (dispatch.deadline !== undefined && clock() >= dispatch.deadline.atEpochMs) {
      return { outcome: "timeout", deadline: dispatch.deadline };
    }
    if (scripted !== undefined) {
      const result: ExecutorResult = scripted;
      scripted = undefined;
      return result;
    }
    return { outcome: "executed", output: { echo: dispatch.input }, finishedAt: clock() };
  }

  return Object.freeze({ execute, scriptNextResult: (result: ExecutorResult): void => { scripted = result; }, dispatched });
}
