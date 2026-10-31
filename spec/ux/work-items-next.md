# Next UX/Product Work Ledger — 2026-10-31

This ledger supersedes the old Game Studio-first UX contract for new work. Historical work remains intact. Canonical product authority: `PRODUCT-NORTH-STAR.md`; mission: `docs/handoff/FINAL-TL-HANDOFF-2026-10-31.md`.

Rules: max 3 concurrent workers; one WO = one worker = one branch = one PR = one frozen write surface; workers do not merge. TL owns root/shared composition, architecture lock/ACR, route registrations, manifests/lockfiles, release workflows and final integration. Base SHA is the branch's current parent/main SHA; TL must record exact current base before dispatch.

## Phase 0 baseline audit (TL, 2026-10-31) — recorded per the dispatch sequence step 1

- **Main:** `a6c30053f3898ef88f9d394d09807c6e7749df03` (PR #14 squash: product contract + TL handoff). Clean tree; single default branch `main`.
- **Tags/releases:** `v3.14.3` @ 29628c9a, `playliquid-gameos-v3.14.3` @ 4f88d746, `playliquid-gameos-v3.15.0` @ d9e13bc9. Releases: `playliquid-gameos-v3.14.3` and `-v3.15.0` — **Linux-only** (AppImage + .deb + SHA256SUMS, 3 assets each). No Windows artifacts, no per-commit/merge preview builds exist today.
- **Workflows:** `.github/workflows/release-desktop.yml` (workflow_dispatch only; Linux x64 AppImage + .deb via `packages/desktop/scripts/bundle.mjs`; ubuntu-latest smoke harness `qa/desktop-release/scripts/run-ubuntu.sh`; tag-collision refusal; published-asset re-verification) and `playliquid-governance.yml` (`pnpm program:check` + `pnpm architecture:check` on `pull_request`; the `push:` trigger's `branches: [main]` **verified as a display artifact, not a defect** — PLX-REL-001 gap 7 byte-verified the blob (`[main]`, no malformed YAML) and 100+ successful push runs; the first push-triggered Desktop Release run fired at `c6b6bc5f3` after the merge).
- **Windows seam (honest):** `packages/desktop/scripts/bundle.mjs` carries inherited win/nsis plumbing (`--os win` aliases, nsis-resources handling, `.exe` outputs) but it has never been exercised in this repository — no windows-latest job, no Windows smoke harness, no portable ZIP target, no Windows release. Do not claim Windows support from the script's existence.
- **Current New Task/shell implementation:** the product shell
  (`packages/desktop/src/renderer/src/gameos/shell/product-shell.tsx`) defaults
  to the Game Studio workspace (`active="studio"`) with the inherited ZCode
  workbench reachable via `openWorkbench` (the "AI & Agents" escape hatch) —
  this is the conflict the product contract supersedes (New Task is default).
  Inherited ZCode New Task machinery: `packages/ui/src/NewTaskButtonGroup.tsx`,
  `packages/ui/src/v4/workbenchNewTaskTarget.ts`,
  `packages/ui/src/v4/composer/newTaskDraft.ts` (workspace-scoped targets,
  drafts, model selection via `@zcode/services` ModelSelectionView).
- **Browser/Terminal panel seams (inherited, to be operated — not rebuilt):**
  browser: `packages/ui/src/browser-use/*` (UnifiedBrowserView and the
  browser-use suite); terminal: `packages/ui/src/Terminal.tsx`,
  `packages/ui/src/SidePaneTerminalPane.tsx`,
  `packages/ui/src/hooks/useAppPanels.ts`,
  `packages/ui/src/WorkspaceTerminalToggleButton.tsx`.
- **Inherited model/provider settings:** `packages/ui/src/SettingsPage.tsx` +
  `packages/ui/src/settings/*` (full ZCode settings page — must remain
  reachable and functionally equivalent; regression coverage is a
  PLX-UX-001 proof requirement).
- **GameIR/lock citations for ACR-001:** `spec/architecture-lock.md` rule 16;
  `spec/architecture.md` §Spark + build Targets list; `spec/requirements.md`
  R6; `spec/module-dependency-matrix.md` (runtime-spark / spark /
  engine-playcanvas); `packages/game-ir/src/document.ts` (version-freeze
  rule satisfied by the ACR).
- **WebFlix:** not yet audited (license/commit/notices) — remains Worker B's
  PLX-UX-002 dependency; no WebFlix code may be copied before that audit.
- **Figma correction status (honest):** BLOCKED — the Figma MCP hit the
  connected account's Starter-plan call limit on 2026-10-31 (recorded in
  `PRODUCT-NORTH-STAR.md` §Figma authority). The correction is NOT done and
  must not be claimed as done. Unblock options: (a) the operator raises the
  Figma MCP limit / supplies credentials, or (b) the operator approves
  text-spec-first implementation (`PRODUCT-NORTH-STAR.md` §New Task is
  complete and unambiguous) with the frame update recorded before visual
  sign-off. PLX-UX-001 dispatch is HELD until one is chosen.

## PLX-UX-001 — ZCode-native New Task and navigation

Owner: Worker A. Dependencies: baseline audit (done 2026-10-31, above); Figma correction (HELD — see audit record; the design text in `PRODUCT-NORTH-STAR.md` §New Task is acceptance-critical and complete, but the frame correction remains the gate the operator set).
Write surface (FROZEN by TL after the Phase-0 inspection — extend, never replace, the inherited implementations):
- `packages/desktop/src/renderer/src/gameos/shell/product-shell.tsx` (default first-run surface → New Task per the product contract; the three workspaces remain reachable)
- `packages/desktop/src/renderer/src/gameos/shell/shell-chrome.tsx` (nav rendering + `openWorkbench` seam)
- `packages/desktop/src/renderer/src/gameos/shell/shell-workspaces.ts` (vocabulary extension only; the frozen UX-001 labels stay)
- `packages/desktop/src/renderer/src/gameos/shell/shell-tokens.ts`, `shell-density.ts`, `shell-icons.tsx` (colocated, only as the newtask surface requires)
- `packages/ui/src/NewTaskButtonGroup.tsx`, `packages/ui/src/v4/workbenchNewTaskTarget.ts`, `packages/ui/src/v4/composer/newTaskDraft.ts` (inherited New Task machinery — extension only)
- colocated tests under the same trees only
- NOT: root manifests/lockfiles, central composition beyond the shell files above, ZCode model/provider internals, release workflows, semantic kernel.
Requirements: New Task first-run; Select project dropdown above composer; attachment/access/model controls inherited; top-right Browser/Terminal toggles use existing ZCode panels (browser-use suite + terminal pane system — see the audit seam list); sidebar exposes Search, Automations, Plugin Marketplace, Groups/Projects/tasks, Home/Sparks/Subscriptions/Live & Replays/Your Channel/Liked/History and full Settings. Full ZCode model settings parity.
Proof: model/provider regression tests; project assignment; panel toggles; browser screenshots 1280x800, 390x844 and 480px min desktop; keyboard/accessibility.

## PLX-UX-002 — WebFlix-style player and discovery

Owner: Worker B. Dependencies: WebFlix license/source audit (pending) and approved Figma map (pending — see FIGMA-IMPLEMENTATION-MAP.md status).
Write surface: player/discovery UI component trees and tests only; no shared shell route registration, domain contracts or release workflow.
Requirements: Home landscape cards, poster-first hover previews, infinite scroll, Continue Watching/Playing, Spark shelf; long-form World play page; instant in-feed Sparks; World Details; channel/subscriptions/liked/history. Previews isolated/disposable and resource-limited. Feeds consume `worldKind` (read model only — ACR-001 Phase B).
Proof: real playable session path; hover preview launch/cancel; fallback poster; touch behavior; Sparks auto-enter without Play CTA or redirect; screenshots and tests.

## PLX-UX-003 — World Projects and social/live/replay

Owner: Worker C. Dependencies: World-kind ACR (ACCEPTED — ACR-001); existing Git/package/live/replay authorities audit (pending).
Write surface: project workspace and social/live/replay UI module trees + colocated tests; no central route registration or shared contracts.
Requirements: world projects, tasks, package composition, semantic PR/review; Your Channel/Subscriptions/Live & Replays/Live Player/Start Live/Replay. Reuse existing live implementation if legally and technically ready; do not create duplicate broadcast stack.
Proof: real branch/PR lifecycle; live session/chat; durable replay record/index/play; semantic package diff; browser evidence.

## PLX-ARCH-001 — World kind/profile and Spark semantic reconciliation

Owner: TL (architecture owner). Dependencies: none.
Status: **ACR-001 ACCEPTED and MERGED** — PR #15 (branch `tl/PLX-ARCH-001-world-kind-acr`, base `a6c30053`), squash `a0fbd8d310968c76d6fa558766abc4843aff74fd`, governance CI run 41198277257 (success). Phase A documents only. Phase B: **PLX-ARCH-002 MERGED** (PR #16, squash `326da97f59bc592a4662b9c714be16d7e4f2d69e`) and **PLX-ARCH-003 MERGED** (PR #18, squash `c7a55f5c94`) — the ACR's Phase B Work Orders are complete.
Write surface: Architecture Change Request, architecture/requirements/graph/matrix/compatibility plan; no worker may change semantic kernel before approval. (Satisfied: no code changes in Phase A.)
Requirements: World kinds include Spark/game/experience/digital_twin/other; target profiles separate. Existing GameIR/Package Graph remain single authority. Reconcile old Spark-only-target lock. (Satisfied by ACR-001; lock v1.1 Amendment 1.)
Proof: accepted ACR (done); migration/compatibility tests (deferred to PLX-ARCH-002/003 — the ACR's implementation Work Orders, defined in ACR-001 §6); no duplicate World type (single-definition-site check lands with PLX-ARCH-002; lock rules 1/40 govern).

## PLX-ARCH-002 — World kind / target profile registries + GameIR world declaration (MERGED)

Owner: TL-executed (ACR-001 §6 first Phase B Work Order). Dependencies: ACR-001 (accepted).
Branch: `arch/PLX-ARCH-002-world-kind-registries` · PR #16 · base `7600fa2` · squash `326da97f59bc592a4662b9c714be16d7e4f2d69e`.
Write surface (frozen): `packages/game-contracts` + `packages/game-ir` + colocated tests only — held exactly.
What landed: `WorldKind` / `TargetProfile` registries + `WorldDeclaration` guard + `DEFAULT_WORLD_KIND` (`game`) + `resolveWorldKind` in `game-contracts/src/world.ts`; optional document-level `world` declaration on `GameIRDocument` (additive; `irVersion` stays "1"); granular validation `GAMEIR/E017/E019/E020` (absence = legacy default, no diagnostic).
Gates (local station, recorded in PR #16): game-contracts test 50/0 + typecheck + oxlint 0/0 (20 files); game-ir test 68/0 + typecheck + oxlint 0/0 (22 files); root `program:check` PASS (45 WOs); `architecture:check` 5/5 baseline / 0 new. Governance CI run 41198813037 (success).
Tests: 16 new — legacy-valid, kind/profile independence matrix (5 kinds × 8 profiles), unknown-reject, non-fail-fast collection, additive-only regression, single-authority registry pin.
Remaining for the ACR's Phase B: none — **PLX-ARCH-003 MERGED** (see its section below); the ACR-001 implementation program is complete through the runtime/build/engine seams.

## PLX-ARCH-003 — (worldKind, targetProfile)-aware dispatch (MERGED)

Owner: TL-executed (ACR-001 §6 second Phase B Work Order). Dependencies: ACR-001 (accepted), PLX-ARCH-002 (merged).
Branch: `arch/PLX-ARCH-003-world-kind-dispatch` · PR #18 · base `79c6acd` · squash `c7a55f5c94`.
Write surface (frozen): `packages/runtime-spark`, `packages/spark`, `packages/engine-playcanvas`, `packages/build-contracts` + colocated tests only — held exactly, plus the TL-owned `pnpm-lock.yaml` delta (+6 lines: the two new workspace-link registrations for the game-contracts dependency; a TL-owned root surface exercised for dep registration, recorded here per the ledger rules).
What landed: `runtime-spark/src/dispatch.ts` (dispatchSparkWorld / sparkRuntimeAdmitsWorld / sparkWorldDoorRefusal — the pure routing authority; the content kind NEVER gates, a declared non-spark delivery is a typed `world-delivery-not-spark` refusal at the createSparkRuntime door, legacy undeclared documents unchanged); refusal vocabulary extracted to `runtime-refusal.ts` and the view to `runtime-view.ts` (module cycle + 400-line budget; public surface unchanged); `build-contracts` TargetProfileInputRef.deliveryProfile? (typed delivery input, digested only when declared — legacy digests byte-identical, proven); `spark` composeSparkBuildDocument door + conditional deliveryProfile/worldKind on the wire/payload + derived SparkBuildWorldContext; `engine-playcanvas` derived PLAYCANVAS_DELIVERY_BY_TARGET/PROFILES (legacy binding digest unchanged, proven), configurePlayCanvasDeliveryProfiles (explicit declarations pinned into the digest), playCanvasCanServeDeliveryProfile + kind-agnostic playCanvasCanServeWorldDelivery. module.ts manifests for build-contracts + engine-playcanvas declare the game-contracts dependency (ACR-001 §3 consumer clause; checker reads manifests with precedence — policy promotion deferred to the next matrix-reconciliation wave, ACR-001 §5).
Gates (local station, recorded in PR #18): build-contracts test 61/0 + typecheck + oxlint 0/0; runtime-spark 65/0 + typecheck + oxlint 0/0; spark 24/0 + typecheck + oxlint 0/0; engine-playcanvas 72/0 + typecheck + oxlint 0/0; root `program:check` PASS (45 WOs); `architecture:check` 5/5 baseline / 0 new; `examples/native-game` regression 46/0 (the ACR's unchanged-behavior requirement). Governance CI run 41213627492 (success).
Tests: kind×delivery independence matrices at every seam (5 kinds × declared deliveries), legacy shape/digest byte-stability proofs, runtime-door refusals, explicit-pin digest proofs, kind-agnostic engine dispatch.
ACR-001 Phase B status: **complete** (PLX-ARCH-002 + PLX-ARCH-003 both merged).

## PLX-REL-001 — Cross-platform installable delivery (MERGED)

Owner: TL or dedicated release worker after disjoint ownership is set. Dependencies: inspect existing release workflow (DONE 2026-10-31 — see the Phase-0 audit record).
Write surface: release workflows, packaging config and release docs only; no UI or semantic contracts.
Requirements: every main merge has Linux .deb/AppImage and Windows .exe installer/portable ZIP preview artifacts from exact SHA; stable tags publish both OS families, checksums, provenance and notes. Packaged GUI smoke tests.
Implementation gaps found by the audit (all mandatory): add `push: main` + PR-head preview builds from the exact SHA (none exist today — the workflow is dispatch-only); windows-latest job exercising the inherited nsis seam + portable ZIP (never exercised in this repo); a Windows smoke harness (only `run-ubuntu.sh` exists); immutable per-SHA/edge preview releases that never overwrite another SHA's artifacts; README status table with latest main SHA + direct links; retention policy; verify/fix the governance workflow's malformed `push:` trigger.
Proof: install/launch/upgrade/uninstall on actual OS runners; README direct links; checksum/source SHA verification.

Merge evidence (per ledger rule 5): branch `rel/PLX-REL-001-cross-platform-previews` · PR #17 · base `79c6acd` · squash `c6b6bc5f3062eb16525d00a3d82c9820fe60d6e2` (2026-10-31). All 8 audit gaps implemented (gap 7 verified non-defect, no fix needed). Gates: governance CI run 41225816582 success at final head `905117e06` (the pipeline-fix commits had tripped the only new `architecture:check` violation — `run.mjs` 420 > 400 lines — fixed by refactor `905117e` extracting the packaged-launch lifecycle verbatim into `run-lifecycle.mjs`; behavior identical, release pipeline untouched); `program:check` PASS (45 Work Orders). Pipeline proof: `workflow_dispatch` run 41222127702 at `dca41e29` — `windows-desktop`, `linux-desktop`, `publish`, `publish-status` ALL SUCCESS; immutable per-SHA preview release published with both OS families + merged `SHA256SUMS` + `BUILD-INFO.txt` and re-verified by re-download. First push-to-main preview run 41225919507 fired at the merge SHA `c6b6bc5f3` (the PLX-REL-001 contract in action); its outcome is recorded in the README release-status table. Windows smoke scope honestly headless (checksums, portable + installed launch, silent install/uninstall, shortcut, HKCU identity, data retention across reinstall — no synthetic GUI interactions; cross-version upgrade recorded as follow-up).

Post-merge follow-up (recorded per rule 5): the first push-triggered preview (run 41225919507 at `c6b6bc5f3`) completed all four jobs green and published immutable `preview/c6b6bc5f30` (both OS families + `SHA256SUMS` + `BUILD-INFO.txt`; BUILD-INFO identifies the exact merge SHA, event, run URL, per-asset SHA-256). The ledger-SHA preview run 41226144216 (`284aff9b0`) then failed in the publish job's re-verification — `error-handling-offline-render` caught the loading screen under the dead proxy (33/34; the same binary had passed the same check in its own build job minutes earlier — a cold-runner first-run prep race the main run already waited out, but the offline path probed once immediately). Honesty-by-construction held: `preview/284aff9b0` was never published and `publish-status` recorded the non-completion. Fix: PR #19 (branch `fix/PLX-REL-001-offline-shell-wait`, squash `d217c95aa1d0fa3409a9faca3577aa8b642123de`, governance green) — the shell wait extracted into `waitForProductShell` and applied to both paths. Proof: push preview run 41230433701 at `d217c95aa1` — all four jobs green, `preview/d217c95aa1` published, re-verification battery **34/34, exit 0** including the previously-failing offline render check ("product shell present — first-run preparation finished within the 180s window").

## Dispatch sequence

1. TL performs baseline audit, Figma correction and file-level ownership mapping. — audit + mapping DONE 2026-10-31; **Figma correction HELD** (operator gate; see the audit record).
2. PLX-ARCH-001 begins immediately; other work that depends on World kind waits for ACR. — **ACR-001 ACCEPTED; Phase B COMPLETE**: PLX-ARCH-002 MERGED (PR #16) and PLX-ARCH-003 MERGED (PR #18, squash `c7a55f5c94`, CI 41213627492).
3. Dispatch PLX-UX-001/002/003 only when write surfaces are pairwise disjoint. — surfaces now frozen above; PLX-UX-001 HELD on the Figma gate; PLX-UX-002 HELD on the WebFlix audit; PLX-UX-003 UNBLOCKED by ACR-001 Phase B completion (worldKind/targetProfile dispatch now available to feeds and project surfaces) but HELD on its authorities audit.
4. PLX-REL-001 can run in parallel only after workflow ownership is disjoint from root integration and existing release work. — audit done; **PLX-REL-001 MERGED** (PR #17, squash `c6b6bc5f30`, governance 41225816582; dispatch proof 41222127702 all-green both OS families; first push-triggered preview 41225919507 at the merge SHA).
5. TL merges only after source + tests + runtime + browser + packaged build evidence agree. Update this ledger with branch, PR, base/head/merge SHA, test results and evidence URLs.
