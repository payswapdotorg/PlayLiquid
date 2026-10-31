# Product Feature Matrix
Initial acceptance map. TL must fill exact source paths, typed contracts, stores/ports, test names and CI evidence during Phase 0.

| Feature | Entry | Authority | Proof |
|---|---|---|---|
| New Task | first-run/sidebar | ZCode task/session | create task, attachments, access, model |
| Project assignment | composer selector | Git/project lifecycle | new + existing project paths |
| Browser/Terminal | composer toggles | ZCode tool panels | open/close, session continuity |
| Model settings | Settings | ZCode provider/model | regression coverage for existing providers |
| Automations | sidebar | ZCode automation | create/run/pause |
| Plugin Marketplace | sidebar | ZCode plugin authority | discover/install/enable |
| Groups/Projects | sidebar | project/group authority | switch/create/list tasks |
| World/package graph | project | GameIR + Package Graph | compose/version/resolve |
| Semantic PR | project | Git lifecycle/provenance | branch/diff/review/merge |
| Home feed | Home | feed service | pagination/recommendations/progress |
| Hover preview | world cards | isolated preview runtime | poster-first, hover launch/cancel/sandbox |
| Sparks | Sparks | world runtime + Spark profile | auto-enter in-feed |
| Long-form world | world page | runtime/session | launch/resume/actions |
| Channel/subscriptions | player nav | creator/follow services | channel tabs/feed |
| Live | hub/player | broadcast/session authority | stream/chat/moderation |
| Replays | hub/channel | replay service | record/index/play |
| World streaming | runtime | section/chunk delivery | progressive load/budgets |
| Deployments | project | provider adapters | real deployment URL/rollback |
| Installers | releases | GitHub Actions | install/launch/upgrade/uninstall |

A visible control without an authoritative operation is incomplete. Do not count placeholder UI as implementation.

## Phase 0 fill (TL, 2026-10-31) — verified source paths and evidence status

Filled only from the actual Phase-0 inspection (main @ `a6c30053`); unverified
cells stay pending their Work Order. No placeholder is counted as implemented.

| Feature | Verified source paths (main @ a6c30053) | Authority status | Evidence status |
|---|---|---|---|
| New Task | `packages/ui/src/NewTaskButtonGroup.tsx`, `packages/ui/src/v4/workbenchNewTaskTarget.ts`, `packages/ui/src/v4/composer/newTaskDraft.ts`; product shell `packages/desktop/src/renderer/src/gameos/shell/product-shell.tsx` (currently defaults to Game Studio — the conflict the contract supersedes) | inherited ZCode machinery intact | product correction pending PLX-UX-001 (Figma gate) |
| Project assignment | `packages/ui/src/v4/workbenchNewTaskTarget.ts` (workspacePath/identity-scoped targets) | inherited; real new/existing paths pending | pending PLX-UX-001 |
| Browser/Terminal | browser: `packages/ui/src/browser-use/*` (UnifiedBrowserView suite); terminal: `packages/ui/src/Terminal.tsx`, `packages/ui/src/SidePaneTerminalPane.tsx`, `packages/ui/src/hooks/useAppPanels.ts`, `packages/ui/src/WorkspaceTerminalToggleButton.tsx` | inherited ZCode panels exist (to be operated by composer toggles, not rebuilt) | toggle wiring pending PLX-UX-001 |
| Model settings | `packages/ui/src/SettingsPage.tsx` + `packages/ui/src/settings/*`; model selection seam `@zcode/services` ModelSelectionView (consumed by `newTaskDraft.ts`) | inherited ZCode settings page intact | regression coverage pending PLX-UX-001 |
| World/package graph | `packages/game-ir/src/*` (GameIRDocument v"1" + optional `world` declaration); `packages/game-contracts/src/world.ts` (registries); `packages/package-registry` | single authority (ACR-001) | registries + validation + 16 tests landed (PLX-ARCH-002, PR #16); runtime/build dispatch pending PLX-ARCH-003 |
| Sparks | — | now governed by ACR-001 (World kind + `spark_vertical` profile; kind/profile distinct) | pending PLX-ARCH-002 + PLX-UX-002 |
| Installers | `.github/workflows/release-desktop.yml`; bundle seam `packages/desktop/scripts/bundle.mjs`; smoke harness `qa/desktop-release/scripts/run-ubuntu.sh` | Linux-only today (2 releases, 3 assets each); Windows seam unexercised; no per-commit previews | Windows + per-commit previews + smoke coverage pending PLX-REL-001 |
