# Status — 2026-10-31

**State: complete and browser-verified.** All eight Figma surfaces, the
hover-preview architecture, the creation→publish→discovery loop, community
interactions, search, theming, and mobile behavior are verified end-to-end.
ESLint clean; dev server healthy on :3000; DB seeded.

## Pass 2 (later on 2026-10-31) — credentials + re-verification

1. **Credential handoff executed** (the instruction that still stood): all
   keys exported to `/home/z/my-project/.env` (single source of truth),
   `~/.bashrc` + `~/.profile` (profile sources the project `.env`), with
   primary→fallback ordering exactly as instructed. Verified live from this
   sandbox: GitHub PAT **and** fallback (200), OpenRouter (authenticated),
   Vercel T1 (200), Apify (valid). Vercel T2 returns 403 (fallback rejected;
   primary works, no impact). Neon ×4, Upstash ×2, Composio (ak_/ck_), E2B
   are exported but their API hosts are DNS-blocked from this sandbox —
   status, policy and re-check script: `docs/ops/CREDENTIALS.md`.
2. **Latent sidebar crash fixed** — found by re-verification: `SidebarNav`
   called `navigate(...)` in the studio rows and the Settings row without
   declaring it, so those clicks threw `ReferenceError: navigate is not
   defined` (the studio/Settings entries had never been click-verified).
   Fixed by declaring `navigate` in `SidebarNav`; re-verified in a fresh
   session: Settings → `#view=studio`, studio row → `#view=home`, zero
   page errors.
3. **Dev overlay unblocked the sidebar** — the Next.js dev indicator
   (`<nextjs-portal>`) covered the bottom-left corner and intercepted the
   Settings row / collapse control. `devIndicators: false` in
   `next.config.ts` (dev-only element; production never renders it).
4. **Sticky footer re-verified empirically** — tall-viewport (1440×2400)
   pin test: New Task (~1001px content) → footer bottom == viewport bottom,
   gap 0; long pages push it naturally (390px mobile: no horizontal
   overflow, footer at document end).

## Fixes applied in pass 1 (found by browser verification)

1. **Publish was fake** — `publish()` posted only the theme, toasted
   "v1.0.0 published", and left the Game row `draft`. Now: `POST /api/games/[id]/theme`
   accepts `status` (validated draft|published|archived); publish sends
   `version: "1.0.0", status: "published"`. Verified: DB shows
   `published` / `1.0.0` and "deep sea catch" appears in the home feed
   (studio dashboard moved it from Drafts to Published).
2. **Toasts were invisible** — feature code uses `sonner`, but the layout
   mounted the radix `<Toaster/>`. Swapped `src/app/layout.tsx` to the sonner
   Toaster; bell/save/publish/share toasts now render (VLM-verified).
3. **Draft version label** hardcoded "v0.1.0"; now shows the row's real
   `version` (e.g. `DRAFT v0.2.0-draft`).
4. **Sheet a11y** — mobile nav Sheet now carries an sr-only
   `SheetDescription` (removes the Radix "Missing Description" warning).
5. **Per-frame ReferenceError in the game loop** — vestigial `hudT` code in
   `game-engine.tsx` threw `hudT is not defined` on every animation frame
   during gameplay (~1000 entries per session). Removed the dead lines;
   re-verified zero page errors during active gameplay in a fresh session.

A hydration-mismatch report seen mid-session was traced to dev-mode HMR
rehydration during live edits; verified clean on fresh loads for both a
first-time visitor and a returning light-theme user (theme restored,
no console errors).

## Known gaps (honest)

- Hover previews require a hover-capable pointer (`hover: hover`); the
  headless verification build reports `hover: none`, so the preview was
  verified under desktop input emulation. Real desktop browsers activate it
  natively; touch devices intentionally never autoplay.
- Search suggestions are sourced from the home DTO held by the always-mounted
  Topbar (works on every view); it is not a dedicated search index.
- Demo is single-player/single-user: likes/follows/saves persist to SQLite;
  there is no auth layer.
- Game start hint says "press Space" — Space works when the start button has
  focus; pointer-down starts directly on canvas.

## Evidence

`docs/verification/ACCEPTANCE-REPORT.md`; screenshots under `tests/go-*.png`.
