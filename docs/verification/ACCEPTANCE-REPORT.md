# Acceptance Report — 2026-10-31

E2E verification in a real browser (agent-browser/Chromium at 1440×900 and
390×844), cross-checked with DOM queries, network logs, direct SQLite reads
and VLM screenshot review. Dev server: :3000, ESLint clean.

## Surfaces (all 8 Figma screens)

| Surface | Evidence |
| --- | --- |
| Home | Hero (Lava Leap), Continue-playing rail, Sparks shelf, category tabs; images all load; VLM-verified |
| Play | Live canvas gameplay (score 0→21→game-over→restart, score 13 live); `POST /play` 200, `POST /scores` 200; watch-page chrome: like (200), follow (200 → "Following"), comment posted (3→4 comments, 200), leaderboard, updates, "More like" rail |
| Sparks | True 9:16 tiles (430×820) in y-mandatory snap feed; engagement rail (Like/Comments/Share) + instant-Play; VLM-verified |
| Game Details | "Gameplay details", leaderboard, updates, "You might also like" |
| New Task | Prompt/mode/agent/model/workspace controls; **live flow**: fishing prompt → agent → game "deep sea catch" created → builder opened (`POST /api/tasks` 200) |
| Game Studio | Draft builds / Published games / Community feedback; post-publish the game moved Drafts→Published |
| Game Builder | Attract-mode canvas; Build Agent patch ("sunset reef" warm palette) applied to live theme; Save build persisted theme JSON + bumped 0.2.0-draft; Publish → status `published`, version `1.0.0` (DB-verified) and game listed in home feed |
| Creator Studio | Plays-this-week chart, Games & releases, Sparks performance, Community moderation |

## Hover-to-play preview (flagship)

- enter → 500 ms dwell → shared layer at card geometry → muted video playing
  (`/previews/lava-leap.mp4`, currentTime advancing) with mute + scrub controls
- exit → layer unmounted, **0 stray players**; VLM-verified controls visible
- touch/reduced-motion: preview intentionally disabled (device policy)
- verified under desktop input emulation (this headless build reports `hover: none`)

## Platform behaviors

- Infinite scroll: 21→25 cards, `cursor=9` page fetched (200)
- Search: live suggestions listbox ("Lava Leap · Platformer"); submit navigates to details (`#view=details&game=…`)
- Theme toggle: dark ⇄ light (body → `lab(100 0 0)`), layout intact (VLM-verified)
- Notifications bell: sonner toast with description (VLM-verified)
- Mobile 390×844: no horizontal overflow, sidebar → drawer (Sheet) navigation, footer after content
- Sticky footer: `min-h-screen flex-col` shell + `mt-auto` footer — bottom on short pages, pushed naturally on long ones
- APIs: home/games/sparks/tasks/studio + [id] play/like/scores/comments/theme/progress, creators/follow — all 200

## Defects found & fixed during verification

1. **Publish didn't publish** (fake success toast; DB stayed `draft`) — fixed: theme route accepts validated `status`; publish sends `1.0.0` + `published`. Re-verified: DB + feed.
2. **All toasts invisible** (sonner calls vs radix `<Toaster/>` mounted) — fixed in layout; re-verified.
3. **Hardcoded draft version label** — now shows real `version`.
4. **Mobile nav Sheet** lacked a Dialog description (Radix a11y warning) —
   added sr-only `SheetDescription`; re-verified warning-free.
5. **Game loop threw `ReferenceError: hudT is not defined` every frame**
   during gameplay (vestigial dead code in `game-engine.tsx`). Removed;
   re-verified with a live window error listener during active play and a
   fresh browser session — zero page errors.

Hydration was investigated after transient reports: fresh loads hydrate
cleanly for first-time visitors and returning light-theme users (no console
errors); the transient reports came from dev-mode HMR rehydration during
live edits.

## Honest notes

- Headless build reports `hover: none`, so hover previews were verified with
  desktop input emulation; on real desktop browsers they activate natively.
- Game start via keyboard requires the start button to have focus (pointer
  starts immediately); hint text mentions Space.
- Single-user demo (no auth); social counts persist to SQLite.

Artifacts: screenshots `tests/go-*.png`, this report, `docs/progress/STATUS.md`.
