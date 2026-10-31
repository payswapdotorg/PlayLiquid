# Implementation Plan — status

Mapping of the handoff phases to this web adaptation. All phases complete
unless noted.

## Phase 0 — Baseline
- [x] Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui foundation
- [x] Prisma schema + SQLite (`db/custom.db`), seeded (13 games, 9 Sparks, 6 creators)
- [x] Media pipeline: covers, avatars, gameplay preview clips, Sparks clips
- [x] Dev server on :3000, ESLint clean

## Phase 1 — Protect ZCode (adapted)
- [x] Task/agent/model capabilities re-homed into New Task + Build Agent (see ZCODE-PRESERVATION-MATRIX.md)
- n/a Desktop/provider-settings track — out of scope for this environment

## Phase 2 — Reproduce the Figma experience (8 screens)
- [x] Home — hero, Continue-playing, Sparks shelf, Trending/Live, infinite grid
- [x] Play — live game canvas, HUD, game-over/restart, sessions, scores
- [x] Sparks — 9:16 snap feed, engagement rail, instant-play
- [x] Game Details — gameplay details, leaderboard, updates, recommendations
- [x] New Task — prompt, modes, agents, model, workspace, recent tasks
- [x] Game Studio — drafts, published, community feedback, open-builder
- [x] Game Builder — live attract-mode canvas, theme controls, Build Agent, save/publish
- [x] Creator Studio — analytics, releases, Sparks performance, moderation

## Phase 3 — WebFlix interaction reuse (clean-room)
- [x] App shell, feed shelves, cards, hover-preview, Shorts model, watch page, comments
- [x] Infinite scrolling (cursor pagination, verified 21→25 cards / cursor=9 page)
- [x] Desktop + mobile (drawer nav, no overflow) validated

## Phase 4 — Game preview asset pipeline
- [x] Preview media contract (`thumbnailUrl` + `previewUrl`) on every Game row
- [x] Shared hover-preview layer with dwell/mute/cleanup/fallback policies
- [x] Touch/reduced-motion: no autoplay (by design)

## Phase 5 — Product completeness
- [x] End-to-end creation loop: prompt → agent → builder patch → save → publish → appears in the home feed
- [x] Community interactions: like, follow, comments (all persisted via API)
- [x] Search with live suggestions + submit navigation
- [x] Theme toggle (dark/light), notifications, toasts
- [x] Packaging identity: PlayLiquid GameOS metadata, dark-first theme

See `docs/verification/ACCEPTANCE-REPORT.md` for evidence.
