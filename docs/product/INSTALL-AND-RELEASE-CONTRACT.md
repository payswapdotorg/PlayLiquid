# Install and Release Contract
Users must download and inspect PlayLiquid at every meaningful revision without cloning/building source.

This document records the contract AND what currently exists to satisfy it
(implemented by PLX-REL-001 — workflow `.github/workflows/release-desktop.yml`,
harnesses under `qa/desktop-release/`). Where something is required but not yet
proven, this document says so instead of claiming it.

## Preview builds

**Required:** on every merge to main (and PR heads where feasible), native
GitHub Actions OS runners build from the EXACT commit SHA:
- Linux x64: `.deb` + AppImage.
- Windows x64: NSIS installer `.exe` + portable ZIP.

**What exists now:**
- `push` to `main` triggers a full cross-platform run: `linux-desktop`
  (ubuntu-latest) and `windows-desktop` (windows-latest) both check out the
  pinned commit SHA, build, run their packaged-app smoke batteries, upload
  Actions artifacts (7-day retention), and — only if BOTH jobs succeed — the
  `publish` job publishes an immutable per-SHA GitHub **prerelease** tagged
  `preview/<short-sha>` carrying all four installers + `SHA256SUMS` +
  `BUILD-INFO.txt`. The `publish-status` job always records what did and did
  not publish, and why.
- PR heads ("where feasible", documented choice): a pull request that receives
  the `release-preview` label triggers the same two build jobs from the EXACT
  PR head SHA (`github.event.pull_request.head.sha` — never the merge ref),
  uploading Actions artifacts only (7-day retention). No release is published
  from PR heads; remove and re-add the label to rebuild after new pushes.
- Manual: `workflow_dispatch` with `publish_preview=true` publishes a
  `preview/<short-sha>` prerelease from any ref; `publish_release=true` is the
  stable path (below).

**Immutability & retention:**
- Preview releases are immutable per SHA: the tag is pinned to the built commit
  (a tag existing at a DIFFERENT commit is refused — same collision policy as
  stable tags), asset uploads never use `--clobber`, and a re-run of the same
  SHA only uploads assets that are missing. Another SHA's artifacts are never
  overwritten.
- Retention: transient Actions artifacts expire after 7 days (30 days for
  stable publish runs); the immutable per-SHA preview releases are retained
  until explicitly pruned by the maintainers.
- Every artifact identifies the commit SHA, version, build timestamp (UTC),
  OS/architecture and SHA-256: `SHA256SUMS` (GNU format, merged across OS
  families) plus `BUILD-INFO.txt` in the release, and the same metadata in the
  release notes.
- Previews are labeled prereleases and marked "unstable per-commit preview" in
  the release notes.

## Stable tags

**Required:** both OS families, checksums, release notes, source SHA,
SBOM/provenance and install/troubleshooting instructions.

**What exists now:** `workflow_dispatch` with `publish_release=true` builds
both OS families from the pinned SHA and publishes the stable tag (default
`playliquid-gameos-v<version>`), pinned to the built SHA with tag-collision
refusal at a different commit (issue #9 policy), carrying AppImage + `.deb` +
`.exe` + `.zip` + merged `SHA256SUMS` + `BUILD-INFO.txt`, honest notes
(unsigned Windows disclosure, auto-update disabled), and post-publication
re-verification (published assets re-downloaded and checksum-verified; the
published `.deb` reinstalled and launched through the Ubuntu smoke harness).
SBOM/provenance beyond checksums and build identification is still pending
(no SBOM format chosen yet — recorded, not claimed). The existing published
stable releases (v3.14.3, v3.15.0) predate Windows packaging and are
Linux-only; the first cross-platform stable release must be dispatched after
PLX-REL-001 merges.

## Smoke tests

**Linux (unchanged RW-003 battery, ubuntu-latest):** clean `.deb`
install/upgrade/uninstall, AppImage launch, desktop entry/icon/executable
identity, product shell rendering + navigation, first-run states, dual
viewports, offline resilience, clean shutdown; the published `.deb` is
re-verified by download + checksum + launch after publication.

**Windows (PLX-REL-001 headless battery, windows-latest):** artifact
checksums; portable ZIP payload structure + launch; silent NSIS install
(`/S`, per-user) with install-dir/exe presence, packaged
`.zcode-install-manifest`, Start Menu shortcut, HKCU uninstall registry
identity; installed-app launch with process identity (exe path), window-title
product identity, Electron userData creation; data retention across a
reinstall-over-existing + relaunch; silent uninstall removing app/shortcut/
registry while retaining user data. Honest scope: no synthetic GUI
interactions are driven; the "upgrade" check is a same-version reinstall (a
cross-version upgrade needs two builds — recorded as follow-up, not claimed);
the app is launched with `--disable-gpu` from a neutral working directory.
See `qa/desktop-release/README.md` (Windows section) for the full check table.

**Signing:** no code-signing certificate exists; Windows installers are
unsigned and every release discloses SmartScreen/"unknown publisher"
behavior. Sign when a certificate is available. **No verified auto-update is
claimed anywhere.**

**Publication gating:** publication requires BOTH OS build jobs (and their
smoke batteries) to succeed; a run that cannot produce both families records
the honest status (`publish-status` job) and publishes nothing.

## Identity and updates

PlayLiquid-specific app ID (`org.playliquid.gameos`), executable
(`playliquid-gameos` on Linux; `PlayLiquid GameOS.exe` on Windows), package
identifiers, desktop entry, Windows installer identity (registry
DisplayName/Publisher), icons and update identity all come from
`packages/desktop/scripts/desktop-product-identity.mjs` (single source of
truth). The inherited ZCode auto-update feed stays DISABLED
(`remoteUpdateFeedEnabled: false`): it only distributes ZCode builds and would
replace PlayLiquid with ZCode. No auto-update is enabled or claimed until a
PlayLiquid-owned feed with signing, feed ownership, rollback and compatibility
exists.

## Governance workflow trigger (verified 2026-10-31, PLX-REL-001)

The Phase-0 audit recorded the governance workflow's `push:` trigger as
`branches: ain]` ("appears malformed — verify/fix when PLX-REL-001 touches
workflows"). Verified at base SHA `79c6acd`: the file reads
`push: branches: [main]` (byte-identical local vs remote; blob
`be6ad37e216e2479caf230f1fd13bf3ee8bb3d45`), the YAML is valid, and the
trigger demonstrably works — the governance workflow has 100 successful
`push` runs on `main` (latest on `79c6acd` itself, run 41198911672). The
`ain]` reading was a decoding artifact, not a repository defect; no fix was
needed and none was made.

## Baseline history (superseded by the sections above)

README originally documented Linux `.deb` and AppImage only. The Phase-0
audit (2026-10-31) established that no Windows packaging, Windows smoke
harness, or per-commit preview builds existed at that time; PLX-REL-001
implements them per this contract. Actual workflow runs and release assets
outrank this document — inspect them before claiming support.
