#!/usr/bin/env bash
# RW-003 — run the packaged-app smoke harness on any Ubuntu machine
# (this is the exact recipe for the Ubuntu-latest release-workflow step and
# for TL re-runs after the A+B integration merge).
#
#   bash qa/desktop-release/scripts/run-ubuntu.sh /path/to/PlayLiquid-*.AppImage [/path/to/*.deb]
#
# Prerequisites (stock ubuntu-latest runner):
#   sudo apt-get update && sudo apt-get install -y xvfb
#   node --version  # >= 22 (built-in WebSocket + fetch; no npm install needed)
#   # FUSE is available on real Ubuntu → AppImages run directly;
#   # the harness falls back to --appimage-extract-and-run automatically.
#
# Optional .deb install-path verification (needs sudo, run OUTSIDE the harness):
#   sudo apt-get install -y ./PlayLiquid-*.deb
#   dpkg -l | grep -i playliquid
#   node qa/desktop-release/scripts/run-smoke.mjs --artifact "$(command -v playliquid)" \
#     --deb ./PlayLiquid-*.deb --sums ./SHA256SUMS
set -euo pipefail

ARTIFACT="${1:?usage: run-ubuntu.sh <AppImage-or-installed-executable> [deb]}"
DEB="${2:-}"
OUT="${OUT:-$(dirname "$0")/../evidence/ubuntu-$(date -u +%Y%m%d-%H%M%S)}"

args=(--artifact "$ARTIFACT" --out "$OUT" --cdp-port 9333 --display ":89")
if [ -n "$DEB" ]; then
  args+=(--deb "$DEB")
  if [ -f "$(dirname "$DEB")/SHA256SUMS" ]; then
    args+=(--sums "$(dirname "$DEB")/SHA256SUMS")
  fi
fi

exec node "$(dirname "$0")/run-smoke.mjs" "${args[@]}"
