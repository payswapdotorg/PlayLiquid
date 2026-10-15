#!/usr/bin/env bash
# RW-003 — baseline smoke run against the CURRENT-main packaged artifact
# (ZCode 3.14.3 AppImage from the release workflow, base 80d227b).
#
# Proven on the reference station (Debian 13, no FUSE, no root, CDP :9222
# occupied by the resident stack). This script is documentation-grade: it is
# the exact command the baseline evidence in ../evidence/ was produced with.
#
#   bash qa/desktop-release/scripts/run-baseline-station.sh
#
# Expected honest outcome on current main: startup, clean shutdown, packaged
# independence, viewports and offline stability PASS; the PlayLiquid identity /
# product-shell checks FAIL (annotated as expected baseline failures via
# --baseline-expectations — that failure pattern is the proof the harness
# detects real state before Workers A+B land).
set -euo pipefail

RELEASE_DIR="${RELEASE_DIR:-/home/z/station/release}"
ARTIFACT="${ARTIFACT:-$RELEASE_DIR/ZCode-3.14.3-linux-x86_64.AppImage}"
DEB="${DEB:-$RELEASE_DIR/ZCode-3.14.3-linux-amd64.deb}"
SUMS="${SUMS:-$RELEASE_DIR/SHA256SUMS}"
OUT="${OUT:-$(dirname "$0")/../evidence/baseline-zcode-3.14.3-appimage}"

exec node "$(dirname "$0")/run-smoke.mjs" \
  --artifact "$ARTIFACT" \
  --deb "$DEB" \
  --sums "$SUMS" \
  --out "$OUT" \
  --cdp-port 9333 \
  --display ":89" \
  --baseline-expectations \
  "$@"
