/**
 * game-ui LOCAL TEST DOUBLES (TEST SUPPORT ONLY — lock rule 44: no hidden
 * mocks presented as production).
 *
 * Two kinds of doubles live here:
 * - {@link LocalAdapter}: a STRUCTURAL double of the engine-adapter-contract
 *   `Adapter` seam. game-ui deliberately does NOT depend on
 *   engine-adapter-contract (its contract is consumed through
 *   tool-fabric-runtime registrations); the double reproduces the neutral
 *   lifecycle + exchange shapes locally so demo fixtures can register demo
 *   tools without adding a dependency edge. Assignability to the real
 *   `Adapter` interface is proven structurally at the registration site.
 * - {@link StaticStudioDataPort} / {@link ScriptedStudioDataPort}: in-memory
 *   `StudioDataPort` doubles for the store harness/tests (fixed snapshot,
 *   scripted success/failure sequences).
 *
 * No IO, no timers, no globals; deterministic by construction.
 */

import type { StudioDataPort, StudioDataResult } from "./ports.ts";
import type { StudioDataSnapshot } from "./view/studio-view.ts";

// ---------------------------------------------------------------------------
// Structural Adapter double (engine-adapter-contract seam, reproduced locally)
// ---------------------------------------------------------------------------

/** The neutral adapter lifecycle states (engine-adapter-contract vocabulary). */
export type LocalAdapterState = "registered" | "ready" | "degraded" | "closed";

/**
 * Lifecycle transition check (structural mirror of the contract's
 * `LifecycleTransitionCheck`; rejection codes are the contract literals).
 */
export type LocalLifecycleCheck =
  | { readonly outcome: "ok"; readonly next: LocalAdapterState }
  | {
      readonly outcome: "rejected";
      readonly code: "adapter-lifecycle/invalid-transition" | "adapter-lifecycle/closed-is-terminal";
      readonly message: string;
    };

/** A command dispatch (structural mirror of `AdapterCommandDispatch`). */
export interface LocalAdapterDispatch {
  readonly kind: "adapter-command-dispatch";
  readonly commandId: string;
  readonly capability: string;
  readonly payload: unknown;
}

/** An authoritative ok result (structural mirror of `AdapterCommandOk`). */
export interface LocalAdapterCommandOk {
  readonly outcome: "ok";
  readonly authority: {
    readonly kind: "adapter-authority";
    readonly adapterId: string;
    readonly finishedAt: number;
  };
  readonly value: unknown;
}

/**
 * A local, in-memory Adapter double. Lifecycle transitions follow the
 * contract table (registered → ready|degraded|closed; ready → degraded|
 * closed; degraded → ready|closed; closed terminal, re-close idempotent).
 * `dispatch` echoes the payload stamped with an authority. Deterministic;
 * records every dispatch for evidence.
 */
export class LocalAdapter {
  readonly id: string;
  readonly label: string;
  readonly offeredCapabilities: readonly string[];
  #state: LocalAdapterState;
  readonly #finishedAt: number;
  readonly #dispatched: LocalAdapterDispatch[] = [];

  constructor(options: {
    readonly id: string;
    readonly label: string;
    readonly offeredCapabilities: readonly string[];
    readonly state?: LocalAdapterState;
    readonly finishedAt?: number;
  }) {
    this.id = options.id;
    this.label = options.label;
    this.offeredCapabilities = [...options.offeredCapabilities];
    this.#state = options.state ?? "registered";
    this.#finishedAt = options.finishedAt ?? 0;
  }

  get state(): LocalAdapterState {
    return this.#state;
  }

  /** Every dispatch received, in order (evidence for tests/harness). */
  get dispatched(): readonly LocalAdapterDispatch[] {
    return [...this.#dispatched];
  }

  markReady(): LocalLifecycleCheck {
    if (this.#state === "registered" || this.#state === "degraded") {
      this.#state = "ready";
      return { outcome: "ok", next: "ready" };
    }
    return this.#refuseTransition("ready");
  }

  reportDegraded(): LocalLifecycleCheck {
    if (this.#state === "registered" || this.#state === "ready") {
      this.#state = "degraded";
      return { outcome: "ok", next: "degraded" };
    }
    return this.#refuseTransition("degraded");
  }

  close(): LocalLifecycleCheck {
    if (this.#state === "closed") {
      return { outcome: "ok", next: "closed" };
    }
    this.#state = "closed";
    return { outcome: "ok", next: "closed" };
  }

  dispatch(command: LocalAdapterDispatch): Promise<LocalAdapterCommandOk> {
    this.#dispatched.push(command);
    return Promise.resolve({
      outcome: "ok",
      authority: {
        kind: "adapter-authority",
        adapterId: this.id,
        finishedAt: this.#finishedAt,
      },
      value: { echo: command.payload },
    });
  }

  #refuseTransition(requested: LocalAdapterState): LocalLifecycleCheck {
    if (this.#state === "closed") {
      return {
        outcome: "rejected",
        code: "adapter-lifecycle/closed-is-terminal",
        message: `adapter ${this.id} is closed; cannot transition to ${requested}`,
      };
    }
    return {
      outcome: "rejected",
      code: "adapter-lifecycle/invalid-transition",
      message: `adapter ${this.id} cannot transition ${this.#state} -> ${requested}`,
    };
  }
}

// ---------------------------------------------------------------------------
// StudioDataPort doubles
// ---------------------------------------------------------------------------

/**
 * A port over one fixed snapshot (or a fixed failure). The demo mount uses
 * this; store tests use it as the stable success/failure seam.
 */
export class StaticStudioDataPort implements StudioDataPort {
  readonly #result: StudioDataResult;

  constructor(data: StudioDataSnapshot, options?: { readonly failWith?: string }) {
    this.#result =
      options?.failWith === undefined
        ? { ok: true, data }
        : { ok: false, code: "load-failed", detail: options.failWith };
  }

  load(): StudioDataResult {
    return this.#result;
  }
}

/**
 * A scripted port: returns the script results in order, then sticks on the
 * last one. An empty script always fails (typed, never a throw).
 */
export class ScriptedStudioDataPort implements StudioDataPort {
  readonly #script: readonly StudioDataResult[];
  #next = 0;

  constructor(script: readonly StudioDataResult[]) {
    this.#script = [...script];
  }

  load(): StudioDataResult {
    if (this.#script.length === 0) {
      return { ok: false, code: "load-failed", detail: "scripted port has no results" };
    }
    const index = Math.min(this.#next, this.#script.length - 1);
    this.#next += 1;
    return (
      this.#script[index] ?? { ok: false, code: "load-failed", detail: "scripted port has no results" }
    );
  }
}
