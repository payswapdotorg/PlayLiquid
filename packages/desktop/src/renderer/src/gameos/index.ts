/**
 * gameos-product-shell public entrypoint (RW-001 baseline, see
 * spec/release/work-items.md). TL baseline placeholder: the product
 * shell implementation (PlayLiquid GameOS default window composing
 * game-ui Studio + gameos-lab + gameos-community behind product
 * navigation with host-wired ports) lands via the release/wa-product-shell
 * work order. This baseline exports only the module manifest so the
 * tree compiles and the architecture gates hold at the frozen base.
 */
export { gameos_productShellModule } from "./module.ts";
