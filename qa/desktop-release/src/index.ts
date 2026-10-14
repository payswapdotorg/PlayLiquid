/**
 * qa-desktop-release public entrypoint (RW-003 baseline, see
 * spec/release/work-items.md). TL baseline placeholder: the packaged-app
 * release QA surface (Xvfb + CDP smoke tests of the BUILT Linux
 * application) lands via the release/wc-smoke-evidence work order. This
 * baseline exports only the module manifest so the tree compiles and the
 * architecture gates hold at the frozen base.
 */
export { qa_desktopReleaseModule } from "./module.ts";
