# Audit Record — WebFlix license/source + Git/package/live/replay authorities

Status: COMPLETE, 2026-10-31. TL-executed audits resolving the pending
dependencies of PLX-UX-002 (Worker B) and PLX-UX-003 (Worker C) recorded in
`spec/ux/work-items-next.md`. Research-only: no production code was touched.
Base: main `4ebcc66a6148af3c7de6689ee9664befd308953e`.

## Audit A — WebFlix license/source audit (PLX-UX-002 dependency)

Question: may WebFlix code be copied, or must PLX-UX-002 be clean-room?

### A.1 Vendored-code scan — no WebFlix code exists in this repository

Case-insensitive scan of the whole tree (8,832 tracked files) for
`webflix` / `web-flix` / `web_flix` / `flix`: matches only in four
documentation files (`spec/ux/work-items-next.md`, `spec/PROJECT-STATE.md`,
`docs/handoff/FINAL-TL-HANDOFF-2026-10-31.md`, `PRODUCT-NORTH-STAR.md`) —
all prose, every mention gating copying on this audit. Zero filename
matches; zero font files exist in the repository at all. Git history across
all 16 refs: the only flix-named path ever committed is
`docs/product/WEBFLIX-REUSE-MAP.md` on the unmerged branch
`handoff/final-product-ux-and-release-contract` (commit `7eb2d1f`) — a
documentation file that itself records "no WebFlix code has been copied
into this branch". The third-party manifests
(`third-party/copied-components.json`,
`third-party/embedded-components.json`, `third-party/inventory.json`,
`THIRD-PARTY-NOTICES.md`) list every vendored upstream — shadcn/ui (MIT),
vercel/ai-elements (Apache-2.0), Fig registry (MIT), Material Icon Theme
(MIT), VS Code IPC utilities (MIT), agent-browser skills (Apache-2.0),
Superpowers (MIT), React Best Practices (MIT), Skia and QuickJS-NG native
binaries — none is WebFlix or WebFlix-derived. The only media-player
dependency in the notices is `media-chrome@4.19.0` (MIT, muxinc), an
inherited ZCode dependency declared in `packages/ui/package.json` with no
source import anywhere (currently unused, legitimately available).

### A.2 Upstream identity and license — no license grant exists

The upstream repository is `https://github.com/payswapdotorg/WebFlix-2.0`,
recorded only in the unmerged branch's reuse map; no URL or commit SHA was
previously recorded on main. This audit inspected the upstream directly at
exact commit `e6a0a24d7aaf807ec86376f34a78286dd5b91966` (branch `main`,
shallow clone):

- **No LICENSE, COPYING or NOTICE file anywhere** in the repository.
- `package.json` has **no `"license"` field** and `"private": true`.
- No license statement in README.md or WORKLOG.md; no font files.
- Self-described as a YouTube clone (Next.js App Router + Prisma + live
  InnerTube/SSR YouTube scraping + a Netflix DRM playback integration).

Default copyright therefore applies: all rights reserved. Public visibility
is not a license. The upstream can also change after this audit — any future
reconsideration must re-pin the SHA and re-audit.

### A.3 Verdict — clean-room only

Compatible reuse **cannot** be established; it is affirmatively ruled out,
not merely unestablished. The handoff's fallback is explicit
(`docs/handoff/FINAL-TL-HANDOFF-2026-10-31.md`): "If compatible reuse
cannot be established, use as design/behavior reference. … Reuse the
interaction grammar: landscape cards, hover previews, infinite feed,
continue watching, portrait Shorts, watch page, channels, subscriptions,
comments, playlists, history, live and replay."

**PLX-UX-002 (Worker B) conditions, effective now:**

1. No WebFlix file, component, asset, font, style or code may be copied,
   vendored, ported or transplanted into this repository. Implementation is
   clean-room from PlayLiquid's own specs (`PRODUCT-NORTH-STAR.md`
   §Player experience, handoff §Player surfaces).
2. Do not port WebFlix's Next.js server actions, Prisma/DB adapters,
   YouTube adapters/broker, cache layers, or Netflix integration.
   "Reuse WebFlix's live stack" (handoff) is **rejected** — live/replay
   comes from PlayLiquid's own authorities (Audit B §3–4).
3. Observing behavior and recording behavioral notes (dwell delays,
   poster-fallback rules, one-active-preview discipline) is within
   "design/behavior reference".
4. Legitimate building blocks: vendored shadcn primitives (MIT) and
   `media-chrome` (MIT, already declared).

The license half of the PLX-UX-002 dependency is **RESOLVED**. The other
half — the approved Figma map (`docs/product/FIGMA-IMPLEMENTATION-MAP.md`,
status "pending exact frame inspection") — remains pending and still gates
dispatch, alongside the PLX-UX-001 Figma correction (Starter-plan MCP limit,
see the ledger).

## Audit B — Git/package/live/replay authorities audit (PLX-UX-003 dependency)

Question: what can Worker C reuse for world projects, package composition,
semantic PR/review, Your Channel/Subscriptions, Live & Replays, and chat?
Per-area inventory, wiring status and verdicts (entry points are exact):

### B.1 Git authority — PARTIAL (contracts reuse; engine BUILD-NEW)

`packages/git-lineage` (PL-012, ~3,655 LOC, 54/54 tests) is pure contracts:
lineage graph (`src/lineage.ts`), fork records (`src/fork.ts`), overlay
records (`src/overlay.ts`), the semantic-diff classification contract
(`src/semantic-diff.ts`: `SemanticDiff`, `SEMANTIC_CHANGE_KINDS`,
`classifyChangeKinds`, `validateSemanticDiff` — 11 frozen change kinds,
digest-pinned payloads), graph validation (`src/validate-lineage.ts`) and
the `LineageStore` port (`src/ports.ts`, no adapter exists — in-memory fake
only). Companion vocabulary: `packages/game-contracts/src/git.ts` (ref
formats). **No git execution, no PR/review/merge lifecycle, no textual diff
engine exists anywhere in GameOS.**

Do-not-duplicate flag: a real git engine already exists in ZCode —
`packages/services/src/git/gitCliRepo.ts` (1,712 LOC of real git CLI
execution) typed to ZCode workspace models. Worker C must not build a
second general git engine and must not import the ZCode one; the correct
path is a GameOS `LineageStore`/git adapter as a single new authority — a
TL architecture decision to be raised before that work starts.

### B.2 Package composition — REUSE-READY; semantic diff PARTIAL

`packages/package-system` (PL-002, ~3,717 LOC, 102/102 tests) implements
the full package model per `spec/package-contract.md`: kinds, scoped ids,
SemVer 2.0.0, `sha256:` digests over canonical JSON, overlays, fail-closed
publication, deterministic resolution (`src/resolve.ts`), lockfiles
(`src/lockfile.ts`), release gates (`src/release-gate.ts`).
`packages/package-registry` (PL-011, ~2,460 LOC, 65/65 tests) adds the
immutable registry (`openRegistry`, `src/registry.ts`) and dual
registry+CAS lock verification (`src/cas-binding.ts`), backed by
`@playliquid/artifact-store` (CAS ports; **in-memory fakes only — no fs
adapter exists**). Wired into the Game Studio packages panel today
(`packages/desktop/src/renderer/src/gameos/host/studio-adapter.ts`) — the
strongest wiring of any GameOS domain package. **The semantic-diff
producer is BUILD-NEW**: nothing computes a diff between two package/GameIR
states; the classification contract to emit is reuse-ready (B.1).

### B.3 Live + chat — BUILD-NEW (zero broadcast stacks exist)

Exhaustive search (`rtmp|webrtc|hls|livestream|broadcast|ffmpeg|media
server|start-live|live player`, case-insensitive, whole repo): no media
broadcast stack exists. The PLX-UX-003 clause "reuse existing live
implementation if legally and technically ready" has **no candidate** — so
Worker C's first implementation becomes *the* single broadcast authority
and must be a new registered package (never inside web/desktop). Closest
real asset: `packages/platform-multiplayer` (PL-016, ~5,628 LOC, 82/82
tests) — live *game-session state* machinery (intent admission, fixed-tick
advance, transport **port**, snapshots, settlement, replay/restore) with
zero consumers and no transport adapter. Naming hazards: ZCode
`packages/services/src/broadcast/` is IDE cross-window IPC, not a broadcast
stack; `platform-contracts` `ModerationSurface` "chat" and GameEventKind
`chat.message` are policy vocabulary only. **Chat (live/comment) is also
BUILD-NEW.** Scope decision for the TL/operator: either authorize/supply an
external broadcast stack, or scope "Start Live" honestly as a live game
session on the multiplayer kernel with honest labeling.

### B.4 Replay — PARTIAL (engine reuse; store/index/player BUILD-NEW)

`packages/replay` (PL-014, ~3,206 LOC, 63/63 tests) implements the complete
record model: sealed command streams (`src/command-stream.ts`), event
witnesses (`src/event-witness.ts`), immutable `ReplayRecord`
(`src/record.ts`: `sealReplayRecord`), deterministic re-execution
(`src/reexecute.ts`: `reExecuteReplay` via `ReplayTargetLauncher` port),
integrity verification (`src/verifier.ts`), `ReplaySource` port
(`src/source.ts`), in-memory fake store (`src/fakes.ts`). Consumed by
lab-simulation capture, `examples/native-game`, qa/performance — but the
desktop host's replay sink is session-scoped and honestly empty; **no
durable `ReplaySource` adapter (intended backing: artifact-store CAS), no
replay catalog/index, no player UI**. Policy layer:
`platform-contracts/src/replay.ts` (`ReplayServicePolicy`,
`authorizeReplayAccess`). Replay already spans three packages by design —
build on `packages/replay` doors; no fourth implementation.

### B.5 Social — PARTIAL (follow graph reuse; channels BUILD-NEW)

`packages/platform-social` (PL-015, ~1,901 LOC, 32/32 tests):
`SocialService` (`src/service.ts`) — follow/block edge tables, append-only
history, snapshot/restore, admission via `platform-contracts`
(`adjudicateSocialAction`). Implemented, tested, **unwired**. This is the
reuse-ready engine for Subscriptions (subscription ≈ follow edge + read
models). Channel/subscription content models, Your Channel, Liked/History
are BUILD-NEW. `packages/community` (PL-032, 64/64 tests) already carries
the wired contribution/review workflow (Community workspace) — reuse for
review surfaces; do not build a parallel contribution workflow.

### B.6 Recommended PLX-UX-003 execution order (defer-least-reusable-first)

1. **World projects + package composition + semantic PR** — highest reuse
   (registry/system/lineage contracts + proven gameos host patterns).
   Branch/PR lifecycle is the risky tail and needs the TL git-adapter
   decision (B.1) first; do not fork ZCode `services/src/git`.
2. **Replay record/index/play** — durable `ReplaySource` over
   artifact-store CAS + catalog + player, strictly through `packages/replay`
   doors.
3. **Your Channel / Subscriptions** — extend `platform-social` follow
   edges + new channel read models; reuse `community` for contributions.
4. **Live + chat** — last and largest; nothing reusable. Requires the
   operator/TL scope decision (B.3); first implementation registers as the
   single broadcast authority.

### B.7 Do-not-duplicate register (binding for Worker C)

(i) one git authority only — never a second engine, never an import of
ZCode `services/src/git`; (ii) `services/src/broadcast` is IDE IPC, not a
live stack; (iii) `packages/web/src/communityUrl.ts` is ZCode help config,
unrelated to GameOS community; (iv) social spans
platform-contracts/platform-social/community — extend, never parallel;
(v) replay spans game-contracts/platform-contracts/replay — extend, never
parallel; (vi) media playback UI may use the already-declared
`media-chrome` (MIT) — do not add a second player dependency without an
ACR-level decision.

## Effect on the ledger

- PLX-UX-002 dependencies: WebFlix license/source audit **RESOLVED
  (clean-room only, conditions A.3)**; approved Figma map still pending —
  dispatch remains HELD on that gate only.
- PLX-UX-003 dependencies: authorities audit **RESOLVED (verdicts + order +
  register above)**; combined with ACR-001 Phase B completion, PLX-UX-003
  is **READY TO DISPATCH** (TL records the frozen base SHA and write
  surface at dispatch time; step 1 of the execution order may start
  without the B.1 git-adapter decision, which gates only the branch/PR
  tail).
- PLX-UX-001: unchanged — HELD on the operator Figma gate (options (a)/(b)
  in the Phase-0 record).
