# Product Experience Status — Baseline and Next Work

**Last inspected:** 2026-10-31  
**Repository:** payswapdotorg/PlayLiquid  
**Main baseline:** `78f2011595b2575c6eaee486a329bcdb4fae58bd`  
**Latest published release observed:** `playliquid-gameos-v3.15.0` (Linux x64)

This document distinguishes the state of existing code from the new product direction.

## 1. Existing implementation facts

- Repository is a complete ZCode fork with PlayLiquid GameOS domain modules.
- The project state records the original PL-001..PL-045 program as complete (45/45 merged) and a 3,226-test aggregate audit. This is historical evidence, not proof that every future product journey is implemented.
- Current product shell source `packages/desktop/src/renderer/src/gameos/shell/product-shell.tsx` opens with `active = "studio"` and mounts Game Studio/Lab/Community as primary workspaces. The inherited ZCode workbench is accessed through an "AI & Agents" route.
- The prior `docs/ux/JOURNEY-MAP.md` states that game/project creation/import through the desktop UI, package publishing/composition through UI, desktop game sessions, engine adapter registration/dispatch, desktop replay and game-target builds are not yet supported by the listed ports/host composition.
- Existing ZCode Settings and Model Provider implementation are present in the fork and remain preservation-critical.
- Existing New Task and project/sidebar features must be audited in actual source before modifying the shell.

## 2. Existing release facts

- Published release `playliquid-gameos-v3.15.0` contains Linux x64 .deb + AppImage + SHA256SUMS.
- Current `.github/workflows/release-desktop.yml` builds on `ubuntu-latest` and collects/publishes Linux artifacts only.
- The desktop bundler recognizes `win` targets and desktop packaging contains Windows-specific hooks, but the release workflow has no Windows job and no Windows artifact is currently published in the observed release.
- PlayLiquid app IDs, executable/package identity and data roots are isolated from upstream ZCode.
- The inherited ZCode update feed is disabled. Keep it disabled until a PlayLiquid-owned secure update feed exists.

See [CROSS-PLATFORM-DISTRIBUTION.md](../release/CROSS-PLATFORM-DISTRIBUTION.md).

## 3. Figma baseline and outstanding design gates

Figma: https://www.figma.com/design/LWlycZ5B3vCrUZ0a4pnu5u

Existing screen set:
- Page 01: Home, Play, Sparks, World/Game Details.
- Page 02: New Task, World Projects, World Project workspace, semantic PR review.

Outstanding:
- New Task must visibly show the project dropdown above composer.
- Browser and Terminal toggle icons must be at the top-right task workspace header, not under the prompt.
- A new design page must cover Your Channel, Subscriptions, Liked Games, Live & Replays, Live Player/Start Live.
- The latest Figma MCP session hit the connected Starter plan call limit before all of these final design details could be applied/visually checked. See [FIGMA-IMPLEMENTATION-CONTRACT.md](../product/FIGMA-IMPLEMENTATION-CONTRACT.md).

Do not begin Figma-dependent UI implementation before this design gate is closed.

## 4. Current durable implementation work

- [Product Experience Specification](../product/PRODUCT-EXPERIENCE-SPEC.md) created.
- [Figma Implementation Contract](../product/FIGMA-IMPLEMENTATION-CONTRACT.md) created.
- [Final Product Implementation Handoff](../handoff/FINAL-PRODUCT-IMPLEMENTATION-HANDOFF.md) created.
- [Product Experience Work Orders](../../spec/product-experience/WORK-ORDERS.md) created.
- [Cross-Platform Distribution Contract](../release/CROSS-PLATFORM-DISTRIBUTION.md) created.
- [WebFlix Reuse Map](../product/WEBFLIX-REUSE-MAP.md) created.

These documents are being submitted for TL integration review in a docs-only PR. They have not yet been merged to main, and they do not mean the described product features are implemented.

## 5. Current next step

TL must review the handoff PR, merge or amend the repository product documents, finish the Figma design gate, update the post-program product work-order plan and only then dispatch implementation workers.

Never mark a new capability complete on the basis of this status document. Use actual source, tests, runtime, browser and platform build evidence.
