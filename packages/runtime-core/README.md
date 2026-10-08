# @playliquid/runtime-core

Work Order PL-013 — Interactive Runtime core (PlayLiquid GameOS).

The **interactive runtime session kernel**: the Experience Protocol surface
(load, reset, observe, act, step, snapshot, restore, replay seam, terminate)
implemented over `@playliquid/runtime-contracts` as the single canonical
command/event path (E2, lock rule 12), with the CapabilityPort seam to the
Capability Broker (lock rule 4 — the broker itself is Work Order PL-026 and
is deliberately NOT implemented here), injected host-side ports, and
in-memory test-support fakes. Pure kernel logic: no IO, no timers, no
engine SDKs, no real rendering/input/networking — those are host adapters.

Imports `@playliquid/runtime-contracts` only, per
`spec/module-dependency-matrix.md` (runtime-core | runtime-contracts,
capability-broker — the latter reached through the seam below).

## Module map

| Area | Module | Anchors |
| --- | --- | --- |
| Role-guarded factory + options | `src/construction.ts` | lock 12 (interactive vs simulation) |
| Kernel orchestrator | `src/kernel.ts` | E1 single owner: phases/epoch/tick/world |
| Canonical event journal | `src/journal.ts` | E2 event path, E10 append-only, deterministic ids |
| `act` pipeline + idempotency | `src/command-path.ts` | E2 command path, E8 anti-gaming |
| Snapshot boundaries | `src/snapshots.ts` | E9 byte-stable, content-addressed |
| Kernel event kinds | `src/event-kinds.ts` | epoch boundary markers |
| Canonical serialization | `src/serialize.ts` | E9 byte-stable codec (safe-integer domain) |
| WorldDriver seam | `src/world.ts` | game simulation plug point (no game semantics here) |
| Host-side ports | `src/ports.ts` | renderer/input/transport/store/clock, all injected |
| CapabilityPort seam | `src/capability-port.ts` | lock 4/14; broker is PL-026 |
| Typed results | `src/results.ts` | all epoch-tagged (stale-result rule) |
| Epoch-segmented log view | `src/logview.ts` | contract order oracle, per segment |
| TEST-SUPPORT fakes + reference driver | `src/fakes.ts` | no hidden mocks-as-production (lock 44) |
| Runtime evidence harness | `src/harness.ts` | `node src/harness.ts`, pure check |

## Async/stateful documentation (spec/worker-contract.md)

| Concern | Binding |
| --- | --- |
| Mutable state owner | THE KERNEL (+ owned collaborators). Experiences get read models only. |
| Command admission | `admitExperienceOperation` (contracts) → CapabilityPort for avatar-agents (lock 14) → `admitCommand` (contracts) — one gate. |
| Event order | 1-based, gapless, globally append-only; per-epoch segments validated by `validateEventStream`. |
| Idempotency key | `{scope:"command", actor, nonce}`; intent fingerprint pre-check BEFORE broker consultation; duplicates return the first receipt; collisions refused (E8). |
| Stale-result rule | Every result carries its epoch (`applyStaleResultRule`); grants from older epochs are broker-denied. |
| Replay/resume boundary | Replay starts at seq 1 or `snapshot.afterEventSeq + 1` only (`validateReplayPlan`); returns RECORDED events (re-simulation is PL-014). |
| Retry/cancellation | Synchronous ops; retries re-submit the same nonce; no async work is retained in the kernel. |

## Determinism (E9)

Fixed-tick stepping, deterministic event ids (`<sessionId>#e<seq>`),
seeded driver worlds, and a canonical byte-stable snapshot codec whose
value domain is JSON-safe safe-integers (floats/unsafe integers are
rejected — no platform formatting ambiguity). Identical driving of two
independently constructed kernels yields identical event log bytes and
identical snapshot digests (tested + harness-proven).

## Act origins (frozen contract compliance)

Per `@playliquid/runtime-contracts` commands.ts, command origin must match
actor class: avatar-agents act ONLY through broker grants
(`resolveActionRequest` → `broker-mediated` origin); players submit
`player-input` commands derived from their intents by the kernel;
platform-system/host-authority actors use their matching origins. All
origins converge on the SAME admission gate and event path (E2).

## Fakes are test support

`src/fakes.ts` ships in-memory fakes (clock, renderer, input, transport,
volatile content-addressed store with REAL sha-256 digests) plus a
deterministic reference `CounterWorldDriver`. They are explicitly NOT
production adapters (lock rule 44). `GrantTableCapabilityPort` implements
the PL-026 seam by delegating to the contracts' own pure evaluator over
caller-owned grant/ledger read models — no second permission authority.

## Gates

```bash
cd packages/runtime-core
../../node_modules/.bin/tsc -p .                    # 0 errors
node --test src/**/*.test.ts                        # 86 tests / 86 pass
../../node_modules/.bin/oxlint .                    # 0 warnings, 0 errors
node src/harness.ts                                 # ok: true (byte-stable)
node scripts/architecture/architecture-check.mjs check --changed   # from repo root
```

## Environment limitations

- No real renderer, device input, network transport, or durable snapshot
  storage is shipped — those are host adapters for later work orders.
- The Capability Broker is PL-026; only the port seam exists here.
- Deterministic re-simulation (replay of inputs into fresh worlds) is the
  Simulation Runtime, PL-014; this kernel provides validated log access.
- The world model is the JSON-safe safe-integer domain; fractional game
  values must be encoded as scaled integers or strings by drivers.
