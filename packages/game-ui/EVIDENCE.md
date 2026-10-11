# PL-033 Evidence — Game Studio foundation

Work item: **PL-033 Game Studio foundation** (spec/work-items.md)
Surface: `packages/game-ui` + `packages/web/gameos`
Branch: `work/pl-033`

## Deliverables

`packages/game-ui` (workspace module, untested-by-contract host surfaces):

- `src/contract.ts` — the studio contract: `StudioDataSnapshot` (14 frozen
  surfaces), `StudioAction` (tab/select/refresh), `StudioState`, port types,
  and the module descriptor.
- `src/ports.ts` — `StaticStudioDataPort` (frozen-snapshot port) +
  `StudioDataPort` interface (async `load`).
- `src/studio-actions.ts` — action factory + `operationLabel` vocabulary.
- `src/studio-store.ts` — `createStudioStore`: dispatch/refresh/load-error
  (E11) state machine over a `StudioDataPort`; record-operations append log;
  unknown actions are no-ops.
- `src/studio-view.ts` — pure projection `projectStudioState(state)` → the
  five read-only views (packages/session/avatars/broker/tools).
- `src/view/*.ts` — per-surface projections with fail-closed presentation
  (missing gate verdict ⇒ blocked; unknown status ⇒ dimmed chip).
- `src/components/*.tsx` — tokens, primitives, status chips, package cards,
  session panels, avatar cards, broker tables, tools panel (with job
  selection), and `studio-shell` (summary header, 5-tab nav with count pills,
  E11 load-error banner, source-attribution footer).
- `src/app/use-studio-store.ts` — `useSyncExternalStore` binding with a
  WeakMap per-state-identity projection cache (snapshot-stable views, no
  render loops).
- `src/app/studio-app.tsx` — `StudioApp` root component.
- `src/fixtures/demo.ts` — deterministic demo snapshot assembled from the
  REAL sibling packages (package-system, runtime-core, avatars, broker,
  tool-fabric) via their public APIs; manual clocks, fixed seeds, scripted
  refusal.
- `src/fakes.ts` — `ScriptedStudioDataPort` (sequenced responses incl.
  failures) for store tests.
- `src/harness.ts` — 19-step deterministic harness (real demo snapshot,
  initial state, tab/selection transitions, record-operations append,
  refresh success/failure, projection determinism, status vocabulary,
  unknown-action no-op); JSON output, exit 1 on failure.
- `src/studio-actions.test.ts` / `src/studio-store.test.ts` /
  `src/studio-view.test.ts` — 34 unit tests (actions/store/views).
- `src/index.ts` — public entrypoint re-exporting ports/store/actions/views/
  components/app/fakes/demo.
- `src/module.ts` — module descriptor for the workspace registry.

`packages/web/gameos` (host preview mount, NOT a modification of the web
app's own config):

- `index.html` + `main.tsx` — host composition: `demoStudioSnapshot()` (async)
  → `StaticStudioDataPort` → `createStudioStore` → `createRoot`
  (StrictMode + `StudioApp`); mount failure renders the E11 banner.
- `browser-shims/node-crypto.ts` — REAL sha256 (FIPS 180-4) subset shim for
  `node:crypto.createHash("sha256")`: the demo snapshot graph transitively
  imports Node crypto (game-ir digests, package-system content digests,
  runtime-core fakes, tool-fabric artifact exchange) and Vite externalizes
  node builtins in the browser. Byte-compatible with Node's crypto (proof
  below); anything beyond the used surface throws loudly.
- `browser-shims/node-child-process.ts` — import-binding-only shim
  (`tool-fabric-runtime`'s entry re-exports its Node process executor);
  calling `spawn` throws — process execution is never silently faked.
- `vite.config.ts` — dedicated config (root=gameos, port 5174, strictPort)
  aliasing the two node builtins to the shims; `packages/web/vite.config.ts`
  untouched.
- `preview/studio-0*.png` — six local screenshot artifacts (not committed;
  the repo has never tracked images — evidence below is the DOM/eval text).

## Gate outputs (all run from `packages/game-ui`)

Type check:

```
$ node ../../node_modules/typescript/bin/tsc -p . --noEmit
(no output; exit 0)
```

Unit tests:

```
$ node --test src/*.test.ts
ℹ tests 34
ℹ pass 34
ℹ fail 0
```

Deterministic harness:

```
$ node src/harness.ts   # JSON; exit 0
{ "harness": ..., "ok": true, "steps": [19 steps], "failures": [] }
ok: true | steps: 19 | failures: 0
  - snapshot-real-sibling-data => frozen:5-surfaces-populated
  - snapshot-surfaces-counted => packages=2,avatars=1,tools=2,jobs=3
  - initial-state => tab=packages,pkg=null,ops=7,error=null
```

Lint:

```
$ ../../node_modules/.bin/oxlint
Found 0 warnings and 0 errors.
Finished in 13ms on 30 files using 2 threads.
```

Architecture check (repo root):

```
$ node scripts/architecture/architecture-check.mjs check --changed
architecture: OK
violations: 4
baseline: 4
new: 0
```

(The 4 violations are pre-existing baseline entries; game-ui follows the
PL-018 precedent of workspace modules not yet registered as managed modules.)

## Browser evidence (Vite dev server, port 5174)

Server:

```
$ cd packages/web && node ../../node_modules/vite/bin/vite.js --config gameos/vite.config.ts
VITE v8.0.8  ready in 409 ms  →  http://localhost:5174/
curl: index:200 main:200 shim:200 gameui:200
```

agent-browser (headless) verification of the mounted app:

- Page title: `PlayLiquid · GameOS Studio`; boot placeholder gone.
- Header: `PlayLiquid · Game Studio` +
  `Game Studio · running · 1 gate-blocked · 1 active tool job` +
  `Refresh snapshot` button.
- `tabs: 5` (Packages / Session / Avatars / Capabilities / Tools), each tab
  visited and rendering its surface:
  - Packages: 2 cards (asset.demo-kit `gate blocked` — license-unverified
    R19 fail-closed note; game.demo-arena `gate passed`), digests, lineage,
    lock pins.
  - Session: runtime session `studio-demo-session · running · epoch 1 ·
    tick 3 · last: replay replayed`, 6 committed events / 2 admitted
    commands, latest observation table.
  - Avatars: R5 alert `host-denied capabilities (R5): audio`, demo-avatar
    card with body/sensors/actuators/memory sub-record table.
  - Capabilities: 4-capability table, host restrictions (2 active, R5),
    active grants table.
  - Tools: 2 registrations, 3 jobs (1 active, durable E6), job row
    selection filters the event table.
- `tables: 3` on the tools surface; footer attribution:
  `Read-only projection of authoritative systems · packages PL-011 ·
  session PL-013 · avatars PL-026 · broker PL-026 · tools PL-019`.
- `Refresh snapshot` clicked → header intact, no E11 banner.
- Page errors: none (`agent-browser errors` empty). Console: only Vite
  connect + React DevTools info lines.
- Responsive shell + sticky footer verified in the screenshots
  (`preview/studio-01..06-*.png`).

## Shim honesty proof (lock rule 44 — no fabricated data)

The browser mount computes the demo snapshot in-page, so its sha256 digests
come from `browser-shims/node-crypto.ts`. Node-side (real `node:crypto`,
via the same `demoStudioSnapshot()`):

```
node asset.demo-kit digest:  sha256:7ad448a1f59f
node game.demo-arena digest: sha256:494bbf35abc8
```

Browser-side (DOM, rendered card): `sha256:7ad448a1f59f` — identical to
Node's crypto on the same inputs. The shim is a real FIPS 180-4
implementation, not an invented value; `spawn` in the child-process shim
throws if ever called (the demo never spawns).

## Fix applied during browser verification

`src/view/package-view.ts` `shortDigest()` double-prefixed digests
(`sha256:sha256:7ad44…`) because package-system stores content digests with
the algorithm prefix. It now strips a leading `sha256:` before slicing;
single-prefix short digests confirmed in the DOM. No test pinned the old
format; all gates re-run green after the change.
