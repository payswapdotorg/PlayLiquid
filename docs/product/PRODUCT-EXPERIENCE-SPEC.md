# PlayLiquid Product Experience Specification

**Status:** Operator-approved product direction; implementation must follow the Figma gate in [FIGMA-IMPLEMENTATION-CONTRACT.md](FIGMA-IMPLEMENTATION-CONTRACT.md).  
**Repository:** `payswapdotorg/PlayLiquid`  
**Baseline reviewed:** `4ebcc66a6148af3c7de6689ee9664befd308953e` (2026-10-24)  
**Design source:** [PlayLiquid Figma concept](https://www.figma.com/design/LWlycZ5B3vCrUZ0a4pnu5u)

This document is the durable product contract. It must be sufficient for a new Tech Lead or worker to understand the product direction without access to any chat history.

## 1. Product definition

PlayLiquid is a Git-native, package-native, AI-native platform for creating, composing, publishing, discovering, playing and collaborating on digital worlds.

A world may be expressed as:
- a full game;
- a Spark (a fast, vertical, instantly playable presentation/target of a world);
- an interactive or social experience;
- a simulation or training environment;
- a digital twin of a real-world place, asset, process or system;
- another future world/experience profile supplied through the extensible profile and package system.

**World is the umbrella semantic/project concept.** The chosen world profile describes how that world is authored, run, presented and delivered. Preserve the existing architecture rule that Spark is a delivery/runtime target profile, not a second content model. A world can have multiple profiles or entry experiences (for example, a full game plus a Spark entry point) without duplicating its underlying world or packages.

The platform should support worlds built with different engines, tools and agent harnesses. Using PlayLiquid makes the project native to the PlayLiquid ecosystem by adopting its package contracts, GameIR/interchange, capability policies, Git lifecycle, runtime interfaces and platform-service integrations. It must not be a prerequisite that every world is authored by PlayLiquid's own agent harness.

## 2. Non-negotiable foundations

### 2.1 Preserve ZCode; do not rebuild it

This repository is already a ZCode fork. Continue from the complete ZCode-derived foundation. Do not start a separate application or recreate existing infrastructure.

ZCode remains the sole authority for:
- AI workspace/session and agent runtime;
- model/provider routing and model selection;
- credentials and provider configuration;
- base desktop/web/CLI infrastructure;
- existing RPC, client, server, host and remote-workspace services;
- existing Browser and Terminal tools;
- existing permissions, approval and task execution systems;
- existing Automations and plugin/UI-plugin infrastructure;
- existing settings, localization, accessibility and update/packaging primitives where applicable.

The product must preserve all ZCode features unless a documented, approved compatibility change is necessary. Rebranding, changing navigation or moving an entry point is not permission to delete the underlying feature.

**Settings are preserved, not redesigned into a second system.** Retain the existing Settings page and the complete Model Provider experience: built-in/custom providers, API keys/credentials, endpoints, API formats, provider modes/access, model CRUD, model metadata, context/output token configuration, modalities, tool-call support, reasoning levels, sorting, enablement, connectivity tests, provider templates, model selection and entitlement behavior. Preserve existing persistence and account/workspace boundaries. Do not copy only the React form while replacing its services.

**The ZCode New Task composer is the starting point for PlayLiquid New Task.** Reuse the existing composer, attachment flow, access-level selector, model selector, task submission and task execution paths. Extend them with PlayLiquid project/package context; do not create an independent agent runtime.

Relevant source areas to audit before changing UI:
- `packages/ui/src/settings/**`
- `packages/ui/src/settings/model-provider-section/**`
- existing New Task/task composer and task/session UI under `packages/ui/src/**`
- Browser/Terminal panes and tool registration paths;
- Automations and plugin marketplace paths;
- project/group/sidebar navigation and persistence paths.

### 2.2 Everything reusable is a package

Every independently reusable or versionable component is a package with identity, version, content digest, dependencies, capabilities, permissions, license, provenance, compatibility, resource requirements and lineage.

Examples include:
- worlds and world regions;
- characters and avatars;
- avatar bodies, rigs, intelligence, skills and memory modules;
- assets, meshes, materials, textures, audio, animations and VFX;
- environments, biomes, props and buildings;
- gameplay systems, rules, mechanics and interactions;
- tools, engine adapters, workflows and agent skills;
- simulations, tests, evaluations and deployment profiles.

Packages can be created independently and composed into one or more worlds. One package should not need to be copied into each world that uses it. Use the existing Package Graph, registry, content-addressed artifact store and package lock contracts.

An avatar remains `Avatar = Body + Intelligence`. These can be authored independently and composed. Capability Broker restrictions apply when an avatar or agent acts inside a world.

### 2.3 A world is a Git-native project

A World Project is a versioned repository with a package graph, world definition, project configuration, target profiles, build/deployment configuration, tests and history.

The developer should not need to use GitHub to work effectively in PlayLiquid.

PlayLiquid provides an intuitive project-native interface over Git semantics:
- project creation/import;
- groups and project organization;
- branches and commits;
- tasks scoped to a project and branch;
- diffs and change summaries;
- pull requests / change proposals;
- reviews, requested changes and approvals;
- merges and version history;
- forks, overlays and lineage;
- releases, builds and deployments.

A task assigned to an existing project works on an isolated change branch. Completed work becomes a reviewable change proposal/pull request. Never silently merge substantial agent work without the configured review/approval policy.

A new project creates a new World Project/repository (or connects an existing repository). A project can optionally connect a GitHub remote. GitHub is an optional remote integration, not the canonical user interface and not a prerequisite for native PlayLiquid projects. Use the repository's existing Git lifecycle authority; do not introduce a second Git or PR authority.

A package can be developed in its own package project/repository and then referenced by multiple world projects.

## 3. Product information architecture

There is no separate Game Studio dashboard as a mandatory product workspace. **The project workspace is where development happens.** The existing GameOS domain capabilities remain available contextually inside projects, tasks and tools.

### 3.1 Primary left navigation

Preserve the familiar ZCode left-sidebar interaction model, visually restyled using the current PlayLiquid theme.

Top-level entries:
1. New Task
2. Search
3. Automations
4. Plugin Marketplace

Then a compact Group / Project mode switch:
- Groups organize projects and teams.
- Projects list the user's world projects and package projects.
- Tasks are visible under the relevant projects and in recent task history.
- Users can create a group, create a project, join a shared project and change the active context.

Discovery and social:
- Home
- Sparks
- Subscriptions
- Live & Replays
- Your Channel
- Liked Games

Also preserve access to:
- Playlists / collections;
- History / recently played;
- saved / watch-later experiences;
- Account and Settings.

Use sensible grouping, collapsible sections and an overflow strategy for smaller desktop/mobile widths. New Task, Search, Automations, Plugin Marketplace and project/group navigation must not disappear behind a secondary "AI & Agents" escape hatch.

The exact order and responsive collapse behavior are shown in Figma and must be locked there before implementation.

### 3.2 New Task — ZCode-native, PlayLiquid-aware

The New Task page should remain minimal, like ZCode's existing first-run composer. It must not become a dashboard or a form containing every possible game feature.

Required layout and controls:
- a clearly visible **Select project** dropdown above the prompt/composer;
- dropdown actions to create a new World Project or select an existing project/group context;
- when an existing world project is selected, a task branch/change proposal is the default project lifecycle;
- a central prompt composer with the existing ZCode placeholder/interaction behavior;
- the existing **+** attachment control;
- the existing access-level dropdown;
- the existing model selection dropdown, populated by the existing ZCode provider/model services;
- send/submit control and keyboard behavior;
- **Browser toggle icon at the top-right of the task workspace header**;
- **Terminal toggle icon at the top-right of the task workspace header**;
- visible active/inactive state and accessible names for both tool toggles;
- the corresponding existing Browser and Terminal panels, not new substitutes.

The project selector is an actual dropdown, not static helper text. The browser and terminal toggles are actual toggles in the top-right header, not chips below the prompt.

Future engine/tool icons may join that top-right tool area when corresponding adapters are installed and registered. Do not show a fake engine launcher. Engine tools must be exposed through the existing Tool Fabric / plugin and capability contracts.

Keep the default composer uncluttered. Give advanced authoring capabilities through:
- existing ZCode `@` context and `/` command patterns;
- package/world reference selection;
- tool and capability picker;
- installed engine/editor panels;
- task-level tool access and permissions;
- project-aware context.

A task can request creation or modification of any package kind. It can also request composition of multiple packages into a world. The user must not have to navigate to a separate Game Studio dashboard before an agent can build a character, avatar, asset, environment, system or world.

### 3.3 World Projects and project workspace

The World Projects page is the project discovery/organization page, not a separate Studio dashboard.

It must support:
- world projects and package projects;
- group membership and sharing;
- project visibility and connected Git remote status;
- project thumbnail/icon and world profile (game, Spark, experience, digital twin, etc.);
- project summary, contributors and recent activity;
- package count and dependency/lineage summary;
- active tasks and pending change proposals;
- recent build/deployment state;
- create, import, clone/fork and connect remote flows where actually supported.

A project workspace has contextual tabs or equivalent navigation:
- Overview
- Tasks
- Pull Requests / Change Proposals
- Packages
- Builds & Deployments
- Activity
- Settings / access control

The package composition graph should make it possible to inspect which packages make up the world and which dependants will be affected by a package update.

The PR/change review surface must show semantic differences, not just file diffs:
- world/region changes;
- package additions/removals/version changes;
- avatar body/intelligence/capability changes;
- assets and environment changes;
- system/mechanic changes;
- permissions and policy changes;
- license/provenance changes;
- simulation/test/replay results;
- performance and loading changes;
- build/deploy target impact.

The user can inspect, comment, request changes, approve and merge inside PlayLiquid. A connected GitHub remote is synchronized through the configured provider adapter.

### 3.4 Tools and authoring

Browser and Terminal remain ZCode tools.

The same task can use:
- browser research and automation;
- terminal, filesystem, Git and scripts;
- installed engines and DCC applications;
- MCP/UI plugins;
- PlayLiquid-native editors;
- agent capabilities.

Engine/editor adapters include Unreal, Unity, Godot, PlayCanvas and Blender, as well as future tools. Prefer mature open-source and existing tool capabilities over rebuilding editors. Native engine projects remain native projects; PlayLiquid orchestrates them through provider-neutral Tool Fabric adapters.

An engine can be opened/controlled in the task workspace when a registered adapter and required local SDK/toolchain are present. State unavailable integrations honestly.

### 3.5 Player and creator surfaces

Borrow WebFlix's YouTube-style interaction model and preserve its familiar navigation logic, adapted to worlds/games rather than videos.

**Home**
- category/filter navigation;
- Trending / recommended worlds;
- Continue Playing with real progress;
- long-form landscape game/world cards;
- vertical Sparks shelf;
- live now shelf;
- replays and creator updates;
- infinite/progressive feed loading;
- real hover-to-play preview in cards.

**Play**
- interactive world/player area in the same visual position as a long-form video player;
- world title, creator/channel row, subscribe/follow, reactions, share, save;
- description and world/profile details;
- comments/replies and creator moderation actions;
- related worlds and recommended content;
- multiplayer/party/presence affordances where supported;
- replay entry point and session metadata;
- clear explicit full-world play/resume behavior.

**Game Details / World Details**
- trailer/gameplay preview;
- title and creator;
- world profile (game, Spark-enabled, experience, twin, etc.);
- rating/plays and other real metrics;
- primary Play/Explore action;
- overview, packages/features, compatibility, supported inputs;
- community/discussion;
- updates/release history;
- leaderboards and related worlds.

**Sparks**
- vertical 9:16, Shorts-style full-screen feed;
- active Spark starts playing/loading automatically as it becomes the selected feed item;
- no separate Play button is required to start;
- gameplay remains inside the Sparks feed;
- swipe/scroll or keyboard advances to the next Spark;
- like, comment, share and follow;
- creator, caption, audio and challenge metadata;
- comments drawer;
- instant-play interaction and score/replay actions where relevant;
- explicit "Open full world" action may navigate to the parent world, but playing a Spark must never redirect to a separate game page.

**Your Channel**
- creator avatar, banner, bio and follower count;
- tabs for Home, Worlds, Sparks, Replays, Collections and About;
- published worlds/package releases;
- featured worlds;
- live/current activity;
- channel subscription/follow state;
- creator community and moderation controls.

**Subscriptions**
- followed creators;
- latest world releases and updates;
- new Sparks;
- live activity;
- creator posts/updates where supported;
- filter by All / Worlds / Sparks / Live / Updates.

**Liked Games**
- liked worlds, games and Sparks;
- saved collections/playlists;
- continue-playing/recently played can be reached from library/history.

### 3.6 Live and replay

Users must be able to:
- browse other players who are live in a world or Spark;
- watch a live gameplay session;
- start their own live from a running world or Spark;
- share the live session and invite other people;
- follow the creator;
- chat and react in real time;
- optionally attach game state, party/presence and viewer-interaction metadata;
- configure audience/moderation and recording options;
- watch completed recorded streams and game sessions later.

Support both:
1. **Stream replay/VOD:** recorded audiovisual live broadcast, viewable from the channel, world and Live & Replays hub.
2. **Interactive game/session replay:** platform replay artifact based on authoritative world/session events or snapshots, where the world/runtime supports it. Preserve determinism and provenance; do not claim every video recording is a replayable simulation.

Live & Replays should show live players, recorded sessions, featured events and upcoming scheduled sessions when implemented. Live chat and recording must use platform services, not per-game bespoke stacks.

### 3.7 Platform capabilities supplied once

PlayLiquid should provide reusable platform services so each game does not implement these independently:
- multiplayer/matchmaking/presence;
- live session discovery and streaming integration;
- chat and social;
- follows/subscriptions/channels;
- replay/VOD;
- leaderboard/achievements/tournaments;
- Liquid spending, rewards and economy/entitlements;
- cloud save;
- analytics;
- moderation and safety;
- competitive integrity/bot detection.

Games declare required capabilities and policies. Platform services own shared state and enforcement. Competitive outcomes, protected rewards and economy settlement are not client-authoritative.

Do not imply that every service is operational merely because a domain package or UI surface exists. The UI must reflect the actual host-composed provider/service state.

### 3.8 World deployment, streaming and digital twins

A world is deployable to supported providers chosen by the developer, including Vercel, Cloudflare and other registered deployment adapters.

The deployment UI must expose:
- target/provider selection;
- environment and credentials status;
- build result and artifact provenance;
- deployment URL and revision;
- rollback/release state;
- region/zone/chunk streaming configuration and telemetry where available.

Large worlds are partitioned (World → Region → Zone → Chunk). PlayLiquid loads and prefetches relevant sections as players explore, obeying package dependencies, access policy, resource budgets and target compatibility. Do not load the entire world if only a small initial section is required.

Digital twins may consume external live/historical data through authorized connectors. Their source, timestamp, freshness, provenance, synchronization policy, identity mapping and simulation-vs-observed distinction must be explicit. A twin must never present estimated or simulated values as real-world observations.

## 4. Game card thumbnails and hover-to-play preview

This is a core discovery interaction.

Reuse the WebFlix hover-preview implementation if its ownership/license is verified and code reuse is authorized. In particular, inspect:
- `src/components/video/video-card.tsx`
- `src/components/video/video-hover-preview.tsx`

The WebFlix repository's public visibility does not itself grant a reuse license. Obtain written authorization or verify a suitable license before copying source. If not authorized, use WebFlix as behavioral guidance and implement a clean-room component. Never import its YouTube/Netflix backends as game data adapters.

Game/world cards need:
- approved static poster/thumbnail;
- actual short gameplay-preview clip;
- duration and relevant world metadata;
- creator/channel identity;
- play count / status where available;
- continue-playing progress when applicable.

Hover behavior:
1. Static poster is shown immediately.
2. Desktop fine-pointer hover waits approximately 450–600 ms (tunable).
3. A real muted inline gameplay-preview video plays within the card.
4. The preview layer follows the card geometry and exposes appropriate mute/progress controls.
5. Only one preview player is active at a time; moving to another card disposes or hands off the previous player.
6. Leaving card and preview controls stops playback and releases media resources.
7. The rest of the card remains clickable and opens the corresponding Play/World page.
8. Touch devices do not pretend to support hover; provide an explicit preview interaction.
9. Reduced-motion preference disables autoplay preview.
10. If preview media fails or is unavailable, retain the static poster and show an honest unavailable state. Never animate a slideshow and present it as playing gameplay.

Do not boot the full world/game engine on hover. Preview is a lightweight capture from an actual world build/session, not a full interactive world instance.

Creator preview workflow:
- choose a world build/session;
- capture a short representative gameplay sequence;
- generate poster/keyframe and encoded preview;
- review/approve or upload a replacement;
- store asset digest, source build/revision, duration, aspect ratio, codec and provenance;
- deliver through the media/object-storage adapter with cache/resize strategy.

Spark preview is not the same as card hover. Spark is the full-screen, instant-play short experience.

## 5. Integration and authority boundaries

Preserve the existing frozen architecture:
- GameIR = semantic kernel.
- Package Graph = dependency/composition authority.
- Git lifecycle = project/branch/commit/change-proposal authority.
- Capability Broker = runtime action authorization.
- ZCode = AI workspace, task/session, model/provider and existing tool authority.
- Tool Fabric = provider-neutral tool/engine integration.
- Interactive Runtime and Simulation Runtime remain distinct execution paths with shared semantic contracts.
- Replay remains a platform primitive.
- Arena remains an external human-capability provider, not a second workflow engine.
- MCP remains a transport/integration mechanism, not a semantic authority.

Do not introduce:
- a second agent runtime;
- a second model/provider settings or routing system;
- a second Automations/workflow system;
- a second Git/PR authority;
- a second package registry;
- a parallel world/session state owner;
- game-specific duplicates of common platform services.

## 6. WebFlix reuse boundary

WebFlix is the behavioral and visual reference for the Home feed, thumbnails, hover previews, long-form page, Shorts, channels, subscriptions, comments, Creator Studio and live interactions.

Prefer actual component reuse after a code/license audit. Adapt presentation/state contracts to PlayLiquid world data and ZCode's React/desktop/web architecture. Do not transplant the Next.js application or its source-specific server actions, YouTube/Netflix APIs, credentials, Prisma adapters or social integrations.

If code reuse is authorized, preserve provenance and identify every copied/modified source file in `docs/product/WEBFLIX-REUSE-MAP.md` or the applicable reuse manifest.

## 7. Product non-goals

- A standalone Game Studio dashboard as the primary development entry point.
- Rebuilding the ZCode app, settings, model-provider infrastructure or task runtime.
- Requiring users to interact with GitHub to perform native project work.
- Booting a full game engine for card hover previews.
- Treating Spark as a second unrelated game/content model.
- Claiming unsupported engines, deployments, live services, digital-twin connectors or console builds as production-ready.
- Fake engagement, invented metrics, nonfunctional controls or slideshow fallbacks pretending to be real gameplay.

## 8. Completion principle

A UI that resembles the Figma frame is not sufficient. Each operation must use the existing authoritative service/port or a newly approved contract, persist real state and be demonstrated in runtime/browser/package tests. Every limitation must be explicit. A feature is GREEN only when source, tests, runtime, browser and deployment/build evidence agree.
