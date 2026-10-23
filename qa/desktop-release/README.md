# qa/desktop-release — RW-003/UX-003 packaged-app smoke tests, enforceable UX acceptance, launch evidence

Work orders: `spec/release/work-items.md` **RW-003** (branch `release/wc-smoke-evidence`,
base `80d227b`) and `spec/ux/work-items.md` **UX-003** (branch `ux/wc-packaged-ux-qa`,
base `ccb489b`) — the UX workstream strengthened this harness so green CI means
more than "the window booted". Module manifest: `src/module.ts` (`qa-desktop-release`,
per `spec/release/ACR-R1-desktop-product-release.md` Change 2).

This harness tests the **PACKAGED Linux application** — the AppImage (and the
.deb, metadata-level) produced by the release workflow — never a dev server,
never repo-relative renderer files, never dev-only env vars. Evidence is
window-level: the real Electron app runs under **Xvfb**, is driven via the
**Chrome DevTools Protocol (CDP)**, and produces screenshots, console logs and
process transcripts at the mandated viewports plus **computed-geometry
assertions at three widths** (1280×800, the 480px minimum OS window, 390×844
emulated).

## Prerequisites

- **Node ≥ 22** (uses built-in `fetch` + `WebSocket`; zero npm dependencies —
  deliberately portable to a stock `ubuntu-latest` GitHub runner).
- **Xvfb** (`apt-get install -y xvfb`).
- Enough free RAM: the harness enforces a **≥ 600 MB MemAvailable gate** before
  every Electron launch (waits up to 20 min on constrained boxes).
- Enough free disk in `TMPDIR` when the AppImage must run via
  `--appimage-extract-and-run` (no FUSE host — e.g. containers; ~1 GB).

## Run on any Ubuntu machine

```bash
# 1. prerequisites (stock ubuntu-latest runner)
sudo apt-get update && sudo apt-get install -y xvfb
node --version   # >= 22

# 2. run against the packaged artifact (from the repo root)
node qa/desktop-release/scripts/run-smoke.mjs \
  --artifact /path/to/PlayLiquid-GameOS-1.0.0-linux-x86_64.AppImage \
  --deb /path/to/PlayLiquid-GameOS-1.0.0-linux-amd64.deb \
  --sums /path/to/SHA256SUMS \
  --out qa/desktop-release/evidence/release-<label>

# convenience wrapper doing exactly the above:
bash qa/desktop-release/scripts/run-ubuntu.sh /path/to/*.AppImage [/path/to/*.deb]
```

Optional `.deb` install-path verification (needs `sudo`, outside the harness):

```bash
sudo apt-get install -y ./PlayLiquid-GameOS-*.deb
node qa/desktop-release/scripts/run-smoke.mjs --artifact "$(command -v playliquid)" --deb ./PlayLiquid-GameOS-*.deb
```

Key options (all also settable via `QA_RELEASE_ARTIFACT` / `QA_RELEASE_DEB` /
`QA_RELEASE_SUMS`):

| option | meaning |
| --- | --- |
| `--artifact` | packaged executable: AppImage, or an installed binary path |
| `--deb` | `.deb` to inspect for packaging identity (no root needed) |
| `--sums` | `SHA256SUMS` file (auto-detected next to the artifact) |
| `--out` | evidence directory (default `evidence/run-<id>`) |
| `--cdp-port` | main-run CDP port, default **9333** (never 9222 — collides with resident stacks); the offline scenario uses `cdp-port + 1` |
| `--display` | Xvfb display, default `:89` (auto-falls back through `:80`-`:89`) |
| `--expected-title` | override the expected window title (default `PlayLiquid GameOS`) |
| `--baseline-expectations` | annotate the known pre-A/B failures (see below) |
| `--skip-offline` | skip the dead-proxy offline scenario |

Exit code: `0` all checks pass (or only *annotated expected* failures with
`--baseline-expectations`); `1` any unexpected failure; `2` nothing ran; `3`
harness error. The JSON report always records the **raw observed status** of
every check — `--baseline-expectations` only adds an `expectedFailure` label
and excludes exactly those IDs from the exit-code calculation.

## What is checked

| id | check |
| --- | --- |
| `artifact-checksum` | artifact sha256 vs `SHA256SUMS` |
| `startup` | packaged app starts under Xvfb (CDP endpoint + main window target + settled DOM) |
| `packaged-independence` | main window loads `file://` (packaged renderer); no dev env vars in the child environment; launched from a neutral cwd |
| `window-title-captured` | the actual window/document title, recorded |
| `product-identity-title` | title carries the PlayLiquid GameOS identity |
| `no-zcode-primary-branding` | ZCode is not the primary UI identity — UX-003 tightened: title, headings, headers AND the shell top bar must carry NO ZCode text (the frozen escape-hatch label is `AI & Agents`) |
| `workbench-escape-hatch-label` | UX-003: `[data-testid=gameos-nav-workbench]` is present, visible, labeled exactly **`AI & Agents`** (frozen shell vocabulary), with an honest title/hint, as a secondary affordance (no `aria-current="page"`) |
| `product-shell-renders` | PlayLiquid product shell (Studio/Lab/Community) is the default surface |
| `studio-surface` / `lab-surface` / `community-surface` | the three product surfaces render (markers from the REAL modules: `packages/game-ui`, `packages/web/gameos-lab`, `packages/web/gameos-community`) |
| `first-run-empty-state` | clean profile shows the no-data state (e.g. `no package records loaded`) |
| `gameos-empty-state-contract` | UX-003: the default first-run surface renders the frozen empty-state vocabulary — a visible `[data-testid=gameos-empty-state]` container offering a REAL next step `[data-testid=gameos-empty-next-step]` with an enabled interactive control (no dead controls, no fake success) |
| `product-navigation` | clicking the Studio / Lab / Community nav actually switches to the corresponding surface |
| `studio-real-operation` | representative REAL operation: the Studio `Refresh snapshot` control pulls an authoritative snapshot through the production-wired port without an E11 failure banner |
| `lab-real-operation` | UX-003: the Lab `Refresh read models` control pulls its authoritative read model through the production-wired data port (no E11 banner) |
| `community-real-operation` | UX-003: the Community `Refresh read models` control pulls its authoritative read model through the production-wired data port (no E11 banner) |
| `lab-command-outcome-visible` | UX-003: dispatching the Lab request-search typed intent through its real control renders its typed outcome in the append-only command log — accepted OR a typed refusal (the observed 3.14.3 baseline refusal is `invalid-context`, the no-revision refusal); silence/fake success fails |
| `community-lifecycle-honest-gate` | UX-003: the unavailable maintainer workflow renders a truthful limitation state — either no advance controls + visible guidance, or controls whose dispatch renders a typed refusal; fake powers or a dead surface fail |
| `clean-profile-startup` | app boots from empty HOME/XDG dirs and creates its own first-run state there |
| `viewports-evidence` | screenshots at 390×844 and 1280×800 (see honest note below) |
| `geometry-1280x800` | UX-003: computed bounding boxes at the real 1280×800 OS window — every bar element (brand, three nav buttons, escape hatch, window controls) present, visible, non-zero, pairwise NON-overlapping, unclipped by the viewport, no horizontal overflow (document + bar scrollWidth), labels not internally truncated; navigation must be directly visible or reachable through the optional `[data-testid=gameos-shell-overflow]` control |
| `geometry-480-window` | UX-003: the same geometry contract at the ACTUAL 480px minimum OS window (`MIN_DESKTOP_WINDOW_WIDTH`, reached via `Browser.setWindowBounds` when available, `window.resizeTo` fallback) |
| `geometry-390x844-emulated` | UX-003: the same geometry contract at the 390×844 emulated viewport (CDP `Emulation.setDeviceMetricsOverride`) |
| `a11y-keyboard-navigation` | UX-003: Tab reaches the bar navigation in a sensible order (brand first when focusable, then Studio → Lab → Community → escape hatch) and **Enter/Space activate** navigation (surface switches, `aria-current="page"` moves) — driven via CDP `Input.dispatchKeyEvent` |
| `a11y-visible-focus` | UX-003: keyboard-focused bar controls render a visible focus indicator (computed outline/box-shadow, or any focused-vs-blurred style change) |
| `a11y-accessible-names` | UX-003: every visible interactive element (bar + active surface) has an accessible name (aria-label / aria-labelledby / text / title); the active nav carries `aria-current` |
| `a11y-heading-hierarchy` | UX-003: every surface has its h1 and visible heading levels never skip (the 3.14.3 surfaces skip h1 → h3) |
| `packaging-identity` | desktop entry / .deb package metadata serves the PlayLiquid identity |
| `error-handling-offline-render` / `error-handling-offline-stability` | with all renderer network egress dead (`--proxy-server` to a closed port), the app still renders, stays alive and responsive — visible degradation, not breakage |
| `clean-shutdown` / `clean-shutdown-offline` | CDP `Browser.close` → exit code 0 within bounds, no orphan processes (both scenarios) |
| `console-evidence-recorded` | renderer console entries captured as evidence |

## Evidence layout

```
evidence/<run>/
  report.json         machine-readable results (raw statuses + counts + env + evidence file index)
  transcript.txt      human-readable run transcript
  screenshots/       viewport-1280x800-window.png (real resized OS window),
                      viewport-1280x800-emulated.png, viewport-390x844-clamp-attempt.png,
                      viewport-390x844-emulated.png, geometry-1280x800.png,
                      geometry-480px-window.png (the real 480px minimum OS window),
                      geometry-390x844-emulated.png, offline-dead-proxy-window.png
  logs/               app-main-stdout.log, app-offline-stdout.log, console-*.json,
                      cdp-targets-main.json, xvfb.log, harness.log
```

## Honest scope & limitations

- **Station distro**: the committed baseline evidence was produced on the
  reference station, which is **Debian 13**, not Ubuntu (no root, no FUSE, no
  real GPU/display server). Running this same harness on `ubuntu-latest` is the
  TL integration step (`scripts/run-ubuntu.sh` is the exact recipe). This is
  recorded in every report's `environment` block.
- **AppImage launch mode**: without FUSE the harness launches with
  `--appimage-extract-and-run` (recorded per-run in `report.json`). On Ubuntu
  with FUSE the AppImage runs directly — the harness auto-detects `/dev/fuse`.
- **CDP switch**: the only non-user launch flag is Chromium's standard
  `--remote-debugging-port` (evidence channel). The offline scenario adds
  `--proxy-server` (standard Chromium switch) — recorded in the report notes.
- **Neutral-cwd discipline (observed artifact behavior)**: the current
  packaged app resolves its agent runtime with a `findUpward(...)` chain
  anchored at the process cwd — launched from inside a ZCode/PlayLiquid repo
  checkout it binds the repo's dev agent (tsx + `src/main.ts`) instead of the
  bundled `resources/glm/zcode.cjs` runtime, and its first-run storage
  preparation then fails ("Startup preparation failed" screen). The harness
  therefore always launches the packaged app with cwd = the clean-profile
  HOME, exactly like a real desktop user (whose cwd is never a repo). The
  observation is recorded per-run in the report notes; whether the upstream
  cwd-sensitivity itself should be fixed is a TL decision, not a harness one.
- **390×844 viewport**: the desktop main window enforces `minWidth: 480`
  (`packages/desktop/src/main/desktopWindowSize.ts`), so a 390-px OS window is
  clamped by product design; the 390×844 viewport is captured via CDP device
  metrics emulation (the DevTools device-mode equivalent) and the clamped
  real-window attempt is recorded alongside. 1280×800 is captured as a REAL
  resized OS window (`window.resizeTo`, honored by Electron for its own
  windows; under Xvfb there is no WM decoration so outer == inner). If a host
  ever refuses the real window resize, the check falls back to the emulated
  capture and says so.
- **Offline scope**: the dead proxy makes *renderer-side* network egress fail
  (the app's in-process host services are unaffected). This is the honest
  window-level simulation of an unavailable external service without app
  cooperation.
- **UX-003 geometry scope (what a virtual display can and cannot assert)**:
  the geometry checks measure COMPUTED boxes (`getBoundingClientRect`) at a
  real resized OS window (1280×800 and the 480px minimum) and the 390×844
  CDP device-metrics emulation — they assert the layout contract (no overlap,
  no clipping, no overflow, reachable navigation), which is exactly what a
  headless run can prove. What it cannot prove: real compositor/WM behavior
  (decorations, resize animations, HiDPI mixing), real GPU rasterization and
  the exact font metrics of other hosts — on the Ubuntu CI runner (different
  fonts) the same 3.14.3 defect manifests as the Game Studio/Lab nav itself
  overflowing off-screen, while on this Debian station the same run shows
  the Close control clipped and the bar overflowing (scrollWidth 508 > 480);
  the check catches both because it asserts the contract, not a specific
  element. The 480px window is reached via `Browser.setWindowBounds` where
  the runtime implements it, with `window.resizeTo` as the recorded fallback
  (under Xvfb there is no WM, so outer == inner size).
- **UX-003 keyboard scope**: keys are dispatched through CDP
  (`Input.dispatchKeyEvent` — full `keyDown`/`keyUp`; Enter carries `text
  "\r"` because CDP treats a textless keyDown as rawKeyDown and Chromium's
  button activation for Enter only fires on a non-raw keydown — live-caught
  on the 3.14.3 baseline). `:focus-visible` is matched under keyboard focus
  per the browser's own heuristic; the pass criterion is the COMPUTED
  indicator, not the pseudo-class alone.
- **Baseline honesty (UX-003)**: on the pre-UX-001/002 baseline (the published
  `PlayLiquid-GameOS-3.14.3` release, built from main `4f88d746`) the frozen-
  contract checks FAIL and are annotated via `--baseline-expectations`:
  `no-zcode-primary-branding` + `workbench-escape-hatch-label` (the inherited
  `ZCode workbench` label is still shipped; frozen new label `AI & Agents`),
  `gameos-empty-state-contract` (UX-002 not implemented), the three
  `geometry-*` checks (no `gameos-shell-brand` marker + the known 480px/390px
  overflow defect), `a11y-visible-focus` (no focus styles) and
  `a11y-heading-hierarchy` (h1 → h3 panel skips). Everything else — the whole
  RW-003 battery, the journey checks (Lab/Community real operations, the
  honest `invalid-context` typed refusal on Lab) and keyboard navigation —
  passes. After Workers A+B merge, the TL rebases this branch and re-runs
  WITHOUT the flag: the same checks must be all-green.

## Station baseline commands (exact, proven)

```bash
# RW-003 historical baseline (the pre-release ZCode-branded artifact):
bash qa/desktop-release/scripts/run-baseline-station.sh

# UX-003 baseline — the published PlayLiquid-GameOS-3.14.3 release (main
# 4f88d746, the honest pre-UX-001/002 state; evidence in
# evidence/ux-baseline-3.14.3/):
TMPDIR=/home/z/station/tmp node qa/desktop-release/scripts/run-smoke.mjs \
  --artifact /home/z/station/baseline/PlayLiquid-GameOS-3.14.3-linux-x86_64.AppImage \
  --deb /home/z/station/baseline/PlayLiquid-GameOS-3.14.3-linux-amd64.deb \
  --sums /home/z/station/baseline/SHA256SUMS \
  --out qa/desktop-release/evidence/ux-baseline-3.14.3 \
  --baseline-expectations
# observed: 26 pass / 8 expected failures / 0 unexpected, exit code 0
# (TMPDIR must live on a volume with ~1 GB free — the AppImage runs via
# --appimage-extract-and-run on this FUSE-less station and the harness cleans
# its extraction temp dir after every run.)
```

Memory discipline (reference station is a 3.9 GB box with a resident
production stack): the harness never uses broad `pkill` — it kills only the
process groups it started (tracked PIDs + a per-run unique token), runs one
Electron instance at a time, and gates each launch on ≥ 600 MB available.
