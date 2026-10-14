/**
 * gameos-product-shell module public contract (RW-001,
 * spec/release/ACR-R1): re-exports the module's public entrypoint.
 * Cross-module imports go through here or the entrypoint only;
 * implementation details stay inside the module.
 */
export * from "./index.ts";
