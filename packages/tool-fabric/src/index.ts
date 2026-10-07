/**
 * Module role: public surface of @playliquid/tool-fabric — pure Tool Fabric
 * contracts: surface versioning, capability mediation, tool identity and
 * descriptors, the tool call protocol, and outcome provenance. Types AND
 * validators are exported; there is no runtime dispatch here (that is the
 * PL-019 Tool Fabric runtime work order).
 *
 * Implements: PL-005 §3.A (whole package).
 */
export * from "./versioning.ts";
export * from "./capability.ts";
export * from "./descriptor.ts";
export * from "./call-protocol.ts";
export * from "./provenance.ts";
