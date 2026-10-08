# @playliquid/lab-contracts

Work Order PL-006 — Game Engineering Lab contracts (PlayLiquid GameOS).

The typed contract layer of the Game Engineering Lab: what the Lab's later
components program against. The Lab itself — simulation, organization
search, learning — arrives in PL-028 (`lab-simulation`), PL-029
(`lab-organization`) and PL-030 (`lab-learning`); Arena wire integration
arrives in PL-007 (`arena-integration`). Pure TypeScript types and pure
functions only: no IO, no simulation engine, no search algorithms, no
Arena SDK, no provider types. Ports are defined here and consumed there;
in-memory fakes for the ports live in `src/fixtures.ts` (test/harness
infrastructure, not public surface).

The only dependencies are the workspace siblings
`@playliquid/game-contracts` and `@playliquid/game-ir`
(spec/module-dependency-matrix.md: lab-contracts | Lab | game-contracts,
game-ir).

## Contract areas

| Area | Module | Anchors |
| --- | --- | --- |
| Branded primitives, seal helper | `src/primitives.ts` | nominal ids, caller-supplied time, E10 sealing |
| External-authority seams | `src/seams.ts` | lock 5 ZCode model routing, Agent Bodies, Tool Fabric tools |
| Organization model | `src/organization.ts` | R16, lock 25/26 — agents, roles, bodies, tools, capabilities, topology, memory, humans, budget, scheduling, review; generalist baseline |
| Organization validator | `src/organization-validation.ts` | typed violation codes across every dimension |
| Epistemic labeling | `src/estimates.ts` | E11, lock 28/29 — labeled estimates disjoint from observed evidence |
| Evaluation-suite seam | `src/evaluation-suites.ts` | game-ir suites, kernel `ValueShape` metrics, resolver port |
| Lab evaluation contracts | `src/evaluation.ts` | candidate-evaluation record, evaluator port (E11 in the signature) |
| Evidence immutability | `src/evidence.ts` | E10, lock 27 — immutable evidence/observations, append-only calibration |
| Capability-gap ladder | `src/gap-ladder.ts` | R18, lock 30/31/32 — frozen rung order, stepwise advance, provider-neutral Arena ref |
| Lab loop stages | `src/loop.ts` | R16/R17 — stage vocabulary, typed links, append-only stage walk |
| Lab loop linkage validation | `src/loop-validation.ts` | cross-ledger link resolution, canonical order |

## Lock-rule enforcement summary

- **Lock 5** (ZCode is the model/provider authority): model assignments
  are opaque `ZCodeModelAssignmentRef`s carrying the
  `zcode-model-routing` authority marker; the package contains no model
  or provider vocabulary at all (house test scans every non-test source
  against a deny-list).
- **Lock 25 / 26** (contextual, evidence-driven search; mandatory
  generalist baseline): every `OrganizationSearchStageRecord` carries a
  mandatory `baseline: OrganizationId` field (the always-available
  generalist) and a typed `OrganizationSearchContext` (game, phase,
  genre, engine, target, deadline, task difficulty);
  `generalistBaselineOrganization` is the canonical constructor and
  validates clean.
- **Lock 27 / E10** (historical observations are immutable): evidence and
  observations are validated, deep-frozen and appended to copy-on-write
  ledgers; duplicate ids are refused (`duplicate-evidence-id`,
  `duplicate-observation-id`); calibration conclusions are appended and
  cite existing observations by id (`unknown-observation-reference`);
  the observations array is carried over as the SAME frozen reference.
  There is no update/revise/rewrite export (house test).
- **Lock 28/29 / E11** (counterfactuals and simulator output are labeled
  estimates, never ground truth): `LabeledEstimate` /
  `SimulatorOutput` / `Counterfactual` carry the `"labeled-estimate"`
  marker; observed records carry the disjoint `"observed-evidence"`
  marker; `@ts-expect-error` type tests prove neither can masquerade as
  the other in either direction, and the `OrganizationEvaluator` port's
  return type has no slot for observations at all.
- **Lock 30 / R18** (explicit, auditable capability gaps): every
  `CapabilityGapRecord` has an id, cycle link, missing capability and
  an append-only rung-attempt trail.
- **Lock 31** (human contribution optional): the community rung may
  carry an explicit `declined` disposition — optional rungs are
  declinable, never silently skippable; `HumanParticipationPlan` modes
  `optional`/`required` are validated against declared participants.
- **Lock 32** (Arena escalation is external): Arena appears only as the
  provider-neutral `ArenaEscalationRef` (external marker + opaque id +
  content-addressed request digest); an actual Arena attempt requires
  it; Arena is reachable only after the community rung
  (`arena-first-resort` refusal otherwise) and `blocked` is terminal.

## Gates

```bash
cd packages/lab-contracts
../../node_modules/.bin/tsc -p .      # typecheck — 0 errors
node --test src/**/*.test.ts          # tests (74 at time of writing)
../../node_modules/.bin/oxlint .      # lint — 0 warnings/errors
node src/harness.ts                   # pure-check runtime evidence
cd ../.. && node scripts/architecture/architecture-check.mjs check --changed
```

Environment notes (recorded honestly):

- Node 24.21's test runner accepts the `src/**/*.test.ts` glob directly
  (Node >= 21 glob support); the same environment quirk documented by
  PL-003/PL-004 (`node --test <dir>` treated as a file) does not affect
  the glob form used here.
- `tsc -p .` compiles `src` with `emitDeclarationOnly` into `dist/`
  (gitignored), exactly like the sibling contract packages.

## Import rule

This package imports `@playliquid/game-contracts` and `@playliquid/game-ir`
directly through the pnpm workspace link (`workspace:*` dependencies) —
including the kernel value system (`GameIRValue`, `ValueShape`,
`valueMatchesShape`) for evaluation-suite metric readings. It does NOT
import `package-system`, `runtime-contracts`, or any engine/provider SDK:
Agent Body and Tool Fabric references are digest-pinned opaque seams
(`src/seams.ts`) bound at implementation graft time (PL-029), mirroring
the documented-seam precedent of `runtime-contracts/src/game-ir-seam.ts`.

## Fixtures and fakes

`src/fixtures.ts` builds every digest by fragment assembly (character-run
arithmetic over a seed string) — no credential-shaped literal strings
anywhere in the package (house test enforces it). The in-memory fakes
(`fakeSuiteResolver`, `fakeOrganizationEvaluator`) implement the package's
ports deterministically and return labeled estimates like any honest
simulator must (lock 29).
