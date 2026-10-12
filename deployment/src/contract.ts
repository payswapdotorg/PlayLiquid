/**
 * deployment module public contract (PL-044): re-exports the module's
 * public entrypoint. Cross-module imports go through here or the module
 * entrypoint only; implementation details stay inside the module.
 */
export * from "./index.ts";
