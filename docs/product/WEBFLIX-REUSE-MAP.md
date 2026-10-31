# WebFlix Reuse Map — PlayLiquid

**Status:** Source inspection started; no WebFlix code has been copied into this branch.  
**Source repository:** https://github.com/payswapdotorg/WebFlix-2.0  
**Product contract:** [PRODUCT-EXPERIENCE-SPEC.md](PRODUCT-EXPERIENCE-SPEC.md)

## 1. Rights gate

WebFlix-2.0 is publicly viewable, but the root-level license was not established during this review. Public visibility is not permission to transplant its components.

Before copying code:
1. Verify the repository's current license and all relevant copyright/third-party notices.
2. If no license clearly permits the intended copying/distribution, obtain explicit written authorization from the rights holder.
3. Record authorization/permission evidence, source commit SHA and applicable scope.
4. If authorization is absent, use WebFlix as a behavioral reference and create a clean-room implementation that follows the approved design/interaction patterns.
5. Do not copy YouTube/Netflix integrations, credentials, data adapters, server actions, or user-identity assumptions into PlayLiquid.

## 2. Initial component inventory

The following paths were inspected or identified as the primary reuse candidates:

| WebFlix source | PlayLiquid target | Reuse intent | Status |
|---|---|---|---|
| `src/components/app/app-shell.tsx` | Shared PlayLiquid shell | Reuse responsive shell patterns only after ZCode shell integration review | Audit required |
| `src/components/app/sidebar.tsx` | PlayLiquid left sidebar | Adapt information architecture; preserve ZCode's New Task/Search/Automations/Marketplace/Groups/Projects semantics | Audit required |
| `src/components/app/topbar.tsx` | PlayLiquid content header | Reuse search, actions and responsive behavior where compatible | Audit required |
| `src/components/app/notifications-bell.tsx` | Notification entry | Reuse component/interaction if rights allow | Audit required |
| `src/components/app/account-menu.tsx` | Account/Settings menu | Preserve ZCode Settings route and behavior; do not replace settings | Audit required |
| `src/components/home/home-feed.tsx` | PlayLiquid Home | Reuse feed composition/loading patterns; adapt DTOs to worlds | Audit required |
| `src/components/home/shorts-shelf.tsx` | Sparks shelf | Reuse vertical shelf/card behavior | Audit required |
| `src/components/home/video-rail.tsx` | Long-form world rails | Reuse horizontal rails and card sizing | Audit required |
| `src/components/video/video-card.tsx` | World/Game card | Reuse card structure/actions; replace video-specific entity/DTO | Source inspected; license gate open |
| `src/components/video/video-hover-preview.tsx` | Shared gameplay preview | Reuse preview-manager architecture where permitted; media asset becomes gameplay clip | Source inspected; license gate open |
| `src/components/shorts/shorts-feed.tsx` | Sparks viewer | Reuse vertical feed navigation/snapping/active item patterns | Audit required |
| `src/components/shorts/shorts-engagement-rail.tsx` | Spark action rail | Reuse engagement layout/behavior | Audit required |
| `src/components/watch/watch-page.tsx` | Play world page | Reuse long-form player page hierarchy; player entity becomes interactive world/session | Audit required |
| `src/components/watch/action-row.tsx` | World action row | Reuse like/share/save/follow affordances | Audit required |
| `src/components/watch/comments-section.tsx` | World discussion | Reuse comments/replies/moderation interaction | Audit required |
| `apps/studio/src/components/studio-shell.tsx` | Creator/channel tools | Use creator analytics/moderation patterns, but no separate Game Studio home dashboard | Audit required |
| `apps/studio/src/app/(studio)/**` | Creator channel/operations | Extract relevant creator-facing experiences; map to World Projects and Your Channel | Audit required |

## 3. Hover preview source findings

The inspected `video-hover-preview.tsx` contains a sophisticated shared preview architecture:
- a single shared layer follows the currently hovered card;
- a dwell delay around 450 ms;
- a shared preview store and one-active-preview policy;
- muted inline playback;
- preview controls including mute and progress/scrub affordances;
- pointer-exit handling that preserves the preview while moving into its controls;
- cleanup when changing hovered cards;
- touch and reduced-motion policies;
- explicit poster/fallback behavior rather than pretending static images are video.

The same file documents multiple fallback lessons from prior production issues. In particular, a silently animated storyboard was repeatedly perceived as a broken slideshow. PlayLiquid must follow the strict rule in the product spec: actual gameplay video or static poster; never a fake slideshow.

The PlayLiquid media pipeline must supply a gameplay clip captured from a real build/session. Hover must not boot the whole engine.

## 4. Required implementation audit per component

For every proposed source reuse, workers must record:
- exact WebFlix commit SHA and source file path;
- code owner/license/authorization evidence;
- source component and transitive dependency list;
- Next.js-specific dependencies that must be removed/adapted;
- YouTube/Netflix/session-specific calls to exclude;
- target ZCode/PlayLiquid component and package;
- actual reused lines/files and modifications;
- tests and visual parity evidence.

## 5. Architecture compatibility

WebFlix uses a Next.js-centric architecture and provider-specific data/server adapters. PlayLiquid is based on the ZCode shared React renderer and its service/host contracts.

Do not transplant the entire Next.js App Router application or create a second frontend/backend. Reuse the isolated presentation and interaction components and adapt them to:
- ZCode's React UI/component conventions;
- current product-shell navigation;
- PlayLiquid domain/view-model contracts;
- GameIR/package/project IDs and version semantics;
- authoritative platform services and typed ports.

Any shared component that cannot be separated cleanly should be reimplemented from observed behavior after the rights gate, rather than introducing a second authority or bundling a second app.
