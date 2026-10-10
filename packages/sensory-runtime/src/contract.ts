/**
 * sensory-runtime module public contract (PL-010 governance promotion
 * format): re-exports the package's public entry. Cross-module consumers
 * import only through here or the package entry; implementation details
 * stay internal.
 */
export * from "./index.ts";
