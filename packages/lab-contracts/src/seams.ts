/**
 * External-authority seams referenced by Lab organization contracts.
 *
 * The Lab DESCRIBES organizations; it never becomes a second authority for
 * the things those descriptions reference. Three seams are needed and each
 * is an OPAQUE reference (lock rules 5 / "one authority per concern"):
 *
 * - {@link ZCodeModelAssignmentRef} — model assignments through ZCode
 *   (lock rule 5: ZCode remains the AI workspace/model/provider
 *   authority). The Lab holds the reference; only the ZCode AI runtime
 *   mints routes. This package contains NO model or provider vocabulary
 *   whatsoever — enforced by a dedicated house test.
 * - {@link AgentBodyRef} — Agent Bodies (spec/architecture.md, "Game
 *   Engineering Lab" candidate dimensions). Bodies are avatar/package
 *   content owned by the GameIR/package graph; binding this seam to the
 *   concrete package-system reference happens at implementation graft
 *   time (lab-organization PL-029), mirroring the documented-seam
 *   precedent of `runtime-contracts/src/game-ir-seam.ts`.
 * - {@link AgentToolRef} — tools used by organization agents. Tools are
 *   owned by Tool Fabric (PL-005, provider-neutral, lock rule 21); the
 *   Lab references them opaquely so that no engine/DCC/provider SDK type
 *   can leak into these contracts (E3).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type { Brand } from "@playliquid/game-contracts";
import { isValidIdText } from "@playliquid/game-contracts";
import type { ContentDigest } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";

/**
 * Opaque identifier of a model route assigned by the ZCode AI runtime.
 * Deliberately NOT a model name, provider name or price: routing is
 * ZCode-owned authority (lock rule 5) and stays behind this brand.
 */
export type ZCodeModelRouteId = Brand<string, "ZCodeModelRouteId">;

/**
 * The marker literal proving an assignment came from the ZCode model
 * routing authority. Only the ZCode AI runtime attaches it; Lab-side code
 * constructs references, never assignments.
 */
export type ZCodeModelRoutingAuthority = "zcode-model-routing";

/**
 * A model assignment for one organization agent, expressed as an opaque
 * ZCode seam reference (spec/architecture.md, Lab candidate dimensions:
 * "model assignments through ZCode").
 */
export interface ZCodeModelAssignmentRef {
  readonly authority: ZCodeModelRoutingAuthority;
  readonly route: ZCodeModelRouteId;
}

/** Parses and validates `text` as a {@link ZCodeModelRouteId}, or returns `undefined`. */
export function asZCodeModelRouteId(text: string): ZCodeModelRouteId | undefined {
  return isValidIdText(text) ? (text as ZCodeModelRouteId) : undefined;
}

/** Returns true when `value` is structurally a valid {@link ZCodeModelAssignmentRef}. */
export function isZCodeModelAssignmentRef(value: unknown): value is ZCodeModelAssignmentRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return ref.authority === "zcode-model-routing" && typeof ref.route === "string" && isValidIdText(ref.route);
}

/** Opaque identifier of an Agent Body within the avatar/package graph. */
export type AgentBodyId = Brand<string, "AgentBodyId">;

/**
 * An opaque, digest-pinned reference to an Agent Body. TODO (graft):
 * bind to the concrete avatar-definition/package reference types when
 * lab-organization (PL-029) compiles organizations against the package
 * graph — the bind is a mechanical re-export, exactly like the
 * runtime-contracts game-ir seam graft.
 */
export interface AgentBodyRef {
  readonly bodyId: AgentBodyId;
  readonly revisionDigest: ContentDigest;
}

/** Parses and validates `text` as an {@link AgentBodyId}, or returns `undefined`. */
export function asAgentBodyId(text: string): AgentBodyId | undefined {
  return isValidIdText(text) ? (text as AgentBodyId) : undefined;
}

/** Returns true when `value` is structurally a valid {@link AgentBodyRef}. */
export function isAgentBodyRef(value: unknown): value is AgentBodyRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.bodyId === "string" && isValidIdText(ref.bodyId) && typeof ref.revisionDigest === "string" && isValidContentDigest(ref.revisionDigest);
}

/** Opaque identifier of a Tool Fabric operation/tool an agent may use. */
export type AgentToolId = Brand<string, "AgentToolId">;

/**
 * An opaque, digest-pinned reference to a tool provided by Tool Fabric
 * (lock rule 21: Tool Fabric is provider-neutral). No engine, DCC or
 * vendor vocabulary here — adapters own those details (E3/E4).
 */
export interface AgentToolRef {
  readonly toolId: AgentToolId;
  readonly revisionDigest: ContentDigest;
}

/** Parses and validates `text` as an {@link AgentToolId}, or returns `undefined`. */
export function asAgentToolId(text: string): AgentToolId | undefined {
  return isValidIdText(text) ? (text as AgentToolId) : undefined;
}

/** Returns true when `value` is structurally a valid {@link AgentToolRef}. */
export function isAgentToolRef(value: unknown): value is AgentToolRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.toolId === "string" && isValidIdText(ref.toolId) && typeof ref.revisionDigest === "string" && isValidContentDigest(ref.revisionDigest);
}
