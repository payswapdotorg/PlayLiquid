# The Community Journey (`qa/browser/src/community-journey.test.ts`)

The Community contribution workbench surfaces of
`@playliquid/gameos-community` (PL-034) walked end to end as one user
journey over the REAL community service (PL-032): **the contributions
list with kind filters + trust/origin/AI/gap chips → the selected
contribution's full provenance chain → the append-only lifecycle ledger →
`submit-contribution` through the typed command port → the workflow walk
to accepted → the E10 duplicate → the typed refusals → the R20 guards →
the command log.**

## What it exercises (real, not mocked)

- **The real workbench store + view models** — `createCommunityStore`
  over the three surfaces (contributions, lifecycle, provenance).
- **The real service** (`community-rig.ts`, the lock-rule-44
  TEST-SUPPORT rig): a real `CommunityService` over the community
  package's own deterministic in-memory ports, seeded with fixture rows
  deliberately different from the package's own demo (a
  lineage-derived-over-QUALIFIED-base gap-linked asset walked to
  `accepted`; an honest AI-disclosed replay-backed report left open; a
  lineage-derived-over-UNQUALIFIED-base code row at `under-review`; one
  confused-host foreign-tenant skill row so the R20 guard is visible).
- **The real ports**: a `CommunityDataPort` whose `load()` re-reads the
  service's read doors (contributionsOf / history) and a
  `CommunityCommandPort` forwarding the typed intents
  `submit-contribution` (the host expands the small intent into a full
  submission: payload, provenance chain, gap link) and
  `advance-contribution` (the workflow commands) — refusal codes come
  back VERBATIM (E8).
- **E8 honest trust**: the code row over the unqualified base renders
  `untrusted-until-qualified`; the walked dialogue row's trust chip
  flips to `qualified-at-accept` exactly at the accept transition.
- **R19**: the provenance surface renders the full chain — origin kind,
  the cited lineage base (package id, version, content digest, node id),
  the honest AI disclosure with every model-provenance entry, the R18 gap
  link and the E8 trust state.
- **E10**: the lifecycle ledger only appends (the walk appends genesis +
  three transitions, never a rewrite); a content-identical replay of a
  submission surfaces as the `duplicate: true` receipt with the FIRST
  receipt's id and records no second contribution; every dispatched
  intent lands in the append-only command log where the refusals stay
  visible.
- **R20**: the foreign row cannot be opened (the store's typed
  `cross-tenant` selection refusal); a subject owned by the foreign
  tenant cannot submit into the viewer tenant (the authoritative
  `cross-tenant-contributor` code); a foreign actor cannot advance a
  viewer contribution (`cross-tenant-actor`).
- **E9**: the whole journey runs twice; the traces are identical.

## What it does NOT exercise (honest scope)

No DOM, no rendering, no browser process, no network, no screenshots.
The `.tsx` panels and the vite mount are the browser host's concern;
`community-ui.ts` documents why the package entrypoint itself is not
imported here.

## The tests

1. `community journey (E11)` — the honest browser-environment statement,
   executable.
2. `community journey: the workbench walk end-to-end over the real
   community service (E5)` — the full walk with per-surface assertions.
3. `community journey (E9)` — two runs, identical trajectory.
4. `community journey (E8)` — the port refuses malformed intents before
   any domain call (typed, never thrown), the authoritative
   `cross-tenant-actor` code comes back verbatim, and the refusals
   record no transitions.
