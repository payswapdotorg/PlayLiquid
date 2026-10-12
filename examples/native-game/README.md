# examples/native-game — the Native GameOS reference game (PL-037)

The demonstration that **GameOS-native projects use GameIR directly**
(spec/architecture.md §Engine strategy): a small but REAL game —
**Lumen Run** — expressed as a versioned composition of packages + target
profiles + runtime policy over the GameIR value forms, with NO engine
envelope (that is PL-038's path).

## What this example is

- **Game composition** (§Game model): a GameIR document (world / assets /
  avatars content in the GameIR value language) + immutable packages
  published through `@playliquid/package-registry` with CAS-backed
  content digests (`@playliquid/artifact-store`) + a package lock pinning
  exact versions/digests (lock rule 10) + provenance/licensing evidence
  that must pass the release gate (R19) before anything else happens.
- **Target profiles** (R6/R12): the sealed spark profile record
  (9:16 portrait mobile-first) planned through `@playliquid/runtime-spark`
  (boot plan + stream schedule + cache manifest digests) and driven
  through `@playliquid/spark` over the REAL build-orchestrator staged
  pipeline; the web target composed with the PlayCanvas engine binding
  (`@playliquid/engine-playcanvas`) as the Build-input binding.
- **Runtime** (§Runtime): the interactive kernel of `@playliquid/runtime-core`
  driven through the FULL Experience Protocol — load, reset, observe, act,
  step, snapshot, restore, replay, terminate — seeded and deterministic
  (E9). The game's simulation logic is a real `WorldDriver`.
- **Platform services** (R7): the game DECLARES its events/policies
  (GameIR capability-declaration nodes) and consumes identity, social,
  leaderboard, achievements, economy and integrity through their public
  contracts only — never a duplicate authority. Rewards settle through
  platform entitlements (R10); competitive outcomes are authoritative
  server-side state (R9); the playthrough records probabilistic
  competitive-integrity evidence (R11) over its own sealed replay
  command stream.

## Honest scope statement

The services run over their **deterministic in-memory fakes/ports**
(stores, clocks, grant directories, build fabric, CAS persistence) —
clearly-labeled test doubles from the platform packages themselves. No
real network, database or CDN is involved; nothing here claims production
deployment. The game is headless: `src/view.ts` renders a textual/
structural view model, not a web UI.

## Gates

```bash
cd examples/native-game
../../node_modules/.bin/tsc -p .          # typecheck
node --test "src/**/*.test.ts"            # deterministic test suite
../../node_modules/.bin/oxlint .           # lint
node src/harness.ts                        # runtime evidence harness
```

The harness runs the scripted playthrough end to end and prints the
evidence trail; it exits non-zero if any stage fails.
