/**
 * qa/security module public contract (PL-041): re-exports the suite's
 * public entrypoint. Cross-module imports go through here or the module
 * entrypoint only; implementation details stay inside the module.
 */
export * from "./index.ts";
