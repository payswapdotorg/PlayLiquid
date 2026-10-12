# qa/performance — committed baseline reports (PL-042)

One machine's honest wall-clock measurements of the cross-system scale
suite (regenerate with `node run-baselines.ts` from qa/performance). The
workload SHAPE digests prove the workloads are deterministic; the timings
are machine-dependent evidence, and the ENFORCED BUDGET (from
`src/budgets.ts`, the single source of truth) is the contract every test
asserts. No extrapolated claims: each metric names exactly what ran.

## simulation

- **Environment**: v24.21.0, linux x64, 2 cpus (Intel(R) Xeon(R) Processor), 4042MB RAM
- **Workload**: PL-014 Simulation Runtime: 500 sessions x (create + seeded load + 20 steps) + one deep 10,000-tick session, over the demo binding with fixed clocks.
- **Workload shape digest**: `b32dc301a2965985be4ee07b194f6e4ee27a83296aaea3190f1643829665abca`
- **Determinism repeat digest**: `a1e3dea47a4731431ff817d980706bd59d3f53f76650089ad53f9e8e94c03b35`

| metric | scale | measured | budget | within |
| --- | --- | --- | --- | --- |
| simulation.sessionScale | 500 sessions x (create + seeded load + 20 steps) | 92.58 ms | 1500 ms | yes |
| simulation.sessionHeap | heapUsed delta across the 500-session workload | 3.5 MB | 64 MB | yes |
| simulation.deepSteps | one seeded session, 10,000 fixed ticks | 88.85 ms | 1200 ms | yes |

## replay

- **Environment**: v24.21.0, linux x64, 2 cpus (Intel(R) Xeon(R) Processor), 4042MB RAM
- **Workload**: PL-014 replay command streams: 50 artifacts x 200 recorded broker-mediated move commands sealed and verified; 1,000 tampered-digest verifications (typed refusals).
- **Workload shape digest**: `00faf989ebca13bc8747923f8acb0241404659cb780cb8660ed45a40cc6db37f`
- **Determinism repeat digest**: `sha256:07380365bfa9db3a97f7fbe7274c69f9823a1302ef0a6fa83b46241c03e0dcdf`

| metric | scale | measured | budget | within |
| --- | --- | --- | --- | --- |
| replay.sealArtifacts | 50 artifacts x 200 commands (10,000 commands) | 298.25 ms | 2500 ms | yes |
| replay.verifyArtifacts | 50 artifacts x 200 commands (10,000 commands) | 234.64 ms | 2500 ms | yes |
| replay.tamperedVerify | 1000 verifications of a tampered artifact digest | 438.51 ms | 2000 ms | yes |

## large-world

- **Environment**: v24.21.0, linux x64, 2 cpus (Intel(R) Xeon(R) Processor), 4042MB RAM
- **Workload**: PL-039 LATTICE: one full world composition (87 packages through registry/CAS), a 240-tick moving-viewpoint streaming schedule, and wanted-set derivation at 4 radii x 289 positions.
- **Workload shape digest**: `34c3253a2af27d05da6c6013ba7b21171274731c71d165fab91de2aa92a89613`
- **Determinism repeat digest**: `85d642716139ca82bb78c4173507e8a3bd09fccf655d9c277367683d134524b4`

| metric | scale | measured | budget | within |
| --- | --- | --- | --- | --- |
| largeWorld.composition | one full world composition (87 packages through registry/CAS) | 52.26 ms | 800 ms | yes |
| largeWorld.streamingSchedule | 240-tick deterministic viewpoint tour over 64 chunks | 30.03 ms | 500 ms | yes |
| largeWorld.wantedSetScan | 4 radii (8/24/48/96) x 289 viewpoint positions | 6.03 ms | 150 ms | yes |

## engine

- **Environment**: v24.21.0, linux x64, 2 cpus (Intel(R) Xeon(R) Processor), 4042MB RAM
- **Workload**: PL-021 PlayCanvas adapter: 2,000 typed engine-binding constructions and a 2,000-command inspect/modify plan applied through the deterministic fake bridge (E11 test host).
- **Workload shape digest**: `84799eaaa6c87b68054f3989ec50605f9f45a59844c437ae6b8178e44c318791`
- **Determinism repeat digest**: `ef68c9a77ca5bd95872c7aa042c3d2b1e1d07386cbe2797f3cb29dea31d41fe5`

| metric | scale | measured | budget | within |
| --- | --- | --- | --- | --- |
| engine.bindingConstruction | 2000 typed engine-binding constructions + projections | 15.74 ms | 200 ms | yes |
| engine.planApplication | 2000 adapter command dispatches (inspect/modify plan) | 112.63 ms | 1500 ms | yes |

## Honesty notes (E11)

- Timings are wall-clock on the generating machine (`performance.now()`);
  heap figures are `process.memoryUsage()` deltas without forced GC.
- The build-orchestrator-style tool execution is NOT measured here: the
  engine suite runs over the deterministic in-memory fake bridge (the
  labeled test host), so it bounds the adapter/orchestration cost only.
- Budgets live in `src/budgets.ts` (~3-10x observed, rounded): they exist
  to catch order-of-magnitude regressions, never percentage points.
