# WebFlix Reuse Map

The handoff required reusing WebFlix's UI/UX implementation. Its repository
carried no license at inspection time, so per the handoff's licensing gate this
is a **clean-room behavioral reimplementation**: the WebFlix *patterns* were
reproduced from scratch against PlayLiquid's game domain — no WebFlix source
files, YouTube integrations, credentials or data adapters were copied.

| WebFlix pattern | PlayLiquid implementation | Notes |
| --- | --- | --- |
| `app-shell` / `sidebar` / `topbar` | `playliquid-app.tsx` + `topbar.tsx` + `sidebar.tsx` | Sticky topbar, collapsible sidebar, mobile drawer (Sheet), footer |
| `home-feed` shelves | `views/home.tsx` | Hero + Continue-playing + Sparks shelf + Trending/Live rails + infinite grid (cursor pages, IntersectionObserver) |
| `video-card` | `game-card.tsx` | Landscape 16:9 cards; title, creator, plays, rating, duration, live/upcoming status, continue-progress bar |
| `video-hover-preview` | `hover-preview.tsx` | Full architecture port — see GAME-PREVIEW-ARCHITECTURE.md |
| `shorts-feed` / Shorts shelf | `views/sparks.tsx` + home Sparks shelf | Vertical 9:16, `scroll-snap-type: y mandatory`, engagement rail, comments |
| `watch-page` (+ action row, comments) | `views/play.tsx` | Game surface + like/dislike/share/save/restart, follow, comments, leaderboard, updates, related games |
| Video details page | `views/details.tsx` | Gameplay details, leaderboards, updates, recommendations |
| Creator Studio | `views/creator-studio.tsx` | Analytics, games & releases, Sparks performance, moderation |
| Notifications bell | topbar | sonner toast feed |
| Search + suggestions | topbar | Live listbox over the home DTO (games + studios); submit navigates to the first hit |

Sparks use vertical 9:16 presentation; long-form game cards are landscape —
both rules from the handoff are honored by the same card components.
