/**
 * THE CAPABILITY BROKER (lock rule 4): the runtime permission authority for
 * avatar/agent actions. One owner of grant admission, budget consumption
 * and denial reasons (E1).
 *
 * The broker does NOT re-implement the frozen capability protocol — it IS
 * the authority operating it. Every evaluation delegates to
 * `@playliquid/runtime-contracts` `resolveActionRequest` (the pure
 * boundary evaluator) over the broker's own authoritative read models:
 * the grant table ({@link GrantRegistryState}), the broker policy
 * ({@link BrokerPolicy}) and the budget ledger. Lock rules 13/14 hold
 * structurally: an {@link ActionRequest} is an authority-free intent plus
 * a grant reference; the only output that can mutate state is a canonical
 * `RuntimeCommandEnvelope` with `origin: broker-mediated`, which must
 * STILL pass the runtime kernel's command admission gate (E2 — the broker
 * never bypasses the canonical command path).
 *
 * Async/stateful documentation (spec/worker-contract.md), this class:
 *
 * - Mutable state owner: THE BROKER. It exclusively owns the grant table,
 *   the budget ledger and the command-id counter. Hosts and experiences
 *   read them through the getters (read models, never writers).
 * - Command admission: `evaluate` derives canonical command envelopes
 *   only; admission happens in the runtime kernel via `admitCommand`.
 * - Event order: the broker emits no events. Budget counters advance in
 *   evaluation order; per-grant counters are the runtime-contracts ledger
 *   semantics (per-tick reset, total, lazy rate windows) — see
 *   runtime-contracts capability.ts.
 * - Idempotency key: travels inside the ActionRequest and is honored by
 *   the KERNEL's idempotency table after admission (runtime-contracts
 *   idempotency.ts; runtime-core capability-port.ts documents the same
 *   seam rule). The broker deliberately performs NO request dedup — that
 *   would create a second idempotency authority. Broker-side protection
 *   against replay is the BUDGET: every granted evaluation consumes; once
 *   a constraint is exhausted, replays are denied (E8 anti-gaming; proven
 *   by a negative test).
 * - Stale-result rule: grants issued under a non-current session epoch are
 *   denied (`grant-epoch-stale`); derived commands carry the evaluation
 *   epoch so downstream consumers apply `applyStaleResultRule` exactly as
 *   everywhere else in the protocol.
 * - Replay/resume boundary: broker state is a pure function of (initial
 *   options, admitted grants, evaluation sequence, clock readings).
 *   Replaying the same sequence reproduces the identical ledger, command
 *   ids and resolutions (harness-proven). Session snapshotting itself is
 *   owned by the runtime kernels (PL-013/PL-014), not by the broker.
 * - Retry/cancellation: evaluation is synchronous and pure-by-contract;
 *   retries re-submit the same idempotency key and are deduplicated by the
 *   kernel; there is no async broker work to cancel.
 *
 * Purity: no IO, no timers (time arrives through the injected
 * {@link BrokerClockPort} and the caller's tick), no globals, no
 * randomness — command ids are a deterministic `<prefix>-<n>` counter.
 */

import { asCommandId, EMPTY_BUDGET_LEDGER, resolveActionRequest } from "@playliquid/runtime-contracts";
import type {
  ActionRequest,
  ActionResolution,
  BudgetLedger,
  CapabilityGrant,
  CapabilityGrantId,
  CommandId,
  SessionEpoch,
  SessionId,
  Tick,
  Timestamp,
} from "@playliquid/runtime-contracts";
import type { BrokerPolicy } from "./policy.ts";
import { commandKindForIntent } from "./policy.ts";
import { admitGrant, findGrant, sweepExpiredGrants } from "./registry.ts";
import type {
  GrantAdmissionRequest,
  GrantAdmissionResult,
  GrantRegistryState,
} from "./registry.ts";

/**
 * Injected time authority (mirrors runtime-core's `ClockPort` shape; the
 * broker package deliberately does not depend on runtime-core — the seam is
 * structural). The broker reads it only to stamp derived commands.
 */
export interface BrokerClockPort {
  now(): Timestamp;
}

/**
 * Evaluation context: the caller's authoritative session view. Structurally
 * identical to runtime-core's `CapabilityPortContext`, so the broker is
 * wireable to the kernel's `CapabilityPort` seam at composition time.
 */
export interface BrokerEvaluationContext {
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
}

/** Construction options for {@link CapabilityBroker}. */
export interface CapabilityBrokerOptions {
  readonly policy: BrokerPolicy;
  readonly clock: BrokerClockPort;
  /** Pre-seeded grant table (test setup or broker-state restore). */
  readonly grants?: readonly CapabilityGrant[];
  /** Pre-seeded budget ledger (broker-state restore). */
  readonly ledger?: BudgetLedger;
  /** Pre-seeded command-id counter (broker-state restore; default 0). */
  readonly commandIdCounter?: number;
  /** Deterministic command id prefix; default `"cmd"`. */
  readonly commandIdPrefix?: string;
}

/**
 * THE broker. Owns the grant table, budget ledger and command-id counter.
 * `evaluate` satisfies the structural shape of runtime-core's
 * `CapabilityPort` (proof in compat.test.ts).
 */
export class CapabilityBroker {
  readonly #policy: BrokerPolicy;
  readonly #clock: BrokerClockPort;
  readonly #prefix: string;
  #registry: GrantRegistryState;
  #ledger: BudgetLedger;
  #counter: number;

  constructor(options: CapabilityBrokerOptions) {
    this.#policy = options.policy;
    this.#clock = options.clock;
    this.#prefix = options.commandIdPrefix ?? "cmd";
    this.#registry = { grants: [...(options.grants ?? [])] };
    this.#ledger = options.ledger ?? EMPTY_BUDGET_LEDGER;
    this.#counter = options.commandIdCounter ?? 0;
  }

  /**
   * Evaluate one action request at the caller's session view. Pure-by-
   * contract: deterministic given (request, context, own state, clock); the
   * only state it may update is broker-owned (the budget ledger on grant).
   * Denial reasons are exactly the frozen runtime-contracts reasons; the
   * one broker-local denial is a missing intent-kind -> command-kind
   * mapping (`intent-kind-outside-grant`, mirroring the GrantTable fake).
   */
  evaluate<P>(request: ActionRequest<P>, context: BrokerEvaluationContext): ActionResolution<P> {
    const commandKind = commandKindForIntent(this.#policy, request.intent.kind);
    if (commandKind === undefined) {
      return {
        status: "denied",
        requestId: request.requestId,
        reason: "intent-kind-outside-grant",
        detail: `broker policy has no command mapping for intent kind ${String(request.intent.kind)}`,
      };
    }
    const commandId = this.#nextCommandId();
    const { resolution, ledger } = resolveActionRequest(
      request,
      {
        grants: this.#registry.grants,
        epoch: context.epoch,
        tick: context.tick,
        capabilityIntentKinds: this.#policy.capabilityIntentKinds,
        ledger: this.#ledger,
      },
      commandId,
      commandKind,
      this.#clock.now(),
    );
    this.#ledger = ledger;
    return resolution;
  }

  /**
   * Admit a grant into the authoritative table. This is the ONLY minting
   * path, and it is host-side: callers are host game policy or platform
   * issuers ({@link GrantIssuer}); avatar agents have no route to it.
   */
  admit(request: GrantAdmissionRequest): GrantAdmissionResult {
    const result = admitGrant(this.#registry, this.#policy, request);
    if (result.ok) {
      this.#registry = result.registry;
    }
    return result;
  }

  /** Revoke a grant by id. Returns whether it existed. */
  revoke(grantId: CapabilityGrantId): boolean {
    const next = this.#registry.grants.filter((grant) => grant.grantId !== grantId);
    const existed = next.length !== this.#registry.grants.length;
    this.#registry = { grants: next };
    return existed;
  }

  /**
   * Sweep grants that are void at tick `at` (bookkeeping only — evaluation
   * denies them identically with or without the sweep). Returns swept ids.
   */
  sweep(at: Tick): readonly CapabilityGrantId[] {
    const { registry, swept } = sweepExpiredGrants(this.#registry, at);
    this.#registry = registry;
    return swept;
  }

  /** Read model: the grant with this id. */
  findGrant(grantId: CapabilityGrantId): CapabilityGrant | undefined {
    return findGrant(this.#registry, grantId);
  }

  /** Read model: the authoritative grant table. */
  get grants(): readonly CapabilityGrant[] {
    return this.#registry.grants;
  }

  /** Read model: the authoritative budget ledger. */
  get ledger(): BudgetLedger {
    return this.#ledger;
  }

  /** Read model: the broker policy. */
  get policy(): BrokerPolicy {
    return this.#policy;
  }

  /** Read model: commands minted so far (restore/replay bookkeeping). */
  get commandIdCounter(): number {
    return this.#counter;
  }

  #nextCommandId(): CommandId {
    this.#counter += 1;
    return asCommandId(`${this.#prefix}-${this.#counter}`);
  }
}
