# @playliquid/platform-multiplayer

Work Order PL-016 — Multiplayer authority service (PlayLiquid GameOS).

The server-side BINDING of platform multiplayer policy
(`@playliquid/platform-contracts`, PL-004) with the runtime session
authority machinery (`@playliquid/runtime-contracts`, PL-003), per
spec/module-dependency-matrix.md row
`multiplayer | Platform | platform-contracts, runtime-contracts` and
spec/architecture.md §Multiplayer: *"Client sends input/intent. Server
validates/simulates and emits state/events."*

Pure domain: no IO, no network, no timers — every effect lives behind an
injected port. Zero runtime dependencies beyond the two workspace
contract packages.

## Contract areas

| Area | Module | Anchors |
| --- | --- | --- |
| Pure SHA-256 + canonical JSON | `src/digest.ts` | E9 byte-stability, content digests |
| Frozen topology + rules | `src/topology.ts` | lock 19, `validateCapabilityPolicy` binding |
| Ports (simulator/transport/store/clock/scheduler) | `src/ports.ts` | ports-everywhere, simulator seam (NOT an engine) |
| Typed intent admission | `src/intents.ts` | lock 13, schema + policy + consistency + planning |
| Platform admission binding | `src/admission.ts` | `decideAdmission`, R20 tenant isolation |
| Protected-outcome enforcement | `src/outcomes.ts` | R9, locks 19/41, E8 refusals, authority build |
| Byte-stable snapshots | `src/snapshot.ts` | E9, R8 replay boundaries |
| Document build/adopt | `src/document.ts` | state <-> document translation |
| Pure effect admission | `src/effects.ts` | binding + topology + causal-command gates |
| Kernel contracts + state shape | `src/kernel-types.ts` | E1 owner shape, typed results |
| Kernel shared helpers | `src/kernel-ops.ts` | emit/transition/refusal internals |
| Session operations | `src/kernel-session.ts` | open, admission, intents, fixed ticks |
| Settlement operations | `src/kernel-settlement.ts` | claims, outcomes, snapshot/restore/replay, terminate |
| Authority session kernel (façade) | `src/kernel.ts` | the class, single mutable-state owner |
| Deterministic fakes | `src/fakes.ts` | test/harness doubles for all five ports |

## The authority flow

```
client intent ──▶ submitIntent ──▶ schema ──▶ policy (intent rule ∩ topology)
                                     │
                                     ▼
                     origin/actor consistency ──▶ idempotency classify
                                     │              (duplicate | collision)
                                     ▼
                     admitCommand  (runtime-contracts canonical gate:
                                    epoch freshness, phase, broker mediation)
                                     │
                                     ▼
                     pending queue ──▶ advanceTicks (fixed-tick, seeded)
                                     │
                                     ▼
                     AuthoritySimulator.step  (the pure seam the app wires)
                                     │
                                     ▼
                     effect admission (binding ∩ topology; P2P refuses
                     protected kinds) ──▶ committed RuntimeEventEnvelope
                                     │        (validated by validateEventStream)
                                     ▼
                     transport.deliver(events)  +  scheduler.nextTickDue
```

Protected outcomes (reward, inventory, damage, standing, score) are
decided ONLY by `decideOutcome` (platform-system origin) or competitive
termination, always from committed event evidence, producing BOTH the
runtime-contracts `AuthoritativeMatchOutcome` and the platform-contracts
`PlatformOutcomeRecord`. Client claims (`ClientSubmittedClaim`,
`ClientPlayResultClaim`) always receive typed refusals plus lossy
advisory records — never events, never outcomes.

## Gates

```bash
cd packages/platform-multiplayer
../../node_modules/.bin/tsc -p .        # typecheck — 0 errors
node --test "src/**/*.test.ts"          # tests
../../node_modules/.bin/oxlint .        # lint — 0 errors
node src/harness.ts                     # pure-check runtime evidence
cd ../.. && node scripts/architecture/architecture-check.mjs check --changed
```

Node >= 24 (type stripping; `.ts` import extensions, never `.js`).

## Import rule

This package imports ONLY `@playliquid/platform-contracts` and
`@playliquid/runtime-contracts` (its frozen matrix row). GameIR semantics
arrive transitively through those packages' exported shapes; nothing
imports engine SDKs, node builtins or IO.
