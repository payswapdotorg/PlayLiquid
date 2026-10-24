# UX Work Items — PlayLiquid-Native Product Experience (post-release workstream)

Designated by operator issue #9 (2026-10-21): make PlayLiquid GameOS
unmistakably a PlayLiquid product, discoverable for new users, polished to an
Apple-quality standard of clarity and attention to detail, and easy to
download/install from this GitHub repository.

This is a NEW UX/release workstream layered on top of the completed 45/45
program (program/graph.json, closed at PL-045) and the completed release
workstream (spec/release/work-items.md, RW-001..004, release
`playliquid-gameos-v3.14.3`). Historical records are preserved; this ledger
tracks the UX work orders ONLY. The program ledger stays closed.

Ledger rules mirror the program's: one Work Order = one worker = one branch
= one PR; frozen write surface; no self-merge; acceptance = exact evidence.
Maximum three concurrent workers.

Base SHA for all UX work orders: `4f88d74682819a6bcad9d4b0ce89b171a8863c6c`
(main at ledger time; this ledger commit is its direct child).

Version/tag policy for the resulting release (TL-owned): fork minor bump to
`3.15.0`, tag `playliquid-gameos-v3.15.0` — a user-facing feature release
(PlayLiquid-native UX, responsive shell, onboarding, journey map, install
docs), no architecture change.

## Frozen cross-workstream contract (all workers implement/assert exactly this)

The shell marker vocabulary (UX-001 preserves/implements, UX-003 asserts):

| marker | element |
| --- | --- |
| `gameos-shell-bar` | the product top bar |
| `gameos-shell-brand` | the brand cluster (mark + name) |
| `gameos-nav-studio` / `gameos-nav-lab` / `gameos-nav-community` | the three workspace navigation buttons (labels: `Game Studio`, `Lab`, `Community`) |
| `gameos-nav-workbench` | the agent-workspace escape hatch — **label: `AI & Agents`** (replaces the inherited `ZCode workbench` label; title/hint states what it opens: models, agents and provider capabilities) |
| `gameos-workspace-host` | the mounted workspace host |
| `gameos-compose-failed` | the honest composition-failure banner |
| `gameos-shell-overflow` (optional) | a compact-width overflow control, if UX-001 uses one |

The empty-state vocabulary (UX-002 implements, UX-003 asserts): every
no-data surface in the three modules renders a container
`data-testid="gameos-empty-state"` that (a) explains what the surface is and
(b) offers at least one REAL next step `data-testid="gameos-empty-next-step"`
performing a supported operation through the module's existing typed
port/store actions (no dead controls, no fake success; cross-workspace
suggestions may be prose, not buttons — navigation is the shell's).

Geometry requirements (UX-001 implements, UX-003 enforces): at the actual
`MIN_DESKTOP_WINDOW_WIDTH` (480) window and at a 390×844 emulated viewport,
no brand, navigation item, workspace control or window control may overlap,
clip, overflow horizontally or become unreachable; the full navigation (all
three workspaces + the `AI & Agents` escape hatch) stays reachable through
the top bar (compact/collapsed forms allowed). Known baseline defect being
fixed: at 480px the `Game Studio` and `Lab` nav buttons currently overflow
off-screen (release evidence `ubuntu-20261015-061743`).

## UX-001 — Product visual design and shell (Worker A)

Branch: `ux/wa-product-visual-shell`.

Frozen write surface:
- `packages/desktop/src/renderer/src/gameos/shell/` (the whole shell tree:
  product-shell.tsx, shell-chrome.tsx, shell-tokens.ts + new shell files +
  colocated `*.test.ts(x)`)
- `packages/desktop/src/renderer/src/gameos/identity.ts` +
  `identity.test.ts` (product vocabulary only)
- `packages/desktop/src/renderer/src/gameos/index.ts` (re-exports)

Read-only references (imports allowed, files untouched):
`packages/game-ui/src`, `packages/web/gameos-lab/src`,
`packages/web/gameos-community/src`, all domain packages, the host adapters
(`gameos/host/**`). NO workspace manifest or lockfile changes. NO
main-process changes. NO qa/ changes (Worker C owns them).

Requirements:
- A coherent visual system for the shell: typography, spacing, surfaces,
  borders, color, icons, interactions, focus states, motion and
  empty/loading/error states — one design-token vocabulary in shell-tokens.ts,
  applied consistently. Do not recreate the inherited ZCode UI with a rebrand;
  do not copy Apple's logo or branding.
- PlayLiquid-first identity: startup, window identity, navigation and key
  shell surfaces clearly PlayLiquid. Replace the top-level `ZCode workbench`
  label with `AI & Agents` (frozen contract above) while keeping the real
  capability fully reachable (same navigation behavior, honest title/hint).
- Responsive top bar: at the actual 480px minimum window width and at
  390×844 emulated, all navigation stays reachable (compact labels, collapse
  or overflow patterns are all acceptable), no overlap/clipping/horizontal
  overflow, window controls never covered, brand readable. Fix the observed
  header overlap (release evidence ubuntu-20261015-061743: Game Studio/Lab
  off-screen at 480px).
- Clear hierarchy, restrained accents, predictable interactions, useful
  keyboard navigation (sensible Tab order, Enter/Space activation), visible
  focus on every interactive element, accessible contrast (WCAG AA for text
  and controls), `prefers-reduced-motion` respected for any added motion.
- Keep technical diagnostics available but secondary to task-oriented
  product language. No decorative dashboards, fabricated activity/metrics or
  non-functional buttons.
- Preserve the kept-mounted workspace design (HIDDEN display switching) and
  the E11 honest failure/retry discipline exactly.

Acceptance evidence (PR must include):
- base SHA; changed files; tests + exact commands (`node --test` on colocated
  shell tests; the module `pnpm --filter` patterns where applicable);
- dev-run or packaged screenshots of the reworked shell at 1280×800, the
  480px minimum window and 390×844 emulated, showing all navigation reachable
  and no overlap;
- a source-level inventory that the `ZCode workbench` label is gone from the
  product shell and the frozen marker vocabulary is present;
- environment limitations stated honestly.

## UX-002 — Onboarding and discoverable journeys (Worker B)

Branch: `ux/wb-onboarding-journeys`.

Frozen write surface:
- `packages/game-ui/src/**` (Game Studio)
- `packages/web/gameos-lab/src/**` (Lab)
- `packages/web/gameos-community/src/**` (Community)
- `docs/ux/JOURNEY-MAP.md` (new — the feature-to-journey map)

Read-only references: everything else (the desktop shell is Worker A's; the
qa harness is Worker C's). NO workspace manifest or lockfile changes. NO
changes to module contracts (`contract.ts` port shapes) or the frozen
architecture — continue using existing authoritative services and typed
ports. Submit an Architecture Change Request through the TL if a genuine
defect is found; do not add parallel authorities.

Requirements:
- `docs/ux/JOURNEY-MAP.md`: a feature-to-journey map in the frozen form
  `entry point → prerequisites → authoritative operation → result/state →
  test evidence` covering at minimum the seven journeys named in issue #9
  (open/create where supported; build/combine packages, avatars,
  capabilities, tools; run/preview/simulate/replay where implemented; Lab
  research/evidence/learning/escalation; publish/contribute/provenance;
  output targets honestly gated; AI/model/agent/provider configuration in
  PlayLiquid vocabulary). Every mapped operation must be REAL (wired to its
  authoritative port) or explicitly marked unsupported with its missing
  prerequisite.
- First-run empty states per the frozen contract: every no-data surface in
  Studio/Lab/Community explains what PlayLiquid is and gives real next steps
  (the module's own supported operations; cross-workspace suggestions as
  prose). Every action performs a real supported operation or explains the
  missing prerequisite. No fake success, no test fixtures as production
  sources.
- Contextual next steps on the Studio/Lab/Community surfaces: after real
  operations (refresh, search, append-only command flows), the UI states
  what just happened and what can be done next within existing module
  contracts.
- Journey wording uses PlayLiquid product vocabulary (the surfaces already
  do; keep it that way and improve clarity).

Acceptance evidence (PR must include):
- base SHA; changed files; tests + exact commands (`node --test "src/**/*.test.ts"`
  in each of the three trees; extended store/view tests for new states);
- the journey map with honest supported/unsupported marking;
- runtime evidence: dev-run screenshots of the new first-run/empty states and
  at least one exercised real operation per module (or the honest
  limitation state where the operation is unavailable);
- environment limitations stated honestly.

## UX-003 — Packaged UX acceptance QA (Worker C)

Branch: `ux/wc-packaged-ux-qa`.

Frozen write surface:
- `qa/desktop-release/**` (the whole harness tree: src/, scripts/, fixtures/,
  README, evidence)

Read-only references: everything else. The harness asserts the frozen shell/
empty-state contract and the geometry requirements; it does not modify
product code.

Requirements (strengthen `qa/desktop-release` so green CI means more than
"the window booted"):
- Geometry enforcement: computed-geometry assertions (bounding boxes via
  CDP) at 1280×800, the actual 480px minimum window width and 390×844
  emulated: no overlap between bar elements, no clipping, no horizontal
  overflow, primary actions visible and reachable. Any missing geometry or
  journey assertion FAILS the run; DOM presence alone or evidence capture
  alone is not a pass.
- Accessibility: keyboard navigation (Tab reaches brand → nav → escape
  hatch → workspace in a sensible order; Enter/Space activates), visible
  focus, accessible labels (aria-label/aria-current), primary heading
  hierarchy.
- First-run guidance: the empty-state contract renders (gameos-empty-state +
  a real next step) on the default first-run surface.
- PlayLiquid identity through the primary flow with no inherited ZCode
  primary branding; the `AI & Agents` escape hatch is present, honest and
  secondary.
- Journey smoke: click Studio/Lab/Community navigation and exercise a
  representative REAL operation through the production-wired ports (the
  existing studio-real-operation pattern extended to Lab and Community
  where wired); unavailable operations render truthful limitation states.
- Re-test and preserve: clean-profile packaged startup, packaged
  independence (file:// renderer, no dev env), offline dead-proxy behavior,
  checksum integrity, clean shutdown (both scenarios), console evidence.
- Evidence: screenshots at all three geometries, logs, transcript and the
  machine-readable report as workflow evidence; label which runs are Ubuntu
  under Xvfb versus a real desktop (honest environment labels).
- The harness must run against current main and report HONEST results —
  where a new check fails on the pre-UX-001/002 baseline, record it as the
  expected baseline failure (annotated, not hidden); after A+B integration
  (TL rebases the branch) the same checks must pass.

Acceptance evidence (PR must include):
- base SHA; changed files; harness run transcripts + exact commands;
  the baseline report on current main (honest pre-integration state) and
  the post-integration battery run (green) — the TL will coordinate the
  rebase after A+B merge;
  screenshots at 1280×800 / 480 window / 390×844 emulated; environment
  limitations stated honestly (Xvfb, distro, display server).

## UX-004 — TL integration, gates, artifacts and publication (TL-owned)

TL-owned surfaces: README.md + README.en.md (the prominent
Download-and-install section), root manifests (version bump), the release
workflow (`.github/workflows/release-desktop.yml`), spec central docs
(PROJECT-STATE post-integration record), this ledger's status, merge
decisions, the GitHub Release publication (tag `playliquid-gameos-v3.15.0`
at the exact tested commit, AppImage + .deb + SHA256SUMS, beginner-friendly
notes with checksum/install/launch steps, honest limitations), and
post-publication verification (download the published asset, SHA-256 verify,
launch).

Release workflow hardening (audited against issue #9): keep the source SHA
pinned through build, smoke and publication; publish exactly the artifacts
tested by the same run; generate and verify checksums; REFUSE a tag collision
when the existing tag points to a different commit (replace the current
`--clobber` overwrite path with an explicit consistency check).

## Status (TL integration record)

- UX-001 (Worker A): DELIVERED — PR #11 rebase-merged as `98cc6e8`
  (design system, density ladder full/compact/minimal, `AI & Agents`
  vocabulary, WCAG AA focus/contrast, reduced motion; 33 shell/identity
  tests, module trees green, arch 4/4/0-new).
- UX-002 (Worker B): DELIVERED — PR #10 rebase-merged as `162997d`
  (journey map `docs/ux/JOURNEY-MAP.md`, 14 empty-state surfaces with the
  frozen markers + real next steps; 44/48/38 tests across the three module
  trees; oxlint 0/0; arch unchanged).
- UX-003 (Worker C): DELIVERED — PR #12 rebase-merged as `bb2939b`
  (34-check battery: geometry ×3, a11y ×4, journey smoke ×4, first-run and
  escape-hatch contracts; honest 3.14.3 baseline 26 pass / 8
  expectedFailure / 0 unexpected, evidence committed in-repo).
- UX-004 (TL): integration commit (heading-hierarchy fix h3→h2 on the three
  module Panel primitives, root version 3.15.0, README download/install
  sections, release-workflow tag-collision refusal) + gate battery on
  integrated main + publication `playliquid-gameos-v3.15.0` + verification.

## Publication record (2026-10-24)

Released: `playliquid-gameos-v3.15.0` at the exact pinned, tested commit
`d9e13bc9c122eb7f3595598ae0423947a28e09e8` — CI battery 34/34 checks green
on BOTH flows (.deb install + AppImage; runs 40045502786 smoke and
40047774766 publish+verify); the published asset was downloaded,
SHA-256-verified and launched in-CI by the workflow's post-publication
verification. Issue #9 closed with the required TL report.
