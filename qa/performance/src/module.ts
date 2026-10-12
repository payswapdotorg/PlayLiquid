/**
 * qa/performance module manifest (PL-042 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * cross-system performance suite imports (the PL-033 packages/web/gameos
 * mount precedent: qa/ is not a pnpm workspace root, so sibling packages
 * are imported by relative path, and no package.json/workspace importer
 * exists here — the TL owns that surface). The suites measure the REAL
 * public surfaces of:
 *
 * - simulation (PL-014): the headless Simulation Runtime — session
 *   scale and fixed-tick step throughput;
 * - replay (PL-014): the content-addressed command-stream artifacts —
 *   sealing and verification throughput, tampered-refusal counts;
 * - large-world (PL-039): the LATTICE reference — world composition
 *   through the registry/CAS authorities, R15 chunk streaming with a
 *   moving viewpoint, and wanted-set resolution scaling;
 * - engine-playcanvas (PL-021): the PlayCanvas engine adapter — typed
 *   engine-binding construction and plan application rate (R12).
 */
export const qaPerformanceModule = {
  id: "qa-performance",
  requires: [
    "engine-playcanvas",
    "large-world",
    "replay",
    "simulation",
  ],
  provides: ["qa-performance"],
  publicEntrypoints: ["src/index.ts"],
} as const;
