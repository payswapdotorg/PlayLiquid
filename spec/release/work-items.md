# Release Work Items — Desktop Product (post-program workstream)

Operator handoff 2026-10-14: deliver a downloadable, launchable PlayLiquid
GameOS desktop application for Ubuntu Linux from this repository. This is a
NEW release-readiness workstream layered on top of the completed 45/45
program (spec/PROJECT-STATE.md) — historical records and the frozen
architecture are preserved; architecture extension is recorded in
spec/release/ACR-R1-desktop-product-release.md.

Ledger rules mirror the program's: one Work Order = one worker = one branch
= one PR; frozen write surface; no self-merge; acceptance = exact evidence.
The program ledger (program/graph.json) stays closed at PL-045 — release
work orders are tracked HERE only.

Base SHA for all release work orders: `26abd7f` (main, program-complete).

## RW-001 — Product shell, navigation and renderer integration (Worker A)

Branch: `release/wa-product-shell`.

Frozen write surface:
- `packages/desktop/src/renderer/src/gameos/` (new tree — the product shell)
- `packages/desktop/src/renderer/index.html` (title + startup branding)
- `packages/desktop/src/renderer/src/main.tsx` (product-first entry routing)
- `packages/desktop/vite.config.ts` (build wiring for the shell if needed)

Read-only references (imports allowed, files untouched):
`packages/game-ui/src`, `packages/web/gameos-lab/src`,
`packages/web/gameos-community/src`, all domain packages. NO workspace
manifest or lockfile changes (relative-source imports per the PL-033/034
precedent). NO desktop main-process changes (Worker B owns `src/main`).

Requirements:
- The first visible window is the PlayLiquid GameOS product: a coherent
  navigation + workspace experience composing the REAL product modules —
  Game Studio (game-ui StudioApp), Lab (gameos-lab), Community
  (gameos-community) — plus the package/runtime/build workflows those
  modules already project.
- Identity consistent across startup screen, window title, navigation,
  icons, menus and empty states: PlayLiquid GameOS.
- Production data path = REAL host-wired ports: desktop host adapters
  implementing the modules' existing typed port seams
  (StudioDataPort / LabDataPort + LabCommandPort / community ports) backed
  by the actual domain implementations, in the renderer or via the
  existing preload/service bridges. The production UI must NOT import
  demo fixtures, `demoStudioSnapshot()`, `StaticStudioDataPort`, fakes or
  test fixtures.
- Every visible action routes to a real supported operation or renders an
  honest unavailable/blocked/empty state. No dead buttons, no fake success.
- No second state owner / registry / model-routing authority / workflow
  engine: state and command ownership stays with the existing authoritative
  modules and stores (E5/E13 discipline verbatim).
- The ZCode workbench (model selection, agent, provider capabilities)
  remains reachable from the product but is NOT the default surface.

Acceptance evidence (PR must include):
- base SHA; changed files; tests + exact commands (store/view-model level
  tests for the shell adapters, `node --test` in the package pattern);
- renderer runtime evidence: dev-run screenshot(s) of the product shell
  (Studio/Lab/Community) with the real ports wired;
- a source-level assertion inventory (e.g. grep proofs) that production
  code paths import no demo/fake/static-port modules;
- environment limitations stated honestly.

## RW-002 — Product identity and Linux packaging (Worker B)

Branch: `release/wb-identity-packaging`.

Frozen write surface:
- `packages/desktop/scripts/desktop-product-identity.mjs`
- `packages/desktop/package.json` (identity/product fields ONLY — no
  dependency/lockfile changes)
- `packages/desktop/electron-builder.config.js`
- `packages/desktop/build/` (icons, desktop-entry, installer assets —
  derive from docs/brand/playliquid-gameos-icon-1024.png)
- `packages/desktop/src/main/` (window title, app menu, brand strings,
  single-instance/deep-link/update isolation)
- `packages/desktop/dev-app-update.yml`
- `packages/desktop/scripts/desktop-product-identity.test.mjs` (new, if the
  identity script needs tests colocated)

Read-only: renderer/** (Worker A), qa/** (Worker C), root manifests.

Requirements:
- PlayLiquid GameOS production identity: appId, productName, Linux
  executable name, Debian package name, icon, desktop-entry metadata,
  installation identity — consistent across installer, artifact filenames,
  startup window and application menu.
- The installed product must NOT install or launch as ZCode and must NOT
  silently overwrite an existing ZCode installation (distinct appId,
  executable, package name, data/profile paths, deep-link protocol and
  update channel).
- Ubuntu-targeted AppImage AND .deb artifacts buildable; state actual
  supported Ubuntu versions + system dependencies from test evidence.
- No internal workspace package renames (`@zcode/*` stays).

Acceptance evidence (PR must include):
- base SHA; changed files; identity unit tests + exact commands;
- local build evidence: the exact electron-builder commands used and the
  produced artifact filenames for Linux;
- icon/desktop-entry evidence (file list + sizes);
- coexistence analysis: how a PlayLiquid install behaves next to an
  existing ZCode install (paths, protocols, update channels) — from
  configuration, stated honestly.

## RW-003 — Packaged-app smoke tests, UI verification and launch evidence (Worker C)

Branch: `release/wc-smoke-evidence`.

Frozen write surface:
- `qa/desktop-release/` (new tree: src/, fixtures, scripts, README)

Read-only: everything else.

Requirements:
- Automated checks against the PACKAGED Linux application (built AppImage;
  .deb where installable), not the dev server:
  startup + clean shutdown; PlayLiquid product shell rendering; correct
  product identity/title/assets; first-run + no-data states;
  Studio/Lab/Community navigation; a representative REAL operation
  reaching its authoritative module through production-wired ports;
  visible error handling when an adapter/service is unavailable;
  no dependence on dev servers, repo-relative files or dev-only env vars;
  clean-profile startup; absence of ZCode branding as the primary UI.
- Viewports 390×844 and 1280×800.
- Window-level evidence (Electron under Xvfb + CDP screenshots/logs), not
  only node --test / type checks / view-model tests.
- The harness must run on the current main artifact too and report HONEST
  results (expected pre-A/B failures recorded as the baseline, e.g. ZCode
  branding still present) — proving the harness detects real state.

Acceptance evidence (PR must include):
- base SHA; changed files; harness run transcripts + exact commands;
  screenshots + logs captured from a packaged run;
- baseline report on current main (honest pre-integration state);
- environment limitations stated honestly (e.g. Xvfb, display server,
  distro actually used).

## RW-004 — TL integration, gates, artifacts and publication (TL-owned)

TL-owned surfaces: root package.json / pnpm-lock.yaml / pnpm-workspace.yaml,
.github/workflows (governance + new release workflow), architecture-policy.yaml,
spec central docs, program records, docs/handoff, merge decisions, GitHub
Release publication (tag, AppImage + .deb + SHA256SUMS, instructions, honest
release notes, verification evidence) and post-publication verification
(download + checksum + launch of the published asset).
