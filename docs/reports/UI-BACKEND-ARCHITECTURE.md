# PlayLiquid GameOS — UI Architecture & Backend Implementation Report

**Date:** 2026-11-01 · **Scope:** the entire `/` experience — web shell, creator desk, settings window · **Status:** gap analysis complete; backend implemented per §5; frontend wiring per §6.

---

## 1. Executive summary

PlayLiquid GameOS is a game **creation + discovery** platform with a single hash-routed SPA on `/`. The UI is complete and polished, but before this report it ran on **two tiers**:

- **Tier 1 — real (kept pre-reconstruction pages):** Home feed, Play (game page), Details, hover previews and the canvas game engine are fully wired to a Prisma/SQLite backend through 9 API endpoints.
- **Tier 2 — mock (Interface Reconstruction v2 pages):** Sparks, Channel, You, Your games, Trending, Live, Leaderboards, Explore, and the entire creator desk (New Task, Automations, Plugins, Settings) displayed hardcoded data and fired toast stubs.

Meanwhile the backend already contained **five fully-implemented but orphaned endpoints** — including an LLM game-generation pipeline (`POST /api/tasks`), a conversational theme-tuning agent (`POST /api/agent`) and a theme/publish save route (`POST /api/games/[id]/theme`). The product's core promise — *type an idea, get a playable game* — existed server-side but was never surfaced.

This report inventories every feature of every view, defines its goals, specifies the backend contract for each, and the implementation that closes every gap. After implementation: **every content surface renders database data, every persistent action writes to the server, and the create → build → publish → play → engage loop is end-to-end real.**

---

## 2. Product goals

| Goal | Where it lives in the UI |
|---|---|
| **G1 — Instant creation.** Turn a one-line idea into a playable draft game via an LLM agent. | New Task composer (desk) |
| **G2 — Iterate with an agent.** Chat with a Build Agent to retune theme/speed/difficulty while playtesting live. | Game Builder (desk, new) |
| **G3 — Publish to the feed.** Promote drafts to published; they appear across discovery surfaces. | Game Builder publish; Home/Explore/Trending |
| **G4 — Discovery.** Browse, search and filter games; short-form Spark clips drive retention. | Home, Explore, Trending, Live, Sparks feed, topbar search |
| **G5 — Deep engagement.** Play, score, climb leaderboards, like, save, comment, follow creators. | Play, Details, Leaderboards, Channel |
| **G6 — Creator identity.** A studio dashboard with real metrics; channel pages for every creator. | You, Your games, Channel |
| **G7 — Power workflows.** Scheduled automations, plugins, persisted settings. | Automations, Plugin Marketplace, Settings |
| **G8 — Console feel.** The desk reproduces a native creator-tool workspace (task list, browser/terminal chrome). | Desk shell, New Task side panels |

---

## 3. Architecture overview

```
/ (src/app/page.tsx → PlayLiquidApp)
├── ExperienceRouter (Zustand store: view, gameId, sparkIndex, channel, searchQuery, settingsOpen)
│   ├── SettingsShell        — settingsOpen=true (full-screen window)
│   ├── DeskShell            — view ∈ {newtask, automations, plugins, build} (creator workspace)
│   └── WebShell             — sidebar + topbar + hash-routed page
│       ├── home, play, details, sparks, channel, you, yourgames,
│       │   trending, live, leaderboards, explore
│       └── HoverPreviewLayer (singleton video preview)
├── State: Zustand usePlayLiquid (routing + likes/follows/saves → localStorage mirror)
│         Zustand useDeskTasks (desk task list, now hydrated from the server)
└── Data: useApi<T>(url) GET hook · postJson(url, body) POST helper (src/hooks/use-api.ts)
```

**Routing:** `#view=play&game=…&spark=…&channel=…&q=…` — `popstate`-synced. `build` is a new desk view carrying `game` (the draft being edited).

**Data layer:** all client fetches go through `useApi`/`postJson`/raw `fetch`. No other transport exists — the report's backend contracts therefore target REST routes under `/api/*`.

**Persistence model:** engagement state is dual-written — optimistic client state (localStorage, instant UI) plus a server write (authoritative counts/rows). The current user is the single `Creator` with `isMe=true` (no auth yet; see §7).

---

## 4. View-by-view inventory, goals & backend contracts

Legend: 🟢 wired → stays · 🔴 was a stub/mock → ✅ now implemented per contract.

### 4.1 Home (`views/home.tsx`) — *discover what to play next*
| Feature | Goal | Backend contract | Status |
|---|---|---|---|
| Hero + rails (continue playing, trending, live, sparks shelves) | G4 | `GET /api/home` → `HomeDTO` | 🟢 already real |
| Recommended infinite grid + category chips | G4 | `GET /api/games?cursor=&category=` | 🟢 already real |
| Sparks shelf tiles → deep-link into feed | G4 | tile click must pass the **correct** `sparkIndex` (was always 0) | ✅ fixed |

### 4.2 Play (`views/play.tsx`) — *play, score, engage* — G5
| Feature | Backend contract | Status |
|---|---|---|
| Game payload, related rail, leaderboard, updates, comments | `GET /api/games/[id]` | 🟢 |
| Play-session start, progress+score persistence, score submit | `POST /api/games/[id]/play` · `/progress` · `/scores` | 🟢 |
| Like | `POST /api/games/[id]/like` | 🟢 |
| Follow creator | `POST /api/creators/[id]/follow` | 🟢 |
| Comments composer | `POST /api/games/[id]/comments` | 🟢 |
| **Save to Library** | `POST /api/games/[id]/save {saved}` → `LibraryItem` row; optimistic localStorage mirror kept | ✅ |
| Dislike ("not for me") | personalization signal — kept client-side (see §7) | 🟡 by design |

### 4.3 Details (`views/details.tsx`) — *evaluate before playing*
All read paths were real. Additions: **Save** now dual-writes via `/api/games/[id]/save`; the **Community tab gains a comment composer** (`POST /api/games/[id]/comments`), previously play-only.

### 4.4 Sparks feed (`views/sparks.tsx`) — *short-form retention loop* — G4
| Feature | Goal | Backend contract | Status |
|---|---|---|---|
| Snap-scroll vertical feed | retention | `GET /api/sparks?cursor=` (paged, likes-ranked) — **the route existed but was never called**; feed showed 3 hardcoded stages | ✅ |
| Like a Spark | G5 | `POST /api/sparks/[id]/like {liked}` + store `toggleLikeSpark` (was local-only state) | ✅ |
| Comments drawer | G5 | `GET/POST /api/sparks/[id]/comments` — **existed, never called**; button was a toast | ✅ |
| Share | G5 | clipboard write of `/#view=sparks&spark=N` + toast (matches game-page behavior) | ✅ |
| Follow/Subscribe | G5 | `POST /api/creators/[id]/follow` + store `toggleFollow` | ✅ |
| Sound on/off, clear-screen, prev/next | UX local state | client-only (presentation) | 🟡 by design |
| "Not interested / don't recommend / report" | feed hygiene | client-side for now (needs moderation infra — §7) | deferred |

### 4.5 Channel (`views/channel.tsx`) — *creator identity* — G6
Was 100% mock (identity, 6 uploads, 5 shorts, 4 playlists, poll). Now:
| Feature | Backend contract | Status |
|---|---|---|
| Identity, banner, handle, stats (videos/subscribers/plays/joined) | **`GET /api/creators/[id]`** (new; resolves id/handle/name) → `ChannelDTO {creator, games, sparks, stats, recentComments}` | ✅ |
| Subscribe toggle | `POST /api/creators/[id]/follow` + store | ✅ |
| Videos tab + **Latest/Popular/Oldest sort chips that actually sort** | client sort over `ChannelDTO.games` | ✅ |
| Shorts tab | `ChannelDTO.sparks` (real clips) | ✅ |
| Live tab | `ChannelDTO.games.filter(isLive)` | ✅ |
| Playlists | games grouped by `category` | ✅ |
| Community tab | `ChannelDTO.recentComments` (real comments on the creator's games) | ✅ |
| Featured video card | top game by plays → **Play now** navigates to `play` | ✅ |
| Join (membership), bell (notifications) | monetization/push infra — bell now persists an opt-in via `/api/settings` key `notify:{creatorId}`; Join deferred (§7) | partial |
| Sidebar studios list | **`GET /api/creators`** (new) replaces hardcoded STUDIOS | ✅ |

### 4.6 You (`views/you.tsx`) — *your studio dashboard* — G6
Was an empty placeholder. Now renders `GET /api/studio` → `StudioDTO`: totals (games/plays/likes/followers/sparks), your games rail, saved-to-Library shelf (`savedGames`, new field), recent comments on your games, weekly play stats, spark stats.

### 4.7 Your games (`views/yourgames.tsx`) — G1/G3
Was one hardcoded card. Now renders `StudioDTO.myGames` — including **drafts** (Draft badge). Draft cards open the **Game Builder**; published cards open Play.

### 4.8 Trending / Live (`views/trending.tsx`, `views/live.tsx`)
Were static placeholders. Now render `HomeDTO.trending` / `HomeDTO.live` from `GET /api/home` with the real `GameCard` grid (hover previews included).

### 4.9 Leaderboards (`views/leaderboards.tsx`) — G5
Was 3 static rows. Now **`GET /api/leaderboards`** (new): `topPlayers` (Score grouped by player — total score, run count, best game) + `topGames` (most-played). Podium + table + games rail.

### 4.10 Explore + search (`views/explore.tsx`, topbar) — G4
Was 4 static cards with non-functional filter chips; topbar search navigated to Explore and dropped the query.
| Feature | Backend contract | Status |
|---|---|---|
| Search box | `GET /api/games?q=` (new param: title/description/tags/category/creator) + `GET /api/sparks?q=` (new) | ✅ |
| Type chips | **All / Games / Sparks** (the old "Experiences/Digital twins" chips had no data concept — replaced with honest filters) | ✅ |
| Topbar search hand-off | store `searchQuery` + `navigate("explore", {search})` + hash `&q=` | ✅ |
| Category filter | reuses `?category=` | ✅ |

### 4.11 New Task (`desk/newtask.tsx`) — *the creation entry point* — G1
| Feature | Goal | Backend contract | Status |
|---|---|---|---|
| Submit a task | G1 | **`POST /api/tasks`** — existed but the button only updated local state + toasted a **fake success**. Now: real call → ZAI LLM generates a full game spec (title/engine/category/description/theme) → draft `Game` row + completed `Task`. Button shows a running state ("Designing…"), result toast offers **Open in Game Builder**. | ✅ |
| Composer options | G1 | `model` + execution `mode` are sent with the task and stored on `Task` | ✅ |
| Task list (desk sidebar) | G8 | **`GET /api/tasks`** (existed, never called) — hydrates the list; entries link to their game (draft → Builder) | ✅ |
| Back to PlayLiquid button | UX escape hatch | mirrors settings' Back-to-workspace pill, navigates to the web experience | ✅ |
| Templates, context tokens (@, /, $, #), idle banner | composer affordances | client-side (prompt scaffolding) | 🟡 by design |
| Browser / Terminal side panels | G8 console feel | preview chrome only — embedding a real webview/shell is out of scope (§7) | deferred |

### 4.12 Game Builder (`desk/gamebuilder.tsx`, **new**) — *G2 + G3, the biggest gap*
The engine's `auto` demo mode, the orphaned `/api/agent` route and the `theme` save route all pointed at a builder that didn't exist. Now a new desk view (`view=build&game=…`):
| Feature | Backend contract |
|---|---|
| Live playtest canvas (manual + autoplay demo) | `GameEngine` (existing) fed by `GET /api/games/[id]` theme |
| Build Agent chat — "make it faster", "neon purple palette" | `POST /api/agent` (existing LLM route) → `{reply, patch}` applied live to the canvas |
| Manual controls: 5 palette color pickers, speed & difficulty sliders, theme label | client state → canvas |
| Save draft / Publish | `POST /api/games/[id]/theme {themeJson, version, status:"draft"\|"published"}` (existing) — published games immediately appear across discovery surfaces |
| Scenes/assets inspector | `GameDetailDTO.scenes` from `GET /api/games/[id]` |

### 4.13 Automations (`desk/automations.tsx`) — G7
Was 4 static template cards + toasts. Now a full CRUD loop on a new `Automation` model:
- `GET /api/automations` · `POST /api/automations` · `PATCH /api/automations/[id]` (rename/reschedule/enable/`markRun`) · `DELETE /api/automations/[id]`
- "Create scheduled task" opens a real form (name, schedule, prompt); templates create real automations; **Run now** executes the automation's prompt through the real task pipeline (`POST /api/tasks`, `mode:"Automation"`) and it appears in the task list.
- "Keep computer awake" persists via `/api/settings` key `keep-awake`.

### 4.14 Plugin Marketplace (`desk/plugins.tsx`) — G7
Install/enable toggles were local-only (reset on remount). Now: **`GET/PUT /api/plugins`** (new) persists per-plugin `{installed, enabled}` in the `Preference` store (key `plugin-states`), merged over the client catalog. Tabs remain presentational (Public/Community/Personal map to the same catalog — §7).

### 4.15 Settings (`settings.tsx`) — G7
Every control (language, interface mode, proactive suggestions, terminal profile/font/shell, restore workspace) was unpersisted; "Save" was a toast. Now **`GET/PUT /api/settings`** (new) persists all values as `Preference` rows; the shell hydrates from the server on open and saves on click. Left menu sections beyond General remain navigation scaffolds (values hidden per active panel — §7).

### 4.16 Topbar / Sidebar
- Voice search: deferred (needs ASR integration — §7).
- Notifications popover: shows server "all caught up" state; subscription to real push is §7.
- Appearance toggle: already persisted (`pl-theme` localStorage) — unchanged.
- Sidebar studios: real via `GET /api/creators` (§4.5).

---

## 5. Backend implementation (complete)

### 5.1 Prisma schema additions (`prisma/schema.prisma`)
```prisma
model LibraryItem { id, gameId→Game, createdAt, @@unique([gameId]) }   // server-side Library
model Automation  { id, name, prompt, schedule, enabled, lastRunAt?, createdAt }
model Preference  { key @id, value, updatedAt }                        // settings/plugin/notify KV
```
(`Game.savedBy LibraryItem[]` relation added; schema pushed with `bun run db:push`.)

### 5.2 Endpoint matrix (after this change-set)

| Endpoint | Method | Purpose | Consumers |
|---|---|---|---|
| `/api/home` | GET | feed rails payload | Home, Trending, Live |
| `/api/games` | GET | paged games · **+`q` search** · `category` filter | Home grid, Explore, design-card resolver |
| `/api/games/[id]` | GET | detail payload (theme, scenes, leaderboard, comments, updates, related) | Play, Details, **Game Builder** |
| `/api/games/[id]/play` `progress` `scores` `like` `comments` `theme` | POST | session/engagement/build-save (all pre-existing) | Play, Details, **Game Builder** |
| `/api/games/[id]/save` | POST | **new** — Library save/unsave | Play, Details, GameCard |
| `/api/sparks` | GET | paged sparks · **+`q` search** | **Sparks feed (now wired)**, Explore |
| `/api/sparks/[id]/like` · `comments` | POST/GET | spark engagement (pre-existing, now wired) | Sparks feed |
| `/api/creators` | GET | **new** — studio list | Sidebar |
| `/api/creators/[id]` | GET | **new** — channel payload (resolves id/handle/name) | Channel |
| `/api/creators/[id]/follow` | POST | follow/unfollow (pre-existing) | Play, Details, Channel, Sparks |
| `/api/studio` | GET | my studio dashboard · **+`savedGames`** | You, Your games |
| `/api/leaderboards` | GET | **new** — global top players + top games | Leaderboards |
| `/api/tasks` | GET/POST | task list + **LLM game generation** (pre-existing, now wired) | New Task, task list, Automations "Run now" |
| `/api/agent` | POST | Build Agent chat → theme patch (pre-existing, now wired) | Game Builder |
| `/api/automations` (+`/[id]`) | GET/POST/PATCH/DELETE | **new** — automations CRUD | Automations |
| `/api/settings` | GET/PUT | **new** — preference KV | Settings, keep-awake, notify opt-ins |
| `/api/plugins` | GET/PUT | **new** — plugin state persistence | Plugin Marketplace |

### 5.3 Creation pipeline (G1 end-to-end)
```
New Task prompt ─▶ POST /api/tasks {prompt, model, mode}
                    ├─ Task row (status running → completed)
                    ├─ ZAI LLM → GeneratedSpec {title, engine, category, description, tags, theme}
                    │   └─ fallback: deterministic templateSpec (never fails the user)
                    └─ draft Game row (status "draft", v0.1.0-draft, engine-matched preview)
                          └─ response {task: {id, status}, game: GameDTO, modelUsed, usedFallback}
Open in Game Builder ─▶ #view=build&game=… ─▶ live playtest + agent tuning (POST /api/agent)
Publish ─▶ POST /api/games/[id]/theme {status:"published"} ─▶ appears in Home/Explore/Trending
```

---

## 6. Frontend wiring (implemented after this report)

1. **Desk (Agent A):** New Task real submit (running state, result toast, builder hand-off) · task list hydration from `GET /api/tasks` with game links · **new Game Builder view** (canvas + agent chat + controls + publish) · Automations CRUD UI + Run-now · Plugin state persistence.
2. **Discovery (Agent B):** Sparks feed real data/like/comments/share · Channel from `GET /api/creators/[id]` with working sorts, real shorts/community/about · Explore search + type chips · topbar search hand-off · Trending/Live from `/api/home` · Leaderboards from `/api/leaderboards` · You + Your games from `/api/studio` (drafts → Builder) · sidebar studios from `GET /api/creators` · SparkTile deep-link index fix.
3. **Engagement surfaces (Agent C):** Save-to-Library dual-write in Play/Details/GameCard · Details Community comment composer · Settings persistence via `/api/settings`.

All wiring keeps the established patterns: `useApi` for GETs, `postJson` for writes, optimistic store updates mirrored server-side, toasts only for genuine feedback.

---

## 7. Explicitly deferred (with rationale)

| Item | Rationale / future backend |
|---|---|
| Auth & multi-user | single-tenant demo (`isMe` creator); production needs NextAuth + per-user rows for likes/library/progress |
| Join / channel memberships | payments (Stripe) + entitlement model |
| Real push notifications | needs web-push/webhook infra; opt-in persisted for now |
| Voice search | ASR integration (z-ai-web-dev-sdk ASR) — UX shell exists |
| Feed hygiene actions (not-interested/report) | needs moderation queue + personalized ranking model |
| Browser/Terminal panels embedding real content | sandboxed webview/PTY (e.g. E2B) — chrome is intentionally honest about being a preview |
| Plugin tabs (Public/Community/Personal) sourcing distinct catalogs | marketplace registry service; state persistence shipped |
| Dislike server-side | personalization signal only; becomes a server write when recommendation ranking exists |
| Per-commit Linux/Windows installers | covered by the separate Install & Release Contract (docs/product/INSTALL-AND-RELEASE-CONTRACT.md) |

---

## 8. Verification (completed 2026-11-01)

- `bun run lint` — clean (zero warnings). `tsc --noEmit` — zero errors in `src/`.
- **Browser-verified end-to-end:** Back button on New Task → home ✓ · task submit ("zen garden puzzle…") → running state → LLM draft "Zen Garden Puzzle" in task list ✓ · task click → Game Builder (canvas, 5 color pickers, sliders, scenes) ✓ · Build Agent chat applied a live palette patch (bg → deep ocean blue) with a clean reply ✓ · Publish → play page with live canvas ✓ · "Your games" shows drafts (badge) + published incl. the new game ✓ · Sparks: 5 paged stages with real clips, like (♡→♥), comments drawer (3 loaded, post prepended) ✓ · Channel: real identity/stats, 7 tabs, Oldest sort reverses correctly, bell opt-in persisted server-side ✓ · Leaderboards: podium + 12-player table from real score aggregates ✓ · Explore: topbar search "lava" → `#view=explore&q=lava` with games + sparks results ✓ · Settings: UI change → Save → `language:"French"` server-verified ✓ · Automations/Plugins CRUD persisted ✓.
- **Hardening during verification:** shared `extractJsonObject` (balanced-brace scanner) now backs both LLM routes — the naive first-`{`…last-`}` slice broke when the model appended prose after the JSON; `POST` aliases on `/api/settings` + `/api/plugins` (POST-only client helper); atomic read-merge-write transaction on plugin state; `useApi` request-generation guard (URL-change race); desk task-store hydration moved to a post-render effect (React "cannot update during render" warning eliminated); full 13-view console sweep clean; mobile (390px) clean on home/newtask/sparks/builder.
