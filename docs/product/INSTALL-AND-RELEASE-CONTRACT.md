# Install and Release Contract
Users must download and inspect PlayLiquid at every meaningful revision without cloning/building source.

## Preview builds
On every merge to main (and PR heads where feasible), use native GitHub Actions OS runners to build:
- Linux x64: .deb + AppImage.
- Windows x64: installer .exe (NSIS or supported existing Electron Builder target) + portable ZIP where feasible.

Upload artifacts to workflow run with direct links and publish immutable per-SHA/edge preview releases. README links latest successful preview. Include source SHA, version, timestamp, platform/architecture and SHA-256. Never overwrite artifacts for another SHA. Label previews non-stable and document retention. Build from exact tested commit.

## Stable tags
Publish both OS families, checksums, release notes, source SHA, SBOM/provenance and install/troubleshooting instructions.

## Smoke tests
Linux: clean .deb install/upgrade/uninstall, AppImage launch, desktop entry/icon/executable identity, New Task, model settings, Browser/Terminal, project selector, user data retention.
Windows: clean install, Start Menu shortcut, launch, identity, same critical journeys, upgrade/relaunch/uninstall and user data retention. Sign when certificate available; otherwise disclose unsigned/SmartScreen behavior.
Test actual packaged GUI on supported OS images; compile/package success alone is not proof. Fail publication if smoke/integrity gates fail.

## Identity and updates
PlayLiquid-specific app ID, executable, package identifiers, desktop entry, Windows installer identity, icons and update identity. Inherited ZCode auto-update must not install ZCode over PlayLiquid. No verified auto-update claims until signing, feed ownership, rollback and compatibility are real.

## Baseline to verify
README currently documents Linux .deb and AppImage. This is not evidence of Windows packaging or per-main-commit installable previews. Inspect actual workflows and release assets before claiming support.
