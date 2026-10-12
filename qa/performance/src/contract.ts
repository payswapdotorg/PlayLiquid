/**
 * qa/performance module public contract (PL-042): re-exports the suite's
 * public entrypoint. Cross-module imports go through here or the module
 * entrypoint only; implementation details stay inside the module.
 */
export * from "./index.ts";
