# @playliquid/avatar-runtime

Work Order PL-026 — Avatar Runtime (PlayLiquid GameOS).

**Avatar = Body + Intelligence** (spec/architecture.md §Avatar). This
package composes avatar definitions whose **body / sensors / actuators /
memory / intelligence are separately versioned sub-records**, drives the
avatar's **sensor input** and **actuator output** ports, and routes **every
action through the Capability Broker** (sibling package
`@playliquid/capability-broker`, lock rule 4) so avatar-agent intents
become **broker-mediated canonical commands** per
`@playliquid/runtime-contracts` (lock rules 13/14). It deliberately builds
**no second kernel**: the interactive and simulation runtimes (PL-013 /
PL-014) host execution; this package provides the pure seams and the
driver.

Skills are **referenced as packages** (`AvatarPackageRef`) — there is no
skill engine here, and model selection stays under the ZCode AI runtime
(lock rule 5). Host restriction of avatar capabilities follows the frozen
game-contracts R5 vocabulary (`HostRestriction`,
`Sensor`/`ActuatorCapabilityId`); runtime action authority is broker grants
(R20 least privilege).

Imports per `spec/module-dependency-matrix.md`: `game-ir`,
`capability-broker`, `runtime-contracts` (declared), plus
`game-contracts` declared directly for the frozen R5 avatar capability
vocabulary (a deliberate, reported addition — the vocabulary lives there).

## Module map

| Area | Module | Anchors |
| --- | --- | --- |
| Sub-record definition types | `src/definition.ts` | separately versioned sub-records; skills as packages |
| Composition + R5 projection + digest | `src/composition.ts` | game-ir canonical hashing (E9); fail-closed validation |
| Ports (pure seams) | `src/ports.ts` | sensor input / memory / intelligence / actuator output / broker |
| The driver | `src/runtime.ts` | lock 13/14: every action broker-mediated |
| TEST-SUPPORT fakes + demo avatar | `src/fakes.ts` | untrusted-brain double (lock 44) |
| Runtime evidence harness | `src/harness.ts` | `node src/harness.ts`, drives the real broker |

## The two gates (never overlapping authorities)

| Gate | Question | Owner |
| --- | --- | --- |
| Composition gate | What does the body physically HAVE? | `composeAvatar` + `effectiveCapabilities` (R5 projection, pure structure) |
| Runtime gate | What may the avatar DO now? | the Capability Broker (grants, budgets, epochs, ticks — R20) |

Per cycle: sensor samples on restriction-denied channels are dropped
before memory; intent claims are checked for provenance (the untrusted
brain cannot forge another actor), for a restriction-surviving actuator
serving the intent kind (a body without `speech` cannot speak), and then
evaluated by the broker. Granted resolutions — and only those — are
emitted to the actuator output as canonical commands, which must still
pass the hosting kernel's `admitCommand` gate (E2).

## Async/stateful documentation (spec/worker-contract.md)

| Concern | Binding |
| --- | --- |
| Mutable state owner | The avatar runtime owns ONLY its request-id counter + cycle reports. Ports own their state; the broker owns grants/budgets; the host kernel owns session state. |
| Command admission | Emitted commands are canonical envelopes; `admitCommand` in the hosting kernel remains the single gate (E2). |
| Event order | One cycle = poll → filter → remember → decide → act; commands reach the actuator port in claim order. |
| Idempotency key | Claim nonces become `{scope:"action", actor, nonce}` per runtime-contracts; dedup is kernel-owned after admission. |
| Stale-result rule | The cycle's epoch travels into every broker evaluation; stale-epoch grants are broker-denied (`grant-epoch-stale`). |
| Replay/resume boundary | A cycle is a pure function of (definition, restriction, port states, broker state, epoch, tick); deterministic request ids keep replays reproducible (harness-proven). |
| Retry/cancellation | Synchronous; retried claims reuse their nonce and are deduplicated kernel-side; no async work is retained. |

## Determinism (E9)

No IO, no timers, no randomness: the definition digest is computed through
game-ir's canonical value forms (`hashGameIRValue`), request ids are a
deterministic `req-<n>` counter, and identically-wired avatar+broker pairs
produce identical emitted commands and reports (test + harness evidence).

## Scope discipline (deliberately NOT here)

- No skill engine, no model routing, no brain implementation (ports only).
- No world/simulation semantics (WorldDriver is runtime-core's seam).
- No command admission (kernel-owned), no grant issuance (host-side).
- No second capability vocabulary (game-contracts' frozen R5 ids only).
