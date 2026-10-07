/**
 * Module role: public surface of @playliquid/engine-adapter-contract — the
 * neutral adapter seam (adapter interface + ids), lifecycle states and
 * transitions, the typed exchange (dispatch in, authoritative outcome out),
 * capability declaration, and the in-memory fake adapter for tests.
 * Provider-neutral only; no engine SDKs, no engine names in identifiers.
 *
 * Implements: PL-005 §3.B (whole package).
 */
export * from "./lifecycle.ts";
export * from "./capability.ts";
export * from "./exchange.ts";
export * from "./adapter.ts";
export * from "./fake-adapter.ts";
