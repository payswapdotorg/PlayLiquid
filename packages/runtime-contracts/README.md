# @playliquid/runtime-contracts

Work Order PL-003 — Runtime/Experience Protocol (PlayLiquid GameOS).

The protocol layer between **authoritative runtime state** and **experiences**
(clients, UIs, simulation drivers). Pure TypeScript types and pure functions
only: no IO, no engine SDKs, no client implementation, zero runtime
dependencies.

## Contract areas

| Area | Module | Anchors |
| --- | --- | --- |
| Branded ids/scalars | `src/primitives.ts` | nominal typing of all id spaces |
| GameIR seam (documented) | `src/game-ir-seam.ts` | TODO bind to `@playliquid/game-ir` at graft time |
| Session lifecycle + epochs | `src/session.ts` | R5, mutable-state-owner docs |
| Canonical command path | `src/commands.ts` | E2, lock 13/14 |
| Canonical event path | `src/events.ts` | E2, order oracle, behavior registry |
| Experience Protocol (9 ops) | `src/experience.ts` | lock 12, R6 target profile hook |
| Capability-mediated actions | `src/capability.ts` | lock 4/13/14, budgets |
| Multiplayer authority | `src/multiplayer.ts` | R9, lock 19, E8 |
| Long-running work | `src/jobs.ts` | E6, retry/cancel/resume |
| Idempotency + stale results | `src/idempotency.ts` | worker-contract async docs |
| Replay/resume boundaries | `src/replay.ts` | lock 15, R8 |
| Spark target profile | `src/spark.ts` | R6, lock 16 (profile, not game model) |

Every module's doc comment carries its share of the worker-contract
"Async/stateful work" documentation (mutable state owner, command admission,
event order, idempotency key, stale-result rule, replay/resume boundary,
retry/cancellation semantics).

## Gates

```bash
cd packages/runtime-contracts
npx tsc -p .          # typecheck (typescript 5.9.x; see note below)
node --test "src/*.test.ts"   # 90 tests (see note below)
node src/harness.ts   # pure-check runtime evidence (fake 3-event session)
npx oxlint packages/runtime-contracts   # from repo root
```

Environment notes (recorded honestly; see the Work Order LIMITATIONS):

- Bare `npx tsc` resolves to the deprecated npm `tsc` placeholder package on
  this machine; the real compiler must be resolvable (repository root
  `node_modules` after a TL install, or a local gitignored install).
- Node 24.21's test runner treats `node --test <dir>` arguments as
  files/globs, not searchable directories; `node --test "src/*.test.ts"` is
  the equivalent working form for "all tests under src/".
- `@types/node` is not resolvable without a root install (lockfile is
  TL-owned), so `src/node-ambient.d.ts` provides minimal ambient
  declarations for `node:test`, `node:assert/strict` and `console`;
  tsconfig sets `"types": []` to stay hermetic.

## Import rule

This package imports `game-ir` semantics ONLY through `src/game-ir-seam.ts`
(per spec/module-dependency-matrix.md). The seam mirrors the minimal
structural surface (digests + opaque refs) the frozen spec defines; at graft
time each mirrored symbol is replaced by the real
`@playliquid/game-ir` import and the seam file is deleted.
