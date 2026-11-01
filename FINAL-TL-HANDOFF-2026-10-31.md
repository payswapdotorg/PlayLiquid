# FINAL TL HANDOFF — PlayLiquid (2026-10-31)

**Repo state at handoff:** branch `main`, HEAD `c0d3a47`, ESLint clean, dev
server verified healthy on `:3000`, SQLite seeded, every user-facing flow
browser-verified end-to-end (evidence: `tests/final-*.png`, 15 shots from the
final pass; earlier passes under `tests/v2-*.png`, `tests/resume-*.png`,
`tests/go-*.png` — 109 artifacts total).

> **Read this first — environment reality check.** The sandbox this project
> was built in was **rebuilt after the 2026-10-31 session documented in
> `docs/ops/CREDENTIALS.md`**. That file describes GitHub PATs, Vercel,
> Neon, Upstash, Composio, OpenRouter, Apify and E2B keys exported to
> `.env`. **None of those exist in the current environment** — `.env` holds
> only `DATABASE_URL`, there is no git remote, no `gh` CLI, and the GitHub
> API answers unauthenticated/rate-limited only. Treat every external
> credential claim in older docs as historical. Consequences are spelled
> out in *Outstanding actions* below.

---

## 1. What was delivered

PlayLiquid is a single-route (`/`) Next.js 16 App-Router SPA — a "GameOS"
product with two experiences:

1. **The web experience** (`playliquid-app.tsx`): sidebar + topbar shell,
   home feed with hover-preview game cards, Sparks vertical-video feed
   (5 stages), game play pages (live canvas engine), game details,
   creator channels, You/Your-games profiles, Trending / Live /
   Leaderboards / Explore (with real search over the games table), search
   suggestions, light/dark theme, full mobile responsiveness, sticky
   footer.
2. **The creator workspace** ("desk", ZCode-derived): New Task composer
   (project/branch selectors, context menu, execution mode, model +
   thought level, templates), **three exclusive side panels — Playtest
   (live game canvas) / Browser / Terminal** — Game Builder (playtest
   canvas, LLM Build-Agent chat that applies real theme patches, palette
   pickers, speed/difficulty, Save draft / Publish), Automations (full
   CRUD), Plugin Marketplace (install/enable persisted server-side),
   Settings (general + **Model settings restored from zai-org/zcode**).

### The end-to-end loop (all real, no mocks in the golden path)

prompt → `POST /api/tasks` (LLM Game Architect designs a full game spec,
5–30 s) → draft Game row → Game Builder opens it → Build Agent chat
(`POST /api/agent`) returns theme patches applied live to the canvas →
Save draft / Publish (`POST /api/games/[id]/theme`, status/version
transitions) → published game appears in discovery feeds and search →
plays/likes/scores write back (`/play`, `/like`, `/scores`).

## 2. The four design corrections (final session, commits `86e277c` + `c0d3a47`)

| # | Correction | Where | Verified |
|---|---|---|---|
| 1 | "‹ Back to PlayLiquid" pill on **every** desk page | `desk/desk-back.tsx` (floating + inline variants), used by newtask, build, automations, plugins | present on all 4 pages; navigates to a **clean** `#view=home` (stale `game`/`spark` params cleared — fixed in `c0d3a47`) |
| 2 | Desk logo toggles the left task list, matching the web logo's sidebar behavior | `desk/desk-shell.tsx` brand bar → `.desktop-shell.collapsed` rail, persisted in `localStorage` (`pl-desk-rail`) | collapse → reload → still collapsed; expand works identically; web logo parity checked |
| 3 | Live playtest as a **third** panel at the same level as Browser/Terminal | `desk/newtask.tsx` top-right three-way toggle + `PlaytestPanel` (build picker incl. drafts from `/api/studio`, shared `GameEngine` canvas, Play/Auto/Restart, open-in-builder) | live 800×450 canvas playing a published build; exclusive switching Playtest→Browser→Terminal; mobile 390 px no overflow |
| 4 | Full **ZCode model settings** restored | `model-settings.tsx` (805 lines) + `/api/models` CRUD + `POST /api/models/[id]/test` | Z.ai + BigModel presets; catalog add (Anthropic/OpenAI/OpenRouter/DeepSeek/Moonshot/custom); API-key row (masked, server-only, reveal toggle); per-model ZCode metadata (context window, max output, input types, capabilities, reasoning levels low→high); **real connectivity test** — verified live: dummy key → actual HTTP 401 from `api.z.ai`; draft re-syncs after Save (`c0d3a47`) |

The test route was the one real gap found in the final audit: the UI called
`POST /api/models/[id]/test` but the route did not exist. It now sends a real
authenticated request per API format (Anthropic `x-api-key` vs OpenAI
`Bearer`), 12 s timeout, honest `{ok, message, status}` reporting.

## 3. Architecture map

```
src/
  app/
    page.tsx                — the single route (mounts PlayLiquidApp)
    layout.tsx              — sonner Toaster, theme
    reconstruction.css      — the design-system stylesheet (v2 reconstruction)
    api/                    — 28 routes, see §4
  components/playliquid/
    playliquid-app.tsx      — web shell + view router (hash-synced)
    sidebar / topbar / logo / game-card / hover-preview / spark-tile
    settings.tsx            — settings window (incl. Model settings tab)
    model-settings.tsx      — ZCode model/provider settings (web adaptation)
    views/                  — home, sparks, play, details, channel, you, …
    mini-games/game-engine  — shared canvas engine (theme-driven)
    desk/                   — creator workspace
      desk-shell.tsx        — brand bar (rail toggle), nav, task list, user
      newtask.tsx           — composer + Playtest/Browser/Terminal panels
      gamebuilder.tsx       — playtest canvas + Build Agent + theme controls
      automations / plugins / desk-back / desk-tasks
  lib/
    store.ts                — zustand store, hash routing, persistence
    types.ts                — shared DTOs (incl. ZCode model-config types)
    db.ts                   — Prisma client
prisma/schema.prisma        — 12 models (Creator, Game, GameUpdate, Spark,
                              Comment, PlaySession, Score, Task, LibraryItem,
                              Automation, Preference, ModelProvider)
docs/                       — architecture / ops / plans / progress / reports /
                              verification (see STATUS.md for history)
```

## 4. API surface (28 routes)

| Route | Verbs | Purpose |
|---|---|---|
| `/api/home` | GET | home feed aggregate |
| `/api/games` | GET | list + `?q=` search + category/cursor paging |
| `/api/games/[id]` | GET | detail + related + leaderboard + updates + comments |
| `/api/games/[id]/play` `/like` `/save` `/progress` `/scores` `/comments` `/theme` | GET/POST | play/score/like/save/progress/comment; theme = save draft / publish |
| `/api/sparks` | GET | sparks feed |
| `/api/sparks/[id]/like` `/comments` | GET/POST | spark interactions |
| `/api/creators` `/api/creators/[id]` `/api/creators/[id]/follow` | GET/POST | creator directory/detail/follow |
| `/api/leaderboards` | GET | leaderboards view |
| `/api/studio` | GET | studio dashboard (drafts/published/metrics) |
| `/api/tasks` | GET/POST | task list; **POST = LLM Game Architect run** |
| `/api/agent` | POST | Build Agent — LLM theme patch |
| `/api/automations` `/api/automations/[id]` | GET/POST/PUT/DELETE | full automations CRUD |
| `/api/plugins` | GET/POST | plugin install/enable state (server-persisted) |
| `/api/settings` | GET/POST | preferences round-trip |
| `/api/models` | GET/POST/PUT/DELETE | ZCode model providers (presets Z.ai/BigModel + custom) |
| `/api/models/[id]/test` | POST | **real** provider connectivity test |

LLM calls go through `z-ai-web-dev-sdk` **server-side only**, with a
fallback path; tasks record `modelUsed`/`usedFallback`.

## 5. How to run and verify

```bash
bun run dev            # :3000 (only route: /)
bun run lint           # clean at handoff
bun run db:push        # prisma → db/custom.db (already applied)
```

Smoke path (2 minutes): open `/` → "Open the creator workspace" → submit
any prompt → "Open builder" in the toast → chat with the Build Agent →
Publish → Explore/search finds it → Settings → Model settings → Test
connection (needs a real API key to pass; failure messages are honest).

## 6. Outstanding actions

### 6.1 Push/merge — **COMPLETED 2026-11-01 (updated post-delivery)**

The operator supplied a PAT after the handoff doc was written. What the
delivery found and did:

1. **PR #14 was already merged** (squash `a6c3005`, docs-only: product
   contract + the desktop-track handoff docs). Nothing to merge.
2. **Remote `main` is the desktop-fork monorepo** (ZCode 3.14.3 lineage,
   pnpm workspace, deb/AppImage releases) — a different codebase from this
   web adaptation, with 200+ commits of progress: ACR-001 world-kind
   separation (PR #15), WorldKind/TargetProfile registries + dispatch
   (PRs #16/#18), cross-platform per-commit previews (PR #17), offline
   shell-wait fix (PR #19), audits (PR #21), World Projects workbench
   (PR #23). The web adaptation serves as its visual reference (see the
   `reference pictures` commits at the repo root).
3. **This web adaptation is preserved on the remote branch
   `handoff/web-adaptation-2026-11-01`** (this branch, head `a5a404c`+).
   Before publishing, the branch's **entire history was scrubbed of
   `.env`** — pre-rebuild commits (`cfb630b`, `66b5848`, `5c1d786` line)
   carried real credential values (GitHub/Neon/Vercel/OpenRouter/E2B/
   Apify/Composio/Upstash) and the repo is public. A sanitized `.env`
   (DATABASE_URL only) was re-added on top. The pre-scrub history remains
   only inside the original sandbox (local `refs/original/*`).
4. **Reference pictures of the four design corrections were committed to
   remote `main`** (`f620426`, following the prior `b81f726` pictures
   precedent): newtask playtest panel, model settings, game builder,
   automations back pill, desk rail collapsed, mobile playtest.

Lessons honored from the remote's own records: PR #20 was self-closed for
  duplicating canonical docs — so no new handoff docs were pushed to main;
  the pictures + this branch pointer are the only footprint.

### 6.2 Deferred by design (documented, not silently dropped)

| Item | Status / reason |
|---|---|
| Auth (NextAuth) | single-player demo; no auth layer (see `docs/architecture/PRODUCT-BOUNDARIES.md`) |
| Payments, push notifications | out of scope for this adaptation |
| Real webview Browser / real PTY Terminal | panels are honest previews (labels say so); wiring a live webview/PTY is desktop-track work |
| OAuth coding-plan entitlements (ZCode) | desktop-track |
| Figma frames | no Figma access in this environment; the reconstruction is source-of-truth (`reconstruction.css` + components) |
| Linux/Windows packaging, per-commit preview builds | **Done on the desktop track** (PR #17: cross-platform per-commit previews, Linux + Windows); for this web adaptation, `next build` works | 
| Spark Architecture Change Request | **Done on the desktop track** (PR #15: ACR-001 world-kind/target-profile separation, Phase B in PRs #16/#18); this web adaptation's Spark model remains stable and fully wired |

### 6.3 Docs needing a credibility pass (next owner)

- `docs/ops/CREDENTIALS.md` — describes keys that no longer exist here;
  kept for the record, annotated at top of this doc.
- `docs/progress/STATUS.md` — appended with the final pass (below).

## 7. Verification evidence (final pass, all in `tests/final-*.png`)

home → newtask (back pill + 3-way toggle) → playtest Auto demo → terminal
panel → automations/plugins/builder back pills → builder inline pill →
desk rail collapsed → model settings (presets, no-key test, **real 401
test**, DeepSeek add) → mobile 390 px newtask + playtest. Zero console
errors, zero page errors, no horizontal overflow, lint clean, dev.log all
200s.

— End of handoff.
