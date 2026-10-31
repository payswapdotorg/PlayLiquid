# PlayLiquid Product North Star
Status: operator-approved durable product contract, 2026-10-31. This repository is the source of truth; implementation must not depend on chat. This contract supersedes older conflicting product/UX statements. It does not silently alter frozen technical architecture; raise an Architecture Change Request (ACR) for conflicts.

## Product
PlayLiquid is a Git-native, AI-native platform to create, compose, publish, explore, play and operate executable worlds.

A **World** may be a Spark, game, experience, digital twin of a real-world entity/place/facility/process/system/organization, or a future extensible kind. Spark is both a valid World kind and may have a Spark-specific delivery/target profile. Content kind and target profile are distinct dimensions. This supersedes the old rule that Spark is only a target profile. Suggested kinds: `spark | game | experience | digital_twin | other`; suggested target profiles: `spark_vertical | web | desktop | mobile | xr | dedicated_server | simulation`. Reconcile the existing GameIR schema; do not create a competing semantic authority.

## Everything is a package
Everything independently versionable and composable is a package: worlds, regions, zones, characters, avatar bodies, intelligence/brains, environments, assets, animation, audio, physics, behaviors, systems, tools, skills, simulations, tests, evaluations, UI, services and build definitions. Packages have stable identity/version, digest, provenance, licensing/rights, dependencies, compatibility and release evidence. Large binary assets use content-addressed/object storage, not ordinary Git history. Avatar remains `Body + Intelligence`; parts can be independently versioned. Worlds compose packages; developers can create packages independently and compose them into multiple worlds.

## Worlds are Git-backed projects
A World is a project/repository with normal Git lifecycle. GitHub is an optional connected remote, not a mandatory daily interface. PlayLiquid presents create/import/connect, project overview, branches, commits, tasks, contributors, package graph, semantic pull requests, review, merge, release and deployment. A task assigned to an existing project creates isolated changes/branch/worktree and a reviewable proposal; a new-project task creates a real repository through the authoritative lifecycle. Do not fake branch/PR/GitHub state. Semantic PRs explain changes in world terms: regions/zones/chunks, packages, characters/assets, behaviors/systems, capabilities, performance/loading budgets, compatibility, rights, tests and replay evidence. Ordinary work should not require opening GitHub.

## Preserve ZCode; do not rebuild it
This is a ZCode fork. ZCode remains authoritative for task/session lifecycle, model/provider routing and settings, custom providers/credentials/capabilities, agent runtime, context, access/permissions, attachments, browser/terminal, search, automations, plugin marketplace, group/project/task primitives where inherited, RPC/client/server/provider architecture, desktop/web/CLI and settings/account infrastructure. Reuse/adapt existing implementations. Do not create a second model router, provider settings page, task system, agent runtime, automation engine, plugin marketplace, browser or terminal. Full inherited model settings must remain reachable and functionally equivalent.

WebFlix code reuse requires checking its actual repository license, notices, dependencies and source commit first. ZCode Apache-2.0 does not license WebFlix. If reuse is not legally established, use it as a behavioral/design reference. Do not blindly port Next.js server actions, database adapters or YouTube integrations. Netflix and TikTok integrations are excluded; YouTube integration is not in scope.

## New Task
First-run opens the simple ZCode-style New Task page, not a feed or separate Game Studio dashboard. Keep PlayLiquid theme and familiar centered prompt composer. Required:
- **Select project** dropdown directly above composer: create new world project or choose existing.
- + attachment control, access-level dropdown, inherited model selector and send action.
- **Browser** and **Terminal** toggle icons at top-right of composer/tool header; visible on/off state; operate existing ZCode panels.
- Future engine/DCC tools use same tool-panel registry and appear only when installed/registered.
- Expandable contextual package/world references: world, Spark, game, experience, twin, character, avatar, asset, environment, system, package.
Do not clutter default page or require engine selection. The Select project and Browser/Terminal controls are missing from the current Figma draft and are acceptance-critical. Add them to the New Task frame before visual sign-off.

## Player experience: WebFlix interaction grammar
Use WebFlix/YouTube-style long-form and Shorts patterns adapted to worlds, not a generic game catalogue:
- Home: category filters, landscape world cards, hover previews, Continue Watching/Playing, vertical Spark shelves, recommended worlds, live now, infinite scroll.
- Long-form World play page: 16:9 player/session, creator row, follow/subscribe, like, share, save, description, chapters/regions, comments/replies and recommendations.
- Sparks: vertical 9:16 full-height snapping/swipe viewer. Active Spark auto-loads and begins interaction; no Play button and no navigation to a separate game page to start. Comments drawer, engagement rail, follow/share, score/progress/replay where appropriate. "Open full world" is separate.
- World details: video-details-style layout with preview, kind, creator, enter/play, packages/requirements, compatibility, release/update history, discussion and recommendations.
- Your Channel: Home, Worlds, Sparks, Replays, Collections, About.
- Subscriptions: followed creators' worlds, Sparks, live sessions and updates.
- Liked/Saved, History/Continue Playing, Live & Replays, Live Player, Start Live, comments and notifications.
No Netflix or TikTok integrations.

## World card previews
Poster appears immediately. After hover-intent delay, load a small sandboxed preview session/stream or pre-rendered interactive preview. Allow safe interaction only when declared. On pointer leave, cancel and release resources; do not persist gameplay progress. Explicitly open the full world to start a real session. If unsupported, keep poster and show honest status. Touch devices use explicit preview/enter affordances; Sparks active feed item auto-enters.
Define preview manifest using existing GameIR/runtime/Package Graph (no parallel authority): poster, preview asset/entrypoint, packages, compatibility, input model, resource budget, sandbox policy and fallback. Preview must be isolated, disposable/read-only by default, capability-restricted and resource-limited. Never grant arbitrary filesystem, network, payment or account privileges. Do not load the whole world to preview a card. Measure poster/first-frame/first-interaction latency, resource usage and cancellation.

## Platform and delivery
PlayLiquid supplies reusable multiplayer/matchmaking/presence, chat/social, replay, leaderboards, achievements, tournaments, integrity/bot-detection signals, cloud saves, moderation, Liquid spending/rewards (where policy allows) and analytics. Worlds declare capabilities/policies; platform services implement them. AI proposes; authoritative systems mutate. Client is not authoritative for competitive outcomes.
Worlds are partitioned into regions/zones/chunks or equivalent sections; stream only what's needed as explored, with progressive loading, caching, content-addressed assets and explicit budgets. Deploy to Vercel, Cloudflare or other supported user-selected provider only when a real adapter exists. Keep Unreal/Unity/Godot/Blender etc native; orchestrate via provider-neutral Tool Fabric. Do not rebuild mature engines.

## Navigation
Creation/work: New Task, Search, Automations, Plugin Marketplace, Groups/Projects switcher, create/recent projects/tasks.
Discovery/player: Home, Sparks, Subscriptions, Live & Replays, Your Channel, Liked/Saved, History/Continue Playing.
Account/Settings must expose the complete inherited ZCode settings, especially model/provider configuration. Project workspace is where world development happens; no standalone Game Studio dashboard as default. Lab/Arena capabilities remain available contextually or in a discoverable Lab area.

## Figma authority
Visual reference: https://www.figma.com/design/LWlycZ5B3vCrUZ0a4pnu5u
Current concept direction is approved except New Task needs Select project and top-right Browser/Terminal toggles. Figma MCP editing hit the connected Starter-plan call limit on 2026-10-31; do not claim correction is done. TL/design owner must add it and record exact frame/node links and screenshots. Implement designs faithfully, not as loose inspiration.

## Truthful completion
Complete means authoritative source contracts + tests + real desktop/web journey + browser evidence at 390x844 and 1280x800 (and 480px min desktop) + package/install evidence where applicable. No dead controls, fabricated data or fake integrations. Old 45/45 program/test counts do not prove this new product is complete; reconcile every claim against current source, tests, runtime and release artifacts.

## Exclusions
No Netflix/TikTok integration, mandatory GitHub UI for ordinary work, separate Game Studio dashboard as default, duplicate model/task/agent authority, fake engine/live/multiplayer/replay/deployment/payment integrations or rights circumvention.
