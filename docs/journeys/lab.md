# The Lab Journey (`qa/browser/src/lab-journey.test.ts`)

The Game Engineering Lab workbench surfaces of `@playliquid/gameos-lab`
(PL-034) walked end to end as one user journey over the REAL Lab loop
engines: **the Arena case → `request-search` through the typed command
port → the candidate stream → evaluate → learn/seal cycles → the gap
ladder advanced one rung at a time (with its authoritative typed
refusals) → the guidance surface → the R20 guards → the append-only
command log.**

## What it exercises (real, not mocked)

- **The real workbench store + view models** — `createLabStore` over the
  six surfaces (searches, evidence, learning, guidance, gaps, arena).
- **The real loop stack** (`lab-rig.ts`, the lock-rule-44 TEST-SUPPORT
  rig): `createLabLearningJourney` — lab-organization's search/evaluation
  over the REAL PL-029 compiler/search and the REAL PL-028 simulation
  engine, lab-learning's sealed records/derived signals/guidance — plus
  one arena-integration-runtime escalation case decided and driven to
  `ingested`.
- **The real ports**: a `LabDataPort` whose `load()` re-reads the
  services' read doors (refreshes see the live loop state) and a
  `LabCommandPort` forwarding the typed intents `request-search` and
  `advance-gap-rung` to the authoritative doors — refusal codes come
  back VERBATIM (E8).
- **R18**: the discovered capability gap's trail starts at
  existing-organization and is advanced one rung at a time through the
  frozen ladder; skipping a rung refuses with the authoritative
  `rung-skip` code.
- **E11**: the guidance surface renders the two epistemic classes —
  observed-evidence and labeled-estimate — structurally disjoint (the
  estimate carries its method + content-addressed basis); the evidence
  ledger renders PL-028 results as labeled estimates by type.
- **E10**: the evidence ledger, the gap attempt trail, the Arena
  lifecycle trail (`draft > authorized > sent > responded > ingested`)
  and the command log (where the three typed refusals stay visible)
  only ever append.
- **R20**: a foreign-tenant search cannot be selected (the store's typed
  `cross-tenant` selection refusal) and a foreign tenant cannot advance
  the journey's gap (the authoritative `cross-tenant` refusal through
  the command port).
- **E9**: the whole journey runs twice; the traces are identical.

## What it does NOT exercise (honest scope)

No DOM, no rendering, no browser process, no network, no screenshots
(and no Arena wire — the Arena case is the runtime integration's
deterministic in-memory journey). The `.tsx` panels and the vite mount
are the browser host's concern; `lab-ui.ts` documents why the package
entrypoint itself is not imported here.

## The tests

1. `lab journey (E11)` — the honest browser-environment statement,
   executable.
2. `lab journey: the workbench walk end-to-end over the real Lab engines
   (E5)` — the full walk with per-surface assertions.
3. `lab journey (E9)` — two runs, identical trajectory.
4. `lab journey (E8)` — the gap door refuses with the authoritative codes
   verbatim (`gap-unknown`, the blocked-rung intent shape,
   `invalid-intent`), and the honest advance still succeeds after the
   refusals.
