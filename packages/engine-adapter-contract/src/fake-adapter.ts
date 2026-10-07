/**
 * Module role: an in-memory FAKE adapter implementing the neutral adapter
 * contract, for use in tests. This is a test double — it is NOT a real
 * provider integration and must never be presented as one (the repository
 * forbids mocks presented as production).
 *
 * Behavior:
 * - lifecycle driven exclusively through advanceLifecycle (never throws);
 * - dispatch order: record → validate shape → closed → not-ready →
 *   degraded → undeclared capability → scripted result (if any) → default
 *   ok echo;
 * - every result it builds is stamped with an AdapterAuthority using the
 *   injected clock (deterministic in tests);
 * - a scripted result survives a refused dispatch and is consumed only by
 *   the next EXECUTED dispatch.
 *
 * Implements: PL-005 §3.B.5 (reference fake).
 */

import { mediateAdapterCapability, type AdapterCapabilityId } from "./capability.ts";
import { advanceLifecycle, type AdapterLifecycleState, type LifecycleTransitionCheck } from "./lifecycle.ts";
import {
  adapterAuthority,
  okCommandResult,
  refusedCommandResult,
  validateAdapterCommandDispatch,
  type AdapterAuthority,
  type AdapterCommandDispatch,
  type AdapterCommandResult,
} from "./exchange.ts";
import type { Adapter, AdapterId } from "./adapter.ts";

export type FakeAdapterClock = () => number;

export interface FakeAdapterOptions {
  readonly adapterId?: AdapterId;
  readonly label?: string;
  readonly offeredCapabilities?: readonly AdapterCapabilityId[];
  /** Deterministic time source for authority stamps; defaults to Date.now. */
  readonly clock?: FakeAdapterClock;
}

export interface FakeAdapter extends Adapter {
  /**
   * Test hook: pre-script the result returned by the next EXECUTED dispatch
   * (refusals do not consume it). The caller supplies the full result,
   * including its authority.
   */
  scriptNextResult(result: AdapterCommandResult): void;
  /** Observation log: every dispatch received, in order (including invalid ones). */
  readonly dispatched: readonly AdapterCommandDispatch[];
}

const DEFAULT_FAKE_ADAPTER_ID: AdapterId = "fake.default";

export function createFakeAdapter(options: FakeAdapterOptions = {}): FakeAdapter {
  const adapterId: AdapterId = options.adapterId ?? DEFAULT_FAKE_ADAPTER_ID;
  const label: string =
    options.label ?? "In-memory fake adapter (test double; NOT a real provider integration)";
  const offered: readonly AdapterCapabilityId[] = Object.freeze([...(options.offeredCapabilities ?? [])]);
  const clock: FakeAdapterClock = options.clock ?? (() => Date.now());

  let state: AdapterLifecycleState = "registered";
  let scripted: AdapterCommandResult | undefined;
  const dispatched: AdapterCommandDispatch[] = [];

  function stamp(): AdapterAuthority {
    return adapterAuthority(adapterId, clock());
  }

  function applyTransition(requested: AdapterLifecycleState): LifecycleTransitionCheck {
    const check = advanceLifecycle(state, requested);
    if (check.outcome === "ok") {
      state = check.next;
    }
    return check;
  }

  async function dispatch(command: AdapterCommandDispatch): Promise<AdapterCommandResult> {
    dispatched.push(command);
    const authority = stamp();

    const shape = validateAdapterCommandDispatch(command);
    if (shape.outcome === "rejected") {
      return refusedCommandResult(authority, {
        code: "adapter/invalid-dispatch",
        message: `invalid dispatch: ${shape.rejections.map((item) => item.message).join("; ")}`,
      });
    }

    if (state === "closed") {
      return refusedCommandResult(authority, { code: "adapter/closed", message: "adapter is closed" });
    }
    if (state === "registered") {
      return refusedCommandResult(authority, { code: "adapter/not-ready", message: "adapter is not ready yet" });
    }
    if (state === "degraded") {
      return refusedCommandResult(authority, { code: "adapter/degraded", message: "adapter is degraded" });
    }

    const mediation = mediateAdapterCapability(offered, command.capability);
    if (mediation.outcome === "refused") {
      return refusedCommandResult(authority, {
        code: mediation.refusal.code,
        message: mediation.refusal.message,
        capability: mediation.refusal.requested,
      });
    }

    if (scripted !== undefined) {
      const result: AdapterCommandResult = scripted;
      scripted = undefined;
      return result;
    }

    return okCommandResult(authority, { commandId: command.commandId, capability: command.capability });
  }

  const fake: FakeAdapter = {
    id: adapterId,
    label,
    offeredCapabilities: offered,
    get state(): AdapterLifecycleState {
      return state;
    },
    markReady: () => applyTransition("ready"),
    reportDegraded: () => applyTransition("degraded"),
    close: () => applyTransition("closed"),
    dispatch,
    scriptNextResult: (result: AdapterCommandResult): void => {
      scripted = result;
    },
    dispatched,
  };
  return Object.freeze(fake);
}
