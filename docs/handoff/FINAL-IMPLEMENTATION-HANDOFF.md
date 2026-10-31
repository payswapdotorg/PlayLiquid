# Final Tech Lead Handoff — Complete PlayLiquid Product

**Authority:** This document is the complete execution handoff for the next Tech Lead. It is repository-owned and must be sufficient without access to chat history.  
**Repository:** `payswapdotorg/PlayLiquid`  
**Base:** ZCode 3.14.3-derived application + PlayLiquid GameOS  
**Product version at planning baseline:** 3.15.0  
**Planning baseline:** `78f2011595b2575c6eaee486a329bcdb4fae58bd`  
**Current product/design specifications:** `docs/product/PRODUCT-EXPERIENCE-SPEC.md`, `docs/product/FIGMA-IMPLEMENTATION-CONTRACT.md`  
**Work-order authority:** `spec/product-experience/WORK-ORDERS.md`  
**Release authority:** `docs/release/CROSS-PLATFORM-DISTRIBUTION.md`

## 0. Mission and definition of success

Take technical ownership of PlayLiquid and implement the complete product described in the linked repository specifications. Do not stop after a UI refresh, a static prototype, or a collection of typed contracts. Deliver a cohesive, usable desktop product whose user-facing journeys are connected to real services and whose releases can be installed and inspected on Linux and Windows.

The product is a combination of:
1. The complete inherited ZCode application and AI-agent workspace.
2. PlayLiquid's Git-native World Project and reusable package ecosystem.
3. A player/creator discovery and play experience.
4. Shared game platform services (identity, social, live, multiplayer, chat, replay, economy, integrity).
5. Engine/tool orchestration, builds, deployment, streaming and digital-twin support.
6. The Game Engineering Lab and external Arena integrations, exposed contextually rather than as a competing primary shell.

The project is not complete until the acceptance gates in this handoff and each Work Order have source, test, runtime, browser and (where relevant) packaged-build evidence.

## 1. Binding product clarifications

These are explicit product decisions. They override any ambiguous or older wording elsewhere; update the relevant repository docs when implementation uncovers contradictions.

### 1.1 New Task page — exact required controls

New Task is the default task-creation experience and reuses the existing ZCode composer and execution pipeline.

Required layout:
- **Select project dropdown:** visibly placed above the prompt/composer. It is an actual selectable dropdown, not helper text or a decorative label. It supports selecting an existing World Project and the create-new-project path. The selected project is persisted as task context and passed into task creation/branch orchestration.
- **Browser toggle icon:** in the task workspace header at the **top-right**. It toggles the existing ZCode Browser panel.
- **Terminal toggle icon:** beside the Browser toggle in the task workspace header at the **top-right**. It toggles the existing ZCode Terminal panel.
- Both icons expose accessible names, focus/keyboard support, active/inactive state and visible feedback. They must open/close the actual existing panels and preserve their session state.
- These icons must not be placed below the prompt, inside the composer footer, or replaced with text chips.
- Keep existing ZCode plus/attachment, access-level, model selection, send/submit and keyboard behavior intact.

The Figma New Task frame must show the project selector and the two top-right toggles. The current frame is not considered design-complete until those details are visible and verified against the actual Figma source.

### 1.2 World is the umbrella model

A **World** can be:
- a full game;
- a Spark;
- an interactive/social experience;
- a simulation or training environment;
- a digital twin of a real-world place, asset, process or system;
- another future profile supported by the extensible package/profile system.

World is the umbrella semantic and project concept. Its profile(s) describe authoring, runtime, interaction, deployment and presentation. One World may have multiple profiles/entry points (for example, full game + Spark) without duplicating the underlying world, packages, identity or history.

**Spark is not a competing root content type.** Preserve architecture-lock rule #16: Spark is a delivery/runtime target profile with fast vertical/mobile-first presentation and boot characteristics. It can be an entry experience into the same parent World. Do not model Spark as a separate world repository or duplicate its package graph.

A real-world digital twin must distinguish observed, imported, estimated and simulated state; record data source, authorization, timestamps, freshness and provenance. Never present simulated/counterfactual values as real observations.

### 1.3 Everything else in the approved product spec remains in force

The operator explicitly approved the rest of `PRODUCT-EXPERIENCE-SPEC.md` and the proposed product direction. Do not reinterpret or drop other approved scope. Resolve missing details through the repository's Figma/design contract and architecture rules, not by asking the operator to repeat prior decisions.

## 2. Preserve and extend ZCode — do not rebuild it

This is an existing ZCode fork. ZCode remains the sole authority for:
- model/provider routing, credentials, model configuration and model selection;
- task/session/agent runtime, permissions and approvals;
- base desktop/web/CLI infrastructure, RPC, client/server and remote workspace;
- Browser and Terminal tools and their existing panels;
- attachments, access-level selection and task submission;
- Settings, complete Model Provider UX, Search, Automations and Plugin Marketplace;
- existing localization, accessibility and settings persistence.

Audit actual source and tests before modifying these. Preserve provider CRUD, API keys, endpoint/API format, model metadata, context/output limits, modalities, tool support, reasoning settings, sorting, enablement, connectivity checks, templates and entitlement behavior.

PlayLiquid owns GameIR, World/package/avatar semantics, Git-native World Project lifecycle, Capability Broker policy, runtime/simulation/replay contracts, shared game platform services, Tool Fabric, engine adapters, target/build orchestration, provenance/licensing and Lab semantics.

One authority per concern. No second model router, generic workflow engine, agent-session runtime, Browser, Terminal, provider settings or Git/PR authority.

## 3. Complete product journeys

### 3.1 Task creation and agent execution
- New Task is the primary starting view.
- Select a World Project or create a project.
- Create task using ZCode's existing runtime, model, access and attachment systems.
- For project-scoped work, assign an isolated branch/change context according to the project's policy.
- Expose Browser and Terminal through the top-right header toggles.
- Agent work is reviewable; substantial work is not silently merged.
- Tasks are discoverable in recent task history and their project workspace.

### 3.2 World Projects and native Git lifecycle
Implement World Projects as the development home, not a standalone Game Studio dashboard.

A World Project is a durable repository containing World definitions, package graph/lock, target profiles, project config, tests, build/deploy config, lineage and history. Users must be able to work without GitHub:
- create/import/connect/clone/fork a project;
- organize projects in groups;
- branch, commit, inspect status/diffs/history;
- create tasks scoped to project/branch;
- create semantic change proposals/pull requests;
- comment, request changes, approve, merge and view history;
- manage packages, builds, deployments and project settings;
- optionally connect a GitHub or other supported remote.

Reuse ZCode's existing Git CLI service for actual local Git operations where it fits. Connect it to GameOS `git-lineage`, package graph and provenance via explicit adapters. Do not mistake the existing workspace Git UI for a complete World Project authority; do not duplicate Git commands in a new implementation. Implement durable storage and restart-safe state; the current desktop GameOS host uses in-memory adapters in several paths.

A semantic review must show world/region, package/version, avatar/body/intelligence/capability, asset, system/mechanic, policy, license/provenance, simulation/replay, performance and build-target impacts alongside file diffs.

### 3.3 Player and creator experience
Implement the WebFlix-inspired world experience using the approved Figma designs:
- Home with progressive/infinite discovery, Continue Playing, long-form worlds, Sparks and live/replay shelves.
- Real hover gameplay preview, not a slideshow or animated poster.
- Long-form Play page with an interactive world/player area, creator actions, details, comments, related worlds and supported multiplayer/replay actions.
- World Details page with actual world profile, compatibility, package/features, releases, creator and real metrics.
- Sparks vertical 9:16 feed: selected Spark plays in-feed; scroll/swipe advances; do not navigate away to a separate game page just to play.
- Your Channel, Subscriptions, Liked Games/collections, Live & Replays and Live Player/Start Live.
- Real loading, empty, error, permission and unavailable states. No fabricated counts, online states, ratings or engagement.

WebFlix is a behavior/design reference. Reuse its code only after a verified license or written authorization. If rights are not established, implement clean-room equivalents; do not import unrelated video-platform backends.

### 3.4 Platform services
Wire the domain packages to actual service adapters and UI:
- identity/profile/channel/follow/subscription;
- social/comments/reactions/share;
- multiplayer/presence/matchmaking;
- live-session discovery, streaming integration and moderation;
- VOD recording and playback;
- authoritative interactive session replay (distinct from VOD);
- leaderboards, achievements, tournaments;
- Liquid economy, rewards, entitlements and settlement;
- cloud save, analytics and integrity/anti-abuse.

Client state is not authoritative for protected rewards, competition outcomes or economy settlement. Game packages declare capabilities/policies; shared platform services enforce them.

### 3.5 World runtime, engines, tools, build and deployment
- Use GameIR and package graph as semantic/composition authorities.
- Use Capability Broker for runtime permission decisions.
- Register actual Tool Fabric adapters; an executor that refuses due to no adapters is honest but not a completed integration.
- Integrate Unreal, Unity, Godot, PlayCanvas and Blender through provider-neutral adapters, prioritizing mature existing tools and open-source projects.
- Native engine projects remain native projects.
- Implement web, Spark, desktop, mobile and server targets as supported by actual toolchains; gate XR/console on authorized SDKs.
- Progressive World → Region → Zone → Chunk streaming.
- Real deployment adapters for supported providers (e.g. Vercel, Cloudflare); never show a fake successful deployment.
- Digital-twin data connectors must enforce authorization and freshness/provenance.

### 3.6 Lab and Arena
Keep Lab as the research/learning capability that learns which organizations, tools, packages and workflows produce the best outcomes for a particular task and context. Keep Arena as an external human-capability provider. Expose them contextually in project/task/tool journeys. Do not replace the approved primary task/project/player information architecture with Lab/Arena dashboards.

## 4. Figma/design completion gate

Figma: https://www.figma.com/design/LWlycZ5B3vCrUZ0a4pnu5u

The New Task frame (node `6:3`) must visibly include:
1. Select project dropdown above composer.
2. Browser toggle icon in top-right task workspace header.
3. Terminal toggle icon in top-right task workspace header.

Complete the outstanding page for:
- Your Channel;
- Subscriptions;
- Liked Games;
- Live & Replays;
- Live Player / Start Live.

Preserve all already-approved screens and theme. Pin exact node/frame IDs, screenshots and design version in the repository before dispatching corresponding UI work. Do not claim Figma was updated unless the file was actually changed and visually inspected. The prior connected Figma session hit a Starter-plan request limit; the design gate remains open until a designer/authorized Figma session completes it.

## 5. Architecture and source audit — mandatory before implementation

Read `AGENTS.md`, `AI_CONTINUATION.md`, `README.md`, `spec/PROJECT-STATE.md`, `spec/architecture.md`, `spec/architecture-lock.md`, `spec/requirements.md`, all product docs and the exact Work Order.

Inspect and document:
- desktop host composition and persistence adapters;
- `packages/desktop/src/renderer/src/gameos/**`;
- `packages/game-ui/**`, `packages/web/gameos-lab/**`, `packages/web/gameos-community/**`;
- all GameOS package contracts, implementations and tests;
- ZCode New Task/composer, settings/model providers, Search, Automations, Marketplace, group/project/sidebar, Browser, Terminal and Git service/UI;
- current build scripts, electron-builder config, release workflow, desktop QA and Windows packaging hooks;
- WebFlix code rights and reusable behavior;
- current Git branches, PRs, commits and CI state.

The shipped GameOS host has typed services but several in-memory stores and incomplete integrations. The journey map lists unsupported operations such as desktop project creation/import, UI package publication/composition, interactive sessions, engine registration/dispatch, desktop replay and target builds. Re-verify each item in current source; do not repeat old status as current without inspection.

## 6. Execution plan and worker governance

Use `spec/product-experience/WORK-ORDERS.md` as the authoritative ledger. Maximum three concurrent workers. One Work Order = one worker = one branch = one PR = one frozen write surface. Workers do not merge. TL owns root manifests/lockfiles, central composition, shared contracts, program state, CI/release integration and final merges.

Recommended phases:
1. PX-000: close product/design/source/rights gate; freeze all contracts.
2. PX-001: ZCode-preserving product shell and exact New Task layout/behavior.
3. PX-002: durable World Project lifecycle, Git and semantic PR/review.
4. PX-003: player/discovery/social screens and actual view-model actions.
5. PX-004: gameplay hover-preview media pipeline.
6. PX-005: World profiles, streaming, deployment and twin connectors.
7. PX-006: live/multiplayer/chat/VOD/replay/economy integration.
8. PX-007: engine/tool packages and project authoring.
9. PX-008: continuous Linux/Windows inspection build/release infrastructure.

After PX-000, PX-001/002/003 may run concurrently only with pairwise-disjoint write surfaces and stable contracts. PX-008 is TL-owned and starts early; it must not wait until the whole product is done.

Each PR must include exact base/head SHA, file list, tests and commands, screenshots/video, runtime logs, package evidence, environment limitations, journey-map updates and next dependency. A green typecheck, mock, static frame, contract-only package or agent report is not acceptance.

## 7. Cross-platform inspectable releases — mandatory

The user must be able to inspect the application without cloning or building the repository.

Required:
- Linux x64: .deb and AppImage.
- Windows x64: PlayLiquid-branded NSIS installer .exe; optional portable archive only after verification.
- Native Ubuntu and Windows runners.
- On every successful main commit, build both platforms and upload installable workflow artifacts with source SHA, version, platform, architecture, checksums and manifest.
- Manual workflow accepts an exact commit SHA or immutable tag and rebuilds that exact revision on both platforms.
- Verify checked-out HEAD equals the requested SHA; never silently build a different revision.
- Provide immutable versioned GitHub Releases with both OS assets after full package-launch acceptance.
- Workflow artifacts are for convenient recent inspection; historical SHA rebuild handles expiration.
- README links latest stable release and explains how to download artifacts from a commit's Actions run or trigger an exact-SHA inspection build.
- Keep PlayLiquid app IDs, executable, package identity, protocols and user-data roots isolated from ZCode. Keep inherited ZCode updater disabled until a PlayLiquid-owned signed update feed exists.
- Generate SHA256SUMS and machine-readable build manifest (source SHA, version, OS/arch, artifact name/size/digest, run URL, Node/pnpm/Electron/toolchain versions).
- Windows install/uninstall, Start Menu, clean launch, second launch and ZCode coexistence must be tested. State unsigned SmartScreen warning honestly if code signing is not configured.
- Linux package launch must reuse/extend `qa/desktop-release` harness. A compile alone is not launch evidence.

The current published baseline is Linux-only. Do not tell the user Windows is available until a Windows asset has been produced and a native Windows launch test passes.

## 8. Final definition of done

The complete product is accepted only when:
- New Task matches Figma and the project selector + Browser/Terminal top-right toggles operate real services.
- ZCode settings/provider/task/search/automation/plugin/browser/terminal functionality is preserved.
- World is the umbrella model; game, Spark, experience, simulation/training and digital twin profiles work without duplicated world identity.
- A user can create a World Project, add packages, create a task, branch, commit, review semantic PR, approve/merge and deploy without GitHub.
- Home/Play/Sparks/World Details/Channel/Subscriptions/Liked/Live/Replays journeys are functional and use real state.
- At least one end-to-end runtime/engine path works with actual toolchain and evidence; unsupported integrations are honestly labeled.
- Platform services have real adapters and authoritative state, with VOD distinguished from interactive replay.
- Build/deployment/streaming and twin data have provenance and tests.
- Linux and Windows installable inspection artifacts are available for every successful main SHA, with exact provenance and checksums; historical SHA can be rebuilt.
- CI, unit/integration, browser, packaged-app and platform-native smoke tests pass.
- Documentation and journey map match actual source behavior.

## 9. TL's first actions

1. Verify this handoff branch/PR and merge or amend the documentation/workflow changes; do not assume it is already on main.
2. Inspect the new `playliquid-inspection-builds.yml` workflow on a real GitHub Actions run. Fix any build/runner issues and add native Windows install/launch validation before calling Windows inspection support complete.
3. Finish the Figma New Task controls and missing Channel/Subscription/Library/Live/Replays designs; pin screenshots and node IDs.
4. Audit WebFlix rights and current ZCode UI/source.
5. Re-baseline each PX work order against live source and dispatch no more than three workers.
6. Start continuous cross-platform artifacts now; deliver the first Linux and Windows inspectable build before major UI work merges.
7. Keep main, work-order ledger, journey map, releases and exact SHAs continuously synchronized.

**Do not ask the operator to repeat the decisions in this handoff.** Resolve ordinary implementation details from source, Figma, architecture and tests. Escalate only genuine blockers such as missing legal authorization, unavailable SDKs, design approval or secrets that cannot be supplied by repository configuration.
