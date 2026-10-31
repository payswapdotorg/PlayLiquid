# Cross-Platform Desktop Distribution Contract

**Current published baseline:** PlayLiquid GameOS 3.15.0, Linux x64 only.  
**Repository workflow reviewed:** `.github/workflows/release-desktop.yml` at main `78f2011595b2575c6eaee486a329bcdb4fae58bd`.  
**Purpose:** make every meaningful PlayLiquid revision easy to download, install and inspect on Linux and Windows, similar to the user experience of the upstream ZCode repository.

## 1. Verified current state

The current GitHub Release `playliquid-gameos-v3.15.0` publishes:
- `PlayLiquid-GameOS-3.15.0-linux-amd64.deb`;
- `PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage`;
- `SHA256SUMS`.

The current `.github/workflows/release-desktop.yml` has a Linux job running on `ubuntu-latest`. It builds Linux x64, installs/tests the .deb and AppImage paths, uploads workflow artifacts and can publish a GitHub Release.

The current workflow does **not** build or publish a Windows installer. The desktop bundler recognizes Windows targets (`win`) and the electron-builder configuration includes Windows-specific packaging hooks/NSIS patch logic, so Windows support is a release automation and validation gap to close. Do not claim the Windows install path is already released or verified.

Current PlayLiquid production/preview app identities are already separated from ZCode:
- app IDs `org.playliquid.gameos` / `org.playliquid.gameos.preview`;
- Linux executable `playliquid-gameos`;
- Linux package `playliquid-gameos`;
- PlayLiquid data root separate from ZCode;
- PlayLiquid updater feed deliberately disabled to prevent the ZCode manifest from replacing the fork.

Preserve these isolation properties.

## 2. Required installable targets

### Linux x64
- `.deb` recommended for Ubuntu.
- AppImage portable execution.
- Both checksummed and tied to an exact source SHA.

### Windows x64
- A PlayLiquid-branded installer `.exe` using the existing configured Electron Builder target (verify its exact target and install/uninstall behavior; add NSIS configuration if not yet complete).
- Optional portable `.zip` only if the app's runtime and update/data behavior are properly tested.
- Dedicated PlayLiquid AppUserModelId, install directory, Start Menu entry, uninstall behavior, file/URL associations and user-data path.
- Existing ZCode installation must remain separate and must not be upgraded or overwritten by PlayLiquid.
- Validate Windows Defender/SmartScreen behavior. If code signing is not configured, document the unsigned-installer warning; do not imply trusted publisher signing.

Do not add macOS as a user acceptance requirement in this workstream; it may remain a later target.

## 3. Download at any point / exact revision policy

There must be two supported ways to inspect a build:

### A. Automatic inspection build for each successful main commit

On every successful main integration commit:
- build Linux x64 (.deb + AppImage);
- build Windows x64 installer;
- run platform-native package launch smoke tests;
- produce SHA-256 checksums;
- produce a machine-readable build manifest with source commit SHA, version, target OS/architecture, artifact names, artifact digests, workflow run URL and environment/toolchain versions;
- upload installable files + manifest + checksums as named GitHub Actions workflow artifacts.

Artifact names must include product/version/short SHA/platform/architecture, e.g. `PlayLiquid-GameOS-3.15.1-<sha>-linux-amd64.deb` and `PlayLiquid-GameOS-3.15.1-<sha>-windows-x64.exe`.

Link the exact successful run from the commit/release status and README's inspection-build instructions. PR builds may also upload artifacts, clearly labeled unmerged and non-release.

Actions artifacts may expire according to repository retention settings. They are useful for immediate inspection, but are not an immutable permanent archive.

### B. Rebuild/publish a historical inspection build by exact SHA

Provide a workflow_dispatch input `build_ref` accepting a commit SHA (preferred) or immutable tag:
- checkout that exact revision;
- verify the resolved HEAD equals the requested commit;
- build both Linux and Windows;
- run the relevant package tests;
- upload artifacts and build manifest;
- optionally publish an immutable prerelease with tag `inspection-<version>-<shortsha>`.

A build must never silently move an inspection tag to a different source SHA. If that tag already exists at another SHA, refuse publication.

This allows the user to download/install a revision even after its ordinary Actions artifacts expire, by rebuilding the exact SHA.

## 4. Release lanes

- **PR verification:** compile, test and package smoke where feasible; no stable release promotion.
- **Main inspection builds:** installable Linux + Windows workflow artifacts for every successfully integrated main SHA.
- **Versioned release:** immutable tag/release with Linux + Windows assets and checksums after full acceptance.
- **Historical inspection build:** manual SHA-pinned build/release workflow.
- **Preview identity:** keep a distinct Preview identity so preview packages can be tested without colliding with stable PlayLiquid or upstream ZCode.
- **No inherited auto-update:** keep the upstream ZCode updater disabled. A PlayLiquid-owned secure update feed can be implemented later with signed manifests, artifact verification and rollback protections.

## 5. Native platform smoke requirements

### Ubuntu/Linux
- Build on `ubuntu-latest` or a documented pinned runner.
- Install the generated .deb in a clean environment.
- Launch the installed `playliquid-gameos` binary.
- Launch AppImage using the normal supported path (or document the environment-specific fallback).
- Exercise clean startup, primary shell, New Task, Settings, Model Provider screen, shutdown and second launch.
- Verify no access to or modification of the ZCode installation/profile.
- Verify product identity and checksum.

### Windows
- Build on `windows-latest` using the pinned Node/pnpm versions and frozen lockfile.
- Install the generated .exe in a clean Windows runner.
- Launch the installed application and execute smoke steps over Electron/Playwright/CDP or the approved Windows automation path.
- Exercise first startup, primary shell, New Task, project selector, Browser/Terminal toggles, Settings and Model Provider screen, clean shutdown and second launch.
- Verify Windows app identity, Start Menu entry, installation/uninstall and separate user-data.
- Verify no ZCode installation/profile is overwritten or modified.
- Download the published release installer in a verification job, verify checksum and launch the published asset, not only the local build.

Smoke evidence must state the OS image/version and whether the test ran in a hosted VM, Xvfb or a real desktop. A successful compile is not a launch test.

## 6. Artifact integrity and provenance

Every artifact set includes:
- exact source commit SHA and tag/ref;
- semantic version and product flavor;
- target platform and architecture;
- file names, sizes and SHA-256 digests;
- workflow run and builder environment;
- relevant test/smoke evidence;
- license/NOTICE bundle and third-party notices.

Never publish a mutable latest asset in a way that loses exact version or source provenance. The README may link the latest stable release for convenience, but every version must remain accessible by immutable tag.

## 7. Definition of done

A user can:
1. Open the repository's Releases page for the newest stable Linux/Windows installers.
2. Open a successful main commit's Actions run and download the installable inspection build corresponding to that exact commit.
3. Trigger a SHA-pinned historical inspection build when the ordinary Actions artifact expired.
4. Verify the checksums.
5. Install/launch on Ubuntu/Linux or Windows.
6. Inspect the actual PlayLiquid UI and functionality without cloning/building the repository.
7. Install PlayLiquid alongside ZCode without profile/package collisions.

Only advertise platforms/artifact types with successful native package launch evidence.
