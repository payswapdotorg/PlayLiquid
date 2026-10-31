# Product Boundaries — PlayLiquid GameOS (Web Adaptation)

PlayLiquid GameOS runs as a single-route Next.js 16 application at `/`.
All eight product surfaces are hash-routed views inside one SPA
(`#view=…&game=…&spark=…`), rendered by `src/components/playliquid/playliquid-app.tsx`.

## Module boundaries

| Boundary | Location | Responsibility |
| --- | --- | --- |
| App shell | `components/playliquid/{topbar,sidebar}.tsx` + `playliquid-app.tsx` | Sticky topbar (search + suggestions, create, notifications, theme, account), collapsible sidebar (player nav + studios + explore), footer. Always mounted; holds the shared hover-preview layer. |
| Home surface | `components/playliquid/views/home.tsx` | Featured hero, Continue-playing rail, Sparks shelf (9:16), Trending/Live rails, cursor-paginated infinite grid. |
| Play surface | `views/play.tsx` + `mini-games/game-engine.tsx` | Watch-page layout around a live canvas game: HUD, game-over/restart, sessions, scores, likes, follow, comments, leaderboard, updates, related games. |
| Sparks surface | `views/sparks.tsx` + `spark-tile.tsx` | Vertical 9:16 snap feed with engagement rail (like/comment/share), creator identity, instant-play entry into the full game. |
| Details surface | `views/details.tsx` | Gameplay details, ratings, leaderboards, updates, recommendations. |
| Creator surfaces | `views/new-task.tsx`, `game-studio.tsx`, `game-builder.tsx`, `creator-studio.tsx` | Task creation (prompt/mode/agent/model/workspace), studio dashboard (drafts/published/feedback), builder (live canvas, theme patcher, Build Agent, save/publish), creator analytics. |
| Hover preview | `hover-preview.tsx` | ONE shared preview player at the app root; cards subscribe via `useHoverPreview`. See GAME-PREVIEW-ARCHITECTURE.md. |
| API surface | `src/app/api/**` | `home`, `games` (+`[id]`, `theme`, `progress`, `play`, `like`, `scores`, `comments`), `sparks` (+`[id]/like|comments`), `creators/[id]/follow`, `tasks`, `agent`, `studio`. REST over fetch; no server actions. |
| Data | `prisma/schema.prisma` (SQLite, `db/custom.db`) | Creator, Game (+GameUpdate), Spark, Comment, PlaySession, Score, Task. |
| Media pipeline | `scripts/gen-images.sh`, `scripts/gen-videos.ts`, `scripts/seed.ts` | Covers, avatars, gameplay preview clips (posters + `/previews/*.mp4`, sparks clips `/previews/sparks/*.mp4`) generated via z-ai image/video generation. |

## Rules honored

- The game feed never boots a game engine — it plays lightweight preview media (see GAME-PREVIEW-ARCHITECTURE.md).
- Only one preview player exists app-wide; the layer is mounted once at the root.
- Views are decoupled: the feed works purely from game metadata + preview assets.
- State: `src/lib/store.ts` (zustand) with hash sync + localStorage persistence (likes, follows, saves, theme).

## Adaptation note

This repository is the **web adaptation** of the PlayLiquid GameOS mission:
the ZCode-desktop fork track (Electron packaging, upstream ZCode settings
preservation, provider registry) does not exist in this environment and is
out of scope here — see ZCODE-PRESERVATION-MATRIX.md for the honest mapping.
