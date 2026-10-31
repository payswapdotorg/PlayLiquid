# Game Preview Architecture (hover-to-play)

Implemented in `src/components/playliquid/hover-preview.tsx` — the flagship
discovery experience, adapted from the WebFlix video-hover-preview pattern.

## Design

- **One shared player.** `HoverPreviewLayer` is mounted once at the app root.
  Cards subscribe through `useHoverPreview(media)` which attaches
  `onMouseEnter` / `onMouseLeave` to the card article.
- **500 ms dwell** (`DWELL_MS`) prevents accidental playback; the timer is
  cleared on leave.
- **Geometry**: the layer positions itself at the hovered card's
  `[data-thumb-anchor]` bounding rect and **tracks it every frame** (rAF loop),
  so scrolling moves the preview with the card.
- **Keyed remount** per `previewUrl`: showing a new card destroys the previous
  `<video>` (pause → remove src → load()) — never two players.
- **Muted, inline, looping autoplay** with `playsInline`; `preload="auto"`.
- **Controls** (mute toggle + scrubbable timeline with aria slider semantics)
  take pointer events; the rest of the layer passes clicks through to the card,
  so the card stays clickable (opens the game page).
- **Moving between card ↔ controls does not close the preview** (relatedTarget
  checks against the card and `[data-preview-layer]`).
- **Leaving the card** stops playback and releases the source (verified:
  zero stray playing videos after exit).

## Device & honesty policy

- `deviceAllowsPreview()` returns false on `(hover: none)`, `(pointer: coarse)`
  or `prefers-reduced-motion: reduce` — touch devices and reduced-motion users
  never get autoplay previews (explicit interaction only).
- Failed playback falls back **honestly**: static thumbnail shows through plus
  a "Preview unavailable" pill. No fake slideshows.
- The preview is a **media asset, not a game execution** — hovering never boots
  a game engine; actual gameplay starts only via Play/Try.

## Media pipeline

`scripts/gen-videos.ts` generated the gameplay preview clips
(`/previews/<slug>.mp4`, landscape) and Sparks clips
(`/previews/sparks/<slug>-clip.mp4`, 9:16 source) alongside poster covers
(`/covers/<slug>.jpg`) via z-ai generation; `scripts/seed.ts` wires them into
Game rows (`thumbnailUrl` / `previewUrl`).

## Verified behavior (2026-10-31)

enter → 500 ms dwell → layer mounts at card geometry → muted video plays
(`lava-leap.mp4`, currentTime advancing) with controls → pointer exit → layer
unmounts, no stray players. Verified in a desktop-emulated input environment
(headless build reports `hover: none`; real desktop browsers report
`hover: hover`, where previews activate natively).
