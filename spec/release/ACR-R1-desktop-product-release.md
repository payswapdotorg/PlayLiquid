# Architecture Change Request R1 — PlayLiquid GameOS Desktop Product Release

- Requested: 2026-10-14, by TL (release-readiness workstream, operator handoff)
- Status: APPROVED (TL-owned central change, additive only)
- Base: main `26abd7f` (program-complete state, 45/45 WOs + feat/ui-plugin)
- Regime: post-program maintenance (spec/PROJECT-STATE.md §Architecture changes)

## Motivation

The operator handoff (2026-10-14) designates a NEW deliverable: a downloadable,
launchable PlayLiquid GameOS desktop application for Ubuntu Linux. The 45/45
program delivered the PlayLiquid domain and its three product UI modules
(game-ui Studio, gameos-lab, gameos-community) as pure-seam read-model
projections — but the desktop application still boots the inherited ZCode
workbench as its default UI, and its packaging identity is ZCode.

## Change 1 — new managed module `gameos-product-shell` (additive)

- Roots: `packages/desktop/src/renderer/src/gameos`
- The PlayLiquid product shell: the DEFAULT first-window experience composing
  the existing product modules (Studio / Lab / Community) behind PlayLiquid
  GameOS navigation, with host-wired ports (real data through the existing
  typed seams — no demo fixtures, no `StaticStudioDataPort`, no fakes).
- Composition follows the frozen PL-033/PL-034 mount recipe: the host loads
  the first authoritative snapshot before the store exists, wires the ports,
  creates the ONE store per module, mounts the app. Relative-source imports
  per the gameos precedent (no workspace manifest/lockfile changes).
- The ZCode workbench remains reachable (underlying model/provider/agent
  capabilities preserved) but is NOT the default product surface.
- No existing frozen rule changes: E5 (UI reads only through ports),
  E10/E13 (typed intents, append-only), lock rule 44 (demo ports are test
  support, never production seams) all hold verbatim.

## Change 2 — new managed module `qa-desktop-release` (additive)

- Roots: `qa/desktop-release/src`
- The packaged-app release QA surface: window-level smoke tests of the BUILT
  Linux application (packaged AppImage / .deb), covering startup/shutdown,
  product identity, PlayLiquid shell rendering, Studio/Lab/Community
  navigation, first-run/no-data states, clean-profile startup, no-dev-server
  independence, both required viewports (390×844, 1280×800).
- Harness discipline: actual rendering/window evidence (Electron under Xvfb +
  CDP), not only `node --test`/view-model assertions; honest failure states.

## Change 3 — product identity & packaging (no domain contract change)

- `packages/desktop/scripts/desktop-product-identity.mjs` gains the PlayLiquid
  product identity (appId / productName / linux executable / linux package
  name); electron-builder Linux targets, artifact names, desktop-entry and
  icons serve the PlayLiquid GameOS identity.
- ZCode identity surfaces inside the desktop main process (window title,
  menu, dialog strings) are rebranded for the product; OAuth deep-link
  protocol and update channel are isolated so a PlayLiquid install neither
  collides with nor silently overwrites an existing ZCode installation.
- No workspace package renames (the fork's internal `@zcode/*` names stay).

## Non-changes

- program/graph.json stays closed at PL-045 (frontier EMPTY preserved);
  the release workstream is tracked in spec/release/work-items.md, NOT as
  program Work Orders.
- No frozen-architecture rule is modified; both new modules enter the
  managed set with declared `requires` recorded in
  spec/module-dependency-matrix.md.
- Root manifests, pnpm-lock.yaml, CI composition and release workflow
  remain TL-owned central surfaces (worker-contract.md).

## Acceptance evidence

Recorded per work order in spec/release/work-items.md and finally in
docs/handoff/RELEASE-DESKTOP.md (release evidence index: tag, SHA, artifact
URLs, checksums, Ubuntu instructions, startup logs, screenshots).
