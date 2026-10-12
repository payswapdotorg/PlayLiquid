# PlayLiquid Browser Journeys (PL-043)

The browser-journey suite: COMPLETE USER JOURNEYS over the REAL public
surfaces of the web workbenches and the reference game, run under plain
`node --test` — the same gate discipline as every other module, no
browser required.

## What this suite IS

Four journeys, each walking one surface end to end:

| Journey | Surface | What it walks |
| --- | --- | --- |
| [studio](studio.md) | `@playliquid/game-ui` (PL-033) | the Game Studio: packages + release gate (R19), the session timeline of the real kernel, avatars under a host restriction (R5), capabilities (a DENIED evaluation), tools (a typed executor refusal), a refresh outage + recovery |
| [lab](lab.md) | `@playliquid/gameos-lab` (PL-034) | the Game Engineering Lab: `request-search` through the typed command port, candidate streams, evaluate → learn/seal cycles over the REAL PL-029/PL-030 engines, the gap ladder advanced one rung at a time (R18), observed-vs-estimate guidance (E11), the Arena escalation trail |
| [community](community.md) | `@playliquid/gameos-community` (PL-034) | the Community workbench: contributions with kind filters + trust/origin/AI/gap chips, provenance full chains, `submit-contribution` through the typed command port, the lifecycle ledger, the R18 gap link |
| [native](native.md) | `examples/native-game` (PL-037) | LUMEN RUN's canonical playthrough: the composition + spark planning evidence (R6), the full Experience Protocol, the sealed replay + R11 verdict, every platform service outcome (R9/R10) |

Every journey drives the REAL store + view models + service stacks —
never mocked projections of them. The rigs (qa/browser/src/*-rig.ts) are
the HOST side: they compose real read models from the real sibling
packages and wire REAL data/command ports (typed intents in, typed
receipts and typed refusals out, codes verbatim).

## What this suite is NOT (E11 — browser honesty, stated plainly)

**There is no browser in this gate set.** No DOM, no rendering, no
browser process, no network, no screenshots. The journeys run the exact
pure view-model projections the browser mounts render, under Node's test
runner; the first test of every journey ASSERTS the absence of a DOM
instead of pretending one exists. Anything browser-API-shaped is governed
by the browser-shims discipline of `packages/web/gameos` and is a host
(vite mount) concern — see each journey doc's honest scope statement.

One structural consequence, documented in place
(`src/studio-ui.ts`, `src/lab-ui.ts`, `src/community-ui.ts`): the three
web packages' `index.ts` entrypoints re-export their presentational
`.tsx` component sets, which plain Node refuses to load (Node
type-stripping does not transform JSX). The journeys therefore reach the
Node-loadable public surface (stores, ports, pure view models — every
symbol the entrypoints also export) through those three single-file
adapters, so the deviation is explicit, minimal and auditable.

## How to run it

```sh
cd qa/browser
npx tsc -p .                     # 0 errors
node --test "src/**/*.test.ts"   # all pass, 0 fail
npx oxlint src/                  # 0 warnings, 0 errors
```

From the repo root, the architecture gate:

```sh
node scripts/architecture/architecture-check.mjs check --changed   # OK, 0 new
```

## The vocabulary (cross-reference)

Every journey test names the discipline it asserts:

- **E5 (evidence over claims)** — UI consumes read models projected from
  authoritative packages' public contracts; journeys only walk real
  stores/ports/services, never fabricated data.
- **E8 (typed refusals, never silent)** — failures carry the
  AUTHORITATIVE refusal codes verbatim (rung-skip, not-a-maintainer,
  cross-tenant, executor/adapter-refused, permanent port outages…); the
  suites assert the exact code, never a stringly-typed stand-in.
- **E9 (determinism)** — each journey runs TWICE; the recorded
  trajectories must be identical (same steps, same facts, same sha256
  digest — `journey-kit.ts`).
- **E10 (append-only evidence)** — ledgers, trails, transitions and
  command logs only ever append; duplicates surface as `duplicate:
  true` receipts; nothing is rewritten, reordered or dropped silently.
- **E11 (epistemic honesty)** — no faked browser, no faked estimates:
  observed evidence is structurally disjoint from labeled estimates
  (the lab guidance), and absence renders as typed null states.
- **R20 (tenancy)** — cross-tenant reads/selections/commands are refused
  with typed `cross-tenant` codes, visibly, at every seam the journeys
  touch.

## Module map (qa/browser/src)

- `journey-kit.ts` — the shared evidence helpers: `TraceRecorder`,
  `canonicalJson`, `digestOfValue`, `createTrace`,
  `assertSameTrajectory`.
- `studio-ui.ts` / `lab-ui.ts` / `community-ui.ts` — the three
  Node-surface adapters (documented above).
- `studio-fixtures.ts` + `studio-rig.ts` — the studio host rig.
- `lab-rig.ts` — the lab host rig (real PL-029/PL-030 stack + Arena
  case + real workbench ports).
- `community-rig.ts` — the community host rig (real PL-032 service +
  real workbench ports).
- `studio-journey.test.ts` / `lab-journey.test.ts` /
  `community-journey.test.ts` / `native-journey.test.ts` — the
  journeys.
- `module.ts` + `index.ts` + `contract.ts` — the PL-010 governance
  manifest and public entrypoints.
