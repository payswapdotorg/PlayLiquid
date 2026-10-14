/**
 * qa-desktop-release module manifest (RW-003, spec/release/ACR-R1).
 *
 * The packaged-app release QA surface: window-level smoke tests of the
 * BUILT Linux application (packaged AppImage / .deb), covering startup
 * and clean shutdown, PlayLiquid product identity, product shell
 * rendering, Studio/Lab/Community navigation, first-run/no-data states,
 * clean-profile startup, no-dev-server independence and both required
 * viewports (390x844, 1280x800). Evidence is actual rendering/window
 * output (Electron under Xvfb + CDP screenshots/logs), with honest
 * baseline reporting on pre-integration main. Harness code may use
 * platform-contracts vocabulary for tenancy-honest fixtures; it imports
 * no domain implementation.
 */
export const qa_desktopReleaseModule = {
  id: "qa-desktop-release",
  requires: ["platform-contracts"],
  provides: ["qa-desktop-release"],
  publicEntrypoints: ["src/index.ts"],
} as const;
