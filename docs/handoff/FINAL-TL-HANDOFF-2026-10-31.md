# Final TL Handoff — PlayLiquid (2026-10-31)

Repository: https://github.com/payswapdotorg/PlayLiquid
Handoff branch: `handoff/product-contract-installers-2026-10-31`
Mission: implement the complete product in `PRODUCT-NORTH-STAR.md`, reproduce Figma faithfully, preserve ZCode instead of rebuilding it, and provide easy Linux + Windows installers for every meaningful revision. This is self-contained; do not rely on chat.

## Operator's exact corrections
1. New Task must visibly show **Select project** directly above the prompt composer.
2. **Browser** and **Terminal** toggle icons belong at the top-right of the composer/tool header; toggles must operate inherited ZCode panels.
3. A World can be a Spark, game, experience, digital twin of a real-world entity/place/process/system, or another extensible kind. Spark can be a World kind and also have a delivery profile. Kind and target profile are distinct.
4. Everything else in the current Figma direction is approved. Do not invent a new UX interpretation.
5. Figma correction is not yet written: Figma MCP call limit was reached on 2026-10-31. Update exact New Task frame and record frame link/node IDs and screenshots before visual sign-off.

## Repository as memory
All decisions, architecture changes, work orders, progress, evidence and continuation instructions live in the repo. Read `AGENTS.md`, `AI_CONTINUATION.md`, `PRODUCT-NORTH-STAR.md`, `spec/PROJECT-STATE.md`, architecture/lock/requirements/dependency graph/module matrix/worker contract, current UX and release ledgers, this handoff and exact Work Orders. Actual source, tests, Git history, runtime, browser and CI evidence outrank summaries. Old PROJECT-STATE/45 work orders describe an earlier program, not proof of this product.

Required durable files to maintain:
- `PRODUCT-NORTH-STAR.md` (product authority)
- `docs/handoff/FINAL-TL-HANDOFF-2026-10-31.md` (this mission)
- `docs/product/FIGMA-IMPLEMENTATION-MAP.md` (exact frame-to-component map)
- `docs/product/FEATURE-MATRIX.md` (feature → UI → port/service → tests/evidence)
- `docs/product/INSTALL-AND-RELEASE-CONTRACT.md` (installable build policy)
- `spec/ux/work-items-next.md` (new work ledger)
Update README, AGENTS and AI_CONTINUATION recovery orders to point here. Preserve old historical records; add superseding decisions rather than rewriting history.

## Phase 0: audit and design lock
Record main SHA, tags, clean status, branches/PRs, current workflow files/release artifacts for Linux and Windows, Figma page/frame IDs, current New Task/sidebar/project/browser/terminal/model settings implementations, WebFlix source commit/license/notices, and Journey Map gaps. Do not infer Windows support from Linux packaging. Inspect actual workflow paths; README currently documents .deb/AppImage, not proof of Windows or per-commit artifacts.
Create exact component-to-frame map and tests before coding.

## ZCode preservation contract
ZCode remains authority for New Task/task/session, model/provider selection/settings/custom providers/credentials, agent runtime/context/access, attachments, browser/terminal, search, automations, plugin marketplace, groups/projects/tasks where inherited, RPC/client/server/provider, desktop/web/CLI and settings. Do not create parallel versions. The current `product-shell.tsx` defaults to Game Studio and AI & Agents is secondary; this conflicts with the approved direction. New Task is default. Project workspace replaces the standalone Game Studio dashboard; preserve underlying domain capabilities contextually. Add regression tests proving all existing model/provider settings remain reachable and work.

## WebFlix reuse
Audit actual license, notices, assets, fonts and dependency licenses at exact commit before copying. ZCode Apache-2.0 does not license WebFlix. If compatible reuse cannot be established, use as design/behavior reference. Do not blindly port Next.js server actions, DB adapters or YouTube adapters. Reuse the interaction grammar: landscape cards, hover previews, infinite feed, continue watching, portrait Shorts, watch page, channels, subscriptions, comments, playlists, history, live and replay.

## Architecture reconciliation
Existing architecture says Spark is only a target profile. This is superseded product direction; Spark is also a World kind. Raise ACR and reconcile GameIR, architecture lock, requirements, package graph, module matrix, migration/compatibility and tests. Do not create competing World/GameIR/Package Graph types. Content kind and target profile must be separate.
World = Git-backed project + versioned package composition. Everything reusable/versioned is a package. Avatar = Body + Intelligence. Large binary assets use CAS/object storage.

## Required UX
### New Task
PlayLiquid theme; ZCode centered composer; Select project dropdown directly above; + attachment; access dropdown; inherited model selector; send; Browser and Terminal toggles top-right connected to existing panels; future engine/DCC panels through same tool registry only when real. Optional expandable package context. No dashboard clutter or mandatory engine choice.

### Sidebar
New Task, Search, Automations, Plugin Marketplace, Groups/Projects switcher/create/recent projects/tasks; Home, Sparks, Subscriptions, Live & Replays, Your Channel, Liked/Saved, History; Account/Settings including full inherited ZCode model/provider settings. No dead links.

### Projects
Create/import/connect world projects, tasks, branches/commits, package composition, semantic PR/review/merge, release/deploy, collaborators/remotes. Existing project task creates isolated change set and reviewable PR; new project task creates real repo. Normal work should not require GitHub.

### Player surfaces
Home: WebFlix-style long-form landscape cards, hover preview, continue watching/playing, Spark shelf, infinite scroll, live now.
Long-form World page: real playable session, creator/actions/description/comments/recommendations.
Sparks: vertical 9:16, active Spark auto-loads and begins interaction in feed; no Play button and no redirect. Open full world is explicit.
World Details: video-details-style preview/creator/kind/enter/packages/compatibility/updates/discussion.
Your Channel: Home, Worlds, Sparks, Replays, Collections, About.
Subscriptions, Liked/Saved, History, Live & Replays, Live Player, Start Live, chat/comments and durable replay.
Hover previews: poster first, hover intent, sandboxed disposable session, safe input, cancel/release on leave, no gameplay persistence, no full-world load. Touch behavior must not rely on hover.
Live/replay must use real services. Reuse WebFlix's live stack only if source/license/readiness audit validates it; do not create duplicate broadcast authority.

## Installable Linux AND Windows at every meaningful revision
Not a later nice-to-have. Users must download and inspect the app without cloning/building source, like ZCode.

### Per-commit preview
Every merge to main (and PR heads where feasible) builds from exact SHA on native OS runners:
- Linux x64: .deb + AppImage.
- Windows x64: installer .exe (NSIS or existing Electron Builder supported target) + portable ZIP if feasible.
Upload artifacts to Actions with direct links and publish an immutable per-SHA/edge preview release. README links latest successful preview. Every artifact identifies commit SHA, version, timestamp, OS/architecture and SHA-256. Never overwrite artifacts from another SHA. Clearly label unstable previews. Define retention for transient Actions artifacts and preserve immutable per-SHA releases according to policy.

### Stable tagged releases
Publish both OS families, checksums, release notes, exact source SHA, SBOM/provenance and install/troubleshooting instructions.

### Smoke tests
Linux: clean .deb install/upgrade/uninstall, AppImage launch, desktop entry/icon/executable, New Task, model settings, Browser/Terminal, project selector, data retention.
Windows: clean installer, Start Menu shortcut, launch/product identity, critical journeys, upgrade/relaunch/uninstall, data retention. Sign when certificate exists; otherwise disclose unsigned/SmartScreen behavior.
Run packaged GUI tests on actual OS images; compile success is not installability. Fail publishing if required smoke/integrity gates fail. Maintain README status table with latest main SHA and links.

Keep PlayLiquid app ID, executable, package identity and update identity. Inherited ZCode auto-update must never replace PlayLiquid with ZCode. Do not claim verified auto-update until signing, feed ownership, rollback and compatibility exist.

## Work organization
Maximum three concurrent workers. One Work Order = one branch = one PR = one disjoint frozen write surface; workers never merge. TL owns architecture/ACR, root manifests/lockfiles, shared contracts, route composition, release workflows, versioning, program state and final integration.

Suggested parallelism after path ownership is verified:
- Worker A: New Task, shell/sidebar, ZCode features/model-settings parity, Figma exact reproduction.
- Worker B: Home/long-form/Sparks/hover preview/channels/subscriptions/comments/history; WebFlix license audit first.
- Worker C: World Projects/package composition/semantic PR and Live/Replays UI/services.
- TL: World kind/Spark ACR, worker DAG, Linux+Windows release pipeline, shared integration and final verification.
Do not assign overlapping write surfaces. Keep root files and central composition serialized.

## Phases
0. Baseline audit, reconcile docs, Figma correction, design/component map.
1. ZCode-native New Task/sidebar/project assignment/model settings/browser/terminal.
2. World kinds/profiles, Git-backed projects, package composition and semantic PR.
3. Home, previews, long-form, Sparks, details, channel/subscription/liked/history.
4. Live, chat, durable replay and replay UX.
5. Streaming, engine/tool adapters, platform game services and truthful deploy targets.
6. Per-commit Linux/Windows installers, stable releases and tested upgrade/uninstall.
Parallelize only when dependency edges and write surfaces permit. Screens alone do not complete a phase.

## Acceptance checklist
- [ ] Fresh launch defaults to New Task.
- [ ] Select project visible above composer; new/existing project paths real.
- [ ] Attachment, access and inherited model selection work.
- [ ] Browser/Terminal toggles top-right operate inherited panels.
- [ ] All ZCode model/provider settings remain reachable and tested.
- [ ] Automations, Plugin Marketplace, Groups/Projects and tasks in sidebar.
- [ ] World kinds include Spark/game/experience/digital twin; kind/profile distinct.
- [ ] Project Git lifecycle and semantic PRs real.
- [ ] Packages compose independently; provenance/licensing gates.
- [ ] Home hover previews, infinite scroll, continue watching and Spark shelves.
- [ ] Sparks auto-play in feed with no play button/redirect.
- [ ] Channel, subscriptions, liked/saved, history work.
- [ ] Live/chat/replay are real and durable.
- [ ] World sections progressively stream; deploy providers honest.
- [ ] Figma New Task corrected; exact frame/node links/screenshots recorded.
- [ ] Browser evidence at 390x844 and 1280x800; desktop min width 480.
- [ ] Linux .deb/AppImage and Windows installer/portable preview for each main merge.
- [ ] Stable releases include checksums/provenance and both OS families.
- [ ] Packaged install/launch/upgrade/uninstall tests pass.
- [ ] Work ledger, feature matrix, Journey Map, README and project state current.

## Reporting
At each milestone record base/merge SHA, PR, changed paths, actual behavior, tests, browser/runtime evidence, Linux/Windows artifact links/checksums, known limitations, unsupported integrations and remaining frontier. A feature is green only when source + tests + runtime + browser + build/install evidence agree. The repository is the memory; unrecorded chat decisions are not durable.
