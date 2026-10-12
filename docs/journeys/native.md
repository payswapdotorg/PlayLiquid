# The Native Journey (`qa/browser/src/native-journey.test.ts`)

The LUMEN RUN reference game (`examples/native-game`, PL-037) walked
through its CANONICAL PLAYTHROUGH as one user journey: **the composition
→ the full Experience Protocol → the sealed replay + its re-execution
verdict → every platform service outcome.**

## What it exercises (real, not mocked)

- **The real canonical playthrough** (`runCanonicalPlaythrough`, reached
  through the example's public entrypoint — pure TypeScript, no browser
  surface): one deterministic, seeded run of the whole game.
- **The composition**: the GameIR-direct document with its content
  digests, the published package set, the lock fingerprint, and the R6
  spark planning evidence (boot plan / stream schedule / cache-manifest
  digests, the critical-byte budget, the planned first-paint and
  first-interaction budgets).
- **The full Experience Protocol** (load, reset, observe, act, step,
  snapshot, restore, replay, terminate): the eight recorded commands with
  their origins, the committed event stream with the authoritative
  `run.completed` outcome, the terminated session view, and the pure
  textual arena renders (start === boundary, complete === restored — the
  honest headless stand-in, deterministic read models).
- **R8/R11 replay integrity**: the sealed replay's stream and witness
  digests and the re-execution verdict (`match`, confidence 1).
- **R9/R10 platform outcomes**, consumed from the authoritative kernel
  events only: the accepted integrity evaluation (enforcement + report
  id), the leaderboard score, the applied achievement evidence, the
  economy settlement (positive quantity against the integrity verdict)
  and the recorded social follow edge.
- **E9**: the whole journey runs twice; the traces are identical (same
  steps, same facts, same digest — `journey-kit.ts`).

## What it does NOT exercise (honest scope)

No engine render loop, no DOM, no rendering, no browser process, no
network, no screenshots. The playthrough is a deterministic simulation —
the PlayCanvas binding is cited as BUILD data and never executed (the
example's own honest scope statement). The platform services run over
their in-memory test doubles (their contracts are the production
surfaces); the R11 verdict is the replay primitive's own re-execution.

## The tests

1. `native journey (E11)` — the honest environment statement, executable
   (no DOM; the render is plain text).
2. `native journey: the canonical playthrough end-to-end, every
   observable surface factual (E5)` — the full walk with per-surface
   factual assertions.
3. `native journey (E9)` — two runs, identical trajectory and digest.
