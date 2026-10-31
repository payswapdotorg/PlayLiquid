# Figma Implementation Contract

**Figma file:** [PlayLiquid — WebFlix UX Adaptation](https://www.figma.com/design/LWlycZ5B3vCrUZ0a4pnu5u)  
**Repository product spec:** [PRODUCT-EXPERIENCE-SPEC.md](PRODUCT-EXPERIENCE-SPEC.md)  
**Status:** Working design baseline; New Task's final control placement and the social/live page set remain Figma sign-off gates.

Figma is the design source of truth. Do not substitute a TL-created redesign or use this document as permission to invent a different interpretation.

## 1. Existing screen set

### Page 01 — WebFlix UX Adaptation

- Home: frame `1:2`
- Play (long-form world/game experience): frame `1:143`
- Sparks (vertical Shorts-style player): frame `1:236`
- World/Game Details: frame `1:302`

### Page 02 — New Task & World Projects

- New Task: frame `6:3`
- World Projects: frame `6:99`
- World Project workspace: frame `6:238`
- Semantic Pull Request review: frame `6:350`

The old Game Studio dashboard, Game Builder dashboard and Creator Studio dashboard are no longer the primary information architecture. Their useful capabilities are relocated as project-context tools, packages, tasks, build/deploy surfaces and channel/creator features. Do not implement a standalone Game Studio dashboard just because it exists in an earlier design iteration.

## 2. Required final correction to the New Task frame

Update frame `6:3` before declaring design sign-off.

The frame must visibly show:

1. **Select project dropdown above the prompt composer.**
   - It must look and behave like a real dropdown, not a text label or fixed project card.
   - Include an option to create a new World Project.
   - Include existing projects/groups as selectable options.
   - Selecting an existing world sets the task's project/branch context.
   - The dropdown must be visible in the default first-run screen.

2. **Browser toggle icon at the top-right of the task workspace header.**
   - Real toggle with selected/active state.
   - Opens/closes the existing ZCode Browser panel.
   - Has an accessible label and tooltip.

3. **Terminal toggle icon at the top-right of the task workspace header.**
   - Real toggle with selected/active state.
   - Opens/closes the existing ZCode Terminal panel.
   - Has an accessible label and tooltip.

4. Retain the existing ZCode composer controls:
   - plus icon for file/context attachments;
   - access level dropdown (including the existing Full access behavior and available modes);
   - model selection dropdown using ZCode's provider/model settings;
   - send button and keyboard submit behavior.

5. Retain the PlayLiquid dark theme and established accent tokens.

6. Keep the New Task view simple. Advanced world/package/engine capability is surfaced by `@` context, `/` commands, package picker and registered tool panels, not by filling the default viewport with dozens of controls.

**Position rule:** Browser and Terminal toggles belong in the top-right header area of the task workspace, not in a row below the prompt. The project dropdown belongs immediately above the composer.

## 3. Existing player-facing patterns

### Home
Match WebFlix's content discovery hierarchy:
- Continue Playing;
- landscape world/game cards;
- vertical Sparks shelf;
- recommendations and categories;
- live/replay shelves;
- infinite/progressive feed;
- hover-to-play card preview.

### Play
Use the long-form WebFlix watch-page structure:
- central player surface;
- world/game metadata;
- creator/channel row and follow/subscribe;
- reactions/share/save;
- description/details;
- discussion/comments;
- related worlds;
- Play/resume and supported multiplayer/session controls.

### Sparks
Use the actual Shorts page pattern:
- full-height 9:16 viewer;
- vertical snapping/navigation;
- creator/caption;
- engagement rail;
- comments drawer;
- next/previous Spark.
- **Instant-play:** active Spark begins loading/playing without a Play button, and interaction stays in the feed. Open the full parent world only via an explicit separate action.

### World Details
Use the video-details-page pattern:
- trailer/preview;
- title/creator/metrics;
- primary Explore/Play;
- overview/details;
- community;
- updates;
- related worlds.

## 4. Additional Figma page required

Create a new page, provisionally titled **03 — Channels, Live & Replays**, with these five complete desktop frames:

1. **Your Channel**
   - banner, avatar, creator name/bio, follow/subscribe;
   - Home / Worlds / Sparks / Replays / Collections / About tabs;
   - featured world, published worlds and creator content.

2. **Subscriptions**
   - followed creator row;
   - latest worlds, packages/updates, Sparks, live now;
   - filters All / Worlds / Sparks / Live / Updates.

3. **Liked Games**
   - liked/saved worlds and Sparks;
   - collections/playlists;
   - empty state and useful next action.

4. **Live & Replays**
   - live-now cards with live status/viewer counts (design examples only; runtime values must be real);
   - recorded live stream VODs;
   - recorded game/session replays;
   - upcoming streams/events when supported.

5. **Live Player / Start Live**
   - design the viewing experience with live chat, creator actions and game/Spark playback;
   - provide a clear route into a Start Live configuration flow for either a running game or Spark;
   - audience, chat, moderation and replay-recording controls;
   - do not conflate recorded VOD video with an interactive state replay.

Use WebFlix as the visual/interaction guide and keep PlayLiquid's current product theme.

## 5. Navigation frame / sidebar contract

The full left rail should be represented in the Figma screens and remain recognizable across pages:

- New Task
- Search
- Automations
- Plugin Marketplace
- Group / Project switch
- Projects / groups list
- task history or recent tasks
- Home
- Sparks
- Subscriptions
- Live & Replays
- Your Channel
- Liked Games
- Account / Settings

Do not make Settings inaccessible. The existing ZCode Settings page is retained and remains the authority for model/provider features.

## 6. Fidelity and QA

For every frame:
- preserve its layout hierarchy, spacing, typography, color and component placement;
- use shared components for repeated shell/card/navigation patterns;
- create responsive variants for 1280×800 desktop, minimum supported window width, and 390×844 mobile where applicable;
- include empty/loading/error/active states for core interactions;
- use meaningful control labels, focus states and reduced-motion behavior;
- avoid decorative metrics that could be mistaken for real data.

Before coding:
1. Finish the New Task correction.
2. Complete the Channels/Live/Replays frames.
3. Capture the complete frame set and obtain design approval.
4. Pin Figma frame/node references in the implementation PR.
5. Use screenshot comparison from the actual built app to the exact frames.

The Starter-plan Figma MCP rate limit prevented completion of the final top-right tool placement and the separate social/live page set in the latest design session. Do not treat those as approved/complete until the Figma source file has actually been updated and visually checked.


## 7. Operator-confirmed New Task and World semantics

The New Task correction is mandatory:
- a visible, functional **Select project** dropdown above the composer;
- **Browser** and **Terminal** toggle icons in the task workspace header at the **top-right**;
- both toggles open/close the existing ZCode Browser and Terminal panels;
- do not move these controls below the prompt or replace them with decorative chips.

World is the umbrella semantic/project concept. A World may be a game, Spark, interactive/social experience, simulation/training environment, digital twin of a real-world place/asset/process/system, or future profile. One World may have multiple profiles/entry points (e.g. a full game and Spark). Spark remains a delivery/runtime target profile, not a separate root content model, per architecture lock #16.
