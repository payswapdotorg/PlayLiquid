# The Studio Journey (`qa/browser/src/studio-journey.test.ts`)

The Game Studio surfaces of `@playliquid/game-ui` (PL-033) walked end to
end as one user journey: **open the studio → browse packages → select a
package → read the session timeline → avatars → capabilities → tools →
a refresh outage → recovery → clear the selection.**

## What it exercises (real, not mocked)

- **The real store + view models** — `createStudioStore` over the pure
  reducer/projections the browser mounts render (E5); a
  `ScriptedStudioDataPort` drives the refresh outage + recovery cycle.
- **A host-composed snapshot** (`studio-fixtures.ts` + `studio-rig.ts`,
  the lock-rule-44 TEST-SUPPORT rig): two sealed package records with
  release-gate verdicts + a lockfile (`@playliquid/package-system`), a
  live interactive kernel session driven through public operations
  (`@playliquid/runtime-core`: load → player act → avatar act via grant →
  step → observe → snapshot → replay), a real broker with a seeded grant
  and one DENIED evaluation (`@playliquid/capability-broker`), the demo
  avatar under a host restriction (`@playliquid/avatar-runtime`, R5) and a
  tool-fabric runtime with two jobs — one succeeded, one scriptedly
  refused (`@playliquid/tool-fabric-runtime` over game-ui's labeled
  TEST-SUPPORT adapter).
- **R19**: the DECLARED-only license row renders gate-BLOCKED with its
  typed reasons.
- **E8**: the denied broker evaluation renders as an error state; the
  refused tool job renders as `failed` with the executor's typed code; a
  permanent port failure keeps failing typed across repeated refreshes —
  no hidden retries, and the last good read model keeps rendering.
- **E10**: the session timeline only ever appends across the outage and
  the recovery (recovery appends the refreshed snapshot's operations);
  the tool job event timeline is populated.
- **E9**: the whole journey runs twice; the traces are identical
  (asserted step by step and by digest).
- **E11**: the header test asserts there is no `window`/`document` and
  that the view model is plain data.

## What it does NOT exercise (honest scope)

No DOM, no rendering, no browser process, no network, no screenshots.
The presentational component set (`.tsx`) and the vite mount are the
browser host's concern (PL-033's `packages/web/gameos` mount pattern
documents that recipe); this journey covers the data + projection layer
the mount renders. `studio-ui.ts` documents why the package entrypoint
itself is not imported here.

## The tests

1. `studio journey (E11)` — the honest browser-environment statement,
   executable.
2. `studio journey: the five surfaces walk end-to-end over real read
   models (E5)` — the full walk with per-surface assertions.
3. `studio journey (E9)` — two runs, identical trajectory.
4. `studio journey (E8)` — a permanent port failure keeps failing typed;
   the UI keeps rendering the last good read model.
