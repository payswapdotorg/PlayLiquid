# @playliquid/capability-broker

Work Order PL-026 — Capability Broker (PlayLiquid GameOS).

**THE runtime permission authority for avatar/agent actions** (architecture
lock rule 4): one owner of grant admission, budget consumption and denial
reasons (E1). Avatar-agent actions are broker-mediated canonical commands
only (lock rules 13/14) — the broker never grants raw engine authority, and
a granted resolution still has to pass the runtime kernel's command
admission gate (E2).

The broker does not re-implement the capability protocol — it IS the
authority operating the frozen `@playliquid/runtime-contracts` semantics
(`CapabilityGrant`, `consumeBudget`, `resolveActionRequest`). Its GameIR
binding is policy derivation: host restrictions come from `avatar-binding`
nodes (R5) and intent coverage is validated against the rules the game's
world can actually adjudicate (`rule.handles`).

Imports `@playliquid/runtime-contracts` and `@playliquid/game-ir` only, per
`spec/module-dependency-matrix.md` (capability-broker | Runtime | game-ir
main dependency; runtime-contracts is the frozen protocol the work order
pins). `runtime-core` is deliberately NOT a dependency: the kernel reaches
the broker through its frozen `CapabilityPort` seam, which
`CapabilityBroker.evaluate` satisfies structurally (proof in
`src/compat.test.ts`).

## Module map

| Area | Module | Anchors |
| --- | --- | --- |
| Broker policy + GameIR derivation | `src/policy.ts` | lock 1 (GameIR declares), R5 restrictions bridge |
| Authoritative grant table | `src/registry.ts` | E1 single owner; R20 least privilege |
| The broker authority | `src/broker.ts` | lock 4/13/14; E2 canonical path only |
| TEST-SUPPORT fakes + GrantTable double | `src/fakes.ts` | lock 44 (no hidden mocks) |
| Demo game fixture | `src/demo.ts` | valid GameIR document + coverage |
| Runtime evidence harness | `src/harness.ts` | `node src/harness.ts`, pure check |

## Async/stateful documentation (spec/worker-contract.md)

| Concern | Binding |
| --- | --- |
| Mutable state owner | THE BROKER: grant table, budget ledger, command-id counter. Read models via getters; nobody else writes. |
| Command admission | `evaluate` derives canonical envelopes (`origin: broker-mediated`) only; `admitCommand` at the kernel is still the single gate (E2). |
| Event order | The broker emits no events; budget counters advance in evaluation order per runtime-contracts ledger semantics. |
| Idempotency key | Travels inside the `ActionRequest`; honored by the KERNEL's idempotency table. The broker performs NO request dedup (no second authority) — the budget ledger is its replay protection (E8). |
| Stale-result rule | Grants of a non-current epoch are denied (`grant-epoch-stale`); derived commands carry the evaluation epoch for downstream `applyStaleResultRule`. |
| Replay/resume boundary | Broker state = (options, admitted grants, evaluation sequence, clock readings); identical sequences reproduce identical ledger/ids/resolutions (harness-proven). Restorable via `grants` + `ledger` + `commandIdCounter` seeds. |
| Retry/cancellation | Synchronous pure evaluation; retries re-submit the same key and are deduplicated kernel-side; no async work to cancel. |

## Grant admission (host side only)

Grants are issued by host game policy or the platform (`GrantIssuer`).
Admission refuses, with typed reasons: duplicate ids, malformed grants,
unknown capabilities, host-denied capabilities (R5/R20), and
approval-required capabilities without the explicit host approval marker.
`expiresAfterTick` sweeps are bookkeeping; evaluation denies expired grants
with or without the sweep.

## Determinism (E9)

No IO, no timers, no globals, no randomness: ticks and epochs are inputs,
command ids are a deterministic `cmd-<n>` counter, issue times come from
the injected clock port. Two brokers driven identically are byte-identical
in ledger, ids and resolutions (test + harness evidence).

## Scope discipline (what is deliberately NOT here)

- No second command path, no engine handles, no avatar intelligence.
- Host `sandboxed` restrictions are not consumed here — sandboxing is an
  adapter/host execution concern, not a permission decision.
- No request-level idempotency table (kernel-owned, see above).
