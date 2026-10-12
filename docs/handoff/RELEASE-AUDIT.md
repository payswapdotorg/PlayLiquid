# PlayLiquid Final Release Audit — PL-045 (Evidence Index)

Executed by the Tech Lead. Audit base: `e823edf` (promotion wave 26) + this audit commit.
This document is the evidence index required by the plan's Task 11 acceptance: every claimed
production capability maps to source + tests + runtime + applicable browser/deployment evidence,
with the exact reproduction commands.

## 1. Exact merged-SHA audit

45/45 Work Orders MERGED (program/graph.json is the machine-readable authority; verified with
`pnpm program:check` → `program check: PASS (45 Work Orders; max 3 workers)`).

44/44 pre-audit records carry a mergedSha contained in `main` (verified with
`git merge-base --is-ancestor <sha> HEAD` for every record). Six early records (PL-005 …
PL-011, from the first program sessions before the record discipline matured) were backfilled
from the program-record commits in this audit: PL-005 `f09b3c5`, PL-006 `b5b6aa4`,
PL-007 `559e7c9`, PL-008 `1da7192`, PL-009 `263eb5c`, PL-011 `c935bc9`.

Governance promotion waves 1-26 (the PL-010 series) promoted the delivery trees to managed
modules with requires edges cross-checked against each tree's actual imports at every wave
(the invariant held 100%: no over- or under-declaration ever survived a station re-verify).

## 2. Reproduction commands

```
pnpm program:check          # program check: PASS (45 Work Orders; max 3 workers)
pnpm program:frontier      # (empty after PL-045 closes)
pnpm architecture:check     # full 5/5/0-new; --changed 4/4/0-new
# every suite (the gate set every Work Order ran):
cd <any package or tree> && npx tsc -p . && node --test "src/**/*.test.ts"
```

## 3. Full-repo test truth (audited in one sweep)

**3226 tests / 3226 pass / 0 fail** across the repo gate set:

- 3139 tests in the `src/**/*.test.ts` suites over 62 src roots (52 PlayLiquid domain packages,
  4 examples — native-game 46, large-world 61, engine-integration 15, lab-journey 19 —
  4 qa trees — browser 15, performance 12, security 48, e2e-lab 42 — services/ops 48,
  deployment 31, and the 52 package suites from arena-integration through tool-fabric-runtime).
- 63 web-package tests: gameos-community 27, gameos-lab 36 (store/view-model suites;
  peer-react host apps carry no node-testable entrypoint — the PL-033/034 mount contract).
- 24 performance sibling-suite tests: runtime-core/perf 13, build-orchestrator/perf 11.

Out-of-scope (recorded for E11 honesty, NOT PlayLiquid surface): `packages/services/test/`
and `packages/ui/test/` are fork-infrastructure tests importing compiled dist artifacts
(`tsc -b` build outputs); they predate the program, no Work Order wrote them, and they are not
part of the gate set.

## 4. Capability → evidence index

| Claimed capability | Source | Tests | Runtime / integration evidence |
|---|---|---|---|
| Interactive runtime kernel (Experience Protocol) | packages/runtime-core | 78 tests | native-game playthrough + qa/performance session-scale/throughput |
| Deterministic simulation | packages/simulation | 55 | large-world headless runs, qa/performance baselines |
| Sealed replay (R8) | packages/replay | suite in src | qa/performance replay throughput; native-game sealed stream + witness match |
| Registry/CAS authority (R19, PL-011) | packages/package-registry, package-system, artifact-store | registry + store suites | every reference example resolves packages through the real doors; deployment verifier re-runs the release gate |
| Build orchestration + targets | packages/build-orchestrator, build-contracts, target-profiles, target-builds | staged-build suites | engine-integration drives the real phase machine; qa/performance build baselines |
| Engine bindings (R12) | packages/engine-playcanvas, engine-unreal, engine-unity, engine-godot | adapter/binding/negative suites | engine-integration adjudication walk + E8 battery; native-game PlayCanvas binding |
| Tool Fabric + Blender (PL-019/025) | packages/tool-fabric, tool-fabric-runtime, tool-blender | 96 + 55 + 48 tests | engine-integration authoring stage over the real pipeline |
| Lab loop (E5 evidence) | packages/lab-contracts, lab-simulation, lab-organization, lab-learning | full suites | examples/lab-journey walk + qa/e2e-lab adversarial suite |
| Arena integration (E6 durability) | packages/arena-integration, arena-integration-runtime | suite + 43 | lab-journey case lifecycle; e2e-lab forged-case refusals |
| Community | packages/community + web/gameos-community | 27 web tests | lab-journey community phase (trust flip, provenance); e2e-lab moved-contributor negatives |
| Platform services (R7) | packages/platform-{contracts,identity,social,leaderboard,achievements,economy,integrity,multiplayer} | per-package suites | native-game platform outcomes; services/ops health gates over the REAL doors |
| Studio UI (E5 view models) | packages/game-ui + web/gameos | 34 game-ui tests | qa/browser studio journey (real stores, no DOM — E11 headers) |
| Rights authority (R20, PL-041) | packages/security-gameos + qa/security | 87 + 48 | deployment R20 lattice checks; e2e-lab cross-tenant doors |
| Economy (R10) + integrity (R11) | platform-economy, platform-integrity | suites | native-game settlement; security-gameos composed verdicts |
| Large-world streaming (R15) | examples/large-world | 61 | qa/performance streaming baselines |
| Reference game (PL-037) | examples/native-game | 46 | qa/browser native journey (R6 spark, R12 binding, platform outcomes) |
| Engine-native workflow (PL-038) | examples/engine-integration | 15 | the canonical workflow walk + E8 battery (this program's proof) |
| Browser journeys (PL-043) | qa/browser | 15 | studio/lab/community/native journeys, E9 run-twice, adapters documented |
| Performance baselines (PL-042) | qa/performance + perf siblings | 12 + 24 | committed honest reports, workload-shape digests, budgets 3-10x |
| Durable operations (E6, PL-044) | services/ops | 48 | crash-anywhere F1-F8 matrix, exactly-once proofs, health gates |
| Deployment truth (PL-044) | deployment + docs/deployment | 31 | verifier over REAL doors, committed manifest re-verified, E11 boundaries |
| Lab/Arena journey (PL-040) | examples/lab-journey + qa/e2e-lab | 19 + 42 | the closed thesis loop + the adversarial suite (this program's proof) |

## 5. Frontier

After this audit's program record closes PL-045, `pnpm program:frontier` reports an empty
frontier — the roadmap is complete.

## 6. Honest boundaries (E11)

- No real engine binaries, no real network, no containers/k8s/secrets: all engines and tools run
  over the adapters' shipped deterministic in-process bridges; deployment is a typed in-process
  model (see docs/deployment).
- Browser journeys run under `node --test` with real stores + view models + service stacks —
  no DOM, no rendering, no browser process (asserted in every journey header).
- The fork-infrastructure packages retain their composite `tsc -b` build pipeline; the audit's
  tsc sweep covers every PlayLiquid-domain tree with exit 0.
