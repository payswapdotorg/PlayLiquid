# qa/desktop-release — RW-003 packaged-app smoke tests, UI verification, launch evidence

Work order: `spec/release/work-items.md` **RW-003** (branch `release/wc-smoke-evidence`,
base `80d227b`). Module manifest: `src/module.ts` (`qa-desktop-release`,
per `spec/release/ACR-R1-desktop-product-release.md` Change 2).

This harness tests the **PACKAGED Linux application** — the AppImage (and the
.deb, metadata-level) produced by the release workflow — never a dev server,
never repo-relative renderer files, never dev-only env vars. Evidence is
window-level: the real Electron app runs under **Xvfb**, is driven via the
**Chrome DevTools Protocol (CDP)**, and produces screenshots, console logs and
process transcripts at the two mandated viewports (390×844, 1280×800).

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
| `no-zcode-primary-branding` | ZCode is not the primary UI identity |
| `product-shell-renders` | PlayLiquid product shell (Studio/Lab/Community) is the default surface |
| `studio-surface` / `lab-surface` / `community-surface` | the three product surfaces render (markers from the REAL modules: `packages/game-ui`, `packages/web/gameos-lab`, `packages/web/gameos-community`) |
| `product-navigation` | clicking the Studio / Lab / Community nav actually switches to the corresponding surface |
| `studio-real-operation` | representative REAL operation: the Studio `Refresh snapshot` control pulls an authoritative snapshot through the production-wired port without an E11 failure banner |
| `first-run-empty-state` | clean profile shows the no-data state (e.g. `no package records loaded`) |
| `clean-profile-startup` | app boots from empty HOME/XDG dirs and creates its own first-run state there |
| `viewports-evidence` | screenshots at 390×844 and 1280×800 (see honest note below) |
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
                      viewport-390x844-emulated.png, offline-dead-proxy-window.png
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
- **Baseline honesty**: on current main (pre-A/B integration) the identity and
  product-shell checks FAIL — this is the proof the harness detects real state
  (the artifact is ZCode-branded, the ZCode workbench boots as the default
  surface). Run with `--baseline-expectations` to annotate exactly those
  failures; after Workers A+B merge, the TL re-run (without the flag) must be
  all-green.

## Station baseline command (exact, proven)

```bash
bash qa/desktop-release/scripts/run-baseline-station.sh
# = node qa/desktop-release/scripts/run-smoke.mjs \
#     --artifact /home/z/station/release/ZCode-3.14.3-linux-x86_64.AppImage \
#     --deb /home/z/station/release/ZCode-3.14.3-linux-amd64.deb \
#     --sums /home/z/station/release/SHA256SUMS \
#     --out qa/desktop-release/evidence/baseline-zcode-3.14.3-appimage \
#     --cdp-port 9333 --display :89 --baseline-expectations
```

Memory discipline (reference station is a 3.9 GB box with a resident
production stack): the harness never uses broad `pkill` — it kills only the
process groups it started (tracked PIDs + a per-run unique token), runs one
Electron instance at a time, and gates each launch on ≥ 600 MB available.
