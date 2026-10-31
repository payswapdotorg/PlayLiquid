# Product Experience Work Orders — Post-PL-045

**Status:** New post-program workstream. Does not reopen or rewrite PL-001..PL-045 or the historical UX-001..UX-004 records.  
**Current main base for planning:** `78f2011595b2575c6eaee486a329bcdb4fae58bd`  
**Authority:** [Product Experience Spec](../../docs/product/PRODUCT-EXPERIENCE-SPEC.md), [Figma Contract](../../docs/product/FIGMA-IMPLEMENTATION-CONTRACT.md), [Final Handoff](../../docs/handoff/FINAL-PRODUCT-IMPLEMENTATION-HANDOFF.md).

The previous product-shell contract centered Game Studio/Lab/Community as top-level workspaces and is superseded for future UX implementation. Do not edit historical records to pretend those decisions were different. This workstream records the new direction.

## Governance

- Maximum three concurrent workers, consistent with `AGENTS.md`.
- One Work Order = one worker = one branch = one PR = one frozen write surface.
- Workers do not merge.
- TL owns shared contracts, central composition, root manifests/lockfiles, architecture policy, release publication and integration.
- Concurrent write surfaces must be pairwise-disjoint.
- Existing ZCode functionality must remain available and tested.
- UI work is blocked until its Figma frames are complete and pinned.
- A feature must be wired to the authoritative service/port; no mock or fake success.

## Ordered phases

### PX-000 — Product specification, design freeze and source audit (TL-owned)
**State:** IN PROGRESS — repository spec created; Figma final edits/sign-off remain open.  
**Write surface:** `docs/product/**`, `docs/handoff/FINAL-PRODUCT-IMPLEMENTATION-HANDOFF.md`, this ledger (TL only).  
**Deliverables:**
- Confirm all approved terms and navigation.
- Finish New Task: visible Select project dropdown above composer; Browser and Terminal toggle icons at top-right.
- Finish Figma page for Your Channel, Subscriptions, Liked Games, Live & Replays, Live Player/Start Live.
- Audit exact ZCode existing routes/components/services/tests for Settings, providers, New Task, Search, Automations, Marketplace, groups/projects, Browser and Terminal.
- Audit WebFlix source component ownership/license; decide actual reuse vs clean-room reference.
- Replace old future-facing UX test contracts with the approved project/task/navigation contract without altering historical evidence.
- Pin exact screenshots, frame IDs, baseline SHA and source reuse map.
**Acceptance:** Figma complete and signed off; ZCode preservation inventory; WebFlix reuse rights/decision; updated test contract; exact evidence in repository.

### PX-001 — ZCode-preserving product shell and New Task
**State:** BLOCKED on PX-000 Figma sign-off.  
**Suggested worker:** A.  
**Write surface:** desktop product-shell/navigation and approved New Task surface; colocated tests and explicitly listed integration points only.  
**Deliverables:**
- ZCode-like sidebar with PlayLiquid visual tokens.
- New Task as the default product landing view.
- Projects/Groups switch, project tree, tasks.
- Search, Automations, Plugin Marketplace, discovery entries.
- Project dropdown above composer.
- Browser/Terminal toggles top-right opening existing ZCode panels.
- Existing plus/access/model/send controls unchanged in behavior.
- Existing Settings/Model Provider route fully accessible.
**Acceptance:** responsive Figma match; existing ZCode settings/model/task regression suite; real browser/package tests.

### PX-002 — World Projects, project task lifecycle and semantic PR UI
**State:** BLOCKED on PX-000 design/contract.  
**Suggested worker:** B.  
**Write surface:** new project UI module, typed intents/ports/adapters in explicitly owned project service areas, tests. No root manifests/central host without TL ownership.  
**Deliverables:**
- World Projects list and Group organization.
- World project creation/import/connect remote (only supported flows).
- Project workspace: Overview, Tasks, Pull Requests, Packages, Builds/Deploys, Activity, Settings.
- Task-to-branch context.
- Native PlayLiquid Git/PR workflow without GitHub requirement.
- Optional GitHub remote adapter.
- Package dependency graph and semantic diff/review.
**Acceptance:** create project, create task, branch, commit, semantic PR, review, approve/merge, optional remote synchronization; persistence and restart evidence.

### PX-003 — Player/discovery/social surfaces
**State:** BLOCKED on PX-000 Figma sign-off and WebFlix license/reuse audit.  
**Suggested worker:** C.  
**Write surface:** player-facing shell/routes/components and their view models/tests only; shared shell integration TL-owned.  
**Deliverables:**
- Home/Continue Playing/feed.
- Long-form Play and World Details.
- Sparks vertical feed, instant-play.
- Your Channel.
- Subscriptions.
- Liked Games/collections.
- Live & Replays.
- Live Player/Start Live flow.
- Comments/chat/follow/share where supported.
**Acceptance:** Figma screenshot match, working state/actions, desktop/mobile browser evidence, no fake metrics or data.

### PX-004 — Hover-preview media pipeline
**State:** DEPENDS on PX-003 card/feed contracts.  
**Suggested worker:** after PX-001..003 or alongside later disjoint runtime work.  
**Write surface:** preview manager/card media component, capture/media contracts, tests and media adapter implementation.  
**Deliverables:** actual gameplay clip generation, poster approval, media metadata/provenance, hover preview player with dwell/one-player/cleanup/fallback/device policies.
**Acceptance:** actual gameplay video in card, not slideshow; one player; mobile/reduced-motion policy; measured startup and resource budgets.

### PX-005 — World profiles, runtime streaming and deployment
**State:** Depends on project/world lifecycle integration and existing runtime/target services.  
**Suggested worker:** later wave.  
**Write surface:** world profile contracts/adapters, runtime/deployment service integration and tests.  
**Deliverables:** game/Spark/interactive experience/twin profiles; progressive Region/Zone/Chunk loading; deploy through registered provider adapters (Vercel/Cloudflare/others); digital twin provenance/freshness.
**Acceptance:** real provider deployment and world streaming tests. No mock provider presented as deployed.

### PX-006 — Platform live/multiplayer/chat/replay/economy integration
**State:** Depends on PX-003 screens and platform service adapters.  
**Suggested worker:** later wave.  
**Write surface:** platform service adapters and typed UI surfaces in disjoint modules.  
**Deliverables:** live player sessions; broadcast start from game/Spark; discovery/chat/moderation; VOD recording; interactive game-state replay; multiplayer/presence; Liquid spending/rewards/entitlements.
**Acceptance:** real authoritative end-to-end session, access/moderation, replay source revision, economy integrity. Distinguish VOD from interactive replay.

### PX-007 — Engine/tool packages and project authoring
**State:** Depends on PX-001 project task flow and current Tool Fabric contracts.  
**Suggested worker:** later wave.  
**Write surface:** engine adapter package and UI tool-panel adapter per engine.  
**Deliverables:** Browser and Terminal reuse from ZCode; installed engine packages/adapters (Unreal, Unity, Godot, PlayCanvas, Blender); task-context authoring panels; build/test/capture/launch/inspect tool operations.
**Acceptance:** at least one fully exercised engine path with real toolchain; all other integrations labeled by actual support status.

### PX-008 — Cross-platform build, install, inspect and release
**State:** TL-owned release workstream, start early enough to identify platform-specific issues; ship continuously.  
**Write surface:** `.github/workflows/**`, desktop target configs, release docs, QA release harness.  
**Deliverables:**
- Linux .deb and AppImage.
- Windows installer (.exe, NSIS or existing configured installer target) and, if supported/tested, portable archive.
- Native OS build runners and launch smoke tests.
- Per-main-commit inspection artifacts with exact SHA.
- workflow_dispatch build of any specified historical SHA.
- checksums, build manifest, install guide and immutable versioned releases.
- keep ZCode updater disabled until safe PlayLiquid update feed exists.
**Acceptance:** user can choose any main commit, retrieve an installable Linux or Windows artifact, verify checksum and launch; successful build is linked to exact source SHA and build evidence.

## Dispatch rule

PX-000 is a hard design/source gate. After PX-000, TL may dispatch PX-001, PX-002 and PX-003 concurrently only if the frozen write surfaces are pairwise disjoint. Then dispatch PX-004..PX-007 according to their actual prerequisites. PX-008 is TL-owned and should be incrementally improved without blocking all UI work; each accepted main commit should have an inspection artifact.

## Status reporting format

For each PX item maintain:
- state: BLOCKED / READY / IN PROGRESS / REVIEW / MERGED / VERIFIED;
- owner, branch and PR;
- exact base/head/merged SHAs;
- changed file list and frozen write surface;
- tests and exact commands;
- browser screenshots/video and runtime logs;
- package/release evidence where relevant;
- environment limitations;
- remaining work and next dependency.

Do not set an item to VERIFIED on the basis of a design mockup, static storybook, fake adapter, green typecheck or report alone.
