# FINAL TECH LEAD HANDOFF — PLAYLIQUID PRODUCT EXPERIENCE AND FULL IMPLEMENTATION

**Repository:** `payswapdotorg/PlayLiquid`  
**Base main SHA:** `78f2011595b2575c6eaee486a329bcdb4fae58bd`  
**Current product release:** `playliquid-gameos-v3.15.0`  
**Product direction authority:** [PRODUCT-EXPERIENCE-SPEC.md](../product/PRODUCT-EXPERIENCE-SPEC.md)  
**Figma authority:** [FIGMA-IMPLEMENTATION-CONTRACT.md](../product/FIGMA-IMPLEMENTATION-CONTRACT.md)  
**Release authority:** [CROSS-PLATFORM-DISTRIBUTION.md](../release/CROSS-PLATFORM-DISTRIBUTION.md)

This handoff is self-contained when read together with the repository documents linked above. It supersedes earlier chat-only design interpretations and the old Game-Studio-primary UX direction. Existing PL-001..PL-045 architecture/program history remains intact; this is a new post-program product UX/integration workstream, not a rewrite of historical completion records.

## 1. Mission

Deliver the complete PlayLiquid user experience by extending the existing ZCode fork.

PlayLiquid is a project/task-centered environment for creating and running digital worlds. A world can be a game, Spark experience, interactive experience, simulation, training environment, real-world digital twin or future world profile. Everything reusable is a package. Every World Project has a Git lifecycle. ZCode remains the task, model/provider, agent and tool foundation.

The result must let users create and operate worlds from PlayLiquid without needing to visit GitHub for ordinary project work. GitHub is an optional connected remote. The complete experience includes creation, project organization, package composition, pull requests, deployment, discovery, gameplay, subscriptions/channels, live, chat, replay and shared game-platform services.

**Do not build the application described in chat. Build the product described by the repository's product spec and approved Figma frames.**

## 2. First action: recover and verify the repository state

At the current main base:
- `AGENTS.md` is the repository agent contract.
- `AI_CONTINUATION.md` defines the recovery order.
- `spec/PROJECT-STATE.md` records the completed 45-work-order GameOS program and its actual limitations.
- `docs/ux/JOURNEY-MAP.md` records the current desktop journeys and explicitly unsupported UI operations.
- `packages/desktop/src/renderer/src/gameos/shell/product-shell.tsx` currently mounts Game Studio/Lab/Community as the primary shell workspaces, with AI & Agents as a secondary route. This no longer matches the product direction.
- `spec/ux/work-items.md` records the prior Game-Studio/Lab/Community shell UX contract. That old UX contract must be superseded by a new post-program workstream; do not rewrite its historical completion evidence.

Before touching code:
1. Read `AGENTS.md`, `AI_CONTINUATION.md`, `README.md`.
2. Read `spec/PROJECT-STATE.md`, `spec/architecture.md`, `spec/architecture-lock.md`, `spec/requirements.md`, `spec/dependency-graph.md`, `spec/module-dependency-matrix.md`, `spec/work-items.md`, `spec/worker-contract.md`.
3. Read [PRODUCT-EXPERIENCE-SPEC.md](../product/PRODUCT-EXPERIENCE-SPEC.md) and [FIGMA-IMPLEMENTATION-CONTRACT.md](../product/FIGMA-IMPLEMENTATION-CONTRACT.md).
4. Read the previous `docs/handoff/FINAL-TECH-LEAD-HANDOFF.md` and `docs/handoff/EXECUTION-PLAN.md) for program history, but this new handoff controls new product UX decisions.
5. Read `docs/ux/JOURNEY-MAP.md` and inspect actual source, tests, PRs, releases and current main SHA.
6. Run the current baseline checks and capture the existing app's actual behavior before changes.

Actual source, tests, runtime and package evidence outrank summaries. Do not treat a previous chat or worker report as a repository requirement.

## 3. Architecture is frozen unless an explicit ACR is approved

Do not create a parallel authority for anything already owned by ZCode or GameOS.

Preserve:
- ZCode model/provider/settings and task/session runtime;
- GameIR;
- Package Graph and registry/CAS;
- Git lifecycle and lineage;
- Capability Broker;
- Interactive Runtime and Simulation Runtime distinction;
- platform service contracts;
- Tool Fabric;
- replay;
- Lab evidence/learning authority;
- Arena as an external human capability provider.

No second workflow engine, model router, package registry, Git/PR authority, world state authority or game platform service stack.

Use the current registered domain packages and typed ports where they have the required authority. If the desktop host currently composes only a read-only port or unavailable executor, do not fake a production action through a UI-only state change. Define the missing typed intent/command, host wiring, persistence and tests under a separately approved architecture change if required.

## 4. Preserve ZCode capabilities — regression gate

Do not delete or recreate ZCode features to make the PlayLiquid shell easier.

Keep the complete existing Settings page and provider system. Preserve:
- built-in/custom providers;
- credentials and API keys;
- base URLs and API formats;
- provider connection/access modes;
- adding/editing/deleting models;
- model metadata and capability overrides;
- context/output token properties;
- text/image/video/audio/PDF modality support where existing contracts provide them;
- tool-call support;
- reasoning-level editors;
- model ordering, enablement, connectivity tests;
- provider templates, auth/account entitlement and refresh flows;
- model selection in New Task and running sessions.

Protect the existing ZCode New Task implementation, file attachment, access controls, model selector, task submission and execution path. Adapt its visual shell but retain the behavior and services.

Preserve Search, Automations, Plugin Marketplace, Groups/Projects, task list/history, Browser and Terminal panels, permissions and approvals.

Create regression tests against the current ZCode fork for these features before UI integration. Include at least one real persisted provider/model configuration and a task run with the selected model. Verify settings/configuration survive update/upgrade and existing profiles are not reset.

## 5. Product navigation and UI implementation

Follow [FIGMA-IMPLEMENTATION-CONTRACT.md](../product/FIGMA-IMPLEMENTATION-CONTRACT.md) exactly.

The primary left navigation is:
- New Task
- Search
- Automations
- Plugin Marketplace
- Group / Project selector and project/group tree
- Tasks and recent history
- Home
- Sparks
- Subscriptions
- Live & Replays
- Your Channel
- Liked Games
- Account / Settings

No standalone Game Studio dashboard as the required development entry point. Development happens inside a World Project and its task workspace. Existing Game Studio domain logic/components may be reused behind project/package/tool pages where appropriate; do not delete useful services just because the standalone dashboard is no longer the primary UI.

### New Task: exact mandatory controls

The default screen must remain simple and ZCode-like, using the PlayLiquid theme.

- A real **Select project** dropdown is visible immediately above the composer. It offers create-new-world-project and existing project selection.
- Existing project selection establishes branch/change-proposal context.
- Existing `+` file/context attachment control remains.
- Existing access-level dropdown remains.
- Existing model dropdown remains and uses ZCode provider/model services.
- Existing send/submit/keyboard behavior remains.
- Browser and Terminal have toggle icons at the **top-right of the task workspace header**. These are real toggles connected to the existing ZCode Browser and Terminal panels.
- Engine icons can appear beside these later only when a corresponding Tool Fabric adapter/package is installed and available.
- `@` package/project context, `/` commands and a tool/capability picker expose advanced world/asset composition without cluttering the default screen.

The New Task controls must not be placed below the composer when Figma explicitly requires them in the top-right header.

### World Projects

Implement project listing and project workspace from the Figma:
- world/package projects;
- groups and sharing;
- project metadata and profile;
- tasks and branch context;
- package graph;
- commits and semantic pull requests;
- build/deploys;
- activity and collaborators;
- optional GitHub remote connection.

A developer can create, review and merge native PlayLiquid changes inside PlayLiquid. No GitHub account should be necessary for native projects. Use provider-neutral remote interfaces when connected to GitHub or another host.

### Player/discovery UX

Reuse WebFlix's visual and interaction patterns:
- Home feed with Continue Playing, long-form landscape cards, vertical Sparks shelves, categories, live/replay shelves and infinite loading;
- real hover-to-play video preview inside game/world cards;
- long-form Play page;
- vertical Sparks page;
- world/game details;
- Your Channel;
- Subscriptions;
- Liked Games;
- Live & Replays;
- live playback, chat and Start Live flow.

The New Task and project pages are explicitly not substitutes for the player-facing experience.

## 6. World/package semantics

World is the umbrella project/semantic model. A World Project is a Git repository containing a versioned composition of packages and target profiles.

Supported profiles should be extensible to games, Spark delivery, interactive experiences, simulations/training and real-world digital twins. Spark remains consistent with architecture lock #16: a delivery/runtime target profile, not a separate root content model.

All independently reusable pieces are packages:
- world/region packages;
- environments;
- characters and avatar body/intelligence;
- meshes/materials/animation/audio/VFX;
- gameplay systems and rules;
- tools/skills;
- tests/simulations/evaluations;
- build/deployment profiles.

Packages are independently developed, versioned, licensed, provenance-tracked and composed into one or more worlds. Large binary assets remain in CAS/object storage, referenced from Git package manifests.

A task can build a complete world or a single reusable package. The same task/agent runtime should be capable of composing several independently produced packages into a project.

## 7. Git-native project workflow

New project:
1. Create World Project and repository identity.
2. Choose/create a world profile (game, Spark-enabled, interactive experience, twin, etc.).
3. Create initial project structure and package graph.
4. Assign agent tasks and contributors.
5. Commit and publish the first project revision.

Existing project task:
1. Select project in New Task.
2. Create/select an isolated branch.
3. Give the agent the correct project revision and package context.
4. Run task through the ZCode runtime.
5. Record file/package/world changes.
6. Produce commits and a semantic change proposal/PR.
7. Run required checks (license/provenance, package dependencies, world schema, tests/simulation/replay, performance, target compatibility).
8. Review/comment/request changes/approve/merge inside PlayLiquid.
9. Update project revision and package lock after merge.
10. Synchronize an optional connected Git remote.

Never silently claim that internal Git/PR operations are supported if the current Git lifecycle service lacks a required create/branch/commit/push/review/merge door. Add the typed contract/service integration and tests first.

## 8. WebFlix reuse

Inspect WebFlix-2.0 component code and its dependency graph:
- app shell/sidebar/topbar;
- home-feed, rails and Shorts shelves;
- video cards and hover-preview layer;
- Shorts feed/engagement rail;
- watch page/actions/comments;
- channel pages;
- Creator Studio / analytics / moderation patterns.

Prefer actual source/component reuse when code rights permit and the code is compatible. The WebFlix repository's public visibility does not itself grant permission to copy; its root-level license was not established during the source review. Obtain explicit authorization or verify an appropriate license first. Otherwise, implement a clean-room equivalent guided by its behavior and Figma. Do not copy its YouTube/Netflix integrations, credentials, backend adapters, server actions or user identity assumptions.

Create `docs/product/WEBFLIX-REUSE-MAP.md` during implementation with source paths, exact source commits, ownership/license evidence, reused/ported files, modifications and excluded backend dependencies.

## 9. Hover-to-play world thumbnails

Implement one shared preview manager for feed cards.

- Static poster first.
- Desktop fine-pointer dwell approximately 450–600 ms.
- Play a real, muted, inline gameplay-preview video inside the hovered card.
- Mute and progress/scrub controls if appropriate.
- One active preview player at a time.
- Clean stop/dispose on pointer exit and card switch.
- Preserve link navigation.
- No hover playback on touch devices; provide explicit preview action.
- Respect reduced motion.
- Real preview clip or static poster fallback only. Never a fake animated slideshow.

Generate previews from actual game builds/sessions using a controlled capture workflow. Store poster and video assets outside ordinary Git history in content-addressed/object storage. Record source revision, digest, codec, dimensions, duration, orientation, license and provenance. Do not boot the full engine for card hover.

## 10. Sparks

Sparks are a fast 9:16 delivery/experience profile of a world.

- Active Spark starts loading/playing automatically.
- No additional Play button is required.
- Game interaction takes place in the Shorts/Sparks feed.
- Next/previous navigation stays inside the feed.
- Comments, likes, creator follow and share remain within the experience.
- An explicit Open Full World action may navigate to its parent world.
- Optimize first interaction through a minimal shell, cached first region/assets, progressive streaming and prefetch of the next Spark.
- Prevent simultaneous heavy boot of multiple Sparks.

## 11. Live, social and replay

Integrate platform services; do not create per-game versions.

- creator channels, follows/subscriptions and liked/saved content;
- live browsing and live status;
- live gameplay/Spark broadcast creation;
- live chat, reactions, invites and moderation;
- stream recording and replay/VOD;
- interactive game/session replay where supported;
- links from replays to source world revision and creator channel.

Distinguish audiovisual VOD from deterministic/replayable world event state. Preserve source version and provenance for replay.

## 12. World runtime, deployment and streaming

World can have multiple runtime targets. Deploy through registered provider adapters selected by the developer (Vercel, Cloudflare or other available provider). Build from pinned GameIR/package-lock/profile/toolchain, output immutable artifact + manifest + provenance/verification.

Partition worlds World → Region → Zone → Chunk. Load/prefetch relevant sections as users explore. Use the existing streaming/runtime contracts where available; extend with typed contracts only when needed.

Digital-twin adapters must preserve data-source identity, timestamps, update cadence, freshness, provenance and observed-vs-simulated distinction.

## 13. Implementation workstreams and concurrency

Respect `AGENTS.md`: maximum three concurrent workers, one worker/branch/PR/frozen write surface, no worker self-merges. TL owns shared files and integration.

Use the new post-program workstream ledger `spec/product-experience/WORK-ORDERS.md`.

Suggested sequence:

### Phase 0 — Spec/Figma/source freeze (TL-owned; no feature coding)
- Finish Figma New Task correction and Channel/Subscription/Liked/Live/Replays design page.
- Pin exact Figma frame IDs and screenshot exports.
- Audit current ZCode sidebar/task/settings/tool implementations.
- Audit WebFlix components and code ownership/license.
- Create ZCode preservation test inventory.
- Update product UX contracts and acceptance harness so the old Game Studio/Lab/Community shell contract is explicitly superseded for new UX.
- Record source SHA and implementation base.

### Phase 1 — ZCode-first shell and New Task
Worker A owns the product shell/navigation/New Task design integration and responsive behavior.
Preserve existing Settings/Model Provider functionality, Automations, Marketplace, Search, Groups/Projects, Browser/Terminal and tasks. Add regression tests.

### Phase 2 — Project-first world development
Worker B owns World Projects, group/project selection, project workspace, package composition and semantic PR/change review. Integrate existing Git lineage/package services; create missing typed commands/services only via the governed process.

### Phase 3 — WebFlix-derived player/social surfaces
Worker C owns Home, cards, Play, Sparks, World Details, channels, subscriptions, liked games, Live & Replays and channel/live screens. Audit WebFlix licensing and reuse map before porting components.

### Phase 4 — Platform/runtime integration
After Phase 1–3 interfaces are pinned, TL dispatches up to three disjoint work orders:
- world runtime/target profile/region streaming/deployment;
- platform multiplayer/live/chat/social/economy/replay service wiring;
- engine/Tool Fabric authoring and game-preview capture/media pipeline.

Keep scopes disjoint and contracts stable. The same existing ZCode agent runtime executes development work.

### Phase 5 — Cross-platform release and end-to-end acceptance
- build and test Linux + Windows installable packages;
- exercise project/task/package/PR/play/Spark/live/replay journeys;
- verify existing ZCode settings/provider and agent flows;
- run screenshot fidelity, accessibility, responsive, performance and security suites;
- publish immutable versioned releases with checksums and exact source SHA.

## 14. Required repository records

Maintain these current files:
- `docs/product/PRODUCT-EXPERIENCE-SPEC.md` — product truth.
- `docs/product/FIGMA-IMPLEMENTATION-CONTRACT.md` — Figma screen truth.
- `spec/product-experience/WORK-ORDERS.md` — dependency/worker/status ledger.
- `docs/product/WEBFLIX-REUSE-MAP.md` — code reuse/rightsholder/commit record.
- `docs/release/CROSS-PLATFORM-DISTRIBUTION.md` — install/release truth.
- `docs/progress/PRODUCT-EXPERIENCE-STATUS.md` — current completion state.
- `docs/verification/PRODUCT-ACCEPTANCE-REPORT.md` — exact test/runtime/browser/build evidence.

Update `README.md`, `AGENTS.md` and `AI_CONTINUATION.md` to link these documents. A fresh agent must be able to restart from repository files alone.

Every Work Order must include:
- base SHA;
- exact frozen write surface;
- required contracts and non-goals;
- tests/commands;
- UI frames;
- real runtime/browser evidence;
- known limitations;
- commit SHA and PR URL.

## 15. Acceptance gates

### ZCode preservation
- Complete Settings page accessible and functional.
- Existing Model Provider features and credentials work.
- Model configuration persists across app restart/update.
- New Task uses existing model resolver and task runtime.
- Existing attachments, access level, Search, Automations, Plugin Marketplace, Browser, Terminal and task history work.
- No second model/provider/workflow/agent authority introduced.

### New Task / project workflow
- Project dropdown visible above composer.
- New project and existing project selection both work.
- Browser and Terminal toggles appear at top-right and open the existing panels.
- Attachments, access and model selectors work.
- Task execution uses ZCode's runtime with selected project context.
- Existing project task produces a branch and reviewable change proposal/PR.
- Native project workflow works without GitHub; connected remote sync works when configured.

### Project/package
- World profile is extensible; game/Spark/experience/twin are representable.
- Every reusable item can be a versioned package.
- Packages can be independently composed into multiple worlds.
- Semantic PR review is correct and backed by actual diffs/provenance/checks.
- Build/deploy UI maps to actual registered adapters.

### Discovery/play
- Home has Continue Playing, long form, Sparks, live and replays.
- Card preview plays real gameplay video after hover dwell.
- One preview at a time; no slideshow; honest fallback.
- Play opens the actual interactive world at the correct revision.
- World details and creator/channel actions are functional.

### Sparks
- Start playback on activation without Play click.
- Stay in Sparks feed while playing.
- Next/previous navigation and engagement work.
- Parent-world navigation is explicit.
- First-interaction metrics are measured on representative devices/networks.

### Channel/social/live/replay
- Your Channel, Subscriptions, Liked Games and Live & Replays work.
- User can start a live from a supported game/Spark session.
- Others can discover/watch and chat.
- Completed broadcasts appear as VODs.
- Interactive state replay remains separately typed and source-versioned.

### World operations
- Registered engines are usable through Tool Fabric.
- Region/zone/chunk loading is proven with tests/telemetry.
- Deployment to each advertised provider is actually verified.
- Digital twin source data/provenance/freshness is truthful.
- Shared multiplayer/chat/economy/replay services own the authoritative operations.

### Build/install
- Linux .deb + AppImage and Windows installer are downloadable per successful main commit/inspection build.
- Windows and Linux package launch tests pass on native runners.
- Each artifact carries SHA256 and exact source commit.
- Historical exact commits can be rebuilt by workflow_dispatch using SHA.
- No ZCode updater can replace PlayLiquid; update-feed policy remains safe.
- Installed PlayLiquid coexists with ZCode and retains independent app identity/data.

A feature is not GREEN because a static UI exists, a typecheck passes, or a domain package exists. Source + tests + runtime + browser + target-specific deployment/package evidence must agree.

## 16. TL final instruction

Preserve ZCode. Reuse WebFlix where authorized. Follow Figma exactly. Make projects and tasks the developer workspace. Treat worlds as the umbrella form spanning games, Sparks, experiences, twins and future profiles. Make package composition and semantic Git/PR work accessible without GitHub. Keep the entire process independent of this handoff's origin: repository docs, source, tests and evidence are the only durable authorities.
